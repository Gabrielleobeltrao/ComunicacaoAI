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

export interface ConversationSummary {
  widgetId: ObjectId
  widgetName: string
  conversationId: string
  lastMessage: string
  lastRole: WidgetMessage['role']
  lastAt: Date
  messageCount: number
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

  return groups.map((group) => ({
    widgetId: group._id.widgetId,
    widgetName: nameById.get(group._id.widgetId.toString()) ?? 'Widget',
    conversationId: group._id.conversationId,
    lastMessage: group.lastMessage,
    lastRole: group.lastRole,
    lastAt: group.lastAt,
    messageCount: group.messageCount,
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
