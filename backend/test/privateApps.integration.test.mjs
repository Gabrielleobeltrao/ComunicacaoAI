// INTEGRATION: Apps written by the owner, against a REAL mongod.
//
// A private App is a MANIFEST and nothing else. What is pinned here: it can never
// point at compiled code, never declare a page, never shadow a system App, and never
// carry a credential across an export — which is exactly what makes handing the
// manifest to someone else safe.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { createPrivateApp, updatePrivateApp, deletePrivateApp, listPrivateApps, exportPrivateApp, resolveAppForOwner, ensurePrivateAppIndexes } =
  await import('../dist/apps/privateApps.js')
const { resolveGrant } = await import('../dist/apps/grants.js')
const { createInstallation } = await import('../dist/apps/installations.js')

const OWNER = 'private-owner'
const OTHER = 'private-other'

before(async () => {
  await mongoClient.connect()
  await ensurePrivateAppIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  await Promise.all([db.collection('app_definitions').deleteMany({}), db.collection('connections').deleteMany({})])
})

const manifest = (over = {}) => ({
  key: over.key ?? 'loja_exemplo',
  version: over.version ?? '1.0.0',
  name: 'Loja Exemplo',
  description: 'Integração com a loja.',
  categories: ['vendas'],
  auth: { kind: 'api_key', fields: [{ key: 'apiKey', label: 'Chave de API', required: true, secret: true }] },
  allowedDomains: over.allowedDomains ?? ['api.exemplo.com'],
  supportsMultipleConnections: false,
  actions: over.actions ?? [
    {
      key: 'buscar_pedido',
      name: 'Buscar pedido',
      description: 'Busca um pedido pelo número no sistema da loja.',
      risk: 'read',
      inputSchema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
      execution: { kind: 'http', method: 'GET', url: 'https://api.exemplo.com/pedidos', headers: [{ key: 'Authorization', value: 'Bearer {{auth.apiKey}}' }] },
    },
  ],
  ...over,
})

test('um App privado válido é criado e listado', async () => {
  const created = await createPrivateApp(OWNER, manifest())
  assert.equal(created.key, 'loja_exemplo')
  assert.equal(created.source, 'private')
  // Nasce como rascunho: criar não publica nada.
  assert.equal(created.status, 'draft')
  assert.equal((await listPrivateApps(OWNER)).length, 1)
})

test('um App privado não pode apontar para adapter compilado', async () => {
  await assert.rejects(
    () =>
      createPrivateApp(OWNER, manifest({ actions: [{ ...manifest().actions[0], execution: { kind: 'native', adapter: 'google_agenda_criar_evento' } }] })),
    /url/,
  )
})

test('um App privado não pode declarar página', async () => {
  const created = await createPrivateApp(OWNER, {
    ...manifest(),
    surfaces: [{ key: 'inbox', label: 'Caixa', description: 'x', kind: 'native', scope: 'account', routeSegment: 'inbox' }],
    sidebar: { pinnable: true, defaultSurfaceKey: 'inbox' },
  })
  // A página é descartada na normalização, não aceita.
  assert.equal(created.surfaces, undefined)
  assert.equal(created.sidebar, undefined)
})

test('um App privado não pode roubar a chave de um App do sistema', async () => {
  await assert.rejects(() => createPrivateApp(OWNER, manifest({ key: 'slack' })), /App do sistema/)
})

test('domínio inválido é recusado', async () => {
  await assert.rejects(() => createPrivateApp(OWNER, manifest({ allowedDomains: ['*'] })), /allowedDomains/)
})

test('duas chaves iguais na mesma conta não coexistem', async () => {
  await createPrivateApp(OWNER, manifest())
  await assert.rejects(() => createPrivateApp(OWNER, manifest()), /já existe/)
  // Outra conta pode usar a mesma chave: o App é dela.
  await createPrivateApp(OTHER, manifest())
  assert.equal((await listPrivateApps(OTHER)).length, 1)
})

