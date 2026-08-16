// Apps whose activation IS a real channel.
//
// WhatsApp is active because a number is connected, not because someone submitted a
// form. Its manifest declares no credential field, so the generic connect flow would
// happily write a "connected" installation with no number and no provider — and the
// office map, the metrics and the agents would all repeat that lie.
//
// So the truth lives where it always lived: the channel document, with its own
// encrypted provider config. This module answers one question — is there a real
// channel behind this installation? — and keeps the installation row in sync with the
// answer. No credential is copied, no provider is duplicated.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { getApp } from './registry.js'
import { activationOf } from './registry.js'
import type { AppDefinition, AppInstallation } from './types.js'

const installations = db.collection<AppInstallation>('connections')
const channels = db.collection<{
  _id: ObjectId
  ownerId: string
  channel?: string
  name?: string
  whatsapp?: { provider?: string; encryptedConfig?: string }
}>('widgets')

export const isManagedChannelApp = (app: AppDefinition): boolean => activationOf(app) === 'managed_channel'

// A channel is valid when it can actually receive and send: a provider and its stored
// config. A row with neither is a draft somebody abandoned, not a connection.
const isValidChannel = (c: { whatsapp?: { provider?: string; encryptedConfig?: string } }): boolean =>
  Boolean(c.whatsapp?.provider && c.whatsapp?.encryptedConfig)

export async function listValidChannels(ownerId: string, appKey: string): Promise<{ _id: ObjectId; name: string }[]> {
  if (appKey !== 'whatsapp') return []
  const docs = await channels.find({ ownerId, channel: 'whatsapp' }).toArray()
  return docs.filter(isValidChannel).map((c) => ({ _id: c._id, name: c.name ?? 'Número' }))
}

export async function hasValidChannel(ownerId: string, appKey: string, channelId?: string | null): Promise<boolean> {
  if (appKey !== 'whatsapp') return false
  if (channelId && ObjectId.isValid(channelId)) {
    const doc = await channels.findOne({ _id: new ObjectId(channelId), ownerId, channel: 'whatsapp' })
    return Boolean(doc && isValidChannel(doc))
  }
  return (await listValidChannels(ownerId, appKey)).length > 0
}

export interface ChannelSyncReport {
  revoked: number
  reconnected: number
}

// Reconcile installations of a managed-channel App with the channels that really
// exist. Idempotent and non-destructive: it only moves the installation's STATUS.
// No conversation, message, number or provider config is ever touched.
export async function syncManagedChannelInstallations(ownerId: string, appKey = 'whatsapp'): Promise<ChannelSyncReport> {
  const app = getApp(appKey)
  if (!app || !isManagedChannelApp(app)) return { revoked: 0, reconnected: 0 }

  const rows = await installations.find({ ownerId, appKey }).toArray()
  let revoked = 0
  let reconnected = 0

  for (const row of rows) {
    const channelId = row.publicMetadata?.channelId ?? null
    const valid = await hasValidChannel(ownerId, appKey, channelId)

    // An installation that points at no valid channel — including the empty ones the
    // generic form used to create — stops claiming to be connected.
    if (!valid && row.status === 'connected') {
      await installations.updateOne(
        { _id: row._id, ownerId },
        { $set: { status: 'needs_reauth', updatedAt: new Date(), 'publicMetadata.invalidReason': 'sem_canal' } },
      )
      revoked++
      continue
    }
    // The channel came back (or was finally configured): so does the installation.
    if (valid && row.status === 'needs_reauth' && row.publicMetadata?.invalidReason === 'sem_canal') {
      await installations.updateOne(
        { _id: row._id, ownerId },
        { $set: { status: 'connected', updatedAt: new Date() }, $unset: { 'publicMetadata.invalidReason': '' } },
      )
      reconnected++
    }
  }
  return { revoked, reconnected }
}

// The whole account, for the boot migration. Counts only — never a value.
export async function backfillManagedChannelInstallations(): Promise<ChannelSyncReport> {
  const owners = (await installations.distinct('ownerId', { appKey: 'whatsapp' })) as string[]
  const total: ChannelSyncReport = { revoked: 0, reconnected: 0 }
  for (const ownerId of owners) {
    const report = await syncManagedChannelInstallations(ownerId)
    total.revoked += report.revoked
    total.reconnected += report.reconnected
  }
  return total
}

// What "test this connection" means for a managed channel: does a real channel answer
// for it? Never "the manifest declares no required field, so everything is fine".
export async function testManagedChannel(
  ownerId: string,
  installation: AppInstallation,
): Promise<{ ok: boolean; message: string }> {
  const channelId = installation.publicMetadata?.channelId ?? null
  if (channelId) {
    const ok = await hasValidChannel(ownerId, installation.appKey, channelId)
    return ok
      ? { ok: true, message: 'Número conectado e com provedor configurado.' }
      : { ok: false, message: 'O número desta conexão não existe mais ou está sem provedor configurado.' }
  }
  const valid = await listValidChannels(ownerId, installation.appKey)
  return valid.length > 0
    ? { ok: true, message: `${valid.length} número(s) conectado(s).` }
    : { ok: false, message: 'Nenhum número do WhatsApp está conectado. Conecte um número em Apps → WhatsApp → Números.' }
}
