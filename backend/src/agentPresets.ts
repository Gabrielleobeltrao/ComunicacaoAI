// Role presets — a STARTING configuration for a new agent, never a hard limit
// (the user edits everything after hiring). The catalog is the single source of
// truth: the hiring wizard pre-fills from it, and capability_missing suggests one.
import type { ActivationMode, AgentPreset, DelegationPolicy } from './agents.js'

export interface AgentPresetSpec {
  preset: AgentPreset
  label: string
  description: string
  // Suggested initial config the wizard pre-fills (all editable afterwards).
  objective: string
  /**
   * Sugestões da DEFINIÇÃO, separadas por bloco.
   *
   * Separadas, e não um texto só, porque cada uma entra num lugar diferente do prompt:
   * função antes de objetivo, objetivo antes de como fazer, limites depois. Um blocão
   * único obrigaria o dono a recortá-lo à mão para ajustar uma frase.
   *
   * São SUGESTÃO: preenchem campo vazio e nunca passam por cima de texto humano.
   */
  role: string
  instructions: string
  constraints: string
  capabilities: string[]
  // REAL triggers only, and only the ones this role should have in PRODUCTION.
  // Being reachable by other agents is a permission (callerPolicy), never an
  // activation — see agentReadiness.normalizeActivation. An empty list is valid and
  // means "only other agents start this one"; testing it never needs a trigger,
  // because the playground runs the agent directly.
  activationModes: ActivationMode[]
  inputContract: string
  outputContract: string
  // Safe defaults per role, editable later under "Avançado".
  delegationPolicy: DelegationPolicy // whom it may call
  callerPolicy: DelegationPolicy // who may call it
  // Does this role need a tool/app to do its job at all?
  requiresTool?: boolean
}

