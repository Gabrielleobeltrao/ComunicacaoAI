// What a channel App's "Visão geral" page shows.
//
// Every number here is counted from what really exists — widgets, channels,
// conversations, messages, deliveries. Nothing is estimated, and a channel with no
// history reports null rather than a zero that would read as "it ran and produced
// nothing". No message content, phone number or conversation text leaves this module.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { listValidChannels } from './channelApps.js'

export type ChannelAppKey = 'web_chat' | 'whatsapp'

export interface ChannelOverview {
  appKey: ChannelAppKey
  // Channels/widgets that can actually receive.
  channels: { id: string; name: string; agentId: string | null; sectorId: string | null; ready: boolean }[]
  conversations: number
  conversations7d: number
  messages7d: number
  // Conversations waiting for a person.
  handoffs: number
  // Null when there is nothing to measure — never a fabricated zero.
  avgResponseMs: number | null
  lastMessageAt: string | null
}

const widgets = db.collection<{
  _id: ObjectId
  ownerId: string
  name: string
  channel?: string
  agentId?: ObjectId | null
  sectorId?: ObjectId | null
  whatsapp?: { provider?: string; encryptedConfig?: string }
}>('widgets')
const messages = db.collection<{ widgetId: ObjectId; conversationId: string; role: string; createdAt: Date }>('widget_messages')

export async function channelOverview(ownerId: string, appKey: ChannelAppKey): Promise<ChannelOverview> {
  // Legacy documents have no `channel` field and are web by definition.
  const filter = appKey === 'whatsapp' ? { ownerId, channel: 'whatsapp' } : { ownerId, channel: { $ne: 'whatsapp' } }
  const docs = await widgets.find(filter).sort({ createdAt: -1 }).toArray()
  const validIds = appKey === 'whatsapp' ? new Set((await listValidChannels(ownerId, 'whatsapp')).map((c) => c._id.toString())) : null

  const channels = docs.map((d) => ({
    id: d._id.toString(),
    name: d.name,
    agentId: d.agentId ? d.agentId.toString() : null,
    sectorId: d.sectorId ? d.sectorId.toString() : null,
    // For WhatsApp, ready means a provider and its config really exist.
    ready: validIds ? validIds.has(d._id.toString()) : true,
  }))

  const ids = docs.map((d) => d._id)
  if (ids.length === 0) {
    return { appKey, channels, conversations: 0, conversations7d: 0, messages7d: 0, handoffs: 0, avgResponseMs: null, lastMessageAt: null }
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [distinct, recent, messages7d, handoffs, latest, responses] = await Promise.all([
    messages.distinct('conversationId', { widgetId: { $in: ids } }),
    messages.distinct('conversationId', { widgetId: { $in: ids }, createdAt: { $gte: since } }),
    messages.countDocuments({ widgetId: { $in: ids }, createdAt: { $gte: since } }),
    db.collection('conversation_memories').countDocuments({ widgetId: { $in: ids }, humanHandoff: true }),
    messages.find({ widgetId: { $in: ids } }).sort({ createdAt: -1 }).limit(1).toArray(),
    // Response time = visitor message → the agent's next message in the same
    // conversation. Bounded to the recent window so one ancient thread cannot skew it.
    messages
      .find({ widgetId: { $in: ids }, createdAt: { $gte: since } }, { projection: { conversationId: 1, role: 1, createdAt: 1 } })
      .sort({ createdAt: 1 })
      .limit(2000)
      .toArray(),
  ])

  const pendingByConversation = new Map<string, Date>()
  const deltas: number[] = []
  for (const m of responses) {
    if (m.role === 'visitor') {
      if (!pendingByConversation.has(m.conversationId)) pendingByConversation.set(m.conversationId, m.createdAt)
      continue
    }
    const asked = pendingByConversation.get(m.conversationId)
    if (asked) {
      deltas.push(Math.max(0, m.createdAt.getTime() - asked.getTime()))
      pendingByConversation.delete(m.conversationId)
    }
  }

  return {
    appKey,
    channels,
    conversations: distinct.length,
    conversations7d: recent.length,
    messages7d,
    handoffs,
    avgResponseMs: deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null,
    lastMessageAt: latest[0]?.createdAt ? latest[0].createdAt.toISOString() : null,
  }
}
