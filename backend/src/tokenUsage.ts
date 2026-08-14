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

// Idempotent charge ledger: one row per BILLED inference. The unique _id (chargeKey)
// is what makes "charge exactly once" real — a redelivered job or a replayed write
// with the same key is ignored, while a genuine retry uses a different key (it ran
// the model again, so it really consumed tokens).
interface UsageChargeDoc {
  _id: string // the chargeKey
  ownerId: string
  inputTokens: number
  outputTokens: number
  createdAt: Date
}
const usageCharges = db.collection<UsageChargeDoc>('token_usage_charges')

export async function ensureTokenUsageIndexes(): Promise<void> {
  // TTL keeps the ledger small: after 30 days a replay can no longer be deduped,
  // which is well past any retry/redelivery window.
  await usageCharges.createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 })
}

// Record owner-level usage exactly once for `chargeKey`. Returns true when it was
// actually charged (false = duplicate, already accounted).
export async function recordReplyUsageOnce(ownerId: string, usage: TokenUsage, chargeKey: string, now: Date = new Date()): Promise<boolean> {
  try {
    await usageCharges.insertOne({ _id: chargeKey, ownerId, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, createdAt: now })
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return false // already charged
    throw error
  }
  await recordReplyUsage(ownerId, usage, now)
  return true
}

// The charge key for one ATTEMPT of a routine step: a retry gets its own key (real
// extra consumption), a redelivery of the same attempt does not.
export function attemptChargeKey(runId: string, stepId: string, agentId: string, attempt: number): string {
  return `run:${runId}:${stepId}:${agentId}:a${attempt}`
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
