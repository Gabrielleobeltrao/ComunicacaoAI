import { classifyBrief } from './classify.js'
import type { Classification, ResourceDecision } from './classify.js'
import { nomeDoAgente, nomesEmUso, slug } from './compile.js'
import { conjuntoQueServe } from './nextQuestion.js'
import { tamanhoDaJanela } from './diff.js'
import type { AssistantCapabilityManifest, CapabilityApp } from './capabilities.js'
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
  manifest: AssistantCapabilityManifest | null
  /** O que a conta já tem. É daqui que sai a escolha entre expandir e criar. */
  inventory: OfficeInventory | null
  base: { title: string; objective: string }
  /**
   * AS SÉRIES RESUMIDAS que o modelo reconheceu. Quando vêm, elas VENCEM a leitura por
   * expressão regular: o modelo entende a frase, e a regex só entende o que alguém
   * escreveu regra para entender. A regex fica como rede — para o turno em que o modelo
   * não declarar nada, e para não perder o que já funcionava.
   */
  windows?: { source: string; field: string; everyMs: number; ops: string[] }[]
  /**
   * OS RECURSOS que as ferramentas anotaram nesta rodada.
   *
   * Eles passaram pelo executor, que já recusou o que não presta. Aqui eles entram no plano
   * ao lado do que o compilador deriva — sem substituir: o Brief continua produzindo o que
   * produzia, e o que o modelo declarou se soma.
   */
  declarados?: {
    databases: { chave: string; nome: string; descricao: string; tipo: string; agentes: string[]; acesso: 'read' | 'write'; diasDeRetencao?: number }[]
    conjuntos: { databaseChave: string; chave: string; nome: string; campos: { nome: string; tipo: string }[]; podeEditar: boolean }[]
    fontes: { chave: string; nome: string; tipo: string; endereco: string; metodo: string; cabecalhos: string[]; intervaloMs: number; campos: { to: string; from: string; required: boolean }[] }[]
    monitores: { chave: string; nome: string; conjuntoChave: string; campo: string; operador: string; valor: number; modo: string }[]
  }
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
  /** O que a pessoa respondeu — `forma:<jobId>` decide agente x função x ferramenta. */
  answers?: Record<string, unknown>
}

