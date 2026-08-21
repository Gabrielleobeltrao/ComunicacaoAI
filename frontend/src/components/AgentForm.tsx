import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { API_URL } from '../lib/api'
import { randomAgentName } from '../lib/agentNames'
import { METRIC_KEY_LABEL } from '../lib/agentStats'
import { Icon } from '../ui'
import { AgentDefinitionFields, AgentRunConfigFields, type AgentDefinitionValue } from './AgentDefinitionFields'
import { CollapsibleBlock } from './CollapsibleBlock'
import { cleanRunConfig, type RunConfig } from '../lib/runConfig'
import type {
  AgentBuiltinTool,
  AgentSummary,
  AgentTool,
  ConversationPersistence,
  GuardrailMode,
  KnowledgeDocumentSummary,
  KnowledgePage,
  Language,
  MemoryType,
  MetricKey,
  MetricProfile,
  ProviderInfo,
  ResponseDetail,
  ResponseTone,
} from '../lib/types'
import { AgentCapabilities } from './AgentCapabilities'
import { AgentToolsPicker } from './AgentToolsPicker'
import { WebSearchStatusLine } from './WebSearchStatusLine'
import { AgentSources } from './AgentSources'
import { AgentAppGrantsEditor } from './AgentAppGrantsEditor'
import { AgentToolsEditor } from './AgentToolsEditor'
import { roleConfigOf } from '../lib/agentCapabilities'
import type { AgentRole } from '../lib/agentCapabilities'

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
  // "como-trabalha" não está aqui: os blocos dela vêm do PAPEL do agente (ver
  // `blocosDoPapel`). Uma lista fixa era o que fazia um coordenador e um pesquisador
  // abrirem exatamente o mesmo formulário.
  // "Definição" abre a lista de propósito: é o bloco que o dono revisa, e o que mais
  // muda o comportamento do agente. "Modelo e execução" vem logo depois, e quase ninguém
  // precisa tocar — todo campo dele começa em "Padrão do sistema".
  avancado: ['capacidades', 'execucao', 'metrica', 'modelo', 'estilo', 'memoria', 'guardrails', 'identificacao', 'dados', 'contrato'],
  // legacy aliases
  essencial: ['identidade'],
  ferramentas: ['ferramentas'],
  conhecimento: ['conhecimento'],
}

/**
 * O mesmo campo, o nome que o papel usa.
 *
 * "O que espera receber" quer dizer coisas diferentes para quem analisa e para quem
 * executa; "formato" quer dizer evidência para um e relatório para outro. O campo
 * gravado é o mesmo — o que muda é a pergunta feita a quem configura, e é a pergunta que
 * decide se a resposta vai ser útil.
 */
const ROTULOS: Record<AgentRole, { definicao: string; entrada: [string, string]; entrega: [string, string]; roteamento: [string, string] }> = {
  researcher: {
    definicao: 'Estratégia de pesquisa',
    entrada: ['O que ele precisa receber', 'Ex.: o período e a empresa a pesquisar.'],
    entrega: ['Formato das evidências', 'Como cada achado deve vir: com a fonte, a data e o trecho? Em lista? Com número e unidade?'],
    roteamento: ['Quando chamar este pesquisador', 'Ex.: "quando a pergunta for sobre preços da concorrência ou notícias do setor".'],
  },
  analyst: {
    definicao: 'Objetivo e critérios da análise',
    entrada: ['O que ele espera receber', 'Ele analisa o que RECEBE das tarefas anteriores. Diga que evidências precisa ter em mãos para concluir.'],
    entrega: ['Formato da análise', 'Ex.: comparação lado a lado, recomendação com o porquê, riscos separados das certezas.'],
    roteamento: ['Quando chamar este analista', 'Ex.: "depois que os dados forem coletados, para comparar e concluir".'],
  },
  coordinator: {
    definicao: 'Como conduzir a equipe',
    entrada: ['O que o pedido precisa trazer', 'Ex.: o prazo e o resultado esperado.'],
    entrega: ['Formato da consolidação', 'Como juntar o que os membros produzirem.'],
    roteamento: ['Quando este coordenador deve conduzir', 'Ex.: "quando o pedido envolver mais de uma área e precisar de resposta única".'],
  },
  executor: {
    definicao: 'Como executar',
    entrada: ['O que ele precisa receber para agir', 'Ex.: o destinatário, o valor e a data — sem isso ele não deve executar.'],
    entrega: ['O que ele deve devolver', 'Ex.: a confirmação com o identificador da operação.'],
    roteamento: ['Quando chamar este executor', 'Ex.: "quando for para enviar o e-mail de cobrança".'],
  },
}

/**
 * O nome do GRUPO — o que os blocos abaixo têm em comum.
 *
 * A aba tinha dez blocos soltos, todos no mesmo nível, todos com a mesma cara. Nenhum
 * deles era difícil sozinho; juntos viravam uma lista em que não dá para saber onde
 * procurar. Nada foi removido: os blocos agora respondem a três perguntas, e é a
 * pergunta que orienta quem chegou.
 */
