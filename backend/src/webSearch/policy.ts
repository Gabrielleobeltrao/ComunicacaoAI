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
  /**
   * Por quantos dias uma página achada pela busca continua valendo. 0 = não guardar.
   *
   * Ela vira documento na base do agente, e é isso que evita procurar de novo: a busca
   * na base roda ANTES da busca na web, então uma pergunta parecida encontra o que já
   * foi lido e a requisição nem sai.
   *
   * A validade existe porque uma página achada uma vez não tem política de releitura —
   * ao contrário de um site cadastrado, que o dono mandou reler. Sem prazo, um dado de
   * três meses atrás seria respondido como se fosse de hoje.
   */
  rememberDays: number
}

/** Os tetos do SISTEMA. A configuração do dono escolhe dentro deles, nunca acima. */
export const WEB_SEARCH_LIMITS = {
  maxSearchResults: { padrao: 10, min: 1, max: 25 },
  maxPagesToRead: { padrao: 5, min: 1, max: 10 },
  maxCharsPerPage: { padrao: 15_000, min: 1_000, max: 40_000 },
  maxEvidenceChunks: { padrao: 8, min: 1, max: 20 },
  searchTimeoutMs: { padrao: 8_000, min: 1_000, max: 30_000 },
  pageReadTimeoutMs: { padrao: 12_000, min: 1_000, max: 60_000 },
  rememberDays: { padrao: 7, min: 0, max: 365 },
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
    // Zero é uma escolha legítima — "não guarde nada" —, e por isso não cai no padrão.
    rememberDays:
      cfg.rememberDays === 0
        ? 0
        : limitar(cfg.rememberDays, WEB_SEARCH_LIMITS.rememberDays as { padrao: number; min: number; max: number }),
  }
}

/**
 * A pergunta quer o estado de AGORA?
 *
 * Isto existe por um erro que o prazo de validade sozinho não evita. Uma página lida
 * ontem diz "hoje o produto custa X". Amanhã alguém pergunta "quanto custa hoje?" — e a
 * página guardada casa perfeitamente com a pergunta, inclusive na palavra "hoje". O
 * agente responde o preço de ontem com a convicção de quem tem fonte.
 *
 * Quando a pergunta pede o agora, uma página que um buscador trouxe UMA VEZ não serve
 * como resposta pronta: ela vale como pista, e o certo é olhar de novo. Só palavras de
 * TEMPO entram aqui — nenhum assunto, nenhum domínio, nenhum ramo de negócio.
 */
const AGORA = [
  'hoje',
  'agora',
  'atual',
  'atuais',
  'atualmente',
  'neste momento',
  'no momento',
  'mais recente',
  'recentes',
  'ultima',
  'ultimas',
  'ultimo',
  'ultimos',
  'esta semana',
  'nesta semana',
  'este mes',
  'neste mes',
  'este ano',
  'neste ano',
  'em tempo real',
  'ao vivo',
  'nesta data',
  'do dia',
  'de hoje',
]

