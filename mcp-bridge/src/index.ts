#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'

const OM_URL = (process.env.OM_URL || 'https://cc.kawalec.pl').replace(/\/$/, '')
const OM_EMAIL = process.env.OM_EMAIL
const OM_PASSWORD = process.env.OM_PASSWORD

if (!OM_EMAIL || !OM_PASSWORD) {
  console.error('FATAL: OM_EMAIL and OM_PASSWORD env vars are required.')
  process.exit(1)
}

// ---- JWT auth (with refresh on near-expiry) -------------------------------

type TokenCache = { token: string; expiresAt: number }
let cached: TokenCache | null = null

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

async function getToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const body = new URLSearchParams({ email: OM_EMAIL!, password: OM_PASSWORD! })
  const res = await fetch(`${OM_URL}/api/auth/login`, {
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
  cached = { token: data.token, expiresAt: decodeJwtExp(data.token) }
  return data.token
}

async function omFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await getToken()
  const res = await fetch(`${OM_URL}${path}`, {
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

// ---- Helpers --------------------------------------------------------------

type ListEnvelope<T> = { items?: T[]; total?: number; data?: T[] }
function pickItems<T>(env: ListEnvelope<T> | T[] | null | undefined): T[] {
  if (!env) return []
  if (Array.isArray(env)) return env
  return env.items ?? env.data ?? []
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

// ---- Tool definitions -----------------------------------------------------

const STAGES = [
  'loose',
  'lead',
  'qualified',
  'discovery',
  'proposal',
  'negotiation',
  'won',
  'lost',
  'stalled',
] as const

const TOOLS: Tool[] = [
  {
    name: 'list_companies',
    description:
      'List companies (B2B accounts) in the Kawalec Command Center CRM. Returns id, name, plus a short description if available.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'optional case-insensitive name filter' },
        limit: { type: 'number', default: 50, maximum: 500 },
      },
    },
  },
  {
    name: 'list_people',
    description:
      'List people (individual contacts) in the CRM. Returns id, name, email, phone, and company link.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'optional name/email filter' },
        limit: { type: 'number', default: 50, maximum: 500 },
      },
    },
  },
  {
    name: 'list_deals',
    description:
      'List sales deals (opportunities). Optionally filter by stage value (lead/qualified/proposal/won/...) or text search across titles.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'string', enum: [...STAGES], description: 'filter deals by current pipeline stage' },
        query: { type: 'string', description: 'optional title search' },
        limit: { type: 'number', default: 100, maximum: 500 },
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

// ---- Tool dispatch --------------------------------------------------------

async function handleListCompanies(args: { query?: string; limit?: number }) {
  const params = new URLSearchParams({ pageSize: String(Math.min(args.limit ?? 50, 100)) })
  if (args.query) params.set('search', args.query)
  const data = await omFetch<ListEnvelope<any>>(`/api/customers/companies?${params}`)
  const rows = pickItems(data).map((c) => ({
    id: c.id,
    name: c.display_name ?? c.displayName ?? '(unnamed)',
    description: c.description ?? null,
  }))
  return formatJson({ count: rows.length, companies: rows })
}

async function handleListPeople(args: { query?: string; limit?: number }) {
  const params = new URLSearchParams({ pageSize: String(Math.min(args.limit ?? 50, 100)) })
  if (args.query) params.set('search', args.query)
  const data = await omFetch<ListEnvelope<any>>(`/api/customers/people?${params}`)
  const rows = pickItems(data).map((p) => ({
    id: p.id,
    name: p.display_name ?? p.displayName ?? '(unnamed)',
    email: p.primary_email ?? p.primaryEmail ?? null,
    phone: p.primary_phone ?? p.primaryPhone ?? null,
  }))
  return formatJson({ count: rows.length, people: rows })
}

async function handleListDeals(args: { stage?: string; query?: string; limit?: number }) {
  const params = new URLSearchParams({
    pageSize: String(Math.min(args.limit ?? 100, 100)),
    sortField: 'createdAt',
    sortDir: 'desc',
  })
  if (args.query) params.set('search', args.query)
  if (args.stage) params.set('pipelineStage', args.stage)
  const data = await omFetch<ListEnvelope<any>>(`/api/customers/deals?${params}`)
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
  return formatJson({ count: rows.length, total: (data as any)?.total ?? rows.length, deals: rows })
}

async function handleGetDeal(args: { id: string }) {
  const data = await omFetch<any>(`/api/customers/deals/${args.id}`)
  return formatJson(data)
}

async function fetchAllDeals(): Promise<any[]> {
  const all: any[] = []
  let page = 1
  // OM caps pageSize at 100; iterate until we hit `total` or get a short page.
  while (true) {
    const data = await omFetch<ListEnvelope<any> & { total?: number }>(
      `/api/customers/deals?pageSize=100&page=${page}&sortField=createdAt&sortDir=desc`,
    )
    const items = pickItems(data)
    all.push(...items)
    const total = (data as any)?.total
    if (items.length < 100 || (typeof total === 'number' && all.length >= total)) break
    page += 1
    if (page > 50) break // hard ceiling for safety
  }
  return all
}

async function handlePipelineSummary() {
  const items = await fetchAllDeals()
  const buckets = new Map<string, { count: number; totalValue: number; currency: string }>()
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

// ---- Server wiring --------------------------------------------------------

const server = new Server(
  { name: 'kawalec-command-center', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    let text: string
    switch (name) {
      case 'list_companies':
        text = await handleListCompanies(args as any)
        break
      case 'list_people':
        text = await handleListPeople(args as any)
        break
      case 'list_deals':
        text = await handleListDeals(args as any)
        break
      case 'get_deal':
        text = await handleGetDeal(args as any)
        break
      case 'pipeline_summary':
        text = await handlePipelineSummary()
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

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`kawalec-mcp bridge ready (target: ${OM_URL}, account: ${OM_EMAIL})`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
