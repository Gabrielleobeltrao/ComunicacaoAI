// Pesquisar é o trabalho do RESEARCHER — e a origem do fato não muda isso.
//
// Um pesquisador coleta de onde puder: do que foi escrito à mão e do que os sites
// publicam. O teste que importa aqui não é "o leitor lê", é o ciclo inteiro: a página
// vira documento, o documento vira busca, e a busca devolve evidência com procedência —
// misturada com o conhecimento manual, porque para quem pergunta os dois são a mesma
// coisa: a resposta.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'
delete process.env.VOYAGE_API_KEY

const { ensureAgentWebKnowledgeFresh } = await import('../dist/webKnowledge.js')
const { resetRateLimits } = await import('../dist/adaptiveWebReader.js')
const { listDocumentsFor, createDocumentFor, retrieveContext } = await import('../dist/knowledge.js')
const { capabilitiesOf } = await import('../dist/agentCapabilities.js')
const { db, mongoClient } = await import('../dist/db.js')

const OWNER = 'dono-pesquisa'
let porta = 0
let servidor
let pedidosPorRota = {}
let corpoDoArtigo = 'A fábrica de Ipatinga bateu recorde de produção em agosto, segundo o relatório trimestral. '
let respostaDoRitmo = { status: 429, retryAfter: '30' }

before(async () => {
  servidor = createServer((req, res) => {
    pedidosPorRota[req.url] = (pedidosPorRota[req.url] ?? 0) + 1

    // 2) um artigo comum
    if (req.url === '/artigo') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<html><head><title>Recorde em agosto</title>
        <meta property="article:published_time" content="2026-08-12T10:00:00Z"/></head>
        <body><nav>Início Contato</nav><article>${corpoDoArtigo.repeat(6)}</article>
        <footer>Rodapé</footer></body></html>`)
      return
    }
    // 3) uma página que só existe depois do JavaScript
    if (req.url === '/app') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body><div id="root"></div><script src="/1.js"></script><script src="/2.js"></script><script src="/3.js"></script></body></html>')
      return
    }
    // 4) um painel: o dado está na TABELA, não na prosa
    if (req.url === '/painel') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html><head><title>Produção por unidade</title></head><body><main>
        <p>${'O painel consolida a produção do mês por unidade fabril. '.repeat(5)}</p>
        <table><caption>Produção de agosto</caption>
          <tr><th>Unidade</th><th>Toneladas</th></tr>
          <tr><td>Ipatinga</td><td>4820</td></tr>
          <tr><td>Cubatão</td><td>3915</td></tr>
        </table></main></body></html>`)
      return
    }
    // 5) uma listagem
    if (req.url === '/lista') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html><body><h1>Notícias</h1>
        <a href="/artigo">Recorde em agosto</a>
        <a href="/materia">Nova linha de produção</a></body></html>`)
      return
    }
    if (req.url === '/materia') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html><head><title>Nova linha</title></head><body><article>${'A nova linha de produção entra em operação no próximo trimestre, segundo a diretoria. '.repeat(8)}</article></body></html>`)
      return
    }
    // 5) um feed
    if (req.url === '/feed') {
      res.writeHead(200, { 'content-type': 'application/rss+xml' })
      res.end(`<rss><channel>
        <item><title>Recorde em agosto</title><link>http://127.0.0.1:${porta}/artigo</link></item>
        <item><title>Nova linha</title><link>http://127.0.0.1:${porta}/materia</link></item>
      </channel></rss>`)
      return
    }
    // 6) JSON-LD
    if (req.url === '/estruturado') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html><head><title>Ficha do produto</title>
        <script type="application/ld+json">{"@type":"Product","name":"Chapa grossa","sku":"CG-42"}</script></head>
        <body><main>${'A ficha técnica descreve o produto e suas especificações. '.repeat(5)}</main></body></html>`)
      return
    }
    // 7) 200 com nada dentro
    if (req.url === '/vazio') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body><p>ok</p></body></html>')
      return
    }
    // 8) o site pedindo calma
    if (req.url?.startsWith('/ritmo')) {
      res.writeHead(respostaDoRitmo.status, { 'content-type': 'text/html', ...(respostaDoRitmo.retryAfter ? { 'retry-after': respostaDoRitmo.retryAfter } : {}) })
      res.end('<html><body>Too many requests</body></html>')
      return
    }
    res.writeHead(404)
    res.end('nao')
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
  await db.collection('knowledge_chunks').deleteMany({})
  pedidosPorRota = {}
  resetRateLimits()
  corpoDoArtigo = 'A fábrica de Ipatinga bateu recorde de produção em agosto, segundo o relatório trimestral. '
  respostaDoRitmo = { status: 429, retryAfter: '30' }
})

const pesquisador = async (fonte) => {
  const _id = new ObjectId()
  await db.collection('agents').insertOne({
    _id,
    ownerId: OWNER,
    name: 'Pesquisador',
    preset: 'researcher',
    objective: 'coletar fatos',
    provider: 'anthropic',
    ...(fonte
      ? {
          watchedSources: [
            { id: 'f1', name: 'Site da empresa', kind: 'http', url: `http://127.0.0.1:${porta}${fonte.path}`, when: 'manual', initialWindow: '7d', ...fonte },
          ],
        }
      : {}),
  })
  return _id
}

