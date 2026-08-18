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

// ---- sector context grant ---------------------------------------------------
// Being in a sector must NOT rewrite the agents' own policies. Instead the
// coordinator gets a narrow, one-level grant for THAT sector's members.

test('sector grant lets a closed coordinator reach its own members, and nobody else', () => {
  const coordinator = mkAgent({ delegationPolicy: 'none' })
  const member = mkAgent({ callerPolicy: 'none' })
  const outsider = mkAgent({ callerPolicy: 'none' })
  const grant = { sectorId: new ObjectId().toString(), memberIds: [member._id.toString()] }

  // without the grant both policies refuse
  assert.equal(checkDelegation(coordinator, member, B, ctxFor(coordinator)).code, 'unauthorized')
  // with it, only the listed member is reachable
  assert.equal(checkDelegation(coordinator, member, B, ctxFor(coordinator, { sectorGrant: grant })).ok, true)
  assert.equal(checkDelegation(coordinator, outsider, B, ctxFor(coordinator, { sectorGrant: grant })).code, 'unauthorized')
})

test('sector grant never overrides owner, building, cycle, depth or budget', () => {
  const coordinator = mkAgent({ delegationPolicy: 'none' })
  const member = mkAgent({ callerPolicy: 'none' })
  const grant = { sectorId: new ObjectId().toString(), memberIds: [member._id.toString()] }
  const withGrant = (over = {}) => ctxFor(coordinator, { sectorGrant: grant, ...over })

  const foreign = mkAgent({ _id: member._id, ownerId: 'other', callerPolicy: 'none' })
  assert.equal(checkDelegation(coordinator, foreign, B, withGrant()).code, 'forbidden')
  assert.equal(checkDelegation(coordinator, member, new ObjectId().toString(), withGrant()).code, 'forbidden')
  assert.equal(checkDelegation(coordinator, member, B, withGrant({ ancestry: [member._id.toString()] })).code, 'cycle')
  assert.equal(checkDelegation(coordinator, member, B, withGrant({ depth: DELEGATION_MAX_DEPTH })).code, 'depth_exceeded')
  assert.equal(checkDelegation(coordinator, member, B, withGrant({ budget: { tokenLimit: 10, tokensSpent: 10 } })).code, 'budget_exceeded')
})

test('the sector grant does not leak one level deeper', () => {
  const coordinator = mkAgent({ delegationPolicy: 'none' })
  const member = mkAgent({ callerPolicy: 'none', delegationPolicy: 'all' })
  const grant = { sectorId: new ObjectId().toString(), memberIds: [member._id.toString()] }
  const child = childContext(ctxFor(coordinator, { sectorGrant: grant }), coordinator, member)
  assert.equal(child.sectorGrant, null)
  // the member cannot re-use the coordinator's grant to call a closed sibling
  const sibling = mkAgent({ callerPolicy: 'none' })
  assert.equal(checkDelegation(member, sibling, B, child).code, 'unauthorized')
})

