import { MONITORING_SOURCE_KINDS } from './types.js'
import type { MonitoringSourceKind } from './types.js'

// A CONFIGURAÇÃO por tipo — uma união discriminada, e não um saco de campos opcionais.
//
// O modelo antigo tinha `url?`, `appKey?`, `datasetKey?`, `eventType?` e mais dez, todos
// opcionais no mesmo objeto. Isso significa que uma fonte de webhook aceitava `url`, uma de
// dataset aceitava `selector`, e nada reclamava: os campos errados ficavam guardados,
// apareciam na tela e confundiam quem fosse editar depois.
//
// Com a união, cada tipo diz exatamente o que ele tem. O que não pertence àquele tipo é
// RECUSADO na entrada, e não silenciosamente ignorado — porque campo ignorado é campo que
// alguém preencheu achando que ia funcionar.

export type StreamProtocol = 'websocket' | 'sse'

export interface ApiPollingConfig {
  kind: 'api_polling'
  url: string
  method: 'GET' | 'POST'
  query: { key: string; value: string }[]
  body: string | null
  /** Nomes que a conexão preenche. O valor nunca está aqui. */
  headerNames: string[]
  pagination: { kind: 'none' } | { kind: 'cursor'; cursorPath: string; maxPages: number } | { kind: 'page'; pageParam: string; maxPages: number }
}

export interface RssConfig {
  kind: 'rss'
  url: string
  headerNames: string[]
}

export interface HttpPageConfig {
  kind: 'http_page'
  url: string
  headerNames: string[]
  selector: string | null
}

export interface BrowserConfig {
  kind: 'browser'
  url: string
  selector: string | null
  /** A ordem em que as estratégias são tentadas. Do mais barato ao mais caro. */
  strategy: ('json' | 'jsonld' | 'dom' | 'browser' | 'vision')[]
}

export interface WebhookConfig {
  kind: 'webhook'
  /** Gerada pelo servidor. O segredo fica cifrado, fora daqui. */
  webhookPublicKey: string | null
}

export interface StreamConfig {
  kind: 'websocket'
  installationId: string | null
  /** WebSocket ou SSE — DITO, e não adivinhado pela URL. */
  protocol: StreamProtocol
  /** Só para SSE: o endereço do fluxo. WebSocket usa a instalação do App. */
  url: string | null
  subscriptions: string[]
  /** Silêncio além disso é conexão morta, mesmo sem erro. */
  heartbeatMs: number
}

export interface AppActionConfig {
  kind: 'app_action'
  appKey: string
  actionKey: string
  installationId: string
}

export interface DatasetConfig {
  kind: 'dataset'
  dataStoreId: string
  datasetKey: string
}

export interface InternalEventConfig {
  kind: 'internal_event'
  eventType: string
}

export type TypedConfig =
  | ApiPollingConfig
  | RssConfig
  | HttpPageConfig
  | BrowserConfig
  | WebhookConfig
  | StreamConfig
  | AppActionConfig
  | DatasetConfig
  | InternalEventConfig

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message)
  }
}

const texto = (v: unknown, campo: string, max = 2000, obrigatorio = true): string => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s && obrigatorio) throw new ConfigError(`"${campo}" é obrigatório para este tipo de fonte`, campo)
  if (s.length > max) throw new ConfigError(`"${campo}" é longo demais`, campo)
  return s
}

const urlValida = (v: unknown, campo = 'url'): string => {
  const s = texto(v, campo)
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('esquema')
  } catch {
    throw new ConfigError('o endereço não é uma URL válida', campo)
  }
  return s
}

const nomes = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => String(x).trim())
    .filter((x) => /^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(x))
    .slice(0, 20)

/**
 * Confere a configuração CONTRA O TIPO — e recusa o que não pertence a ele.
 *
 * Recusar em vez de ignorar é a escolha que importa: um `selector` numa fonte de dataset
 * foi digitado por alguém que esperava alguma coisa, e ignorar em silêncio deixa essa
 * pessoa esperando para sempre.
 */
