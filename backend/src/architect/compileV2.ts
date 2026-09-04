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
  floors?: { key: string; name: string; action?: 'create' | 'reuse'; resourceId?: string | null }[]
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

/** O Database que já existe para este assunto, por nome. Nunca por semelhança vaga. */
function acharDatabase(inventory: OfficeInventory | null, nome: string): { id: string; label: string } | null {
  const alvo = slug(nome)
  if (!alvo) return null
  const achado = (inventory?.sections.database?.items ?? []).find((d) => slug(d.label) === alvo)
  return achado ? { id: achado.id, label: achado.label } : null
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
    /**
     * A AÇÃO vem junto com o andar, e não é inventada aqui.
     *
     * `reuse` sem `resourceId` é recusado pelo validador — e com razão: dizer "reutilizar"
     * sem apontar para nada é dizer que existe um andar que não existe. Quem sabe se este
     * andar é novo ou já estava lá é quem decidiu a organização.
     */
    bp.organization.floors = input.floors.map((a) => ({
      key: a.key,
      // `reuse` sem id cai para `create`: apontar para um andar que não existe produziria um
      // plano inválido, e a aplicação vai criar o andar de qualquer jeito.
      action: a.action === 'reuse' && a.resourceId ? 'reuse' : 'create',
      ...(a.action === 'reuse' && a.resourceId ? { resourceId: a.resourceId } : {}),
      ...ESSENCIAL,
      rationale: 'a organização é aplicada pelo plano que a decidiu; aqui o andar só é referenciado',
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

  /**
   * --- 2. o dado que o Brief pediu, ANTES das peças que o consomem ---------------------------
   *
   * A ordem não é arrumação: a vigilância REUSA a fonte já declarada em vez de criar a sua. Com
   * as necessidades compiladas depois, "observe CXSE3" produzia duas fontes do mesmo papel —
   * dois pedidos de configuração para a mesma pessoa, duas coletas do mesmo endereço, e dois
   * históricos que divergem no primeiro erro de rede.
   */
  for (const [i, need] of (brief.liveDataNeeds ?? []).entries()) {
    compilarFonteDeDado(bp, pending, { need, indice: i, floorKey: andarPadrao, manifest })
  }

  // --- 3. as peças, por classificação -------------------------------------------------------
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
      compilarVigilancia(bp, pending, { brief, job, decision, condicao: vigilancia, floorKey: andarDo(job), manifest })
      if (decision.kind === 'function') {
        if (decision.resolved && decision.resourceRef) {
          /**
           * A CONTA fica registrada no plano, com nome.
           *
           * Resolvida, a função não aparecia em lugar nenhum do Blueprint: o monitor comparava
           * um `rsi` que nada no plano produzia, e quem lesse a proposta não tinha como saber
           * que a conta é determinística — nem auditar qual versão dela roda.
           */
          bp.resources.tools.push({
            key: slug(`funcao-${decision.resourceRef}-${decision.jobId}`),
            action: 'create',
            ...ESSENCIAL,
            rationale: `${decision.jobName}: a conta é determinística — mesma série, mesmo número`,
            dependsOn: [],
            name: decision.resourceRef,
            description: `Calcula ${decision.jobName} com a função registrada ${decision.resourceRef}`,
            provider: 'function',
            agentKeys: [],
          })
        } else {
          pending.push({ kind: 'function', ref: decision.jobName, because: 'nenhuma função registrada faz este cálculo' })
        }
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
        compilarVigilancia(bp, pending, { brief, job, decision, condicao, floorKey: andarDo(job), manifest })
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

  /**
   * --- 3b. o que precisa ficar GUARDADO vira Database + conjunto ----------------------------
   *
   * "Quanto está agora" e "como variou" são perguntas diferentes: a primeira responde com uma
   * leitura, a segunda exige série. Sem este bloco, toda proposta nascia sem Database nenhum
   * e a cadeia parava no monitor — que precisa de um conjunto para observar.
   */
  for (const [i, registro] of (brief.recordsToKeep ?? []).entries()) {
    const raiz = slug(registro.subject) || `registro-${i}`
    const dbKey = `base-${raiz}`
    if (bp.resources.databases.some((d) => d.key === dbKey)) continue

    const existente = acharDatabase(inventory, registro.subject)
    bp.resources.databases.push({
      key: dbKey,
      // Expandir em vez de duplicar: um Database com o mesmo nome já é o lugar deste dado.
      action: existente ? 'reuse' : 'create',
      ...(existente ? { resourceId: existente.id } : {}),
      ...ESSENCIAL,
      rationale: existente ? 'este Database já existe: a proposta grava nele' : `"${registro.subject}" precisa ficar guardado para poder ser comparado depois`,
      dependsOn: [],
      name: existente?.label ?? registro.subject,
      owner: { ownerType: 'account' },
      adapterKind: 'data_history',
      ...(registro.retentionDays ? { retentionDays: registro.retentionDays } : {}),
    })

    /**
     * O conjunto declara os CAMPOS, e o domínio recusa um schema sem eles.
     *
     * Quando o Brief não diz quais são, a proposta não inventa: o conjunto fica como
     * pendência, com o que falta. Um conjunto que aceita tudo não pode ser consultado nem
     * observado — a DSL só permite o que o schema declara.
     */
    if (!registro.fields.length) {
      pending.push({ kind: 'dataset_fields', ref: registro.subject, because: 'falta dizer quais campos guardar: um conjunto sem campos não pode ser consultado nem observado' })
      continue
    }
    bp.resources.datasets.push({
      key: `conjunto-${raiz}`,
      action: 'create',
      ...ESSENCIAL,
      rationale: `é onde "${registro.subject}" fica gravado`,
      dependsOn: [dbKey],
      databaseKey: dbKey,
      datasetKey: slug(registro.subject).replace(/-/g, '_') || `registro_${i}`,
      name: registro.subject,
      schema: {
        type: 'object',
        properties: Object.fromEntries(registro.fields.map((c) => [slug(c).replace(/-/g, '_') || c, {}])),
      },
      // Série gravada é fato acontecido: aceitar `update` faria alguém corrigir o valor de
      // ontem e o gráfico mudar sem que nada registre a mudança.
      mutability: 'append_only',
    })
    bp.acceptanceTests.push({
      key: `teste-${dbKey}`,
      kind: 'database_permission',
      targetKey: dbKey,
      expectation: `o Database de "${registro.subject}" responde com o conjunto declarado`,
      required: true,
    })
  }

  // --- 4. o canal: o PEDIDO ganha ------------------------------------------------------------
  const canal = resolveChannel(brief.channels ?? [], manifest)
  const entrada = bp.organization.agents[0]
  if (canal && entrada) {
    if ('missing' in canal) {
      pending.push({ kind: 'channel', ref: canal.missing, because: 'este canal não existe no catálogo desta conta' })
    } else {
      const app = (manifest?.apps ?? []).find((a) => a.key === canal.key)
      const temAcoes = Boolean(app && (app.actions ?? []).length)
      const acoes = app ? resolveAppActions(app, { id: '', name: 'receber e responder mensagens', trigger: '', input: '', decision: '', action: 'enviar mensagem', output: 'a resposta' }) : { read: [], write: [] }
      /**
       * Um requisito de App SEM ação nenhuma é um requisito de nada — e o validador o
       * recusa, o que derrubava a proposta inteira por causa de um canal nativo.
       *
       * `web_chat` é o caso: ele é uma porta de entrada do próprio produto, não um sistema
       * de terceiro com ações declaradas. O que ele precisa é do VÍNCULO abaixo, que liga
       * quem chega a um agente. Declarar um App vazio junto só criava um erro vermelho que
       * ninguém conseguia resolver na tela.
       */
      if (temAcoes && (acoes.read.length || acoes.write.length)) {
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
      }
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
        // A dependência do requisito só existe quando o requisito existe: um `dependsOn`
        // apontando para um item que não está no plano é recusado pelo validador, e com
        // razão — a ordem de aplicação sairia de uma chave que ninguém vai criar.
        dependsOn: temAcoes && (acoes.read.length || acoes.write.length) ? [entrada.key, slug(`canal-${canal.key}`)] : [entrada.key],
        appKey: canal.key,
        entryAgentKey: entrada.key,
        direction: 'both',
      })
      if (!canal.connected) {
        pending.push({ kind: 'connection', ref: canal.key, because: 'este canal precisa ser conectado antes de a operação receber mensagem' })
      }
    }
  }

  /**
   * --- 4b. o SETOR, quando há mais de um agente no mesmo andar -------------------------------
   *
   * O setor só existe quando há mais de um agente E alguém para coordenar. Criar setor com um
   * agente é agrupar uma pessoa — é o "setor orquestrado para agrupar visualmente" que a
   * constituição proíbe.
   *
   * A `key` é a mesma do V1 (`mesa`) de propósito: enquanto a organização é aplicada pelo
   * plano V1, os dois documentos precisam falar do MESMO setor. Uma chave diferente criaria
   * um segundo setor ao lado do primeiro.
   */
  for (const andar of bp.organization.floors) {
    const equipe = bp.organization.agents.filter((a) => a.floorKey === andar.key)
    if (equipe.length < 2) continue
    const coordenador = equipe[0]
    const key = bp.organization.floors.length > 1 ? slug(`mesa-${andar.key}`) : 'mesa'
    if (bp.organization.sectors.some((s) => s.key === key)) continue
    bp.organization.sectors.push({
      key,
      action: 'create',
      layer: 'recommended',
      rationale: 'são etapas encadeadas; o setor é o que faz elas conversarem',
      // O setor depende do andar e de TODOS os membros: sem eles, a equipe aplicada seria
      // menor do que a aprovada.
      dependsOn: [andar.key, ...equipe.map((a) => a.key)],
      floorKey: andar.key,
      name: bp.organization.floors.length > 1 ? `Mesa de ${andar.name}` : 'Mesa de trabalho',
      mode: 'orchestrated',
      memberAgentKeys: equipe.map((a) => a.key),
      coordinatorAgentKey: coordenador.key,
      instruction: 'Uma porta de entrada só: o coordenador recebe e distribui.',
      inputContract: coordenador.inputContract,
      outputContract: coordenador.outputContract,
    })
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
  /**
   * O FLOW também precisa de prova — senão ele nunca pode entrar no ar.
   *
   * A ativação exige teste aprovado, e só o que declara teste é ativável. Sem esta entrada, o
   * Flow ficava rascunho para sempre e o monitor recusava publicar: `publishMonitor` exige
   * versão publicada do Flow que ele aciona. A cadeia inteira parava por uma prova ausente.
   */
  for (const flow of bp.operations.flows) {
    bp.acceptanceTests.push({
      key: slug(`teste-${flow.key}`),
      kind: 'flow',
      targetKey: flow.key,
      expectation: 'o Flow tem etapa e todas as dependências resolvem',
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
  ctx: {
    brief: OperationBrief
    job: BriefJob | undefined
    decision: ResourceDecision
    condicao: ParsedCondition
    floorKey: string
    manifest: ArchitectCapabilityManifest | null
  },
): void {
  const { brief, job, decision, condicao, floorKey, manifest } = ctx
  const raiz = slug(decision.jobId) || 'vigilancia'

  const historicoKey = `historico-${raiz}`
  const monitorKey = `monitor-${raiz}`
  const flowKey = `flow-${raiz}`

  /**
   * A DERIVAÇÃO é decidida primeiro porque ela muda o que a fonte precisa trazer.
   *
   * Com ela, a fonte entrega FECHAMENTOS e a conta produz o RSI. Sem ela, a fonte precisa
   * entregar o próprio campo observado. Mapear `rsi` na fonte quando existe quem o calcule
   * seria pedir à API um número que este servidor sabe calcular melhor — e amarrar a
   * vigilância a quem publica o indicador.
   */
  const derivacao = derivacaoDoIndicador({ brief, decision, condicao, manifest })
  const campoDaFonte = derivacao ? derivacao.inputField : condicao.field

  /**
   * A FONTE já pode existir — e duas fontes do mesmo dado são duas contas do mesmo dado.
   *
   * "Observe CXSE3 e me avise quando o RSI cair" produzia uma fonte da vigilância e outra da
   * necessidade de dado ao vivo: dois pedidos de configuração para a mesma pessoa, duas
   * coletas do mesmo endereço, dois históricos que divergem no primeiro erro de rede. Elas são
   * a MESMA fonte semântica, e é assim que ela é compilada agora.
   *
   * O reuso é por termo distintivo compartilhado — o papel, o SKU, o sensor. Sem termo em
   * comum, são dados diferentes mesmo, e cada um tem a sua fonte.
   */
  const jaDeclarada = fonteQueJaServe(bp, `${decision.jobName} ${job?.input ?? ''}`)
  const fonteKey = jaDeclarada ?? `fonte-${raiz}`
  if (jaDeclarada && campoDaFonte) {
    /**
     * A fonte reusada precisa TRAZER o campo que esta vigilância consome.
     *
     * Uma necessidade de dado ao vivo nasce sem mapeamento — ela só diz que o dado precisa
     * chegar. Reusá-la sem acrescentar o campo daria uma fonte que responde e não traz nada
     * do que a conta precisa: a prova de fonte reprova, e o motivo ("não trouxe fechamento")
     * só apareceria depois de alguém configurar o endereço.
     */
    const fonte = bp.operations.sources.find((f) => f.key === jaDeclarada)!
    if (!fonte.mapping.fields.some((c) => c.to === campoDaFonte)) {
      fonte.mapping = { ...fonte.mapping, fields: [...fonte.mapping.fields, { to: campoDaFonte, from: campoDaFonte, required: true }] }
    }
  }
  if (!jaDeclarada) {
    // Sem ela o dado não existe, e sem dado não há o que observar. Ela nasce sem config
    // resolvida quando o Brief não diz de onde vem — e isso é pendência declarada.
    bp.operations.sources.push({
      key: fonteKey,
      action: 'create',
      layer: 'essential',
      rationale: `sem uma fonte, "${decision.jobName}" não tem o que observar`,
      dependsOn: [],
      name: decision.jobName,
      kind: 'api_polling',
      config: {},
      mapping: { version: 1, fields: campoDaFonte ? [{ to: campoDaFonte, from: campoDaFonte, required: true }] : [] },
      cadence: { mode: 'interval', intervalMs: 60_000 },
    })
    pending.push({ kind: 'source_config', ref: decision.jobName, because: 'falta dizer de onde este dado vem: endereço, App ou conjunto existente' })
  }

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

  /**
   * O INDICADOR CALCULADO — o buraco no meio da cadeia.
   *
   * A fonte entrega fechamentos; o monitor compara RSI. Enquanto ninguém fazia essa conta, a
   * vigilância só funcionava se a API já publicasse o indicador pronto — e a maioria não
   * publica. Pior: um modelo "calculando" o RSI devolve um número plausível e erra em silêncio.
   *
   * Quando o classificador resolveu o trabalho para uma função registrada que consome série, a
   * cadeia ganha um elo: uma série DERIVADA, calculada pela função com versão fixada, e é ela
   * que o monitor observa. O campo de entrada não é inventado — ele sai do que a pessoa disse
   * que quer guardar; sem isso, é pendência.
   */
  const observadoKey = derivacao ? `indicador-${raiz}` : historicoKey
  if (derivacao) {
    bp.operations.histories.push({
      key: observadoKey,
      action: 'create',
      layer: 'essential',
      rationale: `"${condicao.field}" é calculado de "${derivacao.inputField}" por ${derivacao.functionName} — a conta é determinística, e um modelo aqui erraria em silêncio`,
      dependsOn: [historicoKey],
      sourceKey: fonteKey,
      derive: {
        fromHistoryKey: historicoKey,
        functionName: derivacao.functionName,
        version: derivacao.version,
        inputField: derivacao.inputField,
        inputArg: derivacao.inputArg,
        lookback: derivacao.lookback,
        outputField: condicao.field,
        params: {},
      },
    })
  } else if (decision.kind === 'function' && decision.resolved) {
    pending.push({
      kind: 'indicator_input',
      ref: decision.jobName,
      because: `falta dizer de qual campo "${condicao.field}" é calculado: sem isso, a conta seria sobre um número que ninguém declarou`,
    })
  }

  bp.operations.monitors.push({
    key: monitorKey,
    action: 'create',
    layer: 'essential',
    rationale: `${decision.jobName}: a condição é sobre o dado, não sobre o horário`,
    /**
     * O monitor depende do FLOW, e não o contrário.
     *
     * Ele grava o id do Flow que aciona: criado antes, o `flowId` sai nulo e o alarme
     * reconhece a transição sem acionar nada — um monitor que parece configurado. O Flow, por
     * sua vez, não precisa do monitor para existir: quem o chama é o monitor, depois.
     */
    dependsOn: [observadoKey, flowKey],
    name: decision.jobName,
    // Ele observa a série CALCULADA quando ela existe: observar os fechamentos seria comparar
    // o preço contra 30, que é outra pergunta.
    observes: { kind: 'dataset', datasetKey: observadoKey },
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
    // Sem `monitorKey` aqui: declarar os dois lados fazia a ordem topológica inverter a
    // cadeia — e a dependência real é a do monitor, que precisa do id do Flow.
    dependsOn: [...(dono ? [dono.key] : [])],
    floorKey,
    name: `Avisar: ${decision.jobName}`,
    trigger: { type: 'monitor', monitorKey },
    /**
     * O AVISO é o trabalho — e ele não precisa de agente.
     *
     * Sem etapa nenhuma o Flow não faz nada, não passa no teste de aceitação e nunca pode ser
     * publicado: a cadeia inteira parava aqui, porque `publishMonitor` exige versão publicada
     * do Flow. Montar o texto do que aconteceu é determinístico — um agente aqui só
     * acrescentaria custo e a chance de ele reescrever o número.
     *
     * Quando existe um agente, ele entra DEPOIS: o texto já está pronto, e o que ele
     * acrescenta é julgamento, não formatação.
     */
    steps: [
      {
        id: 'aviso',
        type: 'transform.template',
        name: 'Montar o aviso',
        enabled: true,
        config: { template: `${decision.jobName}: {{input}}` },
      },
      ...(dono
        ? [
            {
              id: 'avaliar',
              type: 'agent.execute',
              name: 'Avaliar e completar',
              enabled: true,
              dependsOn: ['aviso'],
              config: { agentKey: dono.key, instruction: job?.action ? `${decision.jobName}. ${job.action}.` : decision.jobName },
            },
          ]
        : []),
    ],
  })
  /**
   * A ENTREGA é declarada — e o endereço não entra no plano.
   *
   * Enquanto ela era só uma pendência solta, "me avise pelo WhatsApp" terminava na Activity: o
   * Flow rodava, montava o texto e ninguém recebia nada. Declará-la como item do plano é o que
   * dá à tela algo para ligar, e à aplicação algo para transformar em passo `delivery.send`.
   *
   * O canal PEDIDO é preservado. Trocá-lo pelo primeiro conectado entregaria o aviso por onde a
   * pessoa não pediu — e ela descobriria pelo canal errado, ou não descobriria.
   */
  const pedido = canalPedido(brief, job)
  bp.operations.deliveries.push({
    key: `entrega-${raiz}`,
    action: 'create',
    layer: 'essential',
    rationale: pedido
      ? `"${decision.jobName}" sai por ${pedido}, que foi o canal pedido`
      : `"${decision.jobName}" precisa chegar a alguém — um aviso que só existe no painel não avisa`,
    dependsOn: [flowKey],
    fromKey: flowKey,
    ...(pedido ? { channelKey: slug(pedido) } : {}),
    // A dica é o CANAL, nunca o endereço: o plano é lido inteiro pela tela e viaja no histórico.
    destinationHint: pedido ? `uma conexão de ${pedido} desta conta` : 'uma conexão desta conta',
    format: 'text',
  })
  pending.push({
    kind: 'delivery',
    ref: decision.jobName,
    because: pedido
      ? `escolha a conexão de ${pedido} por onde o aviso sai`
      : 'escolha por onde o aviso sai: uma conexão da sua conta',
  })
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
 * O canal que a pessoa PEDIU para receber o aviso.
 *
 * Lido do que ela escreveu — o trabalho e os canais do Brief —, e não do que a conta tem
 * conectado. Um canal pedido e ausente é pendência; um canal substituído em silêncio é o aviso
 * chegando por onde ninguém combinou.
 */
function canalPedido(brief: OperationBrief, job: BriefJob | undefined): string | null {
  const texto = `${job?.output ?? ''} ${job?.action ?? ''} ${job?.name ?? ''} ${(brief.channels ?? []).join(' ')}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const conhecidos: [RegExp, string][] = [
    [/whats\s?app|zap\b/, 'WhatsApp'],
    [/telegram/, 'Telegram'],
    [/\be-?mail\b|email/, 'E-mail'],
    [/\bsms\b/, 'SMS'],
    [/slack/, 'Slack'],
  ]
  for (const [padrao, nome] of conhecidos) if (padrao.test(texto)) return nome
  return null
}

/**
 * A fonte já declarada que serve para este dado, se houver.
 *
 * O casamento é por termo distintivo — o papel ("CXSE3"), o SKU, o código do sensor. Um termo
 * genérico ("cotação", "dado") casaria fontes de coisas diferentes, que é o erro oposto e pior:
 * duas vigilâncias passariam a depender de uma coleta que não é a delas.
 */
function fonteQueJaServe(bp: OfficeBlueprintV2, texto: string): string | null {
  const termos = termosDistintivos(texto)
  if (!termos.length) return null
  for (const fonte of bp.operations.sources) {
    const dela = termosDistintivos(`${fonte.name} ${fonte.rationale ?? ''}`)
    if (dela.some((t) => termos.includes(t))) return fonte.key
  }
  return null
}

/** Palavras que identificam UMA coisa: fora do vocabulário comum e com dígito ou tamanho. */
const GENERICOS_DE_DADO = new Set([
  'cotacao','cotacoes','preco','precos','valor','valores','dado','dados','fonte','fontes','avisar','aviso','sobre',
  'quando','ficar','abaixo','acima','indicador','serie','historico','monitor','alerta','media','minuto','minutos',
])
function termosDistintivos(texto: string): string[] {
  return [
    ...new Set(
      String(texto ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4 && !GENERICOS_DE_DADO.has(t)),
    ),
  ]
}

/**
 * Como o campo observado é CALCULADO, quando ele é.
 *
 * Três coisas precisam existir juntas, e a ausência de qualquer uma é pendência, nunca palpite:
 * a função registrada (que o classificador resolveu), a declaração de que ela consome série
 * (que mora na própria função), e o campo de ENTRADA — que sai do que a pessoa disse que quer
 * guardar, e não de uma lista de nomes prováveis.
 */
function derivacaoDoIndicador(ctx: {
  brief: OperationBrief
  decision: ResourceDecision
  condicao: ParsedCondition
  manifest: ArchitectCapabilityManifest | null
}): { functionName: string; version: string; inputField: string; inputArg: string; lookback: number } | null {
  const { brief, decision, condicao, manifest } = ctx
  if (decision.kind !== 'function' || !decision.resolved || !decision.resourceRef || !condicao.field) return null

  const fn = (manifest?.functions ?? []).find((f) => f.functionName === decision.resourceRef)
  if (!fn?.series) return null

  /**
   * O campo de entrada vem do REGISTRO que a pessoa pediu para guardar.
   *
   * "Candles CXSE3: fechamento, rsi" diz as duas pontas: o que é guardado bruto e o que é
   * calculado. Com mais de um candidato não há como escolher sem adivinhar — e adivinhar aqui
   * calcularia o RSI do volume.
   */
  const alvo = condicao.field.toLowerCase()
  for (const registro of brief.recordsToKeep ?? []) {
    const campos = (registro.fields ?? []).map((c) => slug(c).replace(/-/g, '_') || c)
    if (!campos.some((c) => c.toLowerCase() === alvo)) continue
    const entradas = campos.filter((c) => c.toLowerCase() !== alvo)
    if (entradas.length !== 1) continue
    return {
      functionName: fn.functionName,
      version: fn.version,
      inputField: entradas[0],
      inputArg: fn.series.arg,
      lookback: fn.series.minimum,
    }
  }
  return null
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
