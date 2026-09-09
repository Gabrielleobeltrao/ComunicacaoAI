import type { OfficeBlueprintV1 } from './types.js'

// JUNTAR ou SEPARAR — e o orçamento que impede a operação de inchar.
//
// Contar tarefas não decide nada. Dois trabalhos vão para o mesmo agente quando
// compartilham responsabilidade, conhecimento, permissão e forma de acionamento; vão
// para agentes diferentes quando alguma dessas coisas muda de verdade. É por isso que
// cada decisão guarda o motivo: "por que estes dois são a mesma pessoa?" precisa ter
// resposta antes de alguém aplicar.
//
// O score é determinístico e cada nota lista os fatos que a formaram. Ele NÃO é
// "confiança da IA": é uma leitura de coisas verificáveis — quantos trabalhos ficaram
// sem dono, quantos agentes têm limite escrito, quantos executores batem com o papel.
// Score não bloqueia nada; quem bloqueia é a validação.

export type ArchitectureCode =
  | 'super_agent'
  | 'micro_agent'
  | 'duplicate_responsibility'
  | 'unclear_boundary'
  | 'orphan_agent'
  | 'executor_mismatch'
  | 'permission_mismatch'
  | 'over_budget'

export interface ArchitectureFinding {
  code: ArchitectureCode
  agentKey?: string
  message: string
  fix: string
  severity: 'error' | 'warning'
  /** Os fatos que levaram a este achado. É o que o torna discutível. */
  evidence: string[]
}

export interface MergeSplitDecision {
  agentKey: string
  agentName: string
  /** Os trabalhos que ficaram com este agente. */
  jobs: string[]
  rationale: string
}

/** Os domínios que não convivem no mesmo agente sem virar superagente. */
const DOMINIOS: [string, RegExp][] = [
  ['atendimento', /(atend|dúvida|duvida|cliente|suporte|reclama)/i],
  ['vendas', /(venda|pedido|orçamento|orcamento|proposta comercial|carrinho)/i],
  ['financeiro', /(financ|pagamento|cobran|reembols|nota fiscal|fatura)/i],
  ['marketing', /(marketing|campanha|divulga|newsletter|publica)/i],
  ['estoque', /(estoque|invent|reposi|almoxarif)/i],
  ['relatório', /(relatóri|relatori|dashboard|indicador|métrica|metrica)/i],
  ['agenda', /(agend|marcar|remarcar|reserva|consulta)/i],
]

const dominiosDe = (texto: string): string[] => DOMINIOS.filter(([, re]) => re.test(texto)).map(([nome]) => nome)

const textoDoAgente = (a: { name: string; objective?: string; role?: string; instructions?: string }): string =>
  `${a.name} ${a.objective ?? ''} ${a.role ?? ''} ${a.instructions ?? ''}`

/** Palavras que denunciam um agente sem decisão: ele só repassa. */
const SEM_DECISAO = /^(receb|repass|encaminh|entreg|transfer|envia)/i

export interface ComplexityBudget {
  /** O teto do núcleo. Mais que isso exige justificativa individual. */
  maxCoreAgents: number
  /** Níveis de coordenação: um só, salvo necessidade comprovada. */
  maxCoordinationLevels: number
}

export const DEFAULT_BUDGET: ComplexityBudget = { maxCoreAgents: 4, maxCoordinationLevels: 1 }

export interface ArchitectureScore {
  coverage: number
  cohesion: number
  executorFit: number
  permissionSafety: number
  setupCompleteness: number
  handoffSimplicity: number
  /** Os fatos por trás de cada nota. Nota sem fato é palpite com número. */
  facts: Record<string, string[]>
}

const nota = (bom: number, total: number): number => (total === 0 ? 100 : Math.round((bom / total) * 100))

