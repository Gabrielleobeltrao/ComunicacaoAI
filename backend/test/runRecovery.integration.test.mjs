// INTEGRATION: a run must never get stuck. Against a REAL mongod.
//
// The failure this closes: processRun threw where nobody expected it to, the claim
// was dropped, and the run stayed 'running' with no lease — a state the claim query
// cannot see, so it sat there forever while the user waited for a result.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-encryption-key'
process.env.RUN_LEASE_MS = '400' // short, so an abandoned run is reclaimable in ms
process.env.MAX_RUN_CLAIMS = '3'
process.env.RUN_POLL_MS = '50'
process.env.SCHEDULER_POLL_MS = '100000' // the scheduler is not what is under test

const { mongoClient, db } = await import('../dist/db.js')
const { ensureRunIndexes, insertRunIdempotent, claimNextRun, recoverRun } = await import('../dist/automations/runRepository.js')
const { startAutomationEngine } = await import('../dist/automations/engine.js')

before(async () => {
  await mongoClient.connect()
  await ensureRunIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'recovery-owner'
const runs = () => db.collection('automation_runs')
let seq = 0

const queued = (over = {}) => ({
  _id: new ObjectId(),
  ownerId: OWNER,
  buildingId: new ObjectId(),
  floorId: new ObjectId(),
  automationId: new ObjectId(),
  automationVersion: 1,
  definitionHash: 'h',
  definitionSnapshot: { trigger: { type: 'manual' }, inputs: [], steps: [], resultFormat: 'markdown', deliveries: [], limits: {} },
  triggerType: 'manual',
  triggerPayload: null,
  idempotencyKey: `rec-${++seq}`,
  status: 'queued',
  currentStepId: null,
  queuedAt: new Date(),
  startedAt: null,
  finishedAt: null,
  cancelRequestedAt: null,
  usage: { inputTokens: 0, outputTokens: 0 },
  finalOutput: '',
  error: null,
  ...over,
})

beforeEach(() => runs().deleteMany({ ownerId: OWNER }))

const waitFor = async (predicate, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) return null
    await new Promise((r) => setTimeout(r, 25))
  }
}

test('an unexpected throw during processing requeues the run instead of stranding it', async () => {
  // A snapshot the processor cannot possibly execute: the runner dereferences it and
  // throws. That is exactly the "unexpected" case — not a step that failed cleanly.
  const run = queued({ definitionSnapshot: null })
  await insertRunIdempotent(run)

  const errors = []
  const engine = await startAutomationEngine({ concurrency: 1, onError: (where, error) => errors.push(`${where}: ${error?.message ?? error}`) })
  try {
    // It is retried (MAX_RUN_CLAIMS = 3) and then parked — never stuck, never
    // cycling forever. Waiting for the terminal state proves both.
    const parked = await waitFor(async () => {
      const doc = await runs().findOne({ _id: run._id })
      return doc.status === 'failed' ? doc : null
    })
    assert.ok(parked, 'the run must reach an honest terminal state, not sit in running')
    assert.equal(parked.leaseUntil, null, 'the claim is dropped')
    assert.ok(parked.error?.message, 'the reason is recorded')
    assert.ok(parked.finishedAt, 'and it is finished, so the UI stops waiting')
    assert.ok(
      errors.some((e) => e.includes(run._id.toString())),
      'the failure is reported, not swallowed',
    )
    // Nothing is left claimable: a stuck run would still be sitting there.
    assert.equal(await claimNextRun('late-worker'), null)
  } finally {
    await engine.stop()
  }
})

test('recoverRun requeues while claims remain, and parks the run once they run out', async () => {
  const first = queued()
  await insertRunIdempotent(first)
  await claimNextRun('worker-A') // claims = 1

  assert.equal(await recoverRun(first._id, 'falhou uma vez'), 'queued')
  const requeued = await runs().findOne({ _id: first._id })
  assert.equal(requeued.status, 'queued', 'a transient fault deserves another attempt')
  assert.equal(requeued.leaseUntil, null)
  assert.equal(requeued.claimedBy, null)
  assert.equal(requeued.error.message, 'falhou uma vez')

  // Burn the remaining claims.
  await claimNextRun('worker-A')
  await recoverRun(first._id, 'de novo')
  await claimNextRun('worker-A') // claims = 3 = MAX_RUN_CLAIMS

  assert.equal(await recoverRun(first._id, 'sempre falha'), 'failed')
  const parked = await runs().findOne({ _id: first._id })
  assert.equal(parked.status, 'failed', 'a poison run is parked, not cycled forever')
  assert.ok(parked.finishedAt, 'and it is honestly finished')
  assert.equal(parked.leaseUntil, null)
})

test('a run that already finished is never touched or repeated', async () => {
  const done = queued({ status: 'succeeded', finishedAt: new Date(), finalOutput: 'pronto' })
  await insertRunIdempotent(done)

  assert.equal(await recoverRun(done._id, 'tarde demais'), 'noop')
  const doc = await runs().findOne({ _id: done._id })
  assert.equal(doc.status, 'succeeded')
  assert.equal(doc.finalOutput, 'pronto')
  assert.equal(doc.error, null, 'a finished run keeps its result untouched')

  // And the queue never hands it out again.
  assert.equal(await claimNextRun('worker-Z'), null)
})

test('a run abandoned by a killed process returns to the queue once its lease expires', async () => {
  const run = queued()
  await insertRunIdempotent(run)

  const claimed = await claimNextRun('worker-that-dies')
  assert.ok(claimed)
  assert.equal(await claimNextRun('worker-B'), null, 'nobody may steal a live lease')

  // RUN_LEASE_MS = 400ms: the process died, so nothing renewed it.
  await new Promise((r) => setTimeout(r, 450))
  const reclaimed = await claimNextRun('worker-B')
  assert.ok(reclaimed, 'the work comes back after the lease')
  assert.equal(reclaimed._id.toString(), run._id.toString())
  assert.equal(reclaimed.claims, 2)
})
