// One routine step executed by the worker, extracted so the real ordering rules are
// testable without Redis/BullMQ and without duplicating any rule:
//
//   1. the referenced sector is authorised INSIDE this run's account — before any
//      knowledge lookup, any tool resolution and any model call;
//   2. only then the curated context is retrieved and the model runs;
//   3. the charge and the telemetry are AWAITED (not fire-and-forget) with a bounded
//      retry, so a step is never confirmed while its accounting is still in the air —
//      and a persistence failure never turns into a second inference.
import { ObjectId } from 'mongodb'
import type { Agent } from '../agents.js'
import type { AgentExecutionRequest, AgentExecutionResult } from '../agentRuntime.js'
import type { ResolvedTool } from '../agentTools.js'
import type { AgentEventStatus, RecordAgentEventInput } from '../agentEvents.js'
import type { StepUsage } from './runner.js'

// A configuration problem (not a transient failure): the step must NOT be retried,
// because retrying cannot fix a sector that does not belong to this account. The
// message is uniform and never reveals whether the id exists elsewhere.
export class RoutineConfigurationError extends Error {
  readonly kind = 'validation'
  readonly retryable = false
  constructor(message = 'configuração inválida: setor indisponível para esta conta') {
    super(message)
    this.name = 'RoutineConfigurationError'
  }
}

export interface RoutineStepCall {
  agentId: string
  objective: string
  instructions: string
  input: unknown
  context: string[]
  format: 'text' | 'markdown' | 'json'
  stepId: string
  attempt: number
  sectorId?: string | null
}

export interface RoutineRunContext {
  ownerId: string
  runId: string
  buildingId: ObjectId
  floorId: ObjectId
}

export interface RoutineExecutionDeps {
  loadAgent: (ownerId: string, agentId: ObjectId) => Promise<Agent | null>
  // Owner-scoped: returns null both for a foreign and for a malformed id.
  resolveOwnedSectorId: (ownerId: string, raw: unknown) => Promise<ObjectId | null>
  retrieveContext: (agentId: ObjectId, query: string, opts: { verifiedSectorId: ObjectId | null }) => Promise<{ context: string[]; failed: boolean }>
  resolveTools: (agent: Agent, ownerId: string) => Promise<ResolvedTool[]>
  apiKeyFor: (ownerId: string, provider: string) => Promise<string | null>
  runTask: (req: AgentExecutionRequest) => Promise<AgentExecutionResult>
  // Owner accounting, idempotent per chargeKey.
  charge: (ownerId: string, usage: StepUsage, chargeKey: string) => Promise<boolean>
  chargeKeyFor: (runId: string, stepId: string, agentId: string, attempt: number) => string
  // Per-agent telemetry, idempotent per (eventKey, attempt).
  finalizeEvent: (input: RecordAgentEventInput) => Promise<void>
  eventKeyFor: (runId: string, stepId: string, agentId: string) => string
  isCanceled?: () => Promise<boolean>
  // Injected so tests don't wait real seconds.
  sleep?: (ms: number) => Promise<void>
}

const PERSIST_ATTEMPTS = 3
const PERSIST_BACKOFF_MS = 200

// Await a critical persistence with a bounded retry. NEVER rethrows: the model has
// already run, so failing here must not make the runner retry the step (that would
// pay for a second inference). The failure is reported to the caller instead.
async function persistWithRetry(what: string, fn: () => Promise<unknown>, sleep: (ms: number) => Promise<void>): Promise<boolean> {
  for (let attempt = 1; attempt <= PERSIST_ATTEMPTS; attempt++) {
    try {
      await fn()
      return true
    } catch (error) {
      if (attempt === PERSIST_ATTEMPTS) {
        console.error(`${what} failed after ${PERSIST_ATTEMPTS} attempts (step completed; NOT re-running the model):`, (error as Error).message)
        return false
      }
      await sleep(PERSIST_BACKOFF_MS * attempt)
    }
  }
  return false
}

