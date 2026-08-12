// Integration test for run idempotency (plan §10.4). GUARDED: it runs only when
// both MONGODB_URI and REDIS_URL are set (e.g. against compose.dev.yml), and is
// skipped otherwise — so `npm test` stays green with no infra. Bring infra up
// and run: MONGODB_URI=... REDIS_URL=... npm test -w backend
import { test } from 'node:test'
import assert from 'node:assert/strict'

const hasInfra = Boolean(process.env.MONGODB_URI && process.env.REDIS_URL)

test('same idempotencyKey inserts one run and enqueues one job', { skip: !hasInfra }, async () => {
  const { ObjectId } = await import('mongodb')
  const { mongoClient } = await import('../dist/db.js')
  const { ensureRunIndexes, insertRunIdempotent } = await import('../dist/automations/runRepository.js')
  const { getRunQueue, enqueueRun } = await import('../dist/automations/queue.js')

  await mongoClient.connect()
  await ensureRunIndexes()

  const key = `itest-${Date.now()}`
  const base = {
    ownerId: 'itest',
    buildingId: new ObjectId(),
    floorId: new ObjectId(),
    automationId: new ObjectId(),
    automationVersion: 0,
    definitionHash: 'h',
    definitionSnapshot: { trigger: { type: 'manual' }, inputs: [], steps: [], resultFormat: 'markdown', deliveries: [], limits: {} },
    triggerType: 'manual',
    triggerPayload: null,
    idempotencyKey: key,
    status: 'queued',
    currentStepId: null,
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    finalOutput: '',
    error: null,
  }

  const a = await insertRunIdempotent({ ...base, _id: new ObjectId() })
  const b = await insertRunIdempotent({ ...base, _id: new ObjectId() })
  assert.equal(a.created, true)
  assert.equal(b.created, false)
  assert.equal(a.run._id.toString(), b.run._id.toString())

  const queue = getRunQueue()
  await enqueueRun(key, a.run._id.toString())
  await enqueueRun(key, a.run._id.toString())
  const job = await queue.getJob(key)
  assert.ok(job, 'a job exists for the idempotency key')

  // cleanup
  await queue.remove(key)
  await mongoClient.db().collection('automation_runs').deleteMany({ ownerId: 'itest' })
  await queue.close()
  await mongoClient.close()
})
