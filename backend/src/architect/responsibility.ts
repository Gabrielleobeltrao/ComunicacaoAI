import type { ArchitectCapabilityManifest } from './capabilities.js'
import type { BlueprintAgent, OfficeBlueprintV1 } from './types.js'

// A FICHA de cada agente proposto — e o que a torna verificável.
//
// "Função" era um rótulo: o Arquiteto escrevia `preset: "manager"` e ninguém conferia
// se aquele gerente tinha equipe, se o pesquisador tinha fonte, se o operador tinha
// ferramenta. O agente nascia com um cargo e sem trabalho, e o defeito só aparecia
// quando alguém mandava a primeira mensagem.
//
// Aqui a função vira CONTRATO: cada papel exige recursos mínimos, e a exigência é
// conferida contra o `roleConfig` do servidor — a mesma matriz que o runtime usa para
// montar as ferramentas do agente. Uma segunda tabela aqui divergiria na primeira
// mudança de papel, e a que erra é sempre a cópia.

export type ResponsibilityCode =
  | 'missing_responsibility'
  | 'missing_boundary'
  | 'missing_delivery'
  | 'missing_activation'
  | 'manager_without_team'
  | 'manager_executes'
  | 'researcher_without_source'
  | 'analyst_without_input'
  | 'operator_without_tool'
  | 'communicator_without_channel'
  | 'monitor_without_trigger'
  | 'secretary_without_destinations'
  | 'custom_without_justification'
  | 'unknown_preset'

export interface ResponsibilityFinding {
  code: ResponsibilityCode
  agentKey: string
  agentName: string
  /** Em português, para quem está montando a operação — não para quem escreveu o código. */
  message: string
  /** O que fazer a respeito. Sem isto, um aviso é só um incômodo. */
  fix: string
  severity: 'error' | 'warning'
}

export interface AgentResponsibilitySpec {
  name: string
  preset: string
  primaryResponsibility: string
  owns: string[]
  doesNotOwn: string[]
  executorKind: 'llm' | 'function' | 'tool'
  receives: string
  decides: string
  delivers: string
  activation: string[]
  knowledgeNeeds: string[]
  toolNeeds: string[]
  canCall: string[]
  canBeCalledBy: string[]
  humanEscalation: string
  successMetric: string
  justification: string
}

const texto = (v: unknown): string => String(v ?? '').trim()
const temTexto = (v: unknown): boolean => texto(v).length > 0

/**
 * A ficha derivada do que a proposta já diz.
 *
 * Ela não inventa: o que o blueprint não declara sai vazio, e vazio é o que o validador
 * cobra. Uma ficha preenchida por padrão esconderia justamente o que precisa aparecer.
 */
export function specOf(agent: BlueprintAgent, bp: OfficeBlueprintV1): AgentResponsibilitySpec {
  const setores = (bp.sectors ?? []).filter((s) => (s.memberAgentKeys ?? []).includes(agent.key))
  const coordena = (bp.sectors ?? []).filter((s) => s.coordinatorAgentKey === agent.key)
  const nomeDe = (k: string) => (bp.agents ?? []).find((a) => a.key === k)?.name ?? k

  const canCall =
    agent.delegationPolicy === 'floor'
      ? (bp.agents ?? []).filter((a) => a.key !== agent.key && a.floorKey === agent.floorKey).map((a) => a.name)
      : (agent.callableAgentKeys ?? []).map(nomeDe)

  return {
    name: agent.name,
    preset: texto(agent.preset) || 'custom',
    primaryResponsibility: texto(agent.objective),
    owns: [texto(agent.role)].filter(Boolean),
    // O que ele NÃO faz sai das restrições declaradas — é o campo que impede o agente
    // de se espalhar para o trabalho dos outros.
    doesNotOwn: texto(agent.constraints) ? texto(agent.constraints).split(/\n+/).slice(0, 5) : [],
    executorKind: agent.executorKind ?? 'llm',
    receives: texto(agent.inputContract),
    decides: texto(agent.role),
    delivers: texto(agent.outputContract) || texto(agent.objective),
    activation: agent.activationModes ?? [],
    knowledgeNeeds: (bp.knowledgeRequirements ?? []).filter((k) => k.scope === 'agent' && k.targetKey === agent.key).map((k) => k.title),
    toolNeeds: (bp.appRequirements ?? []).filter((r) => (r.agentKeys ?? []).includes(agent.key)).map((r) => r.appKey),
    canCall,
    canBeCalledBy: coordena.length ? [] : setores.map((s) => `coordenador de ${s.name}`),
    humanEscalation: agent.handoffEnabled ? 'passa para uma pessoa quando não resolve' : '',
    successMetric: '',
    justification: texto(agent.rationale),
  }
}

/**
 * O que cada papel EXIGE para existir de verdade.
 *
 * As mensagens falam do sintoma, não da regra: "este gerente não tem ninguém para
 * coordenar" é acionável; "manager_without_team" é um código de erro.
 */
