// Ler uma página do jeito que ela precisa ser lida.
//
// HTTP 200 não quer dizer leitura válida: pode ser aviso de cookie, tela de login,
// desafio anti-robô ou uma casca vazia que só o JavaScript preenche. Guardar qualquer uma
// dessas coisas como conhecimento é pior que não guardar nada — o agente passa a
// responder com aviso de cookie.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
// Um teste precisa de um servidor de verdade para ver o que CHEGA nele. O mesmo escape
// dos outros testes de rede: só loopback, e a produção recusa subir com ele ligado.
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { readWebPage, resetRateLimits } = await import('../dist/adaptiveWebReader.js')
const { checkContentQuality, classifyPage } = await import('../dist/contentQuality.js')

const pagina = (html, over = {}) => ({ html, contentType: 'text/html', finalUrl: 'https://x.test/p', status: 200, ...over })
// Cada teste começa sem memória do que outro site pediu.
resetRateLimits()
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
  // O motivo mais acionável dos dois. "O conteúdo é montado por JavaScript" descreve a
  // página; quem configurou não tem o que fazer com isso. Saber que ESTE servidor não
  // tem navegador diz onde está a decisão — e que ela não é dele.
  assert.equal(r.code, 'BROWSER_UNAVAILABLE')
  assert.match(r.reason, /não tem navegador configurado/)
  assert.match(r.fallbackReason, /JS_REQUIRED/)
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

// --- o site pedindo calma ---------------------------------------------------------------------
//
// 429 não é "não pode", é "volte depois". A diferença importa: bloqueio é configuração
// para revisar, ritmo é espera para respeitar — e insistir contra um pedido de calma é
// como um limite temporário vira um bloqueio permanente.

test('8b) 429: erro próprio, com os segundos que o site pediu', async () => {
  resetRateLimits()
  const r = await readWebPage('https://ritmo.test/p', {
    fetchPage: async () => pagina('<html><body>Too many requests</body></html>', { status: 429, retryAfterSeconds: 45 }),
    renderer: async () => pagina(RENDERIZADA),
  })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'RATE_LIMITED')
  assert.equal(r.retryAfterSeconds, 45)
  assert.equal(r.readMethod, 'http', 'abrir um navegador contra um limite de ritmo é insistir de outro jeito')
})

test('8c) depois do 429, o mesmo domínio nem é procurado — sem loop', async () => {
  resetRateLimits()
  let requisicoes = 0
  const buscar = async () => {
    requisicoes += 1
    return pagina('<html><body>Too many requests</body></html>', { status: 429, retryAfterSeconds: 60 })
  }
  await readWebPage('https://ritmo2.test/a', { fetchPage: buscar })
  assert.equal(requisicoes, 1)

  // As outras páginas da mesma rodada, no mesmo site: nenhuma requisição nova.
  for (const caminho of ['/b', '/c', '/d']) {
    const r = await readWebPage(`https://ritmo2.test${caminho}`, { fetchPage: buscar })
    assert.equal(r.code, 'RATE_LIMITED')
    assert.equal(r.strategies[0].strategy, 'cooldown')
    // A frase precisa dizer que NÃO houve pedido: quem lê "o site respondeu 503" de novo
    // conclui que o site continua fora, quando ninguém perguntou nada a ele.
    assert.match(r.reason, /aguardando \d+s antes de tentar de novo/)
  }
  assert.equal(requisicoes, 1, 'o site já disse quanto esperar; obedecer é mais barato que descobrir a alternativa')

  // Outro domínio não paga pelo pedido de calma deste.
  const outro = await readWebPage('https://outro.test/p', { fetchPage: servindo(ARTIGO) })
  assert.equal(outro.ok, true)
})

test('503 também é ritmo, e não recusa', async () => {
  resetRateLimits()
  const r = await readWebPage('https://indisponivel.test/p', {
    fetchPage: async () => pagina('<html><body>Service Unavailable</body></html>', { status: 503 }),
  })
  assert.equal(r.code, 'RATE_LIMITED')
})

// --- o resultado normalizado ----------------------------------------------------------------------

