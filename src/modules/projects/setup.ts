import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

type DictRow = {
  value: string
  label: string
  color: string
  icon: string
}

const PROJECT_STATUS_ROWS: DictRow[] = [
  { value: 'active', label: 'Aktywny', color: '#2563eb', icon: 'lucide:play-circle' },
  { value: 'on_hold', label: 'Wstrzymany', color: '#f59e0b', icon: 'lucide:pause-circle' },
  { value: 'completed', label: 'Zakończony', color: '#16a34a', icon: 'lucide:check-circle-2' },
  { value: 'cancelled', label: 'Anulowany', color: '#6b7280', icon: 'lucide:x-circle' },
]

const PROJECT_TASK_STATUS_ROWS: DictRow[] = [
  { value: 'backlog', label: 'Backlog', color: '#94a3b8', icon: 'lucide:archive' },
  { value: 'todo', label: 'Do zrobienia', color: '#0ea5e9', icon: 'lucide:circle' },
  { value: 'in_progress', label: 'W toku', color: '#2563eb', icon: 'lucide:loader' },
  { value: 'accept', label: 'Do akceptacji', color: '#a855f7', icon: 'lucide:eye' },
  { value: 'blocked', label: 'Zablokowane', color: '#ef4444', icon: 'lucide:ban' },
  { value: 'done', label: 'Gotowe', color: '#16a34a', icon: 'lucide:check-circle-2' },
]

async function upsertDict(
  conn: any,
  scope: { organization_id: string; tenant_id: string },
  kind: string,
  rows: DictRow[],
) {
  for (const row of rows) {
    await conn.execute(
      `INSERT INTO customer_dictionary_entries
         (id, organization_id, tenant_id, kind, value, normalized_value, label, color, icon, created_at, updated_at)
       VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?, ?, ?, now(), now())
       ON CONFLICT (organization_id, tenant_id, kind, normalized_value)
       DO UPDATE SET label = EXCLUDED.label, color = EXCLUDED.color, icon = EXCLUDED.icon, updated_at = now()`,
      [
        scope.organization_id,
        scope.tenant_id,
        kind,
        row.value,
        row.value.toLowerCase(),
        row.label,
        row.color,
        row.icon,
      ],
    )
  }
}

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'projects.view',
      'projects.manage',
      'projects.tasks.view',
      'projects.tasks.manage',
    ],
    employee: ['projects.view', 'projects.tasks.view', 'projects.tasks.manage'],
  },

  async seedDefaults(ctx: any) {
    const em: any = ctx.em ?? ctx.container?.resolve?.('em') ?? ctx.resolve?.('em')
    if (!em) {
      console.warn('[projects.setup] em not available; skipping dictionary seed')
      return
    }
    const conn = em.getConnection()
    const scopes: Array<{ organization_id: string; tenant_id: string }> = await conn.execute(
      `SELECT id AS organization_id, tenant_id FROM organizations WHERE deleted_at IS NULL`,
    )
    for (const s of scopes) {
      await upsertDict(conn, s, 'project_status', PROJECT_STATUS_ROWS)
      await upsertDict(conn, s, 'project_task_status', PROJECT_TASK_STATUS_ROWS)
    }
  },
}

export default setup
