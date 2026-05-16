import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'

type Config = {
  url: string
  email: string
  password: string
}

type TokenCache = { token: string; expiresAt: number }

// Must stay in sync with PIPELINE_STAGES in src/modules/kawalec/cli.ts.
// 1:1 mirror of the agency's Twenty workspace pipeline.
const STAGES = [
  'new',
  'przetargi',
  'screening',
  'proposal',
  'potwierdzono',
  'faktura_zaliczkowa',
  'w_realizacji',
  'faktura_koncowa',
  'w_akceptacji',
  'zakonczenie',
  'mrr',
  'odrzucono',
] as const

export const TOOLS: Tool[] = [
  {
    name: 'list_companies',
    description:
      'List companies (B2B accounts) in the Kawalec Command Center CRM. Returns id, name, description.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'optional case-insensitive name filter' },
        limit: { type: 'number', default: 50, maximum: 100 },
      },
    },
  },
  {
    name: 'list_people',
    description:
      'List people (individual contacts) in the CRM. Returns id, name, email, phone.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'optional name/email filter' },
        limit: { type: 'number', default: 50, maximum: 100 },
      },
    },
  },
  {
    name: 'list_deals',
    description:
      'List sales deals (opportunities). Optionally filter by `stage` (one of: new, przetargi, screening, proposal, potwierdzono, faktura_zaliczkowa, w_realizacji, faktura_koncowa, w_akceptacji, zakonczenie, mrr, odrzucono) or text `query` across titles.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'string', enum: [...STAGES] },
        query: { type: 'string', description: 'optional title search' },
        limit: { type: 'number', default: 100, maximum: 100 },
      },
    },
  },
  {
    name: 'get_deal',
    description: 'Fetch a single deal with full detail (value, stage, companies, people, dates).',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'deal UUID' },
      },
    },
  },
  {
    name: 'pipeline_summary',
    description:
      'Return deal counts and total value per pipeline stage in the default pipeline. Useful for sales status questions.',
    inputSchema: { type: 'object', properties: {} },
  },
]

type ListEnvelope<T> = { items?: T[]; total?: number; data?: T[] }
function pickItems<T>(env: ListEnvelope<T> | T[] | null | undefined): T[] {
  if (!env) return []
  if (Array.isArray(env)) return env
  return env.items ?? env.data ?? []
}

function decodeJwtExp(token: string): number {
  const [, payload] = token.split('.')
  if (!payload) return Date.now() + 3_600_000
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof json.exp === 'number' ? json.exp * 1000 : Date.now() + 3_600_000
  } catch {
    return Date.now() + 3_600_000
  }
}

export class OmClient {
  private cache: TokenCache | null = null
  constructor(private cfg: Config) {}

