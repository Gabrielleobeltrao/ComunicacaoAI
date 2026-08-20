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
import { normalize } from './lexicalRetrieval.js'

/** Uma execução de agente dentro do plano. */
export interface ExecutionTask {
  /** Identificador dentro do plano (t1, t2…) — é por ele que `dependsOn` aponta. */
  id: string
  agentId: string
  /** O que ESTE agente precisa entregar. Nunca a pergunta inteira copiada, quando dá. */
  objective: string
  /** As tarefas cujo resultado entra como entrada desta. Vazio = roda com o pedido. */
  dependsOn?: string[]
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
  /** Títulos dos documentos da base dele. Nunca o conteúdo. */
  knowledgeTitles?: string[] | null
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
  return [
    m.name,
    m.type ? `[${m.type}]` : '',
    trecho(m.routingDescription, 200),
    trecho(m.role, 160),
    trecho(m.objective, 200),
    trecho(m.instructions, 160),
    listaCurta(m.capabilities),
    listaCurta(m.tools),
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
 * Conta quantas palavras da PERGUNTA aparecem no perfil dele. Bruto de propósito: a
 * decisão fina é do modelo; isto só precisa separar quem tem alguma relação de quem não
 * tem nenhuma.
 */
export function memberScore(pergunta: string, m: PlannerMember): number {
  const alvo = normalize(describeMember(m))
  const palavras = [...new Set(palavrasDe(pergunta))]
  if (palavras.length === 0) return 0
  const casadas = palavras.filter((p) => alvo.includes(p)).length
  return casadas / palavras.length
}

/**
 * O plano sem modelo: os membros que a pergunta menciona, ou o mais próximo.
 *
 * Nunca devolve vazio com equipe presente — um plano vazio faria o coordenador
 * responder sozinho, que é exatamente o que se quer evitar.
 */
export function fallbackPlan(pergunta: string, membros: PlannerMember[], max = MAX_TASKS): ExecutionPlan {
  if (membros.length === 0) return { tasks: [] }
  // Sem modelo, quem coleta vem primeiro: um analista sozinho não teria o que analisar.
  const coleta = membros.filter((m) => (m.type ?? 'executor') !== 'analyst')
  const candidatos = coleta.length > 0 ? coleta : membros
  const notas = candidatos.map((m) => ({ m, nota: memberScore(pergunta, m) }))
  const relevantes = notas.filter((n) => n.nota > 0).sort((a, b) => b.nota - a.nota)
  // Ninguém casou: manda para um só, e não para todos. Chutar largo custa N inferências.
  const escolhidos = relevantes.length > 0 ? relevantes.slice(0, max) : [notas[0]]
  return {
    tasks: escolhidos.map(({ m }, i) => ({ id: `t${i + 1}`, agentId: m.agentId, objective: pergunta })),
  }
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
    // Um agente por plano nesta etapa: duas tarefas para o mesmo agente são, quase
    // sempre, a mesma pergunta escrita duas vezes — e custam duas inferências.
    if (porAgente.has(agentId)) continue
    porAgente.add(agentId)
    const id = `t${tarefas.length + 1}`
    const original = texto(item?.id)
    if (original) idsOriginais.set(original, id)
    tarefas.push({
      id,
      agentId,
      // Sem objetivo próprio, o pedido original é melhor que uma tarefa vazia.
      objective: texto(item?.objective).slice(0, 600) || pergunta,
      dependsOn: Array.isArray(item?.dependsOn) ? (item.dependsOn as unknown[]).map(texto).filter(Boolean) : [],
    })
  }

  // As dependências só valem depois que todos os ids existem — e só para trás: uma tarefa
  // que espera por outra que roda depois dela é um ciclo escrito de outro jeito.
  const posicao = new Map(tarefas.map((t, i) => [t.id, i]))
  for (const [i, tarefa] of tarefas.entries()) {
    const resolvidas = (tarefa.dependsOn ?? [])
      .map((d) => idsOriginais.get(d) ?? d)
      .filter((d) => posicao.has(d) && posicao.get(d)! < i)
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

// --- o pedido ao modelo --------------------------------------------------------------------

export function planPrompt(pergunta: string, membros: PlannerMember[], max = MAX_TASKS): string {
  return [
    'Você distribui UM pedido entre os membros de uma equipe. Não responda ao pedido.',
    '',
    'Membros disponíveis:',
    ...membros.map((m) => `- id: ${m.agentId} | ${describeMember(m)}`),
    '',
    `Pedido: ${trecho(pergunta, 1500)}`,
    '',
    'Regras:',
    `- Escolha de 1 a ${max} membros. O objetivo é COBERTURA, não chamar todos.`,
    '- Um membro que não tem nada a ver com o pedido fica de fora.',
    '- Dois membros que fariam a mesma coisa: escolha um.',
    '- Se um membro precisa do resultado de outro, declare em dependsOn.',
    '- Quem ANALISA trabalha sobre o que recebe: acione um [analyst] apenas com dependsOn apontando para quem coleta.',
    '- Quem CONDUZ ([coordinator]) não é pesquisador: ele consolida no fim, e não entra como tarefa.',
    '- Cada objective descreve só a parte daquele membro, na língua do pedido.',
    '',
    'Responda SOMENTE com JSON neste formato, sem cercas de código:',
    '{"tasks":[{"id":"t1","agentId":"<id>","objective":"<o que ele entrega>","dependsOn":[]}],"synthesisObjective":"<como juntar>"}',
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
export async function planExecution(opts: {
  question: string
  members: PlannerMember[]
  ask?: (prompt: string) => Promise<string>
  max?: number
}): Promise<{ plan: ExecutionPlan; source: 'model' | 'fallback' | 'empty' }> {
  const max = opts.max ?? MAX_TASKS
  if (opts.members.length === 0) return { plan: { tasks: [] }, source: 'empty' }
  if (!opts.ask) return { plan: fallbackPlan(opts.question, opts.members, max), source: 'fallback' }
  try {
    const saida = await opts.ask(planPrompt(opts.question, opts.members, max))
    const bruto = parsePlanJson(saida)
    if (!bruto) return { plan: fallbackPlan(opts.question, opts.members, max), source: 'fallback' }
    return { plan: validatePlan(bruto, opts.members, opts.question, max), source: 'model' }
  } catch {
    return { plan: fallbackPlan(opts.question, opts.members, max), source: 'fallback' }
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
    if (r.status === 'succeeded') return `${cabeca}\nresult:\n${r.output ?? ''}`
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
  const ids = new Set(tasks.map((t) => t.id))
  return {
    ...plan,
    tasks: tasks.map((t) => {
      const dep = (t.dependsOn ?? []).filter((d) => ids.has(d))
      return dep.length > 0 ? { ...t, dependsOn: dep } : { id: t.id, agentId: t.agentId, objective: t.objective }
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
  const ok = resultados.filter((r) => r.status === 'succeeded' && r.output)
  if (ok.length === 0) return ''
  return [
    ...ok.map((r) => `**${r.agentName}**\n${r.output}`),
    '',
    '_(Não foi possível consolidar as respostas automaticamente; acima está o que cada agente respondeu.)_',
  ].join('\n\n')
}
