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
  return docs.map((d) => d.manifest)
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

export async function deletePrivateApp(ownerId: string, key: string): Promise<boolean> {
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
  return getSystemApp(key) ?? (await getPrivateApp(ownerId, key))
}

// Re-validated on read as well as on write: a document edited outside the API (or
// written by an older, laxer version) must not become an execution path.
export const isUsableManifest = (manifest: AppDefinition): boolean => validateAppManifest(manifest).valid
