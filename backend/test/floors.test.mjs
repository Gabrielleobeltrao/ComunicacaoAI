// Pure-logic tests for the Building/Floor domain. The DB-touching paths
// (backfill idempotency, CRUD, ownership isolation) require a real/in-memory
// MongoDB and are covered by integration tests once that infra is wired; here we
// lock the pure validation the migration and API rely on. A dummy MONGODB_URI is
// set before import so db.js loads without connecting (MongoClient is lazy).
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { isValidTimezone, LANGUAGES, DEFAULT_TIMEZONE } = await import('../dist/building.js')

test('isValidTimezone accepts IANA zones and rejects junk', () => {
  assert.equal(isValidTimezone('America/Sao_Paulo'), true)
  assert.equal(isValidTimezone('UTC'), true)
  assert.equal(isValidTimezone('Europe/Lisbon'), true)
  assert.equal(isValidTimezone('Not/AZone'), false)
  assert.equal(isValidTimezone(''), false)
})

test('language set and default timezone are sane', () => {
  assert.ok(LANGUAGES.includes('pt'))
  assert.ok(LANGUAGES.includes('en'))
  assert.ok(LANGUAGES.includes('es'))
  assert.equal(isValidTimezone(DEFAULT_TIMEZONE), true)
})
