// Delegation safety (Phase 4): the pure gate (owner/building/depth/cycle/auth/budget)
// and the injected executor (real run, cycle refusal, depth cap, shared budget,
// cooperative cancellation, both-sides history). No DB/provider — deps are fakes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { checkDelegation, childContext, rootContext, buildDelegationTools, DELEGATION_MAX_DEPTH } = await import('../dist/delegation.js')

const OWNER = 'owner-1'
const BUILDING = new ObjectId()

function mkAgent(over = {}) {
  return {
    _id: new ObjectId(),
    ownerId: OWNER,
    officeId: BUILDING,
    name: 'A',
    objective: 'obj',
    provider: 'anthropic',
    model: null,
    preset: 'manager',
    capabilities: [],
    activationModes: ['manual'],
    inputContract: '',
    outputContract: '',
    callableAgentIds: [],
    callableSectorIds: [],
    allowedCallerAgentIds: [],
    ...over,
  }
}

function ctxFor(agent, over = {}) {
  return { ...rootContext({ ownerId: OWNER, buildingId: BUILDING.toString(), correlationId: 'corr', agent }), ...over }
}

test('checkDelegation allows same owner+building when both lists are open', () => {
  const a = mkAgent()
  const b = mkAgent()
  assert.equal(checkDelegation(a, b, ctxFor(a)).ok, true)
})

test('checkDelegation denies cross-owner and cross-building', () => {
  const a = mkAgent()
  assert.equal(checkDelegation(a, mkAgent({ ownerId: 'other' }), ctxFor(a)).code, 'forbidden')
  assert.equal(checkDelegation(a, mkAgent({ officeId: new ObjectId() }), ctxFor(a)).code, 'forbidden')
})

test('checkDelegation enforces allowlists on either side', () => {
  const a = mkAgent()
  const b = mkAgent()
  // caller restricted to someone else
  assert.equal(checkDelegation(mkAgent({ callableAgentIds: [new ObjectId().toString()] }), b, ctxFor(a)).code, 'unauthorized')
  // target only allows a specific other caller
  assert.equal(checkDelegation(a, mkAgent({ allowedCallerAgentIds: [new ObjectId().toString()] }), ctxFor(a)).code, 'unauthorized')
  // explicit pairing works
  const ok = checkDelegation(a, mkAgent({ allowedCallerAgentIds: [a._id.toString()] }), ctxFor(a))
  assert.equal(ok.ok, true)
})

test('checkDelegation catches cycles and the depth ceiling', () => {
  const a = mkAgent()
  const b = mkAgent()
  // b already in the chain → cycle
  assert.equal(checkDelegation(a, b, ctxFor(a, { ancestry: [b._id.toString()] })).code, 'cycle')
  // self → cycle
  assert.equal(checkDelegation(a, a, ctxFor(a)).code, 'cycle')
  // at max depth, one more level is refused
  assert.equal(checkDelegation(a, b, ctxFor(a, { depth: DELEGATION_MAX_DEPTH })).code, 'depth_exceeded')
})

test('checkDelegation refuses once the shared budget is spent', () => {
  const a = mkAgent()
  assert.equal(checkDelegation(a, mkAgent(), ctxFor(a, { budget: { tokenLimit: 100, tokensSpent: 100 } })).code, 'budget_exceeded')
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
  const tools = buildDelegationTools(ctx, f.deps)
  const del = tools.find((t) => t.name === 'delegate_to_agent')
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

test('delegate_to_agent refuses a cycle back to an ancestor without running it', async () => {
  const a = mkAgent()
  const b = mkAgent()
  const f = fakeDeps([a, b])
  // ctx where b is already an ancestor (a was called by b)
  const ctx = ctxFor(a, { ancestry: [b._id.toString()] })
  const del = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'delegate_to_agent')
  const out = await del.run({ agentId: b._id.toString(), objective: 'loop' })
  assert.equal(out.ok, false)
  assert.equal(JSON.parse(out.result).code, 'cycle')
  assert.equal(f.started.length, 0) // nothing ran
})

test('delegate_to_agent stops when the shared budget is exhausted mid-chain', async () => {
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
  const locked = mkAgent({ capabilities: ['pesquisa'], allowedCallerAgentIds: [new ObjectId().toString()] })
  const f = fakeDeps([a, reachable, locked])
  const ctx = ctxFor(a)
  const list = buildDelegationTools(ctx, f.deps).find((t) => t.name === 'list_available_agents')
  const all = JSON.parse((await list.run({})).result).agents
  assert.deepEqual(all.map((x) => x.id).sort(), [reachable._id.toString()].sort()) // locked out + self excluded
  const filtered = JSON.parse((await list.run({ capability: 'web' })).result).agents
  assert.equal(filtered.length, 1)
  assert.equal(JSON.parse((await list.run({ capability: 'inexistente' })).result).agents.length, 0)
})

test('childContext deepens the chain and shares the budget object', () => {
  const a = mkAgent()
  const b = mkAgent()
  const ctx = ctxFor(a)
  const child = childContext(ctx, b)
  assert.equal(child.depth, 1)
  assert.equal(child.callerAgentId, b._id.toString())
  assert.deepEqual(child.ancestry, [a._id.toString()])
  assert.equal(child.budget, ctx.budget) // same reference → tree-wide accounting
})
