import type { ObjectId } from 'mongodb'
import type { StepCondition } from './conditions.js'

// Automation domain types (AI-building pivot, Phase 3). A definition is
// structured (never one opaque prompt) so it can be validated, versioned
// immutably and executed step-by-step by the worker in a later phase.

export type AutomationStatus = 'draft' | 'active' | 'paused' | 'archived'
export type TriggerType = 'manual' | 'schedule' | 'webhook'
export type OutputFormat = 'text' | 'markdown' | 'json'

export type StepType =
  | 'source.rss'
  | 'source.http'
  | 'agent.execute'
  | 'transform.template'
  | 'delivery.send'
  // Guardar e consultar informação sem passar por modelo nenhum. Ver memory/records.ts.
  | 'memory.write'
  | 'memory.search'
  | 'memory.delete'
  // Executar uma ação de App diretamente, pelo MESMO caminho que o modelo usaria.
  | 'app.execute'

export const STEP_TYPES: readonly StepType[] = [
  'source.rss',
  'source.http',
  'agent.execute',
  'transform.template',
  'delivery.send',
  'memory.write',
  'memory.search',
  'memory.delete',
  'app.execute',
]

/**
 * `agent.execute` é a ÚNICA etapa que fala com um modelo.
 *
 * Isto não é uma observação, é a regra que sustenta os modos sem IA: se um dia
 * outra etapa passar a inferir, ela entra aqui — e os testes que garantem "zero
 * token" quebram, que é exatamente o que deve acontecer.
 */
export const AI_STEP_TYPES: readonly StepType[] = ['agent.execute']
export const stepUsesAI = (type: StepType): boolean => AI_STEP_TYPES.includes(type)

/**
 * Como um gatilho processa o que chega.
 *
 * `ai` é o que sempre existiu, e é o padrão de quem não escolheu: uma definição sem
 * este campo se comporta exatamente como antes.
 *
 * Os outros existem porque a maior parte do que um webhook recebe não precisa de
 * inteligência. Guardar um pedido é um INSERT; mandar para um modelo custa tokens a
 * cada evento, demora, e o resultado varia.
 */
export type ExecutionMode = 'collect_only' | 'deterministic' | 'ai' | 'hybrid' | 'automatic'

export const EXECUTION_MODES: readonly ExecutionMode[] = ['collect_only', 'deterministic', 'ai', 'hybrid', 'automatic']
export const isExecutionMode = (v: unknown): v is ExecutionMode =>
  typeof v === 'string' && (EXECUTION_MODES as readonly string[]).includes(v)

// Ausente = 'ai'. É isto que preserva o comportamento de tudo que já existe.
export const executionModeOf = (def: { executionMode?: ExecutionMode } | null | undefined): ExecutionMode =>
  isExecutionMode(def?.executionMode) ? def.executionMode : 'ai'

// Os modos em que a LLM nunca é chamada, aconteça o que acontecer.
export const modeNeverUsesAI = (mode: ExecutionMode): boolean => mode === 'collect_only' || mode === 'deterministic'

export interface RetryPolicy {
  maxAttempts: number
  backoffMs: number
}

export interface StepDefinition {
  id: string
  name: string
  type: StepType
  enabled: boolean
  dependsOn: string[]
  inputMapping: Record<string, string>
  config: Record<string, unknown>
  timeoutMs: number
  retryPolicy: RetryPolicy
  continueOnError: boolean
  /**
   * Condição para a etapa rodar. Ausente = sempre roda.
   *
   * É o que faz os modos híbrido e automático não chamarem a IA em silêncio: a
   * etapa do agente só roda quando isto for verdadeiro, e a avaliação é pura.
   */
  runIf?: StepCondition
}

export interface ManualTrigger {
  type: 'manual'
}
export interface ScheduleTrigger {
  type: 'schedule'
  timezone: string
  // Friendly recurrence; a cron expression is derived server-side later.
  cron: string
}
export interface WebhookTrigger {
  type: 'webhook'
  // The signing secret lives encrypted elsewhere; never in the definition.
  requireSignature: boolean
}
export type AutomationTrigger = ManualTrigger | ScheduleTrigger | WebhookTrigger

export interface AutomationInput {
  name: string
  label: string
  required: boolean
  type: 'string' | 'number' | 'boolean'
}

export interface DeliveryTarget {
  provider: 'email' | 'telegram'
  connectionId: string
  // Reference to the step/artifact whose output is delivered.
  fromStepId: string
  required: boolean
}

export interface AutomationLimits {
  maxSteps: number
  maxToolCalls: number
  maxOutputChars: number
  maxTokens: number | null
}

export interface AutomationDefinition {
  trigger: AutomationTrigger
  // Ausente = 'ai'. Ver `executionModeOf`.
  executionMode?: ExecutionMode
  inputs: AutomationInput[]
  steps: StepDefinition[]
  resultFormat: OutputFormat
  deliveries: DeliveryTarget[]
  limits: AutomationLimits
}

export interface Automation {
  _id: ObjectId
  ownerId: string
  buildingId: ObjectId
  floorId: ObjectId
  // When set, this automation is an agent ROUTINE — owned by and surfaced inside the
  // agent, not a standalone "Automação". Absent for legacy standalone automations.
  agentId?: ObjectId
  name: string
  description: string
  status: AutomationStatus
  // The DRAFT's trigger — what the editor shows. Never what the scheduler reads.
  trigger: AutomationTrigger
  draftDefinition: AutomationDefinition
  currentVersion: number
  lastPublishedVersion: number | null
  // The trigger of the last published version: the only one allowed to fire.
  // Absent on automations published before this field existed (backfilled by the
  // scheduler); null when nothing is published or the version row is gone.
  publishedTrigger?: AutomationTrigger | null
  // Next fire instant for a published schedule. Owned by the scheduler; cleared on
  // publish when the cron/timezone/type changed, so the old time cannot fire once
  // more after the change.
  nextRunAt?: Date | null
  // Webhook trigger: hard-to-guess public key + encrypted signing secret.
  webhookPublicKey?: string
  webhookSecretEncrypted?: string
  createdAt: Date
  updatedAt: Date
}

export interface AutomationVersion {
  _id: ObjectId
  ownerId: string
  automationId: ObjectId
  version: number
  definition: AutomationDefinition
  definitionHash: string
  createdAt: Date
  createdBy: string
}

export const DEFAULT_LIMITS: AutomationLimits = {
  maxSteps: 20,
  maxToolCalls: 20,
  maxOutputChars: 200_000,
  maxTokens: null,
}
