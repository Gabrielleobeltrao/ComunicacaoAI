// INTEGRATION: "Logs e auditoria" end to end — the middleware that records changes
// and the two read-only timelines — against a REAL mongod and a REAL express app
// wired the way index.ts wires it.
//
// The load-bearing claims: a change made through the API shows up in the trail with
// no help from the handler; a read never does; the execution detail explains what
// happened without ever revealing what was said; and no owner can read another's.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { ensureAuditIndexes } = await import('../dist/audit.js')
const { auditRequests } = await import('../dist/routes/auditMiddleware.js')
const { logRouter } = await import('../dist/routes/logRoutes.js')
const express = (await import('express')).default

const OWNER = 'log-owner'
const OTHER = 'other-owner'
const FLOOR = new ObjectId()
const AGENT = new ObjectId()
const AUTOMATION = new ObjectId()

const audit = () => db.collection('audit_events')
const runs = () => db.collection('automation_runs')
const stepRuns = () => db.collection('step_runs')
const artifacts = () => db.collection('artifacts')
const deliveries = () => db.collection('deliveries')
const automations = () => db.collection('automations')
const agents = () => db.collection('agents')
const floors = () => db.collection('offices')

let server
let port
// Which owner the fake session belongs to — flipped by a test to prove isolation.
let sessionOwner = OWNER

before(async () => {
  await mongoClient.connect()
  await ensureAuditIndexes()

  const app = express()
  app.use(express.json())
  // Exactly the order index.ts uses: the audit middleware sits in front of
  // everything and reads res.locals.userId once the route has authenticated.
  app.use(auditRequests)
  const auth = (_req, res, next) => {
    res.locals.userId = sessionOwner
    next()
  }
  // Stand-ins for the real mutating routes: the middleware must audit them
  // WITHOUT any cooperation from the handler.
  app.post('/api/agents', auth, (_req, res) => res.status(201).json({ ok: true }))
  app.patch('/api/agents/:id', auth, (_req, res) => res.json({ ok: true }))
  app.delete('/api/tools/:id', auth, (_req, res) => res.status(204).end())
  // A real delete, so the label captured BEFORE the handler can be asserted.
  app.delete('/api/agents/:id', auth, async (req, res) => {
    await db.collection('agents').deleteOne({ _id: new ObjectId(req.params.id), ownerId: res.locals.userId })
    res.status(204).end()
  })
  app.post('/api/agents/:id/routines/:rid/pause', auth, (_req, res) => res.json({ ok: true }))
  app.post('/api/sectors', auth, (_req, res) => res.status(500).json({ error: 'boom' }))
  app.patch('/api/floors/:id', auth, (_req, res) => res.status(400).json({ error: 'nome inválido' }))
  app.get('/api/agents', auth, (_req, res) => res.json([]))
  app.use('/api/logs', auth, logRouter)

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port
      resolve()
    })
  })
})