/**
 * Os problemas de FORMA da operação — os que passam pela validação estrutural.
 *
 * Uma proposta pode ser tecnicamente válida e ainda ser uma arquitetura ruim: o agente
 * que faz tudo, o agente que não faz nada sozinho, dois agentes com o mesmo trabalho,
 * o agente que ninguém aciona. Nenhum desses quebra o `apply` — todos quebram a
 * operação depois.
 */
export function detectArchitecture(bp: OfficeBlueprintV1, budget: ComplexityBudget = DEFAULT_BUDGET): ArchitectureFinding[] {
  const achados: ArchitectureFinding[] = []
  const agentes = bp.agents ?? []
  const setores = bp.sectors ?? []

  for (const agent of agentes) {
    const texto = textoDoAgente(agent)
    const dominios = dominiosDe(texto)

    // SUPERAGENTE: domínios que não convivem. Quando ele erra, ninguém sabe em qual
    // etapa — e a correção de um domínio mexe no comportamento dos outros.
    if (dominios.length >= 3) {
      achados.push({
        code: 'super_agent',
        agentKey: agent.key,
        message: `"${agent.name}" acumula ${dominios.length} domínios diferentes: ${dominios.join(', ')}`,
        fix: 'separe por domínio: cada agente com uma responsabilidade principal, e o coordenador distribuindo',
        severity: 'error',
        evidence: dominios.map((d) => `menciona ${d}`),
      })
    }

    // MICROAGENTE: sem decisão própria, criado para uma chamada. Isso é ferramenta.
    const objetivo = String(agent.objective ?? '').trim()
    if (objetivo && SEM_DECISAO.test(objetivo) && !String(agent.role ?? '').trim()) {
      achados.push({
        code: 'micro_agent',
        agentKey: agent.key,
        message: `"${agent.name}" não decide nada: ele só repassa`,
        fix: 'transforme em ferramenta ou função de quem já conduz a conversa',
        severity: 'warning',
        evidence: [`objetivo começa com "${objetivo.split(/\s+/)[0]}"`, 'não há frase de quando chamar'],
      })
    }

    // ÓRFÃO: ninguém o aciona e ele não atende canal nenhum. Ele existe e não acontece.
    const emSetor = setores.some((s) => (s.memberAgentKeys ?? []).includes(agent.key))
    const acionadoPorApp = (bp.appRequirements ?? []).some((r) => (r.agentKeys ?? []).includes(agent.key))
    const donoDeRotina = (bp.routines ?? []).some((r) => r.ownerAgentKey === agent.key)
    const chamadoPorAlguem = agentes.some((a) => (a.callableAgentKeys ?? []).includes(agent.key)) || agentes.some((a) => a.delegationPolicy === 'floor' && a.floorKey === agent.floorKey && a.key !== agent.key)
    if (!emSetor && !acionadoPorApp && !donoDeRotina && !chamadoPorAlguem && agentes.length > 1) {
      achados.push({
        code: 'orphan_agent',
        agentKey: agent.key,
        message: `nada aciona "${agent.name}"`,
        fix: 'coloque-o num setor, ligue-o a um canal, ou dê a ele uma rotina — senão ele nunca roda',
        severity: 'warning',
        evidence: ['fora de setor', 'sem canal', 'sem rotina', 'ninguém o chama'],
      })
    }

    // EXECUTOR INCOMPATÍVEL com o papel: um coordenador que é função não coordena nada.
    if (agent.preset === 'manager' && agent.executorKind && agent.executorKind !== 'llm') {
      achados.push({
        code: 'executor_mismatch',
        agentKey: agent.key,
        message: `"${agent.name}" coordena, mas foi declarado como "${agent.executorKind}"`,
        fix: 'coordenação exige julgamento: o executor é "llm"',
        severity: 'error',
        evidence: [`preset manager com executor ${agent.executorKind}`],
      })
    }

    // PERMISSÃO INCOMPATÍVEL: delegação para quem não é do andar dele.
    for (const alvo of agent.callableAgentKeys ?? []) {
      const outro = agentes.find((a) => a.key === alvo)
      if (outro && outro.floorKey !== agent.floorKey) {
        achados.push({
          code: 'permission_mismatch',
          agentKey: agent.key,
          message: `"${agent.name}" tenta acionar "${outro.name}", que trabalha em outro andar`,
          fix: 'delegação acontece dentro do andar; mova um dos dois ou use um setor',
          severity: 'error',
          evidence: [`${agent.name} está em ${agent.floorKey}`, `${outro.name} está em ${outro.floorKey}`],
        })
      }
    }
  }

  // RESPONSABILIDADE DUPLICADA: dois agentes com o mesmo domínio e o mesmo papel.
  for (let i = 0; i < agentes.length; i++) {
    for (let j = i + 1; j < agentes.length; j++) {
      const a = agentes[i]
      const b = agentes[j]
      if (a.preset !== b.preset || !a.preset) continue
      const da = dominiosDe(textoDoAgente(a))
      const db = dominiosDe(textoDoAgente(b))
      const comuns = da.filter((d) => db.includes(d))
      if (comuns.length > 0 && da.length === db.length && comuns.length === da.length) {
        achados.push({
          code: 'duplicate_responsibility',
          agentKey: b.key,
          message: `"${a.name}" e "${b.name}" fazem a mesma coisa (${comuns.join(', ')}, mesmo perfil)`,
          fix: 'junte os dois num agente só, ou dê a cada um um domínio diferente',
          severity: 'warning',
          evidence: [`mesmo perfil: ${a.preset}`, `mesmo domínio: ${comuns.join(', ')}`],
        })
      }
    }
  }

  // ORÇAMENTO: mais agentes que o teto do núcleo, sem justificativa individual.
  const semJustificativa = agentes.filter((a) => !String(a.rationale ?? '').trim())
  if (agentes.length > budget.maxCoreAgents && semJustificativa.length > 0) {
    achados.push({
      code: 'over_budget',
      message: `${agentes.length} agentes no núcleo (o teto é ${budget.maxCoreAgents}), e ${semJustificativa.length} sem justificativa`,
      fix: 'comece menor: junte responsabilidades próximas, ou justifique cada agente além do teto',
      severity: 'warning',
      evidence: semJustificativa.map((a) => `"${a.name}" não diz por que existe`),
    })
  }

  // Mais de um nível de coordenação: coordenador que coordena coordenador.
  const coordenadores = new Set(setores.map((s) => s.coordinatorAgentKey).filter(Boolean) as string[])
  const coordenaCoordenador = agentes.filter(
    (a) => coordenadores.has(a.key) && (a.callableAgentKeys ?? []).some((k) => coordenadores.has(k)),
  )
  if (coordenaCoordenador.length > budget.maxCoordinationLevels - 1 && coordenaCoordenador.length > 0) {
    achados.push({
      code: 'over_budget',
      message: 'há mais de um nível de coordenação no núcleo',
      fix: 'no primeiro desenho, um nível basta: um coordenador e os especialistas',
      severity: 'warning',
      evidence: coordenaCoordenador.map((a) => `"${a.name}" coordena outro coordenador`),
    })
  }

  return achados
}

