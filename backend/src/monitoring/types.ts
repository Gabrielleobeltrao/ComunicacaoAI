import type { ObjectId } from 'mongodb'

// A FONTE MONITORADA — orquestração, não motor novo.
//
// Cada tipo aqui já tem um mecanismo funcionando no produto: polling de HTTP é o executor
// de ferramenta com guarda de SSRF; webhook é o receptor dos Flows; WebSocket é o App;
// ação de App é `resolveGrant`; dataset é Databases; evento interno é o barramento. O que
// não existia era o LUGAR onde a pessoa vê tudo isso como uma coisa só, com a mesma
// pergunta em todos: está online? qual foi a última leitura? o que ela dispara?
//
// Por isso `MonitoringSource` guarda REFERÊNCIAS aos subsistemas, e nunca uma cópia do que
// eles fazem. Duplicar o polling aqui criaria dois lugares decidindo backoff, e o dia em
// que divergissem um estaria tentando de novo o que o outro desistiu.

export type MonitoringSourceKind =
  | 'api_polling'
  | 'webhook'
  | 'websocket'
  | 'app_action'
  | 'rss'
  | 'http_page'
  | 'browser'
  | 'dataset'
  | 'internal_event'

export const MONITORING_SOURCE_KINDS: readonly MonitoringSourceKind[] = [
  'api_polling',
  'webhook',
  'websocket',
  'app_action',
  'rss',
  'http_page',
  'browser',
  'dataset',
  'internal_event',
]

/** O que cada tipo precisa saber fazer. Usado pela tela para não oferecer o que não existe. */
export const KIND_CAPABILITIES: Record<MonitoringSourceKind, { pull: boolean; push: boolean; needsUrl: boolean; needsConnection: boolean }> = {
  api_polling: { pull: true, push: false, needsUrl: true, needsConnection: false },
  webhook: { pull: false, push: true, needsUrl: false, needsConnection: false },
  websocket: { pull: false, push: true, needsUrl: false, needsConnection: true },
  app_action: { pull: true, push: false, needsUrl: false, needsConnection: true },
  rss: { pull: true, push: false, needsUrl: true, needsConnection: false },
  http_page: { pull: true, push: false, needsUrl: true, needsConnection: false },
  browser: { pull: true, push: false, needsUrl: true, needsConnection: false },
  dataset: { pull: false, push: true, needsUrl: false, needsConnection: false },
  internal_event: { pull: false, push: true, needsUrl: false, needsConnection: false },
}

export type MonitoringStatus = 'draft' | 'active' | 'paused'
/** O que a Visão geral mostra. `degraded` é o estado que diz a verdade em vez de mentir verde. */
export type MonitoringHealth = 'online' | 'degraded' | 'paused' | 'never_read'

/**
 * O DESTINO do que a fonte lê.
 *
 * "Ao vivo" é valor de agora, consultado sob demanda; "histórico" é série guardada. Os
 * dois existem porque respondem perguntas diferentes — "quanto está agora" e "como
 * variou" — e escolher errado custa: guardar tudo o que só interessa agora enche o banco,
 * e não guardar o que interessa depois perde o passado para sempre.
 */
export interface MonitoringDestination {
  live: boolean
  history: boolean
  /** O recorder que grava — criado pelo serviço, nunca digitado. */
  recorderId?: ObjectId | null
  /** A fonte ao vivo correspondente, quando `live`. */
  realtimeSourceId?: ObjectId | null
  /** Quantos dias guardar. `null` = a política do histórico decide. */
  retentionDays?: number | null
}

/**
 * COMO a fonte é lida. Puxada tem cadência; empurrada não tem — e forçar uma cadência
 * numa fonte que empurra seria inventar trabalho que ninguém pediu.
 */
export interface MonitoringCadence {
  mode: 'interval' | 'cron' | 'stream'
  intervalMs?: number | null
  cron?: string | null
  timezone?: string | null
}

/**
 * O que fazer quando falha — e por quanto tempo insistir.
 *
 * O jitter não é detalhe: sem ele, cem fontes que caíram juntas voltam juntas, e a
 * primeira tentativa depois de um incidente vira o segundo incidente.
 */
export interface MonitoringRetry {
  timeoutMs: number
  maxAttempts: number
  backoffMs: number
  jitterRatio: number
  /** Teto de leituras por minuto. Protege o serviço do outro lado, não este. */
  rateLimitPerMinute: number | null
}

/**
 * Quando um dado deixa de valer.
 *
 * Sem isto, uma fonte que parou de responder continua "verde" com o último valor de três
 * dias atrás — e um monitor decide sobre um número que já não é verdade.
 */
export interface MonitoringFreshness {
  /** Depois disso, o valor é considerado velho e a fonte fica `degraded`. */
  staleAfterMs: number
  /** O que o monitor faz com dado velho: nada, ou avisar. Nunca decidir como se fosse novo. */
  onStale: 'ignore' | 'degrade'
}

