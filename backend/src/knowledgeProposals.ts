import { ObjectId } from 'mongodb'
import { db } from './db.js'
import { findBySourceRef } from './knowledge.js'
import type { KnowledgeAuthority, KnowledgeOwner, KnowledgeOwnerType } from './knowledge.js'
import { saveDocument } from './knowledgeService.js'

// O QUE UM AGENTE PROPÕE — e por que isso não vira conhecimento sozinho.
//
// Um agente que grava direto na base fecha um ciclo perigoso: ele responde a partir do
// que ele mesmo escreveu, e a próxima resposta cita a anterior como fonte. Duas voltas
// depois, um palpite virou política da empresa, com aparência de documento curado e sem
// nenhuma evidência independente por trás.
//
// Aqui a proposta é um artefato separado, com evidência e revisor. Ela NÃO entra na busca
// — o filtro curatorial só devolve `approved`, e proposta nenhuma nasce aprovada. Aprovar
// é uma ação humana, explícita e auditada, e é ela que cria o documento.

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'needs_review'

export interface KnowledgeProposalEvidence {
  /** De onde veio o que sustenta a proposta. */
  kind: 'document' | 'live_data' | 'run' | 'historical'
  ref: string
  note?: string
}

export interface KnowledgeProposal {
  _id: ObjectId
  ownerId: string
  agentId: ObjectId | null
  /** A execução em que a proposta nasceu. É o caminho de volta para o que aconteceu. */
  executionId: string | null
  scopeType: KnowledgeOwnerType
  scopeId: ObjectId
  title: string
  content: string
  evidence: KnowledgeProposalEvidence[]
  /** Só quando vier de um processo que mediu algo. Nunca escrita pelo agente. */
  confidence: { value: number; method: string } | null
  status: ProposalStatus
  /** O que a validação automática encontrou antes de a pessoa olhar. */
  checks: { duplicateOfDocumentId: string | null; conflictsWith: string[]; reason: string | null }
  reviewerId: string | null
  reviewNote: string | null
  createdAt: Date
  updatedAt: Date
  /** O documento criado ao aprovar. Rejeitar não apaga a proposta — apaga a auditoria. */
  documentId: ObjectId | null
}

const proposals = db.collection<KnowledgeProposal>('knowledge_proposals')

export async function ensureKnowledgeProposalIndexes(): Promise<void> {
  await proposals.createIndex({ ownerId: 1, status: 1, createdAt: -1 })
  await proposals.createIndex({ ownerId: 1, scopeType: 1, scopeId: 1 })
}

export class ProposalError extends Error {}

export interface CreateProposalInput {
  ownerId: string
  agentId: ObjectId | null
  executionId?: string | null
  owner: KnowledgeOwner
  title: string
  content: string
  evidence: KnowledgeProposalEvidence[]
  confidence?: { value: number; method: string } | null
}

/**
 * Registra a proposta, já com o que a validação automática viu.
 *
 * Sem evidência ela nasce `needs_review`, e não `pending`: a diferença é que ninguém
 * deve poder aprovar em lote o que não tem nada por trás. E texto gerado por IA não
 * conta como evidência de outra proposta — é assim que o ciclo se fecha sem que ninguém
 * perceba.
 */
export async function createKnowledgeProposal(input: CreateProposalInput): Promise<KnowledgeProposal> {
  const title = input.title.trim()
  const content = input.content.trim()
  if (!title || !content) throw new ProposalError('título e conteúdo são obrigatórios')

  const evidencias = (input.evidence ?? []).filter((e) => e && e.ref)
  const independente = evidencias.some((e) => e.kind !== 'run')

  const checks = await validarProposta(input.ownerId, input.owner, title, content)
  const agora = new Date()
  const doc: KnowledgeProposal = {
    _id: new ObjectId(),
    ownerId: input.ownerId,
    agentId: input.agentId,
    executionId: input.executionId ?? null,
    scopeType: input.owner.ownerType,
    scopeId: input.owner.ownerId,
    title: title.slice(0, 200),
    content: content.slice(0, 100_000),
    evidence: evidencias.slice(0, 10),
    confidence: input.confidence ?? null,
    status: independente && evidencias.length > 0 ? 'pending' : 'needs_review',
    checks,
    reviewerId: null,
    reviewNote: null,
    createdAt: agora,
    updatedAt: agora,
    documentId: null,
  }
  await proposals.insertOne(doc)
  return doc
}

