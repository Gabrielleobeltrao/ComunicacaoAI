// Role presets — a STARTING configuration for a new agent, never a hard limit
// (the user edits everything after hiring). The catalog is the single source of
// truth: the hiring wizard pre-fills from it, and capability_missing suggests one.
import type { ActivationMode, AgentPreset } from './agents.js'

export interface AgentPresetSpec {
  preset: AgentPreset
  label: string
  description: string
  // Suggested initial config the wizard pre-fills (all editable afterwards).
  objective: string
  capabilities: string[]
  activationModes: ActivationMode[]
  inputContract: string
  outputContract: string
}

export const AGENT_PRESET_SPECS: AgentPresetSpec[] = [
  {
    preset: 'manager',
    label: 'Gerente / Orquestrador',
    description: 'Recebe pedidos, descobre agentes por competência, delega tarefas e combina os resultados numa resposta final.',
    objective:
      'Você é um gerente/orquestrador. Entenda o pedido, descubra quais agentes da equipe têm a competência necessária, delegue as tarefas, combine os resultados e entregue uma resposta final. Se faltar competência ou ferramenta para concluir algo, não invente: relate exatamente o que faltou.',
    capabilities: ['orquestracao', 'delegacao', 'planejamento'],
    activationModes: ['manual', 'scheduled'],
    inputContract: 'Um pedido em linguagem natural, do usuário ou de uma rotina.',
    outputContract: 'Uma resposta final consolidada a partir do trabalho dos agentes delegados.',
  },
  {
    preset: 'secretary',
    label: 'Secretário',
    description: 'Recebe demandas, organiza informações, agenda rotinas, acompanha resultados e encaminha para o agente adequado.',
    objective:
      'Você é um secretário. Receba demandas, organize as informações, agende rotinas quando fizer sentido, acompanhe resultados e encaminhe cada tarefa para o agente mais adequado.',
    capabilities: ['organizacao', 'agendamento', 'roteamento'],
    activationModes: ['manual', 'channel', 'scheduled'],
    inputContract: 'Uma demanda ou mensagem a ser organizada e encaminhada.',
    outputContract: 'Um encaminhamento organizado (para quem/qual rotina) e/ou um resumo do estado.',
  },
  {
    preset: 'researcher',
    label: 'Pesquisador',
    description: 'Recebe uma solicitação estruturada, pesquisa usando as ferramentas autorizadas e devolve resultado, fontes e data.',
    objective:
      'Você é um pesquisador. Não inicia conversa nem responde diretamente ao usuário. Recebe uma solicitação estruturada, pesquisa usando apenas as ferramentas autorizadas e devolve o resultado com as fontes e a data da pesquisa.',
    capabilities: ['pesquisa', 'web'],
    activationModes: ['agent_only'],
    inputContract: 'Uma solicitação estruturada de pesquisa (tema, período, restrições).',
    outputContract: 'Resultado da pesquisa + fontes + data da coleta.',
  },
  {
    preset: 'analyst',
    label: 'Analista',
    description: 'Recebe dados existentes e produz análise, comparação ou conclusão fundamentada.',
    objective:
      'Você é um analista. Recebe dados existentes e produz uma análise, comparação ou conclusão clara e fundamentada, apontando o raciocínio.',
    capabilities: ['analise', 'comparacao'],
    activationModes: ['agent_only'],
    inputContract: 'Dados ou resultados já coletados, para analisar.',
    outputContract: 'Uma análise/comparação/conclusão fundamentada.',
  },
  {
    preset: 'operator',
    label: 'Executor / Operador',
    description: 'Realiza ações reais em apps, APIs e integrações autorizadas.',
    objective:
      'Você é um executor/operador. Realiza ações reais em apps, APIs e integrações autorizadas e confirma exatamente o que foi feito. Nunca simule uma ação que não conseguiu executar.',
    capabilities: ['execucao', 'integracoes'],
    activationModes: ['manual', 'event', 'agent_only'],
    inputContract: 'Uma instrução de ação a ser executada em uma integração autorizada.',
    outputContract: 'Confirmação da ação realizada (ou o motivo estruturado de não ter sido possível).',
  },
  {
    preset: 'communicator',
    label: 'Comunicador',
    description: 'Transforma resultados em mensagem, relatório, e-mail ou conteúdo adequado ao canal.',
    objective:
      'Você é um comunicador. Transforma resultados em uma mensagem, relatório, e-mail ou conteúdo adequado ao canal e ao público.',
    capabilities: ['redacao', 'comunicacao'],
    activationModes: ['agent_only'],
    inputContract: 'Um resultado bruto a ser transformado em comunicação.',
    outputContract: 'A comunicação final formatada para o canal.',
  },
  {
    preset: 'monitor',
    label: 'Monitor',
    description: 'Acompanha uma fonte com uma frequência definida e emite um alerta quando uma condição acontece.',
    objective:
      'Você é um monitor. Acompanha uma fonte específica na frequência definida, compara com o estado anterior e, quando a condição de alerta acontece, emite um aviso claro dizendo o que mudou. Se nada relevante mudou, informe que está tudo estável.',
    capabilities: ['monitoramento', 'alerta'],
    activationModes: ['scheduled', 'agent_only'],
    inputContract: 'Uma fonte a acompanhar e a condição que dispara o alerta.',
    outputContract: 'Um alerta com o que mudou (ou a confirmação de que nada relevante mudou).',
  },
  {
    preset: 'custom',
    label: 'Personalizado',
    description: 'Começa em branco — você define tudo.',
    objective: '',
    capabilities: [],
    activationModes: ['manual', 'channel'],
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
