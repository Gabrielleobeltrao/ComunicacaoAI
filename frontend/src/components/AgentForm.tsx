import { Fragment, useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { API_URL } from '../lib/api'
import type {
  AgentSummary,
  ConversationPersistence,
  GuardrailMode,
  KnowledgeDocumentSummary,
  Language,
  MemoryType,
  ProviderInfo,
  ResponseDetail,
  ResponseTone,
} from '../lib/types'

interface AgentFormProps {
  // null = creating a new agent; otherwise editing this one.
  agent: AgentSummary | null
  onSaved: (agent: AgentSummary) => void
  // 'wizard' = step-by-step (the create modal); 'flat' = sections on one screen
  // (the agent page).
  layout?: 'wizard' | 'flat'
  // Flat layout only: render just this one step's fields (0-6). The form still
  // holds and saves every field, so unshown fields keep their saved values.
  only?: number
}

interface PendingDoc {
  id: string
  title: string
  kind: 'text' | 'file'
  content?: string
  file?: File
}

const DEFAULT_HISTORY_LIMIT = 6
const MAX_HISTORY_LIMIT = 30
const MAX_IDENTITY_FIELDS = 5
const MAX_STRUCTURED_OUTPUT_FIELDS = 10
const MAX_DAILY_MESSAGE_LIMIT = 1000

const STEPS = [
  'Básico',
  'Estilo',
  'Memória',
  'Guardrails',
  'Identificação',
  'Dados estruturados',
  'Base de conhecimento',
]

const TONE_OPTIONS: { value: ResponseTone; label: string }[] = [
  { value: 'neutral', label: 'Neutro (padrão)' },
  { value: 'friendly', label: 'Amigável' },
  { value: 'formal', label: 'Formal' },
  { value: 'enthusiastic', label: 'Entusiasmado' },
]

const DETAIL_OPTIONS: { value: ResponseDetail; label: string }[] = [
  { value: 'balanced', label: 'Equilibrado (padrão)' },
  { value: 'concise', label: 'Direto e conciso' },
  { value: 'detailed', label: 'Explicativo e detalhado' },
]

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'pt', label: 'Português (padrão)' },
  { value: 'en', label: 'Inglês' },
  { value: 'es', label: 'Espanhol' },
  { value: 'auto', label: 'Automático (idioma do visitante)' },
]

function OptionSwitch<T extends string>({
  label,
  description,
  value,
  offValue,
  active,
  onSelect,
}: {
  label: string
  description: string
  value: T
  offValue: T
  active: boolean
  onSelect: (value: T) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm text-slate-400">{description}</p>
      </div>
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => onSelect(e.target.checked ? value : offValue)}
          className="peer sr-only"
        />
        <div className="peer h-6 w-11 rounded-full bg-slate-700 transition peer-checked:bg-white after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-slate-950" />
      </label>
    </div>
  )
}

