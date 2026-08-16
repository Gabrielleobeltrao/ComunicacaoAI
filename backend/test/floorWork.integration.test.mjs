// INTEGRATION: how a floor works, against a REAL mongod.
//
// The floor is an ORGANISATIONAL area: it never gains a runtime, a tool or a
// permission of its own. What is pinned here is exactly that — coordination points at
// an existing agent, the agent's own policy decides what it reaches, and removing or
// moving that agent leaves the arrangement NOT READY instead of silently picking a
// substitute.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { getFloor, updateFloor, createFloor } = await import('../dist/floors.js')
const { floorWorkOverview, effectiveTargets } = await import('../dist/floorWork.js')
const { withAgentDefaults } = await import('../dist/agents.js')

const OWNER = 'floor-owner'
const agents = () => db.collection('agents')
const sectors = () => db.collection('sectors')
const floors = () => db.collection('offices')

let FLOOR
let OTHER_FLOOR

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await Promise.all([agents().deleteMany({}), sectors().deleteMany({}), floors().deleteMany({}), db.collection('buildings').deleteMany({})])
  FLOOR = (await createFloor(OWNER, { name: 'Térreo' }))._id
  OTHER_FLOOR = (await createFloor(OWNER, { name: 'Primeiro' }))._id
})

const insertAgent = async (over = {}) => {
  const _id = new ObjectId()
  await agents().insertOne({
    _id,
    ownerId: OWNER,
    officeId: over.officeId ?? FLOOR,
    name: over.name ?? 'Agente',
    objective: over.objective ?? 'Fazer algo',
    preset: 'custom',
    delegationPolicy: over.delegationPolicy ?? 'none',
    callerPolicy: over.callerPolicy ?? 'all',
    callableAgentIds: over.callableAgentIds ?? [],
    callableSectorIds: over.callableSectorIds ?? [],
    allowedCallerAgentIds: over.allowedCallerAgentIds ?? [],
    capabilities: over.capabilities ?? [],
    createdAt: new Date(),
  })
  return _id
}

const insertSector = async (over = {}) => {
  const _id = new ObjectId()
  await sectors().insertOne({
    _id,
    ownerId: OWNER,
    officeId: over.officeId ?? FLOOR,
    name: over.name ?? 'Setor',
    mode: over.mode ?? 'pipeline',
    objective: over.objective ?? '',
    members: [],
    createdAt: new Date(),
  })
  return _id
}

// --- schema e compatibilidade ---------------------------------------------------

test('um andar antigo é LIVRE, que é exatamente como ele já se comportava', async () => {
  const legacyId = new ObjectId()
  await floors().insertOne({ _id: legacyId, ownerId: OWNER, name: 'Antigo', createdAt: new Date() })
  const floor = await getFloor(OWNER, legacyId)
  assert.equal(floor.workMode, 'organization')
  assert.equal(floor.coordinatorAgentId, null)
  assert.equal(floor.instruction, '')
})

test('coordenar sem coordenador é recusado, não salvo pela metade', async () => {
  await assert.rejects(() => updateFloor(OWNER, FLOOR, { workMode: 'coordinated' }), /coordena/)
  assert.equal((await getFloor(OWNER, FLOOR)).workMode, 'organization')
})

test('o coordenador precisa ser um agente deste andar, desta conta', async () => {
  const outsider = await insertAgent({ officeId: OTHER_FLOOR })
  await assert.rejects(() => updateFloor(OWNER, FLOOR, { workMode: 'coordinated', coordinatorAgentId: outsider.toString() }), /deste andar/)
  await assert.rejects(
    () => updateFloor(OWNER, FLOOR, { workMode: 'coordinated', coordinatorAgentId: new ObjectId().toString() }),
    /deste andar/,
  )
})

test('coordenar aponta para um agente existente e não copia nada para o andar', async () => {
  const gerente = await insertAgent({ name: 'Gerente', delegationPolicy: 'floor' })
  const floor = await updateFloor(OWNER, FLOOR, { workMode: 'coordinated', coordinatorAgentId: gerente.toString(), instruction: 'Receba tudo' })
  assert.equal(floor.workMode, 'coordinated')
  assert.equal(floor.coordinatorAgentId.toString(), gerente.toString())

  // O documento do andar não ganhou tools, apps nem lista de permissão.
  const raw = await floors().findOne({ _id: FLOOR })
  for (const forbidden of ['tools', 'builtinTools', 'appGrants', 'callableAgentIds']) {
    assert.equal(raw[forbidden], undefined, `o andar não deveria guardar ${forbidden}`)
  }
})

test('voltar para livre não apaga a escolha, apenas deixa de usá-la', async () => {
  const gerente = await insertAgent({ name: 'Gerente', delegationPolicy: 'floor' })
  await updateFloor(OWNER, FLOOR, { workMode: 'coordinated', coordinatorAgentId: gerente.toString() })
  const back = await updateFloor(OWNER, FLOOR, { workMode: 'organization' })
  assert.equal(back.workMode, 'organization')
  assert.equal(back.coordinatorAgentId.toString(), gerente.toString())
})

// --- descoberta -------------------------------------------------------------------

