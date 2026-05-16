import pg from 'pg'

const { Client: PgClient } = pg
type PgClient = InstanceType<typeof PgClient>

export type Scope = { tenantId: string; organizationId: string }

export type ImportStats = {
  companies: number
  people: number
  deals: number
  updated: number
  skippedExisting: number
}

// 1:1 mirror of the Twenty workspace's opportunity_stage_enum.
// Keep these values in sync with PIPELINE_STAGES in cli.ts.
const TWENTY_STAGE_MAP: Record<string, string> = {
  NEW: 'new',
  PRZETARGI: 'przetargi',
  SCREENING: 'screening',
  PROPOSAL: 'proposal',
  POTWIERDZONO: 'potwierdzono',
  FAKTURA_ZALICZKOWA: 'faktura_zaliczkowa',
  W_REALIZACJI: 'w_realizacji',
  FAKTURA_KONCOWA: 'faktura_koncowa',
  W_AKCEPTACJI: 'w_akceptacji',
  ZAKONCZENIE: 'zakonczenie',
  MRR: 'mrr',
  ODRZUCONO: 'odrzucono',
}

// Stages where OM should treat the deal as closed-won / closed-lost so
// downstream filters (closure_outcome, status) line up.
const WON_STAGES = new Set([
  'potwierdzono',
  'faktura_zaliczkowa',
  'w_realizacji',
  'faktura_koncowa',
  'w_akceptacji',
  'zakonczenie',
  'mrr',
])
const LOST_STAGES = new Set(['odrzucono'])

async function resolveTwentyWorkspace(twentyClient: PgClient): Promise<string> {
  const res = await twentyClient.query(
    `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'workspace_%' ORDER BY nspname LIMIT 1`,
  )
  if (!res.rows.length) {
    throw new Error('No workspace_* schema found in Twenty Postgres. Is the DB initialized?')
  }
  return res.rows[0].nspname as string
}

