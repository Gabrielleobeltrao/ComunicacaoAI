// AUDIT — an append-only record of every CHANGE an owner's account went through.
//
// It is deliberately NOT a copy of anything. Executions already live in
// automation_runs / step_runs and are read from there; this collection answers a
// different question: who changed what, when, and did it work.
//
// PRIVACY IS THE DESIGN, not a cleanup step. Nothing here ever receives a request
// body, a prompt, a webhook payload, a header, a cookie, a credential or an output.
// `metadata` is built by an ALLOWLIST: a key that is not on the list does not reach
// the database, so there is nothing to scrub later.
//
// Append-only means append-only: this module exposes writes and reads, and no
// update or delete. Retention is documented (RETENTION_NOTE) and enforced by an
// operator decision, never by a silent deletion inside the app.
import { ObjectId } from 'mongodb'
import { db } from './db.js'
import { escapeRegex, findEntityIdsByName, normalizeLabel, resolveEntityLabels, labelKeyFor } from './auditLabels.js'

export type AuditActorType = 'user' | 'system' | 'agent'
export const AUDIT_ACTOR_TYPES: AuditActorType[] = ['user', 'system', 'agent']

export type AuditResult = 'success' | 'failure'

// What happened. Deliberately a small, closed vocabulary: a new verb is a decision,
// not something a route can invent by accident.
// 'restore' and 'disconnect' were added when the route table became explicit: a
// restored floor used to be recorded as a creation, and disconnecting Google as
// nothing at all. Additive — older events keep their verbs.
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'activate'
  | 'pause'
  | 'archive'
  | 'restore'
  | 'move'
  | 'rotate'
  | 'publish'
  | 'test'
  | 'disconnect'
export const AUDIT_ACTIONS: AuditAction[] = [
  'create',
  'update',
  'delete',
  'activate',
  'pause',
  'archive',
  'restore',
  'move',
  'rotate',
  'publish',
  'test',
  'disconnect',
]

// What it happened to.
export type AuditEntityType =
  | 'agent'
  | 'sector'
  | 'floor'
  | 'building'
  | 'tool'
  | 'channel'
  | 'connection'
  | 'routine'
  | 'event_trigger'
  | 'automation'
  | 'knowledge'
  | 'settings'
export const AUDIT_ENTITY_TYPES: AuditEntityType[] = [
  'agent',
  'sector',
  'floor',
  'building',
  'tool',
  'channel',
  'connection',
  'routine',
  'event_trigger',
  'automation',
  'knowledge',
  'settings',
]

// Retention: audit events are kept indefinitely by default. There is no TTL index
// and nothing in the app deletes them — an operator who needs a retention window
// applies it explicitly (a documented, deliberate administrative action), so a log
// can never quietly lose the period someone is about to ask about.
export const RETENTION_NOTE = 'append-only; kept indefinitely, no automatic deletion'

export interface AuditEvent {
  _id: ObjectId
  ownerId: string
  actorType: AuditActorType
  // The user/agent that acted. Absent for 'system'.
  actorId?: string | null
  action: AuditAction
  entityType: AuditEntityType
  entityId: string | null
  // A SHORT, plain name captured before a deletion — the only moment it can be read.
  // Live entities are named at read time instead, so the timeline shows the current
  // name. Never content: see auditLabels.ts for which entities are covered.
  entityLabel?: string | null
  floorId?: string | null
  result: AuditResult
  occurredAt: Date
  // Correlates every event produced while serving ONE request.
  requestId: string
  metadata: Record<string, string | number | boolean>
}

const events = db.collection<AuditEvent>('audit_events')

export async function ensureAuditIndexes(): Promise<void> {
  // The timeline itself (and the cursor's sort key).
  await events.createIndex({ ownerId: 1, occurredAt: -1, _id: -1 })
  // The filters the UI offers.
  await events.createIndex({ ownerId: 1, entityType: 1, occurredAt: -1 })
  await events.createIndex({ ownerId: 1, action: 1, occurredAt: -1 })
  await events.createIndex({ ownerId: 1, actorId: 1, occurredAt: -1 })
  await events.createIndex({ ownerId: 1, entityId: 1, occurredAt: -1 })
  await events.createIndex({ ownerId: 1, requestId: 1 })
}

// The ONLY metadata keys that may be stored. Everything else is dropped before the
// write — an allowlist, so a future call site cannot leak a field by forgetting.
// Every one of these is a small, non-identifying operational fact.
const METADATA_ALLOWLIST = new Set([
  'status',
  'previousStatus',
  'method',
  'triggerType',
  'provider',
  'sectorId',
  'agentId',
  'floorId',
  'fromFloorId',
  'toFloorId',
  'fromSectorId',
  'toSectorId',
  'routineId',
  'triggerId',
  'toolId',
  'connectionId',
  'appKey',
  'installationId',
  'actionKey',
  'count',
  'statusCode',
  'reason',
  'section',
  'mode',
  'recurrence',
  'timezone',
])

const MAX_VALUE_CHARS = 120

// Build the stored metadata: allowlisted keys only, scalars only, short. A value
// that is an object, an array, or a long string is not "trimmed" — it is dropped,
// because those are exactly the shapes a payload arrives in.
export function safeMetadata(input: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!METADATA_ALLOWLIST.has(key)) continue
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    else if (typeof value === 'boolean') out[key] = value
    else if (typeof value === 'string') {
      const trimmed = value.trim()
      // A long string is a payload, not a fact about it.
      if (trimmed && trimmed.length <= MAX_VALUE_CHARS) out[key] = trimmed
    }
  }
  return out
}