export interface CompileV2Result {
  blueprint: OfficeBlueprintV2
  classification: Classification
  /** O que foi citado e não existe no catálogo. Pendência declarada, nunca invenção. */
  pending: { kind: string; ref: string; because: string }[]
  /**
   * OS TRABALHOS que a série resumida já resolve.
   *
   * O V1 roda ANTES e não tem como saber disto — ele declara "nenhuma função registrada faz
   * este cálculo" para uma conta que o motor faz sozinho. Quem monta o resumo do turno tem
   * os dois lados na mão, e é lá que a contradição é desfeita.
   */
  trabalhosComJanela: string[]
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

/**
 * A JANELA lida da frase — "o mínimo e o máximo do bitcoin a cada 5 minutos".
 *
 * O motor de Históricos fecha janelas e grava uma linha com as sete contas determinísticas
 * desde sempre. Faltava alguém LER o pedido e dizer que é disso que se trata: sem isto, o
 * compilador procurava uma função registrada que fizesse a conta, não achava nenhuma, e o
 * pedido virava pendência declarada rodada após rodada.
 *
 * Ela devolve `null` sem dó. Sem tamanho de janela não há janela; sem nenhuma conta
 * reconhecida, "guardar o preço" é `every_event`, que é outra coisa. Inventar um padrão aqui
 * gravaria uma série que ninguém pediu, e a pessoa descobriria pelo conteúdo.
 */
/**
 * As sete contas, reconhecidas como as pessoas escrevem: substantivo E verbo.
 *
 * "Somar o valor por hora" e "a soma do valor por hora" são o mesmo pedido; casar só o
 * substantivo fazia a janela sumir do plano quando alguém escrevia no infinitivo.
 */
/** Como cada conta se chama na linha gravada. Um nome só, nos dois caminhos. */
export const NOME_DA_CONTA: Record<string, string> = {
  min: 'minimo', max: 'maximo', avg: 'media', sum: 'soma', count: 'contagem', first: 'abertura', last: 'fechamento',
}

const CONTAS: { padrao: RegExp; op: 'first' | 'last' | 'min' | 'max' | 'avg' | 'sum' | 'count'; nome: string }[] = [
  { padrao: /\b(m[íi]nimos?|menor(es)?|m[íi]nimas?)\b/i, op: 'min', nome: 'minimo' },
  { padrao: /\b(m[áa]ximos?|maior(es)?|m[áa]ximas?|pico)\b/i, op: 'max', nome: 'maximo' },
  { padrao: /\b(m[ée]dias?|m[ée]dios?)\b/i, op: 'avg', nome: 'media' },
  { padrao: /\b(soma|somar|somando|somat[óo]rio|total(izar)?)\b/i, op: 'sum', nome: 'soma' },
  { padrao: /\b(contagem|contar|quantos|quantas|n[úu]mero de)\b/i, op: 'count', nome: 'contagem' },
  { padrao: /\b(abertura|primeiros?|inicial)\b/i, op: 'first', nome: 'abertura' },
  { padrao: /\b(fechamento|[úu]ltimos?|final)\b/i, op: 'last', nome: 'fechamento' },
]

const UNIDADES: { padrao: RegExp; ms: number }[] = [
  { padrao: /\b(segundos?|s)\b/i, ms: 1_000 },
  { padrao: /\b(minutos?|min)\b/i, ms: 60_000 },
  { padrao: /\b(horas?|h)\b/i, ms: 3_600_000 },
]

export interface ParsedWindow {
  everyMs: number
  rules: { from: string; op: 'first' | 'last' | 'min' | 'max' | 'avg' | 'sum' | 'count'; to: string }[]
}

// ponytail: a leitura por regex fica como REDE enquanto `ASSISTANT_TOOLS` estiver desligada
// para alguém. Ela só entende o que alguém escreveu regra para entender — é o teto que a
// ferramenta `propor_janela` existe para tirar. Aposentar: quando a flag estiver ligada por
// padrão e a ferramenta tiver uso real, uma função por vez, conferindo que nenhum turno caiu
// aqui no período.
export function parseJanela(texto: string, campo: string | null): ParsedWindow | null {
  const t = String(texto ?? '')
  // "a cada 5 minutos", "de 5 em 5 minutos", "janelas de 5 minutos", "intervalo de 5 min".
  const m = t.match(/\b(?:a cada|de|em|janelas? de|intervalos? de|per[íi]odos? de)\s+(\d{1,4})\s*(segundos?|minutos?|horas?|min|s|h)\b/i)
  if (!m) return null
  const n = Number(m[1])
  const unidade = UNIDADES.find((u) => u.padrao.test(m[2]))
  if (!Number.isFinite(n) || n <= 0 || !unidade) return null

  const from = String(campo ?? '').trim()
  // Sem saber QUAL número resumir, a janela gravaria a conta de um campo que ninguém
  // declarou. Isso é pendência, não palpite.
  if (!from) return null

  const rules = CONTAS.filter((c) => c.padrao.test(t)).map((c) => ({ from, op: c.op, to: c.nome }))
  if (rules.length === 0) return null
  return { everyMs: n * unidade.ms, rules }
}

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
/**
 * Alguém FALA com este agente?
 *
 * O gatilho decide: trabalho que começa quando uma pessoa escreve precisa de porta; o que
 * começa no horário, não. O texto conta junto, porque "responder a dúvida" é conversa mesmo
 * quando o gatilho não diz quem falou.
 */
export function ehConversaDeGente(job: { trigger?: string; name?: string; action?: string; input?: string }): boolean {
  const t = `${job.trigger ?? ''} ${job.name ?? ''} ${job.action ?? ''} ${job.input ?? ''}`.toLowerCase()
  return /(cliente|pessoa|usuário|usuario|visitante|lead|conversa|mensagem|whatsapp|chat|responder|atender|dúvida|duvida|pergunta)/.test(t)
}

export function resolveChannel(
  pedidos: string[],
  manifest: AssistantCapabilityManifest | null,
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
  const classification = classifyBrief(brief, manifest, input.answers ?? {})
  const bp = emptyBlueprintV2(base.title, brief.businessGoal || base.objective, changeKind)
  const pending: CompileV2Result['pending'] = []

  // --- 1. os andares: quantas áreas, e quais já existem ------------------------------------
  const areas = areasOf(brief)
  const nomes = areas.length ? areas : [base.title.slice(0, 60) || 'Operação']

  const floorKeyDe = new Map<string, string>()
  // Andares decididos fora: entram como estão, e nenhuma `key` é inventada aqui.
  for (const andar of input.floors ?? []) floorKeyDe.set(andar.name, andar.key)

  /**
   * UM TÍTULO NÃO É UMA ÁREA.
   *
   * Sem palavra de área no texto, `nomes` caía para o título da operação — e um título nunca
   * casa com andar existente, então cada operação abria um andar próprio. "Guardar a máxima
   * do Bitcoin" não é uma área da empresa: é trabalho que mora num andar que já existe.
   *
   * Com a conta vazia, criar continua certo — é o primeiro andar. Com UM andar, ele é o
   * lugar. Com VÁRIOS e nenhuma área dita, escolher seria adivinhar: vira pendência, e quem
   * responde é quem sabe. Perguntar é mais barato que desfazer.
   */
  const semArea = !input.floors && areas.length === 0
  const existentes = inventory?.sections.floor?.items ?? []
  if (semArea && existentes.length > 0) {
    if (existentes.length === 1) {
      const unico = existentes[0]
      floorKeyDe.set(unico.label, slug(unico.label) || 'operacao')
      bp.organization.floors.push({
        key: slug(unico.label) || 'operacao',
        action: 'reuse',
        resourceId: unico.id,
        ...ESSENCIAL,
        rationale: 'este trabalho não descreve uma área nova: ele mora no andar que já existe',
        dependsOn: [],
        name: unico.label,
        workMode: 'organization',
      })
    } else {
      /**
       * VÁRIOS andares: a pendência é a pergunta, e o plano continua legível.
       *
       * Um blueprint sem andar nenhum não compila — agente mora em andar. Então ele é
       * montado no primeiro e a escolha vira pendência DECLARADA, com o motivo escrito na
       * própria peça. O que não pode acontecer é o que acontecia: abrir um andar novo e
       * chamar isso de decisão.
       */
      const provisorio = existentes[0]
      floorKeyDe.set(provisorio.label, slug(provisorio.label) || 'operacao')
      bp.organization.floors.push({
        key: slug(provisorio.label) || 'operacao',
        action: 'reuse',
        resourceId: provisorio.id,
        ...ESSENCIAL,
        rationale: `montado em "${provisorio.label}" por enquanto: falta dizer em qual andar este trabalho mora`,
        dependsOn: [],
        name: provisorio.label,
        workMode: 'organization',
      })
      pending.push({
        kind: 'floor_choice',
        ref: base.title,
        because: `em qual andar este trabalho mora? a conta tem ${existentes.length}: ${existentes.slice(0, 6).map((f) => f.label).join(', ')}`,
      })
    }
  }

  for (const nome of (input.floors || (semArea && existentes.length > 0) ? [] : nomes)) {
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
    compilarFonteDeDado(bp, pending, { need, indice: i, floorKey: andarPadrao, manifest, inventory, answers: input.answers ?? {} })
  }

  // --- 3. as peças, por classificação -------------------------------------------------------
  const usados = nomesEmUso(inventory)
  // Uma janela declarada serve a UM trabalho: sem isto, dois trabalhos parecidos ficariam
  // com a mesma série, e o plano gravaria a mesma linha duas vezes.
  const usadas = new Set<{ source: string; field: string; everyMs: number; ops: string[] }>()
  const trabalhosComJanela: string[] = []
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
    /**
     * A JANELA vem ANTES da classificação virar pendência.
     *
     * "Salvar o mínimo e o máximo do bitcoin a cada 5 minutos" não é uma conta que roda uma
     * vez, nem uma vigilância: é uma SÉRIE RESUMIDA. O motor de Históricos faz isso com as
     * sete operações determinísticas — e enquanto ninguém lia o pedido assim, o compilador
     * procurava uma função registrada, não achava nenhuma, e o dono recebia pendência
     * rodada após rodada. Depois de aplicar, ele perguntou: "onde está a função?".
     *
     * Ela é compilada mesmo quando o classificador pede um AGENTE: a janela é COMO o dado é
     * guardado, e não quem faz o trabalho. Os dois convivem — o agente conversa sobre a
     * série que a janela grava.
     */
    const fonteDaJanela = conjuntoQueServe(inventory, String((brief.liveDataNeeds ?? [])[0]?.source ?? job?.input ?? ''))
    const textoDoPedido = `${job?.name ?? ''} ${job?.action ?? ''} ${job?.output ?? ''} ${job?.input ?? ''}`
    const declarados = (brief.recordsToKeep ?? []).flatMap((r) => r.fields ?? [])
    const campo = campoAResumir(textoDoPedido, fonteDaJanela?.campos ?? '', declarados)
    /**
     * O QUE O MODELO DECLAROU vence — e é casado com o trabalho pelo texto dele.
     *
     * Uma janela declarada sem dono viraria série solta; casá-la por proximidade de texto
     * mantém o vínculo com o trabalho que a pediu.
     */
    /**
     * O compilador NÃO confia no que recebe, nem vindo do próprio turno.
     *
     * `normalizeTurn` já valida, mas ele é uma porta; esta é outra, e quem chama o
     * compilador direto passa por aqui. Uma janela sem tamanho, sem campo ou com uma conta
     * que o motor não tem gravaria uma coluna que ninguém lê — e gravaria calada.
     */
    const declarada = (input.windows ?? []).find(
      (w) =>
        !usadas.has(w) &&
        janelaValida(w) &&
        (normalizarCampo(textoDoPedido).includes(normalizarCampo(w.field)) || normalizarCampo(textoDoPedido).includes(normalizarCampo(w.source))),
    )
    if (declarada) usadas.add(declarada)

    /**
     * O CAMPO TEM DE EXISTIR NA ORIGEM — senão a janela roda e não acumula nada.
     *
     * Do banco do dono: a origem gravava `{"preco_bitcoin": "77131.82"}` e a janela
     * procurava `preco`. Ela recebeu oito leituras (`count: 8`) e fechou sem `acc` nenhum:
     * o motor rodou, o recorder existia, e o conjunto ficava vazio para sempre. É o defeito
     * mais caro possível — nada quebra, nada avisa, e a pessoa espera.
     *
     * O modelo escreveu "preco" querendo dizer o preço. Corrigir para o nome real é melhor
     * que recusar: ele acertou a intenção e errou o nome, e a fonte sabe o nome certo.
     */
    if (declarada && !campoDaJanelaExiste(declarada, fonteDaJanela, pending, job?.name ?? decision.jobId)) {
      usadas.add(declarada)
      continue
    }
    const janela = declarada
      ? {
          everyMs: declarada.everyMs,
          // Só as contas que o motor conhece: uma inventada viraria coluna morta.
          rules: declarada.ops.filter((op) => op in NOME_DA_CONTA).map((op) => ({ from: declarada.field, op: op as never, to: NOME_DA_CONTA[op] })),
        }
      : parseJanela(textoDoPedido, campo)
    /**
     * A JANELA FOI PEDIDA e ninguém sabe sobre QUAL campo: isso é pergunta, não silêncio.
     *
     * Antes, campo ambíguo devolvia `null` e a janela sumia do plano sem uma palavra — a
     * pessoa pedia "a soma por hora" e recebia uma proposta que não somava nada.
     */
    if (!janela && !campo && parseJanela(textoDoPedido, '__x__')) {
      const opcoes = candidatosParaResumir(fonteDaJanela?.campos ?? '', declarados)
      pending.push({
        kind: 'window_field',
        ref: job?.name ?? decision.jobId,
        because: opcoes.length
          ? `falta dizer qual campo resumir por janela: ${opcoes.slice(0, 6).join(', ')}`
          : 'falta dizer qual campo resumir por janela — resumir o campo errado grava uma série que parece certa',
      })
    }
    if (janela) {
      // Fica registrado QUAL trabalho a janela resolve: quem monta o resumo do turno precisa
      // saber disso para não declarar pendência de uma conta que o motor já faz.
      trabalhosComJanela.push(job?.name ?? decision.jobId)
      // A janela é COMO o dado é guardado — vale inclusive quando o trabalho também tem um
      // agente. Pular a janela porque existe alguém para conversar sobre ela deixaria a
      // pessoa com o agente e sem o dado, que foi exatamente o que aconteceu.
      compilarJanela(bp, pending, { job, jobId: decision.jobId, janela, achado: fonteDaJanela })
      if (decision.kind !== 'agent') continue
    }

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
      const nome = nomeDoAgente(indiceDeAgente, usados)
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
   * A JANELA QUE NENHUM TRABALHO RECLAMOU ainda é uma janela.
   *
   * O casamento acima é por PROXIMIDADE DE TEXTO: a janela declarada só entra se o nome do
   * campo ou da fonte aparecer no texto do trabalho. Quando não aparece — o trabalho diz
   * "guardar a cotação" e a janela diz `preco_bitcoin` —, a declaração era descartada em
   * silêncio. O modelo tinha chamado a ferramenta, o executor tinha aceitado, e o plano saía
   * sem série nenhuma: exatamente o "ele não usou a ferramenta" visto na conta do dono.
   *
   * Aqui ela é compilada pela ORIGEM que ela mesma declarou. `compilarJanela` já ignora
   * assinatura repetida, então uma janela que o laço tratou não vira uma segunda série.
   */
  for (const w of input.windows ?? []) {
    if (usadas.has(w) || !janelaValida(w)) continue
    const origem = conjuntoQueServe(inventory, w.source)
    if (!campoDaJanelaExiste(w, origem, pending, w.source || w.field)) continue
    compilarJanela(bp, pending, {
      job: undefined,
      jobId: w.source || w.field,
      janela: { everyMs: w.everyMs, rules: w.ops.filter((op) => op in NOME_DA_CONTA).map((op) => ({ from: w.field, op: op as never, to: NOME_DA_CONTA[op] })) },
      achado: origem,
    })
  }


  /**
   * --- 3b. o que precisa ficar GUARDADO vira Database + conjunto ----------------------------
   *
   * "Quanto está agora" e "como variou" são perguntas diferentes: a primeira responde com uma
   * leitura, a segunda exige série. Sem este bloco, toda proposta nascia sem Database nenhum
   * e a cadeia parava no monitor — que precisa de um conjunto para observar.
   */
  /**
   * O QUE AS FERRAMENTAS ANOTARAM entra primeiro, e o Brief não duplica em cima.
   *
   * O modelo declarou depois de ler o inventário e levar as recusas; a derivação do Brief é
   * um palpite bom, mas é palpite. Quando os dois falam do mesmo Database, vale o declarado.
   */
  for (const d of input.declarados?.databases ?? []) {
    if (bp.resources.databases.some((x) => x.key === d.chave)) continue
    const existente = acharDatabase(inventory, d.nome)
    bp.resources.databases.push({
      key: d.chave,
      action: existente ? 'reuse' : 'create',
      ...(existente ? { resourceId: existente.id } : {}),
      ...ESSENCIAL,
      rationale: existente ? 'este Database já existe: a proposta grava nele' : d.descricao || `"${d.nome}" precisa ficar guardado para poder ser consultado depois`,
      dependsOn: [],
      name: existente?.label ?? d.nome,
      owner: { ownerType: 'account' },
      adapterKind: d.tipo,
      agentKeys: d.agentes,
      agentAccess: d.acesso,
      ...(d.diasDeRetencao ? { retentionDays: d.diasDeRetencao } : {}),
    } as never)
  }
  for (const c of input.declarados?.conjuntos ?? []) {
    const base = bp.resources.databases.find((x) => x.key === c.databaseChave)
    if (!base || bp.resources.datasets.some((x) => x.key === `conjunto-${c.chave}`)) continue
    bp.resources.datasets.push({
      key: `conjunto-${c.chave}`,
      action: 'create',
      ...ESSENCIAL,
      rationale: `a forma de cada linha de "${c.nome}"`,
      dependsOn: [base.key],
      databaseKey: base.key,
      datasetKey: c.chave,
      name: c.nome,
      // O schema é o que a consulta e a condição do monitor leem. Sem `properties`, o
      // domínio recusa — e recusa certo.
      schema: {
        type: 'object',
        properties: Object.fromEntries(c.campos.map((f) => [f.nome, { type: f.tipo }])),
      },
      mutability: c.podeEditar ? 'mutable' : 'append_only',
    } as never)
  }

  for (const f of input.declarados?.fontes ?? []) {
    if (bp.operations.sources.some((x) => x.key === f.chave)) continue
    const existente = conjuntoQueServe(inventory, f.nome)
    bp.operations.sources.push({
      key: f.chave,
      action: existente ? 'reuse' : 'create',
      ...(existente ? { resourceId: existente.id } : {}),
      ...ESSENCIAL,
      rationale: existente ? `"${existente.label}" já recebe este dado nesta conta` : `sem uma fonte, "${f.nome}" não tem de onde vir`,
      dependsOn: [],
      name: existente?.label ?? f.nome,
      kind: f.tipo,
      config: f.endereco ? { url: f.endereco, ...(f.tipo === 'api_polling' ? { method: f.metodo } : {}), ...(f.cabecalhos.length ? { headerNames: f.cabecalhos } : {}) } : {},
      mapping: { version: 1, fields: f.campos },
      cadence: f.intervaloMs ? { mode: 'interval', intervalMs: f.intervaloMs } : { mode: 'stream' },
    } as never)
    // Sem campos, a fonte nasce mas não sabe o que ler. Pendência declarada, não invenção.
    if (!f.campos.length) pending.push({ kind: 'source_mapping', ref: f.nome, because: 'falta dizer quais campos ler desta origem' })
    if (!existente && !f.endereco) pending.push({ kind: 'source_config', ref: f.nome, because: 'falta dizer de onde este dado vem: endereço, App ou conjunto existente' })
  }

  for (const m of input.declarados?.monitores ?? []) {
    const conjunto = bp.resources.datasets.find((d) => d.datasetKey === m.conjuntoChave) ?? bp.operations.histories.find((h) => h.key === m.conjuntoChave)
    if (!conjunto || bp.operations.monitors.some((x) => x.key === m.chave)) continue
    bp.operations.monitors.push({
      key: m.chave,
      action: 'create',
      ...ESSENCIAL,
      rationale: `avisa quando ${m.campo} ${m.operador} ${m.valor}`,
      dependsOn: [conjunto.key],
      name: m.nome,
      observes: { kind: 'dataset', datasetKey: conjunto.key },
      condition: { kind: 'compare', field: m.campo, op: m.operador, value: m.valor },
      triggerMode: m.modo,
      debounceMs: 0,
      cooldownMs: 0,
      onStale: 'degrade',
    } as never)
  }

  /**
   * UMA PASTA SÓ QUANDO HÁ O QUE AGRUPAR.
   *
   * O compilador abria um Database por assunto guardado. Na conta do dono isso produziu duas
   * pastas com uma tabela em cada, e o nome da pasta era a descrição da tabela lá dentro —
   * "Histórico consolidado do menor e maior valor do bitcoin por janela de 10 minutos", com
   * um conjunto só. Ele perguntou: "e por que temos pasta e conjunto?".
   *
   * Com um assunto só, tudo vai para o mesmo lugar de sempre e a base aparece SOLTA — a
   * pasta padrão não é uma pasta na tela. Com vários, aí sim uma pasta, porque aí ela agrupa
   * de verdade.
   */
  const assuntos = brief.recordsToKeep ?? []
  const agrupa = assuntos.length > 1
  const pastaComum = agrupa ? null : (acharDatabase(inventory, 'Históricos') ?? null)

  for (const [i, registro] of assuntos.entries()) {
    const raiz = slug(registro.subject) || `registro-${i}`
    // Com vários assuntos, UMA pasta para todos, nomeada pela operação; com um, o lar de
    // sempre, que não aparece como pasta.
    const dbKey = agrupa ? `base-${slug(base.title) || 'operacao'}` : pastaComum ? 'base-historicos' : `base-${raiz}`
    /**
     * O MESMO destino serve a vários assuntos — e o segundo não recria a pasta.
     *
     * Antes, `continue` aqui pulava o assunto inteiro: com dois registros indo para o mesmo
     * lugar, o segundo não ganhava conjunto nenhum. Agora só a criação da pasta é pulada; o
     * conjunto, a janela e o teste continuam sendo declarados logo abaixo.
     */
    const jaDeclarada = bp.resources.databases.find((d) => d.key === dbKey)
    const existente = pastaComum ?? (agrupa ? acharDatabase(inventory, base.title) : acharDatabase(inventory, registro.subject))
    /**
     * A MESMA BASE não entra duas vezes no plano — ela SOBE de acesso.
     *
     * Quando a operação lê e grava no mesmo lugar, o plano declarava duas entradas para um
     * Database só: uma de leitura e outra de escrita. O grant é único por (base, agente), então
     * a segunda sobrescrevia a primeira e quem mandava era a ordem de aplicação — silenciosa.
     * Uma entrada com `write` responde as duas coisas: escrever inclui ler.
     */
    if (jaDeclarada) {
      jaDeclarada.agentAccess = 'write'
      jaDeclarada.agentKeys = [...new Set([...(jaDeclarada.agentKeys ?? []), ...bp.organization.agents.map((a) => a.key)])]
    }
    if (!jaDeclarada) bp.resources.databases.push({
      key: dbKey,
      // Expandir em vez de duplicar: um Database com o mesmo nome já é o lugar deste dado.
      action: existente ? 'reuse' : 'create',
      ...(existente ? { resourceId: existente.id } : {}),
      ...ESSENCIAL,
      rationale: existente ? 'este Database já existe: a proposta grava nele' : `"${registro.subject}" precisa ficar guardado para poder ser comparado depois`,
      dependsOn: [],
      name: existente?.label ?? (agrupa ? base.title : registro.subject),
      owner: { ownerType: 'account' },
      adapterKind: 'data_history',
      // Uma pasta de verdade só quando ela AGRUPA: com um assunto só, o destino é o lar de
      // sempre, e a base aparece solta na tela.
      ...(agrupa ? { explicit: true } : {}),
      // Quem grava aqui são os agentes DESTA operação — declarado, para o dono ver e
      // aprovar junto com o resto. Sem isto o plano criava a base e o agente não a
      // alcançava: operação montada e muda.
      agentKeys: bp.organization.agents.map((a) => a.key),
      agentAccess: 'write' as const,
      ...(registro.retentionDays ? { retentionDays: registro.retentionDays } : {}),
    })

    /**
     * A SÉRIE RESUMIDA PASSA A MORAR AQUI — e é ela que define a forma das linhas.
     *
     * Ligar antes de decidir sobre o conjunto não é arrumação: é a decisão. Quem sabe os
     * campos de uma série resumida é a REGRA da janela, e não o modelo.
     */
    for (const h of bp.operations.histories) {
      if (h.window && !h.databaseKey) {
        h.databaseKey = dbKey
        h.dependsOn = [...new Set([...(h.dependsOn ?? []), dbKey])]
      }
    }

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
    /**
     * QUANDO A JANELA É A SÉRIE, o plano não declara um segundo conjunto.
     *
     * Do banco do dono, um Database com DOIS conjuntos para a mesma coisa: o que o plano
     * criou, com os campos que o modelo inventou (`preco_minimo`, `timestamp_inicio_janela`),
     * e o que o recorder cria, com os nomes que o motor realmente grava (`minimo`, `maximo`).
     * O motor escreve no dele; o outro fica vazio para sempre, ao lado, parecendo defeito.
     *
     * Quem sabe a forma das linhas de uma série resumida é a REGRA da janela, não o modelo.
     */
    if (bp.operations.histories.some((h) => h.window && h.databaseKey === dbKey)) continue

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

    /**
     * A SÉRIE RESUMIDA PASSA A MORAR AQUI.
     *
     * A janela nasce no mesmo Brief que este registro: "grave em um novo database o máximo e
     * o mínimo a cada 5 minutos" é uma frase só. Sem esta linha, o plano criava a base, o
     * motor gravava no Database padrão, e a base pedida ficava vazia para sempre — que é
     * exatamente o "apliquei e só foi criado o database".
     *
     * Só a janela que ainda não tem destino: uma já ligada não é realocada por um registro
     * que apareceu depois.
     */
    if (bp.acceptanceTests.some((t) => t.key === `teste-${dbKey}`)) continue
    bp.acceptanceTests.push({
      key: `teste-${dbKey}`,
      kind: 'database_permission',
      targetKey: dbKey,
      expectation: `o Database de "${registro.subject}" responde com o conjunto declarado`,
      required: true,
    })
  }

  // --- 4. o canal: o PEDIDO ganha ------------------------------------------------------------
  /**
   * A PORTA DE ENTRADA SÓ EXISTE ONDE ALGUÉM ENTRA.
   *
   * `resolveChannel` cai no primeiro canal CONECTADO quando ninguém pede um — e foi assim
   * que o dono, insistindo duas vezes para tirar o web_chat, acabou acionando o gatilho do
   * que tentava evitar: esvaziar `brief.channels` é exatamente o que dispara o padrão.
   *
   * O padrão só vale onde há conversa. Numa operação que roda sozinha no fim do dia não há
   * quem fale, e abrir a porta é prometer um atendimento que ninguém vai atender. Um canal
   * PEDIDO por escrito continua valendo — a regra tira o silêncio, não a escolha.
   */
  const alguemFala = brief.jobs.some((j) => ehConversaDeGente(j))
  const canal = (brief.channels ?? []).length > 0 || alguemFala ? resolveChannel(brief.channels ?? [], manifest) : null
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
  /**
   * DE QUEM É O ACESSO ÀS BASES — decidido no fim, quando os agentes já existem.
   *
   * As fontes de dado são compiladas antes dos agentes (o dado precisa existir para o
   * trabalho ser desenhado em cima dele), então a base de leitura nascia sem `agentKeys`:
   * declarada e inalcançável, que é o mesmo que não declarada. Aqui todo Database que diz
   * para que serve ganha quem o usa.
   */
  for (const base of bp.resources.databases) {
    if (base.agentAccess && !(base.agentKeys ?? []).length) base.agentKeys = bp.organization.agents.map((a) => a.key)
  }

  return { blueprint: bp, classification, pending, trabalhosComJanela }
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
    manifest: AssistantCapabilityManifest | null
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
  ctx: {
    need: { source: string; freshness?: string; required: boolean }
    indice: number
    floorKey: string
    manifest: AssistantCapabilityManifest | null
    inventory: OfficeInventory | null
    /** O que a pessoa respondeu sobre a ORIGEM: `origem:<assunto>` = `usar` | `criar`. */
    answers: Record<string, unknown>
  },
): void {
  const { need, indice } = ctx
  const raiz = slug(need.source) || `dado-${indice}`
  const fonteKey = `fonte-${raiz}`
  if (bp.operations.sources.some((s) => s.key === fonteKey)) return

  /**
   * O DADO QUE JÁ CHEGA NA CONTA.
   *
   * Andar e Database já sabiam procurar o que existe antes de criar; a fonte de dado, não —
   * ela nascia com `action: 'create'` fixo e sequer recebia o inventário. Quem tinha uma
   * Database recebendo cotação a cada quinze segundos e pedia para usá-la ganhava uma fonte
   * NOVA, vazia, mais a pendência "falta dizer de onde este dado vem". A proposta parecia
   * completa e ignorava justamente o que a pessoa já tinha montado.
   *
   * O casamento é por TERMO DISTINTIVO, o mesmo critério que já decide se duas vigilâncias
   * compartilham coleta: "bitcoin" casa, "cotação" não. Casar por palavra genérica seria o
   * erro oposto e pior — gravar o dado de um assunto dentro da base de outro, com a
   * proposta dizendo "estou reusando o que você já tem".
   */
  /**
   * A COLETA QUE JÁ RODA vence a coleta nova.
   *
   * Antes da base, porque é mais específico: quem tem a fonte tem o dado chegando, e abrir
   * outra em cima dela é pagar duas vezes pela mesma leitura — e ficar com duas séries que
   * divergem no primeiro minuto em que uma falhar.
   */
  /**
   * A RESPOSTA MANDA. "É outra origem" quer dizer que a base que eu achei não é a dela —
   * insistir no reuso seria pior que nunca ter perguntado: ela responderia e veria a
   * proposta ignorar a resposta.
   */
  const escolha = String(ctx.answers[`origem:${chaveDeAssunto(need.source)}`] ?? '')
  const fonteDaConta = escolha === 'criar' ? null : fonteDaContaQueJaServe(ctx.inventory, need.source)
  if (fonteDaConta) {
    /**
     * A fonte já roda — mas o plano precisa DIZER DE ONDE SE LÊ.
     *
     * Sair calado aqui foi o defeito: não duplicar a coleta estava certo, e o resultado foi
     * um agente aplicado que sabia gravar e não sabia ler, porque a base de origem nunca
     * entrou no plano e por isso nunca recebeu concessão. A operação inteira existe para
     * ler dali.
     */
    const base = baseDaFonte(ctx.inventory, fonteDaConta)
    if (base && !bp.resources.databases.some((d) => d.resourceId === base.id)) {
      bp.resources.databases.push({
        key: `base-${slug(base.label) || raiz}`,
        action: 'reuse',
        resourceId: base.id,
        layer: need.required ? 'essential' : 'recommended',
        rationale: `"${fonteDaConta.label}" já grava neste Database: a operação lê dele em vez de abrir outra coleta`,
        dependsOn: [],
        name: base.label,
        owner: { ownerType: 'account' },
        adapterKind: 'data_history',
        agentKeys: bp.organization.agents.map((a) => a.key),
        // LEITURA e só: esta é a base de onde a operação consome.
        agentAccess: 'read' as const,
      })
    }
    return
  }

  const jaExiste = escolha === 'criar' ? null : baseQueJaServe(ctx.inventory, need.source)
  if (jaExiste) {
    if (!bp.resources.databases.some((d) => d.resourceId === jaExiste.id)) {
      bp.resources.databases.push({
        key: `base-${slug(jaExiste.label) || raiz}`,
        action: 'reuse',
        resourceId: jaExiste.id,
        layer: need.required ? 'essential' : 'recommended',
        rationale: `"${jaExiste.label}" já recebe este dado: a proposta lê dela em vez de abrir outra coleta`,
        dependsOn: [],
        name: jaExiste.label,
        owner: { ownerType: 'account' },
        adapterKind: 'data_history',
        // LEITURA e só: esta é a base de onde a operação consome. Conceder escrita numa
        // base que a pessoa já usa para outra coisa seria o plano assumindo um risco que
        // ninguém pediu.
        agentKeys: bp.organization.agents.map((a) => a.key),
        agentAccess: 'read' as const,
      })
    }
    return
  }

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

/** A mesma chave que a pergunta usa — ver `slugDeAssunto` em `nextQuestion.ts`. */
const chaveDeAssunto = (texto: string) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

/**
 * A Database DA CONTA que já guarda este dado, se houver.
 *
 * Mesmo critério de `fonteQueJaServe`, contra o inventário em vez do plano: o nome da base
 * e o dos conjuntos dela contam, porque quem batiza a base de "Cripto" costuma batizar o
 * conjunto de "bitcoin".
 */
function baseQueJaServe(inventory: OfficeInventory | null, texto: string): { id: string; label: string } | null {
  const termos = termosDistintivos(texto)
  if (!termos.length) return null
  const casa = (rotulo: string) => termosDistintivos(rotulo).some((t) => termos.includes(t))

  const bases = inventory?.sections.database?.items ?? []
  const conjuntos = inventory?.sections.dataset?.items ?? []
  for (const base of bases) {
    const rotulos = [base.label, ...conjuntos.filter((d) => d.meta?.dataStoreId === base.id).map((d) => d.label)]
    if (rotulos.some(casa)) return { id: base.id, label: base.label }
  }
  return null
}

/**
 * A FONTE da conta que já traz este dado.
 *
 * O NOME QUE A PESSOA USA COSTUMA ESTAR AQUI, e não na base. Numa conta real, "a minha base
 * do bitcoin" era uma fonte chamada "Bitcoin" gravando num Database chamado "Históricos":
 * procurar só pelo nome da base não achava nada, e a proposta mandava abrir uma coleta nova
 * em cima de uma que já rodava havia treze mil leituras.
 */
function fonteDaContaQueJaServe(inventory: OfficeInventory | null, texto: string): { id: string; label: string } | null {
  const termos = termosDistintivos(texto)
  if (!termos.length) return null
  const achada = (inventory?.sections.source?.items ?? []).find((f) => termosDistintivos(f.label).some((t) => termos.includes(t)))
  return achada ? { id: achada.id, label: achada.label } : null
}

/**
 * O Database em que uma fonte grava.
 *
 * A fonte declara `dataStoreId` quando escreve histórico. Sem ele, a conta que só tem um
 * Database de histórico responde sozinha — é ele, e não há ambiguidade a resolver.
 */
function baseDaFonte(inventory: OfficeInventory | null, fonte: { id: string; label: string }): { id: string; label: string } | null {
  const bases = inventory?.sections.database?.items ?? []
  const fonteNoInventario = (inventory?.sections.source?.items ?? []).find((f) => f.id === fonte.id)
  const declarado = String(fonteNoInventario?.meta?.dataStoreId ?? '')
  const porDeclaracao = bases.find((b) => b.id === declarado)
  if (porDeclaracao) return { id: porDeclaracao.id, label: porDeclaracao.label }
  const historicos = bases.filter((b) => String(b.meta?.adapterKind ?? '') === 'data_history')
  return historicos.length === 1 ? { id: historicos[0].id, label: historicos[0].label } : null
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
  manifest: AssistantCapabilityManifest | null
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


/**
 * QUAL NÚMERO a janela resume.
 *
 * Sai do que a pessoa disse que quer guardar (`recordsToKeep`), e não de um palpite sobre o
 * texto: resumir o campo errado grava uma série que parece certa e mente em todo gráfico.
 * Sem nenhum campo declarado, não há janela — é pendência.
 */
/**
 * O que é CARIMBO DE TEMPO — e por isso nunca é o número que a janela resume.
 *
 * Duas famílias, porque as contas nomeiam campo de jeitos diferentes: a palavra dentro do
 * nome (`timestamp`, `data_da_venda`, `hora`) e o sufixo de particípio que o português usa
 * para "quando" (`criado_em`, `atualizado_em`, `lido_em`) e o inglês com `_at`.
 */
const CARIMBO_DE_TEMPO = /(timestamp|data|hora|horario|instante|momento|inicio|fim|janela|periodo|date|time|_(em|at|date|time)$|^(em|at)$)/i

/**
 * QUAL CAMPO A JANELA RESUME — e quando não dá para saber.
 *
 * A primeira versão pegava "o primeiro campo que não é data". Isso passou no caso que estava
 * na mesa (`price, timestamp`) e escolheria `sku` numa fonte `sku, quantidade` — o assunto
 * nunca se repete entre contas, e uma regra que só acerta no exemplo está errada.
 *
 * A ordem agora é a de quem sabe mais, para quem sabe menos:
 *   1. o campo NOMEADO no pedido, casado com um campo real da fonte
 *      ("a soma da quantidade por hora" → `quantidade`);
 *   2. quando a fonte tem um candidato só, ele — não há o que escolher;
 *   3. o que a pessoa declarou guardar, se lá houver um candidato só;
 *   4. nada. Com dois candidatos e nenhum nomeado, resumir é chutar, e o chute grava uma
 *      série que parece certa. Vira pendência, e a pessoa escolhe.
 *
 * ponytail: uma janela resume UM campo. "Média do preço e soma da quantidade" na mesma
 * frase vira uma janela sobre o campo nomeado; se aparecerem dois pedidos assim, o caminho
 * é uma regra por campo, não um segundo palpite aqui.
 */
function normalizarCampo(c: string): string {
  return String(c ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function candidatosDaFonte(campoDaFonte: string): string[] {
  return campoDaFonte
    .split(/[,;\s]+/)
    .map((c) => c.trim())
    .filter((c) => c && !CARIMBO_DE_TEMPO.test(c))
}

export function campoAResumir(texto: string, campoDaFonte: string, declarados: string[] = []): string | null {
  const daFonte = candidatosDaFonte(campoDaFonte)
  const alvo = normalizarCampo(texto)

  // 1. O campo que o pedido NOMEIA. O mais longo primeiro: "valor_total" antes de "valor".
  const nomeado = [...daFonte]
    .sort((a, b) => b.length - a.length)
    .find((c) => normalizarCampo(c).length >= 3 && alvo.includes(normalizarCampo(c)))
  if (nomeado) return nomeado

  // 2. Um candidato só na fonte: não há o que escolher.
  if (daFonte.length === 1) return daFonte[0]

  // 3. O que a pessoa declarou guardar — mesma régua.
  const declaradosLimpos = declarados.map((c) => String(c ?? '').trim()).filter((c) => c && !CARIMBO_DE_TEMPO.test(c))
  const declaradoNomeado = [...declaradosLimpos]
    .sort((a, b) => b.length - a.length)
    .find((c) => normalizarCampo(c).length >= 3 && alvo.includes(normalizarCampo(c)))
  if (declaradoNomeado) return declaradoNomeado
  if (daFonte.length === 0 && declaradosLimpos.length === 1) return declaradosLimpos[0]

  // 4. Ambíguo. Escolher aqui é chutar.
  return null
}

/** Os candidatos que a pessoa teria de escolher entre, quando a regra não decide. */
export function candidatosParaResumir(campoDaFonte: string, declarados: string[] = []): string[] {
  const daFonte = candidatosDaFonte(campoDaFonte)
  if (daFonte.length) return daFonte
  return declarados.map((c) => String(c ?? '').trim()).filter((c) => c && !CARIMBO_DE_TEMPO.test(c))
}

/**
 * A SÉRIE RESUMIDA POR JANELA — a fonte que já existe, uma segunda série em cima dela.
 *
 * Do pedido do dono, literal: "salvar o valor mínimo e máximo de bitcoin em um intervalo de
 * 5 minutos". Ele já tinha a fonte gravando de 15 em 15 segundos, com 17 mil registros. O que
 * faltava era dizer, no plano, que existe uma segunda série que fecha a janela.
 *
 * Reaproveitar a fonte é o ponto: criar outra coletaria o mesmo endereço duas vezes e
 * produziria dois históricos que divergem no primeiro erro de rede.
 */
/**
 * O compilador NÃO confia no que recebe, nem vindo do próprio turno.
 *
 * `normalizeTurn` já valida, mas ele é uma porta; esta é outra, e quem chama o compilador
 * direto passa por aqui. Uma janela sem tamanho, sem campo ou com uma conta que o motor não
 * tem gravaria uma coluna que ninguém lê — e gravaria calada.
 */
const janelaValida = (w: { field?: string; everyMs?: number; ops?: string[] }): boolean =>
  Number.isFinite(Number(w.everyMs)) && Number(w.everyMs) > 0 && String(w.field ?? '').trim() !== '' && (w.ops ?? []).some((op) => op in NOME_DA_CONTA)

/**
 * O CAMPO TEM DE EXISTIR NA ORIGEM — senão a janela roda e não acumula nada.
 *
 * Do banco do dono: a origem gravava `{"preco_bitcoin": "77131.82"}` e a janela procurava
 * `preco`. Ela recebeu oito leituras (`count: 8`) e fechou sem `acc` nenhum: o motor rodou,
 * o recorder existia, e o conjunto ficava vazio para sempre. É o defeito mais caro possível
 * — nada quebra, nada avisa, e a pessoa espera.
 *
 * O modelo escreveu "preco" querendo dizer o preço. CORRIGIR para o nome real é melhor que
 * recusar: ele acertou a intenção e errou o nome, e a fonte sabe o nome certo. Corrige no
 * lugar; devolve `false` só quando não há nome parecido nenhum, e aí a pendência já foi
 * registrada.
 */
function campoDaJanelaExiste(
  declarada: { field: string },
  origem: { label: string; campos: string } | null,
  pending: { kind: string; ref: string; because: string }[],
  ref: string,
): boolean {
  const camposReais = (origem?.campos ?? '')
    .split(/[,;\s]+/)
    .map((c) => c.trim())
    .filter(Boolean)
  // Origem sem campos declarados não tem como desmentir ninguém: a janela segue.
  if (!camposReais.length) return true
  if (camposReais.some((c) => c === declarada.field)) return true
  const parecido = camposReais.find(
    (c) => normalizarCampo(c) === normalizarCampo(declarada.field) || normalizarCampo(c).includes(normalizarCampo(declarada.field)) || normalizarCampo(declarada.field).includes(normalizarCampo(c)),
  )
  if (parecido) {
    declarada.field = parecido
    return true
  }
  pending.push({
    kind: 'window_field',
    ref,
    because: `"${declarada.field}" não existe em "${origem?.label}" — os campos dela são: ${camposReais.join(', ')}`,
  })
  return false
}

function compilarJanela(
  bp: OfficeBlueprintV2,
  pending: { kind: string; ref: string; because: string }[],
  ctx: {
    job: OperationBrief['jobs'][number] | undefined
    /** Só para nomear a série quando não há origem nem entrada — nunca para decidir nada. */
    jobId: string
    janela: ParsedWindow
    achado: { id: string; kind: 'dataset' | 'source'; label: string; campos: string } | null
  },
): void {
  const { job, jobId, janela, achado } = ctx

  /**
   * UMA SÉRIE POR FONTE E POR JANELA — e não uma por trabalho.
   *
   * A chave saía do nome do trabalho. No teste do dono, dois trabalhos falavam da mesma
   * série ("consolidar min/máx" e "armazenar o histórico consolidado"), e o plano nasceu com
   * DUAS fontes iguais e DUAS janelas iguais: duas coletas do mesmo endereço e duas séries
   * gravando a mesma linha. Quem identifica a série é de onde ela lê e como ela fecha.
   */
  const assinatura = slug(`${achado?.label ?? job?.input ?? jobId}-${janela.everyMs}-${janela.rules.map((r) => `${r.from}${r.op}`).join('')}`)
  const fonteKey = `fonte-${assinatura}`
  const janelaKey = `janela-${assinatura}`
  if (bp.operations.histories.some((h) => h.key === janelaKey)) return

  /**
   * A ORIGEM É UM CONJUNTO QUE JÁ RECEBE DADO — o caso mais comum de todos.
   *
   * A conta já coleta há meses, e o pedido é resumir o que já está entrando. O que a busca
   * acha então é um CONJUNTO, cujo id tem a forma `storeId:datasetKey` — e usá-lo como
   * `resourceId` de uma fonte fazia o apply recusar com "a fonte ainda não existe". A janela
   * era pulada, nenhum recorder nascia, e nada atualizava.
   *
   * Aqui a origem é declarada pelo que ela é, e nenhuma fonte é criada nem reaproveitada:
   * não há coleta nova a montar quando o dado já está chegando.
   */
  if (achado?.kind === 'dataset') {
    const cada = tamanhoDaJanela(janela.everyMs)
    bp.operations.histories.push({
      key: janelaKey,
      action: 'create',
      ...ESSENCIAL,
      rationale: `${janela.rules.map((r) => r.to).join(' e ')} de "${janela.rules[0].from}" a cada ${cada}, lendo a série "${achado.label}" que já recebe este dado`,
      dependsOn: [],
      sourceKey: '',
      originRef: achado.id,
      name: `${janela.rules.map((r) => r.to).join(' e ')} de "${janela.rules[0].from}" a cada ${cada}`,
      window: janela,
    })
    bp.acceptanceTests.push({
      key: `prova-${janelaKey}`,
      kind: 'window_field',
      targetKey: janelaKey,
      expectation: `"${achado.label}" traz "${janela.rules[0].from}" e ele é um número`,
      required: true,
    })
    return
  }

  if (!bp.operations.sources.some((f) => f.key === fonteKey)) {
    bp.operations.sources.push({
      key: fonteKey,
      action: achado ? 'reuse' : 'create',
      // Reaproveitar sem dizer QUAL é um plano que só falha na aplicação, tarde demais.
      ...(achado ? { resourceId: achado.id } : {}),
      ...ESSENCIAL,
      rationale: achado ? `"${achado.label}" já recebe este dado nesta conta` : 'sem uma fonte, não há o que resumir em janelas',
      dependsOn: [],
      name: achado?.label ?? String(job?.input ?? assinatura),
      kind: 'api_polling',
      config: {},
      mapping: { version: 1, fields: [{ to: janela.rules[0].from, from: janela.rules[0].from, required: true }] },
      cadence: { mode: 'interval', intervalMs: 60_000 },
    } as never)
    if (!achado) {
      pending.push({ kind: 'source_config', ref: String(job?.input ?? assinatura), because: 'falta dizer de onde este dado vem: endereço, App ou fonte existente' })
    }
  }

  const cada = tamanhoDaJanela(janela.everyMs)
  bp.operations.histories.push({
    key: janelaKey,
    action: 'create',
    ...ESSENCIAL,
    rationale: `${janela.rules.map((r) => r.to).join(' e ')} de "${janela.rules[0].from}" a cada ${cada} — contas determinísticas do motor de Históricos`,
    dependsOn: [fonteKey],
    sourceKey: fonteKey,
    name: `${janela.rules.map((r) => r.to).join(' e ')} de "${janela.rules[0].from}" a cada ${cada}`,
    window: janela,
  })

  /**
   * A PROVA — leve, e antes de a série entrar no ar.
   *
   * Uma leitura da origem responde se a janela tem o que somar. Sem ela, um campo com o nome
   * errado produz um recorder que roda para sempre sem acumular nada: aplicado, "tudo certo",
   * e o conjunto vazio. A prova custa milissegundos e é a diferença entre sinal verde e
   * esperar sem saber.
   */
  bp.acceptanceTests.push({
    key: `prova-${janelaKey}`,
    kind: 'window_field',
    targetKey: janelaKey,
    expectation: `a origem traz "${janela.rules[0].from}" e ele é um número`,
    required: true,
  })
}
