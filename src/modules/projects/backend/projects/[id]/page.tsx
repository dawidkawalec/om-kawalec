'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type ProjectDetail = {
  id: string
  title: string
  description: string | null
  status: string
  dealId: string | null
  ownerUserId: string | null
  startedAt: string | null
  expectedCloseAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

type Task = {
  id: string
  projectId: string
  title: string
  status: string
  position: number
  createdAt: string
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Aktywny' },
  { value: 'on_hold', label: 'Wstrzymany' },
  { value: 'completed', label: 'Zakończony' },
  { value: 'cancelled', label: 'Anulowany' },
]
const STATUS_COLOR: Record<string, string> = {
  active: '#2563eb',
  on_hold: '#f59e0b',
  completed: '#16a34a',
  cancelled: '#6b7280',
}
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]))

const TASK_STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Do zrobienia',
  in_progress: 'W toku',
  accept: 'Do akceptacji',
  blocked: 'Zablokowane',
  done: 'Gotowe',
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const id = params.id

  const [editingTitle, setEditingTitle] = React.useState(false)
  const [titleDraft, setTitleDraft] = React.useState('')

  const projectQuery = useQuery({
    queryKey: ['project', id],
    queryFn: async () =>
      readApiResultOrThrow<ProjectDetail>(`/api/projects/${id}`, undefined, {
        errorMessage: 'Nie udało się załadować projektu.',
      }),
    staleTime: 30_000,
  })

  const tasksQuery = useQuery({
    queryKey: ['project', id, 'tasks-summary'],
    enabled: !!projectQuery.data,
    queryFn: async () =>
      readApiResultOrThrow<{ items: Task[]; total: number }>(`/api/projects/${id}/tasks?pageSize=200`),
    staleTime: 30_000,
  })

  const updateMutation = useMutation({
    mutationFn: async (patch: Partial<ProjectDetail>) =>
      readApiResultOrThrow<ProjectDetail>(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', id] })
      queryClient.invalidateQueries({ queryKey: ['projects', 'list'] })
      flash('Zaktualizowano', 'success')
    },
    onError: (err: Error) => flash(err.message, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: async () =>
      apiCallOrThrow(`/api/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      flash('Projekt usunięty', 'success')
      router.push('/backend/projects')
    },
  })

  if (projectQuery.isLoading) return <Page><PageBody><Spinner /></PageBody></Page>
  if (projectQuery.error || !projectQuery.data) {
    return (
      <Page>
        <PageBody>
          <ErrorNotice message={(projectQuery.error as Error)?.message || 'Brak danych'} />
        </PageBody>
      </Page>
    )
  }
  const project = projectQuery.data
  const tasks = tasksQuery.data?.items || []
  const tasksByStatus: Record<string, Task[]> = {}
  for (const t of tasks) (tasksByStatus[t.status] ??= []).push(t)

  return (
    <Page>
      <PageBody>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            {editingTitle ? (
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  if (titleDraft.trim() && titleDraft !== project.title) {
                    updateMutation.mutate({ title: titleDraft.trim() })
                  }
                  setEditingTitle(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
                autoFocus
                style={{ fontSize: 24, fontWeight: 700, padding: 4, border: '1px solid #cbd5e1', borderRadius: 4, width: '100%', maxWidth: 600 }}
              />
            ) : (
              <h1
                onClick={() => {
                  setTitleDraft(project.title)
                  setEditingTitle(true)
                }}
                title="Klik aby edytować"
                style={{ fontSize: 24, fontWeight: 700, margin: 0, cursor: 'text' }}
              >
                {project.title}
              </h1>
            )}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, fontSize: 13 }}>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 999,
                  color: '#fff',
                  backgroundColor: STATUS_COLOR[project.status] || '#94a3b8',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {STATUS_LABEL[project.status] || project.status}
              </span>
              {project.dealId && (
                <Link href={`/backend/customers/deals/${project.dealId}`} style={{ color: '#2563eb' }}>
                  Powiązany deal: {project.dealId.slice(0, 8)}…
                </Link>
              )}
              <span style={{ color: '#94a3b8' }}>
                Utworzono {new Date(project.createdAt).toLocaleString('pl-PL')}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link
              href={`/backend/projects/${id}/board`}
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                backgroundColor: '#0f172a',
                color: '#fff',
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              Otwórz tablicę
            </Link>
            <select
              value={project.status}
              onChange={(e) => updateMutation.mutate({ status: e.target.value })}
              style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6 }}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (confirm('Usunąć projekt? Zadania też zostaną usunięte.')) {
                  deleteMutation.mutate()
                }
              }}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                backgroundColor: '#fff',
                color: '#dc2626',
                border: '1px solid #fecaca',
                cursor: 'pointer',
              }}
            >
              Usuń
            </button>
          </div>
        </div>

        {project.description && (
          <div style={{ padding: 12, backgroundColor: '#f8fafc', borderRadius: 6, marginBottom: 24, fontSize: 14, color: '#334155' }}>
            {project.description}
          </div>
        )}

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 24 }}>Podsumowanie zadań</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginTop: 12 }}>
          {['backlog', 'todo', 'in_progress', 'accept', 'blocked', 'done'].map((s) => (
            <div key={s} style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 6, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#64748b' }}>{TASK_STATUS_LABEL[s]}</div>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{tasksByStatus[s]?.length ?? 0}</div>
            </div>
          ))}
        </div>
      </PageBody>
    </Page>
  )
}