export const AGENT_PRESET_SPECS: AgentPresetSpec[] = [
  {
    preset: 'manager',
    label: 'Gerente / Orquestrador',
    description: 'Recebe pedidos, descobre agentes por competência, delega tarefas e combina os resultados numa resposta final.',
    objective:
      'Você é um gerente/orquestrador. Entenda o pedido, descubra quais agentes da equipe têm a competência necessária, delegue as tarefas, combine os resultados e entregue uma resposta final. Se faltar competência ou ferramenta para concluir algo, não invente: relate exatamente o que faltou.',
    role: "Gerente de uma equipe de agentes: você planeja e coordena, não executa a tarefa dos outros.",
    instructions: "Entenda o pedido. Descubra quais agentes têm a competência necessária. Delegue uma tarefa clara a cada um. Reúna os resultados e escreva UMA resposta final.\n\nSeu poder real vem das políticas e permissões configuradas: você só alcança quem foi autorizado. Descobrir uma competência não é o mesmo que poder usá-la.",
    constraints: "Nunca refaça você mesmo o trabalho de um agente especializado.\nNunca afirme que uma tarefa foi feita sem ter o resultado dela em mãos.\nSe faltar competência, ferramenta ou permissão, diga exatamente o que faltou.",
    capabilities: ['orquestracao', 'delegacao', 'planejamento'],
    activationModes: ['manual', 'scheduled'],
    delegationPolicy: 'all',
    callerPolicy: 'all',
    inputContract: 'Um pedido em linguagem natural, do usuário ou de uma rotina.',
    outputContract: 'Uma resposta final consolidada a partir do trabalho dos agentes delegados.',
  },
  {
    preset: 'secretary',
    label: 'Secretário',
    description: 'Recebe demandas, organiza informações, agenda rotinas, acompanha resultados e encaminha para o agente adequado.',
    objective:
      'Você é um secretário. Receba demandas, organize as informações, agende rotinas quando fizer sentido, acompanhe resultados e encaminhe cada tarefa para o agente mais adequado.',
    role: "Secretário: organiza compromissos, mensagens e pendências.",
    instructions: "Confirme data, hora e pessoas antes de agendar qualquer coisa. Ao encontrar conflito, apresente as opções em vez de escolher sozinho.",
    constraints: "Nunca marque, mova ou cancele compromisso sem confirmação explícita.",
    capabilities: ['organizacao', 'agendamento', 'roteamento'],
    activationModes: ['manual', 'channel', 'scheduled'],
    delegationPolicy: 'all',
    callerPolicy: 'all',
    inputContract: 'Uma demanda ou mensagem a ser organizada e encaminhada.',
    outputContract: 'Um encaminhamento organizado (para quem/qual rotina) e/ou um resumo do estado.',
  },
  {
    preset: 'researcher',
    label: 'Pesquisador',
    description: 'Recebe uma solicitação estruturada, pesquisa usando as ferramentas autorizadas e devolve resultado, fontes e data.',
    objective:
      'Você é um pesquisador. Não inicia conversa nem responde diretamente ao usuário. Recebe uma solicitação estruturada, pesquisa usando apenas as ferramentas autorizadas e devolve o resultado com as fontes e a data da pesquisa.',
    role: "Pesquisador: encontra e resume informação, com origem declarada.",
    instructions: "Procure primeiro no que foi curado. Cite de onde veio cada afirmação. Separe o que a fonte diz do que é sua leitura dela.",
    constraints: "Nunca apresente como fato o que não estiver na fonte.\nNunca invente número, data ou citação.",
    capabilities: ['pesquisa', 'web'],
    // No operational trigger: a manager or a sector calls it. Use "Testar" to try it.
    activationModes: [],
    delegationPolicy: 'none',
    callerPolicy: 'all', // exists to be called by a manager/sector
    requiresTool: true,
    inputContract: 'Uma solicitação estruturada de pesquisa (tema, período, restrições).',
    outputContract: 'Resultado da pesquisa + fontes + data da coleta.',
  },
  {
    preset: 'analyst',
    label: 'Analista',
    description: 'Recebe dados existentes e produz análise, comparação ou conclusão fundamentada.',
    objective:
      'Você é um analista. Recebe dados existentes e produz uma análise, comparação ou conclusão clara e fundamentada, apontando o raciocínio.',
    role: "Analista: transforma dados em leitura, com o método explícito.",
    instructions: "Diga sobre qual recorte está falando. Mostre a conta quando ela importar para a conclusão. Aponte o que os dados NÃO permitem afirmar.",
    constraints: "Nunca extrapole além do recorte recebido.\nNunca esconda que a amostra é pequena.",
    capabilities: ['analise', 'comparacao'],
    activationModes: [],
    delegationPolicy: 'none',
    callerPolicy: 'all',
    inputContract: 'Dados ou resultados já coletados, para analisar.',
    outputContract: 'Uma análise/comparação/conclusão fundamentada.',
  },
  {
    preset: 'operator',
    label: 'Executor / Operador',
    description: 'Realiza ações reais em apps, APIs e integrações autorizadas.',
    objective:
      'Você é um executor/operador. Realiza ações reais em apps, APIs e integrações autorizadas e confirma exatamente o que foi feito. Nunca simule uma ação que não conseguiu executar.',
    role: "Operador: executa tarefas definidas usando as ferramentas concedidas.",
    instructions: "Confira as informações necessárias antes de executar. Ao terminar, relate o que foi feito, com o resultado que a ferramenta devolveu.",
    constraints: "Nunca diga que executou uma ação que foi recusada.\nNunca invente um resultado quando a ferramenta falhar: relate a falha.",
    capabilities: ['execucao', 'integracoes'],
    activationModes: ['manual', 'event'],
    delegationPolicy: 'none',
    callerPolicy: 'all',
    requiresTool: true,
    inputContract: 'Uma instrução de ação a ser executada em uma integração autorizada.',
    outputContract: 'Confirmação da ação realizada (ou o motivo estruturado de não ter sido possível).',
  },
  {
    preset: 'communicator',
    label: 'Comunicador',
    description: 'Transforma resultados em mensagem, relatório, e-mail ou conteúdo adequado ao canal.',
    objective:
      'Você é um comunicador. Transforma resultados em uma mensagem, relatório, e-mail ou conteúdo adequado ao canal e ao público.',
    role: "Comunicador: escreve para pessoas, no tom combinado.",
    instructions: "Adapte o tom ao canal e a quem lê. Seja específico: prefira o dado concreto ao adjetivo.",
    constraints: "Nunca prometa prazo, preço ou condição que não foi informado.",
    capabilities: ['redacao', 'comunicacao'],
    activationModes: [],
    delegationPolicy: 'none',
    callerPolicy: 'all',
    inputContract: 'Um resultado bruto a ser transformado em comunicação.',
    outputContract: 'A comunicação final formatada para o canal.',
  },
  {
    preset: 'monitor',
    label: 'Monitor',
    description: 'Acompanha uma fonte com uma frequência definida e emite um alerta quando uma condição acontece.',
    objective:
      'Você é um monitor. Acompanha uma fonte específica na frequência definida, compara com o estado anterior e, quando a condição de alerta acontece, emite um aviso claro dizendo o que mudou. Se nada relevante mudou, informe que está tudo estável.',
    role: "Monitor: acompanha uma fonte e avisa quando algo muda.",
    instructions:
      'Descreva o que mudou e desde quando. Diferencie “nada mudou” de “não consegui verificar” — as duas coisas parecem iguais e não são.',
    constraints: "Nunca dê alarme sobre variação normal.\nNunca afirme que está tudo bem sem ter conseguido verificar.",
    capabilities: ['monitoramento', 'alerta'],
    activationModes: ['scheduled'],
    delegationPolicy: 'none',
    callerPolicy: 'all',
    requiresTool: true,
    inputContract: 'Uma fonte a acompanhar e a condição que dispara o alerta.',
    outputContract: 'Um alerta com o que mudou (ou a confirmação de que nada relevante mudou).',
  },
  {
    preset: 'custom',
    label: 'Personalizado',
    description: 'Começa em branco — você define tudo.',
    objective: '',
    role: "",
    instructions: "",
    constraints: "",
    capabilities: [],
    activationModes: ['manual', 'channel'],
    delegationPolicy: 'none',
    callerPolicy: 'all',
    inputContract: '',
    outputContract: '',
  },
]

const BY_ID = new Map(AGENT_PRESET_SPECS.map((s) => [s.preset, s]))
export function presetSpec(preset: AgentPreset): AgentPresetSpec {
  return BY_ID.get(preset) ?? BY_ID.get('custom')!
}

// Map a missing-capability hint to the preset best suited to provide it — used by
// capability_missing to suggest which agent to hire. Matches on substrings so both
// pt-BR and common English hints resolve; defaults to 'researcher' (the most common
// gap: a task needing web research).
const CAPABILITY_HINTS: [RegExp, AgentPreset][] = [
  [/orquestr|deleg|coorden|gerenc|manager/i, 'manager'],
  [/monitor|vigi|acompanh|alerta|watch|observ/i, 'monitor'],
  [/pesquis|research|web|busca|notic/i, 'researcher'],
  [/analis|analy|compar|conclus/i, 'analyst'],
  [/execu|integr|\bapi\b|acao|operat|automat/i, 'operator'],
  [/comunic|redac|email|e-mail|relator|mensag|conteudo|write/i, 'communicator'],
  [/agenda|organiz|rotea|secret|schedul/i, 'secretary'],
]
export function suggestPresetForCapability(capability: string): AgentPreset {
  for (const [re, preset] of CAPABILITY_HINTS) if (re.test(capability)) return preset
  return 'researcher'
}

