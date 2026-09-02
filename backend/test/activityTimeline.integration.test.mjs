// A LINHA DO TEMPO — uma execução, uma linha, e nada de conteúdo.
//
// O painel precisa responder "o que aconteceu, do começo ao fim?" sem virar uma segunda
// verdade: ele LÊ o que a execução já gravou. Estes casos protegem a correlação (fonte →
// monitor → flow → passos → entrega), a contagem que não duplica e o que nunca pode
// aparecer aqui: payload, prompt, resposta, documento e credencial.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { listActivity, parseMonitorRequest } = await import('../dist/activity/timeline.js')
const { ensureMonitorIndexes } = await import('../dist/monitors/state.js')
const { observeAndDispatch } = await import('../dist/monitors/dispatch.js')
const { createAutomation, publishAutomation, setStatus } = await import('../dist/automations/service.js')
const { processRun } = await import('../dist/automations/runProcessor.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
const { ensureExecutionRootIndexes } = await import('../dist/executionRoots.js')

const DONO = 'dono-atividade'
const BUILDING = new ObjectId()
const FLOOR = new ObjectId()

const DEFINICAO = {
  trigger: { type: 'manual' },
  steps: [{ id: 'resumo', type: 'transform.template', name: 'Resumo', enabled: true, config: { template: 'viu: {{input}}' } }],
  resultFormat: 'markdown',
  deliveries: [],
  limits: { maxSteps: 10, maxDurationMs: 60_000, maxTokens: 10_000 },
}

let flow
let monitor

before(async () => {
  await mongoClient.connect()
  await ensureMonitorIndexes()
  await ensureRunIndexes()
  await ensureExecutionRootIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['monitors', 'monitor_states', 'automations', 'automation_versions', 'automation_runs', 'step_runs', 'buildings', 'offices', 'execution_roots'])
    await db.collection(c).deleteMany({})
  await db.collection('buildings').insertOne({ _id: BUILDING, ownerId: DONO, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: FLOOR, ownerId: DONO, buildingId: BUILDING, name: 'Térreo', status: 'active', createdAt: new Date() })
  flow = await createAutomation(DONO, { floorId: FLOOR.toString(), name: 'Avisar sobre RSI', definition: DEFINICAO })
  await publishAutomation(DONO, flow._id, DONO)
  await setStatus(DONO, flow._id, 'active')
  monitor = {
    _id: new ObjectId(),
    ownerId: DONO,
    name: 'RSI sobrevendido',
    source: { kind: 'internal_event', eventType: 'market.candle.closed' },
    condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
    triggerMode: 'enter',
    threshold: null,
    thresholdField: null,
    debounceMs: 0,
    cooldownMs: 0,
    action: { flowId: flow._id },
    status: 'published',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  await db.collection('monitors').insertOne(monitor)
})

const disparar = async () => {
  await observeAndDispatch({ ownerId: DONO, monitor, value: { rsi: 55 }, eventId: 'e1' })
  const r = await observeAndDispatch({ ownerId: DONO, monitor, value: { rsi: 22 }, eventId: 'e2' })
  const run = await db.collection('automation_runs').findOne({ ownerId: DONO })
  await processRun(run._id.toString())
  return { r, run }
}

test('a linha liga fonte → monitor → flow → passos, com uma correlação só', async () => {
  await disparar()
  const { items } = await listActivity({ ownerId: DONO })

  assert.equal(items.length, 1, 'uma execução, uma linha')
  const linha = items[0]
  assert.equal(linha.status, 'succeeded')
  assert.equal(linha.origin.kind, 'monitor')
  assert.equal(linha.origin.name, 'RSI sobrevendido')
  assert.equal(linha.origin.eventId, 'e2', 'o evento que causou, sem o que ele continha')
  assert.equal(linha.flow.name, 'Avisar sobre RSI')
  assert.equal(linha.flow.version, 1, 'a versão publicada que rodou')
  assert.equal(linha.steps.length, 1)
  assert.equal(linha.steps[0].status, 'succeeded')
  assert.ok(linha.executionKey.startsWith('run:'), 'a correlação é a mesma da execução')
})

test('NADA de conteúdo entra na linha: nem payload, nem prompt, nem resposta', async () => {
  monitor = { ...monitor, condition: { kind: 'compare', field: 'segredo', op: 'eq', value: 'valor-secreto-do-teste' } }
  await db.collection('monitors').updateOne({ _id: monitor._id }, { $set: { condition: monitor.condition } })
  await observeAndDispatch({ ownerId: DONO, monitor, value: { segredo: 'outro' }, eventId: 'x1' })
  await observeAndDispatch({ ownerId: DONO, monitor, value: { segredo: 'valor-secreto-do-teste' }, eventId: 'x2' })
  const run = await db.collection('automation_runs').findOne({ ownerId: DONO })
  await processRun(run._id.toString())

  const { items } = await listActivity({ ownerId: DONO })
  const texto = JSON.stringify(items)
  assert.ok(!texto.includes('valor-secreto-do-teste'), 'o que o monitor viu fica onde já mora')
  assert.ok(!texto.includes('viu:'), 'o resultado do passo também não vem para cá')
})

test('a entrega é contada UMA vez, pelo passo que a executa', async () => {
  const { run } = await disparar()
  // Duas entregas bem-sucedidas em passos distintos, e uma que falhou.
  await db.collection('step_runs').insertMany([
    { ownerId: DONO, runId: run._id, stepId: 'd1', stepType: 'delivery.send', attempt: 1, status: 'succeeded', outputPreview: null, artifactIds: [], startedAt: new Date(), finishedAt: new Date(), error: null },
    { ownerId: DONO, runId: run._id, stepId: 'd2', stepType: 'delivery.send', attempt: 1, status: 'succeeded', outputPreview: null, artifactIds: [], startedAt: new Date(), finishedAt: new Date(), error: null },
    { ownerId: DONO, runId: run._id, stepId: 'd3', stepType: 'delivery.send', attempt: 1, status: 'failed', outputPreview: null, artifactIds: [], startedAt: new Date(), finishedAt: new Date(), error: { kind: 'delivery' } },
  ])

  const { items } = await listActivity({ ownerId: DONO })
  assert.equal(items[0].deliveries, 2, 'a que falhou não saiu, e nenhuma é contada duas vezes')
})

test('a atividade de outra conta não aparece', async () => {
  await disparar()
  const { items } = await listActivity({ ownerId: 'outra-conta' })
  assert.equal(items.length, 0)
})

test('monitor apagado depois da execução: a linha continua, o nome some', async () => {
  await disparar()
  await db.collection('monitors').deleteMany({})
  const { items } = await listActivity({ ownerId: DONO })
  assert.equal(items.length, 1, 'a execução aconteceu — apagar a regra não a desfaz')
  assert.equal(items[0].origin.name, 'monitor removido')
})

test('a correlação do monitor é lida do requestId, e nada mais', () => {
  const id = new ObjectId().toString()
  assert.deepEqual(parseMonitorRequest(`monitor:${id}:evt-1`), { monitorId: id, eventId: 'evt-1' })
  assert.equal(parseMonitorRequest('event:evt-1'), null)
  assert.equal(parseMonitorRequest(null), null)
  assert.equal(parseMonitorRequest('monitor:nao-e-id:evt'), null)
})

test('os filtros e a paginação respondem sem inventar página', async () => {
  await disparar()
  assert.equal((await listActivity({ ownerId: DONO, status: 'failed' })).items.length, 0)
  assert.equal((await listActivity({ ownerId: DONO, status: 'succeeded' })).items.length, 1)
  assert.equal((await listActivity({ ownerId: DONO, floorId: new ObjectId().toString() })).items.length, 0)

  const pagina = await listActivity({ ownerId: DONO, limit: 1 })
  assert.equal(pagina.items.length, 1)
  assert.ok(pagina.nextBefore instanceof Date, 'a página cheia oferece continuação')
  const seguinte = await listActivity({ ownerId: DONO, limit: 1, before: pagina.nextBefore })
  assert.equal(seguinte.items.length, 0)
  assert.equal(seguinte.nextBefore, null)
})
