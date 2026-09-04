// A MIGRAÇÃO — projeção, e não mudança.
//
// O que já monitora continua monitorando: os recorders seguem onde estão, com os mesmos
// ids e o mesmo comportamento. A migração dá a eles uma LINHA na Central. Estes casos
// protegem exatamente isso: nada movido, nada reescrito, nada passando a rodar diferente.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const svc = await import('../dist/monitoring/service.js')
const mig = await import('../dist/monitoring/migration.js')

const DONO = 'dono-migracao-central'

before(async () => {
  await mongoClient.connect()
  await svc.ensureMonitoringIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const recorder = (over = {}) => ({
  _id: new ObjectId(),
  ownerId: DONO,
  name: `Recorder ${Math.random()}`,
  enabled: true,
  source: { kind: 'event', ref: 'market.candle.closed' },
  selectedFields: ['rsi', 'preco'],
  entityKeyPath: 'symbol',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
})

beforeEach(async () => {
  for (const c of ['monitoring_sources', 'data_recorders']) await db.collection(c).deleteMany({})
})

test('sem aplicar, a migração só devolve o PLANO', async () => {
  await db.collection('data_recorders').insertOne(recorder())
  const plano = await mig.migrateRecordersToSources(DONO, { dryRun: true })
  assert.equal(plano.scanned, 1)
  assert.equal(plano.created, 0)
  assert.equal(plano.planned[0].kind, 'internal_event')
  assert.equal(await db.collection('monitoring_sources').countDocuments({}), 0)
})

test('a fonte criada APONTA para o recorder que já existia, e nasce pausada', async () => {
  const r = recorder()
  await db.collection('data_recorders').insertOne(r)
  await mig.migrateRecordersToSources(DONO)

  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.equal(fonte.status, 'paused', 'ativar seria mudar o comportamento de algo que já funciona')
  assert.equal(fonte.destination.recorderId.toString(), r._id.toString(), 'ela aponta; não cria outro')
  assert.equal(fonte.kind, 'internal_event')
  assert.equal(fonte.config.eventType, 'market.candle.closed')
  assert.deepEqual(fonte.mapping.fields.map((f) => f.to), ['rsi', 'preco'])
  assert.equal(fonte.entityKeyPath, 'symbol')
})

test('o RECORDER não é tocado', async () => {
  const r = recorder()
  await db.collection('data_recorders').insertOne(r)
  await mig.migrateRecordersToSources(DONO)

  const depois = await db.collection('data_recorders').findOne({ _id: r._id })
  assert.equal(depois.enabled, true)
  assert.deepEqual(depois.source, { kind: 'event', ref: 'market.candle.closed' })
  assert.equal(depois.updatedAt.getTime(), r.updatedAt.getTime(), 'nem o updatedAt muda')
})

test('recorder de live_data vira fonte de WebSocket', async () => {
  await db.collection('data_recorders').insertOne(recorder({ source: { kind: 'live_data', ref: 'conexao-123' } }))
  await mig.migrateRecordersToSources(DONO)
  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.equal(fonte.kind, 'websocket')
  assert.equal(fonte.config.installationId, 'conexao-123')
  assert.equal(fonte.config.protocol, 'websocket')
})

test('recorder MANUAL de fora da Central é pulado, e não descrito errado', async () => {
  // Ele é alimentado por quem chama `recordFact`; inventar um tipo seria descrever errado.
  await db.collection('data_recorders').insertOne(recorder({ source: { kind: 'manual', ref: 'alguma-integracao' } }))
  const r = await mig.migrateRecordersToSources(DONO)
  assert.equal(r.created, 0)
  assert.equal(r.skipped, 1)
})

test('sem campos declarados, o mapeamento diz isso em vez de inventar uma forma', async () => {
  await db.collection('data_recorders').insertOne(recorder({ selectedFields: null }))
  await mig.migrateRecordersToSources(DONO)
  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.deepEqual(fonte.mapping.fields, [{ to: 'valor', from: '' }])
  assert.equal(fonte.schema.additionalProperties, true)
})

test('rodar duas vezes não duplica', async () => {
  await db.collection('data_recorders').insertOne(recorder())
  await mig.migrateRecordersToSources(DONO)
  const denovo = await mig.migrateRecordersToSources(DONO)
  assert.equal(denovo.created, 0)
  assert.equal(denovo.skipped, 1)
  assert.equal(await db.collection('monitoring_sources').countDocuments({}), 1)
})

test('a migração de uma conta não alcança a outra', async () => {
  await db.collection('data_recorders').insertOne(recorder({ ownerId: 'vizinho' }))
  const r = await mig.migrateRecordersToSources(DONO)
  assert.equal(r.scanned, 0)
  assert.equal(await db.collection('monitoring_sources').countDocuments({}), 0)
})

// --- o rollback -----------------------------------------------------------------------

test('o rollback apaga só as projeções INTOCADAS', async () => {
  await db.collection('data_recorders').insertOne(recorder())
  await mig.migrateRecordersToSources(DONO)

  const r = await mig.rollbackRecorderMigration(DONO)
  assert.equal(r.removed, 1)
  assert.equal(await db.collection('monitoring_sources').countDocuments({}), 0)
  assert.equal(await db.collection('data_recorders').countDocuments({}), 1, 'recorder nenhum é tocado')
})

test('projeção que a pessoa ATIVOU não é apagada pelo rollback', async () => {
  await db.collection('data_recorders').insertOne(recorder())
  await mig.migrateRecordersToSources(DONO)
  await db.collection('monitoring_sources').updateOne({ ownerId: DONO }, { $set: { status: 'active' } })

  const r = await mig.rollbackRecorderMigration(DONO)
  assert.equal(r.removed, 0)
  assert.equal(r.kept, 1, 'ela deixou de ser só uma projeção quando alguém passou a usá-la')
})

test('projeção que já LEU não é apagada', async () => {
  await db.collection('data_recorders').insertOne(recorder())
  await mig.migrateRecordersToSources(DONO)
  await db.collection('monitoring_sources').updateOne({ ownerId: DONO }, { $set: { 'telemetry.readsOk': 3 } })

  assert.equal((await mig.rollbackRecorderMigration(DONO)).removed, 0)
})

test('o rollback não toca em fonte criada à mão', async () => {
  await svc.createSource(DONO, {
    name: 'Feita à mão',
    kind: 'api_polling',
    config: { url: 'https://exemplo.test/x' },
    cadence: { mode: 'interval', intervalMs: 60_000 },
    mapping: { version: 1, fields: [{ to: 'a', from: 'a' }] },
    destination: { history: true },
  })
  await mig.rollbackRecorderMigration(DONO)
  assert.equal(await db.collection('monitoring_sources').countDocuments({ ownerId: DONO }), 1)
})
