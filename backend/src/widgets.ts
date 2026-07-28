import { randomBytes } from 'crypto'
import { ObjectId } from 'mongodb'
import { db } from './db.js'

export type WidgetPosition = 'right' | 'left'

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
}

export interface WidgetMessage {
  _id: ObjectId
  widgetId: ObjectId
  conversationId: string
  role: 'visitor' | 'agent'
  content: string
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
  }
  const result = await widgets.insertOne(widget as Widget)
  return { ...widget, _id: result.insertedId }
}

export function listWidgets(ownerId: string) {
  return widgets.find({ ownerId }).sort({ createdAt: -1 }).toArray()
}

export function getWidgetByPublicKey(publicKey: string) {
  return widgets.findOne({ publicKey })
}

export function getWidgetById(widgetId: ObjectId) {
  return widgets.findOne({ _id: widgetId })
}

export function updateWidget(
  ownerId: string,
  widgetId: ObjectId,
  updates: {
    name?: string
    primaryColor?: string | null
    welcomeTitle?: string | null
    welcomeMessage?: string | null
    position?: WidgetPosition
    agentId?: ObjectId | null
  },
) {
  return widgets.findOneAndUpdate(
    { _id: widgetId, ownerId },
    { $set: updates },
    { returnDocument: 'after' },
  )
}

export function setWidgetAvatar(ownerId: string, widgetId: ObjectId, avatarUrl: string | null) {
  return widgets.findOneAndUpdate(
    { _id: widgetId, ownerId },
    { $set: { avatarUrl } },
    { returnDocument: 'after' },
  )
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
  const widgetIds = ownerWidgets.map((w) => w._id)
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

export async function listConversationsForOwner(ownerId: string): Promise<ConversationSummary[]> {
  const ownerWidgets = await widgets.find({ ownerId }).toArray()
  if (ownerWidgets.length === 0) return []

  const nameById = new Map(ownerWidgets.map((w) => [w._id.toString(), w.name]))

  const groups = await widgetMessages
    .aggregate<{
      _id: { widgetId: ObjectId; conversationId: string }
      lastMessage: string
      lastRole: WidgetMessage['role']
      lastAt: Date
      messageCount: number
    }>([
      { $match: { widgetId: { $in: ownerWidgets.map((w) => w._id) } } },
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
    .find({ widgetId: { $in: ownerWidgets.map((w) => w._id) }, humanHandoff: true })
    .toArray()
  const handoffKeys = new Set(handoffDocs.map((d) => `${d.widgetId}:${d.conversationId}`))

  return groups.map((group) => ({
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
) {
  const message: Omit<WidgetMessage, '_id'> = {
    widgetId,
    conversationId,
    role,
    content,
    createdAt: new Date(),
  }
  const result = await widgetMessages.insertOne(message as WidgetMessage)
  return { ...message, _id: result.insertedId }
}
