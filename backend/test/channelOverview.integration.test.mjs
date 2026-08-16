// INTEGRATION: the channel App's overview numbers, against a REAL mongod.
//
// Every figure is counted from real widgets, channels and messages. What is pinned
// here: a channel with no history reports null instead of a zero that would read as
// "it ran and produced nothing", the two channels never mix, and nothing said in a
// conversation leaves this endpoint.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { channelOverview } = await import('../dist/apps/channelOverview.js')

const OWNER = 'overview-owner'
const OTHER = 'overview-other'
const widgets = () => db.collection('widgets')
const messages = () => db.collection('widget_messages')

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  await Promise.all([widgets().deleteMany({}), messages().deleteMany({}), db.collection('conversation_memories').deleteMany({})])
})

const addWidget = async (over = {}) => {
  const _id = new ObjectId()
  await widgets().insertOne({
    _id,
    ownerId: over.ownerId ?? OWNER,
    name: over.name ?? 'Site',
    publicKey: `pk-${_id}`,
    ...(over.channel ? { channel: over.channel } : {}),
    ...(over.whatsapp ? { whatsapp: over.whatsapp } : {}),
    agentId: over.agentId ?? null,
    createdAt: new Date(),
  })
  return _id
}

const say = (widgetId, conversationId, role, minutesAgo) =>
  messages().insertOne({
    _id: new ObjectId(),
    widgetId,
    conversationId,
    role,
    content: 'CONTEÚDO SIGILOSO DA CONVERSA',
    createdAt: new Date(Date.now() - minutesAgo * 60_000),
  })

test('sem canal, os números são honestos em vez de zerados', async () => {
  const overview = await channelOverview(OWNER, 'web_chat')
  assert.deepEqual(overview.channels, [])
  assert.equal(overview.conversations, 0)
  assert.equal(overview.avgResponseMs, null)
  assert.equal(overview.lastMessageAt, null)
})

test('conta conversas distintas, não mensagens', async () => {
  const widget = await addWidget()
  await say(widget, 'c1', 'visitor', 10)
  await say(widget, 'c1', 'agent', 9)
  await say(widget, 'c2', 'visitor', 5)

  const overview = await channelOverview(OWNER, 'web_chat')
  assert.equal(overview.conversations, 2)
  assert.equal(overview.messages7d, 3)
})

test('o tempo de resposta é medido do visitante até o agente', async () => {
  const widget = await addWidget()
  await say(widget, 'c1', 'visitor', 10)
  await say(widget, 'c1', 'agent', 8) // 2 min
  await say(widget, 'c2', 'visitor', 6)
  await say(widget, 'c2', 'agent', 2) // 4 min

  const overview = await channelOverview(OWNER, 'web_chat')
  // Os timestamps do fixture são relativos a Date.now(), então alguns milissegundos
  // de deriva entre as inserções são esperados — a média é que tem de estar certa.
  assert.ok(Math.abs(overview.avgResponseMs - 3 * 60_000) < 1000, `média inesperada: ${overview.avgResponseMs}`)
})

test('uma pergunta ainda sem resposta não vira tempo de resposta', async () => {
  const widget = await addWidget()
  await say(widget, 'c1', 'visitor', 5)
  const overview = await channelOverview(OWNER, 'web_chat')
  assert.equal(overview.avgResponseMs, null)
})

test('web e whatsapp não se misturam', async () => {
  const web = await addWidget({ name: 'Site' })
  const wa = await addWidget({ name: '+55 11 9', channel: 'whatsapp', whatsapp: { provider: 'meta', encryptedConfig: 'x' } })
  await say(web, 'c1', 'visitor', 5)
  await say(wa, 'c2', 'visitor', 5)
  await say(wa, 'c3', 'visitor', 5)

  assert.equal((await channelOverview(OWNER, 'web_chat')).conversations, 1)
  assert.equal((await channelOverview(OWNER, 'whatsapp')).conversations, 2)
})

test('número sem provedor aparece, mas marcado como incompleto', async () => {
  await addWidget({ name: 'Meio configurado', channel: 'whatsapp', whatsapp: { provider: 'meta' } })
  await addWidget({ name: 'Completo', channel: 'whatsapp', whatsapp: { provider: 'meta', encryptedConfig: 'x' } })
  const overview = await channelOverview(OWNER, 'whatsapp')
  assert.equal(overview.channels.length, 2)
  assert.equal(overview.channels.filter((c) => c.ready).length, 1)
})

test('conversas aguardando pessoa são contadas', async () => {
  const widget = await addWidget()
  await db.collection('conversation_memories').insertOne({ widgetId: widget, conversationId: 'c1', humanHandoff: true })
  assert.equal((await channelOverview(OWNER, 'web_chat')).handoffs, 1)
})

test('o canal de outro dono não entra na conta', async () => {
  const alheio = await addWidget({ ownerId: OTHER })
  await say(alheio, 'c1', 'visitor', 5)
  const overview = await channelOverview(OWNER, 'web_chat')
  assert.equal(overview.channels.length, 0)
  assert.equal(overview.conversations, 0)
})

test('nada do que foi dito na conversa sai daqui', async () => {
  const widget = await addWidget()
  await say(widget, 'c1', 'visitor', 5)
  const json = JSON.stringify(await channelOverview(OWNER, 'web_chat'))
  assert.ok(!json.includes('CONTEÚDO SIGILOSO'))
  assert.ok(!json.includes('conversationId'))
})
