// INTEGRATION against a REAL mongod (replica set, so transactions are available —
// the same shape as Atlas). Covers the three MVP hardening items end to end:
//   1. sector knowledge isolation (create / publish / execute, tenant A vs B)
//   2. exactly-once charging (concurrency, crash windows, restart, two instances)
//   3. atomic retry/status bookkeeping (same attempt, real retry, late write)
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

const uri = await startMongo()
process.env.MONGODB_URI = uri

const { db, mongoClient } = await import('../dist/db.js')
const { finalizeAgentEvent, backfillAgentEventAttempts, agentEventsCollection, ensureAgentEventIndexes } = await import('../dist/agentEvents.js')
const { recordReplyUsageOnce, settlePendingCharges, ensureTokenUsageIndexes, getMonthlyTokens, attemptChargeKey } = await import('../dist/tokenUsage.js')
const { createSector, resolveOwnedSectorId } = await import('../dist/sectors.js')
const { createFloor } = await import('../dist/floors.js')
const { createAutomation, publishAutomation, updateDraft } = await import('../dist/automations/service.js')
const { createDocumentFor, listDocumentsFor, getDocumentFor, deleteDocumentFor, updateDocumentFor, ownerFilter } = await import('../dist/knowledge.js')

const A = 'owner-A'
const B = 'owner-B'

// The refusal is uniform: it names the config path, never whether the id exists.
const sectorRefused = (e) => {
  const detail = JSON.stringify(e?.issues ?? e?.errors ?? e?.message ?? e)
  return /setor indispon/i.test(detail) && !/exist|found|outra conta|owner/i.test(detail)
}

before(async () => {
  await mongoClient.connect()
  await ensureAgentEventIndexes()
  await ensureTokenUsageIndexes()
})
after(async () => {
  await mongoClient.close()
  await stopMongo()
})

// ---------------------------------------------------------------- 1. isolation
test('a sector id from another account is never resolvable', async () => {
  const floor = new ObjectId()
  const sectorOfB = await createSector(B, floor, 'Time do B', '#fff', 'orchestrated', [])
  // A cannot resolve B's sector, even though the id is a perfectly valid ObjectId.
  assert.equal(await resolveOwnedSectorId(A, sectorOfB._id.toString()), null)
  // B can.
  assert.ok(await resolveOwnedSectorId(B, sectorOfB._id.toString()))
  // A malformed id is refused the same way (no distinction leaks).
  assert.equal(await resolveOwnedSectorId(B, 'not-an-id'), null)
})

test("A cannot CREATE or PUBLISH an automation referencing B's sector", async () => {
  // Real floors for both accounts, so the sector check is what decides the outcome.
  const floorA = (await createFloor(A, { name: 'Andar A' }))._id
  const floorB = (await createFloor(B, { name: 'Andar B' }))._id
  const sectorOfB = await createSector(B, floorB, 'Time do B', '#fff', 'orchestrated', [])
  const definition = {
    trigger: { type: 'manual' },
    inputs: [],
    steps: [
      {
        id: 's1',
        name: 'run',
        type: 'agent.execute',
        enabled: true,
        dependsOn: [],
        inputMapping: {},
        config: { agentId: new ObjectId().toString(), instruction: 'x', format: 'markdown', sectorId: sectorOfB._id.toString() },
        timeoutMs: 0,
        retryPolicy: { maxAttempts: 1, backoffMs: 0 },
        continueOnError: false,
      },
    ],
    resultFormat: 'markdown',
    deliveries: [],
    limits: { maxSteps: 10, maxToolCalls: 10, maxOutputChars: 1000, maxTokens: null },
  }

  // CREATE is refused with a uniform configuration error.
  await assert.rejects(
    () => createAutomation(A, { floorId: floorA.toString(), name: 'x', description: '', definition }),
    (e) => sectorRefused(e), // OUR check, not a floor error
  )

  // A legitimate automation for A, later patched to point at B's sector: refused.
  const clean = structuredClone(definition)
  delete clean.steps[0].config.sectorId
  const created = await createAutomation(A, { floorId: floorA.toString(), name: 'ok', description: '', definition: clean })
  await assert.rejects(() => updateDraft(A, created._id, { definition }), sectorRefused)

  // And publishing a draft that somehow already carries it is refused too.
  await db.collection('automations').updateOne({ _id: created._id }, { $set: { draftDefinition: definition } })
  await assert.rejects(() => publishAutomation(A, created._id, A), sectorRefused)
})

