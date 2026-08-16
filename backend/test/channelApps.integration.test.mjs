// INTEGRATION: an App whose activation IS a real channel, against a REAL mongod.
//
// The bug this closes: WhatsApp declares no credential field, so the generic connect
// form happily wrote a "connected" installation with no number and no provider — and
// the map, the metrics and the agents all repeated that lie. Activation is now the
// channel itself.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { getApp, activationOf, acceptsGenericConnect } = await import('../dist/apps/registry.js')
const { hasValidChannel, listValidChannels, syncManagedChannelInstallations, backfillManagedChannelInstallations, testManagedChannel, isManagedChannelApp } =
  await import('../dist/apps/channelApps.js')
const { createInstallation, listInstallations } = await import('../dist/apps/installations.js')
const { buildNavigation, resolveSurface } = await import('../dist/apps/navigation.js')

const OWNER = 'channel-owner'
const OTHER = 'channel-other'
const widgets = () => db.collection('widgets')
const connections = () => db.collection('connections')

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  await Promise.all([widgets().deleteMany({}), connections().deleteMany({}), db.collection('user_navigation_preferences').deleteMany({})])
})

const addChannel = async (over = {}) => {
  const _id = new ObjectId()
  await widgets().insertOne({
    _id,
    ownerId: over.ownerId ?? OWNER,
    name: over.name ?? '+55 11 99999-0000',
    publicKey: `pk-${_id.toString()}`,
    channel: 'whatsapp',
    // A channel is only real when it can receive AND send.
    whatsapp: over.whatsapp ?? { provider: 'meta', encryptedConfig: 'CIFRADO' },
    createdAt: new Date(),
  })
  return _id
}

