import { Router } from 'express'
import { listAuditEvents } from '../audit.js'
import type { AuditAction, AuditActorType, AuditEntityType, AuditFilters, AuditResult } from '../audit.js'
import { AUDIT_ACTIONS, AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES } from '../audit.js'
import { listRunTimeline } from '../automations/executionCenter.js'
import type { RunTimelineFilters } from '../automations/executionCenter.js'
import { findRun, listArtifacts, listStepRuns } from '../automations/runRepository.js'
import { listDeliveries } from '../connections/repository.js'
import { publicError } from '../safeError.js'
import { notFound, oid } from './http.js'

// Mounted at /api/logs behind requireAuth. READ ONLY: there is no PATCH and no
// DELETE here, because an audit trail that can be edited is not an audit trail.
//
// Two timelines over the data that already exists:
//   /runs  — executions, read from automation_runs / step_runs (never copied);
//   /audit — changes, read from the append-only audit_events.
//
// Every query is scoped to res.locals.userId, and the run detail re-validates
// ownership before reading anything about it.
export const logRouter = Router()

const clampInt = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def
}

const asDate = (v: unknown): Date | undefined => {
  if (typeof v !== 'string' || !v.trim()) return undefined
  const date = new Date(v)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined

// --- executions -----------------------------------------------------------------

logRouter.get('/runs', async (req, res) => {
  const q = req.query as Record<string, unknown>
  const filters: RunTimelineFilters = {
    floorId: typeof q.floorId === 'string' ? (oid(q.floorId) ?? undefined) : undefined,
    sectorId: typeof q.sectorId === 'string' ? (oid(q.sectorId) ?? undefined) : undefined,
    agentId: typeof q.agentId === 'string' ? (oid(q.agentId) ?? undefined) : undefined,
    status: asString(q.status),
    triggerType: oneOf(q.triggerType, ['manual', 'schedule', 'webhook'] as const),
    from: asDate(q.from),
    to: asDate(q.to),
  }
  const page = { limit: clampInt(q.limit, 25, 1, 100), cursor: asString(q.cursor) }
  res.json(await listRunTimeline(res.locals.userId, filters, page))
})

// The safe detail of ONE execution, composed from the same repositories the run
// APIs already use. What is deliberately absent: the definition snapshot, the
// trigger payload, the final output, and any step output beyond its recorded
// preview — this screen explains what happened, it does not reveal what was said.
logRouter.get('/runs/:id', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  // Re-validated here, not inherited from the listing.
  const run = await findRun(res.locals.userId, id)
  if (!run) return notFound(res)

  const [steps, deliveries, artifacts] = await Promise.all([
    listStepRuns(res.locals.userId, id),
    listDeliveries(res.locals.userId, id),
    listArtifacts(res.locals.userId, id),
  ])

  res.json({
    id: run._id.toString(),
    automationId: run.automationId.toString(),
    automationVersion: run.automationVersion,
    // Safe by construction: a request id, or a correlation derived from ids only.
    requestId: run.requestId ?? null,
    status: run.status,
    triggerType: run.triggerType,
    queuedAt: run.queuedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.startedAt && run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
    usage: run.usage,
    // The stored message is never returned: the kind selects a fixed sentence.
    error: publicError(run.error),
    steps: steps.map((s) => ({
      id: s._id.toString(),
      stepId: s.stepId,
      stepType: s.stepType,
      attempt: s.attempt,
      status: s.status,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      error: publicError(s.error),
    })),
    deliveries: deliveries.map((d) => ({
      id: d._id.toString(),
      provider: d.provider,
      // Already masked at write time; the destination in clear never existed here.
      destinationMasked: d.destinationMasked,
      status: d.status,
      attempt: d.attempt,
      createdAt: d.createdAt,
      sentAt: d.sentAt,
      error: publicError(d.error),
    })),
    // Metadata only: the artifact's CONTENT is not part of an audit view.
    artifacts: artifacts.map((a) => ({
      id: a._id.toString(),
      name: a.name,
      kind: a.kind,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt,
    })),
  })
})

// --- changes ---------------------------------------------------------------------

logRouter.get('/audit', async (req, res) => {
  const q = req.query as Record<string, unknown>
  const filters: AuditFilters = {
    actorId: asString(q.actorId),
    actorType: oneOf<AuditActorType>(q.actorType, AUDIT_ACTOR_TYPES),
    q: asString(q.q),
    action: oneOf<AuditAction>(q.action, AUDIT_ACTIONS),
    entityType: oneOf<AuditEntityType>(q.entityType, AUDIT_ENTITY_TYPES),
    entityId: asString(q.entityId),
    floorId: asString(q.floorId),
    result: oneOf<AuditResult>(q.result, ['success', 'failure'] as const),
    from: asDate(q.from),
    to: asDate(q.to),
  }
  const page = { limit: clampInt(q.limit, 25, 1, 100), cursor: asString(q.cursor) }
  res.json(await listAuditEvents(res.locals.userId, filters, page))
})