const ler = (agentId, motivo = 'manual') => ensureAgentWebKnowledgeFresh(OWNER, agentId, motivo)
const docs = (agentId) => listDocumentsFor({ ownerType: 'agent', ownerId: agentId })

// --- 1) o conhecimento escrito à mão continua sendo conhecimento ------------------------------

test('1) conhecimento manual: escrito à mão, encontrado pela busca', async () => {
  const agentId = await pesquisador(null)
  await createDocumentFor(
    { ownerType: 'agent', ownerId: agentId },
    { title: 'Política de trocas', content: 'A troca pode ser feita em até 30 dias corridos após a compra.' },
  )

  const lista = await docs(agentId)
  assert.equal(lista.length, 1)
  assert.equal(lista[0].web, undefined, 'o que foi escrito à mão não é documento de web')

  const r = await retrieveContext([agentId], 'política de trocas')
  assert.equal(r.status, 'ok')
  assert.match(r.context.join(' '), /30 dias/)
})

// --- 2 a 6) cada tipo de página, pelo mesmo caminho ---------------------------------------------

test('2) artigo: vira documento com título, data e texto limpo', async () => {
  const agentId = await pesquisador({ path: '/artigo' })
  const [r] = await ler(agentId)
  assert.equal(r.created, 1)

  const [doc] = await docs(agentId)
  assert.equal(doc.web.title, 'Recorde em agosto')
  assert.equal(doc.web.readMethod, 'http')
  assert.equal(doc.web.publishedAt.toISOString().slice(0, 10), '2026-08-12')
  const salvo = await db.collection('knowledge_documents').findOne({ _id: doc._id })
  assert.match(salvo.content, /recorde de produção em agosto/)
  assert.ok(!/Início Contato/.test(salvo.content), 'menu não é conhecimento')
})

test('3) página montada por JavaScript: sem navegador, o motivo é dito — e nada é gravado', async () => {
  const agentId = await pesquisador({ path: '/app' })
  const [r] = await ler(agentId)

  assert.equal(r.created, 0)
  const leitura = (r.reads ?? []).find((l) => l.url.endsWith('/app'))
  assert.equal(leitura.code, 'JS_REQUIRED')
  // O caminho tentado fica registrado: HTTP tentou, o navegador não existe aqui.
  assert.ok(leitura.strategies.some((t) => t.strategy === 'http'))
  assert.ok(leitura.strategies.some((t) => t.strategy === 'browser' && t.code === 'JS_REQUIRED'))
  assert.equal((await docs(agentId)).length, 0, 'casca vazia não vira conhecimento')
})

