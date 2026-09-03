import { classifyBrief } from './classify.js'
import type { Classification, ResourceDecision } from './classify.js'
import { slug } from './compile.js'
import type { ArchitectCapabilityManifest, CapabilityApp } from './capabilities.js'
import type { BriefJob, OperationBrief } from './brief.js'
import type { OfficeInventory } from './inventory.js'
import { emptyBlueprintV2 } from './typesV2.js'
import type {
  BlueprintAgentV2,
  BlueprintChangeKindV2,
  OfficeBlueprintV2,
} from './typesV2.js'

// O COMPILADOR V2 — do entendimento para a OPERAÇÃO, sem passar pelo modelo.
//
// O compilador V1 produzia organização: um andar, alguns agentes, talvez uma rotina. Cinco
// defeitos vinham daí, e todos aparecem em produção:
//
//   • um andar genérico para qualquer empresa, sempre `create` — nunca expandir;
//   • `actionKeys: []` em todo App, o que resolve para zero ferramentas;
//   • o canal CONECTADO ganhando do canal PEDIDO;
//   • `liveDataNeeds` compilado em nada;
//   • "quando o RSI ficar abaixo de 30" virando uma rotina com cron das oito da manhã.
//
// Aqui as cinco morrem. O que continua igual é a garantia que já valia: mesmo Brief, mesmo
// inventário, mesmo catálogo → mesmo Blueprint, inclusive as chaves. A key é o que liga a
// proposta ao recurso aplicado; se ela variasse, uma revisão criaria um segundo agente ao
// lado do que já existe.

export interface CompileV2Input {
  brief: OperationBrief
  manifest: ArchitectCapabilityManifest | null
  /** O que a conta já tem. É daqui que sai a escolha entre expandir e criar. */
  inventory: OfficeInventory | null
  base: { title: string; objective: string }
  changeKind: BlueprintChangeKindV2
  /**
   * Os andares que a organização JÁ decidiu, quando ela é decidida em outro lugar.
   *
   * Enquanto a flag do V2 rola, quem cria andares e agentes continua sendo a saga do V1, a
   * partir do plano V1. Se o V2 inventasse as próprias `key`s de andar, o Flow dele
   * apontaria para um andar que ninguém criou — e `floor:atendimento` nunca resolveria no
   * `resourceMap`. Recebendo os andares prontos, os dois documentos descrevem UM escritório.
   */
  floors?: { key: string; name: string }[]
}

export interface CompileV2Result {
  blueprint: OfficeBlueprintV2
  classification: Classification
  /** O que foi citado e não existe no catálogo. Pendência declarada, nunca invenção. */
  pending: { kind: string; ref: string; because: string }[]
}

const ESSENCIAL = { layer: 'essential' as const }

// --- a condição de dado, que não é um horário ------------------------------------------------

/**
 * Uma condição sobre DADO — "quando o RSI ficar abaixo de 30", "se o estoque cair".
 *
 * É o que separa vigilância de agendamento. Um trabalho disparado por horário é uma rotina;
 * um disparado por uma condição precisa de fonte (para o dado existir), de histórico (para
 * haver "antes" e "agora") e de monitor (para a borda ser detectada). Transformar o segundo
 * em cron das oito é entregar um alarme que toca no horário errado e não toca no certo.
 */
const CONDICAO_DE_DADO =
  /\b(quando|se|caso|assim que|sempre que)\b[^.]{0,80}\b(ficar|for|cair|subir|passar|ultrapassar|atingir|chegar|abaixo|acima|maior|menor|igual|cruzar|variar)\b/i

/** Um número solto na frase do gatilho — é ele que vira o limiar do monitor. */
const LIMIAR = /(-?\d+(?:[.,]\d+)?)\s*%?/

const COMPARADORES: { padrao: RegExp; op: string }[] = [
  { padrao: /\b(abaixo de|menor que|inferior a|cair para|cair abaixo)\b/i, op: 'lt' },
  { padrao: /\b(acima de|maior que|superior a|passar de|ultrapassar)\b/i, op: 'gt' },
  { padrao: /\b(igual a|for igual)\b/i, op: 'eq' },
  { padrao: /\b(no mínimo|pelo menos)\b/i, op: 'gte' },
  { padrao: /\b(no máximo|até)\b/i, op: 'lte' },
]

