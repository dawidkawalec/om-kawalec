import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveProjectsContext } from '../../context'
import { taskReorderSchema } from '../../../data/validators'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['projects.tasks.manage'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveProjectsContext(req)
    const body = taskReorderSchema.parse(await req.json().catch(() => ({})))

    const projectCheck = await ctx.em.getConnection().execute(
      `SELECT id FROM projects WHERE id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [body.projectId, ctx.tenantId, ctx.organizationId],
    )
    if (!projectCheck?.length) throw new CrudHttpError(404, { error: 'Project not found' })

    await ctx.em.transactional(async (tem: any) => {
      const conn = tem.getConnection()
      for (const item of body.items) {
        await conn.execute(
          `UPDATE project_tasks
             SET status = ?,
                 position = ?,
                 completed_at = CASE WHEN ? = 'done' THEN now() ELSE NULL END,
                 updated_at = now()
           WHERE id = ? AND project_id = ? AND tenant_id = ? AND deleted_at IS NULL`,
          [item.status, item.position, item.status, item.id, body.projectId, ctx.tenantId],
        )
      }
    })
    return NextResponse.json({ ok: true, updated: body.items.length })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[task.reorder]', err)
    return NextResponse.json({ error: 'Failed to reorder' }, { status: 400 })
  }
}
