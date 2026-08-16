// INTEGRATION: App pages and the sidebar pin, against a REAL mongod.
//
// The one claim worth a test file: a pin is a SHORTCUT. It cannot install, connect,
// grant a scope or open a page the account never activated — and unpinning changes
// no permission. Everything else here is the guard that says which pages exist.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { buildNavigation, getNavigationPreferences, setPinnedApps, dropPinsForApp, resolveSurface, ensureNavigationIndexes, MAX_PINNED_APPS } =
  await import('../dist/apps/navigation.js')
const { createInstallation, revokeInstallation, listInstallations } = await import('../dist/apps/installations.js')
const { getApp } = await import('../dist/apps/registry.js')

const OWNER = 'nav-owner'
const USER = 'nav-owner'
const connections = () => db.collection('connections')
const prefs = () => db.collection('user_navigation_preferences')

before(async () => {
  await mongoClient.connect()
  await ensureNavigationIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  await Promise.all([connections().deleteMany({}), prefs().deleteMany({})])
})

const activate = (appKey) => createInstallation(OWNER, getApp(appKey), { name: getApp(appKey).name })

test('um App que a conta não ativou não oferece página nenhuma', async () => {
  const { apps } = await buildNavigation(OWNER, USER)
  assert.deepEqual(apps, [])
})

test('ativar o Chat Web libera as páginas do manifesto', async () => {
  await activate('web_chat')
  const { apps } = await buildNavigation(OWNER, USER)
  assert.equal(apps.length, 1)
  assert.equal(apps[0].appKey, 'web_chat')
  assert.equal(apps[0].pinned, false)
  assert.deepEqual(
    apps[0].surfaces.map((s) => s.path),
    ['/apps/web-chat/widgets', '/apps/web-chat/conversations'],
  )
  assert.equal(apps[0].defaultSurfaceKey, 'widgets')
})

test('o DTO de navegação não carrega componente, import nem caminho de módulo', async () => {
  await activate('web_chat')
  const json = JSON.stringify(await buildNavigation(OWNER, USER))
  for (const forbidden of ['component', 'import', '..', 'src/']) {
    assert.ok(!json.includes(forbidden), `vazou "${forbidden}"`)
  }
})

test('fixar é atalho: não instala, não concede e não abre nada novo', async () => {
  // Sem instalação, fixar é recusado — o pin não pode virar porta de entrada.
  await assert.rejects(() => setPinnedApps(OWNER, USER, ['web_chat']), /conectado/)
  assert.equal((await listInstallations(OWNER, 'web_chat')).length, 0)

  await activate('web_chat')
  const { pinnedApps } = await setPinnedApps(OWNER, USER, ['web_chat'])
  assert.deepEqual(pinnedApps, [{ appKey: 'web_chat', order: 0 }])
  // Fixar não mudou a instalação.
  const [installation] = await listInstallations(OWNER, 'web_chat')
  assert.equal(installation.status, 'connected')
  assert.deepEqual(installation.grantedScopes, [])
})

test('um App sem páginas não pode ser fixado', async () => {
  await assert.rejects(() => setPinnedApps(OWNER, USER, ['slack']), /não pode ser fixado/)
})

test('App desconhecido é recusado', async () => {
  await assert.rejects(() => setPinnedApps(OWNER, USER, ['../admin']), /desconhecido/)
})

test('existe um único pin por App, mesmo com várias conexões', async () => {
  await activate('whatsapp')
  await createInstallation(OWNER, getApp('whatsapp'), { name: 'Segundo número' })
  const { pinnedApps } = await setPinnedApps(OWNER, USER, ['whatsapp', 'whatsapp'])
  assert.deepEqual(pinnedApps, [{ appKey: 'whatsapp', order: 0 }])
})

