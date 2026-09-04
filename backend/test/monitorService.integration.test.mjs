// SALVAR NUNCA PUBLICA — e as recusas do construtor.
//
// Um monitor age sozinho. Se editar o rascunho mudasse na mesma hora o que dispara de
// madrugada, uma edição pela metade viraria comportamento em produção antes de alguém
// terminar de pensar.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { ensureMonitorIndexes, getState } = await import('../dist/monitors/state.js')
const { createMonitor, updateMonitor, publishMonitor, deleteMonitor, describeMonitors, setMonitorStatus, MonitorError } = await import(
  '../dist/monitors/service.js'
)
const { createAutomation, publishAutomation, setStatus } = await import('../dist/automations/service.js')

const DONO = 'dono-monitor-servico'
const BUILDING = new ObjectId()
const FLOOR = new ObjectId()

const DEFINICAO = {
  trigger: { type: 'manual' },
  steps: [{ id: 'r', type: 'transform.template', name: 'R', enabled: true, config: { template: '{{input}}' } }],
  resultFormat: 'markdown',
  deliveries: [],
  limits: { maxSteps: 10, maxDurationMs: 60_000, maxTokens: 10_000 },
}

let flow
let rascunhoDeFlow

before(async () => {
  await mongoClient.connect()
  await ensureMonitorIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['monitors', 'monitor_states', 'automations', 'automation_versions', 'automation_runs', 'buildings', 'offices', 'data_stores', 'dataset_definitions'])
    await db.collection(c).deleteMany({})
  await db.collection('buildings').insertOne({ _id: BUILDING, ownerId: DONO, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: FLOOR, ownerId: DONO, buildingId: BUILDING, name: 'Térreo', status: 'active', createdAt: new Date() })
  flow = await createAutomation(DONO, { floorId: FLOOR.toString(), name: 'Avisar', definition: DEFINICAO })
  await publishAutomation(DONO, flow._id, DONO)
  await setStatus(DONO, flow._id, 'active')
  rascunhoDeFlow = await createAutomation(DONO, { floorId: FLOOR.toString(), name: 'Rascunho', definition: DEFINICAO })
})

const entrada = (over = {}) => ({
  name: 'RSI sobrevendido',
  source: { kind: 'internal_event', eventType: 'market.candle.closed' },
  condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
  triggerMode: 'enter',
  debounceMs: 0,
  cooldownMs: 0,
  flowId: flow._id.toString(),
  ...over,
})

// --- rascunho e publicação ------------------------------------------------------------

test('um monitor nasce RASCUNHO, mesmo com tudo preenchido', async () => {
  const m = await createMonitor(DONO, entrada())
  assert.equal(m.status, 'draft')
})

test('editar um monitor publicado o devolve para rascunho', async () => {
  const m = await createMonitor(DONO, entrada())
  assert.equal((await publishMonitor(DONO, m._id)).status, 'published')

  const editado = await updateMonitor(DONO, m._id, entrada({ name: 'Outro nome' }))
  assert.equal(editado.status, 'draft', 'o que age sozinho é o que alguém revisou')
})

test('monitor sem Flow não publica — publicado sem ação seria um rascunho mentindo', async () => {
  const m = await createMonitor(DONO, entrada({ flowId: null }))
  await assert.rejects(() => publishMonitor(DONO, m._id), /Flow/)
  const [visao] = await describeMonitors(DONO)
  assert.equal(visao.status, 'draft')
})

test('monitor apontando para Flow sem publicação não publica', async () => {
  const m = await createMonitor(DONO, entrada({ flowId: rascunhoDeFlow._id.toString() }))
  await assert.rejects(() => publishMonitor(DONO, m._id), /publique o Flow/i)
})

// --- o escopo de conta ------------------------------------------------------------------

test('Flow de outra conta não vira ação gravada', async () => {
  await assert.rejects(() => createMonitor(DONO, entrada({ flowId: new ObjectId().toString() })), /não existe/)
})

test('monitor de outra conta não é encontrado, editado nem apagado', async () => {
  const m = await createMonitor(DONO, entrada())
  assert.equal(await updateMonitor('outra-conta', m._id, entrada()), null)
  assert.equal(await deleteMonitor('outra-conta', m._id), false)
  assert.equal((await describeMonitors('outra-conta')).length, 0)
})

// --- as recusas do construtor ----------------------------------------------------------