test("no document or chunk of B is reachable through A's owner filter", async () => {
  const sectorB = new ObjectId()
  const docB = await createDocumentFor({ ownerType: 'sector', ownerId: sectorB }, { title: 'Segredo B', content: 'conteudo do B' })
  const sectorA = new ObjectId()

  // A's sector base does not contain B's document...
  const listedForA = await listDocumentsFor({ ownerType: 'sector', ownerId: sectorA })
  assert.equal(listedForA.some((d) => d._id.equals(docB._id)), false)
  // ...and A cannot read, update or delete it.
  assert.equal(await getDocumentFor({ ownerType: 'sector', ownerId: sectorA }, docB._id), null)
  assert.equal(await updateDocumentFor({ ownerType: 'sector', ownerId: sectorA }, docB._id, { title: 'hack' }), null)
  assert.equal(await deleteDocumentFor({ ownerType: 'sector', ownerId: sectorA }, docB._id), false)
  // The document is intact for its real owner.
  const still = await getDocumentFor({ ownerType: 'sector', ownerId: sectorB }, docB._id)
  assert.equal(still.title, 'Segredo B')

  // A sector filter never falls back to the legacy agentId branch.
  assert.equal('$or' in ownerFilter({ ownerType: 'sector', ownerId: sectorA }), false)

  // The chunks written for B are owner-stamped, so a query scoped to A returns none.
  const chunksOfA = await db.collection('knowledge_chunks').countDocuments({ ownerType: 'sector', ownerId: sectorA })
  assert.equal(chunksOfA, 0)
})

// --------------------------------------------------------------- 2. charging
test('the same charge key never bills twice, even under concurrency', async () => {
  const owner = `charge-${new ObjectId()}`
  const key = 'run:r1:s1:a1:a1'
  const results = await Promise.all(Array.from({ length: 8 }, () => recordReplyUsageOnce(owner, { inputTokens: 10, outputTokens: 5 }, key)))
  assert.equal(results.filter(Boolean).length, 1) // exactly one caller billed
  assert.equal(await getMonthlyTokens(owner), 15)
  // A redelivery afterwards is still a no-op.
  assert.equal(await recordReplyUsageOnce(owner, { inputTokens: 10, outputTokens: 5 }, key), false)
  assert.equal(await getMonthlyTokens(owner), 15)
})

test('a real retry uses a different key and DOES bill again', async () => {
  const owner = `charge-${new ObjectId()}`
  await recordReplyUsageOnce(owner, { inputTokens: 10, outputTokens: 0 }, attemptChargeKey('r', 's', 'a', 1))
  await recordReplyUsageOnce(owner, { inputTokens: 7, outputTokens: 0 }, attemptChargeKey('r', 's', 'a', 2))
  assert.equal(await getMonthlyTokens(owner), 17)
})

test('a crash between rollup and mark cannot double count on restart', async () => {
  const owner = `charge-${new ObjectId()}`
  const key = 'crashy'
  // Simulate the dangerous window: the ledger row exists as NOT applied while the
  // rollup already has the tokens (the exact state an old-style crash could leave).
  await db.collection('token_usage_charges').insertOne({ _id: key, ownerId: owner, date: new Date().toISOString().slice(0, 10), inputTokens: 9, outputTokens: 0, applied: false, createdAt: new Date() })
  const before = await getMonthlyTokens(owner)
  assert.equal(before, 9) // pending rows are already counted at read time

  // Restart → settle. The total must NOT move (it was already reported).
  await settlePendingCharges()
  assert.equal(await getMonthlyTokens(owner), 9)
  // Settling again (a second instance) is still a no-op.
  await settlePendingCharges()
  assert.equal(await getMonthlyTokens(owner), 9)
})

test('two settle runners in parallel apply each charge once', async () => {
  const owner = `charge-${new ObjectId()}`
  const day = new Date().toISOString().slice(0, 10)
  await db.collection('token_usage_charges').insertMany([
    { _id: `p1-${owner}`, ownerId: owner, date: day, inputTokens: 4, outputTokens: 0, applied: false, createdAt: new Date() },
    { _id: `p2-${owner}`, ownerId: owner, date: day, inputTokens: 6, outputTokens: 0, applied: false, createdAt: new Date() },
  ])
  await Promise.all([settlePendingCharges(), settlePendingCharges(), settlePendingCharges()])
  assert.equal(await getMonthlyTokens(owner), 10) // 4 + 6, never doubled
  assert.equal(await db.collection('token_usage_charges').countDocuments({ ownerId: owner, applied: false }), 0)
})

