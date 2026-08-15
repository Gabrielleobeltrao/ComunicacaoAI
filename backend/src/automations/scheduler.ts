// Scheduler — MongoDB only. Each active schedule automation carries `nextRunAt`;
// a loop wakes up, takes the ones that are due, creates their run and advances the
// field. That replaces BullMQ's Job Schedulers (and the Redis they needed).
//
// What it schedules is the LAST PUBLISHED trigger (`publishedTrigger`), never the
// draft: a half-edited cron sitting in the editor must not fire anything.
//
// The properties that matter survive intact:
//   - one run per fire instant, even with several API replicas, because the
//     idempotency key is `${automationId}:${fireInstant}` and the runs collection
//     has a unique index on it;
//   - a fire instant is only given up once its run exists — if creation fails the
//     instant is put back, so the trigger is retried instead of lost;
//   - pausing/archiving stops the schedule, and reactivating never duplicates it.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { createRun } from './runService.js'
import { findVersion } from './repository.js'
import { catchUp, nextFireAt } from './scheduleClock.js'

interface ScheduleDoc {
  _id: ObjectId
  ownerId: string
  status: string
  lastPublishedVersion?: number | null
  // The trigger of the last published version — the only one that may fire.
  publishedTrigger?: { type?: string; cron?: string; timezone?: string } | null
  nextRunAt?: Date | null
}

// Only the piece of createRun the scheduler needs, so a test can inject a failing
// one and prove the fire instant is not lost.
export interface SchedulerDeps {
  createRun: (
    ownerId: string,
    automationId: ObjectId,
    input: { triggerType: 'schedule'; idempotencyKey: string; requestId?: string | null },
  ) => Promise<{ created: boolean }>
}
const defaultDeps: SchedulerDeps = { createRun }

const automations = db.collection('automations')

export async function ensureSchedulerIndexes(): Promise<void> {
  // The due query.
  await automations.createIndex({ status: 1, 'publishedTrigger.type': 1, nextRunAt: 1 })
}

// Automations published before `publishedTrigger` existed only carry the trigger on
// the (mutable) draft. Stamp the published one once so the scheduler never has to
// read a draft. Idempotent, and a no-op after the first pass.
async function backfillPublishedTriggers(): Promise<void> {
  const stale = await automations
    .find<ScheduleDoc>({ status: 'active', lastPublishedVersion: { $ne: null }, publishedTrigger: { $exists: false } })
    .limit(200)
    .toArray()
  for (const a of stale) {
    const version = await findVersion(a.ownerId, a._id, a.lastPublishedVersion as number)
    // null (not undefined) so this document is never re-scanned, even if the
    // version row is missing.
    await automations.updateOne({ _id: a._id }, { $set: { publishedTrigger: version?.definition?.trigger ?? null } })
  }
}

// Give a newly active (or newly published) schedule its first fire instant, and
// clear it from anything that must not fire. Idempotent: safe on every tick.
export async function planSchedules(now = new Date()): Promise<{ planned: number; cleared: number }> {
  await backfillPublishedTriggers()

  let planned = 0
  // Active schedules with no plan yet — including one whose publish just dropped
  // `nextRunAt` because the cron or timezone changed.
  const unplanned = await automations
    .find<ScheduleDoc>({ status: 'active', 'publishedTrigger.type': 'schedule', $or: [{ nextRunAt: null }, { nextRunAt: { $exists: false } }] })
    .toArray()
  for (const a of unplanned) {
    const next = nextFireAt(a.publishedTrigger?.cron ?? '', a.publishedTrigger?.timezone ?? '', now)
    if (!next) continue // malformed schedule: left alone, never crashes the loop
    await automations.updateOne({ _id: a._id }, { $set: { nextRunAt: next } })
    planned++
  }
  // Anything not active — or whose PUBLISHED trigger is not a schedule (a draft
  // that changed type, or a version that was never published) — must not carry a
  // pending fire.
  const cleared = await automations.updateMany(
    { nextRunAt: { $ne: null }, $or: [{ status: { $ne: 'active' } }, { 'publishedTrigger.type': { $ne: 'schedule' } }] },
    { $set: { nextRunAt: null } },
  )
  return { planned, cleared: cleared.modifiedCount }
}

// Fire everything that is due. Returns what happened, for the log.
export async function runDueSchedules(now = new Date(), deps: SchedulerDeps = defaultDeps): Promise<{ fired: number; skipped: number }> {
  let fired = 0
  let skipped = 0
  // Instants we put back after a failed creation: skipped for the rest of THIS
  // tick, so a broken automation cannot spin the loop, and retried on the next one.
  const restored: ObjectId[] = []

  for (;;) {
    // Claim ONE due schedule at a time by moving its nextRunAt forward in the same
    // atomic update: a second replica reading concurrently sees the new value and
    // cannot fire the same instant. The idempotency key is the backstop.
    const due = await automations.findOne<ScheduleDoc>(
      {
        status: 'active',
        'publishedTrigger.type': 'schedule',
        nextRunAt: { $ne: null, $lte: now },
        ...(restored.length ? { _id: { $nin: restored } } : {}),
      },
      { sort: { nextRunAt: 1 } },
    )
    if (!due || !due.nextRunAt) break

    const cron = due.publishedTrigger?.cron ?? ''
    const tz = due.publishedTrigger?.timezone ?? ''
    const fireInstant = due.nextRunAt
    const { next, skipped: missed } = catchUp(cron, tz, fireInstant, now)

    const advanced = await automations.updateOne(
      // The guard: only the replica that still sees THIS instant advances it.
      { _id: due._id, nextRunAt: fireInstant },
      { $set: { nextRunAt: next ?? null } },
    )
    if (advanced.modifiedCount !== 1) continue // another replica got there first

    try {
      // Same key shape the BullMQ scheduler used, so a redelivery — or a replica
      // that raced past the guard — still yields exactly one run.
      const { created } = await deps.createRun(due.ownerId, due._id, {
        triggerType: 'schedule',
        idempotencyKey: `${due._id.toString()}:${fireInstant.getTime()}`,
        // Stable for THIS fire instant: a redelivery correlates to the same string,
        // and it is derived only from ids and a timestamp.
        requestId: `schedule:${due._id.toString()}:${fireInstant.getTime()}`,
      })
      if (created) fired++
      skipped += missed
    } catch (error) {
      // The trigger is only spent once its run exists. Put the instant back —
      // guarded, so a concurrent publish that re-planned meanwhile wins — and let
      // the next tick try again. One broken automation never stops the others.
      console.error(`schedule ${due._id.toString()} failed to create a run:`, error instanceof Error ? error.message : error)
      await automations
        .updateOne({ _id: due._id, nextRunAt: next ?? null }, { $set: { nextRunAt: fireInstant } })
        .catch((restoreError) => console.error(`schedule ${due._id.toString()} could not restore its fire instant:`, restoreError instanceof Error ? restoreError.message : restoreError))
      restored.push(due._id)
    }
  }
  return { fired, skipped }
}

// One tick: plan what is unplanned, then fire what is due.
export async function tickScheduler(now = new Date(), deps: SchedulerDeps = defaultDeps): Promise<{ planned: number; cleared: number; fired: number; skipped: number }> {
  const { planned, cleared } = await planSchedules(now)
  const { fired, skipped } = await runDueSchedules(now, deps)
  return { planned, cleared, fired, skipped }
}
