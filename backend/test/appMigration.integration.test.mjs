// INTEGRATION: moving the existing accounts into the App model, against a REAL mongod.
//
// What is pinned here is the promise the migration makes: nothing is lost, nothing
// keeps a credential in the clear inside an agent document, running it twice changes
// nothing, and an agent that could create a calendar event yesterday can still do it
// today. The migration is worthless if any of those four is false.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { migrateAppsAndInstallations, credentialFingerprint } = await import('../dist/apps/migration.js')
const { listInstallations, getInstallation, decryptInstallationConfig, createInstallation, revokeInstallation, patchInstallation } = await import(
  '../dist/apps/installations.js'
)
const { resolveGrant } = await import('../dist/apps/grants.js')
const { getApp } = await import('../dist/apps/registry.js')
const { toPublicAgent } = await import('../dist/agents.js')
const { ObjectId } = await import('mongodb')

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'migration-owner'
const OTHER = 'other-owner'
const agents = () => db.collection('agents')
const connections = () => db.collection('connections')
const integrations = () => db.collection('integrations')

beforeEach(async () => {
  await Promise.all([agents().deleteMany({}), connections().deleteMany({}), integrations().deleteMany({})])
})

const insertAgent = async (builtinTools, ownerId = OWNER) => {
  const _id = new ObjectId()
  await agents().insertOne({ _id, ownerId, officeId: new ObjectId(), name: 'Agente', builtinTools })
  return _id
}

const readAgent = (id) => agents().findOne({ _id: id })

// --- conexões antigas ----------------------------------------------------------

