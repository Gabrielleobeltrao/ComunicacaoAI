import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { getSectorById } from '../sectors.js'
import { listSectorExecutions, sectorExecutionSummary, sectorExecutionTimeline } from '../sectorExecutions.js'
import type { ExecutionPeriod, SectorExecutionFilters, SectorExecutionSource, SectorExecutionStatus } from '../sectorExecutions.js'
import { notFound, oid } from './http.js'

// Read-only operational view of a sector. Mounted at /api/sectors/:sectorId behind
// requireAuth. Every route resolves the sector in the OWNER's scope first, so an id
// from another account 404s rather than leaking, and nothing returned here can carry
// a prompt, an output, an argument or a raw error — statuses, counts and durations.
export const sectorExecutionRouter = Router({ mergeParams: true })

const PERIODS: ExecutionPeriod[] = ['7d', '30d', 'all']
const readPeriod = (raw: unknown): ExecutionPeriod => (PERIODS.includes(raw as ExecutionPeriod) ? (raw as ExecutionPeriod) : '30d')

async function requireSector(ownerId: string, raw: string): Promise<ObjectId | null> {
  const id = oid(raw)
  if (!id) return null
  const sector = await getSectorById(ownerId, id)
  return sector ? sector._id : null
}

sectorExecutionRouter.get('/executions/summary', async (req, res) => {
  const sectorId = await requireSector(res.locals.userId, String((req.params as Record<string, string>).sectorId))
  if (!sectorId) return notFound(res)
  const period = readPeriod(req.query.period)
  // Playground runs are recorded but excluded by default: a test is not production.
  const includeTest = req.query.includeTest === 'true'
  res.json(await sectorExecutionSummary(res.locals.userId, sectorId, period, { includeTest }))
})

sectorExecutionRouter.get('/executions', async (req, res) => {
  const sectorId = await requireSector(res.locals.userId, String((req.params as Record<string, string>).sectorId))
  if (!sectorId) return notFound(res)
  const q = req.query as Record<string, string | undefined>
  const filters: SectorExecutionFilters = {
    period: readPeriod(q.period),
    status: (['running', 'succeeded', 'failed', 'canceled'] as SectorExecutionStatus[]).includes(q.status as SectorExecutionStatus)
      ? (q.status as SectorExecutionStatus)
      : undefined,
    agentId: typeof q.agentId === 'string' ? q.agentId : undefined,
    stageId: typeof q.stageId === 'string' ? q.stageId.slice(0, 80) : undefined,
    source: (['delegation', 'routine', 'channel', 'manual', 'webhook'] as SectorExecutionSource[]).includes(q.source as SectorExecutionSource)
      ? (q.source as SectorExecutionSource)
      : undefined,
    includeTest: q.includeTest === 'true',
    cursor: typeof q.cursor === 'string' ? q.cursor : null,
    limit: q.limit ? Number(q.limit) : undefined,
  }
  res.json(await listSectorExecutions(res.locals.userId, sectorId, filters))
})

sectorExecutionRouter.get('/executions/:executionId', async (req, res) => {
  const params = req.params as Record<string, string>
  const sectorId = await requireSector(res.locals.userId, String(params.sectorId))
  if (!sectorId) return notFound(res)
  const executionId = oid(params.executionId)
  if (!executionId) return notFound(res)
  const timeline = await sectorExecutionTimeline(res.locals.userId, executionId)
  // An execution of ANOTHER sector is as absent as one of another account.
  if (!timeline || timeline.execution.sectorId !== sectorId.toString()) return notFound(res)
  res.json(timeline)
})
