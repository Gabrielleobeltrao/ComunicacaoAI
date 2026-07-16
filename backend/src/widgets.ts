import { randomBytes } from 'crypto'
import { ObjectId } from 'mongodb'
import { db } from './db.js'

export interface Widget {
  _id: ObjectId
  ownerId: string
  name: string
  publicKey: string
  createdAt: Date
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

export async function createWidget(ownerId: string, name: string) {
  const widget: Omit<Widget, '_id'> = {
    ownerId,
    name,
    publicKey: randomBytes(9).toString('base64url'),
    createdAt: new Date(),
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

export function listMessages(widgetId: ObjectId, conversationId: string) {
  return widgetMessages.find({ widgetId, conversationId }).sort({ createdAt: 1 }).toArray()
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
