// Delegation safety (Phase 4 + policy/building fix): the pure gate (owner / real
// building / depth / cycle / none|all|selected policy / budget) and the injected
// executor (real run, cycle refusal, depth cap, shared budget, cooperative
// cancellation, both-sides history). No DB/provider — deps are fakes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { checkDelegation, childContext, rootContext, buildDelegationTools, agentCanDelegate, DELEGATION_MAX_DEPTH, buildCapabilityMissing, capabilityMissingTool } = await import('../dist/delegation.js')

const OWNER = 'owner-1'
const BUILDING = new ObjectId() // the real building id (agents live on floors of it)
const FLOOR_A = new ObjectId()
const FLOOR_B = new ObjectId() // a different floor of the SAME building

function mkAgent(over = {}) {
  return {
    _id: new ObjectId(),
    ownerId: OWNER,
    officeId: FLOOR_A, // the floor the agent lives on
    name: 'A',
    objective: 'obj',
    provider: 'anthropic',
    model: null,
    preset: 'manager',
    capabilities: [],
    activationModes: ['manual'],
    inputContract: '',
    outputContract: '',
    delegationPolicy: 'all', // open by default in tests; override per case
    callerPolicy: 'all',
    callableAgentIds: [],
    callableSectorIds: [],
    allowedCallerAgentIds: [],
    ...over,
  }
}

function ctxFor(agent, over = {}) {
  return { ...rootContext({ ownerId: OWNER, buildingId: BUILDING.toString(), correlationId: 'corr', agent }), ...over }
}

const B = BUILDING.toString()

test('checkDelegation allows same owner + same building when both policies are open', () => {
  const a = mkAgent()
  const b = mkAgent()
  assert.equal(checkDelegation(a, b, B, ctxFor(a)).ok, true)
})

test('checkDelegation allows a different FLOOR of the SAME building', () => {
  const a = mkAgent({ officeId: FLOOR_A })
  const b = mkAgent({ officeId: FLOOR_B })
  // target resolves to the same building id -> allowed
  assert.equal(checkDelegation(a, b, B, ctxFor(a)).ok, true)
})

test('checkDelegation denies cross-owner and a different building', () => {
  const a = mkAgent()
  assert.equal(checkDelegation(a, mkAgent({ ownerId: 'other' }), B, ctxFor(a)).code, 'forbidden')
  assert.equal(checkDelegation(a, mkAgent(), new ObjectId().toString(), ctxFor(a)).code, 'forbidden')
})

test('checkDelegation enforces none|all|selected on both sides', () => {
  const a = mkAgent()
  // caller policy none -> cannot delegate at all
  assert.equal(checkDelegation(mkAgent({ delegationPolicy: 'none' }), mkAgent(), B, ctxFor(a)).code, 'unauthorized')
  // caller selected but target not listed -> unauthorized
  assert.equal(checkDelegation(mkAgent({ delegationPolicy: 'selected', callableAgentIds: [new ObjectId().toString()] }), mkAgent(), B, ctxFor(a)).code, 'unauthorized')
  // target callerPolicy none -> nobody may call it
  assert.equal(checkDelegation(a, mkAgent({ callerPolicy: 'none' }), B, ctxFor(a)).code, 'unauthorized')
  // target selected with the caller listed -> allowed
  const target = mkAgent({ callerPolicy: 'selected', allowedCallerAgentIds: [a._id.toString()] })
  assert.equal(checkDelegation(a, target, B, ctxFor(a)).ok, true)
  // caller selected WITH the target listed -> allowed
  const t2 = mkAgent()
  assert.equal(checkDelegation(mkAgent({ delegationPolicy: 'selected', callableAgentIds: [t2._id.toString()] }), t2, B, ctxFor(a)).ok, true)
})

test('a fresh manager (delegationPolicy=all, empty lists) can delegate', () => {
  const manager = mkAgent({ preset: 'manager', delegationPolicy: 'all', callableAgentIds: [] })
  assert.equal(agentCanDelegate(manager), true)
  assert.equal(checkDelegation(manager, mkAgent(), B, ctxFor(manager)).ok, true)
})

test('agentCanDelegate follows the outgoing policy', () => {
  assert.equal(agentCanDelegate(mkAgent({ delegationPolicy: 'none' })), false)
  assert.equal(agentCanDelegate(mkAgent({ delegationPolicy: 'all' })), true)
  assert.equal(agentCanDelegate(mkAgent({ delegationPolicy: 'selected' })), true)
})

test('checkDelegation catches cycles and the depth ceiling', () => {
  const a = mkAgent()
  const b = mkAgent()
  assert.equal(checkDelegation(a, b, B, ctxFor(a, { ancestry: [b._id.toString()] })).code, 'cycle')
  assert.equal(checkDelegation(a, a, B, ctxFor(a)).code, 'cycle')
  assert.equal(checkDelegation(a, b, B, ctxFor(a, { depth: DELEGATION_MAX_DEPTH })).code, 'depth_exceeded')
})

test('checkDelegation refuses once the shared budget is spent', () => {
  const a = mkAgent()
  assert.equal(checkDelegation(a, mkAgent(), B, ctxFor(a, { budget: { tokenLimit: 100, tokensSpent: 100 } })).code, 'budget_exceeded')
})

