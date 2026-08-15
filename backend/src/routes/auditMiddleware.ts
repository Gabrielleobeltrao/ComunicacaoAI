import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { recordAudit } from '../audit.js'
import type { AuditAction, AuditEntityType } from '../audit.js'

// ONE place instruments changes: this middleware. Every mutating API request passes
// through it, so a new route is audited the day it is written and no handler has to
// remember — and nothing is recorded twice, because there is no second call site.
//
// What it reads is the REQUEST LINE and the RESPONSE STATUS. Never the body: a body
// is where prompts, payloads, credentials and content live. The path already says
// what was touched, and the status says whether it worked.

// Where the audit trail starts and ends: everything else is out of scope on purpose.
// - auth: sessions, passwords and tokens must never be described here, not even by
//   their shape.
// - hooks: the public webhook receiver is an EXECUTION (it lands in automation_runs),
//   not a change to the account — and its body is a third party's payload.
const SKIP_PREFIXES = ['/api/auth', '/api/hooks', '/api/logs']

// URL segment → the entity that segment addresses. A resource that is not here is
// not audited: adding one is a decision, never an accident.
const ENTITY_BY_RESOURCE: Record<string, AuditEntityType> = {
  agents: 'agent',
  sectors: 'sector',
  floors: 'floor',
  offices: 'floor',
  building: 'building',
  tools: 'tool',
  widgets: 'channel',
  whatsapp: 'channel',
  connections: 'connection',
  automations: 'automation',
  documents: 'knowledge',
  knowledge: 'knowledge',
  settings: 'settings',
  'user-settings': 'settings',
  providers: 'settings',
}

// Sub-resources that are their own entity in the log, even though they hang off an
// agent's URL.
const SPECIAL_RESOURCES: Record<string, AuditEntityType> = {
  routines: 'routine',
  'event-triggers': 'event_trigger',
}

// A trailing verb segment (…/routines/:id/pause) names the action outright.
const ACTION_BY_VERB: Record<string, AuditAction> = {
  activate: 'activate',
  pause: 'pause',
  archive: 'archive',
  rotate: 'rotate',
  publish: 'publish',
  move: 'move',
  test: 'test',
}

const isObjectIdLike = (segment: string): boolean => /^[a-f0-9]{24}$/i.test(segment)

export interface AuditTarget {
  entityType: AuditEntityType
  entityId: string | null
  action: AuditAction
}

// Pure: the request line → what to record (or null for "not an audited change").
// Exported because this mapping is the whole risk surface of the middleware, and it
// deserves to be tested without a server.
export function auditTargetFor(method: string, path: string): AuditTarget | null {
  const verb = method.toUpperCase()
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return null
  if (SKIP_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return null

  const segments = path.split('?')[0].split('/').filter(Boolean)
  if (segments[0] !== 'api') return null
  const rest = segments.slice(1)
  if (!rest.length) return null

  // The LAST named resource in the path is what was acted on: for
  // /api/agents/:id/routines/:rid that is the routine, not the agent.
  const last = rest[rest.length - 1]
  const tail = ACTION_BY_VERB[last]
  const withoutVerb = tail ? rest.slice(0, -1) : rest

  let entityType: AuditEntityType | undefined
  let entityId: string | null = null
  for (let i = 0; i < withoutVerb.length; i++) {
    const segment = withoutVerb[i]
    if (isObjectIdLike(segment)) {
      entityId = segment
      continue
    }
    const mapped = ENTITY_BY_RESOURCE[segment] ?? SPECIAL_RESOURCES[segment]
    if (mapped) {
      entityType = mapped
      // A new resource segment replaces the id that belonged to the previous one.
      entityId = null
    }
  }
  if (!entityType) return null

  // The id of THIS entity, when the path carries one after its resource segment.
  const lastSegment = withoutVerb[withoutVerb.length - 1]
  entityId = isObjectIdLike(lastSegment) ? lastSegment : entityId

  const action: AuditAction = tail ?? (verb === 'POST' ? 'create' : verb === 'DELETE' ? 'delete' : 'update')
  return { entityType, entityId, action }
}

// Attach a request id (also returned as a header, so a support conversation can
// quote it) and record the change once the response is known.
export function auditRequests(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID()
  res.locals.requestId = requestId
  res.setHeader('x-request-id', requestId)

  const target = auditTargetFor(req.method, req.path)
  if (!target) {
    next()
    return
  }

  res.on('finish', () => {
    const ownerId = res.locals.userId
    // No session, no owner to attribute it to: an unauthenticated attempt is a
    // security concern for the access log, not an entry in this owner-scoped trail.
    if (typeof ownerId !== 'string' || !ownerId) return
    // 4xx that mean "invalid input" are noise; what matters is the change that
    // happened, and the failure of one that should have worked.
    const status = res.statusCode
    const relevantFailure = status >= 500 || status === 403 || status === 409
    if (status >= 400 && !relevantFailure) return

    void recordAudit({
      ownerId,
      actorType: 'user',
      actorId: ownerId,
      action: target.action,
      entityType: target.entityType,
      entityId: target.entityId,
      floorId: typeof res.locals.auditFloorId === 'string' ? res.locals.auditFloorId : null,
      result: status < 400 ? 'success' : 'failure',
      requestId,
      // Facts about the request, never anything from its body.
      metadata: { method: req.method, statusCode: status },
    })
  })
  next()
}