const semAcento = (t: string): string => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function wantsCurrentInfo(pergunta: string): boolean {
  const alvo = semAcento(pergunta)
  return AGORA.some((termo) => new RegExp(`\\b${termo}\\b`).test(alvo))
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
/**
 * A pergunta pede um VALOR — e a base trouxe algum?
 *
 * É o caso que fazia o agente responder errado com cara de certo: perguntam "quanto está
 * a ação", a base tem dois trechos que FALAM da ação sem trazer preço nenhum, e a decisão
 * antiga via "dois trechos" e chamava de suficiente. O agente então respondia com o que
 * tinha — incompleto — em vez de ir procurar.
 *
 * O teste é grosseiro de propósito: se a pergunta pede quantidade e nenhum trecho tem
 * número, a base não respondeu. Ele erra para o lado de procurar, que é o lado barato:
 * uma busca a mais custa uma requisição; uma resposta incompleta custa uma decisão errada.
 *
 * ponytail: heurística léxica em português e inglês. Se aparecer um terceiro idioma, o
 * caminho é a verificação por modelo (uma pergunta de sim/não sobre o contexto), não mais
 * palavras nesta lista.
 */
const PEDE_VALOR =
  /\b(quanto|quantos|quantas|qual\s+(?:é\s+)?(?:o|a)\s+(?:valor|pre[çc]o|cota[çc][ãa]o|taxa|custo|total|saldo|n[úu]mero|percentual)|pre[çc]o|cota[çc][ãa]o|valor|taxa|custo|how\s+much|how\s+many|price|rate)\b/i
/** Um número de verdade: dígito com vizinhança de número, não um ano solto num texto. */
const TEM_NUMERO = /\d[\d.,]*\s*(%|reais|r\$|us\$|usd|brl|mil|milh|bilh)|r\$\s*\d|\d+[.,]\d/i

export function respondeAoValorPedido(query: string, passages: string[]): boolean {
  if (!PEDE_VALOR.test(query)) return true
  return passages.some((p) => TEM_NUMERO.test(p))
}

export function shouldSearch(
  cfg: WebSearchSettings,
  estado: {
    grounding: string
    passages: number
    canSearch: boolean
    /** A pergunta pede o estado de AGORA? */
    wantsCurrent?: boolean
    /** O que a base respondeu veio SÓ de páginas que um buscador trouxe? */
    onlySearchMemory?: boolean
    /**
     * A RELEVÂNCIA do melhor trecho (0 a 1). Ausente = desconhecida, e aí a contagem
     * volta a ser o único sinal — como era antes.
     */
    topScore?: number
    /** A pergunta pede um valor, e a base trouxe algum? Ausente = não dá para saber. */
    answersValue?: boolean
  },
): SearchDecision {
  if (!cfg.enabled) return { search: false, reason: 'busca na web desligada neste agente' }
  if (!estado.canSearch) return { search: false, reason: 'nenhum serviço de busca configurado neste servidor' }

  if (cfg.policy === 'always') return { search: true, reason: 'política: sempre procurar' }

  /**
   * A pergunta quer AGORA, e o que a base tem veio de uma busca anterior.
   *
   * Este é o caso perigoso: a página guardada casa com a pergunta — ela também fala
   * "hoje" — e responderia o valor de ontem como se fosse o de agora. Uma página que um
   * buscador trouxe uma vez não tem política de releitura; a única forma de saber se
   * ainda vale é olhar de novo.
   *
   * O que o dono CUROU não entra nesta regra: se ele escreveu, é responsabilidade dele.
   */
  if (estado.wantsCurrent && estado.onlySearchMemory) {
    return { search: true, reason: 'a pergunta é sobre agora, e o que a base tem veio de uma busca anterior' }
  }

  /**
   * A pergunta pede um valor e a base não tem valor nenhum.
   *
   * Vale nas duas políticas automáticas, e antes de qualquer contagem: uma base que fala
   * do assunto sem trazer o número pedido NÃO respondeu, por mais trechos que devolva. Era
   * exatamente aqui que a resposta incompleta passava por completa.
   */
  if (estado.answersValue === false) {
    return { search: true, reason: 'a pergunta pede um valor e a base não trouxe nenhum' }
  }

  if (cfg.policy === 'fallback_only') {
    if (estado.grounding === 'ok' && estado.passages > 0) {
      return { search: false, reason: 'a base já respondeu: não há por que procurar fora' }
    }
    return { search: true, reason: `a base não respondeu (${estado.grounding}): procurando fora` }
  }

  /**
   * `automatic`: procura quando a base não responde BEM — e "bem" deixou de ser contagem.
   *
   * Contar trechos media a quantidade de texto recuperado, nunca a qualidade da resposta:
   * dois trechos que só MENCIONAM o assunto contavam igual a dois que o respondem. Agora
   * o critério é a relevância do melhor trecho, que é o número que a busca já calculava e
   * jogava fora.
   */
  if (estado.grounding === 'ok') {
    const relevancia = estado.topScore
    if (relevancia !== undefined && relevancia < RELEVANCIA_FRACA) {
      return { search: true, reason: `a base respondeu fraco (relevância ${relevancia.toFixed(2)})` }
    }
    // Sem relevância conhecida, a contagem volta a ser o único sinal — como era antes.
    if (relevancia !== undefined || estado.passages >= MINIMO_DE_TRECHOS) {
      return {
        search: false,
        reason: relevancia !== undefined ? `a base respondeu bem (relevância ${relevancia.toFixed(2)})` : `a base trouxe ${estado.passages} trecho(s): suficiente`,
      }
    }
  }
  return {
    search: true,
    reason: estado.grounding === 'ok' ? `a base trouxe só ${estado.passages} trecho(s)` : `a base não respondeu (${estado.grounding})`,
  }
}

/**
 * Abaixo disto a base "respondeu", mas de longe.
 *
 * `RETRIEVAL_MIN_SCORE` (0.5) é o piso para um trecho ENTRAR na resposta. Este é outro
 * limiar, mais alto: entrar é uma coisa, responder bem é outra — e é justamente a faixa
 * entre os dois que produzia resposta incompleta com cara de completa.
 */
const RELEVANCIA_FRACA = 0.65
/** Quantos trechos bastam quando não há relevância para consultar. O critério antigo. */
const MINIMO_DE_TRECHOS = 2
