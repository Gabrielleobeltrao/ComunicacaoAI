// QUANDO um site vinculado a um agente deve ser lido de novo.
//
// A decisão vive sozinha, sem banco e sem rede, porque é ela que decide o que custa: uma
// leitura a mais é tráfego e latência na frente de quem perguntou; uma a menos é o agente
// respondendo com a página de ontem. Sendo pura, dá para provar cada caso com relógio
// fixo, em vez de esperar meia hora para ver o que acontece.
//
// Não confundir com o que já existia. `WatchedSource.when` (`always` / `on_change` /
// `on_demand`) decide se o conteúdo do site entra no PROMPT daquela chamada — é injeção
// de contexto, viva e efêmera. O `refreshMode` daqui decide se o conteúdo vira DOCUMENTO
// na base do agente, que persiste e é recuperado como qualquer outro conhecimento. As
// duas coisas convivem, e uma fonte pode usar as duas.

/** Como o dono quer que este endereço seja mantido atualizado na base. */
export type RefreshMode = 'scheduled' | 'on_demand' | 'manual' | 'hybrid'

/** Como descobrir O QUE ler naquele endereço. Tudo determinístico — nada de modelo. */
export type DiscoveryMode = 'auto' | 'rss' | 'sitemap' | 'listing' | 'single_page'

export type SourceHealth = 'never_run' | 'ok' | 'error' | 'running'

/** O motivo desta verificação. Cada modo responde de um jeito a cada motivo. */
/**
 * `bootstrap` é o motivo que existe para um caso só: a base está VAZIA.
 *
 * Um pesquisador com um site cadastrado e nenhum documento não tem o que responder — e,
 * se ele exige fundamentação, a tarefa morre antes de começar. Nesse estado, o modo não
 * deveria decidir: `manual` e `scheduled` querem dizer "não fique lendo a toda hora", e
 * não "nunca leia, nem uma primeira vez".
 *
 * A primeira leitura é a única que o bootstrap faz. A partir dela, o modo volta a mandar.
 */
export type RefreshReason = 'scheduled' | 'on_demand' | 'manual' | 'bootstrap'

export interface WebSourceConfig {
  enabled?: boolean
  refreshMode?: RefreshMode
  /** Só `scheduled`/`hybrid`. De quanto em quanto tempo. */
  intervalMinutes?: number
  /** Só `on_demand`/`hybrid`. A partir de que idade vale a pena reler antes de executar. */
  maxStalenessMinutes?: number
  discoveryMode?: DiscoveryMode
  crawlArticles?: boolean
  /** Como ler cada página. Ver `adaptiveWebReader`. */
  readMode?: 'auto' | 'http' | 'browser'
  maxArticlesPerRun?: number
  maxDepth?: number
  sameDomainOnly?: boolean
}

/** O que se sabe da última vez que este endereço foi lido. */
export interface WebSourceState {
  lastFetchedAt?: Date | string | null
  lastSuccessfulFetchAt?: Date | string | null
  nextScheduledAt?: Date | string | null
  lastError?: string | null
  status?: SourceHealth
  discoveredUrls?: number
  newDocuments?: number
  updatedDocuments?: number
}

// --- limites seguros ------------------------------------------------------------------
//
// O dono escolhe o intervalo; o sistema escolhe o que é seguro. Cinco minutos é o piso
// porque abaixo disso a leitura vira martelo no site de outra pessoa — e a nossa conta de
// tráfego. Uma semana é o teto porque acima disso "atualização automática" não descreve
// mais o que está acontecendo.
export const MIN_INTERVAL_MINUTES = 5
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60
export const DEFAULT_INTERVAL_MINUTES = 30
/** Sem prazo declarado, meia hora: velho o bastante para reler, novo o bastante para não. */
export const DEFAULT_STALENESS_MINUTES = 30
/** Quantas páginas uma varredura pode abrir de uma vez. */
export const MAX_ARTICLES_PER_RUN = 20
export const DEFAULT_ARTICLES_PER_RUN = 5
/** Profundidade de navegação. Um nível já é "a página e o que ela lista". */
export const MAX_DEPTH = 2

export const REFRESH_MODES: RefreshMode[] = ['scheduled', 'on_demand', 'manual', 'hybrid']
export const DISCOVERY_MODES: DiscoveryMode[] = ['auto', 'rss', 'sitemap', 'listing', 'single_page']

const limitar = (valor: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(valor)))

/**
 * A configuração completa, com o que falta preenchido.
 *
 * Uma fonte gravada antes disto existir não tem campo nenhum — e cai em `manual`, que não
 * lê nada sozinha. É de propósito: ligar leitura automática em endereços que alguém
 * cadastrou para outra coisa seria decidir pelo dono, e gastando a banda dele.
 */
