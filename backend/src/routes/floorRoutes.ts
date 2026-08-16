import { Router } from 'express'
import type { Floor } from '../floors.js'
import { createFloor, deleteFloor, getFloor, getFloorActivity, listFloors, setFloorStatus, updateFloor } from '../floors.js'
import { agentStatesForFloor, floorMetrics } from '../automations/metrics.js'
import { agentLiveStatesForFloor, legacyWorkingMap, liveStatesEtag } from '../agentLiveState.js'
import { floorWorkOverview } from '../floorWork.js'
import { fail, notFound, oid } from './http.js'
import { auditEntity } from './auditMiddleware.js'

// Mounted at /api/floors behind requireAuth (res.locals.userId is the owner).
// floorId is the legacy officeId — never trusted from the client without an
// ownership-scoped lookup.
export const floorRouter = Router()

const toPublic = (f: Floor) => ({
  id: f._id,
  buildingId: f.buildingId,
  name: f.name,
  mission: f.mission,
  description: f.description,
  timezone: f.timezone,
  defaultLanguage: f.defaultLanguage,
  color: f.color,
  icon: f.icon,
  order: f.order,
  status: f.status,
  // How this floor works. `coordinatorAgentId` only points at an agent — no tool,
  // App or permission list is stored on the floor.
  workMode: f.workMode,
  coordinatorAgentId: f.coordinatorAgentId ? f.coordinatorAgentId.toString() : null,
  instruction: f.instruction,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
})

floorRouter.get('/', async (req, res) => {
  const includeArchived = req.query.includeArchived === 'true'
  const floors = await listFloors(res.locals.userId, { includeArchived })
  res.json(floors.map(toPublic))
})

floorRouter.post('/', async (req, res, next) => {
  try {
    const floor = await createFloor(res.locals.userId, req.body ?? {})
    auditEntity(res, { id: floor._id.toString(), label: floor.name, floorId: floor._id.toString() })
    res.status(201).json(toPublic(floor))
  } catch (error) {
    fail(res, error, next)
  }
})

floorRouter.get('/:floorId', async (req, res) => {
  const id = oid(req.params.floorId)
  if (!id) return notFound(res)
  const floor = await getFloor(res.locals.userId, id)
  if (!floor) return notFound(res)
  res.json(toPublic(floor))
})

floorRouter.patch('/:floorId', async (req, res, next) => {
  const id = oid(req.params.floorId)
  if (!id) return notFound(res)
  try {
    const floor = await updateFloor(res.locals.userId, id, req.body ?? {})
    if (!floor) return notFound(res)
    res.json(toPublic(floor))
  } catch (error) {
    fail(res, error, next)
  }
})

// Who coordinates this floor, what they can effectively reach, and whether the
// arrangement is ready. Read-only: it discovers, it never grants.
floorRouter.get('/:floorId/work-overview', async (req, res) => {
  const id = oid(req.params.floorId)
  if (!id) return notFound(res)
  const floor = await getFloor(res.locals.userId, id)
  if (!floor) return notFound(res)
  res.json(await floorWorkOverview(res.locals.userId, floor))
})

floorRouter.delete('/:floorId', async (req, res) => {
  const id = oid(req.params.floorId)
  if (!id) return notFound(res)
  const result = await deleteFloor(res.locals.userId, id)
  if (result === null) return notFound(res)
  if (!result.ok) {
    const message =
      result.code === 'LAST_FLOOR'
        ? 'Não é possível excluir o único andar do prédio.'
        : `Este andar tem ${result.agentCount} agente(s) e ${result.sectorCount} setor(es). Mova ou exclua antes de excluir o andar.`
    res.status(409).json({ code: result.code, message })
    return
  }
  res.status(204).end()
})

floorRouter.post('/:floorId/archive', async (req, res) => {
  const id = oid(req.params.floorId)
  if (!id) return notFound(res)
  const floor = await setFloorStatus(res.locals.userId, id, 'archived')
  if (!floor) return notFound(res)
  res.json(toPublic(floor))
})

floorRouter.post('/:floorId/restore', async (req, res) => {
  const id = oid(req.params.floorId)
  if (!id) return notFound(res)
  const floor = await setFloorStatus(res.locals.userId, id, 'active')
  if (!floor) return notFound(res)
  res.json(toPublic(floor))
})

floorRouter.get('/:floorId/activity', async (req, res) => {
  const id = oid(req.params.floorId)
  if (!id) return notFound(res)
  const floor = await getFloor(res.locals.userId, id)
  if (!floor) return notFound(res)
  const activity = await getFloorActivity(res.locals.userId, id)
  res.json({ floorId: id, ...activity })
})

// Operational metrics (automations/runs) — separate from conversational metrics.
floorRouter.get('/:floorId/metrics', async (req, res) => {
  const id = oid(req.params.floorId)
  if (!id) return notFound(res)
  const floor = await getFloor(res.locals.userId, id)
  if (!floor) return notFound(res)
  res.json(await floorMetrics(res.locals.userId, id))
})

// Per-agent operational state for the live-map overlay (read-only reflection).
//
// Read-only, authenticated, owner AND floor scoped. It returns the versioned DTO —
// enum, timestamps and an allowlisted `safeDetail`, never a prompt, an input, an
// output or a raw error. `legacy=1` keeps the old `Record<agentId,'working'>` shape
// for the current map until the bubble layer ships.
floorRouter.get('/:floorId/agent-states', async (req, res) => {
  const id = oid(req.params.floorId)
  if (!id) return notFound(res)
  const floor = await getFloor(res.locals.userId, id)
  if (!floor) return notFound(res)

  const live = await agentLiveStatesForFloor(res.locals.userId, id)

  // Nothing new since the client's copy: answer 304 instead of a payload. Polling
  // every couple of seconds has to be cheap.
  const etag = liveStatesEtag(live)
  res.setHeader('ETag', etag)
  res.setHeader('Cache-Control', 'no-cache')
  if (req.headers['if-none-match'] === etag) return res.status(304).end()

  const since = typeof req.query.updatedSince === 'string' ? new Date(req.query.updatedSince) : null
  const filtered =
    since && !Number.isNaN(since.getTime())
      ? { ...live, states: live.states.filter((s) => new Date(s.updatedAt) > since) }
      : live

  if (req.query.legacy === '1') {
    // The old contract, derived from the same projection — plus what the previous
    // implementation covered: an agent in a run that has not reported a transition
    // yet still counts as working.
    const legacy = { ...legacyWorkingMap(live), ...(await agentStatesForFloor(res.locals.userId, id)) }
    return res.json(legacy)
  }
  res.json(filtered)
})
