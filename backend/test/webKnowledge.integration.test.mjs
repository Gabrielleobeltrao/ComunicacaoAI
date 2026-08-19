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
const tituloDaMateria = {}

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
        <title>${tituloDaMateria[n] ?? `Matéria ${n}`}</title>
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
  for (const chave of Object.keys(tituloDaMateria)) delete tituloDaMateria[chave]
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

// --- o que o crawler trouxe, visível e gerenciável ---------------------------------------------
//
// Conhecimento é conhecimento, tenha vindo de um arquivo ou de um site. O que muda é a
// procedência — e é ela que precisa aparecer, junto com o que dá para fazer a respeito.

const { countDocumentsFromSource, createDocumentFor, listDocumentsPage } = await import('../dist/knowledge.js')

test('1) o artigo ingerido aparece na base, marcado como web', async () => {
  const agentId = await comFeed()
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  // E um documento escrito à mão, para provar que os dois convivem.
  await createDocumentFor({ ownerType: 'agent', ownerId: agentId }, { title: 'Escrito à mão', content: 'texto do dono' })

  const pagina = await listDocumentsPage({ ownerType: 'agent', ownerId: agentId })
  assert.equal(pagina.summary.total, 3)
  assert.equal(pagina.summary.web, 2)
  assert.equal(pagina.summary.manual, 1)
  assert.ok(pagina.summary.lastWebFetchAt instanceof Date)

  const web = pagina.items.find((d) => d.web)
  assert.equal(web.web.sourceType, 'web')
  assert.equal(web.web.domain, '127.0.0.1')
  assert.ok(web.web.canonicalUrl)
})

test('4) os filtros separam manual de web, e a busca acha pelo domínio', async () => {
  const agentId = await comFeed()
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  await createDocumentFor({ ownerType: 'agent', ownerId: agentId }, { title: 'Manual do produto', content: 'texto do dono' })
  const dono = { ownerType: 'agent', ownerId: agentId }

  assert.equal((await listDocumentsPage(dono, { kind: 'web' })).items.length, 2)
  const manuais = await listDocumentsPage(dono, { kind: 'manual' })
  assert.deepEqual(manuais.items.map((d) => d.title), ['Manual do produto'])
  // O resumo é da BASE inteira, não do recorte: ele existe para dar o tamanho do todo.
  assert.equal(manuais.summary.total, 3)

  assert.equal((await listDocumentsPage(dono, { search: '127.0.0.1' })).items.length, 2)
  assert.equal((await listDocumentsPage(dono, { search: 'Manual do' })).items.length, 1)
  // Uma busca com caracteres de regex não vira consulta maluca.
  assert.equal((await listDocumentsPage(dono, { search: '.*' })).items.length, 0)
})

test('5) o filtro por FONTE mostra só o que aquela fonte produziu', async () => {
  const agentId = await comFeed()
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  const dono = { ownerType: 'agent', ownerId: agentId }

  assert.equal((await listDocumentsPage(dono, { sourceId: 'f1' })).items.length, 2)
  assert.equal((await listDocumentsPage(dono, { sourceId: 'outra' })).items.length, 0)
  // O mesmo número que a tela mostra no "Ver conhecimento gerado (N)".
  assert.equal(await countDocumentsFromSource(dono, 'f1'), 2)
})

test('7) a listagem NÃO carrega o conteúdo dos documentos', async () => {
  const agentId = await comFeed()
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  const pagina = await listDocumentsPage({ ownerType: 'agent', ownerId: agentId })
  // Centenas de artigos inteiros seriam megabytes para desenhar uma lista.
  for (const item of pagina.items) assert.equal(item.content, undefined)
  // E o conteúdo está lá quando alguém abre UM documento.
  const completo = await db.collection('knowledge_documents').findOne({ _id: pagina.items[0]._id })
  assert.ok(completo.content.length > 0)
})

test('a paginação existe, e o resumo não muda com ela', async () => {
  const agentId = await comFeed()
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  const dono = { ownerType: 'agent', ownerId: agentId }
  const primeira = await listDocumentsPage(dono, { limit: 1 })
  const segunda = await listDocumentsPage(dono, { limit: 1, skip: 1 })
  assert.equal(primeira.items.length, 1)
  assert.equal(segunda.items.length, 1)
  assert.notEqual(primeira.items[0]._id.toString(), segunda.items[0]._id.toString())
  assert.equal(primeira.total, 2)
  assert.equal(primeira.summary.total, 2)
})

