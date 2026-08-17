// A condição que decide se uma etapa roda. Pura, determinística, sem LLM.
//
// É ela que sustenta a promessa mais importante dos modos híbrido e automático:
// **a IA nunca é chamada em silêncio**. Ou a condição é verdadeira e o modelo roda,
// ou ela é falsa e a execução termina sem gastar nada. Quem lê a configuração
// consegue dizer de antemão qual dos dois vai acontecer — o que não seria verdade
// se a decisão fosse de outro modelo.

export type ConditionOperator = 'exists' | 'absent' | 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt' | 'matches'

export const CONDITION_OPERATORS: readonly ConditionOperator[] = [
  'exists',
  'absent',
  'equals',
  'not_equals',
  'contains',
  'gt',
  'lt',
  'matches',
]

export interface StepCondition {
  // De onde ler: o id de uma etapa anterior, ou 'input' para o corpo do evento.
  source: string
  // Caminho dentro do valor, em pontos: `cliente.plano`. Vazio = o valor inteiro.
  path: string
  operator: ConditionOperator
  value?: unknown
}

export const isConditionOperator = (v: unknown): v is ConditionOperator =>
  typeof v === 'string' && (CONDITION_OPERATORS as readonly string[]).includes(v)

// Lê um caminho em pontos sem estourar em nada que apareça no meio.
export function readPath(valor: unknown, path: string): unknown {
  if (!path) return valor
  let atual: unknown = valor
  for (const parte of path.split('.')) {
    if (atual === null || atual === undefined) return undefined
    if (typeof atual !== 'object') return undefined
    atual = (atual as Record<string, unknown>)[parte]
  }
  return atual
}

const comoTexto = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v))
const comoNumero = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v))
  return Number.isFinite(n) ? n : null
}

/**
 * Avalia a condição contra o contexto da execução.
 *
 * Falha fechada: operador desconhecido, caminho que não existe, número que não é
 * número — tudo devolve `false`. Numa decisão sobre GASTAR, a dúvida tem que
 * significar "não gaste". O contrário transformaria um erro de digitação na
 * configuração em conta no fim do mês.
 */
export function evaluateCondition(cond: StepCondition | null | undefined, contexto: Record<string, unknown>): boolean {
  if (!cond) return true
  if (!isConditionOperator(cond.operator)) return false

  const base = cond.source === 'input' ? contexto.input : contexto[cond.source]
  const atual = readPath(base, cond.path ?? '')

  switch (cond.operator) {
    case 'exists':
      return atual !== undefined && atual !== null && atual !== ''
    case 'absent':
      return atual === undefined || atual === null || atual === ''
    case 'equals':
      return comoTexto(atual) === comoTexto(cond.value)
    case 'not_equals':
      return comoTexto(atual) !== comoTexto(cond.value)
    case 'contains':
      return comoTexto(atual).toLowerCase().includes(comoTexto(cond.value).toLowerCase())
    case 'gt': {
      const a = comoNumero(atual)
      const b = comoNumero(cond.value)
      return a !== null && b !== null && a > b
    }
    case 'lt': {
      const a = comoNumero(atual)
      const b = comoNumero(cond.value)
      return a !== null && b !== null && a < b
    }
    case 'matches':
      try {
        return new RegExp(comoTexto(cond.value), 'i').test(comoTexto(atual))
      } catch {
        // Expressão inválida na configuração não pode virar "roda a LLM".
        return false
      }
  }
}

// Uma frase para a interface e para o log. Quem lê precisa entender quando o modelo
// vai ser chamado sem abrir a documentação.
export function describeCondition(cond: StepCondition | null | undefined): string {
  if (!cond) return 'sempre'
  const onde = cond.source === 'input' ? 'no evento' : `na etapa ${cond.source}`
  const campo = cond.path ? `"${cond.path}"` : 'o conteúdo'
  const valor = cond.value === undefined ? '' : ` "${comoTexto(cond.value)}"`
  switch (cond.operator) {
    case 'exists':
      return `quando ${campo} existir ${onde}`
    case 'absent':
      return `quando ${campo} não vier ${onde}`
    case 'equals':
      return `quando ${campo} for igual a${valor}`
    case 'not_equals':
      return `quando ${campo} for diferente de${valor}`
    case 'contains':
      return `quando ${campo} contiver${valor}`
    case 'gt':
      return `quando ${campo} for maior que${valor}`
    case 'lt':
      return `quando ${campo} for menor que${valor}`
    case 'matches':
      return `quando ${campo} casar com${valor}`
    default:
      return 'nunca'
  }
}
