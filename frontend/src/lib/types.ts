export interface WidgetSummary {
  _id: string
  name: string
  publicKey: string
}

export interface AgentSummary {
  _id: string
  name: string
  objective: string
  provider: 'anthropic' | 'openai'
  model: string | null
  widgetId: string | null
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
