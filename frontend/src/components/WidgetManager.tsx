import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'

interface WidgetSummary {
  _id: string
  name: string
  publicKey: string
}

export function WidgetManager() {
  const [widgets, setWidgets] = useState<WidgetSummary[]>([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadWidgets() {
    const res = await fetch(`${API_URL}/api/widgets`, { credentials: 'include' })
    if (res.ok) {
      setWidgets(await res.json())
    }
    setLoading(false)
  }

  useEffect(() => {
    loadWidgets()
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setCreating(true)

    try {
      const res = await fetch(`${API_URL}/api/widgets`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      if (!res.ok) {
        setError('Não foi possível criar o widget.')
        return
      }

      setName('')
      await loadWidgets()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do widget (ex: Suporte)"
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={creating}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
        >
          {creating ? 'Criando...' : 'Criar widget'}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando widgets...</p>
      ) : widgets.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum widget criado ainda.</p>
      ) : (
        <ul className="space-y-3">
          {widgets.map((widget) => {
            const snippet = `<script src="${window.location.origin}/widget-loader.js" data-widget-key="${widget.publicKey}"></script>`
            return (
              <li key={widget._id} className="rounded-lg border border-slate-800 p-3">
                <p className="mb-2 font-medium">{widget.name}</p>
                <code className="block overflow-x-auto rounded bg-slate-950 p-2 text-xs text-slate-300">
                  {snippet}
                </code>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
