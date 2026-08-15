import type { ObjectId } from 'mongodb'
import type { AutomationDefinition, TriggerType } from './types.js'

// Execution records (plan §8.8–§8.10). MongoDB is the source of truth; BullMQ only
// coordinates jobs. Snapshots make a run reproducible from the exact definition.
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancel_requested' | 'canceled'

export interface SafeRunError {
  kind: string
  message: string
}

export interface AutomationRun {
  _id: ObjectId
  ownerId: string
  buildingId: ObjectId
  floorId: ObjectId
  automationId: ObjectId
  automationVersion: number
  definitionHash: string
  definitionSnapshot: AutomationDefinition
  triggerType: TriggerType
  triggerPayload: unknown
  idempotencyKey: string
  // Correlates this execution with the request (or the fire) that started it, so a
  // run in the log can be traced back to the change beside it. Safe by construction:
  // a request id for manual runs, and a derived, payload-free string for the
  // scheduler and the webhook receiver. Optional — runs created before it exist.
  requestId?: string | null
  status: RunStatus
  currentStepId: string | null
  queuedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  cancelRequestedAt: Date | null
  usage: { inputTokens: number; outputTokens: number }
  finalOutput: string
  error: SafeRunError | null
  // --- queue bookkeeping (the runs collection IS the queue) --------------------
  // A worker claims a queued run by stamping these atomically. `leaseUntil` is what
  // makes a crash recoverable: once it passes, another worker may claim the run
  // again. Absent on runs written before the Redis queue was removed.
  claimedBy?: string | null
  claimedAt?: Date | null
  leaseUntil?: Date | null
  // How many times this run was claimed. A run that keeps dying is parked instead
  // of being retried forever.
  claims?: number
}

export interface StepRun {
  _id: ObjectId
  ownerId: string
  runId: ObjectId
  stepId: string
  stepType: string
  attempt: number
  status: string
  outputPreview: unknown
  artifactIds: ObjectId[]
  startedAt: Date | null
  finishedAt: Date | null
  error: SafeRunError | null
}

export interface Artifact {
  _id: ObjectId
  ownerId: string
  buildingId: ObjectId
  floorId: ObjectId
  runId: ObjectId
  name: string
  kind: 'markdown' | 'text' | 'json'
  mimeType: string
  sizeBytes: number
  content?: string
  createdAt: Date
}

// Truncate + sanitize a preview so large/secret payloads never land in a run doc.
export function preview(value: unknown, max = 2000): unknown {
  if (typeof value === 'string') return value.length > max ? value.slice(0, max) + '…' : value
  try {
    const s = JSON.stringify(value)
    return s.length > max ? s.slice(0, max) + '…' : value
  } catch {
    return '[unserializable]'
  }
}
