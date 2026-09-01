import type { ArchitectCapabilityManifest } from './capabilities.js'
import type { OperationBrief } from './brief.js'
import type { OfficeBlueprintV1 } from './types.js'

// O ENSAIO da operação, antes de ela existir.
//
// A pergunta que nenhuma validação responde: quando chegar uma mensagem, quem atende?
// E quando o pedido for de reembolso, alguém aprova? O desenho pode estar inteiro e
// ainda deixar um caminho sem dono — e isso só aparece quando um cliente real esbarra
// nele.
//
// NADA aqui sai da máquina. Não há chamada de App, não há mensagem enviada, não há
// cobrança: ferramentas são substituídas por dublês que registram a intenção. Uma
// simulação que executa de verdade não é ensaio, é estreia — e estreia com o público
// dentro.

export interface SimulationCase {
  id: string
  /** O que chega, em linguagem de negócio. */
  input: string
  /** Por onde entra: canal, horário, evento. */
  trigger: string
  /** O caminho que o desenho DEVERIA percorrer, derivado do Brief. */
  expectedRoute: string[]
  /** Verdadeiro quando o cenário deveria parar para uma pessoa aprovar. */
  expectsApproval: boolean
}

export interface SimulationStep {
  kind: 'agent' | 'tool' | 'function' | 'approval' | 'handoff' | 'dead_end'
  ref: string
  detail: string
}

export interface SimulationResult {
  caseId: string
  observedRoute: string[]
  steps: SimulationStep[]
  /** O que impediria este cenário de funcionar. */
  problems: { code: string; message: string; fix: string }[]
  /** As ações que EXECUTARIAM algo — todas em dublê, nenhuma real. */
  sideEffectsAvoided: string[]
  matchedExpected: boolean
}

export interface SimulationRun {
  version: number
  /**
   * Quando o ensaio foi GRAVADO — ausente quando ele é calculado para leitura.
   *
   * A prévia é uma função pura do desenho: duas leituras seguidas precisam ser
   * idênticas, porque é sobre ela que a confirmação carrega o hash. Um carimbo de
   * relógio ali fazia a mesma proposta parecer diferente de si mesma a cada segundo.
   * No que fica guardado no projeto o carimbo tem sentido: ele diz quando aquele ensaio
   * aconteceu.
   */
  createdAt?: string
  cases: SimulationCase[]
  results: SimulationResult[]
  /** Quantos cenários percorreram o caminho esperado sem problema bloqueante. */
  passed: number
}

const CANAL_PADRAO = 'mensagem no canal'

/**
 * Os cenários, derivados do Brief.
 *
 * Três a oito: menos que três não cobre o caminho feliz e o caminho triste; mais que
 * oito vira relatório que ninguém lê. Cada trabalho vira um cenário, e a operação
 * ganha um caso de "chegou algo que ninguém previu" — que é o que descobre buraco.
 */
export function buildCases(brief: OperationBrief, bp?: OfficeBlueprintV1): SimulationCase[] {
  const casos: SimulationCase[] = brief.jobs.slice(0, 6).map((job) => ({
    id: `job:${job.id}`,
    input: job.input || job.name,
    trigger: job.trigger || CANAL_PADRAO,
    expectedRoute: [job.name],
    expectsApproval: job.requiresHumanApproval === true || job.risk === 'high',
  }))

  /**
   * Sem trabalhos no Brief, os cenários saem do DESENHO.
   *
   * É o caso dos projetos anteriores ao Brief e o da proposta pedida direto: eles têm
   * agentes com responsabilidade declarada, e cada uma delas é um caminho que precisa
   * ser ensaiado. Sem isto, esses projetos ficariam com um cenário só — e um ensaio de
   * um cenário não descobre nada.
   */
  if (casos.length === 0 && bp) {
    for (const agent of (bp.agents ?? []).slice(0, 5)) {
      const responsabilidade = String(agent.objective ?? '').trim()
      if (!responsabilidade) continue
      casos.push({
        id: `agent:${agent.key}`,
        input: `algo que exige "${responsabilidade}"`,
        trigger: CANAL_PADRAO,
        expectedRoute: [responsabilidade],
        expectsApproval: false,
      })
    }
  }

  casos.push({
    id: 'fora-do-previsto',
    input: 'uma pergunta que não se encaixa em nenhum dos trabalhos mapeados',
    trigger: CANAL_PADRAO,
    expectedRoute: [],
    expectsApproval: false,
  })

  /**
   * O caminho da ação sensível, mesmo sem o Brief dizer.
   *
   * O `risk` está no próprio App: se a operação pode reembolsar ou apagar, existe um
   * cenário em que alguém deveria aprovar — e ele precisa ser ensaiado mesmo que
   * ninguém tenha escrito a regra.
   */
  const temAcaoSensivel = (bp?.appRequirements ?? []).length > 0 && brief.humanApprovals.length === 0
  if (brief.humanApprovals.length > 0 || temAcaoSensivel) {
    casos.push({
      id: 'aprovacao',
      input: brief.humanApprovals[0] ? `pedido que exige aprovação: ${brief.humanApprovals[0].action}` : 'um pedido que deveria exigir aprovação de uma pessoa',
      trigger: CANAL_PADRAO,
      expectedRoute: [],
      expectsApproval: true,
    })
  }

  return casos.slice(0, 8)
}

