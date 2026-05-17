import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveProjectsContext } from '../context'
import {
  projectCreateSchema,
  projectListQuerySchema,
} from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['projects.manage'] },
}

const SORT_FIELD_MAP: Record<string, string> = {
  title: 'p.title',
  status: 'p.status',
  createdAt: 'p.created_at',
  updatedAt: 'p.updated_at',
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveProjectsContext(req)
    const url = new URL(req.url)
    const params = Object.fromEntries(url.searchParams.entries())
    const query = projectListQuerySchema.parse(params)

    const sortColumn = SORT_FIELD_MAP[query.sortField] ?? 'p.updated_at'
    const sortDir = query.sortDir === 'asc' ? 'asc' : 'desc'
    const offset = (query.page - 1) * query.pageSize

    const where: string[] = ['p.deleted_at IS NULL', 'p.tenant_id = ?', 'p.organization_id = ?']
    const bind: unknown[] = [ctx.tenantId, ctx.organizationId]

    if (query.search) {
      where.push('p.title ILIKE ?')
      bind.push(`%${query.search}%`)
    }
    if (query.status) {
      where.push('p.status = ?')
      bind.push(query.status)
    }
    if (query.dealId) {
      where.push('p.deal_id = ?')
      bind.push(query.dealId)
    }
    if (query.ownerUserId) {
      where.push('p.owner_user_id = ?')
      bind.push(query.ownerUserId)
    }

    const whereSql = where.join(' AND ')
    const conn = ctx.em.getConnection()

    const totalRows = await conn.execute(
      `SELECT COUNT(*)::int AS total FROM projects p WHERE ${whereSql}`,
      bind,
    )
    const total = Number(totalRows?.[0]?.total ?? 0)

    const rows = await conn.execute(
      `SELECT p.*,
              COALESCE((
                SELECT COUNT(*)::int FROM project_tasks t
                 WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.status != 'done'
              ), 0) AS open_tasks_count,
              COALESCE((
                SELECT COUNT(*)::int FROM project_tasks t
                 WHERE t.project_id = p.id AND t.deleted_at IS NULL
              ), 0) AS tasks_count
         FROM projects p
        WHERE ${whereSql}
        ORDER BY ${sortColumn} ${sortDir}
        LIMIT ${query.pageSize} OFFSET ${offset}`,
      bind,
    )

    return NextResponse.json({
      items: rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        status: r.status,
        dealId: r.deal_id,
        ownerUserId: r.owner_user_id,
        startedAt: r.started_at,
        expectedCloseAt: r.expected_close_at,
        completedAt: r.completed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        openTasksCount: r.open_tasks_count,
        tasksCount: r.tasks_count,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[projects.GET]', err)
    return NextResponse.json({ error: 'Failed to list projects' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveProjectsContext(req)
    const body = projectCreateSchema.parse(await req.json().catch(() => ({})))
    const conn = ctx.em.getConnection()

    const rows = await conn.execute(
      `INSERT INTO projects
         (organization_id, tenant_id, title, description, status, deal_id, owner_user_id,
          started_at, expected_close_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())
       RETURNING *`,
      [
        ctx.organizationId,
        ctx.tenantId,
        body.title,
        body.description ?? null,
        body.status ?? 'active',
        body.dealId ?? null,
        body.ownerUserId ?? null,
        body.startedAt ?? null,
        body.expectedCloseAt ?? null,
      ],
    )
    const row = rows?.[0]
    return NextResponse.json(
      { id: row.id, title: row.title, status: row.status },
      { status: 201 },
    )
  } catch (err: any) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err?.code === '23505') {
      return NextResponse.json(
        { error: 'Project for this deal already exists', code: 'duplicate_deal' },
        { status: 409 },
      )
    }
    console.error('[projects.POST]', err)
    return NextResponse.json({ error: err?.message || 'Failed to create project' }, { status: 400 })
  }
}