test('toda leitura devolve os mesmos campos, venha de onde vier', async () => {
  resetRateLimits()
  const html = `<html><head><title>Guia</title><link rel="canonical" href="https://x.test/guia"/></head>
    <body><main>${'Este guia explica o procedimento com detalhes suficientes. '.repeat(8)}
    <a href="/passo-1">Passo 1</a><a href="https://outro.test/x">Externo</a></main></body></html>`
  const r = await readWebPage('https://x.test/p', { fetchPage: servindo(html, { contentType: 'text/html; charset=utf-8' }) })

  assert.equal(r.contentType, 'text/html; charset=utf-8')
  assert.equal(r.metadata.status, 200)
  assert.equal(r.metadata.canonicalUrl, 'https://x.test/guia')
  assert.equal(r.readMethod, 'http')
  assert.ok(!Number.isNaN(new Date(r.capturedAt).getTime()), 'quando esta leitura aconteceu vale para TODO resultado')
  // Os links vêm absolutos: é deles que sai a descoberta de outras páginas.
  assert.deepEqual(r.links.map((l) => l.url), ['https://x.test/passo-1', 'https://outro.test/x'])
  assert.equal(r.links[0].text, 'Passo 1')
  // E o caminho tentado fica registrado.
  assert.deepEqual(r.strategies.map((t) => t.strategy), ['http'])
  assert.equal(r.strategies[0].ok, true)
})

test('num feed, os endereços saem do <link> — quem descobre não precisa saber a tag', async () => {
  resetRateLimits()
  const r = await readWebPage('https://x.test/feed', {
    fetchPage: async () =>
      pagina('<?xml version="1.0"?><rss><channel><item><link>https://x.test/1</link></item><item><link>https://x.test/2</link></item></channel></rss>', {
        contentType: 'application/rss+xml',
      }),
  })
  assert.deepEqual(r.links.map((l) => l.url), ['https://x.test/1', 'https://x.test/2'])
  assert.equal(r.contentType, 'application/rss+xml')
})

test('o tempo esgotado tem nome próprio: ninguém recusou nada', async () => {
  resetRateLimits()
  const r = await readWebPage('https://lento.test/p', {
    fetchPage: async () => {
      throw new Error('The operation was aborted due to timeout')
    },
  })
  assert.equal(r.code, 'TIMEOUT')
  assert.deepEqual(r.strategies.map((t) => t.strategy), ['http'])
})

// --- como o leitor se apresenta ------------------------------------------------------------
//
// Um pedido sem `User-Agent` é a assinatura mais comum de robô mal-feito, e muita borda
// de rede responde 503 ou 403 a ele sem olhar o resto — o que chegava aqui como "o site
// está fora do ar" com o site de pé.

test('o leitor se identifica, e com o nome verdadeiro', async () => {
  resetRateLimits()
  let recebidos = null
  const { safeFetch } = await import('../dist/net/safeHttp.js')
  assert.equal(typeof safeFetch, 'function')

  // O caminho real de rede: um servidor de verdade, para ver o que chega nele.
  const { createServer } = await import('node:http')
  const srv = createServer((req, res) => {
    recebidos = req.headers
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<html><head><title>Ok</title></head><body><article>${'Conteúdo suficiente para passar no veredito de qualidade. '.repeat(8)}</article></body></html>`)
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const porta = srv.address().port

  const r = await readWebPage(`http://127.0.0.1:${porta}/x`)
  await new Promise((r2) => srv.close(r2))

  assert.equal(r.ok, true)
  assert.ok(recebidos['user-agent'], 'sem User-Agent, muita borda de rede recusa antes de olhar o resto')
  // Verdadeiro: diz o que é. Fingir ser um navegador resolveria mais casos, e é
  // exatamente o que este sistema não faz.
  assert.match(recebidos['user-agent'], /ComunicacaoAI/)
  assert.ok(!/Mozilla|Chrome|Safari/.test(recebidos['user-agent']), 'não se passa por navegador')
  assert.match(recebidos['accept'], /text\/html/)
})

test('503 com barreira anti-robô não é falta de ritmo — e as ações são opostas', async () => {
  resetRateLimits()
  // Esperar resolve a falta de ritmo. Contra uma barreira, esperar não resolve nunca:
  // quem configurou precisa saber que aquele site não vem por este caminho.
  const r = await readWebPage('https://barreira.test/p', {
    fetchPage: async () => pagina('<html><body>Just a moment... checking your browser</body></html>', { status: 503, retryAfterSeconds: 30 }),
  })
  assert.equal(r.code, 'CAPTCHA')
  assert.match(r.reason, /503/)
})

test('503 de verdade continua sendo ritmo', async () => {
  resetRateLimits()
  const r = await readWebPage('https://manutencao.test/p', {
    fetchPage: async () => pagina('<html><body>Service Unavailable — manutenção programada</body></html>', { status: 503, retryAfterSeconds: 30 }),
  })
  assert.equal(r.code, 'RATE_LIMITED')
  assert.equal(r.retryAfterSeconds, 30)
})
