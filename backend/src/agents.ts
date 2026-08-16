import { ObjectId } from 'mongodb'
import { db } from './db.js'
import { isValidToolSchema } from './jsonSchema.js'
import type { Provider } from './llm.js'
import type { AgentAppGrant } from './apps/types.js'
import { isSecretLegacyConfigKey } from './apps/registry.js'
// Type-only cycle back to agents.ts, so there is no runtime import loop.
import { sanitizeActivationWrite } from './agentReadiness.js'

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
export type AgentPreset = 'manager' | 'secretary' | 'researcher' | 'analyst' | 'operator' | 'communicator' | 'monitor' | 'custom'
export const AGENT_PRESETS: AgentPreset[] = ['manager', 'secretary', 'researcher', 'analyst', 'operator', 'communicator', 'monitor', 'custom']

// How an agent may be triggered. An agent can have several.
//
// 'agent_only' is LEGACY and read-only: it never was a trigger, it meant "reachable
// only by another agent", which callerPolicy models. Old documents still carry it and
// keep working (normalizeActivation drops it, callerPolicyFromLegacy preserves the
// permission); nothing writes it again — see sanitizeActivationWrite.
export type ActivationMode = 'manual' | 'scheduled' | 'event' | 'channel' | 'agent_only'
// The modes a client may SET. agent_only is deliberately absent.
export const ACTIVATION_MODES: ActivationMode[] = ['manual', 'scheduled', 'event', 'channel']
// Accepted on input for backward compatibility, then converted, never stored.
export const LEGACY_ACTIVATION_MODES: ActivationMode[] = ['agent_only']

// Delegation permission, modelled explicitly so an empty list is never ambiguous
// (it used to mean both "anyone" and "no one"). Applies to BOTH directions:
//   outgoing (delegationPolicy): whom this agent may delegate to.
//   incoming (callerPolicy): who may call this agent.
// 'none' = nobody; 'all' = any agent in the SAME BUILDING; 'selected' = only the
// matching id list (callableAgentIds / allowedCallerAgentIds).
// 'floor' = only agents and executable sectors of the SAME floor. It sits between
// 'selected' (explicit ids) and 'all' (the whole building) and is what a floor
// coordinator normally wants: reach my area, not the building.
export type DelegationPolicy = 'none' | 'all' | 'selected' | 'floor'
export const DELEGATION_POLICIES: DelegationPolicy[] = ['none', 'all', 'selected', 'floor']

// The card KPI an agent shows in position 3. A concrete key is a MANUAL choice and
// is never overwritten by a preset change; 'auto' derives the key from the preset at
// read time (so changing the preset moves only the automatic default).
export type MetricKey = 'executions' | 'delegations' | 'tool_actions' | 'deliveries' | 'conversations' | 'leads'
export type MetricProfile = 'auto' | MetricKey
export const METRIC_PROFILES: MetricProfile[] = ['auto', 'executions', 'delegations', 'tool_actions', 'deliveries', 'conversations', 'leads']

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

// DEPRECATED per-agent HTTP tool. Superseded by the reusable Custom Tools
// (collection `tools`, assigned by id), which carry an encrypted credential, a
// domain allow list, per-run call limits and an explicit authorisation for
// state-changing methods.
//
// Existing tools keep working untouched: agentTools.legacyToolToExecutable adapts
// this shape at resolution time so it runs through the SAME executor as everything
// else. Nothing new should be written in this format.
export interface AgentTool {
  name: string
  description: string
  method: ToolMethod
  url: string
  headers: AgentToolHeader[]
  parameters: AgentToolParam[]
}

// Reusable Custom Tools (collection `tools`) this agent is allowed to call, by id.
// An agent can ONLY call what is listed here — assignment is the permission.
// The legacy per-agent `tools` array below still works and is resolved alongside.

