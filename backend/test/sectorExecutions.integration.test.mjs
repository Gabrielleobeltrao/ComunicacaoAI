// INTEGRATION: the sector execution root, against a REAL mongod.
//
// The claim that matters: a sector run counts ONCE, however many agents it touched.
// Everything else follows from it — tokens and durations come from the child events,
// a retry reuses the root, a failure before the first agent still exists, and a
// playground run is recorded but stays out of production numbers.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const {
  startSectorExecution,
  finishSectorExecution,
  recordFailedSectorExecution,
  sectorExecutionSummary,
  listSectorExecutions,
  sectorExecutionTimeline,
  sectorExecutionKey,
  ensureSectorExecutionIndexes,
} = await import('../dist/sectorExecutions.js')
const { recordAgentEvent } = await import('../dist/agentEvents.js')

const OWNER = 'sector-owner'
const OTHER = 'sector-other'
const SECTOR = new ObjectId()
const FLOOR = new ObjectId()
const A1 = new ObjectId()
const A2 = new ObjectId()
const executions = () => db.collection('sector_executions')
const events = () => db.collection('agent_execution_events')

before(async () => {
  await mongoClient.connect()
  await ensureSectorExecutionIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  await Promise.all([executions().deleteMany({}), events().deleteMany({})])
})

const start = (over = {}) =>
  startSectorExecution({
    executionKey: over.executionKey ?? 'sector:run-1:s1:a0:0',
    ownerId: over.ownerId ?? OWNER,
    sectorId: over.sectorId ?? SECTOR,
    sectorName: 'Cozinha',
    sectorMode: 'pipeline',
    floorId: FLOOR,
    source: 'delegation',
    correlationId: 'run-1',
    callerAgentId: null,
    environment: over.environment,
    startedAt: over.startedAt,
  })

const participation = (rootId, over = {}) =>
  recordAgentEvent({
    eventKey: over.eventKey ?? `deleg:${new ObjectId().toString()}`,
    ownerId: over.ownerId ?? OWNER,
    agentId: over.agentId ?? A1,
    floorId: FLOOR,
    source: 'sector',
    status: over.status ?? 'succeeded',
    startedAt: over.startedAt ?? new Date('2026-01-01T10:00:00Z'),
    finishedAt: over.finishedAt ?? new Date('2026-01-01T10:00:05Z'),
    inputTokens: over.inputTokens ?? 100,
    outputTokens: over.outputTokens ?? 50,
    toolCalls: over.toolCalls ?? 1,
    sectorExecutionId: rootId,
    metadata: { durationMs: over.durationMs ?? 5000, role: over.role ?? 'pipeline_stage', ...(over.metadata ?? {}) },
  })

// --- a raiz ---------------------------------------------------------------------

test('um fluxo com três agentes é UMA execução do setor', async () => {
  const rootId = await start()
  await participation(rootId, { agentId: A1, metadata: { stageId: 'e1', stageName: 'Anotar', stageOrder: 1 } })
  await participation(rootId, { agentId: A2, metadata: { stageId: 'e2', stageName: 'Preparar', stageOrder: 2 } })
  await participation(rootId, { agentId: A1, metadata: { stageId: 'e3', stageName: 'Revisar', stageOrder: 3 } })
  await finishSectorExecution('sector:run-1:s1:a0:0', { status: 'succeeded' })

  const summary = await sectorExecutionSummary(OWNER, SECTOR, 'all')
  assert.equal(summary.executions, 1)
  assert.equal(summary.succeeded, 1)
  // As participações contam três; a execução continua contando uma.
  assert.equal(summary.avgParticipants, 3)
  assert.equal(summary.totalTokens, 450)
})

test('a chave é do CHAMADO, não da tentativa: repetir não duplica a raiz', async () => {
  const first = await start()
  const second = await start()
  assert.equal(first.toString(), second.toString())
  assert.equal(await executions().countDocuments({}), 1)
})

test('o primeiro estado terminal vence: uma falha atrasada não apaga o sucesso', async () => {
  await start()
  await finishSectorExecution('sector:run-1:s1:a0:0', { status: 'succeeded' })
  await finishSectorExecution('sector:run-1:s1:a0:0', { status: 'failed', errorKind: 'stage_failed' })
  const doc = await executions().findOne({})
  assert.equal(doc.status, 'succeeded')
  assert.equal(doc.errorKind, null)
})

