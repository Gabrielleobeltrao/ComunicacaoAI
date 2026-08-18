import { randomBytes } from 'crypto'
import { ensureActivationMode } from './agents.js'
import { TRIGGER_FOR_CONFIG } from './agentReadiness.js'
import { ObjectId } from 'mongodb'
import { db } from './db.js'

export type WidgetPosition = 'right' | 'left'

// A widget is a conversation channel that links an agent/sector to visitors.
// 'web' is the embeddable chat; 'whatsapp' is a connected WhatsApp number that
// reuses the same conversation/reply/Chats stack (see whatsapp.ts).
export interface WhatsAppChannelConfig {
  provider: string
  // encrypt(JSON.stringify(providerConfig)) — decrypted only when sending.
  configEnc: string
  // The connected business number, for display (optional).
  number?: string | null
}

export interface Widget {
  _id: ObjectId
  ownerId: string
  name: string
  publicKey: string
  createdAt: Date
  primaryColor: string | null
  welcomeTitle: string | null
  welcomeMessage: string | null
  position: WidgetPosition
  avatarUrl: string | null
  agentId: ObjectId | null
  sectorId: ObjectId | null
  // Absent on legacy docs = 'web'.
  channel?: 'web' | 'whatsapp'
  whatsapp?: WhatsAppChannelConfig
}

export interface WidgetMessage {
  _id: ObjectId
  widgetId: ObjectId
  conversationId: string
  role: 'visitor' | 'agent'
  content: string
  // For sector-routed replies: which specialist agent answered (shown in Chats).
  agentName?: string | null
  // Provider message id for inbound channel messages (dedupes webhook retries).
  externalId?: string | null
  /**
   * Este turno do agente foi uma PERGUNTA de esclarecimento, e as alternativas que ele
   * ofereceu.
   *
   * Ficam guardados porque num canal não existe cliente para devolvê-los: quando a
   * próxima mensagem chegar, é daqui que sai o "2 significa a segunda opção" e a conta
   * de quantas vezes já se perguntou. Sem isso o teto e a leitura da escolha valem no
   * Playground e não valem no WhatsApp — que é onde a conversa realmente acontece.
   */
  clarification?: boolean
  clarificationOptions?: string[]
  createdAt: Date
}

const widgets = db.collection<Widget>('widgets')
const widgetMessages = db.collection<WidgetMessage>('widget_messages')

export async function createWidget(
  ownerId: string,
  name: string,
  options: {
    primaryColor?: string | null
    welcomeTitle?: string | null
    welcomeMessage?: string | null
    position?: WidgetPosition
    agentId?: ObjectId | null
    sectorId?: ObjectId | null
  } = {},
) {
  const widget: Omit<Widget, '_id'> = {
    ownerId,
    name,
    publicKey: randomBytes(9).toString('base64url'),
    createdAt: new Date(),
    primaryColor: options.primaryColor ?? null,
    welcomeTitle: options.welcomeTitle ?? null,
    welcomeMessage: options.welcomeMessage ?? null,
    position: options.position ?? 'right',
    avatarUrl: null,
    agentId: options.agentId ?? null,
    sectorId: options.sectorId ?? null,
  }
  const result = await widgets.insertOne(widget as Widget)
  // A channel that really points at an agent also makes 'channel' an allowed trigger,
  // so the agent page never shows a live channel as "desligado".
  if (widget.agentId) await ensureActivationMode(ownerId, widget.agentId, TRIGGER_FOR_CONFIG.channel)
  return { ...widget, _id: result.insertedId }
}

// --- WhatsApp channels (widgets with channel: 'whatsapp') -----------------

