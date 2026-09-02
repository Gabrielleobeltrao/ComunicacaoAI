import { ObjectId } from 'mongodb'
import { db } from './db.js'
import { curationFilter, ownerFilter, reviewStateOf } from './knowledge.js'
import type { KnowledgeDocument, KnowledgeOwnerType } from './knowledge.js'
import { resolveKnowledgeOwnersForExecution } from './knowledgeAccess.js'
import { countExecutionsUsingDocument } from './contextManifest.js'
import { gapsResolvedByDocument } from './knowledgeGaps.js'
import { documentsLinkingTo } from './knowledgeLinks.js'
import { openConflictsForDocuments } from './knowledgeConflicts.js'
import { proposalsForDocument } from './knowledgeProposals.js'
import { getAgentById } from './agents.js'

// O MAPA — quem sabe o quê, e por onde a informação alcança quem responde.
//
// O grafo é derivado: hierarquia (prédio → andar → setor → agente → documento) e acesso
// saem das relações reais, e não de uma coleção de arestas. Uma coleção de arestas
// precisaria ser mantida em sincronia com agentes, setores e políticas — e uma cópia que
// envelhece mostra um mapa que já não corresponde ao escritório.
//
// A única coisa persistida é a POSIÇÃO que a pessoa arrastou: ela não é derivável de
// nada, e perdê-la a cada carregamento faria o mapa ser reorganizado por baixo de quem
// acabou de organizá-lo.

export interface KnowledgeGraphNode {
  id: string
  kind: 'building' | 'floor' | 'sector' | 'agent' | 'document'
  label: string
  ownerType?: KnowledgeOwnerType
  ownerId?: string
  color?: string | null
  /** O id do agente. O RETRATO é resolvido no frontend, pelo mecanismo que já existe. */
  portraitKey?: string | null
  indexStatus?: 'indexed' | 'pending' | 'error'
  source?: string | null
  /** Sinais discretos: vencido, revisão pendente, em conflito. */
  flags?: string[]
  counts?: { connections: number; accessibleByAgents: number }
  position?: { x: number; y: number } | null
}

export interface KnowledgeGraphEdge {
  id: string
  source: string
  target: string
  kind: 'contains' | 'references' | 'can_access'
}

export interface KnowledgeGraphResult {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  /** Quantos documentos existem no recorte, e quantos vieram. "Carregar mais" precisa disto. */
  documentTotal: number
  documentLimit: number
  truncated: boolean
}

const documents = db.collection<KnowledgeDocument>('knowledge_documents')

export interface GraphQuery {
  floorId?: ObjectId | null
  /** Ver como um agente: o resultado REMOVE o que ele não pode ler. */
  viewAsAgentId?: ObjectId | null
  search?: string | null
  scopeTypes?: KnowledgeOwnerType[] | null
  status?: KnowledgeDocument['indexStatus'] | null
  source?: string | null
  limit?: number
  skip?: number
}

const nodeIdOf = (kind: string, id: string) => `${kind}:${id}`

/**
 * O grafo de um andar — ou o que um agente específico alcança dele.
 *
 * "Ver como agente" REMOVE do resultado o que ele não pode acessar, em vez de esconder
 * na tela: um mapa que desenha o que a pessoa não deveria ver e conta com o CSS para
 * escondê-lo entrega o dado na primeira aba de rede aberta.
 */
