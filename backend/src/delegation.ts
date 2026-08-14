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
import type { Agent } from './agents.js'
import type { ResolvedTool } from './agentTools.js'
import type { AgentExecutionRequest, AgentExecutionResult, AgentOutputFormat } from './agentRuntime.js'
import { presetSpec, suggestPresetForCapability } from './agentPresets.js'

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
}

export type DelegationDenyCode = 'forbidden' | 'unauthorized' | 'depth_exceeded' | 'cycle' | 'budget_exceeded' | 'canceled'
export type DelegationCheck = { ok: true } | { ok: false; code: DelegationDenyCode; reason: string }

// True when `policy`/`list` authorize acting on `id`. none → never; all → always;
// selected → only when the id is in the explicit list.
function policyAllows(policy: Agent['delegationPolicy'], list: string[], id: string): boolean {
  if (policy === 'all') return true
  if (policy === 'selected') return (list ?? []).includes(id)
  return false // 'none'
}

// Pure safety gate for caller→target. No IO — `targetBuildingId` is resolved by the
// caller so this stays synchronous and unit-testable. Default-deny is impossible to
// bypass: wrong owner/building, over-depth, a cycle, an exhausted budget, or a side
// whose policy doesn't authorize the pairing all fail here before anything runs.
// Cross-FLOOR delegation within the SAME building is allowed; another building or
// owner is refused.
export function checkDelegation(caller: Agent, target: Agent, targetBuildingId: string, ctx: DelegationContext): DelegationCheck {
  const tid = target._id.toString()
  if (target.ownerId !== caller.ownerId) return { ok: false, code: 'forbidden', reason: 'agente de outro proprietário' }
  if (targetBuildingId !== ctx.buildingId) return { ok: false, code: 'forbidden', reason: 'agente de outro prédio' }
  if (ctx.depth + 1 > DELEGATION_MAX_DEPTH) return { ok: false, code: 'depth_exceeded', reason: `profundidade máxima (${DELEGATION_MAX_DEPTH}) atingida` }
  if (tid === ctx.callerAgentId || ctx.ancestry.includes(tid)) return { ok: false, code: 'cycle', reason: 'ciclo de delegação detectado' }
  const callerAllows = policyAllows(caller.delegationPolicy, caller.callableAgentIds, tid)
  const targetAllows = policyAllows(target.callerPolicy, target.allowedCallerAgentIds, caller._id.toString())
  if (!callerAllows || !targetAllows) return { ok: false, code: 'unauthorized', reason: 'delegação não autorizada entre estes agentes' }
  if (ctx.budget.tokensSpent >= ctx.budget.tokenLimit) return { ok: false, code: 'budget_exceeded', reason: 'orçamento de tokens da cadeia esgotado' }
  return { ok: true }
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
  }
}

export function rootContext(opts: {
  ownerId: string
  buildingId: string
  correlationId: string
  agent: Agent
  tokenLimit?: number
  isCanceled?: () => boolean | Promise<boolean>
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
    buildingId: string
    floorId: ObjectId
    source: 'delegation' | 'sector'
    preset: string
    status: 'succeeded' | 'failed' | 'timeout' | 'canceled'
    startedAt: Date
    finishedAt: Date
    inputTokens: number
    outputTokens: number
    toolCalls: number
    parentEventKey: string | null
    rootEventKey: string
    metadata: Record<string, string | number | boolean>
  }) => void
  // Owner-level token accounting for a delegated/sector inference, charged exactly
  // once for `chargeKey`.
  chargeUsage?: (ownerId: string, usage: { inputTokens: number; outputTokens: number }, chargeKey: string) => void
}

interface TaskRun {
  output: string
  usage: { inputTokens: number; outputTokens: number }
  toolCalls: number
  startedAt: Date
  finishedAt: Date
}