export function validateResponsibility(bp: OfficeBlueprintV1, manifest: ArchitectCapabilityManifest | null): ResponsibilityFinding[] {
  const achados: ResponsibilityFinding[] = []
  const agentes = bp.agents ?? []
  // Como texto: o preset do blueprint é o que o modelo escreveu, e pode não ser um
  // dos válidos — é justamente isso que se confere aqui.
  const presetsValidos = new Set<string>((manifest?.presets ?? []).map((p) => String(p.preset)))

  for (const agent of agentes) {
    const spec = specOf(agent, bp)
    const base = { agentKey: agent.key, agentName: agent.name }
    const erro = (code: ResponsibilityCode, message: string, fix: string) => achados.push({ ...base, code, message, fix, severity: 'error' })
    const aviso = (code: ResponsibilityCode, message: string, fix: string) => achados.push({ ...base, code, message, fix, severity: 'warning' })

    // O perfil precisa existir no catálogo REAL. Um preset inventado vira um agente
    // sem papel nenhum na hora de aplicar.
    if (presetsValidos.size > 0 && !presetsValidos.has(spec.preset)) {
      erro('unknown_preset', `"${agent.name}" tem um perfil que não existe nesta instalação ("${spec.preset}")`, 'escolha um dos perfis do catálogo')
      continue
    }

    if (!temTexto(spec.primaryResponsibility)) {
      erro('missing_responsibility', `"${agent.name}" não diz o que entrega`, 'escreva o objetivo em uma frase: o RESULTADO, não a atividade')
    }
    if (!temTexto(spec.decides)) {
      aviso('missing_boundary', `"${agent.name}" não diz quando é acionado`, 'escreva a frase de "quando chamar" — é por ela que o coordenador escolhe')
    }
    if (spec.doesNotOwn.length === 0) {
      aviso('missing_boundary', `"${agent.name}" não tem limite escrito`, 'diga o que ele NÃO faz; sem isso ele se espalha para o trabalho dos outros')
    }
    if (!temTexto(spec.delivers)) {
      aviso('missing_delivery', `não está claro o que "${agent.name}" devolve`, 'descreva a entrega dele')
    }

    switch (spec.preset) {
      case 'manager': {
        if (spec.canCall.length === 0) {
          erro('manager_without_team', `"${agent.name}" coordena, mas não alcança ninguém`, 'dê a ele delegação por andar, ou liste quem ele pode acionar — sem isso ele recebe o pedido e para')
        }
        // Quem conduz não executa: com ferramenta na mão, o caminho mais curto é fazer
        // sozinho, e o time deixa de existir.
        if (spec.toolNeeds.length > 0) {
          aviso('manager_executes', `"${agent.name}" coordena e ainda executa ação de App`, 'deixe a ferramenta com o especialista; o coordenador distribui e consolida')
        }
        break
      }
      case 'researcher': {
        if (spec.knowledgeNeeds.length === 0 && !bp.knowledgeRequirements?.some((k) => k.scope !== 'agent')) {
          erro('researcher_without_source', `"${agent.name}" pesquisa, mas não tem onde procurar`, 'declare a base de conhecimento, o site ou a busca que ele pode usar')
        }
        break
      }
      case 'analyst': {
        if (!temTexto(spec.receives)) {
          erro('analyst_without_input', `"${agent.name}" analisa, mas não diz o que recebe`, 'descreva a entrada: sem dado de origem, não há análise, há adivinhação')
        }
        break
      }
      case 'operator': {
        if (spec.toolNeeds.length === 0 && spec.executorKind === 'llm') {
          erro('operator_without_tool', `"${agent.name}" executa ações, mas não tem ferramenta nenhuma`, 'ligue um App ou uma função a ele — senão ele só vai dizer que fez')
        }
        break
      }
      case 'communicator': {
        const temCanal = (bp.appRequirements ?? []).some((r) => (r.agentKeys ?? []).includes(agent.key))
        if (!temCanal && spec.activation.length === 0) {
          aviso('communicator_without_channel', `"${agent.name}" fala com pessoas, mas não tem canal nem acionamento`, 'diga por onde ele atende (canal) ou o que o aciona')
        }
        break
      }
      case 'monitor': {
        const temRotina = (bp.routines ?? []).some((r) => r.ownerAgentKey === agent.key)
        if (!temRotina && !spec.activation.includes('scheduled')) {
          erro('monitor_without_trigger', `"${agent.name}" vigia, mas nada o dispara`, 'crie a rotina com o horário, ou o acionamento por evento')
        }
        break
      }
      case 'secretary': {
        if (spec.canCall.length === 0) {
          aviso('secretary_without_destinations', `"${agent.name}" encaminha, mas não tem para quem`, 'diga para quem ele encaminha cada tipo de demanda')
        }
        break
      }
      case 'custom': {
        // `custom` é a ausência de perfil: ele abre mão de instrução de papel, política
        // de chamada e contratos prontos. Isso pode ser certo — mas precisa ser dito.
        if (!temTexto(spec.justification)) {
          erro('custom_without_justification', `"${agent.name}" é personalizado sem justificativa`, 'diga por que nenhum perfil pronto serve, ou escolha um deles')
        }
        break
      }
      default:
        break
    }
  }
  return achados
}
