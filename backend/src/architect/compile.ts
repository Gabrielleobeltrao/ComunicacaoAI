import { classifyBrief } from './classify.js'
import type { Classification, ResourceDecision } from './classify.js'
import { mergeSplitRationale } from './architecture.js'
import { emptyBlueprint } from './blueprint.js'
import type { ArchitectCapabilityManifest } from './capabilities.js'
import type { BriefJob, OperationBrief } from './brief.js'
import { areasOf, findExistingFloor } from './compileV2.js'
import type { OfficeInventory } from './inventory.js'
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
/**
 * Alguém FALA com este agente?
 *
 * O gatilho é o que decide: um trabalho que começa quando uma pessoa escreve precisa de
 * porta; um que começa no horário, não. O texto do trabalho conta junto, porque "responder
 * a dúvida" é conversa mesmo quando o gatilho não diz quem falou.
 */
function ehConversa(job: BriefJob): boolean {
  const t = `${job.trigger ?? ''} ${job.name ?? ''} ${job.action ?? ''} ${job.input ?? ''}`.toLowerCase()
  return /(cliente|pessoa|usuário|usuario|visitante|lead|conversa|mensagem|whatsapp|chat|responder|atender|dúvida|duvida|pergunta)/.test(t)
}

/**
 * A ROTINA de um trabalho agendado.
 *
 * Mesma forma da rotina que o classificador já produzia — inclusive a etapa, que existe
 * porque rotina sem etapa é recusada pelo validador. O que muda é a origem: aqui o
 * trabalho é de um AGENTE, e a rotina só o aciona.
 */
function rotinaPara(job: BriefJob, agentKey: string, floorKey: string, layer: BlueprintLayer, layerReason: string): OfficeBlueprintV1['routines'][number] {
  const quando = [job.trigger, job.frequency].filter((t) => t && t.trim()).join(' · ')
  return {
    key: slug(`rotina-${job.id}`),
    action: 'create',
    floorKey,
    ownerAgentKey: agentKey,
    name: job.name,
    // O QUE A PESSOA DISSE, escrito. O `cron` abaixo é um padrão para a rotina poder
    // nascer; é esta frase que diz o que ela pediu de verdade.
    ...(quando ? { description: `Quando: ${quando}` } : {}),
    triggerType: 'schedule',
    cron: '0 8 * * *',
    timezone: 'America/Sao_Paulo',
    steps: [
      {
        id: 'executar',
        type: 'agent.execute',
        config: { agentKey, instruction: job.action ? `${job.name}. ${job.action}.` : job.name },
      },
    ],
    layer,
    layerReason,
    rationale: 'este trabalho acontece por horário: a rotina é quem o aciona',
  }
}

/**
 * Este trabalho acontece SOZINHO, por horário?
 *
 * Lê o `trigger` e a `frequency` — as duas frases que falam de quando. `CADENCIA` é a mesma
 * família de palavras que o classificador usa; o que muda aqui é onde ela é procurada.
 */
function ehAgendado(job: BriefJob): boolean {
  const quando = `${job.trigger ?? ''} ${job.frequency ?? ''}`.toLowerCase()
  if (!quando.trim()) return false
  // Uma pessoa escrevendo não é um horário, mesmo que a frase tenha "todo": "todo cliente
  // que escreve" é conversa, e conversa não vira rotina.
  if (/(cliente|pessoa|usuário|usuario|alguém|alguem)\s+(escreve|manda|pergunta|chama)/.test(quando)) return false
  return CADENCIA_DE_ROTINA.test(quando)
}

/** A mesma família de palavras do classificador — ver `CADENCIA` em `classify.ts`. */
const CADENCIA_DE_ROTINA =
  /(\bdiári|\bdiario|\bsemanal|\bmensal|\banual|\bhora\b|\bhoras\b|\bminuto|\bdia\b|\bdias\b|\bsemana|\bmês\b|\bmes\b|\bmeses|\btoda\s|\btodo\s|\btodos\s|\bcada\s+\d|\bmanhã|\bmanha|\btarde|\bnoite|\bmadrugada|\bútil|\butil|\bsegunda|\bterça|\bterca|\bquarta|\bquinta|\bsexta|\bsábado|\bsabado|\bdomingo|\bcron|\bfim do dia|\bfinal do dia)/i