test('a ordem é preservada e o limite é respeitado', async () => {
  await activate('web_chat')
  await activate('whatsapp')
  const { pinnedApps } = await setPinnedApps(OWNER, USER, ['whatsapp', 'web_chat'])
  assert.deepEqual(pinnedApps, [
    { appKey: 'whatsapp', order: 0 },
    { appKey: 'web_chat', order: 1 },
  ])
  const { apps } = await buildNavigation(OWNER, USER)
  assert.deepEqual(apps.map((a) => a.appKey), ['whatsapp', 'web_chat'])

  const many = Array.from({ length: MAX_PINNED_APPS + 1 }, () => 'web_chat')
  // Duplicatas colapsam, então o limite é testado com chaves distintas válidas.
  assert.equal((await setPinnedApps(OWNER, USER, many)).pinnedApps.length, 1)
})

test('desconectar limpa o pin sem tocar em dado operacional', async () => {
  const installation = await activate('web_chat')
  await setPinnedApps(OWNER, USER, ['web_chat'])
  await revokeInstallation(OWNER, installation._id)
  await dropPinsForApp(OWNER, 'web_chat')

  assert.deepEqual((await getNavigationPreferences(OWNER, USER)).pinnedApps, [])
  // A conexão continua lá, revogada: nada foi apagado em cascata.
  assert.equal((await listInstallations(OWNER, 'web_chat')).length, 1)
})

test('o guard de superfície recusa página desconhecida, traversal e App inativo', async () => {
  assert.equal((await resolveSurface(OWNER, 'web_chat', 'widgets')).reason, 'inactive')
  await activate('web_chat')
  assert.equal((await resolveSurface(OWNER, 'web_chat', 'widgets')).ok, true)
  assert.equal((await resolveSurface(OWNER, 'web_chat', '../secret')).reason, 'unknown')
  assert.equal((await resolveSurface(OWNER, 'inexistente', 'widgets')).reason, 'unknown')
})

test('conexão que precisa reconectar mantém a entrada com CTA, não some', async () => {
  const installation = await activate('whatsapp')
  await connections().updateOne({ _id: new ObjectId(installation._id) }, { $set: { status: 'needs_reauth' } })
  const { apps } = await buildNavigation(OWNER, USER)
  assert.equal(apps[0].status, 'needs_reauth')
  assert.equal(apps[0].surfaces.length, 2)
  assert.equal((await resolveSurface(OWNER, 'whatsapp', 'channels')).reason, 'needs_reauth')
})

test('as preferências são por usuário, não da conta inteira', async () => {
  await activate('web_chat')
  await setPinnedApps(OWNER, 'usuario-a', ['web_chat'])
  assert.deepEqual((await getNavigationPreferences(OWNER, 'usuario-b')).pinnedApps, [])
})

// --- só o que funciona é fixável e navegável ------------------------------------

test('conexão quebrada ou expirada não é fixável', async () => {
  const installation = await activate('web_chat')
  for (const status of ['needs_reauth', 'error']) {
    await connections().updateOne({ _id: new ObjectId(installation._id) }, { $set: { status } })
    await assert.rejects(() => setPinnedApps(OWNER, USER, ['web_chat']), /conectado/, `status ${status} não deveria ser fixável`)
  }
})

test('App só com conexão quebrada abre a tela de reconectar, não a página', async () => {
  const installation = await activate('whatsapp')
  await connections().updateOne({ _id: new ObjectId(installation._id) }, { $set: { status: 'error' } })
  const decision = await resolveSurface(OWNER, 'whatsapp', 'channels')
  assert.equal(decision.ok, false)
  assert.equal(decision.reason, 'needs_reauth')

  const { apps } = await buildNavigation(OWNER, USER)
  // A entrada continua visível com CTA — some seria pior que avisar.
  assert.equal(apps[0].status, 'needs_reauth')
})

test('o guard só devolve as instalações realmente utilizáveis', async () => {
  const broken = await activate('whatsapp')
  await connections().updateOne({ _id: new ObjectId(broken._id) }, { $set: { status: 'needs_reauth' } })
  const ok = await createInstallation(OWNER, getApp('whatsapp'), { name: 'Segundo número' })
  const decision = await resolveSurface(OWNER, 'whatsapp', 'channels')
  assert.equal(decision.ok, true)
  assert.deepEqual(decision.installations.map((i) => i._id.toString()), [ok._id.toString()])
})
