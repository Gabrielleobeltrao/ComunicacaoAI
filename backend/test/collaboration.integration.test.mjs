// INTEGRATION: the collaboration context against a REAL MongoDB (mongodb-memory-server
// runs the actual mongod). Proves the rules that matter over real documents: a
// colleague on ANOTHER FLOOR of the same building counts, another building never
// does, and another owner is invisible. Never skipped.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
const { mongoClient } = await import('../dist/db.js')
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const { createFloor } = await import('../dist/floors.js')
const { createAgent } = await import('../dist/agents.js')
const { createSector } = await import('../dist/sectors.js')
const { collaboratorContext, collaboratorCountFor } = await import('../dist/collaboration.js')
const { sanitizeCollaborationRefs, reachableCollaborators } = await import('../dist/agentReadiness.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')
const { db } = await import('../dist/db.js')
const { ObjectId } = await import('mongodb')

const OWNER_A = 'owner-collab-a'
const OWNER_B = 'owner-collab-b'

// One building with TWO floors for owner A, plus a second building, plus a whole
// other owner — the three boundaries the rules must respect.
const buildingA = await ensureDefaultBuilding(OWNER_A)
const ground = await createFloor(OWNER_A, { name: 'Térreo' })
const upstairs = await createFloor(OWNER_A, { name: 'Primeiro andar' })

const manager = await createAgent(OWNER_A, ground._id, 'Gerente', { preset: 'manager', delegationPolicy: 'all', objective: 'coordenar' })
const colleagueUpstairs = await createAgent(OWNER_A, upstairs._id, 'Colega de cima', { preset: 'operator', objective: 'executar' })

test('a colleague on another FLOOR of the same building is a real collaborator', async () => {
  const ctx = await collaboratorContext(OWNER_A)
  // Both floors resolve to the same building…
  assert.equal(ctx.buildingOf(ground._id.toString()), buildingA._id.toString())
  assert.equal(ctx.buildingOf(upstairs._id.toString()), buildingA._id.toString())
  // …so the manager is NOT alone, even though the roster page lists one floor.
  assert.ok(collaboratorCountFor(manager, ctx) >= 1)
  const reach = reachableCollaborators(
    { ...manager, id: manager._id.toString(), buildingId: buildingA._id.toString() },
    ctx.agents,
    ctx.sectors,
  )
  assert.ok(reach.agentIds.includes(colleagueUpstairs._id.toString()), 'the upstairs colleague must be reachable')
  assert.ok(!reach.agentIds.includes(manager._id.toString()), 'never itself')
})

test('an agent in ANOTHER BUILDING of the same owner is not a collaborator', async () => {
  // The product gives an owner one building today, so a second one only exists as
  // legacy/imported data — written here exactly as it would be found in the wild.
  const otherBuilding = new ObjectId()
  const otherFloor = await createFloor(OWNER_A, { name: 'Anexo' })
  await db.collection('offices').updateOne({ _id: otherFloor._id }, { $set: { buildingId: otherBuilding } })
  const stranger = await createAgent(OWNER_A, otherFloor._id, 'Estranho', { preset: 'operator', objective: 'x' })

  const ctx = await collaboratorContext(OWNER_A)
  const reach = reachableCollaborators({ ...manager, id: manager._id.toString(), buildingId: buildingA._id.toString() }, ctx.agents, ctx.sectors)
  assert.ok(!reach.agentIds.includes(stranger._id.toString()))

  // And the client cannot force it in either.
  const kept = sanitizeCollaborationRefs(
    { id: manager._id.toString(), buildingId: buildingA._id.toString() },
    { callableAgentIds: [stranger._id.toString(), colleagueUpstairs._id.toString()] },
    ctx.agents,
    ctx.sectors,
  )
  assert.deepEqual(kept.callableAgentIds, [colleagueUpstairs._id.toString()])
})

test("another owner's agent is invisible, whatever the client sends", async () => {
  await ensureDefaultBuilding(OWNER_B)
  const theirFloor = await createFloor(OWNER_B, { name: 'Deles' })
  const theirAgent = await createAgent(OWNER_B, theirFloor._id, 'Deles', { preset: 'operator', objective: 'x' })

  const ctx = await collaboratorContext(OWNER_A)
  assert.ok(!ctx.agents.some((a) => a.id === theirAgent._id.toString()), 'another owner never appears in the context')

  const kept = sanitizeCollaborationRefs(
    { id: manager._id.toString(), buildingId: buildingA._id.toString() },
    { callableAgentIds: [theirAgent._id.toString()], allowedCallerAgentIds: [theirAgent._id.toString()] },
    ctx.agents,
    ctx.sectors,
  )
  assert.deepEqual(kept.callableAgentIds, [])
  assert.deepEqual(kept.allowedCallerAgentIds, [])
})

test('an organization sector never counts; an executable one does', async () => {
  const group = await createSector(OWNER_A, ground._id, 'Só agrupa', '#ccc', 'organization', [])
  const team = await createSector(OWNER_A, upstairs._id, 'Equipe', '#ccc', 'orchestrated', [], { coordinatorAgentId: colleagueUpstairs._id })

  const ctx = await collaboratorContext(OWNER_A)
  const executable = new Set(ctx.sectors.filter((s) => s.executable).map((s) => s.id))
  assert.ok(executable.has(team._id.toString()))
  assert.ok(!executable.has(group._id.toString()))

  const kept = sanitizeCollaborationRefs(
    { id: manager._id.toString(), buildingId: buildingA._id.toString() },
    { callableSectorIds: [group._id.toString(), team._id.toString()] },
    ctx.agents,
    ctx.sectors,
  )
  assert.deepEqual(kept.callableSectorIds, [team._id.toString()])
})

test('a colleague that refuses calls is excluded from the reachable count', async () => {
  const closed = await createAgent(OWNER_A, ground._id, 'Fechado', { preset: 'operator', objective: 'x', callerPolicy: 'none' })
  const ctx = await collaboratorContext(OWNER_A)
  const reach = reachableCollaborators({ ...manager, id: manager._id.toString(), buildingId: buildingA._id.toString() }, ctx.agents, ctx.sectors)
  assert.ok(!reach.agentIds.includes(closed._id.toString()))
})
