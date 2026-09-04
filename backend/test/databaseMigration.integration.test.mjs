// MIGRAÇÃO 9.2 — os históricos visíveis como Database, sem mover um registro sequer.
//
// Uma migração que reescreve dado é a que não dá para repetir quando falha no meio. Esta
// cria projeção: o store e os datasets apontam para os recorders que já existem, e os
// `data_history_records` continuam exatamente onde estavam.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { migrateHistoriesToDataStores, rollbackHistoryMigration, DEFAULT_STORE_NAME } = await import('../dist/databases/migration.js')
const { ensureDatabaseIndexes } = await import('../dist/databases/store.js')
const { runQuery } = await import('../dist/databases/adapters.js')

const DONO = 'dono-migracao'
let recorderId

before(async () => {
  await mongoClient.connect()
  await ensureDatabaseIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['data_stores', 'dataset_definitions', 'data_recorders', 'data_history_records', 'buildings'])
    await db.collection(c).deleteMany({})
  recorderId = new ObjectId()
  await db.collection('data_recorders').insertOne({
    _id: recorderId,
    ownerId: DONO,
    buildingId: null,
    name: 'Preços do fornecedor',
    enabled: true,
    source: { kind: 'internal_event', eventType: 'market.candle.closed' },
    entityKeyPath: 'symbol',
    occurredAtPath: null,
    mode: 'every_event',
    intervalMs: null,
    schedule: null,
    persistPolicy: 'summary',
    filters: [],
    selectedFields: ['symbol', 'preco'],
    retentionDays: 90,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.collection('data_history_records').insertMany([
    { ownerId: DONO, recorderId, value: { symbol: 'ABC', preco: 10 }, occurredAt: new Date(1000) },
    { ownerId: DONO, recorderId, value: { symbol: 'ABC', preco: 12 }, occurredAt: new Date(2000) },
  ])
})

test('sem aplicar, a migração só devolve o PLANO', async () => {
  const plano = await migrateHistoriesToDataStores(DONO, { dryRun: true })
  assert.equal(plano.scanned, 1)
  assert.equal(plano.created, 0)
  assert.equal(plano.planned.length, 1)
  assert.equal(await db.collection('data_stores').countDocuments({}), 0, 'dry-run não escreve')
})

test('a migração cria o store e um dataset por recorder — e NÃO move registro', async () => {
  const antes = await db.collection('data_history_records').countDocuments({})
  const r = await migrateHistoriesToDataStores(DONO)

  assert.equal(r.created, 1)
  const store = await db.collection('data_stores').findOne({ ownerId: DONO })
  assert.equal(store.name, DEFAULT_STORE_NAME)
  assert.equal(store.adapterKind, 'data_history')

  const dataset = await db.collection('dataset_definitions').findOne({ ownerId: DONO })
  assert.equal(dataset.key, recorderId.toString(), 'a chave É o recorder: é assim que o adapter o encontra')
  assert.equal(dataset.mutability, 'append_only')
  assert.deepEqual(Object.keys(dataset.schema.properties), ['symbol', 'preco'])

  assert.equal(await db.collection('data_history_records').countDocuments({}), antes, 'nenhum registro foi movido')
})

test('o que a migração criou é CONSULTÁVEL pelo adapter, sem backfill', async () => {
  await migrateHistoriesToDataStores(DONO)
  const store = await db.collection('data_stores').findOne({ ownerId: DONO })
  const dataset = await db.collection('dataset_definitions').findOne({ ownerId: DONO })

  // O adapter cai na CHAVE do dataset quando o store não fixa um recorder — e é por isso
  // que a chave é o id do recorder: um campo a menos para a migração manter sincronizado.
  const r = await runQuery({ accountId: DONO, dataStoreId: store._id, datasetKey: dataset.key, query: {} })
  assert.equal(r.total, 2)
  assert.equal(r.rows.length, 2)
  assert.ok(r.freshness instanceof Date, 'a atualização vem do próprio registro')
})

test('rodar duas vezes não duplica — a migração é idempotente', async () => {
  await migrateHistoriesToDataStores(DONO)
  const denovo = await migrateHistoriesToDataStores(DONO)
  assert.equal(denovo.created, 0)
  assert.equal(denovo.skipped, 1)
  assert.equal(await db.collection('data_stores').countDocuments({}), 1)
  assert.equal(await db.collection('dataset_definitions').countDocuments({}), 1)
})

test('um recorder novo entra numa segunda passagem — ela é retomável', async () => {
  await migrateHistoriesToDataStores(DONO)
  const outro = new ObjectId()
  await db.collection('data_recorders').insertOne({ _id: outro, ownerId: DONO, name: 'Outro', selectedFields: null, entityKeyPath: null, occurredAtPath: null })

  const r = await migrateHistoriesToDataStores(DONO)
  assert.equal(r.created, 1)
  assert.equal(r.skipped, 1)
  const novo = await db.collection('dataset_definitions').findOne({ key: outro.toString() })
  assert.equal(novo.schema.additionalProperties, true, 'sem campos declarados, o schema fica aberto em vez de mentir uma forma')
})

test('o rollback desfaz só o que a migração criou', async () => {
  await migrateHistoriesToDataStores(DONO)
  const antesDosRegistros = await db.collection('data_history_records').countDocuments({})

  const r = await rollbackHistoryMigration(DONO)
  assert.equal(r.removedDatasets, 1)
  assert.equal(r.removedStore, true)
  assert.equal(await db.collection('data_stores').countDocuments({}), 0)
  assert.equal(await db.collection('data_history_records').countDocuments({}), antesDosRegistros, 'registro nenhum é tocado')
})

test('o rollback NÃO leva junto um dataset criado à mão depois', async () => {
  await migrateHistoriesToDataStores(DONO)
  const store = await db.collection('data_stores').findOne({ ownerId: DONO })
  await db.collection('dataset_definitions').insertOne({
    ownerId: DONO,
    dataStoreId: store._id,
    key: 'feito-a-mao',
    name: 'Feito à mão',
    schema: { type: 'object' },
    mutability: 'append_only',
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  const r = await rollbackHistoryMigration(DONO)
  assert.equal(r.removedDatasets, 1)
  assert.equal(r.removedStore, false, 'o store fica de pé porque ainda tem algo dentro')
  assert.ok(await db.collection('dataset_definitions').findOne({ key: 'feito-a-mao' }))
})

test('conta sem histórico nenhum não ganha store vazio', async () => {
  const r = await migrateHistoriesToDataStores('conta-sem-nada')
  assert.equal(r.scanned, 0)
  assert.equal(r.storeId, null)
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: 'conta-sem-nada' }), 0)
})

test('a migração de uma conta não alcança a outra', async () => {
  await db.collection('data_recorders').insertOne({ _id: new ObjectId(), ownerId: 'vizinho', name: 'Do vizinho', selectedFields: null, entityKeyPath: null, occurredAtPath: null })
  await migrateHistoriesToDataStores(DONO)
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: 'vizinho' }), 0)
})