// Emit a per-agent telemetry event for a delegation/sector run (fire-and-forget via
// the injected recordEvent).
function emitAgentEvent(deps: DelegationDeps, ctx: DelegationContext, target: Agent, source: 'delegation' | 'sector', eventKey: string, run: { usage: { inputTokens: number; outputTokens: number }; toolCalls: number; startedAt: Date; finishedAt: Date }, status: 'succeeded' | 'failed' | 'timeout' | 'canceled'): void {
  deps.recordEvent?.({
    eventKey,
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
    toolCalls: run.toolCalls,
    parentEventKey: ctx.currentEventKey ?? null,
    rootEventKey: ctx.rootEventKey ?? eventKey,
    metadata: { correlationId: ctx.correlationId, depth: ctx.depth + 1 },
  })
  // Owner accounting for this delegated inference — once per event key.
  if (run.usage.inputTokens || run.usage.outputTokens) deps.chargeUsage?.(ctx.ownerId, run.usage, `event:${eventKey}`)
}

const TASK_TIMEOUT_MS = 120_000
const MAX_OUTPUT_CHARS = 40_000

function j(v: unknown): string {
  return JSON.stringify(v)
}

async function isCanceled(ctx: DelegationContext): Promise<boolean> {
  return ctx.isCanceled ? Boolean(await ctx.isCanceled()) : false
}

