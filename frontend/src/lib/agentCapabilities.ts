import type { AgentPreset } from './types'

// O que cada agente PODE fazer — e quem decide isso.
//
// Quem decide é o servidor. Ele devolve `roleConfig` junto do agente, derivado da mesma
// matriz que o runtime consulta na hora de montar as ferramentas (`agentCapabilities.ts`
// no backend). A tela obedece.
//
// Isso não é preciosismo de arquitetura, é o defeito que a duplicação produz: com duas
// cópias da regra, uma envelhece. E aí ou a tela esconde um campo que o motor ainda lê —
// o dono não configura, e o comportamento acontece assim mesmo —, ou a tela oferece um
// campo que o motor ignora, e o dono configura uma coisa e vê outra. Os dois já
// aconteceram aqui.
//
// A tabela abaixo existe para UM caso: o agente que ainda não foi criado, e por isso
// ainda não tem resposta do servidor para consultar.

export type AgentRole = 'researcher' | 'analyst' | 'coordinator' | 'executor'

export type RoleSection =
  | 'definicao'
  | 'conhecimento'
  | 'web'
  /** Procurar páginas NOVAS na internet. Só de quem coleta. */
  | 'busca-web'
  | 'ferramentas'
  | 'entrada'
  | 'entrega'
  | 'orquestracao'
  | 'roteamento'

export interface RoleConfig {
  role: AgentRole
  sections: RoleSection[]
  allowedTools: boolean
  allowedKnowledge: boolean
  allowedWeb: boolean
  allowedApps: boolean
  /** Pode procurar páginas novas na internet? Só o pesquisador, e só se ligado. */
  allowedWebSearch?: boolean
  summary?: string
}

/** Espelho de `SECOES` no servidor. Só para o agente que ainda não existe. */
const SECOES: Record<AgentRole, RoleSection[]> = {
  researcher: ['definicao', 'conhecimento', 'web', 'busca-web', 'ferramentas', 'entrega', 'roteamento'],
  analyst: ['definicao', 'entrada', 'entrega', 'roteamento'],
  coordinator: ['definicao', 'orquestracao', 'roteamento'],
  executor: ['definicao', 'ferramentas', 'entrada', 'entrega', 'roteamento'],
}

const POR_PRESET: Record<AgentPreset, { role: AgentRole; knowledge: boolean; tools: boolean }> = {
  researcher: { role: 'researcher', knowledge: true, tools: true },
  monitor: { role: 'researcher', knowledge: true, tools: true },
  analyst: { role: 'analyst', knowledge: false, tools: false },
  manager: { role: 'coordinator', knowledge: false, tools: false },
  secretary: { role: 'coordinator', knowledge: false, tools: false },
  operator: { role: 'executor', knowledge: true, tools: true },
  communicator: { role: 'executor', knowledge: true, tools: true },
  custom: { role: 'executor', knowledge: true, tools: true },
}

export const roleOfPreset = (preset: AgentPreset | null | undefined): AgentRole =>
  (POR_PRESET[preset ?? 'custom'] ?? POR_PRESET.custom).role

/**
 * A configuração deste agente: a do servidor quando ela existe, a derivada quando não.
 *
 * `roleConfig` chega em toda resposta que devolve um agente. A derivação local só entra
 * na contratação, antes de existir agente para o servidor descrever.
 */
export function roleConfigOf(agent: { preset?: AgentPreset | null; knowledgeEnabled?: boolean | null; roleConfig?: RoleConfig } | null): RoleConfig {
  if (agent?.roleConfig) return agent.roleConfig
  const base = POR_PRESET[agent?.preset ?? 'custom'] ?? POR_PRESET.custom
  const knowledge = agent?.knowledgeEnabled === true ? true : agent?.knowledgeEnabled === false ? false : base.knowledge
  const secoes = SECOES[base.role]
  const comBase: RoleSection[] = knowledge && !secoes.includes('conhecimento') ? ['conhecimento', 'web'] : []
  return {
    role: base.role,
    sections: [...comBase, ...secoes].filter((s) => (s === 'conhecimento' || s === 'web' ? knowledge : true)),
    allowedTools: base.tools,
    allowedKnowledge: knowledge,
    allowedWeb: knowledge,
    allowedApps: base.tools,
    allowedWebSearch: false,
  }
}

/** Este agente usa base própria? A escolha explícita do dono manda sobre o tipo. */
export function usesKnowledge(
  preset: AgentPreset | null | undefined,
  knowledgeEnabled?: boolean | null,
  roleConfig?: RoleConfig,
): boolean {
  if (roleConfig) return roleConfig.allowedKnowledge
  return roleConfigOf({ preset, knowledgeEnabled }).allowedKnowledge
}
