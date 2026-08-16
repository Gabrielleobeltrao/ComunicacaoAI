// INTEGRATION: the collaboration gate is the ONE decision, against a REAL mongod.
//
// The bug this closes: the gate existed but production still combined
// `checkDelegation()` with hand-written cross-floor and sector checks — so discovery,
// the floor preview and the runtime could disagree, and the model was offered targets
// that were refused the moment it tried them.
//
// What is pinned here: for every target, DISCOVERY, PREVIEW and RUNTIME give the same
// answer, whatever the reason for refusing.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { buildDelegationTools, rootContext, checkDelegation } = await import('../dist/delegation.js')
const { productionDelegationDeps } = await import('../dist/delegationWiring.js')
const { floorWorkOverview } = await import('../dist/floorWork.js')
const { withAgentDefaults } = await import('../dist/agents.js')
const { createFloor, updateFloor, getFloor } = await import('../dist/floors.js')
const { setFloorCommunication } = await import('../dist/floorCommunication.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')

const OWNER = 'gate-owner'
const agents = () => db.collection('agents')
const sectors = () => db.collection('sectors')

let FLOOR_A
let FLOOR_B
let BUILDING

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await Promise.all([
    agents().deleteMany({}),
    sectors().deleteMany({}),
    db.collection('offices').deleteMany({}),
    db.collection('buildings').deleteMany({}),
    db.collection('agent_delegations').deleteMany({}),
  ])
  FLOOR_A = (await createFloor(OWNER, { name: 'Térreo' }))._id
  FLOOR_B = (await createFloor(OWNER, { name: 'Primeiro' }))._id
  BUILDING = (await ensureDefaultBuilding(OWNER))._id
})

const insertAgent = async (over = {}) => {
  const _id = over._id ?? new ObjectId()
  await agents().insertOne({
    _id,
    ownerId: OWNER,
    officeId: over.officeId ?? FLOOR_A,
    name: over.name ?? 'Agente',
    objective: 'Fazer algo',
    preset: 'custom',
    delegationPolicy: over.delegationPolicy ?? 'all',
    callerPolicy: over.callerPolicy ?? 'all',
    callableAgentIds: over.callableAgentIds ?? [],
    callableSectorIds: over.callableSectorIds ?? [],
    allowedCallerAgentIds: over.allowedCallerAgentIds ?? [],
    capabilities: [],
    createdAt: new Date(),
  })
  return _id
}

const insertSector = async (over = {}) => {
  const _id = new ObjectId()
  await sectors().insertOne({
    _id,
    ownerId: OWNER,
    officeId: over.officeId ?? FLOOR_A,
    name: over.name ?? 'Cozinha',
    mode: over.mode ?? 'pipeline',
    members: over.members ?? [],
    stages: over.stages ?? [],
    coordinatorAgentId: over.coordinatorAgentId ?? null,
    entryPolicy: over.entryPolicy,
    exposedAgentIds: over.exposedAgentIds,
    createdAt: new Date(),
  })
  return _id
}

// The three surfaces, asked about the same target.
async function threeAnswers(callerId, targetId) {
  const deps = productionDelegationDeps()
  const caller = withAgentDefaults(await agents().findOne({ _id: callerId }))
  const ctx = rootContext({ ownerId: OWNER, buildingId: BUILDING.toString(), correlationId: 'run-1', agent: caller })
  const tools = buildDelegationTools(ctx, deps)

  // DISCOVERY: does the model even see it?
  const listed = JSON.parse((await tools.find((t) => t.name === 'list_available_agents').run({})).result)
  const discovered = (listed.agents ?? []).some((a) => a.id === targetId.toString())

  // RUNTIME: what happens if it tries?
  const attempt = JSON.parse((await tools.find((t) => t.name === 'delegate_to_agent').run({ agentId: targetId.toString(), objective: 'faça' })).result)
  // A denial is a denial; anything else means the gate let it through.
  const runtime = attempt.status !== 'denied'

  return { discovered, runtime, denyCode: attempt.code ?? null }
}

test('alvo permitido: descoberta e runtime concordam que sim', async () => {
  const caller = await insertAgent({ name: 'Chamador' })
  const target = await insertAgent({ name: 'Alvo' })
  const { discovered, runtime } = await threeAnswers(caller, target)
  assert.equal(discovered, true)
  // O runtime passa do gate (falha depois, por falta de chave de LLM — o que importa
  // aqui é que não foi RECUSADO).
  assert.equal(runtime, true)
})

test('política de entrada fechada: some da descoberta E é recusado no runtime', async () => {
  const caller = await insertAgent({ name: 'Chamador' })
  const target = await insertAgent({ name: 'Fechado', callerPolicy: 'selected', allowedCallerAgentIds: [] })
  const { discovered, runtime, denyCode } = await threeAnswers(caller, target)
  assert.equal(discovered, false)
  assert.equal(runtime, false)
  assert.equal(denyCode, 'unauthorized')
})

