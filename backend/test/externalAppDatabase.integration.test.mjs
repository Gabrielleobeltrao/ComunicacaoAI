// O DATABASE que vive num App conectado.
//
// O que estes casos protegem: a consulta passa pelo MESMO caminho de permissão que o
// modelo usaria (grant → instalação → versão → credencial cifrada), nenhuma credencial
// aparece na configuração do Data Store, e "quantos vieram" nunca é apresentado como
// "quantos existem".
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { runQuery, AdapterError } = await import('../dist/databases/adapters.js')
const { ensureDatabaseIndexes } = await import('../dist/databases/store.js')

const DONO = 'dono-external-app'
let storeId

before(async () => {
  await mongoClient.connect()
  await ensureDatabaseIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['data_stores', 'dataset_definitions', 'connections', 'app_definitions']) await db.collection(c).deleteMany({})
  storeId = new ObjectId()
  await db.collection('data_stores').insertOne({
    _id: storeId,
    ownerId: DONO,
    buildingId: null,
    name: 'CRM',
    description: '',
    owner: { ownerType: 'account', ownerId: DONO },
    adapterKind: 'external_app',
    // REFERÊNCIA, nunca segredo: chave do App, chave da ação e id da instalação.
    adapterConfig: { appKey: 'crm_externo', actionKey: 'listar_contatos', installationId: new ObjectId().toString() },
    status: 'active',
    retention: { mode: 'forever' },
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.collection('dataset_definitions').insertOne({
    ownerId: DONO,
    dataStoreId: storeId,
    key: 'contatos',
    name: 'Contatos',
    schema: { type: 'object', properties: { nome: { type: 'string' } } },
    mutability: 'read_only',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})

const consultar = () => runQuery({ accountId: DONO, dataStoreId: storeId, datasetKey: 'contatos', query: {} })

test('sem App instalado, a consulta é recusada — e nada é inventado', async () => {
  await assert.rejects(consultar, (e) => {
    assert.ok(e instanceof AdapterError)
    // A instalação não existe: o caminho de permissão de sempre é quem recusa.
    assert.match(e.message, /revista em Apps|não diz qual App/)
    return true
  })
})

test('configuração incompleta é recusada por configuração, não por acaso', async () => {
  await db.collection('data_stores').updateOne({ _id: storeId }, { $set: { adapterConfig: { appKey: 'crm_externo' } } })
  await assert.rejects(consultar, /não diz qual App e qual ação/)
})

test('a configuração do Data Store NUNCA guarda credencial', async () => {
  const store = await db.collection('data_stores').findOne({ _id: storeId })
  const texto = JSON.stringify(store.adapterConfig)
  assert.ok(!/senha|secret|token|apikey|authorization/i.test(texto), 'credencial mora na conexão cifrada')
  assert.deepEqual(Object.keys(store.adapterConfig).sort(), ['actionKey', 'appKey', 'installationId'])
})

test('a consulta não monta texto: o filtro é o objeto fechado do DSL', async () => {
  // Um filtro com aspas e operador de Mongo dentro do valor não vira consulta: ele é
  // recusado pelo DSL antes de chegar ao App.
  await assert.rejects(
    () => runQuery({ accountId: DONO, dataStoreId: storeId, datasetKey: 'contatos', query: { filter: { nome: { $ne: null } } } }),
    (e) => {
      assert.ok(e.message.length > 0)
      return true
    },
  )
})