after(async () => {
  server?.close()
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const call = (method, path, body) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

const json = async (path) => {
  const res = await call('GET', path)
  assert.equal(res.status, 200, `${path} answered ${res.status}`)
  return res.json()
}

// A finished run with everything an execution can produce.
async function seedRun(over = {}) {
  const id = new ObjectId()
  await runs().insertOne({
    _id: id,
    ownerId: over.ownerId ?? OWNER,
    buildingId: new ObjectId(),
    floorId: FLOOR,
    automationId: AUTOMATION,
    automationVersion: 3,
    definitionHash: 'h',
    // Everything that must never reach a log screen:
    definitionSnapshot: { steps: [{ config: { instruction: 'PROMPT-DO-SISTEMA' } }] },
    triggerPayload: { cliente: 'PAYLOAD-DO-WEBHOOK' },
    finalOutput: 'SAIDA-COMPLETA-DO-AGENTE',
    triggerType: 'schedule',
    idempotencyKey: `log-${id.toString()}`,
    status: 'succeeded',
    currentStepId: null,
    queuedAt: new Date('2026-08-15T12:00:00Z'),
    startedAt: new Date('2026-08-15T12:00:01Z'),
    finishedAt: new Date('2026-08-15T12:00:04Z'),
    cancelRequestedAt: null,
    usage: { inputTokens: 120, outputTokens: 80 },
    error: null,
    ...over,
    _id: id,
  })
  return id
}

beforeEach(async () => {
  sessionOwner = OWNER
  await Promise.all([
    audit().deleteMany({}),
    runs().deleteMany({}),
    stepRuns().deleteMany({}),
    artifacts().deleteMany({}),
    deliveries().deleteMany({}),
    automations().deleteMany({}),
    agents().deleteMany({}),
    floors().deleteMany({}),
  ])
  await floors().insertOne({ _id: FLOOR, ownerId: OWNER, name: 'Térreo' })
  await agents().insertOne({ _id: AGENT, ownerId: OWNER, name: 'Ana', objective: 'Atender', officeId: FLOOR })
  await automations().insertOne({
    _id: AUTOMATION,
    ownerId: OWNER,
    buildingId: new ObjectId(),
    floorId: FLOOR,
    agentId: AGENT,
    name: 'Resumo diário',
    description: 'Consolidar o dia',
    status: 'active',
    trigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 9 * * *' },
    draftDefinition: {},
    publishedTrigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 9 * * *' },
    lastPublishedVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})

// The middleware writes on 'finish', which happens after the response is delivered.
const settle = () => new Promise((r) => setTimeout(r, 60))

// --- the middleware records, the handlers do nothing --------------------------------

test('a change made through the API lands in the trail by itself', async () => {
  await call('POST', '/api/agents', { name: 'Ana', objective: 'x' })
  await settle()

  const stored = await audit().findOne({ ownerId: OWNER })
  assert.equal(stored.action, 'create')
  assert.equal(stored.entityType, 'agent')
  assert.equal(stored.result, 'success')
  assert.equal(stored.actorType, 'user')
  assert.equal(stored.actorId, OWNER)
  assert.ok(stored.requestId, 'and it carries the request that produced it')
})

test('the request id is returned to the caller, so it can be quoted later', async () => {
  const res = await call('POST', '/api/agents', { name: 'Ana' })
  await settle()
  const header = res.headers.get('x-request-id')
  assert.ok(header)
  const stored = await audit().findOne({ ownerId: OWNER })
  assert.equal(stored.requestId, header, 'the header and the record are the same request')
})

test('the body never reaches the trail', async () => {
  await call('POST', '/api/agents', {
    name: 'Ana',
    objective: 'PROMPT-SECRETO',
    apiKey: 'sk-live-123',
    password: 'hunter2',
  })
  await settle()
  const stored = await audit().findOne({ ownerId: OWNER })
  const serialized = JSON.stringify(stored)
  for (const secret of ['PROMPT-SECRETO', 'sk-live-123', 'hunter2']) {
    assert.ok(!serialized.includes(secret), `${secret} must never be stored`)
  }
  assert.deepEqual(Object.keys(stored.metadata).sort(), ['method', 'statusCode'])
})

test('every kind of change is recognised from its route', async () => {
  await call('PATCH', '/api/agents/000000000000000000000a11', { name: 'novo' })
  await call('DELETE', '/api/tools/000000000000000000000701')
  await call('POST', '/api/agents/000000000000000000000a11/routines/000000000000000000000b22/pause')
  await settle()

  const all = await audit().find({ ownerId: OWNER }).sort({ occurredAt: 1 }).toArray()
  const shapes = all.map((e) => `${e.action}:${e.entityType}:${e.result}`)
  assert.ok(shapes.includes('update:agent:success'))
  assert.ok(shapes.includes('delete:tool:success'))
  assert.ok(shapes.includes('pause:routine:success'))
  const pause = all.find((e) => e.action === 'pause')
  assert.equal(pause.entityId, '000000000000000000000b22', 'the routine, not the agent')
})

test('a server failure is recorded as a failure; a rejected input is not noise', async () => {
  await call('POST', '/api/sectors', { name: '' }) // 500
  await call('PATCH', '/api/floors/000000000000000000000f11', { name: '' }) // 400
  await settle()

  const all = await audit().find({ ownerId: OWNER }).toArray()
  assert.equal(all.length, 1, 'only the real failure')
  assert.equal(all[0].entityType, 'sector')
  assert.equal(all[0].result, 'failure')
  assert.equal(all[0].metadata.statusCode, 500)
})

test('reading something is not a change', async () => {
  await call('GET', '/api/agents')
  await json('/api/logs/audit?limit=25')
  await settle()
  assert.equal(await audit().countDocuments({}), 0)
})

// --- the execution timeline ----------------------------------------------------------

test('the run timeline says what happened and never what was said', async () => {
  const runId = await seedRun()
  await stepRuns().insertMany([
    { _id: new ObjectId(), ownerId: OWNER, runId, stepId: 'run', stepType: 'agent.execute', attempt: 1, status: 'succeeded', outputPreview: 'PREVIA-DA-SAIDA', artifactIds: [], startedAt: new Date(), finishedAt: new Date(), error: null },
  ])
  await deliveries().insertOne({ _id: new ObjectId(), ownerId: OWNER, runId, provider: 'email', connectionId: new ObjectId(), destinationMasked: 'jo***@exemplo.com', status: 'sent', attempt: 1, providerMessageId: 'm1', idempotencyKey: 'd1', error: null, createdAt: new Date(), sentAt: new Date() })
  await artifacts().insertOne({ _id: new ObjectId(), ownerId: OWNER, buildingId: new ObjectId(), floorId: FLOOR, runId, name: 'resultado', kind: 'markdown', mimeType: 'text/markdown', sizeBytes: 42, content: 'CONTEUDO-DO-ARQUIVO', createdAt: new Date() })

  const page = await json('/api/logs/runs?limit=25')
  assert.equal(page.items.length, 1)
  const item = page.items[0]
  assert.equal(item.name, 'Resumo diário')
  assert.equal(item.agent.name, 'Ana')
  assert.equal(item.place.floorName, 'Térreo')
  assert.equal(item.triggerType, 'schedule')
  assert.equal(item.durationMs, 3000)
  assert.equal(item.tokens, 200)
  assert.equal(item.steps, 1)
  assert.equal(item.deliveries, 1)
  assert.equal(item.artifacts, 1)

  const serialized = JSON.stringify(page)
  for (const forbidden of ['PROMPT-DO-SISTEMA', 'PAYLOAD-DO-WEBHOOK', 'SAIDA-COMPLETA-DO-AGENTE', 'CONTEUDO-DO-ARQUIVO', 'PREVIA-DA-SAIDA']) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} must never appear in a listing`)
  }
})

test('the run detail explains the execution without revealing its content', async () => {
  const runId = await seedRun({ status: 'failed', error: { kind: 'provider', message: 'o modelo recusou o texto do cliente' } })
  await stepRuns().insertOne({ _id: new ObjectId(), ownerId: OWNER, runId, stepId: 'run', stepType: 'agent.execute', attempt: 2, status: 'failed', outputPreview: 'PREVIA-DA-SAIDA', artifactIds: [], startedAt: new Date(), finishedAt: new Date(), error: { kind: 'provider', message: 'falhou' } })
  await artifacts().insertOne({ _id: new ObjectId(), ownerId: OWNER, buildingId: new ObjectId(), floorId: FLOOR, runId, name: 'resultado', kind: 'markdown', mimeType: 'text/markdown', sizeBytes: 42, content: 'CONTEUDO-DO-ARQUIVO', createdAt: new Date() })

  const detail = await json(`/api/logs/runs/${runId.toString()}`)
  assert.equal(detail.status, 'failed')
  assert.equal(detail.automationVersion, 3)
  assert.equal(detail.durationMs, 3000)
  assert.deepEqual(detail.usage, { inputTokens: 120, outputTokens: 80 })
  assert.equal(detail.steps.length, 1)
  assert.equal(detail.steps[0].attempt, 2)
  assert.equal(detail.artifacts[0].sizeBytes, 42, 'metadata of the artifact')

  const serialized = JSON.stringify(detail)
  for (const forbidden of ['PROMPT-DO-SISTEMA', 'PAYLOAD-DO-WEBHOOK', 'SAIDA-COMPLETA-DO-AGENTE', 'CONTEUDO-DO-ARQUIVO', 'PREVIA-DA-SAIDA']) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} must never appear in a detail`)
  }
  assert.ok(!('definitionSnapshot' in detail))
  assert.ok(!('triggerPayload' in detail))
  assert.ok(!('finalOutput' in detail))
  // The error is kept, bounded, because an operator needs to know it failed.
  assert.equal(detail.error.kind, 'provider')
  assert.ok(detail.error.message.length <= 300)
})

test('the timeline filters by period, origin, status and agent', async () => {
  await seedRun({ queuedAt: new Date('2026-08-10T12:00:00Z') })
  await seedRun({ queuedAt: new Date('2026-08-15T12:00:00Z'), triggerType: 'webhook' })
  await seedRun({ queuedAt: new Date('2026-08-15T13:00:00Z'), status: 'failed' })

  assert.equal((await json('/api/logs/runs?limit=25')).items.length, 3)
  assert.equal((await json('/api/logs/runs?triggerType=webhook')).items.length, 1)
  assert.equal((await json('/api/logs/runs?status=failed')).items.length, 1)
  assert.equal((await json('/api/logs/runs?from=2026-08-14T00:00:00Z')).items.length, 2)
  assert.equal((await json(`/api/logs/runs?agentId=${AGENT.toString()}`)).items.length, 3)
  assert.equal((await json(`/api/logs/runs?agentId=${new ObjectId().toString()}`)).items.length, 0)
})

test('the run cursor pages without repeating a row', async () => {
  const sameInstant = new Date('2026-08-15T12:00:00Z')
  for (let i = 0; i < 5; i++) await seedRun({ queuedAt: sameInstant })

  const first = await json('/api/logs/runs?limit=2')
  assert.equal(first.items.length, 2)
  const second = await json(`/api/logs/runs?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)
  const third = await json(`/api/logs/runs?limit=2&cursor=${encodeURIComponent(second.nextCursor)}`)
  const ids = [...first.items, ...second.items, ...third.items].map((i) => i.id)
  assert.equal(ids.length, 5)
  assert.equal(new Set(ids).size, 5)
  assert.equal(third.nextCursor, null)
})

// --- isolation + no write surface ------------------------------------------------------

test("another owner's execution is invisible, in the list and in the detail", async () => {
  const mine = await seedRun()
  const theirs = await seedRun({ ownerId: OTHER })

  const page = await json('/api/logs/runs?limit=25')
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].id, mine.toString())

  // The detail re-validates ownership instead of trusting the id it was handed.
  const forbidden = await call('GET', `/api/logs/runs/${theirs.toString()}`)
  assert.equal(forbidden.status, 404, 'and it looks exactly like something that does not exist')
})

test("another owner's changes are invisible too", async () => {
  await call('POST', '/api/agents', { name: 'meu' })
  sessionOwner = OTHER
  await call('POST', '/api/agents', { name: 'alheio' })
  await settle()

  const theirs = await json('/api/logs/audit?limit=25')
  assert.equal(theirs.items.length, 1)
  sessionOwner = OWNER
  const mine = await json('/api/logs/audit?limit=25')
  assert.equal(mine.items.length, 1)
  assert.notEqual(mine.items[0].id, theirs.items[0].id)
})

test('the audit trail has no write surface at all', async () => {
  await call('POST', '/api/agents', { name: 'Ana' })
  await settle()
  const [event] = (await json('/api/logs/audit?limit=25')).items

  for (const method of ['PATCH', 'DELETE', 'PUT', 'POST']) {
    const res = await call(method, `/api/logs/audit/${event.id}`)
    assert.ok(res.status === 404 || res.status === 405, `${method} on an audit event must not be routed (got ${res.status})`)
  }
  assert.equal(await audit().countDocuments({ ownerId: OWNER }), 1, 'and nothing was removed')
})

// --- hardening round: names, new filters, correlation, safe errors -------------------

test('a change names the entity it touched, resolved in batch at read time', async () => {
  await call('PATCH', `/api/agents/${AGENT.toString()}`, { name: 'novo' })
  await settle()
  const [event] = (await json('/api/logs/audit?limit=25')).items
  assert.equal(event.entityType, 'agent')
  assert.equal(event.entityLabel, 'Ana', 'the CURRENT name, read from the agent itself')
})

test('a deleted entity keeps the short name captured before it went', async () => {
  const doomed = new ObjectId()
  await agents().insertOne({ _id: doomed, ownerId: OWNER, name: 'Pesquisador Político', objective: 'x', officeId: FLOOR })
  await call('DELETE', `/api/agents/${doomed.toString()}`)
  await settle()
  assert.equal(await agents().countDocuments({ _id: doomed }), 0, 'it really is gone')

  const [event] = (await json('/api/logs/audit?limit=25')).items
  assert.equal(event.action, 'delete')
  assert.equal(event.entityLabel, 'Pesquisador Político', 'captured before the deletion, since afterwards there is nothing to read')
  // A label is a NAME, never content: short and single-line.
  assert.ok(event.entityLabel.length <= 80)
  assert.ok(!event.entityLabel.includes('\n'))
})

test('a label is never read across owners', async () => {
  const foreign = new ObjectId()
  await agents().insertOne({ _id: foreign, ownerId: OTHER, name: 'Agente da outra conta', objective: '', officeId: FLOOR })
  await call('PATCH', `/api/agents/${foreign.toString()}`, { name: 'x' })
  await settle()
  const [event] = (await json('/api/logs/audit?limit=25')).items
  assert.equal(event.entityId, foreign.toString())
  assert.equal(event.entityLabel, null, "another owner's name must not be resolved")
})

test('the changes tab filters by actor and searches the entity', async () => {
  await call('PATCH', `/api/agents/${AGENT.toString()}`, { name: 'novo' })
  await call('DELETE', '/api/tools/000000000000000000000701')
  await settle()

  assert.equal((await json('/api/logs/audit?actorType=user')).items.length, 2)
  assert.equal((await json('/api/logs/audit?actorType=system')).items.length, 0)
  assert.equal((await json(`/api/logs/audit?actorId=${OWNER}`)).items.length, 2)

  // By id…
  const byId = await json(`/api/logs/audit?q=${AGENT.toString()}`)
  assert.equal(byId.items.length, 1)
  assert.equal(byId.items[0].entityType, 'agent')
  // …and combined with another filter, still conjunctive.
  assert.equal((await json(`/api/logs/audit?q=${AGENT.toString()}&action=delete`)).items.length, 0)
})

test('the search matches the name kept for a deleted entity, and never runs as a regex', async () => {
  const doomed = new ObjectId()
  await agents().insertOne({ _id: doomed, ownerId: OWNER, name: 'Pesquisador Político', objective: '', officeId: FLOOR })
  await call('DELETE', `/api/agents/${doomed.toString()}`)
  await settle()

  assert.equal((await json('/api/logs/audit?q=Pesquisador')).items.length, 1)
  assert.equal((await json('/api/logs/audit?q=pesquisador')).items.length, 1, 'case-insensitive')
  // A search box is not a place to accept a regular expression.
  assert.equal((await json('/api/logs/audit?q=.*')).items.length, 0)
})

test('the execution timeline filters by sector, combined with the rest', async () => {
  await db.collection('sectors').insertOne({ _id: new ObjectId('000000000000000000000c33'), ownerId: OWNER, name: 'Atendimento', officeId: FLOOR, members: [{ agentId: AGENT }] })
  await seedRun()
  try {
    assert.equal((await json('/api/logs/runs?sectorId=000000000000000000000c33')).items.length, 1)
    assert.equal((await json(`/api/logs/runs?sectorId=000000000000000000000c33&agentId=${AGENT.toString()}`)).items.length, 1)
    // An agent outside that sector, with the sector still applied: nothing.
    assert.equal((await json(`/api/logs/runs?sectorId=000000000000000000000c33&agentId=${new ObjectId().toString()}`)).items.length, 0)
    assert.equal((await json('/api/logs/runs?sectorId=000000000000000000000c99')).items.length, 0, 'a sector that is not ours resolves to nobody')
  } finally {
    await db.collection('sectors').deleteMany({})
  }
})

test('an execution carries a safe correlation, and the detail shows it', async () => {
  const runId = await seedRun({ requestId: 'schedule:aut-1:1755259200000' })
  const detail = await json(`/api/logs/runs/${runId.toString()}`)
  assert.equal(detail.requestId, 'schedule:aut-1:1755259200000')
  // A run written before the field existed simply has none.
  const legacy = await seedRun()
  assert.equal((await json(`/api/logs/runs/${legacy.toString()}`)).requestId, null)
})

test('a stored error message never reaches the log, at any level', async () => {
  const runId = await seedRun({
    status: 'failed',
    error: { kind: 'provider', message: 'recusou o prompt "CPF 000.000.000-00" com a chave sk-live-XYZ' },
  })
  await stepRuns().insertOne({
    _id: new ObjectId(),
    ownerId: OWNER,
    runId,
    stepId: 'run',
    stepType: 'agent.execute',
    attempt: 1,
    status: 'failed',
    outputPreview: '',
    artifactIds: [],
    startedAt: new Date(),
    finishedAt: new Date(),
    error: { kind: 'fetch', message: 'GET https://api.x/y?api_key=sk-live-XYZ falhou' },
  })
  await deliveries().insertOne({
    _id: new ObjectId(),
    ownerId: OWNER,
    runId,
    provider: 'email',
    connectionId: new ObjectId(),
    destinationMasked: 'jo***@exemplo.com',
    status: 'failed',
    attempt: 1,
    providerMessageId: null,
    idempotencyKey: `d-${runId.toString()}`,
    error: { kind: 'delivery', message: 'SMTP 535 auth failed for joao@exemplo.com senha=hunter2' },
    createdAt: new Date(),
    sentAt: null,
  })

  const serialized = JSON.stringify(await json(`/api/logs/runs/${runId.toString()}`))
  for (const secret of ['sk-live-XYZ', 'CPF', 'hunter2', 'joao@exemplo.com', 'api_key', 'https://api.x']) {
    assert.ok(!serialized.includes(secret), `${secret} leaked through an error message`)
  }
  const detail = await json(`/api/logs/runs/${runId.toString()}`)
  // The category still tells an operator what kind of failure it was.
  assert.equal(detail.error.kind, 'provider')
  assert.equal(detail.steps[0].error.kind, 'fetch')
  assert.equal(detail.deliveries[0].error.kind, 'delivery')
  assert.ok(detail.error.message.length > 0, 'and it still says something useful')
})
