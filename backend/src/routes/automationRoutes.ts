import { Router } from 'express'
import { ValidationError } from '../building.js'
import { AutomationValidationError } from '../automations/service.js'
import * as service from '../automations/service.js'
import { createRun } from '../automations/runService.js'
import type { Automation, AutomationVersion } from '../automations/types.js'
import { fail, notFound, oid } from './http.js'

// Mounted at /api/automations behind requireAuth. Ownership enforced in the
// service; ids are validated before any lookup.
export const automationRouter = Router()

const toPublic = (a: Automation) => ({
  id: a._id,
  floorId: a.floorId,
  buildingId: a.buildingId,
  name: a.name,
  description: a.description,
  status: a.status,
  trigger: a.trigger,
  draftDefinition: a.draftDefinition,
  currentVersion: a.currentVersion,
  lastPublishedVersion: a.lastPublishedVersion,
  webhookPublicKey: a.webhookPublicKey ?? null,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
})
const versionPublic = (v: AutomationVersion) => ({
  id: v._id,
  automationId: v.automationId,
  version: v.version,
  definition: v.definition,
  definitionHash: v.definitionHash,
  createdAt: v.createdAt,
})

const clampInt = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def
}

automationRouter.get('/', async (req, res) => {
  const limit = clampInt(req.query.limit, 20, 1, 100)
  const skip = clampInt(req.query.skip, 0, 0, 1_000_000)
  const { items, total } = await service.listAutomations(res.locals.userId, {
    floorId: typeof req.query.floorId === 'string' ? req.query.floorId : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    limit,
    skip,
  })
  res.json({ items: items.map(toPublic), total, limit, skip })
})

automationRouter.post('/', async (req, res, next) => {
  try {
    const created = await service.createAutomation(res.locals.userId, req.body ?? {})
    res.status(201).json(toPublic(created))
  } catch (error) {
    fail(res, error, next)
  }
})

automationRouter.get('/:id', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const a = await service.getAutomation(res.locals.userId, id)
  if (!a) return notFound(res)
  res.json(toPublic(a))
})

automationRouter.patch('/:id', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const a = await service.updateDraft(res.locals.userId, id, req.body ?? {})
    if (!a) return notFound(res)
    res.json(toPublic(a))
  } catch (error) {
    fail(res, error, next)
  }
})

automationRouter.post('/:id/validate', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const result = await service.validateAutomation(res.locals.userId, id)
  if (!result) return notFound(res)
  res.json(result)
})

automationRouter.post('/:id/publish', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const version = await service.publishAutomation(res.locals.userId, id, res.locals.userId)
    if (!version) return notFound(res)
    res.status(201).json(versionPublic(version))
  } catch (error) {
    if (error instanceof AutomationValidationError) {
      res.status(400).json({ code: 'invalid_definition', message: 'definition is invalid', issues: error.issues })
      return
    }
    fail(res, error, next)
  }
})

for (const [action, status] of [
  ['activate', 'active'],
  ['pause', 'paused'],
  ['archive', 'archived'],
] as const) {
  automationRouter.post(`/:id/${action}`, async (req, res, next) => {
    const id = oid(req.params.id)
    if (!id) return notFound(res)
    try {
      const a = await service.setStatus(res.locals.userId, id, status)
      if (!a) return notFound(res)
      res.json(toPublic(a))
    } catch (error) {
      fail(res, error, next)
    }
  })
}

automationRouter.get('/:id/versions', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const versions = await service.listVersions(res.locals.userId, id)
  res.json(versions.map(versionPublic))
})

// Rotate (or create) the webhook signing secret — returns { publicKey, secret }
// once (the plaintext secret is never returned again).
automationRouter.post('/:id/webhook/rotate', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const result = await service.rotateWebhookSecret(res.locals.userId, id)
  if (!result) return notFound(res)
  res.json(result)
})

// Create + enqueue a run (manual/test). Idempotent by idempotencyKey.
automationRouter.post('/:id/runs', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    // The request that asked for it, so the execution and the audit events of the
    // same request line up in the log.
    const { run, created } = await createRun(res.locals.userId, id, {
      ...(req.body ?? {}),
      requestId: typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined,
    })
    res.status(created ? 201 : 200).json({ id: run._id, status: run.status, idempotencyKey: run.idempotencyKey })
  } catch (error) {
    fail(res, error, next)
  }
})
