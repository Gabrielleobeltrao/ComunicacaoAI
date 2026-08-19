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
import { feedFromHtml } from './webContent.js'

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

// --- a ordem da descoberta em modo automático ------------------------------------------------
//
// Da mais barata para a mais cara, e não por acaso: um feed entrega os endereços novos em
// UMA requisição, com data; um sitemap entrega muitos em uma, sem data; uma listagem
// exige interpretar HTML; varrer o site é o último recurso e o único que multiplica
// requisições no servidor de outra pessoa.
//
// A escolha é feita com o que a própria página declara — `<link rel="alternate">` para o
// feed, o caminho padrão do sitemap — e nunca com heurística de domínio. Nada aqui sabe o
// nome de site nenhum.

export type DiscoveryPlan =
  | { via: 'rss'; url: string }
  | { via: 'sitemap'; url: string }
  | { via: 'listing'; url: string }
  | { via: 'single_page'; url: string }

export interface DiscoveryProbe {
  /** Busca uma URL e devolve o corpo, ou null quando não deu. Injetado: aqui não há rede. */
  fetch: (url: string) => Promise<{ body: string; contentType: string } | null>
}

/** Um corpo que é feed — a mesma checagem que a pré-visualização de fonte já usava. */
const ehFeed = (corpo: string, contentType: string): boolean =>
  /xml/i.test(contentType) && /<(rss|feed)\b/i.test(corpo)

/**
 * Por onde descobrir os endereços deste site, em modo automático.
 *
 * No máximo duas requisições a mais que o necessário: a própria página (que seria lida de
 * qualquer forma) e, quando ela não anuncia feed, uma tentativa no sitemap padrão.
 */
export async function planDiscovery(
  url: string,
  kind: 'rss' | 'http',
  probe: DiscoveryProbe,
  opts: { crawlArticles?: boolean } = {},
): Promise<DiscoveryPlan> {
  if (kind === 'rss') return { via: 'rss', url }
  if (/sitemap[^/]*\.xml(\?|$)/i.test(url)) return { via: 'sitemap', url }

  const pagina = await probe.fetch(url)
  if (!pagina) return { via: 'single_page', url }
  // O endereço cadastrado já É um feed, ainda que marcado como página.
  if (ehFeed(pagina.body, pagina.contentType)) return { via: 'rss', url }

  // 1) O feed que a própria página anuncia: uma requisição, e vem com data.
  const feed = feedFromHtml(pagina.body, url)
  if (feed) return { via: 'rss', url: feed }

  // 2) O sitemap no caminho padrão. Só é tentado quando não há feed.
  try {
    const raiz = new URL('/sitemap.xml', url).toString()
    const mapa = await probe.fetch(raiz)
    if (mapa && /<urlset|<sitemapindex/i.test(mapa.body)) return { via: 'sitemap', url: raiz }
  } catch {
    // Endereço malformado não vira tentativa.
  }

  // 3) A listagem — só quando o dono aceitou seguir links. Sem isso, a página é o conteúdo.
  return opts.crawlArticles ? { via: 'listing', url } : { via: 'single_page', url }
}
