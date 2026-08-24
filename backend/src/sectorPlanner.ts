// Quem precisa trabalhar nesta pergunta — decidido ANTES de alguém trabalhar.
//
// O modo orquestrado dependia de uma coisa só: o coordenador, sozinho, resolver chamar
// um colega. Ele tem as ferramentas e (desde o briefing) a lista da equipe, mas a
// decisão continuava sendo um impulso no meio da resposta — e um modelo que recebe uma
// pergunta respondível tende a responder, não a delegar. O resultado prático era uma
// equipe inteira representada por um agente só.
//
// O plano torna essa decisão um passo declarado: uma pergunta simples seleciona UM
// especialista; uma pergunta que atravessa assuntos seleciona os que forem necessários,
// com objetivo próprio para cada um e dependência quando um depende do resultado do
// outro. É a mesma ideia das etapas de um pipeline — só que descoberta na hora, para
// esta pergunta, em vez de escrita à mão para sempre.
//
// DUAS COISAS QUE NÃO SÃO A MESMA:
//
//   1. consultar a BASE de um colega (RAG entre agentes) — é leitura de documento, sai
//      de graça no mesmo turno e já acontece como rede de segurança da recuperação;
//   2. EXECUTAR um colega — é outra inferência, com as ferramentas dele, o modelo dele
//      e o custo dele.
//
// Só a segunda é tarefa de plano. Achar um trecho na base de alguém nunca faz esse
// alguém virar participante da execução, e este módulo não trata as duas como iguais.
//
// Puro de propósito: sem banco, sem provedor e sem relógio. Quem chama o modelo injeta
// a função; quem não tiver modelo ainda recebe um plano — o determinístico, abaixo.
import { createHash } from 'node:crypto'
import { normalize } from './lexicalRetrieval.js'
import { RESPONSE_MODES } from './executors/contract.js'
import { findFunction } from './executors/functionRegistry.js'
import type { ExecutorKind, ResponseMode } from './executors/types.js'

// --- de onde vem cada campo de uma entrada -------------------------------------------------
//
// Três origens, e só três: o contexto do pedido, o resultado de uma etapa anterior, ou um
// valor escrito no próprio plano.
//
// A tentação aqui é aceitar uma expressão — um JSONPath com filtro, um `eval` "pequeno",
// um trecho de código que o modelo escreve na hora. Não: o plano é redigido por um MODELO,
// a partir de uma pergunta que qualquer pessoa pode fazer. Uma expressão avaliável nesse
// caminho é execução arbitrária com passos a mais. O que existe é um caminho de nomes.
export type Binding =
  | { from: 'context'; path: string[] }
  | { from: 'step'; stepId: string; path: string[] }
  | { from: 'literal'; value: unknown }

/**
 * Nomes que atravessam o objeto e chegam no protótipo.
 *
 * Nenhum deles é campo de ninguém, e um binding que os alcança não está lendo um dado: está
 * escrevendo no protótipo de todo objeto do processo.
 */
const PERIGOSOS = new Set(['__proto__', 'prototype', 'constructor'])

/** Um segmento de caminho: nome de campo, nada mais. Sem colchete, ponto, curinga ou filtro. */
export const isSafeSegment = (s: string): boolean => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) && !PERIGOSOS.has(s)

/** Um literal precisa ser JSON — e JSON que não carrega chave perigosa por dentro. */
function unsafeLiteral(valor: unknown, profundidade = 0): string | null {
  if (profundidade > 6) return 'literal aninhado demais'
  if (typeof valor === 'function' || typeof valor === 'symbol' || typeof valor === 'bigint') return 'literal precisa ser JSON'
  if (Array.isArray(valor)) {
    for (const v of valor) {
      const e = unsafeLiteral(v, profundidade + 1)
      if (e) return e
    }
    return null
  }
  if (valor && typeof valor === 'object') {
    for (const chave of Object.keys(valor as object)) {
      if (PERIGOSOS.has(chave)) return `chave proibida "${chave}" no literal`
      const e = unsafeLiteral((valor as Record<string, unknown>)[chave], profundidade + 1)
      if (e) return e
    }
  }
  return null
}

/**
 * Lê o que o modelo escreveu como origem de um campo.
 *
 * `$context.campo`, `$steps.etapa.campo` ou um valor JSON. Uma string que começa com `$` e
 * não é nenhum dos dois é ERRO, não literal: aceitá-la como texto transformaria uma
 * referência escrita errado num valor inventado, entregue ao agente como se fosse dado.
 * `$$` escapa, para o literal que por acaso começa com cifrão.
 */
export function parseBinding(bruto: unknown): { binding?: Binding; error?: string } {
  if (typeof bruto !== 'string') {
    const erro = unsafeLiteral(bruto)
    return erro ? { error: erro } : { binding: { from: 'literal', value: bruto } }
  }
  if (bruto.startsWith('$$')) return { binding: { from: 'literal', value: bruto.slice(1) } }
  if (!bruto.startsWith('$')) return { binding: { from: 'literal', value: bruto } }

  const partes = bruto.slice(1).split('.')
  const raiz = partes.shift() ?? ''
  const invalido = (p: string[]) => p.find((x) => !isSafeSegment(x))

  if (raiz === 'context') {
    if (partes.length === 0) return { error: `${bruto}: falta o nome do campo` }
    const ruim = invalido(partes)
    if (ruim !== undefined) return { error: `${bruto}: segmento inválido "${ruim}"` }
    return { binding: { from: 'context', path: partes } }
  }
  if (raiz === 'steps') {
    const stepId = partes.shift() ?? ''
    if (!isSafeSegment(stepId)) return { error: `${bruto}: id de etapa inválido` }
    if (partes.length === 0) return { error: `${bruto}: falta o nome do campo` }
    const ruim = invalido(partes)
    if (ruim !== undefined) return { error: `${bruto}: segmento inválido "${ruim}"` }
    return { binding: { from: 'step', stepId, path: partes } }
  }
  return { error: `${bruto}: use $context.campo, $steps.etapa.campo ou um valor literal` }
}

/** O mapa inteiro. O NOME do campo de destino passa pela mesma peneira que o caminho. */
export function parseBindings(bruto: unknown): { bindings: Record<string, Binding>; errors: string[] } {
  const bindings: Record<string, Binding> = {}
  const errors: string[] = []
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return { bindings, errors }
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (!isSafeSegment(chave)) {
      errors.push(`campo de destino inválido "${chave}"`)
      continue
    }
    const { binding, error } = parseBinding(valor)
    if (error || !binding) errors.push(`${chave}: ${error ?? 'origem inválida'}`)
    else bindings[chave] = binding
  }
  return { bindings, errors }
}

/** A origem de volta em texto — para o log, o prompt e a mensagem de diagnóstico. */
export const describeBinding = (b: Binding): string =>
  b.from === 'context' ? `$context.${b.path.join('.')}` : b.from === 'step' ? `$steps.${b.stepId}.${b.path.join('.')}` : JSON.stringify(b.value)

const lerCaminho = (raiz: unknown, path: string[]): unknown => {
  let atual = raiz
  for (const p of path) {
    if (!atual || typeof atual !== 'object' || Array.isArray(atual)) return undefined
    // `hasOwnProperty`: sem isto, `$steps.t1.toString` devolveria uma função herdada do
    // protótipo como se fosse um dado que a etapa produziu.
    if (!Object.prototype.hasOwnProperty.call(atual, p)) return undefined
    atual = (atual as Record<string, unknown>)[p]
  }
  return atual
}

/**
 * A entrada montada — e o que NÃO foi encontrado, dito em voz alta.
 *
 * Campo sem origem não vira `null` nem string vazia: vira `missing`. A diferença é a que
 * separa "não sei" de "sei que é nada", e um agente que recebe a segunda responde com
 * convicção sobre um valor que ninguém produziu.
 */
export function resolveBindings(
  bindings: Record<string, Binding> | undefined,
  fontes: { context?: unknown; steps?: Record<string, unknown> },
): { input: Record<string, unknown>; missing: string[] } {
  const input: Record<string, unknown> = {}
  const missing: string[] = []
  for (const [chave, b] of Object.entries(bindings ?? {})) {
    if (b.from === 'literal') {
      input[chave] = b.value
      continue
    }
    const raiz = b.from === 'context' ? fontes.context : (fontes.steps ?? {})[b.stepId]
    const valor = lerCaminho(raiz, b.path)
    if (valor === undefined) missing.push(chave)
    else input[chave] = valor
  }
  return { input, missing }
}

