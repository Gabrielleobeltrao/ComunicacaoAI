// INTEGRATION: the Central de execuções read model, against a REAL mongod.
//
// It is the one place the whole building's automatic work is listed, so the things
// that must hold are: it reads the PUBLISHED trigger (never a draft), it counts
// tokens from what actually ran, it never returns a secret or a payload, and its
// filters really scope by floor/sector/agent — owner first of all.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { ensureExecutionIndexes, executionSummary, listRunsForCenter, listScheduled, listTriggers, webhookEndpoint } = await import(
  '../dist/automations/executionCenter.js'
)

before(async () => {
  await mongoClient.connect()
  await ensureExecutionIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'exec-owner'
const OTHER = 'other-owner'
const PUBLIC_URL = 'https://api.exemplo.test'
const PAGE = { limit: 20, skip: 0 }

const automations = () => db.collection('automations')
const runs = () => db.collection('automation_runs')
const agents = () => db.collection('agents')
const floors = () => db.collection('offices')
const sectors = () => db.collection('sectors')

const FLOOR_A = new ObjectId()
const FLOOR_B = new ObjectId()
const AGENT_A = new ObjectId()
const AGENT_B = new ObjectId()
const SECTOR = new ObjectId()

const NOW = new Date('2026-08-15T12:00:00Z')

async function seedWorld() {
  await floors().insertMany([
    { _id: FLOOR_A, ownerId: OWNER, name: 'Térreo' },
    { _id: FLOOR_B, ownerId: OWNER, name: 'Primeiro' },
  ])
  await agents().insertMany([
    { _id: AGENT_A, ownerId: OWNER, name: 'Ana', objective: 'Cuidar do atendimento', officeId: FLOOR_A },
    { _id: AGENT_B, ownerId: OWNER, name: 'Bruno', objective: 'Cuidar das compras', officeId: FLOOR_B },
  ])
  await sectors().insertOne({ _id: SECTOR, ownerId: OWNER, name: 'Atendimento', officeId: FLOOR_A, members: [{ agentId: AGENT_A }] })
}

// A published automation, with the draft deliberately DIFFERENT from what was
// published — the read model must never look at the draft.
async function seedAutomation(over = {}) {
  const id = over._id ?? new ObjectId()
  const doc = {
    _id: id,
    ownerId: OWNER,
    buildingId: new ObjectId(),
    floorId: FLOOR_A,
    agentId: AGENT_A,
    name: 'Resumo diário',
    description: 'Consolidar o dia',
    status: 'active',
    // The DRAFT says 18:00; the published version says 09:00.
    trigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 18 * * *' },
    draftDefinition: { trigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 18 * * *' }, steps: [], inputs: [], resultFormat: 'markdown', deliveries: [], limits: {} },
    publishedTrigger: { type: 'schedule', timezone: 'America/Sao_Paulo', cron: '0 9 * * *' },
    nextRunAt: new Date('2026-08-15T12:00:00Z'),
    currentVersion: 1,
    lastPublishedVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
  await automations().insertOne(doc)
  return id
}

let runSeq = 0
async function seedRun(automationId, over = {}) {
  const doc = {
    _id: new ObjectId(),
    ownerId: OWNER,
    buildingId: new ObjectId(),
    floorId: FLOOR_A,
    automationId,
    automationVersion: 1,
    definitionHash: 'h',
    // Sensitive by nature: neither of these may ever appear in a listing.
    definitionSnapshot: { steps: [{ config: { instruction: 'segredo do prompt' } }] },
    triggerPayload: { cliente: 'dado privado' },
    triggerType: 'schedule',
    idempotencyKey: `exec-${++runSeq}`,
    status: 'succeeded',
    currentStepId: null,
    queuedAt: NOW,
    startedAt: NOW,
    finishedAt: NOW,
    usage: { inputTokens: 100, outputTokens: 50 },
    finalOutput: 'resultado completo e privado',
    error: null,
    ...over,
  }
  await runs().insertOne(doc)
  return doc._id
}

beforeEach(async () => {
  await Promise.all([
    automations().deleteMany({}),
    runs().deleteMany({}),
    agents().deleteMany({}),
    floors().deleteMany({}),
    sectors().deleteMany({}),
  ])
  await seedWorld()
})

// --- Agendadas -------------------------------------------------------------------

test('a scheduled item is described by the PUBLISHED trigger, never the draft', async () => {
  await seedAutomation()
  const { items, total } = await listScheduled(OWNER, {}, PAGE, NOW)
  assert.equal(total, 1)
  const item = items[0]
  assert.equal(item.cron, '0 9 * * *', 'the draft says 18:00 — it must not be shown')
  assert.equal(item.scheduleLabel, 'Todo dia às 09:00')
  assert.equal(item.timezone, 'America/Sao_Paulo')
  assert.equal(item.nextRunAt, '2026-08-15T12:00:00.000Z')
})

test('an automation whose published trigger is a webhook is not a schedule', async () => {
  await seedAutomation({ publishedTrigger: { type: 'webhook', requireSignature: true }, webhookPublicKey: 'pk-1', nextRunAt: null })
  assert.equal((await listScheduled(OWNER, {}, PAGE, NOW)).total, 0)
  assert.equal((await listTriggers(OWNER, {}, PAGE, PUBLIC_URL, NOW)).total, 1)
})

test('a draft that was never published never appears', async () => {
  await seedAutomation({ publishedTrigger: null, lastPublishedVersion: null, status: 'draft' })
  assert.equal((await listScheduled(OWNER, {}, PAGE, NOW)).total, 0)
})

test('the row carries agent, floor and sector, resolved in batch', async () => {
  await seedAutomation()
  const [item] = (await listScheduled(OWNER, {}, PAGE, NOW)).items
  assert.equal(item.agent.name, 'Ana')
  assert.equal(item.agent.objective, 'Cuidar do atendimento')
  assert.equal(item.place.floorName, 'Térreo')
  assert.equal(item.place.sectorName, 'Atendimento')
  assert.equal(item.place.sectorId, SECTOR.toString())
})

test('last run and recent consumption come from the runs that really happened', async () => {
  const id = await seedAutomation()
  await seedRun(id, { usage: { inputTokens: 100, outputTokens: 50 }, queuedAt: new Date('2026-08-14T12:00:00Z') })
  await seedRun(id, { usage: { inputTokens: 200, outputTokens: 50 }, queuedAt: new Date('2026-08-15T09:00:00Z'), status: 'failed', error: { kind: 'provider', message: 'a chave sk-live-123 falhou' } })

  const [item] = (await listScheduled(OWNER, {}, PAGE, NOW)).items
  assert.equal(item.recentRuns, 2)
  assert.equal(item.recentTokens, 400, '150 + 250 tokens')
  assert.equal(item.averageTokens, 200, 'an average, over the runs in the window')
  assert.equal(item.lastRun.status, 'failed', 'the newest run is the last one')
  assert.equal(item.lastRun.errorKind, 'provider')
  assert.ok(!JSON.stringify(item).includes('sk-live-123'), 'an error MESSAGE can quote a secret — only the kind is listed')
})

test('no history means no average — never a fabricated zero', async () => {
  await seedAutomation()
  const [item] = (await listScheduled(OWNER, {}, PAGE, NOW)).items
  assert.equal(item.averageTokens, null)
  assert.equal(item.recentRuns, 0)
})

test('runs older than the window are excluded from the average but still the last run', async () => {
  const id = await seedAutomation()
  await seedRun(id, { queuedAt: new Date('2026-01-01T12:00:00Z'), usage: { inputTokens: 999, outputTokens: 999 } })
  const [item] = (await listScheduled(OWNER, {}, PAGE, NOW)).items
  assert.equal(item.recentRuns, 0)
  assert.equal(item.averageTokens, null)
  assert.equal(item.lastRun.finishedAt, NOW.toISOString())
})

// --- Gatilhos --------------------------------------------------------------------

test('a trigger exposes its endpoint and NEVER its secret', async () => {
  const id = await seedAutomation({
    publishedTrigger: { type: 'webhook', requireSignature: true },
    webhookPublicKey: 'pk-abc',
    webhookSecretEncrypted: 'iv.tag.ciphertext-super-secreto',
    nextRunAt: null,
  })
  await seedRun(id, { triggerType: 'webhook', queuedAt: new Date('2026-08-15T10:00:00Z') })

  const { items } = await listTriggers(OWNER, {}, PAGE, PUBLIC_URL, NOW)
  const item = items[0]
  assert.equal(item.endpoint, `${PUBLIC_URL}/api/hooks/automations/pk-abc`)
  assert.equal(item.endpoint, webhookEndpoint(PUBLIC_URL, 'pk-abc'))
  assert.equal(item.requireSignature, true)
  const serialized = JSON.stringify(item)
  assert.ok(!serialized.includes('ciphertext-super-secreto'), 'the encrypted secret must never leave')
  assert.ok(!/secret/i.test(serialized), 'not even a field named like one')
  assert.equal(item.lastActivationAt, '2026-08-15T10:00:00.000Z', 'last activation is derived from the last run')
  assert.equal(item.lastResult.status, 'succeeded')
})

test('a trigger that never fired is armed, not pending', async () => {
  await seedAutomation({ publishedTrigger: { type: 'webhook', requireSignature: true }, webhookPublicKey: 'pk-x', nextRunAt: null })
  const [item] = (await listTriggers(OWNER, {}, PAGE, PUBLIC_URL, NOW)).items
  assert.equal(item.lastActivationAt, null)
  assert.equal(item.lastResult, null)
  assert.equal(item.status, 'active', 'active means armed and waiting for an event')
})

// --- Runs -------------------------------------------------------------------------

test('in-flight and history are disjoint, and neither leaks the payload or the output', async () => {
  const id = await seedAutomation()
  await seedRun(id, { status: 'running' })
  await seedRun(id, { status: 'queued' })
  await seedRun(id, { status: 'succeeded' })
  await seedRun(id, { status: 'canceled' })

  const active = await listRunsForCenter(OWNER, 'active', {}, PAGE)
  const history = await listRunsForCenter(OWNER, 'history', {}, PAGE)
  assert.equal(active.total, 2)
  assert.equal(history.total, 2)

  const serialized = JSON.stringify([...active.items, ...history.items])
  assert.ok(!serialized.includes('dado privado'), 'the trigger payload never appears in a listing')
  assert.ok(!serialized.includes('resultado completo'), 'the run output never appears in a listing')
  assert.ok(!serialized.includes('segredo do prompt'), 'the definition snapshot never appears in a listing')
  assert.equal(active.items[0].name, 'Resumo diário', 'but the automation it belongs to is named')
  assert.equal(active.items[0].agent.name, 'Ana')
})

test('a run status filter only accepts statuses of that tab', async () => {
  const id = await seedAutomation()
  await seedRun(id, { status: 'running' })
  await seedRun(id, { status: 'succeeded' })

  assert.equal((await listRunsForCenter(OWNER, 'active', { status: 'running' }, PAGE)).total, 1)
  // 'succeeded' is not an in-flight status: the tab's own set wins over the filter.
  assert.equal((await listRunsForCenter(OWNER, 'active', { status: 'succeeded' }, PAGE)).total, 1)
  assert.equal((await listRunsForCenter(OWNER, 'active', { status: 'succeeded' }, PAGE)).items[0].status, 'running')
})

// --- Filtros e escopo --------------------------------------------------------------

test('filters scope by floor, agent and sector', async () => {
  await seedAutomation()
  await seedAutomation({ floorId: FLOOR_B, agentId: AGENT_B, name: 'Compras' })

  assert.equal((await listScheduled(OWNER, {}, PAGE, NOW)).total, 2)
  assert.equal((await listScheduled(OWNER, { floorId: FLOOR_B }, PAGE, NOW)).total, 1)
  assert.equal((await listScheduled(OWNER, { floorId: FLOOR_B }, PAGE, NOW)).items[0].name, 'Compras')
  assert.equal((await listScheduled(OWNER, { agentId: AGENT_A }, PAGE, NOW)).total, 1)
  // The sector holds only agent A.
  const bySector = await listScheduled(OWNER, { sectorId: SECTOR }, PAGE, NOW)
  assert.equal(bySector.total, 1)
  assert.equal(bySector.items[0].agent.id, AGENT_A.toString())
})

test('a sector with no members returns nothing instead of everything', async () => {
  await seedAutomation()
  const empty = new ObjectId()
  await sectors().insertOne({ _id: empty, ownerId: OWNER, name: 'Vazio', officeId: FLOOR_A, members: [] })
  assert.equal((await listScheduled(OWNER, { sectorId: empty }, PAGE, NOW)).total, 0)
  assert.equal((await listRunsForCenter(OWNER, 'history', { sectorId: empty }, PAGE)).total, 0)
})

test('the status filter separates active from paused', async () => {
  await seedAutomation()
  await seedAutomation({ status: 'paused', nextRunAt: null, name: 'Pausada' })
  assert.equal((await listScheduled(OWNER, {}, PAGE, NOW)).total, 2)
  assert.equal((await listScheduled(OWNER, { status: 'paused' }, PAGE, NOW)).items[0].name, 'Pausada')
})

test('an archived automation is not part of the Central', async () => {
  await seedAutomation({ status: 'archived', nextRunAt: null })
  assert.equal((await listScheduled(OWNER, {}, PAGE, NOW)).total, 0)
})

test('another owner never appears — not in a list, not in a counter', async () => {
  const mine = await seedAutomation()
  await seedRun(mine, { status: 'running' })
  const foreign = new ObjectId()
  await automations().insertOne({
    _id: foreign,
    ownerId: OTHER,
    buildingId: new ObjectId(),
    floorId: FLOOR_A,
    agentId: AGENT_A,
    name: 'Rotina de outra conta',
    description: '',
    status: 'active',
    trigger: { type: 'schedule', timezone: 'UTC', cron: '0 9 * * *' },
    draftDefinition: {},
    publishedTrigger: { type: 'schedule', timezone: 'UTC', cron: '0 9 * * *' },
    nextRunAt: new Date('2026-08-15T13:00:00Z'),
    currentVersion: 1,
    lastPublishedVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
  })
  await runs().insertOne({
    _id: new ObjectId(),
    ownerId: OTHER,
    automationId: foreign,
    floorId: FLOOR_A,
    status: 'running',
    triggerType: 'schedule',
    idempotencyKey: 'foreign-1',
    queuedAt: NOW,
    startedAt: NOW,
    finishedAt: null,
    usage: { inputTokens: 10_000, outputTokens: 10_000 },
  })

  const listed = await listScheduled(OWNER, {}, PAGE, NOW)
  assert.equal(listed.total, 1)
  assert.equal(listed.items[0].name, 'Resumo diário')
  assert.equal((await listRunsForCenter(OWNER, 'active', {}, PAGE)).total, 1)

  const summary = await executionSummary(OWNER, NOW)
  assert.equal(summary.inFlight, 1)
  assert.equal(summary.tokensWindow, 150, "another account's tokens are not counted")
})

test('pagination reports the real total', async () => {
  for (let i = 0; i < 5; i++) await seedAutomation({ name: `Rotina ${i}` })
  const page = await listScheduled(OWNER, {}, { limit: 2, skip: 2 }, NOW)
  assert.equal(page.total, 5)
  assert.equal(page.items.length, 2)
  assert.equal(page.limit, 2)
  assert.equal(page.skip, 2)
})

// --- Contadores ---------------------------------------------------------------------

test('the header counters are measurements, not estimates', async () => {
  // Due in 3h → inside the 24h window.
  const soon = await seedAutomation({ nextRunAt: new Date('2026-08-15T15:00:00Z') })
  // Due in 3 days → outside it.
  await seedAutomation({ nextRunAt: new Date('2026-08-18T12:00:00Z'), name: 'Semanal' })
  // Paused: it carries no plan and is not counted.
  await seedAutomation({ status: 'paused', nextRunAt: null, name: 'Pausada' })
  await seedAutomation({ publishedTrigger: { type: 'webhook', requireSignature: true }, webhookPublicKey: 'pk-1', nextRunAt: null, name: 'Gatilho' })
  await seedAutomation({ publishedTrigger: { type: 'webhook', requireSignature: true }, webhookPublicKey: 'pk-2', nextRunAt: null, name: 'Gatilho pausado', status: 'paused' })
  await seedRun(soon, { status: 'running', usage: { inputTokens: 10, outputTokens: 5 } })
  await seedRun(soon, { status: 'queued', usage: { inputTokens: 0, outputTokens: 0 } })
  await seedRun(soon, { status: 'succeeded', usage: { inputTokens: 30, outputTokens: 20 } })

  const summary = await executionSummary(OWNER, NOW)
  assert.equal(summary.next24h, 1)
  assert.equal(summary.activeTriggers, 1, 'a paused trigger is not armed')
  assert.equal(summary.inFlight, 2, 'queued + running')
  assert.equal(summary.tokensWindow, 65)
  assert.equal(summary.runsWindow, 3, 'the sample behind the total, so it reads as a measurement')
  assert.equal(summary.windowDays, 30)
})
