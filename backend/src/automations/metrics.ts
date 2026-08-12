import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { ensureDefaultBuilding } from '../building.js'
import { getFloorActivity, listFloors } from '../floors.js'

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

// Aggregated building overview (plan §8.7) — one call, no N+1 from the client.
// Ownership is applied throughout (listFloors/floorMetrics are owner-scoped).
export async function buildingOverview(ownerId: string) {
  const building = await ensureDefaultBuilding(ownerId)
  const floors = await listFloors(ownerId)
  const perFloor = await Promise.all(
    floors.map(async (f) => {
      const [metrics, activity] = await Promise.all([floorMetrics(ownerId, f._id), getFloorActivity(ownerId, f._id)])
      return {
        floor: { id: f._id.toString(), name: f.name, mission: f.mission, color: f.color, icon: f.icon, order: f.order, status: f.status },
        agentCount: activity.agentCount,
        sectorCount: activity.sectorCount,
        automationsActive: metrics.automationsActive,
        runsActive: metrics.running,
        failures24h: metrics.failures24h,
      }
    }),
  )
  const totals = perFloor.reduce(
    (acc, d) => ({
      floors: acc.floors + 1,
      agents: acc.agents + d.agentCount,
      sectors: acc.sectors + d.sectorCount,
      automationsActive: acc.automationsActive + d.automationsActive,
      runsActive: acc.runsActive + d.runsActive,
      failures24h: acc.failures24h + d.failures24h,
    }),
    { floors: 0, agents: 0, sectors: 0, automationsActive: 0, runsActive: 0, failures24h: 0 },
  )
  return {
    building: { id: building._id.toString(), name: building.name, description: building.description },
    totals,
    floors: perFloor,
  }
}

// Coarse per-agent operational state for the live-map overlay: an agent
// referenced by an agent.execute step of any active run is marked 'working'.
// The map is read-only about this — the backend is the source of truth (§15.1).
export async function agentStatesForFloor(ownerId: string, floorId: ObjectId): Promise<Record<string, 'working'>> {
  const active = await db
    .collection('automation_runs')
    .find({ ownerId, floorId, status: { $in: ['queued', 'running'] } }, { projection: { definitionSnapshot: 1 } })
    .toArray()
  const states: Record<string, 'working'> = {}
  for (const run of active) {
    const steps = (run.definitionSnapshot as { steps?: Array<{ type?: string; config?: { agentId?: unknown } }> } | undefined)?.steps ?? []
    for (const step of steps) {
      if (step.type === 'agent.execute' && typeof step.config?.agentId === 'string') states[step.config.agentId] = 'working'
    }
  }
  return states
}
