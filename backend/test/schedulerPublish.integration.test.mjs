// INTEGRATION: what the scheduler is allowed to fire, and what happens when a fire
// cannot be turned into a run. Against a REAL mongod.
//
// Two rules are under test here:
//   1. only the LAST PUBLISHED trigger schedules anything — a cron half-edited in
//      the browser must never fire, and changing the hour must not let the old hour
//      go off one last time;
//   2. a fire instant is spent only once its run exists — if creation fails the
//      instant goes back, so the trigger is retried instead of silently lost.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
const { ensureSchedulerIndexes, planSchedules, runDueSchedules, tickScheduler } = await import('../dist/automations/scheduler.js')
const { publishAutomation } = await import('../dist/automations/service.js')

before(async () => {
  await mongoClient.connect()
  await ensureRunIndexes()
  await ensureSchedulerIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'publish-owner'
const automations = () => db.collection('automations')
const versions = () => db.collection('automation_versions')
const runs = () => db.collection('automation_runs')

const step = () => ({
  id: 's1',
  name: 'texto',
  type: 'transform.template',
  enabled: true,
  dependsOn: [],
  inputMapping: {},
  config: { template: 'olá' },
  timeoutMs: 1000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  continueOnError: false,
})

const definition = (trigger) => ({
  trigger,
  inputs: [],
  steps: [step()],
  resultFormat: 'markdown',
  deliveries: [],
  limits: { maxSteps: 20, maxToolCalls: 20, maxOutputChars: 1000, maxTokens: null },
})

const daily = (cron = '0 9 * * *', timezone = 'America/Sao_Paulo') => ({ type: 'schedule', timezone, cron })

// An automation whose draft AND published version are the same schedule.
async function seedPublished(trigger = daily(), over = {}) {
  const id = new ObjectId()
  await automations().insertOne({
    _id: id,
    ownerId: OWNER,
    buildingId: new ObjectId(),
    floorId: new ObjectId(),
    name: 'rotina',
    description: '',
    status: 'active',
    trigger,
    draftDefinition: definition(trigger),
    publishedTrigger: trigger,
    currentVersion: 1,
    lastPublishedVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  })
  await versions().insertOne({
    _id: new ObjectId(),
    ownerId: OWNER,
    automationId: id,
    version: 1,
    definition: definition(trigger),
    definitionHash: 'seed-hash',
    createdAt: new Date(),
    createdBy: OWNER,
  })
  return id
}

// Replace the DRAFT only — exactly what the editor does before Publish.
const editDraft = (id, trigger) => automations().updateOne({ _id: id }, { $set: { trigger, draftDefinition: definition(trigger) } })

beforeEach(async () => {
  await automations().deleteMany({ ownerId: OWNER })
  await versions().deleteMany({ ownerId: OWNER })
  await runs().deleteMany({ ownerId: OWNER })
})

test('an unpublished draft never schedules anything', async () => {
  await automations().insertOne({
    _id: new ObjectId(),
    ownerId: OWNER,
    buildingId: new ObjectId(),
    floorId: new ObjectId(),
    name: 'rascunho',
    description: '',
    // Active with a schedule in the DRAFT, but nothing was ever published.
    status: 'active',
    trigger: daily(),
    draftDefinition: definition(daily()),
    currentVersion: 0,
    lastPublishedVersion: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  const { planned } = await planSchedules(new Date('2026-08-15T01:00:00Z'))
  assert.equal(planned, 0, 'a draft is not a schedule')
})

test('editing the cron in the draft changes nothing until it is published', async () => {
  const id = await seedPublished(daily('0 9 * * *'))
  await planSchedules(new Date('2026-08-15T01:00:00Z'))
  assert.equal((await automations().findOne({ _id: id })).nextRunAt.toISOString(), '2026-08-15T12:00:00.000Z')

  // The user types a new time and does NOT publish.
  await editDraft(id, daily('0 18 * * *'))
  await planSchedules(new Date('2026-08-15T02:00:00Z'))

  const doc = await automations().findOne({ _id: id })
  assert.equal(doc.nextRunAt.toISOString(), '2026-08-15T12:00:00.000Z', 'the published 09:00 still owns the schedule')
})

test('publishing a new time drops the old fire — the old hour never goes off once more', async () => {
  const id = await seedPublished(daily('0 9 * * *'))
  await planSchedules(new Date('2026-08-15T01:00:00Z'))
  const oldInstant = (await automations().findOne({ _id: id })).nextRunAt
  assert.equal(oldInstant.toISOString(), '2026-08-15T12:00:00.000Z')

  await editDraft(id, daily('0 18 * * *'))
  const version = await publishAutomation(OWNER, id, OWNER)
  assert.equal(version.version, 2)

  const afterPublish = await automations().findOne({ _id: id })
  assert.equal(afterPublish.nextRunAt, null, 'the pending fire is dropped, not kept')
  assert.equal(afterPublish.publishedTrigger.cron, '0 18 * * *')

  // The moment the OLD schedule would have fired: nothing happens.
  const { fired } = await runDueSchedules(new Date('2026-08-15T12:00:30Z'))
  assert.equal(fired, 0, 'the replaced hour must never fire')
  assert.equal(await runs().countDocuments({ ownerId: OWNER }), 0)

  // And the new one is planned on the next tick.
  await planSchedules(new Date('2026-08-15T12:00:30Z'))
  assert.equal((await automations().findOne({ _id: id })).nextRunAt.toISOString(), '2026-08-15T21:00:00.000Z')
})

test('publishing a timezone change re-plans the same clock time', async () => {
  const id = await seedPublished(daily('0 9 * * *', 'America/Sao_Paulo'))
  await planSchedules(new Date('2026-08-15T01:00:00Z'))

  await editDraft(id, daily('0 9 * * *', 'Europe/Lisbon'))
  await publishAutomation(OWNER, id, OWNER)
  assert.equal((await automations().findOne({ _id: id })).nextRunAt, null)

  await planSchedules(new Date('2026-08-15T01:00:00Z'))
  assert.equal(
    (await automations().findOne({ _id: id })).nextRunAt.toISOString(),
    '2026-08-15T08:00:00.000Z',
    '09:00 in Lisbon, not in São Paulo',
  )
})

test('publishing a switch to manual stops the schedule', async () => {
  const id = await seedPublished()
  await planSchedules(new Date('2026-08-15T01:00:00Z'))

  await editDraft(id, { type: 'manual' })
  await publishAutomation(OWNER, id, OWNER)
  await planSchedules(new Date('2026-08-15T01:00:00Z'))

  const doc = await automations().findOne({ _id: id })
  assert.equal(doc.nextRunAt, null)
  assert.deepEqual(await runDueSchedules(new Date('2026-08-15T13:00:00Z')), { fired: 0, skipped: 0 })
})

test('re-publishing an unchanged definition keeps the pending fire', async () => {
  const id = await seedPublished()
  await planSchedules(new Date('2026-08-15T01:00:00Z'))
  const instant = (await automations().findOne({ _id: id })).nextRunAt

  // Same draft, published again: idempotent, and the plan must survive it.
  await publishAutomation(OWNER, id, OWNER)
  assert.equal((await automations().findOne({ _id: id })).nextRunAt.getTime(), instant.getTime())
})

test('a failed run creation puts the fire instant back instead of losing it', async () => {
  const id = await seedPublished()
  await planSchedules(new Date('2026-08-15T01:00:00Z'))
  const instant = (await automations().findOne({ _id: id })).nextRunAt

  const now = new Date('2026-08-15T12:00:30Z')
  let attempts = 0
  const failing = {
    createRun: async () => {
      attempts++
      throw new Error('mongo indisponível')
    },
  }
  const outcome = await runDueSchedules(now, failing)
  assert.equal(outcome.fired, 0)
  assert.equal(attempts, 1, 'and it does not spin retrying the same broken automation')
  assert.equal(await runs().countDocuments({ ownerId: OWNER }), 0)

  const kept = await automations().findOne({ _id: id })
  assert.equal(kept.nextRunAt.getTime(), instant.getTime(), 'the trigger is preserved for the next tick')

  // The next tick, with a working database, still fires it.
  const { fired } = await runDueSchedules(now)
  assert.equal(fired, 1)
  assert.equal(await runs().countDocuments({ ownerId: OWNER }), 1)
})

test('a failure on one automation does not hold up the others', async () => {
  const broken = await seedPublished()
  const healthy = await seedPublished()
  await planSchedules(new Date('2026-08-15T01:00:00Z'))

  const deps = {
    createRun: async (ownerId, automationId, input) => {
      if (automationId.equals(broken)) throw new Error('essa falhou')
      const { createRun } = await import('../dist/automations/runService.js')
      return createRun(ownerId, automationId, input)
    },
  }
  const { fired } = await runDueSchedules(new Date('2026-08-15T12:00:30Z'), deps)
  assert.equal(fired, 1, 'the healthy one still fired')
  assert.equal(await runs().countDocuments({ ownerId: OWNER, automationId: healthy }), 1)
  assert.ok((await automations().findOne({ _id: broken })).nextRunAt, 'the broken one kept its instant')
})

test('several API instances ticking at once produce exactly one run per instant', async () => {
  const id = await seedPublished()
  await planSchedules(new Date('2026-08-15T01:00:00Z'))
  const now = new Date('2026-08-15T12:00:30Z')

  // Four replicas waking together, with a slow creation so the window is real.
  const { createRun } = await import('../dist/automations/runService.js')
  const slow = {
    createRun: async (...args) => {
      await new Promise((r) => setTimeout(r, 25))
      return createRun(...args)
    },
  }
  const results = await Promise.all([1, 2, 3, 4].map(() => runDueSchedules(now, slow)))

  assert.equal(
    results.reduce((sum, r) => sum + r.fired, 0),
    1,
    'exactly one replica may fire a given instant',
  )
  assert.equal(await runs().countDocuments({ ownerId: OWNER, automationId: id }), 1)
})

test('tickScheduler plans then fires, using the published trigger', async () => {
  const id = await seedPublished()
  const first = await tickScheduler(new Date('2026-08-15T01:00:00Z'))
  assert.equal(first.planned, 1)
  assert.equal(first.fired, 0)

  const second = await tickScheduler(new Date('2026-08-15T12:00:30Z'))
  assert.equal(second.fired, 1)
  assert.equal(await runs().countDocuments({ ownerId: OWNER, automationId: id }), 1)
})

test('an automation published before publishedTrigger existed is healed, not stranded', async () => {
  const id = await seedPublished()
  // Simulate the old shape: only the draft carried the trigger.
  await automations().updateOne({ _id: id }, { $unset: { publishedTrigger: '' } })

  const { planned } = await planSchedules(new Date('2026-08-15T01:00:00Z'))
  assert.equal(planned, 1, 'the backfill stamps the published trigger and it plans normally')
  assert.equal((await automations().findOne({ _id: id })).publishedTrigger.cron, '0 9 * * *')
})

test('a scheduled fire carries a stable correlation, derived only from ids and time', async () => {
  const id = await seedPublished()
  await planSchedules(new Date('2026-08-15T01:00:00Z'))
  const instant = (await automations().findOne({ _id: id })).nextRunAt

  await runDueSchedules(new Date('2026-08-15T12:00:30Z'))
  const [run] = await runs().find({ ownerId: OWNER, automationId: id }).toArray()

  // Stable for THIS fire: the same automation and the same instant always produce it.
  assert.equal(run.requestId, `schedule:${id.toString()}:${instant.getTime()}`)
  // And it is derived from what we already own — nothing about the definition.
  assert.ok(!run.requestId.includes(' '))
})