test('tipo de evento desconhecido é recusado', async () => {
  await assert.rejects(() => createMonitor(DONO, entrada({ source: { kind: 'internal_event', eventType: 'inventado' } })), /evento desconhecido/)
})

test('nome de campo fora da forma é recusado — a condição não alcança outra coisa', async () => {
  await assert.rejects(
    () => createMonitor(DONO, entrada({ condition: { kind: 'compare', field: '$where', op: 'lt', value: 1 } })),
    /não é um nome de campo válido/,
  )
  await assert.rejects(
    () => createMonitor(DONO, entrada({ condition: { kind: 'compare', field: 'a.b', op: 'lt', value: 1 } })),
    /não é um nome de campo válido/,
  )
})

test('cruzamento sem limiar é recusado — ele nunca dispararia', async () => {
  await assert.rejects(() => createMonitor(DONO, entrada({ triggerMode: 'cross_up' })), /limiar/)
  const ok = await createMonitor(DONO, entrada({ triggerMode: 'cross_up', threshold: 30, thresholdField: 'rsi' }))
  assert.equal(ok.triggerMode, 'cross_up')
})

test('janelas absurdas são recusadas', async () => {
  await assert.rejects(() => createMonitor(DONO, entrada({ debounceMs: 48 * 3600_000 })), /24 horas/)
  await assert.rejects(() => createMonitor(DONO, entrada({ cooldownMs: -1 })), /milissegundos/)
})

test('a condição continua limitada em profundidade e partes', async () => {
  const fundo = {
    kind: 'and',
    children: [{ kind: 'and', children: [{ kind: 'and', children: [{ kind: 'and', children: [{ kind: 'compare', field: 'rsi', op: 'lt', value: 1 }] }] }] }],
  }
  await assert.rejects(() => createMonitor(DONO, entrada({ condition: fundo })), /níveis/)
})

// --- fonte de database -------------------------------------------------------------------

