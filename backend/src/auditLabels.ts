// Naming what a log entry is about: "Você editou o agente Pesquisador Político"
// instead of "editou agente".
//
// Two moments, one rule. A name is read from the entity itself, ALWAYS scoped to the
// owner asking:
//   - while it still exists → resolved in BATCH at read time, so the timeline shows
//     the current name and no page costs one query per row;
//   - when it is about to be deleted → captured once, before the handler runs, and
//     stored on the event, because afterwards there is nothing left to read.
//
// Only entities whose name IS a label are covered. A knowledge document's title is
// the user's own content, so it is deliberately not captured or resolved.
import { ObjectId } from 'mongodb'
import { db } from './db.js'
import type { AuditEntityType } from './audit.js'

// entityType → the collection it lives in and the field that names it. An entity
// type absent from this map is never looked up.
const SOURCES: Partial<Record<AuditEntityType, { collection: string; field: string }>> = {
  agent: { collection: 'agents', field: 'name' },
  sector: { collection: 'sectors', field: 'name' },
  floor: { collection: 'offices', field: 'name' },
  building: { collection: 'buildings', field: 'name' },
  tool: { collection: 'tools', field: 'name' },
  channel: { collection: 'widgets', field: 'name' },
  connection: { collection: 'connections', field: 'name' },
  routine: { collection: 'automations', field: 'name' },
  event_trigger: { collection: 'automations', field: 'name' },
  automation: { collection: 'automations', field: 'name' },
  architect_project: { collection: 'architect_projects', field: 'title' },
  // "Você pôs de plantão o monitor RSI sobrevendido" — o nome vem do próprio monitor.
  monitor: { collection: 'monitors', field: 'name' },
  extension: { collection: 'extension_packages', field: 'name' },
  monitoring_source: { collection: 'monitoring_sources', field: 'name' },
}

// A label is short and plain by construction: no newlines, bounded length.
export const MAX_LABEL_CHARS = 80

export function normalizeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const flat = value.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > MAX_LABEL_CHARS ? `${flat.slice(0, MAX_LABEL_CHARS - 1)}…` : flat
}

// ONE lookup, for the delete path — the only moment a name can still be read.
//
// It runs BEFORE the request is authenticated (the label has to be captured before
// the handler deletes the row), so it returns the document's OWNER alongside the
// name and the caller keeps the label only if that owner is the one the event is
// being written for. Nothing crosses accounts: a mismatch discards the label.
export async function entityLabelWithOwner(
  entityType: AuditEntityType,
  entityId: string,
): Promise<{ ownerId: string; label: string | null } | null> {
  const source = SOURCES[entityType]
  if (!source || !ObjectId.isValid(entityId)) return null
  try {
    const doc = (await db
      .collection(source.collection)
      .findOne({ _id: new ObjectId(entityId) }, { projection: { [source.field]: 1, ownerId: 1 } })) as Record<string, unknown> | null
    if (!doc || typeof doc.ownerId !== 'string') return null
    return { ownerId: doc.ownerId, label: normalizeLabel(doc[source.field]) }
  } catch {
    // A label is a nicety; failing to read one must never affect the request.
    return null
  }
}

// BATCH resolution for a page of events: one query per collection involved, never
// one per row, and every query carries the ownerId.
export async function resolveEntityLabels(
  ownerId: string,
  events: { entityType: AuditEntityType; entityId: string | null }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  // collection → { field, ids }
  const wanted = new Map<string, { field: string; ids: Set<string> }>()
  for (const event of events) {
    const source = SOURCES[event.entityType]
    if (!source || !event.entityId || !ObjectId.isValid(event.entityId)) continue
    const bucket = wanted.get(source.collection) ?? { field: source.field, ids: new Set<string>() }
    bucket.ids.add(event.entityId)
    wanted.set(source.collection, bucket)
  }

  await Promise.all(
    [...wanted.entries()].map(async ([collection, { field, ids }]) => {
      const docs = await db
        .collection(collection)
        .find({ ownerId, _id: { $in: [...ids].map((id) => new ObjectId(id)) } })
        .project({ [field]: 1 })
        .toArray()
      for (const doc of docs) {
        const label = normalizeLabel((doc as Record<string, unknown>)[field])
        // Keyed by collection+id: two entity types may share a collection
        // (routine/event_trigger/automation all live in `automations`).
        if (label) out.set(`${collection}:${(doc as { _id: ObjectId })._id.toString()}`, label)
      }
    }),
  )
  return out
}

// The key `resolveEntityLabels` stores a label under, for a given event.
export const labelKeyFor = (entityType: AuditEntityType, entityId: string): string | null => {
  const source = SOURCES[entityType]
  return source ? `${source.collection}:${entityId}` : null
}

// Searching by NAME has to find what still exists, not only what was deleted (the
// deleted ones are the only rows carrying `entityLabel`). So the term is resolved to
// entity ids first: one owner-scoped query per collection, bounded, with the user's
// text ESCAPED — a search box never becomes a regular expression.
const SEARCH_LIMIT = 100

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export async function findEntityIdsByName(ownerId: string, term: string, entityType?: AuditEntityType): Promise<string[]> {
  const needle = term.trim().slice(0, 120)
  if (!needle) return []
  const collections = entityType
    ? (SOURCES[entityType] ? [SOURCES[entityType]!] : [])
    : // De-duplicated: several entity types share the automations collection.
      [...new Map(Object.values(SOURCES).map((s) => [`${s!.collection}:${s!.field}`, s!])).values()]

  const found = new Set<string>()
  await Promise.all(
    collections.map(async ({ collection, field }) => {
      const docs = await db
        .collection(collection)
        .find({ ownerId, [field]: { $regex: escapeRegex(needle), $options: 'i' } }, { projection: { _id: 1 } })
        .limit(SEARCH_LIMIT)
        .toArray()
      for (const doc of docs) found.add((doc as { _id: ObjectId })._id.toString())
    }),
  )
  return [...found]
}
