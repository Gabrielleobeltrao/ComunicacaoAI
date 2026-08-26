import type { ObjectId } from 'mongodb'

/**
 * Histórico GENÉRICO — o que aconteceu, guardado por uma regra.
 *
 * O motor não sabe o que é preço, estoque ou temperatura. Ele recebe FATOS
 * `{ dono, fonte, chave, quando, valor }` e um conjunto de regras que dizem quando um
 * fato vira registro. Vela de mercado é uma configuração possível — `price first→open`,
 * `price max→high` —, não um conceito daqui. O mesmo mecanismo serve para saldo de
 * estoque, pedidos por hora, leitura de sensor ou usuários ativos.
 *
 * O que ele NÃO é: o Live Data continua respondendo só "qual é o valor agora", com TTL;
 * o `marketData` continua sendo o motor especializado quando a semântica de trade,
 * cotação e vela importa. Este aqui consome os eventos dos dois quando for útil.
 */

/** De onde o fato veio. A origem é REFERÊNCIA, nunca acoplamento ao provider. */
export const SOURCE_KINDS = ['event', 'live_data', 'manual'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

export interface DataSourceDefinition {
  kind: SourceKind
  /**
   * O que a origem identifica dentro do tipo.
   *
   * `event` → o tipo do evento (`integration.websocket.message`, `market.candle.closed`).
   * `live_data` → o id da conexão de WebSocket.
   * `manual` → um nome livre que quem chama `recordFact` usa (tool, agente, rotina,
   * webhook). É por aqui que uma integração futura entra sem código novo no motor.
   */
  ref: string
}

export const RECORDER_MODES = ['every_event', 'on_change', 'snapshot_interval', 'schedule_snapshot', 'window_aggregate', 'condition'] as const
export type RecorderMode = (typeof RECORDER_MODES)[number]

/**
 * O que uma agregação por janela GRAVA.
 *
 * O padrão é só o resumo, e isso é uma decisão de custo: um feed de três tiques por
 * segundo produz 259 mil linhas por dia em bruto e 288 em janelas de cinco minutos.
 * Guardar o tique também é legítimo — para auditar ou recalcular —, mas precisa ser
 * escolha explícita de quem configura, nunca o que acontece por omissão.
 */
export const PERSIST_POLICIES = ['aggregate_only', 'raw_only', 'raw_and_aggregate'] as const
export type PersistPolicy = (typeof PERSIST_POLICIES)[number]

/**
 * De que TIPO é um registro.
 *
 * Bruto, resumo de janela e retrato periódico respondem perguntas diferentes e não
 * podem ser lidos como a mesma coisa: misturar um tique e a média da hora na mesma
 * série produz um número que não existe. A consulta filtra por isto.
 */
export const RECORD_KINDS = ['raw', 'aggregate', 'snapshot'] as const
export type RecordKind = (typeof RECORD_KINDS)[number]

/**
 * A agenda de um retrato periódico — a MESMA do resto do produto.
 *
 * `cron` e `timezone` são exatamente o que as rotinas usam, e são lidos pelo mesmo
 * `scheduleClock`. Não há relógio novo aqui: um segundo jeito de dizer "toda terça às
 * 7h" seria um segundo lugar para o horário de verão estar errado.
 */
export interface RecorderSchedule {
  cron: string
  /** IANA, ex.: `America/Sao_Paulo`. O fuso é do DONO, nunca o do servidor. */
  timezone: string
}

/** As sete operações. Determinísticas, sem modelo no caminho. */
export const AGGREGATIONS = ['first', 'last', 'min', 'max', 'avg', 'sum', 'count'] as const
export type AggregationOp = (typeof AGGREGATIONS)[number]

export interface AggregationRule {
  /** De onde ler no valor do fato: `price`, `data.qty`. */
  from: string
  op: AggregationOp
  /** Como o resultado se chama no registro: `open`, `high`, `total`. */
  to: string
}

/** Um filtro no formato que o resto do produto já usa (ver `automations/conditions`). */
export interface RecorderFilter {
  path: string
  operator: 'exists' | 'equals' | 'not_equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'
  value?: unknown
}

export interface DataRecorderDefinition {
  _id: ObjectId
  ownerId: string
  buildingId: string | null
  name: string
  enabled: boolean
  source: DataSourceDefinition
  /** Onde está a identidade da coisa: `symbol`, `sku`, `sensorId`. Vazio = uma série só. */
  entityKeyPath: string | null
  /** Onde está o instante do FATO. Vazio = o `occurredAt` de quem entregou. */
  occurredAtPath: string | null
  mode: RecorderMode
  /** `snapshot_interval` e `window_aggregate`: o tamanho da janela/intervalo. */
  intervalMs: number | null
  /** `schedule_snapshot`: quando tirar o retrato. Ver `RecorderSchedule`. */
  schedule: RecorderSchedule | null
  /** `window_aggregate`: guardar o resumo, o bruto, ou os dois. */
  persistPolicy: PersistPolicy
  filters: RecorderFilter[]
  /** Quais campos guardar. Vazio = o valor inteiro (já saneado e limitado). */
  selectedFields: string[] | null
  aggregations: AggregationRule[]
  /** `on_change`: qual campo observar. Vazio = o valor todo. */
  changePath: string | null
  retentionDays: number | null
  /** Quantos registros este recorder já gravou. É a cota, e ela é do dono. */
  recordCount: number
  lastRecordAt: Date | null
  lastError: { message: string; at: Date } | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Quantos registros esta regra JÁ GRAVOU — o total histórico, e não o que está guardado.
 *
 * A diferença importa: a retenção apaga sozinha, então `recordCount` sobe e o número de
 * documentos desce. É de propósito — a cota existe para impedir que uma configuração
 * errada produza milhões de linhas, e apagá-las não desfaz o que ela produziu. Quem
 * quer saber quanto está guardado AGORA pede `storedRecords`, que conta no banco.
 */

/**
 * Um registro histórico. IMUTÁVEL: nada aqui é editado depois de gravado.
 *
 * `occurredAt` é quando aconteceu na fonte; `recordedAt` é quando nós gravamos. Os dois
 * separados porque um evento atrasado meia hora não é um evento de agora — e quem lê a
 * série precisa da linha do tempo do fato, não da nossa.
 */
export interface DataHistoryRecord {
  _id: ObjectId
  ownerId: string
  recorderId: ObjectId
  sourceKey: string
  entityKey: string | null
  occurredAt: Date
  recordedAt: Date
  windowStart: Date | null
  windowEnd: Date | null
  /** Bruto, resumo de janela ou retrato. Ausente nos registros anteriores a este campo. */
  recordKind: RecordKind
  value: Record<string, unknown>
  schemaVersion: number
  /** A identidade do registro. Gravar duas vezes com a mesma chave grava uma vez. */
  dedupeKey: string
  expiresAt: Date | null
}

/**
 * Uma janela ABERTA, acumulando. Ela mora no banco, e não na memória.
 *
 * É o que faz um restart não perder nada e dois workers não duplicarem: o acúmulo é
 * feito com operadores atômicos do próprio Mongo (`$min`, `$max`, `$inc`), e o
 * fechamento é um `findOneAndUpdate` com `closed: false` no filtro — dois workers
 * varrendo ao mesmo tempo, só um recebe documento de volta e só ele publica.
 */
export interface OpenWindow {
  _id: ObjectId
  ownerId: string
  recorderId: ObjectId
  entityKey: string | null
  windowStart: Date
  windowEnd: Date
  /** Acumuladores de min/max/sum/count por regra, na chave `to`. */
  acc: Record<string, WindowAcc>
  /**
   * `first` e `last` por regra — e o INSTANTE de cada um, uma vez só para a janela.
   *
   * O instante é propriedade do FATO, não da regra: todas as regras `first` da mesma
   * janela apontam para o mesmo fato, o mais antigo. Guardando `firstAt` no nível da
   * janela, um fato atrasado corrige todas as regras de uma vez — dois updates
   * condicionais, independente de haver uma regra ou doze.
   */
  firsts: Record<string, unknown>
  lasts: Record<string, unknown>
  firstAt: number
  lastAt: number
  count: number
  closed: boolean
  closedAt: Date | null
  /** Fechada e ainda não gravada. Uma queda entre as duas coisas é recuperável. */
  persistedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** Os acumuladores que o próprio Mongo sabe atualizar sem ler antes. */
export interface WindowAcc {
  min?: number
  max?: number
  sum?: number
  count?: number
}

/** O fato — a única entrada do motor. */
export interface Fact {
  ownerId: string
  /** `event:<tipo>`, `live_data:<conexão>`, `manual:<nome>`. */
  sourceKey: string
  entityKey: string | null
  occurredAt: Date
  value: Record<string, unknown>
  /** Para deduplicar quando a origem já tem identidade (um evento, por exemplo). */
  factId?: string
}

export interface DataHistoryPublic {
  id: string
  recorderId: string
  sourceKey: string
  entityKey: string | null
  occurredAt: string
  recordedAt: string
  windowStart: string | null
  windowEnd: string | null
  recordKind: RecordKind
  value: Record<string, unknown>
}

export const historyPublic = (r: DataHistoryRecord): DataHistoryPublic => ({
  id: r._id.toString(),
  recorderId: r.recorderId.toString(),
  sourceKey: r.sourceKey,
  entityKey: r.entityKey,
  occurredAt: r.occurredAt.toISOString(),
  recordedAt: r.recordedAt.toISOString(),
  windowStart: r.windowStart ? r.windowStart.toISOString() : null,
  windowEnd: r.windowEnd ? r.windowEnd.toISOString() : null,
  // Ausente é `raw`: os registros gravados antes deste campo existirem eram todos
  // brutos, e ler "sem tipo" como bruto é a leitura verdadeira deles.
  recordKind: r.recordKind ?? 'raw',
  value: r.value,
})

export interface RecorderPublic {
  id: string
  name: string
  enabled: boolean
  source: DataSourceDefinition
  mode: RecorderMode
  entityKeyPath: string | null
  occurredAtPath: string | null
  intervalMs: number | null
  schedule: RecorderSchedule | null
  persistPolicy: PersistPolicy
  filters: RecorderFilter[]
  selectedFields: string[] | null
  aggregations: AggregationRule[]
  changePath: string | null
  retentionDays: number | null
  recordCount: number
  lastRecordAt: string | null
  lastError: { message: string; at: string } | null
  createdAt: string
  updatedAt: string
}

export const recorderPublic = (r: DataRecorderDefinition): RecorderPublic => ({
  id: r._id.toString(),
  name: r.name,
  enabled: r.enabled,
  source: r.source,
  mode: r.mode,
  entityKeyPath: r.entityKeyPath,
  occurredAtPath: r.occurredAtPath,
  intervalMs: r.intervalMs,
  schedule: r.schedule,
  persistPolicy: r.persistPolicy ?? 'aggregate_only',
  filters: r.filters,
  selectedFields: r.selectedFields,
  aggregations: r.aggregations,
  changePath: r.changePath,
  retentionDays: r.retentionDays,
  recordCount: r.recordCount,
  lastRecordAt: r.lastRecordAt ? r.lastRecordAt.toISOString() : null,
  lastError: r.lastError ? { message: r.lastError.message, at: r.lastError.at.toISOString() } : null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
})

// --- limites ---------------------------------------------------------------------
// Um histórico sem teto é um banco cheio por acidente. Todos configuráveis, todos com
// um padrão que já serve.

export const MAX_RECORDERS_PER_OWNER = Number(process.env.DATA_HISTORY_MAX_RECORDERS ?? 20)
export const MAX_RECORDS_PER_RECORDER = Number(process.env.DATA_HISTORY_MAX_RECORDS ?? 500_000)
export const MAX_VALUE_BYTES = Number(process.env.DATA_HISTORY_MAX_VALUE_BYTES ?? 16_000)
export const MAX_VALUE_DEPTH = Number(process.env.DATA_HISTORY_MAX_DEPTH ?? 8)
export const MIN_INTERVAL_MS = Number(process.env.DATA_HISTORY_MIN_INTERVAL_MS ?? 10_000)
export const MAX_INTERVAL_MS = Number(process.env.DATA_HISTORY_MAX_INTERVAL_MS ?? 86_400_000)
export const DEFAULT_RETENTION_DAYS = Number(process.env.DATA_HISTORY_RETENTION_DAYS ?? 90)
export const MAX_RETENTION_DAYS = Number(process.env.DATA_HISTORY_MAX_RETENTION_DAYS ?? 365)
/** Teto de leitura: uma consulta que devolve tudo é uma consulta que derruba o processo. */
export const MAX_QUERY_LIMIT = Number(process.env.DATA_HISTORY_MAX_QUERY ?? 1_000)
