// Internal delegation: an agent (usually a manager) discovers collaborators by
// competency and hands work to another agent or a sector. This is the REAL executor
// — a delegate tool actually runs the target agent through the same task runtime —
// gated by owner + building + explicit authorization, a depth limit, cycle
// detection, a shared token budget and cooperative cancellation. Every call is
// logged so it appears in both agents' history.
//
// Pure + dependency-injected: no DB/provider imports here, so the safety logic is
// unit-tested without IO. Production wiring lives in ./delegationWiring.ts.
import { ObjectId } from 'mongodb'
import { breadthNotice, buildRetrievalQuery, formatContextWithSources } from './retrievalQuery.js'
import { describeErrors, validateAgainstSchema } from './jsonSchema.js'
import type { Agent } from './agents.js'
import type { ResolvedTool } from './agentTools.js'
import { checkCollaboration } from './collaborationGate.js'
import type { GateContext, GateTarget } from './collaborationGate.js'
import type { FloorCommunicationConfig } from './floorCommunication.js'
import type { AgentExecutionRequest, AgentExecutionResult, AgentOutputFormat } from './agentRuntime.js'
import { presetSpec, suggestPresetForCapability } from './agentPresets.js'
import { resolveAgentRun } from './agentDefinition.js'
// O papel que um agente cumpre numa execução de setor. O tipo vive com a raiz da
// execução, que é quem grava a participação.
import type { ParticipationRole } from './sectorExecutions.js'
import { clarificationFrom } from './clarify.js'
import type { ClarificationRequest } from './clarify.js'

export const DELEGATION_MAX_DEPTH = 4
export const DEFAULT_DELEGATION_TOKEN_BUDGET = 300_000

export interface DelegationBudget {
  tokenLimit: number
  tokensSpent: number // mutated in place; the SAME object is shared across the whole tree
}

export interface DelegationContext {
  ownerId: string
  buildingId: string // caller's REAL building id (resolved from its floor); targets must share it
  correlationId: string
  callerAgentId: string // the agent that owns the delegate tools in this context
  callerAgentName: string
  ancestry: string[] // agentIds already in the call chain, excluding callerAgentId
  depth: number // 0 at the top
  budget: DelegationBudget
  isCanceled?: () => boolean | Promise<boolean>
  // Telemetry lineage: the event of the execution that is delegating right now, and
  // the top of the chain. A KPI like "delegações concluídas" counts ROOT events only,
  // so a chain is never summed twice.
  currentEventKey?: string | null
  rootEventKey?: string | null
  // The REQUEST this whole chain belongs to (executionRoots.ts). Every participation
  // it produces points at the same one, so the building counts the request once
  // however many agents and sectors it crossed.
  rootExecutionId?: ObjectId | null
  // SECTOR CONTEXT GRANT. While a coordinator runs a sector, it may call THAT
  // sector's members without the user having to repeat the relationship on each
  // agent's policies. It is deliberately narrow: one sector, one explicit member
  // list, one level deep (childContext drops it), and every other guard —
  // owner, building, depth, cycle, budget — still applies.
  sectorGrant?: { sectorId: string; memberIds: string[] } | null
}

export type DelegationDenyCode = 'forbidden' | 'unauthorized' | 'depth_exceeded' | 'cycle' | 'budget_exceeded' | 'canceled'
export type DelegationCheck = { ok: true } | { ok: false; code: DelegationDenyCode; reason: string }

// True when `policy`/`list` authorize acting on `id`. none → never; all → always;
// selected → only when the id is in the explicit list.
// `sameFloor` is only meaningful for the 'floor' policy; the caller resolves it,
// so this stays pure and synchronous.
function policyAllows(policy: Agent['delegationPolicy'], list: string[], id: string, sameFloor = false): boolean {
  if (policy === 'all') return true
  if (policy === 'selected') return (list ?? []).includes(id)
  if (policy === 'floor') return sameFloor
  return false // 'none'
}

// Pure safety gate for caller→target. No IO — `targetBuildingId` is resolved by the
// caller so this stays synchronous and unit-testable. Default-deny is impossible to
// bypass: wrong owner/building, over-depth, a cycle, an exhausted budget, or a side
// whose policy doesn't authorize the pairing all fail here before anything runs.
// Cross-FLOOR delegation within the SAME building is allowed; another building or
// owner is refused.
// The facts the pure gate needs about a target, gathered by whoever has the database.
// Kept here so every caller builds them the same way.
export function gateTargetForAgent(target: Agent, targetBuildingId: string, protectedBy?: { sectorId: string; sectorName: string } | null): GateTarget {
  return {
    kind: 'agent',
    id: target._id.toString(),
    ownerId: target.ownerId,
    buildingId: targetBuildingId,
    floorId: target.officeId ? target.officeId.toString() : null,
    callerPolicy: target.callerPolicy,
    allowedCallerAgentIds: target.allowedCallerAgentIds ?? [],
    protectedBy: protectedBy ?? null,
  }
}

export const gateContext = (ctx: DelegationContext, canceled = false): GateContext => ({
  buildingId: ctx.buildingId,
  callerAgentId: ctx.callerAgentId,
  ancestry: ctx.ancestry,
  depth: ctx.depth,
  maxDepth: DELEGATION_MAX_DEPTH,
  budget: ctx.budget,
  canceled,
  sectorGrant: ctx.sectorGrant ?? null,
})

// Everything talks to floors unless the building says otherwise. Callers that know
// the real configuration pass it in; the ones that cannot (pure unit tests) keep the
// previous behaviour, where crossing floors inside one building was always allowed.
const OPEN_COMMUNICATION: FloorCommunicationConfig = { mode: 'all', links: [] }

// DEPRECATED shape, kept so existing callers and tests keep working: it is now a thin
// wrapper over the SINGLE gate. Two implementations of "who may call whom" is exactly
// how discovery starts offering targets the runtime then refuses.
export function checkDelegation(
  caller: Agent,
  target: Agent,
  targetBuildingId: string,
  ctx: DelegationContext,
  extra: { communication?: FloorCommunicationConfig; protectedBy?: { sectorId: string; sectorName: string } | null } = {},
): DelegationCheck {
  const decision = checkCollaboration(
    caller,
    gateTargetForAgent(target, targetBuildingId, extra.protectedBy),
    extra.communication ?? OPEN_COMMUNICATION,
    gateContext(ctx),
  )
  if (decision.ok) return { ok: true }
  // The gate has two codes the older contract did not: they map onto `forbidden`
  // and `unauthorized`, which is what the callers already understand.
  const code: DelegationDenyCode =
    decision.code === 'cross_floor_blocked' || decision.code === 'floor_link_required'
      ? 'forbidden'
      : decision.code === 'sector_entry_required'
        ? 'unauthorized'
        : decision.code
  return { ok: false, code, reason: decision.reason }
}

// The context the target runs under: it becomes the new caller, inherits the chain
// (now including the previous caller) and the SAME budget object, one level deeper.
export function childContext(ctx: DelegationContext, target: Agent): DelegationContext {
  return {
    ...ctx,
    callerAgentId: target._id.toString(),
    callerAgentName: target.name,
    ancestry: [...ctx.ancestry, ctx.callerAgentId],
    depth: ctx.depth + 1,
    // A sector grant belongs to the coordinator's own turn — a member called by it
    // does not inherit the right to call the rest of the team.
    sectorGrant: null,
  }
}

export function rootContext(opts: {
  ownerId: string
  buildingId: string
  correlationId: string
  agent: Agent
  tokenLimit?: number
  isCanceled?: () => boolean | Promise<boolean>
  // The request this chain belongs to. Every participation it produces points at it.
  rootExecutionId?: ObjectId | null
}): DelegationContext {
  return {
    ownerId: opts.ownerId,
    buildingId: opts.buildingId,
    correlationId: opts.correlationId,
    callerAgentId: opts.agent._id.toString(),
    callerAgentName: opts.agent.name,
    ancestry: [],
    depth: 0,
    budget: { tokenLimit: opts.tokenLimit ?? DEFAULT_DELEGATION_TOKEN_BUDGET, tokensSpent: 0 },
    isCanceled: opts.isCanceled,
    rootExecutionId: opts.rootExecutionId ?? null,
  }
}