// The empty row the generic form used to produce.
const addEmptyInstallation = async (over = {}) => {
  const _id = new ObjectId()
  await connections().insertOne({
    _id,
    ownerId: over.ownerId ?? OWNER,
    appKey: 'whatsapp',
    appVersion: '1.0.0',
    name: 'WhatsApp',
    status: 'connected',
    encryptedConfig: '',
    publicMetadata: over.publicMetadata ?? {},
    grantedScopes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return _id
}

// --- o manifesto declara como se ativa ------------------------------------------

test('WhatsApp é ativado por canal; Chat Web é instantâneo', () => {
  assert.equal(activationOf(getApp('whatsapp')), 'managed_channel')
  assert.equal(activationOf(getApp('web_chat')), 'instant')
  assert.equal(isManagedChannelApp(getApp('whatsapp')), true)
})

test('o formulário genérico não pode criar um canal gerenciado', () => {
  assert.equal(acceptsGenericConnect(getApp('whatsapp')), false)
  // Os outros continuam aceitando o fluxo normal.
  assert.equal(acceptsGenericConnect(getApp('slack')), true)
  assert.equal(acceptsGenericConnect(getApp('web_chat')), true)
})

test('a rota do fluxo real está declarada, para o CTA levar a ela', () => {
  assert.equal(getApp('whatsapp').activationRoute, '/apps/whatsapp/channels')
})

test('manifesto antigo, sem o campo, continua se comportando igual', () => {
  assert.equal(activationOf({ auth: { kind: 'oauth2', fields: [] } }), 'oauth')
  assert.equal(activationOf({ auth: { kind: 'api_key', fields: [{ key: 'k' }] } }), 'credentials')
  assert.equal(activationOf({ auth: { kind: 'none', fields: [] } }), 'instant')
})

// --- o que conta como canal válido -------------------------------------------------

test('canal sem provedor ou sem config não conta como conectado', async () => {
  await addChannel({ whatsapp: { provider: 'meta' } })
  await addChannel({ whatsapp: {} })
  assert.equal(await hasValidChannel(OWNER, 'whatsapp'), false)
  assert.deepEqual(await listValidChannels(OWNER, 'whatsapp'), [])
})

test('um canal completo conta', async () => {
  await addChannel()
  assert.equal(await hasValidChannel(OWNER, 'whatsapp'), true)
  assert.equal((await listValidChannels(OWNER, 'whatsapp')).length, 1)
})

test('o canal de outro dono não ativa este App aqui', async () => {
  await addChannel({ ownerId: OTHER })
  assert.equal(await hasValidChannel(OWNER, 'whatsapp'), false)
})

// --- reconciliação das instalações vazias --------------------------------------------

test('instalação vazia antiga deixa de se dizer conectada — sem apagar nada', async () => {
  const id = await addEmptyInstallation()
  const report = await syncManagedChannelInstallations(OWNER)
  assert.equal(report.revoked, 1)

  const doc = await connections().findOne({ _id: id })
  assert.equal(doc.status, 'needs_reauth')
  assert.equal(doc.publicMetadata.invalidReason, 'sem_canal')
  // A linha continua lá: nada de exclusão em cascata.
  assert.equal(await connections().countDocuments({}), 1)
})

test('quando o número é finalmente conectado, a instalação volta sozinha', async () => {
  const id = await addEmptyInstallation()
  await syncManagedChannelInstallations(OWNER)
  await addChannel()
  const report = await syncManagedChannelInstallations(OWNER)
  assert.equal(report.reconnected, 1)
  assert.equal((await connections().findOne({ _id: id })).status, 'connected')
})

test('a reconciliação é idempotente', async () => {
  await addEmptyInstallation()
  await syncManagedChannelInstallations(OWNER)
  const second = await syncManagedChannelInstallations(OWNER)
  assert.deepEqual(second, { revoked: 0, reconnected: 0 })
})

test('instalação ligada a um canal que existe continua conectada', async () => {
  const channelId = await addChannel()
  await addEmptyInstallation({ publicMetadata: { channelId: channelId.toString() } })
  const report = await syncManagedChannelInstallations(OWNER)
  assert.deepEqual(report, { revoked: 0, reconnected: 0 })
})

test('o backfill percorre todos os donos e conta só números', async () => {
  await addEmptyInstallation()
  await addEmptyInstallation({ ownerId: OTHER })
  const report = await backfillManagedChannelInstallations()
  assert.equal(report.revoked, 2)
  assert.equal(typeof report.reconnected, 'number')
})

// --- o teste da conexão ---------------------------------------------------------------

test('testar sem canal FALHA, em vez de passar por não haver campo obrigatório', async () => {
  const app = getApp('whatsapp')
  const installation = await createInstallation(OWNER, app, { name: 'WhatsApp' })
  const result = await testManagedChannel(OWNER, installation)
  assert.equal(result.ok, false)
  assert.match(result.message, /Nenhum número/)
})

test('testar com canal válido passa e diz quantos', async () => {
  await addChannel()
  const installation = await createInstallation(OWNER, getApp('whatsapp'), { name: 'WhatsApp' })
  const result = await testManagedChannel(OWNER, installation)
  assert.equal(result.ok, true)
  assert.match(result.message, /1 número/)
})

test('testar uma conexão presa a um canal removido falha', async () => {
  const channelId = await addChannel()
  const installation = await createInstallation(OWNER, getApp('whatsapp'), {
    name: 'WhatsApp',
    publicMetadata: { channelId: channelId.toString() },
  })
  await widgets().deleteOne({ _id: channelId })
  const result = await testManagedChannel(OWNER, installation)
  assert.equal(result.ok, false)
  assert.match(result.message, /não existe mais/)
})

// --- navegação --------------------------------------------------------------------------

test('WhatsApp sem canal não aparece como pronto e não abre a página', async () => {
  await addEmptyInstallation()
  await syncManagedChannelInstallations(OWNER)

  const { apps } = await buildNavigation(OWNER, OWNER)
  const whatsapp = apps.find((a) => a.appKey === 'whatsapp')
  assert.equal(whatsapp.status, 'needs_reauth')

  const decision = await resolveSurface(OWNER, 'whatsapp', 'channels')
  assert.equal(decision.ok, false)
  assert.equal(decision.reason, 'needs_reauth')
})

test('com número conectado, a página abre normalmente', async () => {
  await addChannel()
  await createInstallation(OWNER, getApp('whatsapp'), { name: 'WhatsApp' })
  const decision = await resolveSurface(OWNER, 'whatsapp', 'channels')
  assert.equal(decision.ok, true)
  assert.equal((await listInstallations(OWNER, 'whatsapp')).length, 1)
})