export interface RecordAuditInput {
  ownerId: string
  actorType: AuditActorType
  actorId?: string | null
  action: AuditAction
  entityType: AuditEntityType
  entityId?: string | null
  entityLabel?: string | null
  floorId?: string | null
  result: AuditResult
  requestId: string
  metadata?: unknown
  occurredAt?: Date
}

// Write one event. It NEVER throws into the caller: an audit failure must not undo
// a change the user already made — but it is not swallowed either, it is reported
// as an operational error on the server.
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    await events.insertOne({
      _id: new ObjectId(),
      ownerId: input.ownerId,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      entityLabel: normalizeLabel(input.entityLabel),
      floorId: input.floorId ?? null,
      result: input.result,
      occurredAt: input.occurredAt ?? new Date(),
      requestId: input.requestId,
      metadata: safeMetadata(input.metadata),
    })
  } catch (error) {
    // Operational, not user-facing: the mutation itself already succeeded.
    console.error('AUDIT WRITE FAILED — the change happened but was not recorded:', {
      action: input.action,
      entityType: input.entityType,
      requestId: input.requestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// --- reading ------------------------------------------------------------------------

export interface AuditFilters {
  actorId?: string
  actorType?: AuditActorType
  action?: AuditAction
  entityType?: AuditEntityType
  entityId?: string
  floorId?: string
  result?: AuditResult
  from?: Date
  to?: Date
  // Free text over the entity: its id, or the name captured when it was deleted.
  // Matched server-side, inside the owner's own events.
  q?: string
}

// (occurredAt, _id): the sort key plus a tiebreak, so two events in the same
// millisecond cannot make a page repeat or skip a row.
export const encodeAuditCursor = (item: { occurredAt: string; id: string }): string => `${new Date(item.occurredAt).getTime()}_${item.id}`

function decodeAuditCursor(raw: string | undefined): { occurredAt: Date; id: ObjectId } | null {
  if (!raw) return null
  const [time, id] = raw.split('_')
  if (!time || !ObjectId.isValid(id ?? '')) return null
  const occurredAt = new Date(Number(time))
  return Number.isNaN(occurredAt.getTime()) ? null : { occurredAt, id: new ObjectId(id) }
}

export interface AuditEventPublic {
  id: string
  actorType: AuditActorType
  actorId: string | null
  action: AuditAction
  entityType: AuditEntityType
  entityId: string | null
  // The current name when the entity still exists, else the one captured before it
  // was deleted, else null.
  entityLabel: string | null
  floorId: string | null
  result: AuditResult
  occurredAt: string
  requestId: string
  metadata: Record<string, string | number | boolean>
}

export async function listAuditEvents(
  ownerId: string,
  f: AuditFilters,
  page: { limit: number; cursor?: string },
): Promise<{ items: AuditEventPublic[]; nextCursor: string | null }> {
  const base: Record<string, unknown> = { ownerId }
  if (f.actorId) base.actorId = f.actorId
  if (f.actorType) base.actorType = f.actorType
  if (f.action) base.action = f.action
  if (f.entityType) base.entityType = f.entityType
  if (f.entityId) base.entityId = f.entityId
  if (f.floorId) base.floorId = f.floorId
  if (f.result) base.result = f.result
  if (f.from || f.to) base.occurredAt = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) }
  if (f.q) {
    const needle = f.q.trim().slice(0, 120)
    // A name search must find what still EXISTS too — only deleted entities carry a
    // stored label. The term is resolved to ids first, owner-scoped and in batch,
    // and the text is escaped: a search box is not a regular expression.
    const liveIds = await findEntityIdsByName(ownerId, needle, f.entityType)
    base.$or = [
      { entityId: needle },
      ...(liveIds.length ? [{ entityId: { $in: liveIds } }] : []),
      { entityLabel: { $regex: escapeRegex(needle), $options: 'i' } },
    ]
  }

  const after = decodeAuditCursor(page.cursor)
  const filter = after
    ? { $and: [base, { $or: [{ occurredAt: { $lt: after.occurredAt } }, { occurredAt: after.occurredAt, _id: { $lt: after.id } }] }] }
    : base

  const docs = await events.find(filter).sort({ occurredAt: -1, _id: -1 }).limit(page.limit + 1).toArray()
  const pageDocs = docs.slice(0, page.limit)
  // ONE batch for the whole page, owner-scoped, so a name never costs a query per row.
  const labels = await resolveEntityLabels(ownerId, pageDocs)
  const items = pageDocs.map((e): AuditEventPublic => {
    const key = e.entityId ? labelKeyFor(e.entityType, e.entityId) : null
    return {
      id: e._id.toString(),
      actorType: e.actorType,
      actorId: e.actorId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      // Current name first; the captured one is what survives a deletion.
      entityLabel: (key ? labels.get(key) : null) ?? e.entityLabel ?? null,
      floorId: e.floorId ?? null,
      result: e.result,
      occurredAt: e.occurredAt.toISOString(),
      requestId: e.requestId,
      metadata: e.metadata ?? {},
    }
  })
  const nextCursor = docs.length > page.limit && items.length ? encodeAuditCursor(items[items.length - 1]) : null
  return { items, nextCursor }
}