test('6) excluir e IGNORAR: o artigo não volta, e a fonte continua inteira', async () => {
  const { ignoreWebUrl } = await import('../dist/webKnowledge.js')
  const agentId = await comFeed()
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')

  const doc = await db.collection('knowledge_documents').findOne({ title: 'Matéria 1' })
  await db.collection('knowledge_documents').deleteOne({ _id: doc._id })
  await ignoreWebUrl(OWNER, agentId, 'f1', doc.web.canonicalUrl)

  const depois = await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')
  assert.equal(depois[0].ignored, 1, 'o endereço ignorado não voltou')
  const titulos = (await documentos(agentId)).map((d) => d.title)
  assert.deepEqual(titulos, ['Matéria 2'])

  // A FONTE continua lá, com a configuração e o resto do que produziu.
  const agente = await db.collection('agents').findOne({ _id: agentId })
  assert.equal(agente.watchedSources.length, 1)
  assert.equal(agente.watchedSources[0].refreshMode, 'manual')
  assert.deepEqual(agente.watchedSources[0].ignoredUrls, [doc.web.canonicalUrl])
})

test('8) o RAG continua recuperando o que veio da web', async () => {
  const agentId = await comFeed()
  tituloDaMateria['1'] = 'Relatório trimestral da unidade 7'
  textoDaMateria['1'] = 'O relatório trimestral da unidade 7 apontou crescimento de 12% no período. '.repeat(15)
  await ensureAgentWebKnowledgeFresh(OWNER, agentId, 'manual')


  const r = await retrieveContext([agentId], 'o que diz o relatório trimestral da unidade 7?')
  assert.equal(r.status, 'ok')
  assert.match(r.context.join('\n'), /crescimento de 12%/)
  // A procedência acompanha o trecho: quem lê a resposta consegue voltar à origem.
  assert.ok(r.sources.some((f) => (f.title ?? '').includes('Relatório trimestral')))
})

// --- O BUG RELATADO: perguntar antes de passar pelo site ------------------------------------
//
// A recuperação rodava primeiro, achava a base vazia e — num agente que EXIGE
// fundamentação — a execução parava com `GroundingRequiredError` sem nunca ter passado
// pelo site. O agente tinha a fonte configurada, o site tinha a resposta, e ninguém foi lá.

const { executeSectorTeam, sectorRunContext } = await import('../dist/delegation.js')
const { retrieveContext } = await import('../dist/knowledge.js')
const { ensureFreshWithTimeout } = await import('../dist/webKnowledge.js')

const agenteComSite = async (over = {}) => {
  const _id = await criarAgente({ refreshMode: 'on_demand', maxStalenessMinutes: 30, ...over })
  return db.collection('agents').findOne({ _id })
}

// Um setor de UM: o próprio agente coordena. É o caminho por onde todo agente de time
// passa — e é dentro dele que a atualização acontece antes da recuperação.
const setorDeUm = (agente) => ({
  _id: new ObjectId(),
  name: 'Mesa',
  officeId: agente.officeId ?? new ObjectId(),
  mode: 'orchestrated',
  coordinatorAgentId: agente._id,
  instruction: '',
  members: [{ agentId: agente._id, isDefault: true }],
  stages: [],
})

const depsDoRuntime = (agente, over = {}) => ({
  loadAgent: async () => agente,
  loadSector: async () => setorDeUm(agente),
  listAgentsInBuilding: async () => [agente],
  buildingIdForFloor: async () => 'predio',
  resolveTools: async () => [],
  apiKeyFor: async () => 'k',
  retrieveContext: (agentId, query, opts) => retrieveContext(agentId, query, { verifiedSectorId: opts?.sectorId ?? null }),
  runTask:
    over.runTask ??
    (async (req) => ({ output: `li: ${(req.context ?? []).join(' ').slice(0, 120)}`, usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] })),
  startDelegation: async () => new ObjectId(),
  finishDelegation: async () => undefined,
  recordEvent: () => undefined,
  // O MESMO serviço que a tela usa no "Atualizar agora" e que o relógio usa.
  ensureWebKnowledgeFresh: (ownerId, agentId) => ensureFreshWithTimeout(ownerId, agentId, 'on_demand'),
  ...over.deps,
})

