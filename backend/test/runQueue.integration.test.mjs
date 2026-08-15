// INTEGRATION: MongoDB IS the queue. Against a REAL mongod (started here) — no
// Redis, no broker. What used to be BullMQ's guarantees are now one atomic
// findOneAndUpdate, so they have to be proven, not assumed.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.RUN_LEASE_MS = '1000' // short lease so reclaim is testable in ms
process.env.MAX_RUN_CLAIMS = '3'

const { mongoClient, db } = await import('../dist/db.js')
const { ensureRunIndexes, insertRunIdempotent, claimNextRun, renewLease, releaseRun } = await import('../dist/automations/runRepository.js')

before(async () => {
  await mongoClient.connect()
  await ensureRunIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const runs = () => db.collection('automation_runs')
let seq = 0
const queued = (over = {}) => ({
  _id: new ObjectId(),
  ownerId: 'q-owner',
  buildingId: new ObjectId(),
  floorId: new ObjectId(),
  automationId: new ObjectId(),
  automationVersion: 1,
  definitionHash: 'h',
  definitionSnapshot: { trigger: { type: 'manual' }, inputs: [], steps: [], resultFormat: 'markdown', deliveries: [], limits: {} },
  triggerType: 'manual',
  triggerPayload: null,
  idempotencyKey: `k-${++seq}`,
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

const wipe = () => runs().deleteMany({ ownerId: 'q-owner' })

test('two workers racing for one run: exactly one wins', async () => {
  await wipe()
  const run = queued()
  await insertRunIdempotent(run)

  // Fire both claims at the same time — the atomicity is the whole point.
  const [a, b] = await Promise.all([claimNextRun('worker-A'), claimNextRun('worker-B')])
  const winners = [a, b].filter(Boolean)
  assert.equal(winners.length, 1, 'a run must never be handed to two workers')
  assert.equal(winners[0]._id.toString(), run._id.toString())
  assert.equal(winners[0].status, 'running')
  assert.ok(['worker-A', 'worker-B'].includes(winners[0].claimedBy))
})

test('runs are claimed oldest first', async () => {
  await wipe()
  const older = queued({ queuedAt: new Date(Date.now() - 60_000) })
  const newer = queued({ queuedAt: new Date() })
  await insertRunIdempotent(newer)
  await insertRunIdempotent(older)

  const first = await claimNextRun('w')
  assert.equal(first._id.toString(), older._id.toString(), 'the oldest queued run goes first')
})

test('an empty queue returns null instead of blocking', async () => {
  await wipe()
  assert.equal(await claimNextRun('w'), null)
})

test('a claimed run is invisible until its lease expires, then is reclaimed', async () => {
  await wipe()
  await insertRunIdempotent(queued())

  const first = await claimNextRun('worker-A')
  assert.ok(first)
  // While the lease holds, nobody else can take it.
  assert.equal(await claimNextRun('worker-B'), null, 'a live claim must not be stolen')

  // The process died: once the lease passes, the work is recoverable.
  await new Promise((r) => setTimeout(r, 1100))
  const second = await claimNextRun('worker-B')
  assert.ok(second, 'an expired lease must be reclaimed — otherwise a crash strands the run forever')
  assert.equal(second._id.toString(), first._id.toString())
  assert.equal(second.claimedBy, 'worker-B')
  assert.equal(second.claims, 2)
})

test('renewing the lease keeps a long run from being stolen', async () => {
  await wipe()
  await insertRunIdempotent(queued())
  const mine = await claimNextRun('worker-A')

  await new Promise((r) => setTimeout(r, 700))
  assert.equal(await renewLease(mine._id, 'worker-A'), true, 'the owner can renew')
  await new Promise((r) => setTimeout(r, 700))
  // Without the renewal the lease would have expired by now (1000ms).
  assert.equal(await claimNextRun('worker-B'), null, 'a renewed run stays mine')

  // A worker that does not own it cannot renew.
  assert.equal(await renewLease(mine._id, 'worker-B'), false)
})

test('releasing a finished run stops it from being reclaimed', async () => {
  await wipe()
  await insertRunIdempotent(queued())
  const mine = await claimNextRun('worker-A')
  await runs().updateOne({ _id: mine._id }, { $set: { status: 'succeeded', finishedAt: new Date() } })
  await releaseRun(mine._id)

  await new Promise((r) => setTimeout(r, 1100))
  assert.equal(await claimNextRun('worker-B'), null, 'a finished run is not work')
})

test('a run that keeps dying is parked as failed instead of cycling forever', async () => {
  await wipe()
  await insertRunIdempotent(queued())

  // Claim and abandon repeatedly, letting the lease expire each time.
  for (let i = 0; i < 3; i++) {
    const got = await claimNextRun(`w${i}`)
    assert.ok(got, `claim ${i + 1} should succeed`)
    await new Promise((r) => setTimeout(r, 1100))
  }
  // The 4th attempt exceeds MAX_RUN_CLAIMS: parked, and the queue is free again.
  assert.equal(await claimNextRun('w-final'), null)
  const doc = await runs().findOne({ ownerId: 'q-owner' })
  assert.equal(doc.status, 'failed')
  assert.match(doc.error.message, /abandonado/)
})

test('the idempotency key still admits exactly one run', async () => {
  await wipe()
  const a = await insertRunIdempotent(queued({ idempotencyKey: 'same' }))
  const b = await insertRunIdempotent(queued({ idempotencyKey: 'same' }))
  assert.equal(a.created, true)
  assert.equal(b.created, false)
  assert.equal(a.run._id.toString(), b.run._id.toString())
  assert.equal(await runs().countDocuments({ ownerId: 'q-owner' }), 1)
})
