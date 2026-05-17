'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
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
const STATUS_TONE: Record<string, string> = {
  active: 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-500/30',
  on_hold: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30',
  cancelled: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border border-slate-500/30',
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
    mutationFn: async () => apiCallOrThrow(`/api/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      flash('Projekt usunięty', 'success')
      router.push('/backend/projects')
    },
  })

  if (projectQuery.isLoading)
    return (
      <Page>
        <PageBody>
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        </PageBody>
      </Page>
    )

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
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex-1 min-w-0">
            {editingTitle ? (
              <Input
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
                className="!h-auto !text-2xl font-bold"
              />
            ) : (
              <h1
                onClick={() => {
                  setTitleDraft(project.title)
                  setEditingTitle(true)
                }}
                title="Klik aby edytować"
                className="cursor-text text-2xl font-bold tracking-tight"
              >
                {project.title}
              </h1>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[project.status] || 'bg-muted text-muted-foreground border border-border'}`}>
                {STATUS_LABEL[project.status] || project.status}
              </span>
              {project.dealId && (
                <Link
                  href={`/backend/customers/deals/${project.dealId}`}
                  className="text-primary hover:underline"
                >
                  Powiązany deal: {project.dealId.slice(0, 8)}…
                </Link>
              )}
              <span className="text-muted-foreground">
                Utworzono {new Date(project.createdAt).toLocaleString('pl-PL')}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/backend/projects/${id}/board`}>Otwórz tablicę</Link>
            </Button>
            <select
              value={project.status}
              onChange={(e) => updateMutation.mutate({ status: e.target.value })}
              className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              onClick={() => {
                if (confirm('Usunąć projekt? Zadania też zostaną usunięte.')) {
                  deleteMutation.mutate()
                }
              }}
              className="text-destructive hover:bg-destructive/10"
            >
              Usuń
            </Button>
          </div>
        </div>

        {project.description && (
          <div className="mb-6 rounded-lg border border-border bg-muted/30 p-4 text-sm">
            {project.description}
          </div>
        )}

        <h2 className="mt-6 text-lg font-semibold">Podsumowanie zadań</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
          {['backlog', 'todo', 'in_progress', 'accept', 'blocked', 'done'].map((s) => (
            <Link
              key={s}
              href={`/backend/projects/${id}/board#${s}`}
              className="rounded-lg border border-border bg-card p-3 text-center transition-colors hover:bg-muted/40"
            >
              <div className="text-xs text-muted-foreground">{TASK_STATUS_LABEL[s]}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{tasksByStatus[s]?.length ?? 0}</div>
            </Link>
          ))}
        </div>
      </PageBody>
    </Page>
  )
}
