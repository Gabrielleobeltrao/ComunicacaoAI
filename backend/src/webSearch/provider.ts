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
import { reserveSearchRequest } from './budget.js'

/**
 * O erro de quem foi barrado pela franquia — antes de a chamada sair.
 *
 * Tem tipo próprio porque a ação é diferente de qualquer outra falha: não é o serviço que
 * está fora, ninguém foi cobrado, e tentar de novo agora dá no mesmo. É uma decisão de
 * configuração — ou uma espera até o mês virar.
 */
export class SearchBudgetError extends Error {
  code = 'monthly_limit_reached' as const
  constructor(reason: string) {
    super(reason)
    this.name = 'SearchBudgetError'
  }
}

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
  /**
   * A credencial do adaptador genérico é a DELE.
   *
   * `BRAVE_SEARCH_API_KEY` nunca é lida aqui, nem como reserva: mandar a chave do Brave
   * para um endereço configurável por variável de ambiente seria entregá-la a qualquer
   * host que alguém escrevesse ali.
   */
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
      // O mesmo teto do Brave, pelo mesmo motivo: quem configurou um serviço genérico
      // também tem uma conta lá. E a partir da reserva a requisição está gasta.
      const reserva = await reserveSearchRequest('http')
      if (!reserva.ok) throw new SearchBudgetError(reserva.reason!)

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
 * O Brave Search.
 *
 * Endereço fixo e credencial vinda EXCLUSIVAMENTE de `BRAVE_SEARCH_API_KEY`, no cabeçalho
 * que o serviço define. A chave não é gravada em lugar nenhum, não volta para a tela, não
 * entra em log e não aparece em mensagem de erro — nem em pedaço. O corpo de uma resposta
 * de erro também não sai daqui: ele costuma repetir o que foi enviado.
 */
const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search'

/**
 * O endereço usado de fato.
 *
 * Em produção é sempre o oficial: a variável de desvio é IGNORADA lá, para que uma
 * configuração errada (ou mal-intencionada) não consiga mandar a credencial para outro
 * host. Fora de produção ela existe para o teste conferir o que sai daqui sem falar com
 * o serviço real.
 */
const braveUrl = (): string =>
  process.env.NODE_ENV === 'production' ? BRAVE_URL : (process.env.BRAVE_SEARCH_BASE_URL_FOR_TEST?.trim() || BRAVE_URL)

interface BraveResposta {
  web?: { results?: { title?: string; url?: string; description?: string }[] }
}

function providerBrave(): WebSearchProvider | null {
  const chave = process.env.BRAVE_SEARCH_API_KEY?.trim()
  if (!chave) return null
  return {
    name: 'brave',
    async search(query, opts) {
      // A franquia é contada ANTES da chamada. Uma tentativa que sai conta mesmo se
      // falhar: do lado do Brave ela foi uma requisição, e um contador que diverge para
      // menos é o que produz a fatura surpresa.
      const reserva = await reserveSearchRequest('brave')
      if (!reserva.ok) throw new SearchBudgetError(reserva.reason!)

      /**
       * A partir daqui a requisição está GASTA, aconteça o que acontecer.
       *
       * Havia uma devolução da reserva quando `safeFetch` lançava, na ideia de que a
       * chamada não teria saído. Isso é falso na maioria dos casos: tempo esgotado,
       * conexão cortada, redirecionamento recusado e erro ao ler o corpo acontecem
       * DEPOIS de o pedido chegar ao Brave — e ele já contou.
       *
       * Devolver aí fazia nosso número ficar abaixo do dele, que é o lado perigoso:
       * "ainda tenho saldo" quando não tem mais é exatamente como se ultrapassa a
       * franquia. Contar a mais custa uma busca; contar a menos custa uma fatura.
       */
      const alvo = `${braveUrl()}?q=${encodeURIComponent(query)}&count=${Math.min(Math.max(opts.maxResults, 1), 20)}`
      const res = await safeFetch(alvo, {
        timeoutMs: opts.timeoutMs,
        maxBytes: 1_000_000,
        headers: { 'X-Subscription-Token': chave, Accept: 'application/json' },
      }).catch((erro) => {
        // Sem `releaseSearchRequest`: ver acima. A mensagem não repete o que foi enviado.
        throw new Error(`não foi possível falar com o serviço de busca: ${erro instanceof Error ? erro.message.slice(0, 120) : 'falha'}`)
      })

      if (res.status < 200 || res.status > 299) {
        // Sai o código, nunca o corpo: ele pode repetir o cabeçalho enviado.
        throw new Error(`o serviço de busca respondeu ${res.status}`)
      }
      const corpo = JSON.parse(res.body) as BraveResposta
      return (corpo.web?.results ?? [])
        .slice(0, opts.maxResults)
        .map((r) => ({
          title: String(r.title ?? '').slice(0, 300),
          url: String(r.url ?? '').trim(),
          snippet: String(r.description ?? '').replace(/\s+/g, ' ').slice(0, 600),
        }))
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
/**
 * Qual provedor está em jogo — pela configuração que EXISTE, não por um padrão fixo.
 *
 * O padrão era `brave`, e isso quebraria uma instalação que já apontava o adaptador
 * genérico: sem chave do Brave ela passaria de "buscando" para "não configurado" só por
 * subir uma versão nova, sem ninguém ter mexido em nada.
 *
 * A ordem resolve: escolha explícita manda; sem ela, o que estiver configurado decide; e
 * sem nada configurado o resultado é "nenhum" — dito com todas as letras, nunca
 * disfarçado de "não achei nada".
 */
export function resolveProviderName(): 'brave' | 'http' | 'none' {
  const explicito = process.env.WEB_SEARCH_PROVIDER?.trim().toLowerCase()
  if (explicito === 'brave' || explicito === 'http') return explicito
  if (explicito) {
    console.warn(`[busca] WEB_SEARCH_PROVIDER="${explicito}" não é um provedor conhecido; nenhuma busca será feita`)
    return 'none'
  }
  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) return 'brave'
  if (process.env.WEB_SEARCH_URL?.trim()) return 'http'
  return 'none'
}

export function activeSearchProvider(): WebSearchProvider | null {
  const escolhido = resolveProviderName()
  if (escolhido === 'http') return providerHttp()
  if (escolhido === 'brave') return providerBrave()
  return null
}

/** O nome do provedor em jogo, mesmo sem ele estar utilizável. Para o painel e as métricas. */
export const configuredProviderName = (): string => resolveProviderName()
