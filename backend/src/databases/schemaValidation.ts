// A VALIDAÇÃO contra o JSON Schema do dataset — pequena e suficiente.
//
// Não é um validador de JSON Schema completo, e isso é uma escolha: o que precisa ser
// garantido antes de gravar é tipo, obrigatoriedade e ausência de campo desconhecido.
// Trazer uma biblioteca inteira para isso significaria uma dependência a mais no caminho
// de escrita, e um comportamento (coerção, `$ref`, formatos) que ninguém aqui pediu.
//
// ponytail: subconjunto deliberado — se um dia o schema precisar de `$ref`, `oneOf` ou
// formatos, trocar por um validador de verdade é o caminho, não crescer este arquivo.

type Tipo = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'

const tipoDe = (v: unknown): Tipo => {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  return typeof v as Tipo
}

const compativel = (valor: unknown, esperado: string): boolean => {
  const t = tipoDe(valor)
  if (esperado === 'number') return t === 'number' || t === 'integer'
  return t === esperado
}

/** `null` quando está tudo certo; a frase do problema quando não está. */
export function validateAgainstSchema(valor: unknown, schema: Record<string, unknown>): string | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return 'o registro precisa ser um objeto'
  const props = (schema.properties ?? {}) as Record<string, { type?: string; enum?: unknown[]; maxLength?: number }>
  const obrigatorios = (schema.required ?? []) as string[]
  const registro = valor as Record<string, unknown>

  for (const campo of obrigatorios) {
    if (registro[campo] === undefined || registro[campo] === null) return `o campo "${campo}" é obrigatório`
  }

  for (const [campo, v] of Object.entries(registro)) {
    const regra = props[campo]
    // Campo desconhecido é recusado: aceitar em silêncio faria o dataset crescer uma
    // coluna que ninguém declarou e que a consulta nunca vai poder filtrar.
    if (!regra) return `o campo "${campo}" não existe neste dataset`
    if (v === null || v === undefined) continue
    if (regra.type && !compativel(v, regra.type)) return `o campo "${campo}" precisa ser ${regra.type}`
    if (regra.enum && !regra.enum.includes(v)) return `o campo "${campo}" precisa ser um de: ${regra.enum.join(', ')}`
    if (regra.maxLength && typeof v === 'string' && v.length > regra.maxLength) return `o campo "${campo}" passa de ${regra.maxLength} caracteres`
    if (typeof v === 'string' && v.length > 10_000) return `o campo "${campo}" é longo demais`
  }
  return null
}