export function normalizeWebSource(cfg: WebSourceConfig | undefined | null): Required<Omit<WebSourceConfig, 'intervalMinutes' | 'maxStalenessMinutes'>> & {
  intervalMinutes: number
  maxStalenessMinutes: number
} {
  const bruto = cfg ?? {}
  const modo = REFRESH_MODES.includes(bruto.refreshMode as RefreshMode) ? (bruto.refreshMode as RefreshMode) : 'manual'
  return {
    enabled: bruto.enabled !== false,
    refreshMode: modo,
    intervalMinutes: limitar(Number(bruto.intervalMinutes) || DEFAULT_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES),
    maxStalenessMinutes: limitar(
      Number(bruto.maxStalenessMinutes) || DEFAULT_STALENESS_MINUTES,
      1,
      MAX_INTERVAL_MINUTES,
    ),
    discoveryMode: DISCOVERY_MODES.includes(bruto.discoveryMode as DiscoveryMode) ? (bruto.discoveryMode as DiscoveryMode) : 'auto',
    // `auto` é o padrão: tenta o barato primeiro e só abre navegador quando precisa.
    readMode: bruto.readMode === 'http' || bruto.readMode === 'browser' ? bruto.readMode : 'auto',
    crawlArticles: bruto.crawlArticles === true,
    maxArticlesPerRun: limitar(Number(bruto.maxArticlesPerRun) || DEFAULT_ARTICLES_PER_RUN, 1, MAX_ARTICLES_PER_RUN),
    maxDepth: limitar(Number(bruto.maxDepth) || 1, 1, MAX_DEPTH),
    sameDomainOnly: bruto.sameDomainOnly !== false,
  }
}

const emMs = (valor: Date | string | null | undefined): number | null => {
  if (!valor) return null
  const d = valor instanceof Date ? valor : new Date(valor)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

export interface RefreshDecision {
  refresh: boolean
  /** Por que sim ou por que não — vai para o log e para a tela, em uma linha. */
  reason: string
}

/**
 * Ler de novo, agora?
 *
 * O motivo importa tanto quanto o modo. `manual` só responde a um clique; `scheduled` só
 * ao relógio; `on_demand` só quando alguém vai usar o agente — e mesmo assim, apenas se o
 * que está guardado já envelheceu. `hybrid` é o único que responde aos dois.
 */
export function shouldRefresh(
  cfg: WebSourceConfig | undefined | null,
  estado: WebSourceState | undefined | null,
  motivo: RefreshReason,
  agora: number = Date.now(),
): RefreshDecision {
  const c = normalizeWebSource(cfg)
  if (!c.enabled) return { refresh: false, reason: 'fonte desligada' }
  // Um clique é sempre atendido: quem pediu está olhando.
  if (motivo === 'manual') return { refresh: true, reason: 'pedido manual' }
  // A primeira leitura de uma base vazia acontece em qualquer modo. Quem chama já
  // confirmou que não há conhecimento; aqui só falta a fonte estar ligada.
  if (motivo === 'bootstrap') return { refresh: true, reason: 'primeira leitura (base vazia)' }

  const ultima = emMs(estado?.lastSuccessfulFetchAt) ?? emMs(estado?.lastFetchedAt)
  const idadeMin = ultima === null ? Number.POSITIVE_INFINITY : (agora - ultima) / 60_000

  if (motivo === 'scheduled') {
    if (c.refreshMode !== 'scheduled' && c.refreshMode !== 'hybrid') return { refresh: false, reason: 'não é automática' }
    const proxima = emMs(estado?.nextScheduledAt)
    if (proxima !== null && agora < proxima) return { refresh: false, reason: 'ainda não deu a hora' }
    if (proxima === null && idadeMin < c.intervalMinutes) return { refresh: false, reason: 'lida há pouco' }
    return { refresh: true, reason: ultima === null ? 'primeira leitura' : `intervalo de ${c.intervalMinutes} min vencido` }
  }

  // on_demand: alguém vai usar este agente agora.
  if (c.refreshMode === 'scheduled') return { refresh: false, reason: 'só por horário' }
  if (c.refreshMode === 'manual') return { refresh: false, reason: 'só manualmente' }
  if (ultima === null) return { refresh: true, reason: 'nunca foi lida' }
  if (idadeMin >= c.maxStalenessMinutes) {
    return { refresh: true, reason: `lida há ${Math.round(idadeMin)} min, limite ${c.maxStalenessMinutes} min` }
  }
  // O caso que economiza a maior parte das leituras: acabou de ser lida.
  return { refresh: false, reason: `lida há ${Math.round(idadeMin)} min` }
}

/** Quando esta fonte deve ser lida de novo pelo relógio. Ausente quando não é automática. */
export function nextScheduledAfter(cfg: WebSourceConfig | undefined | null, agora: number = Date.now()): Date | null {
  const c = normalizeWebSource(cfg)
  if (!c.enabled || (c.refreshMode !== 'scheduled' && c.refreshMode !== 'hybrid')) return null
  return new Date(agora + c.intervalMinutes * 60_000)
}

/**
 * Como descobrir o que ler, quando o dono escolheu "automático".
 *
 * Determinístico e sem surpresa: um feed é um feed; um endereço de sitemap é um sitemap;
 * o resto é a própria página — e só vira varredura de links se o dono pedir.
 */
export function resolveDiscovery(cfg: WebSourceConfig | undefined | null, kind: 'rss' | 'http', url: string): Exclude<DiscoveryMode, 'auto'> {
  const c = normalizeWebSource(cfg)
  if (c.discoveryMode !== 'auto') return c.discoveryMode
  if (kind === 'rss') return 'rss'
  if (/sitemap[^/]*\.xml(\?|$)/i.test(url)) return 'sitemap'
  return c.crawlArticles ? 'listing' : 'single_page'
}