export function AgentForm({ agent, onSaved, layout = 'wizard', only }: AgentFormProps) {
  const isCreating = agent === null
  const flat = layout === 'flat'
  const lastStep = STEPS.length - 1

  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [step, setStep] = useState(0)

  const [editName, setEditName] = useState('')
  const [editObjective, setEditObjective] = useState('')
  const [editProvider, setEditProvider] = useState<'anthropic' | 'openai'>('anthropic')
  const [editModel, setEditModel] = useState('')
  const [editMemoryType, setEditMemoryType] = useState<MemoryType>('none')
  const [editHistoryLimit, setEditHistoryLimit] = useState(DEFAULT_HISTORY_LIMIT)
  const [editIdentityEnabled, setEditIdentityEnabled] = useState(false)
  const [editIdentityFields, setEditIdentityFields] = useState<string[]>([])
  const [editConversationPersistence, setEditConversationPersistence] =
    useState<ConversationPersistence>('same_browser')
  const [editGuardrailMode, setEditGuardrailMode] = useState<GuardrailMode>('none')
  const [editStructuredOutputEnabled, setEditStructuredOutputEnabled] = useState(false)
  const [editStructuredOutputFields, setEditStructuredOutputFields] = useState<string[]>([])
  const [editStructuredOutputWebhookUrl, setEditStructuredOutputWebhookUrl] = useState('')
  const [editResponseTone, setEditResponseTone] = useState<ResponseTone>('neutral')
  const [editResponseDetail, setEditResponseDetail] = useState<ResponseDetail>('balanced')
  const [editResponseEmojis, setEditResponseEmojis] = useState(false)
  const [editResponseFormatting, setEditResponseFormatting] = useState(false)
  const [editHandoffEnabled, setEditHandoffEnabled] = useState(false)
  const [editFirstMessage, setEditFirstMessage] = useState('')
  const [editProactivityEnabled, setEditProactivityEnabled] = useState(false)
  const [editProactivityGuidance, setEditProactivityGuidance] = useState('')
  const [editLanguage, setEditLanguage] = useState<Language>('pt')
  const [editDailyMessageLimit, setEditDailyMessageLimit] = useState(0)
  const [editCheapAuxModel, setEditCheapAuxModel] = useState(true)
  const [editPromptCaching, setEditPromptCaching] = useState(true)
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

  // (Re)initialize every field whenever the target agent changes (or on mount
  // for create). Keyed on the id so re-renders that pass an equivalent object
  // don't wipe in-progress edits.
  useEffect(() => {
    setStep(0)
    setEditError(null)
    setSaving(false)
    setAddMode('text')
    setNewDocTitle('')
    setNewDocContent('')
    setNewDocFile(null)
    setDocError(null)
    setViewingDocId(null)
    setViewingDocTitle('')
    setViewingDocContent('')
    setDocViewError(null)

    if (agent) {
      setEditName(agent.name)
      setEditObjective(agent.objective)
      setEditProvider(agent.provider ?? 'anthropic')
      setEditModel(agent.model ?? '')
      setEditMemoryType(agent.memoryType ?? 'none')
      setEditHistoryLimit(agent.historyLimit ?? DEFAULT_HISTORY_LIMIT)
      setEditIdentityEnabled(agent.identityEnabled ?? false)
      setEditIdentityFields(agent.identityFields ?? [])
      setEditConversationPersistence(agent.conversationPersistence ?? 'same_browser')
      setEditGuardrailMode(agent.guardrailMode ?? 'none')
      setEditStructuredOutputEnabled(agent.structuredOutputEnabled ?? false)
      setEditStructuredOutputFields(agent.structuredOutputFields ?? [])
      setEditStructuredOutputWebhookUrl(agent.structuredOutputWebhookUrl ?? '')
      setEditResponseTone(agent.responseTone ?? 'neutral')
      setEditResponseDetail(agent.responseDetail ?? 'balanced')
      setEditResponseEmojis(agent.responseEmojis ?? false)
      setEditResponseFormatting(agent.responseFormatting ?? false)
      setEditHandoffEnabled(agent.handoffEnabled ?? false)
      setEditFirstMessage(agent.firstMessage ?? '')
      setEditProactivityEnabled(agent.proactivityEnabled ?? false)
      setEditProactivityGuidance(agent.proactivityGuidance ?? '')
      setEditLanguage(agent.language ?? 'pt')
      setEditDailyMessageLimit(agent.dailyMessageLimit ?? 0)
      setEditCheapAuxModel(agent.cheapAuxModel ?? true)
      setEditPromptCaching(agent.promptCaching ?? true)
      setPendingDocs([])
      loadDocuments(agent._id)
    } else {
      setEditName('')
      setEditObjective('')
      setEditProvider('anthropic')
      setEditModel('')
      setEditMemoryType('none')
      setEditHistoryLimit(DEFAULT_HISTORY_LIMIT)
      setEditIdentityEnabled(false)
      setEditIdentityFields([])
      setEditConversationPersistence('same_browser')
      setEditGuardrailMode('none')
      setEditStructuredOutputEnabled(false)
      setEditStructuredOutputFields([])
      setEditStructuredOutputWebhookUrl('')
      setEditResponseTone('neutral')
      setEditResponseDetail('balanced')
      setEditResponseEmojis(false)
      setEditResponseFormatting(false)
      setEditHandoffEnabled(false)
      setEditFirstMessage('')
      setEditProactivityEnabled(false)
      setEditProactivityGuidance('')
      setEditLanguage('pt')
      setEditDailyMessageLimit(0)
      setEditCheapAuxModel(true)
      setEditPromptCaching(true)
      setDocuments([])
      setPendingDocs([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?._id])

  function goNext() {
    if (step === 0 && !editName.trim()) {
      setEditError('Preencha o nome do agente para continuar.')
      return
    }
    setEditError(null)
    setStep((s) => Math.min(STEPS.length - 1, s + 1))
  }

  function goBack() {
    setEditError(null)
    setStep((s) => Math.max(0, s - 1))
  }

  async function loadDocuments(agentId: string) {
    setDocumentsLoading(true)
    const res = await fetch(`${API_URL}/api/agents/${agentId}/documents`, { credentials: 'include' })
    if (res.ok) setDocuments(await res.json())
    setDocumentsLoading(false)
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    // In the wizard, only the last step submits; flat layout submits from anywhere.
    if (!flat && step !== STEPS.length - 1) return
    setEditError(null)
    setSaving(true)
    const identityFields = editIdentityFields.map((field) => field.trim()).filter(Boolean)
    const structuredOutputFields = editStructuredOutputFields.map((field) => field.trim()).filter(Boolean)
    const structuredOutputWebhookUrl = editStructuredOutputWebhookUrl.trim() || null

    const payload = {
      name: editName,
      objective: editObjective,
      provider: editProvider,
      model: editModel || null,
      memoryType: editMemoryType,
      historyLimit: editHistoryLimit,
      identityEnabled: editIdentityEnabled,
      identityFields,
      conversationPersistence: editConversationPersistence,
      guardrailMode: editGuardrailMode,
      structuredOutputEnabled: editStructuredOutputEnabled,
      structuredOutputFields,
      structuredOutputWebhookUrl,
      responseTone: editResponseTone,
      responseDetail: editResponseDetail,
      responseEmojis: editResponseEmojis,
      responseFormatting: editResponseFormatting,
      handoffEnabled: editHandoffEnabled,
      firstMessage: editFirstMessage.trim() || null,
      proactivityEnabled: editProactivityEnabled,
      proactivityGuidance: editProactivityGuidance.trim(),
      language: editLanguage,
      dailyMessageLimit: editDailyMessageLimit,
      cheapAuxModel: editCheapAuxModel,
      promptCaching: editPromptCaching,
    }

    try {
      if (isCreating) {
        const res = await fetch(`${API_URL}/api/agents`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          setEditError('Não foi possível criar o agente.')
          return
        }

        const created: AgentSummary = await res.json()
        const failures = await uploadPendingDocs(created._id)
        setPendingDocs([])
        if (failures > 0) {
          setDocError(`${failures} documento(s) não puderam ser adicionados — tente de novo pela página do agente.`)
        }
        onSaved(created)
        return
      }

      if (!agent) return

      const res = await fetch(`${API_URL}/api/agents/${agent._id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        setEditError('Não foi possível salvar.')
        return
      }

      const updated: AgentSummary = await res.json()
      onSaved(updated)
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

    if (!agent) return
    setAddingDoc(true)

    try {
      const res =
        addMode === 'text'
          ? await fetch(`${API_URL}/api/agents/${agent._id}/documents`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: newDocTitle, content: newDocContent }),
            })
          : await uploadDocumentFile(agent._id, newDocTitle, newDocFile)

      if (!res.ok) {
        setDocError('Não foi possível adicionar o documento.')
        return
      }

      setNewDocTitle('')
      setNewDocContent('')
      setNewDocFile(null)
      await loadDocuments(agent._id)
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

  function handleAddIdentityField() {
    setEditIdentityFields((prev) => [...prev, ''])
  }

  function handleIdentityFieldChange(index: number, value: string) {
    setEditIdentityFields((prev) => prev.map((field, i) => (i === index ? value : field)))
  }

  function handleRemoveIdentityField(index: number) {
    setEditIdentityFields((prev) => prev.filter((_, i) => i !== index))
  }

  function handleAddStructuredOutputField() {
    setEditStructuredOutputFields((prev) => [...prev, ''])
  }

  function handleStructuredOutputFieldChange(index: number, value: string) {
    setEditStructuredOutputFields((prev) => prev.map((field, i) => (i === index ? value : field)))
  }

  function handleRemoveStructuredOutputField(index: number) {
    setEditStructuredOutputFields((prev) => prev.filter((_, i) => i !== index))
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
    if (!agent) return
    setDeletingDocId(documentId)

    try {
      const res = await fetch(`${API_URL}/api/agents/${agent._id}/documents/${documentId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        await loadDocuments(agent._id)
      }
    } finally {
      setDeletingDocId(null)
    }
  }

  async function openDocumentView(documentId: string) {
    if (!agent) return
    setViewingDocId(documentId)
    setViewingDocLoading(true)
    setDocViewError(null)

    try {
      const res = await fetch(`${API_URL}/api/agents/${agent._id}/documents/${documentId}`, {
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
    if (!agent || !viewingDocId) return
    setSavingDocView(true)
    setDocViewError(null)

    try {
      const res = await fetch(`${API_URL}/api/agents/${agent._id}/documents/${viewingDocId}`, {
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
      await loadDocuments(agent._id)
    } finally {
      setSavingDocView(false)
    }
  }

  // Which config step is visible: the active wizard step, the single `only`
  // section, or all sections when flat without `only`.
  const show = (index: number) => (flat ? only == null || only === index : step === index)
  const showKb = flat ? only == null || only === lastStep : step === lastStep
  // Headings only label sections when several are stacked (flat, no `only`);
  // a single-section page is already labelled by the sidebar/page title.
  const heading = (index: number) =>
    flat && only == null ? (
      <h4
        className={`text-sm font-semibold text-slate-300 ${index > 0 ? 'mt-2 border-t border-slate-800 pt-4' : ''}`}
      >
        {STEPS[index]}
      </h4>
    ) : null

  return (
    <div>
      {!flat && (
        <div className="mb-5 flex items-start">
          {STEPS.map((label, index) => (
            <Fragment key={label}>
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                    index === step
                      ? 'bg-white text-slate-950'
                      : index < step
                        ? 'bg-slate-600 text-white'
                        : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {index + 1}
                </div>
                <span
                  className={`mt-1 w-16 text-center text-[10px] leading-tight ${
                    index === step ? 'text-white' : 'text-slate-500'
                  }`}
                >
                  {label}
                </span>
              </div>
              {index < STEPS.length - 1 && <div className="mt-3 h-px flex-1 bg-slate-800" />}
            </Fragment>
          ))}
        </div>
      )}

      <form id="agent-form" onSubmit={handleSave} className="space-y-3">
        {show(0) && (
          <>
            {heading(0)}
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
                placeholder="Ex: Ajudar clientes do restaurante a tirar dúvidas sobre cardápio, horário e reservas."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Primeira mensagem proativa</label>
              <textarea
                value={editFirstMessage}
                onChange={(e) => setEditFirstMessage(e.target.value)}
                rows={2}
                placeholder="Ex: Oi! 👋 Quer ver o cardápio ou já fazer um pedido?"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                Mensagem que o agente mostra ao visitante assim que o chat abre. Se vazio, vale a
                mensagem de boas-vindas configurada no widget.
              </p>
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
            <div className="space-y-2 rounded-lg border border-slate-800 p-3">
              <p className="text-sm font-medium">Otimização de custo</p>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-400">
                  Modo econômico — tarefas internas (memória, extração, guardrail) rodam num modelo
                  barato, sem afetar a qualidade da resposta ao visitante.
                </p>
                <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={editCheapAuxModel}
                    onChange={(e) => setEditCheapAuxModel(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="peer h-6 w-11 rounded-full bg-slate-700 transition peer-checked:bg-white after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-slate-950" />
                </label>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-2">
                <p className="text-sm text-slate-400">
                  Cache de prompt — reaproveita o contexto fixo (objetivo + instruções) entre as
                  mensagens de uma conversa, reduzindo o custo de entrada.
                </p>
                <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={editPromptCaching}
                    onChange={(e) => setEditPromptCaching(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="peer h-6 w-11 rounded-full bg-slate-700 transition peer-checked:bg-white after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-slate-950" />
                </label>
              </div>
            </div>
          </>
        )}

        {show(1) && (
          <>
            {heading(1)}
            <div>
              <label className="mb-1 block text-sm text-slate-400">Idioma das respostas</label>
              <select
                value={editLanguage}
                onChange={(e) => setEditLanguage(e.target.value as Language)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Tom</label>
              <select
                value={editResponseTone}
                onChange={(e) => setEditResponseTone(e.target.value as ResponseTone)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
              >
                {TONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">Nível de detalhe</label>
              <select
                value={editResponseDetail}
                onChange={(e) => setEditResponseDetail(e.target.value as ResponseDetail)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
              >
                {DETAIL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">Emojis</p>
                <p className="text-sm text-slate-400">Permite usar emojis com moderação nas respostas.</p>
              </div>
              <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={editResponseEmojis}
                  onChange={(e) => setEditResponseEmojis(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-700 transition peer-checked:bg-white after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-slate-950" />
              </label>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">Formatação</p>
                <p className="text-sm text-slate-400">
                  Permite negrito e listas nas respostas — o widget já exibe isso formatado.
                </p>
              </div>
              <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={editResponseFormatting}
                  onChange={(e) => setEditResponseFormatting(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-700 transition peer-checked:bg-white after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-slate-950" />
              </label>
            </div>
            <div className="space-y-3 rounded-lg border border-slate-800 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Proatividade comercial</p>
                  <p className="text-sm text-slate-400">
                    O agente sugere complementos, combos e promoções quando fizer sentido na conversa
                    (ex: oferecer a bebida que completa o combo).
                  </p>
                </div>
                <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={editProactivityEnabled}
                    onChange={(e) => setEditProactivityEnabled(e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="peer h-6 w-11 rounded-full bg-slate-700 transition peer-checked:bg-white after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-slate-950" />
                </label>
              </div>
              {editProactivityEnabled && (
                <div>
                  <textarea
                    value={editProactivityGuidance}
                    onChange={(e) => setEditProactivityGuidance(e.target.value)}
                    rows={3}
                    placeholder={'Ex: Quem pede hambúrguer sem bebida, ofereça o combo com refri por +R$ 5.\nSobremesa do dia tem 20% off pra quem pedir prato principal.'}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Diretrizes do que oferecer (opcional). Promoções na base de conhecimento também são
                    usadas automaticamente.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {show(2) && (
          <>
            {heading(2)}
            <div>
              <p className="mb-2 text-sm text-slate-400">
                Memória da conversa (só um tipo pode ficar ativo por vez)
              </p>
              <div className="space-y-2">
                <OptionSwitch
                  label="Memória de fatos-chave"
                  description="Guarda fatos importantes (nome, preferências, decisões) em texto livre, mesclando fatos novos com os antigos. Gera uma chamada extra ao LLM por mensagem."
                  value="facts"
                  offValue="none"
                  active={editMemoryType === 'facts'}
                  onSelect={setEditMemoryType}
                />
                <OptionSwitch
                  label="Memória estruturada"
                  description="Guarda dados em pares chave:valor (ex: 'Serviço preferido: Corte degradê') — mais organizado que texto livre. Gera uma chamada extra ao LLM por mensagem."
                  value="structured"
                  offValue="none"
                  active={editMemoryType === 'structured'}
                  onSelect={setEditMemoryType}
                />
                <OptionSwitch
                  label="Memória por busca semântica"
                  description="Busca os trechos mais relevantes de qualquer ponto da conversa pra cada pergunta, em vez de manter um resumo. Não gera chamada extra ao LLM, mas usa embeddings."
                  value="semantic"
                  offValue="none"
                  active={editMemoryType === 'semantic'}
                  onSelect={setEditMemoryType}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-400">
                Mensagens recentes enviadas por chamada
              </label>
              <input
                type="number"
                min={1}
                max={MAX_HISTORY_LIMIT}
                value={editHistoryLimit}
                onChange={(e) =>
                  setEditHistoryLimit(
                    Math.min(MAX_HISTORY_LIMIT, Math.max(1, Number(e.target.value) || DEFAULT_HISTORY_LIMIT)),
                  )
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                Quantas das últimas mensagens da conversa são enviadas ao LLM em cada resposta (padrão:{' '}
                {DEFAULT_HISTORY_LIMIT}). Mais mensagens dão mais contexto imediato, mas custam mais por
                chamada.
              </p>
            </div>
          </>
        )}

        {show(3) && (
          <div>
            {heading(3)}
            <p className="mb-2 text-sm text-slate-400">
              Guardrails — restrição de escopo (só uma opção pode ficar ativa por vez)
            </p>
            <div className="space-y-2">
              <OptionSwitch
                label="Reforço no prompt"
                description="Instrução mais forte no system prompt pedindo pro modelo recusar assuntos fora do objetivo do agente. Sem chamada extra ao LLM, mas depende do modelo respeitar — mais fraco contra tentativas de fuga."
                value="prompt"
                offValue="none"
                active={editGuardrailMode === 'prompt'}
                onSelect={setEditGuardrailMode}
              />
              <OptionSwitch
                label="Verificação extra por chamada"
                description="Antes de responder, uma chamada LLM extra classifica se a pergunta está dentro do escopo do agente; se não estiver, devolve uma recusa padrão em vez de gerar a resposta completa. Mais confiável, mas soma uma chamada por mensagem."
                value="verification"
                offValue="none"
                active={editGuardrailMode === 'verification'}
                onSelect={setEditGuardrailMode}
              />
            </div>
            <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">Handoff humano</p>
                <p className="text-sm text-slate-400">
                  Se o visitante pedir pra falar com uma pessoa, estiver insatisfeito ou o caso fugir do
                  escopo, o agente avisa que vai chamar um atendente e para de responder. A conversa fica
                  marcada na página Chats pra você assumir (e devolver ao agente quando quiser).
                </p>
              </div>
              <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={editHandoffEnabled}
                  onChange={(e) => setEditHandoffEnabled(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-700 transition peer-checked:bg-white after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-slate-950" />
              </label>
            </div>
            <div className="mt-3 rounded-lg border border-slate-800 p-3">
              <label className="mb-1 block text-sm font-medium">Limite de mensagens por visitante (24h)</label>
              <input
                type="number"
                min={0}
                max={MAX_DAILY_MESSAGE_LIMIT}
                value={editDailyMessageLimit}
                onChange={(e) =>
                  setEditDailyMessageLimit(
                    Math.min(MAX_DAILY_MESSAGE_LIMIT, Math.max(0, Math.floor(Number(e.target.value) || 0))),
                  )
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                Protege sua conta de API contra spam no widget público. Cada visitante pode enviar até esse
                número de mensagens a cada 24h. Use <strong>0</strong> para sem limite.
              </p>
            </div>
          </div>
        )}

        {show(4) && (
          <>
            {heading(4)}
            <div className="space-y-3 rounded-lg border border-slate-800 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Identificação do visitante</p>
                <p className="text-sm text-slate-400">
                  O agente pergunta naturalmente os campos abaixo (ex: Nome, Email) pra reconhecer esse
                  visitante de novo em conversas futuras, mesmo em outro aparelho.
                </p>
              </div>
              <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={editIdentityEnabled}
                  onChange={(e) => setEditIdentityEnabled(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-700 transition peer-checked:bg-white after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-slate-950" />
              </label>
            </div>

            {editIdentityEnabled && (
              <div className="space-y-2">
                {editIdentityFields.map((field, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      value={field}
                      onChange={(e) => handleIdentityFieldChange(index, e.target.value)}
                      placeholder="Ex: Nome"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveIdentityField(index)}
                      className="text-xs text-red-400 underline transition hover:text-red-300"
                    >
                      Remover
                    </button>
                  </div>
                ))}
                {editIdentityFields.length < MAX_IDENTITY_FIELDS && (
                  <button
                    type="button"
                    onClick={handleAddIdentityField}
                    className="text-xs text-slate-400 underline transition hover:text-white"
                  >
                    + Adicionar campo
                  </button>
                )}
              </div>
            )}

            <div className="border-t border-slate-800 pt-3">
              <label className="mb-1 block text-sm text-slate-400">Continuidade da conversa</label>
              <select
                value={editConversationPersistence}
                onChange={(e) => setEditConversationPersistence(e.target.value as ConversationPersistence)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
              >
                <option value="same_browser">Manter a mesma conversa no mesmo navegador</option>
                <option value="always_new">Sempre iniciar uma conversa nova</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Com "mesma conversa", o visitante volta pro histórico de antes ao reabrir o chat no mesmo
                navegador. Com "sempre nova", cada vez que o chat é aberto começa do zero.
              </p>
            </div>
            </div>
          </>
        )}

        {show(5) && (
          <>
            {heading(5)}
            <div className="space-y-3 rounded-lg border border-slate-800 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Dados estruturados personalizados</p>
                <p className="text-sm text-slate-400">
                  Defina campos de negócio (ex: Orçamento, Urgência) que o agente extrai da conversa. Você
                  escolhe a estrutura — útil pra qualificar leads ou enviar os dados pra um sistema externo.
                </p>
              </div>
              <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={editStructuredOutputEnabled}
                  onChange={(e) => setEditStructuredOutputEnabled(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-slate-700 transition peer-checked:bg-white after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-slate-950" />
              </label>
            </div>

            {editStructuredOutputEnabled && (
              <>
                <div className="space-y-2">
                  {editStructuredOutputFields.map((field, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        value={field}
                        onChange={(e) => handleStructuredOutputFieldChange(index, e.target.value)}
                        placeholder="Ex: Orçamento"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveStructuredOutputField(index)}
                        className="text-xs text-red-400 underline transition hover:text-red-300"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                  {editStructuredOutputFields.length < MAX_STRUCTURED_OUTPUT_FIELDS && (
                    <button
                      type="button"
                      onClick={handleAddStructuredOutputField}
                      className="text-xs text-slate-400 underline transition hover:text-white"
                    >
                      + Adicionar campo
                    </button>
                  )}
                </div>

                <div className="border-t border-slate-800 pt-3">
                  <label className="mb-1 block text-sm text-slate-400">Webhook (opcional)</label>
                  <input
                    type="url"
                    value={editStructuredOutputWebhookUrl}
                    onChange={(e) => setEditStructuredOutputWebhookUrl(e.target.value)}
                    placeholder="https://sua-api.com/webhook"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Se preenchido, os dados extraídos são enviados por POST (JSON) pra essa URL sempre que
                    houver uma atualização.
                  </p>
                </div>
              </>
            )}
            </div>
          </>
        )}
      </form>

      {showKb && (
        <>
          {only == null && <div className="my-5 border-t border-slate-800" />}

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
                          onClick={() =>
                            viewingDocId === doc._id ? closeDocumentView() : openDocumentView(doc._id)
                          }
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
        </>
      )}

      {editError && <p className="mt-4 text-sm text-red-400">{editError}</p>}

      {flat ? (
        // The knowledge-base page manages docs immediately, so it has no config save.
        only !== lastStep && (
          <div className="mt-5 flex justify-end border-t border-slate-800 pt-4">
            <button
              type="submit"
              form="agent-form"
              disabled={saving}
              className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
            >
              {isCreating ? (saving ? 'Criando...' : 'Criar agente') : saving ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        )
      ) : (
        <div className="mt-5 flex items-center justify-between border-t border-slate-800 pt-4">
          {step > 0 ? (
            <button
              type="button"
              onClick={goBack}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm transition hover:bg-slate-800"
            >
              Voltar
            </button>
          ) : (
            <span />
          )}

          {step < STEPS.length - 1 ? (
            <button
              key="next"
              type="button"
              onClick={goNext}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200"
            >
              Avançar
            </button>
          ) : (
            <button
              key="submit"
              type="submit"
              form="agent-form"
              disabled={saving}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
            >
              {isCreating ? (saving ? 'Criando...' : 'Criar agente') : saving ? 'Salvando...' : 'Salvar'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
