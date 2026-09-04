import { ErroDeFuncao, registerFunction } from './functionRegistry.js'

// INDICADORES — a conta que um modelo de linguagem não pode fazer.
//
// "Calcule o RSI destes candles" parece uma pergunta para o modelo, e ele responde: dá um
// número plausível, com a confiança de sempre, e erra em silêncio. Uma média que muda de
// valor entre duas perguntas iguais não é uma média.
//
// Aqui a conta é determinística e versionada. Três coisas que isso garante e nenhum prompt
// garantiria:
//
//   MESMA ENTRADA, MESMA SAÍDA. Sempre. É o que permite comparar a leitura de hoje com a de
//   ontem e concluir alguma coisa da diferença.
//
//   DADO INSUFICIENTE É RECUSA, NÃO ESTIMATIVA. O RSI de 14 períodos precisa de 15 preços.
//   Com 8, a resposta honesta é dizer quantos faltam — um número calculado sobre menos dados
//   do que a definição pede é um número errado com cara de certo.
//
//   NENHUMA FONTE ESCONDIDA. Esta função não sabe de onde vêm os preços e não vai buscá-los.
//   Ela recebe a série que alguém autorizado leu. Sem provedor de candles, o que existe é uma
//   pendência para conectar um — nunca um endereço inventado aqui dentro.

/** O padrão de mercado. Declarado como constante porque ele aparece na mensagem de recusa. */
export const RSI_PERIODO_PADRAO = 14

export interface RsiInput {
  /** Os preços de fechamento, do mais ANTIGO para o mais recente. */
  closes: number[]
  period?: number
}

export interface RsiOutput {
  rsi: number
  period: number
  /** Quantos preços entraram na conta. Sem isto, não dá para saber sobre o que ela fala. */
  samples: number
  /** A definição usada, para o resultado ser reproduzível fora daqui. */
  method: 'wilder'
}

/**
 * O RSI de Wilder — a definição que os gráficos usam.
 *
 * A primeira média é aritmética sobre os `period` primeiros movimentos; as seguintes são
 * suavizadas por Wilder. Usar média simples em todas as janelas dá um número parecido e
 * diferente do que a pessoa vê no gráfico dela — e "parecido" é o pior resultado possível,
 * porque ninguém percebe.
 */
export function calculateRsi(closes: number[], period = RSI_PERIODO_PADRAO): RsiOutput {
  const p = Math.trunc(period)
  if (!Number.isFinite(p) || p < 2) throw new ErroDeFuncao('o período do RSI precisa ser um inteiro de 2 para cima.')
  if (p > 200) throw new ErroDeFuncao('período grande demais: use até 200.')

  const serie = (Array.isArray(closes) ? closes : []).map((v) => Number(v))
  if (serie.some((v) => !Number.isFinite(v))) {
    throw new ErroDeFuncao('a série tem valor que não é número: não vou calcular sobre dado quebrado.')
  }
  /**
   * DADO INSUFICIENTE é recusa com o número que falta.
   *
   * "Não consegui calcular" manda a pessoa adivinhar; "faltam 7 fechamentos" diz o que fazer.
   */
  const minimo = p + 1
  if (serie.length < minimo) {
    throw new ErroDeFuncao(`o RSI de ${p} períodos precisa de ${minimo} fechamentos; recebi ${serie.length}. Faltam ${minimo - serie.length}.`)
  }

  const ganhos: number[] = []
  const perdas: number[] = []
  for (let i = 1; i < serie.length; i += 1) {
    const d = serie[i] - serie[i - 1]
    ganhos.push(d > 0 ? d : 0)
    perdas.push(d < 0 ? -d : 0)
  }

  let mediaGanho = ganhos.slice(0, p).reduce((a, b) => a + b, 0) / p
  let mediaPerda = perdas.slice(0, p).reduce((a, b) => a + b, 0) / p
  for (let i = p; i < ganhos.length; i += 1) {
    mediaGanho = (mediaGanho * (p - 1) + ganhos[i]) / p
    mediaPerda = (mediaPerda * (p - 1) + perdas[i]) / p
  }

  /**
   * Sem perdas, o RSI é 100 por definição — e não uma divisão por zero.
   *
   * Uma série que só sobe é o caso mais comum de estouro aqui, e devolver `Infinity` ou `NaN`
   * faria o monitor comparar contra um valor que nenhuma condição reconhece.
   */
  const rsi = mediaPerda === 0 ? (mediaGanho === 0 ? 50 : 100) : 100 - 100 / (1 + mediaGanho / mediaPerda)

  // Duas casas: mais que isso é ruído do ponto flutuante, não precisão.
  return { rsi: Math.round(rsi * 100) / 100, period: p, samples: serie.length, method: 'wilder' }
}

registerFunction({
  functionName: 'calculate_rsi',
  version: '1.0.0',
  description: 'Calcula o RSI (Wilder) de uma série de fechamentos. Determinístico: a mesma série dá sempre o mesmo número.',
  capabilities: ['calcular', 'indicador'],
  inputSchema: {
    type: 'object',
    properties: {
      closes: {
        type: 'array',
        items: { type: 'number' },
        minItems: 3,
        maxItems: 5000,
        description: 'Fechamentos, do mais antigo para o mais recente',
      },
      period: { type: 'integer', minimum: 2, maximum: 200, description: `Períodos do RSI (padrão ${RSI_PERIODO_PADRAO})` },
    },
    required: ['closes'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      rsi: { type: 'number' },
      period: { type: 'integer' },
      samples: { type: 'integer' },
      method: { type: 'string' },
    },
    required: ['rsi', 'period', 'samples', 'method'],
    additionalProperties: false,
  },
  handler: (input) => {
    const bruto = (input ?? {}) as { closes?: unknown; period?: unknown }
    if (!Array.isArray(bruto.closes)) throw new ErroDeFuncao('informe `closes`: a série de fechamentos, do mais antigo para o mais recente.')
    return calculateRsi(bruto.closes as number[], bruto.period === undefined ? RSI_PERIODO_PADRAO : Number(bruto.period))
  },
  // A conta é local e sobre uma série no máximo de 5000 pontos: um segundo é folga.
  timeoutMs: 1000,
  metadata: { family: 'indicador', deterministic: 'true' },
  /**
   * A SÉRIE que ela consome — declarada para quem monta a cadeia.
   *
   * 14 períodos exigem 15 fechamentos, e é isso que `extra: 1` diz. O plano lê daqui em vez
   * de guardar essa regra do lado dele: a definição do RSI mora na função que o calcula.
   */
  series: { arg: 'closes', windowParam: 'period', extra: 1, minimum: RSI_PERIODO_PADRAO + 1 },
})
