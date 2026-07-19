import { ObjectId } from 'mongodb'
import { db } from './db.js'

export interface ConversationMemory {
  _id: ObjectId
  widgetId: ObjectId
  conversationId: string
  memory: string
  updatedAt: Date
}

const conversationMemories = db.collection<ConversationMemory>('conversation_memories')

export async function getConversationMemory(widgetId: ObjectId, conversationId: string): Promise<string> {
  const doc = await conversationMemories.findOne({ widgetId, conversationId })
  return doc?.memory ?? ''
}

export async function setConversationMemory(widgetId: ObjectId, conversationId: string, memory: string) {
  await conversationMemories.updateOne(
    { widgetId, conversationId },
    { $set: { memory, updatedAt: new Date() } },
    { upsert: true },
  )
}
