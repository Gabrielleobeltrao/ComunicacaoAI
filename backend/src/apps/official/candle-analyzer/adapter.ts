// As três ações, expostas pelo mesmo contrato de ferramenta que todo App usa.
//
// Sem rede, sem credencial e sem modelo: cada `run` valida a entrada e chama uma função
// pura. Um erro de entrada volta como recusa estruturada — o agente precisa saber que a
// análise NÃO aconteceu, e não receber um resultado vazio que pareça uma resposta.
import type { ResolvedTool } from '../../../agentTools.js'
import type { NativeFactory } from '../../types.js'
import { analyze } from './analyze.js'
import { CandleInputError, parseLabel, parseSeries } from './candles.js'
import { computeIndicators } from './indicators.js'
import { detectPatterns } from './patterns.js'
import { manifest } from './manifest.js'

const acao = manifest.actions.reduce<Record<string, (typeof manifest.actions)[number]>>((m, a) => ({ ...m, [a.key]: a }), {})

// Uma entrada inválida é dita como tal. `executed: false` é explícito porque um agente
// que recebe prosa ("não foi possível") já foi visto relatando o resultado como se a
// ação tivesse acontecido.
const recusa = (tool: string, erro: unknown) => ({
  ok: false,
  result: JSON.stringify({
    status: 'invalid_input',
    executed: false,
    tool,
    reason: erro instanceof Error ? erro.message : 'entrada inválida',
    instruction: 'A análise NÃO foi feita. Corrija os dados enviados; não invente um resultado.',
  }),
})

const rodar = (nome: string, fn: (args: Record<string, unknown>) => unknown): ResolvedTool['run'] => async (args) => {
  try {
    return { ok: true, result: JSON.stringify(fn(args)) }
  } catch (erro) {
    if (erro instanceof CandleInputError) return recusa(nome, erro)
    throw erro
  }
}

const comuns = (args: Record<string, unknown>) => ({
  symbol: parseLabel(args.symbol, 'symbol'),
  timeframe: parseLabel(args.timeframe, 'timeframe'),
  closedOnly: args.closedOnly !== false,
})

const listaDeTexto = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined

export const candleAnalyzerTools = (): ResolvedTool[] => [
  {
    name: 'candles_calculate_indicators',
    description: acao.candles_calculate_indicators.description,
    inputSchema: acao.candles_calculate_indicators.inputSchema,
    run: rodar('candles_calculate_indicators', (args) => {
      const base = comuns(args)
      const { candles, warnings } = parseSeries(args.candles, { closedOnly: base.closedOnly })
      return {
        schemaVersion: 1,
        symbol: base.symbol,
        timeframe: base.timeframe,
        candleCount: candles.length,
        lastClosedAt: candles[candles.length - 1].timestamp,
        indicators: computeIndicators(candles),
        warnings,
      }
    }),
  },
  {
    name: 'candles_detect_patterns',
    description: acao.candles_detect_patterns.description,
    inputSchema: acao.candles_detect_patterns.inputSchema,
    run: rodar('candles_detect_patterns', (args) => {
      const base = comuns(args)
      const { candles, warnings } = parseSeries(args.candles, { closedOnly: base.closedOnly })
      const patterns = detectPatterns(candles, listaDeTexto(args.patterns))
      return {
        schemaVersion: 1,
        symbol: base.symbol,
        timeframe: base.timeframe,
        candleCount: candles.length,
        lastClosedAt: candles[candles.length - 1].timestamp,
        patterns,
        warnings,
      }
    }),
  },
  {
    name: 'candles_find_opportunities',
    description: acao.candles_find_opportunities.description,
    inputSchema: acao.candles_find_opportunities.inputSchema,
    run: rodar('candles_find_opportunities', (args) => {
      const base = comuns(args)
      return analyze(args, {
        ...base,
        patterns: listaDeTexto(args.patterns),
        minimumScore: typeof args.minimumScore === 'number' ? args.minimumScore : undefined,
      })
    }),
  },
]

// A fábrica ignora dono e configuração: não há credencial nem seleção de recurso para
// injetar. A assinatura é a do contrato comum para o resolvedor de grants não precisar
// de um caminho especial.
export const adapters: NativeFactory[] = [() => candleAnalyzerTools()]
