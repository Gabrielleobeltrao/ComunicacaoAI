// Pure-logic tests for the sector invariants the accessible-management plan
// relies on (plan §17.1): operational readiness and the "exactly one default"
// normalization. DB-touching paths (membership transfer, cross-floor rejection,
// move-between-floors) require MongoDB and are exercised by the guarded e2e spec
// (frontend/e2e/sector-management.spec.ts) against a real stack. A dummy
// MONGODB_URI lets sectors.js import without connecting (MongoClient is lazy).
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { sectorReadiness, normalizeMembers, MAX_SECTOR_MEMBERS } = await import('../dist/sectors.js')

const member = (isDefault = false) => ({ agentId: {}, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault })

test('sectorReadiness — adaptive needs >= 1 member and a default', () => {
  assert.equal(sectorReadiness('adaptive', []), 'incomplete')
  assert.equal(sectorReadiness('adaptive', [member(false)]), 'incomplete') // no default
  assert.equal(sectorReadiness('adaptive', [member(true)]), 'ready')
})

test('sectorReadiness — pipeline needs >= 2 members and a default', () => {
  assert.equal(sectorReadiness('pipeline', [member(true)]), 'incomplete') // single stage
  assert.equal(sectorReadiness('pipeline', [member(false), member(false)]), 'incomplete') // no default
  assert.equal(sectorReadiness('pipeline', [member(true), member(false)]), 'ready')
})

test('normalizeMembers — promotes exactly one default when none is flagged', () => {
  const out = normalizeMembers([member(false), member(false), member(false)])
  assert.equal(out.filter((m) => m.isDefault).length, 1)
  assert.equal(out[0].isDefault, true) // first wins when none flagged
})

test('normalizeMembers — keeps a single default and demotes extras', () => {
  const out = normalizeMembers([member(false), member(true), member(true)])
  assert.equal(out.filter((m) => m.isDefault).length, 1)
  assert.equal(out[1].isDefault, true) // first flagged wins
  assert.equal(out[2].isDefault, false)
})

test('normalizeMembers — empty stays empty (a sector may have no agents)', () => {
  assert.deepEqual(normalizeMembers([]), [])
})

test('MAX_SECTOR_MEMBERS is the shared cap', () => {
  assert.equal(MAX_SECTOR_MEMBERS, 10)
})
