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

export type SectorMode = 'adaptive' | 'pipeline'

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

export interface SectorSummary {
  _id: string
  // The floor (office) this sector lives on. Serialized by the backend.
  floorId: string | null
  name: string
  // The room's base colour on the office map.
  color: string
  mode: SectorMode
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
  callableAgentIds: string[]
  callableSectorIds: string[]
  allowedCallerAgentIds: string[]
}

export type AgentPreset = 'manager' | 'secretary' | 'researcher' | 'analyst' | 'operator' | 'communicator' | 'custom'
export type ActivationMode = 'manual' | 'scheduled' | 'event' | 'channel' | 'agent_only'

// Per-agent roster stats for the Agentes cards (from /api/agent-stats).
export interface AgentCardStats {
  conversations: number
  attendedConversations: number
  qualifiedLeads: number
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
  linkedWidgets: { _id: string; name: string }[]
  linkedSectors: { _id: string; name: string }[]
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

export interface SectorOverview {
  sector: SectorSummary
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
