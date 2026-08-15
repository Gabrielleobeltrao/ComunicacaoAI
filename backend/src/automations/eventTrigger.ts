// Agent EVENT TRIGGERS — the user-facing shape of "something out there happens and
// this agent reacts". Exactly like Rotinas, it is an automation underneath: a webhook
// trigger plus one agent.execute step, so the existing receiver, idempotency, queue,
// runs and accounting handle it unchanged. The user never sees the word "automação".
//
// The event payload reaches the agent through a template step, which is what the
// linear runner already does with a step's dependency — no engine change.
import { ObjectId } from 'mongodb'
import { getAgentById, ensureActivationMode } from '../agents.js'
import { createAutomation, getAutomation, publishAutomation, rotateWebhookSecret, setStatus, updateDraft } from './service.js'
import { listAutomations as repoListAutomations } from './repository.js'
import { DEFAULT_LIMITS } from './types.js'
import type { Automation, AutomationDefinition, OutputFormat } from './types.js'

export interface EventTriggerSpec {
  name: string
  // What the agent must do with each event.
  objective: string
  outputFormat?: OutputFormat
  // Optional EXPLICIT sector context for knowledge grounding (authorised by the
  // service before the definition is stored).
  sectorId?: string | null
}

const STEP_EVENT = 'evento'
const STEP_AGENT = 'run'

export class EventTriggerError extends Error {}

// Pure: spec + owning agent → a valid AutomationDefinition with a webhook trigger.
// Signature is REQUIRED by default: an endpoint that runs an agent must not be
// callable by anyone who merely guesses the URL.
export function buildEventTriggerDefinition(spec: EventTriggerSpec, agentId: ObjectId): AutomationDefinition {
  const format = spec.outputFormat ?? 'markdown'
  return {
    trigger: { type: 'webhook', requireSignature: true },
    inputs: [],
    steps: [
      {
        // Carries the event body into the agent step: the runner hands a step its
        // first dependency's output as `input`.
        id: STEP_EVENT,
        name: 'Evento recebido',
        type: 'transform.template',
        enabled: true,
        dependsOn: [],
        inputMapping: {},
        config: { template: '{{input}}' },
        timeoutMs: 5_000,
        retryPolicy: { maxAttempts: 1, backoffMs: 0 },
        continueOnError: false,
      },
      {
        id: STEP_AGENT,
        name: 'Executar agente',
        type: 'agent.execute',
        enabled: true,
        dependsOn: [STEP_EVENT],
        inputMapping: {},
        config: {
          agentId: agentId.toString(),
          objective: spec.objective,
          instruction: spec.objective,
          format,
          ...(spec.sectorId ? { sectorId: spec.sectorId } : {}),
        },
        timeoutMs: 120_000,
        retryPolicy: { maxAttempts: 1, backoffMs: 2_000 },
        continueOnError: false,
      },
    ],
    resultFormat: format,
    deliveries: [],
    limits: { ...DEFAULT_LIMITS },
  }
}

// Create the trigger and arm it. The signing secret is returned HERE and never
// again — only its encrypted form is stored.
export async function createEventTrigger(
  ownerId: string,
  agentId: ObjectId,
  spec: EventTriggerSpec,
): Promise<{ trigger: Automation; publicKey: string; secret: string }> {
  const agent = await getAgentById(ownerId, agentId)
  if (!agent) throw new EventTriggerError('agent not found')
  const objective = spec.objective.trim()
  if (!objective) throw new EventTriggerError('objective is required')

  const created = await createAutomation(ownerId, {
    floorId: agent.officeId.toString(),
    name: spec.name.trim() || 'Gatilho por evento',
    description: objective.slice(0, 2000),
    definition: buildEventTriggerDefinition({ ...spec, objective }, agentId),
    agentId,
  })
  // createAutomation stores an encrypted secret it cannot hand back; rotating right
  // away is what produces the one plaintext the user ever sees.
  const rotated = await rotateWebhookSecret(ownerId, created._id)
  if (!rotated) throw new EventTriggerError('could not arm the trigger')
  await publishAutomation(ownerId, created._id, ownerId)
  const active = await setStatus(ownerId, created._id, 'active')
  // A configured trigger must also be an allowed one, or the agent page would show
  // an armed webhook while its activation reads "desligado".
  await ensureActivationMode(ownerId, agentId, 'event')
  return { trigger: active ?? created, publicKey: rotated.publicKey, secret: rotated.secret }
}

// Change name/objective. The endpoint and its secret are untouched — a rename must
// never break a caller that is already integrated.
export async function updateEventTrigger(ownerId: string, agentId: ObjectId, triggerId: ObjectId, spec: EventTriggerSpec): Promise<Automation | null> {
  const existing = await getEventTriggerForAgent(ownerId, agentId, triggerId)
  if (!existing) return null
  const objective = spec.objective.trim()
  if (!objective) throw new EventTriggerError('objective is required')
  await updateDraft(ownerId, triggerId, {
    name: spec.name.trim() || existing.name,
    description: objective.slice(0, 2000),
    definition: buildEventTriggerDefinition({ ...spec, objective }, agentId),
  })
  await publishAutomation(ownerId, triggerId, ownerId)
  return getAutomation(ownerId, triggerId)
}

const isEventTrigger = (a: Automation): boolean =>
  (a.publishedTrigger?.type ?? a.trigger?.type) === 'webhook'

export async function listEventTriggers(ownerId: string, agentId: ObjectId): Promise<Automation[]> {
  const { items } = await repoListAutomations(ownerId, { agentId, limit: 100, skip: 0 })
  return items.filter(isEventTrigger)
}

// Ownership guard for every mutation: the trigger must belong to THIS agent, of
// THIS owner, and actually be an event trigger.
export async function getEventTriggerForAgent(ownerId: string, agentId: ObjectId, triggerId: ObjectId): Promise<Automation | null> {
  const doc = await getAutomation(ownerId, triggerId)
  if (!doc || doc.agentId?.toString() !== agentId.toString()) return null
  return isEventTrigger(doc) ? doc : null
}
