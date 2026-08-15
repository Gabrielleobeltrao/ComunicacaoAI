import { Router } from 'express'
import { config } from '../config.js'
import {
  executionSummary,
  EXECUTION_TABS,
  listRunsForCenter,
  listScheduled,
  listTriggers,
} from '../automations/executionCenter.js'
import type { ExecutionFilters, ExecutionTab } from '../automations/executionCenter.js'
import { oid } from './http.js'

// Mounted at /api/executions behind requireAuth. Read-only observability over the
// work the agents already do: it starts no run, publishes nothing, and every query
// is scoped to res.locals.userId. Actions (pause/activate) stay where they belong —
// on the agent's own routine/trigger endpoints.
export const executionRouter = Router()

const clampInt = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def
}

const parseFilters = (query: Record<string, unknown>): ExecutionFilters => ({
  floorId: typeof query.floorId === 'string' ? (oid(query.floorId) ?? undefined) : undefined,
  sectorId: typeof query.sectorId === 'string' ? (oid(query.sectorId) ?? undefined) : undefined,
  agentId: typeof query.agentId === 'string' ? (oid(query.agentId) ?? undefined) : undefined,
  status: typeof query.status === 'string' && query.status ? query.status : undefined,
})

// The counters describe the SAME set the list is showing, so the header and the
// rows can never tell two different stories.
executionRouter.get('/summary', async (req, res) => {
  res.json(await executionSummary(res.locals.userId, new Date(), parseFilters(req.query as Record<string, unknown>)))
})

executionRouter.get('/', async (req, res) => {
  const raw = String(req.query.tab ?? 'scheduled')
  const tab = (EXECUTION_TABS as string[]).includes(raw) ? (raw as ExecutionTab) : 'scheduled'
  const page = { limit: clampInt(req.query.limit, 20, 1, 100), skip: clampInt(req.query.skip, 0, 0, 1_000_000) }
  const filters = parseFilters(req.query as Record<string, unknown>)
  const ownerId = res.locals.userId

  if (tab === 'scheduled') {
    res.json({ tab, ...(await listScheduled(ownerId, filters, page)) })
    return
  }
  if (tab === 'triggers') {
    res.json({ tab, ...(await listTriggers(ownerId, filters, page, config.publicUrl)) })
    return
  }
  res.json({ tab, ...(await listRunsForCenter(ownerId, tab === 'active' ? 'active' : 'history', filters, page)) })
})
