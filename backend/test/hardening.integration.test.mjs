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
const { createAutomation, publishAutomation, updateDraft, validateAutomation } = await import('../dist/automations/service.js')
const { executeRoutineStep, RoutineConfigurationError } = await import('../dist/automations/routineExecution.js')
const { resolveOwnedSectorId: ownedSector } = await import('../dist/sectors.js')
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


// ------------------------------------------------- 4. execution-path hardening
// A minimal agent row the execution deps can return. No IO, no LLM.
const stubAgent = (over = {}) => ({
  _id: new ObjectId(),
  ownerId: A,
  officeId: new ObjectId(),
  name: 'Agente',
  objective: 'obj',
  provider: 'anthropic',
  model: null,
  preset: 'custom',
  ...over,
})

// Deps wired to REAL owner-scoped resolution, with spies on everything that costs.
function execDeps(agent, over = {}) {
  const calls = { runTask: 0, retrieve: 0, charge: [], events: [] }
  return {
    calls,
    deps: {
      loadAgent: async () => agent,
      resolveOwnedSectorId: ownedSector, // the real rule, not a copy
      retrieveContext: async () => {
        calls.retrieve++
        return { context: ['trecho'], failed: false }
      },
      resolveTools: async () => [],
      apiKeyFor: async () => 'k',
      runTask:
        over.runTask ??
        (async () => {
          calls.runTask++
          return { output: 'ok', usage: { inputTokens: 10, outputTokens: 5 }, toolCalls: [{ ok: true }, { ok: false }] }
        }),
      charge: over.charge ?? (async (ownerId, usage, key) => { calls.charge.push(key); return recordReplyUsageOnce(ownerId, usage, key) }),
      chargeKeyFor: attemptChargeKey,
      finalizeEvent: over.finalizeEvent ?? (async (input) => { calls.events.push(input.status); return finalizeAgentEvent(input) }),
      eventKeyFor: (runId, stepId, agentId) => `run:${runId}:${stepId}:${agentId}`,
      sleep: async () => {},
      ...over.depsPatch,
    },
  }
}

const stepCall = (over = {}) => ({ agentId: '', objective: 'o', instructions: 'faça', input: 'x', context: [], format: 'markdown', stepId: 's1', attempt: 1, ...over })
const runCtx = (over = {}) => ({ ownerId: A, runId: new ObjectId().toString(), buildingId: new ObjectId(), floorId: new ObjectId(), ...over })

test('validate reports a foreign sector with the same uniform error', async () => {
  const floorA = (await createFloor(A, { name: 'Andar validate' }))._id
  const floorB = (await createFloor(B, { name: 'Andar B validate' }))._id
  const sectorOfB = await createSector(B, floorB, 'B', '#fff', 'orchestrated', [])
  const clean = {
    trigger: { type: 'manual' },
    inputs: [],
    steps: [{ id: 's1', name: 'run', type: 'agent.execute', enabled: true, dependsOn: [], inputMapping: {}, config: { agentId: new ObjectId().toString(), instruction: 'x', format: 'markdown' }, timeoutMs: 0, retryPolicy: { maxAttempts: 1, backoffMs: 0 }, continueOnError: false }],
    resultFormat: 'markdown',
    deliveries: [],
    limits: { maxSteps: 10, maxToolCalls: 10, maxOutputChars: 1000, maxTokens: null },
  }
  const created = await createAutomation(A, { floorId: floorA.toString(), name: 'v', description: '', definition: clean })
  // A valid draft validates cleanly...
  assert.equal((await validateAutomation(A, created._id)).valid, true)
  // ...and the same draft tampered to point at B's sector is reported invalid with
  // the SAME uniform message used by create/update/publish.
  const tampered = structuredClone(clean)
  tampered.steps[0].config.sectorId = sectorOfB._id.toString()
  await db.collection('automations').updateOne({ _id: created._id }, { $set: { draftDefinition: tampered } })
  const result = await validateAutomation(A, created._id)
  assert.equal(result.valid, false)
  assert.ok(sectorRefused({ issues: result.errors }))
})

