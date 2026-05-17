'use client'

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
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
const STATUS_COLOR: Record<string, string> = {
  active: '#2563eb',
  on_hold: '#f59e0b',
  completed: '#16a34a',
  cancelled: '#6b7280',
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] || '#94a3b8'
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        color: '#fff',
        backgroundColor: color,
      }}
    >
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Projekty</h1>
            <p style={{ color: '#64748b', marginTop: 4, fontSize: 13 }}>
              Projekty powstają automatycznie z deali w stage'u Potwierdzono+ i mają osobną tablicę zadań.
            </p>
          </div>
          <Link
            href="/backend/projects/create"
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              backgroundColor: '#0f172a',
              color: '#fff',
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            + Nowy projekt
          </Link>
        </div>

        {isLoading && <Spinner />}
        {error && <ErrorNotice message={(error as Error).message} />}

        {data && data.items.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 8, color: '#64748b' }}>
            Brak projektów. Stwórz pierwszy lub przesuń deala do stage'u Potwierdzono.
          </div>
        )}

        {data && data.items.length > 0 && (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead style={{ backgroundColor: '#f8fafc' }}>
                <tr>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Tytuł</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Deal</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Otwarte / Wszystkie zadania</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Utworzono</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <Link href={`/backend/projects/${p.id}`} style={{ color: '#0f172a', fontWeight: 500 }}>
                        {p.title}
                      </Link>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <StatusBadge status={p.status} />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {p.dealId ? (
                        <Link href={`/backend/customers/deals/${p.dealId}`} style={{ color: '#2563eb' }}>
                          {p.dealId.slice(0, 8)}…
                        </Link>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: p.openTasksCount > 0 ? '#0f172a' : '#94a3b8' }}>{p.openTasksCount}</span>
                      <span style={{ color: '#cbd5e1', margin: '0 6px' }}>/</span>
                      <span style={{ color: '#64748b' }}>{p.tasksCount}</span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#64748b' }}>
                      {new Date(p.createdAt).toLocaleDateString('pl-PL')}
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
