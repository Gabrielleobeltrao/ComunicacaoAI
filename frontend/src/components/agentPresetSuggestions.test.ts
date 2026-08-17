// A promessa da tela antes de trocar o modelo-base.
//
// A confirmação lista quais campos serão preenchidos. Essa lista é um COMPROMISSO: se ela
// disser "Instruções" e o servidor preencher o objetivo junto, o dono foi passado para
// trás. Por isso a regra é uma função pura, testada aqui, e é a mesma que o servidor
// aplica em `presetFillableFields`.
import { describe, expect, it } from 'vitest'
import { camposQueSeriamPreenchidos } from './AgentDefinitionFields'

const SPEC = {
  objective: 'Você é um pesquisador.',
  role: 'Pesquisador: encontra e resume informação.',
  instructions: 'Procure primeiro no que foi curado.',
  constraints: 'Nunca invente número, data ou citação.',
}

const vazio = { objective: '', role: '', instructions: '', constraints: '' }

describe('campos que uma troca de modelo-base preencheria', () => {
  it('lista os quatro quando tudo está vazio', () => {
    expect(camposQueSeriamPreenchidos(vazio, SPEC).map((c) => c.campo)).toEqual([
      'objective',
      'role',
      'instructions',
      'constraints',
    ])
  })

  it('não lista o que já tem texto — nada escrito é sobrescrito', () => {
    const atual = { ...vazio, role: 'Atendente do plano empresarial.', objective: 'Resolver chamados.' }
    expect(camposQueSeriamPreenchidos(atual, SPEC).map((c) => c.campo)).toEqual(['instructions', 'constraints'])
  })

  it('espaço em branco não conta como texto escrito', () => {
    const atual = { ...vazio, instructions: '   \n  ' }
    expect(camposQueSeriamPreenchidos(atual, SPEC).map((c) => c.campo)).toContain('instructions')
  })

  it('devolve lista vazia quando não há nada a preencher', () => {
    const cheio = { objective: 'a', role: 'b', instructions: 'c', constraints: 'd' }
    expect(camposQueSeriamPreenchidos(cheio, SPEC)).toEqual([])
  })

  it('um molde sem sugestão para o campo não promete preenchê-lo', () => {
    // 'Personalizado' começa em branco: não há o que sugerir, e a tela não pode dizer
    // que vai preencher.
    const semNada = { objective: '', role: '', instructions: '', constraints: '' }
    expect(camposQueSeriamPreenchidos(vazio, semNada)).toEqual([])
  })

  it('o rótulo é o que o dono lê no formulário, não o nome do campo', () => {
    const rotulos = camposQueSeriamPreenchidos(vazio, SPEC).map((c) => c.rotulo)
    expect(rotulos).toEqual(['Objetivo', 'Função', 'Instruções', 'Limites'])
  })
})
