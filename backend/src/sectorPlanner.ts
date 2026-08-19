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
  const notas = membros.map((m) => ({ m, nota: memberScore(pergunta, m) }))
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