// ---- executor via injected deps --------------------------------------------
function fakeDeps(agents, over = {}) {
  const byId = new Map(agents.map((a) => [a._id.toString(), a]))
  const started = []
  const finished = []
  const events = []
  return {
    started,
    finished,
    events,
    deps: {
      recordEvent: (e) => events.push(e),
      loadAgent: async (_o, id) => byId.get(id.toString()) ?? null,
      loadSector: async () => over.sector ?? null,
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

// ---- delegate_to_sector by mode --------------------------------------------
function mkSector(over = {}) {
  return { _id: new ObjectId(), name: 'Equipe', officeId: FLOOR_A, mode: 'orchestrated', coordinatorAgentId: null, instruction: '', members: [], stages: [], ...over }
}

test('delegate_to_sector refuses an organization sector (not executable)', async () => {
  const a = mkAgent()
  const sector = mkSector({ mode: 'organization', members: [{ agentId: mkAgent()._id }] })
  const f = fakeDeps([a], { sector })
  const tool = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_sector')
  const out = JSON.parse((await tool.run({ sectorId: sector._id.toString(), objective: 'x' })).result)
  assert.equal(out.status, 'not_executable')
})

test('delegate_to_sector orchestrated runs the coordinator and records parent+child', async () => {
  const a = mkAgent()
  const coord = mkAgent({ name: 'Coord' })
  const sector = mkSector({ mode: 'orchestrated', coordinatorAgentId: coord._id, members: [{ agentId: coord._id, isDefault: true }] })
  const f = fakeDeps([a, coord], { sector })
  const tool = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_sector')
  const out = JSON.parse((await tool.run({ sectorId: sector._id.toString(), objective: 'faça' })).result)
  assert.equal(out.status, 'ok')
  assert.equal(out.output, 'done')
  // one sector record + one child (coordinator) record
  assert.equal(f.started.filter((s) => s.targetType === 'sector').length, 1)
  assert.equal(f.started.filter((s) => s.targetType === 'agent' && s.targetAgentId.equals(coord._id)).length, 1)
})

test('delegate_to_sector pipeline runs stages in order, chaining outputs, one child per stage', async () => {
  const a = mkAgent()
  const s1 = mkAgent({ name: 'S1' })
  const s2 = mkAgent({ name: 'S2' })
  const sector = mkSector({
    mode: 'pipeline',
    stages: [
      { id: 'a', name: 'Coleta', agentId: s1._id, instruction: 'coletar', dependsOn: [], expectedOutput: '', onError: 'stop', retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
      { id: 'b', name: 'Resumo', agentId: s2._id, instruction: 'resumir', dependsOn: ['a'], expectedOutput: '', onError: 'stop', retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
    ],
  })
  // runTask echoes which instruction + input it saw so we can prove chaining.
  const runTask = async (req) => ({ output: `[${req.instructions}<=${req.input ?? ''}]`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] })
  const f = fakeDeps([a, s1, s2], { sector, runTask })
  const tool = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_sector')
  const out = JSON.parse((await tool.run({ sectorId: sector._id.toString(), objective: 'go', input: 'seed' })).result)
  assert.equal(out.status, 'ok')
  // stage b consumed stage a's output
  assert.equal(out.output, '[resumir<=[coletar<=seed]]')
  assert.equal(f.started.filter((s) => s.targetType === 'agent').length, 2) // one child per stage
})

test('delegate_to_sector pipeline onError=continue skips a failing stage', async () => {
  const a = mkAgent()
  const bad = mkAgent({ name: 'Bad' })
  const good = mkAgent({ name: 'Good' })
  const sector = mkSector({
    mode: 'pipeline',
    stages: [
      { id: 'a', name: 'Falha', agentId: bad._id, instruction: 'x', dependsOn: [], expectedOutput: '', onError: 'continue', retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
      { id: 'b', name: 'Segue', agentId: good._id, instruction: 'y', dependsOn: [], expectedOutput: '', onError: 'stop', retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
    ],
  })
  const runTask = async (req) => {
    if (req.instructions === 'x') throw new Error('boom')
    return { output: 'ok-good', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
  }
  const f = fakeDeps([a, bad, good], { sector, runTask })
  const tool = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_sector')
  const out = JSON.parse((await tool.run({ sectorId: sector._id.toString(), objective: 'go' })).result)
  assert.equal(out.status, 'ok')
  assert.equal(out.output, 'ok-good')
  assert.ok(out.warnings && out.warnings.length === 1)
})

test('delegate_to_sector denies when the caller is not authorized for the sector', async () => {
  const a = mkAgent({ delegationPolicy: 'selected', callableSectorIds: [] }) // may call no sector
  const sector = mkSector({ members: [{ agentId: mkAgent()._id }] })
  const f = fakeDeps([a], { sector })
  const tool = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_sector')
  const out = JSON.parse((await tool.run({ sectorId: sector._id.toString(), objective: 'x' })).result)
  assert.equal(out.code, 'unauthorized')
})

test('delegate_to_agent emits a per-agent telemetry event (source=delegation) for the target', async () => {
  const a = mkAgent()
  const b = mkAgent({ preset: 'researcher' })
  const f = fakeDeps([a, b])
  const del = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_agent')
  await del.run({ agentId: b._id.toString(), objective: 'faça' })
  assert.equal(f.events.length, 1)
  const e = f.events[0]
  assert.equal(e.source, 'delegation')
  assert.equal(e.agentId.toString(), b._id.toString())
  assert.equal(e.status, 'succeeded')
  assert.equal(e.inputTokens, 10)
  assert.equal(e.outputTokens, 5)
  assert.ok(e.eventKey.startsWith('deleg:'))
})

test('delegate_to_sector emits a sector event per stage', async () => {
  const a = mkAgent()
  const s1 = mkAgent()
  const s2 = mkAgent()
  const sector = mkSector({
    mode: 'pipeline',
    stages: [
      { id: 'a', name: 'A', agentId: s1._id, instruction: 'x', dependsOn: [], expectedOutput: '', onError: 'stop', retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
      { id: 'b', name: 'B', agentId: s2._id, instruction: 'y', dependsOn: ['a'], expectedOutput: '', onError: 'stop', retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
    ],
  })
  const f = fakeDeps([a, s1, s2], { sector })
  const tool = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_sector')
  await tool.run({ sectorId: sector._id.toString(), objective: 'go' })
  const sectorEvents = f.events.filter((e) => e.source === 'sector')
  assert.equal(sectorEvents.length, 2)
  assert.ok(sectorEvents.every((e) => e.status === 'succeeded'))
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

// ---- the target's contract governs the delegation --------------------------------
// A delegation used to force Markdown on whatever it called, drop a JSON input from
// the retrieval question, and never tell the target what it had promised to produce.

test('the target decides the format when the caller does not ask for one', async () => {
  const a = mkAgent()
  const b = mkAgent({ defaultOutputFormat: 'json', outputJsonSchema: { type: 'object', properties: { total: { type: 'number' } } } })
  let request = null
  const f = fakeDeps([a, b], {
    runTask: async (req) => ((request = req), { output: '{"total":1}', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  })
  const del = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_agent')
  await del.run({ agentId: b._id.toString(), objective: 'some totals' })
  assert.equal(request.output.format, 'json', 'no Markdown forced on a JSON agent')
  assert.ok(request.output.jsonSchema, 'and its schema travels with it')
})

test('an explicit format from the caller still wins', async () => {
  const a = mkAgent()
  const b = mkAgent({ defaultOutputFormat: 'json' })
  let request = null
  const f = fakeDeps([a, b], { runTask: async (req) => ((request = req), { output: 'texto', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }) })
  const del = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_agent')
  await del.run({ agentId: b._id.toString(), objective: 'x', format: 'markdown' })
  assert.equal(request.output.format, 'markdown')
})

test("the target's contracts are part of what it is asked", async () => {
  const a = mkAgent()
  const b = mkAgent({ inputContract: 'um tema', outputContract: 'lista com fontes' })
  let request = null
  const f = fakeDeps([a, b], { runTask: async (req) => ((request = req), { output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }) })
  const del = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_agent')
  await del.run({ agentId: b._id.toString(), objective: 'pesquise' })
  assert.equal(request.contracts.input, 'um tema')
  assert.equal(request.contracts.output, 'lista com fontes')
})

test('a JSON input is delegated as data and is part of the retrieval question', async () => {
  const a = mkAgent()
  const b = mkAgent()
  let request = null
  let askedQuery = ''
  const f = fakeDeps([a, b], {
    runTask: async (req) => ((request = req), { output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
    depsPatch: { retrieveContext: async (_id, query) => ((askedQuery = query), { context: [], sources: [], status: 'empty', failed: false }) },
  })
  const del = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_agent')
  const payload = { pedido: 'A-1', itens: [1, 2] }
  await del.run({ agentId: b._id.toString(), objective: 'resuma o pedido', input: payload })
  assert.deepEqual(request.input, payload, 'the object is handed over as it is')
  assert.match(askedQuery, /A-1/, 'and it is part of what the base is asked about')
})

// ---- pipeline: a stage says what it owes the next one ------------------------------

test('stageInstruction adds the expected output to the instruction', async () => {
  const { stageInstruction } = await import('../dist/delegation.js')
  assert.equal(stageInstruction('Resuma o texto'), 'Resuma o texto')
  const withExpected = stageInstruction('Resuma o texto', 'Um parágrafo com no máximo 3 frases')
  assert.match(withExpected, /Resuma o texto/)
  assert.match(withExpected, /O resultado desta etapa deve ser: Um parágrafo com no máximo 3 frases/)
})

test('a pipeline stage is told what it owes, and an empty hand-off stops the chain', async () => {
  const a = mkAgent()
  const first = mkAgent()
  const second = mkAgent()
  const instructions = []
  const sector = {
    _id: new ObjectId(),
    name: 'Pipeline',
    officeId: FLOOR_A,
    mode: 'pipeline',
    members: [{ agentId: first._id }, { agentId: second._id }],
    stages: [
      { id: 'e1', name: 'Coleta', agentId: first._id, instruction: 'Colete os dados', dependsOn: [], expectedOutput: 'uma lista de itens', retryPolicy: { maxAttempts: 1, backoffMs: 0 }, onError: 'stop' },
      { id: 'e2', name: 'Resumo', agentId: second._id, instruction: 'Resuma', dependsOn: ['e1'], expectedOutput: 'um parágrafo', retryPolicy: { maxAttempts: 1, backoffMs: 0 }, onError: 'stop' },
    ],
  }
  const f = fakeDeps([a, first, second], {
    sector,
    runTask: async (req) => {
      instructions.push(req.instructions)
      // The FIRST stage produces nothing: the second must never run on emptiness.
      return { output: instructions.length === 1 ? '   ' : 'resumo final', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })
  const del = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_sector')
  const out = await del.run({ sectorId: sector._id.toString(), objective: 'processe' })

  assert.match(instructions[0], /O resultado desta etapa deve ser: uma lista de itens/)
  assert.equal(instructions.length, 1, 'the second stage never ran on an empty hand-off')
  assert.equal(out.ok, false)
  assert.equal(f.finished.at(-1).status, 'failed')
})

test('a pipeline that produces real output runs every stage once', async () => {
  const a = mkAgent()
  const first = mkAgent()
  const second = mkAgent()
  const calls = []
  const sector = {
    _id: new ObjectId(),
    name: 'Pipeline',
    officeId: FLOOR_A,
    mode: 'pipeline',
    members: [{ agentId: first._id }, { agentId: second._id }],
    stages: [
      { id: 'e1', name: 'Coleta', agentId: first._id, instruction: 'Colete', dependsOn: [], expectedOutput: 'itens', retryPolicy: { maxAttempts: 2, backoffMs: 0 }, onError: 'stop' },
      { id: 'e2', name: 'Resumo', agentId: second._id, instruction: 'Resuma', dependsOn: ['e1'], expectedOutput: '', retryPolicy: { maxAttempts: 2, backoffMs: 0 }, onError: 'stop' },
    ],
  }
  const f = fakeDeps([a, first, second], {
    sector,
    runTask: async (req) => (calls.push(req.instructions), { output: `saída ${calls.length}`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
  })
  const del = buildDelegationTools(ctxFor(a), f.deps).find((t) => t.name === 'delegate_to_sector')
  const out = await del.run({ sectorId: sector._id.toString(), objective: 'processe' })
  assert.equal(out.ok, true)
  assert.equal(calls.length, 2, 'no completed stage is called twice')
  assert.equal(JSON.parse(out.result).output, 'saída 2')
})

// --- descoberta por competência -------------------------------------------------------
//
// É por estas etiquetas que um coordenador encontra quem sabe fazer a coisa. Elas eram
// gravadas uma vez, na contratação, e nenhuma tela as editava — agora editam, e a busca
// precisa achar o que foi escrito.

const comCompetencias = (caps, over = {}) => mkAgent({ capabilities: caps, ...over })

const buscar = async (agentes, capability) => {
  const chamador = agentes[0]
  const deps = {
    loadAgent: async (_o, id) => agentes.find((a) => a._id.toString() === id.toString()) ?? null,
    listAgentsInBuilding: async () => agentes,
    buildingIdForFloor: async () => BUILDING.toString(),
    resolveTools: async () => [],
    apiKeyFor: async () => 'k',
    runTask: async () => ({ output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
    startDelegation: async () => new ObjectId(),
    finishDelegation: async () => undefined,
  }
  const ferramenta = buildDelegationTools(ctxFor(chamador), deps).find((t) => t.name === 'list_available_agents')
  const r = await ferramenta.run(capability ? { capability } : {})
  return JSON.parse(r.result).agents.map((a) => a.name)
}

test('a busca por competência acha quem tem a etiqueta', async () => {
  const chamador = comCompetencias([], { name: 'Coordenador', delegationPolicy: 'all' })
  const juridico = comCompetencias(['jurídico'], { name: 'Advogado' })
  const financeiro = comCompetencias(['mercado financeiro'], { name: 'Analista' })

  assert.deepEqual(await buscar([chamador, juridico, financeiro], 'jurídico'), ['Advogado'])
  assert.deepEqual(await buscar([chamador, juridico, financeiro], 'financeiro'), ['Analista'])
})

test('acento não separa quem procura de quem foi etiquetado', async () => {
  const chamador = comCompetencias([], { name: 'Coordenador', delegationPolicy: 'all' })
  const alvo = comCompetencias(['jurídico'], { name: 'Advogado' })
  // Quem digitou a etiqueta com til e quem procura sem ele falam da mesma competência.
  assert.deepEqual(await buscar([chamador, alvo], 'juridico'), ['Advogado'])
  // E o contrário também.
  const semTil = comCompetencias(['juridico'], { name: 'Outro' })
  assert.deepEqual(await buscar([chamador, semTil], 'JURÍDICO'), ['Outro'])
})

test('sem competência pedida, lista todos os alcançáveis', async () => {
  const chamador = comCompetencias([], { name: 'Coordenador', delegationPolicy: 'all' })
  const a = comCompetencias(['x'], { name: 'A' })
  const b = comCompetencias(['y'], { name: 'B' })
  assert.deepEqual((await buscar([chamador, a, b])).sort(), ['A', 'B'])
})

test('o nome também casa — procurar pelo que se lembra funciona', async () => {
  const chamador = comCompetencias([], { name: 'Coordenador', delegationPolicy: 'all' })
  const alvo = comCompetencias([], { name: 'Pesquisador de Mercado' })
  assert.deepEqual(await buscar([chamador, alvo], 'mercado'), ['Pesquisador de Mercado'])
})