export interface SectorStageLite {
  id: string
  name: string
  agentId: ObjectId
  instruction: string
  dependsOn: string[]
  expectedOutput: string
  onError: 'stop' | 'continue'
  retryPolicy: { maxAttempts: number; backoffMs: number }
}

export interface SectorLite {
  _id: ObjectId
  name: string
  officeId: ObjectId
  mode: 'organization' | 'orchestrated' | 'pipeline'
  coordinatorAgentId?: ObjectId | null
  instruction?: string
  members: { agentId: ObjectId; isDefault?: boolean }[]
  stages?: SectorStageLite[]
}

// Injected IO. Production wiring in ./delegationWiring.ts binds these to the real
// agent store, tool resolver, task runtime, provider keys and delegation log.
export interface DelegationDeps {
  // The building's floor-communication configuration, owner-scoped. Optional so this
  // module stays testable with no database — absent means the previous behaviour,
  // where crossing floors inside one building was always allowed.
  loadCommunication?: (ownerId: string) => Promise<FloorCommunicationConfig>
  // A direct call to an agent must be refused when that agent is protected by a
  // sector's entry policy. Optional so this module stays testable with no database.
  sectorEntryFor?: (
    ownerId: string,
    targetAgentId: string,
  ) => Promise<{ blocked: true; sectorId: string; sectorName: string; reason: string } | { blocked: false }>
  // Sector execution root: ONE identity for the whole sector run, so the sector's
  // numbers are not the sum of its members'. Optional — this module stays testable
  // with no database attached.
  startSectorExecution?: (input: {
    executionKey: string
    ownerId: string
    sectorId: ObjectId
    sectorName: string
    sectorMode: string
    floorId: ObjectId | null
    source: 'delegation'
    correlationId: string | null
    callerAgentId: ObjectId | null
  }) => Promise<ObjectId>
  finishSectorExecution?: (executionKey: string, outcome: { status: 'succeeded' | 'failed' | 'canceled'; errorKind?: string | null }) => Promise<void>
  // Live map: a delegation leaving is a real transition of the CALLER. Optional so
  // this module stays testable with no database attached.
  reportState?: (input: { ownerId: string; agentId: ObjectId; floorId: ObjectId | null; rootExecutionId: string; state: string; detail?: unknown }) => void
  loadAgent: (ownerId: string, id: ObjectId) => Promise<Agent | null>
  loadSector: (ownerId: string, id: ObjectId) => Promise<SectorLite | null>
  listAgentsInBuilding: (ownerId: string, buildingId: string) => Promise<Agent[]>
  // The REAL building a floor (office) belongs to — used to authorize cross-floor,
  // same-building delegation. null when the floor is gone.
  buildingIdForFloor: (ownerId: string, floorId: ObjectId) => Promise<string | null>
  // Resolve the target's tools INCLUDING its own delegation tools bound to `childCtx`,
  // so a delegated agent can (safely) delegate further.
  resolveTools: (agent: Agent, ownerId: string, childCtx: DelegationContext) => Promise<ResolvedTool[]>
  apiKeyFor: (ownerId: string, provider: string) => Promise<string | null>
  runTask: (req: AgentExecutionRequest) => Promise<AgentExecutionResult>
  startDelegation: (start: {
    ownerId: string
    correlationId: string
    depth: number
    callerAgentId: ObjectId
    targetType: 'agent' | 'sector'
    targetAgentId?: ObjectId | null
    targetSectorId?: ObjectId | null
    parentId?: ObjectId | null
    objective: string
  }) => Promise<ObjectId>
  finishDelegation: (
    id: ObjectId,
    patch: {
      status: 'succeeded' | 'failed' | 'denied' | 'canceled'
      denyCode?: string | null
      outputPreview?: string | null
      error?: string | null
      usage?: { inputTokens: number; outputTokens: number } | null
    },
  ) => Promise<void>
  // Per-agent operational telemetry for a run through delegation/sector. Optional so
  // tests can omit it. buildingId is the caller's real building; floorId is the run
  // agent's floor.
  recordEvent?: (e: {
    eventKey: string
    ownerId: string
    agentId: ObjectId
    sectorExecutionId?: ObjectId
    rootExecutionId?: ObjectId
    buildingId: string
    floorId: ObjectId
    source: 'delegation' | 'sector'
    preset: string
    status: 'succeeded' | 'failed' | 'timeout' | 'canceled'
    startedAt: Date
    finishedAt: Date
    inputTokens: number
    outputTokens: number
    /** O modelo que rodou — é o que permite somar o gasto POR MODELO. */
    model?: string | null
    toolCalls: number
    parentEventKey: string | null
    rootEventKey: string
    metadata: Record<string, string | number | boolean>
  }) => Promise<void> | void
  // Owner-level token accounting for a delegated/sector inference, charged exactly
  // once for `chargeKey`.
  chargeUsage?: (ownerId: string, usage: { inputTokens: number; outputTokens: number }, chargeKey: string) => Promise<void> | void
  // Curated knowledge for an execution: the agent's own base, plus the sector's when
  // the run happens in an EXPLICIT sector context. Returns passages only (no LLM
  // call); a failure returns none so the run continues ungrounded.
  // The WHOLE result: turning a failure into [] hid the difference between "the
  // base said nothing" and "the base could not be consulted".
  // Os sites do agente marcados como `always`/`on_change`. Injetado para este módulo
  // seguir testável sem rede.
  livePassages?: (ownerId: string, agent: Agent) => Promise<{ content: string; title: string }[]>
  retrieveContext?: (
    // Um agente, ou vários: o coordenador de um setor pode precisar olhar as bases do
    // time inteiro quando a dele não responde (ver `executeSectorTeam`).
    agentId: ObjectId | ObjectId[],
    query: string,
    opts: { sectorId?: ObjectId | null },
  ) => Promise<{
    context: string[]
    sources?: { documentId: string | null; title: string | null }[]
    status?: string
    failed?: boolean
    /** Quantos trechos correspondiam, quando dá para saber — ver `knowledge.ts`. */
    totalMatches?: number
  }>
}

interface TaskRun {
  output: string
  usage: { inputTokens: number; outputTokens: number }
  toolCalls: number
  startedAt: Date
  finishedAt: Date
  // Safe scalars for the telemetry: statuses and counts, never content.
  telemetry?: Record<string, string | number | boolean>
  /** O modelo que rodou de fato — com "Automático", o resolvido, e não o marcador. */
  model?: string | null
  /** Por que este modelo, quando a escolha foi automática. */
  modelReason?: string | null
  /**
   * O especialista pediu para restringir, em vez de responder.
   *
   * É o que faltava para o coordenador saber a diferença entre "aqui está a resposta" e
   * "isto é o começo de 2000 resultados". Sem isso ele recebia texto e tratava tudo como
   * resposta pronta.
   */
  clarification?: ClarificationRequest | null
  // De onde saiu a resposta, para quem PEDIU poder conferir: o veredito da busca e os
  // documentos que entraram — id e título, nunca o texto deles.
  grounding?: string
  sources?: { documentId: string | null; title: string | null }[]
}

// Emit a per-agent telemetry event for a delegation/sector run (fire-and-forget via
// the injected recordEvent).
// AWAITED (not fire-and-forget): a delegated attempt is only reported as finished
// once its telemetry and its charge are persisted. Failures are settled, never
// rethrown — the model already ran, so a persistence problem must not become a
// second inference.
async function emitAgentEvent(
  deps: DelegationDeps,
  ctx: DelegationContext,
  target: Agent,
  source: 'delegation' | 'sector',
  eventKey: string,
  run: {
    usage: { inputTokens: number; outputTokens: number }
    toolCalls: number
    startedAt: Date
    finishedAt: Date
    // Safe operational facts, the same vocabulary the routine step records.
    telemetry?: Record<string, string | number | boolean>
    /** O modelo que rodou, quando quem chama sabe. */
    model?: string | null
  },
  status: 'succeeded' | 'failed' | 'timeout' | 'canceled',
  // Present when this run is a participation in a sector execution: the link that
  // lets the sector count the flow once and still read its members' numbers.
  sectorExecutionId?: ObjectId,
): Promise<void> {
  const pending: (Promise<void> | void)[] = []
  pending.push(deps.recordEvent?.({
    eventKey,
    ...(sectorExecutionId ? { sectorExecutionId } : {}),
    ...(ctx.rootExecutionId ? { rootExecutionId: ctx.rootExecutionId } : {}),
    ownerId: ctx.ownerId,
    agentId: target._id,
    buildingId: ctx.buildingId,
    floorId: target.officeId,
    source,
    preset: target.preset,
    status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    // O modelo que rodou — com "Automático" ele muda de agente para agente, e sem isto
    // registrado não há como somar o gasto por modelo.
    model: run.model ?? target.model ?? null,
    toolCalls: run.toolCalls,
    parentEventKey: ctx.currentEventKey ?? null,
    rootEventKey: ctx.rootEventKey ?? eventKey,
    metadata: {
      correlationId: ctx.correlationId,
      depth: ctx.depth + 1,
      durationMs: run.finishedAt.getTime() - run.startedAt.getTime(),
      ...(run.telemetry ?? {}),
    },
  }))
  // Owner accounting for this delegated inference — once per event key.
  if (run.usage.inputTokens || run.usage.outputTokens) pending.push(deps.chargeUsage?.(ctx.ownerId, run.usage, `event:${eventKey}`))
  const settled = await Promise.allSettled(pending.map(async (p) => p))
  for (const r of settled) if (r.status === 'rejected') console.error('delegation persistence failed (work kept, not re-run):', String(r.reason))
}