export async function createWhatsAppChannel(
  ownerId: string,
  name: string,
  whatsapp: WhatsAppChannelConfig,
  options: { agentId?: ObjectId | null; sectorId?: ObjectId | null } = {},
) {
  const widget: Omit<Widget, '_id'> = {
    ownerId,
    name,
    publicKey: randomBytes(9).toString('base64url'),
    createdAt: new Date(),
    primaryColor: null,
    welcomeTitle: null,
    welcomeMessage: null,
    position: 'right',
    avatarUrl: null,
    agentId: options.agentId ?? null,
    sectorId: options.sectorId ?? null,
    channel: 'whatsapp',
    whatsapp,
  }
  const result = await widgets.insertOne(widget as Widget)
  if (widget.agentId) await ensureActivationMode(ownerId, widget.agentId, TRIGGER_FOR_CONFIG.channel)
  return { ...widget, _id: result.insertedId }
}

export function listWhatsAppChannels(ownerId: string) {
  return widgets.find({ ownerId, channel: 'whatsapp' }).sort({ createdAt: -1 }).toArray()
}

export async function updateWhatsAppChannel(
  ownerId: string,
  channelId: ObjectId,
  updates: {
    name?: string
    agentId?: ObjectId | null
    sectorId?: ObjectId | null
    whatsapp?: WhatsAppChannelConfig
  },
) {
  const set: Partial<Widget> = {}
  if (updates.name !== undefined) set.name = updates.name
  if (updates.agentId !== undefined) set.agentId = updates.agentId
  if (updates.sectorId !== undefined) set.sectorId = updates.sectorId
  if (updates.whatsapp !== undefined) set.whatsapp = updates.whatsapp
  if (Object.keys(set).length > 0) {
    await widgets.updateOne({ _id: channelId, ownerId, channel: 'whatsapp' }, { $set: set })
    if (set.agentId) await ensureActivationMode(ownerId, set.agentId, TRIGGER_FOR_CONFIG.channel)
  }
  return widgets.findOne({ _id: channelId, ownerId, channel: 'whatsapp' })
}

export async function deleteWhatsAppChannel(ownerId: string, channelId: ObjectId) {
  const channel = await widgets.findOne({ _id: channelId, ownerId, channel: 'whatsapp' })
  if (!channel) return false
  await widgetMessages.deleteMany({ widgetId: channelId })
  await widgets.deleteOne({ _id: channelId, ownerId })
  return true
}

export function listWidgets(ownerId: string) {
  // Only the embeddable web widgets; WhatsApp channels are managed separately.
  return widgets.find({ ownerId, channel: { $ne: 'whatsapp' } }).sort({ createdAt: -1 }).toArray()
}

export function getWidgetByPublicKey(publicKey: string) {
  return widgets.findOne({ publicKey })
}

export function getWidgetById(widgetId: ObjectId) {
  return widgets.findOne({ _id: widgetId })
}

export async function updateWidget(
  ownerId: string,
  widgetId: ObjectId,
  updates: {
    name?: string
    primaryColor?: string | null
    welcomeTitle?: string | null
    welcomeMessage?: string | null
    position?: WidgetPosition
    agentId?: ObjectId | null
    sectorId?: ObjectId | null
  },
) {
  const doc = await widgets.findOneAndUpdate(
    { _id: widgetId, ownerId },
    { $set: updates },
    { returnDocument: 'after' },
  )
  if (updates.agentId) await ensureActivationMode(ownerId, updates.agentId, TRIGGER_FOR_CONFIG.channel)
  return doc
}

export function setWidgetAvatar(ownerId: string, widgetId: ObjectId, avatarUrl: string | null) {
  return widgets.findOneAndUpdate(
    { _id: widgetId, ownerId },
    { $set: { avatarUrl } },
    { returnDocument: 'after' },
  )
}

// Delete a widget and everything scoped to it: its messages plus the per-widget
// conversation memory, semantic turns and orchestration decision log. Returns
// false when the widget doesn't exist / isn't owned by this user.
export async function deleteWidget(ownerId: string, widgetId: ObjectId) {
  const widget = await widgets.findOne({ _id: widgetId, ownerId })
  if (!widget) return false

  await Promise.all([
    widgetMessages.deleteMany({ widgetId }),
    db.collection('conversation_memories').deleteMany({ widgetId }),
    db.collection('conversation_turns').deleteMany({ widgetId }),
    db.collection('sector_decisions').deleteMany({ widgetId }),
    db.collection('agent_tool_calls').deleteMany({ widgetId }),
  ])
  await widgets.deleteOne({ _id: widgetId, ownerId })
  return true
}

