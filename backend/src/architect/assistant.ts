import { ObjectId } from 'mongodb'
import { clarifyingQuestion, noCurrentSource, parseIntent, policyFor, suggestIntent } from './intent.js'
import type { ArchitectIntent } from './intent.js'
import { loadOfficeInventory, summarizeInventory } from './inventory.js'
import type { OfficeInventorySummary } from './inventory.js'
import { maskSecretsDeep } from './secrets.js'

// O ASSISTENTE GLOBAL — uma rodada de conversa que pode NÃO virar projeto.
//
// O Arquiteto V1 tem uma entrada só: toda mensagem entra num projeto e produz desenho. Quem
// pergunta "qual o valor do dólar hoje?" recebe uma proposta de operação, e um projeto que
// ninguém pediu fica no histórico da conta para sempre.
//
// Aqui a mensagem passa antes pelo roteador de intenção, e o MODO decide o que acontece:
//
//   answer   → responde. Não cria nada. Se a pergunta é sobre o agora, exige fonte real.
//   explain  → explica o que existe, lendo o inventário. Não cria nada.
//   propose  → é o único que cria ou reabre projeto.
//   operate  → leitura autorizada executa; escrita exige confirmação.
//
// O que atravessa o arquivo: o CONTEXTO da tela é uma referência, não conteúdo. O cliente
// manda "estou no andar X"; o servidor reconfirma que X é desta conta antes de usar. Um id
// que chega do cliente é um pedido, e aceitá-lo faria a resposta descrever o escritório de
// outra pessoa.

export interface ArchitectUiContext {
  pathname?: string
  buildingId?: string
  floorId?: string
  sectorId?: string
  agentId?: string
  resource?: { kind: string; id: string }
}

/** O contexto DEPOIS de conferido: só o que é mesmo desta conta sobrevive. */
export interface ResolvedUiContext {
  pathname: string
  floor?: { id: string; name: string }
  sector?: { id: string; name: string }
  agent?: { id: string; name: string }
  /** O que o cliente mandou e não é desta conta. Some do contexto e fica registrado. */
  rejected: string[]
}

/**
 * Confere o contexto da tela contra a conta.
 *
 * A rota NÃO pode confiar em id do cliente. A conferência é feita pelos getters canônicos,
 * que já filtram por dono — e o que não passa é descartado em silêncio para a resposta, mas
 * fica em `rejected` para quem for depurar.
 */
export async function resolveUiContext(ownerId: string, bruto: ArchitectUiContext | null | undefined): Promise<ResolvedUiContext> {
  const ctx = bruto ?? {}
  const out: ResolvedUiContext = { pathname: String(ctx.pathname ?? '').slice(0, 200), rejected: [] }

  const conferir = async <T>(campo: string, id: unknown, buscar: (i: ObjectId) => Promise<T | null>): Promise<T | null> => {
    const texto = String(id ?? '').trim()
    if (!texto) return null
    if (!ObjectId.isValid(texto)) {
      out.rejected.push(campo)
      return null
    }
    const achado = await buscar(new ObjectId(texto)).catch(() => null)
    if (!achado) out.rejected.push(campo)
    return achado
  }

  const { getFloor } = await import('../floors.js')
  const { getSectorById } = await import('../sectors.js')
  const { getAgentById } = await import('../agents.js')

  const andar = await conferir('floorId', ctx.floorId, (i) => getFloor(ownerId, i))
  if (andar) out.floor = { id: andar._id.toString(), name: String(andar.name) }

  const setor = await conferir('sectorId', ctx.sectorId, (i) => getSectorById(ownerId, i))
  if (setor) out.sector = { id: setor._id.toString(), name: String(setor.name) }

  const agente = await conferir('agentId', ctx.agentId, (i) => getAgentById(ownerId, i))
  if (agente) out.agent = { id: agente._id.toString(), name: String(agente.name) }

  return out
}

// --- a rodada -------------------------------------------------------------------------------

export type AssistantPhase =
  | 'answering'
  | 'consulting'
  | 'preparing_proposal'
  | 'awaiting_approval'
  | 'applying'
  | 'testing'
  | 'done'
  | 'failed'

export interface AssistantTurnResult {
  intent: ArchitectIntent
  phase: AssistantPhase
  /** O texto que a pessoa lê. Nunca contém segredo: passa pela máscara antes de sair. */
  text: string
  /** Uma pergunta curta, quando os dois caminhos são plausíveis. */
  question: string | null
  /** O projeto criado ou reaberto — só em `propose`. */
  projectId: string | null
  /** De onde veio o dado, quando a resposta é sobre o agora. */
  provenance?: { source: string; at: string; transformation?: string }
  context: ResolvedUiContext
  /** O que a conta tem, resumido. É o que a tela usa para explicar sem outra chamada. */
  inventory?: OfficeInventorySummary
}

export interface AssistantTurnInput {
  ownerId: string
  message: string
  uiContext?: ArchitectUiContext | null
  /** A classificação que o modelo devolveu, quando houve chamada. Ausente = heurística. */
  classified?: unknown
}

/** Teto do que entra: uma mensagem é um pedido, não um upload. */
export const ASSISTANT_LIMITS = { message: 4000 }

