// INTEGRATION: hierarchical analytics without double counting, against a REAL mongod.
//
// The failure this prevents: one task that crossed two floors and three agents being
// counted once as a building execution, twice as floor executions and three times as
// agent executions — six numbers that never reconcile. A ROOT is one request;
// everything else is a participation in it.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { startExecutionRoot, markRootRunning, finishExecutionRoot, executionAnalytics, executionBreakdown, ensureExecutionRootIndexes, runExecutionKey } =
  await import('../dist/executionRoots.js')
const { recordAgentEvent } = await import('../dist/agentEvents.js')

const OWNER = 'roots-owner'
const OTHER = 'roots-other'
const FLOOR_A = new ObjectId()
const FLOOR_B = new ObjectId()
const A1 = new ObjectId()
const A2 = new ObjectId()
const A3 = new ObjectId()
const roots = () => db.collection('execution_roots')
const events = () => db.collection('agent_execution_events')

before(async () => {
  await mongoClient.connect()
  await ensureExecutionRootIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  await Promise.all([roots().deleteMany({}), events().deleteMany({})])
})

const startRoot = (over = {}) =>
  startExecutionRoot({
    executionKey: over.executionKey ?? 'run:1',
    ownerId: over.ownerId ?? OWNER,
    buildingId: over.buildingId ?? new ObjectId(),
    originFloorId: over.originFloorId ?? FLOOR_A,
    source: over.source ?? 'schedule',
    environment: over.environment,
    createdAt: over.createdAt ?? new Date('2026-01-01T10:00:00Z'),
  })

const participation = (rootId, over = {}) =>
  recordAgentEvent({
    eventKey: over.eventKey ?? `ev:${new ObjectId().toString()}`,
    ownerId: OWNER,
    agentId: over.agentId ?? A1,
    floorId: over.floorId ?? FLOOR_A,
    source: 'routine',
    status: over.status ?? 'succeeded',
    startedAt: over.startedAt ?? new Date('2026-01-01T10:00:01Z'),
    finishedAt: over.finishedAt ?? new Date('2026-01-01T10:00:04Z'),
    inputTokens: over.inputTokens ?? 100,
    outputTokens: over.outputTokens ?? 50,
    rootExecutionId: rootId,
    metadata: { durationMs: over.durationMs ?? 3000 },
  })

// --- a raiz ------------------------------------------------------------------------

test('uma tarefa que cruza dois andares e três agentes é UMA execução do prédio', async () => {
  const rootId = await startRoot()
  await participation(rootId, { agentId: A1, floorId: FLOOR_A })
  await participation(rootId, { agentId: A2, floorId: FLOOR_B })
  await participation(rootId, { agentId: A3, floorId: FLOOR_B })
  await markRootRunning('run:1', new Date('2026-01-01T10:00:01Z'))
  await finishExecutionRoot('run:1', { status: 'succeeded', finishedAt: new Date('2026-01-01T10:00:07Z') })

  const building = await executionAnalytics({ ownerId: OWNER, scope: 'building', period: 'all' })
  assert.equal(building.executions, 1)
  assert.equal(building.participations, 3)
  // Ponta a ponta é da raiz; tempo ativo é a soma das folhas e pode ser maior.
  assert.equal(building.avgDurationMs, 6000)
  assert.equal(building.activeTimeMs, 9000)
  assert.equal(building.totalTokens, 450)
  assert.equal(building.avgQueueMs, 1000)
})

test('o andar de origem conta a tarefa uma vez, e o outro andar não a reivindica', async () => {
  const rootId = await startRoot({ originFloorId: FLOOR_A })
  await participation(rootId, { agentId: A1, floorId: FLOOR_A })
  await participation(rootId, { agentId: A2, floorId: FLOOR_B })
  await finishExecutionRoot('run:1', { status: 'succeeded' })

  const a = await executionAnalytics({ ownerId: OWNER, scope: 'floor', period: 'all', floorId: FLOOR_A })
  const b = await executionAnalytics({ ownerId: OWNER, scope: 'floor', period: 'all', floorId: FLOOR_B })
  // "Tarefa originada" é do andar de origem: somar A e B não infla o prédio.
  assert.equal(a.executions, 1)
  assert.equal(b.executions, 0)
  // Participação é outra métrica, e é rotulada como tal.
  assert.equal(b.participations, 1)
})

