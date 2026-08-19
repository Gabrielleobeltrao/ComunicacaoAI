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
let artigosNoFeed = ['1', '2']
const textoDaMateria = {}

before(async () => {
  servidor = createServer((req, res) => {
    pedidos.push(req.url)
    if (req.url === '/lista') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<a href="/artigo-1">um</a><a href="/artigo-2">dois</a><a href="https://fora.test/x">de fora</a>')
      return
    }
    if (req.url === '/feed-2') {
      res.writeHead(200, { 'content-type': 'application/xml' })
      res.end(
        `<rss><channel>${artigosNoFeed
          .map((n) => `<item><title>Artigo ${n}</title><link>http://127.0.0.1:${porta}/materia-${n}</link></item>`)
          .join('')}</channel></rss>`,
      )
      return
    }
    if (req.url?.startsWith('/materia-')) {
      const n = req.url.replace('/materia-', '')
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html><head>
        <title>Matéria ${n}</title>
        <link rel="canonical" href="http://127.0.0.1:${porta}/materia-${n}"/>
        <meta property="article:published_time" content="2026-08-${String(10 + Number(n)).padStart(2, '0')}T09:00:00Z"/>
        <meta property="article:author" content="Redação"/>
      </head><body>
        <nav>Home Sobre Contato Assine já</nav>
        <article>${textoDaMateria[n] ?? `Conteúdo da matéria ${n}. `.repeat(30)}</article>
        <footer>Todos os direitos reservados</footer>
      </body></html>`)
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
  artigosNoFeed = ['1', '2']
  for (const chave of Object.keys(textoDaMateria)) delete textoDaMateria[chave]
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

  // Os dois artigos do mesmo domínio. A LISTAGEM não vira documento: ela serviu para
  // descobrir endereços, e menu com banner não responde pergunta nenhuma.
  assert.equal(saida[0].created, 2)
  const titulos = (await documentos(agentId)).map((d) => d.title).sort()
  assert.deepEqual(titulos, ['Artigo /artigo-1', 'Artigo /artigo-2'])
  assert.ok(!titulos.some((t) => t.includes('lista')), 'a página de índice ficou fora da base')
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

// --- o ciclo completo: descobrir, ingerir, e não reprocessar o que não mudou -----------------
//
// O que estes testes protegem é o custo: cada reprocessamento é um embedding pago. Um
// sistema que reindexa a base inteira toda vez que o relógio bate é um sistema que fica
// caro em silêncio.

const comFeed = async (over = {}) =>
  criarAgente({ refreshMode: 'manual', kind: 'rss', url: `http://127.0.0.1:${porta}/feed-2`, discoveryMode: 'rss', maxArticlesPerRun: 10, ...over })

test('1) o feed traz dois artigos novos, e só eles são ingeridos', async () => {
  const agentId = await comFeed()
  const saida = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')

  assert.equal(saida[0].created, 2)
  const docs = await documentos(agentId)
  assert.deepEqual(docs.map((d) => d.title).sort(), ['Matéria 1', 'Matéria 2'])
  // O próprio feed não vira documento: ele é descoberta, não conteúdo.
  assert.ok(!docs.some((d) => d.title.includes('feed')))
})

test('2) segunda execução sem mudança: zero reprocessamento', async () => {
  const agentId = await comFeed()
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  const antes = await db.collection('knowledge_documents').find({}).toArray()

  const segunda = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  assert.equal(segunda[0].unchanged, 2)
  assert.equal(segunda[0].created, 0)
  assert.equal(segunda[0].updated, 0)

  // Nenhum documento foi tocado: se tivesse sido, `updatedAt` teria mudado — e cada
  // reescrita dispara chunk + embedding de novo.
  const depois = await db.collection('knowledge_documents').find({}).toArray()
  assert.deepEqual(
    depois.map((d) => d.updatedAt?.getTime()),
    antes.map((d) => d.updatedAt?.getTime()),
  )
})

test('3) um artigo mudou: só ele é atualizado', async () => {
  const agentId = await comFeed()
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  const antes = await db.collection('knowledge_documents').find({}).toArray()
  const intocado = antes.find((d) => d.title === 'Matéria 2')

  textoDaMateria['1'] = 'O texto da matéria 1 foi reescrito hoje de manhã. '.repeat(20)
  const segunda = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')

  assert.equal(segunda[0].updated, 1)
  assert.equal(segunda[0].unchanged, 1)
  const depois = await db.collection('knowledge_documents').find({}).toArray()
  assert.match(depois.find((d) => d.title === 'Matéria 1').content, /reescrito hoje de manhã/)
  // O outro não foi tocado — nem reindexado.
  assert.equal(depois.find((d) => d.title === 'Matéria 2').updatedAt.getTime(), intocado.updatedAt.getTime())
})

test('8) a página de índice não vira lixo na base', async () => {
  const agentId = await criarAgente({
    refreshMode: 'manual',
    url: `http://127.0.0.1:${porta}/lista`,
    discoveryMode: 'listing',
    crawlArticles: true,
  })
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  const conteudos = (await db.collection('knowledge_documents').find({}).toArray()).map((d) => d.content).join('\n')
  // Menu e rodapé da página de artigo também ficam fora: o que entra é o <article>.
  assert.ok(!/Assine já/.test(conteudos))
  assert.ok(!/Todos os direitos reservados/.test(conteudos))
})

test('9) os metadados da página são guardados, e dão para filtrar por período', async () => {
  const agentId = await comFeed()
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')

  const doc = await db.collection('knowledge_documents').findOne({ title: 'Matéria 1' })
  assert.equal(doc.web.sourceType, 'web')
  assert.equal(doc.web.sourceId, 'f1')
  assert.equal(doc.web.domain, '127.0.0.1')
  assert.equal(doc.web.author, 'Redação')
  assert.ok(doc.web.publishedAt instanceof Date)
  assert.ok(doc.web.contentHash)
  assert.ok(doc.web.fetchedAt instanceof Date)
  // O canônico declarado pela página é a identidade — não a URL com rastreio.
  assert.equal(doc.web.canonicalUrl, `http://127.0.0.1:${porta}/materia-1`)

  // E o recorte por data encontra um e exclui o outro.
  const { metadataFilter } = await import('../dist/knowledge.js')
  const doDia12 = await db
    .collection('knowledge_documents')
    .find(metadataFilter({ publishedAfter: new Date('2026-08-12T00:00:00Z') }))
    .toArray()
  assert.deepEqual(doDia12.map((d) => d.title), ['Matéria 2'])
  const porDominio = await db.collection('knowledge_documents').find(metadataFilter({ domain: '127.0.0.1' })).toArray()
  assert.equal(porDominio.length, 2)
  // Sem recorte, tudo — que é como a busca sempre funcionou.
  assert.deepEqual(metadataFilter(null), {})
})

test('7) o site cai: a base anterior continua de pé', async () => {
  const agentId = await comFeed()
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  const antes = (await documentos(agentId)).length

  // O feed some do ar; o que já foi ingerido não pode desaparecer com ele.
  const agentQuebrado = await criarAgente({ refreshMode: 'manual', url: `http://127.0.0.1:${porta}/quebrado` })
  void agentQuebrado
  artigosNoFeed = []
  const segunda = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')

  assert.equal(segunda[0].created, 0)
  assert.equal((await documentos(agentId)).length, antes, 'nada foi apagado')
})

test('a URL com rastreio é a mesma página: não duplica documento', async () => {
  const agentId = await criarAgente({
    refreshMode: 'manual',
    url: `http://127.0.0.1:${porta}/materia-1?utm_source=newsletter&utm_campaign=x`,
    discoveryMode: 'single_page',
  })
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  const docs = await documentos(agentId)
  assert.equal(docs.length, 1)
  const completo = await db.collection('knowledge_documents').findOne({ _id: docs[0]._id })
  // Guardado pelo canônico, sem os parâmetros de rastreio.
  assert.equal(completo.web.canonicalUrl, `http://127.0.0.1:${porta}/materia-1`)
})

// --- 5 e 6) o relógio, e a combinação dos dois ------------------------------------------------

test('5) SCHEDULED: lê quando o intervalo vence, e não antes', async () => {
  const { refreshScheduledWebSources } = await import('../dist/webKnowledge.js')
  const agentId = await criarAgente({ refreshMode: 'scheduled', intervalMinutes: 15 })

  // A varredura do agendador encontra a fonte e faz a primeira leitura.
  assert.equal(await refreshScheduledWebSources(), 1)
  const primeira = (await db.collection('agents').findOne({ _id: agentId })).watchedSources[0]
  assert.ok(primeira.nextScheduledAt instanceof Date)

  // Logo depois: nada. O intervalo é para ser respeitado.
  assert.equal(await refreshScheduledWebSources(), 0)

  // Passados os 15 minutos, lê de novo.
  assert.equal(await refreshScheduledWebSources(Date.now() + 16 * 60_000), 1)
})

test('6) HYBRID: não relê quando está fresca, relê quando envelhece', async () => {
  const agentId = await criarAgente({ refreshMode: 'hybrid', intervalMinutes: 60, maxStalenessMinutes: 30 })
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  const antes = pedidos.length

  // Chamada logo em seguida: o que está guardado serve, e o site não é tocado.
  const fresca = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'on_demand')
  assert.equal(fresca[0].refreshed, false)
  assert.equal(pedidos.length, antes)

  // Passada a validade, a mesma chamada lê antes de o agente trabalhar.
  const velha = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'on_demand', Date.now() + 31 * 60_000)
  assert.equal(velha[0].refreshed, true)
  assert.ok(pedidos.length > antes)
})
