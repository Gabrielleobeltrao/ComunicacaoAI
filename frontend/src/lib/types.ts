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