export interface ParsedCondition {
  /** O campo observado, quando dá para nomeá-lo a partir do texto. */
  field: string | null
  op: string
  value: number | null
  /** `cross_down`/`cross_up` quando o texto fala em cruzar; `enter` no caso comum. */
  triggerMode: string
}

/**
 * Lê a condição da frase — e devolve `null` quando não há condição de dado nenhuma.
 *
 * O que ela NÃO faz é tão importante quanto o que faz: campo ausente não vira zero, e
 * limiar ausente não vira um padrão. Um monitor com `value: 0` inventado dispara sempre ou
 * nunca, e nos dois casos ninguém descobre por quê.
 */
export function parseDataCondition(texto: string): ParsedCondition | null {
  const t = String(texto ?? '')
  if (!CONDICAO_DE_DADO.test(t)) return null

  const comparador = COMPARADORES.find((c) => c.padrao.test(t))
  const cruzar = /\bcruzar\b/i.test(t)
  const numero = LIMIAR.exec(t)
  const valor = numero ? Number(numero[1].replace(',', '.')) : null

  /**
   * O campo é o nome que aparece ANTES do comparador — "o RSI ficar abaixo de 30" → `rsi`.
   *
   * Quando não dá para nomeá-lo, o resultado é `null` e vira pendência: perguntar "qual
   * campo?" é melhor que escolher um e observar a coisa errada.
   */
  const antes = comparador ? t.slice(0, comparador.padrao.exec(t)?.index ?? 0) : t
  const palavras = antes
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((p) => p.length >= 2 && !/^(quando|se|caso|assim|que|o|a|os|as|de|do|da|ficar|for|cair|subir|passar|me|avise|e)$/i.test(p))
  const campo = palavras.length ? slug(palavras[palavras.length - 1]) : null

  return {
    field: campo || null,
    op: comparador?.op ?? 'lt',
    value: Number.isFinite(valor) ? valor : null,
    triggerMode: cruzar ? (comparador?.op === 'gt' ? 'cross_up' : 'cross_down') : 'enter',
  }
}

// --- a resolução exata de ações de App ----------------------------------------------------------

/**
 * As ações REAIS de um App que servem a este trabalho.
 *
 * O V1 devolvia `[]` aqui, e um grant sem ação resolve para zero ferramentas: o agente ficava
 * com o App declarado e sem poder usá-lo. A resolução casa o verbo do trabalho com o nome e a
 * chave das ações que o manifesto declara — uma ação fora dessa lista não existe, e pedir por
 * ela seria propor um grant que a aplicação recusa depois de alguém aprovar.
 *
 * Leitura e escrita saem SEPARADAS de propósito: a tela mostra as duas em blocos diferentes, e
 * escrita autônoma é uma aprovação por ação, nunca um efeito de conectar.
 */
/** "eventos" e "evento" são a mesma palavra para efeito de casamento. */
const semPlural = (t: string): string => t.toLowerCase().replace(/s\b/g, '')

/**
 * A frase aparece no texto, PALAVRA POR PALAVRA — e não como substring exata.
 *
 * `alvo.includes('criar evento')` falha em "criar o evento na agenda", que é como qualquer
 * pessoa escreve. Perder o App por causa de um artigo no meio cria um agente que não alcança
 * o sistema de que ele precisa — e ninguém descobre isso até a primeira reserva não entrar
 * na agenda.
 *
 * Continua conservador: TODAS as palavras significativas precisam estar lá. "Listar eventos"
 * não casa com "criar o evento", porque "listar" não aparece.
 */
function mencionaAFrase(alvo: string, frase: string): boolean {
  const palavras = frase
    .split(/[^\p{L}\p{N}]+/u)
    .filter((p) => p.length > 3)
    .map(semPlural)
  if (!palavras.length) return false
  const texto = semPlural(alvo)
  return palavras.every((p) => texto.includes(p))
}

