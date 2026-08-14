// Delegation history. Every agent→agent / agent→sector call is recorded here so it
// shows in BOTH the calling agent's and the executed agent's "Histórico" (a record
// is matched by callerAgentId OR targetAgentId). Owner-scoped; never trust ids
// across owners.
import { ObjectId } from 'mongodb'
import { db } from './db.js'

export type DelegationStatus = 'running' | 'succeeded' | 'failed' | 'denied' | 'canceled'

export interface DelegationRecord {
  _id: ObjectId
  ownerId: string
  correlationId: string
  depth: number
  callerAgentId: ObjectId
  targetType: 'agent' | 'sector'
  targetAgentId: ObjectId | null
  targetSectorId: ObjectId | null
  objective: string
  status: DelegationStatus
  denyCode: string | null
  outputPreview: string | null
  error: string | null
  usage: { inputTokens: number; outputTokens: number } | null
  createdAt: Date
  finishedAt: Date | null
}

const col = db.collection<DelegationRecord>('agent_delegations')

export async function ensureDelegationIndexes(): Promise<void> {
  await col.createIndex({ ownerId: 1, callerAgentId: 1, createdAt: -1 })
  await col.createIndex({ ownerId: 1, targetAgentId: 1, createdAt: -1 })
  await col.createIndex({ correlationId: 1 })
}

export interface DelegationStart {
  ownerId: string
  correlationId: string
  depth: number
  callerAgentId: ObjectId
  targetType: 'agent' | 'sector'
  targetAgentId?: ObjectId | null
  targetSectorId?: ObjectId | null
  objective: string
}

export async function startDelegation(start: DelegationStart): Promise<ObjectId> {
  const _id = new ObjectId()
  await col.insertOne({
    _id,
    ownerId: start.ownerId,
    correlationId: start.correlationId,
    depth: start.depth,
    callerAgentId: start.callerAgentId,
    targetType: start.targetType,
    targetAgentId: start.targetAgentId ?? null,
    targetSectorId: start.targetSectorId ?? null,
    objective: start.objective.slice(0, 2000),
    status: 'running',
    denyCode: null,
    outputPreview: null,
    error: null,
    usage: null,
    createdAt: new Date(),
    finishedAt: null,
  })
  return _id
}

export interface DelegationFinish {
  status: DelegationStatus
  denyCode?: string | null
  outputPreview?: string | null
  error?: string | null
  usage?: { inputTokens: number; outputTokens: number } | null
}

export async function finishDelegation(id: ObjectId, patch: DelegationFinish): Promise<void> {
  await col.updateOne(
    { _id: id },
    {
      $set: {
        status: patch.status,
        denyCode: patch.denyCode ?? null,
        outputPreview: patch.outputPreview ?? null,
        error: patch.error ?? null,
        usage: patch.usage ?? null,
        finishedAt: new Date(),
      },
    },
  )
}

// Delegations touching an agent (as caller or as target), newest first.
export async function listDelegationsForAgent(ownerId: string, agentId: ObjectId, limit = 25): Promise<DelegationRecord[]> {
  return col
    .find({ ownerId, $or: [{ callerAgentId: agentId }, { targetAgentId: agentId }] })
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 100))
    .toArray()
}

// How many delegations each agent INITIATED and completed (as caller), for the
// manager/secretary card KPI. One aggregation for the whole roster — no N+1.
export async function succeededDelegationsByCaller(ownerId: string, since?: Date): Promise<Map<string, number>> {
  const match: Record<string, unknown> = { ownerId, status: 'succeeded' }
  if (since) match.createdAt = { $gte: since }
  const rows = await col
    .aggregate<{ _id: ObjectId; count: number }>([{ $match: match }, { $group: { _id: '$callerAgentId', count: { $sum: 1 } } }])
    .toArray()
  return new Map(rows.map((r) => [r._id.toString(), r.count]))
}
