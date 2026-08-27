import { ObjectId } from 'mongodb'
import { ErroDeFuncao, registerFunction } from './functionRegistry.js'
import type { FunctionContext } from './functionRegistry.js'

/**
 * As fontes em tempo real, para AGENTES DE CÓDIGO.
 *
 * Elas leem o mesmo leitor que a ferramenta do agente de LLM — o que o modelo vê é o
 * que o código vê. E leem sem modelo nenhum no caminho: um agente de código que
 * consulta um preço não gasta token, porque não há inferência envolvida. É por isso que
 * cálculo — média, variação, regra de risco — se faz aqui.
 *
 * Como as outras funções que leem estado que muda sozinho, elas moram fora do registry
 * puro. O que continuam sendo: leitura, com o DONO e o AGENTE no filtro, com teto de
 * tempo, e sem nenhuma noção de mercado — a chave é o que a conexão produziu.
 */

const exigirAgente = (ctx?: FunctionContext): { ownerId: string; agentId: ObjectId } => {
  if (!ctx?.ownerId) throw new ErroDeFuncao('esta função só roda dentro de uma execução com dono.')
  // Sem agente não há concessão a conferir — e conceder para "qualquer um da conta"
  // seria exatamente o que o vínculo por agente existe para impedir.
  if (!ctx.agentId || !ObjectId.isValid(ctx.agentId)) throw new ErroDeFuncao('esta função só roda dentro de uma execução de agente.')
  return { ownerId: ctx.ownerId, agentId: new ObjectId(ctx.agentId) }
}

const LEITURA_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    alias: { type: 'string' },
    key: { type: 'string' },
    /**
     * Livre por natureza, e NULO quando não há valor.
     *
     * Sem `type` de propósito: declarar `object` faria o `null` de "não encontrado"
     * quebrar o contrato, e um schema vazio recusaria todas as chaves quando há valor —
     * o validador entra no ramo de objeto pelo valor, não pelo tipo declarado.
     */
    value: { additionalProperties: true },
    receivedAt: {},
    ageMs: {},
    /** Velho: o valor volta junto, e quem chamou decide se ainda serve. */
    stale: { type: 'boolean' },
    updates: {},
  },
  additionalProperties: false,
} as const

registerFunction({
  functionName: 'realtime_data.get',
  version: '1.0.0',
  description: 'O valor de agora de uma fonte em tempo real concedida a este agente, com a idade dele.',
  capabilities: ['tempo real', 'dados'],
  inputSchema: {
    type: 'object',
    properties: { source: { type: 'string', minLength: 1, description: 'O nome da fonte, ex.: btc_price' } },
    required: ['source'],
  },
  outputSchema: LEITURA_SCHEMA,
  timeoutMs: 5_000,
  handler: async (input, _config, ctx) => {
    const { ownerId, agentId } = exigirAgente(ctx)
    const { resolverPorAlias, lerFonte } = await import('../realtimeSources/reader.js')
    const fonte = await resolverPorAlias(ownerId, agentId, String(input.source ?? ''))
    if (!fonte) throw new ErroDeFuncao(`a fonte "${String(input.source ?? '')}" não está disponível para este agente.`)
    return await lerFonte(fonte)
  },
})

registerFunction({
  functionName: 'realtime_data.list',
  version: '1.0.0',
  description: 'As fontes em tempo real concedidas a este agente, com o valor atual de cada uma.',
  capabilities: ['tempo real', 'dados'],
  inputSchema: { type: 'object', properties: { withValues: { type: 'boolean', description: 'Trazer o valor de cada fonte. Padrão: sim.' } }, required: [] },
  outputSchema: {
    type: 'object',
    properties: { count: { type: 'number' }, sources: { type: 'array', items: LEITURA_SCHEMA } },
    additionalProperties: false,
  },
  timeoutMs: 8_000,
  handler: async (input, _config, ctx) => {
    const { ownerId, agentId } = exigirAgente(ctx)
    const { fontesDoAgente } = await import('../realtimeSources/repository.js')
    const { lerFonte } = await import('../realtimeSources/reader.js')
    const lista = await fontesDoAgente(ownerId, agentId)
    if (input.withValues === false) {
      return {
        count: lista.length,
        sources: lista.map((f) => ({ found: false, alias: f.alias, key: f.key, value: null, receivedAt: null, ageMs: null, stale: false, updates: null })),
      }
    }
    return { count: lista.length, sources: await Promise.all(lista.map((f) => lerFonte(f))) }
  },
})

registerFunction({
  functionName: 'realtime_data.wait_for_condition',
  version: '1.0.0',
  description: 'Espera uma fonte em tempo real satisfazer uma condição — sem consultar em laço.',
  capabilities: ['tempo real', 'dados'],
  inputSchema: {
    type: 'object',
    properties: {
      source: { type: 'string', minLength: 1 },
      path: { type: 'string', minLength: 1, description: 'O campo a observar, ex.: price' },
      operator: { type: 'string', enum: ['exists', 'equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'contains', 'changed'] },
      value: {},
      timeoutSeconds: { type: 'number', minimum: 1, maximum: 8 },
    },
    required: ['source', 'path', 'operator'],
  },
  outputSchema: { type: 'object', properties: { ...LEITURA_SCHEMA.properties, matched: { type: 'boolean' } }, additionalProperties: false },
  // Dentro do teto de 10s que toda função registrada respeita: esperar mais do que a
  // execução inteira pode durar seria prometer o que não se cumpre.
  timeoutMs: 10_000,
  handler: async (input, _config, ctx) => {
    const { ownerId, agentId } = exigirAgente(ctx)
    const { resolverPorAlias, esperarFonte } = await import('../realtimeSources/reader.js')
    const fonte = await resolverPorAlias(ownerId, agentId, String(input.source ?? ''))
    if (!fonte) throw new ErroDeFuncao(`a fonte "${String(input.source ?? '')}" não está disponível para este agente.`)
    const segundos = Math.min(Math.max(1, Number(input.timeoutSeconds ?? 8)), 8)
    return await esperarFonte(
      fonte,
      { path: String(input.path ?? ''), operator: String(input.operator ?? 'exists'), value: input.value },
      segundos * 1000,
    )
  },
})
