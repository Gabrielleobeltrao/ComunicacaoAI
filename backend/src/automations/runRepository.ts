import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import type { Artifact, AutomationRun, RunStatus, StepRun } from './runTypes.js'

const runs = db.collection<AutomationRun>('automation_runs')
const stepRuns = db.collection<StepRun>('step_runs')
const artifacts = db.collection<Artifact>('artifacts')

export async function ensureRunIndexes(): Promise<void> {
  await runs.createIndex({ ownerId: 1, idempotencyKey: 1 }, { unique: true })
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
