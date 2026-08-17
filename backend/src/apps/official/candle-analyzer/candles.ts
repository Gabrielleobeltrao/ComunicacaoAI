// Validação da entrada, antes de qualquer cálculo.
//
// Este App recebe candles de qualquer origem — um App de dados, um webhook de
// corretora, uma planilha. Nenhuma delas garante o que manda: chega `high` menor que
// `low`, chega `close` como string, chega a mesma vela duas vezes, chega fora de
// ordem.
//
// Calcular sobre isso não dá erro — dá um número. Um RSI computado sobre uma série
// com vela repetida é um número plausível e errado, e a diferença entre "erro" e
// "número errado" é que o segundo alguém usa. Por isso a entrada é recusada, com o
// motivo, em vez de saneada em silêncio.

export interface Candle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  // Vela ainda em formação muda até fechar. Analisar uma vela aberta é analisar um
  // número que vai mudar — o padrão detectado agora pode não existir em dez minutos.
  closed: boolean
}

export class CandleInputError extends Error {}

// Teto de velas por chamada. Acima disto o payload deixa de ser uma janela de análise
// e passa a ser um despejo de histórico — que não melhora o resultado e enche a
// memória se alguém decidir guardar.
export const MAX_CANDLES = 500
// Abaixo disto os indicadores não têm série suficiente para significar algo. RSI(14)
// precisa de 15 velas; menos que isso devolveria um número sem base.
export const MIN_CANDLES = 15

const ehNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Uma vela crua vira `Candle`, ou o motivo de não virar.
 *
 * A coerência do OHLC é conferida porque ela é a única forma de detectar dado
 * corrompido sem conhecer o ativo: `high` é, por definição, o maior dos quatro. Se não
 * for, a série não descreve um mercado.
 */
export function parseCandle(raw: unknown, indice: number): Candle {
  const onde = `candles[${indice}]`
  if (typeof raw !== 'object' || raw === null) throw new CandleInputError(`${onde}: cada vela precisa ser um objeto`)
  const c = raw as Record<string, unknown>

  for (const campo of ['timestamp', 'open', 'high', 'low', 'close'] as const) {
    if (!ehNumero(c[campo])) throw new CandleInputError(`${onde}.${campo}: precisa ser um número finito`)
  }
  // Volume ausente é comum em alguns provedores; zero é um valor legítimo.
  const volume = ehNumero(c.volume) ? c.volume : 0
  if (volume < 0) throw new CandleInputError(`${onde}.volume: não pode ser negativo`)

  const open = c.open as number
  const high = c.high as number
  const low = c.low as number
  const close = c.close as number

  if (high < low) throw new CandleInputError(`${onde}: high (${high}) é menor que low (${low})`)
  if (high < Math.max(open, close)) throw new CandleInputError(`${onde}: high (${high}) é menor que open/close`)
  if (low > Math.min(open, close)) throw new CandleInputError(`${onde}: low (${low}) é maior que open/close`)
  if (open <= 0 || close <= 0) throw new CandleInputError(`${onde}: preço precisa ser positivo`)

  return {
    timestamp: c.timestamp as number,
    open,
    high,
    low,
    close,
    volume,
    // Ausente é tratado como FECHADA: quase todo provedor só envia o que fechou, e
    // recusar a série inteira por falta de um campo opcional seria pior.
    closed: c.closed === undefined ? true : c.closed === true,
  }
}

export interface ParsedSeries {
  candles: Candle[]
  // O que foi deixado de fora e por quê. Aparece na saída para o dono não achar que
  // analisamos mais do que analisamos.
  warnings: string[]
}

/**
 * A série inteira, validada e ordenada.
 *
 * Timestamps repetidos são recusados, não deduplicados: a mesma vela duas vezes
 * significa que a origem está enviando errado, e escolher qual das duas manter é um
 * palpite sobre dados de mercado.
 */
export function parseSeries(raw: unknown, opts: { closedOnly?: boolean; minimum?: number } = {}): ParsedSeries {
  if (!Array.isArray(raw)) throw new CandleInputError('candles: precisa ser uma lista')
  if (raw.length === 0) throw new CandleInputError('candles: a lista está vazia')
  if (raw.length > MAX_CANDLES) throw new CandleInputError(`candles: ${raw.length} velas passa do limite de ${MAX_CANDLES}`)

  const todas = raw.map(parseCandle)

  const vistos = new Set<number>()
  for (const c of todas) {
    if (vistos.has(c.timestamp)) throw new CandleInputError(`candles: o timestamp ${c.timestamp} aparece mais de uma vez`)
    vistos.add(c.timestamp)
  }

  // Ordenar é seguro — a ordem cronológica é a única correta e não há ambiguidade.
  const ordenadas = [...todas].sort((a, b) => a.timestamp - b.timestamp)
  const warnings: string[] = []
  if (ordenadas.some((c, i) => todas[i]?.timestamp !== c.timestamp)) {
    warnings.push('As velas chegaram fora de ordem e foram ordenadas por timestamp.')
  }

  const closedOnly = opts.closedOnly !== false
  const abertas = ordenadas.filter((c) => !c.closed).length
  const usadas = closedOnly ? ordenadas.filter((c) => c.closed) : ordenadas
  if (closedOnly && abertas > 0) {
    warnings.push(`${abertas} vela(s) ainda em formação foram ignoradas: elas mudam até fechar.`)
  }

  const minimo = Math.max(opts.minimum ?? MIN_CANDLES, 2)
  if (usadas.length < minimo) {
    throw new CandleInputError(`candles: ${usadas.length} vela(s) fechada(s) — são necessárias ao menos ${minimo}`)
  }

  return { candles: usadas, warnings }
}

// Símbolo e timeframe são rótulos: viajam para a saída e para a memória sem serem
// interpretados. O App não conhece corretora nenhuma, e é isso que o torna
// reaproveitável.
export function parseLabel(raw: unknown, campo: string, obrigatorio = true): string {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (!v && obrigatorio) throw new CandleInputError(`${campo}: obrigatório`)
  if (v.length > 40) throw new CandleInputError(`${campo}: longo demais`)
  return v
}
