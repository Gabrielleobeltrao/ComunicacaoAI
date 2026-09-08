#!/usr/bin/env node
// O HTML de cada página pública — escrito no build, sem navegador.
//
// O problema que ele resolve: prévia de link NÃO executa JavaScript. WhatsApp, LinkedIn,
// Slack e Discord leem o HTML cru, e o HTML cru deste app é uma `<div>` vazia com um
// `<title>` só para o site inteiro. Colada em qualquer lugar, a landing aparecia como URL
// pelada, e toda rota tinha o mesmo título.
//
// O plano previa pré-renderizar com o Playwright — subir o `dist`, abrir cada rota no
// Chromium e gravar o DOM. Não é o que está aqui, e a razão é a imagem de produção: o
// Dockerfile do frontend roda `npm ci` e `npm run build` num `node:22-slim` sem Chromium,
// então um build que dependesse do navegador quebraria o deploy — ou obrigaria a instalar
// um Chromium inteiro na imagem para escrever quatro linhas de `<meta>`.
//
// O que dá o ganho é a INJEÇÃO dos metadados, e ela é manipulação de texto. O conteúdo
// renderizado interessa a buscador que não executa JS; o Google executa. Se um dia a
// renderização completa fizer falta, ela sai desta mesma lista de rotas.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(raiz, 'dist')
const modelo = join(dist, 'index.html')

if (!existsSync(modelo)) {
  console.error('[páginas] dist/index.html não existe — rode `vite build` antes')
  process.exit(1)
}

const { site, paginas: fixas } = JSON.parse(readFileSync(join(raiz, 'src/lib/paginasPublicas.json'), 'utf8'))

/**
 * As páginas da DOCUMENTAÇÃO saem do índice dela, e não de uma segunda lista.
 *
 * Acrescentar uma página passa a ser uma entrada no índice e um arquivo `.md`. Se elas
 * fossem repetidas aqui, a primeira página nova entraria no menu e ficaria fora do
 * sitemap — encontrável por dentro e invisível por fora.
 */
const indiceDocs = JSON.parse(readFileSync(join(raiz, 'src/docs/indice.json'), 'utf8'))
const paginasDeDocs = indiceDocs.secoes.flatMap((secao) =>
  secao.paginas.map((p) => ({
    rota: `/docs/${p.slug}`,
    titulo: `${p.titulo} · Documentação ${site.nome}`,
    descricao: p.resumo,
    prioridade: '0.7',
  })),
)

const paginas = [...fixas, { rota: '/docs', titulo: `Documentação · ${site.nome}`, descricao: 'Como o sistema funciona, com exemplos e as partes técnicas por inteiro.', prioridade: '0.8' }, ...paginasDeDocs]
const html = readFileSync(modelo, 'utf8')

/** Aspas e sinais que quebrariam o atributo, e nada além disso. */
const escapar = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Os metadados de UMA página, no lugar do `<title>` do modelo.
 *
 * Descrição, Open Graph e Twitter juntos: são três leitores diferentes do mesmo fato, e
 * escrever só um deles é escolher em qual rede o link fica feio.
 */
function comMetadados(pagina) {
  const url = `${site.url}${pagina.rota === '/' ? '' : pagina.rota}`
  const bloco = [
    `<title>${escapar(pagina.titulo)}</title>`,
    `<meta name="description" content="${escapar(pagina.descricao)}" />`,
    `<link rel="canonical" href="${escapar(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapar(site.nome)}" />`,
    `<meta property="og:title" content="${escapar(pagina.titulo)}" />`,
    `<meta property="og:description" content="${escapar(pagina.descricao)}" />`,
    `<meta property="og:url" content="${escapar(url)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapar(pagina.titulo)}" />`,
    `<meta name="twitter:description" content="${escapar(pagina.descricao)}" />`,
  ].join('\n    ')
  const saida = html.replace(/<title>.*?<\/title>/s, bloco)
  if (saida === html) throw new Error('o modelo não tem <title> para substituir — os metadados ficariam de fora em silêncio')
  return saida
}

let escritas = 0
for (const pagina of paginas) {
  const destino = pagina.rota === '/' ? modelo : join(dist, pagina.rota.replace(/^\//, ''), 'index.html')
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, comMetadados(pagina))
  escritas++
}

// O sitemap sai da MESMA lista: duas listas divergem, e a divergência aparece como uma
// página que o buscador conhece e a pessoa não encontra.
const hoje = new Date().toISOString().slice(0, 10)
writeFileSync(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paginas
    .map((p) => `  <url>\n    <loc>${site.url}${p.rota === '/' ? '/' : p.rota}</loc>\n    <lastmod>${hoje}</lastmod>\n    <priority>${p.prioridade}</priority>\n  </url>`)
    .join('\n')}\n</urlset>\n`,
)

// E o robots aponta para ele. `Disallow` do que é do escritório: essas telas exigem
// sessão, e um buscador batendo nelas só produz resultado que leva a um login.
writeFileSync(
  join(dist, 'robots.txt'),
  ['User-agent: *', 'Allow: /', 'Disallow: /apps', 'Disallow: /databases', 'Disallow: /floors', 'Disallow: /settings', 'Disallow: /widget', '', `Sitemap: ${site.url}/sitemap.xml`, ''].join('\n'),
)

console.log(`[páginas] ${escritas} páginas com metadados próprios, sitemap.xml e robots.txt`)