// Identifies the CALL, not the attempt.
const sectorExecutionKeyFor = (ctx: DelegationContext, sectorId: string): string =>
  `sector:${ctx.correlationId ?? 'none'}:${sectorId}:${ctx.callerAgentId}:${ctx.depth}`

// Safe scalars only — a stage name is the owner's own label, never model output.
function participationTelemetry(
  p?: { role: string; stageId?: string; stageName?: string; stageOrder?: number },
): Record<string, string | number> {
  if (!p) return {}
  return {
    role: p.role,
    ...(p.stageId ? { stageId: p.stageId } : {}),
    ...(p.stageName ? { stageName: p.stageName.slice(0, 60) } : {}),
    ...(typeof p.stageOrder === 'number' ? { stageOrder: p.stageOrder } : {}),
  }
}

const TASK_TIMEOUT_MS = 120_000
const MAX_OUTPUT_CHARS = 40_000

function j(v: unknown): string {
  return JSON.stringify(v)
}

async function isCanceled(ctx: DelegationContext): Promise<boolean> {
  return ctx.isCanceled ? Boolean(await ctx.isCanceled()) : false
}

// The target requires curated knowledge and it was not available. Structured on
// purpose: 'unavailable' (we could not look), 'empty' (we looked and found nothing
// relevant) and 'no_base' (there is nothing to look in) are different problems with
// different fixes.
export class GroundingRequiredError extends Error {
  readonly code = 'knowledge_unavailable'
  constructor(readonly grounding: string) {
    super(`o agente exige base de conhecimento (${grounding})`)
    this.name = 'GroundingRequiredError'
  }
}

const GROUNDING_REASON: Record<string, string> = {
  unavailable: 'a base de conhecimento não pôde ser consultada',
  empty: 'nenhum trecho relevante foi encontrado na base',
  no_base: 'o agente não tem base de conhecimento configurada',
}

// A format a caller asked for, or undefined to let the target decide.
function asOutputFormat(value: unknown): AgentOutputFormat | undefined {
  return value === 'text' || value === 'markdown' || value === 'json' ? value : undefined
}

// A pipeline stage says what it must hand over; the model has to be told.
export function stageInstruction(instruction: string, expectedOutput?: string): string {
  const expected = (expectedOutput ?? '').trim()
  return expected ? `${instruction}\n\nO resultado desta etapa deve ser: ${expected}` : instruction
}