test('o agente conta as execuções de que participou, não as do prédio', async () => {
  const first = await startRoot({ executionKey: 'run:1' })
  await participation(first, { agentId: A1 })
  const second = await startRoot({ executionKey: 'run:2' })
  await participation(second, { agentId: A2 })
  await finishExecutionRoot('run:1', { status: 'succeeded' })
  await finishExecutionRoot('run:2', { status: 'succeeded' })

  const agent = await executionAnalytics({ ownerId: OWNER, scope: 'agent', period: 'all', agentId: A1 })
  assert.equal(agent.executions, 1)
  assert.equal((await executionAnalytics({ ownerId: OWNER, scope: 'building', period: 'all' })).executions, 2)
})

test('duas participações do mesmo agente na mesma raiz não viram duas execuções', async () => {
  const rootId = await startRoot()
  await participation(rootId, { agentId: A1 })
  await participation(rootId, { agentId: A1 })
  await finishExecutionRoot('run:1', { status: 'succeeded' })

  const agent = await executionAnalytics({ ownerId: OWNER, scope: 'agent', period: 'all', agentId: A1 })
  assert.equal(agent.executions, 1)
  assert.equal(agent.participations, 2)
})

test('a raiz é idempotente e o primeiro terminal vence', async () => {
  const first = await startRoot()
  const second = await startRoot()
  assert.equal(first.toString(), second.toString())
  await finishExecutionRoot('run:1', { status: 'succeeded' })
  await finishExecutionRoot('run:1', { status: 'failed', errorKind: 'provider' })
  const doc = await roots().findOne({ executionKey: 'run:1' })
  assert.equal(doc.status, 'succeeded')
})

test('a chave de execução é derivada da run', () => {
  assert.equal(runExecutionKey('abc'), 'run:abc')
})

// --- honestidade --------------------------------------------------------------------

test('evento sem raiz é telemetria parcial, nunca um chute', async () => {
  await recordAgentEvent({
    eventKey: 'legado',
    ownerId: OWNER,
    agentId: A1,
    floorId: FLOOR_A,
    source: 'routine',
    status: 'succeeded',
    startedAt: new Date('2026-01-01T10:00:00Z'),
    finishedAt: new Date('2026-01-01T10:00:02Z'),
    inputTokens: 10,
    outputTokens: 5,
  })
  const building = await executionAnalytics({ ownerId: OWNER, scope: 'building', period: 'all' })
  assert.equal(building.executions, 0)
  assert.equal(building.partialTelemetry, 1)
  // Os tokens da folha continuam visíveis; a execução é que não foi inventada.
  assert.equal(building.totalTokens, 15)
})

test('sem nada, a resposta é honesta em vez de zerada', async () => {
  const building = await executionAnalytics({ ownerId: OWNER, scope: 'building', period: 'all' })
  assert.equal(building.telemetrySince, null)
  assert.equal(building.successRate, null)
  assert.equal(building.avgDurationMs, null)
})

test('execução de teste fica fora das métricas de produção', async () => {
  await startRoot({ executionKey: 'run:test', environment: 'test' })
  await finishExecutionRoot('run:test', { status: 'succeeded' })
  assert.equal((await executionAnalytics({ ownerId: OWNER, scope: 'building', period: 'all' })).executions, 0)
  assert.equal((await executionAnalytics({ ownerId: OWNER, scope: 'building', period: 'all', includeTest: true })).executions, 1)
})

test('o prédio de outro dono não aparece', async () => {
  await startRoot({ ownerId: OTHER, executionKey: 'run:alheio' })
  assert.equal((await executionAnalytics({ ownerId: OWNER, scope: 'building', period: 'all' })).executions, 0)
})

test('P95 e média são calculados no backend, sobre a mesma janela', async () => {
  for (let i = 0; i < 4; i++) {
    const key = `run:${i}`
    await startRoot({ executionKey: key, createdAt: new Date('2026-01-01T10:00:00Z') })
    await markRootRunning(key, new Date('2026-01-01T10:00:00Z'))
    await finishExecutionRoot(key, { status: 'succeeded', finishedAt: new Date(Date.UTC(2026, 0, 1, 10, 0, (i + 1) * 2)) })
  }
  const building = await executionAnalytics({ ownerId: OWNER, scope: 'building', period: 'all' })
  assert.equal(building.avgDurationMs, 5000)
  assert.equal(building.p95DurationMs, 8000)
})

// --- breakdown -----------------------------------------------------------------------

test('o breakdown por agente conta raízes distintas, não participações', async () => {
  const rootId = await startRoot()
  await participation(rootId, { agentId: A1 })
  await participation(rootId, { agentId: A1 })
  await participation(rootId, { agentId: A2 })

  const rows = await executionBreakdown(OWNER, 'agent', { period: 'all' })
  const first = rows.find((r) => r.id === A1.toString())
  assert.equal(first.executions, 1)
  assert.equal(first.participations, 2)
})

