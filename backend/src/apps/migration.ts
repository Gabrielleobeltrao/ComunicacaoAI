// Moving what already exists into the App model, without losing anything.
//
// Three jobs, all idempotent, all additive:
//   1. old `connections` documents learn their `appKey` (they only had `provider`);
//   2. a connected Google account gains an installation mirroring it;
//   3. credentials sitting IN THE CLEAR inside `agent.builtinTools[].config` move
//      into an encrypted installation, and the agent keeps a grant plus the
//      non-secret selection.
//
// Nothing is deleted. A legacy entry stays on the agent, stamped `migratedAt`, so a
// rollback reads the old shape and the new one resolves the credential from the
// installation. Running this twice creates no second installation and no second
// grant — the fingerprint below is what makes that true.
import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { encrypt } from '../crypto.js'
import type { Agent, AgentBuiltinTool } from '../agents.js'
import type { AgentAppGrant, AppInstallation } from './types.js'
import { getApp, LEGACY_ACTION_KEYS, resolveAppKey, splitLegacyConfig, SYSTEM_APPS } from './registry.js'
import { LEGACY_APP_VERSION } from './installations.js'

export interface AppMigrationReport {
  // Counts and ids only — never a value (plan §9.10).
  connectionsBackfilled: number
  googleInstallations: number
  installationsCreated: number
  agentsMigrated: number
  grantsCreated: number
  webChatInstallations: number
  whatsappInstallations: number
}

const installations = db.collection<AppInstallation>('connections')
const agents = db.collection<Agent>('agents')
const integrations = db.collection<{ ownerId: string; provider: string; accountEmail?: string; scope?: string; createdAt?: Date }>('integrations')

// Same credential ⇒ same installation, whichever agent carried it. Hashed so the
// dedup key itself never holds a secret.
export const credentialFingerprint = (appKey: string, credential: Record<string, string>): string => {
  const stable = Object.keys(credential)
    .sort()
    .map((k) => `${k}=${credential[k]}`)
    .join('&')
  return createHash('sha256').update(`${appKey}|${stable}`).digest('hex').slice(0, 32)
}

// 1. Every connection document learns which App it is.
async function backfillConnectionAppKeys(): Promise<number> {
  let touched = 0
  for (const app of SYSTEM_APPS) {
    const r = await installations.updateMany(
      { appKey: { $exists: false }, provider: app.key },
      { $set: { appKey: app.key, appVersion: LEGACY_APP_VERSION } },
    )
    touched += r.modifiedCount
  }
  // `scopes` predates `grantedScopes`; keep both readable.
  const scoped = await installations.updateMany(
    { grantedScopes: { $exists: false }, scopes: { $exists: true } },
    [{ $set: { grantedScopes: '$scopes' } }],
  )
  return touched + scoped.modifiedCount
}

// 2. A connected Google account becomes an installation.
//
// The OAuth tokens stay in `integrations`: that is where the refresh flow reads and
// writes them, and moving them would mean rewriting a working credential rotation in
// the same change. The installation MIRRORS the connection so Apps can show it,
// grant it and revoke it; `publicMetadata.tokenStore` records where the tokens live
// so the next round can move them without guessing.
export async function ensureGoogleInstallation(ownerId: string): Promise<boolean> {
  const google = getApp('google')
  const integration = google ? await integrations.findOne({ ownerId, provider: 'google' }) : null
  if (!google || !integration) return false

  const publicMetadata = { tokenStore: 'integrations', ...(integration.accountEmail ? { account: integration.accountEmail } : {}) }
  const grantedScopes = integration.scope ? integration.scope.split(' ').filter(Boolean) : (google.auth.scopes ?? [])
  const existing = await installations.findOne({ ownerId, appKey: 'google' })
  if (existing) {
    // Reconnecting an account that was revoked must bring it back, with the scopes
    // Google actually granted this time.
    await installations.updateOne(
      { _id: existing._id, ownerId },
      { $set: { status: 'connected', publicMetadata, grantedScopes, appVersion: google.version, updatedAt: new Date() } },
    )
    return false
  }

  const now = new Date()
  await installations.insertOne({
    _id: new ObjectId(),
    ownerId,
    buildingId: null,
    appKey: 'google',
    appVersion: google.version,
    name: integration.accountEmail ? `Google (${integration.accountEmail})` : 'Google',
    status: 'connected',
    // The credential is NOT copied: it stays in `integrations`.
    encryptedConfig: encrypt('{}'),
    publicMetadata,
    grantedScopes,
    createdAt: integration.createdAt ?? now,
    updatedAt: now,
    lastTestedAt: null,
  })
  return true
}

