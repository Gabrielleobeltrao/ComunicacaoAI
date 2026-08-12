import { Router } from 'express'
import type { Floor } from '../floors.js'
import { createFloor, getFloor, getFloorActivity, listFloors, setFloorStatus, updateFloor } from '../floors.js'
import { agentStatesForFloor, floorMetrics } from '../automations/metrics.js'
import { fail, notFound, oid } from './http.js'

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
floorRouter.get('/:floorId/agent-states', async (req, res) => {
  const id = oid(req.params.floorId)
  if (!id) return notFound(res)
  const floor = await getFloor(res.locals.userId, id)
  if (!floor) return notFound(res)
  res.json(await agentStatesForFloor(res.locals.userId, id))
})
