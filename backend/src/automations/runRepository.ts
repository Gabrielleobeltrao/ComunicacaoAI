import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import type { Artifact, AutomationRun, RunStatus, StepRun } from './runTypes.js'

const runs = db.collection<AutomationRun>('automation_runs')
const stepRuns = db.collection<StepRun>('step_runs')
const artifacts = db.collection<Artifact>('artifacts')

export async function ensureRunIndexes(): Promise<void> {
  await runs.createIndex({ ownerId: 1, idempotencyKey: 1 }, { unique: true })
  // The claim query: queued runs oldest-first, plus expired leases to reclaim.
  await runs.createIndex({ status: 1, leaseUntil: 1, queuedAt: 1 })
  await runs.createIndex({ ownerId: 1, floorId: 1, queuedAt: -1 })
  await runs.createIndex({ ownerId: 1, automationId: 1, queuedAt: -1 })
  await stepRuns.createIndex({ runId: 1, stepId: 1, attempt: 1 })
  await artifacts.createIndex({ ownerId: 1, floorId: 1, createdAt: -1 })
  await artifacts.createIndex({ runId: 1 })
}

// Insert honoring idempotency: a duplicate (ownerId, idempotencyKey) returns the
// existing run instead of creating a second one.
export async function insertRunIdempotent(run: AutomationRun): Promise<{ run: AutomationRun; created: boolean }> {
  try {
    await runs.insertOne(run)
    return { run, created: true }
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const existing = await runs.findOne({ ownerId: run.ownerId, idempotencyKey: run.idempotencyKey })
      if (existing) return { run: existing, created: false }
    }
    throw error
  }
}

// How long a claim is held before another worker may take the run over. Long
// enough for a slow multi-step run, short enough that a crashed process does not
// strand work for the rest of the day.
export const RUN_LEASE_MS = Number(process.env.RUN_LEASE_MS ?? 10 * 60_000)
// A run claimed this many times without finishing is parked as failed instead of
// cycling forever (a poison job must not block the queue).
export const MAX_RUN_CLAIMS = Number(process.env.MAX_RUN_CLAIMS ?? 3)

// Atomically take ONE run off the queue. This is the whole queue: a single
// findOneAndUpdate means two workers — or two API replicas — can never get the same
// run, without any external broker.
//
// It picks up two kinds of work:
//   - 'queued'  : never started;
//   - 'running' : claimed by a process that died, once its lease expired.
export async function claimNextRun(workerId: string, now = new Date()): Promise<AutomationRun | null> {
  const claimed = await runs.findOneAndUpdate(
    {
      $or: [
        { status: 'queued', $or: [{ leaseUntil: null }, { leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }] },
        // Abandoned: still marked running but nobody renewed the lease.
        { status: 'running', leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: { status: 'running', claimedBy: workerId, claimedAt: now, leaseUntil: new Date(now.getTime() + RUN_LEASE_MS) },
      $inc: { claims: 1 },
    },
    { sort: { queuedAt: 1 }, returnDocument: 'after' },
  )
  if (!claimed) return null

  // Poison guard: give up loudly instead of reclaiming the same run forever.
  if ((claimed.claims ?? 1) > MAX_RUN_CLAIMS) {
    await runs.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: 'failed',
          finishedAt: now,
          leaseUntil: null,
          error: { kind: 'error', message: `run abandonado após ${MAX_RUN_CLAIMS} tentativas` },
        },
      },
    )
    return null
  }
  return claimed
}

// Keep a long run's claim alive while it is genuinely progressing.
export async function renewLease(id: ObjectId, workerId: string, now = new Date()): Promise<boolean> {
  const res = await runs.updateOne(
    { _id: id, claimedBy: workerId, status: 'running' },
    { $set: { leaseUntil: new Date(now.getTime() + RUN_LEASE_MS) } },
  )
  return res.matchedCount === 1
}

// Release the claim when the run reaches a terminal state, so nothing reclaims it.
export async function releaseRun(id: ObjectId): Promise<void> {
  await runs.updateOne({ _id: id }, { $set: { leaseUntil: null, claimedBy: null } })
}

// The processor threw where it should not have. Without this the run would stay
// 'running' with no lease — invisible to the claim query and stuck forever.
//
// The outcome is deliberate, not silent: back to 'queued' while it still has claims
// left (a transient fault deserves another go), 'failed' once it has burned them
// (a poison run must not cycle). Either way the error is recorded and the claim is
// dropped. A run that already finished is left exactly as it is.
export async function recoverRun(id: ObjectId, message: string, now = new Date()): Promise<'queued' | 'failed' | 'noop'> {
  const run = await runs.findOne({ _id: id })
  if (!run) return 'noop'
  if (run.status !== 'running' && run.status !== 'cancel_requested') return 'noop'

  const terminal = (run.claims ?? 1) >= MAX_RUN_CLAIMS
  const status: RunStatus = terminal ? 'failed' : 'queued'
  const res = await runs.updateOne(
    { _id: id, status: run.status },
    {
      $set: {
        status,
        leaseUntil: null,
        claimedBy: null,
        error: { kind: 'error', message: message.slice(0, 500) },
        ...(terminal ? { finishedAt: now } : {}),
      },
    },
  )
  return res.modifiedCount === 1 ? status : 'noop'
}

export function findRun(ownerId: string, id: ObjectId): Promise<AutomationRun | null> {
  return runs.findOne({ _id: id, ownerId })
}

export function findRunUnscoped(id: ObjectId): Promise<AutomationRun | null> {
  return runs.findOne({ _id: id })
}

export async function updateRun(id: ObjectId, set: Partial<AutomationRun>): Promise<void> {
  await runs.updateOne({ _id: id }, { $set: set })
}

export async function listRuns(
  ownerId: string,
  q: { floorId?: ObjectId; automationId?: ObjectId; automationIds?: ObjectId[]; status?: string; limit: number; skip: number },
): Promise<{ items: AutomationRun[]; total: number }> {
  const filter: Record<string, unknown> = { ownerId }
  if (q.floorId) filter.floorId = q.floorId
  if (q.automationId) filter.automationId = q.automationId
  else if (q.automationIds) filter.automationId = { $in: q.automationIds }
  if (q.status) filter.status = q.status
  const [items, total] = await Promise.all([
    runs.find(filter).sort({ queuedAt: -1 }).skip(q.skip).limit(q.limit).toArray(),
    runs.countDocuments(filter),
  ])
  return { items, total }
}

export async function requestCancel(ownerId: string, id: ObjectId): Promise<AutomationRun | null> {
  const result = await runs.findOneAndUpdate(
    { _id: id, ownerId, status: { $in: ['queued', 'running'] } },
    { $set: { status: 'cancel_requested' as RunStatus, cancelRequestedAt: new Date() } },
    { returnDocument: 'after' },
  )
  return result ?? null
}

export function insertStepRun(doc: StepRun): Promise<unknown> {
  return stepRuns.insertOne(doc)
}
export function listStepRuns(ownerId: string, runId: ObjectId): Promise<StepRun[]> {
  return stepRuns.find({ ownerId, runId }).sort({ startedAt: 1 }).toArray()
}
export function insertArtifact(doc: Artifact): Promise<unknown> {
  return artifacts.insertOne(doc)
}
export function listArtifacts(ownerId: string, runId: ObjectId): Promise<Artifact[]> {
  return artifacts.find({ ownerId, runId }).sort({ createdAt: 1 }).toArray()
}
