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
}

export type MemoryType = 'none' | 'facts' | 'structured' | 'semantic'

export interface AgentSummary {
  _id: string
  name: string
  objective: string
  provider: 'anthropic' | 'openai'
  model: string | null
  widgetId: string | null
  memoryType: MemoryType
  historyLimit: number
  identityFields: string[]
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