export async function buildKnowledgeGraph(accountId: string, q: GraphQuery = {}): Promise<KnowledgeGraphResult> {
  const nodes: KnowledgeGraphNode[] = []
  const edges: KnowledgeGraphEdge[] = []
  const push = (n: KnowledgeGraphNode) => {
    if (!nodes.some((x) => x.id === n.id)) nodes.push(n)
  }
  const ligar = (source: string, target: string, kind: KnowledgeGraphEdge['kind']) => {
    const id = `${kind}:${source}->${target}`
    if (!edges.some((e) => e.id === id)) edges.push({ id, source, target, kind })
  }

  const [predio, andares, setores, agentes] = await Promise.all([
    db.collection('buildings').findOne({ ownerId: accountId }),
    db.collection('offices').find({ ownerId: accountId, ...(q.floorId ? { _id: q.floorId } : {}) }).toArray(),
    db.collection('sectors').find({ ownerId: accountId, ...(q.floorId ? { officeId: q.floorId } : {}) }).toArray(),
    db.collection('agents').find({ ownerId: accountId, ...(q.floorId ? { officeId: q.floorId } : {}) }).toArray(),
  ])

  /**
   * As bases que o agente escolhido alcança — pela MESMA resolução da execução.
   *
   * Uma segunda regra de "o que ele vê no mapa" divergiria da regra do que ele lê de
   * verdade, e o mapa passaria a mentir justamente sobre a pergunta que ele existe para
   * responder.
   */
  let permitidos: Set<string> | null = null
  if (q.viewAsAgentId) {
    const agente = await getAgentById(accountId, q.viewAsAgentId)
    if (!agente) return { nodes: [], edges: [], documentTotal: 0, documentLimit: 0, truncated: false }
    const r = await resolveKnowledgeOwnersForExecution(accountId, agente)
    permitidos = new Set(r.owners.map((o) => `${o.ownerType}:${o.ownerId.toString()}`))
  }

  const podeVer = (ownerType: KnowledgeOwnerType, ownerId: string) => !permitidos || permitidos.has(`${ownerType}:${ownerId}`)

  if (predio && podeVer('building', predio._id.toString())) {
    push({ id: nodeIdOf('building', predio._id.toString()), kind: 'building', label: String(predio.name ?? 'Prédio'), ownerType: 'building', ownerId: predio._id.toString() })
  }
  for (const andar of andares) {
    if (!podeVer('floor', andar._id.toString())) continue
    const id = nodeIdOf('floor', andar._id.toString())
    push({ id, kind: 'floor', label: String(andar.name ?? 'Andar'), ownerType: 'floor', ownerId: andar._id.toString(), color: (andar.color as string) ?? null })
    if (predio) ligar(nodeIdOf('building', predio._id.toString()), id, 'contains')
  }
  for (const setor of setores) {
    if (!podeVer('sector', setor._id.toString())) continue
    const id = nodeIdOf('sector', setor._id.toString())
    push({ id, kind: 'sector', label: String(setor.name ?? 'Setor'), ownerType: 'sector', ownerId: setor._id.toString(), color: (setor.color as string) ?? null })
    ligar(nodeIdOf('floor', setor.officeId.toString()), id, 'contains')
  }
  for (const agente of agentes) {
    if (q.viewAsAgentId && !agente._id.equals(q.viewAsAgentId)) continue
    const id = nodeIdOf('agent', agente._id.toString())
    push({
      id,
      kind: 'agent',
      label: String(agente.name ?? 'Agente'),
      ownerType: 'agent',
      ownerId: agente._id.toString(),
      // Só o id: base64 de imagem no DTO seria megabytes por carregamento, e o frontend
      // já sabe resolver o retrato a partir dele.
      portraitKey: agente._id.toString(),
    })
    const setorDele = setores.find((s) => (s.members ?? []).some((m: { agentId: ObjectId }) => m.agentId.equals(agente._id)))
    ligar(setorDele ? nodeIdOf('sector', setorDele._id.toString()) : nodeIdOf('floor', agente.officeId.toString()), id, 'contains')
  }

  // --- os documentos ------------------------------------------------------------------
  const escoposVisiveis = nodes
    .filter((n) => n.ownerType && n.ownerId)
    .map((n) => ({ ownerType: n.ownerType as KnowledgeOwnerType, ownerId: new ObjectId(n.ownerId as string) }))
    .filter((o) => !q.scopeTypes || q.scopeTypes.includes(o.ownerType))

  const filtro: Record<string, unknown> = escoposVisiveis.length
    ? { $and: [{ $or: escoposVisiveis.map((o) => ownerFilter(o)) }] }
    : { _id: { $exists: false } }
  const partes = (filtro.$and ?? []) as Record<string, unknown>[]
  if (q.status) partes.push({ indexStatus: q.status })
  if (q.source) partes.push({ source: q.source })
  if (q.search?.trim()) partes.push({ title: { $regex: q.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })

  const limite = Math.min(Math.max(q.limit ?? 200, 1), 500)
  const [docs, documentTotal] = await Promise.all([
    documents.find(filtro, { projection: { content: 0 } }).sort({ updatedAt: -1 }).skip(Math.max(q.skip ?? 0, 0)).limit(limite).toArray(),
    documents.countDocuments(filtro),
  ])

  const agora = new Date()
  const emConflito = new Set(
    (await openConflictsForDocuments(accountId, docs.map((d) => d._id))).flatMap((c) => c.documentIds.map((id) => id.toString())),
  )

  for (const doc of docs) {
    const id = nodeIdOf('document', doc._id.toString())
    const estado = reviewStateOf(doc, agora)
    const flags: string[] = []
    if (estado !== 'ok') flags.push(estado)
    if ((doc.lifecycleStatus ?? 'approved') !== 'approved') flags.push(doc.lifecycleStatus as string)
    if (emConflito.has(doc._id.toString())) flags.push('conflict')
    push({
      id,
      kind: 'document',
      label: String(doc.title ?? 'Documento'),
      ownerType: doc.ownerType ?? 'agent',
      ownerId: (doc.ownerId ?? doc.agentId)?.toString(),
      indexStatus: doc.indexStatus ?? 'indexed',
      source: doc.source ?? 'manual',
      ...(flags.length ? { flags } : {}),
      counts: { connections: (doc.links ?? []).filter((l) => l.resolvedDocumentId).length, accessibleByAgents: 0 },
    })
    const dono = nodeIdOf(doc.ownerType ?? 'agent', ((doc.ownerId ?? doc.agentId) as ObjectId).toString())
    ligar(dono, id, 'contains')
    for (const link of doc.links ?? []) {
      if (!link.resolvedDocumentId) continue
      // Só liga o que está NO recorte: uma aresta para um nó ausente vira uma linha que
      // sai do mapa e não chega a lugar nenhum.
      const alvo = nodeIdOf('document', link.resolvedDocumentId.toString())
      if (nodes.some((n) => n.id === alvo) || docs.some((d) => d._id.equals(link.resolvedDocumentId as ObjectId))) ligar(id, alvo, 'references')
    }
  }

  // --- quem PODE acessar cada base --------------------------------------------------
  //
  // A aresta `can_access` sai da política de cada agente — a mesma resolução da execução.
  // É o que separa "pode ler" de "leu", e as duas coisas precisam aparecer diferentes.
  for (const agente of agentes) {
    if (q.viewAsAgentId && !agente._id.equals(q.viewAsAgentId)) continue
    const r = await resolveKnowledgeOwnersForExecution(accountId, agente as unknown as Parameters<typeof resolveKnowledgeOwnersForExecution>[1])
    for (const owner of r.owners) {
      if (owner.ownerType === 'agent' && owner.ownerId.equals(agente._id)) continue
      const alvo = nodeIdOf(owner.ownerType, owner.ownerId.toString())
      if (!nodes.some((n) => n.id === alvo)) continue
      ligar(nodeIdOf('agent', agente._id.toString()), alvo, 'can_access')
    }
  }

  // Quantos agentes alcançam cada documento — pela base dele, não pelo documento.
  const acessoPorEscopo = new Map<string, number>()
  for (const e of edges.filter((x) => x.kind === 'can_access')) acessoPorEscopo.set(e.target, (acessoPorEscopo.get(e.target) ?? 0) + 1)
  for (const n of nodes) {
    if (n.kind !== 'document' || !n.ownerType || !n.ownerId) continue
    const escopo = nodeIdOf(n.ownerType, n.ownerId)
    const proprio = n.ownerType === 'agent' ? 1 : 0
    n.counts = { connections: n.counts?.connections ?? 0, accessibleByAgents: (acessoPorEscopo.get(escopo) ?? 0) + proprio }
  }

  return { nodes, edges, documentTotal, documentLimit: limite, truncated: documentTotal > docs.length + Math.max(q.skip ?? 0, 0) }
}

// --- o layout arrastado ----------------------------------------------------------------

export interface GraphLayoutEntry {
  ownerId: string
  viewKey: string
  nodeId: string
  x: number
  y: number
  updatedAt: Date
}

const layouts = db.collection<GraphLayoutEntry>('knowledge_graph_layouts')

export async function ensureKnowledgeGraphIndexes(): Promise<void> {
  await layouts.createIndex({ ownerId: 1, viewKey: 1, nodeId: 1 }, { unique: true })
  await documents.createIndex({ 'links.resolvedDocumentId': 1 })
}

export const getGraphLayout = (ownerId: string, viewKey: string) => layouts.find({ ownerId, viewKey }).toArray()

/** Só posições. O layout não muda a propriedade nem o conteúdo do conhecimento. */
export async function saveGraphLayout(ownerId: string, viewKey: string, posicoes: { nodeId: string; x: number; y: number }[]): Promise<number> {
  const validas = posicoes
    .filter((p) => p && typeof p.nodeId === 'string' && Number.isFinite(p.x) && Number.isFinite(p.y))
    .slice(0, 1000)
  if (validas.length === 0) return 0
  const agora = new Date()
  await layouts.bulkWrite(
    validas.map((p) => ({
      updateOne: {
        filter: { ownerId, viewKey, nodeId: p.nodeId.slice(0, 120) },
        update: { $set: { x: Math.round(p.x), y: Math.round(p.y), updatedAt: agora } },
        upsert: true,
      },
    })),
  )
  return validas.length
}

/** "Organizar automaticamente": apaga só as posições DESTA visão. */
export async function clearGraphLayout(ownerId: string, viewKey: string): Promise<number> {
  const r = await layouts.deleteMany({ ownerId, viewKey })
  return r.deletedCount
}

// --- análise de impacto ------------------------------------------------------------------

export interface DocumentImpact {
  documentId: string
  title: string
  scopeType: KnowledgeOwnerType
  scopeId: string
  /** Quem PODE ler — permissão potencial, derivada da política. */
  accessibleBy: { agentId: string; name: string }[]
  /** Quem REALMENTE leu — evidência, vinda dos manifestos. */
  actuallyUsedBy: { executionId: string; executionKind: string; agentId: string | null; at: Date }[]
  usedCount: number
  resolvedGaps: { subject: string; count: number }[]
  linkedFrom: { documentId: string; title: string }[]
  proposals: { id: string; title: string; status: string }[]
  openConflicts: { subject: string; documentIds: string[] }[]
  /** Arquivar preserva histórico; excluir apaga a ligação com os manifestos. */
  recommendation: 'safe_to_delete' | 'prefer_archive'
}

/**
 * O que quebra se este documento sair — com potencial e evidência SEPARADOS.
 *
 * "Três agentes usam este documento" era a frase que dava para escrever com a permissão
 * na mão, e ela é falsa: ter acesso não é ter usado. Aqui as duas contagens vêm de
 * lugares diferentes, e a tela mostra as duas com nomes diferentes.
 */
export async function analyzeDocumentImpact(accountId: string, documentId: ObjectId): Promise<DocumentImpact | null> {
  const doc = await documents.findOne({ _id: documentId }, { projection: { content: 0 } })
  if (!doc) return null
  const ownerType = (doc.ownerType ?? 'agent') as KnowledgeOwnerType
  const ownerId = (doc.ownerId ?? doc.agentId) as ObjectId

  const { resolveKnowledgeOwner } = await import('./knowledgeScope.js')
  const dono = await resolveKnowledgeOwner(accountId, { scopeType: ownerType, scopeId: ownerId.toString() })
  if (!dono) return null

  const agentes = await db.collection('agents').find({ ownerId: accountId }, { projection: { name: 1, officeId: 1, knowledgeAccess: 1 } }).toArray()
  const accessibleBy: DocumentImpact['accessibleBy'] = []
  for (const a of agentes) {
    const r = await resolveKnowledgeOwnersForExecution(accountId, { ...a, ownerId: accountId } as unknown as Parameters<typeof resolveKnowledgeOwnersForExecution>[1])
    if (r.owners.some((o) => o.ownerType === ownerType && o.ownerId.equals(ownerId))) {
      accessibleBy.push({ agentId: a._id.toString(), name: String(a.name ?? '') })
    }
  }

  const [usos, total, lacunas, apontam, propostas, conflitos] = await Promise.all([
    (await import('./contextManifest.js')).executionsUsingDocument(accountId, documentId.toString(), 20),
    countExecutionsUsingDocument(accountId, documentId.toString()),
    gapsResolvedByDocument(accountId, documentId),
    documentsLinkingTo(accountId, documentId),
    proposalsForDocument(accountId, documentId),
    openConflictsForDocuments(accountId, [documentId]),
  ])

  return {
    documentId: documentId.toString(),
    title: String(doc.title ?? ''),
    scopeType: ownerType,
    scopeId: ownerId.toString(),
    accessibleBy,
    actuallyUsedBy: usos.map((u) => ({ executionId: u.executionId, executionKind: u.executionKind, agentId: u.agentId?.toString() ?? null, at: u.createdAt })),
    usedCount: total,
    resolvedGaps: lacunas.map((g) => ({ subject: String(g.subject), count: Number(g.count ?? 0) })),
    linkedFrom: apontam.map((d) => ({ documentId: d._id.toString(), title: String(d.title ?? '') })),
    proposals: propostas.map((p) => ({ id: p._id.toString(), title: String(p.title ?? ''), status: String(p.status) })),
    openConflicts: conflitos.map((c) => ({ subject: c.subject, documentIds: c.documentIds.map((id) => id.toString()) })),
    // Com histórico de uso, arquivar preserva os manifestos que apontam para ele; excluir
    // deixaria a auditoria referindo um documento que não existe mais.
    recommendation: total > 0 || lacunas.length > 0 ? 'prefer_archive' : 'safe_to_delete',
  }
}
