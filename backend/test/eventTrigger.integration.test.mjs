// INTEGRATION: agent event triggers (the agent-native webhook), against a REAL
// mongod. What the user creates is "um gatilho"; what exists underneath is the same
// published automation the receiver already knows how to fire — so the properties
// that matter are: the definition really runs THIS agent, the signature is required
// by default, the secret is shown once and never again, a rotation invalidates the
// old one, and pausing takes the endpoint off the air.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { buildEventTriggerDefinition, createEventTrigger, getEventTriggerForAgent, listEventTriggers, updateEventTrigger } = await import(
  '../dist/automations/eventTrigger.js'
)
const { setStatus } = await import('../dist/automations/service.js')
const { listRoutines } = await import('../dist/automations/routine.js')
const { decrypt } = await import('../dist/crypto.js')
const { signBody, verifySignature } = await import('../dist/automations/webhook.js')

before(async () => {
  await mongoClient.connect()
  // The unique (ownerId, idempotencyKey) index IS the redelivery guard — without it
  // a replayed event would quietly create a second run.
  const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
  await ensureRunIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'trigger-owner'
const OTHER = 'other-owner'
const FLOOR = new ObjectId()
const BUILDING = new ObjectId()
const AGENT = new ObjectId()
const FOREIGN_AGENT = new ObjectId()

const automations = () => db.collection('automations')
const agents = () => db.collection('agents')
const floors = () => db.collection('offices')
const buildings = () => db.collection('buildings')

beforeEach(async () => {
  await Promise.all([automations().deleteMany({}), agents().deleteMany({}), floors().deleteMany({}), buildings().deleteMany({})])
  await buildings().insertOne({ _id: BUILDING, ownerId: OWNER, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  await floors().insertOne({ _id: FLOOR, ownerId: OWNER, buildingId: BUILDING, name: 'Térreo', status: 'active', createdAt: new Date() })
  await agents().insertMany([
    { _id: AGENT, ownerId: OWNER, name: 'Ana', objective: 'Atender', officeId: FLOOR, activationModes: [] },
    { _id: FOREIGN_AGENT, ownerId: OTHER, name: 'De outro', objective: '', officeId: FLOOR, activationModes: [] },
  ])
})

const spec = (over = {}) => ({ name: 'Novo pedido', objective: 'Analisar o pedido recebido e responder ao time.', ...over })

// --- the definition ---------------------------------------------------------------

test('the definition is a webhook trigger that runs THIS agent, signature required', () => {
  const def = buildEventTriggerDefinition(spec(), AGENT)
  assert.equal(def.trigger.type, 'webhook')
  assert.equal(def.trigger.requireSignature, true, 'an endpoint that runs an agent is never open by default')

  const agentStep = def.steps.find((s) => s.type === 'agent.execute')
  assert.ok(agentStep, 'the whole point is that an agent runs')
  assert.equal(agentStep.config.agentId, AGENT.toString())
  assert.equal(agentStep.config.instruction, spec().objective)

  // The event body reaches the agent through its dependency — the runner hands a
  // step its first dependency's output as `input`.
  const eventStep = def.steps.find((s) => s.type === 'transform.template')
  assert.ok(eventStep)
  assert.equal(eventStep.config.template, '{{input}}')
  assert.deepEqual(agentStep.dependsOn, [eventStep.id])
})

// --- create -----------------------------------------------------------------------

test('creating arms the trigger and returns the secret exactly once', async () => {
  const { trigger, publicKey, secret } = await createEventTrigger(OWNER, AGENT, spec())

  assert.equal(trigger.status, 'active', 'it is armed right away')
  assert.equal(trigger.lastPublishedVersion, 1, 'and published — a draft never fires')
  assert.equal(trigger.publishedTrigger.type, 'webhook')
  assert.ok(publicKey)
  assert.match(secret, /^[0-9a-f]{64}$/, 'a real 32-byte secret')

  // Stored encrypted, and the stored form is not the secret.
  const stored = await automations().findOne({ _id: trigger._id })
  assert.ok(stored.webhookSecretEncrypted)
  assert.notEqual(stored.webhookSecretEncrypted, secret)
  assert.equal(decrypt(stored.webhookSecretEncrypted), secret)

  // Reading it back — the only way the API can — never yields the plaintext again.
  const [listed] = await listEventTriggers(OWNER, AGENT)
  assert.ok(!JSON.stringify(listed).includes(secret), 'the secret is never returned by a listing')
})

test('the secret really validates a signed body (and rejects a tampered one)', async () => {
  const { secret } = await createEventTrigger(OWNER, AGENT, spec())
  const body = JSON.stringify({ pedido: 'A-1' })
  assert.equal(verifySignature(secret, body, signBody(secret, body)), true)
  assert.equal(verifySignature(secret, body, signBody(secret, '{"pedido":"A-2"}')), false)
})

test('a trigger is not a routine — the two surfaces stay separate', async () => {
  await createEventTrigger(OWNER, AGENT, spec())
  assert.equal((await listEventTriggers(OWNER, AGENT)).length, 1)
  assert.equal((await listRoutines(OWNER, AGENT)).length, 0, 'a webhook must never be listed as a scheduled routine')
})

test('an objective is required', async () => {
  await assert.rejects(() => createEventTrigger(OWNER, AGENT, spec({ objective: '   ' })), /objective/)
})

test("an agent of another account is never reachable", async () => {
  await assert.rejects(() => createEventTrigger(OWNER, FOREIGN_AGENT, spec()), /agent not found/)
  assert.equal(await automations().countDocuments({}), 0)
})

// --- rotate / edit / pause -----------------------------------------------------------

test('rotating replaces the credential: the old one stops validating', async () => {
  const { trigger, secret: first } = await createEventTrigger(OWNER, AGENT, spec())
  const { rotateWebhookSecret } = await import('../dist/automations/service.js')
  const rotated = await rotateWebhookSecret(OWNER, trigger._id)

  assert.notEqual(rotated.secret, first)
  const stored = await automations().findOne({ _id: trigger._id })
  assert.equal(decrypt(stored.webhookSecretEncrypted), rotated.secret)

  const body = '{"x":1}'
  assert.equal(verifySignature(rotated.secret, body, signBody(rotated.secret, body)), true)
  assert.equal(verifySignature(rotated.secret, body, signBody(first, body)), false, 'the previous credential is dead')
  assert.equal(stored.webhookPublicKey, trigger.webhookPublicKey, 'the endpoint itself does not change')
})

test('editing the objective keeps the endpoint working', async () => {
  const { trigger, publicKey } = await createEventTrigger(OWNER, AGENT, spec())
  const updated = await updateEventTrigger(OWNER, AGENT, trigger._id, spec({ objective: 'Outro objetivo agora.' }))
  assert.equal(updated.description, 'Outro objetivo agora.')
  assert.equal(updated.webhookPublicKey, publicKey, 'a rename must never break an integrated caller')
  assert.equal(updated.publishedTrigger.type, 'webhook')
  assert.equal(updated.lastPublishedVersion, 2, 'the change is published — the draft alone would never run')
})

test('pausing takes it off the air, reactivating puts it back', async () => {
  const { trigger } = await createEventTrigger(OWNER, AGENT, spec())
  const paused = await setStatus(OWNER, trigger._id, 'paused')
  assert.equal(paused.status, 'paused')

  const reactivated = await setStatus(OWNER, trigger._id, 'active')
  assert.equal(reactivated.status, 'active')
  assert.equal(reactivated.publishedTrigger.type, 'webhook', 'still the published shape after the round trip')
})

test('ownership is checked on every lookup, both ways', async () => {
  const { trigger } = await createEventTrigger(OWNER, AGENT, spec())
  assert.ok(await getEventTriggerForAgent(OWNER, AGENT, trigger._id))
  assert.equal(await getEventTriggerForAgent(OTHER, AGENT, trigger._id), null, 'another owner sees nothing')
  assert.equal(await getEventTriggerForAgent(OWNER, new ObjectId(), trigger._id), null, 'another agent of the same owner sees nothing')
  assert.equal(await updateEventTrigger(OWNER, new ObjectId(), trigger._id, spec()), null)
})

test('creating a trigger makes "evento" an allowed activation for the agent', async () => {
  await createEventTrigger(OWNER, AGENT, spec())
  const agent = await agents().findOne({ _id: AGENT })
  assert.ok((agent.activationModes ?? []).includes('event'), 'an armed webhook that the agent may not answer would be a lie')
})

// --- the receiver, end to end -------------------------------------------------------
// The public route is mounted exactly as production mounts it (raw body captured for
// the HMAC), so what is proven here is what an integrator will experience.
const express = (await import('express')).default
const { webhookRouter } = await import('../dist/routes/webhookRoutes.js')

function startReceiver() {
  const app = express()
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))
  app.use('/api/hooks', webhookRouter)
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }))
  })
}

