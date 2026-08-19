// A identidade, o conteúdo e a data de uma página — sem rede e sem modelo.
//
// As três coisas que precisam estar certas antes de qualquer embedding: qual endereço é
// este (senão a mesma página vira três documentos), o que nela é conteúdo (senão paga-se
// embedding por menu) e quando ela é (senão não dá para perguntar por período).
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { canonicalizeUrl, extractPageMeta, extractReadableText, feedFromHtml, looksLikeContent, metaContent, pageFacts } =
  await import('../dist/webContent.js')

// --- identidade ---------------------------------------------------------------------------

test('rastreio, fragmento e barra final descrevem a MESMA página', () => {
  assert.equal(canonicalizeUrl('https://X.test/artigo/?utm_source=news&utm_campaign=b#topo'), 'https://x.test/artigo')
  assert.equal(canonicalizeUrl('https://x.test/artigo?fbclid=abc'), 'https://x.test/artigo')
  // O que NÃO é rastreio fica: `?id=7` é outra página.
  assert.equal(canonicalizeUrl('https://x.test/artigo?id=7'), 'https://x.test/artigo?id=7')
  // A ordem dos parâmetros não muda a página; fixá-la torna a chave estável.
  assert.equal(canonicalizeUrl('https://x.test/a?b=2&a=1'), canonicalizeUrl('https://x.test/a?a=1&b=2'))
})

test('o canônico declarado pela página manda', () => {
  // É o próprio site dizendo qual é o endereço de verdade.
  assert.equal(canonicalizeUrl('https://x.test/amp/artigo-123', 'https://x.test/artigo-123'), 'https://x.test/artigo-123')
  assert.equal(canonicalizeUrl('https://x.test/a', '/b'), 'https://x.test/b', 'relativo é resolvido')
})

test('endereço malformado não quebra nada', () => {
  assert.equal(canonicalizeUrl('não é uma url'), 'não é uma url')
})

// --- o que é conteúdo -----------------------------------------------------------------------

test('menu, rodapé e script ficam de fora; o artigo entra', () => {
  const html = `<html><body>
    <nav>Home Sobre Contato</nav>
    <script>rastrear()</script>
    <article><p>O primeiro parágrafo.</p><p>O segundo parágrafo.</p></article>
    <footer>Direitos reservados</footer>
  </body></html>`
  const texto = extractReadableText(html)
  assert.match(texto, /O primeiro parágrafo/)
  assert.match(texto, /O segundo parágrafo/)
  assert.ok(!/Home Sobre Contato/.test(texto))
  assert.ok(!/Direitos reservados/.test(texto))
  assert.ok(!/rastrear/.test(texto))
})

test('sem marcação de artigo, o corpo limpo é o melhor palpite honesto', () => {
  assert.match(extractReadableText('<html><body><p>Só isto aqui.</p></body></html>'), /Só isto aqui/)
})

test('índice e artigo são coisas diferentes', () => {
  const indice = `<body>${'<a href="/x">Manchete curta</a>'.repeat(30)}</body>`
  const artigo = `<body><a href="/fonte">fonte</a><p>${'Texto de verdade, com parágrafos inteiros. '.repeat(30)}</p></body>`
  assert.equal(looksLikeContent(indice, extractReadableText(indice)), false)
  assert.equal(looksLikeContent(artigo, extractReadableText(artigo)), true)
  // Página quase vazia não é conteúdo.
  assert.equal(looksLikeContent('<body>oi</body>', 'oi'), false)
})

// --- quando ela é ----------------------------------------------------------------------------

test('a data vem declarada pela página, e não é adivinhada', () => {
  const html = `<html><head>
    <meta property="og:title" content="A manchete"/>
    <meta property="article:published_time" content="2026-08-12T09:00:00Z"/>
    <meta property="article:modified_time" content="2026-08-13T10:00:00Z"/>
    <meta name="author" content="Fulana"/>
  </head><body><article>texto</article></body></html>`
  const meta = extractPageMeta(html, 'https://x.test/a')
  assert.equal(meta.title, 'A manchete')
  assert.equal(meta.author, 'Fulana')
  assert.equal(meta.publishedAt.toISOString(), '2026-08-12T09:00:00.000Z')
  assert.equal(meta.modifiedAt.toISOString(), '2026-08-13T10:00:00.000Z')
  assert.equal(meta.domain, 'x.test')
})

test('sem declaração, o campo fica vazio — data inventada é pior que data nenhuma', () => {
  const meta = extractPageMeta('<html><head><title>Sem metadados</title></head><body>x</body></html>', 'https://x.test/a')
  assert.equal(meta.publishedAt, null)
  assert.equal(meta.author, null)
  assert.equal(meta.title, 'Sem metadados')
})

test('o <time datetime> também conta', () => {
  const meta = extractPageMeta('<html><body><time datetime="2026-08-01">1º de agosto</time></body></html>', 'https://x.test/a')
  assert.equal(meta.publishedAt.toISOString().slice(0, 10), '2026-08-01')
})

test('o feed anunciado pela página é o caminho mais barato de descoberta', () => {
  const html = '<link rel="alternate" type="application/rss+xml" href="/feed.xml"/>'
  assert.equal(feedFromHtml(html, 'https://x.test/blog'), 'https://x.test/feed.xml')
  assert.equal(feedFromHtml('<html>nada</html>', 'https://x.test/'), null)
})

test('metaContent lê as duas ordens de atributo', () => {
  assert.equal(metaContent('<meta property="og:title" content="A"/>', 'og:title'), 'A')
  assert.equal(metaContent('<meta content="B" name="og:title"/>', 'og:title'), 'B')
})

// --- os fatos de uma página, num objeto só ------------------------------------------------------

test('o hash é do TEXTO, não do HTML', () => {
  // Trocar uma classe de CSS ou a ordem de um script não é mudança de conteúdo — e não
  // pode custar um embedding novo.
  const a = pageFacts('<html><body><article><p class="x">mesmo texto</p></article></body></html>', 'https://x.test/a')
  const b = pageFacts('<html><body><article><p class="y" data-id="9">mesmo texto</p></article></body></html>', 'https://x.test/a')
  assert.equal(a.contentHash, b.contentHash)
})
