// INTEGRATION: the audit trail, against a REAL mongod.
//
// An audit log is only worth having if two things are true: it cannot be quietly
// edited, and it cannot itself become a leak. So what is pinned here is append-only
// behaviour, owner isolation, stable cursor paging — and, above all, that a payload,
// a credential or a prompt CANNOT get in, because the metadata is built from an
// allowlist rather than scrubbed afterwards.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()

const { mongoClient, db } = await import('../dist/db.js')
const { ensureAuditIndexes, listAuditEvents, recordAudit, safeMetadata, RETENTION_NOTE } = await import('../dist/audit.js')
const { auditTargetFor } = await import('../dist/routes/auditMiddleware.js')

before(async () => {
  await mongoClient.connect()
  await ensureAuditIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'audit-owner'
const OTHER = 'other-owner'
const events = () => db.collection('audit_events')
const PAGE = { limit: 25 }

beforeEach(() => events().deleteMany({}))

const write = (over = {}) =>
  recordAudit({
    ownerId: OWNER,
    actorType: 'user',
    actorId: OWNER,
    action: 'update',
    entityType: 'agent',
    entityId: '000000000000000000000a11',
    result: 'success',
    requestId: 'req-1',
    ...over,
  })

// --- what may be stored --------------------------------------------------------------

test('metadata is an ALLOWLIST: anything not on it never reaches the database', () => {
  const kept = safeMetadata({
    // allowed, small operational facts
    status: 'paused',
    statusCode: 200,
    method: 'PATCH',
    count: 3,
    // everything a leak is made of
    body: { pergunta: 'quanto custa?' },
    prompt: 'Você é um assistente...',
    payload: { cliente: 'Fulano', cpf: '000' },
    authorization: 'Bearer sk-live-123',
    cookie: 'session=abc',
    apiKey: 'sk-live-123',
    password: 'hunter2',
    secret: 'shhh',
    signature: 'deadbeef',
    env: 'MONGODB_URI=mongodb://user:pass@host',
    output: 'o texto completo que o agente gerou',
    error: 'falhou ao processar o e-mail joao@exemplo.com',
  })
  assert.deepEqual(kept, { status: 'paused', statusCode: 200, method: 'PATCH', count: 3 })
})

test('an allowlisted key still cannot carry a payload', () => {
  // Objects and arrays are dropped, not stringified: those are the shapes a body
  // arrives in.
  assert.deepEqual(safeMetadata({ status: { nested: 'objeto' } }), {})
  assert.deepEqual(safeMetadata({ status: ['a', 'b'] }), {})
  // And a long string is a payload, not a fact about one.
  assert.deepEqual(safeMetadata({ reason: 'x'.repeat(500) }), {})
  assert.deepEqual(safeMetadata({ reason: 'limite atingido' }), { reason: 'limite atingido' })
})

test('what is written is exactly what the allowlist kept', async () => {
  await write({ metadata: { status: 'active', prompt: 'segredo do sistema', authorization: 'Bearer sk-live' } })
  const stored = await events().findOne({ ownerId: OWNER })
  assert.deepEqual(stored.metadata, { status: 'active' })
  const serialized = JSON.stringify(stored)
  assert.ok(!serialized.includes('sk-live'))
  assert.ok(!serialized.includes('segredo do sistema'))
})

test('an event carries who, what, when and the request that produced it', async () => {
  const before = new Date()
  await write({ action: 'pause', entityType: 'routine', entityId: 'r1', floorId: 'f1', requestId: 'req-42', metadata: { status: 'paused' } })
  const stored = await events().findOne({ ownerId: OWNER })
  assert.equal(stored.actorType, 'user')
  assert.equal(stored.actorId, OWNER)
  assert.equal(stored.action, 'pause')
  assert.equal(stored.entityType, 'routine')
  assert.equal(stored.entityId, 'r1')
  assert.equal(stored.floorId, 'f1')
  assert.equal(stored.result, 'success')
  assert.equal(stored.requestId, 'req-42')
  assert.ok(stored.occurredAt >= before)
})

test('a failed write is reported, never thrown into the caller', async () => {
  // A document the driver cannot serialize would fail the insert; the mutation that
  // produced it must not be undone by it.
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args.join(' '))
  try {
    const cyclic = {}
    cyclic.self = cyclic
    await write({ metadata: { status: 'ok' }, occurredAt: cyclic })
  } finally {
    console.error = original
  }
  assert.ok(errors.some((e) => e.includes('AUDIT WRITE FAILED')), 'the operator has to learn about it')
})

// --- append-only + isolation ------------------------------------------------------------

test('the module exposes no way to change or remove an event', async () => {
  const audit = await import('../dist/audit.js')
  const exported = Object.keys(audit)
  for (const forbidden of ['updateAudit', 'deleteAudit', 'removeAuditEvent', 'purgeAudit', 'clearAudit']) {
    assert.ok(!exported.includes(forbidden), `${forbidden} must not exist`)
  }
  assert.match(RETENTION_NOTE, /append-only/)
  assert.match(RETENTION_NOTE, /no automatic deletion/)
})

test('one owner never sees another owner\'s trail', async () => {
  await write({ metadata: { status: 'meu' } })
  await write({ ownerId: OTHER, actorId: OTHER, metadata: { status: 'alheio' } })

  const mine = await listAuditEvents(OWNER, {}, PAGE)
  assert.equal(mine.items.length, 1)
  assert.equal(mine.items[0].metadata.status, 'meu')

  const theirs = await listAuditEvents(OTHER, {}, PAGE)
  assert.equal(theirs.items.length, 1)
  assert.equal(theirs.items[0].metadata.status, 'alheio')
})

// --- filters + cursor ------------------------------------------------------------------

test('filters narrow by action, entity, result, actor and period', async () => {
  const day = (d) => new Date(`2026-08-${d}T12:00:00Z`)
  await write({ action: 'create', entityType: 'agent', occurredAt: day('10') })
  await write({ action: 'delete', entityType: 'tool', occurredAt: day('11') })
  await write({ action: 'pause', entityType: 'routine', result: 'failure', occurredAt: day('12') })
  await write({ action: 'update', entityType: 'sector', actorType: 'system', actorId: null, occurredAt: day('13') })

  const only = async (f) => (await listAuditEvents(OWNER, f, PAGE)).items
  assert.equal((await only({ action: 'create' })).length, 1)
  assert.equal((await only({ entityType: 'tool' })).length, 1)
  assert.equal((await only({ result: 'failure' }))[0].action, 'pause')
  assert.equal((await only({ actorType: 'system' })).length, 1)
  assert.equal((await only({ actorId: OWNER })).length, 3)
  assert.equal((await only({ from: day('11'), to: day('12') })).length, 2)
  // Conjunctive: both conditions must hold.
  assert.equal((await only({ action: 'delete', entityType: 'agent' })).length, 0)
})

test('the cursor pages a timeline that never repeats or skips a row', async () => {
  // All in the same millisecond: only the _id tiebreak keeps the page stable.
  const sameInstant = new Date('2026-08-15T12:00:00Z')
  for (let i = 0; i < 7; i++) await write({ entityId: `e${i}`, occurredAt: sameInstant })

  const seen = []
  let cursor
  for (let page = 0; page < 5; page++) {
    const result = await listAuditEvents(OWNER, {}, { limit: 3, cursor })
    seen.push(...result.items.map((i) => i.id))
    cursor = result.nextCursor
    if (!cursor) break
  }
  assert.equal(seen.length, 7, 'every row was returned')
  assert.equal(new Set(seen).size, 7, 'and none of them twice')
})

test('the newest change is the first one read', async () => {
  await write({ entityId: 'antigo', occurredAt: new Date('2026-08-10T12:00:00Z') })
  await write({ entityId: 'recente', occurredAt: new Date('2026-08-15T12:00:00Z') })
  const { items } = await listAuditEvents(OWNER, {}, PAGE)
  assert.equal(items[0].entityId, 'recente')
})

// --- what the middleware decides to record -------------------------------------------

test('a read is never audited', () => {
  assert.equal(auditTargetFor('GET', '/api/agents'), null)
  assert.equal(auditTargetFor('GET', '/api/executions?tab=scheduled'), null)
  assert.equal(auditTargetFor('HEAD', '/api/tools'), null)
})

test('sessions, the public webhook receiver and the log itself are out of scope', () => {
  // Auth carries passwords and tokens; hooks carry a third party's payload; the log
  // reading itself is not a change.
  assert.equal(auditTargetFor('POST', '/api/auth/sign-in/email'), null)
  assert.equal(auditTargetFor('POST', '/api/hooks/automations/pk-abc'), null)
  assert.equal(auditTargetFor('POST', '/api/logs/audit'), null)
})

test('the request line alone says what changed', () => {
  assert.deepEqual(auditTargetFor('POST', '/api/agents'), { entityType: 'agent', entityId: null, action: 'create' })
  assert.deepEqual(auditTargetFor('PATCH', '/api/agents/000000000000000000000a11'), {
    entityType: 'agent',
    entityId: '000000000000000000000a11',
    action: 'update',
  })
  assert.deepEqual(auditTargetFor('DELETE', '/api/tools/000000000000000000000701'), {
    entityType: 'tool',
    entityId: '000000000000000000000701',
    action: 'delete',
  })
})

test('a sub-resource is audited as itself, not as the agent it hangs off', () => {
  assert.deepEqual(auditTargetFor('POST', '/api/agents/000000000000000000000a11/routines'), {
    entityType: 'routine',
    entityId: null,
    action: 'create',
  })
  assert.deepEqual(auditTargetFor('PATCH', '/api/agents/000000000000000000000a11/routines/000000000000000000000b22'), {
    entityType: 'routine',
    entityId: '000000000000000000000b22',
    action: 'update',
  })
  assert.deepEqual(auditTargetFor('POST', '/api/agents/000000000000000000000a11/event-triggers/000000000000000000000b22/rotate'), {
    entityType: 'event_trigger',
    entityId: '000000000000000000000b22',
    action: 'rotate',
  })
})

test('a trailing verb names the action', () => {
  for (const [verb, action] of [
    ['activate', 'activate'],
    ['pause', 'pause'],
    ['archive', 'archive'],
  ]) {
    const target = auditTargetFor('POST', `/api/agents/000000000000000000000a11/routines/000000000000000000000b22/${verb}`)
    assert.equal(target.action, action)
    assert.equal(target.entityType, 'routine')
    assert.equal(target.entityId, '000000000000000000000b22')
  }
})

test('an unknown resource is not invented into the log', () => {
  assert.equal(auditTargetFor('POST', '/api/algo-que-nao-existe'), null)
  assert.equal(auditTargetFor('POST', '/nao-e-api/agents'), null)
})