/**
 * Uma rodada do assistente global.
 *
 * O que ela NÃO faz é o ponto: `answer` e `explain` não criam projeto, não escrevem no
 * escritório e não acionam nada. É o roteador que decide, e a política é código.
 */
export async function runAssistantTurn(input: AssistantTurnInput): Promise<AssistantTurnResult> {
  const mensagem = String(input.message ?? '').slice(0, ASSISTANT_LIMITS.message)
  const context = await resolveUiContext(input.ownerId, input.uiContext)

  /**
   * A intenção vem do modelo QUANDO ele foi consultado; senão, da heurística.
   *
   * A heurística sugere e não decide: ela só produz `answer` e `propose`, os dois modos que
   * não executam nada sozinhos. É o que dá uma resposta útil quando o provedor está fora.
   */
  const intent = input.classified !== undefined ? parseIntent(input.classified, mensagem) : suggestIntent(mensagem)
  const policy = policyFor(intent)
  const question = clarifyingQuestion(mensagem, intent)

  if (intent.mode === 'explain') {
    // Explicar lê o inventário e devolve o resumo: é a pergunta "o que eu tenho?".
    const resumo = summarizeInventory(await loadOfficeInventory(input.ownerId))
    return {
      intent,
      phase: 'done',
      text: explicar(resumo, context),
      question,
      projectId: null,
      context,
      inventory: resumo,
    }
  }

  if (intent.mode === 'answer') {
    if (policy.requiresProvenance) {
      /**
       * Sem fonte conectada, a resposta é uma RECUSA — e não um número lembrado.
       *
       * Um valor de câmbio de três meses atrás apresentado como "hoje" não é uma resposta
       * pior: é uma resposta errada, e quem lê não tem como saber. A ligação com as fontes
       * reais da conta entra quando o executor de ferramentas do assistente existir; até lá,
       * a recusa é honesta e diz o que fazer.
       */
      const recusa = noCurrentSource(intent.query)
      return { intent, phase: 'failed', text: recusa.reason ?? '', question, projectId: null, context }
    }
    return {
      intent,
      phase: 'answering',
      text: '',
      question,
      projectId: null,
      context,
    }
  }

  if (intent.mode === 'operate') {
    return {
      intent,
      phase: policy.writesWithoutConfirmation ? 'consulting' : 'awaiting_approval',
      text: policy.writesWithoutConfirmation
        ? ''
        : `"${intent.action}" muda o escritório. Vou preparar a prévia com o impacto antes de fazer qualquer coisa.`,
      question,
      projectId: null,
      context,
    }
  }

  // `propose` é o ÚNICO modo que cria projeto.
  const { createProject } = await import('./repository.js')
  const projeto = await createProject(input.ownerId, {
    title: tituloDe(intent.objective),
    objective: intent.objective,
  })
  return {
    intent,
    phase: 'preparing_proposal',
    text: maskSecretsDeep(`Vou montar isso. Comecei um projeto para "${tituloDe(intent.objective)}" — nada é aplicado sem a sua aprovação.`) as string,
    question,
    projectId: projeto._id.toString(),
    context,
  }
}

/** Um título curto a partir do objetivo. Sem isto, todo projeto se chamaria a frase inteira. */
const tituloDe = (objetivo: string): string => {
  const limpo = String(objetivo ?? '').replace(/\s+/g, ' ').trim()
  const primeira = limpo.split(/[.!?]/)[0] ?? limpo
  return (primeira.length > 60 ? `${primeira.slice(0, 57)}…` : primeira) || 'Nova operação'
}

/**
 * O que a conta tem, em português.
 *
 * O resumo é montado do inventário real — não de um texto do modelo. É a diferença entre
 * "você tem 3 andares" e "acho que você tem alguns andares".
 */
function explicar(resumo: OfficeInventorySummary, ctx: ResolvedUiContext): string {
  const partes: string[] = []
  const onde = ctx.agent ? `o agente ${ctx.agent.name}` : ctx.sector ? `o setor ${ctx.sector.name}` : ctx.floor ? `o andar ${ctx.floor.name}` : null
  if (onde) partes.push(`Você está olhando ${onde}.`)

  const contagem = (kind: string, singular: string, plural: string) => {
    const n = resumo.counts[kind] ?? 0
    if (!n) return null
    return `${n} ${n === 1 ? singular : plural}`
  }
  const organizacao = [contagem('floor', 'andar', 'andares'), contagem('sector', 'setor', 'setores'), contagem('agent', 'agente', 'agentes')].filter(Boolean)
  if (organizacao.length) partes.push(`O escritório tem ${organizacao.join(', ')}.`)

  const operacao = [
    contagem('source', 'fonte', 'fontes'),
    contagem('monitor', 'monitor', 'monitores'),
    contagem('flow', 'Flow', 'Flows'),
    contagem('database', 'Database', 'Databases'),
  ].filter(Boolean)
  if (operacao.length) partes.push(`Em operação: ${operacao.join(', ')}.`)

  if (resumo.attention.length) {
    partes.push(`Precisa de atenção: ${resumo.attention.slice(0, 3).join('; ')}.`)
  }
  return partes.join(' ') || 'Seu escritório ainda está vazio. Me diga o que você quer que ele faça.'
}