/**
 * Por que cada agente ficou com o trabalho que ficou.
 *
 * Derivado do que a proposta declara: quem está em qual setor, quem chama quem, e o
 * que o agente diz que faz. É o registro que responde "por que estes dois não foram
 * juntados?" sem depender da memória de quem revisou.
 */
export function mergeSplitRationale(bp: OfficeBlueprintV1): MergeSplitDecision[] {
  const agentes = bp.agents ?? []
  return agentes.map((a) => {
    const dominios = dominiosDe(textoDoAgente(a))
    const outros = agentes.filter((x) => x.key !== a.key)
    const mesmoDominio = outros.filter((x) => dominiosDe(textoDoAgente(x)).some((d) => dominios.includes(d)))
    const razoes: string[] = []
    if (dominios.length) razoes.push(`cuida de ${dominios.join(' e ')}`)
    if (a.preset) razoes.push(`perfil ${a.preset}`)
    if (mesmoDominio.length) {
      razoes.push(
        `separado de ${mesmoDominio.map((x) => `"${x.name}"`).join(', ')} porque ${
          mesmoDominio[0].preset !== a.preset ? 'o papel é outro' : 'a entrega é independente'
        }`,
      )
    } else if (outros.length) {
      razoes.push('não há outro agente no mesmo domínio')
    }
    return {
      agentKey: a.key,
      agentName: a.name,
      jobs: [String(a.objective ?? '').trim()].filter(Boolean),
      rationale: razoes.join('; ') || 'agente único da operação',
    }
  })
}