test('a tampered automation fails BEFORE the LLM, knowledge or any charge', async () => {
  const floorB = (await createFloor(B, { name: 'Andar B exec' }))._id
  const sectorOfB = await createSector(B, floorB, 'B exec', '#fff', 'orchestrated', [])
  const agent = stubAgent()
  const f = execDeps(agent)
  const ctx = runCtx()

  await assert.rejects(
    () => executeRoutineStep(stepCall({ agentId: agent._id.toString(), sectorId: sectorOfB._id.toString() }), ctx, f.deps),
    (e) => e instanceof RoutineConfigurationError && !/exist|found|outra conta/i.test(e.message),
  )
  // Nothing was spent: no model call, no retrieval, no charge, no telemetry.
  assert.equal(f.calls.runTask, 0)
  assert.equal(f.calls.retrieve, 0)
  assert.deepEqual(f.calls.charge, [])
  assert.deepEqual(f.calls.events, [])
  assert.equal(await db.collection('token_usage_charges').countDocuments({ ownerId: A, _id: new RegExp(ctx.runId) }), 0)
})

test('a redelivered attempt does not charge again nor re-accumulate', async () => {
  const agent = stubAgent()
  const owner = `redeliver-${new ObjectId()}`
  const ctx = runCtx({ ownerId: owner })
  const f = execDeps(agent)
  const call = stepCall({ agentId: agent._id.toString() })

  await executeRoutineStep(call, ctx, f.deps)
  await executeRoutineStep(call, ctx, f.deps) // the SAME attempt, redelivered

  assert.equal(f.calls.runTask, 2) // the model really ran twice (the job was redelivered)
  assert.equal(await getMonthlyTokens(owner), 15) // but it was billed ONCE
  const ev = await agentEventsCollection.findOne({ eventKey: `run:${ctx.runId}:s1:${agent._id.toString()}` })
  assert.equal(ev.attemptCount, 1)
  assert.equal(ev.inputTokens, 10)
  assert.equal(ev.toolCalls, 1) // only the ok:true call
})

test('a transient persistence failure never triggers a second inference', async () => {
  const agent = stubAgent()
  const owner = `flaky-${new ObjectId()}`
  let chargeCalls = 0
  const f = execDeps(agent, {
    charge: async (ownerId, usage, key) => {
      chargeCalls++
      if (chargeCalls === 1) throw new Error('temporary write failure')
      return recordReplyUsageOnce(ownerId, usage, key)
    },
  })
  const ctx = runCtx({ ownerId: owner })
  const out = await executeRoutineStep(stepCall({ agentId: agent._id.toString() }), ctx, f.deps)

  assert.equal(out.output, 'ok')
  assert.equal(out.persisted, true) // the retry succeeded
  assert.equal(chargeCalls, 2) // charge retried...
  assert.equal(f.calls.runTask, 1) // ...WITHOUT calling the model again
  assert.equal(await getMonthlyTokens(owner), 15)
})

test('a step still completes (without re-inferring) when persistence keeps failing', async () => {
  const agent = stubAgent()
  const f = execDeps(agent, {
    charge: async () => {
      throw new Error('down')
    },
  })
  const out = await executeRoutineStep(stepCall({ agentId: agent._id.toString() }), runCtx(), f.deps)
  assert.equal(out.output, 'ok') // the work is not thrown away
  assert.equal(out.persisted, false) // and the caller is told accounting failed
  assert.equal(f.calls.runTask, 1) // the model ran exactly once
})

test('a late attempt-1 write never overwrites the newest attempt (through the executor)', async () => {
  const agent = stubAgent()
  const ctx = runCtx({ ownerId: `late-${new ObjectId()}` })
  const key = `run:${ctx.runId}:s1:${agent._id.toString()}`

  // attempt 1 fails, attempt 2 succeeds
  const failing = execDeps(agent, {
    runTask: async () => {
      throw new Error('provider blip')
    },
  })
  await assert.rejects(() => executeRoutineStep(stepCall({ agentId: agent._id.toString(), attempt: 1 }), ctx, failing.deps))
  const ok = execDeps(agent)
  await executeRoutineStep(stepCall({ agentId: agent._id.toString(), attempt: 2 }), ctx, ok.deps)

  // a delayed duplicate of attempt 1 arrives afterwards
  await assert.rejects(() => executeRoutineStep(stepCall({ agentId: agent._id.toString(), attempt: 1 }), ctx, failing.deps))

  const ev = await agentEventsCollection.findOne({ eventKey: key })
  assert.equal(ev.status, 'succeeded') // attempt 2 still wins
  assert.equal(ev.latestAttempt, 2)
  assert.equal(ev.attemptCount, 2) // and nothing was re-accumulated
})
