import { resolveKnowledgeOwnersForExecution } from './knowledgeAccess.js'
import type { ExecutionContext, ResolvedOwner } from './knowledgeAccess.js'
import { ObjectId } from 'mongodb'
import { retrieveForOwners, selectKnowledgeHitsDetailed, RETRIEVAL_CHAR_BUDGET, RETRIEVAL_MIN_SCORE, RETRIEVAL_TOP_K } from './knowledge.js'
import { neighborsOf } from './knowledgeLinks.js'
import { openConflictsForDocuments, precedence } from './knowledgeConflicts.js'
import type { ConflictCandidate } from './knowledgeConflicts.js'
import type { KnowledgeFilters, RetrievalResult } from './knowledge.js'
import { deriveRequirement, recordContextManifest } from './contextManifest.js'
import { recordKnowledgeGap } from './knowledgeGaps.js'
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
  /** Liga/desliga a expansão pelo grafo nesta chamada. Ausente = o padrão da instalação. */
  graphExpansion?: boolean
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
  const bruto = await retrieveForOwners(owners, query, opts)
  const expandido = await expandirPeloGrafo(owners, query, opts, bruto)
  const resultado = { ...(await aplicarConflitos(accountId, expandido)), owners }
  await registrar(accountId, agent, query, opts, resultado)
  return resultado
}

/**
 * A EXPANSÃO por ligações — um salto, e desligada por padrão.
 *
 * A ideia é simples: se o documento que respondeu cita outro, o citado talvez complete a
 * resposta. O risco também é: relação no grafo NÃO é relevância. Um documento pode citar
 * dez outros por organização, e trazer os dez empurraria para fora do orçamento o trecho
 * que de fato respondia.
 *
 * Por isso o vizinho não entra por fora: ele volta para a MESMA seleção, com o mesmo
 * corte de score e o mesmo teto de caracteres, competindo com os seeds. E por isso a
 * flag existe — ela fica desligada até um eval mostrar ganho medido, e é o caminho de
 * volta se o ganho não aparecer em produção.
 */
export const GRAPH_EXPANSION_ENABLED = process.env.KNOWLEDGE_GRAPH_EXPANSION === '1'
export const GRAPH_EXPANSION_MAX_NEIGHBORS = Number(process.env.KNOWLEDGE_GRAPH_EXPANSION_MAX ?? 5)

async function expandirPeloGrafo(
  owners: ResolvedOwner[],
  query: string,
  opts: AgentRetrievalOptions,
  r: RetrievalResult,
): Promise<RetrievalResult> {
  const ligada = opts.graphExpansion ?? GRAPH_EXPANSION_ENABLED
  if (!ligada || r.status !== 'ok' || r.sources.length === 0) return r

  const seeds = [...new Set(r.sources.map((s) => s.documentId).filter(Boolean))] as string[]
  const vizinhos = await neighborsOf(seeds.map((id) => new ObjectId(id)), owners, GRAPH_EXPANSION_MAX_NEIGHBORS)
  if (vizinhos.length === 0) return r

  // O vizinho é pontuado pelo MESMO critério do texto: entrar só por ser citado seria
  // tratar organização como relevância.
  const { extractTerms, extractWindow, scoreDocument } = await import('./lexicalRetrieval.js')
  const termos = extractTerms(query)
  const candidatos = vizinhos
    .map((d) => ({
      content: extractWindow(d.content ?? '', termos),
      score: scoreDocument(d.title, d.content ?? '', termos),
      ownerType: d.ownerType,
      ownerId: d.ownerId.toString(),
      documentId: d._id.toString(),
      title: d.title,
    }))
    .filter((c) => c.score > 0 && c.content)
  if (candidatos.length === 0) return r

  const jaEscolhidos = r.sources.map((s, i) => ({
    content: r.context[i] ?? '',
    score: s.score ?? 1,
    ownerType: s.ownerType,
    ownerId: s.ownerId,
    documentId: s.documentId ?? undefined,
    title: s.title ?? undefined,
  }))
  const { selected } = selectKnowledgeHitsDetailed([...jaEscolhidos, ...candidatos], opts)
  const novos = new Set(candidatos.map((c) => c.documentId))
  return {
    ...r,
    context: selected.map((h) => h.content),
    sources: selected.map((h) => {
      const anterior = r.sources.find((s) => s.documentId === h.documentId)
      return {
        documentId: h.documentId ?? null,
        title: h.title ?? null,
        ownerType: h.ownerType,
        ownerId: h.ownerId,
        score: h.score,
        // Fica REGISTRADO que este trecho entrou por expansão: sem isso, o eval não
        // consegue medir se a expansão ajudou ou só encheu o orçamento.
        retrieval: anterior?.retrieval ?? (novos.has(h.documentId ?? '') ? 'graph_expansion' : undefined),
        reason: anterior?.reason,
      }
    }),
  }
}

