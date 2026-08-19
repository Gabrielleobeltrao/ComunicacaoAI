// INTEGRAÇÃO: um site vira conhecimento vivo do agente.
//
// Servidor HTTP de verdade, mongod de verdade, e nenhuma LLM em ponto nenhum: descoberta,
// leitura, hash e gravação são determinísticos. O que se prova aqui é o ciclo inteiro —
// ler, virar documento, não reler o que não mudou, e o que a orquestração enxerga disso.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
// O mesmo escape dos outros testes de rede: só loopback, e a produção recusa subir com
// ele ligado.
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'
delete process.env.VOYAGE_API_KEY

const { ensureAgentWebKnowledgeFresh, webSourceRef } = await import('../dist/webKnowledge.js')
const { listDocumentsFor } = await import('../dist/knowledge.js')
const { db, mongoClient } = await import('../dist/db.js')

const OWNER = 'dono-web'
let porta = 0
let corpoDaPagina = '<html><head><title>Boletim</title></head><body>conteúdo original da página</body></html>'
let pedidos = []
let servidor

before(async () => {
  servidor = createServer((req, res) => {
    pedidos.push(req.url)
    if (req.url === '/lista') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<a href="/artigo-1">um</a><a href="/artigo-2">dois</a><a href="https://fora.test/x">de fora</a>')
      return
    }
    if (req.url === '/feed') {
      res.writeHead(200, { 'content-type': 'application/xml' })
      res.end(`<rss><channel><item><title>Um</title><link>http://127.0.0.1:${porta}/artigo-1</link></item></channel></rss>`)
      return
    }
    if (req.url === '/quebrado') {
      res.writeHead(500)
      res.end('erro')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(req.url?.startsWith('/artigo') ? `<html><head><title>Artigo ${req.url}</title></head><body>texto do ${req.url}</body></html>` : corpoDaPagina)
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  porta = servidor.address().port
})

after(async () => {
  await new Promise((r) => servidor.close(r))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await db.collection('agents').deleteMany({})
  await db.collection('knowledge_documents').deleteMany({})
  pedidos = []
  corpoDaPagina = '<html><head><title>Boletim</title></head><body>conteúdo original da página</body></html>'
})

const criarAgente = async (fonte) => {
  const _id = new ObjectId()
  await db.collection('agents').insertOne({
    _id,
    ownerId: OWNER,
    name: 'Agente com site',
    objective: 'ler sites',
    provider: 'anthropic',
    watchedSources: [{ id: 'f1', name: 'Boletim', kind: 'http', url: `http://127.0.0.1:${porta}/pagina`, when: 'on_demand', initialWindow: '7d', ...fonte }],
  })
  return _id
}

const documentos = (agentId) => listDocumentsFor({ ownerType: 'agent', ownerId: agentId })

// --- o ciclo -------------------------------------------------------------------------------

test('a página vira documento na base, com título e procedência', async () => {
  const agentId = await criarAgente({ refreshMode: 'on_demand' })
  const saida = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'on_demand')

  assert.equal(saida[0].refreshed, true)
  assert.equal(saida[0].created, 1)
  const docs = await documentos(agentId)
  assert.equal(docs.length, 1)
  assert.equal(docs[0].title, 'Boletim')
  assert.equal(docs[0].source, 'web')
  // A marca liga o documento ao endereço que o produziu — é ela que permite atualizar em
  // vez de duplicar.
  assert.equal(docs[0].sourceRef, webSourceRef('f1', `http://127.0.0.1:${porta}/pagina`))
})

test('o que não mudou não vira escrita nem reindexação', async () => {
  const agentId = await criarAgente({ refreshMode: 'manual' })
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  const segunda = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')

  assert.equal(segunda[0].unchanged, 1)
  assert.equal(segunda[0].created, 0)
  assert.equal(segunda[0].updated, 0)
  assert.equal((await documentos(agentId)).length, 1, 'não duplicou')
})

test('página mudou: o MESMO documento é atualizado', async () => {
  const agentId = await criarAgente({ refreshMode: 'manual' })
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  corpoDaPagina = '<html><head><title>Boletim</title></head><body>conteúdo NOVO de hoje</body></html>'
  const segunda = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')

  assert.equal(segunda[0].updated, 1)
  const docs = await documentos(agentId)
  assert.equal(docs.length, 1, 'atualizou, não duplicou')
  const completo = await db.collection('knowledge_documents').findOne({ _id: docs[0]._id })
  assert.match(completo.content, /conteúdo NOVO de hoje/)
})

// --- a economia, que é o ponto do modo sob demanda -------------------------------------------

test('sob demanda e lida agora há pouco: nem toca no site', async () => {
  const agentId = await criarAgente({ refreshMode: 'on_demand', maxStalenessMinutes: 30 })
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'on_demand')
  const antes = pedidos.length
  const segunda = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'on_demand')

  assert.equal(segunda[0].refreshed, false)
  assert.match(segunda[0].reason, /lida há/)
  assert.equal(pedidos.length, antes, 'nenhuma requisição nova foi feita')
})

