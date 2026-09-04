import { db, mongoClient } from './db.js'
import type { TokenUsage } from './llm.js'
import { ensureTtlIndex } from './ttlIndex.js'

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

// EXACTLY-ONCE CHARGING
// ---------------------
// The ledger (`token_usage_charges`, _id = chargeKey) is the SINGLE SOURCE OF TRUTH
// for whether an inference was billed: its unique _id makes the decision atomic, so
// the same key can never be counted twice and a real retry (a different key) always
// is. The daily `token_usage` doc is a materialised rollup of that ledger.
//
// The dangerous window is "daily total incremented" → "ledger marked applied": a
// crash in between used to allow a re-apply. It is closed two ways:
//   * With transactions (replica set / Atlas): the ledger insert AND the daily $inc
//     commit together — both or neither, so `applied` is never a lie.
//   * Without transactions (standalone mongod): the daily $inc is NOT attempted at
//     write time. Only the ledger row is inserted (applied:false) and the reported
//     totals READ both sources (rollup + not-yet-applied ledger rows). Nothing is
//     ever re-applied because nothing was half-applied.
interface UsageChargeDoc {
  _id: string // the chargeKey — the authority on "was this billed?"
  ownerId: string
  date: string // YYYY-MM-DD (UTC) of the charge, so ledger-side sums match the rollup
  inputTokens: number
  outputTokens: number
  // true = already folded into the daily rollup; false = still counted from here.
  applied: boolean
  createdAt: Date
}
const usageCharges = db.collection<UsageChargeDoc>('token_usage_charges')

export async function ensureTokenUsageIndexes(): Promise<void> {
  // Longer than the widest reporting window (a calendar month) so a pending row is
  // never dropped while it still counts.
  await ensureTtlIndex(usageCharges, { createdAt: 1 }, 45 * 24 * 3600)
  await usageCharges.createIndex({ ownerId: 1, applied: 1, date: 1 })
}

// A duplicate-key failure, possibly wrapped by an aborted transaction.
function isDuplicateKey(error: unknown): boolean {
  const e = error as { code?: number; message?: string; errorResponse?: { code?: number }; writeErrors?: { code?: number }[] }
  if (e?.code === 11000 || e?.errorResponse?.code === 11000) return true
  if (e?.writeErrors?.some((w) => w.code === 11000)) return true
  return typeof e?.message === 'string' && /E11000|duplicate key/i.test(e.message)
}

// Whether this deployment supports multi-document transactions (replica set/sharded).
// Probed once and cached; a standalone mongod answers "no" and takes the safe path.
let txSupport: boolean | null = null
async function supportsTransactions(): Promise<boolean> {
  if (txSupport !== null) return txSupport
  try {
    const hello = await db.command({ hello: 1 })
    txSupport = Boolean(hello.setName || hello.msg === 'isdbgrid')
  } catch {
    txSupport = false
  }
  return txSupport
}

// Record owner-level usage exactly once for `chargeKey`. Returns true when this call
// was the one that billed it (false = the key was already billed).
export async function recordReplyUsageOnce(ownerId: string, usage: TokenUsage, chargeKey: string, now: Date = new Date()): Promise<boolean> {
  const date = dayKey(now)
  const row: UsageChargeDoc = { _id: chargeKey, ownerId, date, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, applied: false, createdAt: now }

  // STEP 1 — CLAIM. A single atomic insert on the unique _id decides, once and for
  // all, whether this key is billed. It happens OUTSIDE any transaction, so a
  // concurrent duplicate is a plain 11000 (never an aborted transaction), and a crash
  // right after it leaves a row that reporting already counts (see sumTokensSince).
  try {
    await usageCharges.insertOne(row)
  } catch (error) {
    if (isDuplicateKey(error)) return false // already billed
    throw error
  }

  // STEP 2 — FOLD into the daily rollup. Only where transactions exist, and always
  // guarded by `applied:false` inside the transaction, so the increment and the flag
  // commit together: the row is either pending (counted from the ledger) or applied
  // (counted in the rollup) — never both, never neither.
  if (await supportsTransactions()) await foldCharge(row)
  return true
}

// Apply ONE pending charge to the daily rollup, atomically. Returns true when this
// call was the one that folded it.
async function foldCharge(charge: UsageChargeDoc): Promise<boolean> {
  const session = mongoClient.startSession()
  try {
    let folded = false
    await session.withTransaction(async () => {
      folded = false
      const claimed = await usageCharges.updateOne({ _id: charge._id, applied: false }, { $set: { applied: true } }, { session })
      if (!claimed.modifiedCount) return // another runner already folded it
      await tokenUsage.updateOne(
        { _id: `${charge.ownerId}:${charge.date}` },
        { $inc: { inputTokens: charge.inputTokens, outputTokens: charge.outputTokens, replies: 1 }, $setOnInsert: { ownerId: charge.ownerId, date: charge.date } },
        { upsert: true, session },
      )
      folded = true
    })
    return folded
  } catch (error) {
    // Leaving it pending is safe: it is still counted at read time and a later
    // settle can fold it.
    console.error('foldCharge failed (charge stays pending, still counted):', (error as Error).message)
    return false
  } finally {
    await session.endSession()
  }
}

// Fold pending ledger rows into the daily rollup. Safe to run on several instances at
// once and after any crash: each row is claimed by an atomic conditional update
// INSIDE the transaction that also increments the rollup, so a row can be folded by
// exactly one runner, exactly once. Without transactions it is a no-op (pending rows
// are already counted at read time).
export async function settlePendingCharges(limit = 500): Promise<number> {
  if (!(await supportsTransactions())) return 0 // pending rows are already counted
  const pending = await usageCharges.find({ applied: false }).limit(limit).toArray()
  let settled = 0
  for (const charge of pending) if (await foldCharge(charge)) settled++
  return settled
}

// The charge key for one ATTEMPT of a routine step: a retry gets its own key (real
// extra consumption), a redelivery of the same attempt does not.
export function attemptChargeKey(runId: string, stepId: string, agentId: string, attempt: number): string {
  return `run:${runId}:${stepId}:${agentId}:a${attempt}`
}

// Tokens still living only in the ledger (not yet folded into the rollup).
async function sumPendingSince(ownerId: string, sinceDate: string): Promise<number> {
  const rows = await usageCharges
    .aggregate<{ total: number }>([
      { $match: { ownerId, applied: false, date: { $gte: sinceDate } } },
      { $group: { _id: null, total: { $sum: { $add: ['$inputTokens', '$outputTokens'] } } } },
    ])
    .toArray()
  return rows[0]?.total ?? 0
}

async function sumTokensSince(ownerId: string, sinceDate: string): Promise<number> {
  const [rolled, pending] = await Promise.all([
    tokenUsage
      .aggregate<{ total: number }>([
        { $match: { ownerId, date: { $gte: sinceDate } } },
        { $group: { _id: null, total: { $sum: { $add: ['$inputTokens', '$outputTokens'] } } } },
      ])
      .toArray(),
    // A charge is EITHER in the rollup (applied) or still in the ledger (pending) —
    // never in both — so adding the two is exact.
    sumPendingSince(ownerId, sinceDate),
  ])
  return (rolled[0]?.total ?? 0) + pending
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
