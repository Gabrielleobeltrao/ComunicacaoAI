import { publishEvent, onEvent } from '../events/bus.js'
import type { PlatformEvent } from '../events/types.js'
import { closeCandle, closedSeries, dueCandles, foldChild, foldTrade, isDue } from './candleStore.js'
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
export async function closeDueCandles(now = new Date(), limite = 200): Promise<{ closed: number; published: number }> {
  const candidatas = await dueCandles(now, limite)
  let closed = 0
  let published = 0
  for (const aberta of candidatas) {
    if (!isDue(aberta, now)) continue
    const fechada = await closeCandle(aberta._id, now)
    if (!fechada) continue
    closed += 1
    const { created } = await publishEvent(
      {
        ownerId: fechada.ownerId,
        type: 'market.candle.closed',
        source: `${fechada.provider}:${fechada.environment}`,
        schemaVersion: MARKET_SCHEMA_VERSION,
        payload: {
          ownerId: fechada.ownerId,
          provider: fechada.provider,
          installationId: fechada.installationId,
          environment: fechada.environment,
          symbol: fechada.symbol,
          timeframe: fechada.timeframe,
          candle: toCandle(fechada),
        },
        occurredAt: new Date(fechada.bucketStart),
        // A identidade da VELA, não do momento em que fechou: reiniciar no meio da
        // varredura não pode produzir um segundo evento da mesma vela.
        dedupeKey: `candle:${fechada.provider}:${fechada.installationId}:${fechada.symbol}:${fechada.timeframe}:${fechada.bucketStart}`,
      },
      now,
    )
    if (created) published += 1
    // E sobe: a vela fechada é a matéria-prima da vela maior.
    await foldChild(chaveDa(fechada), fechada, now)
  }
  return { closed, published }
}

/**
 * O motor escuta o barramento em vez de o stream chamá-lo direto.
 *
 * É o que faz o dado sobreviver a um restart no meio do caminho: o evento já está
 * guardado quando o motor o vê, e reprocessar é seguro porque dobrar o mesmo negócio
 * duas vezes é impedido pela entrega única do barramento.
 */
export function registerMarketDataHandlers(): void {
  onEvent('market.price.updated', async (event) => {
    const { key, trade } = parseTradeEvent(event)
    // Um evento de outra conta que a do payload seria dado cruzando de dono.
    if (key.ownerId !== event.ownerId) throw new MarketContractError('o evento e o payload discordam sobre o dono')
    await ingestTrade(key, trade)
  })
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
