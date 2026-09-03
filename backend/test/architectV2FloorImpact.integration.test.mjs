// LACUNA 13 — a exclusão de andar hoje só sabe contar agentes e setores.
//
// Caracterização antes da correção: o que existe é um DELETE que recusa andar ocupado e
// apaga andar vazio. Não há análise de impacto, `impactHash`, arquivamento, restauração
// nem purge — e nada olha para Databases, Sources, Monitors, Flows, canais ou grants.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const floors = await import('../dist/floors.js')

const DONO = 'dono-impacto'
let predio
let andar
let outro

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['buildings', 'offices', 'agents', 'sectors', 'monitoring_sources', 'monitors', 'automations', 'data_stores', 'app_installations'])
    await db.collection(c).deleteMany({})

  predio = new ObjectId()
  andar = new ObjectId()
  outro = new ObjectId()
  await db.collection('buildings').insertOne({ _id: predio, ownerId: DONO, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  for (const [id, nome] of [[andar, 'Atendimento'], [outro, 'Financeiro']]) {
    await db.collection('offices').insertOne({ _id: id, ownerId: DONO, buildingId: predio, name: nome, status: 'active', createdAt: new Date(), updatedAt: new Date() })
  }
})

test('LACUNA 13: não existe análise de impacto — só uma contagem de agentes e setores', async () => {
  assert.equal(typeof floors.deleteFloor, 'function')
  for (const nome of ['floorDeletionImpact', 'archiveFloor', 'restoreFloor', 'purgeFloor']) {
    assert.equal(typeof floors[nome], 'undefined', `${nome} ainda não existe (lacuna 13)`)
  }
  const atividade = await floors.getFloorActivity(DONO, andar)
  assert.deepEqual(Object.keys(atividade).sort(), ['agentCount', 'sectorCount'], 'a atividade só conta duas coisas (lacuna 13)')
})

test('LACUNA 13: um andar com Source, Monitor e Flow é considerado VAZIO e apagado', async () => {
  // Nada disso é agente nem setor, então nada disso é contado.
  await db.collection('monitoring_sources').insertOne({ _id: new ObjectId(), ownerId: DONO, name: 'Cotação', kind: 'api_polling', status: 'active', scope: { ownerType: 'floor', ownerId: andar.toString() } })
  await db.collection('monitors').insertOne({ _id: new ObjectId(), ownerId: DONO, name: 'RSI baixo', status: 'published' })
  await db.collection('automations').insertOne({ _id: new ObjectId(), ownerId: DONO, floorId: andar, name: 'Avisar', status: 'active' })

  const r = await floors.deleteFloor(DONO, andar)
  assert.deepEqual(r, { ok: true }, 'o andar é apagado sem nem olhar para a operação (lacuna 13)')
  assert.equal(await db.collection('offices').countDocuments({ _id: andar }), 0)

  // E o que dependia dele continua lá, apontando para um andar que não existe mais.
  assert.equal(await db.collection('automations').countDocuments({ floorId: andar }), 1, 'o Flow ficou órfão (lacuna 13)')
  assert.equal(await db.collection('monitoring_sources').countDocuments({ ownerId: DONO }), 1, 'a fonte ficou órfã (lacuna 13)')
})

test('LACUNA 13: com agente ou setor, a recusa não diz o que aconteceria — só conta', async () => {
  await db.collection('agents').insertOne({ _id: new ObjectId(), ownerId: DONO, officeId: andar, name: 'Marina', provider: 'anthropic', createdAt: new Date() })
  const r = await floors.deleteFloor(DONO, andar)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'FLOOR_NOT_EMPTY')
  assert.deepEqual(Object.keys(r).sort(), ['agentCount', 'code', 'ok', 'sectorCount'])
  assert.equal('impactHash' in r, false, 'não há hash de impacto para confirmar (lacuna 13)')
})

test('LACUNA 13: a conta vizinha nunca é alcançada — esta garantia JÁ existe e precisa sobreviver', async () => {
  assert.equal(await floors.deleteFloor('vizinho', andar), null)
  assert.equal(await db.collection('offices').countDocuments({ _id: andar }), 1)
})