const post = (port, publicKey, body, headers = {}) =>
  fetch(`http://127.0.0.1:${port}/api/hooks/automations/${publicKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })

test('the endpoint runs the agent only when the signature checks out', async () => {
  const { trigger, publicKey, secret } = await createEventTrigger(OWNER, AGENT, spec())
  const { server, port } = await startReceiver()
  try {
    const body = JSON.stringify({ pedido: 'A-1' })

    const unsigned = await post(port, publicKey, body)
    assert.equal(unsigned.status, 401, 'no signature, no run')

    const wrong = await post(port, publicKey, body, { 'x-signature': signBody('outra-credencial', body) })
    assert.equal(wrong.status, 401)

    const ok = await post(port, publicKey, body, { 'x-signature': signBody(secret, body), 'x-event-id': 'evt-1' })
    assert.equal(ok.status, 202)
    const queued = await db.collection('automation_runs').find({ automationId: trigger._id }).toArray()
    assert.equal(queued.length, 1)
    assert.equal(queued[0].status, 'queued')
    assert.equal(queued[0].triggerType, 'webhook')
    assert.deepEqual(queued[0].triggerPayload, { pedido: 'A-1' })

    // Same x-event-id redelivered: still exactly one run.
    const replay = await post(port, publicKey, body, { 'x-signature': signBody(secret, body), 'x-event-id': 'evt-1' })
    assert.equal(replay.status, 202)
    assert.equal(await db.collection('automation_runs').countDocuments({ automationId: trigger._id }), 1, 'idempotency by x-event-id survives')
  } finally {
    server.close()
    await db.collection('automation_runs').deleteMany({})
  }
})

test('a paused trigger is off the air; reactivating brings it back', async () => {
  const { trigger, publicKey, secret } = await createEventTrigger(OWNER, AGENT, spec())
  const { server, port } = await startReceiver()
  try {
    const body = '{"x":1}'
    const sign = { 'x-signature': signBody(secret, body) }

    await setStatus(OWNER, trigger._id, 'paused')
    const paused = await post(port, publicKey, body, { ...sign, 'x-event-id': 'evt-a' })
    assert.equal(paused.status, 404, 'a paused trigger must not fire — and must not reveal that it exists')
    assert.equal(await db.collection('automation_runs').countDocuments({ automationId: trigger._id }), 0)

    await setStatus(OWNER, trigger._id, 'active')
    const live = await post(port, publicKey, body, { ...sign, 'x-event-id': 'evt-b' })
    assert.equal(live.status, 202)
    assert.equal(await db.collection('automation_runs').countDocuments({ automationId: trigger._id }), 1)
  } finally {
    server.close()
    await db.collection('automation_runs').deleteMany({})
  }
})

test('an unpublished draft change never opens or closes a live endpoint', async () => {
  const { trigger, publicKey, secret } = await createEventTrigger(OWNER, AGENT, spec())
  const { server, port } = await startReceiver()
  try {
    // Someone edits the DRAFT into a schedule and does not publish.
    await automations().updateOne(
      { _id: trigger._id },
      { $set: { trigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 9 * * *' } } },
    )
    const body = '{"x":1}'
    const res = await post(port, publicKey, body, { 'x-signature': signBody(secret, body), 'x-event-id': 'evt-draft' })
    assert.equal(res.status, 202, 'what was PUBLISHED is still a webhook, so it still answers')
    assert.equal(await db.collection('automation_runs').countDocuments({ automationId: trigger._id }), 1)
  } finally {
    server.close()
    await db.collection('automation_runs').deleteMany({})
  }
})

test('a webhook run correlates without carrying anything from the event', async () => {
  const { trigger, publicKey, secret } = await createEventTrigger(OWNER, AGENT, spec())
  const { server, port } = await startReceiver()
  try {
    const body = JSON.stringify({ pedido: 'A-1', cliente: 'DADO-PRIVADO' })
    await post(port, publicKey, body, { 'x-signature': signBody(secret, body), 'x-event-id': 'evt-do-provedor' })
    const [run] = await db.collection('automation_runs').find({ automationId: trigger._id }).toArray()

    assert.match(run.requestId, /^webhook:[0-9a-f-]{36}$/, 'generated here, per delivery')
    // Neither the caller's event id nor the body belongs in a field the UI shows.
    assert.ok(!run.requestId.includes('evt-do-provedor'))
    assert.ok(!run.requestId.includes('DADO-PRIVADO'))
    assert.ok(!run.requestId.includes('A-1'))
    assert.notEqual(run.requestId, run.idempotencyKey, 'the idempotency key is built from the payload; the correlation is not')
  } finally {
    server.close()
    await db.collection('automation_runs').deleteMany({})
  }
})

test('each event gets its OWN correlation, and a redelivery keeps the first one', async () => {
  const { trigger, publicKey, secret } = await createEventTrigger(OWNER, AGENT, spec())
  const { server, port } = await startReceiver()
  try {
    const sign = (body) => ({ 'x-signature': signBody(secret, body) })
    const first = JSON.stringify({ pedido: 'A-1' })
    const second = JSON.stringify({ pedido: 'A-2' })

    await post(port, publicKey, first, { ...sign(first), 'x-event-id': 'evt-1' })
    await post(port, publicKey, second, { ...sign(second), 'x-event-id': 'evt-2' })

    const runs = await db.collection('automation_runs').find({ automationId: trigger._id }).sort({ queuedAt: 1 }).toArray()
    assert.equal(runs.length, 2)
    // Two different events must not share a correlation — that was the bug: every
    // execution of the same trigger reported the same string.
    assert.notEqual(runs[0].requestId, runs[1].requestId)

    // A redelivery of evt-1 creates NO run and keeps the original correlation.
    const original = runs[0].requestId
    const replay = await post(port, publicKey, first, { ...sign(first), 'x-event-id': 'evt-1' })
    assert.equal(replay.status, 202)
    const after = await db.collection('automation_runs').find({ automationId: trigger._id }).sort({ queuedAt: 1 }).toArray()
    assert.equal(after.length, 2, 'idempotency still holds')
    assert.equal(after[0].requestId, original, 'the existing execution keeps its own correlation')
  } finally {
    server.close()
    await db.collection('automation_runs').deleteMany({})
  }
})