test('a duração ponta a ponta vem da raiz, não da soma dos agentes', async () => {
  const startedAt = new Date('2026-01-01T10:00:00Z')
  await start({ startedAt })
  await finishSectorExecution('sector:run-1:s1:a0:0', { status: 'succeeded', finishedAt: new Date('2026-01-01T10:00:30Z') })
  const doc = await executions().findOne({})
  assert.equal(doc.durationMs, 30_000)
})

test('tempo ativo pode passar da duração do fluxo e é rotulado à parte', async () => {
  const rootId = await start({ startedAt: new Date('2026-01-01T10:00:00Z') })
  // Dois agentes em paralelo, 5s cada, num fluxo de 6s.
  await participation(rootId, { agentId: A1, durationMs: 5000 })
  await participation(rootId, { agentId: A2, durationMs: 5000 })
  await finishSectorExecution('sector:run-1:s1:a0:0', { status: 'succeeded', finishedAt: new Date('2026-01-01T10:00:06Z') })

  const summary = await sectorExecutionSummary(OWNER, SECTOR, 'all')
  assert.equal(summary.avgDurationMs, 6000)
  assert.equal(summary.activeTimeMs, 10_000)
})

test('uma falha antes do primeiro agente ainda é uma execução', async () => {
  await recordFailedSectorExecution({
    executionKey: 'sector:run-9:s1:a0:0',
    ownerId: OWNER,
    sectorId: SECTOR,
    sectorName: 'Cozinha',
    sectorMode: 'pipeline',
    floorId: FLOOR,
    source: 'delegation',
    correlationId: 'run-9',
    errorKind: 'no_stages',
  })
  const summary = await sectorExecutionSummary(OWNER, SECTOR, 'all')
  assert.equal(summary.executions, 1)
  assert.equal(summary.failed, 1)
  assert.equal(summary.successRate, 0)
})

test('sem telemetria, a resposta é honesta em vez de zerada', async () => {
  const summary = await sectorExecutionSummary(OWNER, SECTOR, 'all')
  assert.equal(summary.executions, 0)
  assert.equal(summary.telemetrySince, null)
  assert.equal(summary.successRate, null)
  assert.equal(summary.avgDurationMs, null)
})

test('o playground é gravado e fica fora das métricas de produção', async () => {
  await start({ executionKey: 'sector:test-1:s1:a0:0', environment: 'test' })
  await finishSectorExecution('sector:test-1:s1:a0:0', { status: 'succeeded' })

  assert.equal((await sectorExecutionSummary(OWNER, SECTOR, 'all')).executions, 0)
  assert.equal((await sectorExecutionSummary(OWNER, SECTOR, 'all', { includeTest: true })).executions, 1)
})

test('o setor de outro dono não devolve nada', async () => {
  await start()
  assert.equal((await sectorExecutionSummary(OTHER, SECTOR, 'all')).executions, 0)
})

test('o snapshot preserva o setor como ele era na execução', async () => {
  await start()
  const doc = await executions().findOne({})
  assert.equal(doc.sectorName, 'Cozinha')
  assert.equal(doc.sectorMode, 'pipeline')
  // Renomear o setor depois não reescreve o passado.
  assert.equal(doc.sectorId.toString(), SECTOR.toString())
})

// --- por agente/etapa -------------------------------------------------------------

test('um agente chamado duas vezes tem duas participações e uma execução', async () => {
  const rootId = await start()
  await participation(rootId, { agentId: A1, metadata: { stageId: 'e1', stageName: 'Anotar', stageOrder: 1 } })
  await participation(rootId, { agentId: A1, metadata: { stageId: 'e2', stageName: 'Revisar', stageOrder: 2 } })
  await finishSectorExecution('sector:run-1:s1:a0:0', { status: 'succeeded' })

  const summary = await sectorExecutionSummary(OWNER, SECTOR, 'all')
  assert.equal(summary.executions, 1)
  const rows = summary.byParticipant.filter((p) => p.agentId === A1.toString())
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r.stageName).sort(), ['Anotar', 'Revisar'])
})

