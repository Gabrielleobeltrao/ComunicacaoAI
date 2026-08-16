// INTEGRATION: every boot migration, run against a FIXTURE that looks like a real
// account written before any of this existed.
//
// This is the rehearsal for production. What it proves: running the migrations
// changes no behaviour the owner had, moves every credential out of the clear,
// preserves widgets, channels, conversations and sectors, and running them a SECOND
// time changes nothing at all.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { runMigrations } = await import('../dist/migrate.js')
const { listInstallations, decryptInstallationConfig } = await import('../dist/apps/installations.js')
const { getFloor } = await import('../dist/floors.js')
const { accessConfigOf } = await import('../dist/sectorAccess.js')
const { getFloorCommunication } = await import('../dist/floorCommunication.js')

const OWNER = 'fixture-owner'
const AGENT = new ObjectId()
const WIDGET = new ObjectId()
const WA_CHANNEL = new ObjectId()
const SECTOR = new ObjectId()
const FLOOR = new ObjectId()

// Counts taken before the migration, compared after. Nothing may disappear.
let before_ = { widgets: 0, messages: 0, sectors: 0, agents: 0 }

before(async () => {
  await mongoClient.connect()

  // A floor written as a plain "office", with no Floor fields at all.
  await db.collection('offices').insertOne({ _id: FLOOR, ownerId: OWNER, name: 'Térreo', createdAt: new Date('2025-01-01') })

  // An agent carrying a credential IN THE CLEAR, the way it used to be stored.
  await db.collection('agents').insertOne({
    _id: AGENT,
    ownerId: OWNER,
    officeId: FLOOR,
    name: 'Atendente',
    objective: 'Atender',
    preset: 'custom',
    builtinTools: [
      { key: 'slack', config: { webhookUrl: 'https://hooks.slack.com/services/T/B/SEGREDO' } },
      { key: 'google_sheets', config: { spreadsheetId: '1AbC', sheetName: 'Leads', columns: 'Nome, Telefone' } },
    ],
    createdAt: new Date('2025-02-01'),
  })

  // A connection with only `provider`, from before appKey existed.
  await db.collection('connections').insertOne({
    _id: new ObjectId(),
    ownerId: OWNER,
    provider: 'email',
    name: 'SMTP',
    status: 'connected',
    encryptedConfig: 'cifrado',
    publicMetadata: {},
    scopes: ['send'],
    createdAt: new Date('2025-02-02'),
    updatedAt: new Date('2025-02-02'),
  })

  // A web widget and a WhatsApp number, with conversations under them.
  await db.collection('widgets').insertMany([
    { _id: WIDGET, ownerId: OWNER, name: 'Site', publicKey: 'pk-site', createdAt: new Date('2025-03-01') },
    {
      _id: WA_CHANNEL,
      ownerId: OWNER,
      name: '+55 11 99999-0000',
      publicKey: 'pk-wa',
      channel: 'whatsapp',
      whatsapp: { provider: 'meta', encryptedConfig: 'CIFRADO-PROVEDOR' },
      createdAt: new Date('2025-03-02'),
    },
  ])
  await db.collection('widget_messages').insertMany([
    { _id: new ObjectId(), widgetId: WIDGET, conversationId: 'c1', role: 'visitor', content: 'oi', createdAt: new Date('2025-03-03') },
    { _id: new ObjectId(), widgetId: WA_CHANNEL, conversationId: 'c2', role: 'visitor', content: 'olá', createdAt: new Date('2025-03-04') },
  ])

  // A sector with no entry policy at all.
  await db.collection('sectors').insertOne({
    _id: SECTOR,
    ownerId: OWNER,
    officeId: FLOOR,
    name: 'Cozinha',
    color: '#fff',
    mode: 'pipeline',
    members: [{ agentId: AGENT }],
    stages: [{ id: 'e1', name: 'Preparar', agentId: AGENT, instruction: '', dependsOn: [] }],
    createdAt: new Date('2025-04-01'),
  })

  before_ = {
    widgets: await db.collection('widgets').countDocuments({}),
    messages: await db.collection('widget_messages').countDocuments({}),
    sectors: await db.collection('sectors').countDocuments({}),
    agents: await db.collection('agents').countDocuments({}),
  }

  await runMigrations()
})

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

test('nada é apagado: widgets, mensagens, setores e agentes continuam lá', async () => {
  assert.equal(await db.collection('widgets').countDocuments({}), before_.widgets)
  assert.equal(await db.collection('widget_messages').countDocuments({}), before_.messages)
  assert.equal(await db.collection('sectors').countDocuments({}), before_.sectors)
  assert.equal(await db.collection('agents').countDocuments({}), before_.agents)
})