export function validateConfig(kind: MonitoringSourceKind, bruto: unknown): TypedConfig {
  if (!MONITORING_SOURCE_KINDS.includes(kind)) throw new ConfigError('tipo de fonte desconhecido')
  const c = (bruto ?? {}) as Record<string, unknown>

  const permitidos: Record<MonitoringSourceKind, string[]> = {
    api_polling: ['url', 'method', 'query', 'body', 'headerNames', 'pagination'],
    rss: ['url', 'headerNames'],
    http_page: ['url', 'headerNames', 'selector'],
    browser: ['url', 'selector', 'strategy'],
    webhook: ['webhookPublicKey'],
    websocket: ['installationId', 'protocol', 'url', 'subscriptions', 'heartbeatMs'],
    app_action: ['appKey', 'actionKey', 'installationId'],
    dataset: ['dataStoreId', 'datasetKey'],
    internal_event: ['eventType'],
  }

  const estranhos = Object.keys(c).filter((k) => !permitidos[kind].includes(k))
  if (estranhos.length) {
    throw new ConfigError(`"${estranhos[0]}" não faz parte de uma fonte do tipo ${kind}`, estranhos[0])
  }

  switch (kind) {
    case 'api_polling': {
      const metodo = c.method === 'POST' ? 'POST' : 'GET'
      const paginacao = c.pagination as Record<string, unknown> | undefined
      return {
        kind,
        url: urlValida(c.url),
        method: metodo,
        query: (Array.isArray(c.query) ? c.query : []).slice(0, 20).map((q) => ({
          key: texto((q as { key?: unknown })?.key, 'query.key', 100),
          value: String((q as { value?: unknown })?.value ?? '').slice(0, 500),
        })),
        body: metodo === 'POST' && c.body ? String(c.body).slice(0, 10_000) : null,
        headerNames: nomes(c.headerNames),
        pagination:
          paginacao?.kind === 'cursor'
            ? { kind: 'cursor', cursorPath: texto(paginacao.cursorPath, 'cursorPath', 200), maxPages: Math.min(20, Math.max(1, Number(paginacao.maxPages ?? 5))) }
            : paginacao?.kind === 'page'
              ? { kind: 'page', pageParam: texto(paginacao.pageParam, 'pageParam', 60), maxPages: Math.min(20, Math.max(1, Number(paginacao.maxPages ?? 5))) }
              : { kind: 'none' },
      }
    }
    case 'rss':
      return { kind, url: urlValida(c.url), headerNames: nomes(c.headerNames) }
    case 'http_page':
      return { kind, url: urlValida(c.url), headerNames: nomes(c.headerNames), selector: c.selector ? texto(c.selector, 'selector', 200) : null }
    case 'browser':
      return {
        kind,
        url: urlValida(c.url),
        selector: c.selector ? texto(c.selector, 'selector', 200) : null,
        // A ordem padrão é a que custa menos primeiro, e a visão fica de fora até alguém
        // pedir: ela é palpite, e palpite precisa ser escolhido de propósito.
        strategy: (Array.isArray(c.strategy) && c.strategy.length
          ? c.strategy.filter((s): s is 'json' | 'jsonld' | 'dom' | 'browser' | 'vision' =>
              ['json', 'jsonld', 'dom', 'browser', 'vision'].includes(String(s)),
            )
          : ['json', 'jsonld', 'dom', 'browser']) as BrowserConfig['strategy'],
      }
    case 'webhook':
      return { kind, webhookPublicKey: c.webhookPublicKey ? String(c.webhookPublicKey) : null }
    case 'websocket': {
      // O protocolo é DITO. Adivinhar por `wss://` versus `https://` erraria num SSE
      // servido por uma API que também fala WebSocket — e o erro só apareceria em produção.
      const protocol: StreamProtocol = c.protocol === 'sse' ? 'sse' : 'websocket'
      if (protocol === 'sse' && !c.url) throw new ConfigError('uma fonte SSE precisa do endereço do fluxo', 'url')
      if (protocol === 'websocket' && !c.installationId) throw new ConfigError('uma fonte WebSocket precisa da conexão do App', 'installationId')
      return {
        kind,
        protocol,
        url: protocol === 'sse' ? urlValida(c.url) : null,
        installationId: protocol === 'websocket' ? texto(c.installationId, 'installationId', 60) : null,
        subscriptions: (Array.isArray(c.subscriptions) ? c.subscriptions : []).map((x) => String(x).slice(0, 120)).slice(0, 40),
        heartbeatMs: Math.min(300_000, Math.max(5_000, Number(c.heartbeatMs ?? 30_000))),
      }
    }
    case 'app_action':
      return { kind, appKey: texto(c.appKey, 'appKey', 60), actionKey: texto(c.actionKey, 'actionKey', 60), installationId: texto(c.installationId, 'installationId', 60) }
    case 'dataset':
      return { kind, dataStoreId: texto(c.dataStoreId, 'dataStoreId', 60), datasetKey: texto(c.datasetKey, 'datasetKey', 120) }
    case 'internal_event':
      return { kind, eventType: texto(c.eventType, 'eventType', 120) }
    default:
      throw new ConfigError('tipo de fonte desconhecido')
  }
}
