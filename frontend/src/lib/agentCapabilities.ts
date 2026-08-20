import type { AgentPreset } from './types'

// O que cada TIPO de agente faz — a mesma matriz do servidor (`agentCapabilities.ts`).
//
// Existe aqui para a tela não oferecer o que o motor não vai usar. Um analista com um
// bloco de base de conhecimento em branco é uma promessa que o runtime não cumpre: ele
// analisa o que RECEBE, e não busca base própria. Mostrar o campo assim mesmo faria o
// dono configurar uma coisa e ver outra acontecer.

export type AgentRole = 'researcher' | 'analyst' | 'coordinator' | 'executor'

const POR_PRESET: Record<AgentPreset, { role: AgentRole; knowledge: boolean }> = {
  researcher: { role: 'researcher', knowledge: true },
  monitor: { role: 'researcher', knowledge: true },
  analyst: { role: 'analyst', knowledge: false },
  manager: { role: 'coordinator', knowledge: false },
  secretary: { role: 'coordinator', knowledge: false },
  operator: { role: 'executor', knowledge: true },
  communicator: { role: 'executor', knowledge: true },
  custom: { role: 'executor', knowledge: true },
}

export const roleOfPreset = (preset: AgentPreset | null | undefined): AgentRole =>
  (POR_PRESET[preset ?? 'custom'] ?? POR_PRESET.custom).role

/** Este agente usa base própria? A escolha explícita do dono manda sobre o tipo. */
export function usesKnowledge(preset: AgentPreset | null | undefined, knowledgeEnabled?: boolean | null): boolean {
  if (knowledgeEnabled === true) return true
  if (knowledgeEnabled === false) return false
  return (POR_PRESET[preset ?? 'custom'] ?? POR_PRESET.custom).knowledge
}

/** A frase que explica por que o bloco não está ali — e como trazê-lo de volta. */
export const WHY_NO_KNOWLEDGE: Record<AgentRole, string> = {
  analyst: 'Quem analisa trabalha sobre o que recebe das tarefas anteriores, e não sobre uma base própria.',
  coordinator: 'Quem conduz planeja, delega e consolida — o conhecimento fica com quem executa.',
  researcher: '',
  executor: '',
}