export function resolveAppActions(app: CapabilityApp, job: BriefJob | null): { read: string[]; write: string[] } {
  const alvo = `${job?.name ?? ''} ${job?.action ?? ''} ${job?.output ?? ''} ${job?.decision ?? ''}`.toLowerCase()
  const read: string[] = []
  const write: string[] = []

  for (const acao of app.actions ?? []) {
    const nome = acao.name.toLowerCase()
    const chave = acao.key.toLowerCase().replace(/_/g, ' ')
    // Casa por nome OU por chave, e cada palavra da chave conta: `create_event` casa com
    // "criar evento" e com "agendar", porque o nome declarado é "Criar evento".
    const casa = mencionaAFrase(alvo, nome) || mencionaAFrase(alvo, chave)
    if (!casa) continue
    ;(acao.risk === 'read' ? read : write).push(acao.key)
  }

  /**
   * Quando nada casou, a leitura mínima vale — e a escrita não.
   *
   * Um App declarado como necessário sem ação nenhuma é recusado pelo validador. Dar a ele a
   * ação de leitura mais óbvia deixa a proposta utilizável; dar uma escrita por padrão seria
   * conceder poder que ninguém pediu.
   */
  if (!read.length && !write.length) {
    const leitura = (app.actions ?? []).find((a) => a.risk === 'read')
    if (leitura) read.push(leitura.key)
  }
  return { read, write }
}

/**
 * O canal que a pessoa PEDIU — e não o primeiro que está conectado.
 *
 * O V1 escolhia `apps.find(c => c.connected)`: quem pedia WhatsApp e tinha o web_chat
 * conectado recebia uma proposta de web_chat, sem aviso. O pedido ganha sempre; a conexão
 * vira pendência de checklist, que é o lugar certo para ela.
 */
export function resolveChannel(
  pedidos: string[],
  manifest: ArchitectCapabilityManifest | null,
): { key: string; connected: boolean } | { missing: string } | null {
  const canais = manifest?.channels ?? []
  for (const pedido of pedidos) {
    const alvo = slug(pedido)
    const achado = canais.find((c) => slug(c.key) === alvo || slug(c.key).includes(alvo) || alvo.includes(slug(c.key)))
    if (achado) return { key: achado.key, connected: achado.connected }
    // Pediu um canal que esta conta não tem: é pendência declarada, não substituição.
    return { missing: pedido }
  }
  // Ninguém pediu canal: aí sim o conectado serve, porque não há pedido para contrariar.
  const conectado = canais.find((c) => c.connected)
  return conectado ? { key: conectado.key, connected: true } : null
}

// --- a escolha entre expandir e criar -----------------------------------------------------------

/**
 * O andar existente que serve a este objetivo — se houver.
 *
 * A comparação é por NOME normalizado, e é conservadora: só reaproveita quando o nome bate de
 * verdade. Reaproveitar por semelhança vaga faria "Atendimento" e "Atendimento ao fornecedor"
 * virarem o mesmo andar, e a expansão sobrescreveria o que já existia.
 */
/**
 * O andar que já existe para este nome — por nome igual, ou pela MESMA ÁREA.
 *
 * O nome igual não basta: "adicione recepção ao meu salão" vira a área "Atendimento", e o
 * andar que a pessoa tem se chama "Recepção". Propor "Atendimento" ao lado dele é criar um
 * segundo andar para a mesma coisa — que é exatamente o que a expansão não pode fazer.
 *
 * Continua conservador: só casa quando o nome do andar existente cai na MESMA família de
 * palavras que produziu a área. "Recepção" e "Atendimento" casam; "Recepção" e "Financeiro"
 * não.
 */
export function findExistingFloor(inventory: OfficeInventory | null, nome: string): { id: string; label: string } | null {
  const alvo = slug(nome)
  if (!alvo) return null
  const andares = inventory?.sections.floor?.items ?? []
  const porNome = andares.find((f) => slug(f.label) === alvo)
  if (porNome) return { id: porNome.id, label: porNome.label }

  const familia = AREAS.find(([, area]) => area === nome)?.[0]
  if (!familia) return null
  /**
   * Só um nome de UMA palavra é reusado pela família.
   *
   * "Recepção" é o andar de atendimento com outro nome. "Atendimento ao fornecedor" não é o
   * andar de atendimento ao cliente — o qualificador é o que o distingue, e reaproveitar por
   * semelhança vaga faria a expansão escrever no andar errado.
   */
  const porArea = andares.find((f) => {
    const palavras = f.label.trim().split(/\s+/)
    return palavras.length === 1 && familia.test(palavras[0].toLowerCase())
  })
  return porArea ? { id: porArea.id, label: porArea.label } : null
}