/** Duplicidade e conflito, antes de a pessoa gastar tempo lendo. */
async function validarProposta(
  ownerId: string,
  owner: KnowledgeOwner,
  title: string,
  content: string,
): Promise<KnowledgeProposal['checks']> {
  const { ownerFilter } = await import('./knowledge.js')
  const existentes = await db
    .collection('knowledge_documents')
    .find({ ...ownerFilter(owner) }, { projection: { title: 1, content: 1, authority: 1 } })
    .limit(200)
    .toArray()

  const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  const alvoTitulo = normalizar(title)
  const duplicado = existentes.find((d) => normalizar(String(d.title ?? '')) === alvoTitulo)
  const { detectConflicts } = await import('./knowledgeConflicts.js')
  const conflitos = detectConflicts([
    { id: 'proposta', title, content, authority: 'note' },
    ...existentes.map((d) => ({ id: d._id.toString(), title: String(d.title ?? ''), content: String(d.content ?? ''), authority: String(d.authority ?? 'reference') })),
  ])

  return {
    duplicateOfDocumentId: duplicado ? duplicado._id.toString() : null,
    conflictsWith: conflitos
      .filter((c) => c.documentIds.includes('proposta'))
      .flatMap((c) => c.documentIds.filter((id) => id !== 'proposta')),
    reason: duplicado ? 'já existe um documento com este título neste escopo' : null,
  }
}

export interface ProposalQuery {
  status?: ProposalStatus
  scopeType?: KnowledgeOwnerType
  scopeId?: ObjectId
  limit?: number
  skip?: number
}

export async function listKnowledgeProposals(ownerId: string, q: ProposalQuery = {}) {
  const filtro: Record<string, unknown> = { ownerId }
  if (q.status) filtro.status = q.status
  if (q.scopeType) filtro.scopeType = q.scopeType
  if (q.scopeId) filtro.scopeId = q.scopeId
  const limite = Math.min(Math.max(q.limit ?? 50, 1), 200)
  const [items, total] = await Promise.all([
    proposals.find(filtro, { projection: { content: 0 } }).sort({ createdAt: -1 }).skip(Math.max(q.skip ?? 0, 0)).limit(limite).toArray(),
    proposals.countDocuments(filtro),
  ])
  return { items, total }
}

export const getKnowledgeProposal = (ownerId: string, id: ObjectId) => proposals.findOne({ _id: id, ownerId })

/**
 * Aprovar CRIA o documento — é a única porta por onde uma proposta entra na busca.
 *
 * A marca `proposal:<id>` liga documento e proposta, e o índice único de `sourceRef`
 * impede que dois cliques criem dois documentos. Aprovar duas vezes devolve o mesmo.
 */
export async function approveKnowledgeProposal(
  ownerId: string,
  id: ObjectId,
  reviewerId: string,
  opts: { authority?: KnowledgeAuthority; note?: string } = {},
): Promise<KnowledgeProposal> {
  const proposta = await proposals.findOne({ _id: id, ownerId })
  if (!proposta) throw new ProposalError('proposta não encontrada')
  if (proposta.status === 'approved' && proposta.documentId) return proposta
  if (proposta.status === 'rejected') throw new ProposalError('esta proposta já foi recusada')

  const owner: KnowledgeOwner = { ownerType: proposta.scopeType, ownerId: proposta.scopeId }
  const sourceRef = `proposal:${proposta._id.toString()}`
  const existente = await findBySourceRef(owner, sourceRef)
  const doc =
    existente ??
    (await saveDocument(ownerId, owner, {
      title: proposta.title,
      content: proposta.content,
      source: 'proposal',
      sourceRef,
      authorId: reviewerId,
      // Aprovada por uma pessoa: é isto que a faz responder.
      lifecycleStatus: 'approved',
      authority: opts.authority ?? 'note',
      maxContent: null,
    }))

  const atualizada: Partial<KnowledgeProposal> = {
    status: 'approved',
    reviewerId,
    reviewNote: opts.note?.slice(0, 500) ?? null,
    documentId: doc._id,
    updatedAt: new Date(),
  }
  await proposals.updateOne({ _id: id, ownerId }, { $set: atualizada })
  return { ...proposta, ...atualizada } as KnowledgeProposal
}

/** Recusar mantém tudo: a auditoria de uma decisão é a decisão mais o motivo. */
export async function rejectKnowledgeProposal(ownerId: string, id: ObjectId, reviewerId: string, note?: string): Promise<KnowledgeProposal | null> {
  const r = await proposals.findOneAndUpdate(
    { _id: id, ownerId, status: { $ne: 'approved' } },
    { $set: { status: 'rejected' as ProposalStatus, reviewerId, reviewNote: note?.slice(0, 500) ?? null, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  return r
}

/** As propostas ligadas a um documento — para a análise de impacto. */
export const proposalsForDocument = (ownerId: string, documentId: ObjectId) =>
  proposals.find({ ownerId, documentId }, { projection: { title: 1, status: 1, createdAt: 1 } }).toArray()
