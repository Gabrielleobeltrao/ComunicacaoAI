// A DSL DE CONSULTA — pequena, fechada e validada no servidor.
//
// A alternativa seria deixar o agente mandar um filtro de Mongo. Ela é tentadora e é a
// porta aberta: `$where` executa JavaScript, `$function` executa JavaScript, `$lookup`
// atravessa coleções, e um `$regex` mal construído derruba o banco com backtracking. Não
// existe lista de bloqueio confiável para uma linguagem inteira — existe lista de
// PERMISSÃO para o que a consulta precisa.
//
// O que passa é o que está aqui: campos declarados no schema, sete operadores, `and`/`or`
// com profundidade limitada, ordenação por campo conhecido e paginação com teto. Tudo o
// mais é recusado com o motivo — e "recusado com o motivo" importa: um filtro silenciosamente
// ignorado devolveria a tabela inteira para uma pergunta que pedia uma linha.

export const OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'] as const
export type QueryOperator = (typeof OPERATORS)[number]

export const MAX_FILTER_DEPTH = 3
export const MAX_FILTER_NODES = 30
export const MAX_LIMIT = 500
export const DEFAULT_LIMIT = 50
export const MAX_IN_VALUES = 50
export const MAX_STRING_LENGTH = 500

export type QueryFilter =
  | { field: string; op: QueryOperator; value: unknown }
  | { and: QueryFilter[] }
  | { or: QueryFilter[] }

export interface QuerySpec {
  filter?: QueryFilter | null
  fields?: string[] | null
  sort?: { field: string; direction: 'asc' | 'desc' }[] | null
  limit?: number
  skip?: number
}

export class QueryDslError extends Error {
  constructor(
    message: string,
    readonly code = 'invalid_query',
  ) {
    super(message)
  }
}

/** Os campos que o schema declara. Consultar fora deles é consultar o que não existe. */
export function schemaFields(schema: Record<string, unknown>): string[] {
  const props = (schema?.properties ?? {}) as Record<string, unknown>
  return Object.keys(props)
}

const ehEscalar = (v: unknown): boolean =>
  v === null || ['string', 'number', 'boolean'].includes(typeof v) || v instanceof Date

function validarValor(v: unknown, op: QueryOperator): unknown {
  if (op === 'in') {
    if (!Array.isArray(v)) throw new QueryDslError('"in" espera uma lista')
    if (v.length === 0 || v.length > MAX_IN_VALUES) throw new QueryDslError(`"in" aceita de 1 a ${MAX_IN_VALUES} valores`)
    return v.map((x) => validarValor(x, 'eq'))
  }
  if (!ehEscalar(v)) throw new QueryDslError('o valor precisa ser texto, número, booleano ou data')
  if (typeof v === 'string') {
    if (v.length > MAX_STRING_LENGTH) throw new QueryDslError(`texto acima de ${MAX_STRING_LENGTH} caracteres`)
    return v
  }
  return v
}

/**
 * A árvore validada — e a contagem de nós, que é o que impede a bomba.
 *
 * Um filtro com mil `or` aninhados passa em qualquer validação de forma e derruba o banco
 * na execução. Profundidade sozinha não resolve: mil irmãos têm profundidade 1.
 */
function validarFiltro(f: unknown, campos: Set<string>, profundidade: number, contador: { n: number }): QueryFilter {
  if (profundidade > MAX_FILTER_DEPTH) throw new QueryDslError(`o filtro passou de ${MAX_FILTER_DEPTH} níveis`)
  if (++contador.n > MAX_FILTER_NODES) throw new QueryDslError(`o filtro passou de ${MAX_FILTER_NODES} condições`)
  if (!f || typeof f !== 'object' || Array.isArray(f)) throw new QueryDslError('condição inválida')

  const node = f as Record<string, unknown>
  for (const chave of ['and', 'or'] as const) {
    if (node[chave] !== undefined) {
      if (!Array.isArray(node[chave]) || (node[chave] as unknown[]).length === 0) throw new QueryDslError(`"${chave}" espera uma lista de condições`)
      const filhos = (node[chave] as unknown[]).map((x) => validarFiltro(x, campos, profundidade + 1, contador))
      return chave === 'and' ? { and: filhos } : { or: filhos }
    }
  }

  const field = String(node.field ?? '')
  if (!campos.has(field)) throw new QueryDslError(`o campo "${field}" não existe neste dataset`, 'unknown_field')
  const op = String(node.op ?? '') as QueryOperator
  if (!OPERATORS.includes(op)) throw new QueryDslError(`operador "${op}" não é permitido`, 'unknown_operator')
  return { field, op, value: validarValor(node.value, op) }
}

