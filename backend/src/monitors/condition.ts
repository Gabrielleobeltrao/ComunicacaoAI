// A CONDIÇÃO de um monitor — uma árvore fechada, avaliada sem modelo nenhum.
//
// "RSI cruzou 30 para cima" não é "RSI está acima de 30". A primeira é uma TRANSIÇÃO e só
// pode ser respondida comparando o agora com o antes; a segunda é um estado. Confundir as
// duas é o defeito clássico de monitor: ou ele dispara uma vez e nunca mais, ou dispara a
// cada tique enquanto a condição continua verdadeira.
//
// Nada aqui chama LLM. Um modelo avaliando condição a cada evento custa por tique, erra de
// vez em quando e não dá para reproduzir — três razões, e qualquer uma bastaria.

export type ComparisonOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne'
export const COMPARISON_OPS: readonly ComparisonOp[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'ne']

export type ConditionAst =
  | { kind: 'compare'; field: string; op: ComparisonOp; value: number | string | boolean }
  /** Compara com o valor ANTERIOR do mesmo campo — variação, e não nível. */
  | { kind: 'delta'; field: string; op: ComparisonOp; value: number; mode: 'absolute' | 'percent' }
  | { kind: 'and'; children: ConditionAst[] }
  | { kind: 'or'; children: ConditionAst[] }
  | { kind: 'not'; child: ConditionAst }

export const MAX_DEPTH = 4
export const MAX_NODES = 20

export class ConditionError extends Error {}