test('sob demanda e envelhecida: lê antes de o agente trabalhar', async () => {
  const agentId = await criarAgente({ refreshMode: 'on_demand', maxStalenessMinutes: 30 })
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'on_demand')
  // Uma hora depois: o que está guardado não serve mais.
  const daquiUmaHora = Date.now() + 60 * 60_000
  const segunda = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'on_demand', daquiUmaHora)
  assert.equal(segunda[0].refreshed, true)
})

test('manual não é lida pelo relógio, e por horário não é lida por chamada', async () => {
  const soManual = await criarAgente({ refreshMode: 'manual' })
  assert.equal((await ensureAgentWebKnowledgeFresh(OWNER, soManual, 'scheduled'))[0].refreshed, false)
  assert.equal((await ensureAgentWebKnowledgeFresh(OWNER, soManual, 'on_demand'))[0].refreshed, false)

  const soHorario = await criarAgente({ refreshMode: 'scheduled', intervalMinutes: 30 })
  assert.equal((await ensureAgentWebKnowledgeFresh(OWNER, soHorario, 'on_demand'))[0].refreshed, false)
  assert.equal((await ensureAgentWebKnowledgeFresh(OWNER, soHorario, 'scheduled'))[0].refreshed, true)
})

// --- descoberta -------------------------------------------------------------------------------

test('varrer uma listagem traz as páginas dela, e não o site inteiro', async () => {
  const agentId = await criarAgente({
    refreshMode: 'manual',
    url: `http://127.0.0.1:${porta}/lista`,
    discoveryMode: 'listing',
    crawlArticles: true,
    maxArticlesPerRun: 5,
  })
  const saida = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')

  // A própria listagem mais os dois artigos do mesmo domínio; o de fora fica fora.
  assert.equal(saida[0].created, 3)
  const titulos = (await documentos(agentId)).map((d) => d.title).sort()
  assert.deepEqual(titulos, ['Artigo /artigo-1', 'Artigo /artigo-2', 'Boletim · lista'])
  assert.ok(!pedidos.some((p) => p.includes('fora.test')))
})

test('um feed vira os artigos que ele lista', async () => {
  const agentId = await criarAgente({ refreshMode: 'manual', kind: 'rss', url: `http://127.0.0.1:${porta}/feed`, discoveryMode: 'rss' })
  const saida = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  assert.equal(saida[0].created, 1)
  assert.equal((await documentos(agentId))[0].title, 'Artigo /artigo-1')
})

test('o teto de páginas por rodada é respeitado', async () => {
  const agentId = await criarAgente({
    refreshMode: 'manual',
    url: `http://127.0.0.1:${porta}/lista`,
    discoveryMode: 'listing',
    maxArticlesPerRun: 1,
  })
  const saida = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  assert.ok(saida[0].created <= 2, `criou ${saida[0].created}`)
})

// --- o que dá errado ----------------------------------------------------------------------------

test('site fora do ar: o erro fica registrado e nada quebra', async () => {
  const agentId = await criarAgente({ refreshMode: 'manual', url: `http://127.0.0.1:${porta}/quebrado` })
  const saida = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')

  // A leitura não produziu documento, mas também não derrubou nada.
  assert.equal(saida[0].created, 0)
  const agente = await db.collection('agents').findOne({ _id: agentId })
  const fonte = agente.watchedSources[0]
  // "Tentei" fica gravado; "consegui", não — é o que faz a próxima chamada tentar de novo.
  assert.ok(fonte.lastFetchedAt)
  assert.ok(!fonte.lastSuccessfulFetchAt)
})

test('endereço privado continua recusado', async () => {
  const agentId = await criarAgente({ refreshMode: 'manual', url: 'http://169.254.169.254/latest/meta-data/' })
  const saida = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  assert.equal(saida[0].created, 0)
  assert.equal((await documentos(agentId)).length, 0)
})

test('fonte desligada não é lida, nem no clique', async () => {
  const agentId = await criarAgente({ refreshMode: 'scheduled', enabled: false })
  assert.deepEqual(await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual'), [])
  assert.equal(pedidos.length, 0)
})

// --- o estado que a tela mostra -------------------------------------------------------------------

test('a leitura registra quando foi, o que achou e quando volta', async () => {
  const agentId = await criarAgente({ refreshMode: 'scheduled', intervalMinutes: 15 })
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'scheduled')

  const fonte = (await db.collection('agents').findOne({ _id: agentId })).watchedSources[0]
  assert.equal(fonte.status, 'ok')
  assert.ok(fonte.lastSuccessfulFetchAt instanceof Date)
  assert.ok(fonte.nextScheduledAt instanceof Date)
  assert.equal(fonte.lastError, null)
  assert.equal(fonte.discoveredUrls, 1)
  assert.equal(fonte.newDocuments, 1)
})

test('agente sem fonte nenhuma não faz nada, e não custa nada', async () => {
  const _id = new ObjectId()
  await db.collection('agents').insertOne({ _id, ownerId: OWNER, name: 'Sem site', objective: 'x', provider: 'anthropic' })
  assert.deepEqual(await ensureAgentWebKnowledgeFresh(OWNER, _id, 'on_demand'), [])
})

test('a fonte de outro dono não é lida por este', async () => {
  const agentId = await criarAgente({ refreshMode: 'manual' })
  assert.deepEqual(await ensureAgentWebKnowledgeFresh('outro-dono', agentId, 'manual'), [])
  assert.equal(pedidos.length, 0)
})
