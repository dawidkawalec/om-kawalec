'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

const STATUS_OPTIONS = [
  { value: 'active', label: 'Aktywny' },
  { value: 'on_hold', label: 'Wstrzymany' },
  { value: 'completed', label: 'Zakończony' },
  { value: 'cancelled', label: 'Anulowany' },
]

export default function CreateProjectPage() {
  const router = useRouter()
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [status, setStatus] = React.useState('active')
  const [dealId, setDealId] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    try {
      const data = await readApiResultOrThrow<{ id: string }>(
        '/api/projects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim() || undefined,
            status,
            dealId: dealId.trim() || undefined,
          }),
        },
        { errorMessage: 'Nie udało się utworzyć projektu.' },
      )
      flash('Projekt utworzony.', 'success')
      router.push(`/backend/projects/${data.id}`)
    } catch (err) {
      flash((err as Error).message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Page>
      <PageBody>
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Nowy projekt</h1>
        <form onSubmit={onSubmit} className="max-w-2xl space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Tytuł *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
              placeholder="Np. Wdrożenie wewnętrznego dashboardu"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Opis</label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[100px] resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Krótki opis zakresu / kluczowych deliverables"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Status</label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Powiązany deal (UUID, opcjonalnie)</label>
              <Input
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? 'Tworzenie…' : 'Utwórz projekt'}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Anuluj
            </Button>
          </div>
        </form>
      </PageBody>
    </Page>
  )
}
