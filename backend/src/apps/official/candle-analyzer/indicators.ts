// Indicadores. Funções puras: a mesma série devolve o mesmo número, sempre.
//
// A reprodutibilidade não é preciosismo. Um agente que decide com base num número que
// varia entre execuções é impossível de depurar: o dono vê "oportunidade encontrada"
// e, ao repetir a análise, não vê. Nada aqui olha o relógio, sorteia ou acessa rede.
//
// Onde há mais de uma convenção — RSI e ATR têm — a escolhida é a de Wilder, que é a
// que as plataformas de gráfico usam. Um RSI calculado com média simples dá outro
// número, e o dono compararia com o gráfico dele e acharia que o nosso está errado.
import type { Candle } from './candles.js'

// Arredonda para o número não carregar ruído de ponto flutuante até a saída JSON.
const arred = (n: number, casas = 4): number => {
  const f = 10 ** casas
  return Math.round(n * f) / f
}

/** Média simples dos últimos `period` valores. `null` quando não há série suficiente. */
export function sma(valores: number[], period: number): number | null {
  if (period <= 0 || valores.length < period) return null
  let soma = 0
  for (let i = valores.length - period; i < valores.length; i++) soma += valores[i]
  return arred(soma / period)
}

/**
 * Média exponencial, semeada com a média simples do primeiro período.
 *
 * A semente importa: começar do primeiro valor faz a EMA levar dezenas de velas para
 * convergir, e as primeiras leituras ficariam sistematicamente erradas.
 */
export function ema(valores: number[], period: number): number | null {
  if (period <= 0 || valores.length < period) return null
  const k = 2 / (period + 1)
  let atual = valores.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < valores.length; i++) atual = valores[i] * k + atual * (1 - k)
  return arred(atual)
}

/**
 * RSI pela suavização de Wilder.
 *
 * Precisa de `period + 1` valores porque trabalha sobre as VARIAÇÕES: 15 fechamentos
 * dão 14 variações, que é o que um RSI(14) consome.
 */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null

  let ganhos = 0
  let perdas = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) ganhos += d
    else perdas -= d
  }
  let mediaGanho = ganhos / period
  let mediaPerda = perdas / period

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    const g = d > 0 ? d : 0
    const p = d < 0 ? -d : 0
    mediaGanho = (mediaGanho * (period - 1) + g) / period
    mediaPerda = (mediaPerda * (period - 1) + p) / period
  }

  // Sem nenhuma perda no período o RSI é 100 por definição — dividir por zero aqui
  // seria devolver NaN para um caso que tem resposta.
  if (mediaPerda === 0) return mediaGanho === 0 ? 50 : 100
  const rs = mediaGanho / mediaPerda
  return arred(100 - 100 / (1 + rs), 2)
}

// Amplitude real de uma vela: o maior entre a própria amplitude e os saltos em relação
// ao fechamento anterior. É o que faz o ATR enxergar gap de abertura.
export const trueRange = (atual: Candle, anterior: Candle | null): number =>
  anterior
    ? Math.max(atual.high - atual.low, Math.abs(atual.high - anterior.close), Math.abs(atual.low - anterior.close))
    : atual.high - atual.low

/** ATR pela suavização de Wilder — a mesma convenção do RSI acima. */
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null

  const trs: number[] = []
  for (let i = 1; i < candles.length; i++) trs.push(trueRange(candles[i], candles[i - 1]))
  if (trs.length < period) return null

  let atual = trs.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < trs.length; i++) atual = (atual * (period - 1) + trs[i]) / period
  return arred(atual)
}

/**
 * Volume da última vela em relação à média do período anterior.
 *
 * 1 é "volume normal", 2 é "o dobro do normal". A média EXCLUI a última vela de
 * propósito: incluí-la faria um pico diluir a própria referência e a leitura sempre
 * pareceria menos extrema do que é.
 */
export function relativeVolume(candles: Candle[], period = 20): number | null {
  if (candles.length < period + 1) return null
  const anteriores = candles.slice(-(period + 1), -1)
  const media = anteriores.reduce((a, c) => a + c.volume, 0) / anteriores.length
  if (media <= 0) return null
  return arred(candles[candles.length - 1].volume / media, 2)
}

export interface Indicators {
  sma20: number | null
  sma50: number | null
  ema9: number | null
  ema21: number | null
  rsi14: number | null
  atr14: number | null
  relativeVolume20: number | null
  lastClose: number
  // Onde o último fechamento está em relação às médias: é a leitura de tendência que
  // o escore usa, e o dono consegue conferir olhando o gráfico.
  aboveSma20: boolean | null
  aboveSma50: boolean | null
}

export function computeIndicators(candles: Candle[]): Indicators {
  const closes = candles.map((c) => c.close)
  const lastClose = closes[closes.length - 1]
  const s20 = sma(closes, 20)
  const s50 = sma(closes, 50)
  return {
    sma20: s20,
    sma50: s50,
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    rsi14: rsi(closes, 14),
    atr14: atr(candles, 14),
    relativeVolume20: relativeVolume(candles, 20),
    lastClose,
    aboveSma20: s20 === null ? null : lastClose > s20,
    aboveSma50: s50 === null ? null : lastClose > s50,
  }
}