// Disconnecting the Google account must invalidate every grant pointing at it — the
// installation stays as history, revoked.
export async function revokeGoogleInstallation(ownerId: string): Promise<void> {
  await installations.updateMany({ ownerId, appKey: 'google' }, { $set: { status: 'revoked', updatedAt: new Date() } })
}

async function ensureGoogleInstallations(): Promise<number> {
  let created = 0
  const owners = (await integrations.distinct('ownerId', { provider: 'google' })) as string[]
  for (const ownerId of owners) {
    if (await ensureGoogleInstallation(ownerId)) created++
  }
  return created
}

// 3. Credentials out of the agent document.
async function migrateAgentBuiltinTools(): Promise<{ installationsCreated: number; agentsMigrated: number; grantsCreated: number }> {
  let installationsCreated = 0
  let agentsMigrated = 0
  let grantsCreated = 0

  const pending = await agents.find({ builtinTools: { $exists: true, $ne: [] } }).toArray()
  for (const agent of pending) {
    const entries = (agent.builtinTools ?? []).filter((e) => !e.migratedAt)
    if (entries.length === 0) continue

    const grants = new Map<string, AgentAppGrant>((agent.appGrants ?? []).map((g) => [g.appKey, { ...g }]))
    const migratedEntries: AgentBuiltinTool[] = []
    let changed = false

    for (const entry of entries) {
      const appKey = resolveAppKey(entry.key)
      const app = getApp(appKey)
      const actionKeys = LEGACY_ACTION_KEYS[entry.key] ?? []
      if (!app || actionKeys.length === 0) continue

      const { credential, resource } = splitLegacyConfig(entry.key, entry.config ?? {})
      const needsCredential = (app.auth.fields ?? []).some((f) => f.required)
      // An entry whose credential was never filled in is not a connection; leave it
      // exactly as it is rather than creating an empty installation.
      if (needsCredential && Object.keys(credential).length === 0) continue

      const installationId = await ensureInstallation(agent.ownerId, appKey, credential, app.version, app.name, () => {
        installationsCreated++
      })
      // Google without a connected account: nothing to grant yet, and the legacy
      // entry keeps working the moment the owner connects.
      if (!installationId) continue

      const existing = grants.get(appKey)
      const grant: AgentAppGrant = existing ?? {
        installationId: installationId.toString(),
        appKey,
        actionKeys: [],
        resourceConfig: {},
        autonomousWriteActionKeys: [],
      }
      const before = JSON.stringify(grant)
      grant.installationId = installationId.toString()
      grant.actionKeys = [...new Set([...grant.actionKeys, ...actionKeys])]
      grant.resourceConfig = { ...grant.resourceConfig, ...resource }
      // Behaviour is PRESERVED, not tightened: enabling the app used to allow every
      // action it offered, writes included. Taking that away here would silently
      // break agents that already create events or register contacts.
      const writes = app.actions.filter((a) => actionKeys.includes(a.key) && a.risk !== 'read').map((a) => a.key)
      grant.autonomousWriteActionKeys = [...new Set([...grant.autonomousWriteActionKeys, ...writes])]
      if (!existing) grantsCreated++
      if (JSON.stringify(grant) !== before) changed = true
      grants.set(appKey, grant)

      // The credential leaves the agent document; the non-secret selection stays
      // readable for a rollback.
      migratedEntries.push({ key: entry.key, config: resource, migratedAt: new Date() })
    }

    if (!changed && migratedEntries.length === 0) continue

    const migratedKeys = new Set(migratedEntries.map((e) => e.key))
    const builtinTools = (agent.builtinTools ?? []).map((e) => migratedEntries.find((m) => m.key === e.key) ?? e)
    await agents.updateOne(
      { _id: agent._id, ownerId: agent.ownerId },
      { $set: { appGrants: [...grants.values()], builtinTools } },
    )
    if (migratedKeys.size > 0) agentsMigrated++
  }

  return { installationsCreated, agentsMigrated, grantsCreated }
}

