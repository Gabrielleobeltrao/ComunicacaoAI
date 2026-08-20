// Ler uma página do jeito que ela precisa ser lida.
//
// HTTP 200 não quer dizer leitura válida: pode ser aviso de cookie, tela de login,
// desafio anti-robô ou uma casca vazia que só o JavaScript preenche. Guardar qualquer uma
// dessas coisas como conhecimento é pior que não guardar nada — o agente passa a
// responder com aviso de cookie.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { readWebPage } = await import('../dist/adaptiveWebReader.js')
const { checkContentQuality, classifyPage } = await import('../dist/contentQuality.js')

const pagina = (html, over = {}) => ({ html, contentType: 'text/html', finalUrl: 'https://x.test/p', status: 200, ...over })
const servindo = (html, over = {}) => async () => pagina(html, over)

const ARTIGO = `<html><head><title>O relatório de agosto</title>
  <meta property="article:published_time" content="2026-08-10T09:00:00Z"/>
  <link rel="canonical" href="https://x.test/relatorio"/></head>
  <body><nav>Home Sobre Contato</nav>
  <article>${'O relatório de agosto descreve o resultado do período com detalhes. '.repeat(8)}</article>
  <footer>Direitos reservados</footer></body></html>`

// --- 1) o simples continua simples -------------------------------------------------------

test('1) HTML com conteúdo é lido por HTTP, e o navegador não é acionado', async () => {
  let abriuNavegador = false
  const r = await readWebPage('https://x.test/p', {
    fetchPage: servindo(ARTIGO),
    renderer: async () => ((abriuNavegador = true), pagina(ARTIGO)),
  })
  assert.equal(r.ok, true)
  assert.equal(r.readMethod, 'http')
  assert.equal(abriuNavegador, false, 'abrir navegador aqui seria gastar por nada')
  assert.equal(r.kind, 'article')
})

test('4) do artigo sai texto limpo: menu e rodapé ficam fora', async () => {
  const r = await readWebPage('https://x.test/p', { fetchPage: servindo(ARTIGO) })
  assert.match(r.text, /relatório de agosto descreve/)
  assert.ok(!/Home Sobre Contato/.test(r.text))
  assert.ok(!/Direitos reservados/.test(r.text))
  assert.equal(r.metadata.title, 'O relatório de agosto')
  assert.equal(r.metadata.canonicalUrl, 'https://x.test/relatorio')
  assert.equal(r.metadata.publishedAt.toISOString(), '2026-08-10T09:00:00.000Z')
})

// --- 2, 3 e 5) quando o HTTP não basta -----------------------------------------------------

const CASCA = '<html><body><div id="root"></div><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></body></html>'
const RENDERIZADA = `<html><head><title>Cotações de hoje</title></head><body><main>${'A tabela de hoje já está carregada e visível na página. '.repeat(8)}</main></body></html>`

test('2 e 5) página montada por JavaScript cai para o navegador, e o DOM renderizado é lido', async () => {
  const r = await readWebPage('https://x.test/p', {
    fetchPage: servindo(CASCA),
    renderer: async () => pagina(RENDERIZADA),
  })
  assert.equal(r.ok, true)
  assert.equal(r.readMethod, 'browser')
  assert.match(r.fallbackReason ?? '', /JS_REQUIRED/)
  assert.match(r.text, /tabela de hoje já está carregada/)
})

test('3) HTTP 200 sem conteúdo útil também tenta o navegador', async () => {
  let tentou = false
  const r = await readWebPage('https://x.test/p', {
    fetchPage: servindo('<html><body><p>oi</p></body></html>'),
    renderer: async () => ((tentou = true), pagina(RENDERIZADA)),
  })
  assert.equal(tentou, true, '200 não quer dizer leitura válida')
  assert.equal(r.ok, true)
  assert.equal(r.readMethod, 'browser')
})

test('o modo escolhido pelo dono manda', async () => {
  let tentou = false
  const soHttp = await readWebPage('https://x.test/p', {
    mode: 'http',
    fetchPage: servindo(CASCA),
    renderer: async () => ((tentou = true), pagina(RENDERIZADA)),
  })
  assert.equal(tentou, false, 'em modo HTTP, navegador nenhum é aberto')
  assert.equal(soHttp.ok, false)
  assert.equal(soHttp.code, 'JS_REQUIRED')

  let buscouHttp = false
  const soNavegador = await readWebPage('https://x.test/p', {
    mode: 'browser',
    fetchPage: async () => ((buscouHttp = true), pagina(ARTIGO)),
    renderer: async () => pagina(RENDERIZADA),
  })
  assert.equal(buscouHttp, false, 'em modo navegador, o HTTP é pulado')
  assert.equal(soNavegador.readMethod, 'browser')
})

// --- 6) o que não é texto corrido -----------------------------------------------------------

