import { ObjectId } from 'mongodb'
import { db } from './db.js'
import type { Provider } from './llm.js'

export const DEFAULT_HISTORY_LIMIT = 6

export type MemoryType = 'none' | 'facts' | 'structured' | 'semantic'
export const MEMORY_TYPES: MemoryType[] = ['none', 'facts', 'structured', 'semantic']

export type ConversationPersistence = 'same_browser' | 'always_new'
export const CONVERSATION_PERSISTENCE_TYPES: ConversationPersistence[] = ['same_browser', 'always_new']

export type GuardrailMode = 'none' | 'prompt' | 'verification'
export const GUARDRAIL_MODES: GuardrailMode[] = ['none', 'prompt', 'verification']

export type ResponseTone = 'neutral' | 'friendly' | 'formal' | 'enthusiastic'
export const RESPONSE_TONES: ResponseTone[] = ['neutral', 'friendly', 'formal', 'enthusiastic']

export type ResponseDetail = 'balanced' | 'concise' | 'detailed'
export const RESPONSE_DETAILS: ResponseDetail[] = ['balanced', 'concise', 'detailed']

export type Language = 'pt' | 'en' | 'es' | 'auto'
export const LANGUAGES: Language[] = ['pt', 'en', 'es', 'auto']

export const MAX_DAILY_MESSAGE_LIMIT = 1000
export const MAX_TOOLS = 10
export const MAX_TOOL_PARAMS = 10

export type ToolMethod = 'GET' | 'POST'
export const TOOL_METHODS: ToolMethod[] = ['GET', 'POST']

export type ToolParamType = 'string' | 'number' | 'boolean'
export const TOOL_PARAM_TYPES: ToolParamType[] = ['string', 'number', 'boolean']

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

// A custom HTTP tool the agent can call: the model decides when to call it based
// on name/description/parameters, and the backend makes the request to `url`.
export interface AgentTool {
  name: string
  description: string
  method: ToolMethod
  url: string
  headers: AgentToolHeader[]
  parameters: AgentToolParam[]
}

// A built-in integration ("app") enabled on the agent, with its per-agent config
// (e.g. which spreadsheet). See builtinTools.ts for the catalog.
export interface AgentBuiltinTool {
  key: string
  config: Record<string, string>
}

export interface Agent {
  _id: ObjectId
  ownerId: string
  name: string
  objective: string
  provider: Provider
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
  createdAt: Date
}

const agents = db.collection<Agent>('agents')

export async function createAgent(
  ownerId: string,
  name: string,
  options: {
    objective?: string
    provider?: Provider
    model?: string | null
    memoryType?: MemoryType
    historyLimit?: number
    identityEnabled?: boolean
    identityFields?: string[]
    conversationPersistence?: ConversationPersistence
    guardrailMode?: GuardrailMode
    structuredOutputEnabled?: boolean
    structuredOutputFields?: string[]
    structuredOutputWebhookUrl?: string | null
    responseTone?: ResponseTone
    responseDetail?: ResponseDetail
    responseEmojis?: boolean
    responseFormatting?: boolean
    handoffEnabled?: boolean
    firstMessage?: string | null
    proactivityEnabled?: boolean
    proactivityGuidance?: string
    language?: Language
    dailyMessageLimit?: number
    cheapAuxModel?: boolean
    promptCaching?: boolean
    tools?: AgentTool[]
    builtinTools?: AgentBuiltinTool[]
  } = {},
) {
  const agent: Omit<Agent, '_id'> = {
    ownerId,
    name,
    objective: options.objective ?? '',
    provider: options.provider ?? 'anthropic',
    model: options.model ?? null,
    memoryType: options.memoryType ?? 'none',
    historyLimit: options.historyLimit ?? DEFAULT_HISTORY_LIMIT,
    identityEnabled: options.identityEnabled ?? false,
    identityFields: options.identityFields ?? [],
    conversationPersistence: options.conversationPersistence ?? 'same_browser',
    guardrailMode: options.guardrailMode ?? 'none',
    structuredOutputEnabled: options.structuredOutputEnabled ?? false,
    structuredOutputFields: options.structuredOutputFields ?? [],
    structuredOutputWebhookUrl: options.structuredOutputWebhookUrl ?? null,
    responseTone: options.responseTone ?? 'neutral',
    responseDetail: options.responseDetail ?? 'balanced',
    responseEmojis: options.responseEmojis ?? false,
    responseFormatting: options.responseFormatting ?? false,
    handoffEnabled: options.handoffEnabled ?? false,
    firstMessage: options.firstMessage ?? null,
    proactivityEnabled: options.proactivityEnabled ?? false,
    proactivityGuidance: options.proactivityGuidance ?? '',
    language: options.language ?? 'pt',
    dailyMessageLimit: options.dailyMessageLimit ?? 0,
    cheapAuxModel: options.cheapAuxModel ?? true,
    promptCaching: options.promptCaching ?? true,
    tools: options.tools ?? [],
    builtinTools: options.builtinTools ?? [],
    createdAt: new Date(),
  }
  const result = await agents.insertOne(agent as Agent)
  return { ...agent, _id: result.insertedId }
}

export function listAgents(ownerId: string) {
  return agents.find({ ownerId }).sort({ createdAt: -1 }).toArray()
}

export function getAgentById(ownerId: string, agentId: ObjectId) {
  return agents.findOne({ _id: agentId, ownerId })
}

export function updateAgent(
  ownerId: string,
  agentId: ObjectId,
  updates: {
    name?: string
    objective?: string
    provider?: Provider
    model?: string | null
    memoryType?: MemoryType
    historyLimit?: number
    identityEnabled?: boolean
    identityFields?: string[]
    conversationPersistence?: ConversationPersistence
    guardrailMode?: GuardrailMode
    structuredOutputEnabled?: boolean
    structuredOutputFields?: string[]
    structuredOutputWebhookUrl?: string | null
    responseTone?: ResponseTone
    responseDetail?: ResponseDetail
    responseEmojis?: boolean
    responseFormatting?: boolean
    handoffEnabled?: boolean
    firstMessage?: string | null
    proactivityEnabled?: boolean
    proactivityGuidance?: string
    language?: Language
    dailyMessageLimit?: number
    cheapAuxModel?: boolean
    promptCaching?: boolean
    tools?: AgentTool[]
    builtinTools?: AgentBuiltinTool[]
  },
) {
  return agents.findOneAndUpdate(
    { _id: agentId, ownerId },
    { $set: updates },
    { returnDocument: 'after' },
  )
}

export async function deleteAgent(ownerId: string, agentId: ObjectId) {
  const result = await agents.deleteOne({ _id: agentId, ownerId })
  return result.deletedCount > 0
}
