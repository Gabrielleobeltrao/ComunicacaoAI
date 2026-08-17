// Atalhos de schema compartilhados pelos manifestos oficiais.
//
// Ficam fora dos módulos de App para os manifestos permanecerem só descrição: quando
// se lê um manifesto, o que interessa é o que o App faz, não como um objeto de schema
// é montado.
import type { AppActionDefinition } from '../types.js'

export const str = (description: string) => ({ type: 'string', description })
export const num = (description: string) => ({ type: 'number', description })
export const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
})

export const native = (key: string): AppActionDefinition['execution'] => ({ kind: 'native', adapter: key })