export function parseQuery(bruto: unknown, schema: Record<string, unknown>): QuerySpec {
  const q = (bruto ?? {}) as Record<string, unknown>
  const campos = new Set(schemaFields(schema))
  if (campos.size === 0) throw new QueryDslError('este dataset não declara campos', 'no_schema')

  const filter = q.filter === undefined || q.filter === null ? null : validarFiltro(q.filter, campos, 1, { n: 0 })

  let fields: string[] | null = null
  if (q.fields !== undefined && q.fields !== null) {
    if (!Array.isArray(q.fields)) throw new QueryDslError('"fields" espera uma lista')
    fields = q.fields.map((f) => String(f))
    for (const f of fields) if (!campos.has(f)) throw new QueryDslError(`o campo "${f}" não existe neste dataset`, 'unknown_field')
  }

  let sort: QuerySpec['sort'] = null
  if (q.sort !== undefined && q.sort !== null) {
    if (!Array.isArray(q.sort)) throw new QueryDslError('"sort" espera uma lista')
    if (q.sort.length > 3) throw new QueryDslError('ordene por no máximo 3 campos')
    sort = q.sort.map((s) => {
      const item = (s ?? {}) as Record<string, unknown>
      const field = String(item.field ?? '')
      if (!campos.has(field)) throw new QueryDslError(`o campo "${field}" não existe neste dataset`, 'unknown_field')
      const direction = item.direction === 'desc' ? 'desc' : 'asc'
      return { field, direction }
    })
  }

  const limit = Math.min(Math.max(Number(q.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const skip = Math.max(Number(q.skip) || 0, 0)
  return { filter, fields, sort, limit, skip }
}

const MONGO_OP: Record<QueryOperator, string> = {
  eq: '$eq',
  ne: '$ne',
  gt: '$gt',
  gte: '$gte',
  lt: '$lt',
  lte: '$lte',
  in: '$in',
  contains: '$regex',
}

const escaparRegex = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A tradução para o filtro do banco — sobre um PREFIXO controlado.
 *
 * O prefixo (`value.`) é do servidor, e é o que impede um campo chamado `ownerId` de
 * virar um filtro sobre a coluna de dono: o campo do usuário nunca alcança a raiz do
 * documento, onde moram o escopo e a identidade.
 */
export function toMongoFilter(f: QueryFilter | null | undefined, prefixo = 'value.'): Record<string, unknown> {
  if (!f) return {}
  if ('and' in f) return { $and: f.and.map((x) => toMongoFilter(x, prefixo)) }
  if ('or' in f) return { $or: f.or.map((x) => toMongoFilter(x, prefixo)) }
  const caminho = `${prefixo}${f.field}`
  if (f.op === 'contains') {
    return { [caminho]: { $regex: escaparRegex(String(f.value)), $options: 'i' } }
  }
  return { [caminho]: { [MONGO_OP[f.op]]: f.value } }
}

export function toMongoSort(sort: QuerySpec['sort'], prefixo = 'value.'): Record<string, 1 | -1> {
  const fora: Record<string, 1 | -1> = {}
  for (const s of sort ?? []) fora[`${prefixo}${s.field}`] = s.direction === 'desc' ? -1 : 1
  return fora
}

export function toMongoProjection(fields: string[] | null | undefined, prefixo = 'value.'): Record<string, 1> | undefined {
  if (!fields || fields.length === 0) return undefined
  const fora: Record<string, 1> = {}
  for (const f of fields) fora[`${prefixo}${f}`] = 1
  return fora
}
