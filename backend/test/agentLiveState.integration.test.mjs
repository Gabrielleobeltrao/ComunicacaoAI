// INTEGRATION: the live-state projection against a REAL mongod.
//
// What is pinned here is what makes the map trustworthy: a replayed transition
// changes nothing, a late one never overwrites a newer one, an execution that ends —
// including a crash, a timeout or a cancellation — always lands on a terminal state,
// and a row that nobody refreshes disappears on its own.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { reportAgentState, finishAgentState, clearAgentState, agentLiveStatesForFloor, ensureAgentLiveStateIndexes } = await import(
  '../dist/agentLiveState.js'
)
const { createLiveTracker } = await import('../dist/agentLiveTracker.js')
const { executeRoutineStep } = await import('../dist/automations/routineExecution.js')

const OWNER = 'live-owner'
const OTHER = 'live-other'
const FLOOR = new ObjectId()
const AGENT = new ObjectId()
const states = () => db.collection('agent_live_states')

before(async () => {
  await mongoClient.connect()
  await ensureAgentLiveStateIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(() => states().deleteMany({}))

const base = { ownerId: OWNER, agentId: AGENT, floorId: FLOOR, rootExecutionId: 'run-1' }
const read = () => states().findOne({ ownerId: OWNER, agentId: AGENT, rootExecutionId: 'run-1' })

test('uma transição vira exatamente uma linha, com prazo de validade', async () => {
  await reportAgentState({ ...base, state: 'thinking' })
  const doc = await read()
  assert.equal(doc.state, 'thinking')
  assert.ok(doc.expiresAt > doc.updatedAt)
  assert.equal(await states().countDocuments({}), 1)
})

test('repetir a mesma transição não cria uma segunda linha', async () => {
  const at = new Date()
  await reportAgentState({ ...base, state: 'thinking', at, sequence: 100 })
  await reportAgentState({ ...base, state: 'thinking', at, sequence: 100 })
  assert.equal(await states().countDocuments({}), 1)
})

test('uma transição atrasada nunca sobrescreve uma mais nova', async () => {
  await reportAgentState({ ...base, state: 'using_tool', sequence: 200 })
  await reportAgentState({ ...base, state: 'queued', sequence: 100 })
  assert.equal((await read()).state, 'using_tool')
})

test('o índice único é por (dono, agente, execução): duas execuções coexistem', async () => {
  await reportAgentState({ ...base, state: 'thinking' })
  await reportAgentState({ ...base, rootExecutionId: 'run-2', state: 'delivering' })
  assert.equal(await states().countDocuments({ ownerId: OWNER, agentId: AGENT }), 2)
  const { states: visual } = await agentLiveStatesForFloor(OWNER, FLOOR)
  // Uma linha por agente no mapa, com a contagem das outras.
  assert.equal(visual.length, 1)
  assert.equal(visual[0].state, 'delivering')
  assert.equal(visual[0].concurrent, 2)
})

test('terminar é sempre terminal, e some rápido', async () => {
  await reportAgentState({ ...base, state: 'using_tool' })
  await finishAgentState({ ...base, state: 'failed' })
  const doc = await read()
  assert.equal(doc.state, 'failed')
  assert.ok(doc.expiresAt.getTime() - doc.updatedAt.getTime() <= 6_000)
})

test('cancelar durante uma ferramenta ainda termina a linha', async () => {
  const tracker = createLiveTracker({ ...base, agentId: AGENT.toString() })
  tracker.report('using_tool')
  await tracker.finish('canceled')
  assert.equal((await read()).state, 'canceled')
})

test('uma linha vencida não aparece no mapa mesmo antes de o Mongo removê-la', async () => {
  const past = new Date(Date.now() - 60_000)
  await states().insertOne({
    _id: new ObjectId(),
    ownerId: OWNER,
    agentId: AGENT,
    floorId: FLOOR,
    rootExecutionId: 'run-morto',
    state: 'thinking',
    detail: null,
    sequence: 1,
    startedAt: past,
    updatedAt: past,
    expiresAt: past,
  })
  const { states: visual } = await agentLiveStatesForFloor(OWNER, FLOOR)
  assert.deepEqual(visual, [])
})

test('o índice de TTL existe: um worker morto não deixa agente pensando para sempre', async () => {
  const indexes = await states().indexes()
  const ttl = indexes.find((i) => i.expireAfterSeconds !== undefined)
  assert.ok(ttl, 'faltou o índice TTL')
  assert.deepEqual(ttl.key, { expiresAt: 1 })
})

test('o andar de outro dono não devolve nada', async () => {
  await reportAgentState({ ...base, state: 'thinking' })
  const { states: visual } = await agentLiveStatesForFloor(OTHER, FLOOR)
  assert.deepEqual(visual, [])
})

test('limpar remove a participação sem tocar nas outras', async () => {
  await reportAgentState({ ...base, state: 'thinking' })
  await reportAgentState({ ...base, rootExecutionId: 'run-2', state: 'thinking' })
  await clearAgentState(OWNER, AGENT, 'run-1')
  assert.equal(await states().countDocuments({ ownerId: OWNER }), 1)
})

test('o detalhe guardado passou pela allowlist', async () => {
  await reportAgentState({ ...base, state: 'using_tool', detail: { appKey: 'google', actionLabel: 'Criar evento', url: 'https://x/y?token=abc' } })
  const doc = await read()
  assert.deepEqual(doc.detail, { appKey: 'google', actionLabel: 'Criar evento' })
  assert.ok(!JSON.stringify(doc).includes('token=abc'))
})

// --- o caminho real de uma rotina ------------------------------------------------

const agentDoc = (over = {}) => ({
  _id: AGENT,
  ownerId: OWNER,
  officeId: FLOOR,
  name: 'Ana',
  objective: 'Atender',
  provider: 'anthropic',
  model: null,
  preset: 'custom',
  ...over,
})

const stepDeps = (over = {}) => ({
  loadAgent: async () => agentDoc(over.agent ?? {}),
  resolveOwnedSectorId: async () => null,
  retrieveContext: async () => ({ context: ['trecho'], failed: false, status: 'ok', sources: [] }),
  resolveTools: async () => [],
  apiKeyFor: async () => 'k',
  runTask: over.runTask ?? (async (req) => {
    req.progress?.('thinking')
    return { output: 'pronto', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
  }),
  charge: async () => true,
  chargeKeyFor: (runId, stepId, agentId, attempt) => `${runId}:${stepId}:${agentId}:${attempt}`,
  finalizeEvent: async () => undefined,
  eventKeyFor: (runId, stepId, agentId) => `run:${runId}:${stepId}:${agentId}`,
  trackerFor: (agentId) => createLiveTracker({ ownerId: OWNER, agentId, floorId: FLOOR, rootExecutionId: 'run-real' }),
  sleep: async () => undefined,
  ...over.deps,
})

const call = { agentId: AGENT.toString(), stepId: 's1', attempt: 1, objective: 'Resumir', instructions: 'faça', input: {}, context: [] }
const ctx = { ownerId: OWNER, runId: 'run-real', buildingId: new ObjectId(), floorId: FLOOR }

test('uma execução real de rotina passa por leitura de base e termina concluída', async () => {
  const result = await executeRoutineStep(call, ctx, stepDeps())
  await result.settle
  const doc = await states().findOne({ ownerId: OWNER, rootExecutionId: 'run-real' })
  assert.equal(doc.state, 'completed')
  assert.equal(doc.floorId.toString(), FLOOR.toString())
})

test('uma execução que falha termina em failed, não fica pensando', async () => {
  const deps = stepDeps({
    runTask: async () => {
      throw Object.assign(new Error('provider caiu'), { kind: 'provider' })
    },
  })
  await assert.rejects(() => executeRoutineStep(call, ctx, deps))
  assert.equal((await states().findOne({ ownerId: OWNER, rootExecutionId: 'run-real' })).state, 'failed')
})

test('cancelamento durante a execução termina em canceled', async () => {
  const deps = stepDeps({
    runTask: async () => {
      throw Object.assign(new Error('tempo esgotado'), { kind: 'timeout' })
    },
    deps: { isCanceled: async () => true },
  })
  await assert.rejects(() => executeRoutineStep(call, ctx, deps))
  assert.equal((await states().findOne({ ownerId: OWNER, rootExecutionId: 'run-real' })).state, 'canceled')
})

test('agente que exige base e não tem fica bloqueado, sem gastar inferência', async () => {
  let called = false
  const deps = stepDeps({
    agent: { requireGrounding: true },
    runTask: async () => {
      called = true
      return { output: '', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [] }
    },
    deps: { retrieveContext: async () => ({ context: [], failed: true, status: 'unavailable', sources: [] }) },
  })
  await assert.rejects(() => executeRoutineStep(call, ctx, deps))
  assert.equal(called, false)
  assert.equal((await states().findOne({ ownerId: OWNER, rootExecutionId: 'run-real' })).state, 'blocked')
})
