import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { config } from '../config.js'
import { getAgentById } from '../agents.js'
import { createRoutine, getRoutineForAgent, listAgentAutomations, listRoutines, RoutineError, updateRoutine } from '../automations/routine.js'
import type { RoutineSpec } from '../automations/routine.js'
import {
  createEventTrigger,
  EventTriggerError,
  getEventTriggerForAgent,
  listEventTriggers,
  updateEventTrigger,
} from '../automations/eventTrigger.js'
import { webhookEndpoint } from '../automations/executionCenter.js'
import { cronToRecurrence, describeRecurrence, isValidRecurrence } from '../automations/schedule.js'
import { rotateWebhookSecret, setStatus } from '../automations/service.js'
import { listRuns } from '../automations/runRepository.js'
import { preview } from '../automations/runTypes.js'
import type { Automation } from '../automations/types.js'
import { listDelegationsForAgent } from '../delegationLog.js'
import { oid } from './http.js'

// Agent ROUTINES + HISTORY. Mounted at /api/agents/:agentId behind requireAuth
// (mergeParams so :agentId is visible). A routine is an agent-owned scheduled
// automation; the history is the runs of that agent's routines. The standalone
// "Automações" surface is gone — everything here lives inside the agent.
export const agentRoutineRouter = Router({ mergeParams: true })

function serializeRoutine(a: Automation) {
  // WHEN it fires is read from the published trigger — the draft is only a fallback
  // for a routine created before that field existed. The rest of the shape comes
  // from the draft, which a routine keeps identical to its published version:
  // createRoutine and updateRoutine always publish immediately.
  const trigger = a.publishedTrigger ?? a.draftDefinition.trigger
  const cron = trigger?.type === 'schedule' ? trigger.cron : ''
  const timezone = trigger?.type === 'schedule' ? trigger.timezone : ''
  const recurrence = cron ? cronToRecurrence(cron) : null
  const definition = a.draftDefinition
  const agentStep = (definition?.steps ?? []).find((s) => s.type === 'agent.execute')
  const config = (agentStep?.config ?? {}) as { input?: unknown; instruction?: unknown; objective?: unknown }
  // Routines written before `input` was stored on its own carry it inside the
  // composed instruction; recover it so the editor never loses what the user typed.
  const legacyInput = typeof config.instruction === 'string' ? config.instruction.split('\n\nEntrada: ')[1] : undefined
  const delivery = (definition?.deliveries ?? [])[0]
  return {
    id: a._id.toString(),
    name: a.name,
    objective: a.description,
    status: a.status,
    timezone,
    cron,
    recurrence,
    scheduleLabel: recurrence ? describeRecurrence(recurrence) : cron,
    // Everything the edit form needs to open already filled in.
    input: typeof config.input === 'string' ? config.input : (legacyInput ?? ''),
    outputFormat: definition?.resultFormat ?? 'markdown',
    delivery: delivery ? { provider: delivery.provider, connectionId: delivery.connectionId.toString() } : null,
    lastPublishedVersion: a.lastPublishedVersion,
    nextRunAt: a.nextRunAt ?? null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

function parseRoutineSpec(body: Record<string, unknown>): { spec?: RoutineSpec; error?: string } {
  const objective = typeof body.objective === 'string' ? body.objective.trim() : ''
  if (!objective) return { error: 'objective is required' }
  if (!isValidRecurrence(body.recurrence)) return { error: 'invalid recurrence' }
  const d = body.delivery as { provider?: unknown; connectionId?: unknown } | null | undefined
  const provider = d?.provider
  const delivery =
    d && (provider === 'email' || provider === 'telegram') && typeof d.connectionId === 'string' && d.connectionId
      ? { provider: provider as 'email' | 'telegram', connectionId: d.connectionId }
      : null
  const fmt = body.outputFormat
  return {
    spec: {
      name: typeof body.name === 'string' ? body.name.trim() : '',
      objective,
      recurrence: body.recurrence as RoutineSpec['recurrence'],
      timezone: typeof body.timezone === 'string' && body.timezone ? body.timezone : 'America/Sao_Paulo',
      input: typeof body.input === 'string' ? body.input : undefined,
      outputFormat: fmt === 'text' || fmt === 'markdown' || fmt === 'json' ? fmt : undefined,
      delivery,
      retryMaxAttempts: typeof body.retryMaxAttempts === 'number' ? body.retryMaxAttempts : undefined,
    },
  }
}

async function requireAgent(ownerId: string, raw: string): Promise<ObjectId | null> {
  const id = oid(raw)
  if (!id) return null
  const agent = await getAgentById(ownerId, id)
  return agent ? id : null
}

agentRoutineRouter.get('/routines', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const routines = await listRoutines(res.locals.userId, agentId)
  res.json(routines.map(serializeRoutine))
})

agentRoutineRouter.post('/routines', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const { spec, error } = parseRoutineSpec(req.body ?? {})
  if (error) {
    res.status(400).json({ error })
    return
  }
  try {
    const routine = await createRoutine(res.locals.userId, agentId, spec!)
    res.status(201).json(serializeRoutine(routine))
  } catch (e) {
    res.status(e instanceof RoutineError ? 400 : 500).json({ error: e instanceof Error ? e.message : 'failed' })
  }
})