// What a stage's hand-off is checked for, honestly.
//
// With a JSON contract the check is STRUCTURAL: the output must parse and, when the
// agent declares a schema, satisfy it — the next stage is not released otherwise.
// With a free-text contract the only deterministic check possible is that something
// was produced: `expectedOutput` is prose, and nothing here claims to have verified
// that the prose was honoured. That limitation is deliberate and documented.
export function checkStageOutput(
  output: string,
  target: Pick<Agent, 'defaultOutputFormat' | 'outputJsonSchema'>,
  format?: AgentOutputFormat,
): { ok: true } | { ok: false; problem: string } {
  if (!output.trim()) return { ok: false, problem: 'a etapa não produziu resultado' }
  const effective = format ?? target.defaultOutputFormat
  if (effective !== 'json') return { ok: true }
  let parsed: unknown
  try {
    parsed = JSON.parse(output.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
  } catch {
    return { ok: false, problem: 'a etapa deveria produzir JSON e não produziu' }
  }
  if (target.outputJsonSchema) {
    const validation = validateAgainstSchema(target.outputJsonSchema, parsed)
    if (!validation.valid) return { ok: false, problem: `o JSON da etapa não cumpre o contrato: ${describeErrors(validation.errors)}` }
  }
  return { ok: true }
}

// Run one target agent as a task under `ctx` (ctx.callerAgentId is the delegator).
// Returns the model output, charging the shared budget. Assumes checkDelegation
// already passed.
async function runAgentTask(
  deps: DelegationDeps,
  ctx: DelegationContext,
  target: Agent,
  objective: string,
  input: unknown,
  // Undefined = "the target decides" (its own default, else markdown).
  format: AgentOutputFormat | undefined,
  eventKey?: string,
  sectorId?: ObjectId | null,
  grant?: { sectorId: string; memberIds: string[] } | null,
): Promise<TaskRun> {
  // The child runs under THIS execution's event, so anything it delegates chains to
  // the same root (parent/root lineage).
  const cctx = {
    ...childContext(ctx, target),
    currentEventKey: eventKey ?? ctx.currentEventKey ?? null,
    rootEventKey: ctx.rootEventKey ?? eventKey ?? null,
    // Only the coordinator receives it (see delegate_to_sector).
    sectorGrant: grant ?? null,
  }
  const tools = await deps.resolveTools(target, ctx.ownerId, cctx)
  const apiKey = await deps.apiKeyFor(ctx.ownerId, target.provider)
  // Curated grounding: the executor's own base, plus the sector's ONLY when this run
  // has an explicit sector context (never implied by the agent's home sector).
  // The question includes the objective AND the input, serialized when it is an
  // object — a delegation that hands over JSON used to retrieve nothing.
  const query = buildRetrievalQuery({ objective, input })
  // A rejected promise is 'unavailable', not "no knowledge": the two must never be
  // confused, and only the first one is a reason to refuse.
  const retrieved = query && deps.retrieveContext
    ? await deps.retrieveContext(target._id, query, { sectorId: sectorId ?? null }).catch(() => ({ context: [], sources: [], status: 'unavailable', failed: true }))
    : { context: [], sources: [], status: 'no_base' as const, failed: false }
  const passages = Array.isArray(retrieved) ? (retrieved as string[]) : (retrieved.context ?? [])
  const sources = Array.isArray(retrieved) ? [] : (retrieved.sources ?? [])
  const grounding = (Array.isArray(retrieved) ? undefined : retrieved.status) ?? (!Array.isArray(retrieved) && retrieved.failed ? 'unavailable' : passages.length ? 'ok' : 'empty')
  // The target's own rule, honoured wherever it runs: a delegated agent that must
  // answer from curated knowledge does not answer without it, and nothing is spent.
  if (target.requireGrounding && grounding !== 'ok') {
    throw new GroundingRequiredError(grounding)
  }
  // Os endereços que o dono marcou para entrar sozinhos também valem aqui: delegação e
  // etapa de setor são "o agente foi chamado" tanto quanto uma conversa.
  const vivas = deps.livePassages ? await deps.livePassages(ctx.ownerId, target).catch(() => []) : []
  // Numbered references, so the answer can cite what it used. The owner is not named.
  // O aviso de amplitude vem ANTES das passagens: é o que decide entre responder e
  // perguntar, e depois delas já seria tarde.
  const aviso = breadthNotice(
    Array.isArray(retrieved) ? undefined : (retrieved as { totalMatches?: number }).totalMatches,
    passages.length,
  )
  const context = [
    ...(aviso ? [aviso] : []),
    ...formatContextWithSources(passages, sources),
    ...vivas.map((v) => `[${v.title}]\n${v.content}`),
  ]
  const startedAt = new Date()
  // The TARGET decides how it answers: an agent configured to produce JSON is not
  // forced into Markdown because the caller did not think about it.
  const effectiveFormat: AgentOutputFormat = format ?? target.defaultOutputFormat ?? 'markdown'
  /**
   * O agente delegado é o MESMO agente, por outra porta.
   *
   * As ferramentas já foram resolvidas acima, e é o risco delas que decide o
   * paralelismo — por isso o resolvedor vem depois. Delegação é automação: ninguém
   * está olhando a tela, o resultado é consumido por quem pediu.
   */
  const execucao = resolveAgentRun(target, { context: 'automation', toolRisks: tools.map((t) => t.risk ?? 'write') })

  const res = await deps.runTask({
    // O objetivo é o do ALVO; o pedido delegado é a instrução da tarefa. Trocar os dois
    // faria o agente esquecer para que ele existe e virar executor do pedido da vez.
    objective: target.objective || objective,
    // Instruções do agente primeiro, pedido depois: as dele valem para todo trabalho,
    // o pedido é o do momento.
    instructions: [target.instructions?.trim(), objective?.trim()].filter(Boolean).join('\n\n'),
    // Função e limites, que antes não chegavam por este caminho.
    definition: { role: target.role ?? null, constraints: target.constraints ?? null },
    // Passages are untrusted DATA (agentRuntime marks them as such), never system
    // instructions.
    context: context.length ? context : undefined,
    input,
    provider: target.provider,
    // Resolvido: "Automático" guarda um marcador, não um id de modelo.
    model: execucao.model,
    apiKey,
    tools,
    // What the target promised to receive and produce, in its own words.
    contracts: { input: target.inputContract, output: target.outputContract },
    output: { format: effectiveFormat, jsonSchema: effectiveFormat === 'json' ? (target.outputJsonSchema ?? null) : null },
    runConfig: execucao.runConfig,
    enableCaching: execucao.enableCaching,
    limits: { timeoutMs: TASK_TIMEOUT_MS, maxOutputChars: MAX_OUTPUT_CHARS },
  })
  ctx.budget.tokensSpent += res.usage.inputTokens + res.usage.outputTokens
  const telemetry: Record<string, string | number | boolean> = {
    grounding,
    ragChunks: passages.length,
    ragSources: new Set(sources.map((source) => source.documentId).filter(Boolean)).size,
    outputFormat: effectiveFormat,
    // Campo e motivo apenas — o mesmo diagnóstico da rotina, pelo mesmo formato.
    runConfigDropped: (execucao.runConfig.dropped ?? []).map((d) => `${d.field}: ${d.reason}`).join('; '),
    outputValid: res.format?.valid !== false,
    outputRepaired: res.format?.repaired === true,
    toolsAvailable: tools.length,
    toolsExecuted: res.toolCalls.filter((c) => c.ok).length,
  }
  // "Ações com ferramenta" counts calls that actually COMPLETED, not attempts.
  return { output: res.output, usage: res.usage, toolCalls: res.toolCalls.filter((c) => c.ok).length, startedAt, finishedAt: new Date(), telemetry, grounding, sources, model: execucao.model, modelReason: execucao.modelReason, clarification: clarificationFrom(res.toolCalls) }
}

// ---- delegate_to_agent ------------------------------------------------------
async function delegateToAgent(deps: DelegationDeps, ctx: DelegationContext, args: Record<string, unknown>): Promise<{ ok: boolean; result: string }> {
  const targetId = typeof args.agentId === 'string' ? args.agentId : ''
  const objective = typeof args.objective === 'string' ? args.objective.trim() : ''
  const input = args.input
  if (!ObjectId.isValid(targetId) || !objective) return { ok: false, result: j({ status: 'error', reason: 'agentId e objective são obrigatórios' }) }
  if (await isCanceled(ctx)) return { ok: false, result: j({ status: 'canceled' }) }

  const [caller, target] = await Promise.all([deps.loadAgent(ctx.ownerId, new ObjectId(ctx.callerAgentId)), deps.loadAgent(ctx.ownerId, new ObjectId(targetId))])
  if (!caller) return { ok: false, result: j({ status: 'error', reason: 'agente chamador não encontrado' }) }
  if (!target) return { ok: false, result: j({ status: 'error', reason: 'agente alvo não encontrado' }) }

  // ONE decision. The facts are resolved here — building, floor communication and the
  // sector that may protect the target — and the pure gate decides. Discovery asks the
  // same gate with the same facts, so it can never offer a target this refuses.
  const targetBuildingId = await deps.buildingIdForFloor(ctx.ownerId, target.officeId)
  const [communication, entry] = await Promise.all([
    deps.loadCommunication?.(ctx.ownerId) ?? Promise.resolve(undefined),
    // An internal call made by that sector's own run carries the grant and is exempt —
    // being on the member list alone never counts as internal.
    (ctx.sectorGrant?.memberIds.includes(targetId) ?? false) ? Promise.resolve(undefined) : deps.sectorEntryFor?.(ctx.ownerId, targetId),
  ])
  const decision = checkCollaboration(
    caller,
    gateTargetForAgent(target, targetBuildingId ?? '', entry?.blocked ? { sectorId: entry.sectorId, sectorName: entry.sectorName } : null),
    communication ?? OPEN_COMMUNICATION,
    gateContext(ctx),
  )
  if (!decision.ok) {
    return {
      ok: false,
      result: j({
        status: 'denied',
        code: decision.code,
        reason: decision.reason,
        ...(decision.sectorId ? { sectorId: decision.sectorId, sector: decision.sectorName } : {}),
      }),
    }
  }

  const recId = await deps.startDelegation({
    ownerId: ctx.ownerId,
    correlationId: ctx.correlationId,
    depth: ctx.depth + 1,
    callerAgentId: caller._id,
    targetType: 'agent',
    targetAgentId: target._id,
    objective,
  })
  // The caller is waiting on another agent — that is what the map shows, without
  // ever naming the objective.
  deps.reportState?.({
    ownerId: ctx.ownerId,
    agentId: caller._id,
    floorId: caller.officeId ?? null,
    rootExecutionId: ctx.correlationId,
    state: 'delegating_agent',
    detail: { targetType: 'agent' },
  })
  const startedAt = new Date()
  try {
    const run = await runAgentTask(deps, ctx, target, objective, input, asOutputFormat(args.format), `deleg:${recId.toString()}`)
    await deps.finishDelegation(recId, { status: 'succeeded', outputPreview: run.output.slice(0, 500), usage: run.usage })
    await emitAgentEvent(deps, ctx, target, 'delegation', `deleg:${recId.toString()}`, run, 'succeeded')
    // O especialista pediu para restringir. Devolver isso como se fosse resposta faria o
    // coordenador consolidar uma pergunta como se fosse um resultado.
    if (run.clarification) {
      return {
        ok: true,
        result: j({
          status: 'needs_clarification',
          agent: target.name,
          pergunta: run.clarification.question,
          motivo: run.clarification.reason,
          ...(run.clarification.options ? { opcoes: run.clarification.options } : {}),
          instrucao:
            'NÃO invente a resposta. Faça essa pergunta a quem pediu (adapte a redação se quiser), ou responda-a você mesmo se já souber o recorte e delegue de novo.',
        }),
      }
    }
    return { ok: true, result: j({ status: 'ok', agent: target.name, output: run.output }) }
  } catch (error) {
    // The target requires curated knowledge and there was none: a distinct outcome,
    // reported with WHICH of the three problems it was, and with no inference spent.
    if (error instanceof GroundingRequiredError) {
      await deps.finishDelegation(recId, { status: 'failed', error: error.message })
      await emitAgentEvent(deps, ctx, target, 'delegation', `deleg:${recId.toString()}`, { usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: 0, startedAt, finishedAt: new Date() }, 'failed')
      return {
        ok: false,
        result: j({ status: 'knowledge_unavailable', code: error.code, grounding: error.grounding, agent: target.name, reason: GROUNDING_REASON[error.grounding] ?? error.message }),
      }
    }
    const message = error instanceof Error ? error.message : 'falha na delegação'
    // A cancellation or a timeout is not a plain failure — both the log and the
    // telemetry record their own terminal status.
    const outcome = /cancel/i.test(message) || (await isCanceled(ctx)) ? 'canceled' : /timeout|exceeded/i.test(message) ? 'timeout' : 'failed'
    await deps.finishDelegation(recId, { status: outcome === 'timeout' ? 'failed' : outcome, error: message })
    await emitAgentEvent(deps, ctx, target, 'delegation', `deleg:${recId.toString()}`, { usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: 0, startedAt, finishedAt: new Date() }, outcome)
    return { ok: false, result: j({ status: outcome === 'canceled' ? 'canceled' : 'error', reason: message }) }
  }
}

// Run a target with a bounded number of attempts (retryPolicy.maxAttempts). The last
// error propagates when every attempt fails.
async function runWithRetry(deps: DelegationDeps, ctx: DelegationContext, target: Agent, objective: string, input: unknown, format: AgentOutputFormat | undefined, maxAttempts: number, eventKey?: string, sectorId?: ObjectId | null): Promise<TaskRun> {
  let lastError: unknown
  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
    try {
      return await runAgentTask(deps, ctx, target, objective, input, format, eventKey, sectorId)
    } catch (error) {
      lastError = error
      // 'empty' and 'no_base' are configuration, not weather: retrying them cannot
      // change the answer. 'unavailable' can, so it keeps its attempts.
      if (error instanceof GroundingRequiredError && error.grounding !== 'unavailable') break
    }
  }
  throw lastError instanceof Error ? lastError : new Error('falha na execução')
}

