import { ObjectId } from 'mongodb'
import { db } from './db.js'

export interface ConversationMemory {
  _id: ObjectId
  widgetId: ObjectId
  conversationId: string
  memory: string
  structuredMemory: Record<string, string>
  structuredOutputData: Record<string, string>
  visitorProfileId: ObjectId | null
  humanHandoff: boolean
  // Sticky routing: the team member currently handling this conversation, so
  // the router keeps it on the same specialist until the topic changes.
  activeAgentId: ObjectId | null
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

export async function getStructuredOutputData(
  widgetId: ObjectId,
  conversationId: string,
): Promise<Record<string, string>> {
  const doc = await getDoc(widgetId, conversationId)
  return doc?.structuredOutputData ?? {}
}

export async function setStructuredOutputData(
  widgetId: ObjectId,
  conversationId: string,
  structuredOutputData: Record<string, string>,
) {
  await conversationMemories.updateOne(
    { widgetId, conversationId },
    { $set: { structuredOutputData, updatedAt: new Date() } },
    { upsert: true },
  )
}

export async function getHumanHandoff(widgetId: ObjectId, conversationId: string): Promise<boolean> {
  const doc = await getDoc(widgetId, conversationId)
  return doc?.humanHandoff ?? false
}

export async function setHumanHandoff(widgetId: ObjectId, conversationId: string, active: boolean) {
  await conversationMemories.updateOne(
    { widgetId, conversationId },
    { $set: { humanHandoff: active, updatedAt: new Date() } },
    { upsert: true },
  )
}

export async function getActiveAgentId(widgetId: ObjectId, conversationId: string): Promise<ObjectId | null> {
  const doc = await getDoc(widgetId, conversationId)
  return doc?.activeAgentId ?? null
}

export async function setActiveAgentId(widgetId: ObjectId, conversationId: string, agentId: ObjectId) {
  await conversationMemories.updateOne(
    { widgetId, conversationId },
    { $set: { activeAgentId: agentId, updatedAt: new Date() } },
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