test('num dataset, os campos vêm do SCHEMA declarado', async () => {
  const dataStoreId = new ObjectId()
  await db.collection('dataset_definitions').insertOne({
    ownerId: DONO,
    dataStoreId,
    key: 'candles',
    name: 'Velas',
    schema: { type: 'object', properties: { rsi: { type: 'number' }, close: { type: 'number' } } },
    mutability: 'append_only',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const fonte = { kind: 'database', dataStoreId: dataStoreId.toString(), datasetKey: 'candles' }

  const m = await createMonitor(DONO, entrada({ source: fonte }))
  assert.equal(m.source.kind, 'database')

  await assert.rejects(
    () => createMonitor(DONO, entrada({ source: fonte, condition: { kind: 'compare', field: 'senha', op: 'eq', value: 1 } })),
    /não existe nesta fonte/,
  )
})

test('dataset de outra conta não existe para este monitor', async () => {
  const fonte = { kind: 'database', dataStoreId: new ObjectId().toString(), datasetKey: 'candles' }
  await assert.rejects(() => createMonitor(DONO, entrada({ source: fonte })), /não existe nesta conta/)
})

// --- a leitura da tela ---------------------------------------------------------------------

test('a lista traz a condição em português e o estado atual', async () => {
  const m = await createMonitor(DONO, entrada())
  const [visao] = await describeMonitors(DONO)
  assert.equal(visao.id, m._id.toString())
  assert.equal(visao.conditionText, 'rsi abaixo de 30')
  assert.equal(visao.state, null, 'sem observação ainda, e a tela diz isso em vez de inventar')
})

test('pausar e apagar levam o estado junto', async () => {
  const m = await createMonitor(DONO, entrada())
  await publishMonitor(DONO, m._id)
  assert.equal((await setMonitorStatus(DONO, m._id, 'paused')).status, 'paused')

  await db.collection('monitor_states').insertOne({ ownerId: DONO, monitorId: m._id, status: 'watching', version: 1 })
  assert.equal(await deleteMonitor(DONO, m._id), true)
  assert.equal(await getState(DONO, m._id), null, 'estado órfão só serviria para confundir')
})

// --- operationKind, derivado na leitura ---------------------------------------------------

test('operationKind é DERIVADO quando o campo não existe — nada foi carimbado em massa', async () => {
  const { operationKindOf } = await import('../dist/automations/types.js')
  const agentId = new ObjectId()

  // O que já está no banco: nenhum documento tem o campo.
  assert.equal(operationKindOf({ agentId }), 'routine', 'rotina mora dentro de um agente')
  assert.equal(operationKindOf({}), 'flow', 'automação standalone é operação do escritório')
  // E o campo, quando existir, manda.
  assert.equal(operationKindOf({ agentId, operationKind: 'flow' }), 'flow')

  const gravado = await db.collection('automations').findOne({ _id: flow._id })
  assert.equal(gravado.operationKind, undefined, 'criar não carimba: o legado continua sem o campo')
})

test('a flag MONITORS_ENABLED=0 nega a rota de verdade', async () => {
  const express = (await import('express')).default
  const { monitorRouter } = await import('../dist/routes/monitorRoutes.js')
  const app = express()
  app.use((req, res, next) => {
    res.locals.userId = DONO
    next()
  })
  app.use('/api/monitors', monitorRouter)
  const servidor = app.listen(0)
  const porta = servidor.address().port
  try {
    process.env.MONITORS_ENABLED = '0'
    const negado = await fetch(`http://127.0.0.1:${porta}/api/monitors`)
    assert.equal(negado.status, 404, 'a flag fecha a rota, não só o botão')

    delete process.env.MONITORS_ENABLED
    const aberto = await fetch(`http://127.0.0.1:${porta}/api/monitors`)
    assert.equal(aberto.status, 200)
  } finally {
    delete process.env.MONITORS_ENABLED
    servidor.close()
  }
})

// --- o que o alarme já custou ----------------------------------------------------------------

test('ACEITAÇÃO: a listagem diz quantas execuções o monitor pediu e quanto elas custaram', async () => {
  /**
   * Vigiar é de graça; o que custa é o que acontece DEPOIS da borda.
   *
   * Sem esse número na tela, um monitor com cooldown mal ajustado só aparece na fatura — e aí
   * a pergunta "qual deles está gastando?" não tem resposta em lugar nenhum do produto.
   */
  const m = await createMonitor(DONO, entrada({}))
  const alheio = await createMonitor(DONO, entrada({ name: 'Outro' }))

  // Duas execuções deste monitor e uma do outro, correlacionadas pelo mesmo fio que a
  // Activity usa: o `requestId` que o disparo grava.
  await db.collection('automation_runs').insertMany([
    { _id: new ObjectId(), ownerId: DONO, requestId: `monitor:${m._id.toString()}:e1`, usage: { inputTokens: 120, outputTokens: 30 }, status: 'succeeded' },
    { _id: new ObjectId(), ownerId: DONO, requestId: `monitor:${m._id.toString()}:e2`, usage: { inputTokens: 80, outputTokens: 20 }, status: 'succeeded' },
    { _id: new ObjectId(), ownerId: DONO, requestId: `monitor:${alheio._id.toString()}:e1`, usage: { inputTokens: 999, outputTokens: 999 }, status: 'succeeded' },
  ])

  const visao = await describeMonitors(DONO)
  const meu = visao.find((v) => v.id === m._id.toString())
  assert.deepEqual(meu.cost, { runs: 2, inputTokens: 200, outputTokens: 50 })

  // O custo do vizinho não entra no meu: são alarmes diferentes.
  const outro = visao.find((v) => v.id === alheio._id.toString())
  assert.equal(outro.cost.runs, 1)
})

test('o monitor que nunca disparou custa ZERO — e diz isso, em vez de omitir', async () => {
  const m = await createMonitor(DONO, entrada({}))
  const [visao] = (await describeMonitors(DONO)).filter((v) => v.id === m._id.toString())
  assert.deepEqual(visao.cost, { runs: 0, inputTokens: 0, outputTokens: 0 }, 'campo ausente faz a tela mostrar vazio, que se lê como "não sei"')
})

test('AMEAÇA: a execução de OUTRA conta não entra no custo deste monitor', async () => {
  const m = await createMonitor(DONO, entrada({}))
  await db.collection('automation_runs').insertOne({
    _id: new ObjectId(),
    ownerId: 'vizinho',
    requestId: `monitor:${m._id.toString()}:e1`,
    usage: { inputTokens: 500, outputTokens: 500 },
    status: 'succeeded',
  })
  const [visao] = (await describeMonitors(DONO)).filter((v) => v.id === m._id.toString())
  assert.equal(visao.cost.runs, 0, 'o id do monitor não é segredo: o dono precisa estar no filtro')
})
