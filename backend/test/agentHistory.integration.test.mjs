// INTEGRATION: the agent's own Histórico, against a REAL mongod and the REAL router.
//
// Two things it must never do. It must not hand the browser a shape the browser
// cannot render — a failed routine used to arrive as `error: { kind, message }`
// while the client expected a string, which React refuses outright ("Objects are not
// valid as a React child"). And it must not hand it the engine's stored message,
// which can quote the prompt, the payload or a credential.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { agentRoutineRouter } = await import('../dist/routes/agentRoutineRoutes.js')
const express = (await import('express')).default

const OWNER = 'history-owner'
const OTHER = 'other-owner'
const FLOOR = new ObjectId()
const AGENT = new ObjectId()
const OTHER_AGENT = new ObjectId()
const ROUTINE = new ObjectId()

let server
let port
let sessionOwner = OWNER

before(async () => {
  await mongoClient.connect()
  const app = express()
  app.use(express.json())
  app.use('/api/agents/:agentId', (_req, res, next) => {
    res.locals.userId = sessionOwner
    next()
  }, agentRoutineRouter)
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

const history = async (agentId = AGENT) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/agents/${agentId.toString()}/history`)
  assert.equal(res.status, 200)
  return res.json()
}

beforeEach(async () => {
  sessionOwner = OWNER
  await Promise.all([
    db.collection('agents').deleteMany({}),
    db.collection('offices').deleteMany({}),
    db.collection('automations').deleteMany({}),
    db.collection('automation_runs').deleteMany({}),
    db.collection('agent_delegations').deleteMany({}),
  ])
  await db.collection('offices').insertOne({ _id: FLOOR, ownerId: OWNER, name: 'Térreo' })
  await db.collection('agents').insertMany([
    { _id: AGENT, ownerId: OWNER, name: 'Ana', objective: 'Atender', officeId: FLOOR },
    { _id: OTHER_AGENT, ownerId: OTHER, name: 'De outra conta', objective: '', officeId: FLOOR },
  ])
  await db.collection('automations').insertOne({
    _id: ROUTINE,
    ownerId: OWNER,
    buildingId: new ObjectId(),
    floorId: FLOOR,
    agentId: AGENT,
    name: 'Resumo diário',
    description: 'Consolidar o dia',
    status: 'active',
    trigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 9 * * *' },
    draftDefinition: { trigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 9 * * *' }, steps: [], deliveries: [] },
    publishedTrigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 9 * * *' },
    lastPublishedVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})

// A run that really failed, with the kind of message the engine actually stores.
const LEAKY_MESSAGE = 'o provedor recusou o prompt "CPF 000.000.000-00" usando a chave sk-live-XYZ em https://api.x/y?api_key=sk-live-XYZ'

async function seedFailedRun() {
  await db.collection('automation_runs').insertOne({
    _id: new ObjectId(),
    ownerId: OWNER,
    buildingId: new ObjectId(),
    floorId: FLOOR,
    automationId: ROUTINE,
    automationVersion: 1,
    definitionHash: 'h',
    definitionSnapshot: {},
    triggerPayload: null,
    triggerType: 'schedule',
    idempotencyKey: `hist-${new ObjectId().toString()}`,
    status: 'failed',
    queuedAt: new Date(),
    startedAt: new Date(),
    finishedAt: new Date(),
    usage: { inputTokens: 10, outputTokens: 5 },
    finalOutput: '',
    error: { kind: 'provider', message: LEAKY_MESSAGE },
  })
}

test('a failed routine arrives as an object the UI can render, not a bare string', async () => {
  await seedFailedRun()
  const body = await history()
  assert.equal(body.items.length, 1)
  const item = body.items[0]

  // The shape the client now declares: { kind, message } — and BOTH are plain
  // strings, so rendering `error.message` can never receive an object.
  assert.equal(typeof item.error, 'object')
  assert.equal(typeof item.error.kind, 'string')
  assert.equal(typeof item.error.message, 'string')
  assert.equal(item.error.kind, 'provider')
  assert.ok(item.error.message.length > 0)
  assert.equal(item.status, 'failed')
  assert.equal(item.routineName, 'Resumo diário')
})

test('the engine message never reaches the history', async () => {
  await seedFailedRun()
  const serialized = JSON.stringify(await history())
  for (const secret of ['sk-live-XYZ', 'CPF', 'api_key', 'https://api.x']) {
    assert.ok(!serialized.includes(secret), `${secret} leaked into the agent history`)
  }
})

test('a run that succeeded carries no error at all', async () => {
  await db.collection('automation_runs').insertOne({
    _id: new ObjectId(),
    ownerId: OWNER,
    buildingId: new ObjectId(),
    floorId: FLOOR,
    automationId: ROUTINE,
    automationVersion: 1,
    definitionHash: 'h',
    definitionSnapshot: {},
    triggerType: 'schedule',
    idempotencyKey: `ok-${new ObjectId().toString()}`,
    status: 'succeeded',
    queuedAt: new Date(),
    startedAt: new Date(),
    finishedAt: new Date(),
    usage: { inputTokens: 1, outputTokens: 1 },
    finalOutput: 'pronto',
    error: null,
  })
  const [item] = (await history()).items
  assert.equal(item.error, null)
})

// --- delegations ----------------------------------------------------------------------

const seedDelegation = (over = {}) =>
  db.collection('agent_delegations').insertOne({
    _id: new ObjectId(),
    ownerId: OWNER,
    correlationId: 'c1',
    depth: 1,
    callerAgentId: AGENT,
    targetType: 'agent',
    targetAgentId: new ObjectId(),
    targetSectorId: null,
    parentId: null,
    objective: 'Resumir o relatório',
    status: 'failed',
    denyCode: null,
    outputPreview: 'trecho do resultado',
    error: LEAKY_MESSAGE,
    usage: null,
    createdAt: new Date(),
    finishedAt: new Date(),
    ...over,
  })

test('a failed delegation reports a reason, never the stored message', async () => {
  await seedDelegation()
  const body = await history()
  assert.equal(body.delegations.length, 1)
  const item = body.delegations[0]
  assert.equal(item.error.kind, 'error')
  assert.equal(typeof item.error.message, 'string')
  const serialized = JSON.stringify(body.delegations)
  for (const secret of ['sk-live-XYZ', 'CPF', 'api_key']) {
    assert.ok(!serialized.includes(secret), `${secret} leaked through a delegation error`)
  }
})

test('a denied delegation explains WHICH rule refused it', async () => {
  await seedDelegation({ status: 'denied', denyCode: 'budget_exceeded', error: 'orçamento estourado processando "dados do cliente"' })
  const [item] = (await history()).delegations
  assert.equal(item.error.kind, 'denied')
  assert.match(item.error.message, /orçamento/i)
  assert.equal(item.denyCode, 'budget_exceeded', 'the code itself stays, it is a closed vocabulary')
  assert.ok(!JSON.stringify(item).includes('dados do cliente'))
})

test('the output preview stays — it is what "salvar no conhecimento" uses', async () => {
  await seedDelegation({ status: 'succeeded', error: null })
  const [item] = (await history()).delegations
  assert.equal(item.outputPreview, 'trecho do resultado')
  assert.equal(item.error, null)
})

test('the history is owner-scoped, and another account sees nothing', async () => {
  await seedFailedRun()
  await seedDelegation()
  sessionOwner = OTHER
  const res = await fetch(`http://127.0.0.1:${port}/api/agents/${AGENT.toString()}/history`)
  assert.equal(res.status, 404, "another owner cannot even name this agent's history")
})