// Record a child delegation (caller = the agent that invoked the sector) so each
// stage/coordinator run shows in both histories, one level below the sector record,
// AND a per-agent 'sector' telemetry event.
async function recordChildRun(
  deps: DelegationDeps,
  ctx: DelegationContext,
  target: Agent,
  objective: string,
  parentId: ObjectId,
  run: (eventKey: string) => Promise<TaskRun>,
  // Which sector run this participation belongs to, and what part the agent played.
  participation?: { sectorExecutionId: ObjectId; role: 'coordinator' | 'specialist' | 'pipeline_stage'; stageId?: string; stageName?: string; stageOrder?: number },
  // A execução inteira, e não só o texto: quem chama precisa da procedência para poder
  // mostrar de onde veio a resposta.
): Promise<TaskRun> {
  const recId = await deps.startDelegation({
    ownerId: ctx.ownerId,
    correlationId: ctx.correlationId,
    depth: ctx.depth + 2,
    callerAgentId: new ObjectId(ctx.callerAgentId),
    targetType: 'agent',
    targetAgentId: target._id,
    parentId,
    objective,
  })
  const eventKey = `deleg:${recId.toString()}`
  const startedAt = new Date()
  try {
    const r = await run(eventKey)
    await deps.finishDelegation(recId, { status: 'succeeded', outputPreview: r.output.slice(0, 500), usage: r.usage })
    await emitAgentEvent(deps, ctx, target, 'sector', eventKey, { ...r, telemetry: { ...(r.telemetry ?? {}), ...participationTelemetry(participation) } }, 'succeeded', participation?.sectorExecutionId)
    return r
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha'
    const outcome = /cancel/i.test(message) ? 'canceled' : /timeout|exceeded/i.test(message) ? 'timeout' : 'failed'
    await deps.finishDelegation(recId, { status: outcome === 'timeout' ? 'failed' : outcome, error: message })
    await emitAgentEvent(
      deps,
      ctx,
      target,
      'sector',
      eventKey,
      { usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: 0, startedAt, finishedAt: new Date(), telemetry: { errorKind: outcome, ...participationTelemetry(participation) } },
      outcome,
      participation?.sectorExecutionId,
    )
    throw error
  }
}

// ---- o executor de setor, único ---------------------------------------------
//
// Havia DOIS comportamentos para "executar um setor". Este, que executa de verdade —
// coordenador com acesso aos membros, ou etapas encadeadas, cada agente com o próprio
// provedor, modelo, ferramentas, memória e base. E outro, no Playground e no canal, que
// só ESCOLHIA NOMES: perguntava a um modelo auxiliar quais especialistas seriam bons,
// buscava trechos e fazia uma única inferência com o membro marcado como padrão. O
// pesquisador nunca rodava; o coordenador nunca era chamado; `coordinatorAgentId` e
// `stages` sequer eram lidos. Um setor com dados de BBSE3 no pesquisador respondia "não
// tenho esses dados" — e estava certo, porque quem respondia era outro agente.
//
// Agora existe só este. O Playground, o canal e `delegate_to_sector` chamam a mesma
// função; o que muda entre eles é quem registra o quê, não o que acontece.

/**
 * As ferramentas que existem para um agente ALCANÇAR o time.
 *
 * Elas não declaram risco porque o risco é do que o outro lado faz — delegar não
 * escreve nada por si. Ficam nomeadas aqui para o Playground poder liberá-las sem
 * precisar repetir a lista e sem ela envelhecer em silêncio.
 */
export const TEAM_TOOL_NAMES = ['list_available_agents', 'get_agent_capabilities', 'delegate_to_agent', 'delegate_to_sector'] as const

/**
 * O contexto de uma execução de setor pedida por uma PESSOA.
 *
 * Sem agente chamador: quem pediu foi o dono, pela tela ou por um canal. O campo fica
 * vazio de propósito — inventar um agente aqui produziria uma cadeia de delegação que
 * nunca existiu. Ele só entra na `ancestry` dos filhos, onde uma string vazia não casa
 * com id de agente nenhum e portanto não bloqueia nada.
 */
export function sectorRunContext(opts: {
  ownerId: string
  buildingId: string
  correlationId: string
  tokenLimit?: number
  isCanceled?: () => boolean | Promise<boolean>
  rootExecutionId?: ObjectId | null
}): DelegationContext {
  return {
    ownerId: opts.ownerId,
    buildingId: opts.buildingId,
    correlationId: opts.correlationId,
    callerAgentId: '',
    callerAgentName: '',
    ancestry: [],
    depth: 0,
    budget: { tokenLimit: opts.tokenLimit ?? DEFAULT_DELEGATION_TOKEN_BUDGET, tokensSpent: 0 },
    isCanceled: opts.isCanceled,
    rootExecutionId: opts.rootExecutionId ?? null,
  }
}

export interface SectorParticipant {
  agentId: string
  name: string
  role: ParticipationRole
  stageId?: string
  stageName?: string
  order?: number
  /** O veredito da busca de conhecimento DESTE agente: ok/empty/no_base/unavailable. */
  grounding?: string
  /** Quantas ferramentas ele completou. Um número, nunca argumentos ou resultado. */
  toolCalls?: number
  /** Os documentos que entraram na resposta: id e título, nunca o texto. */
  sources?: { documentId: string | null; title: string | null }[]
  /** O que ESTE agente custou. Quem paga a conta precisa ver a conta separada. */
  usage?: { inputTokens: number; outputTokens: number }
  /** Quanto ele demorou, em milissegundos. */
  durationMs?: number
  /** O provedor e o modelo com que ele rodou — a prova de que cada um usa o seu. */
  provider?: string
  model?: string | null
  /** Por que este modelo, quando a escolha foi automática. */
  modelReason?: string | null
  /** Deu certo? Uma etapa que falhou com `onError: continue` também aparece aqui. */
  status?: 'succeeded' | 'failed'
}

export interface SectorTeamRun {
  output: string
  /** Quem REALMENTE executou, na ordem em que executou. */
  participants: SectorParticipant[]
  warnings: string[]
  /**
   * O time pediu para restringir em vez de responder.
   *
   * Vem de quem falou por último — o coordenador, ou a etapa final do pipeline. É o que
   * permite ao canal marcar o turno e escrever as alternativas: sem isto, o
   * esclarecimento funcionava na delegação entre agentes e sumia quando quem perguntava
   * era o próprio coordenador.
   */
  clarification?: ClarificationRequest | null
}

export interface SectorTeamOptions {
  objective: string
  input?: unknown
  format?: AgentOutputFormat
  /**
   * O registro de delegação pai, quando a execução veio de um agente. Ausente numa
   * execução iniciada por uma PESSOA (Playground, canal): ali não há delegação — há um
   * pedido — e inventar um registro com um agente chamador falso sujaria a auditoria.
   */
  parentDelegationId?: ObjectId | null
  sectorExecutionId?: ObjectId | null
  /** Já está na cadeia? Numa execução iniciada por pessoa, não há cadeia. */
  inChain?: (id: ObjectId) => boolean
}

