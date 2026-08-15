// Readiness is not "the process answered": it is "this instance can do its whole
// job". The bug behind these tests is a deploy where the API served HTTP happily
// while the embedded automation engine had failed to start — routines were accepted
// and never ran, and every health probe was green.
//
// No database is needed: the engine handle is injected, which is the point — the
// failure path has to be observable without breaking a real MongoDB.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// db.js is imported transitively and requires a URI; nothing here ever connects.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/readiness-test'

const { engineStatus, readiness, startEmbeddedEngine, stopEmbeddedEngine } = await import('../dist/automations/engine.js')

// A stand-in for a live engine: the state machine only cares that it exists.
const fakeEngine = { id: 'test-engine', stop: async () => undefined }
const starterOk = async () => fakeEngine
const starterFails = async () => {
  throw new Error('ensureRunIndexes failed: connection refused')
}

beforeEach(async () => {
  delete process.env.EMBEDDED_WORKER
  await stopEmbeddedEngine()
})

test('EMBEDDED_WORKER=true: not ready until the engine is actually up', async () => {
  const before = readiness(true)
  assert.equal(before.code, 503, 'mongo alone is not enough when the engine belongs here')
  assert.equal(before.body.engine, 'down')
  assert.equal(before.body.mongo, 'ok')

  await startEmbeddedEngine({}, starterOk)

  const after = readiness(true)
  assert.equal(after.code, 200)
  assert.deepEqual(after.body, { status: 'ready', mongo: 'ok', engine: 'embedded' })
  assert.equal(engineStatus().running, true)
})

test('a failed start is recorded, never swallowed, and keeps readiness red', async () => {
  const handle = await startEmbeddedEngine({}, starterFails)
  assert.equal(handle, null, 'startup must not throw — it degrades this instance instead')

  const status = engineStatus()
  assert.equal(status.running, false)
  assert.match(status.error, /connection refused/, 'the reason is kept for the operator')
  assert.equal(readiness(true).code, 503, 'an engine that never started can never be ready')
})

test('stopping the engine takes the instance out of rotation', async () => {
  await startEmbeddedEngine({}, starterOk)
  assert.equal(readiness(true).code, 200)

  await stopEmbeddedEngine()
  assert.equal(readiness(true).code, 503, 'draining for shutdown means no longer ready')
})

test('EMBEDDED_WORKER=false: the separate-worker mode is accepted and named', async () => {
  process.env.EMBEDDED_WORKER = 'false'
  const handle = await startEmbeddedEngine({}, starterOk)
  assert.equal(handle, null, 'the engine must NOT be started here in this mode')

  const status = engineStatus()
  assert.equal(status.mode, 'separate')
  assert.equal(status.ok, true)

  const verdict = readiness(true)
  assert.equal(verdict.code, 200)
  assert.equal(verdict.body.engine, 'separate', 'the mode is explicit, so a wrong deploy is visible')
})

test('MongoDB down is never ready, whatever the engine is doing', async () => {
  await startEmbeddedEngine({}, starterOk)
  const verdict = readiness(false)
  assert.equal(verdict.code, 503)
  assert.equal(verdict.body.mongo, 'down')
})
