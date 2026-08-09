import { useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { AgentSummary, SectorSummary, WidgetPosition, WidgetSummary } from '../lib/types'
import { Modal } from './Modal'

const DEFAULT_COLOR = '#111827'

interface WidgetManagerProps {
  widgets: WidgetSummary[]
  loading: boolean
  agents: AgentSummary[]
  agentsLoading: boolean
  sectors: SectorSummary[]
  onChange: () => void | Promise<void>
}

// The "answered by" selector encodes the choice as agent:<id> or sector:<id>.
function parseTarget(target: string): { agentId: string | null; sectorId: string | null } {
  if (target.startsWith('sector:')) return { agentId: null, sectorId: target.slice(5) }
  if (target.startsWith('agent:')) return { agentId: target.slice(6), sectorId: null }
  return { agentId: null, sectorId: null }
}

export function WidgetManager({ widgets, loading, agents, agentsLoading, sectors, onChange }: WidgetManagerProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [deletingWidgetId, setDeletingWidgetId] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const [editingWidget, setEditingWidget] = useState<WidgetSummary | null>(null)
  const [editName, setEditName] = useState('')
  const [editTarget, setEditTarget] = useState('')
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
    setEditTarget('')
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
    setEditTarget(widget.sectorId ? `sector:${widget.sectorId}` : widget.agentId ? `agent:${widget.agentId}` : '')
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
    const target = parseTarget(editTarget)

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
            agentId: target.agentId,
            sectorId: target.sectorId,
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
          agentId: target.agentId,
          sectorId: target.sectorId,
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

  async function handleDeleteWidget(widget: WidgetSummary) {
    if (deletingWidgetId) return
    if (
      !window.confirm(
        `Excluir o widget "${widget.name}"? Essa ação não pode ser desfeita e apaga também todas as conversas e mensagens desse widget.`,
      )
    ) {
      return
    }
    setListError(null)
    setDeletingWidgetId(widget._id)

    try {
      const res = await fetch(`${API_URL}/api/widgets/${widget._id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null)
        setListError(body?.error ?? 'Não foi possível excluir o widget.')
        return
      }
      await onChange()
    } finally {
      setDeletingWidgetId(null)
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
        className="rounded-lg bg-(--intent-brand) px-4 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover) disabled:opacity-50"
      >
        + Novo widget
      </button>

      {listError && (
        <p className="rounded-lg border border-(--coral-500) bg-(--coral-50) px-3 py-2 text-sm text-(--coral-600)">
          {listError}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-(--text-muted)">Carregando widgets...</p>
      ) : widgets.length === 0 ? (
        <p className="text-sm text-(--text-muted)">Nenhum widget criado ainda.</p>
      ) : (
        <ul className="space-y-3">
          {widgets.map((widget) => {
            const snippet = `<script src="${window.location.origin}/widget-loader.js" data-widget-key="${widget.publicKey}"></script>`
            const linkedTeam = sectors.find((sector) => sector._id === widget.sectorId)
            const linkedAgent = agents.find((agent) => agent._id === widget.agentId)
            const attendedBy = linkedTeam
              ? `Setor "${linkedTeam.name}"`
              : linkedAgent
                ? `Agente "${linkedAgent.name}"`
                : 'Sem atendimento'

            return (
              <li key={widget._id} className="rounded-lg border border-(--border-subtle) p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{widget.name}</p>
                    <p className="text-sm text-(--text-muted)">{attendedBy}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(widget)}
                      disabled={agentsLoading}
                      className="rounded-lg border border-(--border-strong) px-3 py-1.5 text-sm transition hover:bg-(--surface-sunken) disabled:opacity-50"
                    >
                      {agentsLoading ? 'Carregando...' : 'Editar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteWidget(widget)}
                      disabled={deletingWidgetId === widget._id}
                      className="rounded-lg border border-(--coral-500) px-3 py-1.5 text-sm text-(--coral-600) transition hover:bg-(--coral-50) disabled:opacity-50"
                    >
                      {deletingWidgetId === widget._id ? 'Excluindo...' : 'Excluir'}
                    </button>
                  </div>
                </div>
                <code className="block overflow-x-auto rounded bg-(--surface-card) p-2 text-xs text-(--text-body)">
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
            <label className="mb-1 block text-sm text-(--text-muted)">Nome</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Nome do widget (ex: Suporte)"
              required
              autoFocus
              className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-(--text-muted)">Atendido por</label>
            <select
              value={editTarget}
              onChange={(e) => setEditTarget(e.target.value)}
              className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
            >
              <option value="">Sem atendimento</option>
              {sectors.length > 0 && (
                <optgroup label="Setores">
                  {sectors.map((sector) => (
                    <option key={sector._id} value={`sector:${sector._id}`}>
                      {sector.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Agentes">
                {agents.map((agent) => (
                  <option key={agent._id} value={`agent:${agent._id}`}>
                    {agent.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">Cor principal</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={editPrimaryColor ?? DEFAULT_COLOR}
                  onChange={(e) => setEditPrimaryColor(e.target.value)}
                  className="h-9 w-12 rounded border border-(--border-strong) bg-(--surface-card)"
                />
                {editPrimaryColor && (
                  <button
                    type="button"
                    onClick={() => setEditPrimaryColor(null)}
                    className="text-xs text-(--text-muted) underline transition hover:text-(--text-heading)"
                  >
                    Padrão
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">Posição na tela</label>
              <select
                value={editPosition}
                onChange={(e) => setEditPosition(e.target.value as WidgetPosition)}
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              >
                <option value="right">Direita</option>
                <option value="left">Esquerda</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-(--text-muted)">Título de boas-vindas</label>
            <input
              value={editWelcomeTitle}
              onChange={(e) => setEditWelcomeTitle(e.target.value)}
              placeholder="Se vazio, usa o nome do widget"
              className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-(--text-muted)">Mensagem de boas-vindas</label>
            <textarea
              value={editWelcomeMessage}
              onChange={(e) => setEditWelcomeMessage(e.target.value)}
              rows={2}
              placeholder="Primeira mensagem automática exibida ao visitante (opcional)"
              className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-(--text-muted)">Ícone do botão</label>
            <div className="flex items-center gap-3">
              {avatarPreviewUrl && (
                <img
                  src={avatarPreviewUrl}
                  alt="Ícone do widget"
                  className="h-10 w-10 rounded-full border border-(--border-strong) object-cover"
                />
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleAvatarFileChange}
                disabled={uploadingAvatar}
                className="text-sm text-(--text-muted) file:mr-3 file:rounded-lg file:border-0 file:bg-(--surface-sunken) file:px-3 file:py-1.5 file:text-sm file:text-(--text-heading)"
              />
              {avatarPreviewUrl && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  disabled={uploadingAvatar}
                  className="text-xs text-(--coral-600) underline transition hover:text-(--coral-600) disabled:opacity-50"
                >
                  Remover
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-(--text-faint)">
              Se não enviar um ícone, o botão mostra o texto "Chat".
            </p>
          </div>

          {editError && <p className="text-sm text-(--coral-600)">{editError}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-(--intent-brand) px-4 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover) disabled:opacity-50"
          >
            {isCreating ? (saving ? 'Criando...' : 'Criar widget') : saving ? 'Salvando...' : 'Salvar'}
          </button>
        </form>
      </Modal>
    </div>
  )
}
