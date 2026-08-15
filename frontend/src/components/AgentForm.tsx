import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { API_URL } from '../lib/api'
import { randomAgentName } from '../lib/agentNames'
import { METRIC_KEY_LABEL } from '../lib/agentStats'
import { Icon } from '../ui'
import type {
  AgentBuiltinTool,
  AgentSummary,
  AgentTool,
  ConversationPersistence,
  GuardrailMode,
  KnowledgeDocumentSummary,
  Language,
  MemoryType,
  MetricKey,
  MetricProfile,
  ProviderInfo,
  ResponseDetail,
  ResponseTone,
} from '../lib/types'
import { AgentAppGrantsEditor } from './AgentAppGrantsEditor'
import { AgentToolsEditor } from './AgentToolsEditor'

interface AgentFormProps {
  // null = creating a new agent; otherwise editing this one.
  agent: AgentSummary | null
  onSaved: (agent: AgentSummary) => void
  // 'wizard' = step-by-step (the create modal); 'flat' = sections on one screen
  // (the agent page).
  layout?: 'wizard' | 'flat'
  // Flat layout only: which agent-page section to render (see SECTION_BLOCKS).
  // The form still holds and saves every field, so unshown fields keep their
  // saved values.
  section?: string
  // Floor the new agent is created on (create only). Omitted → default office.
  floorId?: string
  // KPI keys with a real data source for this agent (from the overview), so the
  // "Métrica do card" picker never offers a metric that would show nothing.
  availableMetrics?: MetricKey[]
}

// The agent page groups fields into blocks; each section shows a set of blocks.
// "Essencial" is the only thing a common user must touch — everything technical
// is grouped under "avancado" so it stays out of the way with sensible defaults.
// Five sections now: Visão geral (identity + objective), Como trabalha (tools and
// knowledge), Fluxos, Atividade and Avançado (everything technical). Legacy keys are
// kept as aliases so an old bookmark still lands somewhere sensible.
const SECTION_BLOCKS: Record<string, string[]> = {
  'visao-geral': ['identidade'],
  'como-trabalha': ['ferramentas', 'conhecimento'],
  avancado: ['metrica', 'modelo', 'estilo', 'memoria', 'guardrails', 'identificacao', 'dados', 'contrato'],
  // legacy aliases
  essencial: ['identidade'],
  ferramentas: ['ferramentas'],
  conhecimento: ['conhecimento'],
}

