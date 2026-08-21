// Quando o pesquisador pode procurar páginas novas — e com que teto.
//
// Puro: configuração entra, decisão sai. Sem rede, sem banco, sem modelo.
//
// A pergunta que este módulo responde é de CUSTO. Cada busca é uma requisição a um
// serviço externo, e cada página escolhida é uma leitura completa. O padrão é não
// procurar: um agente que já funciona com os sites cadastrados não deve passar a varrer
// a internet porque uma versão nova ficou disponível.

/** Quando procurar. O nome descreve a intenção, não o mecanismo. */
export type WebSearchPolicy = 'automatic' | 'fallback_only' | 'always'
export const WEB_SEARCH_POLICIES: WebSearchPolicy[] = ['automatic', 'fallback_only', 'always']

export interface WebSearchSettings {
  enabled: boolean
  policy: WebSearchPolicy
  /** Quantos resultados pedir. São só título, endereço e trecho — baratos. */
  maxSearchResults: number
  /** Quantas páginas ABRIR. Esta é a que custa: cada uma é uma leitura completa. */
  maxPagesToRead: number
  maxCharsPerPage: number
  /** Quantos trechos entram no contexto do modelo. Página inteira no prompt é desperdício. */
  maxEvidenceChunks: number
  searchTimeoutMs: number
  pageReadTimeoutMs: number
}

/** Os tetos do SISTEMA. A configuração do dono escolhe dentro deles, nunca acima. */
export const WEB_SEARCH_LIMITS = {
  maxSearchResults: { padrao: 10, min: 1, max: 25 },
  maxPagesToRead: { padrao: 5, min: 1, max: 10 },
  maxCharsPerPage: { padrao: 15_000, min: 1_000, max: 40_000 },
  maxEvidenceChunks: { padrao: 8, min: 1, max: 20 },
  searchTimeoutMs: { padrao: 8_000, min: 1_000, max: 30_000 },
  pageReadTimeoutMs: { padrao: 12_000, min: 1_000, max: 60_000 },
} as const

const limitar = (valor: unknown, faixa: { padrao: number; min: number; max: number }): number => {
  const n = Math.trunc(Number(valor))
  if (!Number.isFinite(n) || n <= 0) return faixa.padrao
  return Math.min(faixa.max, Math.max(faixa.min, n))
}

/**
 * A configuração de busca de um agente, com os padrões preenchidos.
 *
 * `enabled` só é verdadeiro quando alguém marcou explicitamente. Ausente é FALSO — é o
 * que preserva o comportamento de todo agente que já existe.
 */
export function normalizeWebSearch(bruto: Partial<WebSearchSettings> | null | undefined): WebSearchSettings {
  const cfg = bruto ?? {}
  return {
    enabled: cfg.enabled === true,
    policy: WEB_SEARCH_POLICIES.includes(cfg.policy as WebSearchPolicy) ? (cfg.policy as WebSearchPolicy) : 'fallback_only',
    maxSearchResults: limitar(cfg.maxSearchResults, WEB_SEARCH_LIMITS.maxSearchResults),
    maxPagesToRead: limitar(cfg.maxPagesToRead, WEB_SEARCH_LIMITS.maxPagesToRead),
    maxCharsPerPage: limitar(cfg.maxCharsPerPage, WEB_SEARCH_LIMITS.maxCharsPerPage),
    maxEvidenceChunks: limitar(cfg.maxEvidenceChunks, WEB_SEARCH_LIMITS.maxEvidenceChunks),
    searchTimeoutMs: limitar(cfg.searchTimeoutMs, WEB_SEARCH_LIMITS.searchTimeoutMs),
    pageReadTimeoutMs: limitar(cfg.pageReadTimeoutMs, WEB_SEARCH_LIMITS.pageReadTimeoutMs),
  }
}

export interface SearchDecision {
  search: boolean
  /** Por que sim ou por que não — vai para o painel e para o log, em uma linha. */
  reason: string
}

/**
 * Procurar agora?
 *
 * `grounding` é o resultado da consulta que JÁ aconteceu: 'ok' quer dizer que a base
 * respondeu. A política decide o que fazer com isso.
 *
 * `automatic` e `fallback_only` são parecidas de propósito, e a diferença é o limiar:
 * a primeira também procura quando a base trouxe pouca coisa — uma resposta magra é
 * quase sempre pior que nenhuma, porque tem cara de resposta.
 */
export function shouldSearch(
  cfg: WebSearchSettings,
  estado: { grounding: string; passages: number; canSearch: boolean },
): SearchDecision {
  if (!cfg.enabled) return { search: false, reason: 'busca na web desligada neste agente' }
  if (!estado.canSearch) return { search: false, reason: 'nenhum serviço de busca configurado neste servidor' }

  if (cfg.policy === 'always') return { search: true, reason: 'política: sempre procurar' }

  if (cfg.policy === 'fallback_only') {
    if (estado.grounding === 'ok' && estado.passages > 0) {
      return { search: false, reason: 'a base já respondeu: não há por que procurar fora' }
    }
    return { search: true, reason: `a base não respondeu (${estado.grounding}): procurando fora` }
  }

  // automatic
  const MAGRO = 2
  if (estado.grounding === 'ok' && estado.passages >= MAGRO) {
    return { search: false, reason: `a base trouxe ${estado.passages} trecho(s): suficiente` }
  }
  return {
    search: true,
    reason: estado.grounding === 'ok' ? `a base trouxe só ${estado.passages} trecho(s)` : `a base não respondeu (${estado.grounding})`,
  }
}
