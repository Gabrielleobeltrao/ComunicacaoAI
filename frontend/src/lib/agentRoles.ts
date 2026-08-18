import type { AgentPreset } from './types'

// O que o agente FAZ, em um verbo.
//
// Existem oito perfis, e o nome de cada um descreve um cargo — Gerente, Pesquisador,
// Analista, Comunicador. Cargo é uma boa etiqueta para quem já entendeu o sistema e uma
// péssima para quem está escolhendo pela primeira vez: "Analista" e "Pesquisador" soam
// parecidos, e nada no nome diz que um busca e o outro conclui.
//
// Por baixo, a diferença real entre os perfis é pequena — texto inicial, se delega ou
// não, e se ele tem gatilho próprio ou só existe para ser chamado. Então o verbo não é
// simplificação de fachada: ele é mais próximo da verdade do que o cargo.
//
// Os três de baixo continuam alcançáveis, atrás de "Outros perfis". Secretário e Monitor
// são casos específicos, e Personalizado é para quem já sabe o que quer.

export interface PapelDeAgente {
  preset: AgentPreset
  /** O verbo, que é o que a pessoa está escolhendo de fato. */
  verbo: string
  /** O nome de cargo, mantido: quem já conhece o sistema procura por ele. */
  cargo: string
}

export const PAPEIS_PRINCIPAIS: PapelDeAgente[] = [
  { preset: 'manager', verbo: 'Coordena', cargo: 'Gerente' },
  { preset: 'researcher', verbo: 'Busca', cargo: 'Pesquisador' },
  { preset: 'analyst', verbo: 'Analisa', cargo: 'Analista' },
  { preset: 'operator', verbo: 'Age', cargo: 'Executor' },
  { preset: 'communicator', verbo: 'Escreve', cargo: 'Comunicador' },
]

export const PAPEIS_OUTROS: PapelDeAgente[] = [
  { preset: 'secretary', verbo: 'Organiza', cargo: 'Secretário' },
  { preset: 'monitor', verbo: 'Vigia', cargo: 'Monitor' },
  { preset: 'custom', verbo: 'Do zero', cargo: 'Personalizado' },
]

export const TODOS_OS_PAPEIS = [...PAPEIS_PRINCIPAIS, ...PAPEIS_OUTROS]

export const papelDe = (preset: AgentPreset): PapelDeAgente | null =>
  TODOS_OS_PAPEIS.find((p) => p.preset === preset) ?? null

/** É um dos principais? Decide se a lista de "outros" já nasce aberta. */
export const ehPrincipal = (preset: AgentPreset): boolean => PAPEIS_PRINCIPAIS.some((p) => p.preset === preset)