/** As famílias de palavras que nomeiam uma área. Uma empresa com três áreas não é um andar só. */
const AREAS: [RegExp, string][] = [
  [/\b(atend|suporte|sac|recep|cliente)\w*/, 'Atendimento'],
  [/\b(vend|comercial|prospec)\w*/, 'Comercial'],
  [/\b(financ|cobran|faturam|pagament)\w*/, 'Financeiro'],
  [/\b(logíst|logist|entreg|expedi|estoque)\w*/, 'Logística'],
  [/\b(marketing|conteúdo|conteudo|campanha)\w*/, 'Marketing'],
  [/\b(operaç|operac|produç|produc)\w*/, 'Operações'],
]

/** As ÁREAS que o Brief descreve. */
export function areasOf(brief: OperationBrief): string[] {
  const texto = `${brief.businessGoal} ${brief.jobs.map((j) => j.name).join(' ')}`.toLowerCase()
  const achadas = AREAS.filter(([re]) => re.test(texto)).map(([, nome]) => nome)
  return achadas.length ? achadas : []
}

// --- o compilador -------------------------------------------------------------------------------

export function compileBriefV2(input: CompileV2Input): CompileV2Result {
  const { brief, manifest, inventory, base, changeKind } = input
  const classification = classifyBrief(brief, manifest)
  const bp = emptyBlueprintV2(base.title, brief.businessGoal || base.objective, changeKind)
  const pending: CompileV2Result['pending'] = []

  // --- 1. os andares: quantas áreas, e quais já existem ------------------------------------
  const areas = areasOf(brief)
  const nomes = areas.length ? areas : [base.title.slice(0, 60) || 'Operação']

  const floorKeyDe = new Map<string, string>()
  // Andares decididos fora: entram como estão, e nenhuma `key` é inventada aqui.
  for (const andar of input.floors ?? []) floorKeyDe.set(andar.name, andar.key)
  for (const nome of input.floors ? [] : nomes) {
    const existente = findExistingFloor(inventory, nome)
    const key = slug(nome) || 'operacao'
    floorKeyDe.set(nome, key)
    bp.organization.floors.push({
      key,
      // Expandir em vez de duplicar: o andar que já existe é REUSADO, e a proposta só
      // acrescenta o que falta nele.
      action: existente ? 'reuse' : 'create',
      ...(existente ? { resourceId: existente.id } : {}),
      ...ESSENCIAL,
      rationale: existente ? `este andar já existe: a proposta acrescenta, não recria` : 'é o lugar onde esta área trabalha',
      dependsOn: [],
      name: existente?.label ?? nome,
      ...(brief.businessGoal ? { mission: brief.businessGoal.slice(0, 200) } : {}),
      workMode: 'organization',
    })
  }
  // Quando os andares vêm prontos, eles são o bloco de organização do V2 também: dois
  // documentos, uma organização só.
  if (input.floors?.length) {
    bp.organization.floors = input.floors.map((a) => ({
      key: a.key,
      action: 'reuse' as const,
      ...ESSENCIAL,
      rationale: 'o andar é criado pela aplicação da organização; aqui ele só é referenciado',
      dependsOn: [],
      name: a.name,
      workMode: 'organization' as const,
    }))
  }
  const andarPadrao = bp.organization.floors[0].key
  /** Em qual andar este trabalho mora. Sem pista, o primeiro. */
  const andarDo = (job: BriefJob | undefined): string => {
    const texto = `${job?.name ?? ''} ${job?.action ?? ''}`.toLowerCase()
    for (const [nome, key] of floorKeyDe) {
      if (texto.includes(nome.toLowerCase().slice(0, 5))) return key
    }
    return andarPadrao
  }

  // --- 2. as peças, por classificação -------------------------------------------------------
  const NOMES = ['Marina', 'Rafael', 'Tereza', 'Bruno', 'Helena', 'Caio', 'Alice', 'Otávio', 'Lívia', 'Gustavo']
  let indiceDeAgente = 0
  const agentePorTrabalho = new Map<string, string>()

  for (const decision of classification.decisions) {
    const job = brief.jobs.find((j) => j.id === decision.jobId)

    /**
     * A CONDIÇÃO DE DADO vem antes do tipo — e é por isso que ela é lida aqui.
     *
     * O classificador olha o texto do trabalho e vê "RSI": para ele, isso é cálculo. Está
     * certo sobre o cálculo e errado sobre a FORMA — "me avise quando o RSI ficar abaixo de
     * 30" não é uma conta que roda uma vez, é uma vigilância: o dado precisa chegar
     * continuamente, ter um "antes" e um "agora", e a borda precisa ser detectada.
     *
     * As duas coisas convivem: a vigilância é compilada aqui, e o cálculo continua descendo
     * para virar função ou pendência. Escolher uma delas descartaria a outra.
     */
    const vigilancia = parseDataCondition(`${job?.trigger ?? ''} ${job?.name ?? ''}`)
    if (vigilancia && decision.kind !== 'agent') {
      compilarVigilancia(bp, pending, { brief, job, decision, condicao: vigilancia, floorKey: andarDo(job) })
      if (decision.kind === 'function' && !decision.resolved) {
        pending.push({ kind: 'function', ref: decision.jobName, because: 'nenhuma função registrada faz este cálculo' })
      }
      continue
    }

    if (decision.kind === 'agent') {
      const key = slug(decision.jobId) || `agente-${indiceDeAgente}`
      const nome = NOMES[indiceDeAgente % NOMES.length]
      agentePorTrabalho.set(decision.jobId, key)
      const agente: BlueprintAgentV2 = {
        key,
        action: 'create',
        ...ESSENCIAL,
        rationale: decision.because,
        dependsOn: [andarDo(job)],
        floorKey: andarDo(job),
        name: nome,
        // Nenhum destes pode ficar vazio: o validador V2 recusa, e o Flow renderizaria uma
        // ficha em branco. Onde o Brief não diz, o compilador deriva do trabalho.
        role: job?.decision ? `Decide ${job.decision}` : `Responsável por ${decision.jobName.toLowerCase()}`,
        trigger: job?.trigger ? `Quando ${job.trigger}` : `Quando o assunto for ${decision.jobName.toLowerCase()}`,
        inputContract: job?.input || 'o que chegou pelo canal',
        outputContract: job?.output || `o resultado de ${decision.jobName.toLowerCase()}`,
        ...(job?.decision ? { judgement: job.decision } : {}),
        ...(job?.action ? { performs: job.action } : {}),
        preset: decision.suggestedPreset ?? 'custom',
        objective: job?.output ? `${decision.jobName}: entrega ${job.output}` : decision.jobName,
        executorKind: 'llm',
        handoffEnabled: true,
      }
      bp.organization.agents.push(agente)
      indiceDeAgente += 1

      /**
       * O App que o TRABALHO DO AGENTE cita — com as ações exatas.
       *
       * Um agente que "cria o evento na agenda" precisa da ferramenta do calendário. O V1
       * só criava requisito de App quando o classificador dizia `tool`, e um trabalho que
       * mistura conversa e ação externa não é `tool` — é um agente com ferramenta. Sem
       * isto, o agente é criado e não alcança o sistema que ele precisa usar.
       */
      for (const app of manifest?.apps ?? []) {
        const acoes = resolveAppActions(app, job ?? null)
        // Só quando alguma ação REALMENTE casou: o fallback de leitura mínima existe para
        // quem já foi escolhido, não para escolher.
        const citado = `${job?.action ?? ''} ${job?.output ?? ''} ${job?.name ?? ''}`.toLowerCase()
        const mencionado =
          citado.includes(app.key.replace(/_/g, ' ')) ||
          citado.includes(app.name.toLowerCase()) ||
          (app.actions ?? []).some((a) => mencionaAFrase(citado, a.name))
        if (!mencionado || !acoes.write.length && !acoes.read.length) continue
        const chave = slug(`app-${app.key}-${decision.jobId}`)
        if (bp.resources.appRequirements.some((r) => r.key === chave)) continue
        bp.resources.appRequirements.push({
          key: chave,
          action: 'create',
          ...ESSENCIAL,
          rationale: `${agente.name} precisa de ${app.name} para ${decision.jobName.toLowerCase()}`,
          dependsOn: [agente.key],
          appKey: app.key,
          agentKeys: [agente.key],
          actionKeys: [...acoes.read, ...acoes.write],
          autonomousWriteActionKeys: [],
          resourceConfig: {},
          required: true,
        })
      }
      continue
    }

    if (decision.kind === 'tool') {
      if (!decision.resolved || !decision.resourceRef) {
        pending.push({ kind: 'tool', ref: decision.jobName, because: 'nenhum App do catálogo executa este trabalho' })
        continue
      }
      const app = (manifest?.apps ?? []).find((a) => a.key === decision.resourceRef)
      const acoes = app ? resolveAppActions(app, job ?? null) : { read: [], write: [] }
      bp.resources.appRequirements.push({
        key: slug(`app-${decision.resourceRef}-${decision.jobId}`),
        action: 'create',
        ...ESSENCIAL,
        rationale: `${decision.jobName}: ${decision.because}`,
        dependsOn: [],
        appKey: decision.resourceRef,
        agentKeys: [],
        // As ações EXATAS, do manifesto real. Vazio aqui é o defeito que o V1 tinha.
        actionKeys: [...acoes.read, ...acoes.write],
        // Escrita autônoma começa vazia SEMPRE: ela é aprovada por ação, na tela.
        autonomousWriteActionKeys: [],
        resourceConfig: {},
        required: true,
      })
      if (!acoes.read.length && !acoes.write.length) {
        pending.push({ kind: 'app_action', ref: decision.resourceRef, because: 'nenhuma ação deste App corresponde ao trabalho descrito' })
      }
      continue
    }

    if (decision.kind === 'function' && !decision.resolved) {
      pending.push({ kind: 'function', ref: decision.jobName, because: 'nenhuma função registrada faz este cálculo' })
      continue
    }

    if (decision.kind === 'routine') {
      // A pergunta que o V1 não fazia: isto é um HORÁRIO ou uma CONDIÇÃO?
      const condicao = parseDataCondition(`${job?.trigger ?? ''} ${job?.name ?? ''}`)
      if (condicao) {
        compilarVigilancia(bp, pending, { brief, job, decision, condicao, floorKey: andarDo(job) })
        continue
      }
      const dono = bp.organization.agents[0]
      if (!dono) {
        pending.push({ kind: 'routine', ref: decision.jobName, because: 'não há agente para ser o dono da rotina' })
        continue
      }
      bp.operations.routines.push({
        key: slug(`rotina-${decision.jobId}`),
        action: 'create',
        ...ESSENCIAL,
        rationale: decision.because,
        dependsOn: [dono.key],
        floorKey: andarDo(job),
        ownerAgentKey: dono.key,
        name: decision.jobName,
        ...(job?.frequency ? { description: `Frequência declarada: ${job.frequency}` } : {}),
        triggerType: 'schedule',
        cron: '0 8 * * *',
        timezone: 'America/Sao_Paulo',
        steps: [
          { id: 'executar', type: 'agent.execute', config: { agentKey: dono.key, instruction: job?.action ? `${decision.jobName}. ${job.action}.` : decision.jobName } },
        ],
      })
    }
  }

  // --- 3. o dado ao vivo que o Brief pediu e o V1 jogava fora --------------------------------
  for (const [i, need] of (brief.liveDataNeeds ?? []).entries()) {
    compilarFonteDeDado(bp, pending, { need, indice: i, floorKey: andarPadrao, manifest })
  }

  // --- 4. o canal: o PEDIDO ganha ------------------------------------------------------------
  const canal = resolveChannel(brief.channels ?? [], manifest)
  const entrada = bp.organization.agents[0]
  if (canal && entrada) {
    if ('missing' in canal) {
      pending.push({ kind: 'channel', ref: canal.missing, because: 'este canal não existe no catálogo desta conta' })
    } else {
      const app = (manifest?.apps ?? []).find((a) => a.key === canal.key)
      const acoes = app ? resolveAppActions(app, { id: '', name: 'receber e responder mensagens', trigger: '', input: '', decision: '', action: 'enviar mensagem', output: 'a resposta' }) : { read: [], write: [] }
      bp.resources.appRequirements.unshift({
        key: slug(`canal-${canal.key}`),
        action: 'create',
        ...ESSENCIAL,
        rationale: 'Receber o que chega e responder por onde a pessoa falou.',
        dependsOn: [],
        appKey: canal.key,
        agentKeys: [entrada.key],
        actionKeys: [...acoes.read, ...acoes.write],
        autonomousWriteActionKeys: [],
        resourceConfig: {},
        required: true,
      })
      /**
       * O VÍNCULO do canal — o que o V1 não criava.
       *
       * Declarar o App não liga a porta de entrada a ninguém: o que chega pelo WhatsApp
       * precisa de um agente que receba. Sem este item, o App é concedido e a mensagem não
       * chega a lugar nenhum.
       */
      bp.operations.channels.push({
        key: slug(`entrada-${canal.key}`),
        action: 'create',
        ...ESSENCIAL,
        rationale: `Quem chega por ${canal.key} é atendido por ${entrada.name}.`,
        dependsOn: [entrada.key, slug(`canal-${canal.key}`)],
        appKey: canal.key,
        entryAgentKey: entrada.key,
        direction: 'both',
      })
      if (!canal.connected) {
        pending.push({ kind: 'connection', ref: canal.key, because: 'este canal precisa ser conectado antes de a operação receber mensagem' })
      }
    }
  }

  // --- 5. as ferramentas ficam com quem conduz ------------------------------------------------
  for (const req of bp.resources.appRequirements) {
    if (req.agentKeys.length === 0 && entrada) req.agentKeys = [entrada.key]
  }

  // --- 6. o que precisa ser provado ------------------------------------------------------------
  for (const fonte of bp.operations.sources) {
    bp.acceptanceTests.push({
      key: slug(`teste-${fonte.key}`),
      kind: 'source',
      targetKey: fonte.key,
      expectation: 'a fonte responde, o mapeamento acha os campos e o dado é recente',
      required: true,
    })
  }
  for (const monitor of bp.operations.monitors) {
    bp.acceptanceTests.push({
      key: slug(`teste-${monitor.key}`),
      kind: 'monitor_simulation',
      targetKey: monitor.key,
      expectation: 'a simulação mostra um caso que dispara e um que não dispara',
      required: true,
    })
  }
  for (const c of bp.operations.channels) {
    bp.acceptanceTests.push({
      key: slug(`teste-${c.key}`),
      kind: 'channel',
      targetKey: c.key,
      expectation: 'uma mensagem de teste chega ao agente de entrada',
      required: true,
    })
  }

  bp.warnings = pending.map((p) => ({ path: p.kind, message: `${p.ref}: ${p.because}` }))
  return { blueprint: bp, classification, pending }
}