  private async getToken(): Promise<string> {
    if (this.cache && this.cache.expiresAt > Date.now() + 60_000) return this.cache.token
    const body = new URLSearchParams({ email: this.cfg.email, password: this.cfg.password })
    const res = await fetch(`${this.cfg.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual',
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`OM auth failed (${res.status}): ${txt.slice(0, 300)}`)
    }
    const data = (await res.json()) as { token?: string }
    if (!data?.token) throw new Error('OM auth response missing token')
    this.cache = { token: data.token, expiresAt: decodeJwtExp(data.token) }
    return data.token
  }

  async request<T = unknown>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const token = await this.getToken()
    const res = await fetch(`${this.cfg.url}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${text.slice(0, 500)}`)
    }
    return (text ? JSON.parse(text) : null) as T
  }
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

async function handleListCompanies(om: OmClient, args: { query?: string; limit?: number }) {
  const params = new URLSearchParams({ pageSize: String(Math.min(args.limit ?? 50, 100)) })
  if (args.query) params.set('search', args.query)
  const data = await om.request<ListEnvelope<any>>(`/api/customers/companies?${params}`)
  const rows = pickItems(data).map((c) => ({
    id: c.id,
    name: c.display_name ?? c.displayName ?? '(unnamed)',
    description: c.description ?? null,
  }))
  return formatJson({ count: rows.length, companies: rows })
}

async function handleListPeople(om: OmClient, args: { query?: string; limit?: number }) {
  const params = new URLSearchParams({ pageSize: String(Math.min(args.limit ?? 50, 100)) })
  if (args.query) params.set('search', args.query)
  const data = await om.request<ListEnvelope<any>>(`/api/customers/people?${params}`)
  const rows = pickItems(data).map((p) => ({
    id: p.id,
    name: p.display_name ?? p.displayName ?? '(unnamed)',
    email: p.primary_email ?? p.primaryEmail ?? null,
    phone: p.primary_phone ?? p.primaryPhone ?? null,
  }))
  return formatJson({ count: rows.length, people: rows })
}

async function handleListDeals(
  om: OmClient,
  args: { stage?: string; query?: string; limit?: number },
) {
  const params = new URLSearchParams({
    pageSize: String(Math.min(args.limit ?? 100, 100)),
    sortField: 'createdAt',
    sortDir: 'desc',
  })
  if (args.query) params.set('search', args.query)
  if (args.stage) params.set('pipelineStage', args.stage)
  const data = await om.request<ListEnvelope<any>>(`/api/customers/deals?${params}`)
  const rows = pickItems(data).map((d) => ({
    id: d.id,
    title: d.title,
    stage: d.pipeline_stage ?? d.pipelineStage ?? null,
    status: d.status ?? null,
    value: d.value_amount ?? d.valueAmount ?? null,
    currency: d.value_currency ?? d.valueCurrency ?? null,
    probability: d.probability ?? null,
    expectedCloseAt: d.expected_close_at ?? d.expectedCloseAt ?? null,
  }))
  return formatJson({
    count: rows.length,
    total: (data as any)?.total ?? rows.length,
    deals: rows,
  })
}

async function handleGetDeal(om: OmClient, args: { id: string }) {
  const data = await om.request<any>(`/api/customers/deals/${args.id}`)
  return formatJson(data)
}

async function fetchAllDeals(om: OmClient): Promise<any[]> {
  const all: any[] = []
  let page = 1
  while (true) {
    const data = await om.request<ListEnvelope<any> & { total?: number }>(
      `/api/customers/deals?pageSize=100&page=${page}&sortField=createdAt&sortDir=desc`,
    )
    const items = pickItems(data)
    all.push(...items)
    const total = (data as any)?.total
    if (items.length < 100 || (typeof total === 'number' && all.length >= total)) break
    page += 1
    if (page > 50) break
  }
  return all
}

async function handlePipelineSummary(om: OmClient) {
  const items = await fetchAllDeals(om)
  type Bucket = { count: number; totalValue: number; currency: string }
  const buckets = new Map<string, Bucket>()
  for (const d of items) {
    const stage = (d.pipeline_stage ?? d.pipelineStage ?? '(none)') as string
    const value = Number(d.value_amount ?? d.valueAmount ?? 0) || 0
    const currency = (d.value_currency ?? d.valueCurrency ?? 'PLN') as string
    const bucket = buckets.get(stage) ?? { count: 0, totalValue: 0, currency }
    bucket.count += 1
    bucket.totalValue += value
    bucket.currency = currency
    buckets.set(stage, bucket)
  }
  const summary = STAGES.map((stage) => {
    const b = buckets.get(stage)
    return {
      stage,
      count: b?.count ?? 0,
      totalValue: b ? Number(b.totalValue.toFixed(2)) : 0,
      currency: b?.currency ?? 'PLN',
    }
  })
  return formatJson({ pipeline: summary, totalDeals: items.length })
}

export function registerHandlers(server: Server, om: OmClient) {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name
    const args = (req.params.arguments ?? {}) as Record<string, unknown>
    try {
      let text: string
      switch (name) {
        case 'list_companies':
          text = await handleListCompanies(om, args as any)
          break
        case 'list_people':
          text = await handleListPeople(om, args as any)
          break
        case 'list_deals':
          text = await handleListDeals(om, args as any)
          break
        case 'get_deal':
          text = await handleGetDeal(om, args as any)
          break
        case 'pipeline_summary':
          text = await handlePipelineSummary(om)
          break
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
      }
      return { content: [{ type: 'text', text }] }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      }
    }
  })
}
