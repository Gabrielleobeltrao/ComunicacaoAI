import { ObjectId } from 'mongodb'
import { db } from './db.js'

export interface ConversationMemory {
  _id: ObjectId
  widgetId: ObjectId
  conversationId: string
  memory: string
  structuredMemory: Record<string, string>
  visitorProfileId: ObjectId | null
  updatedAt: Date
}

const conversationMemories = db.collection<ConversationMemory>('conversation_memories')

async function getDoc(widgetId: ObjectId, conversationId: string) {
  return conversationMemories.findOne({ widgetId, conversationId })
}

export async function getConversationMemory(widgetId: ObjectId, conversationId: string): Promise<string> {
  const doc = await getDoc(widgetId, conversationId)
  return doc?.memory ?? ''
}

export async function setConversationMemory(widgetId: ObjectId, conversationId: string, memory: string) {
  await conversationMemories.updateOne(
    { widgetId, conversationId },
    { $set: { memory, updatedAt: new Date() } },
    { upsert: true },
  )
}

export async function getStructuredMemory(
  widgetId: ObjectId,
  conversationId: string,
): Promise<Record<string, string>> {
  const doc = await getDoc(widgetId, conversationId)
  return doc?.structuredMemory ?? {}
}

export async function setStructuredMemory(
  widgetId: ObjectId,
  conversationId: string,
  structuredMemory: Record<string, string>,
) {
  await conversationMemories.updateOne(
    { widgetId, conversationId },
    { $set: { structuredMemory, updatedAt: new Date() } },
    { upsert: true },
  )
}

export async function getLinkedVisitorProfileId(
  widgetId: ObjectId,
  conversationId: string,
): Promise<ObjectId | null> {
  const doc = await getDoc(widgetId, conversationId)
  return doc?.visitorProfileId ?? null
}

export async function linkVisitorProfile(widgetId: ObjectId, conversationId: string, visitorProfileId: ObjectId) {
  await conversationMemories.updateOne(
    { widgetId, conversationId },
    { $set: { visitorProfileId, updatedAt: new Date() } },
    { upsert: true },
  )
}
