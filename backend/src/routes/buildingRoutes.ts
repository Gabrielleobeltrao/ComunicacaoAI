import { Router } from 'express'
import type { Building } from '../building.js'
import { ensureDefaultBuilding, updateBuilding } from '../building.js'
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

buildingRouter.patch('/', async (req, res, next) => {
  try {
    const building = await updateBuilding(res.locals.userId, req.body ?? {})
    res.json(toPublic(building))
  } catch (error) {
    fail(res, error, next)
  }
})
