'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
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

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    fontSize: 14,
  }
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 6,
    color: '#334155',
  }

  return (
    <Page>
      <PageBody>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 0 }}>Nowy projekt</h1>
        <form onSubmit={onSubmit} style={{ maxWidth: 640 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Tytuł *</label>
            <input
              style={inputStyle}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Opis</label>
            <textarea
              style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>Status</label>
              <select
                style={inputStyle}
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
              <label style={labelStyle}>Powiązany deal (UUID, opcjonalnie)</label>
              <input
                style={inputStyle}
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                backgroundColor: '#0f172a',
                color: '#fff',
                border: 'none',
                fontWeight: 500,
                cursor: submitting ? 'wait' : 'pointer',
              }}
            >
              {submitting ? 'Tworzenie…' : 'Utwórz projekt'}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                backgroundColor: '#fff',
                color: '#0f172a',
                border: '1px solid #cbd5e1',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Anuluj
            </button>
          </div>
        </form>
      </PageBody>
    </Page>
  )
}
