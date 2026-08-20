// O que cada TIPO de agente faz — e, principalmente, o que ele não faz.
//
// O preset era só texto inicial e uma lista de pendências: um analista nascia com uma
// frase sobre analisar e, no resto, era idêntico a um pesquisador. Tinha base própria,
// consultava a base própria e, quando ela estava vazia, analisava o nada.
//
// Isso não é detalhe de configuração, é comportamento. Um analista que busca a própria
// base produz análise sobre o que ele mesmo guardou, em vez de sobre as evidências que
// lhe foram entregues — e a resposta parece fundamentada sem ser. Um coordenador que
// consulta base própria vira mais um pesquisador, e o time perde a divisão de trabalho.
//
// Aqui ficam as duas coisas que o runtime e o planejador precisam saber: quem coleta,
// quem analisa o que recebeu, quem conduz. Puro, sem banco e sem modelo.
import type { Agent, AgentPreset } from './agents.js'

/** O papel funcional. Vários presets caem no mesmo papel. */
export type AgentRole = 'researcher' | 'analyst' | 'coordinator' | 'executor'

export interface RoleCapabilities {
  role: AgentRole
  /** Consulta a própria base (RAG) durante a execução. */
  knowledge: boolean
  /** Lê os sites cadastrados antes de trabalhar. Depende de `knowledge`. */
  webSources: boolean
  /** Planeja, delega e consolida. */
  orchestrates: boolean
  /** Trabalha sobre o que RECEBEU: sem entrada, não tem o que fazer. */
  needsInputs: boolean
  /** Uma linha para o painel e para o log — por que ele age assim. */
  summary: string
}

const POR_PRESET: Record<AgentPreset, RoleCapabilities> = {
  researcher: {
    role: 'researcher',
    knowledge: true,
    webSources: true,
    orchestrates: false,
    needsInputs: false,
    summary: 'coleta: consulta a própria base e os sites cadastrados',
  },
  monitor: {
    role: 'researcher',
    knowledge: true,
    webSources: true,
    orchestrates: false,
    needsInputs: false,
    summary: 'acompanha uma fonte: consulta base e sites',
  },
  analyst: {
    role: 'analyst',
    // O ponto do tipo: ele analisa o que RECEBE. Buscar base própria aqui é o caminho
    // curto para uma análise isolada, feita sobre o que o próprio agente guardou.
    knowledge: false,
    webSources: false,
    orchestrates: false,
    needsInputs: true,
    summary: 'analisa o que recebe: não busca base própria',
  },
  manager: {
    role: 'coordinator',
    knowledge: false,
    webSources: false,
    orchestrates: true,
    needsInputs: false,
    summary: 'conduz: planeja, delega e consolida',
  },
  secretary: {
    role: 'coordinator',
    knowledge: false,
    webSources: false,
    orchestrates: true,
    needsInputs: false,
    summary: 'organiza e encaminha',
  },
  operator: {
    role: 'executor',
    // Ferramenta é o principal dele; base entra quando o dono configura uma.
    knowledge: true,
    webSources: true,
    orchestrates: false,
    needsInputs: false,
    summary: 'executa ações com as ferramentas concedidas',
  },
  communicator: {
    role: 'executor',
    knowledge: true,
    webSources: true,
    orchestrates: false,
    needsInputs: true,
    summary: 'escreve a partir do que recebe',
  },
  custom: {
    role: 'executor',
    // Sem perfil declarado não se sabe o que ele faz — e tirar capacidade de quem não
    // declarou nada quebraria agentes que já funcionam.
    knowledge: true,
    webSources: true,
    orchestrates: false,
    needsInputs: false,
    summary: 'perfil personalizado: mantém todas as capacidades',
  },
}

/** O que este agente FAZ, já considerando a escolha explícita do dono. */
export function capabilitiesOf(
  agent: Pick<Agent, 'preset'> & { knowledgeEnabled?: boolean | null },
): RoleCapabilities {
  const base = POR_PRESET[agent.preset ?? 'custom'] ?? POR_PRESET.custom
  // A porta de saída: o dono pode ligar a base num tipo que não a usa por padrão. É
  // escolha explícita, e por isso ela manda sobre o tipo — a regra existe para o caso
  // comum, não para amarrar quem sabe o que quer.
  if (agent.knowledgeEnabled === true) {
    return { ...base, knowledge: true, webSources: true, summary: `${base.summary} (base ligada manualmente)` }
  }
  if (agent.knowledgeEnabled === false) {
    return { ...base, knowledge: false, webSources: false, summary: `${base.summary} (base desligada manualmente)` }
  }
  return base
}

export const roleOf = (preset: AgentPreset | null | undefined): AgentRole => (POR_PRESET[preset ?? 'custom'] ?? POR_PRESET.custom).role

/** Rótulo curto para tela e log. Nunca o nome interno do preset. */
export const ROLE_LABEL: Record<AgentRole, string> = {
  researcher: 'coleta',
  analyst: 'analisa',
  coordinator: 'conduz',
  executor: 'executa',
}