// A built-in integration ("app") enabled on the agent, with its per-agent config
// (e.g. which spreadsheet). See builtinTools.ts for the catalog.
//
// DEPRECATED — this is where a credential used to live in the clear, inside the
// agent document. It is read-only during the transition: the migration moves the
// credential into an encrypted installation and leaves only non-secret selection
// here. New configuration goes through `appGrants`.
export interface AgentBuiltinTool {
  key: string
  config: Record<string, string>
  // Stamped by the migration. Present = the credential already lives in an
  // installation and must not be read from here again.
  migratedAt?: Date
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
  // What this agent may do with the owner's connected Apps: which installation,
  // which actions, and which of those may run without being asked. Not listed
  // means not reachable — assignment IS the permission.
  appGrants: AgentAppGrant[]
  // --- Agent-as-the-primary-unit model (additive; legacy agents get safe defaults
  // via withAgentDefaults on read, so no destructive migration is needed) ---
  preset: AgentPreset
  capabilities: string[] // free-form competency tags used for capability-based discovery/delegation
  activationModes: ActivationMode[] // how this agent may be triggered
  inputContract: string // what data the agent expects to receive (free text)
  outputContract: string // what result the agent must produce (free text)
  // --- executable side of the contract (all optional, all additive) --------------
  // The format a task produces when the caller does not ask for a specific one.
  // Absent = the previous behaviour (whatever the caller requested, else text).
  defaultOutputFormat?: 'text' | 'markdown' | 'json'
  // For JSON: the schema the answer must satisfy. Validated with the same validator
  // the tools use; an invalid answer earns ONE correction and then fails as
  // `validation` instead of being delivered.
  outputJsonSchema?: Record<string, unknown> | null
  // When true, a task refuses to run without curated knowledge (the retrieval
  // failed or found nothing above the relevance floor). Default false: the agent
  // answers anyway and is told the base was unavailable.
  requireGrounding?: boolean
  delegationPolicy: DelegationPolicy // outgoing: whom this agent may delegate to
  callerPolicy: DelegationPolicy // incoming: who may call this agent
  callableAgentIds: string[] // when delegationPolicy='selected': the agents this one may call
  callableSectorIds: string[] // when delegationPolicy='selected': the sectors this one may call
  // Ids from the `tools` collection this agent may call.
  toolIds: string[]
  allowedCallerAgentIds: string[] // when callerPolicy='selected': the agents allowed to call this one
  metricProfile: MetricProfile // which KPI the card shows ('auto' = derive from preset)
  createdAt: Date
}

// Legacy documents predate the explicit policy fields. Derive a compatible policy
// from the old id lists + preset so behaviour is preserved: a manager could always
// delegate, a non-empty list meant "these only", and an empty allowedCaller list
// meant "any caller".
function deriveDelegationPolicy(a: Agent): DelegationPolicy {
  if (a.delegationPolicy) return a.delegationPolicy
  if ((a.callableAgentIds?.length ?? 0) > 0 || (a.callableSectorIds?.length ?? 0) > 0) return 'selected'
  return a.preset === 'manager' ? 'all' : 'none'
}
function deriveCallerPolicy(a: Agent): DelegationPolicy {
  if (a.callerPolicy) return a.callerPolicy
  return (a.allowedCallerAgentIds?.length ?? 0) > 0 ? 'selected' : 'all'
}

// The legacy per-agent tool format keeps its credential in a plain header, and that
// header can be called anything. Nothing outside the executor may see those values:
// they are masked on every way out of the API, and a masked value sent back on save
// means "keep the stored one" (see parseTools).
export const MASKED_HEADER_VALUE = '***'