agentRoutineRouter.patch('/routines/:routineId', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  const routineId = oid(String((req.params as Record<string, string>).routineId))
  if (!agentId || !routineId) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const { spec, error } = parseRoutineSpec(req.body ?? {})
  if (error) {
    res.status(400).json({ error })
    return
  }
  try {
    const routine = await updateRoutine(res.locals.userId, agentId, routineId, spec!)
    if (!routine) {
      res.status(404).json({ error: 'routine not found' })
      return
    }
    res.json(serializeRoutine(routine))
  } catch (e) {
    res.status(e instanceof RoutineError ? 400 : 500).json({ error: e instanceof Error ? e.message : 'failed' })
  }
})

// Activate / pause / archive a routine. archive is also the "delete" (soft).
agentRoutineRouter.post('/routines/:routineId/:action', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  const routineId = oid(String((req.params as Record<string, string>).routineId))
  const action = String((req.params as Record<string, string>).action)
  const status = action === 'activate' ? 'active' : action === 'pause' ? 'paused' : action === 'archive' ? 'archived' : null
  if (!agentId || !routineId || !status) {
    res.status(400).json({ error: 'invalid request' })
    return
  }
  const owned = await getRoutineForAgent(res.locals.userId, agentId, routineId)
  if (!owned) {
    res.status(404).json({ error: 'routine not found' })
    return
  }
  const updated = await setStatus(res.locals.userId, routineId, status)
  if (!updated) {
    res.status(409).json({ error: 'could not change status' })
    return
  }
  res.json(serializeRoutine(updated))
})

// --- Event triggers (webhooks that belong to THIS agent) ------------------------
// Agent-native on purpose: the user creates "um gatilho por evento", not an
// automation with a webhook trigger and an agent.execute step. The secret is never
// part of this shape — it is returned once, by create and by rotate, and nowhere else.
function serializeTrigger(a: Automation) {
  const trigger = (a.publishedTrigger ?? a.trigger) as { type?: string; requireSignature?: boolean }
  return {
    id: a._id.toString(),
    name: a.name,
    objective: a.description,
    status: a.status,
    endpoint: a.webhookPublicKey ? webhookEndpoint(config.publicUrl, a.webhookPublicKey) : null,
    requireSignature: trigger?.requireSignature !== false,
    hasSecret: Boolean(a.webhookSecretEncrypted),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

agentRoutineRouter.get('/event-triggers', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const triggers = await listEventTriggers(res.locals.userId, agentId)
  res.json(triggers.map(serializeTrigger))
})

agentRoutineRouter.post('/event-triggers', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const objective = typeof body.objective === 'string' ? body.objective.trim() : ''
  if (!objective) {
    res.status(400).json({ error: 'objective is required' })
    return
  }
  try {
    const { trigger, secret } = await createEventTrigger(res.locals.userId, agentId, {
      name: typeof body.name === 'string' ? body.name : '',
      objective,
    })
    // The ONLY moment the plaintext secret exists outside the database.
    res.status(201).json({ ...serializeTrigger(trigger), secret })
  } catch (e) {
    res.status(e instanceof EventTriggerError ? 400 : 500).json({ error: e instanceof Error ? e.message : 'failed' })
  }
})

