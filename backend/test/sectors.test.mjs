// Sector model (Phase C): mode normalization (legacy adaptive), per-mode readiness,
// and stage normalization. Pure — dummy MONGODB_URI so the import doesn't connect.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { normalizeSectorMode, sectorIsExecutable, sectorReadiness, normalizeStages, SECTOR_MODES } = await import('../dist/sectors.js')

test('normalizeSectorMode reads legacy adaptive as orchestrated and unknown as orchestrated', () => {
  assert.equal(normalizeSectorMode('adaptive'), 'orchestrated')
  assert.equal(normalizeSectorMode(undefined), 'orchestrated')
  assert.equal(normalizeSectorMode('weird'), 'orchestrated')
  assert.equal(normalizeSectorMode('organization'), 'organization')
  assert.equal(normalizeSectorMode('pipeline'), 'pipeline')
  assert.deepEqual([...SECTOR_MODES], ['organization', 'orchestrated', 'pipeline'])
})

test('sectorIsExecutable: only orchestrated/pipeline run', () => {
  assert.equal(sectorIsExecutable('organization'), false)
  assert.equal(sectorIsExecutable('orchestrated'), true)
  assert.equal(sectorIsExecutable('pipeline'), true)
})

test('sectorReadiness by mode', () => {
  const member = { agentId: new ObjectId(), isDefault: true, sector: '', routingDescription: '', advanceWhen: '', transitions: [] }
  // organization: any member is enough
  assert.equal(sectorReadiness('organization', [member]), 'ready')
  assert.equal(sectorReadiness('organization', []), 'incomplete')
  // orchestrated: needs a coordinator AND a member
  assert.equal(sectorReadiness('orchestrated', [member], { coordinatorAgentId: new ObjectId() }), 'ready')
  assert.equal(sectorReadiness('orchestrated', [member], { coordinatorAgentId: null }), 'incomplete')
  // pipeline: needs at least one stage
  assert.equal(sectorReadiness('pipeline', [], { stages: [{ id: 'a' }] }), 'ready')
  assert.equal(sectorReadiness('pipeline', [], { stages: [] }), 'incomplete')
})

test('normalizeStages assigns ids, clamps retries and defaults onError to stop', () => {
  const out = normalizeStages([
    { name: 'X', agentId: new ObjectId(), instruction: '', dependsOn: [], inputMapping: {}, expectedOutput: '', retryPolicy: { maxAttempts: 99 }, onError: 'bogus' },
    { id: 'keep', name: 'Y', agentId: new ObjectId(), instruction: '', dependsOn: [], inputMapping: {}, expectedOutput: '', retryPolicy: { maxAttempts: 0 }, onError: 'continue' },
  ])
  assert.equal(out[0].id, 's1')
  assert.equal(out[0].retryPolicy.maxAttempts, 5) // clamped to max
  assert.equal(out[0].onError, 'stop') // unknown -> stop
  assert.equal(out[1].id, 'keep')
  assert.equal(out[1].retryPolicy.maxAttempts, 1) // clamped to min
  assert.equal(out[1].onError, 'continue')
})