/**
 * Uma vigilância por CONDIÇÃO vira a cadeia inteira: fonte → histórico → monitor → Flow.
 *
 * É a correção da lacuna 9. O que o V1 fazia era transformar "me avise quando o RSI cair
 * abaixo de 30" numa rotina das oito da manhã — que não avisa quando acontece e avisa quando
 * não aconteceu.
 *
 * Campo e limiar ausentes viram PENDÊNCIA, nunca zero: um monitor com limiar inventado
 * dispara sempre ou nunca, e nos dois casos ninguém descobre por quê.
 */
function compilarVigilancia(
  bp: OfficeBlueprintV2,
  pending: CompileV2Result['pending'],
  ctx: { brief: OperationBrief; job: BriefJob | undefined; decision: ResourceDecision; condicao: ParsedCondition; floorKey: string },
): void {
  const { job, decision, condicao, floorKey } = ctx
  const raiz = slug(decision.jobId) || 'vigilancia'

  const fonteKey = `fonte-${raiz}`
  const historicoKey = `historico-${raiz}`
  const monitorKey = `monitor-${raiz}`
  const flowKey = `flow-${raiz}`

  // A fonte: sem ela o dado não existe, e sem dado não há o que observar. Ela nasce sem
  // config resolvida quando o Brief não diz de onde vem — e isso é pendência declarada.
  bp.operations.sources.push({
    key: fonteKey,
    action: 'create',
    layer: 'essential',
    rationale: `sem uma fonte, "${decision.jobName}" não tem o que observar`,
    dependsOn: [],
    name: decision.jobName,
    kind: 'api_polling',
    config: {},
    mapping: { version: 1, fields: condicao.field ? [{ to: condicao.field, from: condicao.field, required: true }] : [] },
    cadence: { mode: 'interval', intervalMs: 60_000 },
  })
  pending.push({ kind: 'source_config', ref: decision.jobName, because: 'falta dizer de onde este dado vem: endereço, App ou conjunto existente' })

  // O histórico: é ele que dá "antes" e "agora". Sem os dois, uma borda não existe.
  bp.operations.histories.push({
    key: historicoKey,
    action: 'create',
    layer: 'essential',
    rationale: 'uma borda só existe quando há um valor anterior para comparar',
    dependsOn: [fonteKey],
    sourceKey: fonteKey,
  })

  if (!condicao.field || condicao.value === null) {
    pending.push({
      kind: 'monitor_condition',
      ref: decision.jobName,
      because: condicao.field
        ? 'falta o número da condição — e um limiar inventado dispara sempre ou nunca'
        : 'falta dizer qual campo observar — e observar o campo errado é pior que não observar',
    })
    return
  }

  bp.operations.monitors.push({
    key: monitorKey,
    action: 'create',
    layer: 'essential',
    rationale: `${decision.jobName}: a condição é sobre o dado, não sobre o horário`,
    dependsOn: [historicoKey],
    name: decision.jobName,
    observes: { kind: 'dataset', datasetKey: historicoKey },
    condition: { kind: 'compare', field: condicao.field, op: condicao.op, value: condicao.value },
    triggerMode: condicao.triggerMode,
    ...(condicao.triggerMode.startsWith('cross') ? { threshold: condicao.value, thresholdField: condicao.field } : {}),
    debounceMs: 0,
    cooldownMs: 0,
    // Dado velho não dispara e marca a fonte: decidir sobre um número que já não é verdade
    // é o alarme que toca sozinho de madrugada.
    onStale: 'degrade',
    flowKey,
  })

  const dono = bp.organization.agents[0]
  bp.operations.flows.push({
    key: flowKey,
    action: 'create',
    layer: 'essential',
    rationale: 'o trabalho só começa na borda verdadeira, e não a cada leitura',
    dependsOn: [monitorKey, ...(dono ? [dono.key] : [])],
    floorKey,
    name: `Avisar: ${decision.jobName}`,
    trigger: { type: 'monitor', monitorKey },
    steps: dono
      ? [{ id: 'avisar', type: 'agent.execute', config: { agentKey: dono.key, instruction: job?.action ? `${decision.jobName}. ${job.action}.` : decision.jobName } }]
      : [],
  })
  if (!dono) pending.push({ kind: 'flow_step', ref: decision.jobName, because: 'não há agente para executar o aviso' })
}