export interface RoutineStepResult {
  output: string
  usage: StepUsage
  // false when the charge or the telemetry could not be written even after retries.
  // The step still succeeded — the caller decides how loudly to complain.
  persisted: boolean
}

export async function executeRoutineStep(call: RoutineStepCall, ctx: RoutineRunContext, deps: RoutineExecutionDeps): Promise<RoutineStepResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  const agent = await deps.loadAgent(ctx.ownerId, new ObjectId(call.agentId))
  if (!agent) throw new Error(`agente não encontrado: ${call.agentId}`)

  // (1) AUTHORISE FIRST. A stale version or a tampered document can carry any
  // sectorId; it is re-resolved in THIS run's account before anything is spent.
  let verifiedSectorId: ObjectId | null = null
  if (call.sectorId) {
    verifiedSectorId = await deps.resolveOwnedSectorId(ctx.ownerId, call.sectorId)
    if (!verifiedSectorId) throw new RoutineConfigurationError()
  }

  // (2) Grounding + model.
  const knowledgeQuery = [call.instructions, typeof call.input === 'string' ? call.input : ''].filter(Boolean).join('\n').slice(0, 2000)
  const retrieved = knowledgeQuery ? await deps.retrieveContext(agent._id, knowledgeQuery, { verifiedSectorId }) : { context: [], failed: false }
  const tools = await deps.resolveTools(agent, ctx.ownerId)
  const apiKey = await deps.apiKeyFor(ctx.ownerId, agent.provider)

  const startedAt = new Date()
  const eventKey = deps.eventKeyFor(ctx.runId, call.stepId, agent._id.toString())
  const baseEvent = {
    eventKey,
    ownerId: ctx.ownerId,
    agentId: agent._id,
    buildingId: ctx.buildingId,
    floorId: ctx.floorId,
    source: 'routine' as const,
    preset: agent.preset,
    startedAt,
    // Drives per-attempt idempotency: a redelivered write of the SAME attempt does
    // not inflate the accumulators; a real retry does.
    attemptCount: call.attempt,
    metadata: { runId: ctx.runId, stepId: call.stepId, attempt: call.attempt },
  }

  let result: AgentExecutionResult
  try {
    result = await deps.runTask({
      objective: String(agent.objective ?? call.objective ?? ''),
      instructions: call.instructions,
      input: call.input,
      // Step outputs + curated passages, both handled as untrusted data.
      context: [...call.context, ...retrieved.context],
      provider: agent.provider,
      model: agent.model,
      apiKey,
      tools,
      output: { format: call.format },
    })
  } catch (error) {
    const kind = (error as { kind?: string }).kind
    const canceled = deps.isCanceled ? await deps.isCanceled().catch(() => false) : false
    const status: AgentEventStatus = canceled ? 'canceled' : kind === 'timeout' ? 'timeout' : 'failed'
    // Awaited too: a failed attempt must be visible before the runner moves on.
    await persistWithRetry('finalizeAgentEvent', () => deps.finalizeEvent({ ...baseEvent, status, finishedAt: new Date() }), sleep)
    throw error
  }

  // (3) CRITICAL PERSISTENCE — awaited, idempotent, and never a reason to re-infer.
  const charged = await persistWithRetry(
    'recordReplyUsageOnce',
    () => deps.charge(ctx.ownerId, result.usage, deps.chargeKeyFor(ctx.runId, call.stepId, agent._id.toString(), call.attempt)),
    sleep,
  )
  const recorded = await persistWithRetry(
    'finalizeAgentEvent',
    () =>
      deps.finalizeEvent({
        ...baseEvent,
        status: 'succeeded' as AgentEventStatus,
        finishedAt: new Date(),
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        toolCalls: result.toolCalls.filter((c) => c.ok).length, // completed tool calls only
      }),
    sleep,
  )

  return { output: result.output, usage: result.usage, persisted: charged && recorded }
}