// Run one target agent as a task under `ctx` (ctx.callerAgentId is the delegator).
// Returns the model output, charging the shared budget. Assumes checkDelegation
// already passed.
async function runAgentTask(deps: DelegationDeps, ctx: DelegationContext, target: Agent, objective: string, input: unknown, format: AgentOutputFormat, eventKey?: string): Promise<TaskRun> {
  // The child runs under THIS execution's event, so anything it delegates chains to
  // the same root (parent/root lineage).
  const cctx = { ...childContext(ctx, target), currentEventKey: eventKey ?? ctx.currentEventKey ?? null, rootEventKey: ctx.rootEventKey ?? eventKey ?? null }
  const tools = await deps.resolveTools(target, ctx.ownerId, cctx)
  const apiKey = await deps.apiKeyFor(ctx.ownerId, target.provider)
  const startedAt = new Date()
  const res = await deps.runTask({
    objective: target.objective || objective,
    instructions: objective,
    input,
    provider: target.provider,
    model: target.model,
    apiKey,
    tools,
    output: { format },
    limits: { timeoutMs: TASK_TIMEOUT_MS, maxOutputChars: MAX_OUTPUT_CHARS },
  })
  ctx.budget.tokensSpent += res.usage.inputTokens + res.usage.outputTokens
  // "Ações com ferramenta" counts calls that actually COMPLETED, not attempts.
  return { output: res.output, usage: res.usage, toolCalls: res.toolCalls.filter((c) => c.ok).length, startedAt, finishedAt: new Date() }
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

  const targetBuildingId = await deps.buildingIdForFloor(ctx.ownerId, target.officeId)
  const check = checkDelegation(caller, target, targetBuildingId ?? '', ctx)
  if (!check.ok) return { ok: false, result: j({ status: 'denied', code: check.code, reason: check.reason }) }

  const recId = await deps.startDelegation({
    ownerId: ctx.ownerId,
    correlationId: ctx.correlationId,
    depth: ctx.depth + 1,
    callerAgentId: caller._id,
    targetType: 'agent',
    targetAgentId: target._id,
    objective,
  })
  const startedAt = new Date()
  try {
    const run = await runAgentTask(deps, ctx, target, objective, input, (args.format as AgentOutputFormat) || 'markdown', `deleg:${recId.toString()}`)
    await deps.finishDelegation(recId, { status: 'succeeded', outputPreview: run.output.slice(0, 500), usage: run.usage })
    emitAgentEvent(deps, ctx, target, 'delegation', `deleg:${recId.toString()}`, run, 'succeeded')
    return { ok: true, result: j({ status: 'ok', agent: target.name, output: run.output }) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha na delegação'
    await deps.finishDelegation(recId, { status: 'failed', error: message })
    emitAgentEvent(deps, ctx, target, 'delegation', `deleg:${recId.toString()}`, { usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: 0, startedAt, finishedAt: new Date() }, 'failed')
    return { ok: false, result: j({ status: 'error', reason: message }) }
  }
}

// Run a target with a bounded number of attempts (retryPolicy.maxAttempts). The last
// error propagates when every attempt fails.
async function runWithRetry(deps: DelegationDeps, ctx: DelegationContext, target: Agent, objective: string, input: unknown, format: AgentOutputFormat, maxAttempts: number, eventKey?: string): Promise<TaskRun> {
  let lastError: unknown
  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
    try {
      return await runAgentTask(deps, ctx, target, objective, input, format, eventKey)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('falha na execução')
}

// Record a child delegation (caller = the agent that invoked the sector) so each
// stage/coordinator run shows in both histories, one level below the sector record,
// AND a per-agent 'sector' telemetry event.
async function recordChildRun(deps: DelegationDeps, ctx: DelegationContext, target: Agent, objective: string, parentId: ObjectId, run: (eventKey: string) => Promise<TaskRun>): Promise<string> {
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
    emitAgentEvent(deps, ctx, target, 'sector', eventKey, r, 'succeeded')
    return r.output
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha'
    await deps.finishDelegation(recId, { status: 'failed', error: message })
    emitAgentEvent(deps, ctx, target, 'sector', eventKey, { usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: 0, startedAt, finishedAt: new Date() }, /timeout|exceeded/i.test(message) ? 'timeout' : 'failed')
    throw error
  }
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
  const callerCanCall = policyAllows(caller.delegationPolicy, caller.callableSectorIds, sectorId)
  if (!callerCanCall) return { ok: false, result: j({ status: 'denied', code: 'unauthorized', reason: 'setor não autorizado para este agente' }) }
  if (ctx.depth + 1 > DELEGATION_MAX_DEPTH) return { ok: false, result: j({ status: 'denied', code: 'depth_exceeded', reason: 'profundidade máxima atingida' }) }
  if (ctx.budget.tokensSpent >= ctx.budget.tokenLimit) return { ok: false, result: j({ status: 'denied', code: 'budget_exceeded', reason: 'orçamento esgotado' }) }

  const sector = await deps.loadSector(ctx.ownerId, new ObjectId(sectorId))
  if (!sector) return { ok: false, result: j({ status: 'error', reason: 'setor não encontrado' }) }
  const sectorBuildingId = await deps.buildingIdForFloor(ctx.ownerId, sector.officeId)
  if (sectorBuildingId !== ctx.buildingId) return { ok: false, result: j({ status: 'denied', code: 'forbidden', reason: 'setor de outro prédio' }) }
  if (sector.mode === 'organization') return { ok: false, result: j({ status: 'not_executable', reason: 'este setor apenas agrupa agentes; escolha um agente ou um setor orquestrado/pipeline' }) }

  const inChain = (id: ObjectId) => id.toString() === ctx.callerAgentId || ctx.ancestry.includes(id.toString())
  const format = (args.format as AgentOutputFormat) || 'markdown'

  const recId = await deps.startDelegation({
    ownerId: ctx.ownerId,
    correlationId: ctx.correlationId,
    depth: ctx.depth + 1,
    callerAgentId: caller._id,
    targetType: 'sector',
    targetSectorId: sector._id,
    objective,
  })
  try {
    let output = ''
    if (sector.mode === 'pipeline') {
      const stages = sector.stages ?? []
      if (stages.length === 0) throw new Error('pipeline sem etapas')
      const outputs: Record<string, string> = {}
      const failures: string[] = []
      for (const stage of stages) {
        if (await isCanceled(ctx)) throw new Error('cancelado')
        if (ctx.budget.tokensSpent >= ctx.budget.tokenLimit) throw new Error('orçamento esgotado')
        const agent = await deps.loadAgent(ctx.ownerId, stage.agentId)
        const problem = !agent ? 'agente da etapa não encontrado' : inChain(stage.agentId) ? 'ciclo de delegação na etapa' : null
        if (problem || !agent) {
          if (stage.onError === 'continue') {
            failures.push(`${stage.name}: ${problem}`)
            continue
          }
          throw new Error(`${stage.name}: ${problem}`)
        }
        const input = stage.dependsOn.length ? stage.dependsOn.map((id) => outputs[id] ?? '').join('\n\n') : args.input
        const instruction = stage.instruction || objective
        try {
          const out = await recordChildRun(deps, ctx, agent, instruction, recId, (k) => runWithRetry(deps, ctx, agent, instruction, input, format, stage.retryPolicy.maxAttempts, k))
          outputs[stage.id] = out
          output = out
        } catch (error) {
          const message = error instanceof Error ? error.message : 'falha'
          if (stage.onError === 'continue') {
            failures.push(`${stage.name}: ${message}`)
            continue
          }
          throw new Error(`${stage.name}: ${message}`)
        }
      }
      await deps.finishDelegation(recId, { status: 'succeeded', outputPreview: output.slice(0, 500) })
      return { ok: true, result: j({ status: 'ok', sector: sector.name, output, ...(failures.length ? { warnings: failures } : {}) }) }
    }

    // orchestrated
    const coordinatorId = sector.coordinatorAgentId ?? sector.members.find((m) => m.isDefault)?.agentId ?? sector.members[0]?.agentId
    if (!coordinatorId) throw new Error('setor orquestrado sem coordenador nem membros')
    if (inChain(coordinatorId)) throw new Error('ciclo de delegação: o coordenador já está na cadeia')
    const coordinator = await deps.loadAgent(ctx.ownerId, coordinatorId)
    if (!coordinator) throw new Error('coordenador não encontrado')
    const instruction = sector.instruction ? `${sector.instruction}\n\n${objective}` : objective
    output = await recordChildRun(deps, ctx, coordinator, instruction, recId, (k) => runAgentTask(deps, ctx, coordinator, instruction, args.input, format, k))
    await deps.finishDelegation(recId, { status: 'succeeded', outputPreview: output.slice(0, 500) })
    return { ok: true, result: j({ status: 'ok', sector: sector.name, output }) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha na delegação de setor'
    await deps.finishDelegation(recId, { status: 'failed', error: message })
    return { ok: false, result: j({ status: 'error', reason: message }) }
  }
}

// ---- discovery tools --------------------------------------------------------
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
  const available = all.filter((t) => t._id.toString() !== caller._id.toString() && checkDelegation(caller, t, ctx.buildingId, ctx).ok)
  const filtered = need ? available.filter((t) => (t.capabilities ?? []).some((c) => c.toLowerCase().includes(need)) || t.name.toLowerCase().includes(need)) : available
  return { ok: true, result: j({ status: 'ok', agents: filtered.map(agentCard) }) }
}

async function getCapabilities(deps: DelegationDeps, ctx: DelegationContext, args: Record<string, unknown>): Promise<{ ok: boolean; result: string }> {
  const id = typeof args.agentId === 'string' ? args.agentId : ''
  if (!ObjectId.isValid(id)) return { ok: false, result: j({ status: 'error', reason: 'agentId inválido' }) }
  const [caller, target] = await Promise.all([deps.loadAgent(ctx.ownerId, new ObjectId(ctx.callerAgentId)), deps.loadAgent(ctx.ownerId, new ObjectId(id))])
  if (!caller || !target) return { ok: false, result: j({ status: 'error', reason: 'agente não encontrado' }) }
  const targetBuildingId = await deps.buildingIdForFloor(ctx.ownerId, target.officeId)
  const check = checkDelegation(caller, target, targetBuildingId ?? '', ctx)
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
      description: 'Lista os agentes colaboradores que você pode acionar (mesmo prédio e autorizados), opcionalmente filtrando por competência. Use antes de delegar.',
      inputSchema: { type: 'object', properties: { capability: { type: 'string', description: 'competência desejada (opcional)' } }, additionalProperties: false },
      run: (args) => listAvailable(deps, ctx, args),
    },
    {
      name: 'get_agent_capabilities',
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
          input: { type: 'string', description: 'dados de entrada (opcional)' },
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
          input: { type: 'string', description: 'dados de entrada (opcional)' },
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