export function compileBrief(
  brief: OperationBrief,
  manifest: ArchitectCapabilityManifest | null,
  base: { title: string; objective: string },
  /** O que a conta já tem. Sem isto, todo pedido abria um andar próprio. */
  inventory: OfficeInventory | null = null,
  /**
   * O que a pessoa RESPONDEU. `forma:<jobId>` é a escolha entre agente, função,
   * ferramenta e rotina — e ela vence a recomendação da regra.
   */
  answers: Record<string, unknown> = {},
): CompileResult {
  const classification = classifyBrief(brief, manifest, answers)
  const bp: OfficeBlueprintV1 = emptyBlueprint(base.title, brief.businessGoal || base.objective)
  const pending: CompileResult['pending'] = []
  const jobs: CompiledJob[] = []

  /**
   * UM TÍTULO NÃO É UM ANDAR NOVO.
   *
   * Isto criava um andar por operação, sempre: `action: 'create'` fixo, nome tirado do
   * título, e o inventário nem chegava aqui. Quem já tinha o escritório montado pedia
   * "guarde a máxima do dia" e ganhava um andar chamado "Máxima e mínima do Bitcoin" ao
   * lado do que usava — e a operação nascia longe de tudo o que ela precisava.
   *
   * A regra é a mesma do V2: conta vazia ganha o primeiro andar; se a pessoa nomeia uma
   * ÁREA ("atendimento", "financeiro"), essa área é procurada e criada se não existir; e
   * trabalho que não descreve área nenhuma mora no andar que já existe.
   */
  const areas = areasOf(brief)
  const daArea = areas.length ? findExistingFloor(inventory, areas[0]) : null
  const existentes = inventory?.sections.floor?.items ?? []
  const anfitriao = daArea ?? (areas.length === 0 ? (existentes[0] ?? null) : null)
  /**
   * COM VÁRIOS ANDARES e nenhuma área dita, a escolha é da pessoa.
   *
   * Pegar o primeiro é adivinhar onde o trabalho mora, e a proposta sai montada no lugar
   * errado parecendo certa — foi assim que guardar o máximo do Bitcoin nasceu no "Salão",
   * que é o andar do restaurante, só por ser o primeiro da lista.
   *
   * O plano continua montado no primeiro para permanecer válido (agente mora em andar), e
   * a escolha vira pendência declarada. Perguntar é mais barato que desfazer.
   */
  if (!daArea && areas.length === 0 && existentes.length > 1) {
    pending.push({
      kind: 'floor_choice',
      ref: base.title,
      because: `em qual andar este trabalho mora? montei em "${existentes[0].label}" por enquanto; a conta tem ${existentes.length}: ${existentes.slice(0, 6).map((f) => f.label).join(', ')}`,
    })
  }
  /**
   * A KEY NÃO MUDA — ela é o que liga a proposta ao recurso aplicado.
   *
   * Derivá-la do nome do andar anfitrião parecia mais legível e é um defeito: uma revisão
   * que reencontrasse outro andar produziria outra `key`, e o `resourceMap` da aplicação
   * anterior deixaria de casar. O resultado seria um segundo escritório ao lado do
   * primeiro — exatamente o que "não duplica recursos existentes" proíbe. O que muda é a
   * AÇÃO e para onde ela aponta.
   */
  const floorKey = 'operacao'
  bp.floors = [
    anfitriao
      ? {
          key: floorKey,
          action: 'reuse',
          resourceId: 'id' in anfitriao ? anfitriao.id : (anfitriao as { id: string }).id,
          name: anfitriao.label,
          mission: brief.businessGoal.slice(0, 200) || undefined,
          workMode: 'organization',
          layer: 'essential',
          layerReason: 'é o lugar onde a operação mora',
          rationale: 'este andar já existe: a operação entra nele em vez de abrir outro ao lado',
        }
      : {
          key: floorKey,
          action: 'create',
          name: areas[0] ?? base.title.slice(0, 60) ?? 'Operação',
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

      /**
       * QUEM DISPARA, quando o trabalho acontece sozinho.
       *
       * Agente e rotina não competem: um é o TRABALHADOR, a outra é o GATILHO. Um trabalho
       * que exige julgamento E acontece no fim do dia precisa dos dois — sem a rotina ele
       * nasce pronto esperando uma conversa, que é justamente o que a pessoa disse que não
       * queria.
       *
       * A cadência é lida do TRIGGER, e essa era a causa: `texto(job)` junta nome, ação,
       * decisão e saída — a frase que diz QUANDO a coisa acontece era a única que ninguém
       * lia.
       */
      if (job && ehAgendado(job)) {
        bp.routines.push(rotinaPara(job, key, floorKey, layer, reason))
        // O HORÁRIO EXATO é da pessoa, não meu. O padrão existe para a rotina poder nascer;
        // inventá-lo em silêncio é entregar um alarme que toca na hora errada.
        pending.push({ kind: 'routine_time', ref: job.name, because: `confirme o horário: "${job.trigger}" — a rotina nasce com um horário padrão até você ajustar` })
      }
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

  /**
   * O CANAL só existe onde alguém ENTRA.
   *
   * Uma porta de entrada é para uma pessoa FALAR com o agente. Numa operação que roda
   * sozinha no fim do dia não há quem fale — e abrir a porta assim mesmo é prometer um
   * atendimento que ninguém vai atender.
   *
   * Isto acontecia porque `brief.channels` ACUMULA: o modelo escreveu "web_chat" numa
   * rodada e a pessoa disse "não quero conversa" na seguinte, sem que a lista fosse
   * retratada. O entendimento guarda o que foi dito; quem decide o que vira recurso é aqui.
   */
  const alguemFala = brief.jobs.some((j) => ehConversa(j))
  const canalConectado = (manifest?.channels ?? []).find((c) => c.connected)
  const canalCitado = brief.channels[0]
  if (bp.agents[0] && alguemFala) {
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
