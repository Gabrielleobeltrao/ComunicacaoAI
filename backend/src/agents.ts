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

// The role preset an agent was created from — a STARTING configuration, never a hard
// limit (every field stays editable afterwards). 'custom' = the old free-form agent.
export type AgentPreset = 'manager' | 'secretary' | 'researcher' | 'analyst' | 'operator' | 'communicator' | 'custom'
export const AGENT_PRESETS: AgentPreset[] = ['manager', 'secretary', 'researcher', 'analyst', 'operator', 'communicator', 'custom']

// How an agent may be triggered. An agent can have several. 'agent_only' means it is
// reachable ONLY by another agent/sector — it never starts a conversation, answers a
// channel directly, or runs manually (typical for a researcher).
export type ActivationMode = 'manual' | 'scheduled' | 'event' | 'channel' | 'agent_only'
export const ACTIVATION_MODES: ActivationMode[] = ['manual', 'scheduled', 'event', 'channel', 'agent_only']

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
  // The Escritório this agent belongs to (children of the office). Every agent
  // has one; a sector is optional (orphan agents are allowed).
  officeId: ObjectId
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
  // --- Agent-as-the-primary-unit model (additive; legacy agents get safe defaults
  // via withAgentDefaults on read, so no destructive migration is needed) ---
  preset: AgentPreset
  capabilities: string[] // free-form competency tags used for capability-based discovery/delegation
  activationModes: ActivationMode[] // how this agent may be triggered
  inputContract: string // what data the agent expects to receive (free text)
  outputContract: string // what result the agent must produce (free text)
  callableAgentIds: string[] // agents this agent may delegate to (owner-scoped ids)
  callableSectorIds: string[] // sectors this agent may delegate to (owner-scoped ids)
  allowedCallerAgentIds: string[] // agents allowed to call this one ([] = any agent of the same owner)
  createdAt: Date
}

// Fill the agent-as-primary-unit fields for documents written before they existed,
// so every reader sees a complete Agent without a destructive backfill.
export function withAgentDefaults(a: Agent): Agent {
  return {
    ...a,
    preset: a.preset ?? 'custom',
    capabilities: a.capabilities ?? [],
    activationModes: a.activationModes ?? ['manual', 'channel'],
    inputContract: a.inputContract ?? '',
    outputContract: a.outputContract ?? '',
    callableAgentIds: a.callableAgentIds ?? [],
    callableSectorIds: a.callableSectorIds ?? [],
    allowedCallerAgentIds: a.allowedCallerAgentIds ?? [],
  }
}

export interface AgentModelFields {
  preset?: AgentPreset
  capabilities?: string[]
  activationModes?: ActivationMode[]
  inputContract?: string
  outputContract?: string
  callableAgentIds?: string[]
  callableSectorIds?: string[]
  allowedCallerAgentIds?: string[]
}

// Parse + validate the agent-as-primary-unit fields from a request body. Only sets a
// key when the client sent a valid value, so a PATCH stays a true partial update.
// Returns an error string when a present value is the wrong type/shape.
export function parseAgentModelFields(body: Record<string, unknown>): { fields: AgentModelFields; error?: string } {
  const fields: AgentModelFields = {}
  if (body.preset !== undefined) {
    if (typeof body.preset !== 'string' || !(AGENT_PRESETS as string[]).includes(body.preset)) return { fields, error: 'Unknown preset' }
    fields.preset = body.preset as AgentPreset
  }
  if (body.activationModes !== undefined) {
    const v = body.activationModes
    if (!Array.isArray(v) || !v.every((m) => typeof m === 'string' && (ACTIVATION_MODES as string[]).includes(m))) return { fields, error: 'activationModes must be a list of known modes' }
    fields.activationModes = [...new Set(v as ActivationMode[])]
  }
  for (const key of ['capabilities', 'callableAgentIds', 'callableSectorIds', 'allowedCallerAgentIds'] as const) {
    const v = body[key]
    if (v === undefined) continue
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return { fields, error: `${key} must be a list of strings` }
    fields[key] = [...new Set((v as string[]).map((s) => s.trim()).filter(Boolean))]
  }
  for (const key of ['inputContract', 'outputContract'] as const) {
    const v = body[key]
    if (v === undefined) continue
    if (typeof v !== 'string') return { fields, error: `${key} must be a string` }
    fields[key] = v.slice(0, 4000)
  }
  return { fields }
}

const agents = db.collection<Agent>('agents')

export async function createAgent(
  ownerId: string,
  officeId: ObjectId,
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
    preset?: AgentPreset
    capabilities?: string[]
    activationModes?: ActivationMode[]
    inputContract?: string
    outputContract?: string
    callableAgentIds?: string[]
    callableSectorIds?: string[]
    allowedCallerAgentIds?: string[]
  } = {},
) {
  const agent: Omit<Agent, '_id'> = {
    ownerId,
    officeId,
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
    preset: options.preset ?? 'custom',
    capabilities: options.capabilities ?? [],
    activationModes: options.activationModes ?? ['manual', 'channel'],
    inputContract: options.inputContract ?? '',
    outputContract: options.outputContract ?? '',
    callableAgentIds: options.callableAgentIds ?? [],
    callableSectorIds: options.callableSectorIds ?? [],
    allowedCallerAgentIds: options.allowedCallerAgentIds ?? [],
    createdAt: new Date(),
  }
  const result = await agents.insertOne(agent as Agent)
  return { ...agent, _id: result.insertedId }
}

export async function listAgents(ownerId: string, floorId?: ObjectId): Promise<Agent[]> {
  const filter: Record<string, unknown> = { ownerId }
  if (floorId) filter.officeId = floorId
  const docs = await agents.find(filter).sort({ createdAt: -1 }).toArray()
  return docs.map(withAgentDefaults)
}

export async function getAgentById(ownerId: string, agentId: ObjectId): Promise<Agent | null> {
  const doc = await agents.findOne({ _id: agentId, ownerId })
  return doc ? withAgentDefaults(doc) : null
}

export async function updateAgent(
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
    preset?: AgentPreset
    capabilities?: string[]
    activationModes?: ActivationMode[]
    inputContract?: string
    outputContract?: string
    callableAgentIds?: string[]
    callableSectorIds?: string[]
    allowedCallerAgentIds?: string[]
  },
) {
  const doc = await agents.findOneAndUpdate(
    { _id: agentId, ownerId },
    { $set: updates },
    { returnDocument: 'after' },
  )
  return doc ? withAgentDefaults(doc) : null
}

export async function deleteAgent(ownerId: string, agentId: ObjectId) {
  const result = await agents.deleteOne({ _id: agentId, ownerId })
  return result.deletedCount > 0
}
