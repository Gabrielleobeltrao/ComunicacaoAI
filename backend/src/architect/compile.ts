import { classifyBrief } from './classify.js'
import type { Classification, ResourceDecision } from './classify.js'
import { mergeSplitRationale } from './architecture.js'
import { emptyBlueprint } from './blueprint.js'
import type { ArchitectCapabilityManifest } from './capabilities.js'
import type { OperationBrief } from './brief.js'
import type { BlueprintAgent, BlueprintLayer, OfficeBlueprintV1 } from './types.js'

// O COMPILADOR: do entendimento para o desenho, sem passar pelo modelo.
//
// Enquanto o Blueprint vinha da LLM, duas conversas iguais produziam desenhos
// diferentes — e "por que este agente existe?" só tinha a resposta que o modelo
// resolvesse dar naquele dia. Aqui o desenho é DERIVADO: mesmo Brief, mesmo catálogo,
// mesma constituição, mesmo resultado, inclusive as chaves.
//
// A estabilidade das chaves não é preciosismo. Elas são o que liga a proposta ao
// recurso já aplicado: se `marina` virasse `agent-2` na revisão seguinte, o diff diria
// que um agente sumiu e outro nasceu — e a aplicação criaria um segundo agente ao lado
// do que já existe.
//
// O que o catálogo não tem vira PENDÊNCIA declarada. Um App inventado não é um App: é
// uma proposta que falha na hora de aplicar, depois de alguém ter aprovado.