test('6) tabelas, JSON-LD e pares viram dados estruturados com a hora da captura', async () => {
  const html = `<html><head><title>Painel</title>
    <script type="application/ld+json">{"@type":"Dataset","name":"Leituras"}</script></head>
    <body><main>
      <table><caption>Leituras</caption>
        <tr><th>Dia</th><th>Valor</th></tr>
        <tr><td>01</td><td>118</td></tr>
        <tr><td>02</td><td>121</td></tr>
      </table>
      <dl><dt>Unidade</dt><dd>7</dd><dt>Responsável</dt><dd>Equipe A</dd></dl>
      ${'Texto de apoio explicando a tabela acima com algum detalhe. '.repeat(6)}
    </main></body></html>`
  const r = await readWebPage('https://x.test/p', { fetchPage: servindo(html) })

  assert.equal(r.ok, true)
  assert.equal(r.structuredData.tables[0].headers.join(','), 'Dia,Valor')
  assert.deepEqual(r.structuredData.tables[0].rows[0], ['01', '118'])
  assert.equal(r.structuredData.tables[0].caption, 'Leituras')
  assert.equal(r.structuredData.jsonLd[0].name, 'Leituras')
  assert.equal(r.structuredData.pairs['Unidade'], '7')
  // A hora em que aquilo valia: para um número que muda, é metade da informação.
  assert.ok(!Number.isNaN(new Date(r.structuredData.capturedAt).getTime()))
})

// --- 9) o erro tem NOME -----------------------------------------------------------------------

test('9) login, robô e bloqueio produzem erros distintos — e não tentam navegador', async () => {
  const login = await readWebPage('https://x.test/p', {
    fetchPage: servindo('<html><body><h1>Assine para continuar</h1><p>Please log in to continue</p></body></html>'),
    renderer: async () => pagina(RENDERIZADA),
  })
  assert.equal(login.code, 'LOGIN_REQUIRED')
  assert.equal(login.readMethod, 'http', 'contornar login não é função deste sistema')

  const robo = await readWebPage('https://x.test/p', {
    fetchPage: servindo('<html><body>Just a moment... checking your browser</body></html>'),
    renderer: async () => pagina(RENDERIZADA),
  })
  assert.equal(robo.code, 'CAPTCHA')

  const bloqueado = await readWebPage('https://x.test/p', {
    fetchPage: servindo('<html><body>Access denied</body></html>', { status: 403 }),
  })
  assert.equal(bloqueado.code, 'HTTP_BLOCKED')
  assert.match(bloqueado.reason, /403/)
})

test('sem navegador nesta instalação, o motivo é dito — não é uma leitura vazia', async () => {
  const r = await readWebPage('https://x.test/p', { fetchPage: servindo(CASCA), renderer: null })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'JS_REQUIRED')
  assert.match(r.reason, /JavaScript/)
  // E o HTML do HTTP sobrevive: é ele que a descoberta usa para achar links.
  assert.ok(r.html.length > 0)
})

// --- 8) o que dá errado não derruba nada -------------------------------------------------------

test('8) timeout do navegador vira erro nomeado, e não exceção', async () => {
  const r = await readWebPage('https://x.test/p', {
    fetchPage: servindo(CASCA),
    renderer: async () => {
      throw new Error('Timeout 20000ms exceeded')
    },
  })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'BROWSER_TIMEOUT')
})

test('o site fora do ar não vira exceção', async () => {
  const r = await readWebPage('https://x.test/p', {
    fetchPage: async () => {
      throw new Error('fetch failed')
    },
  })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'HTTP_BLOCKED')
})

// --- o feed não é uma página --------------------------------------------------------------------

test('um feed não está "vazio" nem precisa de navegador', async () => {
  let tentou = false
  const r = await readWebPage('https://x.test/feed', {
    fetchPage: async () => pagina('<?xml version="1.0"?><rss><channel><item><title>Um</title><link>https://x.test/1</link></item></channel></rss>', { contentType: 'application/xml' }),
    renderer: async () => ((tentou = true), pagina(RENDERIZADA)),
  })
  assert.equal(r.ok, true)
  assert.equal(tentou, false, 'aplicar regra de página a um XML é erro de categoria')
  assert.equal(r.kind, 'structured_data')
})

// --- a classificação ------------------------------------------------------------------------------

test('a classificação escolhe estratégia, e não restringe', () => {
  assert.equal(classifyPage('<article>x</article>', 'a'.repeat(300)), 'article')
  assert.equal(classifyPage(`<body>${'<a href="/x">manchete</a>'.repeat(30)}</body>`, 'curto'), 'listing')
  assert.equal(classifyPage('<div id="root"></div><script></script><script></script><script></script>', ''), 'dynamic_page')
  assert.equal(classifyPage('<body>x</body>', 'a'.repeat(100), { tables: 2 }), 'structured_data')
})

test('o veredito de qualidade diz quantos caracteres úteis existem', () => {
  const bom = checkContentQuality('<article>x</article>', 'a'.repeat(300))
  assert.equal(bom.ok, true)
  assert.equal(bom.usefulChars, 300)
  const vazio = checkContentQuality('<html><body></body></html>', '')
  assert.equal(vazio.code, 'CONTENT_EMPTY')
  assert.equal(vazio.retryWithBrowser, true)
})