test('4) tabela: o número fica com o nome da coluna, e a busca acha', async () => {
  const agentId = await pesquisador({ path: '/painel' })
  const [r] = await ler(agentId)
  assert.equal(r.created, 1)

  const [doc] = await docs(agentId)
  assert.equal(doc.web.structured.tables[0].caption, 'Produção de agosto')
  assert.ok(doc.web.structured.capturedAt instanceof Date, 'para um número que muda, quando ele valia é metade da informação')

  // O que decide se o RAG acha: cabeçalho JUNTO do valor.
  const busca = await retrieveContext([agentId], 'produção por unidade')
  assert.equal(busca.status, 'ok')
  assert.match(busca.context.join(' '), /Ipatinga \| Toneladas: 4820/)
})

test('5) listagem e feed: os artigos entram, o índice não', async () => {
  const lista = await pesquisador({ path: '/lista', discoveryMode: 'auto', crawlArticles: true })
  const [r1] = await ler(lista)
  const titulos1 = (await docs(lista)).map((d) => d.title)
  assert.ok(titulos1.some((t) => /Recorde em agosto/.test(t)), `veio: ${titulos1.join(' | ')}`)
  assert.ok(r1.discovered >= 2)

  const feed = await pesquisador({ path: '/feed', kind: 'rss' })
  await ler(feed)
  const titulos2 = (await docs(feed)).map((d) => d.title)
  assert.ok(titulos2.some((t) => /Nova linha/.test(t)), `veio: ${titulos2.join(' | ')}`)
  // O feed em si não vira documento: ele serviu para descobrir, e uma lista de manchetes
  // não responde pergunta nenhuma.
  assert.ok(!titulos2.some((t) => /^Site da empresa$/.test(t)))
})

test('6) JSON-LD: os dados públicos da página são guardados como dados', async () => {
  const agentId = await pesquisador({ path: '/estruturado' })
  await ler(agentId)
  const [doc] = await docs(agentId)
  assert.equal(doc.web.structured.jsonLd[0].sku, 'CG-42')
  assert.equal(doc.web.structured.jsonLd[0].name, 'Chapa grossa')
})

// --- 7 e 8) o que dá errado, com nome ------------------------------------------------------------

test('7) HTTP 200 sem conteúdo útil não vira conhecimento — e tenta o próximo caminho', async () => {
  const agentId = await pesquisador({ path: '/vazio' })
  const [r] = await ler(agentId)
  assert.equal(r.created, 0)
  const leitura = (r.reads ?? []).find((l) => l.url.endsWith('/vazio'))
  // Tentou o navegador: 200 não quer dizer leitura válida, e conteúdo pode chegar depois.
  assert.ok(leitura.strategies.some((t) => t.strategy === 'browser'))
  assert.equal((await docs(agentId)).length, 0)
})

test('8) 429: espera o que o site pediu, não insiste, e a base anterior fica de pé', async () => {
  const agentId = await pesquisador({ path: '/ritmo', discoveryMode: 'single_page' })
  // Uma base que já existia antes da recusa.
  await createDocumentFor({ ownerType: 'agent', ownerId: agentId }, { title: 'Nota anterior', content: 'O conteúdo que já estava guardado antes da recusa.' })

  const [primeira] = await ler(agentId)
  const l1 = (primeira.reads ?? [])[0]
  assert.equal(l1.code, 'RATE_LIMITED', 'ritmo não é bloqueio: é temporário, e tem hora para passar')
  assert.equal(l1.retryAfterSeconds, 30, 'o número certo de segundos está na resposta, não num chute nosso')

  const antes = pedidosPorRota['/ritmo'] ?? 0
  const [segunda] = await ler(agentId)
  assert.equal(pedidosPorRota['/ritmo'] ?? 0, antes, 'insistir contra um pedido de calma é como um limite vira bloqueio')
  assert.equal((segunda.reads ?? [])[0].strategies[0].strategy, 'cooldown')

  // E o que já estava guardado continua lá: uma leitura que não aconteceu não apaga nada.
  const lista = await docs(agentId)
  assert.equal(lista.length, 1)
  assert.equal(lista[0].title, 'Nota anterior')
})

// --- 9 e 10) o ciclo: muda, atualiza; não muda, não duplica ---------------------------------------