test('andar livre não tem coordenação e isso não é um problema', async () => {
  const overview = await floorWorkOverview(OWNER, await getFloor(OWNER, FLOOR))
  assert.equal(overview.workMode, 'organization')
  assert.equal(overview.ready, true)
  assert.deepEqual(overview.issues, [])
  assert.equal(overview.coordinator, null)
})

test('a política floor alcança o próprio andar — e só ele', async () => {
  const gerente = await insertAgent({ name: 'Gerente', delegationPolicy: 'floor' })
  const colega = await insertAgent({ name: 'Colega' })
  await insertAgent({ name: 'De outro andar', officeId: OTHER_FLOOR })
  await updateFloor(OWNER, FLOOR, { workMode: 'coordinated', coordinatorAgentId: gerente.toString() })

  const overview = await floorWorkOverview(OWNER, await getFloor(OWNER, FLOOR))
  assert.equal(overview.ready, true)
  const names = overview.targets.map((t) => t.name)
  assert.ok(names.includes('Colega'))
  assert.ok(!names.includes('De outro andar'))
  assert.ok(!names.includes('Gerente'))
  assert.equal(overview.preview.from, 'Gerente')
  assert.ok(colega)
})

test('setor apenas organizacional aparece, mas não como alvo executável', async () => {
  const gerente = await insertAgent({ name: 'Gerente', delegationPolicy: 'floor' })
  await insertSector({ name: 'Grupo', mode: 'organization' })
  await insertSector({ name: 'Cozinha', mode: 'pipeline' })
  await updateFloor(OWNER, FLOOR, { workMode: 'coordinated', coordinatorAgentId: gerente.toString() })

  const overview = await floorWorkOverview(OWNER, await getFloor(OWNER, FLOOR))
  const grupo = overview.targets.find((t) => t.name === 'Grupo')
  const cozinha = overview.targets.find((t) => t.name === 'Cozinha')
  assert.equal(grupo.ready, false)
  assert.match(grupo.blockedReason, /não executa/)
  assert.equal(cozinha.ready, true)
})

test('a política de entrada do alvo continua valendo', async () => {
  const gerente = await insertAgent({ name: 'Gerente', delegationPolicy: 'floor' })
  await insertAgent({ name: 'Fechado', callerPolicy: 'selected', allowedCallerAgentIds: [] })
  await updateFloor(OWNER, FLOOR, { workMode: 'coordinated', coordinatorAgentId: gerente.toString() })

  const overview = await floorWorkOverview(OWNER, await getFloor(OWNER, FLOOR))
  const fechado = overview.targets.find((t) => t.name === 'Fechado')
  assert.equal(fechado.ready, false)
  assert.match(fechado.blockedReason, /não aceita/)
})

test('coordenador sem permissão de delegar deixa o andar não pronto', async () => {
  const gerente = await insertAgent({ name: 'Gerente', delegationPolicy: 'none' })
  await insertAgent({ name: 'Colega' })
  await updateFloor(OWNER, FLOOR, { workMode: 'coordinated', coordinatorAgentId: gerente.toString() })

  const overview = await floorWorkOverview(OWNER, await getFloor(OWNER, FLOOR))
  assert.equal(overview.ready, false)
  assert.equal(overview.issues[0].code, 'coordinator_cannot_delegate')
})

test('remover o coordenador não escolhe substituto: fica não pronto', async () => {
  const gerente = await insertAgent({ name: 'Gerente', delegationPolicy: 'floor' })
  await insertAgent({ name: 'Colega' })
  await updateFloor(OWNER, FLOOR, { workMode: 'coordinated', coordinatorAgentId: gerente.toString() })
  await agents().deleteOne({ _id: gerente })

  const overview = await floorWorkOverview(OWNER, await getFloor(OWNER, FLOOR))
  assert.equal(overview.ready, false)
  assert.equal(overview.issues[0].code, 'no_coordinator')
  assert.equal(overview.coordinator, null)
})

test('mover o coordenador para outro andar também interrompe a coordenação', async () => {
  const gerente = await insertAgent({ name: 'Gerente', delegationPolicy: 'floor' })
  await updateFloor(OWNER, FLOOR, { workMode: 'coordinated', coordinatorAgentId: gerente.toString() })
  await agents().updateOne({ _id: gerente }, { $set: { officeId: OTHER_FLOOR } })

  const overview = await floorWorkOverview(OWNER, await getFloor(OWNER, FLOOR))
  assert.equal(overview.ready, false)
  assert.equal(overview.issues[0].code, 'coordinator_moved')
})

test('a política all continua sendo escolha explícita do usuário, nunca do andar', () => {
  const coordinator = withAgentDefaults({ _id: new ObjectId(), ownerId: OWNER, officeId: FLOOR, name: 'G', delegationPolicy: 'floor' })
  const other = withAgentDefaults({ _id: new ObjectId(), ownerId: OWNER, officeId: OTHER_FLOOR, name: 'Outro andar', callerPolicy: 'all' })
  // Com 'floor', um agente de outro andar não entra mesmo estando no prédio.
  const targets = effectiveTargets(coordinator, [], [], [other])
  assert.deepEqual(targets, [])
})
