export type WidgetPosition = 'right' | 'left'

export interface WidgetSummary {
  _id: string
  name: string
  publicKey: string
  primaryColor: string | null
  welcomeTitle: string | null
  welcomeMessage: string | null
  position: WidgetPosition
  avatarUrl: string | null
  agentId: string | null
  sectorId: string | null
}

// organization = only groups agents (not executable); orchestrated = a coordinator
// leads and delegates; pipeline = ordered stages. Legacy 'adaptive' is served by the
// backend as 'orchestrated'.
export type SectorMode = 'organization' | 'orchestrated' | 'pipeline'

export interface SectorTransition {
  condition: string
  targetAgentId: string
}

export interface SectorMemberSummary {
  agentId: string
  sector: string
  routingDescription: string
  advanceWhen: string
  transitions: SectorTransition[]
  isDefault: boolean
}

// Pipeline execution stage (serialized). Ids are backend-assigned; the UI works in
// names/agents, never raw ids.
export interface SectorStageSummary {
  id: string
  name: string
  agentId: string
  instruction: string
  dependsOn: string[]
  inputMapping: Record<string, string>
  expectedOutput: string
  retryPolicy: { maxAttempts: number; backoffMs: number }
  onError: 'stop' | 'continue'
}

export interface SectorSummary {
  _id: string
  // The floor (office) this sector lives on. Serialized by the backend.
  floorId: string | null
  name: string
  // The room's base colour on the office map.
  color: string
  mode: SectorMode
  coordinatorAgentId?: string | null
  instruction?: string
  inputContract?: string
  outputContract?: string
  stages?: SectorStageSummary[]
  members: SectorMemberSummary[]
}

export type ToolMethod = 'GET' | 'POST'
export type ToolParamType = 'string' | 'number' | 'boolean'

export interface AgentToolParam {
  name: string
  type: ToolParamType
  description: string
  required: boolean
}

export interface AgentToolHeader {
  key: string
  value: string
}

export interface AgentTool {
  name: string
  description: string
  method: ToolMethod
  url: string
  headers: AgentToolHeader[]
  parameters: AgentToolParam[]
}

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
  ok: boolean
  result: string
  createdAt?: string
}

// A built-in integration ("app") enabled on an agent, with its per-agent config.
export interface AgentBuiltinTool {
  key: string
  config: Record<string, string>
}

export interface BuiltinAppCatalog {
  key: string
  label: string
  description: string
  connection?: 'google'
  configFields: { key: string; label: string; placeholder?: string; required: boolean; type?: 'text' | 'password' }[]
  guide?: { steps: string[]; docUrl?: string }
}

export interface WhatsAppProviderCatalog {
  key: string
  label: string
  description: string
  available: boolean
  fields: { key: string; label: string; placeholder?: string; required: boolean; type?: 'text' | 'password' }[]
  webhookNote?: string
}

export interface WhatsAppChannel {
  _id: string
  name: string
  provider: string | null
  number: string | null
  agentId: string | null
  sectorId: string | null
  createdAt: string
  webhookUrl: string | null
}

export type MemoryType = 'none' | 'facts' | 'structured' | 'semantic'
export type ConversationPersistence = 'same_browser' | 'always_new'
export type GuardrailMode = 'none' | 'prompt' | 'verification'
export type ResponseTone = 'neutral' | 'friendly' | 'formal' | 'enthusiastic'
export type ResponseDetail = 'balanced' | 'concise' | 'detailed'
export type Language = 'pt' | 'en' | 'es' | 'auto'

export interface AgentSummary {
  _id: string
  // The floor (office) this agent lives on. Serialized by the backend.
  floorId?: string | null
  name: string
  objective: string
  provider: 'anthropic' | 'openai'
  model: string | null
  memoryType: MemoryType
  historyLimit: number
  identityEnabled: boolean
  identityFields: string[]
  conversationPersistence: ConversationPersistence
  guardrailMode: GuardrailMode
  structuredOutputEnabled: boolean
  structuredOutputFields: string[]
  structuredOutputWebhookUrl: string | null
  responseTone: ResponseTone
  responseDetail: ResponseDetail
  responseEmojis: boolean
  responseFormatting: boolean
  handoffEnabled: boolean
  firstMessage: string | null
  proactivityEnabled: boolean
  proactivityGuidance: string
  language: Language
  dailyMessageLimit: number
  cheapAuxModel: boolean
  promptCaching: boolean
  tools: AgentTool[]
  builtinTools: AgentBuiltinTool[]
  // Agent-as-the-primary-unit model (additive; legacy agents get safe defaults from
  // the backend). Drive the hiring wizard, Acionamentos and delegation.
  preset: AgentPreset
  capabilities: string[]
  activationModes: ActivationMode[]
  inputContract: string
  outputContract: string
  // Executable contract (optional, advanced): the shape automatic tasks produce and,
  // for JSON, the schema the answer must satisfy.
  defaultOutputFormat?: 'text' | 'markdown' | 'json' | null
  outputJsonSchema?: Record<string, unknown> | null
  requireGrounding?: boolean
  delegationPolicy: DelegationPolicy
  callerPolicy: DelegationPolicy
  callableAgentIds: string[]
  callableSectorIds: string[]
  // Ids of the reusable Custom Tools this agent may call.
  toolIds?: string[]
  allowedCallerAgentIds: string[]
  metricProfile: MetricProfile
}

