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
  /**
   * Chama ferramenta de fora: app conectado, HTTP personalizado, integração.
   *
   * Quem CONDUZ não executa. Um coordenador com a ferramenta na mão usa a ferramenta —
   * é o caminho mais curto — e o time deixa de existir: ele vira um agente sozinho com
   * uma equipe decorativa. Quando a tarefa precisa de ferramenta, o plano tem de
   * escolher quem a tem.
   */
  externalTools: boolean
  /** A memória operacional (buscar_memoria). Quem só conduz não guarda operação. */
  memory: boolean
  /**
   * Pode PROCURAR páginas novas na internet — quando o dono liga.
   *
   * Diferente de `webSources`, e a distinção é o ponto: `webSources` é ler os endereços
   * que o dono cadastrou; isto é descobrir endereços que ninguém cadastrou. Só quem
   * COLETA pode, e só quando explicitamente ligado: um agente que já funciona com três
   * sites conhecidos não passa a varrer a internet por causa de uma versão nova.
   */
  webSearch: boolean
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
    externalTools: true,
    memory: true,
    webSearch: true,
    summary: 'coleta: consulta a própria base e os sites cadastrados',
  },
  monitor: {
    role: 'researcher',
    knowledge: true,
    webSources: true,
    orchestrates: false,
    needsInputs: false,
    externalTools: true,
    memory: true,
    webSearch: true,
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
    externalTools: false,
    memory: true,
    webSearch: false,
    summary: 'analisa o que recebe: não busca base própria',
  },
  manager: {
    role: 'coordinator',
    knowledge: false,
    webSources: false,
    orchestrates: true,
    needsInputs: false,
    externalTools: false,
    memory: false,
    webSearch: false,
    summary: 'conduz: planeja, delega e consolida',
  },
  secretary: {
    role: 'coordinator',
    knowledge: false,
    webSources: false,
    orchestrates: true,
    needsInputs: false,
    externalTools: false,
    memory: false,
    webSearch: false,
    summary: 'organiza e encaminha',
  },
  operator: {
    role: 'executor',
    // Ferramenta é o principal dele; base entra quando o dono configura uma.
    knowledge: true,
    webSources: true,
    orchestrates: false,
    needsInputs: false,
    externalTools: true,
    memory: true,
    webSearch: false,
    summary: 'executa ações com as ferramentas concedidas',
  },
  communicator: {
    role: 'executor',
    knowledge: true,
    webSources: true,
    orchestrates: false,
    needsInputs: true,
    externalTools: true,
    memory: true,
    webSearch: false,
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
    externalTools: true,
    memory: true,
    webSearch: false,
    summary: 'perfil personalizado: mantém todas as capacidades',
  },
}

/** O que este agente FAZ, já considerando a escolha explícita do dono. */
export function capabilitiesOf(
  agent: Pick<Agent, 'preset'> & { knowledgeEnabled?: boolean | null; webSearch?: { enabled?: boolean } | null },
): RoleCapabilities {
  const bruto = POR_PRESET[agent.preset ?? 'custom'] ?? POR_PRESET.custom
  /**
   * Procurar na internet é uma porta que se ABRE, nunca uma que já vem aberta.
   *
   * A matriz diz quem PODE ter a capacidade — só quem coleta. O interruptor do dono diz
   * se ela está ligada. Sem os dois, não há busca: assim nenhum agente existente muda de
   * comportamento por causa de uma versão nova.
   */
  const base: RoleCapabilities = { ...bruto, webSearch: bruto.webSearch && agent.webSearch?.enabled === true }
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

// --- o que a TELA mostra para cada papel ------------------------------------------------
//
// A tela e o runtime derivam da MESMA matriz acima, e é isso que evita o pior defeito
// possível aqui: um campo escondido que o motor continua usando, ou — pior — um campo
// oferecido que o motor ignora. O dono configurava uma coisa e via outra acontecer.
//
// Note o que NÃO existe nesta lista: um bloco "este agente não tem conhecimento". Uma
// capacidade que não pertence ao papel simplesmente não é desenhada. Explicar a ausência
// de uma coisa que nunca deveria estar ali só transforma uma tela limpa numa tela cheia
// de justificativa.

/** Cada bloco de configuração de "Como trabalha". O nome é do PAPEL, não do campo. */
export type RoleSection =
  /** Função, instruções e limites — com o rótulo do papel. */
  | 'definicao'
  | 'conhecimento'
  | 'web'
  | 'ferramentas'
  /** O que ele espera RECEBER para trabalhar. */
  | 'entrada'
  /** Em que forma ele entrega o resultado. */
  | 'entrega'
  /** Os tetos e a política de quem conduz. */
  | 'orquestracao'
  /** Quando mandar trabalho para ele. */
  | 'roteamento'
  /** Procurar páginas novas na internet. Só de quem coleta. */
  | 'busca-web'

const SECOES: Record<AgentRole, RoleSection[]> = {
  // Quem coleta fatos: onde procurar, com que ferramenta, e em que forma entregar o achado.
  researcher: ['definicao', 'conhecimento', 'web', 'busca-web', 'ferramentas', 'entrega', 'roteamento'],
  // Quem analisa o que recebe: o que espera receber, como comparar, o que fazer com
  // conflito e com lacuna. Nada sobre ONDE buscar — ele não busca.
  analyst: ['definicao', 'entrada', 'entrega', 'roteamento'],
  // Quem conduz: só orquestração. Sem base, sem site, sem app, sem ferramenta HTTP.
  coordinator: ['definicao', 'orquestracao', 'roteamento'],
  // Quem executa: o que pode acionar, com que permissão, o que precisa receber e entregar.
  executor: ['definicao', 'ferramentas', 'entrada', 'entrega', 'roteamento'],
}

/**
 * A configuração de UM agente: que blocos desenhar e o que o motor vai de fato usar.
 *
 * É a resposta única para "o que este agente é". A API devolve isto junto do agente, e a
 * tela obedece — em vez de manter uma segunda cópia da regra que envelhece sozinha.
 */
export interface RoleUIConfig {
  role: AgentRole
  sections: RoleSection[]
  capabilities: RoleCapabilities
  allowedTools: boolean
  allowedKnowledge: boolean
  allowedWeb: boolean
  allowedApps: boolean
  /** Pode procurar páginas novas na internet? Só o pesquisador, e só se ligado. */
  allowedWebSearch: boolean
  summary: string
}

export function roleUIConfigOf(agent: Pick<Agent, 'preset'> & { knowledgeEnabled?: boolean | null }): RoleUIConfig {
  const capacidades = capabilitiesOf(agent)
  const secoes = SECOES[capacidades.role]
  // O override do dono não muda só o runtime: ele traz o bloco de volta para a tela.
  // Esconder um bloco que o motor passou a usar seria a mesma inconsistência ao contrário.
  const comBase = capacidades.knowledge && !secoes.includes('conhecimento') ? (['conhecimento', 'web'] as RoleSection[]) : []
  return {
    role: capacidades.role,
    sections: [...comBase, ...secoes].filter((s) => (s === 'conhecimento' || s === 'web' ? capacidades.knowledge : true)),
    capabilities: capacidades,
    allowedTools: capacidades.externalTools,
    allowedKnowledge: capacidades.knowledge,
    allowedWeb: capacidades.webSources,
    allowedApps: capacidades.externalTools,
    allowedWebSearch: capacidades.webSearch,
    summary: capacidades.summary,
  }
}