// ---- executor via injected deps --------------------------------------------
function fakeDeps(agents, over = {}) {
  const byId = new Map(agents.map((a) => [a._id.toString(), a]))
  const started = []
  const finished = []
  return {
    started,
    finished,
    deps: {
      loadAgent: async (_o, id) => byId.get(id.toString()) ?? null,
      loadSector: async () => null,
      listAgentsInBuilding: async () => agents,
      buildingIdForFloor: async () => B,
      resolveTools: async (agent, ownerId, childCtx) => buildDelegationTools(childCtx, over.self),
      apiKeyFor: async () => 'k',
      runTask: over.runTask ?? (async () => ({ output: 'done', usage: { inputTokens: 10, outputTokens: 5 }, toolCalls: [] })),
      startDelegation: async (s) => {
        const id = new ObjectId()
        started.push({ id, ...s })
        return id
      },
      finishDelegation: async (id, patch) => finished.push({ id, ...patch }),
      ...over.depsPatch,
    },
  }
}

test('delegate_to_agent runs the target and records start+finish (both-sides history)', async () => {
  const a = mkAgent()
  const b = mkAgent()
  const f = fakeDeps([a, b])
  const ctx = ctxFor(a)
  const del = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'delegate_to_agent')
  const out = await del.run({ agentId: b._id.toString(), objective: 'faça X' })
  assert.equal(out.ok, true)
  const parsed = JSON.parse(out.result)
  assert.equal(parsed.status, 'ok')
  assert.equal(parsed.output, 'done')
  assert.equal(f.started.length, 1)
  assert.equal(f.started[0].callerAgentId.toString(), a._id.toString())
  assert.equal(f.started[0].targetAgentId.toString(), b._id.toString())
  assert.equal(f.finished[0].status, 'succeeded')
  assert.deepEqual(f.finished[0].usage, { inputTokens: 10, outputTokens: 5 })
})

test('delegate_to_agent denies an unauthorized pairing without running it', async () => {
  const a = mkAgent({ delegationPolicy: 'selected', callableAgentIds: [] }) // may call nobody
  const b = mkAgent()
  const f = fakeDeps([a, b])
  const del = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_agent')
  const out = await del.run({ agentId: b._id.toString(), objective: 'x' })
  assert.equal(out.ok, false)
  assert.equal(JSON.parse(out.result).code, 'unauthorized')
  assert.equal(f.started.length, 0)
})

test('delegate_to_agent refuses a cycle back to an ancestor without running it', async () => {
  const a = mkAgent()
  const b = mkAgent()
  const f = fakeDeps([a, b])
  const ctx = ctxFor(a, { ancestry: [b._id.toString()] })
  const del = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'delegate_to_agent')
  const out = await del.run({ agentId: b._id.toString(), objective: 'loop' })
  assert.equal(out.ok, false)
  assert.equal(JSON.parse(out.result).code, 'cycle')
  assert.equal(f.started.length, 0)
})

test('delegate_to_agent stops when the shared budget is exhausted', async () => {
  const a = mkAgent()
  const b = mkAgent()
  const f = fakeDeps([a, b])
  const ctx = ctxFor(a, { budget: { tokenLimit: 5, tokensSpent: 5 } })
  const del = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'delegate_to_agent')
  const out = await del.run({ agentId: b._id.toString(), objective: 'x' })
  assert.equal(JSON.parse(out.result).code, 'budget_exceeded')
})

test('cooperative cancellation refuses before running', async () => {
  const a = mkAgent()
  const b = mkAgent()
  const f = fakeDeps([a, b])
  const ctx = ctxFor(a, { isCanceled: () => true })
  const del = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'delegate_to_agent')
  const out = await del.run({ agentId: b._id.toString(), objective: 'x' })
  assert.equal(JSON.parse(out.result).status, 'canceled')
  assert.equal(f.started.length, 0)
})

test('list_available_agents hides the caller and unauthorized agents, filters by capability', async () => {
  const a = mkAgent({ capabilities: ['gestao'] })
  const reachable = mkAgent({ capabilities: ['pesquisa', 'web'] })
  const locked = mkAgent({ capabilities: ['pesquisa'], callerPolicy: 'none' }) // nobody may call it
  const f = fakeDeps([a, reachable, locked])
  const ctx = ctxFor(a)
  const list = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'list_available_agents')
  const all = JSON.parse((await list.run({})).result).agents
  assert.deepEqual(all.map((x) => x.id).sort(), [reachable._id.toString()].sort()) // locked out + self excluded
  const filtered = JSON.parse((await list.run({ capability: 'web' })).result).agents
  assert.equal(filtered.length, 1)
  assert.equal(JSON.parse((await list.run({ capability: 'inexistente' })).result).agents.length, 0)
})

test('capability_missing reports the gap with a suggested preset instead of inventing', async () => {
  const cm = buildCapabilityMissing('Resumir notícias de ontem', 'pesquisa web')
  assert.equal(cm.status, 'capability_missing')
  assert.equal(cm.suggestedPreset, 'researcher')
  assert.ok(cm.suggestedPresetLabel)
  assert.equal(buildCapabilityMissing('Enviar relatório', 'envio de e-mail').suggestedPreset, 'communicator')
  const tool = capabilityMissingTool()
  const out = JSON.parse((await tool.run({ task: 'X', missingCapability: 'orquestrar equipe' })).result)
  assert.equal(out.status, 'capability_missing')
  assert.equal(out.suggestedPreset, 'manager')
  assert.equal(JSON.parse((await tool.run({ task: 'X' })).result).status, 'error')
})

test('childContext deepens the chain and shares the budget object', () => {
  const a = mkAgent()
  const b = mkAgent()
  const ctx = ctxFor(a)
  const child = childContext(ctx, b)
  assert.equal(child.depth, 1)
  assert.equal(child.callerAgentId, b._id.toString())
  assert.deepEqual(child.ancestry, [a._id.toString()])
  assert.equal(child.budget, ctx.budget)
})