export interface MonitoringTelemetry {
  lastReadAt: Date | null
  lastOkAt: Date | null
  lastErrorAt: Date | null
  lastErrorCode: string | null
  /** Latência da última leitura. Não é média: média esconde o pico que derruba. */
  lastLatencyMs: number | null
  consecutiveFailures: number
  readsOk: number
  readsFailed: number
  /** Reconexões, para fontes que mantêm sessão. */
  reconnects: number
  /** O conteúdo da última leitura gravada. É o que faz "de novo o mesmo" não virar linha. */
  lastContentHash?: string | null
}

export const emptyTelemetry = (): MonitoringTelemetry => ({
  lastReadAt: null,
  lastOkAt: null,
  lastErrorAt: null,
  lastErrorCode: null,
  lastLatencyMs: null,
  consecutiveFailures: 0,
  readsOk: 0,
  readsFailed: 0,
  reconnects: 0,
  lastContentHash: null,
})

/**
 * A CONFIGURAÇÃO por tipo — referências, nunca segredo.
 *
 * Credencial mora na conexão cifrada (`connectionId`) e no cofre do App. Um segredo aqui
 * ficaria em texto claro num documento que a tela lê inteiro.
 */
export interface MonitoringConfig {
  /** `api_polling`, `rss`, `http_page`, `browser`. */
  url?: string
  method?: 'GET' | 'POST'
  query?: { key: string; value: string }[]
  /** Corpo para POST. Sem interpolação de segredo: isso é da conexão. */
  body?: string
  /** Nomes de cabeçalho que a conexão preenche. O valor nunca está aqui. */
  headerNames?: string[]
  /** Paginação, quando a API tem. */
  pagination?: { kind: 'none' | 'cursor' | 'page'; cursorPath?: string; pageParam?: string; maxPages?: number }
  /** `app_action`. */
  appKey?: string
  actionKey?: string
  /** `websocket` — a instalação do App de WebSocket, com as subscriptions dela. */
  installationId?: string
  subscriptions?: string[]
  /** `dataset`. */
  dataStoreId?: string
  datasetKey?: string
  /** `internal_event`. */
  eventType?: string
  /** `webhook` — a chave pública gerada; o segredo de assinatura fica cifrado. */
  webhookPublicKey?: string
  /** `http_page` e `browser`: a estratégia, em ordem de preferência. */
  strategy?: ('json' | 'jsonld' | 'dom' | 'browser' | 'vision')[]
  selector?: string
}

export interface MonitoringSource {
  _id: ObjectId
  ownerId: string
  /** De quem é, dentro do escritório. Grant por agente/setor sai daqui. */
  scope: { ownerType: 'account' | 'building' | 'floor' | 'sector'; ownerId: string }
  name: string
  description: string
  kind: MonitoringSourceKind
  status: MonitoringStatus
  /** A conexão que empresta credencial. Referência, nunca valor. */
  connectionId?: ObjectId | null
  config: MonitoringConfig
  /** O contrato do que sai desta fonte, depois do mapeamento. */
  schema: Record<string, unknown>
  /** O extrator, versionado: mudar o mapeamento não reescreve o passado. */
  mapping: FieldMapping
  cadence: MonitoringCadence
  retry: MonitoringRetry
  freshness: MonitoringFreshness
  /** O campo que identifica a coisa observada, quando a fonte traz várias. */
  entityKeyPath: string | null
  /** Como decidir que duas leituras são a mesma. */
  dedupe: { mode: 'none' | 'content_hash' | 'field'; field?: string | null }
  destination: MonitoringDestination
  telemetry: MonitoringTelemetry
  createdAt: Date
  updatedAt: Date
}

// --- o mapeamento -------------------------------------------------------------------------

/**
 * O EXTRATOR — fechado, versionado e sem uma linha de código do usuário.
 *
 * Um campo é um caminho no documento mais uma lista de transformações escolhidas de uma
 * lista fixa. Não há expressão, não há `eval`, não há função enviada pela tela: o que
 * existe é dado descrevendo qual pedaço pegar e o que fazer com ele.
 *
 * A VERSÃO importa porque o mapeamento envelhece junto com a API do outro lado. Guardar a
 * versão que produziu cada leitura é o que permite olhar uma série antiga e saber por que
 * ela tem a forma que tem.
 */
export type TransformOp =
  | { op: 'number' }
  | { op: 'trim' }
  | { op: 'lower' }
  | { op: 'upper' }
  | { op: 'boolean' }
  | { op: 'date' }
  | { op: 'first' }
  | { op: 'join'; separator: string }
  | { op: 'replace'; find: string; with: string }
  | { op: 'default'; value: string | number | boolean }

export interface FieldRule {
  /** O nome que o campo terá no dado normalizado. */
  to: string
  /** De onde ele vem: `dados.preco`, `items[0].valor`. Sem curinga e sem expressão. */
  from: string
  transforms?: TransformOp[]
  required?: boolean
}

export interface FieldMapping {
  version: number
  /** Onde está a lista, quando a fonte devolve várias linhas. Vazio = um objeto só. */
  itemsPath?: string | null
  fields: FieldRule[]
}