/**
 * Executa o setor como time.
 *
 * `orchestrated`: roda `coordinatorAgentId` e concede a ele, SÓ durante esta execução,
 * o direito de chamar os membros do próprio setor. Quem escolhe o especialista é o
 * coordenador, com as ferramentas de delegação na mão — e cada membro chamado executa
 * com a própria configuração.
 *
 * `pipeline`: lê `sector.stages` — nunca `members` — e roda as etapas na ordem,
 * passando a saída de uma como entrada das dependentes.
 *
 * `organization` não executa: é agrupamento visual, e quem chama trata isso antes.
 */
export async function executeSectorTeam(
  deps: DelegationDeps,
  ctx: DelegationContext,
  sector: SectorLite,
  opts: SectorTeamOptions,
): Promise<SectorTeamRun> {
  const inChain = opts.inChain ?? (() => false)
  const format = opts.format
  const participants: SectorParticipant[] = []
  const warnings: string[] = []
  // O pedido de quem falou por último: é ele que chega a quem pediu.
  let clarification: ClarificationRequest | null = null
  const sectorExecutionId = opts.sectorExecutionId ?? null

  const participationOf = (
    role: ParticipationRole,
    stage?: { id: string; name: string; order: number },
  ) => (sectorExecutionId ? { sectorExecutionId, role, stageId: stage?.id, stageName: stage?.name, stageOrder: stage?.order } : undefined)

  // Um agente do time roda igual pelos três caminhos. A diferença é só o registro: com
  // um pai, vira delegação-filha; sem pai, o evento é emitido direto, e a participação
  // no setor é gravada do mesmo jeito.
  const rodarMembro = async (
    target: Agent,
    instruction: string,
    input: unknown,
    executar: (eventKey: string) => Promise<TaskRun>,
    participation: ReturnType<typeof participationOf>,
    papel: SectorParticipant,
  ): Promise<string> => {
    void input
    let saida: TaskRun
    if (opts.parentDelegationId) {
      saida = await recordChildRun(deps, ctx, target, instruction, opts.parentDelegationId, executar, participation)
    } else {
      const eventKey = `setor:${sectorExecutionId?.toString() ?? ctx.correlationId}:${target._id.toString()}:${participants.length}`
      const startedAt = new Date()
      try {
        const r = await executar(eventKey)
        await emitAgentEvent(
          deps,
          ctx,
          target,
          'sector',
          eventKey,
          { ...r, telemetry: { ...(r.telemetry ?? {}), ...participationTelemetry(participation) } },
          'succeeded',
          participation?.sectorExecutionId,
        )
        saida = r
      } catch (error) {
        const message = error instanceof Error ? error.message : 'falha'
        const outcome = /cancel/i.test(message) ? 'canceled' : /timeout|exceeded/i.test(message) ? 'timeout' : 'failed'
        await emitAgentEvent(
          deps,
          ctx,
          target,
          'sector',
          eventKey,
          { usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: 0, startedAt, finishedAt: new Date(), telemetry: participationTelemetry(participation) },
          outcome,
          participation?.sectorExecutionId,
        )
        throw error
      }
    }
    // A procedência acompanha quem produziu: quem lê a resposta vê de qual agente veio
    // cada fonte, e não uma pilha anônima.
    clarification = saida.clarification ?? null
    participants.push({
      ...papel,
      grounding: saida.grounding,
      toolCalls: saida.toolCalls,
      sources: (saida.sources ?? []).map((f) => ({ documentId: f.documentId, title: f.title })),
      usage: saida.usage,
      durationMs: Math.max(0, saida.finishedAt.getTime() - saida.startedAt.getTime()),
      provider: target.provider,
      // O que rodou, não o que está guardado: com "Automático" os dois diferem.
      model: saida.model ?? target.model ?? null,
      modelReason: saida.modelReason ?? null,
      status: 'succeeded',
    })
    return saida.output
  }

  if (sector.mode === 'pipeline') {
    const stages = sector.stages ?? []
    if (stages.length === 0) throw new Error('pipeline sem etapas')
    const outputs: Record<string, string> = {}
    let output = ''
    for (const stage of stages) {
      if (await isCanceled(ctx)) throw new Error('cancelado')
      if (ctx.budget.tokensSpent >= ctx.budget.tokenLimit) throw new Error('orçamento esgotado')
      const agent = await deps.loadAgent(ctx.ownerId, stage.agentId)
      const problem = !agent ? 'agente da etapa não encontrado' : inChain(stage.agentId) ? 'ciclo de delegação na etapa' : null
      if (problem || !agent) {
        if (stage.onError === 'continue') {
          warnings.push(`${stage.name}: ${problem}`)
          continue
        }
        throw new Error(`${stage.name}: ${problem}`)
      }
      // A entrada de uma etapa é a saída de quem ela depende — e só o pedido original
      // quando ela não depende de ninguém.
      const input = stage.dependsOn.length ? stage.dependsOn.map((id) => outputs[id] ?? '').join('\n\n') : opts.input
      const instruction = stageInstruction(stage.instruction || opts.objective, stage.expectedOutput)
      const order = stages.indexOf(stage) + 1
      try {
        const out = await rodarMembro(
          agent,
          instruction,
          input,
          (k) => runWithRetry(deps, ctx, agent, instruction, input, format, stage.retryPolicy.maxAttempts, k, sector._id),
          participationOf('pipeline_stage', { id: stage.id, name: stage.name, order }),
          { agentId: agent._id.toString(), name: agent.name, role: 'pipeline_stage', stageId: stage.id, stageName: stage.name, order },
        )
        // Conferida ANTES de a próxima etapa consumir: estrutural quando a etapa produz
        // JSON, e só "saiu alguma coisa" no resto.
        const verdict = checkStageOutput(out, agent, format)
        if (!verdict.ok) throw new Error(verdict.problem)
        outputs[stage.id] = out
        output = out
      } catch (error) {
        const message = error instanceof Error ? error.message : 'falha'
        if (stage.onError === 'continue') {
          warnings.push(`${stage.name}: ${message}`)
          continue
        }
        throw new Error(`${stage.name}: ${message}`)
      }
    }
    return { output, participants, warnings, clarification }
  }

  // orquestrado
  const coordinatorId = sector.coordinatorAgentId ?? sector.members.find((m) => m.isDefault)?.agentId ?? sector.members[0]?.agentId
  if (!coordinatorId) throw new Error('setor orquestrado sem coordenador nem membros')
  if (inChain(coordinatorId)) throw new Error('ciclo de delegação: o coordenador já está na cadeia')
  const coordinator = await deps.loadAgent(ctx.ownerId, coordinatorId)
  if (!coordinator) throw new Error('coordenador não encontrado')
  const instruction = sector.instruction ? `${sector.instruction}\n\n${opts.objective}` : opts.objective
  // O time que o coordenador alcança durante ESTA execução: os membros do próprio
  // setor, menos ele. Nada global é aberto, e o filho não herda o direito.
  const grant = {
    sectorId: sector._id.toString(),
    memberIds: sector.members.map((m) => m.agentId.toString()).filter((id) => id !== coordinator._id.toString()),
  }

  /**
   * A rede de segurança do conhecimento.
   *
   * O coordenador costuma não ter base própria — quem tem é o especialista. Se ele não
   * delegar (e ele pode não delegar), a resposta sairia "não tenho esses dados" com o
   * dado guardado ali do lado, na base de um colega do MESMO setor. Então: primeiro a
   * base dele; se não vier nada, as bases do time.
   *
   * Continua dentro do escopo já autorizado — os membros deste setor, desta conta.
   * Nada global é aberto, e a base do setor entra pelo mesmo `sectorId` de sempre.
   */
  // Os colegas que a busca ainda NÃO cobriu. Sem nenhum, não há segunda busca a fazer:
  // repetir a mesma consulta nos mesmos donos custa e não descobre nada.
  const colegas = sector.members.map((m) => m.agentId).filter((id) => id.toString() !== coordinator._id.toString())
  const achou = (r: { context?: string[]; status?: string }): boolean =>
    r.status === 'ok' || (r.status === undefined && (r.context?.length ?? 0) > 0)
  const depsComTime: DelegationDeps = deps.retrieveContext && colegas.length > 0
    ? {
        ...deps,
        retrieveContext: async (agentId, query, o) => {
          const propria = await deps.retrieveContext!(agentId, query, o)
          if (achou(propria)) return propria
          const doTime = await deps.retrieveContext!([coordinator._id, ...colegas], query, o)
          // Só substitui quando o time REALMENTE achou: um 'empty' do time não pode
          // apagar um 'unavailable' da base própria, que significa outra coisa.
          return achou(doTime) ? doTime : propria
        },
      }
    : deps

  const output = await rodarMembro(
    coordinator,
    instruction,
    opts.input,
    (k) => runAgentTask(depsComTime, ctx, coordinator, instruction, opts.input, format, k, sector._id, grant),
    participationOf('coordinator'),
    { agentId: coordinator._id.toString(), name: coordinator.name, role: 'coordinator' },
  )
  return { output, participants, warnings, clarification }
}

