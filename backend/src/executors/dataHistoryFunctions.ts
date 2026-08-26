import { ErroDeFuncao, registerFunction } from './functionRegistry.js'
import type { FunctionContext } from './functionRegistry.js'

/**
 * O histórico, para quem calcula.
 *
 * Como as funções de dado ao vivo, elas moram fora do registry puro: leem estado que
 * muda sozinho. O que elas continuam sendo é LEITURA, com o dono no filtro, com teto de
 * tempo e de tamanho — e sem nenhuma noção de mercado. A chave é o que o recorder
 * gravou: pode ser um par de moedas, um SKU ou um sensor.
 *
 * Nenhum modelo participa de soma, média, mínimo, máximo ou OHLC. Uma média calculada
 * por um LLM é uma média que muda de valor entre duas perguntas iguais.
 */

const exigirDono = (ctx?: FunctionContext): string => {
  if (!ctx?.ownerId) throw new ErroDeFuncao('esta função só roda dentro de uma execução com dono.')
  return ctx.ownerId
}

/**
 * O registro, como a tool devolve.
 *
 * `entityKey`, `windowStart` e `windowEnd` ficam SEM tipo declarado de propósito: eles
 * são texto ou nulo, e o validador de contrato — que recusa o que não bate — trataria
 * `null` num campo `string` como quebra de contrato. Já `value` é livre por natureza:
 * ele carrega o que o recorder gravou, que muda de um histórico para outro.
 */
const REGISTRO_SCHEMA = {
  type: 'object',
  properties: {
    entityKey: {},
    occurredAt: { type: 'string' },
    windowStart: {},
    windowEnd: {},
    value: { type: 'object', additionalProperties: true },
  },
  additionalProperties: false,
} as const

const BASE = {
  recorderId: { type: 'string', minLength: 1, description: 'Qual histórico' },
  entityKey: { type: 'string', description: 'A chave, ex.: BTCUSDT ou SKU-1' },
} as const

const PERIODO = {
  from: { type: 'string', description: 'Início do período, ISO 8601' },
  to: { type: 'string', description: 'Fim do período, ISO 8601' },
} as const

const data = (v: unknown): Date | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) throw new ErroDeFuncao('data inválida: use ISO 8601, como 2026-01-01T00:00:00Z.')
  return d
}

const idDoRecorder = async (bruto: unknown) => {
  const { dataHistoryRecorderId } = await import('../dataHistory/engine.js')
  const id = dataHistoryRecorderId(String(bruto ?? ''))
  if (!id) throw new ErroDeFuncao('recorderId inválido.')
  return id
}

/** O DTO. Sempre o mesmo formato, venha de onde vier. */
const comoSaida = (r: {
  entityKey: string | null
  occurredAt: Date
  windowStart: Date | null
  windowEnd: Date | null
  value: Record<string, unknown>
}) => ({
  entityKey: r.entityKey,
  occurredAt: r.occurredAt.toISOString(),
  windowStart: r.windowStart ? r.windowStart.toISOString() : null,
  windowEnd: r.windowEnd ? r.windowEnd.toISOString() : null,
  value: r.value,
})

registerFunction({
  functionName: 'data_history.latest',
  version: '1.0.0',
  description: 'O registro mais recente de uma chave num histórico.',
  capabilities: ['dados', 'histórico'],
  inputSchema: { type: 'object', properties: { ...BASE }, required: ['recorderId'] },
  outputSchema: { type: 'object', properties: { found: { type: 'boolean' }, record: REGISTRO_SCHEMA } },
  timeoutMs: 5_000,
  handler: async (input, _config, ctx) => {
    const { ultimoRegistro } = await import('../dataHistory/store.js')
    const r = await ultimoRegistro(exigirDono(ctx), await idDoRecorder(input.recorderId), input.entityKey ? String(input.entityKey) : null)
    return { found: Boolean(r), record: r ? comoSaida(r) : null }
  },
})

