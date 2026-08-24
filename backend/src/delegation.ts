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
import { breadthNotice, buildRetrievalQuery, formatContextWithSources, multiSourceNotice } from './retrievalQuery.js'
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
import { coordinatorBriefing } from './sectorBriefing.js'
import { NOOP_TRACKER, instrumentTools } from './agentLiveTracker.js'
import { ROLE_LABEL, capabilitiesOf, roleOf } from './agentCapabilities.js'
import { preview, traceEvent } from './executionTrace.js'
import { activeSearchProvider, configuredProviderName } from './webSearch/provider.js'
import { normalizeWebSearch, shouldSearch, wantsCurrentInfo } from './webSearch/policy.js'
import { recordSearchEvent } from './webSearch/budget.js'
import type { WebSearchSettings } from './webSearch/policy.js'
import { runWebSearch } from './webSearch/run.js'
import type { TraceInput } from './executionTrace.js'
import type { LiveTracker } from './agentLiveTracker.js'
import {
  MAX_ORCHESTRATION_ROUNDS,
  MAX_TASKS,
  MAX_TASKS_TOTAL,
  ORCHESTRATION_TIMEOUT_MS,
  assembleWithoutModel,
  buildSynthesisContext,
  dedupeAgainst,
  describeBinding,
  describeDiagnostics,
  matchedCapabilities,
  planIdOf,
  schemaHash,
  describePlan,
  memberScore,
  haltingFailure,
  inputForTask,
  limitationNote,
  parseSufficiency,
  planExecution,
  readyTasks,
  shouldRun,
  stepOutputs,
  wantsReplan,
  sufficiencyPrompt,
  synthesisInstruction,
  taskKey,
} from './sectorPlanner.js'
import type { ExecutionPlan, ExecutionTask, Sufficiency, TaskResult } from './sectorPlanner.js'
import { agentContractOf } from './executors/contract.js'
import { dispatchAgentExecution } from './executors/dispatcher.js'
import { describeStepError, finishStep, prepareStepInput, stepAgentOf } from './executors/stepExecution.js'

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
  /**
   * A trilha desta execução, para o painel de acompanhamento. Vem do cliente ANTES de a
   * execução existir — é o que permite acompanhar sem esperar a resposta. Ausente = não
   * há ninguém olhando, e nada é emitido.
   */
  traceId?: string | null
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
    traceId: ctx.traceId ?? null,
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
  /** A trilha para o painel. Ausente = ninguém está olhando. */
  traceId?: string | null
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
    traceId: opts.traceId ?? null,
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
  // `routingDescription` é o que o dono escreveu sobre QUANDO mandar para este membro —
  // é a melhor frase que existe para o coordenador escolher a quem delegar.
  members: { agentId: ObjectId; isDefault?: boolean; routingDescription?: string }[]
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
  /**
   * O balão de quem está EXECUTANDO — outra coisa do que `reportState`, que marca quem
   * DELEGOU ("delegando…"). Sem isto, o mapa mostrava o coordenador delegando e o
   * especialista parado, sendo que o trabalho estava justamente com ele.
   *
   * Opcional para este módulo continuar testável sem banco; ausente = não instrumenta.
   */
  trackerFor?: (ownerId: string, agentId: ObjectId, floorId: ObjectId | null, rootExecutionId: string) => LiveTracker
  /**
   * O modelo auxiliar que distribui o pedido entre os membros. Injetado para este
   * módulo não conhecer provedor nenhum — e opcional: sem ele o plano é determinístico.
   */
  planWithModel?: (ownerId: string, coordinator: Agent, prompt: string) => Promise<string>
  /**
   * Os TÍTULOS dos documentos de um agente. Ajudam a escolher quem tem o dado, sem
   * abrir o dado: nenhum trecho de base passa por aqui.
   */
  knowledgeTitlesFor?: (ownerId: string, agentId: ObjectId) => Promise<string[]>
  /**
   * "A base deste agente está atualizada o bastante para ele trabalhar?"
   *
   * A orquestração não sabe o que é um crawler: ela pergunta antes de executar a tarefa, e
   * quem decide — modo, intervalo, idade do que está guardado — é o gerente de fontes.
   * Injetado, opcional, e na maioria das vezes a resposta não custa nada.
   */
  ensureWebKnowledgeFresh?: (ownerId: string, agentId: ObjectId) => Promise<unknown>
  /**
   * A primeira leitura de uma base vazia, em qualquer modo. Só é chamada quando a busca
   * já voltou sem nada — nunca antes.
   */
  bootstrapWebKnowledge?: (ownerId: string, agentId: ObjectId) => Promise<unknown>
  /**
   * Guarda na base as páginas que a busca leu. Injetada porque escreve no banco, e este
   * módulo é puro. Ausente = a busca funciona e nada é guardado.
   */
  rememberSearchPages?: (
    ownerId: string,
    agentId: ObjectId,
    query: string,
    pages: unknown[],
    rememberDays: number,
  ) => Promise<{ saved: number; updated: number; unchanged: number }>
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
    sources?: { documentId: string | null; title: string | null; origin?: 'manual' | 'web' | 'search'; capturedAt?: string | null }[]
    status?: string
    failed?: boolean
    /** Quantos trechos correspondiam, quando dá para saber — ver `knowledge.ts`. */
    totalMatches?: number
  }>
}