// ---- delegate_to_sector -----------------------------------------------------
// Real team executor, by mode:
//   organization — not executable (a visual grouping); returns not_executable.
//   orchestrated — the coordinator runs the request; with delegation tools it calls
//                  members itself and consolidates.
//   pipeline     — the stages run in order, each stage's input chained from its
//                  dependencies' outputs, honouring retryPolicy and onError.
// Every stage/coordinator run is a child delegation (parent = the sector record).
async function delegateToSector(deps: DelegationDeps, ctx: DelegationContext, args: Record<string, unknown>): Promise<{ ok: boolean; result: string }> {
  const sectorId = typeof args.sectorId === 'string' ? args.sectorId : ''
  const objective = typeof args.objective === 'string' ? args.objective.trim() : ''
  if (!ObjectId.isValid(sectorId) || !objective) return { ok: false, result: j({ status: 'error', reason: 'sectorId e objective são obrigatórios' }) }
  if (await isCanceled(ctx)) return { ok: false, result: j({ status: 'canceled' }) }

  const caller = await deps.loadAgent(ctx.ownerId, new ObjectId(ctx.callerAgentId))
  if (!caller) return { ok: false, result: j({ status: 'error', reason: 'agente chamador não encontrado' }) }
  // Policy, depth and budget are the gate's job now — checked once, below, with the
  // sector in hand (a 'floor' policy cannot be decided before knowing its floor).

  const sector = await deps.loadSector(ctx.ownerId, new ObjectId(sectorId))
  if (!sector) return { ok: false, result: j({ status: 'error', reason: 'setor não encontrado' }) }
  deps.reportState?.({
    ownerId: ctx.ownerId,
    agentId: caller._id,
    floorId: caller.officeId ?? null,
    rootExecutionId: ctx.correlationId,
    state: 'delegating_sector',
    detail: { targetType: 'sector' },
  })
  // Same gate as an agent call, with the sector as the target: floors, the caller's
  // policy, depth, cycles and budget are decided in ONE place and in one order.
  const sectorBuildingId = await deps.buildingIdForFloor(ctx.ownerId, sector.officeId)
  const communication = (await deps.loadCommunication?.(ctx.ownerId)) ?? OPEN_COMMUNICATION
  const sectorDecision = checkCollaboration(
    caller,
    {
      kind: 'sector',
      id: sector._id.toString(),
      ownerId: ctx.ownerId,
      buildingId: sectorBuildingId ?? '',
      floorId: sector.officeId ? sector.officeId.toString() : null,
      executable: sector.mode !== 'organization',
    },
    communication,
    gateContext(ctx),
  )
  if (!sectorDecision.ok) {
    // A group that does not execute keeps its own, more useful answer: it is not a
    // permission problem, it is the wrong kind of target.
    if (sector.mode === 'organization') {
      return { ok: false, result: j({ status: 'not_executable', reason: 'este setor apenas agrupa agentes; escolha um agente ou um setor orquestrado/pipeline' }) }
    }
    return { ok: false, result: j({ status: 'denied', code: sectorDecision.code, reason: sectorDecision.reason }) }
  }

  const inChain = (id: ObjectId) => id.toString() === ctx.callerAgentId || ctx.ancestry.includes(id.toString())
  const format = asOutputFormat(args.format)

  const recId = await deps.startDelegation({
    ownerId: ctx.ownerId,
    correlationId: ctx.correlationId,
    depth: ctx.depth + 1,
    callerAgentId: caller._id,
    targetType: 'sector',
    targetSectorId: sector._id,
    objective,
  })

  // ONE root for the whole flow, opened before the first agent. The key is
  // deterministic, so a retry of the same call reuses it instead of counting twice.
  const executionKey = sectorExecutionKeyFor(ctx, sector._id.toString())
  const sectorExecutionId = await deps.startSectorExecution?.({
    executionKey,
    ownerId: ctx.ownerId,
    sectorId: sector._id,
    sectorName: sector.name,
    sectorMode: sector.mode,
    floorId: sector.officeId ?? null,
    source: 'delegation',
    correlationId: ctx.correlationId ?? null,
    callerAgentId: caller._id,
  })
  const participationOf = (
    role: 'coordinator' | 'specialist' | 'pipeline_stage',
    stage?: { id: string; name: string; order: number },
  ) => (sectorExecutionId ? { sectorExecutionId, role, stageId: stage?.id, stageName: stage?.name, stageOrder: stage?.order } : undefined)

  try {
    // O MESMO executor do Playground e do canal. O que esta função acrescenta é o que
    // só existe quando quem pede é um agente: o portão de colaboração, o registro de
    // delegação pai e a resposta em JSON que a ferramenta devolve ao modelo.
    const run = await executeSectorTeam(deps, ctx, sector, {
      objective,
      input: args.input,
      format,
      parentDelegationId: recId,
      sectorExecutionId,
      inChain,
    })
    await deps.finishDelegation(recId, { status: 'succeeded', outputPreview: run.output.slice(0, 500) })
    await deps.finishSectorExecution?.(executionKey, { status: 'succeeded' })
    return {
      ok: true,
      result: j({
        status: 'ok',
        sector: sector.name,
        output: run.output,
        // Quem realmente trabalhou, para o chamador não ter que adivinhar.
        participants: run.participants.map((p) => p.name),
        ...(run.warnings.length ? { warnings: run.warnings } : {}),
      }),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha na delegação de setor'
    const canceled = /cancel/i.test(message)
    await deps.finishDelegation(recId, { status: canceled ? 'canceled' : 'failed', error: message })
    // A failure BEFORE the first agent is still an execution of this sector: the root
    // closes with a CATEGORY, never with the message.
    await deps.finishSectorExecution?.(executionKey, { status: canceled ? 'canceled' : 'failed', errorKind: canceled ? 'canceled' : 'stage_failed' })
    return { ok: false, result: j({ status: canceled ? 'canceled' : 'error', reason: message }) }
  }
}

// ---- discovery tools --------------------------------------------------------

/** Minúsculas e sem acento — a forma em que duas grafias da mesma palavra se encontram. */
const semAcento = (texto: string): string =>
  texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
function agentCard(a: Agent) {
  return { id: a._id.toString(), name: a.name, preset: a.preset, capabilities: a.capabilities ?? [], outputContract: a.outputContract || undefined }
}

// The agents the caller may actually delegate to (same building + authorized), so
// the model discovers collaborators by competency instead of guessing ids.
async function listAvailable(deps: DelegationDeps, ctx: DelegationContext, args: Record<string, unknown>): Promise<{ ok: boolean; result: string }> {
  const caller = await deps.loadAgent(ctx.ownerId, new ObjectId(ctx.callerAgentId))
  if (!caller) return { ok: false, result: j({ status: 'error', reason: 'agente chamador não encontrado' }) }
  const all = await deps.listAgentsInBuilding(ctx.ownerId, ctx.buildingId)
  const need = typeof args.capability === 'string' ? args.capability.toLowerCase() : ''
  // Candidates already share the caller's building (listAgentsInBuilding), so the
  // building check is satisfied by construction — pass ctx.buildingId as the target's.
  // Discovery HIDES what the runtime would refuse — same gate, same facts, so the two
  // cannot disagree. Resolving the sector protection per candidate is one query each;
  // the alternative is offering a target that fails after an inference is spent.
  const communication = (await deps.loadCommunication?.(ctx.ownerId)) ?? OPEN_COMMUNICATION
  const candidates = all.filter((t) => t._id.toString() !== caller._id.toString())
  const protections = await Promise.all(
    candidates.map((t) => (deps.sectorEntryFor ? deps.sectorEntryFor(ctx.ownerId, t._id.toString()) : Promise.resolve({ blocked: false as const }))),
  )
  const available = candidates.filter((t, i) => {
    const entry = protections[i]
    return checkCollaboration(
      caller,
      gateTargetForAgent(t, ctx.buildingId, entry.blocked ? { sectorId: entry.sectorId, sectorName: entry.sectorName } : null),
      communication,
      gateContext(ctx),
    ).ok
  })
  // Sem acento dos DOIS lados: quem etiquetou "jurídico" e quem procura por "juridico"
  // estão falando da mesma competência, e a busca não pode discordar por causa de um til.
  const alvo = semAcento(need)
  const filtered = need
    ? available.filter((t) => (t.capabilities ?? []).some((c) => semAcento(c).includes(alvo)) || semAcento(t.name).includes(alvo))
    : available
  return { ok: true, result: j({ status: 'ok', agents: filtered.map(agentCard) }) }
}

async function getCapabilities(deps: DelegationDeps, ctx: DelegationContext, args: Record<string, unknown>): Promise<{ ok: boolean; result: string }> {
  const id = typeof args.agentId === 'string' ? args.agentId : ''
  if (!ObjectId.isValid(id)) return { ok: false, result: j({ status: 'error', reason: 'agentId inválido' }) }
  const [caller, target] = await Promise.all([deps.loadAgent(ctx.ownerId, new ObjectId(ctx.callerAgentId)), deps.loadAgent(ctx.ownerId, new ObjectId(id))])
  if (!caller || !target) return { ok: false, result: j({ status: 'error', reason: 'agente não encontrado' }) }
  const targetBuildingId = await deps.buildingIdForFloor(ctx.ownerId, target.officeId)
  const [communication, entry] = await Promise.all([
    deps.loadCommunication?.(ctx.ownerId) ?? Promise.resolve(undefined),
    deps.sectorEntryFor?.(ctx.ownerId, id) ?? Promise.resolve(undefined),
  ])
  const check = checkCollaboration(
    caller,
    gateTargetForAgent(target, targetBuildingId ?? '', entry?.blocked ? { sectorId: entry.sectorId, sectorName: entry.sectorName } : null),
    communication ?? OPEN_COMMUNICATION,
    gateContext(ctx),
  )
  if (!check.ok) return { ok: false, result: j({ status: 'denied', code: check.code, reason: check.reason }) }
  return {
    ok: true,
    result: j({ status: 'ok', ...agentCard(target), objective: target.objective, inputContract: target.inputContract || undefined, activationModes: target.activationModes ?? [] }),
  }
}

// Build the four delegation tools bound to a caller context. `deps.resolveTools`
// must append these (bound to the child ctx) when resolving a delegated agent's
// tools, which is what lets delegation recurse.
export function buildDelegationTools(ctx: DelegationContext, deps: DelegationDeps): ResolvedTool[] {
  return [
    {
      name: 'list_available_agents',
      // Descoberta é leitura: consultar quem existe não aciona ninguém.
      risk: 'read',
      description: 'Lista os agentes colaboradores que você pode acionar (mesmo prédio e autorizados), opcionalmente filtrando por competência. Use antes de delegar.',
      inputSchema: { type: 'object', properties: { capability: { type: 'string', description: 'competência desejada (opcional)' } }, additionalProperties: false },
      run: (args) => listAvailable(deps, ctx, args),
    },
    {
      name: 'get_agent_capabilities',
      risk: 'read',
      description: 'Detalha as competências, objetivo e contratos de entrada/saída de um agente colaborador.',
      inputSchema: { type: 'object', properties: { agentId: { type: 'string', description: 'id do agente' } }, required: ['agentId'], additionalProperties: false },
      run: (args) => getCapabilities(deps, ctx, args),
    },
    {
      name: 'delegate_to_agent',
      description: 'Delega uma tarefa a um agente colaborador e retorna o resultado dele. Informe o objetivo claro e, se útil, um input.',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'id do agente alvo' },
          objective: { type: 'string', description: 'o que o agente deve fazer' },
          // Any JSON value: a string, or the object/array the caller already has.
          // `additionalProperties: true` is what lets an OBJECT through — the
          // validator refuses unknown keys by default.
          input: { description: 'dados de entrada (texto ou JSON, opcional)', additionalProperties: true },
          format: { type: 'string', enum: ['text', 'markdown', 'json'], description: 'formato da resposta (opcional; padrão: o do agente alvo)' },
        },
        required: ['agentId', 'objective'],
        additionalProperties: false,
      },
      run: (args) => delegateToAgent(deps, ctx, args),
    },
    {
      name: 'delegate_to_sector',
      description: 'Delega uma tarefa a um setor (equipe). Orquestrado: o coordenador conduz e aciona os membros. Pipeline: as etapas rodam em ordem encadeando resultados. Setores de organização não executam.',
      inputSchema: {
        type: 'object',
        properties: {
          sectorId: { type: 'string', description: 'id do setor' },
          objective: { type: 'string', description: 'o que a equipe deve fazer' },
          input: { description: 'dados de entrada (texto ou JSON, opcional)', additionalProperties: true },
          format: { type: 'string', enum: ['text', 'markdown', 'json'], description: 'formato da resposta (opcional)' },
        },
        required: ['sectorId', 'objective'],
        additionalProperties: false,
      },
      run: (args) => delegateToSector(deps, ctx, args),
    },
  ]
}

