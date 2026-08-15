// INTEGRATION: the automation machinery — run idempotency, the run queue and the
// scheduler — against a REAL mongod (started here) and a REAL Redis.
//
// It brings its own MongoDB, so the only external requirement is Redis. When no
// Redis answers, the file skips with a message saying exactly what to start,
// instead of pretending the pipeline is covered.
//
// ISOLATION: it always uses a DEDICATED Redis database (index 15) and ignores any
// ambient REDIS_URL. The queues and the scheduler are global by name, so sharing a
// database with a running worker would let this file's reconcile wipe real
// schedules. Point TEST_REDIS_URL somewhere else if 15 is taken.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15'

// A plain TCP probe: cheap, and it never leaves a client connected.
async function redisReachable(url) {
  const { hostname, port } = new URL(url)
  return new Promise((resolve) => {
    const socket = net.connect({ host: hostname || '127.0.0.1', port: Number(port) || 6379 })
    const done = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(1500)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.once('timeout', () => done(false))
  })
}

const hasRedis = await redisReachable(REDIS_URL)
const skip = hasRedis ? false : `Redis não respondeu em ${REDIS_URL} — suba um (docker run -p 6379:6379 redis) para exercitar a fila`

// Never let an ambient value leak in: the isolated database is the whole point.
process.env.REDIS_URL = REDIS_URL

process.env.MONGODB_URI = await startMongo()

const { ObjectId } = await import('mongodb')
const { mongoClient, db } = await import('../dist/db.js')
const { ensureRunIndexes, insertRunIdempotent } = await import('../dist/automations/runRepository.js')
const { getRunQueue, enqueueRun, closeRunQueue, jobIdFor } = await import('../dist/automations/queue.js')
const { getScheduleQueue, reconcileSchedules, closeScheduleQueue } = await import('../dist/automations/scheduler.js')

// Everything this file creates is namespaced, so a shared Redis is never polluted.
const OWNER = `itest-${process.pid}`
const KEY = `${OWNER}-run`

before(async () => {
  if (skip) return
  await mongoClient.connect()
  await ensureRunIndexes()
})

