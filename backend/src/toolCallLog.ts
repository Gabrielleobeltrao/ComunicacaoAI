import { ObjectId } from 'mongodb'
import { db } from './db.js'
import type { ToolCallRecord } from './agentTools.js'

// Observability: every tool the agent invoked while answering, so the owner can
// see (in Chats) what the agent did behind the scenes.
export interface ToolCallLog {
  _id: ObjectId
  widgetId: ObjectId
  conversationId: string
  name: string
  arguments: Record<string, unknown>
  ok: boolean
  result: string
  createdAt: Date
}

const toolCallLogs = db.collection<ToolCallLog>('agent_tool_calls')

export async function logToolCalls(widgetId: ObjectId, conversationId: string, calls: ToolCallRecord[]) {
  if (calls.length === 0) return
  const now = new Date()
  await toolCallLogs.insertMany(
    calls.map((c) => ({
      widgetId,
      conversationId,
      name: c.name,
      arguments: c.arguments,
      ok: c.ok,
      // Cap what we store; the full result already went back to the model.
      result: c.result.slice(0, 2000),
      createdAt: now,
    })) as ToolCallLog[],
  )
}

export function listToolCalls(widgetId: ObjectId, conversationId: string) {
  return toolCallLogs.find({ widgetId, conversationId }).sort({ createdAt: 1 }).toArray()
}
