import type { ObjectId } from 'mongodb'
import type { Candle } from '../apps/official/candle-analyzer/candles.js'

/**
 * OS CONTRATOS do dado de mercado, versionados.
 *
 * Cada provider fala um dialeto: um manda `p`, outro `price`, outro `Price`; um manda
 * epoch em segundos, outro ISO com fuso. Traduzir isso na entrada — e só na entrada —
 * é o que permite ter um motor de candles, e não um por corretora.
 *
 * A versão existe para o consumidor poder RECUSAR em vez de adivinhar: um payload de
 * versão desconhecida não é "parecido o suficiente".
 */
export const MARKET_SCHEMA_VERSION = 1

/** Um negócio fechado. É o fato mais granular que o motor usa. */
export interface Trade {
  symbol: string
  price: number
  size: number
  /** Quando aconteceu no mercado — não quando chegou aqui. */
  at: Date
  /** O id do provider, quando existe. É o que torna o eco reconhecível. */
  tradeId: string | null
}

/** A melhor oferta de cada lado. Não entra em candle: cotação não é negócio. */
export interface Quote {
  symbol: string
  bid: number
  ask: number
  bidSize: number
  askSize: number
  at: Date
}

/** Uma vela pronta, vinda do próprio provider. */
export interface Bar {
  symbol: string
  timeframe: Timeframe
  at: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1D'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]
export const isTimeframe = (v: unknown): v is Timeframe => TIMEFRAMES.includes(v as Timeframe)

/**
 * A vela guardada.
 *
 * O formato de saída é o `Candle` que o App de análise já recebe — mesmo campo, mesmo
 * significado. Um segundo formato de vela seria um segundo lugar onde `high` pode
 * estar errado.
 */
export interface StoredCandle {
  _id: ObjectId
  ownerId: string
  /** Quem produziu o dado: a chave do App. Duas corretoras discordam, e tudo bem. */
  provider: string
  /** A conexão. Duas contas na mesma corretora são duas séries. */
  installationId: string
  environment: string
  symbol: string
  timeframe: Timeframe
  /** Início do balde, em milissegundos UTC. É a identidade da vela. */
  bucketStart: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  /** Quantos negócios entraram. Zero numa vela agregada de outra vela. */
  trades: number
  /**
   * A hora da fonte mais ANTIGA já dobrada aqui — o negócio que abriu, ou a primeira
   * vela filha. É ela que permite reconhecer um dado atrasado e corrigir a abertura em
   * vez de deixar a primeira mensagem a chegar decidir.
   */
  openedFrom?: number
  /** A fonte mais RECENTE, pelo mesmo motivo, do outro lado: quem define o fechamento. */
  lastChildAt?: number
  closed: boolean
  closedAt: Date | null
  /**
   * Quando o `market.candle.closed` desta vela foi publicado.
   *
   * É um outbox recuperável, e existe por causa de uma janela real: fechar a vela e
   * publicar o evento eram duas escritas, e uma queda entre elas deixava a vela fechada
   * sem evento — para sempre, porque a varredura só procurava vela ABERTA. Agora ela
   * também procura vela fechada e não publicada.
   */
  publishedAt?: Date | null
  /** Quando esta vela já foi dobrada na maior. Mesmo motivo: a queda no meio. */
  foldedAt?: Date | null
  /**
   * Quais filhas já entraram nesta vela, pelo início do balde delas.
   *
   * Sem isto, dobrar duas vezes somaria o volume duas vezes — e uma retomada depois de
   * uma queda dobra de novo por definição.
   */
  foldedChildren?: number[]
  /** Retenção: candle fechado some sozinho depois do prazo. */
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** O que sai para quem consome — o mesmo contrato do analisador de candles. */
export const toCandle = (c: StoredCandle): Candle => ({
  timestamp: c.bucketStart,
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
  volume: c.volume,
  closed: c.closed,
})

/**
 * O último preço conhecido, por conta e ambiente.
 *
 * Não é histórico: é o estado atual, e expira sozinho. Guardar isto para sempre seria
 * guardar uma série temporal num documento que só sabe o último valor.
 */
export interface MarketState {
  _id: ObjectId
  ownerId: string
  provider: string
  installationId: string
  environment: string
  symbol: string
  price: number | null
  bid: number | null
  ask: number | null
  /** A hora do FATO mais recente já visto. É ela que decide o que é atraso. */
  at: Date
  expiresAt: Date
  updatedAt: Date
}
