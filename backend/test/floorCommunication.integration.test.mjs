// INTEGRATION: preview before save, against a REAL mongod.
//
// The bug this closes: the dialog asked "what does mode X block?" while the backend
// answered using the SAVED links — so a draft with new links got an impact for a
// configuration nobody was looking at. And the screen saved the mode on the same
// click that asked for the preview, which meant the communication had already
// changed by the time the owner read the consequence.
//
// What is pinned here: the impact is computed for the WHOLE candidate, validated by
// the same function the save uses, and nothing is written.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { getFloorCommunication, setFloorCommunication, normalizeCommunication, communicationImpact, canCommunicate } = await import(
  '../dist/floorCommunication.js'
)
const { createFloor } = await import('../dist/floors.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')

const OWNER = 'comm-owner'
let A
let B
let C
let BUILDING

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await Promise.all([db.collection('offices').deleteMany({}), db.collection('buildings').deleteMany({}), db.collection('agents').deleteMany({})])
  A = (await createFloor(OWNER, { name: 'Térreo' }))._id
  B = (await createFloor(OWNER, { name: 'Primeiro' }))._id
  C = (await createFloor(OWNER, { name: 'Segundo' }))._id
  BUILDING = (await ensureDefaultBuilding(OWNER))._id
})

// Two agents that call each other across floors: the references an isolation would break.
const crossFloorPair = async () => {
  const target = new ObjectId()
  await db.collection('agents').insertMany([
    { _id: new ObjectId(), ownerId: OWNER, name: 'Chamador', officeId: A, callableAgentIds: [target.toString()] },
    { _id: target, ownerId: OWNER, name: 'Alvo', officeId: B, callableAgentIds: [] },
  ])
}

test('o impacto responde sobre o rascunho inteiro, não sobre os links salvos', async () => {
  await crossFloorPair()
  // Salvo: nenhum link. Rascunho: um link que liga exatamente esse par.
  await setFloorCommunication(OWNER, BUILDING, { mode: 'selected', links: [] })

  const semLink = await communicationImpact(OWNER, await normalizeCommunication(OWNER, await getFloorCommunication(OWNER, BUILDING), { mode: 'selected' }))
  assert.equal(semLink.blocked.length, 1)

  const comLink = await communicationImpact(
    OWNER,
    await normalizeCommunication(OWNER, await getFloorCommunication(OWNER, BUILDING), {
      mode: 'selected',
      links: [{ fromFloorId: A.toString(), toFloorId: B.toString(), direction: 'one_way' }],
    }),
  )
  // Mesma pergunta, resposta oposta — e é o rascunho que decide.
  assert.equal(comLink.blocked.length, 0)
})

test('calcular impacto não persiste nada', async () => {
  await setFloorCommunication(OWNER, BUILDING, { mode: 'all', links: [] })
  await normalizeCommunication(OWNER, await getFloorCommunication(OWNER, BUILDING), {
    mode: 'selected',
    links: [{ fromFloorId: A.toString(), toFloorId: C.toString(), direction: 'both' }],
  })
  const stored = await getFloorCommunication(OWNER, BUILDING)
  assert.equal(stored.mode, 'all')
  assert.equal(stored.links.length, 0)
})

test('o preview usa a MESMA validação do save: link inválido é recusado nos dois', async () => {
  const current = await getFloorCommunication(OWNER, BUILDING)
  const alheio = new ObjectId().toString()
  await assert.rejects(
    () => normalizeCommunication(OWNER, current, { mode: 'selected', links: [{ fromFloorId: A.toString(), toFloorId: alheio }] }),
    /não existe neste prédio/,
  )
  await assert.rejects(
    () => setFloorCommunication(OWNER, BUILDING, { mode: 'selected', links: [{ fromFloorId: A.toString(), toFloorId: alheio }] }),
    /não existe neste prédio/,
  )
})

test('o rascunho normalizado é exatamente o que o save gravaria', async () => {
  const patch = {
    mode: 'selected',
    links: [
      { fromFloorId: A.toString(), toFloorId: B.toString(), direction: 'both' },
      // Repetido ao contrário: é o mesmo link nos dois sentidos.
      { fromFloorId: B.toString(), toFloorId: A.toString(), direction: 'both' },
    ],
  }
  const preview = await normalizeCommunication(OWNER, await getFloorCommunication(OWNER, BUILDING), patch)
  const saved = await setFloorCommunication(OWNER, BUILDING, patch)
  assert.deepEqual(JSON.parse(JSON.stringify(preview)), JSON.parse(JSON.stringify(saved)))
  assert.equal(saved.links.length, 1)
})

test('mão única continua sendo mão única depois de salva', async () => {
  const saved = await setFloorCommunication(OWNER, BUILDING, {
    mode: 'selected',
    links: [{ fromFloorId: A.toString(), toFloorId: B.toString(), direction: 'one_way' }],
  })
  assert.equal(canCommunicate(saved, A.toString(), B.toString()), true)
  assert.equal(canCommunicate(saved, B.toString(), A.toString()), false)
})
