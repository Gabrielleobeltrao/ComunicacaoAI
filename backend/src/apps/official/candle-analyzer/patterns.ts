// Padrões de candle. Puros, e com os limiares escritos em vez de escondidos.
//
// Todo padrão de candle é uma REGRA COM LIMIAR: "corpo pequeno", "sombra longa",
// "engolfa". Onde exatamente cai o corte é convenção, e livro nenhum concorda com o
// outro. Deixar os números aqui, nomeados, é o que permite alguém discordar e ajustar
// — e é o que faz o resultado ser explicável ("sombra inferior 2,4× o corpo") em vez
// de um veredito.
//
// Nada aqui diz para comprar ou vender. Um padrão é uma observação sobre a forma das
// velas; o que fazer com ela não é decisão deste App.
import type { Candle } from './candles.js'

export interface DetectedPattern {
  key: string
  name: string
  direction: 'bullish' | 'bearish' | 'neutral'
  // 0..1. Quão bem a vela se encaixa na regra — não "quão provável é dar certo".
  strength: number
  // Em português e com o número que motivou. É isto que o dono lê.
  detail: string
  at: number
}

// --- limiares -----------------------------------------------------------------------------
// Corpo até 10% da amplitude é "sem corpo" (doji). Sombra a partir de 2× o corpo é
// "longa". A sombra oposta de um martelo tem que ser pequena — até 1× o corpo — senão
// a vela é só volátil, não um martelo.
const DOJI_BODY = 0.1
const LONG_SHADOW = 2
const SMALL_OPPOSITE = 1
// Corpo a partir de 60% da amplitude é "corpo cheio", usado nas estrelas.
const FULL_BODY = 0.6
// A vela do meio de uma estrela precisa ser pequena em relação às vizinhas.
const STAR_BODY = 0.5

const corpo = (c: Candle): number => Math.abs(c.close - c.open)
const amplitude = (c: Candle): number => c.high - c.low
const sombraSup = (c: Candle): number => c.high - Math.max(c.open, c.close)
const sombraInf = (c: Candle): number => Math.min(c.open, c.close) - c.low
const alta = (c: Candle): boolean => c.close > c.open
const baixa = (c: Candle): boolean => c.close < c.open
const meio = (c: Candle): number => (c.open + c.close) / 2

// Vela sem amplitude nenhuma (preço travado) não tem forma para ler. Devolver 0 aqui
// evita divisão por zero em todos os padrões abaixo.
const proporcaoCorpo = (c: Candle): number => (amplitude(c) === 0 ? 0 : corpo(c) / amplitude(c))

const limitar = (n: number): number => Math.max(0, Math.min(1, Math.round(n * 100) / 100))

// --- padrões de uma vela -------------------------------------------------------------------

export function doji(c: Candle): DetectedPattern | null {
  if (amplitude(c) === 0) return null
  const prop = proporcaoCorpo(c)
  if (prop > DOJI_BODY) return null
  return {
    key: 'doji',
    name: 'Doji',
    // Abertura e fechamento praticamente iguais: indecisão, não direção.
    direction: 'neutral',
    strength: limitar(1 - prop / DOJI_BODY),
    detail: `Corpo de ${(prop * 100).toFixed(1)}% da amplitude: abertura e fechamento praticamente no mesmo lugar.`,
    at: c.timestamp,
  }
}

export function hammer(c: Candle): DetectedPattern | null {
  const b = corpo(c)
  if (b === 0 || amplitude(c) === 0) return null
  const inf = sombraInf(c)
  const sup = sombraSup(c)
  if (inf < b * LONG_SHADOW) return null
  if (sup > b * SMALL_OPPOSITE) return null
  return {
    key: 'hammer',
    name: 'Martelo',
    direction: 'bullish',
    strength: limitar(inf / (b * LONG_SHADOW * 2)),
    detail: `Sombra inferior ${(inf / b).toFixed(1)}× o corpo: o preço caiu no meio da vela e voltou.`,
    at: c.timestamp,
  }
}

export function shootingStar(c: Candle): DetectedPattern | null {
  const b = corpo(c)
  if (b === 0 || amplitude(c) === 0) return null
  const sup = sombraSup(c)
  const inf = sombraInf(c)
  if (sup < b * LONG_SHADOW) return null
  if (inf > b * SMALL_OPPOSITE) return null
  return {
    key: 'shooting_star',
    name: 'Estrela cadente',
    direction: 'bearish',
    strength: limitar(sup / (b * LONG_SHADOW * 2)),
    detail: `Sombra superior ${(sup / b).toFixed(1)}× o corpo: o preço subiu no meio da vela e devolveu.`,
    at: c.timestamp,
  }
}

// --- padrões de duas velas ------------------------------------------------------------------