test('9 e 10) conteúdo novo atualiza o MESMO documento; conteúdo igual não faz nada', async () => {
  const agentId = await pesquisador({ path: '/artigo' })
  const [a] = await ler(agentId)
  assert.equal(a.created, 1)
  const [doc1] = await docs(agentId)

  const [b] = await ler(agentId)
  assert.equal(b.created, 0)
  assert.equal(b.updated, 0)
  assert.equal(b.unchanged, 1, 'o hash do texto é quem decide se vale reindexar')

  corpoDoArtigo = 'A fábrica de Ipatinga revisou o número para 5100 toneladas na correção do relatório. '
  const [c] = await ler(agentId)
  assert.equal(c.updated, 1)
  assert.equal(c.created, 0)

  const lista = await docs(agentId)
  assert.equal(lista.length, 1, 'o mesmo endereço é o mesmo documento — não uma segunda cópia')
  assert.equal(lista[0]._id.toString(), doc1._id.toString())
})

// --- 11) manual e web são a mesma resposta ---------------------------------------------------------

test('11) o pesquisador cruza o que foi escrito à mão com o que leu do site', async () => {
  const agentId = await pesquisador({ path: '/painel' })
  await createDocumentFor(
    { ownerType: 'agent', ownerId: agentId },
    { title: 'Meta interna de produção', content: 'A meta de produção de Ipatinga para agosto era de 4500 toneladas.' },
  )
  await ler(agentId)

  const lista = await docs(agentId)
  assert.equal(lista.length, 2)
  assert.equal(lista.filter((d) => d.web).length, 1)
  assert.equal(lista.filter((d) => !d.web).length, 1)

  // A busca não separa origem: para quem pergunta, as duas são a resposta.
  // Uma pergunta que cruza os dois: a meta que alguém escreveu e a produção que o site
  // publicou. Para quem pergunta, a origem não importa — a resposta é uma só.
  const r = await retrieveContext([agentId], 'meta produção unidade Ipatinga')
  assert.equal(r.status, 'ok')
  const texto = r.context.join(' ')
  assert.match(texto, /4500/, 'o que foi escrito à mão')
  assert.match(texto, /4820/, 'o que veio do site')
})

// --- 12) e nada disso vaza para quem não coleta -------------------------------------------------------

test('12) analista e coordenador continuam sem site e sem base', async () => {
  for (const preset of ['analyst', 'manager', 'secretary']) {
    const _id = new ObjectId()
    await db.collection('agents').insertOne({
      _id,
      ownerId: OWNER,
      name: preset,
      preset,
      objective: 'x',
      provider: 'anthropic',
      // A fonte CONTINUA gravada — ignorar não é apagar.
      watchedSources: [{ id: 'f1', name: 'Site', kind: 'http', url: `http://127.0.0.1:${porta}/artigo`, when: 'manual' }],
    })
    assert.equal(capabilitiesOf({ preset }).webSources, false, preset)
    assert.equal(capabilitiesOf({ preset }).knowledge, false, preset)

    const doc = await db.collection('agents').findOne({ _id })
    assert.equal(doc.watchedSources.length, 1, `${preset}: o que estava gravado continua gravado`)
  }
})

test('a evidência diz de onde veio: escrita à mão ou lida do site', async () => {
  // Para quem PERGUNTA os dois são a mesma coisa — a resposta. Para quem confere, não:
  // um número lido de um site tem hora de captura e endereço para voltar; um texto
  // escrito à mão tem um autor. Sem a marca, a resposta que mistura os dois não audita.
  const agentId = await pesquisador({ path: '/painel' })
  await createDocumentFor(
    { ownerType: 'agent', ownerId: agentId },
    { title: 'Meta interna de produção', content: 'A meta de produção de Ipatinga para agosto era de 4500 toneladas.' },
  )
  await ler(agentId)

  const r = await retrieveContext([agentId], 'meta produção unidade Ipatinga')
  const origens = r.sources.map((f) => f.origin).sort()
  assert.deepEqual(origens, ['manual', 'web'])
})
