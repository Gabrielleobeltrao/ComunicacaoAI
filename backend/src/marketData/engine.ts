import { publishEvent, onEvent } from '../events/bus.js'
import type { PlatformEvent } from '../events/types.js'
import { closeCandle, closedSeries, dueCandles, foldChild, foldTrade, isDue, markFolded, markPublished, pendingCandles } from './candleStore.js'
import type { SeriesKey } from './candleStore.js'
import { rememberQuote, rememberTrade } from './state.js'
import { recordTick } from './ticks.js'
import { MARKET_SCHEMA_VERSION, toCandle } from './types.js'
import type { Quote, StoredCandle, Timeframe, Trade } from './types.js'
import type { Candle } from '../apps/official/candle-analyzer/candles.js'

/**
 * O MOTOR de dados de mercado.
 *
 * Ele não fala com provider nenhum: recebe evento interno, dobra em vela e publica
 * vela fechada. Zero chamada de modelo, zero token — esta camada é aritmética, e
 * colocar um modelo aqui seria pagar por uma soma.
 */

export class MarketContractError extends Error {}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * O payload do evento vira contrato interno, ou é recusado com o motivo.
 *
 * Recusar é melhor que sanear: um `price` que veio como texto e virou zero é um número
 * plausível e errado, e a diferença entre erro e número errado é que o segundo alguém
 * usa.
 */
export function parseTradeEvent(event: Pick<PlatformEvent, 'payload' | 'schemaVersion'>): { key: SeriesKey; trade: Trade } {
  if (event.schemaVersion !== MARKET_SCHEMA_VERSION) {
    throw new MarketContractError(`versão de contrato desconhecida: ${event.schemaVersion}`)
  }
  const p = event.payload as Record<string, unknown>
  const price = num(p.price)
  const symbol = typeof p.symbol === 'string' ? p.symbol.trim().toUpperCase() : ''
  if (!symbol) throw new MarketContractError('symbol ausente')
  if (price === null || price <= 0) throw new MarketContractError('price precisa ser um número positivo')
  const at = p.at ? new Date(String(p.at)) : null
  if (!at || Number.isNaN(at.getTime())) throw new MarketContractError('at precisa ser uma data válida')
  for (const campo of ['ownerId', 'provider', 'installationId', 'environment'] as const) {
    if (typeof p[campo] !== 'string' || !p[campo]) throw new MarketContractError(`${campo} ausente`)
  }
  return {
    key: {
      ownerId: String(p.ownerId),
      provider: String(p.provider),
      installationId: String(p.installationId),
      environment: String(p.environment),
      symbol,
    },
    trade: { symbol, price, size: num(p.size) ?? 0, at, tradeId: typeof p.tradeId === 'string' ? p.tradeId : null },
  }
}

/**
 * Um negócio entra na série.
 *
 * Devolve o que aconteceu com ele, porque "ignorado" não é o mesmo que "processado":
 * um provider que só manda dado atrasado precisa ser visível, não silencioso.
 */
export async function ingestTrade(key: SeriesKey, trade: Trade, now = new Date()): Promise<'folded' | 'late' | 'dropped'> {
  const r = await foldTrade(key, trade, now)
  // A vela do balde já fechou: o negócio chegou tarde demais para mudar um número que
  // já foi publicado como fato.
  if (!r) return 'dropped'
  await rememberTrade(key, trade, now)
  await recordTick(key, trade, now)
  return r.late ? 'late' : 'folded'
}

export async function ingestQuote(key: SeriesKey, quote: Quote, now = new Date()): Promise<void> {
  await rememberQuote(key, quote, now)
}

const chaveDa = (c: StoredCandle): SeriesKey => ({
  ownerId: c.ownerId,
  provider: c.provider,
  installationId: c.installationId,
  environment: c.environment,
  symbol: c.symbol,
})

/**
 * Fechar tudo que já passou da hora, publicar e dobrar para cima.
 *
 * A publicação vem DEPOIS do fechamento no banco, e nunca antes: um
 * `market.candle.closed` de uma vela que ainda muda seria um fato falso — e alguém
 * decide em cima dele.
 *
 * Fechar é atômico: dois workers varrendo juntos, só um recebe o documento de volta.
 * A chave de dedupe do evento é a segunda rede — a que sobrevive a um restart no meio
 * da publicação.
 */
/**
 * Publicar o evento de uma vela fechada, e marcar que ele saiu.
 *
 * Duas escritas, e a ordem importa: publicar PRIMEIRO e marcar depois. Invertido, uma
 * queda no meio deixaria a vela marcada como publicada sem evento nenhum — e ninguém
 * mais olharia para ela. Nesta ordem, a queda no meio produz no máximo uma tentativa
 * repetida de publicar, que a chave de dedupe absorve.
 */
async function publicarVela(vela: StoredCandle, now: Date): Promise<boolean> {
  const { created } = await publishEvent(
    {
      ownerId: vela.ownerId,
      type: 'market.candle.closed',
      source: `${vela.provider}:${vela.environment}`,
      schemaVersion: MARKET_SCHEMA_VERSION,
      payload: {
        ownerId: vela.ownerId,
        provider: vela.provider,
        installationId: vela.installationId,
        environment: vela.environment,
        symbol: vela.symbol,
        timeframe: vela.timeframe,
        candle: toCandle(vela),
      },
      occurredAt: new Date(vela.bucketStart),
      // A identidade da VELA, não do momento em que fechou: reiniciar no meio da
      // varredura não pode produzir um segundo evento da mesma vela.
      dedupeKey: `candle:${vela.provider}:${vela.installationId}:${vela.symbol}:${vela.timeframe}:${vela.bucketStart}`,
    },
    now,
  )
  await markPublished(vela._id, now)
  return created
}