/**
 * Uma necessidade de dado ao vivo vira fonte + destino — o que o V1 jogava fora.
 *
 * `liveDataNeeds` existia no Brief e não era compilado em nada: nem recurso, nem pendência.
 * Quem pedia "acompanhe a cotação do dólar" recebia um plano que não mencionava o dólar.
 */
function compilarFonteDeDado(
  bp: OfficeBlueprintV2,
  pending: CompileV2Result['pending'],
  ctx: { need: { source: string; freshness?: string; required: boolean }; indice: number; floorKey: string; manifest: ArchitectCapabilityManifest | null },
): void {
  const { need, indice } = ctx
  const raiz = slug(need.source) || `dado-${indice}`
  const fonteKey = `fonte-${raiz}`
  if (bp.operations.sources.some((s) => s.key === fonteKey)) return

  bp.operations.sources.push({
    key: fonteKey,
    action: 'create',
    layer: need.required ? 'essential' : 'recommended',
    rationale: `"${need.source}" precisa chegar de algum lugar para ser usado`,
    dependsOn: [],
    name: need.source,
    kind: 'api_polling',
    config: {},
    mapping: { version: 1, fields: [] },
    cadence: { mode: 'interval', intervalMs: 60_000 },
  })

  /**
   * O destino AO VIVO — "quanto está agora" é outra pergunta de "como variou".
   *
   * Ele nasce sem agente nenhum: acesso é concessão, não padrão. Quem concede escolhe na
   * tela, e a escolha aparece no plano como grant.
   */
  bp.operations.liveDestinations.push({
    key: `agora-${raiz}`,
    action: 'create',
    layer: need.required ? 'essential' : 'recommended',
    rationale: 'para um agente consultar o valor de agora sem abrir conexão nenhuma',
    dependsOn: [fonteKey],
    sourceKey: fonteKey,
    alias: slug(need.source).replace(/-/g, '_') || `dado_${indice}`,
    staleAfterSeconds: freshnessEmSegundos(need.freshness),
    agentKeys: [],
  })

  pending.push({ kind: 'source_config', ref: need.source, because: 'falta dizer de onde este dado vem: endereço, App ou conjunto existente' })
}

/**
 * "até 1 minuto" → 60. O padrão é 15 minutos.
 *
 * A janela não é decoração: ela é o que faz um valor velho parar de responder como se fosse
 * de agora.
 */
function freshnessEmSegundos(texto: string | undefined): number {
  const t = String(texto ?? '').toLowerCase()
  const n = /(\d+)/.exec(t)
  const valor = n ? Number(n[1]) : 0
  if (!valor) return 900
  if (/hora/.test(t)) return Math.min(86_400, valor * 3600)
  if (/minuto/.test(t)) return Math.min(86_400, valor * 60)
  if (/segundo/.test(t)) return Math.max(30, valor)
  return 900
}