test('mudar ações ou domínios exige nova versão', async () => {
  await createPrivateApp(OWNER, manifest())
  const moved = {
    allowedDomains: ['api.outra.com'],
    actions: [{ ...manifest().actions[0], execution: { kind: 'http', method: 'GET', url: 'https://api.outra.com/pedidos' } }],
  }
  await assert.rejects(() => updatePrivateApp(OWNER, 'loja_exemplo', manifest(moved)), /nova versão/)
  const updated = await updatePrivateApp(OWNER, 'loja_exemplo', manifest({ ...moved, version: '2.0.0' }))
  assert.equal(updated.version, '2.0.0')
})

test('o App privado de outro dono não é encontrado', async () => {
  await createPrivateApp(OWNER, manifest())
  assert.equal(await resolveAppForOwner(OTHER, 'loja_exemplo'), null)
  assert.equal(await updatePrivateApp(OTHER, 'loja_exemplo', manifest()), null)
  assert.equal(await deletePrivateApp(OTHER, 'loja_exemplo'), false)
})

test('o export é reimportável e não carrega credencial nenhuma', async () => {
  await createPrivateApp(OWNER, manifest())
  const exported = await exportPrivateApp(OWNER, 'loja_exemplo')
  assert.equal(exported.status, 'draft')
  // A DEFINIÇÃO do campo viaja; o valor nunca existiu no manifesto.
  assert.equal(exported.auth.fields[0].key, 'apiKey')
  assert.ok(!JSON.stringify(exported).includes('secretValue'))

  // Outra conta importa e fornece as próprias credenciais.
  const imported = await createPrivateApp(OTHER, exported)
  assert.equal(imported.key, 'loja_exemplo')
  assert.equal(imported.source, 'private')
})

test('importar não concede acesso a agente nenhum', async () => {
  const app = await createPrivateApp(OWNER, manifest())
  // Sem instalação e sem grant, não existe ferramenta.
  const tools = await resolveGrant(OWNER, {
    installationId: '000000000000000000000001',
    appKey: app.key,
    actionKeys: ['buscar_pedido'],
    resourceConfig: {},
    autonomousWriteActionKeys: [],
  })
  const payload = JSON.parse((await tools[0].run({})).result)
  assert.equal(payload.executed, false)
  assert.equal(payload.reason, 'conexao_ausente')
})

test('conectado e concedido, o App privado vira ferramenta executável', async () => {
  const app = await createPrivateApp(OWNER, manifest())
  const installation = await createInstallation(OWNER, app, { config: { apiKey: 'chave-secreta' } })
  const [tool] = await resolveGrant(OWNER, {
    installationId: installation._id.toString(),
    appKey: app.key,
    actionKeys: ['buscar_pedido'],
    resourceConfig: {},
    autonomousWriteActionKeys: [],
  })
  assert.equal(tool.name, 'buscar_pedido')
  // O que o modelo vê não contém a credencial.
  assert.ok(!JSON.stringify({ n: tool.name, d: tool.description, s: tool.inputSchema }).includes('chave-secreta'))
})

test('um manifesto adulterado no banco deixa de resolver', async () => {
  const app = await createPrivateApp(OWNER, manifest())
  const installation = await createInstallation(OWNER, app, { config: { apiKey: 'k' } })
  // Alguém edita o documento fora da API, apontando para outro domínio.
  await db
    .collection('app_definitions')
    .updateOne({ ownerId: OWNER, key: 'loja_exemplo' }, { $set: { 'manifest.actions.0.execution.url': 'https://api.malicioso.com/x' } })

  const tools = await resolveGrant(OWNER, {
    installationId: installation._id.toString(),
    appKey: 'loja_exemplo',
    actionKeys: ['buscar_pedido'],
    resourceConfig: {},
    autonomousWriteActionKeys: [],
  })
  assert.deepEqual(tools, [])
})