// ------------------------------------------------------- 3. attempts / status
const evBase = (eventKey, attempt, status, ms, tokens) => ({
  eventKey,
  ownerId: 'owner-ev',
  agentId: new ObjectId(),
  source: 'routine',
  preset: 'custom',
  status,
  startedAt: new Date(Date.now() - ms),
  finishedAt: new Date(),
  durationMs: ms,
  inputTokens: tokens,
  outputTokens: 0,
  toolCalls: 1,
  attemptCount: attempt,
})

test('the same attempt written twice accumulates only once', async () => {
  const key = `ev-dup-${new ObjectId()}`
  await finalizeAgentEvent(evBase(key, 1, 'failed', 100, 10))
  await finalizeAgentEvent(evBase(key, 1, 'failed', 100, 10)) // redelivery
  const doc = await agentEventsCollection.findOne({ eventKey: key })
  assert.equal(doc.attemptCount, 1)
  assert.equal(doc.durationMs, 100)
  assert.equal(doc.inputTokens, 10)
  assert.equal(doc.toolCalls, 1)
})

test('concurrent writes of the same attempt still accumulate once', async () => {
  const key = `ev-race-${new ObjectId()}`
  await Promise.all(Array.from({ length: 6 }, () => finalizeAgentEvent(evBase(key, 1, 'succeeded', 50, 5))))
  const doc = await agentEventsCollection.findOne({ eventKey: key })
  assert.equal(doc.attemptCount, 1)
  assert.equal(doc.durationMs, 50)
  assert.equal(doc.inputTokens, 5)
})

test('a real retry accumulates and ends with the highest attempt status', async () => {
  const key = `ev-retry-${new ObjectId()}`
  await finalizeAgentEvent(evBase(key, 1, 'failed', 100, 10))
  await finalizeAgentEvent(evBase(key, 2, 'succeeded', 200, 20))
  const doc = await agentEventsCollection.findOne({ eventKey: key })
  assert.equal(doc.status, 'succeeded')
  assert.equal(doc.attemptCount, 2)
  assert.equal(doc.durationMs, 300)
  assert.equal(doc.inputTokens, 30)
  assert.equal(doc.latestAttempt, 2)
})

test('a LATE write from attempt 1 never overwrites the success of attempt 2', async () => {
  const key = `ev-late-${new ObjectId()}`
  await finalizeAgentEvent(evBase(key, 1, 'failed', 100, 10))
  await finalizeAgentEvent(evBase(key, 2, 'succeeded', 200, 20))
  // attempt 1's terminal write arrives late (a delayed/duplicated worker message)
  await finalizeAgentEvent(evBase(key, 1, 'failed', 100, 10))
  const doc = await agentEventsCollection.findOne({ eventKey: key })
  assert.equal(doc.status, 'succeeded') // the later attempt still wins
  assert.equal(doc.latestAttempt, 2)
  assert.equal(doc.attemptCount, 2) // and nothing was re-accumulated
  assert.equal(doc.durationMs, 300)
})

test('legacy events without seenAttempts are backfilled and then protected', async () => {
  const key = `ev-legacy-${new ObjectId()}`
  await agentEventsCollection.insertOne({
    _id: new ObjectId(),
    eventKey: key,
    ownerId: 'owner-ev',
    buildingId: null,
    floorId: null,
    agentId: new ObjectId(),
    source: 'routine',
    preset: 'custom',
    status: 'succeeded',
    startedAt: new Date(),
    finishedAt: new Date(),
    durationMs: 500,
    inputTokens: 50,
    outputTokens: 0,
    toolCalls: 0,
    attemptCount: 2,
    parentEventKey: null,
    rootEventKey: key,
    metadata: {},
  })
  await backfillAgentEventAttempts()
  const filled = await agentEventsCollection.findOne({ eventKey: key })
  assert.deepEqual(filled.seenAttempts, [1, 2])
  assert.equal(filled.latestAttempt, 2)
  // A replay of attempt 2 now finds it already accounted.
  await finalizeAgentEvent(evBase(key, 2, 'succeeded', 999, 999))
  const after = await agentEventsCollection.findOne({ eventKey: key })
  assert.equal(after.attemptCount, 2)
  assert.equal(after.durationMs, 500)
  assert.equal(after.inputTokens, 50)
})
