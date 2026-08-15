import type { ObjectId } from 'mongodb'

// Automation domain types (AI-building pivot, Phase 3). A definition is
// structured (never one opaque prompt) so it can be validated, versioned
// immutably and executed step-by-step by the worker in a later phase.

export type AutomationStatus = 'draft' | 'active' | 'paused' | 'archived'
export type TriggerType = 'manual' | 'schedule' | 'webhook'
export type OutputFormat = 'text' | 'markdown' | 'json'

export type StepType = 'source.rss' | 'source.http' | 'agent.execute' | 'transform.template' | 'delivery.send'

export const STEP_TYPES: readonly StepType[] = [
  'source.rss',
  'source.http',
  'agent.execute',
  'transform.template',
  'delivery.send',
]

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
