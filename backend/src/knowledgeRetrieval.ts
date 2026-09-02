import type { ObjectId } from 'mongodb'
import { resolveKnowledgeOwnersForExecution } from './knowledgeAccess.js'
import type { ExecutionContext, ResolvedOwner } from './knowledgeAccess.js'
import { retrieveForOwners, RETRIEVAL_CHAR_BUDGET, RETRIEVAL_MIN_SCORE, RETRIEVAL_TOP_K } from './knowledge.js'
import type { KnowledgeFilters, RetrievalResult } from './knowledge.js'
import { deriveRequirement, recordContextManifest } from './contextManifest.js'
import type { Agent } from './agents.js'

// A PORTA ÚNICA da leitura de conhecimento.
//
// Todo executor entra por aqui: chat direto, delegação, execução de setor, rotina,
// playground e widget. Antes, cada um montava a própria lista de bases — e cinco listas
// significam cinco chances de a mesma pergunta ter respostas diferentes conforme a porta
// por onde ela entrou. Aqui a política é resolvida uma vez, do mesmo jeito, e a busca
// acontece dentro de um orçamento só.

export interface AgentRetrievalResult extends RetrievalResult {
  /** As bases realmente consultadas, com o motivo de cada uma. */
  owners: ResolvedOwner[]
}

export interface AgentRetrievalOptions extends ExecutionContext {
  topK?: number
  charBudget?: number
  minScore?: number
  filters?: KnowledgeFilters | null
  /**
   * De qual execução isto faz parte.
   *
   * Presente = grava o manifesto. Ausente = não grava, e é o caso de quem chama a busca
   * para conferir uma configuração, não para responder alguém. O manifesto é registro de
   * execução; um por clique de tela viraria ruído sem dono.
   */
  execution?: { executionId: string; kind: string } | null
  /** O agente foi configurado para não responder sem base? Muda o que é obrigatório. */
  requireGrounding?: boolean
}

/**
 * O que este agente encontra, nas bases que ele pode ler.
 *
 * Sem base nenhuma o resultado é `denied`, e não `empty`: um agente cuja política não
 * lhe dá acesso a coisa alguma não descobriu que o conhecimento não existe — ele não
 * teve onde procurar. As duas respostas levam a frases diferentes, e trocá-las faria o
 * agente afirmar ausência sobre uma base cheia.
 */
export async function retrieveForAgent(
  accountId: string,
  agent: Pick<Agent, '_id' | 'ownerId' | 'officeId' | 'knowledgeAccess'>,
  query: string,
  opts: AgentRetrievalOptions = {},
): Promise<AgentRetrievalResult> {
  const { owners } = await resolveKnowledgeOwnersForExecution(accountId, agent, { verifiedSectorId: opts.verifiedSectorId ?? null })
  if (owners.length === 0) {
    const vazio: AgentRetrievalResult = { context: [], sources: [], status: 'denied', failed: false, owners: [] }
    await registrar(accountId, agent, query, opts, vazio)
    return vazio
  }
  const r = await retrieveForOwners(owners, query, opts)
  const resultado = { ...r, owners }
  await registrar(accountId, agent, query, opts, resultado)
  return resultado
}

/**
 * O manifesto sai daqui — do lado do SERVIDOR, com o que de fato aconteceu.
 *
 * Registrar dentro da busca (e não em cada executor) é o que impede as seis portas de
 * divergirem no que relatam: quem responde sobre a execução é quem executou a busca.
 */
async function registrar(
  accountId: string,
  agent: Pick<Agent, '_id' | 'knowledgeAccess'>,
  query: string,
  opts: AgentRetrievalOptions,
  r: AgentRetrievalResult,
): Promise<void> {
  if (!opts.execution) return
  await recordContextManifest({
    ownerId: accountId,
    executionId: opts.execution.executionId,
    executionKind: opts.execution.kind,
    agentId: agent._id,
    requested: deriveRequirement(r.owners, query, { requireGrounding: opts.requireGrounding }),
    allowed: r.owners,
    sources: r.sources,
    contextChars: r.context.reduce((n, c) => n + c.length, 0),
    groundingStatus: r.status,
    budget: {
      topK: opts.topK ?? RETRIEVAL_TOP_K,
      charBudget: opts.charBudget ?? RETRIEVAL_CHAR_BUDGET,
      minScore: opts.minScore ?? RETRIEVAL_MIN_SCORE,
    },
    ignored: r.ignored ?? [],
    documentMeta: r.documentMeta,
  })
}

/**
 * A leitura de VÁRIOS agentes — o conhecimento do time, na delegação.
 *
 * Cada colega entra com a política DELE. Somar as bases de todos e buscar uma vez é o
 * que mantém o orçamento global valendo: fazer uma busca por colega daria a um time de
 * cinco pessoas cinco vezes mais contexto que a um agente sozinho, e o corte final
 * escolheria entre sobras de cada busca em vez de escolher entre tudo.
 */
export async function retrieveForAgents(
  accountId: string,
  agents: Pick<Agent, '_id' | 'ownerId' | 'officeId' | 'knowledgeAccess'>[],
  query: string,
  opts: AgentRetrievalOptions = {},
): Promise<AgentRetrievalResult> {
  const todos: ResolvedOwner[] = []
  const vistos = new Set<string>()
  for (const agent of agents) {
    const { owners } = await resolveKnowledgeOwnersForExecution(accountId, agent, { verifiedSectorId: opts.verifiedSectorId ?? null })
    for (const o of owners) {
      const chave = `${o.ownerType}:${o.ownerId.toString()}`
      if (vistos.has(chave)) continue
      vistos.add(chave)
      todos.push(o)
    }
  }
  if (todos.length === 0) return { context: [], sources: [], status: 'denied', failed: false, owners: [] }
  const r = await retrieveForOwners(todos, query, opts)
  return { ...r, owners: todos }
}

/** O id do agente, para os fluxos que só têm ids em mãos. Nunca resolve política sozinho. */
export type AgentLike = Pick<Agent, '_id' | 'ownerId' | 'officeId' | 'knowledgeAccess'>
export const agentLike = (a: { _id: ObjectId; ownerId: string; officeId: ObjectId; knowledgeAccess?: Agent['knowledgeAccess'] }): AgentLike => a