test('uma conexão antiga ganha appKey sem perder provider', async () => {
  const _id = new ObjectId()
  await connections().insertOne({
    _id,
    ownerId: OWNER,
    provider: 'email',
    name: 'SMTP',
    status: 'connected',
    encryptedConfig: 'x',
    publicMetadata: {},
    scopes: ['send'],
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await migrateAppsAndInstallations()

  const doc = await connections().findOne({ _id })
  assert.equal(doc.appKey, 'email')
  // O fluxo de entregas ainda resolve por provider: ele continua lá.
  assert.equal(doc.provider, 'email')
  assert.deepEqual(doc.grantedScopes, ['send'])
})

// --- Google --------------------------------------------------------------------

test('uma conta Google conectada vira instalação sem mover os tokens', async () => {
  await integrations().insertOne({
    ownerId: OWNER,
    provider: 'google',
    accountEmail: 'dono@loja.com',
    accessToken: 'cifrado-access',
    refreshToken: 'cifrado-refresh',
    expiryDate: Date.now() + 60_000,
    scope: 'https://www.googleapis.com/auth/calendar',
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await migrateAppsAndInstallations()

  const [installation] = await listInstallations(OWNER, 'google')
  assert.ok(installation)
  assert.equal(installation.status, 'connected')
  assert.equal(installation.publicMetadata.tokenStore, 'integrations')
  assert.deepEqual(installation.grantedScopes, ['https://www.googleapis.com/auth/calendar'])
  // Os tokens continuam onde o fluxo de refresh os lê e escreve.
  const integration = await integrations().findOne({ ownerId: OWNER, provider: 'google' })
  assert.equal(integration.refreshToken, 'cifrado-refresh')
  assert.equal(decryptInstallationConfig(installation).refreshToken, undefined)
})

// --- credencial dentro do agente ------------------------------------------------

test('a credencial sai do documento do agente e vira instalação criptografada', async () => {
  const agentId = await insertAgent([{ key: 'stripe', config: { secretKey: 'sk_test_segredo', successUrl: 'https://loja.com/ok' } }])

  const report = await migrateAppsAndInstallations()
  assert.equal(report.installationsCreated, 1)
  assert.equal(report.agentsMigrated, 1)

  const agent = await readAgent(agentId)
  // O segredo não está mais no agente, nem em lugar nenhum do documento.
  assert.ok(!JSON.stringify(agent).includes('sk_test_segredo'))
  // A seleção não secreta continua legível.
  assert.equal(agent.builtinTools[0].config.successUrl, 'https://loja.com/ok')
  assert.ok(agent.builtinTools[0].migratedAt)

  const [installation] = await listInstallations(OWNER, 'stripe')
  assert.equal(decryptInstallationConfig(installation).secretKey, 'sk_test_segredo')
  // O que está guardado no banco está cifrado.
  const raw = await connections().findOne({ _id: installation._id })
  assert.ok(!raw.encryptedConfig.includes('sk_test_segredo'))

  const [grant] = agent.appGrants
  assert.equal(grant.appKey, 'stripe')
  assert.equal(grant.installationId, installation._id.toString())
  assert.deepEqual(grant.actionKeys, ['stripe_criar_link_pagamento'])
  assert.equal(grant.resourceConfig.successUrl, 'https://loja.com/ok')
  // Comportamento preservado: o agente já podia criar cobrança e continua podendo.
  assert.deepEqual(grant.autonomousWriteActionKeys, ['stripe_criar_link_pagamento'])
})

test('rodar a migração duas vezes não cria segunda instalação nem segundo grant', async () => {
  const agentId = await insertAgent([{ key: 'slack', config: { webhookUrl: 'https://hooks.slack.com/services/AAA' } }])

  await migrateAppsAndInstallations()
  const second = await migrateAppsAndInstallations()

  assert.equal(second.installationsCreated, 0)
  assert.equal(second.grantsCreated, 0)
  assert.equal((await listInstallations(OWNER, 'slack')).length, 1)
  const agent = await readAgent(agentId)
  assert.equal(agent.appGrants.length, 1)
  assert.equal(agent.builtinTools.length, 1)
})

test('dois agentes com a mesma credencial compartilham uma única instalação', async () => {
  const a = await insertAgent([{ key: 'hubspot', config: { token: 'pat-na1-mesmo' } }])
  const b = await insertAgent([{ key: 'hubspot', config: { token: 'pat-na1-mesmo' } }])
  const c = await insertAgent([{ key: 'hubspot', config: { token: 'pat-na1-outro' } }])

  await migrateAppsAndInstallations()

  const list = await listInstallations(OWNER, 'hubspot')
  assert.equal(list.length, 2)
  const [ga] = (await readAgent(a)).appGrants
  const [gb] = (await readAgent(b)).appGrants
  const [gc] = (await readAgent(c)).appGrants
  assert.equal(ga.installationId, gb.installationId)
  assert.notEqual(ga.installationId, gc.installationId)
})

test('a impressão digital da credencial não contém a credencial', () => {
  const fp = credentialFingerprint('stripe', { secretKey: 'sk_live_supersecreto' })
  assert.ok(!fp.includes('sk_live_supersecreto'))
  assert.equal(fp, credentialFingerprint('stripe', { secretKey: 'sk_live_supersecreto' }))
  assert.notEqual(fp, credentialFingerprint('stripe', { secretKey: 'outro' }))
})

test('o agente de outro dono não é tocado', async () => {
  const mine = await insertAgent([{ key: 'slack', config: { webhookUrl: 'https://hooks.slack.com/services/MINE' } }])
  const theirs = await insertAgent([{ key: 'slack', config: { webhookUrl: 'https://hooks.slack.com/services/THEIRS' } }], OTHER)

  await migrateAppsAndInstallations()

  assert.equal((await listInstallations(OWNER, 'slack')).length, 1)
  assert.equal((await listInstallations(OTHER, 'slack')).length, 1)
  const theirGrant = (await readAgent(theirs)).appGrants[0]
  const myInstallations = await listInstallations(OWNER, 'slack')
  assert.notEqual(theirGrant.installationId, myInstallations[0]._id.toString())
  assert.ok(mine)
})

test('google_calendar e google_sheets viram um único grant no App Google', async () => {
  await integrations().insertOne({
    ownerId: OWNER,
    provider: 'google',
    accountEmail: 'dono@loja.com',
    accessToken: 'a',
    refreshToken: 'r',
    expiryDate: Date.now() + 60_000,
    scope: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const agentId = await insertAgent([
    { key: 'google_calendar', config: { calendarId: 'agenda@grupo.calendar.google.com' } },
    { key: 'google_sheets', config: { spreadsheetId: '1AbC', sheetName: 'Leads', columns: 'Nome, Telefone' } },
  ])

  await migrateAppsAndInstallations()

  const agent = await readAgent(agentId)
  assert.equal(agent.appGrants.length, 1)
  const [grant] = agent.appGrants
  assert.equal(grant.appKey, 'google')
  assert.equal(grant.actionKeys.length, 4)
  assert.equal(grant.resourceConfig.calendarId, 'agenda@grupo.calendar.google.com')
  assert.equal(grant.resourceConfig.spreadsheetId, '1AbC')
  // Criar evento e registrar linha continuam autorizados.
  assert.ok(grant.autonomousWriteActionKeys.includes('google_agenda_criar_evento'))
  assert.ok(grant.autonomousWriteActionKeys.includes('google_sheets_registrar'))
})

test('sem conta Google conectada, a entrada legada fica como está', async () => {
  const agentId = await insertAgent([{ key: 'google_calendar', config: { calendarId: 'principal' } }])
  await migrateAppsAndInstallations()
  const agent = await readAgent(agentId)
  assert.equal((agent.appGrants ?? []).length, 0)
  assert.equal(agent.builtinTools[0].migratedAt, undefined)
})

test('entrada legada sem credencial preenchida não vira instalação vazia', async () => {
  const agentId = await insertAgent([{ key: 'slack', config: {} }])
  const report = await migrateAppsAndInstallations()
  assert.equal(report.installationsCreated, 0)
  assert.equal((await readAgent(agentId)).builtinTools[0].migratedAt, undefined)
})

// --- canais que viram Apps -------------------------------------------------------

test('quem já usa widget web encontra o Chat Web ativo, sem tocar no widget', async () => {
  const widgetId = new ObjectId()
  await db.collection('widgets').insertOne({ _id: widgetId, ownerId: OWNER, name: 'Site', publicKey: 'pk-1', createdAt: new Date() })

  const report = await migrateAppsAndInstallations()
  assert.equal(report.webChatInstallations, 1)

  const [installation] = await listInstallations(OWNER, 'web_chat')
  assert.equal(installation.status, 'connected')
  // O widget não foi tocado: id, chave pública e roteamento continuam iguais.
  const widget = await db.collection('widgets').findOne({ _id: widgetId })
  assert.equal(widget.publicKey, 'pk-1')

  // Rodar de novo não cria uma segunda instalação.
  assert.equal((await migrateAppsAndInstallations()).webChatInstallations, 0)
  assert.equal((await listInstallations(OWNER, 'web_chat')).length, 1)
  await db.collection('widgets').deleteMany({})
})

test('cada número de WhatsApp vira uma conexão, sem copiar credencial nem histórico', async () => {
  const channelId = new ObjectId()
  await db.collection('widgets').insertOne({
    _id: channelId,
    ownerId: OWNER,
    name: '+55 11 99999-8888',
    publicKey: 'pk-wa',
    channel: 'whatsapp',
    whatsapp: { provider: 'meta', encryptedConfig: 'CIFRADO-DO-PROVEDOR' },
    createdAt: new Date(),
  })

  const report = await migrateAppsAndInstallations()
  assert.equal(report.whatsappInstallations, 1)

  const [installation] = await listInstallations(OWNER, 'whatsapp')
  assert.equal(installation.publicMetadata.channelId, channelId.toString())
  // A config do provedor continua no canal, não foi duplicada na instalação.
  assert.deepEqual(decryptInstallationConfig(installation), {})
  const channel = await db.collection('widgets').findOne({ _id: channelId })
  assert.equal(channel.whatsapp.encryptedConfig, 'CIFRADO-DO-PROVEDOR')

  assert.equal((await migrateAppsAndInstallations()).whatsappInstallations, 0)
  await db.collection('widgets').deleteMany({})
})

// --- o que a API devolve durante a transição ------------------------------------

test('a API nunca devolve o valor de uma credencial legada', () => {
  const publicAgent = toPublicAgent({
    builtinTools: [{ key: 'stripe', config: { secretKey: 'sk_live_segredo', successUrl: 'https://loja.com/ok' } }],
  })
  assert.equal(publicAgent.builtinTools[0].config.secretKey, '***')
  assert.equal(publicAgent.builtinTools[0].config.successUrl, 'https://loja.com/ok')
})

// --- o grant no runtime ---------------------------------------------------------

const grantFor = async (appKey, actionKeys, over = {}) => {
  const app = getApp(appKey)
  const installation = await createInstallation(OWNER, app, { config: { webhookUrl: 'https://hooks.slack.com/services/X' } })
  return {
    installation,
    grant: { installationId: installation._id.toString(), appKey, actionKeys, resourceConfig: {}, autonomousWriteActionKeys: [], ...over },
  }
}

test('só as ações do grant são materializadas', async () => {
  const app = getApp('google')
  const installation = await createInstallation(OWNER, app, {})
  const tools = await resolveGrant(OWNER, {
    installationId: installation._id.toString(),
    appKey: 'google',
    actionKeys: ['google_agenda_listar_eventos'],
    resourceConfig: {},
    autonomousWriteActionKeys: [],
  })
  assert.deepEqual(
    tools.map((t) => t.name),
    ['google_agenda_listar_eventos'],
  )
})

test('uma instalação revogada recusa em vez de sumir', async () => {
  const { installation, grant } = await grantFor('slack', ['slack_notificar'], { autonomousWriteActionKeys: ['slack_notificar'] })
  await revokeInstallation(OWNER, installation._id)

  const [tool] = await resolveGrant(OWNER, grant)
  const outcome = await tool.run({ mensagem: 'oi' })
  const payload = JSON.parse(outcome.result)
  assert.equal(payload.status, 'capability_unavailable')
  assert.equal(payload.executed, false)
  assert.equal(payload.reason, 'conexao_revogada')
})

test('a instalação de outro dono não resolve', async () => {
  const { grant } = await grantFor('slack', ['slack_notificar'])
  const [tool] = await resolveGrant(OTHER, grant)
  const payload = JSON.parse((await tool.run({ mensagem: 'oi' })).result)
  assert.equal(payload.reason, 'conexao_ausente')
  assert.equal(payload.executed, false)
})

test('escrita não autorizada é recusada antes de sair daqui', async () => {
  const { grant } = await grantFor('slack', ['slack_notificar'])
  const [tool] = await resolveGrant(OWNER, grant)
  const payload = JSON.parse((await tool.run({ mensagem: 'oi' })).result)
  assert.equal(payload.reason, 'autorizacao_necessaria')
  assert.equal(payload.executed, false)
})

test('versão maior diferente exige revisão antes de voltar a funcionar', async () => {
  const { installation, grant } = await grantFor('slack', ['slack_notificar'], { autonomousWriteActionKeys: ['slack_notificar'] })
  await connections().updateOne({ _id: installation._id }, { $set: { appVersion: '9.0.0' } })
  const [tool] = await resolveGrant(OWNER, grant)
  const payload = JSON.parse((await tool.run({ mensagem: 'oi' })).result)
  assert.equal(payload.reason, 'versao_incompativel')
})

test('o segredo nunca chega ao que o modelo vê', async () => {
  const { grant } = await grantFor('slack', ['slack_notificar'], { autonomousWriteActionKeys: ['slack_notificar'] })
  const [tool] = await resolveGrant(OWNER, grant)
  const exposed = JSON.stringify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })
  assert.ok(!exposed.includes('hooks.slack.com/services/X'))
})

test('renomear a conexão não apaga a credencial', async () => {
  const app = getApp('slack')
  const installation = await createInstallation(OWNER, app, { config: { webhookUrl: 'https://hooks.slack.com/services/KEEP' } })
  await patchInstallation(OWNER, installation._id, app, { name: 'Canal de vendas' })
  const after = await getInstallation(OWNER, installation._id)
  assert.equal(after.name, 'Canal de vendas')
  assert.equal(decryptInstallationConfig(after).webhookUrl, 'https://hooks.slack.com/services/KEEP')
})

test('desconectar preserva o histórico e invalida o uso na hora', async () => {
  const app = getApp('slack')
  const installation = await createInstallation(OWNER, app, { config: { webhookUrl: 'https://hooks.slack.com/services/GONE' } })
  await revokeInstallation(OWNER, installation._id)
  const after = await getInstallation(OWNER, installation._id)
  // A linha continua existindo (histórico), mas não serve mais para nada.
  assert.equal(after.status, 'revoked')
  assert.deepEqual(decryptInstallationConfig(after), {})
})
