// De uma página bruta para conhecimento: a identidade, o conteúdo e a data.
//
// Três coisas que precisam estar certas antes de qualquer embedding, e nenhuma delas
// precisa de modelo:
//
//   1. QUAL endereço é este. `?utm_source=…`, `#secao` e a barra no fim descrevem a mesma
//      página; tratá-los como três endereços diferentes triplica a base, triplica o custo
//      de embedding e faz a mesma notícia aparecer três vezes na resposta.
//   2. O QUE nela é conteúdo. Menu, rodapé, banner e "leia também" mudam a cada visita e
//      não respondem pergunta nenhuma. Guardá-los é pagar embedding por navegação.
//   3. QUANDO ela é. Uma base de notícias sem data não deixa perguntar "e na semana
//      passada?" — e a data está declarada na própria página, em metadados padronizados.
//
// Tudo aqui é texto entrando e texto saindo: determinístico, testável, e de graça.
import { contentHashOf } from './automations/sourceChange.js'

/** Parâmetros que descrevem de ONDE se veio, não O QUE se vê. */
const RASTREIO = /^(utm_[a-z_]+|gclid|fbclid|mc_[a-z]+|ref|ref_src|igshid|si|spm|_ga)$/i

/**
 * O endereço canônico: o mesmo conteúdo, sempre escrito do mesmo jeito.
 *
 * O `<link rel="canonical">` da página manda, quando existe — é o próprio site dizendo
 * qual é o endereço de verdade. Sem ele, a limpeza: sem fragmento, sem parâmetro de
 * rastreio, sem barra final, host em minúsculas.
 */
export function canonicalizeUrl(url: string, canonicalDeclarada?: string | null): string {
  const bruta = (canonicalDeclarada ?? '').trim() || url
  let u: URL
  try {
    u = new URL(bruta, url)
  } catch {
    return url
  }
  u.hash = ''
  u.hostname = u.hostname.toLowerCase()
  for (const chave of [...u.searchParams.keys()]) if (RASTREIO.test(chave)) u.searchParams.delete(chave)
  // A ordem dos parâmetros que sobraram não muda a página; fixá-la torna a chave estável.
  u.searchParams.sort()
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '')
  return u.toString()
}

export const domainOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const tag = (html: string, nome: string): string | null => {
  const m = html.match(new RegExp(`<${nome}\\b[^>]*>([\\s\\S]*?)<\\/${nome}>`, 'i'))
  return m ? m[1] : null
}

/** O conteúdo de uma `<meta>`, procurando por `property` ou `name`. */
export function metaContent(html: string, chave: string): string | null {
  const escapada = chave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const padroes = [
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${escapada}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${escapada}["']`, 'i'),
  ]
  for (const p of padroes) {
    const m = html.match(p)
    if (m?.[1]) return m[1].trim()
  }
  return null
}

/** O `<link rel="canonical">`, quando o site declara um. */
export function canonicalFromHtml(html: string): string | null {
  const m = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i)
  return m?.[1]?.trim() ?? null
}

/** O endereço do feed que a própria página anuncia. É a descoberta mais barata que existe. */
export function feedFromHtml(html: string, base: string): string | null {
  const m = html.match(
    /<link[^>]+type\s*=\s*["']application\/(?:rss|atom)\+xml["'][^>]*href\s*=\s*["']([^"']+)["']/i,
  ) ?? html.match(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']application\/(?:rss|atom)\+xml["']/i)
  if (!m?.[1]) return null
  try {
    return new URL(m[1], base).toString()
  } catch {
    return null
  }
}

const iso = (valor: string | null | undefined): Date | null => {
  if (!valor) return null
  const d = new Date(valor)
  return Number.isNaN(d.getTime()) ? null : d
}

export interface WebPageMeta {
  title: string | null
  author: string | null
  publishedAt: Date | null
  modifiedAt: Date | null
  canonicalUrl: string
  domain: string
}

/**
 * O que a página declara sobre si.
 *
 * Vem de metadados padronizados — OpenGraph, `article:*`, `<time datetime>` — que existem
 * justamente para serem lidos por máquina. Nada é adivinhado: sem a declaração, o campo
 * fica vazio, e uma data inventada seria pior que data nenhuma numa busca por período.
 */
export function extractPageMeta(html: string, url: string): WebPageMeta {
  const canonicalUrl = canonicalizeUrl(url, canonicalFromHtml(html))
  const titulo =
    metaContent(html, 'og:title') ??
    (tag(html, 'title') ?? '').replace(/\s+/g, ' ').trim() ??
    null
  const publicado =
    iso(metaContent(html, 'article:published_time')) ??
    iso(metaContent(html, 'og:published_time')) ??
    iso(metaContent(html, 'datePublished')) ??
    iso(html.match(/<time[^>]+datetime\s*=\s*["']([^"']+)["']/i)?.[1])
  return {
    title: titulo ? titulo.slice(0, 200) : null,
    author: (metaContent(html, 'article:author') ?? metaContent(html, 'author'))?.slice(0, 120) ?? null,
    publishedAt: publicado,
    modifiedAt: iso(metaContent(html, 'article:modified_time')) ?? iso(metaContent(html, 'og:updated_time')),
    canonicalUrl,
    domain: domainOf(canonicalUrl),
  }
}

// Pedaços que mudam a cada visita e não respondem a pergunta nenhuma.
const RUIDO = /<(script|style|nav|header|footer|aside|form|noscript|svg|iframe)\b[\s\S]*?<\/\1>/gi

/**
 * O texto que vale guardar.
 *
 * Quando a página marca o conteúdo — `<article>`, `<main>`, `role="main"` —, é ele que
 * entra, e só ele: menu, rodapé e banner ficam de fora. Sem marcação, o corpo inteiro
 * limpo, que é o melhor palpite honesto.
 */
export function extractReadableText(html: string, max = 20_000): string {
  const semRuido = html.replace(RUIDO, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  const principal =
    tag(semRuido, 'article') ??
    tag(semRuido, 'main') ??
    semRuido.match(/<[a-z]+[^>]+role\s*=\s*["']main["'][^>]*>([\s\S]*?)<\/[a-z]+>/i)?.[1] ??
    tag(semRuido, 'body') ??
    semRuido
  return principal
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
    .slice(0, max)
}

/**
 * Isto é uma página de CONTEÚDO ou um índice para descobrir outras?
 *
 * A distinção decide o que vira conhecimento. Um índice tem muito link e pouco texto por
 * link — é navegação. Uma página de conteúdo tem o contrário. A conta é grosseira de
 * propósito: ela só precisa separar "isto responde alguma coisa" de "isto lista coisas".
 */
export function looksLikeContent(html: string, texto: string): boolean {
  const links = (html.match(/<a\b/gi) ?? []).length
  if (texto.length < 400) return false
  if (links === 0) return true
  // Menos de 40 caracteres de texto por link é uma lista de manchetes, não um artigo.
  return texto.length / links >= 40
}

export interface WebDocumentFacts extends WebPageMeta {
  url: string
  text: string
  contentHash: string
  fetchedAt: Date
}

/** Tudo o que se sabe de uma página lida, num objeto só. O hash é do TEXTO limpo. */
export function pageFacts(html: string, url: string, agora: Date = new Date()): WebDocumentFacts {
  const meta = extractPageMeta(html, url)
  const text = extractReadableText(html)
  return { ...meta, url, text, contentHash: contentHashOf(text), fetchedAt: agora }
}
