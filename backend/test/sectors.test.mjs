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

test('setor orquestrado com o coordenador sozinho avisa, sem bloquear', () => {
  // Executa (por isso não bloqueia), mas não delega para ninguém — e no painel de teste
  // isso aparece como um agente só, que parece defeito.
  const c = new ObjectId()
  const sozinho = sectorReadiness({ mode: 'orchestrated', members: [{ agentId: c }], coordinatorAgentId: c })
  assert.equal(sozinho.ready, true)
  assert.ok(sozinho.issues.some((i) => i.code === 'coordinator_alone'))
  const comTime = sectorReadiness({ mode: 'orchestrated', members: [{ agentId: c }, { agentId: new ObjectId() }], coordinatorAgentId: c })
  assert.ok(!comTime.issues.some((i) => i.code === 'coordinator_alone'))
})

test('sectorIsExecutable: only orchestrated/pipeline run', () => {
  assert.equal(sectorIsExecutable('organization'), false)
  assert.equal(sectorIsExecutable('orchestrated'), true)
  assert.equal(sectorIsExecutable('pipeline'), true)
})

test('sectorReadiness by mode', () => {
  const member = { agentId: new ObjectId(), isDefault: true, sector: '', routingDescription: '', advanceWhen: '', transitions: [] }
  const agentId = new ObjectId()
  // organization: any member is enough
  assert.equal(sectorReadiness({ mode: 'organization', members: [member] }).ready, true)
  assert.equal(sectorReadiness({ mode: 'organization', members: [] }).ready, false)
  // orchestrated: needs a coordinator AND a member
  assert.equal(sectorReadiness({ mode: 'orchestrated', members: [member], coordinatorAgentId: new ObjectId() }).ready, true)
  assert.equal(sectorReadiness({ mode: 'orchestrated', members: [member], coordinatorAgentId: null }).ready, false)
  assert.equal(sectorReadiness({ mode: 'orchestrated', members: [], coordinatorAgentId: new ObjectId() }).ready, false)
  // pipeline: needs stages, and every stage needs an agent
  assert.equal(sectorReadiness({ mode: 'pipeline', members: [], stages: [{ id: 'a', name: 'A', agentId }] }).ready, true)
  assert.equal(sectorReadiness({ mode: 'pipeline', members: [], stages: [] }).ready, false)
  assert.equal(sectorReadiness({ mode: 'pipeline', members: [], stages: [{ id: 'a', name: 'A', agentId: null }] }).ready, false)
})

test('sectorReadiness: legacy adaptive sectors are read as orchestrated, never as broken', () => {
  const member = { agentId: new ObjectId() }
  const r = sectorReadiness({ mode: 'adaptive', members: [member], coordinatorAgentId: new ObjectId() })
  assert.equal(r.ready, true)
  assert.deepEqual(r.issues, [])
})

test('sectorReadiness: a stage pointing at a removed agent is blocking and names the stage', () => {
  const r = sectorReadiness({
    mode: 'pipeline',
    members: [],
    stages: [{ id: 's1', name: 'Triagem', agentId: new ObjectId() }],
    knownAgentIds: [new ObjectId().toString()],
  })
  assert.equal(r.ready, false)
  assert.equal(r.issues[0].code, 'stage_without_agent')
  assert.match(r.issues[0].message, /Triagem/)
})

test('sectorReadiness: an agent with its own pending setup warns but never blocks the sector', () => {
  const r = sectorReadiness({ mode: 'organization', members: [{ agentId: new ObjectId() }], pendingAgentNames: ['Ana'] })
  assert.equal(r.ready, true)
  assert.deepEqual(r.issues.map((i) => i.code), ['agent_pending'])
  assert.deepEqual(r.issues.map((i) => i.severity), ['warning'])
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