export function listMessages(widgetId: ObjectId, conversationId: string) {
  return widgetMessages.find({ widgetId, conversationId }).sort({ createdAt: 1 }).toArray()
}

export function countVisitorMessagesSince(widgetId: ObjectId, conversationId: string, since: Date) {
  return widgetMessages.countDocuments({ widgetId, conversationId, role: 'visitor', createdAt: { $gte: since } })
}

export interface OwnerStats {
  conversations: number
  conversationsThisWeek: number
  messagesThisWeek: number
  attendedConversations: number
  handoffs: number
  qualifiedLeads: number
}

export async function getOwnerStats(ownerId: string): Promise<OwnerStats> {
  const ownerWidgets = await widgets.find({ ownerId }).project({ _id: 1 }).toArray()
  return statsForWidgetIds(ownerWidgets.map((w) => w._id))
}

// Same metrics as the owner-wide dashboard, but scoped to the widgets a single
// agent directly answers — the numbers shown on that agent's page.
export async function getAgentStats(ownerId: string, agentId: ObjectId): Promise<OwnerStats> {
  const agentWidgets = await widgets.find({ ownerId, agentId }).project({ _id: 1 }).toArray()
  return statsForWidgetIds(agentWidgets.map((w) => w._id))
}

export interface AgentCardStats {
  conversations: number
  attendedConversations: number
  qualifiedLeads: number
}

// Per-agent stats for the whole roster in a few aggregations (instead of one
// getAgentStats round-trip per agent). Only widgets an agent answers directly
// are attributed; sector-answered widgets aren't tied to a single agent.
// `opts.since` scopes conversations/leads to the SAME period as the operational
// metrics (a lifetime total must never be mixed with a 7d/30d figure); `opts.agentId`
// narrows the whole aggregation to one agent, so the agent page doesn't fetch the
// entire roster.
export async function getAgentStatsBatch(ownerId: string, opts: { since?: Date | null; agentId?: ObjectId | null } = {}): Promise<Record<string, AgentCardStats>> {
  const widgetFilter: Record<string, unknown> = { ownerId, agentId: { $ne: null } }
  if (opts.agentId) widgetFilter.agentId = opts.agentId
  const ownerWidgets = await widgets.find(widgetFilter).project({ _id: 1, agentId: 1 }).toArray()
  const widgetToAgent = new Map<string, string>()
  for (const w of ownerWidgets) {
    if (w.agentId) widgetToAgent.set(w._id.toString(), w.agentId.toString())
  }
  const widgetIds = ownerWidgets.map((w) => w._id)
  const result: Record<string, AgentCardStats> = {}
  if (widgetIds.length === 0) return result

  const bump = (agentId: string) => (result[agentId] ??= { conversations: 0, attendedConversations: 0, qualifiedLeads: 0 })
  const sinceMatch = opts.since ? { createdAt: { $gte: opts.since } } : {}

  const convGroups = await widgetMessages
    .aggregate<{ _id: { widgetId: ObjectId; conversationId: string }; hasAgent: number }>([
      { $match: { widgetId: { $in: widgetIds }, ...sinceMatch } },
      {
        $group: {
          _id: { widgetId: '$widgetId', conversationId: '$conversationId' },
          hasAgent: { $max: { $cond: [{ $eq: ['$role', 'agent'] }, 1, 0] } },
        },
      },
    ])
    .toArray()
  for (const g of convGroups) {
    const agentId = widgetToAgent.get(g._id.widgetId.toString())
    if (!agentId) continue
    const s = bump(agentId)
    s.conversations++
    if (g.hasAgent) s.attendedConversations++
  }

  const leadGroups = await db
    .collection('conversation_memories')
    .aggregate<{ _id: ObjectId; count: number }>([
      {
        $match: {
          widgetId: { $in: widgetIds },
          // Same period as the operational metrics (memories carry updatedAt).
          ...(opts.since ? { updatedAt: { $gte: opts.since } } : {}),
          $expr: { $gt: [{ $size: { $objectToArray: { $ifNull: ['$structuredOutputData', {}] } } }, 0] },
        },
      },
      { $group: { _id: '$widgetId', count: { $sum: 1 } } },
    ])
    .toArray()
  for (const g of leadGroups) {
    const agentId = widgetToAgent.get(g._id.toString())
    if (!agentId) continue
    bump(agentId).qualifiedLeads += g.count
  }

  return result
}

