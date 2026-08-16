// Apps the owner writes themselves.
//
// A private App is a MANIFEST: several declarative HTTP actions, validated by the
// same rules a community package will face. It can never point at compiled code,
// never declare a page, and never carry a credential — the credential belongs to the
// installation, which is why a manifest can be exported and handed to someone else
// who supplies their own.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { ValidationError } from '../building.js'
import { describeManifestIssues, exportableManifest, sanitizeImportedManifest, validateAppManifest } from './manifest.js'
import { SYSTEM_APPS } from './registry.js'
import { getApp as getSystemApp } from './registry.js'
import type { AppDefinition } from './types.js'

export interface PrivateAppDoc {
  _id: ObjectId
  ownerId: string
  key: string
  version: string
  manifest: AppDefinition
  createdAt: Date
  updatedAt: Date
}

const privateApps = db.collection<PrivateAppDoc>('app_definitions')

export async function ensurePrivateAppIndexes(): Promise<void> {
  await privateApps.createIndex({ ownerId: 1, key: 1 }, { unique: true })
}

const RESERVED = new Set(SYSTEM_APPS.map((a) => a.key))

function normalize(input: unknown, ownerId: string): AppDefinition {
  const { manifest, errors } = sanitizeImportedManifest(input)
  if (!manifest) throw new ValidationError(describeManifestIssues(errors))
  // Drop the keys the sanitizer nulled out: the driver stores an explicit
  // `undefined` as null, and a stored null is not the same as absent.
  const record = manifest as unknown as Record<string, unknown>
  for (const key of ['surfaces', 'sidebar', 'icon', 'documentationUrl']) {
    if (record[key] === undefined || record[key] === null) delete record[key]
  }
  // A private App may not shadow a system one: the same key would make "which App is
  // this?" ambiguous at resolution time.
  if (RESERVED.has(manifest.key)) throw new ValidationError(`a chave "${manifest.key}" pertence a um App do sistema`)
  void ownerId
  return manifest
}

export async function listPrivateApps(ownerId: string): Promise<AppDefinition[]> {
  const docs = await privateApps.find({ ownerId }).sort({ createdAt: -1 }).toArray()
  // Re-validated on the way out too. A document edited straight in the database, or
  // written by an older and laxer version, is not allowed to become a live App just
  // because it is already stored.
  return docs.map((d) => d.manifest).filter(isUsableManifest)
}

// THE resolver. System Apps plus the owner's own, in that order — so catalog,
// installation, grant validation and runtime can never disagree about which App a
// key means, and one account's App is invisible to another.
export async function listAppsForOwner(ownerId: string): Promise<AppDefinition[]> {
  return [...SYSTEM_APPS, ...(await listPrivateApps(ownerId))]
}

export async function getPrivateApp(ownerId: string, key: string): Promise<AppDefinition | null> {
  const doc = await privateApps.findOne({ ownerId, key })
  return doc?.manifest ?? null
}

export async function createPrivateApp(ownerId: string, input: unknown): Promise<AppDefinition> {
  const manifest = normalize(input, ownerId)
  const now = new Date()
  try {
    await privateApps.insertOne({ _id: new ObjectId(), ownerId, key: manifest.key, version: manifest.version, manifest, createdAt: now, updatedAt: now })
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new ValidationError('já existe um App privado com esta chave')
    throw error
  }
  return manifest
}

export async function updatePrivateApp(ownerId: string, key: string, input: unknown): Promise<AppDefinition | null> {
  const existing = await privateApps.findOne({ ownerId, key })
  if (!existing) return null
  const manifest = normalize({ ...(input as object), key }, ownerId)
  // A change to what an App can reach or do is a NEW version: an installation pinned
  // to the old one keeps working until the owner reviews it.
  const changedSurface =
    JSON.stringify(existing.manifest.actions) !== JSON.stringify(manifest.actions) ||
    JSON.stringify(existing.manifest.allowedDomains) !== JSON.stringify(manifest.allowedDomains)
  if (changedSurface && manifest.version === existing.version) {
    throw new ValidationError('mudou ações ou domínios: informe uma nova versão')
  }
  await privateApps.updateOne({ _id: existing._id }, { $set: { manifest, version: manifest.version, updatedAt: new Date() } })
  return manifest
}

// What breaks if this App goes away. Asked before deleting, and shown to the owner
// as a sentence rather than as a failed request.
export interface PrivateAppImpact {
  installations: number
  connectedInstallations: number
  agents: number
  archived: boolean
}

export async function privateAppImpact(ownerId: string, key: string): Promise<PrivateAppImpact | null> {
  const doc = await privateApps.findOne({ ownerId, key })
  if (!doc) return null
  const installed = await db.collection('connections').find({ ownerId, appKey: key, status: { $ne: 'revoked' } }).toArray()
  const ids = installed.map((i) => (i._id as ObjectId).toString())
  const agents = ids.length
    ? await db.collection('agents').countDocuments({ ownerId, 'appGrants.installationId': { $in: ids.map((id) => new ObjectId(id)) } })
    : 0
  return {
    installations: installed.length,
    connectedInstallations: installed.filter((i) => i.status === 'connected').length,
    agents,
    archived: doc.manifest.status === 'suspended',
  }
}

// Archiving is the reversible half: the App stops being offered and stops resolving
// for the runtime, but the connections and grants stay exactly where they are, so
// nothing is silently destroyed and the owner can undo it.
export async function archivePrivateApp(ownerId: string, key: string, archived: boolean): Promise<AppDefinition | null> {
  const doc = await privateApps.findOne({ ownerId, key })
  if (!doc) return null
  const manifest = { ...doc.manifest, status: archived ? ('suspended' as const) : ('published' as const) }
  await privateApps.updateOne({ _id: doc._id }, { $set: { manifest, updatedAt: new Date() } })
  return manifest
}

// Deleting is the irreversible half, and it refuses while anything still depends on
// it. The caller gets the impact back, not a bare error, so the UI can say what to
// revoke first instead of just failing.
export async function deletePrivateApp(ownerId: string, key: string): Promise<boolean> {
  const impact = await privateAppImpact(ownerId, key)
  if (!impact) return false
  if (impact.installations > 0 || impact.agents > 0) {
    throw new ValidationError(
      `este App ainda tem ${impact.installations} conexão(ões) e ${impact.agents} agente(s) usando. Desconecte e revogue antes de excluir, ou arquive o App.`,
    )
  }
  const r = await privateApps.deleteOne({ ownerId, key })
  return r.deletedCount === 1
}

// A manifest ready to hand to someone else. It carries no credential by construction
// — the manifest never had one — and it comes back as a draft on import.
export async function exportPrivateApp(ownerId: string, key: string): Promise<Omit<AppDefinition, 'status'> | null> {
  const manifest = await getPrivateApp(ownerId, key)
  return manifest ? exportableManifest(manifest) : null
}

// System first, then the owner's own. One lookup, so the runtime and the API can
// never disagree about which App a grant points at.
export async function resolveAppForOwner(ownerId: string, key: string): Promise<AppDefinition | null> {
  const system = getSystemApp(key)
  if (system) return system
  const own = await getPrivateApp(ownerId, key)
  // An archived App still resolves for what is already connected — pulling the tool
  // out from under a running agent is worse than letting it finish — but it is
  // filtered out of the catalog, so nothing NEW can be connected to it.
  return own && isUsableManifest(own) ? own : null
}

// Re-validated on read as well as on write: a document edited outside the API (or
// written by an older, laxer version) must not become an execution path.
export const isUsableManifest = (manifest: AppDefinition): boolean => validateAppManifest(manifest).valid
