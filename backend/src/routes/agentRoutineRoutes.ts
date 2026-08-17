import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { config } from '../config.js'
import { getAgentById } from '../agents.js'
import {
  createRoutine,
  getRoutineForAgent,
  listAgentAutomations,
  listRoutines,
  readSourceFromDefinition,
  RoutineError,
  STEP_SOURCE,
  updateRoutine,
} from '../automations/routine.js'
import type { RoutineSource, RoutineSpec } from '../automations/routine.js'
import { isInitialWindow } from '../automations/sourceChange.js'
import { isExecutionMode } from '../automations/types.js'
import type { ExecutionMode } from '../automations/types.js'
import { aiStepPlanned, normalizeMemoryPlan } from '../automations/executionPlan.js'
import type { MemoryPlan } from '../automations/executionPlan.js'
import type { StepCondition } from '../automations/conditions.js'
import { previewSource } from '../automations/sourcePreview.js'
import { getCheckpoint } from '../automations/sourceCheckpoint.js'
import { createRun } from '../automations/runService.js'
import {
  createEventTrigger,
  EventTriggerError,
  normalizeCondition,
  readEventTriggerConfig,
  getEventTriggerForAgent,
  listEventTriggers,
  updateEventTrigger,
} from '../automations/eventTrigger.js'
import { webhookEndpoint } from '../automations/executionCenter.js'
import { cronToRecurrence, describeRecurrence, isValidRecurrence } from '../automations/schedule.js'
import { rotateWebhookSecret, setStatus } from '../automations/service.js'
import { listRuns } from '../automations/runRepository.js'
import type { Automation } from '../automations/types.js'
import { listDelegationsForAgent } from '../delegationLog.js'
import { publicDelegationError, publicError } from '../safeError.js'
import { oid } from './http.js'
import { auditEntity } from './auditMiddleware.js'

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
  // A fonte de entrada. Rotina antiga não tem etapa de fonte e volta como `fixed`,
  // que é exatamente o que ela sempre foi.
  const source = readSourceFromDefinition(definition)
  return {
    id: a._id.toString(),
    source,
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
  // ABSENT vs null is a real distinction here: an absent `delivery` means "leave the
  // destination as it is" (the editor could not load the connections, so it must not
  // silently drop one), while an explicit null means the user chose "Nenhum".
  const d = body.delivery as { provider?: unknown; connectionId?: unknown } | null | undefined
  const provider = d?.provider
  const delivery = !('delivery' in body)
    ? undefined
    : d && (provider === 'email' || provider === 'telegram') && typeof d.connectionId === 'string' && d.connectionId
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
      // Ausente = mantém a fonte atual (mesma regra da entrega: um formulário salvo
      // antes de carregar não pode apagar o monitoramento).
      ...('source' in body ? { source: parseSource(body.source) } : {}),
    },
  }
}

// A fonte vinda do corpo da requisição. Uma URL que não seja http/https é recusada
// aqui, antes de virar definição — e o safeFetch recusa de novo na hora de buscar.
// As duas checagens existem de propósito: esta dá erro de formulário, aquela impede
// a requisição.
function parseSource(raw: unknown): RoutineSource {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const kind = s.kind
  if (kind !== 'rss' && kind !== 'http') return { kind: 'fixed' }
  const url = typeof s.url === 'string' ? s.url.trim() : ''
  const focus = typeof s.focus === 'string' ? s.focus : undefined
  if (kind === 'rss') {
    return { kind: 'rss', url, initialWindow: isInitialWindow(s.initialWindow) ? s.initialWindow : '24h', ...(focus ? { focus } : {}) }
  }
  return { kind: 'http', url, ...(focus ? { focus } : {}) }
}

/**
 * Modo, destino de memória e condição, vindos do corpo da requisição.
 *
 * Ausentes = o comportamento de sempre: modo `ai`, sem memória, sem condição. É isto
 * que faz um cliente antigo — ou um `PATCH` que só muda o nome — continuar
 * funcionando exatamente como antes.
 */
