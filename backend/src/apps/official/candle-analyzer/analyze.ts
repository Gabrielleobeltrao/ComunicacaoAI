// A análise: padrões + indicadores → um sinal com escore e as razões dele.
//
// O que este arquivo NÃO faz, de propósito: não busca cotação, não fala com corretora,
// não emite BUY/SELL e não chama modelo. Ele descreve o que a série mostra e dá uma
// nota. Quem decide operar é gente, ou um App de risco que ainda não existe — e essa
// separação é o que impede um bug de padrão de virar uma ordem enviada.
//
// O escore é uma soma de fatores nomeados, e cada um que entra deixa uma frase em
// `reasons`. Um número sem razões é impossível de contestar: o dono veria "72" e não
// teria como saber se concorda.
import { computeIndicators } from './indicators.js'
import type { Indicators } from './indicators.js'
import { detectPatterns } from './patterns.js'
import type { DetectedPattern } from './patterns.js'
import { parseSeries } from './candles.js'
import type { Candle } from './candles.js'

// A versão do formato de saída. Existe porque este JSON vai para a memória e para
// condições configuradas pelo dono: mudar um campo sem avisar quebraria fluxos salvos.
export const SCHEMA_VERSION = 1

export type Direction = 'bullish' | 'bearish' | 'neutral'

export interface AnalysisResult {
  schemaVersion: number
  symbol: string
  timeframe: string
  candleCount: number
  lastClosedAt: number
  opportunityFound: boolean
  direction: Direction
  score: number
  patterns: DetectedPattern[]
  indicators: Indicators
  reasons: string[]
  warnings: string[]
}

// --- pesos ------------------------------------------------------------------------------
// Escritos aqui, somando 100 no cenário de concordância total. Não são calibrados
// contra mercado nenhum — são um ponto de partida explícito, e é melhor que estejam
// visíveis do que espalhados por condicionais.
const PESO_PADRAO = 45
const PESO_TENDENCIA = 20
const PESO_RSI = 20
const PESO_VOLUME = 15

const DIR_LABEL: Record<Direction, string> = { bullish: 'alta', bearish: 'baixa', neutral: 'indefinida' }

/**
 * A direção que os padrões apontam.
 *
 * Padrões contrários se cancelam: martelo (alta) junto de estrela cadente (baixa) na
 * mesma vela é ruído, não sinal, e chamar de qualquer um dos dois seria escolher pelo
 * acaso da ordem da lista.
 */
function direcaoDosPadroes(patterns: DetectedPattern[]): { direction: Direction; forca: number } {
  let alta = 0
  let baixa = 0
  for (const p of patterns) {
    if (p.direction === 'bullish') alta += p.strength
    if (p.direction === 'bearish') baixa += p.strength
  }
  if (alta === 0 && baixa === 0) return { direction: 'neutral', forca: 0 }
  if (Math.abs(alta - baixa) < 0.05) return { direction: 'neutral', forca: 0 }
  return alta > baixa ? { direction: 'bullish', forca: Math.min(1, alta) } : { direction: 'bearish', forca: Math.min(1, baixa) }
}

export interface AnalyzeOptions {
  symbol: string
  timeframe: string
  patterns?: readonly string[]
  minimumScore?: number
  closedOnly?: boolean
}

