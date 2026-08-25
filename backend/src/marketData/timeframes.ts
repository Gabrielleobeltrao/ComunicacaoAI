import type { Timeframe } from './types.js'

/**
 * Os baldes de tempo, puros e em UTC.
 *
 * UTC não é preferência: um balde de 1 dia que muda de tamanho duas vezes por ano
 * porque o fuso local mudou é um balde que produz duas velas erradas por ano, sempre
 * num domingo de madrugada, e ninguém descobre.
 */
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1D': 24 * 60 * 60_000,
}

/**
 * De qual timeframe cada um é montado.
 *
 * Sempre do MENOR imediatamente abaixo: montar 1h direto de 1m custaria sessenta
 * dobras em vez de quatro, e daria o mesmo resultado. `1m` não tem pai — ele vem dos
 * negócios.
 */
export const AGGREGATES_FROM: Record<Timeframe, Timeframe | null> = {
  '1m': null,
  '5m': '1m',
  '15m': '5m',
  '1h': '15m',
  '4h': '1h',
  '1D': '1h',
}

/** Para quem cada timeframe fechado precisa ser dobrado. */
export const AGGREGATES_TO: Record<Timeframe, Timeframe[]> = {
  '1m': ['5m'],
  '5m': ['15m'],
  '15m': ['1h'],
  '1h': ['4h', '1D'],
  '4h': [],
  '1D': [],
}

/**
 * O início do balde que contém este instante.
 *
 * Todos os tamanhos daqui dividem o dia exatamente, então alinhar pela época funciona
 * para todos — inclusive `4h`, que fica em 00, 04, 08, 12, 16 e 20 UTC, e `1D`, que
 * fica na meia-noite UTC.
 */
export function bucketStart(at: Date | number, timeframe: Timeframe): number {
  const ms = typeof at === 'number' ? at : at.getTime()
  const passo = TIMEFRAME_MS[timeframe]
  return Math.floor(ms / passo) * passo
}

export const bucketEnd = (start: number, timeframe: Timeframe): number => start + TIMEFRAME_MS[timeframe]

/** O balde já acabou no relógio? Fechar antes disso é fechar uma vela que ainda muda. */
export const bucketIsOver = (start: number, timeframe: Timeframe, now: Date | number = Date.now()): boolean =>
  (typeof now === 'number' ? now : now.getTime()) >= bucketEnd(start, timeframe)
