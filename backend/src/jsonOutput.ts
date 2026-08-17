// Conferir se uma resposta cumpre o contrato JSON.
//
// Vive aqui, e não dentro do runtime, porque os caminhos de CONVERSA — Playground,
// widget, canais — não passam pelo runtime. Eles chamavam o provedor direto e entregavam
// o que viesse: um agente configurado para produzir JSON recebia a instrução no prompt e
// ninguém conferia o resultado. Por uma porta o contrato valia; pela outra, era
// decoração.
//
// Puro: sem banco, sem rede, sem modelo.
import { describeErrors, validateAgainstSchema } from './jsonSchema.js'

/**
 * Extrai UM objeto JSON do texto do modelo, tolerando cercas de código.
 *
 * A tolerância é deliberada: modelos colocam ```json por hábito, e recusar por causa da
 * cerca seria reprovar uma resposta correta por causa da embalagem.
 */
export function parseJsonText(bruto: string): unknown {
  const limpo = bruto
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  return JSON.parse(limpo)
}

export type JsonCheck = { ok: true; text: string; json: unknown } | { ok: false; problem: string }

export function checkJsonText(texto: string, schema: Record<string, unknown> | null | undefined): JsonCheck {
  let json: unknown
  try {
    json = parseJsonText(texto)
  } catch {
    return { ok: false, problem: 'não é JSON válido' }
  }
  if (schema) {
    const validation = validateAgainstSchema(schema, json)
    if (!validation.valid) return { ok: false, problem: describeErrors(validation.errors) }
  }
  return { ok: true, text: texto, json }
}