export function toPublicAgent<T extends { tools?: AgentTool[]; builtinTools?: AgentBuiltinTool[] }>(agent: T): T {
  // Legacy built-in config could hold a token in the clear. Until the migration has
  // moved every one of them into an installation, nothing from it leaves the API
  // with a readable value.
  const builtinTools = agent.builtinTools?.length
    ? agent.builtinTools.map((entry) => ({
        ...entry,
        config: Object.fromEntries(
          Object.entries(entry.config ?? {}).map(([key, value]) => [key, isSecretLegacyConfigKey(entry.key, key) && value ? MASKED_HEADER_VALUE : value]),
        ),
      }))
    : agent.builtinTools

  if (!agent.tools?.length) return builtinTools === agent.builtinTools ? agent : { ...agent, builtinTools }
  return {
    ...agent,
    builtinTools,
    tools: agent.tools.map((tool) => ({
      ...tool,
      headers: (tool.headers ?? []).map((header) => ({ key: header.key, value: header.value ? MASKED_HEADER_VALUE : '' })),
    })),
  }
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
    toolIds: a.toolIds ?? [],
    appGrants: a.appGrants ?? [],
    allowedCallerAgentIds: a.allowedCallerAgentIds ?? [],
    delegationPolicy: deriveDelegationPolicy(a),
    callerPolicy: deriveCallerPolicy(a),
    metricProfile: a.metricProfile ?? 'auto',
  }
}

