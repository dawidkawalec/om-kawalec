'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type ProjectRow = {
  id: string
  title: string
  status: string
  dealId: string | null
  ownerUserId: string | null
  openTasksCount: number
  tasksCount: number
  createdAt: string
  updatedAt: string
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Aktywny',
  on_hold: 'Wstrzymany',
  completed: 'Zakończony',
  cancelled: 'Anulowany',
}

const STATUS_TONE: Record<string, string> = {
  active: 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-500/30',
  on_hold: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30',
  cancelled: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border border-slate-500/30',
}

function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] || 'bg-muted text-muted-foreground border border-border'
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

export default function ProjectsListPage() {
  const scopeVersion = useOrganizationScopeVersion()
  const { data, isLoading, error } = useQuery({
    queryKey: ['projects', 'list', `scope:${scopeVersion}`],
    staleTime: 30_000,
    queryFn: async () => {
      const payload = await readApiResultOrThrow<{ items: ProjectRow[]; total: number }>(
        '/api/projects?pageSize=100&sortField=updatedAt&sortDir=desc',
        undefined,
        { errorMessage: 'Nie udało się załadować listy projektów.' },
      )
      return payload
    },
  })

  return (
    <Page>
      <PageBody>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Projekty</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Projekty powstają automatycznie z deali w stage&apos;u <strong>Potwierdzono</strong> i dalszych, oraz mają osobną tablicę zadań.
            </p>
          </div>
          <Button asChild>
            <Link href="/backend/projects/create">+ Nowy projekt</Link>
          </Button>
        </div>

        {isLoading && (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        )}
        {error && <ErrorNotice message={(error as Error).message} />}

        {data && data.items.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            Brak projektów. Stwórz pierwszy lub przesuń deala do stage&apos;u <strong>Potwierdzono</strong>.
          </div>
        )}

        {data && data.items.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Tytuł</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Deal</th>
                  <th className="px-4 py-3 text-right font-semibold">Otwarte / Wszystkie</th>
                  <th className="px-4 py-3 font-semibold">Utworzono</th>
                  <th className="px-4 py-3 font-semibold">Akcje</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/backend/projects/${p.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {p.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3">
                      {p.dealId ? (
                        <Link
                          href={`/backend/customers/deals/${p.dealId}`}
                          className="text-primary hover:underline"
                        >
                          {p.dealId.slice(0, 8)}…
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={p.openTasksCount > 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                        {p.openTasksCount}
                      </span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span className="text-muted-foreground">{p.tasksCount}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString('pl-PL')}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/backend/projects/${p.id}/board`}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Tablica
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