/**
 * Fechar o que venceu, publicar o que ainda não foi publicado, dobrar o que ainda não
 * subiu — nesta ordem, e cada parte retomável sozinha.
 *
 * A varredura não assume que a passada anterior terminou. Ela olha para MARCAS no
 * documento, não para o que aconteceu na memória de um processo que pode ter morrido.
 */
export async function closeDueCandles(now = new Date(), limite = 200): Promise<{ closed: number; published: number; folded: number }> {
  let closed = 0
  for (const aberta of await dueCandles(now, limite)) {
    if (!isDue(aberta, now)) continue
    if (await closeCandle(aberta._id, now)) closed += 1
  }

  // A retomada: tudo que está fechado e ficou pela metade — inclusive o que acabou de
  // fechar acima, e o que ficou de uma execução que morreu no meio.
  let published = 0
  let folded = 0
  for (const vela of await pendingCandles(limite)) {
    if (!vela.publishedAt) {
      if (await publicarVela(vela, now)) published += 1
    }
    if (!vela.foldedAt) {
      // A vela fechada é a matéria-prima da vela maior. Dobrar de novo não soma de
      // novo: o filtro do update exclui a filha que já entrou.
      await foldChild(chaveDa(vela), vela, now)
      await markFolded(vela._id, now)
      folded += 1
    }
  }
  return { closed, published, folded }
}

/**
 * O motor escuta o barramento em vez de o stream chamá-lo direto.
 *
 * É o que faz o dado sobreviver a um restart no meio do caminho: o evento já está
 * guardado quando o motor o vê, e reprocessar é seguro porque dobrar o mesmo negócio
 * duas vezes é impedido pela entrega única do barramento.
 */
export function registerMarketDataHandlers(): void {
  // O nome identifica o CONSUMIDOR. É por ele que uma retentativa sabe que este handler
  // já rodou para este evento — sem isso, o retry somaria o mesmo negócio de novo.
  onEvent('market.price.updated', 'marketData.ingestTrade', async (event) => {
    const { key, trade } = parseTradeEvent(event)
    // Um evento de outra conta que a do payload seria dado cruzando de dono.
    if (key.ownerId !== event.ownerId) throw new MarketContractError('o evento e o payload discordam sobre o dono')
    await ingestTrade(key, trade)
  })

  // A cotação não entra em vela: ninguém pagou aquele preço. Ela atualiza o estado
  // atual, e só.
  onEvent('market.quote.updated', 'marketData.ingestQuote', async (event) => {
    const { key, quote } = parseQuoteEvent(event)
    if (key.ownerId !== event.ownerId) throw new MarketContractError('o evento e o payload discordam sobre o dono')
    await ingestQuote(key, quote)
  })
}

/** O mesmo contrato do negócio, para a cotação — que tem dois lados e nenhum volume. */
export function parseQuoteEvent(event: Pick<PlatformEvent, 'payload' | 'schemaVersion'>): { key: SeriesKey; quote: Quote } {
  if (event.schemaVersion !== MARKET_SCHEMA_VERSION) {
    throw new MarketContractError(`versão de contrato desconhecida: ${event.schemaVersion}`)
  }
  const p = event.payload as Record<string, unknown>
  const symbol = typeof p.symbol === 'string' ? p.symbol.trim().toUpperCase() : ''
  const bid = num(p.bid)
  const ask = num(p.ask)
  if (!symbol) throw new MarketContractError('symbol ausente')
  if (bid === null || ask === null) throw new MarketContractError('uma cotação precisa dos dois lados')
  const at = p.at ? new Date(String(p.at)) : null
  if (!at || Number.isNaN(at.getTime())) throw new MarketContractError('at precisa ser uma data válida')
  for (const campo of ['ownerId', 'provider', 'installationId', 'environment'] as const) {
    if (typeof p[campo] !== 'string' || !p[campo]) throw new MarketContractError(`${campo} ausente`)
  }
  return {
    key: {
      ownerId: String(p.ownerId),
      provider: String(p.provider),
      installationId: String(p.installationId),
      environment: String(p.environment),
      symbol,
    },
    quote: { symbol, bid, ask, bidSize: num(p.bidSize) ?? 0, askSize: num(p.askSize) ?? 0, at },
  }
}

/**
 * A série pronta para análise, no contrato que o App de análise já recebe.
 *
 * É a linha inteira da integração: nenhum indicador nem padrão é recalculado aqui. O
 * analisador é bom no que faz, e uma segunda implementação seria uma segunda resposta
 * para a mesma pergunta.
 *
 * Só velas FECHADAS: analisar uma vela em formação é analisar um número que ainda vai
 * mudar, e o padrão reconhecido agora pode não existir daqui a dez minutos.
 */
export async function seriesForAnalysis(
  ownerId: string,
  q: { symbol: string; timeframe: Timeframe; provider?: string; installationId?: string; limit?: number },
): Promise<Candle[]> {
  const docs = await closedSeries(ownerId, q)
  return docs.map(toCandle)
}