after(async () => {
  if (hasRedis) {
    // Safe because this database is exclusive to the test (see ISOLATION above).
    const runQueue = getRunQueue()
    await runQueue.remove(jobIdFor(KEY)).catch(() => undefined)
    const scheduleQueue = getScheduleQueue()
    for (const s of await scheduleQueue.getJobSchedulers().catch(() => [])) {
      await scheduleQueue.removeJobScheduler(s.key).catch(() => undefined)
    }
    // Drops the singletons too, so the Redis connections stop holding the process.
    await closeRunQueue()
    await closeScheduleQueue()
  }
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const runDoc = (over = {}) => ({
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
  idempotencyKey: KEY,
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

test('the same idempotency key inserts ONE run and enqueues ONE job', { skip }, async () => {
  const a = await insertRunIdempotent(runDoc())
  const b = await insertRunIdempotent(runDoc())
  assert.equal(a.created, true)
  assert.equal(b.created, false, 'a redelivered trigger must not create a second run')
  assert.equal(a.run._id.toString(), b.run._id.toString())

  const queue = getRunQueue()
  await enqueueRun(KEY, a.run._id.toString())
  await enqueueRun(KEY, a.run._id.toString())
  const job = await queue.getJob(jobIdFor(KEY))
  assert.ok(job, 'a job exists for the idempotency key')
  assert.equal(job.data.runId, a.run._id.toString())
})

test('an ACTIVE schedule automation is registered with the scheduler; a paused one is not', { skip }, async () => {
  const automations = db.collection('automations')
  const active = new ObjectId()
  const paused = new ObjectId()
  const base = {
    ownerId: OWNER,
    buildingId: new ObjectId(),
    floorId: new ObjectId(),
    name: 'itest',
    description: '',
    trigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 7 * * *' },
    draftDefinition: { trigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 7 * * *' }, inputs: [], steps: [], resultFormat: 'markdown', deliveries: [], limits: {} },
    currentVersion: 1,
    lastPublishedVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  await automations.insertMany([
    { ...base, _id: active, status: 'active' },
    { ...base, _id: paused, status: 'paused' },
  ])

  await reconcileSchedules()
  const keys = new Set((await getScheduleQueue().getJobSchedulers()).map((s) => s.key))
  assert.ok(keys.has(active.toString()), 'an active schedule must be registered — otherwise routines never fire')
  assert.ok(!keys.has(paused.toString()), 'a paused automation must never be scheduled')

  // Pausing it removes the registration on the next reconcile.
  await automations.updateOne({ _id: active }, { $set: { status: 'paused' } })
  await reconcileSchedules()
  const after = new Set((await getScheduleQueue().getJobSchedulers()).map((s) => s.key))
  assert.ok(!after.has(active.toString()), 'pausing must unregister the schedule')
})

test('the queue delivers a job to a worker, which consumes it exactly once', { skip }, async () => {
  const { Worker } = await import('bullmq')
  const { createConnection } = await import('../dist/automations/queue.js')

  const seen = []
  const connection = createConnection()
  const worker = new Worker(
    'automation-runs',
    async (job) => {
      seen.push(String(job.data.runId))
    },
    { connection, concurrency: 1 },
  )

  const runId = new ObjectId().toString()
  const key = `${OWNER}-consumed`
  // Enqueue TWICE with the same idempotency key: BullMQ must hand it over once.
  await enqueueRun(key, runId)
  await enqueueRun(key, runId)

  const mine = () => seen.filter((x) => x === runId)
  const deadline = Date.now() + 10_000
  while (mine().length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
  // Give a redelivery a fair chance to show up before asserting it did not.
  await new Promise((r) => setTimeout(r, 500))

  // The queue is shared with the earlier test, so count only this run's deliveries.
  assert.deepEqual(mine(), [runId], 'the worker must consume the job exactly once')

  await worker.close()
  await connection.quit().catch(() => connection.disconnect())
  await getRunQueue().remove(jobIdFor(key)).catch(() => undefined)
})

test('a scheduled automation creates exactly ONE run per fire instant', { skip }, async () => {
  const { createRun } = await import('../dist/automations/runService.js')
  const automations = db.collection('automations')
  const id = new ObjectId()
  await automations.insertOne({
    _id: id,
    ownerId: OWNER,
    buildingId: new ObjectId(),
    floorId: new ObjectId(),
    name: 'agendada',
    description: '',
    status: 'active',
    trigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 7 * * *' },
    draftDefinition: { trigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 7 * * *' }, inputs: [], steps: [], resultFormat: 'markdown', deliveries: [], limits: {} },
    currentVersion: 1,
    lastPublishedVersion: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  // The scheduler's key is automationId + fire timestamp, WITH a colon — the exact
  // shape BullMQ rejects as a job id. Enqueuing used to throw here after the run
  // row was written, stranding it in 'queued'. Two fires of the same instant (a
  // replica, a re-delivery) must produce exactly one run.
  const fired = `${id.toString()}:1700000000000`
  const first = await createRun(OWNER, id, { triggerType: 'schedule', idempotencyKey: fired })
  const second = await createRun(OWNER, id, { triggerType: 'schedule', idempotencyKey: fired })
  assert.equal(first.created, true)
  assert.equal(second.created, false, 'a re-fire must never duplicate the run')
  assert.equal(first.run._id.toString(), second.run._id.toString())

  const count = await db.collection('automation_runs').countDocuments({ idempotencyKey: fired })
  assert.equal(count, 1, 'exactly one run row for one fire instant')
})

test('closing the queues leaves no open Redis connection behind', { skip }, async () => {
  // Open both producers, then close them the way the worker does on SIGTERM.
  getRunQueue()
  getScheduleQueue()
  await closeRunQueue()
  await closeScheduleQueue()

  // A closed singleton must be re-creatable — proving close() dropped it rather
  // than leaving a half-dead client around.
  const reopened = getRunQueue()
  assert.ok(reopened, 'the queue can be opened again after closing')
  await closeRunQueue()

  // The real proof that nothing is left open is the process exiting on its own:
  // node:test would hang forever otherwise, and this file has no forced exit.
})
