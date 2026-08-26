import { ErroDeFuncao, registerFunction } from './functionRegistry.js'
import type { FunctionContext } from './functionRegistry.js'

// As funções de DADO AO VIVO moram fora do registry de propósito.
//
// O `functionRegistry.ts` é puro: um teste lê a fonte dele e recusa relógio, rede e
// disco, porque uma função pura sempre devolve o mesmo para a mesma entrada e é isso
// que torna uma execução reproduzível. Estas quatro não são puras — elas existem para
// LER estado que muda sozinho — e por isso ficam aqui, num arquivo que assume isso no
// nome e no comentário, em vez de enfraquecer a regra do outro.
//
// O que elas continuam sendo: leitura, com o dono no filtro, com teto de tempo, e sem
// nenhuma noção de corretora, símbolo ou mercado. A chave é o que o mapeamento da
// conexão produziu — pode ser um papel, um par de moedas ou um sensor.

// Quatro funções de LEITURA sobre o Live Data Store: o cálculo — RSI, média móvel, OHLC,
// regra de risco — acontece em código, sobre o valor de agora, sem um modelo no caminho.

const CONEXAO_SCHEMA = {
  type: 'object',
  properties: { connectionId: { type: 'string', minLength: 1, description: 'A conexão de WebSocket' } },
  required: ['connectionId'],
} as const

const VALOR_SCHEMA = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    value: {},
    updates: { type: 'number' },
    receivedAt: { type: 'string' },
    ageMs: { type: 'number' },
  },
} as const

/** O DTO. `ageMs` porque "de quando é este preço" é a primeira pergunta de quem calcula. */
const comIdade = (r: { key: string; value: unknown; updates: number; receivedAt: Date } | null, agora = Date.now()) =>
  r ? { key: r.key, value: r.value, updates: r.updates, receivedAt: r.receivedAt.toISOString(), ageMs: agora - r.receivedAt.getTime() } : null

const exigirDono = (ctx?: FunctionContext): string => {
  if (!ctx?.ownerId) throw new ErroDeFuncao('esta função só roda dentro de uma execução com dono.')
  return ctx.ownerId
}

registerFunction({
  functionName: 'liveData.get',
  version: '1.0.0',
  description: 'O último valor recebido para uma chave numa conexão de WebSocket.',
  capabilities: ['tempo real', 'dados'],
  inputSchema: {
    type: 'object',
    properties: { ...CONEXAO_SCHEMA.properties, key: { type: 'string', minLength: 1, description: 'A chave, ex.: AAPL' } },
    required: ['connectionId', 'key'],
  },
  outputSchema: { type: 'object', properties: { found: { type: 'boolean' }, record: VALOR_SCHEMA } },
  timeoutMs: 3_000,
  handler: async (input, _config, ctx) => {
    const { getLiveValue } = await import('../integrations/websocket/liveData.js')
    const r = await getLiveValue(exigirDono(ctx), String(input.connectionId), String(input.key))
    return { found: Boolean(r), record: comIdade(r) }
  },
})

registerFunction({
  functionName: 'liveData.latest',
  version: '1.0.0',
  description: 'As chaves atualizadas mais recentemente numa conexão de WebSocket.',
  capabilities: ['tempo real', 'dados'],
  inputSchema: {
    type: 'object',
    properties: { ...CONEXAO_SCHEMA.properties, limit: { type: 'integer', minimum: 1, maximum: 200 } },
    required: ['connectionId'],
  },
  outputSchema: { type: 'object', properties: { count: { type: 'number' }, records: { type: 'array', items: VALOR_SCHEMA } } },
  timeoutMs: 3_000,
  handler: async (input, _config, ctx) => {
    const { latestLiveValues } = await import('../integrations/websocket/liveData.js')
    const rs = await latestLiveValues(exigirDono(ctx), String(input.connectionId), Number(input.limit ?? 50))
    return { count: rs.length, records: rs.map((r) => comIdade(r)) }
  },
})

registerFunction({
  functionName: 'liveData.list',
  version: '1.0.0',
  description: 'As chaves de uma conexão, em ordem, opcionalmente filtradas por prefixo.',
  capabilities: ['tempo real', 'dados'],
  inputSchema: {
    type: 'object',
    properties: {
      ...CONEXAO_SCHEMA.properties,
      prefix: { type: 'string', description: 'Só as chaves que começam assim' },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
    required: ['connectionId'],
  },
  outputSchema: { type: 'object', properties: { count: { type: 'number' }, records: { type: 'array', items: VALOR_SCHEMA } } },
  timeoutMs: 3_000,
  handler: async (input, _config, ctx) => {
    const { listLiveValues } = await import('../integrations/websocket/liveData.js')
    const rs = await listLiveValues(exigirDono(ctx), String(input.connectionId), String(input.prefix ?? ''), Number(input.limit ?? 100))
    return { count: rs.length, records: rs.map((r) => comIdade(r)) }
  },
})

registerFunction({
  functionName: 'liveData.waitFor',
  version: '1.0.0',
  description: 'Espera uma chave satisfazer uma condição, ou desiste no prazo.',
  capabilities: ['tempo real', 'dados'],
  inputSchema: {
    type: 'object',
    properties: {
      ...CONEXAO_SCHEMA.properties,
      key: { type: 'string', minLength: 1 },
      /**
       * A condição é DECLARADA, não escrita.
       *
       * Um campo "expressão" aqui seria uma linha de código — e uma linha de código
       * escrita na configuração de um agente e executada pelo servidor. O que estes
       * operadores não cobrem, o código do agente pergunta depois de receber o valor.
       */
      path: { type: 'string', description: 'Campo dentro do valor. Vazio = o valor inteiro.' },
      operator: { type: 'string', enum: ['exists', 'equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'contains', 'changed'] },
      value: {},
      timeoutMs: { type: 'integer', minimum: 100, maximum: 8_000 },
    },
    required: ['connectionId', 'key', 'operator'],
  },
  outputSchema: { type: 'object', properties: { matched: { type: 'boolean' }, record: VALOR_SCHEMA } },
  /**
   * Dez segundos, que é o teto da plataforma para qualquer função registrada — e a
   * espera cabe dentro dele.
   *
   * Uma espera mais longa que isso não é caso de função: é caso de rotina, que roda de
   * tempos em tempos e não segura uma execução. Abrir exceção no teto por uma função
   * seria abrir o teto para todas.
   */
  timeoutMs: 10_000,
  handler: async (input, _config, ctx) => {
    const { waitForLiveValue } = await import('../integrations/websocket/liveData.js')
    const r = await waitForLiveValue(
      exigirDono(ctx),
      String(input.connectionId),
      String(input.key),
      { path: input.path ? String(input.path) : undefined, operator: input.operator as never, value: input.value },
      Number(input.timeoutMs ?? 5_000),
    )
    return { matched: r.matched, record: comIdade(r.record) }
  },
})