registerFunction({
  functionName: 'data_history.range',
  version: '1.0.0',
  description: 'Os registros de um período, do mais novo para o mais antigo.',
  capabilities: ['dados', 'histórico'],
  inputSchema: {
    type: 'object',
    properties: {
      ...BASE,
      ...PERIODO,
      limit: { type: 'integer', minimum: 1, maximum: 1000 },
      order: { type: 'string', enum: ['asc', 'desc'] },
    },
    required: ['recorderId'],
  },
  outputSchema: { type: 'object', properties: { count: { type: 'number' }, records: { type: 'array', items: REGISTRO_SCHEMA } } },
  timeoutMs: 8_000,
  handler: async (input, _config, ctx) => {
    const { listarRegistros } = await import('../dataHistory/store.js')
    const rs = await listarRegistros(exigirDono(ctx), {
      recorderId: await idDoRecorder(input.recorderId),
      entityKey: input.entityKey ? String(input.entityKey) : null,
      from: data(input.from),
      to: data(input.to),
      limit: Number(input.limit ?? 100),
      order: input.order === 'asc' ? 'asc' : 'desc',
    })
    return { count: rs.length, records: rs.map(comoSaida) }
  },
})

registerFunction({
  functionName: 'data_history.aggregate',
  version: '1.0.0',
  description: 'first, last, min, max, avg, sum e count sobre um período — calculados pelo banco.',
  capabilities: ['dados', 'histórico'],
  inputSchema: {
    type: 'object',
    properties: {
      ...BASE,
      ...PERIODO,
      aggregations: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Campo dentro do valor, ex.: price' },
            op: { type: 'string', enum: ['first', 'last', 'min', 'max', 'avg', 'sum', 'count'] },
            to: { type: 'string', description: 'Nome do resultado, ex.: open' },
          },
          required: ['op', 'to'],
        },
      },
    },
    required: ['recorderId', 'aggregations'],
  },
  outputSchema: { type: 'object', properties: { result: { type: 'object', additionalProperties: true } } },
  timeoutMs: 8_000,
  handler: async (input, _config, ctx) => {
    const { agregarRegistros } = await import('../dataHistory/store.js')
    const { normalizeMappingPath, normalizeMappingTarget } = await import('../integrations/websocket/mapping.js')
    const regras = (Array.isArray(input.aggregations) ? input.aggregations : []).map((a, i) => {
      const item = (a ?? {}) as Record<string, unknown>
      const op = String(item.op ?? '')
      if (!['first', 'last', 'min', 'max', 'avg', 'sum', 'count'].includes(op)) throw new ErroDeFuncao(`agregação ${i + 1}: operação desconhecida.`)
      return {
        // O mesmo normalizador da configuração — o que bloqueia protótipo e expressão
        // ali bloqueia aqui, porque uma tool também recebe entrada de fora.
        from: op === 'count' ? '' : normalizeMappingPath(item.from, `agregação ${i + 1}`),
        op: op as 'first',
        to: normalizeMappingTarget(item.to, `agregação ${i + 1}`),
      }
    })
    const r = await agregarRegistros(
      exigirDono(ctx),
      {
        recorderId: await idDoRecorder(input.recorderId),
        entityKey: input.entityKey ? String(input.entityKey) : null,
        from: data(input.from),
        to: data(input.to),
      },
      regras,
    )
    return { result: r }
  },
})

registerFunction({
  functionName: 'data_history.series',
  version: '1.0.0',
  description: 'A série de um campo no tempo, pronta para calcular — pares de instante e valor.',
  capabilities: ['dados', 'histórico'],
  inputSchema: {
    type: 'object',
    properties: {
      ...BASE,
      ...PERIODO,
      field: { type: 'string', description: 'Qual campo do valor virar a série, ex.: close' },
      limit: { type: 'integer', minimum: 1, maximum: 1000 },
    },
    required: ['recorderId', 'field'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      count: { type: 'number' },
      points: { type: 'array', items: { type: 'object', properties: { at: { type: 'string' }, value: {} }, additionalProperties: false } },
    },
  },
  timeoutMs: 8_000,
  handler: async (input, _config, ctx) => {
    const { listarRegistros } = await import('../dataHistory/store.js')
    const { readPath } = await import('../automations/conditions.js')
    const { normalizeMappingPath } = await import('../integrations/websocket/mapping.js')
    const campo = normalizeMappingPath(input.field, 'campo')
    // Em ordem crescente, sempre: uma série que serve para calcular é uma série no
    // sentido do tempo. Quem quiser o mais recente primeiro usa `range`.
    const rs = await listarRegistros(exigirDono(ctx), {
      recorderId: await idDoRecorder(input.recorderId),
      entityKey: input.entityKey ? String(input.entityKey) : null,
      from: data(input.from),
      to: data(input.to),
      limit: Number(input.limit ?? 500),
      order: 'asc',
    })
    const points = rs.map((r) => ({ at: r.occurredAt.toISOString(), value: readPath(r.value, campo) ?? null }))
    return { count: points.length, points }
  },
})
