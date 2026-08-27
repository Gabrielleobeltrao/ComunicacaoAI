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
export type AgentRole = 'researcher' | 'analyst' | 'coordinator' | 'executor' | 'communicator' | 'custom'

/**
 * As capacidades que um papel pode ter — a lista fechada.
 *
 * Existe para que o runtime pergunte por NOME em vez de por campo: um guarda novo é uma
 * entrada aqui e uma checagem, e não mais um booleano solto que alguém esquece de
 * consultar no quinto lugar que precisava dele.
 */
export const CAPABILITIES = ['knowledge', 'webSources', 'webSearch', 'realtime', 'externalTools', 'orchestrates', 'memory'] as const
export type CapabilityName = (typeof CAPABILITIES)[number]

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
  /**
   * Consulta fontes de dados em tempo real concedidas.
   *
   * É COLETA: ler o preço de agora é buscar um fato lá fora, e por isso pertence a quem
   * coleta. Quem analisa trabalha sobre o que recebeu; quem executa recebe o dado na
   * instrução; quem conduz não busca nada. Sem isto, qualquer agente com uma fonte
   * concedida viraria um pesquisador por um caminho lateral.
   */
  realtime: boolean
  /**
   * O que a configuração pediu e o papel NÃO permite.
   *
   * Uma configuração antiga incompatível não é executada nem apagada: ela é ignorada e
   * fica listada aqui, para a tela dizer o que deixou de valer. Executar em silêncio
   * seria manter a brecha; apagar sem avisar seria perder o que o dono escreveu.
   */
  legacyConflicts: CapabilityName[]
  /** Uma linha para o painel e para o log — por que ele age assim. */
  summary: string
}

/**
 * O que cada papel PODE ter — o teto, e não o estado.
 *
 * A diferença entre esta matriz e a de baixo é a regra central do goal: aqui está o que
 * é POSSÍVEL para o papel; lá, o que vem ligado por padrão. Um interruptor do dono só
 * anda dentro do teto — é isso que impede um executor de virar pesquisador por um
 * toggle, e um analista de recuperar a base própria por uma configuração antiga.
 */
const TETO: Record<AgentRole, Record<CapabilityName, boolean>> = {
  // Coleta fatos: pode olhar em todo lugar, e não aciona nada lá fora.
  researcher: { knowledge: true, webSources: true, webSearch: true, realtime: true, externalTools: false, orchestrates: false, memory: true },
  // Trabalha sobre o que RECEBEU. Nada de buscar — nem base, nem site, nem tempo real.
  analyst: { knowledge: false, webSources: false, webSearch: false, realtime: false, externalTools: false, orchestrates: false, memory: true },
  // Conduz. Quem conduz não executa nem pesquisa: com a ferramenta na mão ele usa a
  // ferramenta, que é o caminho curto, e o time vira decoração.
  coordinator: { knowledge: false, webSources: false, webSearch: false, realtime: false, externalTools: false, orchestrates: true, memory: false },
  // Executa o que foi mandado, com o que lhe foi concedido. Os dados vêm na instrução.
  executor: { knowledge: false, webSources: false, webSearch: false, realtime: false, externalTools: true, orchestrates: false, memory: true },
  // Escreve a partir do input, com as ferramentas de comunicação concedidas.
  communicator: { knowledge: false, webSources: false, webSearch: false, realtime: false, externalTools: true, orchestrates: false, memory: true },
  /**
   * Personalizado: teto ABERTO, e nada ligado por acidente.
   *
   * Ele não é um preset com regra frouxa — é a ausência de preset. Um agente que o dono
   * montou à mão, com sites e ferramentas escolhidos um a um, não pode perder o que
   * configurou porque uma versão nova decidiu que ele "é" executor. O que o goal proíbe
   * é o bypass INVISÍVEL, e aqui nada é invisível: cada capacidade é escolha declarada
   * do dono, e a tela mostra todas.
   *
   * O que continua valendo para ele: tudo o mais deste arquivo. Ligar é explícito,
   * `webSearch` e `realtime` seguem fechados até alguém abrir.
   */
  custom: { knowledge: true, webSources: true, webSearch: true, realtime: true, externalTools: true, orchestrates: true, memory: true },
}

/**
 * O PADRÃO de cada preset — sempre dentro do teto do papel.
 *
 * Aqui mora só o que vem ligado. O que é possível está em `TETO`, e a diferença é o que
 * torna a separação real: mudar um padrão muda a conveniência; mudar o teto muda o que
 * um papel É, e isso não fica ao alcance de um interruptor na tela.
 */