/** Uma execução de agente dentro do plano. */
export interface ExecutionTask {
  /** Identificador dentro do plano (t1, t2…) — é por ele que `dependsOn` aponta. */
  id: string
  agentId: string
  /** O que ESTE agente precisa entregar. Nunca a pergunta inteira copiada, quando dá. */
  objective: string
  /** As tarefas cujo resultado entra como entrada desta. Vazio = roda com o pedido. */
  dependsOn?: string[]
  /**
   * De onde vem cada campo da entrada.
   *
   * AUSENTE é diferente de VAZIO: ausente é uma tarefa legada, que recebe o texto dos
   * antecessores como sempre recebeu. Declarar um campo aqui é dizer que a tarefa PRECISA
   * dele — se ele não chegar, ela não roda.
   */
  inputBindings?: Record<string, Binding>
  /** O contrato de saída do agente no momento em que o plano foi montado. */
  expectedOutputSchema?: Record<string, unknown>
  /** A impressão digital do schema acima: muda quando o contrato do agente muda. */
  outputSchemaHash?: string
  /** Depois que der certo. `stop` encerra o plano ali — uma etapa que decide se há mais. */
  onSuccess?: 'continue' | 'stop'
  /** E quando falhar. `skip` é o de sempre: os dependentes não rodam, o resto continua. */
  onFailure?: 'stop' | 'skip' | 'replan'
  /** Quando esta tarefa precisa de um formato diferente do padrão do agente. */
  responseMode?: ResponseMode
}

/**
 * A identidade de um PLANO, para correlacionar a auditoria.
 *
 * Derivada do conteúdo, e não sorteada: este módulo não tem relógio nem gerador aleatório
 * — de propósito, porque um plano precisa sair igual duas vezes para o mesmo pedido no
 * teste. E derivar tem uma vantagem que sortear não teria: dois planos com o mesmo id são
 * literalmente o mesmo plano, o que é a pergunta que se faz ao investigar uma repetição.
 */
export const planIdOf = (plan: ExecutionPlan): string =>
  schemaHash(plan.tasks.map((t) => [t.id, t.agentId, t.objective, t.dependsOn ?? [], t.inputBindings ?? {}]))

/**
 * As capacidades DESTE membro que a pergunta encostou.
 *
 * É a resposta para "por que ele?" na auditoria. Sem isso, o registro diz que o agente foi
 * escolhido e não diz o que nele casou — e a única forma de investigar uma escolha errada
 * seria reproduzir a pergunta inteira.
 */
export function matchedCapabilities(pergunta: string, m: PlannerMember): string[] {
  const palavras = new Set(palavrasDe(pergunta))
  return (m.capabilities ?? [])
    .filter((c) => {
      const alvo = normalize(String(c))
      return [...palavras].some((p) => alvo.includes(p))
    })
    .slice(0, 8)
}

/** A impressão digital de um contrato — chaves ordenadas, para não depender da ordem. */
export function schemaHash(schema: unknown): string {
  const canonico = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonico)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonico((v as Record<string, unknown>)[k])]))
        : v
  return createHash('sha256').update(JSON.stringify(canonico(schema) ?? null)).digest('hex').slice(0, 16)
}

export interface ExecutionPlan {
  tasks: ExecutionTask[]
  /** O que fazer com os resultados. Ausente = consolidar como o coordenador achar melhor. */
  synthesisObjective?: string
}

/** O que se sabe de um membro na hora de escolher. Vem carregado; este módulo não busca. */
export interface PlannerMember {
  agentId: string
  name: string
  /**
   * O TIPO funcional — diferente de `role`, que é a "Função" escrita pelo dono.
   *
   * Não é etiqueta: quem analisa trabalha sobre o que recebe, e um plano que o aciona sem
   * entrada produz análise sobre o nada.
   */
  type?: 'researcher' | 'analyst' | 'coordinator' | 'executor' | null
  /** Quando mandar para ele — a frase escrita pelo dono, e a mais útil que existe aqui. */
  routingDescription?: string | null
  role?: string | null
  objective?: string | null
  instructions?: string | null
  capabilities?: string[] | null
  /** Nomes das ferramentas concedidas: dizem o que ele CONSEGUE fazer, não só saber. */
  tools?: string[] | null
  /** As ações de App autorizadas, como "appKey.actionKey". Referência, nunca credencial. */
  actions?: string[] | null
  /** Títulos dos documentos da base dele. Nunca o conteúdo. */
  knowledgeTitles?: string[] | null
  /**
   * COMO ele executa. Um agente de função não é um agente de modelo com outro nome: ele
   * não improvisa a partir de prosa, e mandar-lhe uma pergunta em vez dos campos que o
   * schema pede é uma tarefa que nasce falhando.
   */
  executorKind?: ExecutorKind | null
  /** O que ele ACEITA receber. É por aqui que se sabe se a entrada da tarefa existe. */
  inputJsonSchema?: Record<string, unknown> | null
  /** O que ele PRODUZ. É por aqui que se sabe se a saída de um serve de entrada para o outro. */
  outputJsonSchema?: Record<string, unknown> | null
  /**
   * A referência do que ele executa quando não é modelo.
   *
   * Nome e chave, nunca código nem credencial: é o mesmo princípio do executor da fase 2,
   * e o planejador não é lugar para a primeira exceção a ele.
   */
  executorConfig?: { functionName?: string; version?: string; toolId?: string; appKey?: string; actionKey?: string } | null
}

/** Os nomes dos campos de um schema. É o sinal de contrato mais direto que existe aqui. */
export const schemaFields = (schema: unknown): string[] => {
  const p = (schema as { properties?: unknown } | null)?.properties
  return p && typeof p === 'object' && !Array.isArray(p) ? Object.keys(p as object) : []
}

/** Os campos sem os quais o agente não trabalha. */
export const requiredFields = (schema: unknown): string[] => {
  const r = (schema as { required?: unknown } | null)?.required
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : []
}

const tipoDoCampo = (schema: unknown, campo: string): string | null => {
  const props = (schema as { properties?: Record<string, unknown> } | null)?.properties
  const t = (props?.[campo] as { type?: unknown } | undefined)?.type
  return typeof t === 'string' ? t : null
}

/**
 * O teto de execuções por pergunta.
 *
 * Não é para chamar todo mundo: cada tarefa é uma inferência inteira, com a base e as
 * ferramentas do agente. Cobertura suficiente, não exaustiva.
 */
export const MAX_TASKS = 4

// --- o texto que descreve um membro, para busca e para o prompt --------------------------

const listaCurta = (itens: string[] | null | undefined, max = 8): string =>
  (itens ?? []).map((i) => String(i).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, max).join(', ')