function GrupoDeBlocos({ titulo, resumo, ativo, children }: { titulo: string; resumo: string; ativo: boolean; children: ReactNode }) {
  // Fora da aba "Como trabalha" não há grupo nenhum: no assistente de contratação os
  // mesmos campos aparecem em sequência, e um cabeçalho ali seria enfeite.
  if (!ativo) return <>{children}</>
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="text-sm font-semibold text-(--text-heading)">{titulo}</h3>
      <p className="mt-0.5 mb-1 text-xs text-(--text-faint)">{resumo}</p>
      <div className="rounded-xl border border-(--border-subtle) px-3">{children}</div>
    </section>
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
  // A definição em blocos e a configuração de execução. Começam vazias: é o vazio que
  // reproduz o comportamento de um agente criado antes desta tela.
  const [editDefinicao, setEditDefinicao] = useState<AgentDefinitionValue>({
    role: agent?.role ?? '',
    instructions: agent?.instructions ?? '',
    constraints: agent?.constraints ?? '',
  })
  const [editRunConfig, setEditRunConfig] = useState<RunConfig>(agent?.runConfig ?? {})
  /**
   * O tipo do agente, como está gravado. Só leitura.
   *
   * Era estado editável porque havia um seletor para trocá-lo. Trocar o tipo mudava o
   * que o agente PODE fazer — base, sites, ferramentas — sem tocar em nada do que estava
   * escrito nele: sobrava um agente com a definição de pesquisador e o comportamento de
   * coordenador, e nada na tela ligava uma coisa à outra. O tipo é escolhido uma vez, na
   * contratação.
   */
  const presetSalvo = agent?.preset ?? 'custom'
  // `undefined` = o tipo decide; `true`/`false` = escolha explícita do dono.
  const [knowledgeEnabled, setKnowledgeEnabled] = useState<boolean | undefined>(agent?.knowledgeEnabled)
  // Campos que já existiam no servidor e não tinham onde ser escritos. O rótulo de cada
  // um muda com o papel — "o que espera receber" quer dizer uma coisa para quem analisa e
  // outra para quem executa —, mas o campo gravado é o mesmo.
  const [editRouting, setEditRouting] = useState(agent?.routingDescription ?? '')
  const [editInputContract, setEditInputContract] = useState(agent?.inputContract ?? '')
  const [editOutputContract, setEditOutputContract] = useState(agent?.outputContract ?? '')
  const [editOrchestration, setEditOrchestration] = useState<NonNullable<AgentSummary['orchestration']>>(agent?.orchestration ?? {})
  const [editWebSearch, setEditWebSearch] = useState<NonNullable<AgentSummary['webSearch']>>(agent?.webSearch ?? {})
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
  /**
   * O valor legado de cache, mantido apenas para não ser APAGADO ao salvar.
   *
   * O controle saiu da tela: agora existe um só, tri-estado, em "Modelo e execução"
   * (`runConfig.cache`). Este campo continua sendo lido do documento e devolvido intacto,
   * porque ele é o fallback de quem nunca abriu a tela nova — zerá-lo aqui religaria o
   * cache de quem desligou antes.
   */
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
  // O que a base tem, em números — e o recorte que está sendo olhado. O conteúdo de cada
  // documento NÃO vem aqui: uma base alimentada por site tem centenas de artigos.
  const [resumo, setResumo] = useState<KnowledgePage['summary'] | null>(null)
  const [filtroDoc, setFiltroDoc] = useState<'all' | 'manual' | 'web'>('all')
  const [buscaDoc, setBuscaDoc] = useState('')
  const [fonteDoc, setFonteDoc] = useState<string | null>(null)
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
  const [reindexando, setReindexando] = useState<string | null>(null)
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
      setEditDefinicao({
        role: agent.role ?? '',
        instructions: agent.instructions ?? '',
        constraints: agent.constraints ?? '',
      })
      setEditRunConfig(agent.runConfig ?? {})
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
      setEditRouting(agent.routingDescription ?? '')
      setEditInputContract(agent.inputContract ?? '')
      setEditOutputContract(agent.outputContract ?? '')
      setEditOrchestration(agent.orchestration ?? {})
      setEditWebSearch(agent.webSearch ?? {})
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
      setEditRouting('')
      setEditInputContract('')
      setEditOutputContract('')
      setEditOrchestration({})
      setEditWebSearch({})
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

  // "Ver conhecimento gerado" mora na configuração da fonte; a lista mora aqui. O evento
  // liga os dois sem que um precise conhecer o estado do outro.
  useEffect(() => {
    const aoFiltrar = (evento: Event) => {
      const sourceId = (evento as CustomEvent<{ sourceId?: string }>).detail?.sourceId
      if (!sourceId || !agent?._id) return
      setFiltroDoc('web')
      setFonteDoc(sourceId)
      void loadDocuments(agent._id, { kind: 'web', sourceId })
    }
    window.addEventListener('conhecimento:filtrar-fonte', aoFiltrar)
    return () => window.removeEventListener('conhecimento:filtrar-fonte', aoFiltrar)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?._id])

  async function loadDocuments(agentId: string, over: { kind?: 'all' | 'manual' | 'web'; q?: string; sourceId?: string | null } = {}) {
    setDocumentsLoading(true)
    const params = new URLSearchParams()
    const kind = over.kind ?? filtroDoc
    if (kind !== 'all') params.set('kind', kind)
    const q = over.q ?? buscaDoc
    if (q.trim()) params.set('q', q.trim())
    const fonte = over.sourceId === undefined ? fonteDoc : over.sourceId
    if (fonte) params.set('sourceId', fonte)
    const busca = params.toString()
    const res = await fetch(`${API_URL}/api/agents/${agentId}/documents${busca ? `?${busca}` : ''}`, { credentials: 'include' })
    if (res.ok) {
      const corpo = await res.json()
      // Compatibilidade: uma resposta antiga em forma de lista continua funcionando.
      const pagina: KnowledgePage = Array.isArray(corpo)
        ? { items: corpo, total: corpo.length, summary: { manual: corpo.length, web: 0, total: corpo.length, lastWebFetchAt: null } }
        : corpo
      setDocuments(pagina.items ?? [])
      setResumo(pagina.summary ?? null)
    }
    setDocumentsLoading(false)
  }


  /**
   * Salvar agora, em vez de esperar.
   *
   * A gravação automática continua existindo — ela é a rede que evita perder edição ao
   * trocar de aba. O botão é para quem quer o recibo na hora: mexeu na ferramenta, clicou,
   * viu "Salvo". Sem ele, a única confirmação era uma frase dizendo que confiasse.
   */
  async function salvarAgora() {
    if (!agent) return
    const corpo = JSON.stringify(buildPayload())
    setAutoSaveState('saving')
    try {
      const res = await fetch(`${API_URL}/api/agents/${agent._id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: corpo,
      })
      if (!res.ok) {
        setAutoSaveState('error')
        return
      }
      // O que acabou de ir é a nova linha de base: sem isto, o efeito de gravação
      // automática dispararia de novo logo em seguida, com o mesmo conteúdo.
      savedPayloadRef.current = corpo
      setAutoSaveState('saved')
      onSaved(await res.json())
    } catch {
      setAutoSaveState('error')
    }
  }

  function buildPayload() {
    return {
      name: editName,
      objective: editObjective,
      // Blocos da definição. Enviados sempre que o formulário está aberto; o servidor
      // só grava o que vem, e marca a edição para o preset não sobrescrever depois.
      role: editDefinicao.role,
      instructions: editDefinicao.instructions,
      constraints: editDefinicao.constraints,
      // Vazio = padrão do sistema. Limpar o campo é uma escolha, e ela chega como
      // ausência.
      runConfig: cleanRunConfig(editRunConfig),
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
      routingDescription: editRouting.trim(),
      inputContract: editInputContract.trim(),
      outputContract: editOutputContract.trim(),
      orchestration: editOrchestration,
      webSearch: editWebSearch,
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

  async function handleDeleteDocument(documentId: string, ignorarUrl = false) {
    if (!agent) return
    setDeletingDocId(documentId)

    try {
      const res = await fetch(`${API_URL}/api/agents/${agent._id}/documents/${documentId}${ignorarUrl ? '?ignore=1' : ''}`, {
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
  /**
   * Tentar indexar de novo, e ver o motivo se falhar outra vez.
   *
   * A indexação só acontece na ESCRITA, e o texto de uma página relida não muda — então,
   * sem isto, um documento que falhou uma vez ficava com zero trechos para sempre: na
   * tela com o conteúdo certo, e fora da busca.
   */
  async function reindexar(documentId: string) {
    if (!agent?._id) return
    setReindexando(documentId)
    try {
      const res = await fetch(`${API_URL}/api/agents/${agent._id}/documents/${documentId}/reindex`, { method: 'POST', credentials: 'include' })
      if (res.ok) await loadDocuments(agent._id)
    } finally {
      setReindexando(null)
    }
  }

  const showBlock = (block: string) => {
    if (flat && section === 'como-trabalha') return blocosDoPapel.includes(block)
    if (flat) return section == null || (SECTION_BLOCKS[section] ?? []).includes(block)
    if (block === 'identidade' || block === 'conhecimento') return true
    return advancedOpen
  }
  /**
   * Base e sites só aparecem para quem os USA.
   *
   * Um analista com um bloco de conhecimento em branco é uma promessa que o runtime não
   * cumpre: ele analisa o que recebe. Nada é apagado — o que já estava gravado continua
   * lá —, e quem sabe o que quer religa no próprio bloco.
   */
  /**
   * O que ESTE agente pode fazer — a resposta do servidor, quando ela vale.
   *
   * Vale enquanto o tipo na tela é o mesmo que está gravado. Assim que o dono troca o
   * tipo no formulário, a resposta guardada descreve o agente anterior, e a derivação
   * local assume: a tela precisa mudar na hora da escolha, e não depois de salvar.
   */
  const cfg = roleConfigOf({
    preset: presetSalvo as AgentSummary['preset'],
    knowledgeEnabled,
    roleConfig: presetSalvo === agent?.preset ? agent?.roleConfig : undefined,
  })
  const rotulos = ROTULOS[cfg.role]
  const usaBase = cfg.allowedKnowledge
  const blocosDoPapel = cfg.sections as string[]
  const showKb = showBlock('conhecimento') && usaBase
  // Advanced groups are collapsible when several stack together (the "Avançado"
  // page, or the create modal with advanced expanded); a block shown alone (a
  // single-block section) gets no header.
  // "Como trabalha" entra aqui junto de "Avançado": ela também empilha vários blocos, e
  // sem cabeçalho eles viram uma rolagem longa em que nada é encontrável.
  const stacked = (flat && (section === 'avancado' || section === 'como-trabalha')) || (!flat && advancedOpen)
  // O provedor escolhido, com os modelos e os padrões que ele declara.
  const provedorAtual = providers.find((p) => p.id === editProvider)

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
                  // Sem autoFocus: este formulário edita um agente que já existe e
                  // vive no MEIO da página. Focar o campo fazia o navegador rolar
                  // até ele, então a página abria pela metade.
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
          {/* GRUPO 1 — quem ele é e o que ele entrega. Cinco blocos que respondem à
              mesma pergunta: a definição, o que espera receber, em que forma entrega e
              quando deve ser chamado. Soltos, eram cinco linhas indistinguíveis. */}
          <GrupoDeBlocos
            ativo={flat && section === 'como-trabalha'}
            titulo="Quem ele é e o que entrega"
            resumo="A função, o que espera receber, em que forma responde e quando deve ser chamado."
          >
          {showBlock('definicao') && (
            <CollapsibleBlock title={rotulos.definicao} showHeader={stacked} testId="agent-definition-block">
              <AgentDefinitionFields value={editDefinicao} onChange={setEditDefinicao} presetLabel={agent?.preset ?? null} />
            </CollapsibleBlock>
          )}


          {/* O que ele precisa RECEBER. Quem analisa só trabalha sobre isto; quem executa
              não deve agir sem isto. O campo é antigo (`inputContract`) e nunca teve onde
              ser escrito — vivia só na API. */}
          {/* Vinha ANTES do formulário, renderizada pela página — o primeiro bloco da
              aba, longe da definição que ela complementa. É por estas etiquetas que outro
              agente encontra este; elas são parte de quem ele é. */}
          {flat && section === 'como-trabalha' && agent && (
            <CollapsibleBlock
              title="Competências"
              showHeader
              defaultOpen
              hint={(agent.capabilities ?? []).length ? `${(agent.capabilities ?? []).length}` : 'nenhuma'}
            >
              <AgentCapabilities key={`${agent._id}:caps`} agent={agent} onSaved={() => onSaved(agent)} />
            </CollapsibleBlock>
          )}

          {showBlock('entrada') && (
            <CollapsibleBlock title={rotulos.entrada[0]} showHeader={stacked}>
              <textarea
                value={editInputContract}
                onChange={(e) => setEditInputContract(e.target.value)}
                rows={3}
                data-testid="agent-input-contract"
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              />
              <p className="mt-1 text-xs text-(--text-faint)">{rotulos.entrada[1]}</p>
            </CollapsibleBlock>
          )}

          {showBlock('entrega') && (
            <CollapsibleBlock title={rotulos.entrega[0]} showHeader={stacked}>
              <textarea
                value={editOutputContract}
                onChange={(e) => setEditOutputContract(e.target.value)}
                rows={3}
                data-testid="agent-output-contract"
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              />
              <p className="mt-1 text-xs text-(--text-faint)">{rotulos.entrega[1]}</p>
            </CollapsibleBlock>
          )}

          {/* Quem conduz não executa: aqui não há app, ferramenta nem base — só os tetos
              da orquestração. Cada tarefa é uma inferência inteira, com a base e as
              ferramentas de um agente; quem paga a conta escolhe quantas. */}
          {showBlock('orquestracao') && (
            <CollapsibleBlock title="Orquestração" showHeader={stacked}>
              <div className="space-y-4" data-testid="orchestration-block">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm text-(--text-muted)">Agentes por pedido</label>
                    <select
                      value={editOrchestration.maxTasks ?? ''}
                      onChange={(e) => setEditOrchestration({ ...editOrchestration, maxTasks: e.target.value ? Number(e.target.value) : undefined })}
                      data-testid="orchestration-max-tasks"
                      className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                    >
                      <option value="">Padrão do sistema (até 4)</option>
                      <option value="1">1 — sempre um só</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                    </select>
                    <p className="mt-1 text-xs text-(--text-faint)">Quantos membros o plano pode acionar. Cada um é uma execução completa.</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-(--text-muted)">Rodadas de planejamento</label>
                    <select
                      value={editOrchestration.maxRounds ?? ''}
                      onChange={(e) => setEditOrchestration({ ...editOrchestration, maxRounds: e.target.value ? Number(e.target.value) : undefined })}
                      data-testid="orchestration-max-rounds"
                      className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                    >
                      <option value="">Padrão do sistema (até 2)</option>
                      <option value="1">1 — não tenta de novo</option>
                      <option value="2">2</option>
                    </select>
                    <p className="mt-1 text-xs text-(--text-faint)">Uma segunda rodada só acontece quando a primeira não respondeu tudo.</p>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-(--text-muted)">Quando um membro falha</label>
                  <select
                    value={editOrchestration.onPartialFailure ?? ''}
                    onChange={(e) =>
                      setEditOrchestration({ ...editOrchestration, onPartialFailure: (e.target.value || undefined) as 'synthesize' | 'fail' | undefined })
                    }
                    data-testid="orchestration-partial-failure"
                    className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                  >
                    <option value="">Responder com o que veio, dizendo o que faltou (padrão)</option>
                    <option value="fail">Não responder: falhar a execução inteira</option>
                  </select>
                  <p className="mt-1 text-xs text-(--text-faint)">
                    Meia resposta declarada serve para quase tudo. Para um número que vai virar decisão, às vezes não responder é o certo.
                  </p>
                </div>
              </div>
            </CollapsibleBlock>
          )}


          {/* Vale para TODO papel: é a frase que o planejador lê para escolher quem
              trabalha. Sem ela, a escolha depende de o pedido por acaso repetir palavras
              do objetivo do agente. */}
          {showBlock('roteamento') && (
            <CollapsibleBlock title={rotulos.roteamento[0]} showHeader={stacked}>
              <textarea
                value={editRouting}
                onChange={(e) => setEditRouting(e.target.value)}
                rows={2}
                maxLength={400}
                data-testid="agent-routing-description"
                className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
              />
              <p className="mt-1 text-xs text-(--text-faint)">
                {rotulos.roteamento[1]} Um setor pode sobrescrever isto no próprio membro.
              </p>
            </CollapsibleBlock>
          )}
          </GrupoDeBlocos>

          {/* A porta de saída da regra do TIPO. Fica em Avançado, e não no meio de "Como
              trabalha": é uma exceção deliberada, não um passo da configuração. */}
          {showBlock('capacidades') && (
            <CollapsibleBlock title="Capacidades do tipo" showHeader={stacked}>
              <p className="text-sm text-(--text-muted)">{cfg.summary ?? 'O tipo do agente decide o que ele consulta e o que ele aciona.'}</p>
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={knowledgeEnabled === true}
                  onChange={(e) => setKnowledgeEnabled(e.target.checked ? true : undefined)}
                  data-testid="enable-knowledge"
                />
                <span>
                  Usar base própria neste agente mesmo assim
                  <span className="block text-xs text-(--text-faint)">
                    Liga a base e os sites num tipo que não os usa por padrão. Nada é apagado ao desmarcar — a configuração continua gravada.
                  </span>
                </span>
              </label>
            </CollapsibleBlock>
          )}

          {showBlock('execucao') && (
            <CollapsibleBlock title="Modelo e execução" showHeader={stacked}>
              <AgentRunConfigFields value={editRunConfig} onChange={setEditRunConfig} provider={editProvider} model={editModel || null} />
            </CollapsibleBlock>
          )}

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
                data-testid="agent-model"
              >
                {/* O padrão vem NOMEADO. "Padrão do sistema", sozinho, não diz se vai
                    rodar o modelo mais caro ou o mais barato — e quem paga a diferença é
                    quem está lendo. */}
                <option value="">
                  {provedorAtual?.defaultModel ? `Padrão do sistema — ${provedorAtual.defaultModel}` : 'Padrão do sistema'}
                </option>
                {/* A escolha por PERFIL. Fica ao lado do padrão porque é a alternativa a
                    ele: um manda sempre o mesmo modelo, o outro olha o que o agente faz. */}
                <option value="auto">Automático (pelo perfil do agente)</option>
                {(provedorAtual?.models ?? []).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              {/* O modelo de bastidor também é dinheiro: com o modo econômico ligado,
                  memória, extração e guardrail rodam nele. */}
              {editModel === 'auto' && (
                <p className="mt-1 text-xs text-(--text-faint)" data-testid="agent-model-auto-note">
                  Escolhe entre {provedorAtual?.defaultModel ?? 'o modelo principal'} e{' '}
                  {provedorAtual?.auxiliaryModel ?? 'o econômico'} conforme o que este agente faz: quem planeja, decide ou
                  executa ação real fica no principal; quem só transforma um texto que já existe usa o barato.
                </p>
              )}
              {provedorAtual?.auxiliaryModel && (
                <p className="mt-1 text-xs text-(--text-faint)" data-testid="agent-aux-model">
                  Tarefas internas (memória, extração, guardrail) usam {provedorAtual.auxiliaryModel} enquanto o modo
                  econômico estiver ligado.
                </p>
              )}
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

        {/* GRUPO 2 — o que ele ACIONA. Apps conectados, ferramentas HTTP próprias e as
            reutilizáveis da conta: três lugares diferentes para a mesma pergunta, que
            agora ficam juntos. */}
        {showBlock('ferramentas') && (
        <GrupoDeBlocos
          ativo={flat && section === 'como-trabalha'}
          titulo="O que ele aciona"
          resumo="Os apps e as ferramentas que ele pode chamar. Conceder é o que autoriza."
        >
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
              {/* As reutilizáveis da conta. Ficavam num bloco separado, fora do
                  formulário — três lugares para a mesma pergunta ("o que ele pode
                  acionar?"), e nenhum deles dizia que os outros dois existiam. */}
              {agent && (
                <div className="border-t border-(--border-subtle) pt-4">
                  <p className="mb-2 text-sm font-medium">Ferramentas reutilizáveis da conta</p>
                  <AgentToolsPicker key={`${agent._id}:tools`} agent={agent} onSaved={() => onSaved(agent)} />
                </div>
              )}
              {/* O recibo na hora. A gravação automática continua embaixo como rede — ela
                  é o que evita perder edição ao trocar de aba —, mas quem mexeu numa
                  ferramenta quer ver "Salvo", e não uma frase pedindo confiança. */}
              {flat && !isCreating && (
                <div className="flex items-center justify-end gap-3 border-t border-(--border-subtle) pt-4">
                  {autoSaveState !== 'idle' && (
                    <span className={`text-xs ${autoSaveState === 'error' ? 'text-(--coral-600)' : 'text-(--text-faint)'}`} data-testid="tools-save-state">
                      {autoSaveState === 'saving' ? 'Salvando…' : autoSaveState === 'saved' ? 'Salvo ✓' : 'Erro ao salvar'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void salvarAgora()}
                    disabled={autoSaveState === 'saving'}
                    data-testid="tools-save"
                    className="rounded-lg bg-(--intent-brand) px-4 py-2 text-sm font-medium text-(--text-on-brand) transition hover:bg-(--intent-brand-hover) disabled:opacity-50"
                  >
                    Salvar
                  </button>
                </div>
              )}
            </div>
          </CollapsibleBlock>
        )}
        </GrupoDeBlocos>
        )}
        </div>
      </div>

      {/* Não há bloco explicando a ausência de nada. Uma capacidade que não pertence ao
          papel simplesmente não é desenhada: um cartão dizendo "este agente não tem
          conhecimento" ocupa o mesmo espaço do bloco de verdade, com a diferença de não
          servir para nada. Quem quiser a base num tipo que não a usa liga em Avançado. */}
      {showKb && (
        /* GRUPO 3 — o que ele CONSULTA. Depois do que ele é e do que ele aciona: é a
           ordem em que a pergunta aparece de verdade. Antes vinha primeiro, empurrando a
           identidade do agente para baixo de uma lista de documentos. */
        <div className="order-4">
          {section == null && <div className="my-5 border-t border-(--border-subtle)" />}

          {/* Recolhível como os outros blocos da aba: era o único que ficava sempre
              aberto, e é justamente o mais alto — a lista de documentos empurrava todo o
              resto para fora da tela. */}
          <GrupoDeBlocos
            ativo={flat && section === 'como-trabalha'}
            titulo="O que ele consulta"
            resumo="De onde ele tira as respostas: o que você escreve, os sites que ele lê, e o que já foi guardado."
          >
          {/* FONTES DE CONHECIMENTO — o que ENTRA. Separado do que foi gerado porque são
              duas perguntas diferentes: "de onde ele tira" e "o que ele já tem". Estavam
              no mesmo bloco, e a lista de documentos empurrava o formulário de adicionar
              para fora da tela. */}
          <CollapsibleBlock title="Fontes de conhecimento" showHeader={stacked} testId="knowledge-sources-block">
            <div className="space-y-3">
              <p className="text-sm text-(--text-muted)">
                Textos que o agente usa para responder com precisão (cardápio, horários, políticas...).
                {isCreating && ' Eles serão enviados assim que o agente for criado.'}
              </p>
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
          </CollapsibleBlock>

          {/* PESQUISA WEB — entre "de onde ele tira" e "o que ele já tem", porque é
              exatamente o que acontece entre as duas: como cada site é lido, com que
              profundidade e com que limite. Ficava depois do conhecimento gerado, o que
              invertia causa e efeito. Só para quem COLETA: quem analisa trabalha sobre o
              que recebe, e quem conduz não lê site. */}
          {/* WEB — uma seção, dois sub-blocos, porque são duas coisas que é fácil confundir:
              "Sites específicos" é ler os endereços que VOCÊ escolheu; "Busca em toda a
              web" é descobrir endereços que ninguém escolheu. Eram dois blocos irmãos com
              o mesmo peso visual, e nada dizia que um não era o outro. */}
          {agent?._id && (cfg.allowedWeb || showBlock('busca-web')) && (
            <CollapsibleBlock title="Web" showHeader={stacked} testId="web-block">
              <div className="space-y-4">
                {cfg.allowedWeb && (
                  <div data-testid="web-sites-block">
                    <p className="text-sm font-medium">Sites específicos</p>
                    <p className="mb-2 text-xs text-(--text-faint)">
                      Você escolhe quais sites ele acompanha. Ele lê esses endereços — e só esses.
                    </p>
                    <AgentSources key={`${agent._id}:sources`} agentId={agent._id} />
                  </div>
                )}
          {/* O segundo sub-bloco: descobrir páginas que NINGUÉM cadastrou.
              
              Fica logo abaixo de "Sites específicos" de propósito, e a diferença está
              escrita entre os dois: lá você escolhe as fontes, aqui quem escolhe é o
              buscador. Custa mais, erra mais, e por isso nasce desligado. */}
          {showBlock('busca-web') && (
            <div className="space-y-4 border-t border-(--border-subtle) pt-4" data-testid="web-search-block">
              <div>
                <p className="text-sm font-medium">Busca em toda a web</p>
                <p className="text-xs text-(--text-faint)">
                  O buscador descobre páginas que você não cadastrou. Acima, em “Sites específicos”, é o contrário: você escolhe quais sites ele
                  acompanha.
                </p>
              </div>
              <WebSearchStatusLine />
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editWebSearch.enabled === true}
                    onChange={(e) => setEditWebSearch({ ...editWebSearch, enabled: e.target.checked })}
                    data-testid="web-search-enabled"
                  />
                  <span>
                    Permitir busca na web
                    <span className="block text-xs text-(--text-faint)">
                      Permite que o pesquisador procure novas fontes na internet quando o conhecimento e os sites cadastrados não forem
                      suficientes, ou quando a tarefa exigir informação atual.
                    </span>
                  </span>
                </label>

                {editWebSearch.enabled && (
                  <>
                    <div>
                      <label className="mb-1 block text-sm text-(--text-muted)">Quando pesquisar</label>
                      <select
                        value={editWebSearch.policy ?? 'fallback_only'}
                        onChange={(e) => setEditWebSearch({ ...editWebSearch, policy: e.target.value as 'automatic' | 'fallback_only' | 'always' })}
                        data-testid="web-search-policy"
                        className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                      >
                        <option value="fallback_only">Só quando a base não responder (recomendado)</option>
                        <option value="automatic">Automático — também quando a base trouxer pouco</option>
                        <option value="always">Sempre, mesmo com a base cheia</option>
                      </select>
                      <p className="mt-1 text-xs text-(--text-faint)">
                        Cada busca é uma requisição a um serviço externo, e cada página escolhida é uma leitura completa. “Sempre” faz as duas
                        coisas em toda tarefa.
                      </p>
                    </div>

                    {/* O ajuste fino de quem já sabe o que quer. Fechado: os padrões
                        servem para a maioria, e cinco números abertos escondem o
                        interruptor que de fato importa. */}
                    <details data-testid="web-search-advanced">
                      <summary className="cursor-pointer text-xs text-(--text-muted)">Configurações avançadas de busca</summary>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        {(
                          [
                            ['maxSearchResults', 'Resultados por busca', 10, 'Só título, endereço e trecho — baratos.'],
                            ['maxPagesToRead', 'Páginas abertas', 5, 'Esta é a que custa: cada uma é uma leitura completa.'],
                            ['maxCharsPerPage', 'Caracteres por página', 15000, 'Quanto de cada página é considerado.'],
                            ['maxEvidenceChunks', 'Trechos de evidência', 8, 'O que chega ao modelo. Página inteira piora a resposta.'],
                            ['searchTimeoutMs', 'Tempo limite da busca (ms)', 8000, ''],
                            ['pageReadTimeoutMs', 'Tempo limite por página (ms)', 12000, ''],
                          ] as const
                        ).map(([campo, rotulo, padrao, ajuda]) => (
                          <div key={campo}>
                            <label className="mb-1 block text-xs text-(--text-muted)">{rotulo}</label>
                            <input
                              type="number"
                              min={1}
                              value={editWebSearch[campo] ?? ''}
                              placeholder={String(padrao)}
                              onChange={(e) =>
                                setEditWebSearch({ ...editWebSearch, [campo]: e.target.value ? Number(e.target.value) : undefined })
                              }
                              data-testid={`web-search-${campo}`}
                              className="w-full rounded-lg border border-(--border-strong) bg-(--surface-card) px-3 py-2 text-sm outline-none focus:border-(--border-focus)"
                            />
                            {ajuda && <p className="mt-0.5 text-[11px] text-(--text-faint)">{ajuda}</p>}
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-(--text-faint)">
                        Em branco = o padrão. O servidor tem tetos próprios: um número acima deles é reduzido ao teto, não aceito.
                      </p>
                    </details>
                  </>
                )}
            </div>
          )}
              </div>
            </CollapsibleBlock>
          )}

          {/* CONHECIMENTO GERADO — o que ele JÁ TEM, venha de onde vier: o que foi escrito
              à mão e o que os sites produziram, com o filtro para separar os dois. */}
          <CollapsibleBlock
            title="Conhecimento gerado"
            showHeader={stacked}
            testId="knowledge-generated-block"
            hint={documents.length ? `${documents.length}` : undefined}
          >
          <div className="space-y-3">

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
            ) : (
              <>
              {/* O que a base tem, em números. Sem isto, "conhecimento" é uma lista sem
                  tamanho — e o que veio de site some no meio do que foi escrito à mão. */}
              {resumo && resumo.total > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--text-muted)" data-testid="knowledge-summary">
                  <span>Manual: <strong className="text-(--text-heading)">{resumo.manual}</strong></span>
                  <span>Web: <strong className="text-(--text-heading)">{resumo.web}</strong></span>
                  <span>Total: <strong className="text-(--text-heading)">{resumo.total}</strong></span>
                  {resumo.lastWebFetchAt && <span>· última leitura web: {new Date(resumo.lastWebFetchAt).toLocaleString('pt-BR')}</span>}
                </div>
              )}
              {resumo && resumo.web > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {(['all', 'manual', 'web'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      data-testid={`knowledge-filter-${k}`}
                      onClick={() => {
                        setFiltroDoc(k)
                        setFonteDoc(null)
                        if (agent?._id) void loadDocuments(agent._id, { kind: k, sourceId: null })
                      }}
                      className={`rounded-full px-2.5 py-0.5 text-xs ${filtroDoc === k && !fonteDoc ? 'bg-(--intent-brand) text-(--text-on-brand)' : 'text-(--text-muted)'}`}
                    >
                      {k === 'all' ? 'Todos' : k === 'manual' ? 'Manual' : 'Web'}
                    </button>
                  ))}
                  <input
                    value={buscaDoc}
                    onChange={(e) => setBuscaDoc(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && agent?._id) {
                        e.preventDefault()
                        void loadDocuments(agent._id, { q: (e.target as HTMLInputElement).value })
                      }
                    }}
                    placeholder="Buscar por título, domínio ou endereço"
                    data-testid="knowledge-search"
                    className="min-w-0 flex-1 rounded-lg border border-(--border-strong) bg-(--surface-card) px-2 py-1 text-xs outline-none focus:border-(--border-focus)"
                  />
                  {fonteDoc && (
                    <button
                      type="button"
                      data-testid="knowledge-clear-source"
                      onClick={() => {
                        setFonteDoc(null)
                        if (agent?._id) void loadDocuments(agent._id, { sourceId: null })
                      }}
                      className="text-xs text-(--text-muted) underline"
                    >
                      limpar filtro de fonte
                    </button>
                  )}
                </div>
              )}
              {documentsLoading ? (
              <p className="text-sm text-(--text-muted)">Carregando documentos...</p>
            ) : documents.length === 0 ? (
              <p className="text-sm text-(--text-muted)">Nenhum documento adicionado ainda.</p>
            ) : (
              <ul className="space-y-2">
                {documents.map((doc) => (
                  <li key={doc._id} className="rounded-lg border border-(--border-subtle) p-2 text-sm" data-testid={doc.web ? 'knowledge-web-item' : 'knowledge-manual-item'}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          {/* O selo separa o que foi escrito do que foi lido de um site —
                              e o domínio diz de ONDE, que é a primeira pergunta. */}
                          {doc.web && (
                            <span className="rounded-full bg-(--intent-brand-soft) px-1.5 py-0.5 text-[10px] font-bold text-(--text-heading)" data-testid="knowledge-web-badge">
                              WEB
                            </span>
                          )}
                          <span className="break-words">{doc.title}</span>
                        </span>
                        {doc.web && (
                          <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-(--text-faint)">
                            <span>{doc.web.domain}</span>
                            {doc.web.publishedAt && <span>· publicado {new Date(doc.web.publishedAt).toLocaleDateString('pt-BR')}</span>}
                            {doc.web.fetchedAt && <span>· lido {new Date(doc.web.fetchedAt).toLocaleString('pt-BR')}</span>}
                            {typeof doc.chunkCount === 'number' && <span>· {doc.chunkCount} trecho(s)</span>}
                            {doc.indexStatus && (
                              <span>· {doc.indexStatus === 'indexed' ? 'indexado' : doc.indexStatus === 'pending' ? 'indexando…' : 'erro ao indexar'}</span>
                            )}
                          </span>
                        )}
                      </span>
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
                        {/* Um artigo apagado volta no próximo scan — o endereço continua
                            sendo da fonte. Isto apaga E manda não trazer de volta, sem
                            mexer na fonte nem no resto que ela produziu. */}
                        {doc.web && (
                          <button
                            type="button"
                            onClick={() => handleDeleteDocument(doc._id, true)}
                            disabled={deletingDocId === doc._id}
                            data-testid="knowledge-delete-ignore"
                            title="Apaga e impede que o próximo scan traga este endereço de volta"
                            className="text-xs text-(--coral-600) underline transition hover:text-(--coral-600) disabled:opacity-50"
                          >
                            Excluir e ignorar
                          </button>
                        )}
                      </div>
                    </div>

                    {viewingDocId === doc._id && (
                      <div className="mt-2 border-t border-(--border-subtle) pt-2" data-testid="knowledge-doc-detail">
                        {viewingDocLoading ? (
                          <p className="text-sm text-(--text-muted)">Carregando...</p>
                        ) : doc.web ? (
                          /* O que veio de um site é LEITURA: editar à mão aqui seria
                             desfeito pelo próximo scan, e o dono não teria como saber. */
                          <div className="space-y-2">
                            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                              <dt className="text-(--text-faint)">Endereço</dt>
                              <dd className="min-w-0 break-all">
                                <a href={doc.web.canonicalUrl} target="_blank" rel="noopener noreferrer" className="underline" data-testid="knowledge-doc-url">
                                  {doc.web.canonicalUrl}
                                </a>
                              </dd>
                              <dt className="text-(--text-faint)">Fonte</dt>
                              <dd className="break-words">{doc.web.domain} · {doc.web.sourceId}</dd>
                              {doc.web.author && (
                                <>
                                  <dt className="text-(--text-faint)">Autoria</dt>
                                  <dd>{doc.web.author}</dd>
                                </>
                              )}
                              {doc.web.publishedAt && (
                                <>
                                  <dt className="text-(--text-faint)">Publicado</dt>
                                  <dd>{new Date(doc.web.publishedAt).toLocaleString('pt-BR')}</dd>
                                </>
                              )}
                              <dt className="text-(--text-faint)">Última leitura</dt>
                              <dd>{new Date(doc.web.fetchedAt).toLocaleString('pt-BR')}</dd>
                              <dt className="text-(--text-faint)">Indexação</dt>
                              <dd>
                                {doc.indexStatus === 'indexed' ? 'indexado' : doc.indexStatus === 'pending' ? 'indexando…' : 'erro ao indexar'}
                                {typeof doc.chunkCount === 'number' ? ` · ${doc.chunkCount} trecho(s)` : ''}
                                {/* O MOTIVO. "Erro ao indexar" sozinho é uma parede: chave ausente,
                                    cota, modelo e tamanho pedem ações diferentes, e nenhuma delas
                                    dá para escolher sem saber qual é o caso. */}
                                {doc.indexStatus === 'error' && (
                                  <span className="mt-1 block text-(--coral-600)" data-testid="knowledge-index-error">
                                    {doc.indexError || 'motivo não registrado — a próxima tentativa vai gravá-lo'}
                                  </span>
                                )}
                                {doc.indexStatus === 'error' && agent?._id && (
                                  <button
                                    type="button"
                                    data-testid="knowledge-reindex"
                                    disabled={reindexando === doc._id}
                                    onClick={() => void reindexar(doc._id)}
                                    className="mt-1 text-xs text-(--text-link) underline disabled:opacity-50"
                                  >
                                    {reindexando === doc._id ? 'Indexando…' : 'Tentar novamente'}
                                  </button>
                                )}
                              </dd>
                            </dl>
                            <pre className="max-h-64 overflow-auto rounded-lg bg-(--surface-sunken) p-2 text-[11px] whitespace-pre-wrap break-words" data-testid="knowledge-doc-content">
                              {viewingDocContent}
                            </pre>
                          </div>
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
              </>
            )}

          </div>
          </CollapsibleBlock>
          </GrupoDeBlocos>
        </div>
      )}

      {editError && <p className="order-last mt-4 text-sm text-(--coral-600)">{editError}</p>}

      {flat ? (
        // No save button: edits persist automatically. The knowledge-base page
        // manages its docs immediately, so it shows no status line.
        // A frase de "salva automaticamente" saiu: ela ocupava espaço para pedir confiança
        // e não dizia nada sobre o que aconteceu. O que informa é o ESTADO — e ele só
        // aparece quando há estado.
        section !== 'conhecimento' &&
        autoSaveState !== 'idle' && (
          <div className="order-last mt-5 flex justify-end border-t border-(--border-subtle) pt-4 text-sm">
            <span className={autoSaveState === 'error' ? 'text-(--coral-600)' : 'text-(--text-faint)'}>
              {autoSaveState === 'saving'
                ? 'Salvando...'
                : autoSaveState === 'saved'
                  ? 'Salvo ✓'
                  : 'Erro ao salvar — ajuste algo para tentar de novo'}
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