// A collapsible advanced group: a clickable header that shows/hides its fields.
// When it isn't the header context (a single block shown alone), it just renders
// the children. Children stay mounted (hidden) so their state/focus is kept.
function CollapsibleBlock({
  title,
  showHeader,
  children,
}: {
  title: string
  showHeader: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  if (!showHeader) return <>{children}</>
  return (
    <div className="border-t border-(--border-subtle) first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 py-3 text-left text-(--text-body) transition hover:text-(--text-heading)"
      >
        <span className="text-sm font-semibold">{title}</span>
        <span className={`text-(--text-faint) transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      <div className={open ? 'space-y-3 pb-3' : 'hidden'}>{children}</div>
    </div>
  )
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
    <div className="flex items-start justify-between gap-3 rounded-lg border border-(--border-subtle) p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm text-(--text-muted)">{description}</p>
      </div>
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => onSelect(e.target.checked ? value : offValue)}
          className="peer sr-only"
        />
        <div className="peer h-6 w-11 rounded-full bg-(--paper-3) transition peer-checked:bg-(--intent-success) after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-white" />
      </label>
    </div>
  )
}

export function AgentForm({ agent, onSaved, layout = 'wizard', section, floorId, availableMetrics }: AgentFormProps) {
  const isCreating = agent === null
  const flat = layout === 'flat'

  const [providers, setProviders] = useState<ProviderInfo[]>([])

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
  const [editProactivityEnabled, setEditProactivityEnabled] = useState(false)
  const [editProactivityGuidance, setEditProactivityGuidance] = useState('')
  const [editLanguage, setEditLanguage] = useState<Language>('pt')
  const [editDailyMessageLimit, setEditDailyMessageLimit] = useState(0)
  const [editCheapAuxModel, setEditCheapAuxModel] = useState(true)
  const [editPromptCaching, setEditPromptCaching] = useState(true)
  const [editMetricProfile, setEditMetricProfile] = useState<MetricProfile>('auto')
  const [editTools, setEditTools] = useState<AgentTool[]>([])
  const [editBuiltinTools, setEditBuiltinTools] = useState<AgentBuiltinTool[]>([])
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  // Autosave (agent page only): status shown in place of a save button, plus a
  // baseline of the last-saved payload and a flag that the form has loaded.
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [initialized, setInitialized] = useState(false)
  const savedPayloadRef = useRef<string | null>(null)
  // Create modal: whether the advanced settings are expanded.
  const [advancedOpen, setAdvancedOpen] = useState(false)

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
  // Executable contract (advanced, all optional): the shape a task produces and,
  // for JSON, the schema it must satisfy. Absent = exactly today's behaviour.
  const [editDefaultOutputFormat, setEditDefaultOutputFormat] = useState<'' | 'text' | 'markdown' | 'json'>('')
  const [editOutputJsonSchema, setEditOutputJsonSchema] = useState('')
  const [editRequireGrounding, setEditRequireGrounding] = useState(false)
  const [schemaError, setSchemaError] = useState<string | null>(null)

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
    setEditError(null)
    setSaving(false)
    setAdvancedOpen(false)
    // Reset autosave baseline for the freshly loaded agent.
    savedPayloadRef.current = null
    setInitialized(false)
    setAutoSaveState('idle')
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
      setEditProactivityEnabled(agent.proactivityEnabled ?? false)
      setEditProactivityGuidance(agent.proactivityGuidance ?? '')
      setEditLanguage(agent.language ?? 'pt')
      setEditDailyMessageLimit(agent.dailyMessageLimit ?? 0)
      setEditCheapAuxModel(agent.cheapAuxModel ?? true)
      setEditPromptCaching(agent.promptCaching ?? true)
      setEditMetricProfile(agent.metricProfile ?? 'auto')
      setEditTools(agent.tools ?? [])
    setEditDefaultOutputFormat(agent.defaultOutputFormat ?? '')
    setEditOutputJsonSchema(agent.outputJsonSchema ? JSON.stringify(agent.outputJsonSchema, null, 2) : '')
    setEditRequireGrounding(agent.requireGrounding === true)
      setEditBuiltinTools(agent.builtinTools ?? [])
      setPendingDocs([])
      loadDocuments(agent._id)
    } else {
      // New agents get an auto-generated, gender-coherent name in the default
      // language (pt); it re-rolls if the language changes (no manual field).
      setEditName(randomAgentName('pt').name)
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
      setEditProactivityEnabled(false)
      setEditProactivityGuidance('')
      setEditLanguage('pt')
      setEditDailyMessageLimit(0)
      setEditCheapAuxModel(true)
      setEditPromptCaching(true)
      setEditMetricProfile('auto')
      setEditTools([])
      setEditBuiltinTools([])
      setDocuments([])
      setPendingDocs([])
    }
    // Populated now; the autosave effect can capture its baseline.
    setInitialized(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?._id])

  // Persist edits automatically on the agent page (flat, editing). The
  // `initialized` gate ensures the baseline is the loaded agent's values, so
  // loading never triggers a save; the baseline guard prevents save loops.
  const payloadJson = JSON.stringify(buildPayload())
  useEffect(() => {
    if (!flat || isCreating || !initialized || !agent) return
    if (savedPayloadRef.current === null) {
      savedPayloadRef.current = payloadJson
      return
    }
    if (payloadJson === savedPayloadRef.current) return

    setAutoSaveState('saving')
    const agentId = agent._id
    const captured = payloadJson
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/agents/${agentId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: captured,
        })
        if (!res.ok) {
          setAutoSaveState('error')
          return
        }
        savedPayloadRef.current = captured
        const updated: AgentSummary = await res.json()
        setAutoSaveState('saved')
        onSaved(updated)
      } catch {
        setAutoSaveState('error')
      }
    }, 700)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadJson, flat, isCreating, initialized])

  // If the user leaves (switches section / navigates) before the debounce
  // fires, flush the pending edit so nothing is lost. keepalive lets the
  // request finish after the component unmounts.
  const flushRef = useRef<{ agentId: string; json: string } | null>(null)
  useEffect(() => {
    if (flat && !isCreating && agent) flushRef.current = { agentId: agent._id, json: payloadJson }
  })
  useEffect(() => {
    return () => {
      const pending = flushRef.current
      if (pending && pending.json !== savedPayloadRef.current) {
        fetch(`${API_URL}/api/agents/${pending.agentId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: pending.json,
          keepalive: true,
        }).catch(() => {})
      }
    }
  }, [])

  async function loadDocuments(agentId: string) {
    setDocumentsLoading(true)
    const res = await fetch(`${API_URL}/api/agents/${agentId}/documents`, { credentials: 'include' })
    if (res.ok) setDocuments(await res.json())
    setDocumentsLoading(false)
  }

  function buildPayload() {
    return {
      name: editName,
      objective: editObjective,
      provider: editProvider,
      model: editModel || null,
      memoryType: editMemoryType,
      historyLimit: editHistoryLimit,
      identityEnabled: editIdentityEnabled,
      identityFields: editIdentityFields.map((field) => field.trim()).filter(Boolean),
      conversationPersistence: editConversationPersistence,
      guardrailMode: editGuardrailMode,
      structuredOutputEnabled: editStructuredOutputEnabled,
      structuredOutputFields: editStructuredOutputFields.map((field) => field.trim()).filter(Boolean),
      structuredOutputWebhookUrl: editStructuredOutputWebhookUrl.trim() || null,
      responseTone: editResponseTone,
      responseDetail: editResponseDetail,
      responseEmojis: editResponseEmojis,
      responseFormatting: editResponseFormatting,
      handoffEnabled: editHandoffEnabled,
      proactivityEnabled: editProactivityEnabled,
      proactivityGuidance: editProactivityGuidance.trim(),
      language: editLanguage,
      dailyMessageLimit: editDailyMessageLimit,
      cheapAuxModel: editCheapAuxModel,
      promptCaching: editPromptCaching,
      metricProfile: editMetricProfile,
      tools: editTools,
      builtinTools: editBuiltinTools,
      // Optional and only sent when set, so an agent that never opened this block is
      // saved exactly as it always was.
      defaultOutputFormat: editDefaultOutputFormat || null,
      outputJsonSchema: parseSchemaField(editOutputJsonSchema),
      requireGrounding: editRequireGrounding,
    }
  }

  // The typed schema → what the API receives. Invalid JSON keeps the previous value
  // out of the payload instead of sending something the backend would reject.
  function parseSchemaField(raw: string): Record<string, unknown> | null {
    const text = raw.trim()
    if (!text) return null
    try {
      const parsed = JSON.parse(text)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setEditError(null)
    setSaving(true)
    const payload = buildPayload()

    try {
      if (isCreating) {
        const res = await fetch(`${API_URL}/api/agents`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, floorId }),
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

  // Whether a field block is visible. On the agent page it follows the active
  // section; in the create modal (single screen) the essentials + knowledge are
  // always shown and the rest is revealed under "Configurações avançadas".
  const showBlock = (block: string) => {
    if (flat) return section == null || (SECTION_BLOCKS[section] ?? []).includes(block)
    if (block === 'identidade' || block === 'conhecimento') return true
    return advancedOpen
  }
  const showKb = showBlock('conhecimento')
  // Advanced groups are collapsible when several stack together (the "Avançado"
  // page, or the create modal with advanced expanded); a block shown alone (a
  // single-block section) gets no header.
  const stacked = (flat && section === 'avancado') || (!flat && advancedOpen)

  return (
    <div className="flex flex-col">
      <form id="agent-form" onSubmit={handleSave} className="space-y-3">
        {showBlock('identidade') && (
          <>
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">Nome</label>
              {isCreating ? (
                <>
                  <div className="flex items-center gap-2">
                    <div
                      aria-live="polite"
                      className="flex-1 truncate rounded-lg border border-(--border-strong) bg-(--surface-sunken) px-3 py-2 text-sm"
                      style={{ fontWeight: 600, color: 'var(--text-heading)' }}
                    >
                      {editName}
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditName(randomAgentName(editLanguage, editName).name)}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm"
                      style={{ color: 'var(--text-body)', cursor: 'pointer', fontWeight: 600 }}
                    >
                      <Icon name="refresh-cw" size={14} />
                      Gerar outro
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-(--text-faint)">Nome gerado automaticamente. Toque em “Gerar outro” para trocar.</p>
                </>
              ) : (
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  autoFocus
                  className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                />
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">O que este agente faz?</label>
              <textarea
                value={editObjective}
                onChange={(e) => setEditObjective(e.target.value)}
                rows={4}
                placeholder="Ex: Ajudar clientes do restaurante a tirar dúvidas sobre cardápio, horário e reservas, e anotar pedidos."
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              />
              <p className="mt-1 text-xs text-(--text-faint)">
                Descreva o objetivo e como o agente deve agir — é a instrução principal dele.
              </p>
            </div>
          </>
        )}
      </form>

      {/* Advanced settings live at the end (order-3, after the knowledge base)
          in a panel of their own so expanding them doesn't push everything. */}
      <div className="order-3">
        {!flat && (
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            className="flex w-full items-center gap-1.5 border-t border-(--border-subtle) pt-4 text-sm text-(--text-muted) transition hover:text-(--text-heading)"
          >
            <span className={`transition-transform ${advancedOpen ? 'rotate-90' : ''}`}>▸</span>
            Configurações avançadas
            <span className="text-xs text-(--text-faint)">(opcional)</span>
          </button>
        )}

        <div
          className={
            !flat && advancedOpen ? 'mt-3 rounded-xl border border-(--border-subtle) bg-(--surface-card)/40 px-4 py-1' : ''
          }
        >
          {showBlock('metrica') && (
          <CollapsibleBlock title="Métrica do card" showHeader={stacked}>
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">KPI mostrado no card do agente</label>
              <select
                value={editMetricProfile}
                onChange={(e) => setEditMetricProfile(e.target.value as MetricProfile)}
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              >
                <option value="auto">Automático (pelo perfil)</option>
                {(availableMetrics ?? []).map((k) => (
                  <option key={k} value={k}>
                    {METRIC_KEY_LABEL[k]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-(--text-faint)">
                “Automático” usa o KPI do perfil do agente. Só aparecem métricas com dados reais disponíveis.
              </p>
            </div>
          </CollapsibleBlock>
          )}

          {showBlock('modelo') && (
          <CollapsibleBlock title="Modelo e custo" showHeader={stacked}>
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">Provedor</label>
              <select
                value={editProvider}
                onChange={(e) => {
                  setEditProvider(e.target.value as 'anthropic' | 'openai')
                  setEditModel('')
                }}
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">Modelo</label>
              <select
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              >
                <option value="">Padrão do sistema</option>
                {(providers.find((p) => p.id === editProvider)?.models ?? []).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 rounded-lg border border-(--border-subtle) p-3">
              <p className="text-sm font-medium">Otimização de custo</p>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-(--text-muted)">
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
                  <div className="peer h-6 w-11 rounded-full bg-(--paper-3) transition peer-checked:bg-(--intent-success) after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-white" />
                </label>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-(--border-subtle) pt-2">
                <p className="text-sm text-(--text-muted)">
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
                  <div className="peer h-6 w-11 rounded-full bg-(--paper-3) transition peer-checked:bg-(--intent-success) after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-white" />
                </label>
              </div>
            </div>
          </CollapsibleBlock>
        )}

        {showBlock('estilo') && (
          <CollapsibleBlock title="Estilo das respostas" showHeader={stacked}>
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">Idioma das respostas</label>
              <select
                value={editLanguage}
                onChange={(e) => {
                  const lang = e.target.value as Language
                  setEditLanguage(lang)
                  // Keep the auto-generated name in the chosen language while creating.
                  if (isCreating) setEditName(randomAgentName(lang, editName).name)
                }}
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">Tom</label>
              <select
                value={editResponseTone}
                onChange={(e) => setEditResponseTone(e.target.value as ResponseTone)}
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              >
                {TONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-(--text-muted)">Nível de detalhe</label>
              <select
                value={editResponseDetail}
                onChange={(e) => setEditResponseDetail(e.target.value as ResponseDetail)}
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              >
                {DETAIL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-(--border-subtle) p-3">
              <div>
                <p className="text-sm font-medium">Emojis</p>
                <p className="text-sm text-(--text-muted)">Permite usar emojis com moderação nas respostas.</p>
              </div>
              <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={editResponseEmojis}
                  onChange={(e) => setEditResponseEmojis(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-(--paper-3) transition peer-checked:bg-(--intent-success) after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-white" />
              </label>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-(--border-subtle) p-3">
              <div>
                <p className="text-sm font-medium">Formatação</p>
                <p className="text-sm text-(--text-muted)">
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
                <div className="peer h-6 w-11 rounded-full bg-(--paper-3) transition peer-checked:bg-(--intent-success) after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-white" />
              </label>
            </div>
            <div className="space-y-3 rounded-lg border border-(--border-subtle) p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Proatividade comercial</p>
                  <p className="text-sm text-(--text-muted)">
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
                  <div className="peer h-6 w-11 rounded-full bg-(--paper-3) transition peer-checked:bg-(--intent-success) after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-white" />
                </label>
              </div>
              {editProactivityEnabled && (
                <div>
                  <textarea
                    value={editProactivityGuidance}
                    onChange={(e) => setEditProactivityGuidance(e.target.value)}
                    rows={3}
                    placeholder={'Ex: Quem pede hambúrguer sem bebida, ofereça o combo com refri por +R$ 5.\nSobremesa do dia tem 20% off pra quem pedir prato principal.'}
                    className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                  />
                  <p className="mt-1 text-xs text-(--text-faint)">
                    Diretrizes do que oferecer (opcional). Promoções na base de conhecimento também são
                    usadas automaticamente.
                  </p>
                </div>
              )}
            </div>
          </CollapsibleBlock>
        )}

        {showBlock('memoria') && (
          <CollapsibleBlock title="Memória" showHeader={stacked}>
            <div>
              <p className="mb-2 text-sm text-(--text-muted)">
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
              <label className="mb-1 block text-sm text-(--text-muted)">
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
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              />
              <p className="mt-1 text-xs text-(--text-faint)">
                Quantas das últimas mensagens da conversa são enviadas ao LLM em cada resposta (padrão:{' '}
                {DEFAULT_HISTORY_LIMIT}). Mais mensagens dão mais contexto imediato, mas custam mais por
                chamada.
              </p>
            </div>
          </CollapsibleBlock>
        )}

        {showBlock('guardrails') && (
          <CollapsibleBlock title="Segurança e limites" showHeader={stacked}>
            <p className="mb-2 text-sm text-(--text-muted)">
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
            <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-(--border-subtle) p-3">
              <div>
                <p className="text-sm font-medium">Handoff humano</p>
                <p className="text-sm text-(--text-muted)">
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
                <div className="peer h-6 w-11 rounded-full bg-(--paper-3) transition peer-checked:bg-(--intent-success) after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-white" />
              </label>
            </div>
            <div className="mt-3 rounded-lg border border-(--border-subtle) p-3">
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
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              />
              <p className="mt-1 text-xs text-(--text-faint)">
                Protege sua conta de API contra spam no widget público. Cada visitante pode enviar até esse
                número de mensagens a cada 24h. Use <strong>0</strong> para sem limite.
              </p>
            </div>
          </CollapsibleBlock>
        )}

        {showBlock('identificacao') && (
          <CollapsibleBlock title="Identificação do visitante" showHeader={stacked}>
            <div className="space-y-3 rounded-lg border border-(--border-subtle) p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Identificação do visitante</p>
                <p className="text-sm text-(--text-muted)">
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
                <div className="peer h-6 w-11 rounded-full bg-(--paper-3) transition peer-checked:bg-(--intent-success) after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-white" />
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
                      className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveIdentityField(index)}
                      className="text-xs text-(--coral-600) underline transition hover:text-(--coral-600)"
                    >
                      Remover
                    </button>
                  </div>
                ))}
                {editIdentityFields.length < MAX_IDENTITY_FIELDS && (
                  <button
                    type="button"
                    onClick={handleAddIdentityField}
                    className="text-xs text-(--text-muted) underline transition hover:text-(--text-heading)"
                  >
                    + Adicionar campo
                  </button>
                )}
              </div>
            )}

            <div className="border-t border-(--border-subtle) pt-3">
              <label className="mb-1 block text-sm text-(--text-muted)">Continuidade da conversa</label>
              <select
                value={editConversationPersistence}
                onChange={(e) => setEditConversationPersistence(e.target.value as ConversationPersistence)}
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              >
                <option value="same_browser">Manter a mesma conversa no mesmo navegador</option>
                <option value="always_new">Sempre iniciar uma conversa nova</option>
              </select>
              <p className="mt-1 text-xs text-(--text-faint)">
                Com "mesma conversa", o visitante volta pro histórico de antes ao reabrir o chat no mesmo
                navegador. Com "sempre nova", cada vez que o chat é aberto começa do zero.
              </p>
            </div>
            </div>
          </CollapsibleBlock>
        )}

        {showBlock('contrato') && (
          <CollapsibleBlock title="Contrato de saída" showHeader={stacked}>
            <div className="space-y-3 rounded-lg border border-(--border-subtle) p-3" data-testid="output-contract-block">
              <p className="text-sm text-(--text-muted)">
                Para tarefas automáticas (rotinas, gatilhos e delegações). Deixe em branco para manter o comportamento atual.
              </p>
              <div>
                <label className="mb-1 block text-sm text-(--text-muted)">Formato padrão do resultado</label>
                <select
                  value={editDefaultOutputFormat}
                  onChange={(e) => setEditDefaultOutputFormat(e.target.value as '' | 'text' | 'markdown' | 'json')}
                  className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                  data-testid="default-output-format"
                >
                  <option value="">Quem pedir decide (padrão)</option>
                  <option value="text">Texto</option>
                  <option value="markdown">Markdown</option>
                  <option value="json">JSON</option>
                </select>
              </div>
              {editDefaultOutputFormat === 'json' && (
                <div>
                  <label className="mb-1 block text-sm text-(--text-muted)">Estrutura do JSON (JSON Schema, opcional)</label>
                  <textarea
                    value={editOutputJsonSchema}
                    onChange={(e) => {
                      setEditOutputJsonSchema(e.target.value)
                      setSchemaError(e.target.value.trim() && !parseSchemaField(e.target.value) ? 'Isso não é um objeto JSON válido.' : null)
                    }}
                    rows={5}
                    spellCheck={false}
                    placeholder={'{\n  "type": "object",\n  "properties": { "titulo": { "type": "string" } },\n  "required": ["titulo"]\n}'}
                    className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 font-mono text-xs outline-none focus:border-(--border-focus)"
                    data-testid="output-json-schema"
                  />
                  {schemaError ? (
                    <p className="mt-1 text-xs" style={{ color: 'var(--status-blocked)' }} data-testid="schema-error">
                      {schemaError}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-(--text-faint)">
                      A resposta é validada. Se não bater, o agente tem UMA chance de corrigir; persistindo, a execução falha em vez de entregar algo fora do formato.
                    </p>
                  )}
                </div>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={editRequireGrounding} onChange={(e) => setEditRequireGrounding(e.target.checked)} data-testid="require-grounding" />
                <span>
                  Responder apenas com base no conhecimento
                  <span className="block text-xs text-(--text-faint)">
                    Se a base não puder ser consultada ou nada relevante for encontrado, a execução falha em vez de responder sem fundamento.
                  </span>
                </span>
              </label>
            </div>
          </CollapsibleBlock>
        )}

        {showBlock('dados') && (
          <CollapsibleBlock title="Dados estruturados" showHeader={stacked}>
            <div className="space-y-3 rounded-lg border border-(--border-subtle) p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Dados estruturados personalizados</p>
                <p className="text-sm text-(--text-muted)">
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
                <div className="peer h-6 w-11 rounded-full bg-(--paper-3) transition peer-checked:bg-(--intent-success) after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-5 peer-checked:after:bg-white" />
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
                        className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveStructuredOutputField(index)}
                        className="text-xs text-(--coral-600) underline transition hover:text-(--coral-600)"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                  {editStructuredOutputFields.length < MAX_STRUCTURED_OUTPUT_FIELDS && (
                    <button
                      type="button"
                      onClick={handleAddStructuredOutputField}
                      className="text-xs text-(--text-muted) underline transition hover:text-(--text-heading)"
                    >
                      + Adicionar campo
                    </button>
                  )}
                </div>

                <div className="border-t border-(--border-subtle) pt-3">
                  <label className="mb-1 block text-sm text-(--text-muted)">Webhook (opcional)</label>
                  <input
                    type="url"
                    value={editStructuredOutputWebhookUrl}
                    onChange={(e) => setEditStructuredOutputWebhookUrl(e.target.value)}
                    placeholder="https://sua-api.com/webhook"
                    className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                  />
                  <p className="mt-1 text-xs text-(--text-faint)">
                    Se preenchido, os dados extraídos são enviados por POST (JSON) pra essa URL sempre que
                    houver uma atualização.
                  </p>
                </div>
              </>
            )}
            </div>
          </CollapsibleBlock>
        )}

        {showBlock('ferramentas') && (
          <CollapsibleBlock title="Ferramentas" showHeader={stacked}>
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium">Apps</p>
                <p className="mb-2 text-xs text-(--text-faint)">
                  O que este agente pode fazer com as contas conectadas na conta. A credencial fica na conexão.
                </p>
                <AgentAppGrantsEditor agentId={agent?._id ?? null} />
              </div>
              <div className="border-t border-(--border-subtle) pt-4">
                <p className="mb-2 text-sm font-medium">Ferramentas personalizadas (HTTP)</p>
                <AgentToolsEditor value={editTools} onChange={setEditTools} />
              </div>
            </div>
          </CollapsibleBlock>
        )}
        </div>
      </div>

      {showKb && (
        <div className="order-2">
          {section == null && <div className="my-5 border-t border-(--border-subtle)" />}

          <div className="space-y-3">
            <h4 className="font-medium">Base de conhecimento</h4>
            <p className="text-sm text-(--text-muted)">
              Textos que o agente usa para responder com precisão (cardápio, horários, políticas...).
              {isCreating && ' Eles serão enviados assim que o agente for criado.'}
            </p>

            {isCreating ? (
              pendingDocs.length === 0 ? (
                <p className="text-sm text-(--text-muted)">Nenhum documento adicionado ainda.</p>
              ) : (
                <ul className="space-y-2">
                  {pendingDocs.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-(--border-subtle) p-2 text-sm"
                    >
                      <span>{doc.title}</span>
                      <button
                        type="button"
                        onClick={() => handleRemovePendingDoc(doc.id)}
                        className="text-xs text-(--coral-600) underline transition hover:text-(--coral-600)"
                      >
                        Remover
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : documentsLoading ? (
              <p className="text-sm text-(--text-muted)">Carregando documentos...</p>
            ) : documents.length === 0 ? (
              <p className="text-sm text-(--text-muted)">Nenhum documento adicionado ainda.</p>
            ) : (
              <ul className="space-y-2">
                {documents.map((doc) => (
                  <li key={doc._id} className="rounded-lg border border-(--border-subtle) p-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span>{doc.title}</span>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            viewingDocId === doc._id ? closeDocumentView() : openDocumentView(doc._id)
                          }
                          className="text-xs text-(--text-muted) underline transition hover:text-(--text-heading)"
                        >
                          {viewingDocId === doc._id ? 'Fechar' : 'Ver/Editar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteDocument(doc._id)}
                          disabled={deletingDocId === doc._id}
                          className="text-xs text-(--coral-600) underline transition hover:text-(--coral-600) disabled:opacity-50"
                        >
                          {deletingDocId === doc._id ? 'Excluindo...' : 'Excluir'}
                        </button>
                      </div>
                    </div>

                    {viewingDocId === doc._id && (
                      <div className="mt-2 border-t border-(--border-subtle) pt-2">
                        {viewingDocLoading ? (
                          <p className="text-sm text-(--text-muted)">Carregando...</p>
                        ) : (
                          <form onSubmit={handleSaveDocumentView} className="space-y-2">
                            <input
                              value={viewingDocTitle}
                              onChange={(e) => setViewingDocTitle(e.target.value)}
                              required
                              className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                            />
                            <textarea
                              value={viewingDocContent}
                              onChange={(e) => setViewingDocContent(e.target.value)}
                              rows={6}
                              required
                              className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                            />
                            {docViewError && <p className="text-sm text-(--coral-600)">{docViewError}</p>}
                            <button
                              type="submit"
                              disabled={savingDocView}
                              className="rounded-lg bg-(--intent-brand) px-4 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover) disabled:opacity-50"
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

            <form onSubmit={handleAddDocument} className="space-y-2 rounded-lg border border-(--border-subtle) p-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAddMode('text')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    addMode === 'text' ? 'bg-(--intent-brand) text-white' : 'border border-(--border-strong) text-(--text-muted)'
                  }`}
                >
                  Colar texto
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode('file')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    addMode === 'file' ? 'bg-(--intent-brand) text-white' : 'border border-(--border-strong) text-(--text-muted)'
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
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              />

              {addMode === 'text' ? (
                <textarea
                  value={newDocContent}
                  onChange={(e) => setNewDocContent(e.target.value)}
                  placeholder="Cole aqui o conteúdo (cardápio, horários, políticas...)"
                  rows={4}
                  required
                  className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                />
              ) : (
                <input
                  type="file"
                  accept=".txt,.pdf,image/jpeg,image/png,image/gif,image/webp"
                  onChange={handleFileChange}
                  required
                  className="w-full text-sm text-(--text-muted) file:mr-3 file:rounded-lg file:border-0 file:bg-(--surface-sunken) file:px-3 file:py-1.5 file:text-sm file:text-(--text-heading)"
                />
              )}

              {addMode === 'file' && (
                <p className="text-xs text-(--text-faint)">
                  Aceita .txt, .pdf ou imagens (o texto é extraído automaticamente — em imagens, o
                  provedor de LLM do agente transcreve o conteúdo).
                </p>
              )}

              {docError && <p className="text-sm text-(--coral-600)">{docError}</p>}
              <button
                type="submit"
                disabled={addingDoc}
                className="rounded-lg bg-(--intent-brand) px-4 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover) disabled:opacity-50"
              >
                {addingDoc ? 'Adicionando...' : 'Adicionar documento'}
              </button>
            </form>
          </div>
        </div>
      )}

      {editError && <p className="order-last mt-4 text-sm text-(--coral-600)">{editError}</p>}

      {flat ? (
        // No save button: edits persist automatically. The knowledge-base page
        // manages its docs immediately, so it shows no status line.
        section !== 'conhecimento' && (
          <div className="order-last mt-5 flex justify-end border-t border-(--border-subtle) pt-4 text-sm">
            <span className={autoSaveState === 'error' ? 'text-(--coral-600)' : 'text-(--text-faint)'}>
              {autoSaveState === 'saving'
                ? 'Salvando...'
                : autoSaveState === 'saved'
                  ? 'Salvo ✓'
                  : autoSaveState === 'error'
                    ? 'Erro ao salvar — ajuste algo para tentar de novo'
                    : 'As alterações são salvas automaticamente'}
            </span>
          </div>
        )
      ) : (
        <div className="order-last mt-5 flex justify-end border-t border-(--border-subtle) pt-4">
          <button
            type="submit"
            form="agent-form"
            disabled={saving}
            className="rounded-lg bg-(--intent-brand) px-5 py-2 text-sm font-medium text-white transition hover:bg-(--intent-brand-hover) disabled:opacity-50"
          >
            {saving ? 'Criando...' : 'Criar agente'}
          </button>
        </div>
      )}
    </div>
  )
}