/** Quem recebe o que chega pelo canal: o coordenador, ou o único agente que existe. */
function pontoDeEntrada(bp: OfficeBlueprintV1): { key: string; name: string } | null {
  const agentes = bp.agents ?? []
  if (agentes.length === 0) return null
  const coordenador = (bp.sectors ?? []).map((s) => s.coordinatorAgentKey).find(Boolean)
  const doCanal = (bp.appRequirements ?? []).flatMap((r) => r.agentKeys ?? [])[0]
  const chave = doCanal ?? coordenador ?? agentes[0].key
  const agent = agentes.find((a) => a.key === chave) ?? agentes[0]
  return { key: agent.key, name: agent.name }
}

/**
 * O ensaio de um cenário.
 *
 * Percorre o desenho como o runtime percorreria: entra por quem atende o canal, o
 * coordenador distribui, o especialista trabalha, a ferramenta é chamada — em dublê. O
 * que interessa é onde o caminho PARA: um cenário que morre num agente sem ferramenta
 * é um cliente esperando resposta que não vem.
 */
export function simulateCase(caso: SimulationCase, bp: OfficeBlueprintV1, manifest: ArchitectCapabilityManifest | null): SimulationResult {
  const steps: SimulationStep[] = []
  const problems: SimulationResult['problems'] = []
  const sideEffectsAvoided: string[] = []
  const agentes = bp.agents ?? []

  const entrada = pontoDeEntrada(bp)
  if (!entrada) {
    return {
      caseId: caso.id,
      observedRoute: [],
      steps: [{ kind: 'dead_end', ref: '', detail: 'não há agente para receber' }],
      problems: [{ code: 'no_entry_point', message: 'nada nesta operação recebe o que chega', fix: 'crie ao menos um agente ligado ao canal' }],
      sideEffectsAvoided: [],
      matchedExpected: false,
    }
  }

  steps.push({ kind: 'agent', ref: entrada.name, detail: `recebe: ${caso.input}` })
  const rota = [entrada.name]

  // O coordenador distribui: quem ele alcança é quem pode resolver.
  const agenteEntrada = agentes.find((a) => a.key === entrada.key)!
  const alcanca =
    agenteEntrada.delegationPolicy === 'floor'
      ? agentes.filter((a) => a.key !== agenteEntrada.key && a.floorKey === agenteEntrada.floorKey)
      : agentes.filter((a) => (agenteEntrada.callableAgentKeys ?? []).includes(a.key))

  /**
   * Quem cobre este cenário.
   *
   * A comparação é entre o TRABALHO esperado e a responsabilidade declarada do agente —
   * nunca entre nomes. Os agentes têm nome de pessoa por desenho; comparar "Responder
   * dúvida" com "Marina" nunca casaria, e a rota observada pareceria sempre errada.
   */
  const cobre = (a: (typeof agentes)[number]): boolean => {
    const declarado = `${a.objective ?? ''} ${a.role ?? ''}`.toLowerCase()
    return caso.expectedRoute.some((trabalho) =>
      trabalho
        .toLowerCase()
        .split(/\s+/)
        .filter((palavra) => palavra.length >= 4)
        .some((palavra) => declarado.includes(palavra)),
    )
  }

  const candidatos = [agenteEntrada, ...alcanca]
  const coberto = candidatos.find(cobre)
  const executor = coberto ?? alcanca[0] ?? agenteEntrada

  if (executor.key !== agenteEntrada.key) {
    steps.push({ kind: 'agent', ref: executor.name, detail: 'acionado pelo coordenador' })
    rota.push(executor.name)
  }

  // A ferramenta é chamada em DUBLÊ: a intenção é registrada, a ação não acontece.
  const ferramentas = (bp.appRequirements ?? []).filter((r) => (r.agentKeys ?? []).includes(executor.key))
  for (const req of ferramentas) {
    const app = (manifest?.apps ?? []).find((a) => a.key === req.appKey)
    const sensiveis = (app?.actions ?? []).filter((a) => a.risk === 'high_risk' && (req.actionKeys ?? []).includes(a.key))
    for (const acao of req.actionKeys ?? []) {
      steps.push({ kind: 'tool', ref: `${req.appKey}.${acao}`, detail: 'dublê: a chamada foi registrada, não executada' })
      sideEffectsAvoided.push(`${req.appKey}.${acao}`)
    }
    if (!app?.connected) {
      problems.push({
        code: 'app_not_connected',
        message: `${req.appKey} não está conectado: este caminho para aqui`,
        fix: 'conecte o App antes de aplicar',
      })
      steps.push({ kind: 'dead_end', ref: req.appKey, detail: 'App não conectado' })
    }
    if (sensiveis.length > 0 && !caso.expectsApproval) {
      problems.push({
        code: 'unapproved_sensitive_action',
        message: `este caminho executa "${sensiveis[0].key}" sem aprovação humana`,
        fix: 'declare quem aprova antes de a ação acontecer',
      })
    }
  }

  // A aprovação humana, quando o cenário a exige.
  if (caso.expectsApproval) {
    const temHandoff = executor.handoffEnabled !== false
    steps.push({ kind: 'approval', ref: executor.name, detail: temHandoff ? 'para e espera uma pessoa' : 'ninguém aprova: segue sozinho' })
    if (!temHandoff) {
      problems.push({
        code: 'missing_approval',
        message: 'o cenário exige aprovação e o caminho não para em ninguém',
        fix: 'ligue a passagem para humano no agente que executa',
      })
    }
  }

  // Conhecimento que o caminho precisaria e que ainda não existe.
  const conhecimentoPendente = (bp.knowledgeRequirements ?? []).filter((k) => k.targetKey === executor.key && !k.content?.trim())
  for (const k of conhecimentoPendente) {
    problems.push({ code: 'missing_knowledge', message: `"${executor.name}" precisa de "${k.title}", que ainda não foi enviado`, fix: 'envie o conteúdo, ou aceite que ele responderá que não sabe' })
  }

  if (caso.id === 'fora-do-previsto' && executor.handoffEnabled === false) {
    problems.push({ code: 'no_fallback', message: 'não há saída para o que ninguém previu', fix: 'deixe um agente com passagem para humano' })
  }

  /**
   * "Bateu com o esperado" quer dizer: ALGUÉM neste desenho declara fazer o trabalho
   * do cenário, e o caminho até ele não esbarrou em problema bloqueante. Um cenário sem
   * trabalho esperado (o imprevisto, a aprovação) bate quando não encontra problema.
   */
  const matchedExpected = caso.expectedRoute.length === 0 ? problems.length === 0 : Boolean(coberto) && problems.length === 0

  return { caseId: caso.id, observedRoute: rota, steps, problems, sideEffectsAvoided, matchedExpected }
}

/** O ensaio inteiro, versionado — para comparar duas revisões da mesma operação. */
export function runSimulation(
  brief: OperationBrief,
  bp: OfficeBlueprintV1,
  manifest: ArchitectCapabilityManifest | null,
  version: number,
  now?: Date,
): SimulationRun {
  const cases = buildCases(brief, bp)
  const results = cases.map((c) => simulateCase(c, bp, manifest))
  return {
    version,
    ...(now ? { createdAt: now.toISOString() } : {}),
    cases,
    results,
    passed: results.filter((r) => r.matchedExpected && r.problems.length === 0).length,
  }
}
