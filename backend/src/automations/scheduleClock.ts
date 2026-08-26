// When does a schedule fire next?
//
// This used to be BullMQ's job (Job Schedulers on Redis). Now the scheduler is a
// plain Mongo loop, so the "next instant" calculation lives here — pure, so every
// awkward case (month rollover, a day that does not exist in a short month, a
// weekday set, a DST shift) is a unit test instead of a production surprise.
//
// The timezone is the OWNER's, never the server's: a routine set for 07:00 in
// America/Sao_Paulo must fire at 07:00 there whatever the container's clock says.
import { CronExpressionParser } from 'cron-parser'

// A fire instant, or null when the expression/timezone is unusable. Returning null
// instead of throwing matters: this runs inside a loop that must never die because
// one automation carries a malformed schedule.
export function nextFireAt(cron: string, timezone: string, after: Date): Date | null {
  if (!cron?.trim() || !timezone?.trim()) return null
  try {
    const it = CronExpressionParser.parse(cron, { currentDate: after, tz: timezone })
    return it.next().toDate()
  } catch {
    return null
  }
}

// Fires strictly AFTER `after`, so advancing from the instant we just ran never
// returns that same instant again.
export const advanceFrom = (cron: string, timezone: string, lastFire: Date): Date | null => nextFireAt(cron, timezone, lastFire)

/**
 * O disparo mais recente que JÁ aconteceu — o espelho de `nextFireAt`.
 *
 * Existe para quem precisa alinhar um trabalho à agenda sem guardar "quando rodei da
 * última vez": duas passadas entre dois disparos devolvem o mesmo instante, e é isso
 * que torna a gravação idempotente. Devolve `null` na mesma condição do irmão — uma
 * expressão ou fuso que o relógio não entende não derruba o laço de quem chamou.
 */
export function lastFireAt(cron: string, timezone: string, at: Date): Date | null {
  if (!cron?.trim() || !timezone?.trim()) return null
  try {
    const it = CronExpressionParser.parse(cron, { currentDate: at, tz: timezone })
    return it.prev().toDate()
  } catch {
    return null
  }
}

// A schedule the process missed while it was down is SKIPPED, not replayed: three
// days of "resumo do dia" arriving at once is noise, not recovery. This returns the
// first fire that is still in the future, and how many were skipped (for the log).
export function catchUp(cron: string, timezone: string, from: Date, now: Date): { next: Date | null; skipped: number } {
  let cursor = from
  let skipped = 0
  // Bounded: a schedule idle for years must not spin. 500 steps covers well over a
  // year of daily fires; beyond that we just jump to the next fire after `now`.
  for (let i = 0; i < 500; i++) {
    const candidate = nextFireAt(cron, timezone, cursor)
    if (!candidate) return { next: null, skipped }
    if (candidate > now) return { next: candidate, skipped }
    cursor = candidate
    skipped++
  }
  return { next: nextFireAt(cron, timezone, now), skipped }
}