/**
 * O score — seis leituras verificáveis, cada uma com os fatos que a formaram.
 *
 * Não é confiança, não é qualidade prevista, não é nota da IA. É contagem: quantos
 * agentes têm limite escrito, quantos executores batem com o papel, quantas ações
 * sensíveis têm aprovação. Serve para orientar a revisão, e não para substituí-la.
 */
export function scoreArchitecture(bp: OfficeBlueprintV1, budget: ComplexityBudget = DEFAULT_BUDGET): ArchitectureScore {
  const agentes = bp.agents ?? []
  const facts: Record<string, string[]> = {}

  // Cobertura: todo agente entrega alguma coisa declarada.
  const comEntrega = agentes.filter((a) => String(a.objective ?? '').trim())
  facts.coverage = [`${comEntrega.length} de ${agentes.length} agentes dizem o que entregam`]

  // Coesão: quantos NÃO acumulam domínios demais.
  const coesos = agentes.filter((a) => dominiosDe(textoDoAgente(a)).length <= 2)
  facts.cohesion = [`${coesos.length} de ${agentes.length} agentes ficam em até dois domínios`]

  // Aderência do executor: papel e meio combinam.
  const executorOk = agentes.filter((a) => !(a.preset === 'manager' && a.executorKind && a.executorKind !== 'llm'))
  facts.executorFit = [`${executorOk.length} de ${agentes.length} agentes têm executor coerente com o papel`]

  // Segurança de permissão: ação sensível com aprovação declarada.
  const comHandoff = agentes.filter((a) => a.handoffEnabled !== false)
  facts.permissionSafety = [`${comHandoff.length} de ${agentes.length} agentes preveem passar para uma pessoa`]

  // Prontidão: o que ainda depende de conexão ou conteúdo.
  const pendencias = (bp.appRequirements ?? []).length + (bp.knowledgeRequirements ?? []).filter((k) => !k.content?.trim()).length
  const itens = (bp.appRequirements ?? []).length + (bp.knowledgeRequirements ?? []).length
  facts.setupCompleteness = [`${pendencias} ${pendencias === 1 ? 'pendência' : 'pendências'} antes de a operação rodar sozinha`]

  // Simplicidade dos repasses: quantos saltos entre agentes o desenho exige.
  const saltos = agentes.reduce((n, a) => n + (a.callableAgentKeys?.length ?? 0), 0)
  facts.handoffSimplicity = [`${saltos} ${saltos === 1 ? 'repasse declarado' : 'repasses declarados'} entre agentes`, `teto de coordenação: ${budget.maxCoordinationLevels}`]

  return {
    coverage: nota(comEntrega.length, agentes.length),
    cohesion: nota(coesos.length, agentes.length),
    executorFit: nota(executorOk.length, agentes.length),
    permissionSafety: nota(comHandoff.length, agentes.length),
    setupCompleteness: itens === 0 ? 100 : nota(itens - pendencias, itens),
    handoffSimplicity: saltos <= agentes.length ? 100 : Math.max(0, 100 - (saltos - agentes.length) * 15),
    facts,
  }
}
