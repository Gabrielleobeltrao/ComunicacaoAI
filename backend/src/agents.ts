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
  },
) {
  return agents.findOneAndUpdate(
    { _id: agentId, ownerId },
    { $set: updates },
    { returnDocument: 'after' },
  )
}
