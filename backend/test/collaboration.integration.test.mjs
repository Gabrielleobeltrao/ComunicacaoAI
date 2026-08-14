// INTEGRATION: the collaboration context against a REAL MongoDB (mongodb-memory-server
// runs the actual mongod). Proves the rules that matter over real documents: a
// colleague on ANOTHER FLOOR of the same building counts, another building never
// does, and another owner is invisible. Never skipped.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
// A webhook automation encrypts its signing secret on creation. A throwaway test
// key keeps that path real without touching any configuration.
process.env.ENCRYPTION_KEY ||= 'test-only-encryption-key-'.padEnd(40, 'x')
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

// ------------------------------------- publishing an automation with agent steps
const { createAutomation, publishAutomation, setStatus, AutomationValidationError } = await import('../dist/automations/service.js')
const { listActivePublished } = await import('../dist/automations/repository.js')
const { liveWebhookCountFor } = await import('../dist/automations/webhookTriggers.js')

const webhookDefinition = (agentId) => ({
  trigger: { type: 'webhook', requireSignature: false },
  inputs: [],
  steps: [
    {
      id: 's1',
      name: 'run',
      type: 'agent.execute',
      enabled: true,
      dependsOn: [],
      inputMapping: {},
      config: { agentId: agentId.toString(), instruction: 'faça algo', format: 'markdown' },
      timeoutMs: 0,
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
      continueOnError: false,
    },
  ],
  resultFormat: 'markdown',
  deliveries: [],
  limits: { maxSteps: 10, maxToolCalls: 10, maxOutputChars: 1000, maxTokens: null },
})

const rejects = async (fn, what) => {
  await assert.rejects(fn, (e) => {
    assert.ok(e instanceof AutomationValidationError, `${what} should fail validation, got ${e}`)
    // Uniform message: it never says whether the id belongs to somebody else.
    assert.match(JSON.stringify(e.issues), /agente indisponível para esta conta/)
    return true
  })
}

test("publishing is refused when a step names another owner's agent", async () => {
  const theirFloor = await createFloor(OWNER_B, { name: 'Andar B pub' })
  const theirAgent = await createAgent(OWNER_B, theirFloor._id, 'Agente do B', { preset: 'operator', objective: 'x' })

  const created = await createAutomation(OWNER_A, { floorId: ground._id.toString(), name: 'wh', description: '', definition: webhookDefinition(theirAgent._id) })
  await rejects(() => publishAutomation(OWNER_A, created._id, OWNER_A), "another owner's agent")
})

test('publishing is refused when the agent lives in another building', async () => {
  const otherBuilding = new ObjectId()
  const farFloor = await createFloor(OWNER_A, { name: 'Prédio vizinho' })
  await db.collection('offices').updateOne({ _id: farFloor._id }, { $set: { buildingId: otherBuilding } })
  const farAgent = await createAgent(OWNER_A, farFloor._id, 'Agente distante', { preset: 'operator', objective: 'x' })

  const created = await createAutomation(OWNER_A, { floorId: ground._id.toString(), name: 'wh2', description: '', definition: webhookDefinition(farAgent._id) })
  await rejects(() => publishAutomation(OWNER_A, created._id, OWNER_A), 'cross-building agent')
})

test('publishing is refused when the agentId is not even an id', async () => {
  const def = webhookDefinition(colleagueUpstairs._id)
  def.steps[0].config.agentId = 'not-an-object-id'
  const created = await createAutomation(OWNER_A, { floorId: ground._id.toString(), name: 'wh3', description: '', definition: def })
  await rejects(() => publishAutomation(OWNER_A, created._id, OWNER_A), 'malformed agentId')
})

test('a valid webhook publishes, activates, syncs the event trigger and counts once', async () => {
  const created = await createAutomation(OWNER_A, { floorId: ground._id.toString(), name: 'wh-ok', description: '', definition: webhookDefinition(colleagueUpstairs._id) })
  await publishAutomation(OWNER_A, created._id, OWNER_A)
  await setStatus(OWNER_A, created._id, 'active')

  const { getAgentById } = await import('../dist/agents.js')
  const after = await getAgentById(OWNER_A, colleagueUpstairs._id)
  assert.ok((after.activationModes ?? []).includes('event'), 'activating a webhook must allow the event trigger')

  const live = await listActivePublished(OWNER_A)
  assert.equal(liveWebhookCountFor(live, colleagueUpstairs._id.toString()), 1)

  // Pausing it stops the count (the permission is deliberately left alone).
  await setStatus(OWNER_A, created._id, 'paused')
  assert.equal(liveWebhookCountFor(await listActivePublished(OWNER_A), colleagueUpstairs._id.toString()), 0)
  await setStatus(OWNER_A, created._id, 'active')
})

test('an edited draft does not move the event until it is republished', async () => {
  const target = await createAgent(OWNER_A, ground._id, 'Alvo do webhook', { preset: 'operator', objective: 'x' })
  const created = await createAutomation(OWNER_A, { floorId: ground._id.toString(), name: 'wh-draft', description: '', definition: webhookDefinition(target._id) })
  await publishAutomation(OWNER_A, created._id, OWNER_A)
  await setStatus(OWNER_A, created._id, 'active')
  assert.equal(liveWebhookCountFor(await listActivePublished(OWNER_A), target._id.toString()), 1)

  // Edit the DRAFT to point somewhere else, without republishing.
  const moved = await createAgent(OWNER_A, ground._id, 'Novo alvo', { preset: 'operator', objective: 'x' })
  await db.collection('automations').updateOne({ _id: created._id }, { $set: { draftDefinition: webhookDefinition(moved._id) } })

  const live = await listActivePublished(OWNER_A)
  assert.equal(liveWebhookCountFor(live, target._id.toString()), 1, 'the published version still rules')
  assert.equal(liveWebhookCountFor(live, moved._id.toString()), 0, 'an unpublished draft must not count')

  // Republish: now the new definition is the live one.
  await publishAutomation(OWNER_A, created._id, OWNER_A)
  const after = await listActivePublished(OWNER_A)
  assert.equal(liveWebhookCountFor(after, target._id.toString()), 0)
  assert.equal(liveWebhookCountFor(after, moved._id.toString()), 1)
})
