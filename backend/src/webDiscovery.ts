// O QUE ler num endereço — decidido por regra, nunca por modelo.
//
// Um endereço vinculado a um agente pode ser três coisas: a própria página, um feed que
// lista outras, ou um índice cheio de links. Descobrir qual é, e quais endereços seguir,
// é análise de texto: extrair `<loc>` de um sitemap, `<a href>` de uma listagem, o link
// de cada item de um feed. Nada aqui pede opinião a uma LLM, e é por isso que o resultado
// é o mesmo toda vez — e de graça.
//
// O que existe fica onde está: o feed é interpretado por `parseRssItems`, a página vira
// texto por `normalizeHttpContent`, e a busca em si é sempre o `safeFetch`, que recusa
// endereço privado. Aqui só mora a escolha de quais URLs entram na próxima rodada.
import { parseRssItems } from './automations/sources.js'

/** Um `<loc>` de sitemap. O formato é padronizado, então a leitura é literal. */
export function urlsFromSitemap(xml: string, max = 50): string[] {
  const achados = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1])
  return [...new Set(achados)].slice(0, max)
}

/** Os links de uma página de índice, na ordem em que aparecem. */
export function urlsFromListing(html: string, base: string, opts: { sameDomainOnly?: boolean; max?: number } = {}): string[] {
  const max = opts.max ?? 20
  let origem: URL
  try {
    origem = new URL(base)
  } catch {
    return []
  }
  const saida: string[] = []
  const vistos = new Set<string>()
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    let absoluta: URL
    try {
      absoluta = new URL(m[1], origem)
    } catch {
      continue
    }
    // Só http(s): `mailto:`, `tel:` e `javascript:` não são páginas para ler.
    if (absoluta.protocol !== 'http:' && absoluta.protocol !== 'https:') continue
    if (opts.sameDomainOnly !== false && absoluta.host !== origem.host) continue
    // A âncora é a MESMA página com o navegador rolado: ler de novo é ler duas vezes.
    absoluta.hash = ''
    const chave = absoluta.toString()
    if (chave === origem.toString() || vistos.has(chave)) continue
    vistos.add(chave)
    saida.push(chave)
    if (saida.length >= max) break
  }
  return saida
}

/** Os endereços dos itens de um feed, do mais recente para trás. */
export function urlsFromFeed(xml: string, max = 20): string[] {
  const links = parseRssItems(xml)
    .map((item) => item.url)
    .filter((u): u is string => Boolean(u))
  return [...new Set(links)].slice(0, max)
}

/**
 * Um título legível para o documento que vai virar conhecimento.
 *
 * O `<title>` quando existe; senão o caminho da URL, que ao menos diz de onde veio. Um
 * documento chamado "https://…?utm_source=…" não ajuda ninguém a reconhecer a fonte — e o
 * título é o que a busca usa como evidência.
 */
export function titleFromPage(html: string, url: string, fallback: string): string {
  const t = html.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i)?.[1]
  const limpo = (t ?? '').replace(/\s+/g, ' ').trim()
  if (limpo) return limpo.slice(0, 120)
  try {
    const u = new URL(url)
    const caminho = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).at(-1)
    return caminho ? `${fallback} · ${decodeURIComponent(caminho).slice(0, 80)}` : fallback
  } catch {
    return fallback
  }
}
