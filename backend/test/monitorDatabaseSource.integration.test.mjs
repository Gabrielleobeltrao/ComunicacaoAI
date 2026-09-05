// O MONITOR DE DATASET, ligado ao que realmente acontece.
//
// Um monitor de dataset que ninguém alimenta é decorativo: existe na tela, tem condição
// válida e nunca observa nada. Estes casos cobrem a ponte — a gravação do registro — e o
// que ela precisa garantir: uma execução por registro, dedupe pela identidade dele e
// recuperação depois de um restart.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { ensureMonitorIndexes, getState } = await import('../dist/monitors/state.js')
const { observarRegistro, registerDatabaseMonitors, valorObservado } = await import('../dist/monitors/dataSource.js')
const { resumePendingDispatches } = await import('../dist/monitors/dispatch.js')
const { inserirRegistro, resetRecordListeners, ensureDataHistoryIndexes } = await import('../dist/dataHistory/store.js')
const { createAutomation, publishAutomation, setStatus } = await import('../dist/automations/service.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')

const DONO = 'dono-monitor-dataset'
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
let recorderId
let dataStoreId
let monitor

before(async () => {
  await mongoClient.connect()
  await ensureMonitorIndexes()
  await ensureRunIndexes()
  // O índice único de `dedupeKey` é o que faz a dedupe do histórico existir. Sem ele o
  // teste mediria outra coisa.
  await ensureDataHistoryIndexes()
})
after(async () => {
  resetRecordListeners()
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const registro = (over = {}) => ({
  ownerId: DONO,
  recorderId,
  sourceKey: 'teste',
  entityKey: null,
  occurredAt: new Date(),
  recordedAt: new Date(),
  windowStart: null,
  windowEnd: null,
  recordKind: 'raw',
  value: { rsi: 55 },
  schemaVersion: 1,
  dedupeKey: `k-${Math.random()}`,
  expiresAt: null,
  ...over,
})

beforeEach(async () => {
  for (const c of ['monitors', 'monitor_states', 'automations', 'automation_versions', 'automation_runs', 'step_runs', 'buildings', 'offices', 'data_stores', 'dataset_definitions', 'data_history_records', 'data_recorders', 'execution_roots'])
    await db.collection(c).deleteMany({})
  resetRecordListeners()

  await db.collection('buildings').insertOne({ _id: BUILDING, ownerId: DONO, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: FLOOR, ownerId: DONO, buildingId: BUILDING, name: 'Térreo', status: 'active', createdAt: new Date() })
  flow = await createAutomation(DONO, { floorId: FLOOR.toString(), name: 'Avisar', definition: DEFINICAO })
  await publishAutomation(DONO, flow._id, DONO)
  await setStatus(DONO, flow._id, 'active')

  recorderId = new ObjectId()
  dataStoreId = new ObjectId()
  await db.collection('dataset_definitions').insertOne({
    ownerId: DONO,
    dataStoreId,
    key: recorderId.toString(),
    name: 'Velas',
    schema: { type: 'object', properties: { rsi: { type: 'number' } } },
    mutability: 'append_only',
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  monitor = {
    _id: new ObjectId(),
    ownerId: DONO,
    name: 'RSI sobrevendido',
    source: { kind: 'database', dataStoreId, datasetKey: recorderId.toString() },
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

const execucoes = () => db.collection('automation_runs').find({ ownerId: DONO }).toArray()

/**
 * Espera ATÉ a condição valer — em vez de dormir um prazo fixo.
 *
 * O aviso ao monitor sai FORA da gravação, de propósito: gravar não pode depender de
 * observar. Um `sleep(150)` transformava isso num palpite sobre a velocidade da máquina,
 * e o palpite errou na CI: o teste acusou "0 execuções" para um caminho que funciona, só
 * que 150ms depois. Esperar pela condição passa tão rápido quanto a máquina permitir, e
 * só falha quando a coisa de fato não acontece — que é o defeito que o caso procura.
 */
const ateQue = async (condicao, oQue, limiteMs = 5000) => {
  const fim = Date.now() + limiteMs
  for (;;) {
    const valor = await condicao()
    if (valor) return valor
    if (Date.now() > fim) throw new Error(`esperei ${limiteMs}ms por: ${oQue}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

// --- a ponte -------------------------------------------------------------------------------

test('ACEITAÇÃO: gravar um registro faz o monitor observar e o Flow ser enfileirado', async () => {
  registerDatabaseMonitors()

  // O primeiro estabelece o "antes"; o segundo cruza para baixo.
  assert.equal(await inserirRegistro(registro({ value: { rsi: 55 }, dedupeKey: 'r1' })), 'gravado')
  assert.equal(await inserirRegistro(registro({ value: { rsi: 22 }, dedupeKey: 'r2' })), 'gravado')
  // Só o segundo registro (rsi 22) satisfaz a condição, então a primeira execução a
  // aparecer é a dele: esperar por UMA não esconde uma segunda que não pode existir.
  const runs = await ateQue(async () => {
    const r = await execucoes()
    return r.length > 0 ? r : null
  }, 'a execução enfileirada pela transição')
  assert.equal(runs.length, 1, 'exatamente uma execução para a transição')
  assert.equal(runs[0].idempotencyKey, `${monitor._id.toString()}:mon:r2`)
})

test('o valor observado é o do REGISTRO, sem metadado que a condição não deveria alcançar', () => {
  const visto = valorObservado(registro({ value: { rsi: 10, symbol: 'ABC' } }))
  assert.deepEqual(Object.keys(visto).sort(), ['occurredAt', 'rsi', 'symbol'])
  assert.ok(!('ownerId' in visto) && !('recorderId' in visto) && !('dedupeKey' in visto))
})

test('o mesmo registro observado duas vezes gera UMA execução', async () => {
  await observarRegistro(registro({ value: { rsi: 55 }, dedupeKey: 'd1' }))
  const primeiro = await observarRegistro(registro({ value: { rsi: 10 }, dedupeKey: 'd2' }))
  const repetido = await observarRegistro(registro({ value: { rsi: 10 }, dedupeKey: 'd2' }))

  assert.equal(primeiro[0].triggered, true)
  assert.equal(repetido[0].reason, 'duplicate')
  assert.equal((await execucoes()).length, 1)
})

test('a gravação repetida nem chega ao monitor — a dedupe do histórico vem antes', async () => {
  registerDatabaseMonitors()
  const doc = registro({ value: { rsi: 10 }, dedupeKey: 'igual' })
  assert.equal(await inserirRegistro(doc), 'gravado')
  assert.equal(await inserirRegistro(doc), 'repetido')
  // Uma observação só: a segunda gravação não aconteceu.
  const estado = await ateQue(() => getState(DONO, monitor._id), 'o monitor observar a gravação')
  assert.equal(estado.lastEventId, 'igual')
})

test('monitor de OUTRO dataset não é acordado', async () => {
  const outroRecorder = new ObjectId()
  const saidas = await observarRegistro(registro({ recorderId: outroRecorder, value: { rsi: 5 }, dedupeKey: 'x1' }))
  assert.equal(saidas.length, 0)
  assert.equal((await execucoes()).length, 0)
})

test('monitor apontando para outro Data Store não é acordado pelo mesmo recorder', async () => {
  await db.collection('monitors').updateOne({ _id: monitor._id }, { $set: { 'source.dataStoreId': new ObjectId() } })
  const m = await db.collection('monitors').findOne({ _id: monitor._id })
  monitor = m
  const saidas = await observarRegistro(registro({ value: { rsi: 5 }, dedupeKey: 'y1' }))
  assert.equal(saidas.length, 0, 'dois Data Stores podem apontar para o mesmo recorder')
})

test('monitor em RASCUNHO não observa', async () => {
  await db.collection('monitors').updateOne({ _id: monitor._id }, { $set: { status: 'draft' } })
  const saidas = await observarRegistro(registro({ value: { rsi: 5 }, dedupeKey: 'z1' }))
  assert.equal(saidas.length, 0)
})

test('o registro de OUTRA conta não alcança este monitor', async () => {
  const saidas = await observarRegistro(registro({ ownerId: 'outra-conta', value: { rsi: 5 }, dedupeKey: 'w1' }))
  assert.equal(saidas.length, 0)
})

// --- restart -------------------------------------------------------------------------------------

test('disparo interrompido antes de enfileirar é retomado, e continua sendo UMA execução', async () => {
  await observarRegistro(registro({ value: { rsi: 55 }, dedupeKey: 'q1' }))
  await observarRegistro(registro({ value: { rsi: 10 }, dedupeKey: 'q2' }))
  assert.equal((await execucoes()).length, 1)

  // A queda: a borda foi consumida, a execução sumiu antes de existir de verdade.
  await db.collection('automation_runs').deleteMany({})
  await db.collection('monitor_states').updateOne({ ownerId: DONO, monitorId: monitor._id }, { $set: { pendingDispatch: { eventId: 'q2', at: new Date() } } })

  assert.equal(await resumePendingDispatches(), 1)
  const runs = await execucoes()
  assert.equal(runs.length, 1)
  assert.equal(runs[0].idempotencyKey, `${monitor._id.toString()}:mon:q2`)

  await resumePendingDispatches()
  assert.equal((await execucoes()).length, 1, 'retomar de novo não cria uma segunda')
})

test('a falha de um monitor não desfaz a gravação — o registro é um fato', async () => {
  registerDatabaseMonitors()
  // Um monitor apontando para um Flow que não existe: o dispatch marca degradado e segue.
  await db.collection('monitors').updateOne({ _id: monitor._id }, { $set: { action: { flowId: new ObjectId() } } })
  assert.equal(await inserirRegistro(registro({ value: { rsi: 10 }, dedupeKey: 'f1' })), 'gravado')
  // Espera o monitor CHEGAR na falha — sem isso, o caso mediria um instante em que ele
  // ainda nem tinha tentado, e passaria mesmo se a falha desfizesse a gravação depois.
  await ateQue(async () => (await getState(DONO, monitor._id))?.status === 'degraded', 'o monitor marcar que está degradado')
  assert.equal(await db.collection('data_history_records').countDocuments({ dedupeKey: 'f1' }), 1)
})
