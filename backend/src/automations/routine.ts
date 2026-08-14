// Agent ROUTINES — the user-facing shape of a scheduled agent task, living inside the
// agent (never a standalone "Automação"). A routine compiles to an AutomationDefinition
// (schedule trigger + one agent.execute step + optional delivery) so the existing
// engine — scheduler, queue, worker, runs, artifacts, deliveries — runs it unchanged.
import { ObjectId } from 'mongodb'
import { getAgentById } from '../agents.js'
import { recurrenceToCron, isValidRecurrence, describeRecurrence } from './schedule.js'
import type { Recurrence } from './schedule.js'
import { createAutomation, getAutomation, publishAutomation, setStatus, updateDraft } from './service.js'
import { listAutomations as repoListAutomations } from './repository.js'
import { DEFAULT_LIMITS } from './types.js'
import type { Automation, AutomationDefinition, OutputFormat } from './types.js'

export interface RoutineSpec {
  name: string
  objective: string // the instruction/objective for each run
  recurrence: Recurrence // friendly recurrence (daily / weekly / monthly)
  timezone: string
  input?: string // static input text handed to the agent every run
  outputFormat?: OutputFormat
  delivery?: { provider: 'email' | 'telegram'; connectionId: string } | null
  retryMaxAttempts?: number
  maxOutputChars?: number
  // Optional EXPLICIT sector context for knowledge grounding. Authorised
  // owner-scoped by the service before the definition is stored/published, and
  // re-checked defensively by the worker.
  sectorId?: string | null
}

const STEP_AGENT = 'run'
const STEP_DELIVERY = 'deliver'

// Pure: routine spec + owning agent → a valid AutomationDefinition.
export function buildRoutineDefinition(spec: RoutineSpec, agentId: ObjectId): AutomationDefinition {
  const format = spec.outputFormat ?? 'markdown'
  const instruction = spec.input ? `${spec.objective}\n\nEntrada: ${spec.input}` : spec.objective
  const steps: AutomationDefinition['steps'] = [
    {
      id: STEP_AGENT,
      name: 'Executar agente',
      type: 'agent.execute',
      enabled: true,
      dependsOn: [],
      inputMapping: {},
      config: { agentId: agentId.toString(), objective: spec.objective, instruction, format, ...(spec.sectorId ? { sectorId: spec.sectorId } : {}) },
      timeoutMs: 120_000,
      retryPolicy: { maxAttempts: Math.max(1, Math.min(spec.retryMaxAttempts ?? 1, 5)), backoffMs: 2000 },
      continueOnError: false,
    },
  ]
  const deliveries: AutomationDefinition['deliveries'] = []
  if (spec.delivery) {
    steps.push({
      id: STEP_DELIVERY,
      name: 'Entregar resultado',
      type: 'delivery.send',
      enabled: true,
      dependsOn: [STEP_AGENT],
      inputMapping: {},
      config: { connectionId: spec.delivery.connectionId, fromStepId: STEP_AGENT },
      timeoutMs: 30_000,
      retryPolicy: { maxAttempts: 2, backoffMs: 2000 },
      continueOnError: false,
    })
    deliveries.push({ provider: spec.delivery.provider, connectionId: spec.delivery.connectionId, fromStepId: STEP_AGENT, required: false })
  }
  return {
    trigger: { type: 'schedule', timezone: spec.timezone, cron: recurrenceToCron(spec.recurrence) },
    inputs: [],
    steps,
    resultFormat: format,
    deliveries,
    limits: { ...DEFAULT_LIMITS, maxOutputChars: spec.maxOutputChars ?? DEFAULT_LIMITS.maxOutputChars },
  }
}

export class RoutineError extends Error {}

// Create a routine on an agent: build the definition, create the (agent-owned)
// automation, publish it (immutable version) and activate it so the scheduler picks
// it up. Returns the resulting Automation.
export async function createRoutine(ownerId: string, agentId: ObjectId, spec: RoutineSpec): Promise<Automation> {
  const agent = await getAgentById(ownerId, agentId)
  if (!agent) throw new RoutineError('agent not found')
  if (!isValidRecurrence(spec.recurrence)) throw new RoutineError('invalid recurrence')
  const definition = buildRoutineDefinition(spec, agentId)
  const created = await createAutomation(ownerId, {
    floorId: agent.officeId.toString(),
    name: spec.name || describeRecurrence(spec.recurrence),
    description: spec.objective.slice(0, 2000),
    definition,
    agentId,
  })
  await publishAutomation(ownerId, created._id, ownerId)
  const active = await setStatus(ownerId, created._id, 'active')
  return active ?? created
}

// Update a routine's definition (name/schedule/objective) by rebuilding it, then
// re-publish + keep its current active/paused status.
export async function updateRoutine(ownerId: string, agentId: ObjectId, routineId: ObjectId, spec: RoutineSpec): Promise<Automation | null> {
  const existing = await getAutomation(ownerId, routineId)
  if (!existing || existing.agentId?.toString() !== agentId.toString()) return null
  if (!isValidRecurrence(spec.recurrence)) throw new RoutineError('invalid recurrence')
  const definition = buildRoutineDefinition(spec, agentId)
  await updateDraft(ownerId, routineId, { name: spec.name || describeRecurrence(spec.recurrence), description: spec.objective.slice(0, 2000), definition })
  await publishAutomation(ownerId, routineId, ownerId)
  return getAutomation(ownerId, routineId)
}

export async function listRoutines(ownerId: string, agentId: ObjectId): Promise<Automation[]> {
  const { items } = await repoListAutomations(ownerId, { agentId, limit: 100, skip: 0 })
  return items
}

// Guard that a routine belongs to the given agent before status/delete actions.
export async function getRoutineForAgent(ownerId: string, agentId: ObjectId, routineId: ObjectId): Promise<Automation | null> {
  const doc = await getAutomation(ownerId, routineId)
  return doc && doc.agentId?.toString() === agentId.toString() ? doc : null
}
