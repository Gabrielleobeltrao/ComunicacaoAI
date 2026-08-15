// Scheduler — MongoDB only. Each active schedule automation carries `nextRunAt`;
// a loop wakes up, takes the ones that are due, creates their run and advances the
// field. That replaces BullMQ's Job Schedulers (and the Redis they needed).
//
// The two properties that matter survive intact:
//   - one run per fire instant, even with several API replicas, because the
//     idempotency key is `${automationId}:${fireInstant}` and the runs collection
//     has a unique index on it;
//   - pausing/archiving stops the schedule, and reactivating never duplicates it.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { createRun } from './runService.js'
import { catchUp, nextFireAt } from './scheduleClock.js'

interface ScheduleDoc {
  _id: ObjectId
  ownerId: string
  status: string
  trigger?: { type?: string; cron?: string; timezone?: string }
  nextRunAt?: Date | null
}

const automations = db.collection('automations')

export async function ensureSchedulerIndexes(): Promise<void> {
  // The due query.
  await automations.createIndex({ status: 1, 'trigger.type': 1, nextRunAt: 1 })
}

// Give a newly active (or newly published) schedule its first fire instant, and
// clear it from anything that must not fire. Idempotent: safe on every tick.
export async function planSchedules(now = new Date()): Promise<{ planned: number; cleared: number }> {
  let planned = 0
  // Active schedules with no plan yet.
  const unplanned = await automations
    .find<ScheduleDoc>({ status: 'active', 'trigger.type': 'schedule', $or: [{ nextRunAt: null }, { nextRunAt: { $exists: false } }] })
    .toArray()
  for (const a of unplanned) {
    const next = nextFireAt(a.trigger?.cron ?? '', a.trigger?.timezone ?? '', now)
    if (!next) continue // malformed schedule: left alone, never crashes the loop
    await automations.updateOne({ _id: a._id }, { $set: { nextRunAt: next } })
    planned++
  }
  // Anything not active must not carry a pending fire.
  const cleared = await automations.updateMany(
    { status: { $ne: 'active' }, nextRunAt: { $ne: null } },
    { $set: { nextRunAt: null } },
  )
  return { planned, cleared: cleared.modifiedCount }
}

// Fire everything that is due. Returns what happened, for the log.
export async function runDueSchedules(now = new Date()): Promise<{ fired: number; skipped: number }> {
  let fired = 0
  let skipped = 0

  for (;;) {
    // Claim ONE due schedule at a time by moving its nextRunAt forward in the same
    // atomic update: a second replica reading concurrently sees the new value and
    // cannot fire the same instant. The idempotency key is the backstop.
    const due = await automations.findOne<ScheduleDoc>(
      { status: 'active', 'trigger.type': 'schedule', nextRunAt: { $ne: null, $lte: now } },
      { sort: { nextRunAt: 1 } },
    )
    if (!due || !due.nextRunAt) break

    const cron = due.trigger?.cron ?? ''
    const tz = due.trigger?.timezone ?? ''
    const fireInstant = due.nextRunAt
    const { next, skipped: missed } = catchUp(cron, tz, fireInstant, now)

    const advanced = await automations.updateOne(
      // The guard: only the replica that still sees THIS instant advances it.
      { _id: due._id, nextRunAt: fireInstant },
      { $set: { nextRunAt: next ?? null } },
    )
    if (advanced.modifiedCount !== 1) continue // another replica got there first

    skipped += missed
    try {
      // Same key shape the BullMQ scheduler used, so a redelivery — or a replica
      // that raced past the guard — still yields exactly one run.
      const { created } = await createRun(due.ownerId, due._id, {
        triggerType: 'schedule',
        idempotencyKey: `${due._id.toString()}:${fireInstant.getTime()}`,
      })
      if (created) fired++
    } catch (error) {
      // One broken automation must never stop the others.
      console.error(`schedule ${due._id.toString()} failed to create a run:`, error instanceof Error ? error.message : error)
    }
  }
  return { fired, skipped }
}

// One tick: plan what is unplanned, then fire what is due.
export async function tickScheduler(now = new Date()): Promise<{ planned: number; cleared: number; fired: number; skipped: number }> {
  const { planned, cleared } = await planSchedules(now)
  const { fired, skipped } = await runDueSchedules(now)
  return { planned, cleared, fired, skipped }
}
