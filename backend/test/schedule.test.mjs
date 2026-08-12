// Recurrence → cron (plan §11.2). Pure.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { recurrenceToCron, isValidRecurrence, describeRecurrence } = await import('../dist/automations/schedule.js')

test('daily/weekly/monthly map to correct cron patterns', () => {
  assert.equal(recurrenceToCron({ kind: 'daily', time: '08:00' }), '0 8 * * *')
  assert.equal(recurrenceToCron({ kind: 'daily', time: '23:30' }), '30 23 * * *')
  assert.equal(recurrenceToCron({ kind: 'weekly', time: '09:15', weekdays: [1, 3, 5] }), '15 9 * * 1,3,5')
  assert.equal(recurrenceToCron({ kind: 'monthly', time: '07:00', day: 1 }), '0 7 1 * *')
})

test('weekdays are deduped and sorted', () => {
  assert.equal(recurrenceToCron({ kind: 'weekly', time: '06:00', weekdays: [5, 1, 1, 3] }), '0 6 * * 1,3,5')
})

test('invalid recurrences are rejected', () => {
  assert.equal(isValidRecurrence({ kind: 'daily', time: '25:00' }), false)
  assert.equal(isValidRecurrence({ kind: 'weekly', time: '08:00', weekdays: [] }), false)
  assert.equal(isValidRecurrence({ kind: 'monthly', time: '08:00', day: 40 }), false)
  assert.equal(isValidRecurrence({ kind: 'daily', time: 'noon' }), false)
  assert.equal(isValidRecurrence({ kind: 'daily', time: '08:00' }), true)
})

test('describeRecurrence produces a human summary', () => {
  assert.match(describeRecurrence({ kind: 'daily', time: '08:00' }), /Todo dia às 08:00/)
  assert.match(describeRecurrence({ kind: 'weekly', time: '09:00', weekdays: [1, 3] }), /seg, qua/)
})