test('o breakdown por andar separa onde o trabalho aconteceu', async () => {
  const rootId = await startRoot()
  await participation(rootId, { agentId: A1, floorId: FLOOR_A })
  await participation(rootId, { agentId: A2, floorId: FLOOR_B })
  const rows = await executionBreakdown(OWNER, 'floor', { period: 'all' })
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r.executions), [1, 1])
})

// --- originado x participado ---------------------------------------------------------

test('o andar separa o que ORIGINOU do que apenas participou', async () => {
  // Uma tarefa nasce no andar A e envolve um agente do andar B.
  const rootId = await startRoot({ originFloorId: FLOOR_A })
  await participation(rootId, { agentId: A1, floorId: FLOOR_A, inputTokens: 100, outputTokens: 50 })
  await participation(rootId, { agentId: A2, floorId: FLOOR_B, inputTokens: 300, outputTokens: 100 })
  await finishExecutionRoot('run:1', { status: 'succeeded' })

  const a = await executionAnalytics({ ownerId: OWNER, scope: 'floor', period: 'all', floorId: FLOOR_A })
  const b = await executionAnalytics({ ownerId: OWNER, scope: 'floor', period: 'all', floorId: FLOOR_B })

  // O andar A originou uma; o andar B não originou nenhuma...
  assert.equal(a.executions, 1)
  assert.equal(b.executions, 0)
  // ...mas participou de uma, e isso é dito com outro nome.
  assert.equal(b.participatedExecutions, 1)
  assert.equal(b.participations, 1)
})

test('tokens de participação não são divididos por raízes originadas', async () => {
  const rootId = await startRoot({ originFloorId: FLOOR_A })
  await participation(rootId, { agentId: A2, floorId: FLOOR_B, inputTokens: 300, outputTokens: 100 })
  await finishExecutionRoot('run:1', { status: 'succeeded' })

  const b = await executionAnalytics({ ownerId: OWNER, scope: 'floor', period: 'all', floorId: FLOOR_B })
  // 400 tokens gastos em 1 execução participada. Dividir por 0 originadas seria um
  // KPI sem sentido — e era exatamente o que acontecia.
  assert.equal(b.totalTokens, 400)
  assert.equal(b.avgTokensPerExecution, 400)
})

test('o prédio continua contando a mesma tarefa uma vez só', async () => {
  const rootId = await startRoot({ originFloorId: FLOOR_A })
  await participation(rootId, { agentId: A1, floorId: FLOOR_A })
  await participation(rootId, { agentId: A2, floorId: FLOOR_B })
  await participation(rootId, { agentId: A3, floorId: FLOOR_B })
  await finishExecutionRoot('run:1', { status: 'succeeded' })

  const building = await executionAnalytics({ ownerId: OWNER, scope: 'building', period: 'all' })
  const a = await executionAnalytics({ ownerId: OWNER, scope: 'floor', period: 'all', floorId: FLOOR_A })
  const b = await executionAnalytics({ ownerId: OWNER, scope: 'floor', period: 'all', floorId: FLOOR_B })
  assert.equal(building.executions, 1)
  // Somar os andares dá o mesmo total, porque só quem originou conta.
  assert.equal(a.executions + b.executions, building.executions)
})

test('uma execução de teste tem raiz e continua fora da produção', async () => {
  const rootId = await startRoot({ executionKey: 'manual:1', source: 'manual', environment: 'test' })
  await participation(rootId, { agentId: A1 })
  await finishExecutionRoot('manual:1', { status: 'succeeded' })

  assert.equal((await executionAnalytics({ ownerId: OWNER, scope: 'building', period: 'all' })).executions, 0)
  const withTest = await executionAnalytics({ ownerId: OWNER, scope: 'building', period: 'all', includeTest: true })
  assert.equal(withTest.executions, 1)
  // E a raiz existe de verdade: a execução é correlacionada, não invisível.
  assert.equal(withTest.participations, 1)
})

test('canal e manual entram nas métricas como qualquer outra origem', async () => {
  for (const [key, source] of [['channel:w:c:1', 'channel'], ['run:2', 'schedule']]) {
    const id = await startRoot({ executionKey: key, source })
    await participation(id, { agentId: A1, eventKey: `ev-${key}` })
    await finishExecutionRoot(key, { status: 'succeeded' })
  }
  const building = await executionAnalytics({ ownerId: OWNER, scope: 'building', period: 'all' })
  assert.equal(building.executions, 2)
})