function parseTriggerExtras(body: Record<string, unknown>): {
  executionMode?: ExecutionMode
  memory?: MemoryPlan
  aiCondition?: StepCondition | null
} {
  return {
    ...(isExecutionMode(body.executionMode) ? { executionMode: body.executionMode } : {}),
    ...('memory' in body ? { memory: normalizeMemoryPlan(body.memory) } : {}),
    ...('aiCondition' in body ? { aiCondition: normalizeCondition(body.aiCondition) } : {}),
  }
}

// http(s) e nada mais. `file:`, `gopher:` e afins nem chegam ao safeFetch.
function urlAceitavel(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// Mensagem de formulário para uma fonte mal preenchida, ou null se estiver ok.
function fonteComUrlInvalida(spec: RoutineSpec): string | null {
  const fonte = spec.source
  if (!fonte || fonte.kind === 'fixed') return null
  if (!fonte.url) return 'a URL da fonte é obrigatória'
  if (!urlAceitavel(fonte.url)) return 'a URL precisa começar com http:// ou https://'
  return null
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

  // O estado do monitoramento vem do checkpoint e do último run, e só para as
  // rotinas que de fato monitoram algo. Uma rotina de entrada fixa não paga essa
  // consulta e não ganha campos que não fazem sentido para ela.
  const enriquecidas = await Promise.all(
    routines.map(async (r) => {
      const base = serializeRoutine(r)
      if (base.source.kind === 'fixed') return base

      const [checkpoint, ultimos] = await Promise.all([
        getCheckpoint(res.locals.userId, r._id, STEP_SOURCE),
        listRuns(res.locals.userId, { automationIds: [r._id], limit: 1, skip: 0 }),
      ])
      const ultimo = ultimos.items[0]
      return {
        ...base,
        monitoring: {
          lastCheckedAt: checkpoint?.lastCheckedAt ?? null,
          lastChangedAt: checkpoint?.lastChangedAt ?? null,
          // O desfecho da última verificação, em três estados que o usuário
          // entende: encontrou algo, verificou e não havia nada, ou falhou.
          // `noChange` é o campo anterior; ler os dois mantém os runs já gravados
          // aparecendo certo na lista.
          lastResult: !ultimo
            ? null
            : ultimo.status === 'failed'
              ? 'failed'
              : (ultimo.sourceOutcome ?? (ultimo.noChange ? 'no_change' : 'changed')),
          lastRunAt: ultimo?.finishedAt ?? ultimo?.startedAt ?? null,
          lastError: publicError(ultimo?.error ?? null),
        },
      }
    }),
  )
  res.json(enriquecidas)
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
  // Só o que dá para julgar pelo corpo da requisição. A regra de frequência depende
  // da fonte EFETIVA — que num PATCH pode vir da rotina salva — e por isso mora em
  // `createRoutine`/`updateRoutine`, que a resolvem antes de decidir.
  const urlInvalida = fonteComUrlInvalida(spec!)
  if (urlInvalida) {
    res.status(400).json({ error: urlInvalida })
    return
  }
  try {
    const routine = await createRoutine(res.locals.userId, agentId, spec!)
    auditEntity(res, { id: routine._id.toString(), label: routine.name, floorId: routine.floorId.toString() })
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
  // Só o que dá para julgar pelo corpo da requisição. A regra de frequência depende
  // da fonte EFETIVA — que num PATCH pode vir da rotina salva — e por isso mora em
  // `createRoutine`/`updateRoutine`, que a resolvem antes de decidir.
  const urlInvalida = fonteComUrlInvalida(spec!)
  if (urlInvalida) {
    res.status(400).json({ error: urlInvalida })
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

// Testar a fonte: consulta a URL e mostra o que ela devolve. NENHUMA LLM é
// chamada, nenhum token é gasto e nenhum checkpoint é tocado — o usuário está
// conferindo se o endereço funciona, não pedindo uma execução.
agentRoutineRouter.post('/routines/test-source', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  if (!agentId) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const kind = body.kind === 'rss' || body.kind === 'http' ? body.kind : null
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!kind) {
    res.status(400).json({ error: 'informe se a fonte é rss ou http' })
    return
  }
  if (!url || !urlAceitavel(url)) {
    res.status(400).json({ ok: false, kind, message: 'A URL precisa começar com http:// ou https://.' })
    return
  }
  const preview = await previewSource(kind, url, {
    initialWindow: isInitialWindow(body.initialWindow) ? body.initialWindow : undefined,
  })
  res.json(preview)
})

// "Verificar agora": enfileira uma execução da rotina fora do horário dela. É a
// MESMA execução que o agendador dispararia — inclusive o checkpoint —, então se
// não houver novidade ela termina como sucesso sem alteração. É diferente de
// "testar fonte", que não executa nada.
agentRoutineRouter.post('/routines/:routineId/check-now', async (req, res) => {
  const agentId = await requireAgent(res.locals.userId, String((req.params as Record<string, string>).agentId))
  const routineId = oid(String((req.params as Record<string, string>).routineId))
  if (!agentId || !routineId) {
    res.status(404).json({ error: 'not found' })
    return
  }
  const owned = await getRoutineForAgent(res.locals.userId, agentId, routineId)
  if (!owned) {
    res.status(404).json({ error: 'routine not found' })
    return
  }
  const { run, created } = await createRun(res.locals.userId, routineId, {
    triggerType: 'manual',
    requestId: typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined,
  })
  auditEntity(res, { id: owned._id.toString(), label: owned.name, floorId: owned.floorId.toString() })
  res.status(created ? 201 : 200).json({ runId: run._id.toString(), status: run.status })
})

// Activate / pause / archive a routine. archive is also the "delete" (soft).
//
// Fica DEPOIS de `test-source` e `check-now` de propósito: `:action` é um pega-tudo
// e engoliria os dois, entregando "check-now" como se fosse um verbo de status.
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
  // Modo, destino da memória e condição vêm da definição — não há cópia da spec em
  // lugar nenhum, e é por isso que a interface reabre o gatilho do jeito que ele foi
  // salvo.
  const cfg = readEventTriggerConfig(a.draftDefinition)
  return {
    executionMode: cfg.executionMode,
    memory: cfg.memory,
    aiCondition: cfg.aiCondition,
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
  const extras = parseTriggerExtras(body)
  // Sem etapa de IA não há a quem instruir: exigir objetivo obrigaria a escrever um
  // texto que ninguém vai ler.
  if (!objective && aiStepPlanned(extras.executionMode ?? 'ai', extras.aiCondition ?? null)) {
    res.status(400).json({ error: 'objective is required' })
    return
  }
  try {
    const { trigger, secret } = await createEventTrigger(res.locals.userId, agentId, {
      name: typeof body.name === 'string' ? body.name : '',
      objective,
      ...extras,
    })
    auditEntity(res, { id: trigger._id.toString(), label: trigger.name, floorId: trigger.floorId.toString() })
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
  const extras = parseTriggerExtras(body)
  if (!objective && aiStepPlanned(extras.executionMode ?? 'ai', extras.aiCondition ?? null)) {
    res.status(400).json({ error: 'objective is required' })
    return
  }
  try {
    const updated = await updateEventTrigger(res.locals.userId, agentId, triggerId, {
      name: typeof body.name === 'string' ? body.name : '',
      objective,
      ...extras,
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
      // Categorised: an engine message can quote the very input that failed.
      error: publicError(run.error),
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
      // Kept: the agent's own history offers it for "salvar no conhecimento". It is
      // the one place it appears — the Central de logs never carries it.
      outputPreview: d.outputPreview,
      // The stored message is a target agent's raw failure; what leaves is the
      // reason, derived from the status and the deny code the gate chose.
      error: publicDelegationError(d.status, d.denyCode),
      createdAt: d.createdAt,
      finishedAt: d.finishedAt,
    })),
  })
})
