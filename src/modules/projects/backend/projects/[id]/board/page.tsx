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
  { value: 'backlog', label: 'Backlog', color: '#94a3b8' },
  { value: 'todo', label: 'Do zrobienia', color: '#0ea5e9' },
  { value: 'in_progress', label: 'W toku', color: '#2563eb' },
  { value: 'accept', label: 'Do akceptacji', color: '#a855f7' },
  { value: 'blocked', label: 'Zablokowane', color: '#ef4444' },
  { value: 'done', label: 'Gotowe', color: '#16a34a' },
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

  // local optimistic state for drag-drop
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

    // Locate the task across columns
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

    // Optimistic update — move task to bottom of target column
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
          <Spinner />
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
        <div style={{ marginBottom: 16 }}>
          <Link href={`/backend/projects/${projectId}`} style={{ color: '#64748b', fontSize: 13 }}>
            ← {projectQuery.data.title}
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 0' }}>Tablica zadań</h1>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(220px, 1fr))`,
            gap: 12,
            overflowX: 'auto',
          }}
        >
          {COLUMNS.map((col) => {
            const tasks = board[col.value] || []
            return (
              <div
                key={col.value}
                onDragOver={(e) => handleDragOver(e, col.value)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.value)}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  backgroundColor: activeColumn === col.value ? '#f1f5f9' : '#f8fafc',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 400,
                }}
              >
                <div
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        backgroundColor: col.color,
                      }}
                    />
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{col.label}</span>
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>{tasks.length}</span>
                  </div>
                  <button
                    onClick={() => {
                      setNewTaskForColumn(col.value)
                      setNewTaskTitle('')
                    }}
                    title="Dodaj zadanie"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#64748b',
                      cursor: 'pointer',
                      fontSize: 18,
                      lineHeight: 1,
                    }}
                  >
                    +
                  </button>
                </div>

                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                  {newTaskForColumn === col.value && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (newTaskTitle.trim()) {
                          createMutation.mutate({ title: newTaskTitle.trim(), status: col.value })
                        }
                      }}
                      style={{ padding: 8, border: '1px dashed #cbd5e1', borderRadius: 6, backgroundColor: '#fff' }}
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
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          border: '1px solid #cbd5e1',
                          borderRadius: 4,
                          fontSize: 13,
                        }}
                      />
                    </form>
                  )}

                  {tasks.length === 0 && newTaskForColumn !== col.value && (
                    <div style={{ color: '#cbd5e1', fontSize: 12, textAlign: 'center', padding: 20 }}>
                      Brak zadań
                    </div>
                  )}

                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onDragEnd={() => setDraggingId(null)}
                      style={{
                        padding: '10px 12px',
                        backgroundColor: '#fff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 6,
                        boxShadow: draggingId === task.id ? '0 4px 12px rgba(0,0,0,0.08)' : '0 1px 2px rgba(0,0,0,0.04)',
                        cursor: 'grab',
                        opacity: draggingId === task.id ? 0.5 : 1,
                        fontSize: 13,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1 }}>{task.title}</div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm('Usunąć zadanie?')) deleteMutation.mutate(task.id)
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#cbd5e1',
                            cursor: 'pointer',
                            fontSize: 14,
                            lineHeight: 1,
                          }}
                          title="Usuń"
                        >
                          ×
                        </button>
                      </div>
                      {task.dueAt && (
                        <div style={{ marginTop: 4, fontSize: 11, color: '#64748b' }}>
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
