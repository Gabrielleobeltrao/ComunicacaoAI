// INTEGRATION: the scheduler against a REAL mongod — no Redis. These are the
// guarantees BullMQ's Job Schedulers used to provide, now upheld by `nextRunAt`
// plus the unique idempotency key.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()

const { mongoClient, db } = await import('../dist/db.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
const { ensureSchedulerIndexes, planSchedules, runDueSchedules, tickScheduler } = await import('../dist/automations/scheduler.js')

before(async () => {
  await mongoClient.connect()
  await ensureRunIndexes()
  await ensureSchedulerIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'sched-owner'
const automations = () => db.collection('automations')
const runs = () => db.collection('automation_runs')

beforeEach(async () => {
  await automations().deleteMany({ ownerId: OWNER })
  await runs().deleteMany({ ownerId: OWNER })
})

// A published, active daily schedule at 09:00 São Paulo. `publishedTrigger` is what
// the scheduler reads — the draft `trigger` is only what the editor shows.
async function seedSchedule(over = {}) {
  const id = new ObjectId()
  const trigger = over.trigger ?? { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 9 * * *' }
  const definition = { trigger, inputs: [], steps: [], resultFormat: 'markdown', deliveries: [], limits: {} }
  await automations().insertOne({
    _id: id,
    ownerId: OWNER,
    buildingId: new ObjectId(),
    floorId: new ObjectId(),
    name: 'rotina',
    description: '',
    status: 'active',
    trigger,
    draftDefinition: definition,
    publishedTrigger: trigger,
    currentVersion: 1,
    lastPublishedVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  })
  return id
}

test('an active schedule gets a future nextRunAt; a paused one gets none', async () => {
  const active = await seedSchedule()
  const paused = await seedSchedule({ status: 'paused' })
  const now = new Date('2026-08-15T01:00:00Z')

  const { planned } = await planSchedules(now)
  assert.equal(planned, 1, 'only the active one is planned')

  const a = await automations().findOne({ _id: active })
  assert.ok(a.nextRunAt > now, 'the fire instant must be in the future')
  assert.equal(a.nextRunAt.toISOString(), '2026-08-15T12:00:00.000Z')

  const p = await automations().findOne({ _id: paused })
  assert.ok(!p.nextRunAt, 'a paused automation must never carry a pending fire')
})

test('pausing an automation clears its pending fire', async () => {
  const id = await seedSchedule()
  await planSchedules(new Date('2026-08-15T01:00:00Z'))
  assert.ok((await automations().findOne({ _id: id })).nextRunAt)

  await automations().updateOne({ _id: id }, { $set: { status: 'paused' } })
  const { cleared } = await planSchedules(new Date('2026-08-15T01:00:00Z'))
  assert.equal(cleared, 1)
  assert.equal((await automations().findOne({ _id: id })).nextRunAt, null)
})

test('reactivating replans without duplicating', async () => {
  const id = await seedSchedule()
  const now = new Date('2026-08-15T01:00:00Z')
  await planSchedules(now)
  await automations().updateOne({ _id: id }, { $set: { status: 'paused' } })
  await planSchedules(now)
  await automations().updateOne({ _id: id }, { $set: { status: 'active' } })
  await planSchedules(now)

  assert.equal(await automations().countDocuments({ ownerId: OWNER }), 1, 'activate → pause → activate is still ONE automation')
  assert.ok((await automations().findOne({ _id: id })).nextRunAt)
})

test('a due schedule creates exactly ONE run and moves to the next instant', async () => {
  const id = await seedSchedule()
  await planSchedules(new Date('2026-08-15T01:00:00Z'))

  // Past the fire instant.
  const now = new Date('2026-08-15T12:00:30Z')
  const { fired } = await runDueSchedules(now)
  assert.equal(fired, 1)

  const created = await runs().find({ ownerId: OWNER, automationId: id }).toArray()
  assert.equal(created.length, 1)
  assert.equal(created[0].status, 'queued', 'inserting IS enqueuing — no broker involved')
  assert.equal(created[0].triggerType, 'schedule')

  // Advanced to tomorrow, so a second tick fires nothing.
  const after = await automations().findOne({ _id: id })
  assert.equal(after.nextRunAt.toISOString(), '2026-08-16T12:00:00.000Z')
  assert.deepEqual(await runDueSchedules(now), { fired: 0, skipped: 0 })
  assert.equal(await runs().countDocuments({ ownerId: OWNER }), 1)
})

test('two replicas ticking at the same instant still produce ONE run', async () => {
  const id = await seedSchedule()
  await planSchedules(new Date('2026-08-15T01:00:00Z'))
  const now = new Date('2026-08-15T12:00:30Z')

  // The real race: both processes wake up together.
  const [a, b] = await Promise.all([runDueSchedules(now), runDueSchedules(now)])
  assert.equal(a.fired + b.fired, 1, 'exactly one replica may fire a given instant')
  assert.equal(await runs().countDocuments({ ownerId: OWNER, automationId: id }), 1)
})

test('fires missed while the process was down are skipped, not replayed', async () => {
  const id = await seedSchedule()
  // Pretend the plan is three days stale.
  await automations().updateOne({ _id: id }, { $set: { nextRunAt: new Date('2026-08-12T12:00:00Z') } })

  const now = new Date('2026-08-15T13:00:00Z')
  const { fired, skipped } = await runDueSchedules(now)
  assert.equal(fired, 1, 'one run for the current gap, not one per missed day')
  assert.equal(skipped, 3, 'the 13th, 14th and 15th are reported as skipped')
  assert.equal(await runs().countDocuments({ ownerId: OWNER }), 1)
  assert.equal((await automations().findOne({ _id: id })).nextRunAt.toISOString(), '2026-08-16T12:00:00.000Z')
})

test('a malformed schedule is left alone instead of stopping the loop', async () => {
  await seedSchedule({ trigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: 'isso não é cron' } })
  const good = await seedSchedule()

  const { planned } = await planSchedules(new Date('2026-08-15T01:00:00Z'))
  assert.equal(planned, 1, 'the healthy automation is still planned')
  assert.ok((await automations().findOne({ _id: good })).nextRunAt)
})

test('a manual automation is never scheduled', async () => {
  await seedSchedule({ trigger: { type: 'manual' } })
  const { planned } = await planSchedules(new Date('2026-08-15T01:00:00Z'))
  assert.equal(planned, 0)
})

test('tickScheduler plans and fires in one pass', async () => {
  const id = await seedSchedule()
  // First tick plans; the instant is in the future, so nothing fires yet.
  const first = await tickScheduler(new Date('2026-08-15T01:00:00Z'))
  assert.equal(first.planned, 1)
  assert.equal(first.fired, 0)

  // A later tick, past the instant, fires it.
  const second = await tickScheduler(new Date('2026-08-15T12:00:30Z'))
  assert.equal(second.fired, 1)
  assert.equal(await runs().countDocuments({ ownerId: OWNER, automationId: id }), 1)
})