async function ensureInstallation(
  ownerId: string,
  appKey: string,
  credential: Record<string, string>,
  version: string,
  appName: string,
  onCreate: () => void,
): Promise<ObjectId | null> {
  // Google is connected by OAuth: its installation comes from `integrations`, and if
  // the owner never connected there is nothing to point a grant at.
  if (appKey === 'google') {
    const existing = await installations.findOne({ ownerId, appKey: 'google' })
    return existing?._id ?? null
  }

  const fingerprint = credentialFingerprint(appKey, credential)
  const existing = await installations.findOne({ ownerId, appKey, 'publicMetadata.legacyFingerprint': fingerprint })
  if (existing) return existing._id

  const now = new Date()
  const _id = new ObjectId()
  await installations.insertOne({
    _id,
    ownerId,
    buildingId: null,
    appKey,
    appVersion: version,
    name: appName,
    status: 'connected',
    encryptedConfig: encrypt(JSON.stringify(credential)),
    publicMetadata: { legacyFingerprint: fingerprint, migratedFrom: 'builtinTools' },
    grantedScopes: [],
    createdAt: now,
    updatedAt: now,
    lastTestedAt: null,
  })
  onCreate()
  return _id
}

// 4. The channels that already exist BECOME Apps.
//
// A widget or a connected number is exactly what an installation describes, so an
// owner who already uses them must find the App active — not be asked to activate
// something they have been using for months. Nothing is copied: no conversation, no
// message, no widget id, no provider config. Only a row saying "this account uses
// this App", pointing at what is already there.
async function registerChannelApps(): Promise<{ webChat: number; whatsapp: number }> {
  const widgets = db.collection<{ _id: ObjectId; ownerId: string; channel?: string; name?: string; createdAt?: Date }>('widgets')
  let webChat = 0
  let whatsapp = 0

  const webOwners = (await widgets.distinct('ownerId', { channel: { $ne: 'whatsapp' } })) as string[]
  for (const ownerId of webOwners) {
    if (await ensureChannelInstallation(ownerId, 'web_chat')) webChat++
  }

  // One installation per connected NUMBER: the credentials stay in the channel
  // document, which is what the webhook and the adapters already read.
  const numbers = await widgets.find({ channel: 'whatsapp' }).toArray()
  for (const number of numbers) {
    if (await ensureChannelInstallation(number.ownerId, 'whatsapp', number)) whatsapp++
  }
  return { webChat, whatsapp }
}

async function ensureChannelInstallation(
  ownerId: string,
  appKey: 'web_chat' | 'whatsapp',
  channel?: { _id: ObjectId; name?: string; createdAt?: Date },
): Promise<boolean> {
  const app = getApp(appKey)
  if (!app) return false
  // The channel id is the idempotency key: a second run finds the same row.
  const filter = channel ? { ownerId, appKey, 'publicMetadata.channelId': channel._id.toString() } : { ownerId, appKey }
  if (await installations.findOne(filter)) return false

  const now = new Date()
  await installations.insertOne({
    _id: new ObjectId(),
    ownerId,
    buildingId: null,
    appKey,
    appVersion: app.version,
    name: channel?.name ? `WhatsApp · ${channel.name}` : app.name,
    status: 'connected',
    // No credential is moved: the channel keeps its own encrypted provider config.
    encryptedConfig: encrypt('{}'),
    publicMetadata: channel ? { channelId: channel._id.toString(), configStore: 'widgets' } : { configStore: 'widgets' },
    grantedScopes: [],
    createdAt: channel?.createdAt ?? now,
    updatedAt: now,
    lastTestedAt: null,
  })
  return true
}

export async function migrateAppsAndInstallations(): Promise<AppMigrationReport> {
  const connectionsBackfilled = await backfillConnectionAppKeys()
  const googleInstallations = await ensureGoogleInstallations()
  const agentsResult = await migrateAgentBuiltinTools()
  const channels = await registerChannelApps()
  return {
    connectionsBackfilled,
    googleInstallations,
    installationsCreated: agentsResult.installationsCreated,
    agentsMigrated: agentsResult.agentsMigrated,
    grantsCreated: agentsResult.grantsCreated,
    webChatInstallations: channels.webChat,
    whatsappInstallations: channels.whatsapp,
  }
}
