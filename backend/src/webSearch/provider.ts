// Procurar páginas NOVAS na internet — e a distinção que o resto do sistema depende.
//
// "Web Sources" são os endereços que o dono cadastrou: o sistema sabe onde procurar.
// "Web Search" é descobrir endereços que ninguém cadastrou. São capacidades diferentes,
// com custos diferentes e riscos diferentes, e confundi-las é como um agente que deveria
// ler três sites conhecidos acaba lendo a internet.
//
// Este módulo é só a PORTA. Nenhum fornecedor é assumido: quem opera aponta a
// configuração para o serviço que quiser, e o pesquisador não sabe qual é. Sem
// configuração não há busca — e "não há busca" é dito com todas as letras, em vez de
// virar uma lista vazia que parece "não achei nada".
import { safeFetch } from '../net/safeHttp.js'

/** Um resultado de busca: o suficiente para DECIDIR se vale abrir, e nada além. */
export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface SearchOptions {
  maxResults: number
  timeoutMs: number
}

export interface WebSearchProvider {
  readonly name: string
  search(query: string, opts: SearchOptions): Promise<SearchResult[]>
}

/**
 * Um provedor genérico falado por configuração.
 *
 * A resposta de cada serviço de busca tem um formato diferente, e acoplar o código a um
 * deles seria escolher fornecedor por dentro. Em vez disso, o caminho até a lista e os
 * nomes dos três campos vêm do ambiente: o mesmo adaptador serve qualquer API que
 * devolva JSON com título, endereço e trecho.
 *
 * A chave vai no cabeçalho que o serviço pedir, e nunca aparece em log, em erro ou no
 * painel — nem o nome dela.
 */
function providerHttp(): WebSearchProvider | null {
  const url = process.env.WEB_SEARCH_URL?.trim()
  if (!url) return null

  const caminho = (process.env.WEB_SEARCH_RESULTS_PATH ?? 'results').trim()
  const campoTitulo = (process.env.WEB_SEARCH_TITLE_FIELD ?? 'title').trim()
  const campoUrl = (process.env.WEB_SEARCH_URL_FIELD ?? 'url').trim()
  const campoTrecho = (process.env.WEB_SEARCH_SNIPPET_FIELD ?? 'snippet').trim()
  const nomeDoCabecalho = (process.env.WEB_SEARCH_API_KEY_HEADER ?? 'Authorization').trim()
  const chave = process.env.WEB_SEARCH_API_KEY?.trim()
  const prefixo = process.env.WEB_SEARCH_API_KEY_PREFIX ?? (nomeDoCabecalho.toLowerCase() === 'authorization' ? 'Bearer ' : '')

  /** Desce por um caminho tipo `data.web.results`. Ausente em qualquer nível = lista vazia. */
  const descer = (raiz: unknown, cam: string): unknown[] => {
    let atual: unknown = raiz
    for (const parte of cam.split('.').filter(Boolean)) {
      if (!atual || typeof atual !== 'object') return []
      atual = (atual as Record<string, unknown>)[parte]
    }
    return Array.isArray(atual) ? atual : []
  }

  return {
    name: (process.env.WEB_SEARCH_PROVIDER_NAME ?? 'http').trim() || 'http',
    async search(query, opts) {
      const alvo = url.includes('{query}')
        ? url.replace('{query}', encodeURIComponent(query))
        : `${url}${url.includes('?') ? '&' : '?'}q=${encodeURIComponent(query)}`

      const res = await safeFetch(alvo, {
        timeoutMs: opts.timeoutMs,
        maxBytes: 1_000_000,
        headers: chave ? { [nomeDoCabecalho]: `${prefixo}${chave}` } : undefined,
      })
      if (res.status < 200 || res.status > 299) {
        // O corpo pode repetir a chave numa mensagem de erro. Sai o código, nunca o corpo.
        throw new Error(`o serviço de busca respondeu ${res.status}`)
      }
      const corpo = JSON.parse(res.body) as unknown
      return descer(corpo, caminho)
        .slice(0, opts.maxResults)
        .map((linha) => {
          const l = (linha ?? {}) as Record<string, unknown>
          return {
            title: String(l[campoTitulo] ?? '').slice(0, 300),
            url: String(l[campoUrl] ?? '').trim(),
            snippet: String(l[campoTrecho] ?? '').replace(/\s+/g, ' ').slice(0, 600),
          }
        })
        .filter((r) => /^https?:\/\//i.test(r.url))
    },
  }
}

/**
 * O provedor configurado, ou nulo.
 *
 * Nulo é uma resposta legítima e comum: a maioria das instalações não tem serviço de
 * busca. O pesquisador trata isso como "não há como procurar", que é diferente de
 * "procurei e não achei" — e a diferença aparece no painel.
 */
export function activeSearchProvider(): WebSearchProvider | null {
  return providerHttp()
}
