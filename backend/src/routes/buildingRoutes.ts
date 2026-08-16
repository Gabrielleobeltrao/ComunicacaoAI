import { Router } from 'express'
import type { Building } from '../building.js'
import { ensureDefaultBuilding, updateBuilding } from '../building.js'
import { buildingOverview } from '../automations/metrics.js'
import { communicationImpact, FLOOR_COMMUNICATION_MODES, getFloorCommunication, setFloorCommunication } from '../floorCommunication.js'
import { fail } from './http.js'

// Mounted at /api/building behind requireAuth (res.locals.userId is the owner).
export const buildingRouter = Router()

const toPublic = (b: Building) => ({
  id: b._id,
  name: b.name,
  description: b.description,
  defaultTimezone: b.defaultTimezone,
  defaultLanguage: b.defaultLanguage,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
})

buildingRouter.get('/', async (_req, res) => {
  const building = await ensureDefaultBuilding(res.locals.userId)
  res.json(toPublic(building))
})

// Aggregated overview for the unified dashboard (KPIs + per-floor cards).
buildingRouter.get('/overview', async (_req, res, next) => {
  try {
    res.json(await buildingOverview(res.locals.userId))
  } catch (error) {
    fail(res, error, next)
  }
})

buildingRouter.patch('/', async (req, res, next) => {
  try {
    const building = await updateBuilding(res.locals.userId, req.body ?? {})
    res.json(toPublic(building))
  } catch (error) {
    fail(res, error, next)
  }
})

// Which floors of THIS building may talk to which. Owner-scoped, validated against
// this owner's floors, and atomic: a link never points outside the building.
buildingRouter.get('/floor-communication', async (_req, res) => {
  const building = await ensureDefaultBuilding(res.locals.userId)
  res.json(await getFloorCommunication(res.locals.userId, building._id))
})

buildingRouter.patch('/floor-communication', async (req, res, next) => {
  try {
    const building = await ensureDefaultBuilding(res.locals.userId)
    res.json(await setFloorCommunication(res.locals.userId, building._id, req.body ?? {}))
  } catch (error) {
    fail(res, error, next)
  }
})

// What a configuration would block, computed BEFORE saving it.
buildingRouter.get('/floor-communication/impact', async (req, res, next) => {
  try {
    const building = await ensureDefaultBuilding(res.locals.userId)
    const current = await getFloorCommunication(res.locals.userId, building._id)
    const q = req.query as Record<string, string | undefined>
    const mode = FLOOR_COMMUNICATION_MODES.includes(q.mode as never) ? (q.mode as typeof current.mode) : current.mode
    res.json(await communicationImpact(res.locals.userId, { mode, links: current.links }))
  } catch (error) {
    fail(res, error, next)
  }
})