export function bullishEngulfing(anterior: Candle, atual: Candle): DetectedPattern | null {
  if (!baixa(anterior) || !alta(atual)) return null
  // O corpo atual precisa cobrir o anterior inteiro — é isso que "engolfar" quer dizer.
  if (atual.open > Math.min(anterior.open, anterior.close)) return null
  if (atual.close < Math.max(anterior.open, anterior.close)) return null
  const anteriorCorpo = corpo(anterior)
  if (anteriorCorpo === 0) return null
  return {
    key: 'bullish_engulfing',
    name: 'Engolfo de alta',
    direction: 'bullish',
    strength: limitar(corpo(atual) / (anteriorCorpo * 2)),
    detail: `Vela de alta cobre inteira a vela de baixa anterior (${(corpo(atual) / anteriorCorpo).toFixed(1)}× o corpo dela).`,
    at: atual.timestamp,
  }
}

export function bearishEngulfing(anterior: Candle, atual: Candle): DetectedPattern | null {
  if (!alta(anterior) || !baixa(atual)) return null
  if (atual.open < Math.max(anterior.open, anterior.close)) return null
  if (atual.close > Math.min(anterior.open, anterior.close)) return null
  const anteriorCorpo = corpo(anterior)
  if (anteriorCorpo === 0) return null
  return {
    key: 'bearish_engulfing',
    name: 'Engolfo de baixa',
    direction: 'bearish',
    strength: limitar(corpo(atual) / (anteriorCorpo * 2)),
    detail: `Vela de baixa cobre inteira a vela de alta anterior (${(corpo(atual) / anteriorCorpo).toFixed(1)}× o corpo dela).`,
    at: atual.timestamp,
  }
}

// --- padrões de três velas -------------------------------------------------------------------

export function morningStar(a: Candle, b: Candle, c: Candle): DetectedPattern | null {
  // Primeira de baixa com corpo cheio, segunda pequena, terceira de alta fechando
  // acima do meio da primeira: a reversão só conta se a terceira desfizer metade da
  // queda.
  if (!baixa(a) || proporcaoCorpo(a) < FULL_BODY) return null
  if (corpo(b) > corpo(a) * STAR_BODY) return null
  if (!alta(c) || c.close <= meio(a)) return null
  return {
    key: 'morning_star',
    name: 'Estrela da manhã',
    direction: 'bullish',
    strength: limitar((c.close - meio(a)) / Math.max(corpo(a), 1e-9)),
    detail: 'Queda com corpo cheio, indecisão, e uma vela de alta que devolve mais da metade da queda.',
    at: c.timestamp,
  }
}

export function eveningStar(a: Candle, b: Candle, c: Candle): DetectedPattern | null {
  if (!alta(a) || proporcaoCorpo(a) < FULL_BODY) return null
  if (corpo(b) > corpo(a) * STAR_BODY) return null
  if (!baixa(c) || c.close >= meio(a)) return null
  return {
    key: 'evening_star',
    name: 'Estrela da noite',
    direction: 'bearish',
    strength: limitar((meio(a) - c.close) / Math.max(corpo(a), 1e-9)),
    detail: 'Alta com corpo cheio, indecisão, e uma vela de baixa que devolve mais da metade da subida.',
    at: c.timestamp,
  }
}

export const PATTERN_KEYS = [
  'doji',
  'hammer',
  'shooting_star',
  'bullish_engulfing',
  'bearish_engulfing',
  'morning_star',
  'evening_star',
] as const
export type PatternKey = (typeof PATTERN_KEYS)[number]

/**
 * Os padrões presentes na PONTA da série.
 *
 * Só na ponta: um martelo de trinta velas atrás não é uma oportunidade agora, e
 * devolver o histórico inteiro de padrões daria ao agente uma lista para ele escolher
 * — o que é justamente a decisão que este App existe para não delegar a um modelo.
 */
export function detectPatterns(candles: Candle[], apenas?: readonly string[]): DetectedPattern[] {
  const quer = (k: PatternKey): boolean => !apenas || apenas.length === 0 || apenas.includes(k)
  const n = candles.length
  const ultima = candles[n - 1]
  const penultima = n >= 2 ? candles[n - 2] : null
  const antepenultima = n >= 3 ? candles[n - 3] : null

  const achados: (DetectedPattern | null)[] = [
    quer('doji') ? doji(ultima) : null,
    quer('hammer') ? hammer(ultima) : null,
    quer('shooting_star') ? shootingStar(ultima) : null,
    penultima && quer('bullish_engulfing') ? bullishEngulfing(penultima, ultima) : null,
    penultima && quer('bearish_engulfing') ? bearishEngulfing(penultima, ultima) : null,
    antepenultima && penultima && quer('morning_star') ? morningStar(antepenultima, penultima, ultima) : null,
    antepenultima && penultima && quer('evening_star') ? eveningStar(antepenultima, penultima, ultima) : null,
  ]

  return achados.filter((p): p is DetectedPattern => p !== null)
}
