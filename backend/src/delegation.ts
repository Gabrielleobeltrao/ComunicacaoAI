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

export const DELEGATION_MAX_DEPTH = 4
export const DEFAULT_DELEGATION_TOKEN_BUDGET = 300_000

export interface DelegationBudget {
  tokenLimit: number
  tokensSpent: number // mutated in place; the SAME object is shared across the whole tree
}

export interface DelegationContext {
  ownerId: string
  buildingId: string // caller's officeId; every target must share it
  correlationId: string
  callerAgentId: string // the agent that owns the delegate tools in this context
  callerAgentName: string
  ancestry: string[] // agentIds already in the call chain, excluding callerAgentId
  depth: number // 0 at the top
  budget: DelegationBudget
  isCanceled?: () => boolean | Promise<boolean>
}

export type DelegationDenyCode = 'forbidden' | 'unauthorized' | 'depth_exceeded' | 'cycle' | 'budget_exceeded' | 'canceled'
export type DelegationCheck = { ok: true } | { ok: false; code: DelegationDenyCode; reason: string }

// Pure safety gate for caller→target. No IO. Default-deny is impossible to bypass:
// wrong owner/building, over-depth, a cycle, an exhausted budget, or a side that
// doesn't authorize the pairing all fail here before anything runs.
export function checkDelegation(caller: Agent, target: Agent, ctx: DelegationContext): DelegationCheck {
  const tid = target._id.toString()
  if (target.ownerId !== caller.ownerId) return { ok: false, code: 'forbidden', reason: 'agente de outro proprietário' }
  if (target.officeId.toString() !== ctx.buildingId) return { ok: false, code: 'forbidden', reason: 'agente de outro prédio' }
  if (ctx.depth + 1 > DELEGATION_MAX_DEPTH) return { ok: false, code: 'depth_exceeded', reason: `profundidade máxima (${DELEGATION_MAX_DEPTH}) atingida` }
  if (tid === ctx.callerAgentId || ctx.ancestry.includes(tid)) return { ok: false, code: 'cycle', reason: 'ciclo de delegação detectado' }
  // [] on either list = "any agent of the same owner" (see Agent field docs); a
  // non-empty list is an allowlist. Both sides must permit the pairing.
  const callerAllows = (caller.callableAgentIds ?? []).length === 0 || caller.callableAgentIds.includes(tid)
  const targetAllows = (target.allowedCallerAgentIds ?? []).length === 0 || target.allowedCallerAgentIds.includes(caller._id.toString())
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

export interface SectorLite {
  _id: ObjectId
  name: string
  officeId: ObjectId
  mode: 'adaptive' | 'pipeline'
  members: { agentId: ObjectId; isDefault?: boolean }[]
}

// Injected IO. Production wiring in ./delegationWiring.ts binds these to the real
// agent store, tool resolver, task runtime, provider keys and delegation log.
export interface DelegationDeps {
  loadAgent: (ownerId: string, id: ObjectId) => Promise<Agent | null>
  loadSector: (ownerId: string, id: ObjectId) => Promise<SectorLite | null>
  listAgentsInBuilding: (ownerId: string, buildingId: string) => Promise<Agent[]>
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
async function runAgentTask(
  deps: DelegationDeps,
  ctx: DelegationContext,
  target: Agent,
  objective: string,
  input: unknown,
  format: AgentOutputFormat,
): Promise<{ output: string; usage: { inputTokens: number; outputTokens: number } }> {
  const cctx = childContext(ctx, target)
  const tools = await deps.resolveTools(target, ctx.ownerId, cctx)
  const apiKey = await deps.apiKeyFor(ctx.ownerId, target.provider)
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
  return { output: res.output, usage: res.usage }
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

  const check = checkDelegation(caller, target, ctx)
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
  try {
    const { output, usage } = await runAgentTask(deps, ctx, target, objective, input, (args.format as AgentOutputFormat) || 'markdown')
    await deps.finishDelegation(recId, { status: 'succeeded', outputPreview: output.slice(0, 500), usage })
    return { ok: true, result: j({ status: 'ok', agent: target.name, output }) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha na delegação'
    await deps.finishDelegation(recId, { status: 'failed', error: message })
    return { ok: false, result: j({ status: 'error', reason: message }) }
  }
}

// ---- delegate_to_sector -----------------------------------------------------
// Real, minimal team executor. pipeline: members run in order, each output feeding
// the next input; the last output is returned. adaptive: the default member leads
// and may sub-delegate to teammates via its own tools.
// ponytail: adaptive routing = default-member-leads (no LLM supervisor pick in task
// mode); upgrade to a planner if teams need per-task specialist routing.
async function delegateToSector(deps: DelegationDeps, ctx: DelegationContext, args: Record<string, unknown>): Promise<{ ok: boolean; result: string }> {
  const sectorId = typeof args.sectorId === 'string' ? args.sectorId : ''
  const objective = typeof args.objective === 'string' ? args.objective.trim() : ''
  if (!ObjectId.isValid(sectorId) || !objective) return { ok: false, result: j({ status: 'error', reason: 'sectorId e objective são obrigatórios' }) }
  if (await isCanceled(ctx)) return { ok: false, result: j({ status: 'canceled' }) }

  const caller = await deps.loadAgent(ctx.ownerId, new ObjectId(ctx.callerAgentId))
  if (!caller) return { ok: false, result: j({ status: 'error', reason: 'agente chamador não encontrado' }) }
  const callerCanCall = (caller.callableSectorIds ?? []).length === 0 || caller.callableSectorIds.includes(sectorId)
  if (!callerCanCall) return { ok: false, result: j({ status: 'denied', code: 'unauthorized', reason: 'setor não autorizado para este agente' }) }
  if (ctx.depth + 1 > DELEGATION_MAX_DEPTH) return { ok: false, result: j({ status: 'denied', code: 'depth_exceeded', reason: 'profundidade máxima atingida' }) }
  if (ctx.budget.tokensSpent >= ctx.budget.tokenLimit) return { ok: false, result: j({ status: 'denied', code: 'budget_exceeded', reason: 'orçamento esgotado' }) }

  const sector = await deps.loadSector(ctx.ownerId, new ObjectId(sectorId))
  if (!sector || sector.members.length === 0) return { ok: false, result: j({ status: 'error', reason: 'setor não encontrado ou vazio' }) }
  if (sector.officeId.toString() !== ctx.buildingId) return { ok: false, result: j({ status: 'denied', code: 'forbidden', reason: 'setor de outro prédio' }) }

  const members = (await Promise.all(sector.members.map((m) => deps.loadAgent(ctx.ownerId, m.agentId)))).filter((a): a is Agent => a !== null)
  // Members already in the chain would loop — drop them.
  const runnable = members.filter((a) => a._id.toString() !== ctx.callerAgentId && !ctx.ancestry.includes(a._id.toString()))
  if (runnable.length === 0) return { ok: false, result: j({ status: 'denied', code: 'cycle', reason: 'todos os membros já estão na cadeia' }) }

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
    const format = (args.format as AgentOutputFormat) || 'markdown'
    let output = ''
    if ((sector.mode ?? 'adaptive') === 'pipeline') {
      let carry: unknown = args.input
      for (const member of runnable) {
        if (await isCanceled(ctx)) throw new Error('cancelado')
        if (ctx.budget.tokensSpent >= ctx.budget.tokenLimit) throw new Error('orçamento esgotado')
        const step = await runAgentTask(deps, ctx, member, objective, carry, format)
        output = step.output
        carry = step.output
      }
    } else {
      const lead = runnable.find((a) => sector.members.find((m) => m.isDefault)?.agentId.equals(a._id)) ?? runnable[0]
      const res = await runAgentTask(deps, ctx, lead, objective, args.input, format)
      output = res.output
    }
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
  const available = all.filter((t) => t._id.toString() !== caller._id.toString() && checkDelegation(caller, t, ctx).ok)
  const filtered = need ? available.filter((t) => (t.capabilities ?? []).some((c) => c.toLowerCase().includes(need)) || t.name.toLowerCase().includes(need)) : available
  return { ok: true, result: j({ status: 'ok', agents: filtered.map(agentCard) }) }
}

async function getCapabilities(deps: DelegationDeps, ctx: DelegationContext, args: Record<string, unknown>): Promise<{ ok: boolean; result: string }> {
  const id = typeof args.agentId === 'string' ? args.agentId : ''
  if (!ObjectId.isValid(id)) return { ok: false, result: j({ status: 'error', reason: 'agentId inválido' }) }
  const [caller, target] = await Promise.all([deps.loadAgent(ctx.ownerId, new ObjectId(ctx.callerAgentId)), deps.loadAgent(ctx.ownerId, new ObjectId(id))])
  if (!caller || !target) return { ok: false, result: j({ status: 'error', reason: 'agente não encontrado' }) }
  const check = checkDelegation(caller, target, ctx)
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
      description: 'Delega uma tarefa a um setor (equipe). Em pipeline os membros rodam em sequência; em adaptativo o membro padrão conduz.',
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

// Whether an agent should be offered delegation tools at all: only agents wired to
// call someone (a manager/orchestrator) — keeps the toolset lean for leaf agents.
export function agentCanDelegate(agent: Agent): boolean {
  return (agent.callableAgentIds?.length ?? 0) > 0 || (agent.callableSectorIds?.length ?? 0) > 0
}
