import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveProjectsContext } from '../../context'
import { taskUpdateSchema } from '../../../data/validators'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['projects.tasks.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['projects.tasks.manage'] },
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

async function loadTask(req: Request, id: string) {
  const ctx = await resolveProjectsContext(req)
  const rows = await ctx.em.getConnection().execute(
    `SELECT * FROM project_tasks WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
    [id, ctx.tenantId],
  )
  if (!rows?.length) throw new CrudHttpError(404, { error: 'Task not found' })
  return { ctx, task: rows[0] as any }
}

export async function PUT(req: Request, params: { params: { id: string } } | { params: Promise<{ id: string }> }) {
  try {
    const { id } = await (params as any).params
    const { ctx, task } = await loadTask(req, id)
    const body = taskUpdateSchema.parse(await req.json().catch(() => ({})))
    const sets: string[] = []
    const bind: unknown[] = []
    const push = (col: string, val: unknown) => {
      sets.push(`${col} = ?`)
      bind.push(val)
    }
    let newStatus: string | undefined
    if (body.title !== undefined) push('title', body.title)
    if (body.description !== undefined) push('description', body.description)
    if (body.status !== undefined) {
      newStatus = body.status
      push('status', body.status)
      if (body.status === 'done') push('completed_at', new Date())
      else if (task.status === 'done') push('completed_at', null)
    }
    if (body.assigneeUserId !== undefined) push('assignee_user_id', body.assigneeUserId)
    if (body.dueAt !== undefined) push('due_at', body.dueAt)
    // position handling: if status changed but position not provided, append to bottom
    if (body.position !== undefined) {
      push('position', body.position)
    } else if (newStatus && newStatus !== task.status) {
      const maxRows = await ctx.em.getConnection().execute(
        `SELECT COALESCE(MAX(position), -10)::int AS max_pos FROM project_tasks
          WHERE project_id = ? AND status = ? AND deleted_at IS NULL`,
        [task.project_id, newStatus],
      )
      const pos = Number(maxRows?.[0]?.max_pos ?? -10) + 10
      push('position', pos)
    }
    if (!sets.length) return NextResponse.json(mapTask(task))
    push('updated_at', new Date())
    bind.push(id, ctx.tenantId)
    const rows = await ctx.em.getConnection().execute(
      `UPDATE project_tasks SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ? RETURNING *`,
      bind,
    )
    return NextResponse.json(mapTask(rows[0]))
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[task.PUT]', err)
    return NextResponse.json({ error: 'Failed to update task' }, { status: 400 })
  }
}

export async function DELETE(req: Request, params: { params: { id: string } } | { params: Promise<{ id: string }> }) {
  try {
    const { id } = await (params as any).params
    const { ctx } = await loadTask(req, id)
    await ctx.em.getConnection().execute(
      `UPDATE project_tasks SET deleted_at = now(), updated_at = now() WHERE id = ? AND tenant_id = ?`,
      [id, ctx.tenantId],
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[task.DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })
  }
}