test('o widget e o número de WhatsApp mantêm id, chave pública e config do provedor', async () => {
  const widget = await db.collection('widgets').findOne({ _id: WIDGET })
  assert.equal(widget.publicKey, 'pk-site')
  const channel = await db.collection('widgets').findOne({ _id: WA_CHANNEL })
  assert.equal(channel.publicKey, 'pk-wa')
  // A credencial do provedor NÃO foi movida nem duplicada.
  assert.equal(channel.whatsapp.encryptedConfig, 'CIFRADO-PROVEDOR')
})

test('a credencial sai do documento do agente e vira instalação cifrada', async () => {
  const agent = await db.collection('agents').findOne({ _id: AGENT })
  assert.ok(!JSON.stringify(agent).includes('T/B/SEGREDO'))
  // A seleção não secreta continua legível no agente.
  const sheets = agent.builtinTools.find((b) => b.key === 'google_sheets')
  assert.equal(sheets.config.spreadsheetId, '1AbC')

  const [slack] = await listInstallations(OWNER, 'slack')
  assert.equal(decryptInstallationConfig(slack).webhookUrl, 'https://hooks.slack.com/services/T/B/SEGREDO')
  const raw = await db.collection('connections').findOne({ _id: slack._id })
  assert.ok(!raw.encryptedConfig.includes('T/B/SEGREDO'))
})

test('o agente continua podendo fazer o que já fazia', async () => {
  const agent = await db.collection('agents').findOne({ _id: AGENT })
  const slackGrant = agent.appGrants.find((g) => g.appKey === 'slack')
  assert.deepEqual(slackGrant.actionKeys, ['slack_notificar'])
  // Ele já podia notificar sozinho; continua podendo.
  assert.deepEqual(slackGrant.autonomousWriteActionKeys, ['slack_notificar'])
})

test('conexão antiga ganha appKey sem perder provider', async () => {
  const doc = await db.collection('connections').findOne({ provider: 'email' })
  assert.equal(doc.appKey, 'email')
  assert.equal(doc.provider, 'email')
})

test('os canais existentes aparecem como Apps ativos', async () => {
  assert.equal((await listInstallations(OWNER, 'web_chat')).length, 1)
  const [whatsapp] = await listInstallations(OWNER, 'whatsapp')
  assert.equal(whatsapp.publicMetadata.channelId, WA_CHANNEL.toString())
})

test('o andar antigo lê como LIVRE, que é como ele se comportava', async () => {
  const floor = await getFloor(OWNER, FLOOR)
  assert.equal(floor.workMode, 'organization')
  assert.equal(floor.coordinatorAgentId, null)
})

test('o setor existente continua aberto: nada é fechado sem o dono pedir', async () => {
  const sector = await db.collection('sectors').findOne({ _id: SECTOR })
  assert.equal(accessConfigOf(sector).entryPolicy, 'open_members')
})

test('o prédio existente mantém a colaboração que já tinha', async () => {
  const building = await db.collection('buildings').findOne({ ownerId: OWNER })
  const config = await getFloorCommunication(OWNER, building._id)
  // Um prédio de um andar só não tem o que cruzar.
  assert.equal(config.mode, 'isolated')
  assert.deepEqual(config.links, [])
})

test('os índices necessários existem depois da migração', async () => {
  const expected = [
    ['agent_live_states', 'expiresAt_1'],
    ['sector_executions', 'executionKey_1'],
    ['execution_roots', 'executionKey_1'],
    ['user_navigation_preferences', 'ownerId_1_userId_1'],
    ['app_definitions', 'ownerId_1_key_1'],
  ]
  for (const [collection, index] of expected) {
    const indexes = await db.collection(collection).indexes()
    assert.ok(
      indexes.some((i) => i.name === index),
      `faltou o índice ${index} em ${collection}`,
    )
  }
})

test('rodar a migração de novo não muda absolutamente nada', async () => {
  const snapshot = async () => ({
    connections: await db.collection('connections').countDocuments({}),
    grants: (await db.collection('agents').findOne({ _id: AGENT })).appGrants.length,
    installations: (await listInstallations(OWNER)).length,
    sectors: await db.collection('sectors').countDocuments({}),
  })
  const first = await snapshot()
  await runMigrations()
  assert.deepEqual(await snapshot(), first)
})
