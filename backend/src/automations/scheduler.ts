import { Queue } from 'bullmq'
import { db } from '../db.js'
import { createConnection } from './queue.js'
import type { Redis } from 'ioredis'

// Scheduler reconciliation (plan §10.3). The desired set lives in Mongo (active
// automations with a schedule trigger); a reconciler mirrors it onto BullMQ Job
// Schedulers (one per automation, keyed by its id). BullMQ owns cron + timezone
// (DST handled by the tz option). Recurrence is never computed from a browser.
export const SCHEDULE_QUEUE = 'automation-schedules'

let queue: Queue | null = null
let connection: Redis | null = null
export function getScheduleQueue(): Queue {
  if (!queue) {
    connection = createConnection()
    queue = new Queue(SCHEDULE_QUEUE, { connection })
  }
  return queue
}

// See closeRunQueue: the connection is ours to quit, not BullMQ's.
export async function closeScheduleQueue(): Promise<void> {
  const q = queue
  const c = connection
  queue = null
  connection = null
  if (q) await q.close().catch(() => undefined)
  if (c) await c.quit().catch(() => c.disconnect())
}

interface DesiredSchedule {
  automationId: string
  ownerId: string
  cron: string
  tz: string
}

async function desiredSchedules(): Promise<DesiredSchedule[]> {
  const docs = await db
    .collection('automations')
    .find({ status: 'active', 'trigger.type': 'schedule' })
    .toArray()
  const out: DesiredSchedule[] = []
  for (const a of docs) {
    const trigger = a.trigger as { cron?: unknown; timezone?: unknown } | undefined
    if (typeof trigger?.cron === 'string' && trigger.cron && typeof trigger?.timezone === 'string' && trigger.timezone) {
      out.push({ automationId: a._id.toString(), ownerId: String(a.ownerId), cron: trigger.cron, tz: trigger.timezone })
    }
  }
  return out
}

// Add schedulers that should exist, remove ones that shouldn't. Stable id per
// automation so activate → pause → activate never duplicates a schedule.
export async function reconcileSchedules(): Promise<{ added: number; removed: number; total: number }> {
  const q = getScheduleQueue()
  const desired = await desiredSchedules()
  const desiredById = new Map(desired.map((d) => [d.automationId, d]))

  const existing = await q.getJobSchedulers()
  const existingKeys = new Set(existing.map((s) => s.key))

  let removed = 0
  for (const sched of existing) {
    if (!desiredById.has(sched.key)) {
      await q.removeJobScheduler(sched.key)
      removed++
    }
  }

  let added = 0
  for (const d of desired) {
    if (existingKeys.has(d.automationId)) continue
    await q.upsertJobScheduler(
      d.automationId,
      { pattern: d.cron, tz: d.tz },
      { name: 'trigger', data: { automationId: d.automationId, ownerId: d.ownerId } },
    )
    added++
  }
  return { added, removed, total: desired.length }
}