/** A análise sobre uma série já validada. Pura e reproduzível. */
export function analyzeSeries(candles: Candle[], warnings: string[], opts: AnalyzeOptions): AnalysisResult {
  const indicators = computeIndicators(candles)
  const patterns = detectPatterns(candles, opts.patterns)
  const reasons: string[] = []
  const avisos = [...warnings]

  const { direction: dirPadrao, forca } = direcaoDosPadroes(patterns)
  let score = 0
  let direction: Direction = dirPadrao

  if (patterns.length === 0) {
    reasons.push('Nenhum padrão reconhecido na última vela fechada.')
  } else {
    for (const p of patterns) reasons.push(`${p.name}: ${p.detail}`)
  }

  if (dirPadrao !== 'neutral') {
    score += PESO_PADRAO * forca
  } else if (patterns.length > 0) {
    reasons.push('Os padrões encontrados apontam para lados opostos — tratado como indefinido.')
  }

  // Tendência: o fechamento acima ou abaixo das médias, na MESMA direção do padrão.
  // Uma reversão de alta contra tendência de baixa não ganha ponto de tendência — é
  // justamente o caso em que ela costuma falhar.
  if (dirPadrao !== 'neutral' && indicators.aboveSma20 !== null) {
    const aFavor = dirPadrao === 'bullish' ? indicators.aboveSma20 : !indicators.aboveSma20
    if (aFavor) {
      score += PESO_TENDENCIA
      reasons.push(`Fechamento ${dirPadrao === 'bullish' ? 'acima' : 'abaixo'} da média de 20 períodos, a favor do padrão.`)
    } else {
      reasons.push('A média de 20 períodos aponta contra o padrão encontrado.')
    }
  }

  // RSI: sobrevenda reforça reversão de alta; sobrecompra reforça reversão de baixa.
  if (indicators.rsi14 !== null && dirPadrao !== 'neutral') {
    const rsi = indicators.rsi14
    if (dirPadrao === 'bullish' && rsi <= 30) {
      score += PESO_RSI
      reasons.push(`RSI em ${rsi}: região de sobrevenda, coerente com reversão de alta.`)
    } else if (dirPadrao === 'bearish' && rsi >= 70) {
      score += PESO_RSI
      reasons.push(`RSI em ${rsi}: região de sobrecompra, coerente com reversão de baixa.`)
    } else {
      reasons.push(`RSI em ${rsi}: sem extremo que reforce o padrão.`)
    }
  }

  // Volume: um padrão com volume acima do normal foi visto por mais gente.
  if (indicators.relativeVolume20 !== null && dirPadrao !== 'neutral') {
    const rv = indicators.relativeVolume20
    if (rv >= 1.5) {
      score += PESO_VOLUME
      reasons.push(`Volume ${rv}× a média das últimas 20 velas.`)
    } else {
      reasons.push(`Volume ${rv}× a média: sem destaque.`)
    }
  }

  // Avisos sobre o que não pôde ser considerado — para o escore não parecer completo
  // quando metade dos fatores ficou de fora por falta de série.
  if (indicators.rsi14 === null) avisos.push('Série curta para RSI(14): o fator não entrou no escore.')
  if (indicators.sma20 === null) avisos.push('Série curta para média de 20: o fator de tendência não entrou no escore.')
  if (indicators.relativeVolume20 === null) avisos.push('Sem volume comparável: o fator de volume não entrou no escore.')

  score = Math.max(0, Math.min(100, Math.round(score)))
  if (score === 0) direction = 'neutral'

  const minimo = typeof opts.minimumScore === 'number' && Number.isFinite(opts.minimumScore) ? Math.max(0, Math.min(100, opts.minimumScore)) : 60
  const opportunityFound = direction !== 'neutral' && score >= minimo

  reasons.push(
    opportunityFound
      ? `Escore ${score} atinge o mínimo de ${minimo}: oportunidade de ${DIR_LABEL[direction]}.`
      : `Escore ${score} não atinge o mínimo de ${minimo}: nada a fazer.`,
  )

  return {
    schemaVersion: SCHEMA_VERSION,
    symbol: opts.symbol,
    timeframe: opts.timeframe,
    candleCount: candles.length,
    lastClosedAt: candles[candles.length - 1].timestamp,
    opportunityFound,
    direction,
    score,
    patterns,
    indicators,
    reasons,
    warnings: avisos,
  }
}

// A entrada crua vira análise. É este o caminho que as ações do App usam.
export function analyze(input: Record<string, unknown>, opts: AnalyzeOptions): AnalysisResult {
  const { candles, warnings } = parseSeries(input.candles, { closedOnly: opts.closedOnly })
  return analyzeSeries(candles, warnings, opts)
}