interface TaskRun {
  output: string
  /**
   * O DADO, quando o agente produz dado.
   *
   * O texto sempre existiu; o dado era descartado aqui e reconstruído mais adiante por
   * quem precisasse dele — reparseando uma string que já tinha sido um objeto. Carregá-lo
   * é o que permite a etapa seguinte ler `$steps.t1.campo` em vez de procurar o número
   * dentro da prosa.
   */
  json?: unknown
  format?: { requested: string; valid: boolean; repaired: boolean }
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
  sources?: { documentId: string | null; title: string | null; origin?: 'manual' | 'web' | 'search'; capturedAt?: string | null }[]
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
/**
 * Quantas correções de formato uma tarefa ganha do modelo.
 *
 * Uma, que é o que sempre houve. Configurável porque as duas pontas são escolhas
 * legítimas: zero para quem quer o contrato ou nada, e mais de uma para um contrato
 * grande que o modelo acerta na segunda. Cada uma é uma inferência paga — por isso um
 * teto, e não um laço. Opcional: sem a variável, o comportamento é o de antes.
 */
const MAX_OUTPUT_REPAIRS = Math.max(0, Number(process.env.MAX_OUTPUT_REPAIRS ?? 1) || 0)
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
//
// Exportada porque é AQUI que se decide quem consulta base, quem recebe fonte viva e
// quem acende o balão de leitura — as três coisas que a divisão de papéis governa. Testar
// isso por fora exigiria montar um setor inteiro para observar uma decisão que mora nesta
// função.
export async function runAgentTask(
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
  // Quem está na equipe, para o coordenador. Vem separado do pedido de propósito: é
  // instrução, e NÃO pode entrar na busca de conhecimento — a consulta passaria a casar
  // com nomes e competências dos membros em vez da pergunta que foi feita.
  briefing?: string | null,
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
  // O balão deste agente. A raiz é a mesma da cadeia: o mapa não soma execuções
  // diferentes, e o estado morre com ela (TTL na projeção).
  const tracker =
    deps.trackerFor?.(ctx.ownerId, target._id, target.officeId ?? null, (ctx.rootExecutionId ?? ctx.correlationId).toString()) ??
    NOOP_TRACKER
  tracker.report('thinking')
  const tools = instrumentTools(await deps.resolveTools(target, ctx.ownerId, cctx), tracker, (evento) => {
    if (!ctx.traceId) return
    traceEvent({
      ownerId: ctx.ownerId,
      executionId: ctx.traceId,
      type: 'tool',
      status: evento.ok ? 'success' : 'error',
      agentId: target._id.toString(),
      title: `${target.name}: ${evento.name}`,
      input: evento.args,
      output: evento.ok ? preview(String(evento.result ?? ''), 400) : undefined,
      durationMs: evento.durationMs,
      metadata: { tool: evento.name, ...(evento.error ? { error: evento.error } : {}) },
    })
  })
  const apiKey = await deps.apiKeyFor(ctx.ownerId, target.provider)
  // Curated grounding: the executor's own base, plus the sector's ONLY when this run
  // has an explicit sector context (never implied by the agent's home sector).
  // The question includes the objective AND the input, serialized when it is an
  // object — a delegation that hands over JSON used to retrieve nothing.
  /**
   * A base viva do agente, ANTES de perguntar a ela.
   *
   * Esta ordem é o conserto: a recuperação rodava primeiro, achava a base vazia e —
   * quando o agente exige fundamentação — a execução parava com `GroundingRequiredError`
   * sem NUNCA ter passado pelo site. O agente tinha a fonte configurada, o site tinha a
   * resposta, e ninguém foi lá.
   *
   * Quem decide se vale a leitura é a política da fonte (`webSourcePolicy`): `manual` não
   * lê, `scheduled` é do relógio, `on_demand`/`hybrid` leem quando o que está guardado
   * envelheceu. Na maioria das chamadas isso não custa nada — e nunca derruba a execução:
   * sem conseguir atualizar, o agente trabalha com o que já tem.
   */
  /**
   * O que este TIPO de agente faz — decidido antes de qualquer busca.
   *
   * Um analista analisa o que RECEBE: buscar base própria aqui é o caminho curto para uma
   * análise isolada, feita sobre o que ele mesmo guardou em vez de sobre as evidências
   * que lhe foram entregues. Um coordenador que consulta base vira mais um pesquisador.
   * Quem sabe o que quer liga a base à mão (`knowledgeEnabled`), e aí ela volta.
   */
  const capacidades = capabilitiesOf(target)
  if (ctx.traceId) {
    traceEvent({
      ownerId: ctx.ownerId,
      executionId: ctx.traceId,
      type: 'agent',
      status: 'info',
      agentId: target._id.toString(),
      title: `${target.name} — ${ROLE_LABEL[capacidades.role]}`,
      input: preview(typeof input === 'string' ? input : input ? JSON.stringify(input) : '', 300),
      metadata: {
        agentType: capacidades.role,
        preset: target.preset ?? 'custom',
        knowledge: capacidades.knowledge,
        webSources: capacidades.webSources,
        tools: tools.length,
        reason: capacidades.summary,
      },
    })
  }

  if (deps.ensureWebKnowledgeFresh && capacidades.webSources) {
    const antesDaFonte = Date.now()
    // O começo, e não só o resultado: quando um site demora, o painel precisa mostrar
    // que a espera é a leitura da fonte — e não o agente pensando.
    if (ctx.traceId) {
      traceEvent({
        ownerId: ctx.ownerId,
        executionId: ctx.traceId,
        type: 'rag',
        status: 'running',
        agentId: target._id.toString(),
        title: `${target.name}: verificando fontes web`,
      })
    }
    const fontes = (await deps.ensureWebKnowledgeFresh(ctx.ownerId, target._id).catch(() => [])) as
      | {
          name: string
          refreshed: boolean
          reason: string
          discovered?: number
          created: number
          updated: number
          unchanged: number
          ignored?: number
          via?: string
          error?: string
          reads?: {
            url: string
            method: string
            ok: boolean
            code?: string
            reason?: string
            fallbackReason?: string
            kind?: string
            usefulChars?: number
            durationMs?: number
            contentType?: string
            links?: number
            retryAfterSeconds?: number
            strategies?: { strategy: string; ok: boolean; code?: string; reason: string; durationMs: number }[]
          }[]
        }[]
      | undefined
    // Uma leitura que FALHOU volta com `refreshed: false` — ela não mexeu em nada. Mas é
    // justamente ela que precisa aparecer: sem isto, o site fora do ar era invisível, e a
    // resposta com dado velho passava por resposta atual.
    const mexidas = (fontes ?? []).filter((f) => f.refreshed || f.error)
    const comFalha = mexidas.filter((f) => f.error)
    if (comFalha.length > 0) {
      // Não derruba nada: o agente responde com o que já está na base. Mas fica dito, no
      // log e no painel — uma resposta com dado velho por causa de um site fora do ar não
      // pode passar por resposta atual.
      console.warn(
        `[web-source] agent=${target._id.toString()} falha ao atualizar: ` +
          comFalha.map((f) => `${f.name} (${f.error})`).join(', ') +
          ' — respondendo com o que já está na base',
      )
    }
    if (mexidas.length > 0 && ctx.traceId) {
      const totais = mexidas.reduce(
        (soma, f) => ({ novos: soma.novos + f.created, atualizados: soma.atualizados + f.updated, iguais: soma.iguais + f.unchanged }),
        { novos: 0, atualizados: 0, iguais: 0 },
      )
      traceEvent({
        ownerId: ctx.ownerId,
        executionId: ctx.traceId,
        type: 'rag',
        status: mexidas.some((f) => f.error) ? 'error' : 'success',
        agentId: target._id.toString(),
        title:
          comFalha.length > 0
            ? `${target.name}: falha ao atualizar fonte — respondendo com a base anterior`
            : `${target.name}: fontes web — ${totais.novos} nova(s), ${totais.atualizados} atualizada(s), ${totais.iguais} sem mudança`,
        durationMs: Date.now() - antesDaFonte,
        metadata: {
          sources: mexidas.map((f) => ({
            name: f.name,
            via: f.via ?? null,
            reason: f.reason,
            discovered: f.discovered ?? 0,
            new: f.created,
            updated: f.updated,
            unchanged: f.unchanged,
            error: f.error ?? null,
          })),
          // A LEITURA, e não só o resultado: por HTTP ou por navegador, o que a página
          // era, quantos caracteres úteis vieram e — quando falhou — o motivo com nome.
          // Sem isto, "0 novos" tem a mesma cara de "0 lidos".
          reads: mexidas.flatMap((f) =>
            (f.reads ?? []).slice(0, 8).map((r) => ({
              url: r.url,
              method: r.method,
              ok: r.ok,
              kind: r.kind ?? null,
              usefulChars: r.usefulChars ?? 0,
              code: r.code ?? null,
              reason: r.reason ?? null,
              fallbackReason: r.fallbackReason ?? null,
              durationMs: r.durationMs ?? null,
              contentType: r.contentType ?? null,
              links: r.links ?? 0,
              // O caminho inteiro da tentativa: HTTP, veredito, navegador. É isto que
              // separa "não achei nada" de "não consegui olhar".
              strategies: r.strategies ?? [],
              ...(r.retryAfterSeconds !== undefined ? { retryAfterSeconds: r.retryAfterSeconds } : {}),
            })),
          ),
        },
      })
    }
  }

  const query = buildRetrievalQuery({ objective, input })
  // O balão só acende para quem realmente vai procurar. Ele acendia para todo mundo, e
  // o mapa mostrava o analista e o coordenador "consultando a base" — trabalho que não
  // estava acontecendo. Um painel que relata o que não houve é tão ruim quanto o
  // comportamento errado: manda investigar no lugar errado.
  if (query && deps.retrieveContext && capacidades.knowledge) tracker.report('reading_knowledge')
  // A rejected promise is 'unavailable', not "no knowledge": the two must never be
  // confused, and only the first one is a reason to refuse.
  const buscar = async () =>
    query && deps.retrieveContext && capacidades.knowledge
      ? await deps
          .retrieveContext(target._id, query, { sectorId: sectorId ?? null })
          .catch(() => ({ context: [], sources: [], status: 'unavailable', failed: true }))
      : { context: [], sources: [], status: 'no_base' as const, failed: false }
  const leitura = (r: Awaited<ReturnType<typeof buscar>>) => {
    const passagens = Array.isArray(r) ? (r as string[]) : (r.context ?? [])
    return {
      passages: passagens,
      sources: Array.isArray(r) ? [] : (r.sources ?? []),
      grounding:
        (Array.isArray(r) ? undefined : r.status) ?? (!Array.isArray(r) && r.failed ? 'unavailable' : passagens.length ? 'ok' : 'empty'),
      total: Array.isArray(r) ? undefined : (r as { totalMatches?: number }).totalMatches,
    }
  }

  let retrieved = await buscar()
  let { passages, sources, grounding, total: totalMatches } = leitura(retrieved)

  /**
   * A PRIMEIRA leitura de uma base vazia — mesmo quando o modo diz "não fique lendo".
   *
   * Um pesquisador com site cadastrado e nenhum documento não tem o que responder: a
   * busca volta vazia e, se ele exige fundamentação, a tarefa morre antes de começar.
   * `manual` e `scheduled` querem dizer "não leia a toda hora", não "nunca leia" — então,
   * com a base zerada, a fonte é lida uma vez e a busca é REFEITA. Da segunda em diante o
   * modo volta a mandar, porque a fonte já produziu conhecimento.
   */
  // Qualquer resultado que NÃO seja utilizável dispara a tentativa: numa instalação sem
  // busca vetorial, base vazia responde `unavailable` ("não consegui procurar") e não
  // `empty` — e exigir `empty` deixava justamente o caso real de fora. Chamar demais aqui
  // não custa: o gerente só lê a fonte que ainda não produziu nada.
  if (grounding !== 'ok' && deps.bootstrapWebKnowledge && query && capacidades.knowledge) {
    const comecouBootstrap = Date.now()
    const iniciadas = ((await deps.bootstrapWebKnowledge(ctx.ownerId, target._id).catch(() => [])) ?? []) as {
      name: string
      refreshed: boolean
      reason: string
      discovered?: number
      created: number
      updated: number
      unchanged: number
      error?: string
    }[]
    const produziu = iniciadas.filter((f) => f.created > 0 || f.updated > 0)
    if (ctx.traceId && iniciadas.some((f) => f.refreshed || f.error)) {
      traceEvent({
        ownerId: ctx.ownerId,
        executionId: ctx.traceId,
        type: 'rag',
        status: produziu.length > 0 ? 'success' : iniciadas.some((f) => f.error) ? 'error' : 'info',
        agentId: target._id.toString(),
        title:
          produziu.length > 0
            ? `${target.name}: base estava vazia — primeira leitura trouxe ${produziu.reduce((n, f) => n + f.created, 0)} documento(s)`
            : `${target.name}: base vazia e a primeira leitura não trouxe nada`,
        durationMs: Date.now() - comecouBootstrap,
        metadata: {
          bootstrap: true,
          sources: iniciadas.map((f) => ({
            name: f.name,
            reason: f.reason,
            discovered: f.discovered ?? 0,
            new: f.created,
            updated: f.updated,
            unchanged: f.unchanged,
            error: f.error ?? null,
          })),
        },
      })
    }
    if (produziu.length > 0) {
      // A busca é refeita: sem isto, a leitura teria acontecido tarde demais para ESTA
      // pergunta — e o agente responderia sem o que acabou de chegar.
      retrieved = await buscar()
      ;({ passages, sources, grounding, total: totalMatches } = leitura(retrieved))
      if (ctx.traceId) {
        traceEvent({
          ownerId: ctx.ownerId,
          executionId: ctx.traceId,
          type: 'rag',
          status: grounding === 'ok' ? 'success' : 'info',
          agentId: target._id.toString(),
          title: `${target.name}: base consultada de novo — ${passages.length} trecho(s)`,
          metadata: { grounding, passages: passages.length, retry: true },
        })
      }
    }
  }
  // Só quem PROCURA aparece com um evento de base. O painel emitia um para todo agente
  // com pergunta, então o plano mostrava o analista e o coordenador consultando —
  // exatamente o que a divisão de papéis existe para impedir.
  if (ctx.traceId && query && capacidades.knowledge) {
    // O que a busca fez, sem o que ela leu: títulos e quantidade dizem se o agente tinha
    // base, e o conteúdo dela não é assunto de painel.
    traceEvent({
      ownerId: ctx.ownerId,
      executionId: ctx.traceId,
      type: 'rag',
      status: grounding === 'ok' ? 'success' : grounding === 'unavailable' ? 'error' : 'info',
      agentId: target._id.toString(),
      title: `${target.name}: base — ${grounding === 'ok' ? `${passages.length} trecho(s)` : grounding === 'unavailable' ? 'não foi possível consultar' : grounding === 'empty' ? 'nada encontrado' : 'sem base'}`,
      input: preview(query, 200),
      metadata: {
        grounding,
        passages: passages.length,
        sources: sources.map((f) => f.title).filter(Boolean),
        // De ONDE veio a evidência. Para quem pergunta, manual e web são a mesma coisa —
        // a resposta. Para quem confere, não: um número lido de um site tem hora de
        // captura e endereço para voltar. Sem isto, uma resposta que mistura os dois não
        // dá para auditar.
        origins: {
          manual: sources.filter((f) => f.origin === 'manual').length,
          web: sources.filter((f) => f.origin === 'web').length,
        },
      },
    })
  }
  /**
   * PROCURAR páginas novas, quando a base não bastou — e só quem coleta.
   *
   * A ordem é a que economiza: a base já respondeu (ou não) acima, e é essa resposta que
   * decide se vale procurar fora. Buscar antes seria pagar por uma pergunta que o próprio
   * agente já sabia responder.
   *
   * Nada disto acontece com o interruptor desligado, que é o padrão, nem para analista,
   * coordenador ou executor — a capacidade não existe para eles.
   */
  const buscaWeb: WebSearchSettings = normalizeWebSearch(target.webSearch)
  const provedorDeBusca = capacidades.webSearch ? activeSearchProvider() : null
  const evidenciasDaWeb: string[] = []
  if (capacidades.webSearch && query) {
    // O que a base respondeu veio SÓ de páginas que um buscador trouxe? A distinção
    // decide se uma pergunta sobre "agora" pode ser respondida com o que está guardado.
    const soMemoriaDeBusca = sources.length > 0 && sources.every((f) => f.origin === 'search')
    const decisao = shouldSearch(buscaWeb, {
      grounding,
      passages: passages.length,
      canSearch: Boolean(provedorDeBusca),
      wantsCurrent: wantsCurrentInfo(query),
      onlySearchMemory: soMemoriaDeBusca,
    })
    if (decisao.search && provedorDeBusca) {
      tracker.report('reading_knowledge')
      const r = await runWebSearch(provedorDeBusca, query, buscaWeb)
      // A data de captura vai JUNTO da evidência: sem ela, um trecho que diz "hoje" é
      // lido como se fosse de hoje, qualquer que seja o dia em que foi escrito.
      const lidoEm = new Date().toISOString().slice(0, 10)
      for (const e of r.evidence) evidenciasDaWeb.push(`[${e.title}] · lido em ${lidoEm}\nFonte: ${e.url}\n\n${e.text}`)
      if (r.evidence.length > 0) grounding = 'ok'

      // O que foi lido vira memória do agente: a próxima pergunta parecida encontra isto
      // na base, e a requisição ao buscador nem sai.
      const guardado =
        deps.rememberSearchPages && r.pages.length > 0
          ? await deps.rememberSearchPages(ctx.ownerId, target._id, query, r.pages, buscaWeb.rememberDays).catch(() => null)
          : null

      await recordSearchEvent({
        agentId: target._id.toString(),
        ownerId: ctx.ownerId,
        provider: r.provider,
        query,
        // A franquia barrou = a requisição NÃO saiu e não gastou. Gravar isso como busca
        // feita mostrava consumo que não existiu, e um agente parado por falta de cota
        // parecia um agente gastando.
        outcome: r.code === 'monthly_limit_reached' ? 'blocked' : 'sent',
        performed: r.code !== 'monthly_limit_reached',
        found: r.found,
        pagesRead: r.read.length,
        evidence: r.evidence.length,
        saved: (guardado?.saved ?? 0) + (guardado?.updated ?? 0),
        ok: r.ok,
        code: r.code ?? null,
        durationMs: r.durationMs,
      })
      if (ctx.traceId) {
        traceEvent({
          ownerId: ctx.ownerId,
          executionId: ctx.traceId,
          type: 'rag',
          status: r.ok ? (r.evidence.length > 0 ? 'success' : 'info') : 'error',
          agentId: target._id.toString(),
          title: r.ok
            ? `${target.name}: busca na web — ${r.found} resultado(s), ${r.read.length} página(s) lida(s), ${r.evidence.length} evidência(s)`
            : r.code === 'monthly_limit_reached'
              ? `${target.name}: a franquia mensal de busca acabou — respondendo com a base`
              : `${target.name}: a busca na web falhou — respondendo com o que já tinha`,
          input: preview(query, 200),
          durationMs: r.durationMs,
          metadata: {
            provider: r.provider,
            policy: buscaWeb.policy,
            reason: decisao.reason,
            found: r.found,
            // Só endereço e título: o conteúdo lido não é assunto de painel, e nenhuma
            // credencial passa por aqui.
            selected: r.selected.map((s) => ({ url: s.url, title: s.title, score: s.score })),
            read: r.read,
            evidence: r.evidence.map((e) => ({ url: e.url, title: e.title })),
            error: r.error ?? null,
            code: r.code ?? null,
          },
        })
      }
    } else if (buscaWeb.enabled) {
      // A busca EVITADA também é registrada: é ela que mostra a economia de ter memória.
      await recordSearchEvent({
        agentId: target._id.toString(),
        ownerId: ctx.ownerId,
        // O provedor em jogo, e não um nome fixo: uma instalação no adaptador genérico
        // via "brave" no painel sem nunca ter falado com o Brave.
        provider: configuredProviderName(),
        query,
        outcome: 'avoided',
        performed: false,
        skipReason: decisao.reason,
        found: 0,
        pagesRead: 0,
        evidence: 0,
        saved: 0,
        ok: true,
        durationMs: 0,
      })
    }
    if (!decisao.search && ctx.traceId && buscaWeb.enabled) {
      // Não procurou — e o motivo importa tanto quanto a busca. Sem isto, "não procurou"
      // e "procurou e não achou" ficam iguais no painel.
      traceEvent({
        ownerId: ctx.ownerId,
        executionId: ctx.traceId,
        type: 'rag',
        status: 'info',
        agentId: target._id.toString(),
        title: `${target.name}: busca na web não foi necessária`,
        metadata: { policy: buscaWeb.policy, reason: decisao.reason },
      })
    }
  }

  /**
   * "Só responder com base no conhecimento" — para quem TEM conhecimento a consultar.
   *
   * A regra vale onde quer que o agente rode. Mas para quem não consulta base por papel,
   * ela é impossível de satisfazer: a busca nem acontece, `grounding` é sempre 'no_base',
   * e o agente ficaria bloqueado para sempre — um analista que nunca analisa. A exigência
   * dele é outra, e já existe: ele precisa de ENTRADA, não de base.
   */
  if (target.requireGrounding && capacidades.knowledge && grounding !== 'ok') {
    // Ele parou, e parou por uma razão. `reportNow` porque o estado precisa estar
    // gravado antes do `throw` — senão a corrida deixa o balão "pensando" para sempre.
    await tracker.reportNow('blocked')
    await tracker.finish('failed')
    throw new GroundingRequiredError(grounding)
  }
  /**
   * Os endereços que o dono marcou para entrar sozinhos — para quem CONSULTA.
   *
   * Valem aqui porque delegação e etapa de setor são "o agente foi chamado" tanto quanto
   * uma conversa. Mas eram injetados em qualquer papel: um coordenador com uma fonte viva
   * recebia o conteúdo do site no prompt, o que é a mesma coisa que consultar base — pela
   * porta dos fundos. Quem analisa trabalha sobre o que recebe; quem conduz, sobre o que
   * o time trouxe.
   */
  const vivas = deps.livePassages && capacidades.knowledge ? await deps.livePassages(ctx.ownerId, target).catch(() => []) : []
  // Numbered references, so the answer can cite what it used. The owner is not named.
  // O aviso de amplitude vem ANTES das passagens: é o que decide entre responder e
  // perguntar, e depois delas já seria tarde.
  const aviso = breadthNotice(totalMatches, passages.length)
  const misturado = multiSourceNotice(sources)
  const context = [
    ...(aviso ? [aviso] : []),
    ...(misturado ? [misturado] : []),
    ...formatContextWithSources(passages, sources),
    ...vivas.map((v) => `[${v.title}]\n${v.content}`),
    // O que veio da busca: TRECHOS com procedência, nunca a página inteira. Página no
    // prompt custa token e piora a resposta — o que responde fica enterrado no menu.
    ...evidenciasDaWeb,
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

  tracker.report('responding')
  let res: Awaited<ReturnType<typeof deps.runTask>>
  try {
    res = await deps.runTask({
      // O objetivo é o do ALVO; o pedido delegado é a instrução da tarefa. Trocar os dois
      // faria o agente esquecer para que ele existe e virar executor do pedido da vez.
      objective: target.objective || objective,
      // Instruções do agente primeiro, pedido depois: as dele valem para todo trabalho,
      // o pedido é o do momento.
      instructions: [target.instructions?.trim(), briefing?.trim(), objective?.trim()].filter(Boolean).join('\n\n'),
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
        limits: { timeoutMs: TASK_TIMEOUT_MS, maxOutputChars: MAX_OUTPUT_CHARS, maxOutputRepairs: MAX_OUTPUT_REPAIRS },
    })
  } catch (erro) {
    // Nenhuma execução pode terminar num estado ativo: sem isto, um agente que falhou
    // continuaria "pensando" no mapa até o TTL expirar.
    const mensagem = erro instanceof Error ? erro.message : ''
    await tracker.finish(/cancel/i.test(mensagem) ? 'canceled' : 'failed')
    throw erro
  }
  await tracker.finish('completed')
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
  return { output: res.output, json: res.json, format: res.format, usage: res.usage, toolCalls: res.toolCalls.filter((c) => c.ok).length, startedAt, finishedAt: new Date(), telemetry, grounding, sources, model: execucao.model, modelReason: execucao.modelReason, clarification: clarificationFrom(res.toolCalls) }
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
  /** A trilha para o painel. Ausente = ninguém está olhando. */
  traceId?: string | null
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
    traceId: opts.traceId ?? null,
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
  sources?: { documentId: string | null; title: string | null; origin?: 'manual' | 'web' | 'search'; capturedAt?: string | null }[]
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
    // Devolve a EXECUÇÃO, não só o texto dela: o dado estruturado morria aqui, e a etapa
    // seguinte tinha que extraí-lo da prosa.
  ): Promise<TaskRun> => {
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
    return saida
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
        const out = (
          await rodarMembro(
            agent,
            instruction,
            input,
            (k) => runWithRetry(deps, ctx, agent, instruction, input, format, stage.retryPolicy.maxAttempts, k, sector._id),
            participationOf('pipeline_stage', { id: stage.id, name: stage.name, order }),
            { agentId: agent._id.toString(), name: agent.name, role: 'pipeline_stage', stageId: stage.id, stageName: stage.name, order },
          )
        ).output
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
  // O time que o coordenador alcança durante ESTA execução: os membros do próprio
  // setor, menos ele. Nada global é aberto, e o filho não herda o direito.
  const outros = sector.members.filter((m) => m.agentId.toString() !== coordinator._id.toString())
  const grant = {
    sectorId: sector._id.toString(),
    memberIds: outros.map((m) => m.agentId.toString()),
  }

  /**
   * A equipe deixa de ser algo a descobrir.
   *
   * O direito de chamar os membros já era concedido; a informação de que eles existem,
   * não. O coordenador recebia o próprio objetivo e o pedido — e um modelo que não sabe
   * que tem equipe responde sozinho. Como coordenador quase nunca tem base própria, ele
   * respondia sozinho e errado, com o dado na base de um colega do mesmo setor.
   *
   * Agora a lista vai escrita, com id e função de cada um. Isso também POUPA: sem ela,
   * chegar a um especialista custava uma chamada de descoberta antes da delegação.
   */
  const equipe = (await Promise.all(outros.map((m) => deps.loadAgent(ctx.ownerId, m.agentId).catch(() => null))))
    .map((agente, i) => {
      if (!agente) return null
      // Lido pelo mesmo caminho leniente da fase 1: um agente criado antes de qualquer um
      // destes campos existir lê como sempre leu, e chega aqui com o contrato padrão.
      const contrato = agentContractOf(agente)
      return {
            agentId: agente._id.toString(),
            name: agente.name,
            // O que o dono escreveu no MEMBRO manda; o do agente é o padrão. Um setor que
            // já tem a frase não muda em nada, e um agente sem setor deixa de ficar mudo.
            routingDescription: outros[i].routingDescription || agente.routingDescription || null,
            role: agente.role ?? null,
            // O TIPO funcional, para o planejador não tratar quem analisa como quem coleta.
            type: roleOf(agente.preset),
            objective: agente.objective ?? null,
            instructions: agente.instructions ?? null,
            capabilities: agente.capabilities ?? null,
            // O que ele CONSEGUE fazer, e não só o que sabe. Nomes, nunca credenciais.
            // "busca_na_web" entra como capacidade: sem isso o planejador manda uma
            // pergunta sobre algo ATUAL para quem só alcança o que já está guardado.
            tools: [
              ...(agente.tools ?? []).map((t) => t.name),
              ...(agente.builtinTools ?? []).map((t) => t.key),
              ...(capabilitiesOf(agente).webSearch ? ['busca_na_web'] : []),
            ],
            // As ações de App autorizadas — referência, nunca credencial.
            actions: (agente.appGrants ?? []).flatMap((g) => g.actionKeys.map((k) => `${g.appKey}.${k}`)),
            /**
             * O CONTRATO, e não só a descrição.
             *
             * Escolher por nome e por prosa é como o plano acabava mandando a pergunta para
             * quem tinha o rótulo certo e a capacidade errada. Com o tipo de executor e os
             * schemas na mesa, o planejador sabe quem aceita campos em vez de prosa, quem
             * produz o que o outro precisa, e quando não existe ninguém que produza.
             */
            executorKind: contrato.executorKind,
            inputJsonSchema: contrato.inputJsonSchema,
            outputJsonSchema: contrato.outputJsonSchema,
            executorConfig:
              contrato.executorConfig.kind === 'function'
                ? { functionName: contrato.executorConfig.functionName, ...(contrato.executorConfig.version ? { version: contrato.executorConfig.version } : {}) }
                : contrato.executorConfig.kind === 'tool'
                  ? { ...contrato.executorConfig }
                  : null,
            // Só os TÍTULOS: o conteúdo da base não sai daqui, nem para escolher.
            knowledgeTitles: null as string[] | null,
      }
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
  // Os títulos da base de cada membro, quando quem chamou sabe buscá-los. É o sinal mais
  // direto de "quem tem o dado" — e continua sendo só título, nunca trecho.
  if (deps.knowledgeTitlesFor) {
    await Promise.all(
      equipe.map(async (m) => {
        m.knowledgeTitles = await deps.knowledgeTitlesFor!(ctx.ownerId, new ObjectId(m.agentId)).catch(() => null)
      }),
    )
  }
  if (equipe.length === 0) {
    // Sem isto o teste mostrava um único participante e parecia quebrado. Está
    // funcionando: não há mais ninguém no setor para acionar.
    warnings.push('setor orquestrado sem outros membros: o coordenador respondeu sozinho')
  }
  /**
   * O PLANO, antes de qualquer trabalho.
   *
   * Aqui estava o buraco que sobrou: o coordenador tinha as ferramentas e a lista da
   * equipe, mas a decisão de acionar alguém continuava sendo um impulso no meio da
   * resposta — e um modelo que recebe uma pergunta respondível responde. Agora a
   * distribuição é um passo declarado: quem trabalha, com que objetivo, e quem espera
   * por quem. Uma pergunta simples continua selecionando um só.
   *
   * Sem `planWithModel` (instalação sem modelo auxiliar, teste sem dublê) o plano sai
   * determinístico — setores existentes continuam funcionando igual.
   */
  /**
   * Os tetos deste coordenador — dentro dos tetos do sistema.
   *
   * Cada tarefa é uma inferência inteira, com a base e as ferramentas de um agente. Quem
   * paga a conta escolhe quantas; o sistema é que diz o máximo. Ausente = o padrão, que é
   * o comportamento de sempre.
   */
  const limites = coordinator.orchestration ?? {}
  const tetoDeTarefas = Math.min(limites.maxTasks ?? MAX_TASKS, MAX_TASKS)
  const tetoDeRodadas = Math.min(limites.maxRounds ?? MAX_ORCHESTRATION_ROUNDS, MAX_ORCHESTRATION_ROUNDS)
  const { plan, source: origemDoPlano, diagnostics, clarification: faltaDeDado } = await planExecution({
    question: opts.objective,
    members: equipe,
    ask: deps.planWithModel ? (prompt) => deps.planWithModel!(ctx.ownerId, coordinator, prompt) : undefined,
    max: tetoDeTarefas,
  })
  /**
   * O que a compilação apontou.
   *
   * O diagnóstico vai para o log de quem administra — é lá que ele serve. O ESCLARECIMENTO
   * vai para a resposta: quando um dado que ninguém produz é o que falta, quem perguntou
   * precisa saber disso em vez de receber um número que o agente completou sozinho.
   */
  if (diagnostics?.length) console.info(`[plan:diagnostics] sector=${sector._id.toString()} ${describeDiagnostics(diagnostics)}`)
  if (faltaDeDado) warnings.push(faltaDeDado)
  const briefing = coordinatorBriefing(sector.name, equipe, plan)
  const instruction = sector.instruction ? `${sector.instruction}\n\n${opts.objective}` : opts.objective

  /**
   * A rede de segurança do conhecimento — para QUEM CONSULTA.
   *
   * Ela nasceu para o coordenador: ele não tem base própria, e se não delegasse, a
   * resposta sairia "não tenho esses dados" com o dado guardado na base de um colega. Essa
   * justificativa envelheceu: hoje o coordenador não consulta base nenhuma, por regra — o
   * gate de capacidades o impede antes de chegar aqui.
   *
   * O que sobrou é o caso real: um PESQUISADOR cuja própria base não tem a resposta, e a
   * de um colega do mesmo setor tem. Ele continua sendo quem procura — só procura em mais
   * lugares. Os outros papéis nem chegam a esta função.
   *
   * Continua dentro do escopo já autorizado: os membros deste setor, desta conta.
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
          // Sem o coordenador: ele não coleta, então a base dele não é fonte de nada —
          // incluí-la era consultar, por outro caminho, exatamente quem não consulta.
          const doTime = await deps.retrieveContext!(colegas, query, o)
          // Só substitui quando o time REALMENTE achou: um 'empty' do time não pode
          // apagar um 'unavailable' da base própria, que significa outra coisa.
          return achou(doTime) ? doTime : propria
        },
      }
    : deps

  /**
   * O RUNTIME executa o plano — o coordenador não precisa lembrar de fazê-lo.
   *
   * Antes: coordenador chama A, gosta da resposta, e B nunca é consultado. O plano
   * existia e podia ser ignorado no meio de uma inferência. Agora as tarefas rodam aqui,
   * em ondas: tudo que não depende de ninguém sai junto, e quem depende espera pelo que
   * precisa — a mesma ideia das etapas de um pipeline, só que o grafo é descoberto para
   * esta pergunta.
   *
   * Cada tarefa passa pelo executor normal do agente (`runAgentTask`): o provedor dele, o
   * modelo dele, as instruções dele, as ferramentas dele e a base dele. Nada aqui
   * substitui a configuração de ninguém.
   *
   * Sem plano — setor sem outros membros, instalação antiga — nada disto acontece e o
   * coordenador responde como sempre respondeu.
   */
  const nomePorAgente = new Map(equipe.map((m) => [m.agentId, m.name]))
  const inicioDaOrquestracao = Date.now()
  // O painel recebe os mesmos momentos que o log — quando há alguém olhando. Sem
  // `traceId` nada é emitido, e a execução não paga por observabilidade que ninguém pediu.
  const trilha = (entrada: Omit<TraceInput, 'ownerId' | 'executionId'>) => {
    if (!ctx.traceId) return
    traceEvent({ ...entrada, ownerId: ctx.ownerId, executionId: ctx.traceId })
  }
  const prazo = inicioDaOrquestracao + ORCHESTRATION_TIMEOUT_MS
  const execId = sectorExecutionId?.toString() ?? ctx.correlationId

  const rodarTarefa = async (task: ExecutionTask): Promise<TaskResult> => {
    const agentName = nomePorAgente.get(task.agentId) ?? 'membro'
    const base = { taskId: task.id, agentId: task.agentId, agentName, objective: task.objective, dependsOn: task.dependsOn ?? [] }
    const comecou = Date.now()
    const alvo = await deps.loadAgent(ctx.ownerId, new ObjectId(task.agentId)).catch(() => null)
    if (!alvo) {
      trilha({ type: 'agent', status: 'error', agentId: task.agentId, title: `${agentName}: agente não encontrado` })
      return { ...base, status: 'failed', error: 'agente não encontrado', durationMs: 0 }
    }
    // A mesma proteção da delegação: um agente que já está na cadeia não entra de novo,
    // por mais que o plano peça. É o que impede recursão sem fim entre setores.
    if (inChain(alvo._id)) {
      trilha({ type: 'agent', status: 'skipped', agentId: task.agentId, title: `${agentName}: já está na cadeia (ciclo evitado)` })
      return { ...base, status: 'skipped', error: 'ciclo de delegação', durationMs: 0 }
    }

    /**
     * A FICHA da etapa — montada uma vez, usada nos dois destinos.
     *
     * O painel e o registro de execução contavam a mesma história com vocabulários
     * diferentes, e nenhum dos dois dizia COMO a etapa foi executada. Investigar "por que
     * este agente" ou "quanto custou a função" exigia ler o log do servidor.
     *
     * Só escalares e nomes: tipo de executor, referência do que roda, versão, e as
     * impressões digitais dos contratos. Nunca o corpo de um schema (que é grande e muda),
     * nunca um valor de campo, nunca credencial. O hash responde "mudou?" sem guardar o quê.
     */
    const contratoDoAlvo = agentContractOf(alvo)
    const membroDoPlano = equipe.find((m) => m.agentId === task.agentId)
    const fichaDaEtapa: Record<string, string | number | boolean> = {
      /**
       * A qual EXECUÇÃO esta etapa pertence — e a qual raiz.
       *
       * Sem os dois, uma etapa é um fato solto: dá para ver que ela rodou e não dá para
       * ligá-la ao pedido que a causou nem à cadeia em que ela estava. É o primeiro
       * agrupamento que qualquer investigação faz.
       */
      executionId: execId,
      ...(ctx.rootExecutionId ? { rootExecutionId: ctx.rootExecutionId.toString() } : {}),
      planId,
      stepId: task.id,
      agentId: task.agentId,
      executorKind: contratoDoAlvo.executorKind,
      // POR QUE ele: as capacidades dele que a pergunta encostou.
      capability: membroDoPlano ? matchedCapabilities(opts.objective, membroDoPlano).join(', ') : '',
      ...(contratoDoAlvo.executorConfig.kind === 'function'
        ? {
            functionName: contratoDoAlvo.executorConfig.functionName,
            functionVersion: contratoDoAlvo.executorConfig.version ?? '',
          }
        : {}),
      ...(contratoDoAlvo.executorConfig.kind === 'tool'
        ? {
            appKey: contratoDoAlvo.executorConfig.appKey ?? '',
            actionKey: contratoDoAlvo.executorConfig.actionKey ?? '',
            toolId: contratoDoAlvo.executorConfig.toolId ?? '',
          }
        : {}),
      ...(contratoDoAlvo.executorKind === 'llm' ? { model: alvo.model ?? '', provider: alvo.provider } : {}),
      responseMode: task.responseMode ?? contratoDoAlvo.responseMode,
      /**
       * Qual TENTATIVA desta etapa, e quando ela começou.
       *
       * O plano é replanejado até duas vezes, e uma etapa pode aparecer de novo na segunda
       * rodada. Sem o número, duas linhas idênticas na auditoria não dizem se foram duas
       * tentativas do mesmo trabalho ou duas etapas diferentes que por acaso se parecem.
       */
      attempt: rodada,
      startedAt: new Date(comecou).toISOString(),
      ...(contratoDoAlvo.inputJsonSchema ? { inputSchemaHash: schemaHash(contratoDoAlvo.inputJsonSchema) } : {}),
      ...(task.outputSchemaHash ? { outputSchemaHash: task.outputSchemaHash } : {}),
      dependsOn: base.dependsOn.join(','),
      // De ONDE veio cada campo. As origens; nunca os valores.
      inputOrigins: Object.entries(task.inputBindings ?? {})
        .map(([campo, b]) => `${campo}<-${b.from === 'literal' ? 'literal' : describeBinding(b)}`)
        .join(' '),
    }
    console.info(`[task:start] execution=${execId} plan=${planId} task=${task.id} agent=${task.agentId} kind=${contratoDoAlvo.executorKind} deps=[${base.dependsOn.join(',')}]`)
    // A DELEGAÇÃO, na direção de ida: quem pediu, para quem, e o que foi pedido.
    trilha({
      type: 'delegation',
      status: 'running',
      agentId: task.agentId,
      title: `${coordinator.name} → ${agentName}`,
      input: preview(task.objective, 400),
      metadata: { taskId: task.id, from: coordinator.name, to: agentName, dependsOn: base.dependsOn },
    })
    trilha({
      type: 'agent',
      status: 'running',
      agentId: task.agentId,
      provider: alvo.provider,
      model: alvo.model ?? null,
      title: `${agentName} executando`,
      input: preview(task.objective, 400),
      metadata: {
        ...fichaDaEtapa,
        taskId: task.id,
        role: alvo.role ?? alvo.preset ?? null,
        dependsOn: base.dependsOn,
        // As ferramentas DISPONÍVEIS para ele; as usadas saem no evento de resultado.
        capabilities: alvo.capabilities ?? [],
      },
    })
    /**
     * A CONFERÊNCIA DE ENTRADA — a primeira das duas paradas obrigatórias.
     *
     * O plano é uma promessa; o que chega aqui é outra coisa. A etapa anterior pode ter
     * devolvido um número onde o contrato pedia texto, ou nada onde ele exigia um valor.
     * Sem esta parada, o desencontro vira entrada do agente — e um agente que recebe
     * entrada errada não falha: ele responde, com convicção, a partir do que entendeu.
     *
     * Não executar é barato. Executar com o campo errado custa uma resposta plausível e
     * falsa, que é o desfecho mais caro que existe aqui.
     */
    const passo = stepAgentOf(task.agentId, alvo)
    const preparada = prepareStepInput(task, passo, { steps: stepOutputs(resultadosPorId) })
    if (!preparada.ok) {
      const e = preparada.error
      console.info(`[task:input] execution=${execId} ${describeStepError(e)}`)
      trilha({
        type: 'agent',
        status: 'skipped',
        agentId: task.agentId,
        title: `${agentName}: entrada não confere (${e.field ?? e.code})`,
        // Etapa, agente, campo e código. Nunca o valor do campo.
        metadata: { ...fichaDaEtapa, taskId: task.id, inputValid: false, error: e.code, field: e.field ?? null, durationMs: 0 },
      })
      return { ...base, status: 'skipped', error: `entrada não confere: ${e.message}`, durationMs: 0 }
    }
    const ligada = inputForTask(task, resultadosPorId)
    const entrada = ligada.text || opts.input
    try {
      /**
       * O DISPATCHER, e não uma segunda cópia da decisão.
       *
       * Um agente de função ou de ferramenta não é um agente de modelo com outro nome: ele
       * não improvisa a partir de prosa, e mandá-lo ao provedor seria pagar uma inferência
       * para não fazer o trabalho. Quem decide é o mesmo ponto da fase 2 — o executor de
       * modelo continua sendo o runtime de sempre, injetado aqui.
       */
      const saida = await rodarMembro(
        alvo,
        task.objective,
        entrada,
        async (k) => {
          const contrato = agentContractOf(alvo)
          if (contrato.executorKind === 'llm') {
            const r = await runAgentTask(depsComTime, ctx, alvo, task.objective, entrada, format, k, sector._id, null)
            // A MESMA ficha vai para o registro de execução, que é onde a auditoria fica
            // depois que o painel fecha. Um segundo vocabulário para o mesmo fato obrigaria
            // a cruzar dois formatos para responder uma pergunta só.
            //
            // `latencyMs` é o tempo do PROVEDOR — diferente da duração da etapa, que inclui
            // a busca na base, a montagem do prompt e a validação. Quando uma etapa demora,
            // a primeira pergunta é qual das duas coisas demorou.
            return {
              ...r,
              telemetry: {
                ...(r.telemetry ?? {}),
                ...fichaDaEtapa,
                latencyMs: Math.max(0, r.finishedAt.getTime() - r.startedAt.getTime()),
              },
            }
          }
          const comecouPasso = Date.now()
          const r = await dispatchAgentExecution(alvo, {
            agentId: alvo._id,
            ownerId: ctx.ownerId,
            objective: task.objective,
            input: preparada.input,
            correlationId: ctx.correlationId,
          })
          if (!r.ok) throw new Error(r.error?.message ?? 'a etapa não completou')
          return {
            output: r.text ?? '',
            json: r.structured?.data,
            usage: { inputTokens: r.telemetry.inputTokens ?? 0, outputTokens: r.telemetry.outputTokens ?? 0 },
            toolCalls: r.telemetry.externalCalls ?? 0,
            startedAt: new Date(comecouPasso),
            finishedAt: new Date(),
            telemetry: { ...fichaDaEtapa, externalCalls: r.telemetry.externalCalls ?? 0, latencyMs: Date.now() - comecouPasso },
          }
        },
        participationOf('specialist'),
        { agentId: alvo._id.toString(), name: alvo.name, role: 'specialist' },
      )
      /**
       * A CONFERÊNCIA DE SAÍDA — a segunda parada.
       *
       * O que não cumpre o contrato não vira entrada de ninguém: um dado inválido propagado
       * é o mesmo defeito uma etapa adiante, e lá ele já não tem de onde ser explicado.
       * `responseMode` recorta o que sai — quem pediu dado recebe dado, e não a frase que o
       * envolvia.
       */
      const conferida = finishStep(task, passo, {
        ok: true,
        ...(saida.json !== undefined
          ? { structured: { data: saida.json, valid: saida.format?.valid !== false, repaired: saida.format?.repaired === true } }
          : {}),
        text: saida.output,
        metadata: {},
        telemetry: { durationMs: Date.now() - comecou },
      })
      if (!conferida.ok) {
        console.info(`[task:output] execution=${execId} ${describeStepError(conferida.error)}`)
        trilha({
          type: 'agent',
          status: 'error',
          agentId: task.agentId,
          title: `${agentName}: saída não confere (${conferida.error.field ?? conferida.error.code})`,
          metadata: {
            ...fichaDaEtapa,
            taskId: task.id,
            inputValid: true,
            outputValid: false,
            error: conferida.error.code,
            field: conferida.error.field ?? null,
            durationMs: Date.now() - comecou,
          },
        })
        return { ...base, status: 'failed', error: `saída não confere: ${conferida.error.message}`, durationMs: Date.now() - comecou }
      }
      const durationMs = Date.now() - comecou
      console.info(`[task:end] execution=${execId} task=${task.id} agent=${task.agentId} status=succeeded duration=${durationMs}ms`)
      const participacao = participants.find((p) => p.agentId === task.agentId && p.status === 'succeeded')
      trilha({
        type: 'agent',
        status: 'success',
        agentId: task.agentId,
        provider: alvo.provider,
        model: participacao?.model ?? alvo.model ?? null,
        title: `${agentName} concluiu`,
        output: preview(conferida.text ?? '', 600),
        durationMs,
        metadata: {
          ...fichaDaEtapa,
          taskId: task.id,
          inputValid: true,
          outputValid: true,
          // O que SAIU: dado e texto contados separadamente, que é a diferença que a fase 4
          // criou e que o painel precisa mostrar sem misturar de novo.
          hasStructured: conferida.structured !== undefined,
          hasText: Boolean(conferida.text),
          finishedAt: new Date().toISOString(),
          // O tempo do PROVEDOR, separado do tempo da etapa: a etapa inclui base, prompt e
          // validação, e quando ela demora a primeira pergunta é qual das duas demorou.
          latencyMs: Math.max(0, saida.finishedAt.getTime() - saida.startedAt.getTime()),
          grounding: participacao?.grounding ?? null,
          toolCalls: participacao?.toolCalls ?? 0,
          sources: (participacao?.sources ?? []).map((f) => f.title).filter(Boolean),
          usage: participacao?.usage ?? null,
          // Uma correção de formato é uma inferência a mais, paga. Ela precisa aparecer.
          outputRepaired: saida.format?.repaired === true,
          modelReason: participacao?.modelReason ?? null,
          durationMs,
        },
      })
      // A DELEGAÇÃO, na direção de volta: o que o colega devolveu a quem pediu.
      trilha({
        type: 'delegation',
        status: 'success',
        agentId: task.agentId,
        title: `${agentName} → ${coordinator.name}`,
        output: preview(conferida.text ?? '', 400),
        durationMs,
        metadata: { taskId: task.id, from: agentName, to: coordinator.name },
      })
      // O dado vai junto com o texto: é ele que a etapa seguinte lê em `$steps.<id>.campo`.
      return { ...base, status: 'succeeded', output: conferida.text ?? '', structured: conferida.structured?.data, durationMs }
    } catch (erro) {
      const durationMs = Date.now() - comecou
      // A CATEGORIA, nunca o texto cru: mensagem de provedor pode carregar payload.
      const mensagem = erro instanceof Error ? erro.message : 'falha'
      /**
       * A CATEGORIA, nunca o texto cru — com uma exceção que vale a pena.
       *
       * A mensagem de um provedor pode carregar o payload que foi enviado; por isso ela
       * vira categoria. Já a de uma função ou de uma ferramenta é escrita por este
       * repositório: nome de campo, tipo esperado, código do executor — sem corpo de
       * terceiro, sem credencial e sem pilha (fase 2). Trocá-la por "falha na execução"
       * apagaria a única informação que permite consertar: qual campo saiu errado.
       */
      const doExecutor = agentContractOf(alvo).executorKind !== 'llm'
      const categoria = /cancel/i.test(mensagem)
        ? 'cancelado'
        : /timeout|exceeded/i.test(mensagem)
          ? 'tempo esgotado'
          : doExecutor
            ? mensagem.slice(0, 200)
            : /grounding|base/i.test(mensagem)
              ? 'sem base para responder'
              : 'falha na execução'
      console.info(`[task:end] execution=${execId} task=${task.id} agent=${task.agentId} status=failed duration=${durationMs}ms error=${categoria}`)
      trilha({
        type: 'agent',
        status: 'error',
        agentId: task.agentId,
        provider: alvo.provider,
        title: `${agentName} falhou: ${categoria}`,
        durationMs,
        metadata: { ...fichaDaEtapa, taskId: task.id, inputValid: true, error: categoria, durationMs },
      })
      // A participação com falha é registrada para o painel mostrar quem tentou.
      participants.push({ agentId: alvo._id.toString(), name: alvo.name, role: 'specialist', durationMs, status: 'failed' })
      return { ...base, status: 'failed', error: categoria, durationMs }
    }
  }

  // Os resultados desta rodada, por id de tarefa — é daqui que sai a entrada de quem depende.
  let resultadosPorId = new Map<string, TaskResult>()
  /** O plano em execução agora. Vazio antes da primeira rodada. */
  let planId = ''

  /** Uma rodada: as tarefas prontas saem juntas, as dependentes esperam pelas suas. */
  const executarPlano = async (p: ExecutionPlan): Promise<TaskResult[]> => {
    // A identidade do plano DESTA rodada: a segunda rodada é outro plano, e correlacionar
    // as duas sob o mesmo id esconderia justamente que houve replanejamento.
    planId = planIdOf(p)
    resultadosPorId = new Map<string, TaskResult>()
    while (resultadosPorId.size < p.tasks.length) {
      if (await isCanceled(ctx)) throw new Error('cancelado')
      if (ctx.budget.tokensSpent >= ctx.budget.tokenLimit) {
        warnings.push('orçamento esgotado antes de concluir o plano')
        break
      }
      if (Date.now() > prazo) {
        warnings.push('tempo de orquestração esgotado antes de concluir o plano')
        break
      }
      const onda = readyTasks(p, new Set(resultadosPorId.keys()))
      // Impossível com um plano validado (as dependências só apontam para trás), mas um
      // laço infinito num executor de agentes custa dinheiro de verdade.
      if (onda.length === 0) break

      // As independentes saem JUNTAS. `allSettled` porque uma que falha não pode levar as
      // outras: o resultado de cada uma é registrado, e a síntese decide o que fazer.
      const semEntrada = (task: ExecutionTask): TaskResult => ({
        taskId: task.id,
        agentId: task.agentId,
        agentName: nomePorAgente.get(task.agentId) ?? 'membro',
        objective: task.objective,
        dependsOn: task.dependsOn ?? [],
        status: 'skipped',
        error: 'todas as dependências falharam',
        durationMs: 0,
      })
      const executadas = await Promise.allSettled(
        onda.map((task) => (shouldRun(task, resultadosPorId) ? rodarTarefa(task) : Promise.resolve(semEntrada(task)))),
      )
      for (const [i, r] of executadas.entries()) {
        const task = onda[i]
        resultadosPorId.set(task.id, r.status === 'fulfilled' ? r.value : { ...semEntrada(task), status: 'failed', error: 'falha na execução' })
      }
      // `onFailure: 'stop'` — uma etapa que o plano declarou indispensável falhou. Seguir
      // com as outras produziria uma resposta montada sobre o que sobrou, sem dizer que a
      // parte que sustentava o resto não existe.
      const parou = haltingFailure(p, resultadosPorId)
      if (parou) {
        warnings.push(`${nomePorAgente.get(parou.agentId) ?? 'um membro'}: etapa indispensável falhou; o plano parou`)
        for (const t of p.tasks) if (!resultadosPorId.has(t.id)) resultadosPorId.set(t.id, { ...semEntrada(t), error: 'o plano parou antes desta etapa' })
        break
      }
    }
    return p.tasks.map((t) => resultadosPorId.get(t.id)).filter((r): r is TaskResult => Boolean(r))
  }

  /**
   * A consolidação, com o que existir até agora.
   *
   * Falha aqui NÃO joga fora o trabalho: houve execução de verdade, e devolver vazio
   * seria o pior desfecho possível. A montagem sem modelo entrega o que cada agente
   * respondeu, dizendo que a junção não pôde ser feita.
   */
  const sintetizar = async (feitos: TaskResult[], limitacao: string): Promise<string> => {
    /**
     * A síntese em prosa existe para uma coisa: apresentar a resposta a uma PESSOA.
     *
     * Quando quem pediu quer dado, transformá-lo em frase e devolver a frase é gastar uma
     * inferência para piorar o resultado — o consumidor teria que extrair do texto o que já
     * estava estruturado. Dado intermediário não precisa virar sentença.
     */
    const dados = feitos.filter((r) => r.status === 'succeeded' && r.structured !== undefined)
    if (agentContractOf(coordinator).responseMode === 'structured' && dados.length > 0) {
      console.info(`[synthesis:skipped] execution=${execId} reason=structured results=${dados.length}`)
      trilha({
        type: 'synthesis',
        status: 'success',
        agentId: coordinator._id.toString(),
        title: 'Entrega estruturada — sem consolidação em texto',
        metadata: { inputs: dados.map((r) => ({ agent: r.agentName, status: r.status })) },
      })
      // Um resultado sai sozinho; vários saem endereçados por etapa, porque juntá-los numa
      // estrutura inventada aqui seria este arquivo decidindo o formato de saída de alguém.
      return JSON.stringify(dados.length === 1 ? dados[0].structured : Object.fromEntries(dados.map((r) => [r.taskId, r.structured])))
    }
    const instrucaoFinal = [sector.instruction?.trim(), synthesisInstruction(plan), limitacao].filter(Boolean).join('\n\n')
    const entradaFinal = buildSynthesisContext(opts.objective, { ...plan, tasks: feitos.map((r) => ({ id: r.taskId, agentId: r.agentId, objective: r.objective, dependsOn: r.dependsOn })) }, feitos)
    const comecou = Date.now()
    console.info(`[synthesis:start] execution=${execId} agent=${coordinator._id.toString()} results=${feitos.length}`)
    trilha({
      type: 'synthesis',
      status: 'running',
      agentId: coordinator._id.toString(),
      provider: coordinator.provider,
      model: coordinator.model ?? null,
      title: `${coordinator.name} consolidando ${feitos.length} resultado(s)`,
      metadata: {
        // Quais saídas entraram — e o estado de cada uma, que é como se vê se a síntese
        // recebeu tudo o que era esperado.
        inputs: feitos.map((r) => ({ agent: r.agentName, status: r.status, durationMs: r.durationMs })),
        limitation: limitacao ? preview(limitacao, 200) : null,
      },
    })
    try {
      const { output: texto } = await rodarMembro(
        coordinator,
        instrucaoFinal,
        entradaFinal,
        (k) => runAgentTask(depsComTime, ctx, coordinator, instrucaoFinal, entradaFinal, format, k, sector._id, grant, briefing),
        participationOf('coordinator'),
        { agentId: coordinator._id.toString(), name: coordinator.name, role: 'coordinator' },
      )
      console.info(`[synthesis:end] execution=${execId} status=succeeded duration=${Date.now() - comecou}ms`)
      trilha({
        type: 'synthesis',
        status: 'success',
        agentId: coordinator._id.toString(),
        title: 'Consolidação concluída',
        output: preview(texto, 600),
        durationMs: Date.now() - comecou,
      })
      return texto
    } catch (erro) {
      const montado = assembleWithoutModel(feitos)
      console.info(`[synthesis:end] execution=${execId} status=failed duration=${Date.now() - comecou}ms fallback=${montado ? 'montagem' : 'nenhum'}`)
      trilha({
        type: 'synthesis',
        status: 'error',
        agentId: coordinator._id.toString(),
        title: montado ? 'Consolidação falhou — respostas entregues sem juntar' : 'Consolidação falhou',
        durationMs: Date.now() - comecou,
        metadata: { fallback: montado ? 'montagem sem modelo' : 'nenhum' },
      })
      warnings.push('não foi possível consolidar as respostas da equipe')
      if (!montado) throw erro
      return montado
    }
  }

  /**
   * A ORQUESTRAÇÃO: planejar, executar, consolidar — e, se faltou, uma segunda chance.
   *
   * O teto de rodadas é o que impede o motor de decidir sozinho quando parar. A pergunta
   * de suficiência só é feita quando ainda existe alguém não consultado: sem especialista
   * sobrando, uma segunda rodada não mudaria a resposta e custaria a equipe inteira.
   */
  const todos: TaskResult[] = []
  const jaFeitas = new Set<string>()
  const consultados = new Set<string>()
  let planoAtual: ExecutionPlan = plan
  let rodada = 0
  let output = ''
  let faltou: string | undefined

  console.info(`[orchestration:start] execution=${execId} sector=${sector._id.toString()} members=${equipe.length}`)
  trilha({
    type: 'orchestration_start',
    status: 'running',
    title: `Equipe "${sector.name}" — ${equipe.length} membro(s) disponível(is)`,
    metadata: {
      sectorId: sector._id.toString(),
      backendExecutionId: execId,
      coordinator: { id: coordinator._id.toString(), name: coordinator.name, provider: coordinator.provider },
      members: equipe.map((m) => ({ id: m.agentId, name: m.name })),
    },
  })

  while (rodada < tetoDeRodadas) {
    rodada += 1
    planoAtual = dedupeAgainst(planoAtual, jaFeitas, MAX_TASKS_TOTAL - todos.length)
    if (planoAtual.tasks.length === 0) break

    console.info(
      `[plan] execution=${execId} sector=${sector._id.toString()} round=${rodada} source=${rodada === 1 ? origemDoPlano : 'model'} ` +
        `tasks=${planoAtual.tasks.length} ${describePlan(planoAtual, equipe)}`,
    )
    // Por que ESTES e não os outros: os selecionados com o objetivo de cada um, e os
    // demais com a afinidade que tiveram. É a pergunta que o painel existe para responder.
    const selecionados = new Set(planoAtual.tasks.map((t) => t.agentId))
    trilha({
      type: 'planner',
      status: 'success',
      provider: coordinator.provider,
      model: rodada === 1 && origemDoPlano === 'fallback' ? 'sem modelo (determinístico)' : 'modelo auxiliar',
      title: `Plano da rodada ${rodada}: ${planoAtual.tasks.length} tarefa(s)`,
      input: preview(opts.objective, 300),
      metadata: {
        round: rodada,
        planId: planIdOf(planoAtual),
        source: rodada === 1 ? origemDoPlano : 'model',
        available: equipe.map((m) => ({ id: m.agentId, name: m.name })),
        selected: planoAtual.tasks.map((t) => {
          const membro = equipe.find((m) => m.agentId === t.agentId)
          return {
            taskId: t.id,
            agentId: t.agentId,
            name: nomePorAgente.get(t.agentId) ?? t.agentId,
            objective: t.objective,
            dependsOn: t.dependsOn ?? [],
            // POR QUE este, e COMO ele executa — as duas perguntas que o painel não
            // respondia sobre um plano.
            executorKind: membro?.executorKind ?? 'llm',
            capability: membro ? matchedCapabilities(opts.objective, membro) : [],
            /**
             * De onde vem cada campo — como LINHA, não como objeto.
             *
             * A sanitização da trilha para de descer na quarta profundidade, de propósito:
             * é o que impede um payload aninhado de virar um despejo. `metadata.selected[]
             * .inputOrigins[]{}` é exatamente a quarta, e o objeto sairia como "[…]".
             * Achatar em texto respeita o limite em vez de afrouxá-lo.
             */
            inputOrigins: Object.entries(t.inputBindings ?? {}).map(
              ([campo, b]) => `${campo}<-${b.from === 'literal' ? 'literal' : describeBinding(b)}`,
            ),
            onFailure: t.onFailure ?? 'skip',
          }
        }),
        notSelected: equipe
          .filter((m) => !selecionados.has(m.agentId))
          .map((m) => ({ name: m.name, affinity: Number(memberScore(opts.objective, m).toFixed(2)) })),
      },
    })
    for (const t of planoAtual.tasks) {
      jaFeitas.add(taskKey(t.agentId, t.objective))
      consultados.add(t.agentId)
    }

    todos.push(...(await executarPlano(planoAtual)))
    const naoConsultados = equipe.filter((m) => !consultados.has(m.agentId))
    const ultimaRodada = rodada >= tetoDeRodadas || naoConsultados.length === 0 || todos.length >= MAX_TASKS_TOTAL || Date.now() > prazo

    // A suficiência é decidida ANTES da última consolidação, para a nota de limitação
    // poder entrar nela — dizer o que faltou é parte da resposta, não um adendo.
    let limitacao = ''
    if (!ultimaRodada && deps.planWithModel) {
      const parcial = assembleWithoutModel(todos)
      /**
       * `onFailure: 'replan'` — o plano já disse que, se esta etapa falhar, vale tentar de
       * outro jeito. Perguntar ao modelo se a resposta ficou suficiente seria pagar por uma
       * opinião sobre uma decisão que já está escrita no plano.
       */
      const veredito: Sufficiency = wantsReplan(planoAtual, resultadosPorId)
        ? { sufficient: false, missing: faltou }
        : await deps
            .planWithModel(ctx.ownerId, coordinator, sufficiencyPrompt(opts.objective, parcial, naoConsultados))
            .then(parseSufficiency)
            .catch(() => ({ sufficient: true }) as Sufficiency)
      console.info(`[sufficiency] execution=${execId} round=${rodada} sufficient=${veredito.sufficient} pending=${naoConsultados.length}`)
      trilha({
        type: 'sufficiency',
        status: veredito.sufficient ? 'success' : 'info',
        title: veredito.sufficient ? 'Informação suficiente' : 'Falta informação — nova rodada',
        metadata: {
          round: rodada,
          sufficient: veredito.sufficient,
          missing: veredito.missing ? preview(veredito.missing, 200) : null,
          stillAvailable: naoConsultados.map((m) => m.name),
        },
      })
      if (veredito.sufficient) {
        output = await sintetizar(todos, '')
        break
      }
      faltou = veredito.missing
      // A rodada seguinte olha SÓ quem não foi consultado: repetir quem já respondeu é
      // pagar de novo pela mesma resposta.
      const proximo = await planExecution({
        question: faltou ? `${opts.objective}\n\nFalta especificamente: ${faltou}` : opts.objective,
        members: naoConsultados,
        ask: deps.planWithModel ? (prompt) => deps.planWithModel!(ctx.ownerId, coordinator, prompt) : undefined,
        max: Math.min(tetoDeTarefas, Math.max(0, MAX_TASKS_TOTAL - todos.length)),
      })
      planoAtual = proximo.plan
      if (planoAtual.tasks.length === 0) {
        output = await sintetizar(todos, '')
        break
      }
      continue
    }

    // Última rodada possível: se ainda faltava algo, a resposta diz o que faltou.
    if (faltou) limitacao = limitationNote(faltou, rodada)
    output = await sintetizar(todos, limitacao)
    break
  }

  if (todos.length === 0) {
    // Sem plano — setor sem outros membros, ou tudo já feito: o coordenador responde o
    // pedido original, exatamente como antes desta mudança.
    output = (
      await rodarMembro(
        coordinator,
        instruction,
        opts.input,
        (k) => runAgentTask(depsComTime, ctx, coordinator, instruction, opts.input, format, k, sector._id, grant, briefing),
        participationOf('coordinator'),
        { agentId: coordinator._id.toString(), name: coordinator.name, role: 'coordinator' },
      )
    ).output
  }
  const falharam = todos.filter((r) => r.status !== 'succeeded')
  for (const r of falharam) warnings.push(`${r.agentName}: ${r.error ?? 'não executou'}`)
  /**
   * Um membro falhou e os outros responderam: entregar meia resposta, ou nenhuma?
   *
   * O padrão é entregar — com a falta escrita, que é o que separa "parcial declarado"
   * de "parcial disfarçado de completo". Mas há trabalho em que meia resposta é pior
   * que nenhuma (um número que vai para um relatório, um saldo, uma contagem), e para
   * esse caso o coordenador pode exigir que a execução falhe inteira.
   */
  if (limites.onPartialFailure === 'fail' && falharam.length > 0 && todos.length > 0) {
    const quem = falharam.map((r) => r.agentName).join(', ')
    trilha({
      type: 'orchestration_end',
      status: 'error',
      title: `Execução interrompida: ${falharam.length} membro(s) não responderam`,
      metadata: { policy: 'fail', failed: falharam.map((r) => ({ agent: r.agentName, error: r.error ?? null })) },
    })
    throw new Error(`resposta parcial recusada por configuração do coordenador: ${quem} não respondeu`)
  }
  if (faltou) warnings.push(`informação incompleta: ${faltou.slice(0, 200)}`)
  console.info(
    `[orchestration:end] execution=${execId} sector=${sector._id.toString()} rounds=${rodada} tasks=${todos.length} ` +
      `succeeded=${todos.length - falharam.length} failed=${falharam.length} duration=${Date.now() - inicioDaOrquestracao}ms`,
  )
  trilha({
    type: 'orchestration_end',
    status: falharam.length > 0 ? 'error' : 'success',
    title: `Fim — ${rodada} rodada(s), ${todos.length} tarefa(s), ${falharam.length} falha(s)`,
    durationMs: Date.now() - inicioDaOrquestracao,
    metadata: { rounds: rodada, tasks: todos.length, failed: falharam.length, warnings },
  })
  trilha({ type: 'final', status: 'success', title: 'Resposta final', output: preview(output, 800) })
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
