import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveProjectsContext } from '../context'
import { projectUpdateSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['projects.view'] },
  PUT: { requireAuth: true, requireFeatures: ['projects.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['projects.manage'] },
}

function mapRow(r: any) {
  return {
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
  }
}

async function loadProject(req: Request, id: string) {
  const ctx = await resolveProjectsContext(req)
  const rows = await ctx.em.getConnection().execute(
    `SELECT * FROM projects WHERE id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL LIMIT 1`,
    [id, ctx.tenantId, ctx.organizationId],
  )
  if (!rows?.length) throw new CrudHttpError(404, { error: 'Project not found' })
  return { ctx, project: rows[0] as any }
}

export async function GET(req: Request, params: { params: { id: string } } | { params: Promise<{ id: string }> }) {
  try {
    const { id } = await (params as any).params
    const { project } = await loadProject(req, id)
    return NextResponse.json(mapRow(project))
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[project.GET]', err)
    return NextResponse.json({ error: 'Failed to load project' }, { status: 500 })
  }
}

export async function PUT(req: Request, params: { params: { id: string } } | { params: Promise<{ id: string }> }) {
  try {
    const { id } = await (params as any).params
    const { ctx } = await loadProject(req, id)
    const body = projectUpdateSchema.parse(await req.json().catch(() => ({})))
    const sets: string[] = []
    const bind: unknown[] = []
    const push = (col: string, val: unknown) => {
      sets.push(`${col} = ?`)
      bind.push(val)
    }
    if (body.title !== undefined) push('title', body.title)
    if (body.description !== undefined) push('description', body.description)
    if (body.status !== undefined) {
      push('status', body.status)
      if (body.status === 'completed') push('completed_at', new Date())
      else push('completed_at', null)
    }
    if (body.dealId !== undefined) push('deal_id', body.dealId)
    if (body.ownerUserId !== undefined) push('owner_user_id', body.ownerUserId)
    if (body.startedAt !== undefined) push('started_at', body.startedAt)
    if (body.expectedCloseAt !== undefined) push('expected_close_at', body.expectedCloseAt)
    if (!sets.length) return NextResponse.json({ ok: true })
    push('updated_at', new Date())
    bind.push(id, ctx.tenantId, ctx.organizationId)
    const rows = await ctx.em.getConnection().execute(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ? AND organization_id = ? RETURNING *`,
      bind,
    )
    return NextResponse.json(mapRow(rows[0]))
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[project.PUT]', err)
    return NextResponse.json({ error: 'Failed to update project' }, { status: 400 })
  }
}

export async function DELETE(req: Request, params: { params: { id: string } } | { params: Promise<{ id: string }> }) {
  try {
    const { id } = await (params as any).params
    const { ctx } = await loadProject(req, id)
    await ctx.em.getConnection().execute(
      `UPDATE projects SET deleted_at = now(), updated_at = now() WHERE id = ? AND tenant_id = ? AND organization_id = ?`,
      [id, ctx.tenantId, ctx.organizationId],
    )
    // cascade soft-delete tasks
    await ctx.em.getConnection().execute(
      `UPDATE project_tasks SET deleted_at = now(), updated_at = now() WHERE project_id = ? AND deleted_at IS NULL`,
      [id],
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[project.DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
}
