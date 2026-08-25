// An installation is the owner's account for an App: the credential, encrypted, in
// ONE place. It evolves the `connections` collection instead of opening a second
// source of truth — a document written before this model keeps working, and the
// delivery flow keeps resolving connections by `provider`.
//
// Nothing here ever returns a credential. The public DTO has no field that could
// carry one, and `decryptInstallationConfig` is internal to the runtime.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { decrypt, encrypt } from '../crypto.js'
import { ValidationError } from '../building.js'
import type { AppDefinition } from './types.js'
import { isUsableApp } from './types.js'
import type { AppEnvironment, AppInstallation, AppInstallationPublic, InstallationStatus } from './types.js'
import { INSTALLATION_STATUSES } from './types.js'

// The same collection the delivery flow already reads.
const installations = db.collection<AppInstallation>('connections')

// A document written before Apps existed has no version. It is the first version.
export const LEGACY_APP_VERSION = '1.0.0'

export async function ensureInstallationIndexes(): Promise<void> {
  await installations.createIndex({ ownerId: 1, appKey: 1 })
  await installations.createIndex({ ownerId: 1, status: 1 })
}

// Dual-read: normalise an old `connections` document into an installation without
// touching it. `provider` predates `appKey` and stays readable either way.
export function toInstallation(doc: Partial<AppInstallation> & { _id: ObjectId; ownerId: string }): AppInstallation {
  const appKey = String(doc.appKey ?? doc.provider ?? '')
  const status = INSTALLATION_STATUSES.includes(doc.status as InstallationStatus) ? (doc.status as InstallationStatus) : 'connected'
  return {
    _id: doc._id,
    ownerId: doc.ownerId,
    buildingId: doc.buildingId ?? null,
    appKey,
    appVersion: String(doc.appVersion ?? LEGACY_APP_VERSION),
    name: String(doc.name ?? appKey),
    status,
    encryptedConfig: String(doc.encryptedConfig ?? ''),
    publicMetadata: doc.publicMetadata ?? {},
    grantedScopes: doc.grantedScopes ?? doc.scopes ?? [],
    createdAt: doc.createdAt ?? new Date(0),
    updatedAt: doc.updatedAt ?? doc.createdAt ?? new Date(0),
    lastTestedAt: doc.lastTestedAt ?? null,
    /**
     * Ausente no documento fica ausente AQUI também.
     *
     * Resolver para `default` neste ponto pareceria inofensivo e apagaria a diferença
     * entre "a conexão é padrão" e "este documento é anterior ao campo" — e é o segundo
     * caso que a migração precisa enxergar. Quem quer o valor pronto usa `environmentOf`.
     */
    environment: doc.environment,
    provider: doc.provider,
    scopes: doc.scopes,
  }
}

export const installationPublic = (i: AppInstallation): AppInstallationPublic => ({
  id: i._id.toString(),
  appKey: i.appKey,
  appVersion: i.appVersion,
  name: i.name,
  status: i.status,
  publicMetadata: i.publicMetadata,
  grantedScopes: i.grantedScopes,
  createdAt: i.createdAt.toISOString(),
  updatedAt: i.updatedAt.toISOString(),
  lastTestedAt: i.lastTestedAt ? i.lastTestedAt.toISOString() : null,
  // Ausente no documento = `default`, que é o que toda conexão existente é. A tela
  // recebe sempre o valor resolvido, e não precisa saber que o campo pode faltar.
  environment: i.environment ?? 'default',
})

// What the owner recognises without exposing the account itself.
export function maskAccount(value: string): string {
  const v = value.trim()
  if (!v) return ''
  if (v.includes('@')) {
    const [user, domain] = v.split('@')
    return `${user.slice(0, 2)}***@${domain}`
  }
  return v.length <= 4 ? '***' : `${v.slice(0, 2)}***${v.slice(-2)}`
}

export async function listInstallations(ownerId: string, appKey?: string): Promise<AppInstallation[]> {
  // Dual-read on the filter too: an old email/telegram document only has `provider`.
  const filter: Record<string, unknown> = { ownerId }
  if (appKey) filter.$or = [{ appKey }, { appKey: { $exists: false }, provider: appKey }]
  const docs = await installations.find(filter).sort({ createdAt: -1 }).toArray()
  return docs.map(toInstallation)
}

export async function getInstallation(ownerId: string, id: ObjectId): Promise<AppInstallation | null> {
  // Ownership is part of the query, never an assertion after the fact.
  const doc = await installations.findOne({ _id: id, ownerId })
  return doc ? toInstallation(doc) : null
}

const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

// The credential is checked against the MANIFEST, so a new App needs no new code
// here. Only declared fields survive: an extra key in the request body is dropped
// rather than encrypted and carried forever.
export function normalizeConfig(app: AppDefinition, config: unknown): Record<string, string> {
  const fields = app.auth.fields ?? []
  if (fields.length === 0) return {}
  if (typeof config !== 'object' || config === null) throw new ValidationError('config é obrigatório')
  const input = config as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const field of fields) {
    const value = input[field.key]
    if (value === undefined || value === null || value === '') {
      if (field.required) throw new ValidationError(`campo obrigatório: ${field.label}`)
      continue
    }
    out[field.key] = String(value)
  }
  return out
}

export function normalizeName(name: unknown, fallback: string): string {
  const s = String(name ?? '').trim() || fallback
  if (s.length > 120) throw new ValidationError('nome inválido')
  return s
}

export interface CreateInstallationInput {
  name?: string
  config?: unknown
  publicMetadata?: Record<string, string>
  buildingId?: ObjectId | null
  grantedScopes?: string[]
  /** Ausente = `default`. `live` é recusado neste ciclo — ver `normalizeEnvironment`. */
  environment?: string
}

