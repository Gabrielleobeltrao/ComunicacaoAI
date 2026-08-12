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
export function getRunQueue(): Queue {
  if (!queue) queue = new Queue(RUN_QUEUE, { connection: createConnection() })
  return queue
}

// Idempotent enqueue: jobId = idempotencyKey, so a duplicate trigger (webhook
// replay, scheduler re-fire) reuses the same job instead of duplicating work.
export async function enqueueRun(idempotencyKey: string, runId: string): Promise<void> {
  await getRunQueue().add('run', { runId }, { jobId: idempotencyKey, removeOnComplete: 1000, removeOnFail: 5000 })
}
