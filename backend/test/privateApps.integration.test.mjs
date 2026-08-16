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
const {
  createPrivateApp,
  updatePrivateApp,
  deletePrivateApp,
  listPrivateApps,
  listAppsForOwner,
  exportPrivateApp,
  resolveAppForOwner,
  privateAppImpact,
  archivePrivateApp,
  ensurePrivateAppIndexes,
} = await import('../dist/apps/privateApps.js')
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
  await Promise.all([
    db.collection('app_definitions').deleteMany({}),
    db.collection('connections').deleteMany({}),
    db.collection('agents').deleteMany({}),
  ])
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

// --- o resolvedor único -------------------------------------------------------------

test('o catálogo do dono é sistema + os dele, e nada do vizinho', async () => {
  await createPrivateApp(OWNER, manifest({ key: 'meu_app' }))
  await createPrivateApp(OTHER, manifest({ key: 'app_do_vizinho' }))

  const mine = await listAppsForOwner(OWNER)
  const keys = mine.map((a) => a.key)
  assert.ok(keys.includes('web_chat'), 'os Apps do sistema continuam no catálogo')
  assert.ok(keys.includes('meu_app'))
  assert.ok(!keys.includes('app_do_vizinho'), 'o App privado de outra conta não aparece')
})

test('o App do sistema vence a resolução, e o privado não consegue disputar a chave', async () => {
  await assert.rejects(() => createPrivateApp(OWNER, manifest({ key: 'whatsapp' })), /App do sistema/)
  assert.equal((await resolveAppForOwner(OWNER, 'whatsapp')).source, 'system')
})

// --- exclusão não destrutiva --------------------------------------------------------

const connectPrivate = async (owner = OWNER, key = 'loja_exemplo') => {
  const app = await resolveAppForOwner(owner, key)
  return createInstallation(owner, app, { name: 'Minha loja', config: { apiKey: 'segredo' } })
}

test('não dá para excluir um App privado que ainda tem conexão', async () => {
  await createPrivateApp(OWNER, manifest())
  await connectPrivate()

  await assert.rejects(() => deletePrivateApp(OWNER, 'loja_exemplo'), /Desconecte e revogue/)
  // E continua lá: a recusa não é um meio-caminho.
  assert.ok(await resolveAppForOwner(OWNER, 'loja_exemplo'))
})

test('não dá para excluir enquanto um agente ainda tem permissão', async () => {
  await createPrivateApp(OWNER, manifest())
  const installation = await connectPrivate()
  await db.collection('agents').insertOne({
    ownerId: OWNER,
    name: 'Atendente',
    appGrants: [{ appKey: 'loja_exemplo', installationId: installation._id, actionKeys: ['buscar_pedido'], resourceConfig: {}, autonomousWriteActionKeys: [] }],
  })

  const impact = await privateAppImpact(OWNER, 'loja_exemplo')
  assert.equal(impact.installations, 1)
  assert.equal(impact.agents, 1)
  await assert.rejects(() => deletePrivateApp(OWNER, 'loja_exemplo'), /agente/)
})

test('sem conexão nem permissão, a exclusão passa', async () => {
  await createPrivateApp(OWNER, manifest())
  assert.equal((await privateAppImpact(OWNER, 'loja_exemplo')).installations, 0)
  assert.equal(await deletePrivateApp(OWNER, 'loja_exemplo'), true)
  assert.equal(await resolveAppForOwner(OWNER, 'loja_exemplo'), null)
})

test('arquivar tira do catálogo sem derrubar o que já está conectado', async () => {
  await createPrivateApp(OWNER, manifest())
  await connectPrivate()
  await archivePrivateApp(OWNER, 'loja_exemplo', true)

  // Fora do catálogo — nada novo se conecta a ele.
  const offered = (await listAppsForOwner(OWNER)).filter((a) => a.status === 'published').map((a) => a.key)
  assert.ok(!offered.includes('loja_exemplo'))
  // Mas o que já rodava continua resolvendo: arquivar não é revogar.
  assert.ok(await resolveAppForOwner(OWNER, 'loja_exemplo'))
  assert.equal((await privateAppImpact(OWNER, 'loja_exemplo')).archived, true)

  await archivePrivateApp(OWNER, 'loja_exemplo', false)
  assert.equal((await privateAppImpact(OWNER, 'loja_exemplo')).archived, false)
})

test('o impacto de outra conta não é legível', async () => {
  await createPrivateApp(OWNER, manifest())
  assert.equal(await privateAppImpact(OTHER, 'loja_exemplo'), null)
  assert.equal(await archivePrivateApp(OTHER, 'loja_exemplo', true), null)
  assert.equal(await deletePrivateApp(OTHER, 'loja_exemplo'), false)
})

test('manifesto adulterado no banco some da listagem, não vira App', async () => {
  await createPrivateApp(OWNER, manifest())
  await db.collection('app_definitions').updateOne(
    { ownerId: OWNER, key: 'loja_exemplo' },
    { $set: { 'manifest.actions.0.execution': { kind: 'native', adapter: 'google' } } },
  )
  assert.equal((await listPrivateApps(OWNER)).length, 0)
  assert.equal((await listAppsForOwner(OWNER)).find((a) => a.key === 'loja_exemplo'), undefined)
})
