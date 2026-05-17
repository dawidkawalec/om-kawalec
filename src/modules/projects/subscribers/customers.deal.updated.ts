import type { EntityManager } from '@mikro-orm/postgresql'

export const metadata = {
  event: 'customers.deal.updated',
  persistent: true,
  id: 'projects:on-deal-updated',
}

type DealUpdatedPayload = {
  id: string
  organizationId: string
  tenantId: string
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

const TRIGGER_STAGES = new Set([
  'potwierdzono',
  'faktura_zaliczkowa',
  'w_realizacji',
  'faktura_koncowa',
  'w_akceptacji',
  'zakonczenie',
  'mrr',
])

export default async function handle(payload: DealUpdatedPayload, ctx: ResolverContext) {
  try {
    if (!payload?.id || !payload?.tenantId || !payload?.organizationId) return
    const em = ctx.resolve<EntityManager>('em')
    const conn = em.getConnection()

    const dealRows = await conn.execute(
      `SELECT id, pipeline_stage, organization_id, tenant_id
         FROM customer_deals
        WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
        LIMIT 1`,
      [payload.id, payload.tenantId],
    )
    if (!dealRows?.length) return
    const deal = dealRows[0] as any
    const stage = (deal.pipeline_stage || '').toLowerCase()
    if (!TRIGGER_STAGES.has(stage)) return

    const existing = await conn.execute(
      `SELECT id FROM projects WHERE deal_id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
      [deal.id, deal.tenant_id],
    )
    if (existing?.length) return

    // Fallback title — deal.title is encrypted at rest; the user will rename
    // from /backend/projects/<id> inline. Using last 8 chars of deal id keeps
    // it traceable.
    const shortId = String(deal.id).slice(0, 8)
    const title = `Projekt #${shortId}`

    try {
      await conn.execute(
        `INSERT INTO projects
           (organization_id, tenant_id, title, status, deal_id, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, now(), now(), now())`,
        [deal.organization_id, deal.tenant_id, title, deal.id],
      )
      console.log(`[projects:on-deal-updated] created project for deal ${deal.id} (stage=${stage})`)
    } catch (err: any) {
      // unique_violation -> another instance / earlier event already created the project
      if (err?.code === '23505') return
      throw err
    }
  } catch (err) {
    console.error('[projects:on-deal-updated] failed:', err)
  }
}
