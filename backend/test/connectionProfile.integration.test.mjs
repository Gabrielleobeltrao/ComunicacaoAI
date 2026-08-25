// Uma CONEXÃO reaproveitada por várias ferramentas.
//
// A ferramenta guardava a URL inteira e a própria credencial. Duas ferramentas contra a
// mesma API guardavam o mesmo segredo duas vezes, e trocar a chave significava editar as
// duas — quando alguém lembrava da segunda.
//
// Nada de coleção nova: a conexão é a instalação de App que já existia. O que estas provas
// fixam é que ela pode ser emprestada sem afrouxar nada — e que a ferramenta manual, que é
// a que todo mundo tem hoje, continua idêntica.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.APP_ENCRYPTION_KEY ||= 'chave-de-teste-com-32-caracteres!'

const { createPrivateApp, resolveAppForOwner } = await import('../dist/apps/privateApps.js')
const { createInstallation, patchInstallation, getInstallation, installationPublic, normalizeEnvironment } = await import(
  '../dist/apps/installations.js'
)
const { resolveConnection, joinPath, environmentOf } = await import('../dist/apps/connectionProfile.js')
const { resolveExecutableTool } = await import('../dist/tools/connectedTool.js')
const { createTool, ToolValidationError } = await import('../dist/tools.js')
const { db, mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const DONO = 'owner-conexao'
const VIZINHO = 'owner-vizinho'

const MANIFESTO = {
  key: 'erp_teste',
  version: '1.0.0',
  source: 'private',
  name: 'ERP de Teste',
  description: 'Uma API de exemplo para as provas de conexão.',
  categories: ['erp'],
  auth: { kind: 'api_key', fields: [{ key: 'token', label: 'Token', secret: true }], scopes: [] },
  // O sandbox precisa estar na lista: o manifesto não pode declarar uma base num host que
  // ele não tem permissão de alcançar, senão a ferramenta conectada herdaria uma permissão
  // que ninguém revisou. A validação pegou isto — o manifesto de teste é que estava errado.
  allowedDomains: ['api.erp-teste.com', 'sandbox.erp-teste.com'],
  supportsMultipleConnections: true,
  actions: [],
  status: 'active',
  // É este campo que torna o App emprestável como conexão. Sem ele, ele só executa as
  // próprias ações — que é o que todo App existente faz.
  connection: {
    baseUrl: 'https://api.erp-teste.com',
    baseUrlByEnvironment: { paper: 'https://sandbox.erp-teste.com' },
    headers: [{ key: 'X-Token', value: '{{auth.token}}' }],
  },
}

const semConexao = { ...MANIFESTO, key: 'sem_conexao', name: 'App Sem Conexão', connection: undefined }

before(async () => {
  for (const dono of [DONO, VIZINHO]) {
    // Sem `catch`: um manifesto recusado aqui faria TODAS as provas falharem por "app
    // não encontrado", escondendo o motivo real atrás de um sintoma.
    await createPrivateApp(dono, MANIFESTO)
    await createPrivateApp(dono, semConexao)
  }
})

beforeEach(async () => {
  await db.collection('connections').deleteMany({}).catch(() => undefined)
  await db.collection('tools').deleteMany({}).catch(() => undefined)
})

const app = (dono = DONO, key = 'erp_teste') => resolveAppForOwner(dono, key)
const conectar = async (over = {}, dono = DONO) =>
  createInstallation(dono, await app(dono, over.appKey ?? 'erp_teste'), {
    name: over.name ?? 'ERP principal',
    config: { token: over.token ?? 'segredo-do-erp' },
    ...over,
  })

const ferramenta = (over = {}) =>
  createTool(DONO, {
    name: over.name ?? 'consultar_conta',
    description: 'Consulta a conta no ERP de teste.',
    method: 'GET',
    url: over.url ?? '/v2/account',
    inputSchema: { type: 'object', properties: {} },
    ...over,
  })

// --- a ferramenta MANUAL não muda em nada -----------------------------------------------------

test('sem conexão, a ferramenta executa exatamente como sempre executou', async () => {
  const t = await ferramenta({ url: 'https://api.exemplo.com/pedidos', name: 'manual' })
  assert.equal(t.installationId, null)
  const pronta = await resolveExecutableTool(t, DONO)
  assert.equal(pronta.ok, true)
  // A MESMA ferramenta: sem ida ao banco, sem base emprestada, sem nada resolvido.
  assert.equal(pronta.executable.url, 'https://api.exemplo.com/pedidos')
  assert.equal(pronta.allHeadersAreSecret, false, 'os cabeçalhos dela são dela, e o mascaramento é o de sempre')
  assert.deepEqual(pronta.executable.allowedDomains, ['api.exemplo.com'])
})

// --- a conexão emprestada ------------------------------------------------------------------------

test('com conexão, a ferramenta guarda só o caminho e recebe base e credencial na execução', async () => {
  const conexao = await conectar()
  const t = await ferramenta({ installationId: conexao._id.toString() })

  // No banco fica o CAMINHO. O segredo não está aqui — está na conexão, cifrado.
  assert.equal(t.url, '/v2/account')
  assert.equal(t.auth.kind, 'none')
  assert.equal(t.auth.secretEncrypted, null)

  const pronta = await resolveExecutableTool(t, DONO)
  assert.equal(pronta.ok, true)
  assert.equal(pronta.executable.url, 'https://api.erp-teste.com/v2/account')
  assert.deepEqual(pronta.executable.headers, [{ key: 'X-Token', value: 'segredo-do-erp' }])
  // Todo cabeçalho vindo da conexão pode carregar credencial, seja qual for o nome.
  assert.equal(pronta.allHeadersAreSecret, true)
  // O domínio permitido é o do APP: quem autorizou a conexão viu esta lista antes.
  assert.deepEqual(pronta.executable.allowedDomains, ['api.erp-teste.com', 'sandbox.erp-teste.com'])
})

test('duas ferramentas na mesma conexão não duplicam o segredo', async () => {
  const conexao = await conectar()
  const a = await ferramenta({ name: 'consultar_conta', installationId: conexao._id.toString() })
  const b = await ferramenta({ name: 'consultar_pedidos', url: '/v2/orders', installationId: conexao._id.toString() })

  for (const t of [a, b]) assert.equal(t.auth.secretEncrypted, null, 'o segredo não se multiplica com as ferramentas')
  const pa = await resolveExecutableTool(a, DONO)
  const pb = await resolveExecutableTool(b, DONO)
  assert.equal(pa.executable.headers[0].value, 'segredo-do-erp')
  assert.equal(pb.executable.headers[0].value, 'segredo-do-erp')
  assert.equal(pb.executable.url, 'https://api.erp-teste.com/v2/orders')
})

test('trocar a credencial na conexão vale para todas as ferramentas de uma vez', async () => {
  const conexao = await conectar()
  const t = await ferramenta({ installationId: conexao._id.toString() })
  await patchInstallation(DONO, conexao._id, await app(), { config: { token: 'token-novo' } })
  const pronta = await resolveExecutableTool(t, DONO)
  assert.equal(pronta.executable.headers[0].value, 'token-novo')
})

// --- o que a conexão RECUSA -----------------------------------------------------------------------

test('conexão de outro dono simplesmente não existe', async () => {
  const alheia = await conectar({}, VIZINHO)
  const r = await resolveConnection(DONO, alheia._id.toString())
  assert.equal(r.ok, false)
  assert.equal(r.problem, 'connection_not_found')
})

test('conexão revogada bloqueia a execução com o motivo', async () => {
  const conexao = await conectar()
  const t = await ferramenta({ installationId: conexao._id.toString() })
  await patchInstallation(DONO, conexao._id, await app(), { status: 'revoked' })

  const pronta = await resolveExecutableTool(t, DONO)
  assert.equal(pronta.ok, false)
  assert.match(pronta.message, /revogada/)
  // A recusa é conferida AGORA, e não quando a lista foi montada: uma conexão revogada
  // no meio da execução precisa barrar a chamada que ainda vai sair.
})

test('conexão expirada diz para reconectar, e não "revogada"', async () => {
  const conexao = await conectar()
  await patchInstallation(DONO, conexao._id, await app(), { status: 'needs_reauth' })
  const r = await resolveConnection(DONO, conexao._id.toString())
  assert.equal(r.problem, 'connection_expired')
  assert.match(r.message, /reconectada/)
})

test('um App que não declara conexão não pode ser emprestado a uma ferramenta', async () => {
  const conexao = await conectar({ appKey: 'sem_conexao' })
  const r = await resolveConnection(DONO, conexao._id.toString())
  assert.equal(r.problem, 'app_not_connectable')
})

test('com conexão, uma URL completa é recusada na criação', async () => {
  const conexao = await conectar()
  // Um caminho absoluto seria a ferramenta escapando da conexão: apontaria para onde
  // quisesse, com a credencial da conexão junto.
  await assert.rejects(
    () => ferramenta({ url: 'https://outro-site.com/roubar', installationId: conexao._id.toString() }),
    (e) => e instanceof ToolValidationError && /apenas o caminho/.test(e.message),
  )
})

// --- ambiente -------------------------------------------------------------------------------------

test('a conexão paper usa a base de simulação', async () => {
  const conexao = await conectar({ environment: 'paper' })
  const r = await resolveConnection(DONO, conexao._id.toString())
  assert.equal(r.environment, 'paper')
  assert.equal(r.baseUrl, 'https://sandbox.erp-teste.com')
})

test('LIVE é recusado na criação — ligar não pode ser uma linha de configuração', async () => {
  // Um ambiente que envia ordem de verdade não passa a existir por acidente.
  assert.throws(() => normalizeEnvironment('live'), /não está liberado/)
  await assert.rejects(() => conectar({ environment: 'live' }), /não está liberado/)
})

test('uma conexão antiga, sem o campo, é `default` — e nada muda para ela', async () => {
  const conexao = await conectar()
  await db.collection('connections').updateOne({ _id: conexao._id }, { $unset: { environment: '' } })
  const lida = await getInstallation(DONO, conexao._id)
  assert.equal(lida.environment, undefined)
  assert.equal(environmentOf(lida), 'default')
  // E a API sempre entrega o valor resolvido: a tela não precisa saber que ele pode faltar.
  assert.equal(installationPublic(lida).environment, 'default')
})

// --- segredo nunca sai ---------------------------------------------------------------------------

test('a API da conexão não devolve segredo, nem cifrado', async () => {
  const conexao = await conectar()
  const publico = installationPublic(conexao)
  const json = JSON.stringify(publico)
  assert.ok(!json.includes('segredo-do-erp'), 'o valor em claro não sai')
  assert.ok(!json.includes(conexao.encryptedConfig), 'nem o cifrado — ele também é o segredo')
  assert.equal(publico.encryptedConfig, undefined)
})

// --- juntar caminho -------------------------------------------------------------------------------

test('a junção de base e caminho não duplica nem come a barra', () => {
  assert.equal(joinPath('https://a.com', '/v2/x'), 'https://a.com/v2/x')
  assert.equal(joinPath('https://a.com/', 'v2/x'), 'https://a.com/v2/x')
  assert.equal(joinPath('https://a.com/', ''), 'https://a.com')
  assert.equal(joinPath('https://a.com', 'https://b.com/x'), null, 'URL completa não é caminho')
})
