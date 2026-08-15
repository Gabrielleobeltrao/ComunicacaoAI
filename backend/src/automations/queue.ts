import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { config } from '../config.js'

// BullMQ coordinates automation-run jobs; MongoDB stays the source of truth.
// The connection is lazy so importing this module never touches Redis — the API
// only connects when a run is actually enqueued, and unit tests never do.
export const RUN_QUEUE = 'automation-runs'

export function createConnection(): Redis {
  if (!config.redisUrl) throw new Error('REDIS_URL is not configured')
  // maxRetriesPerRequest:null is required by BullMQ for blocking commands.
  return new Redis(config.redisUrl, { maxRetriesPerRequest: null })
}

let queue: Queue | null = null
// BullMQ does NOT own a connection instance handed to it, so closing the queue
// leaves the socket open and the process alive. We keep the reference and quit it.
let connection: Redis | null = null
export function getRunQueue(): Queue {
  if (!queue) {
    connection = createConnection()
    queue = new Queue(RUN_QUEUE, { connection })
  }
  return queue
}

// Close the queue, quit its connection and drop the singletons, so nothing holds the
// event loop open. Needed by anything that must exit cleanly — tests and graceful
// shutdown alike. Safe to call when nothing was ever opened.
export async function closeRunQueue(): Promise<void> {
  const q = queue
  const c = connection
  queue = null
  connection = null
  if (q) await q.close().catch(() => undefined)
  if (c) await c.quit().catch(() => c.disconnect())
}

// BullMQ refuses a custom job id containing ':' ("Custom Id cannot contain :"),
// and the scheduler's key is `${automationId}:${fireTimestamp}` — so enqueuing a
// scheduled run used to THROW after the run row had already been inserted, leaving
// it stuck in 'queued' forever while the schedule job failed. Percent-encoding is
// a bijection, so the id stays deterministic (same key -> same job) and no two
// distinct keys can collide into one.
export const jobIdFor = (idempotencyKey: string): string => encodeURIComponent(idempotencyKey)

// Idempotent enqueue: jobId derives from the idempotencyKey, so a duplicate trigger
// (webhook replay, scheduler re-fire, a second worker replica) reuses the same job
// instead of duplicating work.
export async function enqueueRun(idempotencyKey: string, runId: string): Promise<void> {
  await getRunQueue().add('run', { runId }, { jobId: jobIdFor(idempotencyKey), removeOnComplete: 1000, removeOnFail: 5000 })
}