async function statsForWidgetIds(widgetIds: ObjectId[]): Promise<OwnerStats> {
  if (widgetIds.length === 0) {
    return {
      conversations: 0,
      conversationsThisWeek: 0,
      messagesThisWeek: 0,
      attendedConversations: 0,
      handoffs: 0,
      qualifiedLeads: 0,
    }
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const convGroups = await widgetMessages
    .aggregate<{ _id: unknown; lastAt: Date; hasAgent: boolean }>([
      { $match: { widgetId: { $in: widgetIds } } },
      {
        $group: {
          _id: { widgetId: '$widgetId', conversationId: '$conversationId' },
          lastAt: { $max: '$createdAt' },
          hasAgent: { $max: { $cond: [{ $eq: ['$role', 'agent'] }, 1, 0] } },
        },
      },
    ])
    .toArray()

  const conversations = convGroups.length
  const conversationsThisWeek = convGroups.filter((g) => g.lastAt >= weekAgo).length
  const attendedConversations = convGroups.filter((g) => Boolean(g.hasAgent)).length

  const messagesThisWeek = await widgetMessages.countDocuments({
    widgetId: { $in: widgetIds },
    createdAt: { $gte: weekAgo },
  })

  const memories = db.collection('conversation_memories')
  const handoffs = await memories.countDocuments({ widgetId: { $in: widgetIds }, humanHandoff: true })
  const qualifiedLeads = await memories.countDocuments({
    widgetId: { $in: widgetIds },
    $expr: { $gt: [{ $size: { $objectToArray: { $ifNull: ['$structuredOutputData', {}] } } }, 0] },
  })

  return {
    conversations,
    conversationsThisWeek,
    messagesThisWeek,
    attendedConversations,
    handoffs,
    qualifiedLeads,
  }
}

export interface ConversationSummary {
  widgetId: ObjectId
  widgetName: string
  conversationId: string
  lastMessage: string
  lastRole: WidgetMessage['role']
  lastAt: Date
  messageCount: number
  humanHandoff: boolean
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The channel filter is applied HERE, on the server, against widgets this owner
// actually has. Editing the query string can therefore narrow the result, never widen
// it: an id that is not the owner's simply is not in the set.
export interface ConversationFilters {
  search?: string
  channel?: 'web' | 'whatsapp'
  widgetId?: ObjectId
}

export async function listConversationsForOwner(
  ownerId: string,
  searchOrFilters?: string | ConversationFilters,
): Promise<ConversationSummary[]> {
  const filters: ConversationFilters = typeof searchOrFilters === 'string' ? { search: searchOrFilters } : (searchOrFilters ?? {})
  const search = filters.search
  const scope: Record<string, unknown> = { ownerId }
  // Legacy documents have no `channel` field and are web by definition.
  if (filters.channel === 'web') scope.channel = { $ne: 'whatsapp' }
  else if (filters.channel === 'whatsapp') scope.channel = 'whatsapp'
  if (filters.widgetId) scope._id = filters.widgetId

  const ownerWidgets = await widgets.find(scope).toArray()
  if (ownerWidgets.length === 0) return []

  const widgetIds = ownerWidgets.map((w) => w._id)
  const nameById = new Map(ownerWidgets.map((w) => [w._id.toString(), w.name]))

  const groups = await widgetMessages
    .aggregate<{
      _id: { widgetId: ObjectId; conversationId: string }
      lastMessage: string
      lastRole: WidgetMessage['role']
      lastAt: Date
      messageCount: number
    }>([
      { $match: { widgetId: { $in: widgetIds } } },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: { widgetId: '$widgetId', conversationId: '$conversationId' },
          lastMessage: { $last: '$content' },
          lastRole: { $last: '$role' },
          lastAt: { $last: '$createdAt' },
          messageCount: { $sum: 1 },
        },
      },
      { $sort: { lastAt: -1 } },
    ])
    .toArray()

  // The handoff flag lives on the per-conversation memory doc, not on the
  // messages — join it in so the list can badge conversations waiting for
  // a human without an extra request per row.
  const handoffDocs = await db
    .collection('conversation_memories')
    .find({ widgetId: { $in: widgetIds }, humanHandoff: true })
    .toArray()
  const handoffKeys = new Set(handoffDocs.map((d) => `${d.widgetId}:${d.conversationId}`))

  // Search across the FULL message content of each conversation (not just the
  // last message), plus the widget name / conversation id, so the owner can
  // find a thread by anything that was said in it.
  let selected = groups
  const term = search?.trim()
  if (term) {
    const rx = new RegExp(escapeRegExp(term), 'i')
    const contentMatches = await widgetMessages
      .aggregate<{ _id: { widgetId: ObjectId; conversationId: string } }>([
        { $match: { widgetId: { $in: widgetIds }, content: { $regex: escapeRegExp(term), $options: 'i' } } },
        { $group: { _id: { widgetId: '$widgetId', conversationId: '$conversationId' } } },
      ])
      .toArray()
    const contentKeys = new Set(contentMatches.map((m) => `${m._id.widgetId}:${m._id.conversationId}`))
    selected = groups.filter((group) => {
      const key = `${group._id.widgetId}:${group._id.conversationId}`
      const widgetName = nameById.get(group._id.widgetId.toString()) ?? ''
      return contentKeys.has(key) || rx.test(widgetName) || rx.test(group._id.conversationId)
    })
  }

  return selected.map((group) => ({
    widgetId: group._id.widgetId,
    widgetName: nameById.get(group._id.widgetId.toString()) ?? 'Widget',
    conversationId: group._id.conversationId,
    lastMessage: group.lastMessage,
    lastRole: group.lastRole,
    lastAt: group.lastAt,
    messageCount: group.messageCount,
    humanHandoff: handoffKeys.has(`${group._id.widgetId}:${group._id.conversationId}`),
  }))
}