/**
 * Dois trechos que se contradizem NUNCA vão juntos para o modelo.
 *
 * Quando a precedência decide — aprovado sobre rascunho, política oficial sobre nota,
 * verificado mais recentemente entre iguais —, o perdedor sai e o motivo fica registrado.
 * Quando ela NÃO decide, os dois saem e o estado vira `conflict`: mandar os dois e torcer
 * é exatamente a decisão silenciosa que este bloco existe para não ter, e mandar um
 * escolhido no par seria a mesma coisa com um passo a mais.
 */
async function aplicarConflitos(accountId: string, r: RetrievalResult): Promise<RetrievalResult> {
  const ids = [...new Set(r.sources.map((s) => s.documentId).filter(Boolean))] as string[]
  if (ids.length < 2) return r

  const abertos = await openConflictsForDocuments(accountId, ids.map((id) => new ObjectId(id)))
  if (abertos.length === 0) return r

  const { db } = await import('./db.js')
  const envolvidos = [...new Set(abertos.flatMap((c) => c.documentIds.map((id) => id.toString())))].filter((id) => ids.includes(id))
  if (envolvidos.length < 2) return r

  const docs = await db
    .collection('knowledge_documents')
    .find({ _id: { $in: envolvidos.map((id) => new ObjectId(id)) } }, { projection: { title: 1, content: 1, authority: 1, lifecycleStatus: 1, verifiedAt: 1, updatedAt: 1 } })
    .toArray()
  const porId = new Map(
    docs.map((d) => [
      d._id.toString(),
      {
        id: d._id.toString(),
        title: String(d.title ?? ''),
        content: String(d.content ?? ''),
        authority: String(d.authority ?? 'reference'),
        lifecycleStatus: d.lifecycleStatus as string,
        verifiedAt: d.verifiedAt as Date,
        updatedAt: d.updatedAt as Date,
      },
    ]),
  )

  const removidos = new Set<string>()
  const ignorados = [...(r.ignored ?? [])]
  let indeciso = false
  for (const conflito of abertos) {
    const partes: ConflictCandidate[] = conflito.documentIds.map((id) => porId.get(id.toString())).filter(Boolean) as ConflictCandidate[]
    if (partes.length < 2) continue
    let vencedor: ConflictCandidate | null = partes[0]
    for (const outro of partes.slice(1)) {
      const escolhido = precedence(vencedor, outro)
      if (!escolhido) {
        vencedor = null
        break
      }
      vencedor = escolhido
    }
    if (!vencedor) {
      indeciso = true
      for (const p of partes) {
        removidos.add(p.id)
        ignorados.push({ kind: 'document', ref: p.id, reason: `conflito não resolvido sobre "${conflito.subject}" — a regra não decide qual vale` })
      }
      continue
    }
    for (const p of partes) {
      if (p.id === vencedor.id) continue
      removidos.add(p.id)
      ignorados.push({ kind: 'document', ref: p.id, reason: `conflito sobre "${conflito.subject}": ${vencedor.authority} tem precedência` })
    }
  }

  if (removidos.size === 0) return { ...r, ignored: ignorados }
  const manter = r.sources.map((s, i) => ({ s, i })).filter(({ s }) => !s.documentId || !removidos.has(s.documentId))
  return {
    ...r,
    context: manter.map(({ i }) => r.context[i]).filter((c) => c !== undefined),
    sources: manter.map(({ s }) => s),
    ignored: ignorados,
    // Indeciso é `conflict` mesmo quando sobrou contexto: quem exige grounding precisa
    // poder parar, e a tela precisa poder dizer que há uma decisão pendente.
    status: indeciso ? 'conflict' : manter.length > 0 ? r.status : 'empty',
  }
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

  /**
   * A LACUNA nasce aqui, junto do manifesto — e pelo mesmo motivo.
   *
   * "A base não respondeu" é um sinal que existia em toda execução e se perdia: cada uma
   * era um registro solto, e ninguém ia ler dez mil deles. Agregada por assunto, ela vira
   * a resposta para "o que falta na nossa base?".
   *
   * `denied` NÃO gera lacuna: não falta conhecimento, falta permissão — e tratá-los
   * igual mandaria alguém escrever um documento que já existe do outro lado da política.
   */
  if (['empty', 'no_base', 'unavailable'].includes(r.status)) {
    const escopo = r.owners.find((o) => o.reason === 'own') ?? r.owners[0]
    if (escopo) {
      await recordKnowledgeGap({
        ownerId: accountId,
        scopeType: escopo.ownerType,
        scopeId: escopo.ownerId,
        agentId: agent._id,
        question: query,
        cause: r.status as 'empty' | 'no_base' | 'unavailable',
      })
    }
  }

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