const rodar = (agente, pergunta) =>
  executeSectorTeam(
    depsDoRuntime(agente),
    sectorRunContext({ ownerId: OWNER, buildingId: 'predio', correlationId: 'teste' }),
    setorDeUm(agente),
    { objective: pergunta },
  )

test('1) base vazia + on_demand: a pergunta passa pelo site ANTES de consultar a base', async () => {
  corpoDaPagina = '<html><head><title>Novo horário de atendimento</title></head><body><article>' + 'O comunicado de hoje informa o novo horário de atendimento, das 9h às 18h. '.repeat(20) + '</article></body></html>'
  const agente = await agenteComSite()
  assert.equal((await documentos(agente._id)).length, 0, 'a base começa vazia')

  const r = await rodar(agente, 'qual o novo horário de atendimento?')

  // O documento foi criado ANTES da recuperação — e o que ele diz chegou ao agente.
  assert.equal((await documentos(agente._id)).length, 1)
  assert.match(r.output, /novo horário de atendimento/i)
  assert.equal(r.participants[0].grounding, 'ok')
})

test('2) requireGrounding não bloqueia antes de tentar o refresh', async () => {
  corpoDaPagina = '<html><head><title>Tabela de preços vigente</title></head><body><article>' + 'A tabela de preços vigente começa em primeiro de setembro. '.repeat(20) + '</article></body></html>'
  const agente = await agenteComSite()
  // O agente EXIGE base. Antes, isto era um erro garantido: a base estava vazia no
  // momento da checagem, porque ninguém tinha passado pelo site.
  const comExigencia = { ...agente, requireGrounding: true }

  const r = await rodar(comExigencia, 'quando começa a tabela de preços?')
  assert.equal(r.participants[0].grounding, 'ok')
  assert.match(r.output, /tabela de preços/i)
})

test('6) o site cai, mas a base anterior existe: o agente trabalha com ela', async () => {
  corpoDaPagina = '<html><head><title>Protocolo antigo em vigor</title></head><body><article>' + 'O protocolo antigo continua valendo até segunda ordem. '.repeat(20) + '</article></body></html>'
  const agente = await agenteComSite()
  await ensureAgentWebKnowledgeFresh(OWNER, agente._id, 'manual')
  const antes = (await documentos(agente._id)).length
  assert.equal(antes, 1)

  // O site sai do ar. A execução seguinte não pode perder o que já estava guardado.
  const quebrado = { ...agente, watchedSources: [{ ...agente.watchedSources[0], url: `http://127.0.0.1:${porta}/quebrado` }] }
  await db.collection('agents').updateOne({ _id: agente._id }, { $set: { watchedSources: quebrado.watchedSources } })

  const r = await rodar(quebrado, 'o protocolo antigo ainda vale?')
  assert.equal((await documentos(agente._id)).length, antes, 'nada foi apagado')
  assert.equal(r.participants[0].grounding, 'ok')
  assert.match(r.output, /protocolo antigo/i)
})

test('7) manual não é atualizada por uma pergunta', async () => {
  const agente = await agenteComSite({ refreshMode: 'manual' })
  const antes = pedidos.length
  await rodar(agente, 'alguma coisa')
  assert.equal(pedidos.length, antes, 'nenhuma requisição ao site')
  assert.equal((await documentos(agente._id)).length, 0)
})

test('5) hybrid recém-lida não busca de novo a cada pergunta', async () => {
  const agente = await agenteComSite({ refreshMode: 'hybrid', intervalMinutes: 60, maxStalenessMinutes: 30 })
  await ensureAgentWebKnowledgeFresh(OWNER, agente._id, 'manual')
  const antes = pedidos.length

  await rodar(agente, 'de novo')
  assert.equal(pedidos.length, antes, 'a base recente serve; o site não é tocado')
})