export interface AgentModelFields {
  preset?: AgentPreset
  capabilities?: string[]
  activationModes?: ActivationMode[]
  inputContract?: string
  outputContract?: string
  defaultOutputFormat?: 'text' | 'markdown' | 'json'
  outputJsonSchema?: Record<string, unknown> | null
  requireGrounding?: boolean
  delegationPolicy?: DelegationPolicy
  callerPolicy?: DelegationPolicy
  callableAgentIds?: string[]
  callableSectorIds?: string[]
  allowedCallerAgentIds?: string[]
  toolIds?: string[]
  metricProfile?: MetricProfile
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
    const accepted = [...ACTIVATION_MODES, ...LEGACY_ACTIVATION_MODES] as string[]
    if (!Array.isArray(v) || !v.every((m) => typeof m === 'string' && accepted.includes(m))) return { fields, error: 'activationModes must be a list of known modes' }
    // A legacy agent_only in the payload is converted here and never stored.
    const explicit = typeof body.callerPolicy === 'string' && (DELEGATION_POLICIES as string[]).includes(body.callerPolicy) ? (body.callerPolicy as DelegationPolicy) : undefined
    const sanitized = sanitizeActivationWrite(v as string[], explicit)
    fields.activationModes = sanitized.activationModes
    if (sanitized.callerPolicy) fields.callerPolicy = sanitized.callerPolicy
  }
  for (const key of ['capabilities', 'callableAgentIds', 'callableSectorIds', 'allowedCallerAgentIds', 'toolIds'] as const) {
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
  for (const key of ['delegationPolicy', 'callerPolicy'] as const) {
    const v = body[key]
    if (v === undefined) continue
    if (typeof v !== 'string' || !(DELEGATION_POLICIES as string[]).includes(v)) return { fields, error: `${key} must be one of ${DELEGATION_POLICIES.join(', ')}` }
    fields[key] = v as DelegationPolicy
  }
  if (body.metricProfile !== undefined) {
    if (typeof body.metricProfile !== 'string' || !(METRIC_PROFILES as string[]).includes(body.metricProfile)) return { fields, error: `metricProfile must be one of ${METRIC_PROFILES.join(', ')}` }
    fields.metricProfile = body.metricProfile as MetricProfile
  }
  // --- executable contract (optional; absent leaves the agent exactly as it was) ---
  if (body.defaultOutputFormat !== undefined) {
    if (body.defaultOutputFormat === null || body.defaultOutputFormat === '') fields.defaultOutputFormat = undefined
    else if (typeof body.defaultOutputFormat !== 'string' || !['text', 'markdown', 'json'].includes(body.defaultOutputFormat)) {
      return { fields, error: 'defaultOutputFormat must be text, markdown or json' }
    } else fields.defaultOutputFormat = body.defaultOutputFormat as 'text' | 'markdown' | 'json'
  }
  if (body.outputJsonSchema !== undefined) {
    if (body.outputJsonSchema === null || body.outputJsonSchema === '') fields.outputJsonSchema = null
    else {
      // The same validator the tools use: a schema that cannot be enforced is not
      // accepted, so an agent can never promise a shape nothing checks.
      if (!isValidToolSchema(body.outputJsonSchema)) return { fields, error: 'outputJsonSchema must be an object JSON Schema' }
      fields.outputJsonSchema = body.outputJsonSchema as Record<string, unknown>
    }
  }
  if (body.requireGrounding !== undefined) {
    if (typeof body.requireGrounding !== 'boolean') return { fields, error: 'requireGrounding must be a boolean' }
    fields.requireGrounding = body.requireGrounding
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
    appGrants?: AgentAppGrant[]
    preset?: AgentPreset
    capabilities?: string[]
    activationModes?: ActivationMode[]
    inputContract?: string
    outputContract?: string
    delegationPolicy?: DelegationPolicy
    callerPolicy?: DelegationPolicy
    callableAgentIds?: string[]
    callableSectorIds?: string[]
    allowedCallerAgentIds?: string[]
    toolIds?: string[]
    metricProfile?: MetricProfile
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
    appGrants: options.appGrants ?? [],
    preset: options.preset ?? 'custom',
    capabilities: options.capabilities ?? [],
    // agent_only is never stored, whatever the caller passed.
    activationModes: sanitizeActivationWrite(options.activationModes ?? ['manual', 'channel']).activationModes,
    inputContract: options.inputContract ?? '',
    outputContract: options.outputContract ?? '',
    callableAgentIds: options.callableAgentIds ?? [],
    callableSectorIds: options.callableSectorIds ?? [],
    toolIds: options.toolIds ?? [],
    allowedCallerAgentIds: options.allowedCallerAgentIds ?? [],
    // A manager delegates by default; every other role starts as a leaf (none) and
    // opts in. Any agent can be called by default (callerPolicy='all') so a manager
    // can reach a fresh specialist without extra wiring.
    delegationPolicy: options.delegationPolicy ?? (options.preset === 'manager' ? 'all' : 'none'),
    callerPolicy: options.callerPolicy ?? 'all',
    metricProfile: options.metricProfile ?? 'auto',
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
    appGrants?: AgentAppGrant[]
    preset?: AgentPreset
    capabilities?: string[]
    activationModes?: ActivationMode[]
    inputContract?: string
    outputContract?: string
    delegationPolicy?: DelegationPolicy
    callerPolicy?: DelegationPolicy
    callableAgentIds?: string[]
    callableSectorIds?: string[]
    allowedCallerAgentIds?: string[]
    toolIds?: string[]
    metricProfile?: MetricProfile
  },
) {
  // Same rule as creation: a legacy agent_only coming back in an update is converted
  // to the incoming permission it meant and dropped from the stored triggers.
  const patch = { ...updates }
  if (patch.activationModes) {
    const sanitized = sanitizeActivationWrite(patch.activationModes, patch.callerPolicy)
    patch.activationModes = sanitized.activationModes
    if (sanitized.callerPolicy) patch.callerPolicy = sanitized.callerPolicy
  }
  const doc = await agents.findOneAndUpdate(
    { _id: agentId, ownerId },
    { $set: patch },
    { returnDocument: 'after' },
  )
  return doc ? withAgentDefaults(doc) : null
}

// Keep the "allowed" side in sync when a trigger is really configured: creating a
// routine implies scheduled, linking a widget implies channel, a webhook implies
// event. activationModes stays the single source of truth for what is allowed, and
// new configuration can never contradict it. Idempotent.
export async function ensureActivationMode(ownerId: string, agentId: ObjectId, mode: ActivationMode): Promise<void> {
  await agents.updateOne({ _id: agentId, ownerId }, { $addToSet: { activationModes: mode } })
}

// A deleted tool must not linger in any agent's allow list: an id that resolves
// to nothing is confusing in the UI and pointless at execution time.
export async function pullToolFromAgents(ownerId: string, toolId: string): Promise<number> {
  const res = await agents.updateMany({ ownerId, toolIds: toolId }, { $pull: { toolIds: toolId } })
  return res.modifiedCount
}

export async function deleteAgent(ownerId: string, agentId: ObjectId) {
  const result = await agents.deleteOne({ _id: agentId, ownerId })
  return result.deletedCount > 0
}