const POR_PRESET: Record<AgentPreset, { role: AgentRole; ligadas: Partial<Record<CapabilityName, boolean>>; needsInputs: boolean; summary: string }> = {
  researcher: {
    role: 'researcher',
    ligadas: { knowledge: true, webSources: true, realtime: true, memory: true },
    needsInputs: false,
    summary: 'coleta: consulta a própria base e os sites cadastrados',
  },
  monitor: {
    role: 'researcher',
    ligadas: { knowledge: true, webSources: true, realtime: true, memory: true },
    needsInputs: false,
    summary: 'acompanha uma fonte: consulta base e sites',
  },
  analyst: {
    role: 'analyst',
    ligadas: { memory: true },
    needsInputs: true,
    summary: 'analisa o que recebe: não busca nada por conta própria',
  },
  manager: { role: 'coordinator', ligadas: { orchestrates: true }, needsInputs: false, summary: 'conduz: planeja, delega e consolida' },
  secretary: { role: 'coordinator', ligadas: { orchestrates: true }, needsInputs: false, summary: 'organiza e encaminha' },
  operator: {
    role: 'executor',
    ligadas: { externalTools: true, memory: true },
    // Ele recebe a instrução pronta: sem os dados na entrada, não improvisa uma busca.
    needsInputs: true,
    summary: 'executa ações com as ferramentas concedidas, a partir do que recebe',
  },
  communicator: {
    role: 'communicator',
    ligadas: { externalTools: true, memory: true },
    needsInputs: true,
    summary: 'escreve a partir do que recebe',
  },
  /**
   * Personalizado: capacidades EXPLÍCITAS, e não um coringa.
   *
   * Sem nada declarado ele cai no papel de quem executa — que é o que um agente sem
   * perfil costuma ser — e as capacidades que o dono tiver ligado à mão continuam
   * valendo, desde que caibam no teto. O que ele não é mais é o atalho invisível para
   * ter tudo: o que estiver fora do teto aparece como incompatível, e não roda.
   */
  custom: {
    role: 'custom',
    // O que ele sempre teve ligado — tirar isso quebraria agentes que funcionam hoje.
    ligadas: { knowledge: true, webSources: true, externalTools: true, memory: true },
    needsInputs: false,
    summary: 'perfil personalizado: as capacidades são as que o dono escolheu',
  },
}

/**
 * O que este agente FAZ — o teto do papel, e depois a escolha do dono dentro dele.
 *
 * A ordem importa e é a correção central: antes, um `knowledgeEnabled: true` devolvia
 * base e sites para QUALQUER papel, então um analista ou um coordenador recuperava por
 * um interruptor a capacidade que o papel existe para não ter. Agora o interruptor só
 * anda dentro do que o papel permite; fora disso ele é registrado como incompatível e
 * ignorado — nunca executado em silêncio, nunca apagado sem avisar.
 */
export function capabilitiesOf(
  agent: Pick<Agent, 'preset'> & {
    knowledgeEnabled?: boolean | null
    webSearch?: { enabled?: boolean } | null
    /** Capacidades ligadas à mão. Só valem dentro do teto do papel. */
    capabilityOverrides?: Partial<Record<CapabilityName, boolean>> | null
  },
): RoleCapabilities {
  const perfil = POR_PRESET[agent.preset ?? 'custom'] ?? POR_PRESET.custom
  const teto = TETO[perfil.role]
  const conflitos: CapabilityName[] = []

  /** Ligar só vale dentro do teto. Fora dele, vira conflito e fica desligado. */
  const pedido: Partial<Record<CapabilityName, boolean>> = { ...(agent.capabilityOverrides ?? {}) }
  // Os interruptores ANTIGOS, traduzidos para o mesmo caminho — eles continuam valendo
  // para quem já os usava, e passam pela mesma porta de todo o resto.
  if (agent.knowledgeEnabled === true) {
    pedido.knowledge = true
    pedido.webSources = true
  }
  if (agent.knowledgeEnabled === false) {
    pedido.knowledge = false
    pedido.webSources = false
  }
  /**
   * Procurar página nova é porta que se ABRE: sem interruptor, fica fechada mesmo para
   * quem pode. Os DOIS caminhos contam — o campo antigo `webSearch.enabled` e o pedido
   * genérico —, senão o específico apagaria o genérico e um pedido incompatível deixaria
   * de ser registrado como conflito.
   */
  pedido.webSearch = agent.webSearch?.enabled === true || pedido.webSearch === true

  const resolvida = {} as Record<CapabilityName, boolean>
  for (const nome of CAPABILITIES) {
    const padrao = perfil.ligadas[nome] === true
    const querLigar = pedido[nome] === true
    const querDesligar = pedido[nome] === false
    if (querLigar && !teto[nome]) {
      // Pedido incompatível com o papel: não roda, e não some — fica visível.
      conflitos.push(nome)
      resolvida[nome] = false
      continue
    }
    resolvida[nome] = querDesligar ? false : (querLigar ? true : padrao) && teto[nome]
  }

  // Ler um site cadastrado depende de ter base: sem ela não há onde guardar o que leu.
  if (!resolvida.knowledge) resolvida.webSources = false

  const marca = conflitos.length ? ` (ignorado por não caber no papel: ${conflitos.join(', ')})` : ''
  return {
    role: perfil.role,
    knowledge: resolvida.knowledge,
    webSources: resolvida.webSources,
    orchestrates: resolvida.orchestrates,
    needsInputs: perfil.needsInputs,
    externalTools: resolvida.externalTools,
    memory: resolvida.memory,
    webSearch: resolvida.webSearch,
    realtime: resolvida.realtime,
    legacyConflicts: conflitos,
    summary: `${perfil.summary}${marca}`,
  }
}