agentRoutineRouter.patch('/event-triggers/:triggerId', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  const triggerId = oid(String((req.params as Record<string, string>).triggerId))
  if (!agentId || !triggerId) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const objective = typeof body.objective === 'string' ? body.objective.trim() : ''
  if (!objective) {
    res.status(400).json({ error: 'objective is required' })
    return
  }
  try {
    const updated = await updateEventTrigger(res.locals.userId, agentId, triggerId, {
      name: typeof body.name === 'string' ? body.name : '',
      objective,
    })
    if (!updated) {
      res.status(404).json({ error: 'trigger not found' })
      return
    }
    res.json(serializeTrigger(updated))
  } catch (e) {
    res.status(e instanceof EventTriggerError ? 400 : 500).json({ error: e instanceof Error ? e.message : 'failed' })
  }
})

// A new credential, shown once. The old one stops working immediately — which is
// the whole point of a rotation.
agentRoutineRouter.post('/event-triggers/:triggerId/rotate', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  const triggerId = oid(String((req.params as Record<string, string>).triggerId))
  if (!agentId || !triggerId) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const owned = await getEventTriggerForAgent(res.locals.userId, agentId, triggerId)
  if (!owned) {
    res.status(404).json({ error: 'trigger not found' })
    return
  }
  const rotated = await rotateWebhookSecret(res.locals.userId, triggerId)
  if (!rotated) {
    res.status(409).json({ error: 'could not rotate' })
    return
  }
  const fresh = await getEventTriggerForAgent(res.locals.userId, agentId, triggerId)
  res.json({ ...serializeTrigger(fresh ?? owned), secret: rotated.secret })
})

agentRoutineRouter.post('/event-triggers/:triggerId/:action', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  const triggerId = oid(String((req.params as Record<string, string>).triggerId))
  const action = String((req.params as Record<string, string>).action)
  const status = action === 'activate' ? 'active' : action === 'pause' ? 'paused' : action === 'archive' ? 'archived' : null
  if (!agentId || !triggerId || !status) {
    res.status(400).json({ error: 'invalid request' })
    return
  }
  const owned = await getEventTriggerForAgent(res.locals.userId, agentId, triggerId)
  if (!owned) {
    res.status(404).json({ error: 'trigger not found' })
    return
  }
  const updated = await setStatus(res.locals.userId, triggerId, status)
  if (!updated) {
    res.status(409).json({ error: 'could not change status' })
    return
  }
  res.json(serializeTrigger(updated))
})

// Run history for the agent: the runs of all its routines, newest first.
agentRoutineRouter.get('/history', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  // The agent's WHOLE automatic history: scheduled routines and event triggers alike.
  const owned = await listAgentAutomations(res.locals.userId, agentId)
  const ids = owned.map((r) => r._id)
  const limit = Math.min(Number(req.query.limit) || 25, 100)
  const nameById = new Map(owned.map((r) => [r._id.toString(), r.name]))
  // Two strands of history: scheduled routine runs, and delegations this agent took
  // part in (as caller OR as target — so a delegated task shows on both agents).
  const [runsResult, delegations] = await Promise.all([
    ids.length ? listRuns(res.locals.userId, { automationIds: ids, limit, skip: 0 }) : Promise.resolve({ items: [], total: 0 }),
    listDelegationsForAgent(res.locals.userId, agentId, limit),
  ])
  res.json({
    total: runsResult.total,
    items: runsResult.items.map((run) => ({
      id: run._id.toString(),
      routineId: run.automationId.toString(),
      routineName: nameById.get(run.automationId.toString()) ?? 'Rotina',
      status: run.status,
      triggerType: run.triggerType,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      error: run.error ? preview(run.error) : null,
    })),
    delegations: delegations.map((d) => ({
      id: d._id.toString(),
      direction: d.callerAgentId.equals(agentId) ? 'outgoing' : 'incoming',
      targetType: d.targetType,
      targetAgentId: d.targetAgentId?.toString() ?? null,
      targetSectorId: d.targetSectorId?.toString() ?? null,
      objective: d.objective,
      status: d.status,
      denyCode: d.denyCode,
      outputPreview: d.outputPreview,
      error: d.error,
      createdAt: d.createdAt,
      finishedAt: d.finishedAt,
    })),
  })
})
