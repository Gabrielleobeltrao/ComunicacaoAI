// As etiquetas pelas quais um agente é ENCONTRADO por outro.
//
// O campo existia e nenhuma tela o editava: era gravado uma vez, na contratação, a partir
// do catálogo do modelo-base. Todo pesquisador da conta ficava com as mesmas duas
// etiquetas — e três pesquisadores de assuntos diferentes viravam a mesma coisa para o
// coordenador que precisa escolher um.
import { describe, expect, it } from 'vitest'
import { normalizeTags } from './AgentCapabilities'

describe('etiquetas de competência', () => {
  it('tira espaço sobrando', () => {
    expect(normalizeTags(['  jurídico  '])).toEqual(['jurídico'])
  })

  it('não repete a mesma competência, nem escrita de outro jeito', () => {
    // "Jurídico" e "juridico" são a mesma coisa para quem procura — a busca compara sem
    // acento, então guardar as duas só polui a lista.
    expect(normalizeTags(['Jurídico', 'juridico', 'JURIDICO'])).toEqual(['Jurídico'])
  })

  it('uma lista colada vira várias etiquetas, e não uma gigante', () => {
    expect(normalizeTags(['jurídico, tributário; societário'])).toEqual(['jurídico', 'tributário', 'societário'])
  })

  it('descarta vazio e só-espaço', () => {
    expect(normalizeTags(['', '   ', 'pesquisa'])).toEqual(['pesquisa'])
  })

  it('trunca etiqueta absurdamente longa em vez de aceitar um parágrafo', () => {
    expect(normalizeTags(['a'.repeat(100)])[0].length).toBe(40)
  })

  it('tem teto de quantidade — uma lista infinita não ajuda ninguém a escolher', () => {
    expect(normalizeTags(Array.from({ length: 50 }, (_, i) => `tag${i}`))).toHaveLength(20)
  })

  it('preserva a ORDEM em que foram escritas', () => {
    expect(normalizeTags(['b', 'a', 'c'])).toEqual(['b', 'a', 'c'])
  })
})
