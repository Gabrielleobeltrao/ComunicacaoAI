import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type { AgentSummary, KnowledgeDocumentSummary, ProviderInfo, WidgetSummary } from '../lib/types'
import { Modal } from './Modal'

interface AgentManagerProps {
  agents: AgentSummary[]
  loading: boolean
  widgets: WidgetSummary[]
  onChange: () => void | Promise<void>
}

interface PendingDoc {
  id: string
  title: string
  kind: 'text' | 'file'
  content?: string
  file?: File
}

export function AgentManager({ agents, loading, widgets, onChange }: AgentManagerProps) {
  const [isCreating, setIsCreating] = useState(false)

  const [providers, setProviders] = useState<ProviderInfo[]>([])

  const [editingAgent, setEditingAgent] = useState<AgentSummary | null>(null)
  const [editName, setEditName] = useState('')
  const [editObjective, setEditObjective] = useState('')
  const [editProvider, setEditProvider] = useState<'anthropic' | 'openai'>('anthropic')
  const [editModel, setEditModel] = useState('')
  const [editMemoryEnabled, setEditMemoryEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [addMode, setAddMode] = useState<'text' | 'file'>('text')
  const [newDocTitle, setNewDocTitle] = useState('')
  const [newDocContent, setNewDocContent] = useState('')
  const [newDocFile, setNewDocFile] = useState<File | null>(null)
  const [addingDoc, setAddingDoc] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null)
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([])

  const [viewingDocId, setViewingDocId] = useState<string | null>(null)
  const [viewingDocTitle, setViewingDocTitle] = useState('')
  const [viewingDocContent, setViewingDocContent] = useState('')
  const [viewingDocLoading, setViewingDocLoading] = useState(false)
  const [savingDocView, setSavingDocView] = useState(false)
  const [docViewError, setDocViewError] = useState<string | null>(null)

  useEffect(() => {
    async function loadProviders() {
      const res = await fetch(`${API_URL}/api/providers`, { credentials: 'include' })
      if (res.ok) setProviders(await res.json())
    }
    loadProviders()
  }, [])

  function openCreate() {
    setIsCreating(true)
    setEditingAgent(null)
    setEditName('')
    setEditObjective('')
    setEditProvider('anthropic')
    setEditModel('')
    setEditMemoryEnabled(false)
    setEditError(null)
    setAddMode('text')
    setNewDocTitle('')
    setNewDocContent('')
    setNewDocFile(null)
    setDocError(null)
    setDocuments([])
    setPendingDocs([])
  }

  async function loadDocuments(agentId: string) {
    setDocumentsLoading(true)
    const res = await fetch(`${API_URL}/api/agents/${agentId}/documents`, { credentials: 'include' })
    if (res.ok) setDocuments(await res.json())
    setDocumentsLoading(false)
  }

  function openEdit(agent: AgentSummary) {
    setIsCreating(false)
    setEditingAgent(agent)
    setEditName(agent.name)
    setEditObjective(agent.objective)
    setEditProvider(agent.provider ?? 'anthropic')
    setEditModel(agent.model ?? '')
    setEditMemoryEnabled(agent.memoryEnabled ?? false)
    setEditError(null)
    setAddMode('text')
    setNewDocTitle('')
    setNewDocContent('')
    setNewDocFile(null)
    setDocError(null)
    closeDocumentView()
    loadDocuments(agent._id)
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setEditError(null)
    setSaving(true)

    try {
      if (isCreating) {
        const res = await fetch(`${API_URL}/api/agents`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editName,
            objective: editObjective,
            provider: editProvider,
            model: editModel || null,
            memoryEnabled: editMemoryEnabled,
          }),
        })

        if (!res.ok) {
          setEditError('Não foi possível criar o agente.')
          return
        }

        const created: AgentSummary = await res.json()
        setIsCreating(false)
        setEditingAgent(created)
        await onChange()

        const failures = await uploadPendingDocs(created._id)
        setPendingDocs([])
        await loadDocuments(created._id)
        if (failures > 0) {
          setDocError(`${failures} documento(s) não puderam ser adicionados — tente de novo abaixo.`)
        }
        return
      }

      if (!editingAgent) return

      const res = await fetch(`${API_URL}/api/agents/${editingAgent._id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          objective: editObjective,
          provider: editProvider,
          model: editModel || null,
          memoryEnabled: editMemoryEnabled,
        }),
      })

      if (!res.ok) {
        setEditError('Não foi possível salvar.')
        return
      }

      setEditingAgent(null)
      await onChange()
    } finally {
      setSaving(false)
    }
  }

  async function handleAddDocument(event: FormEvent) {
    event.preventDefault()
    setDocError(null)

    if (isCreating) {
      if (addMode === 'file' && !newDocFile) return
      setPendingDocs((prev) => [
        ...prev,
        addMode === 'text'
          ? { id: crypto.randomUUID(), title: newDocTitle, kind: 'text', content: newDocContent }
          : { id: crypto.randomUUID(), title: newDocTitle, kind: 'file', file: newDocFile ?? undefined },
      ])
      setNewDocTitle('')
      setNewDocContent('')
      setNewDocFile(null)
      return
    }

    if (!editingAgent) return
    setAddingDoc(true)

    try {
      const res =
        addMode === 'text'
          ? await fetch(`${API_URL}/api/agents/${editingAgent._id}/documents`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: newDocTitle, content: newDocContent }),
            })
          : await uploadDocumentFile(editingAgent._id, newDocTitle, newDocFile)

      if (!res.ok) {
        setDocError('Não foi possível adicionar o documento.')
        return
      }

      setNewDocTitle('')
      setNewDocContent('')
      setNewDocFile(null)
      await loadDocuments(editingAgent._id)
    } finally {
      setAddingDoc(false)
    }
  }

  function uploadDocumentFile(agentId: string, title: string, file: File | null) {
    const formData = new FormData()
    formData.append('title', title)
    if (file) formData.append('file', file)

    return fetch(`${API_URL}/api/agents/${agentId}/documents/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
  }

  function handleRemovePendingDoc(id: string) {
    setPendingDocs((prev) => prev.filter((doc) => doc.id !== id))
  }

  async function uploadPendingDocs(agentId: string): Promise<number> {
    let failures = 0
    for (const doc of pendingDocs) {
      try {
        const res =
          doc.kind === 'text'
            ? await fetch(`${API_URL}/api/agents/${agentId}/documents`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: doc.title, content: doc.content }),
              })
            : await uploadDocumentFile(agentId, doc.title, doc.file ?? null)

        if (!res.ok) failures += 1
      } catch {
        failures += 1
      }
    }
    return failures
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setNewDocFile(event.target.files?.[0] ?? null)
  }

  async function handleDeleteDocument(documentId: string) {
    if (!editingAgent) return
    setDeletingDocId(documentId)

    try {
      const res = await fetch(`${API_URL}/api/agents/${editingAgent._id}/documents/${documentId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        await loadDocuments(editingAgent._id)
      }
    } finally {
      setDeletingDocId(null)
    }
  }

  async function openDocumentView(documentId: string) {
    if (!editingAgent) return
    setViewingDocId(documentId)
    setViewingDocLoading(true)
    setDocViewError(null)

    try {
      const res = await fetch(`${API_URL}/api/agents/${editingAgent._id}/documents/${documentId}`, {
        credentials: 'include',
      })
      if (!res.ok) {
        setDocViewError('Não foi possível carregar o documento.')
        return
      }
      const doc = await res.json()
      setViewingDocTitle(doc.title)
      setViewingDocContent(doc.content)
    } finally {
      setViewingDocLoading(false)
    }
  }

  function closeDocumentView() {
    setViewingDocId(null)
    setViewingDocTitle('')
    setViewingDocContent('')
    setDocViewError(null)
  }

  async function handleSaveDocumentView(event: FormEvent) {
    event.preventDefault()
    if (!editingAgent || !viewingDocId) return
    setSavingDocView(true)
    setDocViewError(null)

    try {
      const res = await fetch(`${API_URL}/api/agents/${editingAgent._id}/documents/${viewingDocId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: viewingDocTitle, content: viewingDocContent }),
      })

      if (!res.ok) {
        setDocViewError('Não foi possível salvar o documento.')
        return
      }

      closeDocumentView()
      await loadDocuments(editingAgent._id)
    } finally {
      setSavingDocView(false)
    }
  }

  const widgetNameById = new Map(widgets.map((w) => [w._id, w.name]))

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={openCreate}
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
      >
        + Novo agente
      </button>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando agentes...</p>
      ) : agents.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum agente criado ainda.</p>
      ) : (
        <ul className="space-y-3">
          {agents.map((agent) => (
            <li
              key={agent._id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 p-3"
            >
              <div>
                <p className="font-medium">{agent.name}</p>
                <p className="text-sm text-slate-400">
                  {agent.widgetId
                    ? `Vinculado a "${widgetNameById.get(agent.widgetId) ?? 'widget removido'}"`
                    : 'Sem widget vinculado'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openEdit(agent)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm transition hover:bg-slate-800"
              >
                Editar
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={isCreating || editingAgent !== null}
        onClose={() => {
          setIsCreating(false)
          setEditingAgent(null)
        }}
        title={isCreating ? 'Novo agente' : 'Editar agente'}
        wide
      >
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-slate-400">Nome</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
              autoFocus
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Objetivo / instruções</label>
            <textarea
              value={editObjective}
              onChange={(e) => setEditObjective(e.target.value)}
              rows={3}
              placeholder='Ex: Ajudar clientes do restaurante a tirar dúvidas sobre cardápio, horário e reservas.'
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Provedor</label>
            <select
              value={editProvider}
              onChange={(e) => {
                setEditProvider(e.target.value as 'anthropic' | 'openai')
                setEditModel('')
              }}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Modelo</label>
            <select
              value={editModel}
              onChange={(e) => setEditModel(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
            >
              <option value="">Padrão do sistema</option>
              {(providers.find((p) => p.id === editProvider)?.models ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 p-3">
            <div>
              <p className="text-sm font-medium">Memória da conversa</p>
              <p className="text-sm text-slate-400">
                O agente guarda fatos importantes (nome, preferências, decisões) e lembra deles mesmo
                depois que saem do histórico recente. Gera uma chamada extra ao LLM por mensagem.
              </p>
            </div>
            <label className="relative inline-flex shrink-0 cursor-pointer items-center">
              <input
                type="checkbox"
                checked={editMemoryEnabled}
                onChange={(e) => setEditMemoryEnabled(e.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-slate-700 transition peer-checked:bg-white after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-slate-950" />
            </label>
          </div>
          {editError && <p className="text-sm text-red-400">{editError}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
          >
            {isCreating ? (saving ? 'Criando...' : 'Criar agente') : saving ? 'Salvando...' : 'Salvar'}
          </button>
        </form>

        <div className="my-5 border-t border-slate-800" />

        <div className="space-y-3">
          <h4 className="font-medium">Base de conhecimento</h4>
          <p className="text-sm text-slate-400">
            Textos que o agente usa para responder com precisão (cardápio, horários, políticas...).
            {isCreating && ' Eles serão enviados assim que o agente for criado.'}
          </p>

          {isCreating ? (
            pendingDocs.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum documento adicionado ainda.</p>
            ) : (
              <ul className="space-y-2">
                {pendingDocs.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 p-2 text-sm"
                  >
                    <span>{doc.title}</span>
                    <button
                      type="button"
                      onClick={() => handleRemovePendingDoc(doc.id)}
                      className="text-xs text-red-400 underline transition hover:text-red-300"
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : documentsLoading ? (
            <p className="text-sm text-slate-400">Carregando documentos...</p>
          ) : documents.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhum documento adicionado ainda.</p>
          ) : (
            <ul className="space-y-2">
              {documents.map((doc) => (
                <li key={doc._id} className="rounded-lg border border-slate-800 p-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span>{doc.title}</span>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => (viewingDocId === doc._id ? closeDocumentView() : openDocumentView(doc._id))}
                        className="text-xs text-slate-400 underline transition hover:text-white"
                      >
                        {viewingDocId === doc._id ? 'Fechar' : 'Ver/Editar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDocument(doc._id)}
                        disabled={deletingDocId === doc._id}
                        className="text-xs text-red-400 underline transition hover:text-red-300 disabled:opacity-50"
                      >
                        {deletingDocId === doc._id ? 'Excluindo...' : 'Excluir'}
                      </button>
                    </div>
                  </div>

                  {viewingDocId === doc._id && (
                    <div className="mt-2 border-t border-slate-800 pt-2">
                      {viewingDocLoading ? (
                        <p className="text-sm text-slate-400">Carregando...</p>
                      ) : (
                        <form onSubmit={handleSaveDocumentView} className="space-y-2">
                          <input
                            value={viewingDocTitle}
                            onChange={(e) => setViewingDocTitle(e.target.value)}
                            required
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
                          />
                          <textarea
                            value={viewingDocContent}
                            onChange={(e) => setViewingDocContent(e.target.value)}
                            rows={6}
                            required
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
                          />
                          {docViewError && <p className="text-sm text-red-400">{docViewError}</p>}
                          <button
                            type="submit"
                            disabled={savingDocView}
                            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
                          >
                            {savingDocView ? 'Salvando...' : 'Salvar alterações'}
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAddDocument} className="space-y-2 rounded-lg border border-slate-800 p-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAddMode('text')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  addMode === 'text' ? 'bg-white text-slate-950' : 'border border-slate-700 text-slate-400'
                }`}
              >
                Colar texto
              </button>
              <button
                type="button"
                onClick={() => setAddMode('file')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  addMode === 'file' ? 'bg-white text-slate-950' : 'border border-slate-700 text-slate-400'
                }`}
              >
                Enviar arquivo/imagem
              </button>
            </div>

            <input
              value={newDocTitle}
              onChange={(e) => setNewDocTitle(e.target.value)}
              placeholder="Título (ex: Cardápio)"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
            />

            {addMode === 'text' ? (
              <textarea
                value={newDocContent}
                onChange={(e) => setNewDocContent(e.target.value)}
                placeholder="Cole aqui o conteúdo (cardápio, horários, políticas...)"
                rows={4}
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
            ) : (
              <input
                type="file"
                accept=".txt,.pdf,image/jpeg,image/png,image/gif,image/webp"
                onChange={handleFileChange}
                required
                className="w-full text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-sm file:text-white"
              />
            )}

            {addMode === 'file' && (
              <p className="text-xs text-slate-500">
                Aceita .txt, .pdf ou imagens (o texto é extraído automaticamente — em imagens, o
                provedor de LLM do agente transcreve o conteúdo).
              </p>
            )}

            {docError && <p className="text-sm text-red-400">{docError}</p>}
            <button
              type="submit"
              disabled={addingDoc}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
            >
              {addingDoc ? 'Adicionando...' : 'Adicionar documento'}
            </button>
          </form>
        </div>
      </Modal>
    </div>
  )
}
