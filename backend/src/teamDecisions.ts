import { ObjectId } from 'mongodb'
import { db } from './db.js'

// Observability: one row per orchestration decision so owners can see which
// specialists the supervisor consulted (and when it asked to clarify).
export interface TeamDecision {
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

const teamDecisions = db.collection<TeamDecision>('team_decisions')

export async function logTeamDecision(entry: {
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
  await teamDecisions.insertOne({ ...entry, createdAt: new Date() } as TeamDecision)
}

// Owner-facing observability: every orchestration decision in a conversation,
// oldest first, so the owner can see how the supervisor/pipeline reasoned.
export function listTeamDecisionsForConversation(ownerId: string, widgetId: ObjectId, conversationId: string) {
  return teamDecisions.find({ ownerId, widgetId, conversationId }).sort({ createdAt: 1 }).toArray()
}

export interface TeamDecisionAggregate {
  totals: { _id: ObjectId; decisions: number; clarify: number; moved: number }[]
  // Times each specialist/stage handled a turn, per team.
  specialists: { _id: { teamId: ObjectId; name: string }; count: number }[]
  // Times each stage was left (was the source of a pipeline move), per team.
  fromStages: { _id: { teamId: ObjectId; name: string }; count: number }[]
}

// Aggregate every orchestration decision for an owner into per-team rollups the
// dashboard turns into analytics (top specialists, clarify rate, stage activity).
export async function aggregateTeamDecisions(ownerId: string): Promise<TeamDecisionAggregate> {
  const [totals, specialists, fromStages] = await Promise.all([
    teamDecisions
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
    teamDecisions
      .aggregate([
        { $match: { ownerId } },
        { $unwind: '$specialists' },
        { $group: { _id: { teamId: '$teamId', name: '$specialists' }, count: { $sum: 1 } } },
      ])
      .toArray(),
    teamDecisions
      .aggregate([
        { $match: { ownerId, fromStage: { $type: 'string' } } },
        { $group: { _id: { teamId: '$teamId', name: '$fromStage' }, count: { $sum: 1 } } },
      ])
      .toArray(),
  ])
  return {
    totals: totals as TeamDecisionAggregate['totals'],
    specialists: specialists as TeamDecisionAggregate['specialists'],
    fromStages: fromStages as TeamDecisionAggregate['fromStages'],
  }
}