/** Sem acento, sem espaço, estável: é a mesma chave toda vez que este trabalho aparecer. */
export function slug(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * Nomes de pessoa para os agentes.
 *
 * O agente se chama Marina, não "Analista de Swing Trade" — o cargo está no papel e no
 * objetivo. A lista é fixa e a escolha é por POSIÇÃO, não sorteada: o mesmo Brief
 * produz os mesmos nomes, e uma revisão não renomeia a equipe inteira.
 */
const NOMES = [
  'Marina', 'Rafael', 'Tereza', 'Bruno', 'Helena', 'Caio', 'Alice', 'Otávio',
  'Lívia', 'Gustavo', 'Nina', 'Daniel', 'Sofia', 'Renato', 'Clara', 'Vitor',
]

const nomeDoAgente = (indice: number): string => NOMES[indice % NOMES.length]

/** O que o servidor decidiu sobre cada trabalho, junto com o que ele vai virar. */
export interface CompiledJob {
  decision: ResourceDecision
  layer: BlueprintLayer
  layerReason: string
}

export interface CompileResult {
  blueprint: OfficeBlueprintV1
  classification: Classification
  jobs: CompiledJob[]
  /** O que foi citado e não existe no catálogo. Pendência declarada, nunca invenção. */
  pending: { kind: string; ref: string; because: string }[]
}

/**
 * A camada de cada trabalho.
 *
 * O núcleo é o caminho mínimo até o resultado principal: alguém recebe e responde. O
 * que torna a resposta boa — as ferramentas e as contas — é recomendado. O que roda
 * sozinho pode esperar o primeiro teste; ele não bloqueia ninguém.
 */
function camadaDo(decision: ResourceDecision, indiceDeAgente: number): { layer: BlueprintLayer; reason: string } {
  if (decision.kind === 'agent') {
    return indiceDeAgente === 0
      ? { layer: 'essential', reason: 'é quem recebe e responde: sem ele a operação não existe' }
      : { layer: 'recommended', reason: 'divide um trabalho que o primeiro agente faria sozinho' }
  }
  if (decision.kind === 'routine') {
    return { layer: 'complete', reason: 'roda sozinho: pode esperar o primeiro teste sem bloquear ninguém' }
  }
  return { layer: 'recommended', reason: 'melhora a resposta, mas o núcleo funciona sem ele' }
}

const CAMADA_ORDEM: Record<BlueprintLayer, number> = { essential: 0, recommended: 1, complete: 2 }

/**
 * O desenho derivado do entendimento.
 *
 * A ordem importa: os trabalhos são percorridos na ordem do Brief, e cada agente ganha
 * o nome da posição dele. Isso é o que torna as chaves estáveis entre revisões.
 */
export function compileBrief(
  brief: OperationBrief,
  manifest: ArchitectCapabilityManifest | null,
  base: { title: string; objective: string },
): CompileResult {
  const classification = classifyBrief(brief, manifest)
  const bp: OfficeBlueprintV1 = emptyBlueprint(base.title, brief.businessGoal || base.objective)
  const pending: CompileResult['pending'] = []
  const jobs: CompiledJob[] = []

  const floorKey = 'operacao'
  bp.floors = [
    {
      key: floorKey,
      action: 'create',
      name: base.title.slice(0, 60) || 'Operação',
      mission: brief.businessGoal.slice(0, 200) || undefined,
      workMode: 'organization',
      layer: 'essential',
      layerReason: 'é o lugar onde a operação mora',
      rationale: 'um andar só: os agentes desta operação trabalham no mesmo contexto',
    },
  ]

  let indiceDeAgente = 0
  const porTrabalho = new Map<string, string>()

  for (const decision of classification.decisions) {
    const job = brief.jobs.find((j) => j.id === decision.jobId)
    const { layer, reason } =
      decision.kind === 'agent' ? camadaDo(decision, indiceDeAgente) : camadaDo(decision, -1)
    jobs.push({ decision, layer, layerReason: reason })

    if (decision.kind === 'agent') {
      const key = slug(decision.jobId) || `agente-${indiceDeAgente}`
      const nome = nomeDoAgente(indiceDeAgente)
      porTrabalho.set(decision.jobId, key)
      const agente: BlueprintAgent = {
        key,
        action: 'create',
        floorKey,
        name: nome,
        preset: decision.suggestedPreset ?? 'custom',
        objective: job?.output ? `${decision.jobName}: entrega ${job.output}` : decision.jobName,
        role: job?.trigger ? `Quando ${job.trigger}` : `Quando o assunto for ${decision.jobName.toLowerCase()}`,
        ...(job?.decision ? { instructions: `Decide: ${job.decision}. Se faltar informação, diga que vai confirmar em vez de supor.` } : {}),
        ...(job?.input ? { inputContract: job.input } : {}),
        ...(job?.output ? { outputContract: job.output } : {}),
        executorKind: 'llm',
        handoffEnabled: true,
        layer,
        layerReason: reason,
        rationale: decision.because,
      }
      bp.agents.push(agente)
      indiceDeAgente += 1
      continue
    }

    if (decision.kind === 'tool') {
      if (!decision.resolved || !decision.resourceRef) {
        pending.push({ kind: 'tool', ref: decision.jobName, because: 'nenhum App do catálogo executa este trabalho' })
        continue
      }
      bp.appRequirements.push({
        key: slug(`app-${decision.resourceRef}-${decision.jobId}`),
        appKey: decision.resourceRef,
        reason: `${decision.jobName}: ${decision.because}`,
        required: true,
        actionKeys: [],
        agentKeys: [],
        layer,
        layerReason: reason,
      })
      continue
    }

    if (decision.kind === 'function' && !decision.resolved) {
      pending.push({ kind: 'function', ref: decision.jobName, because: 'nenhuma função registrada faz este cálculo' })
      continue
    }

    if (decision.kind === 'routine') {
      // A rotina precisa de dono; sem agente, ela fica como pendência.
      const dono = bp.agents[0]
      if (!dono) {
        pending.push({ kind: 'routine', ref: decision.jobName, because: 'não há agente para ser o dono da rotina' })
        continue
      }
      bp.routines.push({
        key: slug(`rotina-${decision.jobId}`),
        action: 'create',
        floorKey,
        ownerAgentKey: dono.key,
        name: decision.jobName,
        ...(job?.frequency ? { description: `Frequência declarada: ${job.frequency}` } : {}),
        triggerType: 'schedule',
        cron: '0 8 * * *',
        timezone: 'America/Sao_Paulo',
        /**
         * A rotina nasce com a etapa que ela precisa para existir.
         *
         * Rotina sem etapa é recusada pelo validador — e era o que acontecia quando o
         * desenho vinha do modelo, que era instruído a NÃO escrever etapas justamente
         * porque inventava a forma delas. O compilador sabe a forma: uma execução do
         * dono, por `agentKey`, que a aplicação troca pelo id real.
         */
        steps: [
          {
            id: 'executar',
            type: 'agent.execute',
            config: {
              agentKey: dono.key,
              instruction: job?.action ? `${decision.jobName}. ${job.action}.` : decision.jobName,
            },
          },
        ],
        layer,
        layerReason: reason,
        rationale: decision.because,
      })
    }
  }

  // O canal: a porta de entrada vai para o primeiro agente, que é quem recebe.
  const canalConectado = (manifest?.channels ?? []).find((c) => c.connected)
  const canalCitado = brief.channels[0]
  if (bp.agents[0]) {
    const chave = canalConectado?.key ?? (manifest?.channels ?? []).find((c) => canalCitado && c.key.includes(slug(canalCitado)))?.key
    if (chave) {
      bp.appRequirements.unshift({
        key: slug(`canal-${chave}`),
        appKey: chave,
        reason: 'Receber o que chega e responder por onde a pessoa falou.',
        required: true,
        actionKeys: [],
        agentKeys: [bp.agents[0].key],
        layer: 'essential',
        layerReason: 'sem canal, ninguém alcança a operação',
      })
    } else if (canalCitado) {
      pending.push({ kind: 'channel', ref: canalCitado, because: 'este canal não existe no catálogo desta conta' })
    }
  }

  // As ferramentas resolvidas ficam com o agente que conduz.
  for (const req of bp.appRequirements) {
    if (req.agentKeys.length === 0 && bp.agents[0]) req.agentKeys = [bp.agents[0].key]
  }

  /**
   * O setor só existe quando há mais de um agente E alguém para coordenar.
   *
   * Criar setor com um agente é agrupar uma pessoa — é o "setor orquestrado para
   * agrupar visualmente" que a constituição proíbe.
   */
  if (bp.agents.length > 1) {
    const coordenador = bp.agents[0]
    coordenador.preset = 'manager'
    coordenador.delegationPolicy = 'floor'
    coordenador.objective = `Receber o que chega, acionar quem resolve e devolver uma resposta só`
    bp.sectors.push({
      key: 'mesa',
      action: 'create',
      floorKey,
      name: 'Mesa de trabalho',
      mode: 'orchestrated',
      memberAgentKeys: bp.agents.map((a) => a.key),
      coordinatorAgentKey: coordenador.key,
      instruction: 'Uma porta de entrada só: o coordenador recebe e distribui.',
      layer: 'recommended',
      layerReason: 'o setor aparece quando existe mais de um agente para coordenar',
      rationale: 'são etapas encadeadas; o setor é o que faz elas conversarem',
    })
  }

  // O conhecimento que o Brief pediu vira pendência no escopo do agente que o usa.
  for (const need of brief.knowledgeNeeds) {
    const alvo = bp.agents[0]
    if (!alvo) break
    bp.knowledgeRequirements.push({
      key: slug(`conhecimento-${need.subject}`),
      scope: 'agent',
      targetKey: alvo.key,
      title: need.subject.slice(0, 80),
      description: 'Sem isto, o agente responde por conta própria — e é aí que ele inventa.',
      required: need.required,
      expectedSource: 'user_answer',
      state: 'missing',
      layer: need.required ? 'essential' : 'recommended',
      layerReason: need.required ? 'sem esta base, a resposta do núcleo não é confiável' : 'melhora a resposta, mas o núcleo funciona sem',
    })
  }

  // As suposições do Brief acompanham a proposta: elas explicam o que foi assumido.
  bp.assumptions = brief.assumptions
    .filter((a) => a.status === 'open')
    .slice(0, 10)
    .map((a) => ({ key: a.id, text: a.text }))

  // O que não existe no catálogo é dito em voz alta, junto da proposta.
  bp.warnings = pending.map((p) => ({ path: p.kind, message: `${p.ref}: ${p.because} — fica como pendência` }))

  return { blueprint: bp, classification, jobs, pending }
}

/**
 * O recorte de uma camada — com as dependências que ela precisa para funcionar.
 *
 * Aplicar "essencial" não pode entregar um setor cujos membros ficaram de fora, nem uma
 * rotina sem dono. Por isso o filtro é por camada E por fechamento: o que sobra precisa
 * ser aplicável sozinho.
 */
export function selectLayer(bp: OfficeBlueprintV1, layer: BlueprintLayer): OfficeBlueprintV1 {
  const cabe = (item: { layer?: BlueprintLayer }): boolean => CAMADA_ORDEM[item.layer ?? 'essential'] <= CAMADA_ORDEM[layer]

  const agents = (bp.agents ?? []).filter(cabe)
  const chaves = new Set(agents.map((a) => a.key))
  /**
   * Alguém ficou de fora?
   *
   * Só então valem as regras de tamanho — "setor precisa de dois", "quem sobrou sozinho
   * não coordena". Sem essa distinção, o recorte reescreveria um projeto LEGADO, cujos
   * itens não têm camada e portanto entram todos: um setor de um membro que já existia
   * sumiria da proposta sem ninguém ter pedido. As demais regras são fechamento de
   * dependência, e não fazem nada quando nada foi cortado.
   */
  const cortou = agents.length < (bp.agents ?? []).length

  const sectors = (bp.sectors ?? [])
    .filter(cabe)
    // Um setor que perdeu membros a ponto de sobrar um não é setor: virou um agente
    // sozinho com um rótulo em volta.
    .map((s) => ({ ...s, memberAgentKeys: (s.memberAgentKeys ?? []).filter((k) => chaves.has(k)) }))
    .filter((s) => (s.memberAgentKeys.length > 1 || !cortou) && (!s.coordinatorAgentKey || chaves.has(s.coordinatorAgentKey)))

  const routines = (bp.routines ?? []).filter((r) => cabe(r) && chaves.has(r.ownerAgentKey))

  const appRequirements = (bp.appRequirements ?? [])
    .filter(cabe)
    // Some só o que ficou ÓRFÃO: a exigência que citava agentes e perdeu todos eles.
    // A que nunca citou ninguém é da operação inteira e continua valendo.
    .filter((r) => (r.agentKeys ?? []).length === 0 || (r.agentKeys ?? []).some((k) => chaves.has(k)))
    .map((r) => ({ ...r, agentKeys: (r.agentKeys ?? []).filter((k) => chaves.has(k)) }))

  const knowledgeRequirements = (bp.knowledgeRequirements ?? [])
    .filter(cabe)
    .filter((k) => k.scope !== 'agent' || !k.targetKey || chaves.has(k.targetKey))

  // Quem sobrou sozinho não coordena o vazio: sem equipe, delegação por andar é uma
  // permissão que não alcança ninguém, e o validador cobraria a equipe que não existe.
  const sozinho = cortou && agents.length === 1 && sectors.length === 0
  return {
    ...bp,
    agents: agents.map((a) =>
      sozinho && (a.delegationPolicy === 'floor' || a.preset === 'manager')
        ? {
            ...a,
            delegationPolicy: 'none' as const,
            preset: a.preset === 'manager' ? 'communicator' : a.preset,
            objective: `${a.objective ?? ''}`.replace('acionar quem resolve e devolver uma resposta só', 'responder').trim(),
          }
        : a,
    ),
    sectors,
    routines,
    appRequirements,
    knowledgeRequirements,
  }
}

/** Quantos itens cada camada acrescenta — para a tela dizer o que muda ao trocar. */
export function layerCounts(bp: OfficeBlueprintV1): Record<BlueprintLayer, { agents: number; sectors: number; routines: number; apps: number }> {
  const contar = (layer: BlueprintLayer) => {
    const recorte = selectLayer(bp, layer)
    return {
      agents: recorte.agents.length,
      sectors: recorte.sectors.length,
      routines: recorte.routines.length,
      apps: recorte.appRequirements.length,
    }
  }
  return { essential: contar('essential'), recommended: contar('recommended'), complete: contar('complete') }
}

export { mergeSplitRationale }