/**
 * Este papel pode esta capacidade? A pergunta que todo guarda de runtime faz.
 *
 * Um ponto só para consultar significa um lugar só para errar — e é o que permite
 * afirmar que a separação não depende de prompt nem de tela.
 */
export const roleAllows = (role: AgentRole, capability: CapabilityName): boolean => TETO[role][capability]

export const capabilityCeiling = (role: AgentRole): Record<CapabilityName, boolean> => ({ ...TETO[role] })

export const roleOf = (preset: AgentPreset | null | undefined): AgentRole => (POR_PRESET[preset ?? 'custom'] ?? POR_PRESET.custom).role

/** Rótulo curto para tela e log. Nunca o nome interno do preset. */
export const ROLE_LABEL: Record<AgentRole, string> = {
  researcher: 'coleta',
  analyst: 'analisa',
  coordinator: 'conduz',
  executor: 'executa',
  communicator: 'comunica',
  custom: 'personalizado',
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
  researcher: ['definicao', 'conhecimento', 'web', 'busca-web', 'entrega', 'roteamento'],
  // Quem analisa o que recebe: o que espera receber, como comparar, o que fazer com
  // conflito e com lacuna. Nada sobre ONDE buscar — ele não busca.
  analyst: ['definicao', 'entrada', 'entrega', 'roteamento'],
  // Quem conduz: só orquestração. Sem base, sem site, sem app, sem ferramenta HTTP.
  coordinator: ['definicao', 'orquestracao', 'roteamento'],
  // Quem executa: o que pode acionar, com que permissão, o que precisa receber e entregar.
  executor: ['definicao', 'ferramentas', 'entrada', 'entrega', 'roteamento'],
  // Quem comunica escreve a partir do que recebe: as ferramentas dele são de
  // comunicação, e não há bloco de busca nenhum — ele não procura.
  communicator: ['definicao', 'ferramentas', 'entrada', 'entrega', 'roteamento'],
  // Personalizado vê TUDO: é o único papel onde cada capacidade é escolha do dono, e
  // esconder um controle seria esconder uma escolha que só ele pode fazer.
  custom: ['definicao', 'conhecimento', 'web', 'busca-web', 'ferramentas', 'entrada', 'entrega', 'orquestracao', 'roteamento'],
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
  allowedRealtime: boolean
  legacyConflicts: CapabilityName[]
  summary: string
}

export function roleUIConfigOf(agent: Pick<Agent, 'preset'> & { knowledgeEnabled?: boolean | null }): RoleUIConfig {
  const capacidades = capabilitiesOf(agent)
  const secoes = SECOES[capacidades.role]
  // O override do dono não muda só o runtime: ele traz o bloco de volta para a tela.
  // Esconder um bloco que o motor passou a usar seria a mesma inconsistência ao contrário.
  /**
   * Nada de trazer bloco de volta por causa de interruptor.
   *
   * Isto existia para o caso "o dono ligou a base à mão num papel que não a usa" — e era
   * o outro lado da mesma brecha: a tela desenhava um controle que o papel não permite.
   * Agora o teto decide, e a tela desenha só o que o motor de fato vai usar.
   */
  return {
    role: capacidades.role,
    sections: secoes.filter((s) => (s === 'conhecimento' || s === 'web' ? capacidades.knowledge : s === 'busca-web' ? roleAllows(capacidades.role, 'webSearch') : true)),
    capabilities: capacidades,
    allowedTools: capacidades.externalTools,
    allowedKnowledge: capacidades.knowledge,
    allowedWeb: capacidades.webSources,
    allowedApps: capacidades.externalTools,
    allowedWebSearch: roleAllows(capacidades.role, 'webSearch'),
    /** Pode consultar fonte em tempo real? Só quem coleta. */
    allowedRealtime: roleAllows(capacidades.role, 'realtime'),
    /** O que a configuração pediu e o papel não permite — a tela avisa em vez de sumir. */
    legacyConflicts: capacidades.legacyConflicts,
    summary: capacidades.summary,
  }
}
