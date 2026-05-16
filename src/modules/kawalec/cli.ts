import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { importTwenty } from './import-twenty'

type PipelineStage = {
  name: string
  value: string
  label: string
  color: string
  icon: string
}

// 1:1 mirror of the agency's Twenty pipeline (workspace-customized
// opportunity_stage_enum). Order matches the funnel left-to-right.
const PIPELINE_STAGES: PipelineStage[] = [
  { name: 'Nowy',               value: 'new',                 label: 'Nowy',               color: '#94a3b8', icon: 'lucide:sparkles'      },
  { name: 'Przetargi',          value: 'przetargi',           label: 'Przetargi',          color: '#6366f1', icon: 'lucide:gavel'         },
  { name: 'Screening',          value: 'screening',           label: 'Screening',          color: '#3b82f6', icon: 'lucide:filter'        },
  { name: 'Oferta',             value: 'proposal',            label: 'Oferta',             color: '#f97316', icon: 'lucide:file-text'     },
  { name: 'Potwierdzono',       value: 'potwierdzono',        label: 'Potwierdzono',       color: '#22c55e', icon: 'lucide:check-circle-2'},
  { name: 'Faktura zaliczkowa', value: 'faktura_zaliczkowa',  label: 'Faktura zaliczkowa', color: '#06b6d4', icon: 'lucide:file-text'     },
  { name: 'W realizacji',       value: 'w_realizacji',        label: 'W realizacji',       color: '#eab308', icon: 'lucide:loader'        },
  { name: 'Faktura końcowa',    value: 'faktura_koncowa',     label: 'Faktura końcowa',    color: '#0891b2', icon: 'lucide:file-check'    },
  { name: 'W akceptacji',       value: 'w_akceptacji',        label: 'W akceptacji',       color: '#a855f7', icon: 'lucide:eye'           },
  { name: 'Zakończenie',        value: 'zakonczenie',         label: 'Zakończenie',        color: '#16a34a', icon: 'lucide:trophy'        },
  { name: 'MRR',                value: 'mrr',                 label: 'MRR',                color: '#14b8a6', icon: 'lucide:repeat'        },
  { name: 'Odrzucono',          value: 'odrzucono',           label: 'Odrzucono',          color: '#ef4444', icon: 'lucide:x-circle'      },
]

function parseArgs(rest: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i]
    if (!k?.startsWith('--')) continue
    const key = k.slice(2)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out[key] = 'true'
    } else {
      out[key] = next
      i++
    }
  }
  return out
}

async function resolveDefaultScope(em: any): Promise<{ tenantId: string; organizationId: string } | null> {
  const conn = em.getConnection()
  const rows = await conn.execute(
    `SELECT tenant_id, organization_id, COUNT(*) AS deals
       FROM customer_deals
      GROUP BY tenant_id, organization_id
      ORDER BY deals DESC
      LIMIT 1`,
  )
  if (rows.length) return { tenantId: rows[0].tenant_id, organizationId: rows[0].organization_id }
  const orgRows = await conn.execute(
    `SELECT t.id AS tenant_id, o.id AS organization_id
       FROM tenants t
       JOIN organizations o ON o.tenant_id = t.id
       LIMIT 1`,
  )
  if (orgRows.length) return { tenantId: orgRows[0].tenant_id, organizationId: orgRows[0].organization_id }
  return null
}

