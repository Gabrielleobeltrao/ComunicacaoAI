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
}) {
  await teamDecisions.insertOne({ ...entry, createdAt: new Date() } as TeamDecision)
}

// Owner-facing observability: every orchestration decision in a conversation,
// oldest first, so the owner can see how the supervisor/pipeline reasoned.
export function listTeamDecisionsForConversation(ownerId: string, widgetId: ObjectId, conversationId: string) {
  return teamDecisions.find({ ownerId, widgetId, conversationId }).sort({ createdAt: 1 }).toArray()
}
