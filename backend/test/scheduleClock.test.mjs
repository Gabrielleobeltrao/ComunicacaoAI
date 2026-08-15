// When a routine fires. Pure — no database, no Redis, no clock of its own: every
// case pins an explicit "now" so the assertions can never drift with the calendar.
//
// All expectations are in UTC (what gets stored), computed from a wall-clock time
// in the OWNER's timezone (what the user typed).
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { nextFireAt, advanceFrom, catchUp } = await import('../dist/automations/scheduleClock.js')

const SP = 'America/Sao_Paulo'
const at = (iso) => new Date(iso)
const iso = (d) => d.toISOString()

test('daily: fires at the wall-clock hour of the OWNER timezone, not the server', () => {
  // 01:00 UTC on the 15th is 22:00 on the 14th in São Paulo, so the next 09:00
  // there is later the same (15th) day: 12:00 UTC.
  assert.equal(iso(nextFireAt('0 9 * * *', SP, at('2026-08-15T01:00:00Z'))), '2026-08-15T12:00:00.000Z')
  // Just after it fired, the next one is the following day.
  assert.equal(iso(nextFireAt('0 9 * * *', SP, at('2026-08-15T12:00:01Z'))), '2026-08-16T12:00:00.000Z')
})

test('the same expression in another timezone yields another instant', () => {
  const sp = nextFireAt('0 9 * * *', SP, at('2026-08-15T01:00:00Z'))
  const lisbon = nextFireAt('0 9 * * *', 'Europe/Lisbon', at('2026-08-15T01:00:00Z'))
  assert.notEqual(iso(sp), iso(lisbon), 'the timezone must actually matter')
  assert.equal(iso(lisbon), '2026-08-15T08:00:00.000Z') // WEST = UTC+1 in August
})

test('weekly: only the chosen weekdays', () => {
  // Tuesdays and Fridays at 07:00 SP. 2026-08-15 is a Saturday → next is Tuesday 18.
  assert.equal(iso(nextFireAt('0 7 * * 2,5', SP, at('2026-08-15T01:00:00Z'))), '2026-08-18T10:00:00.000Z')
  // From Tuesday right after it fired → Friday.
  assert.equal(iso(nextFireAt('0 7 * * 2,5', SP, at('2026-08-18T10:00:01Z'))), '2026-08-21T10:00:00.000Z')
})

test('monthly: a day that does not exist is skipped, never clamped', () => {
  // The 31st from April 1st: April has 30 days, so it lands on May 31.
  assert.equal(iso(nextFireAt('0 8 31 * *', SP, at('2026-04-01T00:00:00Z'))), '2026-05-31T11:00:00.000Z')
  // February from January 31: skips to March 31 (no Feb 31).
  assert.equal(iso(nextFireAt('0 8 31 * *', SP, at('2026-02-01T00:00:00Z'))), '2026-03-31T11:00:00.000Z')
})

test('year rollover', () => {
  assert.equal(iso(nextFireAt('0 9 1 1 *', SP, at('2026-12-31T23:00:00Z'))), '2027-01-01T12:00:00.000Z')
})

test('a DST change moves the UTC instant, keeping the wall-clock hour', () => {
  // Lisbon: WET (UTC+0) in winter, WEST (UTC+1) in summer. 09:00 local is 09:00Z
  // in January and 08:00Z in July — the point of storing a timezone, not an offset.
  assert.equal(iso(nextFireAt('0 9 * * *', 'Europe/Lisbon', at('2026-01-10T00:00:00Z'))), '2026-01-10T09:00:00.000Z')
  assert.equal(iso(nextFireAt('0 9 * * *', 'Europe/Lisbon', at('2026-07-10T00:00:00Z'))), '2026-07-10T08:00:00.000Z')
})

test('a malformed schedule yields null instead of throwing', () => {
  // The scheduler loop must survive one bad automation.
  assert.equal(nextFireAt('not a cron', SP, at('2026-08-15T01:00:00Z')), null)
  assert.equal(nextFireAt('0 9 * * *', 'Mars/Olympus', at('2026-08-15T01:00:00Z')), null)
  assert.equal(nextFireAt('', SP, at('2026-08-15T01:00:00Z')), null)
  assert.equal(nextFireAt('0 9 * * *', '', at('2026-08-15T01:00:00Z')), null)
})

test('advanceFrom never returns the instant it just ran', () => {
  const fired = at('2026-08-15T12:00:00Z')
  const next = advanceFrom('0 9 * * *', SP, fired)
  assert.ok(next > fired, 'must move forward')
  assert.equal(iso(next), '2026-08-16T12:00:00.000Z')
})

test('a schedule missed while the process was down SKIPS instead of replaying', () => {
  // Last fire three days ago; the process comes back now. Three daily fires were
  // missed — they are counted and dropped, and the next one is in the future.
  const from = at('2026-08-12T12:00:00Z')
  const now = at('2026-08-15T13:00:00Z')
  const { next, skipped } = catchUp('0 9 * * *', SP, from, now)
  assert.equal(skipped, 3, 'the 13th, 14th and 15th are behind us')
  assert.equal(iso(next), '2026-08-16T12:00:00.000Z')
  assert.ok(next > now)
})

test('catchUp with nothing missed just returns the next fire', () => {
  const { next, skipped } = catchUp('0 9 * * *', SP, at('2026-08-15T12:00:00Z'), at('2026-08-15T13:00:00Z'))
  assert.equal(skipped, 0)
  assert.equal(iso(next), '2026-08-16T12:00:00.000Z')
})

test('catchUp on a long-idle schedule stays bounded and still lands in the future', () => {
  // Years of daily fires: the loop must not spin through all of them.
  const { next } = catchUp('0 9 * * *', SP, at('2020-01-01T12:00:00Z'), at('2026-08-15T13:00:00Z'))
  assert.ok(next > at('2026-08-15T13:00:00Z'), 'must land in the future whatever the gap')
})
