import type { ObjectId } from 'mongodb'
import { db } from '../db.js'

// Operational metrics for a floor (plan §16). Kept separate from conversational
// metrics — runs and conversations are never summed as one unit.
export interface FloorMetrics {
  automationsActive: number
  runsToday: number
  running: number
  failures24h: number
  succeeded24h: number
  successRate: number | null // over the last 24h, null when no finished runs
  recentArtifacts: number
}

export async function floorMetrics(ownerId: string, floorId: ObjectId): Promise<FloorMetrics> {
  const runs = db.collection('automation_runs')
  const automations = db.collection('automations')
  const artifacts = db.collection('artifacts')
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000)
  const scope = { ownerId, floorId }

  const [automationsActive, runsToday, running, failures24h, succeeded24h, recentArtifacts] = await Promise.all([
    automations.countDocuments({ ...scope, status: 'active' }),
    runs.countDocuments({ ...scope, queuedAt: { $gte: dayAgo } }),
    runs.countDocuments({ ...scope, status: { $in: ['queued', 'running'] } }),
    runs.countDocuments({ ...scope, status: 'failed', finishedAt: { $gte: dayAgo } }),
    runs.countDocuments({ ...scope, status: 'succeeded', finishedAt: { $gte: dayAgo } }),
    artifacts.countDocuments({ ...scope, createdAt: { $gte: dayAgo } }),
  ])
  const finished = succeeded24h + failures24h
  return {
    automationsActive,
    runsToday,
    running,
    failures24h,
    succeeded24h,
    successRate: finished > 0 ? succeeded24h / finished : null,
    recentArtifacts,
  }
}
