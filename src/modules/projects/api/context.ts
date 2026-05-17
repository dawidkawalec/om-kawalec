import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'

export type ProjectsRouteContext = {
  container: AwilixContainer
  em: EntityManager
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
  tenantId: string
  organizationId: string
}

export async function resolveProjectsContext(req: Request): Promise<ProjectsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }
  if (!auth.orgId) {
    throw new CrudHttpError(400, { error: 'Organization context is required' })
  }
  const em = container.resolve('em') as EntityManager
  return {
    container,
    em,
    auth,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  }
}
