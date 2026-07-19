import { ObjectId } from 'mongodb'
import { db } from './db.js'
import type { Provider } from './llm.js'

export interface Agent {
  _id: ObjectId
  ownerId: string
  name: string
  objective: string
  provider: Provider
  model: string | null
  widgetId: ObjectId | null
  memoryEnabled: boolean
  createdAt: Date
}

const agents = db.collection<Agent>('agents')

export async function createAgent(
  ownerId: string,
  name: string,
  widgetId: ObjectId | null,
  options: { objective?: string; provider?: Provider; model?: string | null; memoryEnabled?: boolean } = {},
) {
  if (widgetId) {
    await unlinkWidgetFromOtherAgents(ownerId, widgetId, null)
  }

  const agent: Omit<Agent, '_id'> = {
    ownerId,
    name,
    objective: options.objective ?? '',
    provider: options.provider ?? 'anthropic',
    model: options.model ?? null,
    widgetId,
    memoryEnabled: options.memoryEnabled ?? false,
    createdAt: new Date(),
  }
  const result = await agents.insertOne(agent as Agent)
  return { ...agent, _id: result.insertedId }
}

export function listAgents(ownerId: string) {
  return agents.find({ ownerId }).sort({ createdAt: -1 }).toArray()
}

export function getAgentById(ownerId: string, agentId: ObjectId) {
  return agents.findOne({ _id: agentId, ownerId })
}

export function getAgentByWidgetId(widgetId: ObjectId) {
  return agents.findOne({ widgetId })
}

export async function setAgentWidget(ownerId: string, agentId: ObjectId, widgetId: ObjectId | null) {
  if (widgetId) {
    await unlinkWidgetFromOtherAgents(ownerId, widgetId, agentId)
  }

  return agents.findOneAndUpdate(
    { _id: agentId, ownerId },
    { $set: { widgetId } },
    { returnDocument: 'after' },
  )
}

export function updateAgent(
  ownerId: string,
  agentId: ObjectId,
  updates: {
    name?: string
    objective?: string
    provider?: Provider
    model?: string | null
    memoryEnabled?: boolean
  },
) {
  return agents.findOneAndUpdate(
    { _id: agentId, ownerId },
    { $set: updates },
    { returnDocument: 'after' },
  )
}

async function unlinkWidgetFromOtherAgents(ownerId: string, widgetId: ObjectId, exceptAgentId: ObjectId | null) {
  await agents.updateMany(
    { ownerId, widgetId, ...(exceptAgentId ? { _id: { $ne: exceptAgentId } } : {}) },
    { $set: { widgetId: null } },
  )
}
