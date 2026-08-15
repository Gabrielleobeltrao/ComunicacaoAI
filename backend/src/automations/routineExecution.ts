// One routine step executed by the worker, extracted so the real ordering rules are
// testable without Redis/BullMQ and without duplicating any rule:
//
//   1. the referenced sector is authorised INSIDE this run's account — before any
//      knowledge lookup, any tool resolution and any model call;
//   2. only then the curated context is retrieved and the model runs;
//   3. the charge and the telemetry are persisted with a bounded retry and handed
//      back as `settle`, which the RUNNER awaits OUTSIDE the step timeout. That is
//      what guarantees a slow database can never be mistaken for a slow inference:
//      the step is still not confirmed before its accounting finishes, but a
//      persistence delay/failure can never trigger a second model call.
import { ObjectId } from 'mongodb'
import type { Agent } from '../agents.js'
import type { AgentExecutionRequest, AgentExecutionResult } from '../agentRuntime.js'
import type { ResolvedTool } from '../agentTools.js'
import type { AgentEventStatus, RecordAgentEventInput } from '../agentEvents.js'
import type { StepUsage } from './runner.js'
import { buildRetrievalQuery } from '../retrievalQuery.js'

// The knowledge the step requires could not be consulted (the embedding or the
// vector search failed), and this agent is configured to refuse rather than answer
// ungrounded. Retryable: the base may well answer on the next attempt.
export class KnowledgeUnavailableError extends Error {
  readonly kind = 'knowledge_unavailable'
  readonly retryable = true
  constructor(message = 'a base de conhecimento não pôde ser consultada') {
    super(message)
    this.name = 'KnowledgeUnavailableError'
  }
}

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
  retrieveContext: (
    agentId: ObjectId,
    query: string,
    opts: { verifiedSectorId: ObjectId | null },
  ) => Promise<{ context: string[]; failed: boolean; status?: string; sources?: unknown[] }>
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
  // Resolves when the charge + telemetry finished their attempts; false when they
  // could not be written even after retries. NEVER rejects — the model already ran,
  // so this must not look like a step failure. Awaited by the runner outside the
  // step timeout.
  settle: Promise<boolean>
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

  // (2) Grounding + model. The question includes the objective, the instructions AND
  // the input — serialized when it is an object, which used to retrieve nothing.
  const knowledgeQuery = buildRetrievalQuery({ objective: agent.objective ?? call.objective, instructions: call.instructions, input: call.input })
  const retrieved = knowledgeQuery ? await deps.retrieveContext(agent._id, knowledgeQuery, { verifiedSectorId }) : { context: [], failed: false, status: 'no_base' }
  const grounding = (retrieved.status as string | undefined) ?? (retrieved.failed ? 'unavailable' : retrieved.context.length ? 'ok' : 'empty')
  // An agent told to answer only from curated knowledge does NOT answer when the base
  // could not be consulted. Nothing is invented, and nothing is spent.
  if (agent.requireGrounding && grounding !== 'ok') {
    throw new KnowledgeUnavailableError(
      grounding === 'unavailable' ? 'a base de conhecimento não pôde ser consultada' : 'nenhum trecho relevante foi encontrado na base',
    )
  }
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
    // Safe scalars only: counts and statuses, never a prompt, a passage or an output.
    metadata: {
      runId: ctx.runId,
      stepId: call.stepId,
      attempt: call.attempt,
      grounding,
      ragChunks: retrieved.context.length,
      toolsAvailable: 0,
    },
  }

  // The routine's own choice, then the agent's default, then text.
  const outputFormat = call.format ?? agent.defaultOutputFormat ?? 'text'
  baseEvent.metadata.toolsAvailable = tools.length

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
      // What the agent promised to receive and produce reaches the model now.
      contracts: { input: agent.inputContract, output: agent.outputContract },
      // The step's own format wins; the agent's default is the fallback for a step
      // that never expressed one. The schema only applies to JSON.
      output: { format: outputFormat, jsonSchema: outputFormat === 'json' ? (agent.outputJsonSchema ?? null) : null },
    })
  } catch (error) {
    const kind = (error as { kind?: string }).kind
    const canceled = deps.isCanceled ? await deps.isCanceled().catch(() => false) : false
    const status: AgentEventStatus = canceled ? 'canceled' : kind === 'timeout' ? 'timeout' : 'failed'
    // Awaited too: a failed attempt must be visible before the runner moves on.
    await persistWithRetry('finalizeAgentEvent', () => deps.finalizeEvent({ ...baseEvent, status, finishedAt: new Date() }), sleep)
    throw error
  }

  // (3) CRITICAL PERSISTENCE — started here, awaited by the runner OUTSIDE the step
  // timeout. Idempotent (charge per attempt, telemetry per attempt) and it never
  // rejects, so a slow or failing database is never read as a failed inference.
  const settle = (async () => {
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
          metadata: {
            ...baseEvent.metadata,
            // The shape that was asked for and whether it had to be corrected —
            // never the answer itself.
            outputFormat,
            outputRepaired: result.format?.repaired === true,
          },
        }),
      sleep,
    )
    return charged && recorded
  })()

  return { output: result.output, usage: result.usage, settle }
}
