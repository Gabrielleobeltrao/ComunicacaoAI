import { useState } from 'react'
import type { FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { AgentSummary, WidgetSummary } from '../lib/types'
import { Modal } from './Modal'

interface WidgetManagerProps {
  widgets: WidgetSummary[]
  loading: boolean
  agents: AgentSummary[]
  onChange: () => void | Promise<void>
  onAssignAgent: (widgetId: string, agentId: string) => void | Promise<void>
}

export function WidgetManager({ widgets, loading, agents, onChange, onAssignAgent }: WidgetManagerProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [editingWidget, setEditingWidget] = useState<WidgetSummary | null>(null)
  const [editName, setEditName] = useState('')
  const [editAgentId, setEditAgentId] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  function openCreate() {
    setCreateName('')
    setCreateError(null)
    setCreateOpen(true)
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setCreateError(null)
    setCreating(true)

    try {
      const res = await fetch(`${API_URL}/api/widgets`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: createName }),
      })

      if (!res.ok) {
        setCreateError('Não foi possível criar o widget.')
        return
      }

      setCreateOpen(false)
      await onChange()
    } finally {
      setCreating(false)
    }
  }

  function openEdit(widget: WidgetSummary) {
    setEditingWidget(widget)
    setEditName(widget.name)
    setEditAgentId(agents.find((agent) => agent.widgetId === widget._id)?._id ?? '')
    setEditError(null)
  }

  async function handleSaveEdit(event: FormEvent) {
    event.preventDefault()
    if (!editingWidget) return
    setEditError(null)
    setSaving(true)

    try {
      const res = await fetch(`${API_URL}/api/widgets/${editingWidget._id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName }),
      })

      if (!res.ok) {
        setEditError('Não foi possível salvar.')
        return
      }

      const currentAgentId = agents.find((agent) => agent.widgetId === editingWidget._id)?._id ?? ''
      if (currentAgentId !== editAgentId) {
        await onAssignAgent(editingWidget._id, editAgentId)
      }

      setEditingWidget(null)
      await onChange()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={openCreate}
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
      >
        + Novo widget
      </button>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando widgets...</p>
      ) : widgets.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum widget criado ainda.</p>
      ) : (
        <ul className="space-y-3">
          {widgets.map((widget) => {
            const snippet = `<script src="${window.location.origin}/widget-loader.js" data-widget-key="${widget.publicKey}"></script>`
            const linkedAgent = agents.find((agent) => agent.widgetId === widget._id)

            return (
              <li key={widget._id} className="rounded-lg border border-slate-800 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{widget.name}</p>
                    <p className="text-sm text-slate-400">
                      {linkedAgent ? `Atendido por "${linkedAgent.name}"` : 'Sem agente vinculado'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEdit(widget)}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800"
                  >
                    Editar
                  </button>
                </div>
                <code className="block overflow-x-auto rounded bg-slate-950 p-2 text-xs text-slate-300">
                  {snippet}
                </code>
              </li>
            )
          })}
        </ul>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Novo widget">
        <form onSubmit={handleCreate} className="space-y-3">
          <input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Nome do widget (ex: Suporte)"
            required
            autoFocus
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          {createError && <p className="text-sm text-red-400">{createError}</p>}
          <button
            type="submit"
            disabled={creating}
            className="w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
          >
            {creating ? 'Criando...' : 'Criar widget'}
          </button>
        </form>
      </Modal>

      <Modal open={editingWidget !== null} onClose={() => setEditingWidget(null)} title="Editar widget">
        <form onSubmit={handleSaveEdit} className="space-y-3">
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            required
            autoFocus
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <select
            value={editAgentId}
            onChange={(e) => setEditAgentId(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
          >
            <option value="">Sem agente vinculado</option>
            {agents.map((agent) => (
              <option key={agent._id} value={agent._id}>
                {agent.name}
              </option>
            ))}
          </select>
          {editError && <p className="text-sm text-red-400">{editError}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </form>
      </Modal>
    </div>
  )
}
