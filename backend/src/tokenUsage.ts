import { db } from './db.js'
import type { TokenUsage } from './llm.js'

// One rolling document per owner per UTC day. Keeps the collection tiny and
// makes "this week" / "this month" rollups a cheap range scan.
interface TokenUsageDoc {
  _id: string // `${ownerId}:${YYYY-MM-DD}`
  ownerId: string
  date: string // YYYY-MM-DD (UTC)
  inputTokens: number
  outputTokens: number
  replies: number
}

const tokenUsage = db.collection<TokenUsageDoc>('token_usage')

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function recordReplyUsage(ownerId: string, usage: TokenUsage, now: Date = new Date()) {
  const date = dayKey(now)
  await tokenUsage.updateOne(
    { _id: `${ownerId}:${date}` },
    {
      $inc: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, replies: 1 },
      $setOnInsert: { ownerId, date },
    },
    { upsert: true },
  )
}

async function sumTokensSince(ownerId: string, sinceDate: string): Promise<number> {
  const result = await tokenUsage
    .aggregate<{ total: number }>([
      { $match: { ownerId, date: { $gte: sinceDate } } },
      { $group: { _id: null, total: { $sum: { $add: ['$inputTokens', '$outputTokens'] } } } },
    ])
    .toArray()
  return result[0]?.total ?? 0
}

export interface UsageSummary {
  tokensThisWeek: number
  tokensThisMonth: number
}

export async function getUsageSummary(ownerId: string, now: Date = new Date()): Promise<UsageSummary> {
  const weekAgo = dayKey(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000))
  const monthStart = `${now.toISOString().slice(0, 7)}-01`
  const [tokensThisWeek, tokensThisMonth] = await Promise.all([
    sumTokensSince(ownerId, weekAgo),
    sumTokensSince(ownerId, monthStart),
  ])
  return { tokensThisWeek, tokensThisMonth }
}

export function getMonthlyTokens(ownerId: string, now: Date = new Date()): Promise<number> {
  const monthStart = `${now.toISOString().slice(0, 7)}-01`
  return sumTokensSince(ownerId, monthStart)
}