export type AgentPreset = 'manager' | 'secretary' | 'researcher' | 'analyst' | 'operator' | 'communicator' | 'monitor' | 'custom'
// 'agent_only' is LEGACY and read-only — it is never written again, and is not an
// option anywhere in the UI (callerPolicy models what it meant).
export type ActivationMode = 'manual' | 'scheduled' | 'event' | 'channel' | 'agent_only'
export const SETTABLE_ACTIVATION_MODES: ActivationMode[] = ['manual', 'scheduled', 'event', 'channel']
// Delegation permission (both directions): none = nobody, all = any agent in the
// same building, selected = only the matching id list.
export type DelegationPolicy = 'none' | 'all' | 'selected'

// The card's third-metric KPI. 'auto' derives from the preset; a concrete key is a
// manual choice that a preset change never overwrites.
export type MetricKey = 'executions' | 'delegations' | 'tool_actions' | 'conversations' | 'leads'
export type MetricProfile = 'auto' | MetricKey

// Per-agent operational stats over a period (from /api/agent-stats). Derived metrics
// are null when there is no telemetry — rendered "—", distinct from a real zero.
export interface AgentOperationalStats {
  executions: number
  avgDurationMs: number | null
  activeTimeMs: number
  totalTokens: number
  avgTokensPerExecution: number | null
  successRate: number | null // 0..1
  // label = full (agent page/tooltip); shortLabel = compact (card).
  specific: { key: MetricKey; label: string; shortLabel: string; value: number | null }
}

export interface AgentChannelStats {
  linked: boolean
  conversations: number
  attendedConversations: number
  qualifiedLeads: number
}

export interface AgentStatsResponse {
  period: '7d' | '30d' | 'all'
  telemetrySince: string | null
  stats: Record<string, AgentOperationalStats>
  channel: Record<string, AgentChannelStats>
}

// Per-agent roster stats for the Agentes cards (from /api/agent-stats).
export interface AgentCardStats {
  conversations: number
  attendedConversations: number
  qualifiedLeads: number
}

// The conceptual model the agent page renders (from the backend, never guessed).
export type TriggerKind = 'manual' | 'scheduled' | 'channel' | 'event'
export interface TriggerState {
  kind: TriggerKind
  allowed: boolean
  // Configured = something real fires it (a routine, a channel, a webhook).
  configured: boolean
  // Legacy rows only: something real fires it while the agent does not allow it.
  inconsistent?: boolean
}
export interface AgentWiring {
  routineCount: number
  channelCount: number
  webhookCount: number
  collaboratorCount: number
  toolCount: number
  knowledgeCount: number
  deliveryConfigured: boolean
}
export interface ReadinessIssue {
  code: string
  message: string
  action: string
  section: 'como-trabalha' | 'fluxos' | 'visao-geral'
}
export interface AgentReadiness {
  ready: boolean
  issues: ReadinessIssue[]
}

export interface AgentOverview {
  agent: AgentSummary
  stats: {
    conversations: number
    conversationsThisWeek: number
    messagesThisWeek: number
    attendedConversations: number
    handoffs: number
    qualifiedLeads: number
  }
  // KPI availability for the "Métrica do card" picker (data-source aware).
  channelLinked: boolean
  wiring: AgentWiring
  readiness: AgentReadiness
  triggers: TriggerState[]
  availableMetrics: MetricKey[]
  resolvedMetric: MetricKey
  linkedWidgets: { _id: string; name: string }[]
  // Where this agent is used as part of a team, and in which role. A coordinator
  // or a pipeline stage agent is often NOT in the sector's member list.
  linkedSectors: { _id: string; name: string; mode: SectorMode; roles: { role: 'coordinator' | 'member' | 'stage'; stageId?: string; stageName?: string }[] }[]
  knowledgeCount: number
}

export interface SectorAnalytics {
  sectorId: string
  sectorName: string
  mode: SectorMode
  decisions: number
  clarifyRate: number
  moves: number
  specialists: { name: string; count: number }[]
  stages: { name: string; handled: number; left: number }[]
}

export interface SectorReadinessIssueSummary {
  code: 'no_members' | 'no_coordinator' | 'no_stages' | 'stage_without_agent' | 'agent_pending'
  message: string
  action: string
  severity: 'blocking' | 'warning'
}

export interface SectorOverview {
  sector: SectorSummary
  readiness: { ready: boolean; issues: SectorReadinessIssueSummary[] }
  analytics: SectorAnalytics | null
  linkedWidgets: { _id: string; name: string }[]
}

export interface DashboardStats {
  conversations: number
  conversationsThisWeek: number
  messagesThisWeek: number
  attendedConversations: number
  handoffs: number
  qualifiedLeads: number
  agents: number
  widgets: number
  tokensThisWeek: number
  tokensThisMonth: number
  monthlyTokenCap: number
}

export interface ProviderInfo {
  id: 'anthropic' | 'openai'
  label: string
  models: { id: string; label: string }[]
}

export interface KnowledgeDocumentSummary {
  _id: string
  title: string
  createdAt: string
}