// --- histórico ---------------------------------------------------------------------

test('o histórico vem do mais recente para o mais antigo e pagina com cursor', async () => {
  for (let i = 0; i < 3; i++) {
    const key = `sector:run-${i}:s1:a0:0`
    await start({ executionKey: key, startedAt: new Date(Date.UTC(2026, 0, 1 + i)) })
    await finishSectorExecution(key, { status: 'succeeded' })
  }
  const first = await listSectorExecutions(OWNER, SECTOR, { limit: 2 })
  assert.equal(first.items.length, 2)
  assert.ok(first.items[0].startedAt > first.items[1].startedAt)
  assert.ok(first.nextCursor)

  const second = await listSectorExecutions(OWNER, SECTOR, { limit: 2, cursor: first.nextCursor })
  assert.equal(second.items.length, 1)
  assert.equal(second.nextCursor, null)
})

test('filtrar por agente devolve as execuções em que ele participou', async () => {
  const withA1 = await start({ executionKey: 'sector:run-a:s1:a0:0' })
  await participation(withA1, { agentId: A1 })
  const withA2 = await start({ executionKey: 'sector:run-b:s1:a0:0' })
  await participation(withA2, { agentId: A2 })

  const list = await listSectorExecutions(OWNER, SECTOR, { agentId: A1.toString() })
  assert.equal(list.items.length, 1)
  assert.equal(list.items[0].id, withA1.toString())
})

test('filtrar por status funciona sem inventar linhas', async () => {
  await start({ executionKey: 'sector:ok:s1:a0:0' })
  await finishSectorExecution('sector:ok:s1:a0:0', { status: 'succeeded' })
  await start({ executionKey: 'sector:bad:s1:a0:0' })
  await finishSectorExecution('sector:bad:s1:a0:0', { status: 'failed', errorKind: 'stage_failed' })

  const failed = await listSectorExecutions(OWNER, SECTOR, { status: 'failed' })
  assert.equal(failed.items.length, 1)
  assert.equal(failed.items[0].errorKind, 'stage_failed')
})

// --- timeline -----------------------------------------------------------------------

test('a timeline mostra a ordem real e nada do que foi dito', async () => {
  const rootId = await start()
  await participation(rootId, {
    agentId: A1,
    startedAt: new Date('2026-01-01T10:00:00Z'),
    finishedAt: new Date('2026-01-01T10:00:05Z'),
    metadata: { stageId: 'e1', stageName: 'Anotar pedido', stageOrder: 1 },
  })
  await participation(rootId, {
    agentId: A2,
    status: 'failed',
    startedAt: new Date('2026-01-01T10:00:05Z'),
    finishedAt: new Date('2026-01-01T10:00:08Z'),
    metadata: { stageId: 'e2', stageName: 'Preparar', stageOrder: 2, errorKind: 'provider' },
  })
  await finishSectorExecution('sector:run-1:s1:a0:0', { status: 'failed', errorKind: 'stage_failed' })

  const timeline = await sectorExecutionTimeline(OWNER, rootId)
  assert.equal(timeline.steps.length, 2)
  assert.deepEqual(timeline.steps.map((s) => s.stageName), ['Anotar pedido', 'Preparar'])
  assert.equal(timeline.steps[1].status, 'failed')
  // Categoria, nunca a mensagem.
  assert.equal(timeline.steps[1].errorKind, 'provider')
  const json = JSON.stringify(timeline)
  for (const forbidden of ['prompt', 'output', 'arguments', 'message']) assert.ok(!json.includes(forbidden), `vazou ${forbidden}`)
})

test('a timeline de outro dono não existe', async () => {
  const rootId = await start()
  assert.equal(await sectorExecutionTimeline(OTHER, rootId), null)
})

test('a chave determinística é a mesma para a mesma chamada', () => {
  const input = { correlationId: 'run-1', sectorId: 's1', callerAgentId: 'a1', depth: 0 }
  assert.equal(sectorExecutionKey(input), sectorExecutionKey(input))
  assert.notEqual(sectorExecutionKey(input), sectorExecutionKey({ ...input, correlationId: 'run-2' }))
})