const setupCrm = {
  command: 'setup-crm',
  async run(rest: string[]): Promise<void> {
    const args = parseArgs(rest)
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any

    let scope: { tenantId: string; organizationId: string } | null
    if (args.tenant && args.org) {
      scope = { tenantId: args.tenant, organizationId: args.org }
    } else {
      scope = await resolveDefaultScope(em)
    }
    if (!scope) {
      console.error('No tenant/organization found. Pass --tenant <id> --org <id> or run after `yarn initialize`.')
      return
    }
    const { tenantId, organizationId } = scope

    await em.transactional(async (tem: any) => {
      const conn = tem.getConnection()

      // 1. Ensure default pipeline exists.
      const pipelineRows = await conn.execute(
        `SELECT id FROM customer_pipelines
          WHERE tenant_id = ? AND organization_id = ? AND is_default = true
          LIMIT 1`,
        [tenantId, organizationId],
      )
      let pipelineId: string
      if (pipelineRows.length === 0) {
        const created = await conn.execute(
          `INSERT INTO customer_pipelines (organization_id, tenant_id, name, is_default, created_at, updated_at)
           VALUES (?, ?, 'Default Pipeline', true, now(), now())
           RETURNING id`,
          [organizationId, tenantId],
        )
        pipelineId = created[0].id
      } else {
        pipelineId = pipelineRows[0].id
      }

      // 2. Idempotent replace of pipeline stages.
      //    Strategy: null-out deal references, delete existing, insert new, relink deals by lowercased name.
      await conn.execute(
        `UPDATE customer_deals SET pipeline_stage_id = NULL WHERE pipeline_id = ?`,
        [pipelineId],
      )
      await conn.execute(`DELETE FROM customer_pipeline_stages WHERE pipeline_id = ?`, [pipelineId])
      for (let i = 0; i < PIPELINE_STAGES.length; i++) {
        const stage = PIPELINE_STAGES[i]
        await conn.execute(
          `INSERT INTO customer_pipeline_stages (organization_id, tenant_id, pipeline_id, name, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, now(), now())`,
          [organizationId, tenantId, pipelineId, stage.name, i],
        )
      }
      //    First: direct match on new name. Then: legacy OM scaffold name aliases
      //    so example deals from `yarn initialize` end up in sensible columns.
      await conn.execute(
        `UPDATE customer_deals d SET pipeline_stage_id = s.id
           FROM customer_pipeline_stages s
          WHERE s.pipeline_id = d.pipeline_id
            AND LOWER(s.name) = LOWER(d.pipeline_stage)`,
      )
      // Compat aliases: existing rows that still hold legacy or OM-scaffold
      // stage values get rewritten to the closest Twenty-pipeline equivalent.
      // The Twenty importer subsequently overwrites these with the precise
      // per-deal stage when it runs.
      const LEGACY_ALIASES: Array<[string, string]> = [
        // legacy hybrid (Phase 1 v1) -> Twenty equivalents
        ['lead', 'Nowy'],
        ['qualified', 'Screening'],
        ['discovery', 'Screening'],
        ['proposal', 'Oferta'],
        ['negotiation', 'Oferta'],
        ['won', 'Zakończenie'],
        ['lost', 'Odrzucono'],
        ['loose', 'Odrzucono'],
        ['stalled', 'Odrzucono'],
        // OM scaffold example values
        ['opportunity', 'Screening'],
        ['marketing_qualified_lead', 'Nowy'],
        ['sales_qualified_lead', 'Screening'],
        ['offering', 'Oferta'],
        ['negotiations', 'Oferta'],
        ['win', 'Zakończenie'],
      ]
      for (const [legacy, target] of LEGACY_ALIASES) {
        const stageDef = PIPELINE_STAGES.find((s) => s.name === target)
        if (!stageDef) continue
        const legacyLc = legacy.toLowerCase().replace(/'/g, "''")
        const targetValue = stageDef.value.replace(/'/g, "''")
        const targetName = target.replace(/'/g, "''")
        const sqlText = `UPDATE customer_deals SET
              pipeline_stage_id = (
                SELECT id FROM customer_pipeline_stages
                 WHERE pipeline_id = customer_deals.pipeline_id
                   AND name = '${targetName}'
                 LIMIT 1
              ),
              pipeline_stage = '${targetValue}'
            WHERE pipeline_stage_id IS NULL
              AND LOWER(pipeline_stage) = '${legacyLc}'
            RETURNING id`
        const result = await conn.execute(sqlText)
        const rowCount = Array.isArray(result) ? result.length : (result as any)?.affectedRows ?? '?'
        console.log(`  [alias] ${legacy} -> ${target}: matched ${rowCount} deal(s)`)
      }

      // 3. Idempotent replace of pipeline_stage dictionary (labels, colors, icons).
      //    Delete current entries for this scope, re-insert ours.
      await conn.execute(
        `DELETE FROM customer_dictionary_entries
          WHERE tenant_id = ? AND organization_id = ? AND kind = 'pipeline_stage'`,
        [tenantId, organizationId],
      )
      for (const stage of PIPELINE_STAGES) {
        await conn.execute(
          `INSERT INTO customer_dictionary_entries
             (organization_id, tenant_id, kind, value, normalized_value, label, color, icon, created_at, updated_at)
           VALUES (?, ?, 'pipeline_stage', ?, ?, ?, ?, ?, now(), now())`,
          [
            organizationId,
            tenantId,
            stage.value,
            stage.value.toLowerCase(),
            stage.label,
            stage.color,
            stage.icon,
          ],
        )
      }

      // 4. Tenant / organization rename (only if still default scaffold name).
      //    Note: MikroORM em wraps tenants under multi-tenancy filters; raw connection
      //    is fine for tenants/organizations because they are root entities.
      if (args['rename-tenant'] !== 'false') {
        await conn.execute(
          `UPDATE tenants SET name = 'Kawalec Agency', updated_at = now()
            WHERE id = '${tenantId.replace(/'/g, "''")}'
              AND name IN ('Acme', 'Acme Corp', 'Acme Corp Tenant', 'Acme Tenant', 'Default Tenant')`,
        )
        await conn.execute(
          `UPDATE organizations SET name = 'Kawalec Agency', updated_at = now()
            WHERE id = '${organizationId.replace(/'/g, "''")}'
              AND name IN ('Acme', 'Acme Corp', 'Acme Corp Organization', 'Default Organization')`,
        )
      }

      await tem.flush()
    })

    console.log(`Kawalec CRM setup applied (tenant=${tenantId}, org=${organizationId}).`)
    console.log(`Stages: ${PIPELINE_STAGES.map((s) => s.name).join(' / ')}`)
  },
}

const importTwentyCmd = {
  command: 'import-twenty',
  async run(rest: string[]): Promise<void> {
    const args = parseArgs(rest)
    const twentyUrl =
      args.twenty || args['twenty-url'] || process.env.TWENTY_DATABASE_URL || ''
    const appUrl = args['app-url'] || process.env.APP_URL || 'http://localhost:3000'
    const email =
      args.email || process.env.OM_INIT_SUPERADMIN_EMAIL || ''
    const password =
      args.password || process.env.OM_INIT_SUPERADMIN_PASSWORD || ''
    const dryRun = args['dry-run'] === 'true' || args.dryRun === 'true'
    const limit = args.limit ? Number(args.limit) : undefined

    if (!twentyUrl) {
      console.error(
        'Missing TWENTY_DATABASE_URL. Pass --twenty <postgres-url> or set TWENTY_DATABASE_URL in .env.',
      )
      return
    }
    if (!dryRun && (!email || !password)) {
      console.error(
        'Need OM superadmin credentials. Pass --email and --password, or set OM_INIT_SUPERADMIN_EMAIL/PASSWORD.',
      )
      return
    }

    console.log(`Importing from Twenty -> ${appUrl} (dryRun=${dryRun}, limit=${limit ?? 'none'})`)
    const stats = await importTwenty({
      twentyUrl,
      appUrl,
      superadminEmail: email,
      superadminPassword: password,
      dryRun,
      limit,
    })
    console.log(
      `\nDone. companies=${stats.companies} people=${stats.people} ` +
        `deals=${stats.deals} updated=${stats.updated} skippedExisting=${stats.skippedExisting}`,
    )
  },
}

const kawalecCli = [setupCrm, importTwentyCmd]
export default kawalecCli