const trecho = (texto: string | null | undefined, max: number): string =>
  (texto ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Tudo que descreve um membro, em uma linha — a mesma base para o modelo e para a nota. */
export function describeMember(m: PlannerMember): string {
  const entrada = schemaFields(m.inputJsonSchema)
  const saida = schemaFields(m.outputJsonSchema)
  const obrigatorios = new Set(requiredFields(m.inputJsonSchema))
  return [
    m.name,
    m.type ? `[${m.type}]` : '',
    // COMO ele executa vem antes do resto: é o que decide se a tarefa recebe campos ou prosa.
    m.executorKind && m.executorKind !== 'llm' ? `executa:${m.executorKind}` : '',
    m.executorConfig?.functionName ? `função:${m.executorConfig.functionName}` : '',
    m.executorConfig?.appKey && m.executorConfig?.actionKey ? `ação:${m.executorConfig.appKey}.${m.executorConfig.actionKey}` : '',
    trecho(m.routingDescription, 200),
    trecho(m.role, 160),
    trecho(m.objective, 200),
    trecho(m.instructions, 160),
    listaCurta(m.capabilities),
    listaCurta(m.tools),
    listaCurta(m.actions),
    // Os campos do contrato, com `*` no que é obrigatório: sem isso o modelo escreve
    // bindings para campos que o agente não tem e inventa os que ele exige.
    entrada.length > 0 ? `entrada:{${entrada.map((c) => (obrigatorios.has(c) ? `${c}*` : c)).slice(0, 12).join(',')}}` : '',
    saida.length > 0 ? `saída:{${saida.slice(0, 12).join(',')}}` : '',
    listaCurta(m.knowledgeTitles),
  ]
    .filter(Boolean)
    .join(' · ')
}

// --- a escolha determinística ------------------------------------------------------------
//
// Existe por três razões, e nenhuma delas é ser tão boa quanto um modelo: ela responde
// quando não há modelo disponível, quando o modelo devolve lixo, e no teste — onde um
// plano precisa ser o mesmo toda vez.

// Palavras que aparecem em qualquer pergunta e não apontam para ninguém.
const VAZIAS = new Set([
  'qual','quais','quando','onde','como','porque','para','sobre','esse','essa','este','esta','isso','pelo','pela',
  'que','com','dos','das','uma','uns','umas','por','nos','nas','mais','menos','entre','também','tambem','preciso',
  'quero','pode','poderia','favor','me','da','de','do','no','na','em','os','as','um','e','ou','the','and','for','with',
])

const palavrasDe = (texto: string): string[] =>
  normalize(texto)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((p) => p.length >= 4 && !VAZIAS.has(p))

/**
 * Quanto este membro tem a ver com a pergunta, entre 0 e 1.
 *
 * Não é uma contagem sobre o perfil inteiro: o que ele SABE FAZER pesa, o que ele se CHAMA
 * quase não. Um agente batizado de "Financeiro" casa com metade das perguntas de uma
 * empresa sem que isso diga nada sobre o que ele consegue entregar — e escolher por nome é
 * como o plano acabava mandando a pergunta para quem tinha o rótulo certo e a capacidade
 * errada. Capacidade, ferramenta e contrato são a evidência; nome é contexto secundário.
 *
 * Bruto de propósito: a decisão fina é do modelo; isto separa quem tem alguma relação de
 * quem não tem nenhuma, e é o desempate quando não há modelo.
 */
export function memberScore(pergunta: string, m: PlannerMember): number {
  const palavras = [...new Set(palavrasDe(pergunta))]
  if (palavras.length === 0) return 0
  const baldes: { texto: string; peso: number }[] = [
    { texto: listaCurta(m.capabilities, 24), peso: 3 },
    { texto: `${listaCurta(m.tools, 24)} ${listaCurta(m.actions, 24)}`, peso: 3 },
    { texto: m.routingDescription ?? '', peso: 3 },
    // Os campos do contrato: "faturamento", "cnpj" são competência declarada, não prosa.
    { texto: [...schemaFields(m.inputJsonSchema), ...schemaFields(m.outputJsonSchema)].join(' '), peso: 2 },
    { texto: [m.role, m.objective, m.instructions].filter(Boolean).join(' '), peso: 2 },
    { texto: listaCurta(m.knowledgeTitles, 24), peso: 1 },
    { texto: m.name ?? '', peso: 0.5 },
  ]
  let soma = 0
  let total = 0
  for (const b of baldes) {
    const alvo = normalize(b.texto)
    // Balde vazio não conta contra ninguém: um membro sem base declarada não é pior
    // candidato por isso, só tem menos evidência.
    if (!alvo.trim()) continue
    total += b.peso
    soma += b.peso * (palavras.filter((p) => alvo.includes(p)).length / palavras.length)
  }
  return total === 0 ? 0 : soma / total
}

/**
 * O plano sem modelo: os membros que a pergunta menciona, ou o mais próximo.
 *
 * Nunca devolve vazio com equipe presente — um plano vazio faria o coordenador
 * responder sozinho, que é exatamente o que se quer evitar.
 */
export function fallbackPlan(
  pergunta: string,
  membros: PlannerMember[],
  max = MAX_TASKS,
  opts: { contextFields?: string[] } = {},
): ExecutionPlan {
  if (membros.length === 0) return { tasks: [] }
  // Sem modelo, quem coleta vem primeiro: um analista sozinho não teria o que analisar.
  // E quem CONDUZ nunca é tarefa: um coordenador dentro do plano é o time inteiro parado
  // esperando por alguém que também estava esperando.
  const operacionais = membros.filter((m) => (m.type ?? 'executor') !== 'coordinator')
  const base = operacionais.length > 0 ? operacionais : membros
  const coleta = base.filter((m) => (m.type ?? 'executor') !== 'analyst')
  const candidatos = coleta.length > 0 ? coleta : base
  const notas = candidatos.map((m) => ({ m, nota: memberScore(pergunta, m) }))
  const relevantes = notas.filter((n) => n.nota > 0).sort((a, b) => b.nota - a.nota)
  // Ninguém casou: manda para um só, e não para todos. Chutar largo custa N inferências.
  const escolhidos = relevantes.length > 0 ? relevantes.slice(0, max) : [notas[0]]
  const tasks: ExecutionTask[] = []

  /**
   * Um agente que declara contrato de entrada recebe CAMPOS, não prosa.
   *
   * E só os campos cuja origem existe de verdade: o que estiver no contexto do pedido, ou o
   * que uma tarefa anterior deste mesmo plano declara produzir. O que não tiver origem fica
   * de fora — `compilePlan` o aponta como `missing_input`, que é o comportamento certo.
   * Preencher aqui seria o motor inventando o valor.
   */
  const ligar = (m: PlannerMember): { bindings: Record<string, Binding>; deps: string[]; faltando: string[] } => {
    const bindings: Record<string, Binding> = {}
    const deps = new Set<string>()
    const faltando: string[] = []
    for (const campo of requiredFields(m.inputJsonSchema)) {
      if (!isSafeSegment(campo)) continue
      if ((opts.contextFields ?? []).includes(campo)) {
        bindings[campo] = { from: 'context', path: [campo] }
        continue
      }
      const fonte = tasks.find((t) => schemaFields(membros.find((x) => x.agentId === t.agentId)?.outputJsonSchema).includes(campo))
      if (fonte) {
        bindings[campo] = { from: 'step', stepId: fonte.id, path: [campo] }
        deps.add(fonte.id)
      } else faltando.push(campo)
    }
    return { bindings, deps: [...deps], faltando }
  }

  const incluir = (m: PlannerMember) => {
    const task: ExecutionTask = { id: `t${tasks.length + 1}`, agentId: m.agentId, objective: pergunta }
    const { bindings, deps } = ligar(m)
    // Sem contrato de entrada, nada de bindings: a tarefa continua legada, recebendo o texto
    // dos antecessores exatamente como sempre recebeu.
    if (Object.keys(bindings).length > 0) task.inputBindings = bindings
    if (deps.length > 0) task.dependsOn = deps
    if (m.outputJsonSchema) {
      task.expectedOutputSchema = m.outputJsonSchema
      task.outputSchemaHash = schemaHash(m.outputJsonSchema)
    }
    tasks.push(task)
  }

  for (const { m } of escolhidos) incluir(m)

  /**
   * O analista volta ao plano — mas só quando o contrato dele está atendido.
   *
   * Ele foi excluído lá em cima por uma razão que continua valendo: analista sem entrada
   * produz leitura sem evidência. O que mudou é que agora dá para SABER se ele tem entrada,
   * em vez de supor. Se todos os campos que ele exige são produzidos por quem já está no
   * plano, ele deixa de ser um chute e passa a ser uma etapa com origem para cada campo.
   */
  const jaTem = new Set(tasks.map((t) => t.agentId))
  const analistas = base
    .filter((m) => (m.type ?? 'executor') === 'analyst' && !jaTem.has(m.agentId) && requiredFields(m.inputJsonSchema).length > 0)
    .map((m) => ({ m, nota: memberScore(pergunta, m) }))
    .filter((n) => n.nota > 0)
    .sort((a, b) => b.nota - a.nota)
  for (const { m } of analistas) {
    if (tasks.length >= max) break
    const { faltando, deps } = ligar(m)
    if (faltando.length > 0 || deps.length === 0) continue
    incluir(m)
  }
  return { tasks }
}

// --- validação -----------------------------------------------------------------------------

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Transforma o que o modelo devolveu num plano em que dá para confiar.
 *
 * O que ele devolve é uma sugestão, não um comando: um id inventado, um agente repetido,
 * uma dependência circular ou dez tarefas para uma pergunta simples são todos possíveis,
 * e nenhum deles pode chegar ao runtime. O que sobrevive daqui é executável.
 */
export function validatePlan(bruto: unknown, membros: PlannerMember[], pergunta: string, max = MAX_TASKS): ExecutionPlan {
  const validos = new Map(membros.map((m) => [m.agentId, m]))
  const cru = (bruto ?? {}) as { tasks?: unknown; synthesisObjective?: unknown }
  const lista = Array.isArray(cru.tasks) ? cru.tasks : []

  const tarefas: ExecutionTask[] = []
  const porAgente = new Set<string>()
  const idsOriginais = new Map<string, string>() // id que o modelo usou → id normalizado
  for (const item of lista as Record<string, unknown>[]) {
    if (tarefas.length >= max) break
    const agentId = texto(item?.agentId)
    // Um agente que não é membro deste setor não entra. O portão de colaboração ainda
    // decidiria depois, mas um plano que já nasce impossível só gera ruído no log.
    if (!validos.has(agentId)) continue
    // Quem CONDUZ não vira tarefa operacional. O modelo sugere isso com frequência —
    // "peça ao gerente que levante os dados" —, e o resultado é um coordenador
    // respondendo sozinho com a equipe parada ao lado. Se a tarefa precisa de
    // ferramenta ou de base, ela é de quem tem uma.
    if ((validos.get(agentId)!.type ?? 'executor') === 'coordinator') continue
    // Um agente por plano nesta etapa: duas tarefas para o mesmo agente são, quase
    // sempre, a mesma pergunta escrita duas vezes — e custam duas inferências.
    if (porAgente.has(agentId)) continue
    porAgente.add(agentId)
    const id = `t${tarefas.length + 1}`
    const original = texto(item?.id)
    if (original) idsOriginais.set(original, id)
    const membro = validos.get(agentId)!
    const bindings = item?.inputBindings !== undefined ? parseBindings(item.inputBindings).bindings : undefined
    const falha = texto(item?.onFailure)
    const modo = texto(item?.responseMode)
    tarefas.push({
      id,
      agentId,
      // Sem objetivo próprio, o pedido original é melhor que uma tarefa vazia.
      objective: texto(item?.objective).slice(0, 600) || pergunta,
      dependsOn: Array.isArray(item?.dependsOn) ? (item.dependsOn as unknown[]).map(texto).filter(Boolean) : [],
      // Origem inválida some aqui e reaparece em `compilePlan` como campo sem origem, que é
      // o diagnóstico verdadeiro: o problema não é a sintaxe, é o dado que não vem.
      ...(bindings && Object.keys(bindings).length > 0 ? { inputBindings: bindings } : {}),
      /**
       * O contrato de saída vem do MEMBRO, nunca do modelo.
       *
       * Deixar o planejador declarar o que a etapa devolve é deixá-lo prometer em nome de
       * outro: o schema que vale é o que o agente tem agora, e o hash é o que denuncia que
       * ele mudou depois que o plano foi montado.
       */
      ...(membro.outputJsonSchema
        ? { expectedOutputSchema: membro.outputJsonSchema, outputSchemaHash: schemaHash(membro.outputJsonSchema) }
        : {}),
      ...(texto(item?.onSuccess) === 'stop' ? { onSuccess: 'stop' as const } : {}),
      ...(falha === 'stop' || falha === 'skip' || falha === 'replan' ? { onFailure: falha } : {}),
      ...(RESPONSE_MODES.includes(modo as ResponseMode) ? { responseMode: modo as ResponseMode } : {}),
    })
  }

  // As dependências só valem depois que todos os ids existem — e só para trás: uma tarefa
  // que espera por outra que roda depois dela é um ciclo escrito de outro jeito.
  const posicao = new Map(tarefas.map((t, i) => [t.id, i]))
  for (const [i, tarefa] of tarefas.entries()) {
    const resolvidas = (tarefa.dependsOn ?? [])
      .map((d) => idsOriginais.get(d) ?? d)
      .filter((d) => posicao.has(d) && posicao.get(d)! < i)
    // Os bindings apontam para os ids que o MODELO escolheu; os ids do plano são outros.
    // Sem esta tradução o campo apontaria para uma etapa que não existe — e o agente
    // rodaria sem ele, que é o começo de toda resposta inventada.
    if (tarefa.inputBindings) {
      const traduzidos: Record<string, Binding> = {}
      for (const [chave, b] of Object.entries(tarefa.inputBindings)) {
        if (b.from !== 'step') {
          traduzidos[chave] = b
          continue
        }
        const alvo = idsOriginais.get(b.stepId) ?? b.stepId
        if (posicao.has(alvo) && posicao.get(alvo)! < i) {
          traduzidos[chave] = { ...b, stepId: alvo }
          resolvidas.push(alvo)
        }
      }
      /**
       * Uma tarefa CONTRATADA continua contratada, mesmo perdendo todos os bindings.
       *
       * `delete` a devolvia para o modo legado — e legado quer dizer "recebe o texto do
       * antecessor e se vira". Uma tarefa cujas origens foram todas descartadas por serem
       * inválidas é o oposto disso: ela é a que MAIS precisa ser barrada. Deletar
       * transformava o defeito em silêncio, e o agente rodava com a prosa.
       *
       * Vazio é o estado certo: `compilePlan` aponta cada campo obrigatório sem origem, e
       * o runtime não executa.
       */
      tarefa.inputBindings = traduzidos
    }
    if (resolvidas.length > 0) tarefa.dependsOn = [...new Set(resolvidas)]
    else delete tarefa.dependsOn
  }

  /**
   * Quem ANALISA precisa receber alguma coisa.
   *
   * Um analista sem dependência analisa o que existir na entrada — que é o pedido cru — e
   * devolve uma leitura sem evidência, com toda a aparência de uma análise fundamentada.
   * Duas correções, nesta ordem: se há quem colete no mesmo plano, ele passa a depender
   * de todos; se não há, ele sai. Não selecionar é melhor que selecionar para produzir
   * texto sobre o nada.
   */
  const papel = new Map(membros.map((m) => [m.agentId, m.type ?? 'executor']))
  const coletores = tarefas.filter((t) => papel.get(t.agentId) === 'researcher' || papel.get(t.agentId) === 'executor')
  const corrigidas = tarefas.filter((t) => {
    if (papel.get(t.agentId) !== 'analyst') return true
    if ((t.dependsOn ?? []).length > 0) return true
    const antes = coletores.filter((c) => tarefas.indexOf(c) < tarefas.indexOf(t)).map((c) => c.id)
    if (antes.length === 0) return false
    t.dependsOn = antes
    return true
  })
  tarefas.length = 0
  tarefas.push(...corrigidas)

  if (tarefas.length === 0) return fallbackPlan(pergunta, membros, max)
  const sintese = texto(cru.synthesisObjective).slice(0, 400)
  return { tasks: tarefas, ...(sintese ? { synthesisObjective: sintese } : {}) }
}

// --- a compilação: o plano vira executável, ou vira diagnóstico -----------------------------
//
// `validatePlan` é indulgente de propósito — ela recebe a sugestão de um modelo e salva o
// que dá para salvar. Este passo é o oposto: roda ANTES de qualquer execução e ou o plano
// está de pé, ou está escrito por que não está.
//
// A pergunta que ele responde é sempre a mesma: cada campo que uma tarefa recebe TEM
// origem? Um plano onde a resposta é não roda assim mesmo — e o agente, sem o dado,
// preenche a lacuna com o que for plausível. É por isso que a falha aqui é preferível: ela
// custa uma mensagem, e a outra custa uma resposta errada com cara de certa.

export type PlanDiagnosticCode =
  | 'unknown_agent'
  | 'capability_mismatch'
  | 'invalid_id'
  | 'duplicate_id'
  | 'unknown_step'
  | 'forward_reference'
  | 'undeclared_dependency'
  | 'cycle'
  | 'missing_input'
  | 'unknown_context_field'
  | 'incompatible_output'
  | 'unknown_function'
  | 'unsafe_reference'

export interface PlanDiagnostic {
  code: PlanDiagnosticCode
  taskId?: string
  /** O campo em questão, quando há um. Nome de campo, nunca o valor dele. */
  field?: string
  message: string
}

export interface CompileOptions {
  /**
   * Os campos que o pedido traz.
   *
   * AUSENTE não é a mesma coisa que VAZIO: ausente quer dizer que quem chamou não sabe
   * enumerar o contexto, e aí `$context.x` passa. Vazio quer dizer que não há contexto
   * nenhum, e aí qualquer `$context.x` é um campo sem origem.
   */
  contextFields?: string[]
  /** Existe esta função? Injetável para teste; o padrão é o registro real do servidor. */
  functionExists?: (functionName: string, version?: string) => boolean
}

export interface CompiledPlan {
  ok: boolean
  plan: ExecutionPlan
  diagnostics: PlanDiagnostic[]
  /** O que ninguém produz e o contexto não tem. É daqui que sai o pedido de esclarecimento. */
  unmet: { taskId: string; agentId: string; field: string }[]
}

const funcaoExiste = (nome: string, versao?: string): boolean => {
  const f = findFunction(nome)
  return Boolean(f) && (!versao || f!.version === versao)
}

export function compilePlan(plan: ExecutionPlan, membros: PlannerMember[], opts: CompileOptions = {}): CompiledPlan {
  const diagnostics: PlanDiagnostic[] = []
  const unmet: CompiledPlan['unmet'] = []
  const porId = new Map(membros.map((m) => [m.agentId, m]))
  const existe = opts.functionExists ?? funcaoExiste
  const vistos = new Set<string>()
  const posicao = new Map<string, number>()
  for (const [i, t] of plan.tasks.entries()) if (!posicao.has(t.id)) posicao.set(t.id, i)

  for (const [i, task] of plan.tasks.entries()) {
    const diga = (code: PlanDiagnosticCode, message: string, field?: string) =>
      diagnostics.push({ code, taskId: task.id, message, ...(field ? { field } : {}) })

    if (!isSafeSegment(task.id)) diga('invalid_id', `id de etapa inválido: "${task.id}"`)
    if (vistos.has(task.id)) diga('duplicate_id', `id repetido: "${task.id}"`)
    vistos.add(task.id)

    // AUTORIZADO quer dizer: membro deste setor. O portão de colaboração ainda decide
    // depois, mas um plano que já nasce impossível não deve chegar até lá.
    const membro = porId.get(task.agentId)
    if (!membro) {
      diga('unknown_agent', `${task.agentId} não é membro deste setor`)
      continue
    }

    // Quem CONDUZ não executa tarefa operacional, e quem ANALISA precisa receber algo.
    if ((membro.type ?? 'executor') === 'coordinator') diga('capability_mismatch', `${membro.name} conduz a equipe; não executa etapa`)
    if ((membro.type ?? 'executor') === 'analyst' && (task.dependsOn ?? []).length === 0 && !task.inputBindings)
      diga('capability_mismatch', `${membro.name} analisa o que recebe, e esta etapa não recebe nada`)

    // O que ele executa precisa EXISTIR. Um agente de função apontando para uma função que
    // não está no registro é uma etapa que falha depois de o plano inteiro já ter começado.
    if (membro.executorKind === 'function') {
      const nome = membro.executorConfig?.functionName ?? ''
      if (!nome || !existe(nome, membro.executorConfig?.version))
        diga('unknown_function', `${membro.name}: função "${nome || '(vazia)'}" não existe no registro`)
    }
    if (membro.executorKind === 'tool') {
      const cfg = membro.executorConfig ?? {}
      if (!cfg.toolId && !(cfg.appKey && cfg.actionKey)) diga('unknown_function', `${membro.name}: ferramenta ou ação não configurada`)
      else if (cfg.appKey && cfg.actionKey && membro.actions && !membro.actions.includes(`${cfg.appKey}.${cfg.actionKey}`))
        diga('unknown_function', `${membro.name}: ação ${cfg.appKey}.${cfg.actionKey} não está autorizada`)
    }

    // As dependências: existem, e vêm ANTES. Uma etapa que espera por outra que roda depois
    // dela é um ciclo escrito de um jeito que não parece um.
    for (const d of task.dependsOn ?? []) {
      if (!posicao.has(d)) diga('unknown_step', `depende de "${d}", que não existe no plano`)
      else if (posicao.get(d)! >= i) diga('forward_reference', `depende de "${d}", que só roda depois`)
    }

    // Os bindings: origem existente, declarada, e sem nome perigoso.
    const declaradas = new Set(task.dependsOn ?? [])
    for (const [campo, b] of Object.entries(task.inputBindings ?? {})) {
      if (!isSafeSegment(campo) || (b.from !== 'literal' && b.path.some((x) => !isSafeSegment(x)))) {
        diga('unsafe_reference', `${campo}: referência proibida em ${describeBinding(b)}`, campo)
        continue
      }
      if (b.from === 'context') {
        if (opts.contextFields && !opts.contextFields.includes(b.path[0]))
          diga('unknown_context_field', `${campo}: o pedido não traz "${b.path[0]}"`, campo)
        continue
      }
      if (b.from !== 'step') continue
      if (!posicao.has(b.stepId)) {
        diga('unknown_step', `${campo}: lê de "${b.stepId}", que não existe no plano`, campo)
        continue
      }
      if (posicao.get(b.stepId)! >= i) {
        diga('forward_reference', `${campo}: lê de "${b.stepId}", que só roda depois`, campo)
        continue
      }
      if (!declaradas.has(b.stepId)) diga('undeclared_dependency', `${campo}: lê de "${b.stepId}" sem declará-la em dependsOn`, campo)
      // A saída da origem serve de entrada aqui? Só dá para responder quando a origem
      // declara o que produz — quando não declara, o silêncio é honesto e não vira erro.
      const origem = porId.get(plan.tasks[posicao.get(b.stepId)!].agentId)
      const produz = schemaFields(origem?.outputJsonSchema)
      if (produz.length > 0 && b.path.length === 1 && !produz.includes(b.path[0])) {
        diga('incompatible_output', `${campo}: "${b.stepId}" não produz "${b.path[0]}"`, campo)
        continue
      }
      const tipoOrigem = b.path.length === 1 ? tipoDoCampo(origem?.outputJsonSchema, b.path[0]) : null
      const tipoDestino = tipoDoCampo(membro.inputJsonSchema, campo)
      if (tipoOrigem && tipoDestino && tipoOrigem !== tipoDestino)
        diga('incompatible_output', `${campo}: "${b.stepId}" produz ${tipoOrigem}, e aqui é ${tipoDestino}`, campo)
    }

    /**
     * O campo obrigatório sem origem — o defeito que este arquivo existe para pegar.
     *
     * Uma etapa que precisa de um dado que nenhuma etapa anterior produz e que o pedido não
     * traz roda mesmo assim: o agente lê a prosa, não acha o número, e escreve um plausível.
     * A resposta sai completa, com aparência de fundamentada, e errada. Aqui ela vira uma
     * frase dizendo qual campo falta.
     */
    for (const campo of requiredFields(membro.inputJsonSchema)) {
      if (task.inputBindings && campo in task.inputBindings) continue
      // Tarefa legada não declara binding nenhum: a entrada dela é o texto do antecessor, e
      // cobrar contrato de quem foi planejado antes de o contrato existir seria quebrar o
      // que já roda. Só cobra quem declarou bindings, ou quem não tem de quem herdar texto.
      if (!task.inputBindings && (task.dependsOn ?? []).length > 0) continue
      diga('missing_input', `${membro.name} exige "${campo}", e nada no plano produz esse campo`, campo)
      unmet.push({ taskId: task.id, agentId: task.agentId, field: campo })
    }
  }

  // Os ciclos, olhando o grafo inteiro. As duas checagens acima já barram o caso comum
  // (dependência para a frente), mas um plano montado à mão pode chegar aqui de outro jeito.
  const restantes = new Map(plan.tasks.map((t) => [t.id, new Set((t.dependsOn ?? []).filter((d) => posicao.has(d)))]))
  let mudou = true
  while (mudou) {
    mudou = false
    for (const [id, deps] of restantes) {
      if (deps.size > 0) continue
      restantes.delete(id)
      for (const outras of restantes.values()) outras.delete(id)
      mudou = true
    }
  }
  if (restantes.size > 0)
    diagnostics.push({ code: 'cycle', message: `dependência circular entre: ${[...restantes.keys()].join(', ')}` })

  return { ok: diagnostics.length === 0, plan, diagnostics, unmet }
}

/** O diagnóstico em uma linha — para o log e para a mensagem de quem administra. */
export const describeDiagnostics = (ds: PlanDiagnostic[]): string =>
  ds.map((d) => `${d.code}${d.taskId ? `@${d.taskId}` : ''}: ${d.message}`).join('; ')

/**
 * A pergunta que se faz quando o dado não existe em lugar nenhum.
 *
 * A quarta saída — preencher com um valor plausível — é a que este projeto não tem.
 */
export function clarificationFor(unmet: CompiledPlan['unmet']): string {
  const campos = [...new Set(unmet.map((u) => u.field))]
  if (campos.length === 0) return ''
  return `Para seguir, falta ${campos.length === 1 ? 'um dado' : 'um dado ou mais'} que ninguém da equipe produz: ${campos.join(', ')}.`
}

/**
 * O fornecedor que faltava.
 *
 * Antes de perguntar, procura: existe no setor alguém que DECLARA produzir o campo que
 * falta e que ainda não está no plano? Se existe, ele entra antes de quem precisa do campo.
 * Se não existe, devolve nulo — e quem chamou pergunta ou falha com o diagnóstico.
 */
export function supplyMissing(
  plan: ExecutionPlan,
  membros: PlannerMember[],
  unmet: CompiledPlan['unmet'],
  max = MAX_TASKS,
): ExecutionPlan | null {
  if (unmet.length === 0) return null
  const noPlano = new Set(plan.tasks.map((t) => t.agentId))
  const fornecedores: ExecutionTask[] = []
  const porCampo = new Map<string, string>()

  for (const falta of unmet) {
    if (porCampo.has(falta.field)) continue
    // Um fornecedor já convocado costuma entregar mais de um campo — e convocar outro para
    // o segundo campo do mesmo cadastro é pagar duas inferências pela mesma consulta.
    const jaConvocado = fornecedores.find((f) =>
      schemaFields(membros.find((m) => m.agentId === f.agentId)?.outputJsonSchema).includes(falta.field),
    )
    if (jaConvocado) {
      porCampo.set(falta.field, jaConvocado.id)
      continue
    }
    const quem = membros.find(
      (m) => !noPlano.has(m.agentId) && (m.type ?? 'executor') !== 'coordinator' && schemaFields(m.outputJsonSchema).includes(falta.field),
    )
    if (!quem) return null
    noPlano.add(quem.agentId)
    const id = `p${fornecedores.length + 1}`
    fornecedores.push({
      id,
      agentId: quem.agentId,
      objective: `Levantar ${falta.field} para a equipe.`,
      ...(quem.outputJsonSchema ? { expectedOutputSchema: quem.outputJsonSchema, outputSchemaHash: schemaHash(quem.outputJsonSchema) } : {}),
    })
    porCampo.set(falta.field, id)
  }
  // Teto é teto: um plano que cresce para se consertar deixa de ser o plano que o dono
  // autorizou pagar. Sem espaço, é melhor perguntar.
  if (fornecedores.length + plan.tasks.length > max) return null

  const tasks = plan.tasks.map((t) => {
    const meus = unmet.filter((u) => u.taskId === t.id && porCampo.has(u.field))
    if (meus.length === 0) return t
    const bindings: Record<string, Binding> = { ...(t.inputBindings ?? {}) }
    const deps = new Set(t.dependsOn ?? [])
    for (const u of meus) {
      const fonte = porCampo.get(u.field)!
      bindings[u.field] = { from: 'step', stepId: fonte, path: [u.field] }
      deps.add(fonte)
    }
    return { ...t, inputBindings: bindings, dependsOn: [...deps] }
  })
  // Os fornecedores vão na FRENTE: dependência só aponta para trás, e essa é a única
  // ordem em que a regra continua verdadeira.
  return { ...plan, tasks: [...fornecedores, ...tasks] }
}

// --- planos antigos ---------------------------------------------------------------------

/** Sem bindings declarados: a entrada é o texto dos antecessores, como sempre foi. */
export const isLegacyTask = (t: ExecutionTask): boolean => t.inputBindings === undefined

/**
 * Um plano gravado antes desta fase, lido de volta.
 *
 * Ele continua válido e continua rodando: nenhum campo novo é obrigatório, e um plano sem
 * nenhum deles é exatamente o plano de antes. O adaptador existe para que um registro
 * antigo passe por `compilePlan` sem virar erro por não falar a língua nova.
 */
export function adaptLegacyPlan(bruto: unknown): ExecutionPlan {
  const cru = (bruto ?? {}) as { tasks?: unknown; synthesisObjective?: unknown }
  const tasks: ExecutionTask[] = []
  for (const item of (Array.isArray(cru.tasks) ? cru.tasks : []) as Record<string, unknown>[]) {
    const agentId = texto(item?.agentId)
    if (!agentId) continue
    const id = texto(item?.id) || `t${tasks.length + 1}`
    const deps = Array.isArray(item?.dependsOn) ? (item.dependsOn as unknown[]).map(texto).filter(Boolean) : []
    tasks.push({
      id,
      agentId,
      objective: texto(item?.objective),
      ...(deps.length > 0 ? { dependsOn: deps } : {}),
      // Sem `inputBindings`, de propósito: é o que a marca como legada.
    })
  }
  const sintese = texto(cru.synthesisObjective)
  return { tasks, ...(sintese ? { synthesisObjective: sintese } : {}) }
}

// --- o pedido ao modelo --------------------------------------------------------------------

export function planPrompt(pergunta: string, membros: PlannerMember[], max = MAX_TASKS, contextFields?: string[]): string {
  const comContrato = membros.some((m) => schemaFields(m.inputJsonSchema).length > 0)
  return [
    'Você distribui UM pedido entre os membros de uma equipe. Não responda ao pedido.',
    '',
    'Membros disponíveis:',
    ...membros.map((m) => `- id: ${m.agentId} | ${describeMember(m)}`),
    '',
    `Pedido: ${trecho(pergunta, 1500)}`,
    ...(contextFields && contextFields.length > 0 ? ['', `Campos que o pedido traz: ${contextFields.slice(0, 24).join(', ')}`] : []),
    '',
    'Regras:',
    `- Escolha de 1 a ${max} membros. O objetivo é COBERTURA, não chamar todos.`,
    // A regra que mudou nesta fase: escolher por CAPACIDADE, não por rótulo. Um nome bonito
    // casa com qualquer pedido e não diz nada sobre o que o agente consegue entregar.
    '- Escolha por CAPACIDADE e por CONTRATO: o que ele sabe fazer, as ferramentas dele e os campos que ele aceita e produz. O NOME é o último critério, não o primeiro.',
    '- Um membro que não tem nada a ver com o pedido fica de fora.',
    '- Dois membros que fariam a mesma coisa: escolha um.',
    '- Se um membro precisa do resultado de outro, declare em dependsOn.',
    '- Quem ANALISA trabalha sobre o que recebe: acione um [analyst] apenas com dependsOn apontando para quem coleta.',
    '- Quem CONDUZ ([coordinator]) não é pesquisador: ele consolida no fim, e não entra como tarefa.',
    '- Cada objective descreve só a parte daquele membro, na língua do pedido.',
    ...(comContrato
      ? [
          '',
          'Entradas (inputBindings) — quem tem entrada:{...} recebe CAMPOS, não a pergunta:',
          '- Cada campo tem UMA origem: "$context.campo" (o pedido), "$steps.<id>.campo" (etapa anterior) ou um valor JSON literal.',
          '- Os campos marcados com * são obrigatórios: declare a origem de todos.',
          '- Só aponte para um campo que a etapa de origem realmente produz (veja "saída:{...}") e declare essa etapa em dependsOn.',
          '- Se um campo obrigatório não existe no pedido nem na saída de ninguém, NÃO INVENTE: inclua antes um membro que produza esse campo, ou deixe o campo de fora.',
          '- Nada de expressão, fórmula, filtro ou código: só nome de campo.',
        ]
      : []),
    '',
    'Responda SOMENTE com JSON neste formato, sem cercas de código:',
    '{"tasks":[{"id":"t1","agentId":"<id>","objective":"<o que ele entrega>","dependsOn":[],"inputBindings":{},"onFailure":"skip"}],"synthesisObjective":"<como juntar>"}',
    'onFailure: "skip" (o resto continua), "stop" (o plano para) ou "replan" (vale replanejar).',
  ].join('\n')
}

/** Extrai o JSON de uma resposta que pode vir com cercas ou texto em volta. */
export function parsePlanJson(saida: string): unknown {
  const limpo = saida.replace(/```json/gi, '').replace(/```/g, '').trim()
  const inicio = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (inicio < 0 || fim <= inicio) return null
  try {
    return JSON.parse(limpo.slice(inicio, fim + 1))
  } catch {
    return null
  }
}

/**
 * O plano desta pergunta.
 *
 * `ask` é injetado: este módulo não conhece provedor nenhum, e sem `ask` o plano é o
 * determinístico — o que mantém setores antigos funcionando em qualquer instalação.
 * Falha do modelo NUNCA derruba a execução: cair para o determinístico é pior que o
 * ideal e melhor que não responder.
 */
export interface PlanOutcome {
  plan: ExecutionPlan
  source: 'model' | 'fallback' | 'empty'
  /** O que a compilação apontou. Vazio quando o plano está de pé. */
  diagnostics?: PlanDiagnostic[]
  /** O que perguntar a quem pediu, quando o dado não existe em lugar nenhum. */
  clarification?: string
}

export async function planExecution(opts: {
  question: string
  members: PlannerMember[]
  ask?: (prompt: string) => Promise<string>
  max?: number
  /** Os campos que o pedido traz. Ausente = quem chamou não sabe enumerá-los. */
  contextFields?: string[]
  functionExists?: CompileOptions['functionExists']
}): Promise<PlanOutcome> {
  const max = opts.max ?? MAX_TASKS
  if (opts.members.length === 0) return { plan: { tasks: [] }, source: 'empty' }

  const compilar = (plan: ExecutionPlan) =>
    compilePlan(plan, opts.members, { contextFields: opts.contextFields, functionExists: opts.functionExists })

  /**
   * O plano depois da compilação — consertado, esclarecido ou recusado, nesta ordem.
   *
   * A quarta possibilidade, que é a que se quer evitar, seria seguir com o campo faltando e
   * deixar o agente completá-lo: a resposta sairia inteira, com aparência de fundamentada, e
   * sem ninguém saber de onde veio o número.
   */
  const conferir = (plan: ExecutionPlan, source: PlanOutcome['source']): PlanOutcome => {
    const compilado = compilar(plan)
    if (compilado.ok) return { plan: compilado.plan, source }
    if (compilado.unmet.length > 0) {
      // 1. alguém do setor produz o que falta? Ele entra antes de quem precisa.
      const reforcado = supplyMissing(plan, opts.members, compilado.unmet, max)
      if (reforcado) {
        const segunda = compilar(reforcado)
        if (segunda.ok) return { plan: segunda.plan, source }
      }
      // 2. ninguém produz: pergunta, em vez de inventar.
      return {
        plan: compilado.plan,
        source,
        diagnostics: compilado.diagnostics,
        clarification: clarificationFor(compilado.unmet),
      }
    }
    // 3. o resto (ciclo, referência inválida, capacidade errada) sai com o diagnóstico. O
    // plano continua junto: quem chamou decide entre executar o que sobrou e desistir.
    return { plan: compilado.plan, source, diagnostics: compilado.diagnostics }
  }

  if (!opts.ask) return conferir(fallbackPlan(opts.question, opts.members, max, { contextFields: opts.contextFields }), 'fallback')
  try {
    const saida = await opts.ask(planPrompt(opts.question, opts.members, max, opts.contextFields))
    const bruto = parsePlanJson(saida)
    if (!bruto) return conferir(fallbackPlan(opts.question, opts.members, max, { contextFields: opts.contextFields }), 'fallback')
    return conferir(validatePlan(bruto, opts.members, opts.question, max), 'model')
  } catch {
    return conferir(fallbackPlan(opts.question, opts.members, max, { contextFields: opts.contextFields }), 'fallback')
  }
}

/**
 * O plano em uma linha de log.
 *
 * Nomes, ids e o começo do objetivo — nada de credencial, prompt de sistema ou conteúdo
 * de base. O objetivo é cortado porque ele carrega texto de quem perguntou.
 */
export function describePlan(plan: ExecutionPlan, membros: PlannerMember[]): string {
  const nome = new Map(membros.map((m) => [m.agentId, m.name]))
  const partes = plan.tasks.map(
    (t) =>
      `${t.id}=${nome.get(t.agentId) ?? '?'}(${t.agentId})` +
      `${t.dependsOn?.length ? ` after:${t.dependsOn.join(',')}` : ''}` +
      // As ORIGENS, nunca os valores: o log diz de onde o campo vem, e quem lê o log não
      // fica sabendo o que estava escrito nele.
      `${t.inputBindings ? ` in:{${Object.entries(t.inputBindings).map(([k, b]) => `${k}=${b.from === 'literal' ? 'literal' : describeBinding(b)}`).join(',')}}` : ''}` +
      `${t.onFailure && t.onFailure !== 'skip' ? ` onFailure:${t.onFailure}` : ''}` +
      ` "${trecho(t.objective, 120)}"`,
  )
  return partes.join(' | ') || '(sem tarefas)'
}

// --- a execução do plano: ondas, e o que fazer com o que falhou ----------------------------

/** O que aconteceu com uma tarefa. `skipped` é diferente de `failed`: ela nem tentou. */
export interface TaskResult {
  taskId: string
  agentId: string
  agentName: string
  objective: string
  dependsOn: string[]
  status: 'succeeded' | 'failed' | 'skipped'
  output?: string
  /** O DADO que a etapa produziu, quando ela produz dado. É o que os bindings leem. */
  structured?: unknown
  /** A CATEGORIA do problema, nunca o texto do provedor nem conteúdo de base. */
  error?: string
  durationMs: number
}

/**
 * As tarefas que podem rodar AGORA: as que ainda não rodaram e cujas dependências já
 * terminaram — de qualquer jeito, inclusive mal.
 *
 * É a única regra de ordem que existe aqui. `validatePlan` já garante que uma dependência
 * sempre aponta para trás, então uma onda vazia com tarefas pendentes é impossível na
 * prática; o runtime confere assim mesmo, porque um laço infinito num executor de agentes
 * custa dinheiro de verdade.
 */
export function readyTasks(plan: ExecutionPlan, concluidas: Set<string>): ExecutionTask[] {
  return plan.tasks.filter((t) => !concluidas.has(t.id) && (t.dependsOn ?? []).every((d) => concluidas.has(d)))
}

/**
 * Vale a pena rodar esta tarefa, visto o que aconteceu com as dependências dela?
 *
 * Se TODAS falharam, ela roda sem a entrada de que precisava — e uma tarefa sem entrada
 * inventa ou repete a pergunta. Se ao menos uma deu certo, roda com o que existe: meia
 * entrada costuma valer mais que nenhuma resposta.
 */
export function shouldRun(task: ExecutionTask, resultados: Map<string, TaskResult>): boolean {
  const deps = task.dependsOn ?? []
  if (deps.length === 0) return true
  return deps.some((d) => resultados.get(d)?.status === 'succeeded')
}

/**
 * O que cada etapa produziu, endereçável por `$steps.<id>.campo`.
 *
 * Quando o agente devolve dado, é o dado. Quando devolve prosa, ainda dá para ler o JSON
 * que ele escreveu no meio do texto — e, na pior das hipóteses, `$steps.<id>.text`.
 */
export function stepOutputs(resultados: Map<string, TaskResult>): Record<string, unknown> {
  const fontes: Record<string, unknown> = {}
  for (const [id, r] of resultados) {
    if (r.status !== 'succeeded') continue
    const dado = r.structured ?? (r.output ? parsePlanJson(r.output) : null)
    fontes[id] = dado && typeof dado === 'object' && !Array.isArray(dado) ? { text: r.output ?? '', ...(dado as object) } : { text: r.output ?? '' }
  }
  return fontes
}

/**
 * A entrada desta tarefa: os campos que o plano declarou, e o texto de quem veio antes.
 *
 * `missing` é o ponto do arquivo inteiro. Um campo declarado em `inputBindings` é um campo
 * que a tarefa PRECISA — e se ele não chegou, rodar assim mesmo significa entregar a prosa
 * ao agente e deixá-lo deduzir o número. Quem chama decide o que fazer; o que não existe é
 * a opção de preencher.
 */
export function inputForTask(
  task: ExecutionTask,
  resultados: Map<string, TaskResult>,
  /** O contexto do PEDIDO — é o que faz `$context.campo` valer em execução. */
  contexto?: Record<string, unknown>,
): { text: string; input?: Record<string, unknown>; missing: string[] } {
  // Tarefa LEGADA: a entrada é o texto dos antecessores, com autoria, exatamente como
  // sempre foi. É o adaptador, e ele fica.
  if (isLegacyTask(task)) return { text: inputFromDependencies(task, resultados), missing: [] }
  /**
   * Tarefa NOVA: só os campos declarados.
   *
   * Anexar também a prosa do antecessor desfaz o que o plano acabou de decidir. O agente
   * recebe o campo `faturamento: 120000` E o parágrafo onde o número aparece com outro
   * contexto — e passa a escolher entre os dois, no meio da inferência, sem que ninguém
   * saiba qual ele escolheu. Um campo tem uma origem só; é essa a ideia inteira.
   */
  const { input, missing } = resolveBindings(task.inputBindings, { context: contexto, steps: stepOutputs(resultados) })
  const campos = Object.entries(input).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
  return { text: campos.join('\n'), input, missing }
}

/** A tarefa que, ao falhar, derruba o plano inteiro. Nula quando não houve nenhuma. */
export function haltingFailure(plan: ExecutionPlan, resultados: Map<string, TaskResult>): ExecutionTask | null {
  return plan.tasks.find((t) => t.onFailure === 'stop' && resultados.get(t.id)?.status === 'failed') ?? null
}

/** Alguma falha pediu explicitamente por um replanejamento. */
export function wantsReplan(plan: ExecutionPlan, resultados: Map<string, TaskResult>): boolean {
  return plan.tasks.some((t) => t.onFailure === 'replan' && resultados.get(t.id)?.status !== 'succeeded')
}

/** A etapa que encerra o plano ao dar certo — um portão que decide que já basta. */
export function stopsAfterSuccess(plan: ExecutionPlan, resultados: Map<string, TaskResult>): boolean {
  return plan.tasks.some((t) => t.onSuccess === 'stop' && resultados.get(t.id)?.status === 'succeeded')
}

/** A entrada de uma tarefa dependente: o que os antecessores produziram, com autoria. */
export function inputFromDependencies(task: ExecutionTask, resultados: Map<string, TaskResult>): string {
  const partes = (task.dependsOn ?? [])
    .map((d) => resultados.get(d))
    .filter((r): r is TaskResult => Boolean(r) && r!.status === 'succeeded' && Boolean(r!.output))
    .map((r) => `[${r.agentName}] objetivo: ${trecho(r.objective, 200)}\n${r.output}`)
  return partes.join('\n\n')
}

// --- a síntese ------------------------------------------------------------------------------

const INSTRUCOES_DE_SINTESE = [
  'SYNTHESIS INSTRUCTIONS',
  '- Responda à PERGUNTA ORIGINAL usando os resultados acima, e só eles.',
  '- CRUZE o que veio de agentes diferentes: relações, causas, e o que um explica no outro.',
  '- Se dois resultados se contradizem, diga que se contradizem e mostre os dois — não escolha em silêncio.',
  '- Não repita o último resultado como se fosse a resposta: a resposta é o conjunto.',
  '- O que ninguém entregou, ninguém sabe: não preencha lacuna com suposição. Diga o que faltou e por quê.',
  '- Não cite ids de tarefa nem nomes internos de sistema; fale das FONTES pelo nome do agente quando for útil.',
].join('\n')

/**
 * O contexto da síntese, em blocos que não se confundem.
 *
 * Um bloco por coisa — pergunta, plano, resultado de cada agente — porque a falha que
 * este passo existe para evitar é justamente misturar: pegar o número de um agente e
 * atribuí-lo ao assunto de outro. O rótulo `[Nome]` antes de cada resultado é o que
 * torna a atribuição verificável por quem lê a resposta depois.
 *
 * Uma falha aparece como falha, com a categoria. Esconder que um agente não respondeu
 * faria a síntese parecer completa quando não é.
 */
export function buildSynthesisContext(question: string, plan: ExecutionPlan, resultados: TaskResult[]): string {
  const linhaDoPlano = plan.tasks
    .map((t) => {
      const r = resultados.find((x) => x.taskId === t.id)
      const espera = t.dependsOn?.length ? ` (depois de ${t.dependsOn.join(', ')})` : ''
      return `- ${t.id}: ${r?.agentName ?? t.agentId}${espera} → ${trecho(t.objective, 200)}`
    })
    .join('\n')

  const blocos = resultados.map((r) => {
    const cabeca = `[${r.agentName}]\nobjective: ${trecho(r.objective, 300)}`
    /**
     * A síntese é o ponto em que o dado PRECISA ser apresentado a uma pessoa.
     *
     * Uma etapa `structured` não produz texto — de propósito, para não virar prosa na
     * entrada da etapa seguinte. Mas aqui, no fim, esconder o dado faria a consolidação
     * relatar uma etapa que "não devolveu nada" logo depois de ela ter devolvido o número
     * que responde à pergunta.
     */
    if (r.status === 'succeeded') {
      const dado = r.structured !== undefined ? JSON.stringify(r.structured) : ''
      return `${cabeca}\nresult:\n${[dado, r.output ?? ''].filter(Boolean).join('\n')}`
    }
    if (r.status === 'skipped') return `${cabeca}\nresult: NÃO EXECUTADO — dependia de uma tarefa que falhou.`
    return `${cabeca}\nresult: FALHOU (${r.error ?? 'motivo não registrado'}). Não há resultado deste agente.`
  })

  return [
    'ORIGINAL USER QUESTION',
    trecho(question, 2000),
    '',
    'EXECUTION PLAN',
    linhaDoPlano || '(sem tarefas)',
    '',
    'AGENT RESULTS',
    blocos.join('\n\n') || '(nenhum agente executou)',
    '',
    INSTRUCOES_DE_SINTESE,
  ].join('\n')
}

/** A instrução curta que acompanha o contexto — o pedido, não os dados. */
export function synthesisInstruction(plan: ExecutionPlan): string {
  return [
    'Junte os resultados da equipe numa resposta só, para quem perguntou.',
    plan.synthesisObjective ? `Objetivo da consolidação: ${trecho(plan.synthesisObjective, 300)}` : '',
    'Os dados estão na entrada, separados por agente. Não invente o que não estiver lá.',
  ]
    .filter(Boolean)
    .join('\n')
}

// --- limites -------------------------------------------------------------------------------
//
// Todos pequenos, e todos pelo mesmo motivo: cada rodada é um plano novo, cada tarefa é
// uma inferência inteira com a base e as ferramentas de um agente, e um motor que decide
// sozinho quando parar precisa de um lugar onde a decisão não seja dele.

/** Quantas vezes o setor pode replanejar. Dois: a tentativa, e a chance de completar. */
export const MAX_ORCHESTRATION_ROUNDS = 2
/** Teto de execuções somando TODAS as rodadas — o de `MAX_TASKS` é por rodada. */
export const MAX_TASKS_TOTAL = 6
/** O relógio da orquestração inteira. Cada tarefa já tem o seu; este é o do conjunto. */
export const ORCHESTRATION_TIMEOUT_MS = 240_000

/**
 * A identidade de uma tarefa para efeito de repetição: agente + objetivo.
 *
 * O mesmo agente com o mesmo objetivo numa segunda rodada é a mesma pergunta feita duas
 * vezes — custa igual e responde igual. Com objetivo diferente, não: pedir outra coisa
 * ao mesmo especialista é trabalho novo.
 */
export const taskKey = (agentId: string, objective: string): string =>
  `${agentId}|${normalize(objective).replace(/\s+/g, ' ').trim().slice(0, 200)}`

/** Tira do plano o que já foi feito e o que passaria do teto total. */
export function dedupeAgainst(plan: ExecutionPlan, jaFeitas: Set<string>, restante: number): ExecutionPlan {
  const tasks: ExecutionTask[] = []
  for (const t of plan.tasks) {
    if (tasks.length >= restante) break
    if (jaFeitas.has(taskKey(t.agentId, t.objective))) continue
    tasks.push(t)
  }
  // As dependências que sobraram apontando para tarefa removida deixam de existir: a
  // tarefa roda com o pedido original em vez de esperar por algo que não vem.
  /**
   * Um binding órfão é outra história.
   *
   * Perder uma dependência textual custa contexto; perder a ORIGEM de um campo declarado
   * custa o campo — e a tarefa rodaria pedindo ao agente que deduzisse o que a etapa
   * removida ia entregar. Quem ficou sem origem sai do plano junto.
   */
  let inteiras = tasks
  for (let antes = -1; antes !== inteiras.length; ) {
    antes = inteiras.length
    const vivos = new Set(inteiras.map((t) => t.id))
    // Em ponto fixo: quem some leva junto quem lia dele, e quem lia desse último também.
    inteiras = inteiras.filter((t) => Object.values(t.inputBindings ?? {}).every((b) => b.from !== 'step' || vivos.has(b.stepId)))
  }
  return {
    ...plan,
    tasks: inteiras.map((t) => {
      const dep = (t.dependsOn ?? []).filter((d) => inteiras.some((x) => x.id === d))
      if (dep.length > 0) return { ...t, dependsOn: dep }
      const { dependsOn: _fora, ...resto } = t
      return resto
    }),
  }
}

// --- suficiência ----------------------------------------------------------------------------

export interface Sufficiency {
  sufficient: boolean
  /** O que ficou faltando, na língua da pergunta. Vira o pedido da rodada seguinte. */
  missing?: string
}

/**
 * A pergunta que decide se vale uma segunda rodada.
 *
 * Curta de propósito: é uma decisão de sim/não sobre um texto que já existe, e pagar o
 * modelo principal por ela seria caro sem ser melhor. E ela só é feita quando existe
 * alguém ainda não consultado — sem especialista sobrando, a resposta não mudaria.
 */
export function sufficiencyPrompt(question: string, answer: string, naoConsultados: PlannerMember[]): string {
  return [
    'Avalie se a RESPOSTA abaixo já responde à PERGUNTA. Não reescreva a resposta.',
    '',
    `PERGUNTA: ${trecho(question, 1000)}`,
    '',
    `RESPOSTA OBTIDA: ${trecho(answer, 3000)}`,
    '',
    'Ainda não foram consultados:',
    ...naoConsultados.map((m) => `- ${m.name}: ${describeMember(m)}`),
    '',
    'Se a resposta já cobre a pergunta, diga que é suficiente. Só peça mais quando ALGUÉM',
    'da lista acima puder cobrir o que falta — se ninguém puder, é suficiente assim mesmo.',
    '',
    'Responda SOMENTE com JSON: {"sufficient":true} ou {"sufficient":false,"missing":"<o que falta>"}',
  ].join('\n')
}

export function parseSufficiency(saida: string): Sufficiency {
  const bruto = parsePlanJson(saida) as { sufficient?: unknown; missing?: unknown } | null
  // Sem resposta legível, considera suficiente: uma rodada extra por causa de um parse
  // ruim custa uma equipe inteira de inferências.
  if (!bruto || typeof bruto.sufficient !== 'boolean') return { sufficient: true }
  const missing = typeof bruto.missing === 'string' ? bruto.missing.trim().slice(0, 400) : ''
  return bruto.sufficient ? { sufficient: true } : { sufficient: false, ...(missing ? { missing } : {}) }
}

/**
 * A frase que a resposta final ganha quando a informação não chegou.
 *
 * Existe porque o silêncio aqui é uma mentira por omissão: uma resposta parcial
 * apresentada como completa é pior que uma resposta que diz onde parou.
 */
export function limitationNote(missing: string | undefined, rounds: number): string {
  return [
    `Depois de ${rounds} rodada(s) de consulta à equipe, ainda falta informação para responder por completo.`,
    missing ? `Especificamente: ${trecho(missing, 300)}.` : '',
    'Responda com o que foi obtido e diga claramente, ao final, o que não foi possível apurar. Não preencha a lacuna com suposição.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * A resposta de emergência: os resultados, sem modelo nenhum.
 *
 * Se a consolidação falhar — provedor fora do ar, orçamento estourado — houve trabalho
 * de verdade e jogá-lo fora seria o pior desfecho possível. Isto não é uma síntese: é o
 * que cada agente respondeu, com o nome de quem respondeu, e a frase que diz que a
 * junção não pôde ser feita.
 */
export function assembleWithoutModel(resultados: TaskResult[]): string {
  const ok = resultados.filter((r) => r.status === 'succeeded' && (r.output || r.structured !== undefined))
  if (ok.length === 0) return ''
  return [
    ...ok.map((r) => `**${r.agentName}**\n${r.output || JSON.stringify(r.structured)}`),
    '',
    '_(Não foi possível consolidar as respostas automaticamente; acima está o que cada agente respondeu.)_',
  ].join('\n\n')
}
