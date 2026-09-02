// O PARSER de feed — pequeno, fechado, e sem parser de XML genérico.
//
// Trazer uma biblioteca de XML para ler cinco tags significaria carregar entidades
// externas e DTD junto — e é exatamente aí que mora o XXE. O que este arquivo lê é texto
// entre etiquetas, e estes casos afirmam isso.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFeed, pareceFeed } from '../dist/monitoring/feed.js'

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><guid>a1</guid><title>Primeiro</title><link>https://ex.test/1</link>
<description><![CDATA[<p>corpo &amp; cia</p>]]></description><pubDate>Mon, 02 Sep 2026 10:00:00 GMT</pubDate></item>
<item><guid>a2</guid><title>Segundo</title><link>https://ex.test/2</link></item>
</channel></rss>`

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>urn:1</id><title>Título</title><link href="https://ex.test/x" rel="alternate"/>
<summary>resumo</summary><updated>2026-09-02T10:00:00Z</updated><author>Fulano</author></entry>
</feed>`

test('lê RSS 2.0', () => {
  const itens = parseFeed(RSS)
  assert.equal(itens.length, 2)
  assert.equal(itens[0].id, 'a1')
  assert.equal(itens[0].title, 'Primeiro')
  assert.equal(itens[0].link, 'https://ex.test/1')
  assert.equal(itens[0].summary, 'corpo & cia', 'CDATA e entidade resolvidos, etiquetas fora')
  assert.equal(itens[0].publishedAt, '2026-09-02T10:00:00.000Z')
})

test('lê Atom pelo MESMO caminho, com o link no atributo', () => {
  const [item] = parseFeed(ATOM)
  assert.equal(item.id, 'urn:1')
  assert.equal(item.link, 'https://ex.test/x', 'no Atom o endereço está no href, não no corpo')
  assert.equal(item.author, 'Fulano')
  assert.equal(item.publishedAt, '2026-09-02T10:00:00.000Z')
})

test('data ilegível vira null, e não uma data inventada', () => {
  const [item] = parseFeed('<rss><item><title>x</title><pubDate>quinta que vem</pubDate></item></rss>')
  assert.equal(item.publishedAt, null)
})

test('AMEAÇA: entidade externa (XXE) não é resolvida — não há resolvedor', () => {
  const xxe = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<rss><item><title>&xxe;</title></item></rss>`
  const [item] = parseFeed(xxe)
  // A entidade fica como texto: não existe DTD, não existe SYSTEM, não existe leitura.
  assert.ok(!String(item.title).includes('root:'), 'nada de arquivo do sistema')
  assert.equal(item.title, '&xxe;')
})

test('AMEAÇA: `&amp;lt;` não vira `<` — a ordem da decodificação importa', () => {
  const [item] = parseFeed('<rss><item><title>a &amp;lt;script&amp;gt; b</title></item></rss>')
  assert.equal(item.title, 'a &lt;script&gt; b', 'desfazer `&amp;` antes reconstruiria a etiqueta')
})

test('feed gigante tem teto', () => {
  const itens = Array.from({ length: 500 }, (_, i) => `<item><guid>${i}</guid><title>t</title></item>`).join('')
  assert.equal(parseFeed(`<rss>${itens}</rss>`).length, 200)
})

test('campo gigante é cortado', () => {
  const [item] = parseFeed(`<rss><item><title>${'x'.repeat(9000)}</title></item></rss>`)
  assert.equal(item.title.length, 4000)
})

test('o que não é feed devolve lista vazia, e não lança', () => {
  assert.deepEqual(parseFeed('{"json":true}'), [])
  assert.deepEqual(parseFeed(''), [])
})

test('reconhece feed pelo tipo e pelo corpo', () => {
  assert.equal(pareceFeed('application/rss+xml', ''), true)
  assert.equal(pareceFeed('text/html', '<?xml?><feed xmlns="...">'), true)
  assert.equal(pareceFeed('text/html', '<html><body>'), false)
})
