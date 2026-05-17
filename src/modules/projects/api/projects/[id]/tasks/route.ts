import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveProjectsContext } from '../../../context'
import { taskCreateSchema, taskListQuerySchema, PROJECT_TASK_STATUSES } from '../../../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['projects.tasks.view'] },
  POST: { requireAuth: true, requireFeatures: ['projects.tasks.manage'] },
}

function mapTask(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    description: r.description,
    status: r.status,
    assigneeUserId: r.assignee_user_id,
    position: r.position,
    dueAt: r.due_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function GET(req: Request, params: { params: { id: string } } | { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await (params as any).params
    const ctx = await resolveProjectsContext(req)
    const url = new URL(req.url)
    const queryParams = Object.fromEntries(url.searchParams.entries())
    const query = taskListQuerySchema.parse(queryParams)

    // Verify project belongs to scope
    const projectCheck = await ctx.em.getConnection().execute(
      `SELECT id FROM projects WHERE id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [projectId, ctx.tenantId, ctx.organizationId],
    )
    if (!projectCheck?.length) throw new CrudHttpError(404, { error: 'Project not found' })

    const where: string[] = ['t.deleted_at IS NULL', 't.project_id = ?', 't.tenant_id = ?']
    const bind: unknown[] = [projectId, ctx.tenantId]
    if (query.status) {
      where.push('t.status = ?')
      bind.push(query.status)
    }
    if (query.assigneeUserId) {
      where.push('t.assignee_user_id = ?')
      bind.push(query.assigneeUserId)
    }
    if (query.search) {
      where.push('t.title ILIKE ?')
      bind.push(`%${query.search}%`)
    }

    const rows = await ctx.em.getConnection().execute(
      `SELECT t.* FROM project_tasks t
        WHERE ${where.join(' AND ')}
        ORDER BY t.status, t.position
        LIMIT ${query.pageSize}`,
      bind,
    )
    const tasks = rows.map(mapTask)

    if (query.groupBy === 'status') {
      const groups: Record<string, any[]> = {}
      for (const s of PROJECT_TASK_STATUSES) groups[s] = []
      for (const t of tasks) (groups[t.status] ??= []).push(t)
      return NextResponse.json({ groups })
    }
    return NextResponse.json({ items: tasks, total: tasks.length })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[project.tasks.GET]', err)
    return NextResponse.json({ error: 'Failed to list tasks' }, { status: 500 })
  }
}

export async function POST(req: Request, params: { params: { id: string } } | { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await (params as any).params
    const ctx = await resolveProjectsContext(req)
    const body = taskCreateSchema.parse(await req.json().catch(() => ({})))

    const projectCheck = await ctx.em.getConnection().execute(
      `SELECT id FROM projects WHERE id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [projectId, ctx.tenantId, ctx.organizationId],
    )
    if (!projectCheck?.length) throw new CrudHttpError(404, { error: 'Project not found' })

    const status = body.status ?? 'backlog'
    const maxRows = await ctx.em.getConnection().execute(
      `SELECT COALESCE(MAX(position), -10)::int AS max_pos FROM project_tasks
        WHERE project_id = ? AND status = ? AND deleted_at IS NULL`,
      [projectId, status],
    )
    const position = Number(maxRows?.[0]?.max_pos ?? -10) + 10

    const inserted = await ctx.em.getConnection().execute(
      `INSERT INTO project_tasks
         (project_id, organization_id, tenant_id, title, description, status, assignee_user_id, position, due_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())
       RETURNING *`,
      [
        projectId,
        ctx.organizationId,
        ctx.tenantId,
        body.title,
        body.description ?? null,
        status,
        body.assigneeUserId ?? null,
        position,
        body.dueAt ?? null,
      ],
    )
    return NextResponse.json(mapTask(inserted[0]), { status: 201 })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[project.tasks.POST]', err)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 400 })
  }
}