/**
 * O ambiente que a conexão PODE ter.
 *
 * `live` existe no tipo e é recusado aqui: um ambiente que envia ordem de verdade não
 * passa a existir por uma linha de configuração. Ligá-lo é decisão de produto, e ela não
 * foi tomada — então a API diz isso em voz alta em vez de aceitar e falhar depois.
 */
export function normalizeEnvironment(bruto: unknown): AppEnvironment {
  const v = String(bruto ?? '').trim().toLowerCase()
  if (v === 'live') throw new ValidationError('o ambiente "live" não está liberado neste sistema; use "paper"')
  return v === 'paper' ? 'paper' : 'default'
}

export async function createInstallation(ownerId: string, app: AppDefinition, input: CreateInstallationInput): Promise<AppInstallation> {
  if (app.status === 'suspended') throw new ValidationError('este App não aceita novas conexões')
  // "Em breve" é anúncio, não oferta. Bloquear só na tela deixaria a porta aberta para
  // quem chama a API direto — e uma conexão criada agora ficaria pendurada esperando um
  // fluxo que ainda não existe.
  if (!isUsableApp(app)) throw new ValidationError('este App ainda não está disponível para conectar')
  if (!app.supportsMultipleConnections) {
    const existing = await listInstallations(ownerId, app.key)
    if (existing.some((i) => i.status !== 'revoked')) throw new ValidationError('este App já está conectado nesta conta')
  }
  const config = normalizeConfig(app, input.config ?? {})
  const now = new Date()
  const doc: AppInstallation = {
    _id: new ObjectId(),
    ownerId,
    buildingId: input.buildingId ?? null,
    appKey: app.key,
    appVersion: app.version,
    name: normalizeName(input.name, app.name),
    status: 'connected',
    encryptedConfig: encrypt(JSON.stringify(config)),
    publicMetadata: input.publicMetadata ?? {},
    // Least privilege: an installation may only be granted what the App declares.
    grantedScopes: (input.grantedScopes ?? app.auth.scopes ?? []).filter((s) => (app.auth.scopes ?? []).includes(s) || !app.auth.scopes),
    createdAt: now,
    updatedAt: now,
    lastTestedAt: null,
    // O App decide o padrão quando o pedido não diz — ver `defaultEnvironment`.
    environment: normalizeEnvironment(input.environment ?? app.defaultEnvironment),
  }
  await installations.insertOne(doc)
  return doc
}

export interface PatchInstallationInput {
  name?: string
  config?: unknown
  publicMetadata?: Record<string, string>
  status?: InstallationStatus
}

export async function patchInstallation(
  ownerId: string,
  id: ObjectId,
  app: AppDefinition,
  patch: PatchInstallationInput,
): Promise<AppInstallation | null> {
  const existing = await getInstallation(ownerId, id)
  if (!existing) return null
  const set: Partial<AppInstallation> = { updatedAt: new Date() }
  if (patch.name !== undefined) set.name = normalizeName(patch.name, existing.name)
  if (patch.publicMetadata !== undefined) set.publicMetadata = patch.publicMetadata
  if (patch.status !== undefined) {
    if (!INSTALLATION_STATUSES.includes(patch.status)) throw new ValidationError('status inválido')
    set.status = patch.status
  }
  if (patch.config !== undefined) {
    // A secret is never re-shown, so an omitted field means "keep the current one"
    // rather than "clear it" — otherwise renaming a connection would wipe its token.
    const current = existing.encryptedConfig ? (JSON.parse(decrypt(existing.encryptedConfig)) as Record<string, string>) : {}
    const incoming = (patch.config ?? {}) as Record<string, unknown>
    const merged: Record<string, unknown> = { ...current }
    for (const field of app.auth.fields ?? []) {
      const value = incoming[field.key]
      if (value !== undefined && value !== null && value !== '') merged[field.key] = value
    }
    set.encryptedConfig = encrypt(JSON.stringify(normalizeConfig(app, merged)))
    // New credential ⇒ the connection is worth trusting again.
    if (existing.status === 'needs_reauth' || existing.status === 'error') set.status = 'connected'
  }
  const r = await installations.findOneAndUpdate({ _id: id, ownerId }, { $set: set }, { returnDocument: 'after' })
  return r ? toInstallation(r) : null
}

export async function markInstallationTested(ownerId: string, id: ObjectId, ok: boolean): Promise<void> {
  await installations.updateOne(
    { _id: id, ownerId },
    { $set: { lastTestedAt: new Date(), updatedAt: new Date(), ...(ok ? { status: 'connected' as const } : { status: 'error' as const }) } },
  )
}

// Disconnecting REVOKES: the credential stops working immediately, and nothing the
// owner produced with it is deleted. Wiping history is a separate, explicit action.
export async function revokeInstallation(ownerId: string, id: ObjectId): Promise<boolean> {
  const r = await installations.updateOne(
    { _id: id, ownerId },
    { $set: { status: 'revoked' as const, encryptedConfig: encrypt('{}'), updatedAt: new Date() } },
  )
  return r.matchedCount === 1
}

export async function deleteInstallation(ownerId: string, id: ObjectId): Promise<boolean> {
  const r = await installations.deleteOne({ _id: id, ownerId })
  return r.deletedCount === 1
}

// Internal only — never exposed by the API, never logged.
export function decryptInstallationConfig(installation: AppInstallation): Record<string, string> {
  if (!installation.encryptedConfig) return {}
  try {
    const parsed = JSON.parse(decrypt(installation.encryptedConfig))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

// A revoked or broken installation must not resolve into a working tool, even for a
// run that started before it was revoked.
export const isInstallationUsable = (i: AppInstallation | null): boolean => i?.status === 'connected'
