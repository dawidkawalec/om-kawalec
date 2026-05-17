'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type Task = {
  id: string
  projectId: string
  title: string
  description: string | null
  status: string
  position: number
  assigneeUserId: string | null
  dueAt: string | null
  createdAt: string
}

type Project = {
  id: string
  title: string
  status: string
}

const COLUMNS = [
  { value: 'backlog', label: 'Backlog', dot: 'bg-slate-400' },
  { value: 'todo', label: 'Do zrobienia', dot: 'bg-sky-500' },
  { value: 'in_progress', label: 'W toku', dot: 'bg-blue-600' },
  { value: 'accept', label: 'Do akceptacji', dot: 'bg-purple-500' },
  { value: 'blocked', label: 'Zablokowane', dot: 'bg-red-500' },
  { value: 'done', label: 'Gotowe', dot: 'bg-emerald-600' },
]

export default function BoardPage() {
  const params = useParams<{ id: string }>()
  const projectId = params.id
  const queryClient = useQueryClient()

  const projectQuery = useQuery<Project>({
    queryKey: ['project', projectId, 'header'],
    queryFn: () => readApiResultOrThrow<Project>(`/api/projects/${projectId}`),
    staleTime: 60_000,
  })

  const tasksQuery = useQuery({
    queryKey: ['project', projectId, 'tasks', 'board'],
    queryFn: () =>
      readApiResultOrThrow<{ groups: Record<string, Task[]> }>(
        `/api/projects/${projectId}/tasks?groupBy=status&pageSize=500`,
      ),
    staleTime: 10_000,
  })

  const [board, setBoard] = React.useState<Record<string, Task[]>>({})
  React.useEffect(() => {
    if (tasksQuery.data?.groups) setBoard(tasksQuery.data.groups)
  }, [tasksQuery.data])

  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [activeColumn, setActiveColumn] = React.useState<string | null>(null)
  const [newTaskForColumn, setNewTaskForColumn] = React.useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = React.useState('')

  const reorderMutation = useMutation({
    mutationFn: async (items: Array<{ id: string; status: string; position: number }>) =>
      apiCallOrThrow('/api/projects/tasks/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, items }),
      }),
    onError: (err: Error) => {
      flash(err.message, 'error')
      tasksQuery.refetch()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'tasks'] })
    },
  })

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; status: string }) =>
      readApiResultOrThrow<Task>(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'tasks'] })
      setNewTaskForColumn(null)
      setNewTaskTitle('')
    },
    onError: (err: Error) => flash(err.message, 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (taskId: string) =>
      apiCallOrThrow(`/api/projects/tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'tasks'] })
    },
  })

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, taskId: string) {
    setDraggingId(taskId)
    e.dataTransfer.setData('text/plain', taskId)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>, column: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (activeColumn !== column) setActiveColumn(column)
  }

  function handleDragLeave() {
    setActiveColumn(null)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>, targetStatus: string) {
    e.preventDefault()
    setActiveColumn(null)
    const taskId = e.dataTransfer.getData('text/plain') || draggingId
    setDraggingId(null)
    if (!taskId) return

    let fromStatus: string | undefined
    let task: Task | undefined
    for (const col of Object.keys(board)) {
      const t = board[col]?.find((x) => x.id === taskId)
      if (t) {
        fromStatus = col
        task = t
        break
      }
    }
    if (!task) return
    if (fromStatus === targetStatus) return

    setBoard((prev) => {
      const next: Record<string, Task[]> = { ...prev }
      next[fromStatus!] = (prev[fromStatus!] || []).filter((t) => t.id !== taskId)
      const targetList = [...(prev[targetStatus] || [])]
      const maxPos = targetList.reduce((m, t) => Math.max(m, t.position), -10)
      targetList.push({ ...task!, status: targetStatus, position: maxPos + 10 })
      next[targetStatus] = targetList
      return next
    })

    reorderMutation.mutate([
      { id: taskId, status: targetStatus, position: (board[targetStatus]?.length ?? 0) * 10 + 10 },
    ])
  }

  if (projectQuery.isLoading || tasksQuery.isLoading) {
    return (
      <Page>
        <PageBody>
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        </PageBody>
      </Page>
    )
  }
  if (projectQuery.error || !projectQuery.data) {
    return (
      <Page>
        <PageBody>
          <ErrorNotice message="Brak danych projektu" />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-4">
          <Link href={`/backend/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground">
            ← {projectQuery.data.title}
          </Link>
          <h1 className="mt-1 text-xl font-bold tracking-tight">Tablica zadań</h1>
        </div>

        <div
          className="grid gap-3 overflow-x-auto pb-4"
          style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(240px, 1fr))` }}
        >
          {COLUMNS.map((col) => {
            const tasks = board[col.value] || []
            const isActive = activeColumn === col.value
            return (
              <div
                key={col.value}
                onDragOver={(e) => handleDragOver(e, col.value)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.value)}
                className={`flex min-h-[400px] flex-col rounded-lg border ${
                  isActive ? 'border-primary bg-primary/5' : 'border-border bg-muted/30'
                } transition-colors`}
              >
                <div className="flex items-center justify-between border-b border-border/70 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                    <span className="text-sm font-semibold">{col.label}</span>
                    <span className="text-xs text-muted-foreground">{tasks.length}</span>
                  </div>
                  <button
                    onClick={() => {
                      setNewTaskForColumn(col.value)
                      setNewTaskTitle('')
                    }}
                    title="Dodaj zadanie"
                    className="rounded text-lg leading-none text-muted-foreground hover:bg-muted hover:text-foreground px-1.5"
                  >
                    +
                  </button>
                </div>

                <div className="flex flex-1 flex-col gap-2 p-2">
                  {newTaskForColumn === col.value && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (newTaskTitle.trim()) {
                          createMutation.mutate({ title: newTaskTitle.trim(), status: col.value })
                        }
                      }}
                      className="rounded-md border border-dashed border-border bg-background p-2"
                    >
                      <input
                        autoFocus
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        onBlur={() => {
                          if (!newTaskTitle.trim()) setNewTaskForColumn(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setNewTaskForColumn(null)
                            setNewTaskTitle('')
                          }
                        }}
                        placeholder="Tytuł zadania, Enter aby zapisać"
                        className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </form>
                  )}

                  {tasks.length === 0 && newTaskForColumn !== col.value && (
                    <div className="py-6 text-center text-xs text-muted-foreground/60">Brak zadań</div>
                  )}

                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onDragEnd={() => setDraggingId(null)}
                      className={`group relative cursor-grab rounded-md border border-border bg-card p-2.5 text-sm shadow-sm transition-all hover:shadow ${
                        draggingId === task.id ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 break-words">{task.title}</div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm('Usunąć zadanie?')) deleteMutation.mutate(task.id)
                          }}
                          className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                          title="Usuń"
                        >
                          ×
                        </button>
                      </div>
                      {task.dueAt && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          do {new Date(task.dueAt).toLocaleDateString('pl-PL')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </PageBody>
    </Page>
  )
}
