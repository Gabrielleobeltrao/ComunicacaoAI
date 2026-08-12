import { Router } from 'express'
import { findRun, listArtifacts, listRuns, listStepRuns, requestCancel } from '../automations/runRepository.js'
import type { Artifact, AutomationRun, StepRun } from '../automations/runTypes.js'
import { notFound, oid } from './http.js'

// Mounted at /api/runs behind requireAuth. Listings never return the (large)
// definition snapshot; the run detail includes it for reproducibility.
export const runRouter = Router()

const clampInt = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def
}

const runSummary = (r: AutomationRun) => ({
  id: r._id,
  automationId: r.automationId,
  floorId: r.floorId,
  automationVersion: r.automationVersion,
  triggerType: r.triggerType,
  status: r.status,
  currentStepId: r.currentStepId,
  queuedAt: r.queuedAt,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  usage: r.usage,
  error: r.error,
})
const stepPublic = (s: StepRun) => ({
  id: s._id,
  stepId: s.stepId,
  stepType: s.stepType,
  attempt: s.attempt,
  status: s.status,
  outputPreview: s.outputPreview,
  error: s.error,
})
const artifactPublic = (a: Artifact) => ({
  id: a._id,
  name: a.name,
  kind: a.kind,
  mimeType: a.mimeType,
  sizeBytes: a.sizeBytes,
  runId: a.runId,
  createdAt: a.createdAt,
})

runRouter.get('/', async (req, res) => {
  const limit = clampInt(req.query.limit, 20, 1, 100)
  const skip = clampInt(req.query.skip, 0, 0, 1_000_000)
  const { items, total } = await listRuns(res.locals.userId, {
    floorId: typeof req.query.floorId === 'string' && oid(req.query.floorId) ? oid(req.query.floorId)! : undefined,
    automationId: typeof req.query.automationId === 'string' && oid(req.query.automationId) ? oid(req.query.automationId)! : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    limit,
    skip,
  })
  res.json({ items: items.map(runSummary), total, limit, skip })
})

runRouter.get('/:id', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const run = await findRun(res.locals.userId, id)
  if (!run) return notFound(res)
  res.json({ ...runSummary(run), finalOutput: run.finalOutput, definitionSnapshot: run.definitionSnapshot })
})

runRouter.get('/:id/steps', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const run = await findRun(res.locals.userId, id)
  if (!run) return notFound(res)
  const steps = await listStepRuns(res.locals.userId, id)
  res.json(steps.map(stepPublic))
})

runRouter.get('/:id/artifacts', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const run = await findRun(res.locals.userId, id)
  if (!run) return notFound(res)
  const artifacts = await listArtifacts(res.locals.userId, id)
  res.json(artifacts.map(artifactPublic))
})

runRouter.post('/:id/cancel', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const run = await requestCancel(res.locals.userId, id)
  if (!run) return notFound(res)
  res.json(runSummary(run))
})
