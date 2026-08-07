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
  teamId: string | null
}

export type TeamMode = 'adaptive' | 'pipeline'

export interface TeamTransition {
  condition: string
  targetAgentId: string
}

export interface TeamMemberSummary {
  agentId: string
  sector: string
  routingDescription: string
  advanceWhen: string
  transitions: TeamTransition[]
  isDefault: boolean
}

export interface TeamSummary {
  _id: string
  name: string
  mode: TeamMode
  members: TeamMemberSummary[]
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
  teamId: string | null
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
  linkedTeams: { _id: string; name: string }[]
  knowledgeCount: number
}

export interface TeamAnalytics {
  teamId: string
  teamName: string
  mode: TeamMode
  decisions: number
  clarifyRate: number
  moves: number
  specialists: { name: string; count: number }[]
  stages: { name: string; handled: number; left: number }[]
}

export interface TeamOverview {
  team: TeamSummary
  analytics: TeamAnalytics | null
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