// Whether an agent should be offered delegation tools at all. Driven by the explicit
// outgoing policy, so a fresh manager (delegationPolicy='all') can delegate even with
// empty id lists, and a leaf ('none') never gets the tools.
export function agentCanDelegate(agent: Agent): boolean {
  return agent.delegationPolicy !== 'none'
}

// ---- capability_missing -----------------------------------------------------
// When no capable agent or tool exists for a task, the model must NOT invent an
// answer — it reports the gap here. Pure: task + missing capability → a structured
// outcome carrying the preset to hire, which the UI turns into a prefilled
// "Contratar agente" button. (goal §"Se não houver agente/ferramenta capaz")
export interface CapabilityMissing {
  status: 'capability_missing'
  task: string
  missingCapability: string
  missingTool: string | null
  suggestedPreset: string
  suggestedPresetLabel: string
}

export function buildCapabilityMissing(task: string, capability: string, tool?: string | null): CapabilityMissing {
  const preset = suggestPresetForCapability(capability || tool || '')
  return {
    status: 'capability_missing',
    task: task.trim(),
    missingCapability: capability.trim(),
    missingTool: tool?.trim() || null,
    suggestedPreset: preset,
    suggestedPresetLabel: presetSpec(preset).label,
  }
}

// Escape-hatch tool offered to every task-context agent (delegating or not).
export function capabilityMissingTool(): ResolvedTool {
  return {
    name: 'report_capability_missing',
    description:
      'Use quando NÃO existir agente colaborador nem ferramenta capaz de cumprir a tarefa. Não invente: relate a lacuna. Informe a tarefa, a competência que falta e, se aplicável, a ferramenta ausente.',
    // Relatar uma lacuna não muda nada no mundo. Sem risco declarado ela contava como
    // ESCRITA — e risco de escrita bloqueia paralelismo, impede nova tentativa depois de
    // uma falha e, agora, promove o agente ao modelo caro. Três decisões erradas por um
    // campo ausente.
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'a tarefa que não pôde ser cumprida' },
        missingCapability: { type: 'string', description: 'a competência que falta (ex: pesquisa web, envio de e-mail)' },
        missingTool: { type: 'string', description: 'ferramenta específica ausente (opcional)' },
      },
      required: ['task', 'missingCapability'],
      additionalProperties: false,
    },
    run: async (args) => {
      const task = typeof args.task === 'string' ? args.task : ''
      const capability = typeof args.missingCapability === 'string' ? args.missingCapability : ''
      const tool = typeof args.missingTool === 'string' ? args.missingTool : null
      if (!task || !capability) return { ok: false, result: j({ status: 'error', reason: 'task e missingCapability são obrigatórios' }) }
      return { ok: true, result: j(buildCapabilityMissing(task, capability, tool)) }
    },
  }
}