async function login(
  appUrl: string,
  email: string,
  password: string,
): Promise<string> {
  // OM's /api/auth/login expects application/x-www-form-urlencoded or
  // multipart/form-data — not JSON. Sending JSON yields 400 "Invalid email or password".
  const body = new URLSearchParams({ email, password }).toString()
  const res = await fetch(`${appUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  })
  // OM may respond 200 with cookies, or 302 redirect-with-set-cookie.
  if (res.status !== 200 && res.status !== 302) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Auth failed (${res.status}): ${txt.slice(0, 300)}`)
  }
  const raw = res.headers.get('set-cookie')
  if (!raw) throw new Error('Login succeeded but no Set-Cookie header. Check APP_URL.')
  // Split on comma that separates cookies (commas inside Expires are not followed by `key=`).
  return raw
    .split(/,(?=[^;]+=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

async function omRequest<T = any>(
  appUrl: string,
  cookie: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${appUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

function pickItems<T = any>(payload: any): T[] {
  if (!payload) return []
  if (Array.isArray(payload)) return payload as T[]
  if (Array.isArray(payload.items)) return payload.items as T[]
  if (Array.isArray(payload.data)) return payload.data as T[]
  return []
}

function pickCreatedId(payload: any): string | undefined {
  if (!payload) return undefined
  if (typeof payload.id === 'string') return payload.id
  if (payload.data && typeof payload.data.id === 'string') return payload.data.id
  return undefined
}

export async function importTwenty(opts: {
  twentyUrl: string
  appUrl: string
  superadminEmail: string
  superadminPassword: string
  dryRun?: boolean
  limit?: number
}): Promise<ImportStats> {
  const tw = new PgClient({ connectionString: opts.twentyUrl })
  await tw.connect()
  try {
    const ws = await resolveTwentyWorkspace(tw)
    console.log(`Twenty workspace: ${ws}`)

    let cookie = ''
    if (!opts.dryRun) {
      cookie = await login(opts.appUrl, opts.superadminEmail, opts.superadminPassword)
      console.log(`Authenticated to ${opts.appUrl} as ${opts.superadminEmail}`)
    } else {
      console.log('[dry-run] skipping OM auth and writes')
    }

    const stats: ImportStats = { companies: 0, people: 0, deals: 0, updated: 0, skippedExisting: 0 }
    const companyMap = new Map<string, string>()
    const personMap = new Map<string, string>()

    const limitSql = opts.limit ? ` LIMIT ${Number(opts.limit)}` : ''

    // -- Companies --
    let existingCompanyByName = new Map<string, string>()
    if (!opts.dryRun) {
      const list = await omRequest<any>(
        opts.appUrl,
        cookie,
        'GET',
        '/api/customers/companies?per_page=500',
      )
      for (const c of pickItems(list)) {
        if (c?.display_name && c?.id) existingCompanyByName.set(c.display_name, c.id)
      }
    }
    const companyRes = await tw.query(
      `SELECT id, name, "addressAddressCity" AS city, employees,
              "annualRecurringRevenueAmountMicros" AS arr_micros,
              "annualRecurringRevenueCurrencyCode" AS arr_ccy,
              "domainNamePrimaryLinkUrl" AS domain,
              "linkedinLinkPrimaryLinkUrl" AS linkedin,
              "idealCustomerProfile" AS icp
         FROM "${ws}".company
        WHERE "deletedAt" IS NULL${limitSql}`,
    )
    for (const row of companyRes.rows) {
      const name = (row.name || '').trim() || `(Twenty ${String(row.id).slice(0, 8)})`
      const existingId = existingCompanyByName.get(name)
      if (existingId) {
        companyMap.set(row.id, existingId)
        stats.skippedExisting++
        continue
      }
      const desc = [
        row.domain ? `Website: ${row.domain}` : null,
        row.linkedin ? `LinkedIn: ${row.linkedin}` : null,
        row.employees ? `Employees: ${row.employees}` : null,
        row.icp ? 'ICP' : null,
        row.arr_micros
          ? `ARR: ${(Number(row.arr_micros) / 1_000_000).toFixed(0)} ${row.arr_ccy || ''}`.trim()
          : null,
        row.city ? `City: ${row.city}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined
      if (opts.dryRun) {
        console.log(`  [dry] company: ${name}`)
        stats.companies++
        continue
      }
      const created = await omRequest<any>(opts.appUrl, cookie, 'POST', '/api/customers/companies', {
        displayName: name,
        description: desc,
      })
      const newId = pickCreatedId(created)
      if (!newId) {
        throw new Error(`Company create returned no id: ${JSON.stringify(created).slice(0, 200)}`)
      }
      companyMap.set(row.id, newId)
      stats.companies++
    }
    console.log(`Companies: ${stats.companies} created, ${stats.skippedExisting} pre-existing`)

    // -- People --
    const skippedBefore = stats.skippedExisting
    let existingPersonByEmail = new Map<string, string>()
    if (!opts.dryRun) {
      const list = await omRequest<any>(
        opts.appUrl,
        cookie,
        'GET',
        '/api/customers/people?per_page=500',
      )
      for (const p of pickItems(list)) {
        if (p?.primary_email && p?.id) existingPersonByEmail.set(p.primary_email, p.id)
      }
    }
    const personRes = await tw.query(
      `SELECT id, "nameFirstName" AS first_name, "nameLastName" AS last_name,
              "emailsPrimaryEmail" AS email,
              "phonesPrimaryPhoneNumber" AS phone,
              "phonesPrimaryPhoneCallingCode" AS phone_cc,
              "jobTitle" AS job_title, city,
              "companyId" AS twenty_company_id
         FROM "${ws}".person
        WHERE "deletedAt" IS NULL${limitSql}`,
    )
    for (const row of personRes.rows) {
      const fullName =
        [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
        row.email ||
        `(Twenty ${String(row.id).slice(0, 8)})`
      if (row.email && existingPersonByEmail.has(row.email)) {
        personMap.set(row.id, existingPersonByEmail.get(row.email)!)
        stats.skippedExisting++
        continue
      }
      const phone = row.phone
        ? row.phone_cc
          ? `${row.phone_cc} ${row.phone}`
          : row.phone
        : undefined
      const desc =
        [row.job_title ? `Title: ${row.job_title}` : null, row.city ? `City: ${row.city}` : null]
          .filter(Boolean)
          .join(' · ') || undefined
      if (opts.dryRun) {
        console.log(`  [dry] person: ${fullName} <${row.email || ''}>`)
        stats.people++
        continue
      }
      const firstName = (row.first_name || '').trim() || (row.email ? row.email.split('@')[0] : fullName)
      const lastName = (row.last_name || '').trim() || '-'
      const created = await omRequest<any>(opts.appUrl, cookie, 'POST', '/api/customers/people', {
        firstName,
        lastName,
        displayName: fullName,
        primaryEmail: row.email || undefined,
        primaryPhone: phone,
        description: desc,
      })
      const newId = pickCreatedId(created)
      if (!newId) {
        throw new Error(`Person create returned no id: ${JSON.stringify(created).slice(0, 200)}`)
      }
      personMap.set(row.id, newId)
      stats.people++
    }
    console.log(
      `People: ${stats.people} created, ${stats.skippedExisting - skippedBefore} pre-existing`,
    )

    // -- Deals --
    const updatedBefore = stats.updated
    let existingDealByTitle = new Map<string, string>()
    let defaultPipelineId: string | undefined
    // value (lowercased Twenty enum) -> pipeline_stages.id
    let stageIdByValue = new Map<string, string>()
    if (!opts.dryRun) {
      const list = await omRequest<any>(
        opts.appUrl,
        cookie,
        'GET',
        '/api/customers/deals?pageSize=100',
      )
      for (const d of pickItems(list)) {
        if (d?.title && d?.id) existingDealByTitle.set(d.title, d.id)
      }
      // Resolve default pipeline.
      const pipelinesList = await omRequest<any>(
        opts.appUrl,
        cookie,
        'GET',
        '/api/customers/pipelines',
      )
      for (const p of pickItems(pipelinesList)) {
        if (p?.is_default || p?.isDefault) {
          defaultPipelineId = p.id
          break
        }
      }
      if (!defaultPipelineId) {
        const items = pickItems<any>(pipelinesList)
        defaultPipelineId = items[0]?.id
      }
      // Resolve stage ids. customer_pipeline_stages has only {id, name, position};
      // map Twenty enum value -> Polish display label -> stage.id.
      const valueToLabel: Record<string, string> = {
        new: 'Nowy',
        przetargi: 'Przetargi',
        screening: 'Screening',
        proposal: 'Oferta',
        potwierdzono: 'Potwierdzono',
        faktura_zaliczkowa: 'Faktura zaliczkowa',
        w_realizacji: 'W realizacji',
        faktura_koncowa: 'Faktura końcowa',
        w_akceptacji: 'W akceptacji',
        zakonczenie: 'Zakończenie',
        mrr: 'MRR',
        odrzucono: 'Odrzucono',
      }
      if (defaultPipelineId) {
        const stagesList = await omRequest<any>(
          opts.appUrl,
          cookie,
          'GET',
          `/api/customers/pipeline-stages?pipeline_id=${defaultPipelineId}`,
        )
        const nameToId = new Map<string, string>()
        for (const s of pickItems(stagesList)) {
          const name = (s?.name ?? s?.label ?? '').toString().trim()
          if (name && s?.id) nameToId.set(name, s.id)
        }
        for (const [value, label] of Object.entries(valueToLabel)) {
          const id = nameToId.get(label)
          if (id) stageIdByValue.set(value, id)
        }
      }
    }
    const oppRes = await tw.query(
      `SELECT id, name, "amountAmountMicros" AS amount_micros,
              "amountCurrencyCode" AS ccy, "closeDate" AS close_date,
              stage::text AS stage,
              "companyId" AS twenty_company_id,
              "pointOfContactId" AS twenty_poc_id
         FROM "${ws}".opportunity
        WHERE "deletedAt" IS NULL${limitSql}`,
    )
    for (const row of oppRes.rows) {
      const title = (row.name || '').trim() || `(Twenty deal ${String(row.id).slice(0, 8)})`
      const stageValue = TWENTY_STAGE_MAP[row.stage as string] || 'new'
      const closureOutcome = WON_STAGES.has(stageValue)
        ? 'won'
        : LOST_STAGES.has(stageValue)
          ? 'lost'
          : undefined
      const status = WON_STAGES.has(stageValue)
        ? 'win'
        : LOST_STAGES.has(stageValue)
          ? 'loose'
          : 'open'
      const amount = row.amount_micros ? Number(row.amount_micros) / 1_000_000 : undefined
      const companyOmId = row.twenty_company_id ? companyMap.get(row.twenty_company_id) : undefined
      const personOmId = row.twenty_poc_id ? personMap.get(row.twenty_poc_id) : undefined
      if (opts.dryRun) {
        console.log(
          `  [dry] deal: ${title} -> stage=${stageValue}, value=${amount ?? '-'} ${row.ccy || ''}`,
        )
        stats.deals++
        continue
      }
      const existingId = existingDealByTitle.get(title)
      const stageId = stageIdByValue.get(stageValue)
      if (existingId) {
        // Idempotent re-run: rewrite stage on the row we created earlier so a
        // schema change (e.g. switching from hybrid -> Twenty stages) sticks.
        const body: Record<string, unknown> = {
          id: existingId,
          pipelineStage: stageValue,
          pipelineId: defaultPipelineId,
          pipelineStageId: stageId,
          status,
          closureOutcome,
        }
        await omRequest<any>(opts.appUrl, cookie, 'PUT', '/api/customers/deals', body)
        stats.updated++
        continue
      }
      const body: Record<string, unknown> = {
        title,
        status,
        pipelineStage: stageValue,
        pipelineId: defaultPipelineId,
        pipelineStageId: stageId,
        valueAmount: amount,
        valueCurrency: row.ccy || 'PLN',
        expectedCloseAt: row.close_date,
        closureOutcome,
        companyIds: companyOmId ? [companyOmId] : undefined,
        personIds: personOmId ? [personOmId] : undefined,
      }
      const created = await omRequest<any>(opts.appUrl, cookie, 'POST', '/api/customers/deals', body)
      const newId = pickCreatedId(created)
      if (!newId) {
        throw new Error(`Deal create returned no id: ${JSON.stringify(created).slice(0, 200)}`)
      }
      stats.deals++
    }
    console.log(
      `Deals: ${stats.deals} created, ${stats.updated - updatedBefore} updated`,
    )

    return stats
  } finally {
    await tw.end().catch(() => {})
  }
}
