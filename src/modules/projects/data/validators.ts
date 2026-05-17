import { z } from 'zod'

export const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'cancelled'] as const
export const PROJECT_TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'accept',
  'blocked',
  'done',
] as const

export const projectListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    search: z.string().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    dealId: z.string().uuid().optional(),
    ownerUserId: z.string().uuid().optional(),
    sortField: z.enum(['title', 'status', 'createdAt', 'updatedAt']).default('updatedAt'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  })
  .passthrough()

export const projectCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  dealId: z.string().uuid().nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  startedAt: z.coerce.date().nullable().optional(),
  expectedCloseAt: z.coerce.date().nullable().optional(),
})

export const projectUpdateSchema = projectCreateSchema.partial()

export const taskListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(200),
    status: z.enum(PROJECT_TASK_STATUSES).optional(),
    assigneeUserId: z.string().uuid().optional(),
    search: z.string().optional(),
    groupBy: z.enum(['status']).optional(),
  })
  .passthrough()

export const taskCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(PROJECT_TASK_STATUSES).optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
})

export const taskUpdateSchema = taskCreateSchema.partial().extend({
  position: z.number().int().min(0).optional(),
})

export const taskReorderSchema = z.object({
  projectId: z.string().uuid(),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        status: z.enum(PROJECT_TASK_STATUSES),
        position: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(500),
})

export type ProjectListQuery = z.infer<typeof projectListQuerySchema>
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>
export type TaskListQuery = z.infer<typeof taskListQuerySchema>
export type TaskCreateInput = z.infer<typeof taskCreateSchema>
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>
export type TaskReorderInput = z.infer<typeof taskReorderSchema>
