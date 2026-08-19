// O QUE ler num endereço — por regra, nunca por modelo.
//
// Descobrir quais páginas seguir é análise de texto: `<loc>` de um sitemap, `<a href>` de
// uma listagem, o link de cada item de um feed. Determinístico e de graça — e por isso
// testável com um punhado de HTML.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { titleFromPage, urlsFromFeed, urlsFromListing, urlsFromSitemap } = await import('../dist/webDiscovery.js')

test('o sitemap é lido literalmente, sem repetição', () => {
  const xml = `<urlset><url><loc>https://x.test/a</loc></url><url><loc>https://x.test/b</loc></url><url><loc>https://x.test/a</loc></url></urlset>`
  assert.deepEqual(urlsFromSitemap(xml), ['https://x.test/a', 'https://x.test/b'])
  assert.equal(urlsFromSitemap(xml, 1).length, 1, 'o teto é respeitado')
})

test('a listagem devolve links absolutos, do mesmo domínio, sem a própria página', () => {
  const html = `
    <a href="/noticias/1">um</a>
    <a href="https://x.test/noticias/2">dois</a>
    <a href="https://outro.test/3">de fora</a>
    <a href="mailto:alguem@x.test">e-mail</a>
    <a href="/noticias/1#comentarios">a mesma, rolada</a>
    <a href="https://x.test/blog">a própria</a>`
  const urls = urlsFromListing(html, 'https://x.test/blog')
  assert.deepEqual(urls, ['https://x.test/noticias/1', 'https://x.test/noticias/2'])
})

test('sair do domínio é escolha explícita', () => {
  const html = '<a href="https://outro.test/3">de fora</a>'
  assert.deepEqual(urlsFromListing(html, 'https://x.test/blog'), [])
  assert.deepEqual(urlsFromListing(html, 'https://x.test/blog', { sameDomainOnly: false }), ['https://outro.test/3'])
})

test('o feed devolve os links dos itens, na ordem do feed', () => {
  const xml = `<rss><channel>
    <item><title>Um</title><link>https://x.test/1</link></item>
    <item><title>Dois</title><link>https://x.test/2</link></item>
  </channel></rss>`
  assert.deepEqual(urlsFromFeed(xml), ['https://x.test/1', 'https://x.test/2'])
})

test('o título vem da página; sem ele, ao menos o caminho', () => {
  assert.equal(titleFromPage('<html><head><title>  Relatório   anual </title>', 'https://x.test/a', 'Fonte'), 'Relatório anual')
  // Um documento chamado "https://…?utm_source=…" não ajuda ninguém a reconhecer a fonte.
  assert.equal(titleFromPage('<html>sem título', 'https://x.test/relatorios/2026-anual', 'Fonte'), 'Fonte · 2026-anual')
  assert.equal(titleFromPage('<html>sem título', 'https://x.test/', 'Fonte'), 'Fonte')
})

test('lixo não vira endereço', () => {
  assert.deepEqual(urlsFromListing('<a href="javascript:void(0)">x</a>', 'https://x.test/'), [])
  assert.deepEqual(urlsFromListing('<a href="">x</a>', 'não é uma url'), [])
  assert.deepEqual(urlsFromSitemap('isto não é xml'), [])
})