export async function getConversationMessages(
  ownerId: string,
  widgetId: ObjectId,
  conversationId: string,
) {
  const widget = await widgets.findOne({ _id: widgetId, ownerId })
  if (!widget) return null
  return listMessages(widgetId, conversationId)
}

export async function addOwnerReply(
  ownerId: string,
  widgetId: ObjectId,
  conversationId: string,
  content: string,
) {
  const widget = await widgets.findOne({ _id: widgetId, ownerId })
  if (!widget) return null
  return addMessage(widgetId, conversationId, 'agent', content)
}

export async function addMessage(
  widgetId: ObjectId,
  conversationId: string,
  role: WidgetMessage['role'],
  content: string,
  agentName: string | null = null,
  externalId: string | null = null,
  // A marca de esclarecimento, quando este turno é uma pergunta com alternativas.
  clarify: { options: string[] } | null = null,
) {
  const message: Omit<WidgetMessage, '_id'> = {
    widgetId,
    conversationId,
    role,
    content,
    agentName,
    externalId,
    ...(clarify ? { clarification: true, clarificationOptions: clarify.options } : {}),
    createdAt: new Date(),
  }
  const result = await widgetMessages.insertOne(message as WidgetMessage)
  return { ...message, _id: result.insertedId }
}

// True if an inbound provider message id was already stored for this channel —
// webhook deliveries can be retried, so we drop duplicates.
export async function inboundAlreadySeen(widgetId: ObjectId, externalId: string) {
  if (!externalId) return false
  const existing = await widgetMessages.findOne({ widgetId, externalId })
  return existing !== null
}