export function parseCondition(bruto: unknown, campos: string[], profundidade = 1, contador = { n: 0 }): ConditionAst {
  if (profundidade > MAX_DEPTH) throw new ConditionError(`a condição passou de ${MAX_DEPTH} níveis`)
  if (++contador.n > MAX_NODES) throw new ConditionError(`a condição passou de ${MAX_NODES} partes`)
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw new ConditionError('condição inválida')
  const n = bruto as Record<string, unknown>

  switch (n.kind) {
    case 'and':
    case 'or': {
      const filhos = Array.isArray(n.children) ? n.children : []
      if (filhos.length === 0) throw new ConditionError(`"${n.kind}" precisa de ao menos uma parte`)
      return { kind: n.kind, children: filhos.map((f) => parseCondition(f, campos, profundidade + 1, contador)) } as ConditionAst
    }
    case 'not':
      return { kind: 'not', child: parseCondition(n.child, campos, profundidade + 1, contador) }
    case 'delta':
    case 'compare': {
      const field = String(n.field ?? '')
      if (!campos.includes(field)) throw new ConditionError(`o campo "${field}" não existe nesta fonte`)
      const op = String(n.op ?? '') as ComparisonOp
      if (!COMPARISON_OPS.includes(op)) throw new ConditionError(`operador "${op}" não é permitido`)
      if (n.kind === 'delta') {
        const valor = Number(n.value)
        if (!Number.isFinite(valor)) throw new ConditionError('a variação precisa ser um número')
        return { kind: 'delta', field, op, value: valor, mode: n.mode === 'percent' ? 'percent' : 'absolute' }
      }
      const v = n.value
      if (v === null || v === undefined || (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean')) {
        throw new ConditionError('o valor precisa ser número, texto ou booleano')
      }
      return { kind: 'compare', field, op, value: v }
    }
    default:
      throw new ConditionError('tipo de condição desconhecido')
  }
}

/**
 * O número de um valor — ou `null` quando ele não é um número.
 *
 * `Number(null)` é 0 e `Number('')` é 0, e essa é a armadilha: um campo AUSENTE
 * dispararia "abaixo de 30" como se valesse zero. Ausência não é zero — e num monitor
 * essa diferença é o alarme que toca sozinho de madrugada.
 */
const numeroDe = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const comparar = (a: unknown, op: ComparisonOp, b: unknown): boolean => {
  if (op === 'eq') return a === b
  if (op === 'ne') return a !== b
  const x = numeroDe(a)
  const y = numeroDe(b)
  // Comparação numérica sobre algo que não é número é FALSA, e não um erro: uma fonte que
  // devolveu `null` num tique não pode derrubar o monitor nem disparar por engano.
  if (x === null || y === null) return false
  return op === 'gt' ? x > y : op === 'gte' ? x >= y : op === 'lt' ? x < y : x <= y
}

export interface Observation {
  value: Record<string, unknown>
  previous?: Record<string, unknown> | null
}

/** Avalia a árvore. Determinística: a mesma observação dá sempre a mesma resposta. */
export function evaluateCondition(ast: ConditionAst, obs: Observation): boolean {
  switch (ast.kind) {
    case 'and':
      return ast.children.every((c) => evaluateCondition(c, obs))
    case 'or':
      return ast.children.some((c) => evaluateCondition(c, obs))
    case 'not':
      return !evaluateCondition(ast.child, obs)
    case 'compare':
      return comparar(obs.value[ast.field], ast.op, ast.value)
    case 'delta': {
      const agora = numeroDe(obs.value[ast.field])
      const antes = numeroDe(obs.previous?.[ast.field])
      if (agora === null || antes === null) return false
      // Sem valor anterior não existe variação — e "não existe" é falso, nunca zero.
      const variacao = ast.mode === 'percent' ? (antes === 0 ? NaN : ((agora - antes) / Math.abs(antes)) * 100) : agora - antes
      if (!Number.isFinite(variacao)) return false
      return comparar(variacao, ast.op, ast.value)
    }
    default:
      return false
  }
}

export type TriggerMode = 'level' | 'enter' | 'exit' | 'cross_up' | 'cross_down' | 'change'
export const TRIGGER_MODES: readonly TriggerMode[] = ['level', 'enter', 'exit', 'cross_up', 'cross_down', 'change']

export interface TransitionInput {
  mode: TriggerMode
  was: boolean
  is: boolean
  /** Para `cross_up`/`cross_down`: o valor observado do campo comparado. */
  previousValue?: number | null
  currentValue?: number | null
  threshold?: number | null
  /** Para `change`: houve mudança de valor? */
  valueChanged?: boolean
}

/**
 * DISPAROU?
 *
 * `level` é o único que dispara enquanto a condição continua verdadeira — e por isso ele é
 * o que precisa de cooldown. Os outros são bordas: eles acontecem no instante da mudança,
 * e um monitor que os tratasse como nível avisaria a cada tique de um mercado parado.
 */
export function shouldTrigger(input: TransitionInput): boolean {
  switch (input.mode) {
    case 'level':
      return input.is
    case 'enter':
      return input.is && !input.was
    case 'exit':
      return !input.is && input.was
    case 'change':
      return Boolean(input.valueChanged)
    case 'cross_up': {
      const { previousValue: antes, currentValue: agora, threshold: limiar } = input
      if (antes === null || antes === undefined || agora === null || agora === undefined || limiar === null || limiar === undefined) return false
      // A borda de verdade: estava abaixo (ou igual) e passou para cima.
      return antes <= limiar && agora > limiar
    }
    case 'cross_down': {
      const { previousValue: antes, currentValue: agora, threshold: limiar } = input
      if (antes === null || antes === undefined || agora === null || agora === undefined || limiar === null || limiar === undefined) return false
      return antes >= limiar && agora < limiar
    }
    default:
      return false
  }
}

/** A frase que a pessoa confere antes de publicar. Sem ela, publicar é apostar. */
export function describeCondition(ast: ConditionAst): string {
  const OP: Record<ComparisonOp, string> = { gt: 'acima de', gte: 'no mínimo', lt: 'abaixo de', lte: 'no máximo', eq: 'igual a', ne: 'diferente de' }
  switch (ast.kind) {
    case 'compare':
      return `${ast.field} ${OP[ast.op]} ${ast.value}`
    case 'delta':
      return `${ast.field} variou ${OP[ast.op]} ${ast.value}${ast.mode === 'percent' ? '%' : ''}`
    case 'and':
      return ast.children.map(describeCondition).join(' e ')
    case 'or':
      return ast.children.map(describeCondition).join(' ou ')
    case 'not':
      return `não (${describeCondition(ast.child)})`
    default:
      return ''
  }
}
