import { ObjectId } from 'mongodb'
import { db } from './db.js'

// Observability: one row per orchestration decision so owners can see which
// specialists the supervisor consulted (and when it asked to clarify).
export interface SectorDecision {
  _id: ObjectId
  ownerId: string
  teamId: ObjectId
  widgetId: ObjectId | null
  conversationId: string | null
  // Adaptive: the consulted specialists. Pipeline: the single active stage.
  specialists: string[]
  clarify: boolean
  // Pipeline observability (absent on adaptive decisions).
  mode?: 'adaptive' | 'pipeline'
  advanced?: boolean
  // The stage the flow moved away from this turn (null when it stayed put).
  // Lets the UI render skip/branch/back as "fromStage → stage", not just advance.
  fromStage?: string | null
  createdAt: Date
}

const sectorDecisions = db.collection<SectorDecision>('sector_decisions')

export async function logSectorDecision(entry: {
  ownerId: string
  teamId: ObjectId
  widgetId: ObjectId | null
  conversationId: string | null
  specialists: string[]
  clarify: boolean
  mode?: 'adaptive' | 'pipeline'
  advanced?: boolean
  fromStage?: string | null
}) {
  await sectorDecisions.insertOne({ ...entry, createdAt: new Date() } as SectorDecision)
}

// Owner-facing observability: every orchestration decision in a conversation,
// oldest first, so the owner can see how the supervisor/pipeline reasoned.
export function listSectorDecisionsForConversation(ownerId: string, widgetId: ObjectId, conversationId: string) {
  return sectorDecisions.find({ ownerId, widgetId, conversationId }).sort({ createdAt: 1 }).toArray()
}

export interface SectorDecisionAggregate {
  totals: { _id: ObjectId; decisions: number; clarify: number; moved: number }[]
  // Times each specialist/stage handled a turn, per team.
  specialists: { _id: { teamId: ObjectId; name: string }; count: number }[]
  // Times each stage was left (was the source of a pipeline move), per team.
  fromStages: { _id: { teamId: ObjectId; name: string }; count: number }[]
}

// Aggregate every orchestration decision for an owner into per-team rollups the
// dashboard turns into analytics (top specialists, clarify rate, stage activity).
export async function aggregateSectorDecisions(ownerId: string): Promise<SectorDecisionAggregate> {
  const [totals, specialists, fromStages] = await Promise.all([
    sectorDecisions
      .aggregate([
        { $match: { ownerId } },
        {
          $group: {
            _id: '$teamId',
            decisions: { $sum: 1 },
            clarify: { $sum: { $cond: ['$clarify', 1, 0] } },
            moved: { $sum: { $cond: ['$advanced', 1, 0] } },
          },
        },
      ])
      .toArray(),
    sectorDecisions
      .aggregate([
        { $match: { ownerId } },
        { $unwind: '$specialists' },
        { $group: { _id: { teamId: '$teamId', name: '$specialists' }, count: { $sum: 1 } } },
      ])
      .toArray(),
    sectorDecisions
      .aggregate([
        { $match: { ownerId, fromStage: { $type: 'string' } } },
        { $group: { _id: { teamId: '$teamId', name: '$fromStage' }, count: { $sum: 1 } } },
      ])
      .toArray(),
  ])
  return {
    totals: totals as SectorDecisionAggregate['totals'],
    specialists: specialists as SectorDecisionAggregate['specialists'],
    fromStages: fromStages as SectorDecisionAggregate['fromStages'],
  }
}
