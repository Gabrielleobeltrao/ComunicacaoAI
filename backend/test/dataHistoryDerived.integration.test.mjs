// O INDICADOR DERIVADO — a conta que faltava no meio da vigilância.
//
// A fonte entrega FECHAMENTOS e o monitor compara RSI. Enquanto ninguém fazia essa conta, a
// cadeia só funcionava se a API já devolvesse `rsi` pronto — o que transfere o cálculo para
// fora e faz o teste medir o provedor. Estes casos cobrem o meio: a série lida do histórico, a
// função registrada executada pelo executor canônico, e o resultado gravado como série.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { inserirRegistro, resetRecordListeners, ensureDataHistoryIndexes, listarRegistros } = await import('../dist/dataHistory/store.js')
const { calcularDerivados, refDerivada, registerDerivedIndicators } = await import('../dist/dataHistory/derived.js')
const { calculateRsi } = await import('../dist/executors/indicatorFunctions.js')
const { limparCacheDeRecorders } = await import('../dist/dataHistory/engine.js')

const DONO = 'dono-derivado'
let origem
let derivado

before(async () => {
  await mongoClient.connect()
  await ensureDataHistoryIndexes()
})
after(async () => {
  resetRecordListeners()
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

/** Um recorder qualquer: o que importa aqui é a origem e o derivado, não o modo. */
const recorder = (over) => ({
  _id: new ObjectId(),
  ownerId: DONO,
  buildingId: null,
  enabled: true,
  entityKeyPath: null,
  occurredAtPath: null,
  mode: 'every_event',
  intervalMs: null,
  schedule: null,
  persistPolicy: 'raw_only',
  filters: [],
  selectedFields: null,
  aggregations: [],
  changePath: null,
  retentionDays: null,
  retention: { mode: 'forever' },
  storage: { kind: 'internal' },
  recordCount: 0,
  lastRecordAt: null,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
})

beforeEach(async () => {
  for (const c of ['data_recorders', 'data_history_records', 'execution_roots']) await db.collection(c).deleteMany({})
  resetRecordListeners()
  limparCacheDeRecorders()

  origem = recorder({ name: 'Candles CXSE3', source: { kind: 'manual', ref: 'candles-cxse3' } })
  derivado = recorder({
    name: 'RSI de CXSE3',
    source: { kind: 'manual', ref: refDerivada(origem._id, 'rsi') },
    derivedFrom: {
      recorderId: origem._id,
      functionName: 'calculate_rsi',
      version: '1.0.0',
      inputField: 'fechamento',
      inputArg: 'closes',
      lookback: 15,
      params: { period: 14 },
    },
  })
  await db.collection('data_recorders').insertMany([origem, derivado])
})

/** Grava um fechamento na série de origem e devolve o registro gravado. */
const candle = async (fechamento, i) => {
  const doc = {
    ownerId: DONO,
    recorderId: origem._id,
    sourceKey: 'manual:candles-cxse3',
    entityKey: null,
    occurredAt: new Date(Date.UTC(2026, 0, 1, 10, i)),
    recordedAt: new Date(Date.UTC(2026, 0, 1, 10, i)),
    windowStart: null,
    windowEnd: null,
    recordKind: 'raw',
    value: { fechamento },
    schemaVersion: 1,
    dedupeKey: `candle-${i}`,
    expiresAt: null,
  }
  await inserirRegistro(doc)
  return doc
}

/** A série que o RSI de Wilder reconhece: sobe até 15, e depois desaba. */
const SUBIDA = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128]
const QUEDA = [110, 95, 80, 68, 58]

// --- a conta ------------------------------------------------------------------------------

test('ACEITAÇÃO: com fechamentos suficientes, o RSI é calculado e GRAVADO como série', async () => {
  for (const [i, f] of SUBIDA.entries()) await candle(f, i)
  const ultimo = await candle(130, 99)

  const saidas = await calcularDerivados(ultimo)
  assert.equal(saidas.length, 1, `esperava uma conta, veio: ${JSON.stringify(saidas)}`)
  assert.equal(saidas[0].kind, 'gravado', JSON.stringify(saidas[0]))

  const serie = await listarRegistros(DONO, { recorderId: derivado._id, limit: 10 })
  assert.equal(serie.length, 1, 'o RSI calculado precisa existir como registro, não só como retorno')

  /**
   * O NÚMERO é o da função, conferido contra ela.
   *
   * Comparar com um valor fixo escrito à mão aqui não provaria que a função foi executada —
   * provaria que alguém digitou o mesmo número duas vezes.
   */
  const closes = await listarRegistros(DONO, { recorderId: origem._id, limit: 15, order: 'desc' })
  const esperado = calculateRsi(closes.map((r) => r.value.fechamento).reverse(), 14)
  assert.equal(serie[0].value.rsi, esperado.rsi, 'o RSI gravado não é o que a função calcula')
  assert.equal(serie[0].value.samples, esperado.samples)
  assert.equal(serie[0].value.method, 'wilder')
})

test('ACEITAÇÃO: o registro calculado carrega PROVENIÊNCIA — nome, versão e instante do fato', async () => {
  for (const [i, f] of SUBIDA.entries()) await candle(f, i)
  const ultimo = await candle(130, 99)
  await calcularDerivados(ultimo)

  const [linha] = await listarRegistros(DONO, { recorderId: derivado._id, limit: 1 })
  assert.equal(linha.value.calculatedBy, 'calculate_rsi@1.0.0', 'sem quem calculou, a série é um número solto')
  assert.equal(linha.value.period, 14, 'sem o período, o número não é reproduzível')
  assert.equal(
    linha.occurredAt.getTime(),
    ultimo.occurredAt.getTime(),
    'o instante é o do FATO que originou a conta, não o de quando ela rodou',
  )
})

test('ACEITAÇÃO: dado insuficiente é estado degradado com o que falta — nunca estimativa', async () => {
  for (const [i, f] of SUBIDA.slice(0, 8).entries()) await candle(f, i)
  const ultimo = await candle(20, 99)

  const [saida] = await calcularDerivados(ultimo)
  assert.equal(saida.kind, 'insuficiente', JSON.stringify(saida))
  assert.equal(saida.faltam, 6, 'dizer "não consegui" manda a pessoa adivinhar; o número diz o que fazer')

  const serie = await listarRegistros(DONO, { recorderId: derivado._id, limit: 5 })
  assert.equal(serie.length, 0, 'um RSI calculado sobre menos dados do que a definição pede é um número errado com cara de certo')

  const doc = await db.collection('data_recorders').findOne({ _id: derivado._id })
  assert.match(doc.lastError?.message ?? '', /faltam 6/, 'a falta precisa ficar onde quem configurou vai olhar')
})

test('AMEAÇA: recalcular o mesmo registro NÃO grava um segundo RSI', async () => {
  for (const [i, f] of SUBIDA.entries()) await candle(f, i)
  const ultimo = await candle(130, 99)

  await calcularDerivados(ultimo)
  await calcularDerivados(ultimo)

  const serie = await listarRegistros(DONO, { recorderId: derivado._id, limit: 10 })
  assert.equal(serie.length, 1, 'a identidade do registro de origem é o que faz a conta ser idempotente')
})

test('ACEITAÇÃO: a queda REAL dos fechamentos leva o RSI abaixo de 30', async () => {
  for (const [i, f] of SUBIDA.entries()) await candle(f, i)
  const alto = await candle(130, 50)
  await calcularDerivados(alto)
  const [primeiro] = await listarRegistros(DONO, { recorderId: derivado._id, limit: 1 })
  assert.ok(primeiro.value.rsi > 30, `uma série que só sobe tem RSI alto, veio ${primeiro.value.rsi}`)

  for (const [i, f] of QUEDA.entries()) {
    const r = await candle(f, 60 + i)
    await calcularDerivados(r)
  }
  const [ultimo] = await listarRegistros(DONO, { recorderId: derivado._id, limit: 1, order: 'desc' })
  assert.ok(ultimo.value.rsi < 30, `a queda precisa levar o RSI abaixo de 30, veio ${ultimo.value.rsi}`)
})

// --- a falha ------------------------------------------------------------------------------

test('ACEITAÇÃO: a função que FALHA aparece na Activity e não grava número nenhum', async () => {
  // Período impossível: a função recusa, e a recusa é o comportamento certo.
  await db.collection('data_recorders').updateOne({ _id: derivado._id }, { $set: { 'derivedFrom.params': { period: 1 } } })
  for (const [i, f] of SUBIDA.entries()) await candle(f, i)
  const ultimo = await candle(130, 99)

  const [saida] = await calcularDerivados(ultimo)
  assert.equal(saida.kind, 'falhou', JSON.stringify(saida))

  const serie = await listarRegistros(DONO, { recorderId: derivado._id, limit: 5 })
  assert.equal(serie.length, 0, 'uma conta que falhou não pode virar linha da série')

  const raizes = await db.collection('execution_roots').find({ ownerId: DONO }).toArray()
  assert.equal(raizes.length, 1, 'uma função que para de calcular deixa o monitor sem disparar — e isso precisa ser visível')
  assert.equal(raizes[0].status, 'failed')

  const doc = await db.collection('data_recorders').findOne({ _id: derivado._id })
  assert.ok(doc.lastError?.message, 'sem motivo, a falha não é investigável')
})

test('a conta bem-sucedida também aparece na Activity, uma vez por registro', async () => {
  for (const [i, f] of SUBIDA.entries()) await candle(f, i)
  const ultimo = await candle(130, 99)
  await calcularDerivados(ultimo)
  await calcularDerivados(ultimo)

  const raizes = await db.collection('execution_roots').find({ ownerId: DONO }).toArray()
  assert.equal(raizes.length, 1, 'a raiz é idempotente pela chave: recalcular não abre uma segunda linha')
  assert.equal(raizes[0].status, 'succeeded')
})

// --- a ponte ------------------------------------------------------------------------------

test('ACEITAÇÃO: gravar um fechamento dispara a conta pelo ouvinte do histórico', async () => {
  const contas = []
  registerDerivedIndicators((onde, e) => contas.push(`${onde}: ${e}`))

  for (const [i, f] of SUBIDA.entries()) await candle(f, i)
  // O ouvinte roda sem espera — o histórico não pode ficar preso a quem escuta. Esperamos a
  // fila de microtarefas drenar, que é o que o próprio motor faz entre uma gravação e outra.
  const ultimo = await candle(130, 99)
  await new Promise((ok) => setImmediate(ok))
  await new Promise((ok) => setImmediate(ok))

  assert.deepEqual(contas, [], 'o ouvinte não pode quebrar em silêncio')
})

test('AMEAÇA: uma série que deriva de SI MESMA não se realimenta', async () => {
  await db.collection('data_recorders').updateOne({ _id: derivado._id }, { $set: { 'derivedFrom.recorderId': derivado._id } })
  const doc = await db.collection('data_recorders').findOne({ _id: derivado._id })
  const proprio = {
    ownerId: DONO,
    recorderId: derivado._id,
    sourceKey: `manual:${doc.source.ref}`,
    entityKey: null,
    occurredAt: new Date(),
    recordedAt: new Date(),
    windowStart: null,
    windowEnd: null,
    recordKind: 'raw',
    value: { rsi: 20 },
    schemaVersion: 1,
    dedupeKey: 'proprio-1',
    expiresAt: null,
  }
  const saidas = await calcularDerivados(proprio)
  assert.deepEqual(saidas, [], 'derivar de si mesmo gravaria para sempre')
})
