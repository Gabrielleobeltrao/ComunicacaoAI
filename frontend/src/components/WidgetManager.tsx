import { useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { AgentSummary, WidgetPosition, WidgetSummary } from '../lib/types'
import { Modal } from './Modal'

const DEFAULT_COLOR = '#111827'

interface WidgetManagerProps {
  widgets: WidgetSummary[]
  loading: boolean
  agents: AgentSummary[]
  agentsLoading: boolean
  onChange: () => void | Promise<void>
}

export function WidgetManager({ widgets, loading, agents, agentsLoading, onChange }: WidgetManagerProps) {
  const [isCreating, setIsCreating] = useState(false)

  const [editingWidget, setEditingWidget] = useState<WidgetSummary | null>(null)
  const [editName, setEditName] = useState('')
  const [editAgentId, setEditAgentId] = useState('')
  const [editPrimaryColor, setEditPrimaryColor] = useState<string | null>(null)
  const [editWelcomeTitle, setEditWelcomeTitle] = useState('')
  const [editWelcomeMessage, setEditWelcomeMessage] = useState('')
  const [editPosition, setEditPosition] = useState<WidgetPosition>('right')
  const [editAvatarUrl, setEditAvatarUrl] = useState<string | null>(null)
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  function resetCustomizationFields() {
    setEditName('')
    setEditAgentId('')
    setEditPrimaryColor(null)
    setEditWelcomeTitle('')
    setEditWelcomeMessage('')
    setEditPosition('right')
    setEditAvatarUrl(null)
    setPendingAvatarFile(null)
    setEditError(null)
  }

  function openCreate() {
    setIsCreating(true)
    setEditingWidget(null)
    resetCustomizationFields()
  }

  function openEdit(widget: WidgetSummary) {
    setIsCreating(false)
    setEditingWidget(widget)
    setEditName(widget.name)
    setEditAgentId(widget.agentId ?? '')
    setEditPrimaryColor(widget.primaryColor)
    setEditWelcomeTitle(widget.welcomeTitle ?? '')
    setEditWelcomeMessage(widget.welcomeMessage ?? '')
    setEditPosition(widget.position ?? 'right')
    setEditAvatarUrl(widget.avatarUrl)
    setPendingAvatarFile(null)
    setEditError(null)
  }

  function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    if (!isCreating && editingWidget) {
      uploadAvatarNow(editingWidget._id, file)
      return
    }
    setPendingAvatarFile(file)
  }

  async function uploadAvatarNow(widgetId: string, file: File | null) {
    if (!file) return
    setUploadingAvatar(true)
    setEditError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API_URL}/api/widgets/${widgetId}/avatar`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      if (!res.ok) {
        setEditError('Não foi possível enviar o ícone.')
        return
      }
      const updated: WidgetSummary = await res.json()
      setEditAvatarUrl(updated.avatarUrl)
      await onChange()
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function handleRemoveAvatar() {
    if (isCreating || !editingWidget) {
      setPendingAvatarFile(null)
      setEditAvatarUrl(null)
      return
    }

    setUploadingAvatar(true)
    try {
      const res = await fetch(`${API_URL}/api/widgets/${editingWidget._id}/avatar`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setEditAvatarUrl(null)
        await onChange()
      }
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setEditError(null)
    setSaving(true)

    try {
      if (isCreating) {
        const res = await fetch(`${API_URL}/api/widgets`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editName,
            primaryColor: editPrimaryColor,
            welcomeTitle: editWelcomeTitle || null,
            welcomeMessage: editWelcomeMessage || null,
            position: editPosition,
            agentId: editAgentId || null,
          }),
        })

        if (!res.ok) {
          setEditError('Não foi possível criar o widget.')
          return
        }

        const created: WidgetSummary = await res.json()

        if (pendingAvatarFile) {
          await uploadAvatarNow(created._id, pendingAvatarFile)
          setPendingAvatarFile(null)
        }

        setIsCreating(false)
        setEditingWidget(created)
        await onChange()
        return
      }

      if (!editingWidget) return

      const res = await fetch(`${API_URL}/api/widgets/${editingWidget._id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          primaryColor: editPrimaryColor,
          welcomeTitle: editWelcomeTitle || null,
          welcomeMessage: editWelcomeMessage || null,
          position: editPosition,
          agentId: editAgentId || null,
        }),
      })

      if (!res.ok) {
        setEditError('Não foi possível salvar.')
        return
      }

      setEditingWidget(null)
      await onChange()
    } finally {
      setSaving(false)
    }
  }

  const pendingAvatarPreview = useMemo(
    () => (pendingAvatarFile ? URL.createObjectURL(pendingAvatarFile) : null),
    [pendingAvatarFile],
  )
  const avatarPreviewUrl = pendingAvatarPreview ?? editAvatarUrl

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={openCreate}
        disabled={agentsLoading}
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
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
            const linkedAgent = agents.find((agent) => agent._id === widget.agentId)

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
                    disabled={agentsLoading}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {agentsLoading ? 'Carregando...' : 'Editar'}
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

      <Modal
        open={isCreating || editingWidget !== null}
        onClose={() => {
          setIsCreating(false)
          setEditingWidget(null)
        }}
        title={isCreating ? 'Novo widget' : 'Editar widget'}
        wide
      >
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-slate-400">Nome</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Nome do widget (ex: Suporte)"
              required
              autoFocus
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-400">Agente vinculado</label>
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
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-slate-400">Cor principal</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={editPrimaryColor ?? DEFAULT_COLOR}
                  onChange={(e) => setEditPrimaryColor(e.target.value)}
                  className="h-9 w-12 rounded border border-slate-700 bg-slate-950"
                />
                {editPrimaryColor && (
                  <button
                    type="button"
                    onClick={() => setEditPrimaryColor(null)}
                    className="text-xs text-slate-400 underline transition hover:text-white"
                  >
                    Padrão
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Posição na tela</label>
              <select
                value={editPosition}
                onChange={(e) => setEditPosition(e.target.value as WidgetPosition)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
              >
                <option value="right">Direita</option>
                <option value="left">Esquerda</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-400">Título de boas-vindas</label>
            <input
              value={editWelcomeTitle}
              onChange={(e) => setEditWelcomeTitle(e.target.value)}
              placeholder="Se vazio, usa o nome do widget"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-400">Mensagem de boas-vindas</label>
            <textarea
              value={editWelcomeMessage}
              onChange={(e) => setEditWelcomeMessage(e.target.value)}
              rows={2}
              placeholder="Primeira mensagem automática exibida ao visitante (opcional)"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-400">Ícone do botão</label>
            <div className="flex items-center gap-3">
              {avatarPreviewUrl && (
                <img
                  src={avatarPreviewUrl}
                  alt="Ícone do widget"
                  className="h-10 w-10 rounded-full border border-slate-700 object-cover"
                />
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleAvatarFileChange}
                disabled={uploadingAvatar}
                className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:text-white"
              />
              {avatarPreviewUrl && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  disabled={uploadingAvatar}
                  className="text-xs text-red-400 underline transition hover:text-red-300 disabled:opacity-50"
                >
                  Remover
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Se não enviar um ícone, o botão mostra o texto "Chat".
            </p>
          </div>

          {editError && <p className="text-sm text-red-400">{editError}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
          >
            {isCreating ? (saving ? 'Criando...' : 'Criar widget') : saving ? 'Salvando...' : 'Salvar'}
          </button>
        </form>
      </Modal>
    </div>
  )
}