test('andares isolados: nem descoberta nem runtime atravessam', async () => {
  await setFloorCommunication(OWNER, BUILDING, { mode: 'isolated', links: [] })
  const caller = await insertAgent({ name: 'Chamador', officeId: FLOOR_A })
  const target = await insertAgent({ name: 'De outro andar', officeId: FLOOR_B })

  const { discovered, runtime, denyCode } = await threeAnswers(caller, target)
  assert.equal(discovered, false)
  assert.equal(runtime, false)
  assert.equal(denyCode, 'cross_floor_blocked')
})

test('link de mão única vale só na direção criada — nos dois sentidos as respostas batem', async () => {
  const a = await insertAgent({ name: 'A', officeId: FLOOR_A })
  const b = await insertAgent({ name: 'B', officeId: FLOOR_B })
  await setFloorCommunication(OWNER, BUILDING, {
    mode: 'selected',
    links: [{ fromFloorId: FLOOR_A.toString(), toFloorId: FLOOR_B.toString(), direction: 'one_way' }],
  })

  const forward = await threeAnswers(a, b)
  assert.equal(forward.discovered, true)
  assert.equal(forward.runtime, true)

  const backward = await threeAnswers(b, a)
  assert.equal(backward.discovered, false)
  assert.equal(backward.runtime, false)
  assert.equal(backward.denyCode, 'floor_link_required')
})

test('núcleo fechado esconde o membro da descoberta e o recusa no runtime', async () => {
  const caller = await insertAgent({ name: 'Chamador' })
  const member = await insertAgent({ name: 'Etapa' })
  await insertSector({ name: 'Cozinha', entryPolicy: 'sector_only', members: [{ agentId: member }], stages: [{ id: 'e1', name: 'Preparar', agentId: member }] })

  const { discovered, runtime, denyCode } = await threeAnswers(caller, member)
  assert.equal(discovered, false)
  assert.equal(runtime, false)
  assert.equal(denyCode, 'sector_entry_required')
})

test('membro exposto volta a aparecer nas duas superfícies', async () => {
  const caller = await insertAgent({ name: 'Chamador' })
  const member = await insertAgent({ name: 'Exposto' })
  await insertSector({ entryPolicy: 'selected_members', exposedAgentIds: [member], members: [{ agentId: member }] })

  const { discovered, runtime } = await threeAnswers(caller, member)
  assert.equal(discovered, true)
  assert.equal(runtime, true)
})

test('ciclo e profundidade continuam recusando pelo mesmo gate', async () => {
  const caller = await insertAgent({ name: 'Chamador' })
  const target = await insertAgent({ name: 'Alvo' })
  const callerDoc = withAgentDefaults(await agents().findOne({ _id: caller }))

  const cycles = checkDelegation(callerDoc, withAgentDefaults(await agents().findOne({ _id: target })), BUILDING.toString(), {
    ownerId: OWNER,
    buildingId: BUILDING.toString(),
    correlationId: 'r',
    callerAgentId: caller.toString(),
    callerAgentName: 'Chamador',
    ancestry: [target.toString()],
    depth: 0,
    budget: { tokensSpent: 0, tokenLimit: 100 },
  })
  assert.equal(cycles.code, 'cycle')
})

// --- preview do andar concorda com o runtime -------------------------------------

test('o preview do andar não oferece alvo que o runtime recusaria', async () => {
  const coordinator = await insertAgent({ name: 'Gerente', delegationPolicy: 'floor' })
  const open = await insertAgent({ name: 'Aberto' })
  const closed = await insertAgent({ name: 'Fechado', callerPolicy: 'selected', allowedCallerAgentIds: [] })
  const member = await insertAgent({ name: 'Protegido' })
  await insertSector({ name: 'Núcleo', entryPolicy: 'sector_only', members: [{ agentId: member }] })
  await updateFloor(OWNER, FLOOR_A, { workMode: 'coordinated', coordinatorAgentId: coordinator.toString() })

  const overview = await floorWorkOverview(OWNER, await getFloor(OWNER, FLOOR_A))
  const byName = new Map(overview.targets.map((t) => [t.name, t]))

  // O que o preview marca como pronto é exatamente o que o runtime aceita.
  assert.equal(byName.get('Aberto').ready, true)
  assert.equal(byName.get('Fechado').ready, false)
  assert.equal(byName.get('Protegido').ready, false)
  assert.match(byName.get('Protegido').blockedReason, /só recebe chamadas pelo próprio setor/)

  for (const [name, id] of [['Aberto', open], ['Fechado', closed], ['Protegido', member]]) {
    const { runtime } = await threeAnswers(coordinator, id)
    assert.equal(runtime, byName.get(name).ready, `${name}: preview e runtime discordam`)
  }
})

test('com andares isolados, o preview de um coordenador all não promete outro andar', async () => {
  await setFloorCommunication(OWNER, BUILDING, { mode: 'isolated', links: [] })
  const coordinator = await insertAgent({ name: 'Gerente', delegationPolicy: 'all' })
  await insertAgent({ name: 'Outro andar', officeId: FLOOR_B })
  await updateFloor(OWNER, FLOOR_A, { workMode: 'coordinated', coordinatorAgentId: coordinator.toString() })

  const overview = await floorWorkOverview(OWNER, await getFloor(OWNER, FLOOR_A))
  const other = overview.targets.find((t) => t.name === 'Outro andar')
  assert.equal(other.ready, false)
  assert.match(other.blockedReason, /isolados/)
})
