// VERSÃO DE FERRAMENTA — imutável, com hash, e sem quebrar o que já roda.
//
// "Instalei a ferramenta X" só significa alguma coisa se X não puder mudar por baixo. Se
// o autor puder editar o que já foi instalado, cada instalação vira alvo móvel — e a
// permissão que alguém revisou ontem pode estar valendo para outro comportamento hoje.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { ensureToolVersionIndexes, publishVersion, listVersions, latestVersion, hashOf, riskOf, describeLegacyTool, ToolVersionError } = await import('../dist/toolVersions.js')
const { createTool, getTool } = await import('../dist/tools.js')

const DONO = 'dono-versoes'
const VIZINHO = 'vizinho-versoes'

before(async () => {
  await mongoClient.connect()
  await ensureToolVersionIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

let ferramenta
beforeEach(async () => {
  for (const c of ['tools', 'tool_versions']) await db.collection(c).deleteMany({})
  delete process.env.CODE_TOOLS_ENABLED
  ferramenta = await createTool(DONO, {
    name: 'consulta_cep',
    description: 'consulta um CEP',
    method: 'GET',
    url: 'https://exemplo.test/cep',
    inputSchema: { type: 'object', properties: { cep: { type: 'string' } } },
  })
})

const publicar = (extra = {}) =>
  publishVersion(DONO, ferramenta._id, {
    version: '1.0.0',
    runtimeKind: 'http',
    manifest: { method: 'GET', url: 'https://exemplo.test/cep' },
    inputSchema: ferramenta.inputSchema,
    outputSchema: { type: 'object', properties: { rua: { type: 'string' } } },
    ...extra,
  })

// --- imutabilidade -----------------------------------------------------------------------

test('uma versão publicada NÃO pode ser republicada', async () => {
  const v = await publicar()
  assert.equal(v.immutable, true)
  await assert.rejects(() => publicar({ manifest: { method: 'GET', url: 'https://outro.test' } }), /já foi publicada/)
  assert.equal((await listVersions(DONO, ferramenta._id)).length, 1)
})

test('o hash não muda com a ORDEM das chaves', () => {
  const a = hashOf({ url: 'https://x.test', method: 'GET', timeout: 1000 })
  const b = hashOf({ timeout: 1000, method: 'GET', url: 'https://x.test' })
  assert.equal(a, b, 'uma reescrita cosmética não pode virar "versão diferente" na conferência')
  assert.notEqual(a, hashOf({ url: 'https://y.test', method: 'GET', timeout: 1000 }))
})

test('publicar exige dizer o que a ferramenta DEVOLVE', async () => {
  await assert.rejects(() => publicar({ outputSchema: null }), /devolve/)
  const erro = await publicar({ outputSchema: null }).catch((e) => e)
  assert.equal(erro.code, 'missing_output_schema')
})

test('a versão usa semver', async () => {
  await assert.rejects(() => publicar({ version: 'v1' }), /formato 1\.0\.0/)
  await assert.rejects(() => publicar({ version: '1.0' }), /formato/)
})

// --- risco derivado ------------------------------------------------------------------------

test('o risco vem do que a ferramenta FAZ, não do que alguém digitou', () => {
  assert.equal(riskOf('http', { method: 'GET' }), 'read')
  assert.equal(riskOf('http', { method: 'POST' }), 'write')
  assert.equal(riskOf('http', { method: 'delete' }), 'write')
  // Código roda em sandbox e ainda não executa: declarar `read` seria otimismo.
  assert.equal(riskOf('code', {}), 'high_risk')
})

test('a versão publicada carrega o risco calculado', async () => {
  const v = await publicar({ manifest: { method: 'POST', url: 'https://exemplo.test/cep' } })
  assert.equal(v.risk, 'write')
})

// --- código fail-closed ------------------------------------------------------------------------

test('ferramenta de CÓDIGO não publica sem o runtime isolado', async () => {
  const erro = await publishVersion(DONO, ferramenta._id, {
    version: '2.0.0',
    runtimeKind: 'code',
    manifest: { source: 'print(1)' },
    inputSchema: {},
    outputSchema: { type: 'object' },
  }).catch((e) => e)
  assert.ok(erro instanceof ToolVersionError)
  assert.equal(erro.code, 'code_runtime_disabled')
  assert.equal((await listVersions(DONO, ferramenta._id)).length, 0)
})

// --- o legado -----------------------------------------------------------------------------------

test('a ferramenta antiga é lida como versão zero, sem ser tocada', async () => {
  const antes = await db.collection('tools').findOne({ _id: ferramenta._id })
  const descricao = describeLegacyTool(ferramenta)
  assert.equal(descricao.runtimeKind, 'http')
  assert.equal(descricao.version, '0.0.0')
  assert.equal(descricao.risk, 'read')
  assert.equal(descricao.status, 'active')

  const depois = await db.collection('tools').findOne({ _id: ferramenta._id })
  assert.deepEqual(depois, antes, 'derivar na leitura é o que faz nenhuma ferramenta antiga parar de funcionar')
  assert.equal(depois.runtimeKind, undefined)
})

test('publicar uma versão NÃO altera a ferramenta', async () => {
  const antes = await getTool(DONO, ferramenta._id)
  await publicar()
  const depois = await getTool(DONO, ferramenta._id)
  assert.equal(depois.updatedAt.getTime(), antes.updatedAt.getTime())
  assert.equal(depois.name, antes.name)
})

// --- isolamento ------------------------------------------------------------------------------------

test('a versão de outra conta não é lida nem sobrescrita', async () => {
  await publicar()
  assert.deepEqual(await listVersions(VIZINHO, ferramenta._id), [])
  assert.equal(await latestVersion(VIZINHO, ferramenta._id), null)

  // O vizinho publica com o MESMO número na MESMA ferramenta: contas diferentes, versões
  // diferentes — e nenhuma sobrescreve a outra.
  const dele = await publishVersion(VIZINHO, ferramenta._id, {
    version: '1.0.0',
    runtimeKind: 'http',
    manifest: { method: 'GET', url: 'https://dele.test' },
    inputSchema: {},
    outputSchema: { type: 'object' },
  })
  const minha = await latestVersion(DONO, ferramenta._id)
  assert.notEqual(dele.sha256, minha.sha256)
  assert.equal(minha.manifest.url, 'https://exemplo.test/cep')
})

test('a listagem de versões não carrega o manifesto inteiro', async () => {
  await publicar()
  const [v] = await listVersions(DONO, ferramenta._id)
  assert.equal(v.manifest, undefined, 'a lista mostra o que identifica; o corpo vem quando alguém abre')
  assert.ok(v.sha256)
  assert.ok(v.version)
})

test('a versão mais recente é a última publicada', async () => {
  await publicar({ version: '1.0.0' })
  await publicar({ version: '1.1.0', manifest: { method: 'GET', url: 'https://exemplo.test/cep/v2' } })
  const ultima = await latestVersion(DONO, ferramenta._id)
  assert.equal(ultima.version, '1.1.0')
})
