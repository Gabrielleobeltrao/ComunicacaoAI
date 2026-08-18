import { ObjectId } from 'mongodb'
import { db } from './db.js'
// Re-exported so every caller keeps importing it from here; it lives apart because
// the routine step needs it without pulling in the database.
export { buildRetrievalQuery } from './retrievalQuery.js'
import { embedText, embedTexts } from './voyage.js'
import { extractTerms, extractWindow, scoreText, termsToPattern } from './lexicalRetrieval.js'

// Curated knowledge base (RAG) shared by agents AND sectors. There is ONE store:
// the same `knowledge_documents` / `knowledge_chunks` collections, the same Voyage
// embeddings and the same Atlas Vector Search index — a document just belongs to an
// owner, which is either an agent or a sector.
//
// Backwards compatibility: legacy rows only had `agentId`. Every row now also carries
// `ownerType` + `ownerId`, backfilled as ('agent', agentId) — and `agentId` keeps
// being written for agent-owned rows, so older code paths and any un-migrated reader
// keep working during the transition.
export type KnowledgeOwnerType = 'agent' | 'sector'

export interface KnowledgeOwner {
  ownerType: KnowledgeOwnerType
  ownerId: ObjectId
}

export interface KnowledgeDocument {
  _id: ObjectId
  // Legacy field: still written when ownerType === 'agent' (null for sector docs).
  agentId: ObjectId | null
  ownerType: KnowledgeOwnerType
  ownerId: ObjectId
  title: string
  content: string
  // Provenance for curated entries saved from a run/conversation (never automatic).
  source: string | null // e.g. 'manual' | 'run' | 'conversation'
  sourceRef: string | null // safe reference (runId / conversationId), never content
  authorId: string | null // ownerId (account) that saved it
  // Indexing state so the UI can show "indexando…" / "erro ao indexar".
  indexStatus: 'indexed' | 'pending' | 'error'
  chunkCount: number
  createdAt: Date
  updatedAt: Date
}

export interface KnowledgeChunk {
  _id: ObjectId
  agentId: ObjectId | null
  ownerType: KnowledgeOwnerType
  ownerId: ObjectId
  documentId: ObjectId
  // Indexing round that produced this chunk — a new generation only replaces the
  // previous one after it is written, so a failed re-index keeps the old version
  // searchable.
  generation?: ObjectId
  content: string
  embedding: number[]
  createdAt: Date
}

const documents = db.collection<KnowledgeDocument>('knowledge_documents')
const chunks = db.collection<KnowledgeChunk>('knowledge_chunks')

const CHUNK_SIZE = 800
const CHUNK_OVERLAP = 100

export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  const result: string[] = []
  for (const paragraph of paragraphs) {
    if (paragraph.length <= CHUNK_SIZE) {
      result.push(paragraph)
      continue
    }

    let start = 0
    while (start < paragraph.length) {
      const end = Math.min(start + CHUNK_SIZE, paragraph.length)
      result.push(paragraph.slice(start, end))
      if (end === paragraph.length) break
      start = end - CHUNK_OVERLAP
    }
  }
  return result
}

// A filter that matches rows written before the ownerType backfill as well as new
// ones — the transition never hides a document.
export function ownerFilter(owner: KnowledgeOwner): Record<string, unknown> {
  if (owner.ownerType === 'agent') {
    return { $or: [{ ownerType: 'agent', ownerId: owner.ownerId }, { ownerType: { $exists: false }, agentId: owner.ownerId }] }
  }
  return { ownerType: 'sector', ownerId: owner.ownerId }
}

export interface CreateDocumentInput {
  title: string
  content: string
  source?: string | null
  sourceRef?: string | null
  authorId?: string | null
}

export async function createDocumentFor(owner: KnowledgeOwner, input: CreateDocumentInput) {
  const now = new Date()
  const document: Omit<KnowledgeDocument, '_id'> = {
    agentId: owner.ownerType === 'agent' ? owner.ownerId : null,
    ownerType: owner.ownerType,
    ownerId: owner.ownerId,
    title: input.title,
    content: input.content,
    source: input.source ?? 'manual',
    sourceRef: input.sourceRef ?? null,
    authorId: input.authorId ?? null,
    indexStatus: 'pending',
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  const result = await documents.insertOne(document as KnowledgeDocument)
  const documentId = result.insertedId
  const indexed = await indexDocumentChunks(owner, documentId, input.content)
  return { ...document, _id: documentId, ...indexed }
}

// Backwards-compatible wrapper (agent-owned documents).
export function createDocument(agentId: ObjectId, title: string, content: string) {
  return createDocumentFor({ ownerType: 'agent', ownerId: agentId }, { title, content })
}

// Re-chunk + re-embed a document. Indexing state is persisted so the UI can show it,
// and an embedding failure marks the document 'error' instead of throwing away the
// content the user already saved.
async function indexDocumentChunks(owner: KnowledgeOwner, documentId: ObjectId, content: string): Promise<{ indexStatus: KnowledgeDocument['indexStatus']; chunkCount: number }> {
  const pieces = chunkText(content)
  if (pieces.length === 0) {
    await chunks.deleteMany({ documentId })
    await documents.updateOne({ _id: documentId }, { $set: { indexStatus: 'indexed', chunkCount: 0 } })
    return { indexStatus: 'indexed', chunkCount: 0 }
  }
  // Embed FIRST, swap after: the previous chunks stay searchable until the new ones
  // exist, so a failing embedding call never leaves the document unsearchable.
  let embeddings: number[][]
  try {
    embeddings = await embedTexts(pieces, 'document')
  } catch (error) {
    console.error('knowledge indexing failed (previous version kept searchable):', (error as Error).message)
    const kept = await chunks.countDocuments({ documentId })
    await documents.updateOne({ _id: documentId }, { $set: { indexStatus: 'error', chunkCount: kept } })
    return { indexStatus: 'error', chunkCount: kept }
  }
  const generation = new ObjectId() // marks this indexing round
  const chunkDocs: Omit<KnowledgeChunk, '_id'>[] = pieces.map((piece, index) => ({
    agentId: owner.ownerType === 'agent' ? owner.ownerId : null,
    ownerType: owner.ownerType,
    ownerId: owner.ownerId,
    documentId,
    generation,
    content: piece,
    embedding: embeddings[index],
    createdAt: new Date(),
  }))
  try {
    await chunks.insertMany(chunkDocs as KnowledgeChunk[])
  } catch (error) {
    console.error('knowledge chunk write failed (previous version kept searchable):', (error as Error).message)
    await chunks.deleteMany({ documentId, generation }) // roll back the partial write
    const kept = await chunks.countDocuments({ documentId })
    await documents.updateOne({ _id: documentId }, { $set: { indexStatus: 'error', chunkCount: kept } })
    return { indexStatus: 'error', chunkCount: kept }
  }
  // New generation is live — now drop the old one.
  await chunks.deleteMany({ documentId, generation: { $ne: generation } })
  await documents.updateOne({ _id: documentId }, { $set: { indexStatus: 'indexed', chunkCount: chunkDocs.length } })
  return { indexStatus: 'indexed', chunkCount: chunkDocs.length }
}

// Re-run indexing for a document whose last attempt failed ("Tentar novamente").
export async function reindexDocumentFor(owner: KnowledgeOwner, documentId: ObjectId) {
  const doc = await documents.findOne({ _id: documentId, ...ownerFilter(owner) })
  if (!doc) return null
  const indexed = await indexDocumentChunks(owner, documentId, doc.content)
  return { ...doc, ...indexed }
}

export function listDocumentsFor(owner: KnowledgeOwner) {
  return documents
    .find(ownerFilter(owner), { projection: { content: 0 } })
    .sort({ createdAt: -1 })
    .toArray()
}
export function listDocuments(agentId: ObjectId) {
  return listDocumentsFor({ ownerType: 'agent', ownerId: agentId })
}

export function getDocumentFor(owner: KnowledgeOwner, documentId: ObjectId) {
  return documents.findOne({ _id: documentId, ...ownerFilter(owner) })
}
export function getDocument(agentId: ObjectId, documentId: ObjectId) {
  return getDocumentFor({ ownerType: 'agent', ownerId: agentId }, documentId)
}

export async function updateDocumentFor(owner: KnowledgeOwner, documentId: ObjectId, updates: { title?: string; content?: string }) {
  const setFields: Partial<KnowledgeDocument> = { updatedAt: new Date() }
  if (updates.title !== undefined) setFields.title = updates.title
  if (updates.content !== undefined) {
    setFields.content = updates.content
    setFields.indexStatus = 'pending'
  }

  const result = await documents.findOneAndUpdate({ _id: documentId, ...ownerFilter(owner) }, { $set: setFields }, { returnDocument: 'after' })
  if (!result) return null
  if (updates.content !== undefined) {
    const indexed = await indexDocumentChunks(owner, documentId, updates.content)
    return { ...result, ...indexed }
  }
  return result
}
export function updateDocument(agentId: ObjectId, documentId: ObjectId, updates: { title?: string; content?: string }) {
  return updateDocumentFor({ ownerType: 'agent', ownerId: agentId }, documentId, updates)
}

export async function deleteDocumentFor(owner: KnowledgeOwner, documentId: ObjectId) {
  const doc = await documents.findOne({ _id: documentId, ...ownerFilter(owner) }, { projection: { _id: 1 } })
  if (!doc) return false
  await chunks.deleteMany({ documentId })
  const result = await documents.deleteOne({ _id: documentId })
  return result.deletedCount > 0
}
export function deleteDocument(agentId: ObjectId, documentId: ObjectId) {
  return deleteDocumentFor({ ownerType: 'agent', ownerId: agentId }, documentId)
}

// Wipe an owner's entire knowledge base (agent deleted / sector deleted).
export async function deleteAllFor(owner: KnowledgeOwner) {
  const docs = await documents.find(ownerFilter(owner), { projection: { _id: 1 } }).toArray()
  const ids = docs.map((d) => d._id)
  if (ids.length) await chunks.deleteMany({ documentId: { $in: ids } })
  await documents.deleteMany(ownerFilter(owner))
  return ids.length
}
export function deleteAllForAgent(agentId: ObjectId) {
  return deleteAllFor({ ownerType: 'agent', ownerId: agentId })
}
export function deleteAllForSector(sectorId: ObjectId) {
  return deleteAllFor({ ownerType: 'sector', ownerId: sectorId })
}

export const VECTOR_INDEX_NAME = 'knowledge_vector_index'
export const EMBEDDING_DIMENSIONS = 1024

// The index filters on ownerId/ownerType (the new model) AND agentId (legacy rows),
// so search works during and after the transition.
const VECTOR_INDEX_DEFINITION = {
  fields: [
    { type: 'vector', path: 'embedding', numDimensions: EMBEDDING_DIMENSIONS, similarity: 'cosine' },
    { type: 'filter', path: 'agentId' },
    { type: 'filter', path: 'ownerId' },
    { type: 'filter', path: 'ownerType' },
  ],
}

export async function ensureVectorIndex() {
  try {
    // Atlas Search indexes can only be created on a collection that already
    // exists — and MongoDB only creates collections lazily on first write,
    // so before any knowledge document has been saved this is a no-op.
    await db.createCollection('knowledge_chunks').catch((error) => {
      if (error?.codeName !== 'NamespaceExists') throw error
    })

    const existing = await chunks.listSearchIndexes(VECTOR_INDEX_NAME).toArray()
    if (existing.length === 0) {
      await chunks.createSearchIndex({ name: VECTOR_INDEX_NAME, type: 'vectorSearch', definition: VECTOR_INDEX_DEFINITION })
      console.log(`Created Atlas Vector Search index "${VECTOR_INDEX_NAME}" (it can take a minute to finish building)`)
      return
    }
    // Idempotent upgrade: add the ownerId/ownerType filters to an index created
    // before shared sector knowledge existed.
    const current = existing[0] as { latestDefinition?: { fields?: { path?: string }[] } }
    const paths = new Set((current?.latestDefinition?.fields ?? []).map((f) => f.path))
    if (!paths.has('ownerId') || !paths.has('ownerType')) {
      await chunks.updateSearchIndex(VECTOR_INDEX_NAME, VECTOR_INDEX_DEFINITION)
      console.log(`Updated Atlas Vector Search index "${VECTOR_INDEX_NAME}" with owner filters`)
    }
  } catch (error) {
    console.error('Could not create/update the Atlas Vector Search index — knowledge search will be unavailable until this is fixed:', error)
  }
}

// Plain Mongo indexes for the CRUD/listing paths.
export async function ensureKnowledgeIndexes(): Promise<void> {
  await documents.createIndex({ ownerType: 1, ownerId: 1, createdAt: -1 })
  await chunks.createIndex({ ownerType: 1, ownerId: 1 })
  await chunks.createIndex({ documentId: 1 })
}

// Idempotent, non-destructive backfill: stamp ownerType/ownerId on rows written
// before the shared-knowledge model. Safe to re-run; reversible by simply ignoring
// the new fields (agentId is untouched).
export async function backfillKnowledgeOwners(): Promise<{ documents: number; chunks: number }> {
  const filter = { ownerType: { $exists: false }, agentId: { $ne: null } }
  const [d, c] = await Promise.all([
    documents.updateMany(filter, [{ $set: { ownerType: 'agent', ownerId: '$agentId' } }]),
    chunks.updateMany(filter, [{ $set: { ownerType: 'agent', ownerId: '$agentId' } }]),
  ])
  return { documents: d.modifiedCount, chunks: c.modifiedCount }
}

export interface KnowledgeHit {
  content: string
  score: number
  ownerType: KnowledgeOwnerType
  ownerId: string
  // Provenance, so an answer can cite where a passage came from. Safe by shape: an
  // id and a short title, both from the owner's own documents.
  documentId?: string
  title?: string
}

// Where a passage came from. Never crosses accounts: the hits it is built from are
// already restricted to owner-resolved bases.
export interface KnowledgeSource {
  documentId: string | null
  title: string | null
  ownerType: KnowledgeOwnerType
  ownerId: string
}

// Vector search across one or more owners (an agent plus, when the execution runs in
// a sector context, that sector). Owners are resolved server-side from
// ownership-checked ids, so a tenant can never reach another tenant's chunks.
export async function searchKnowledgeForOwners(owners: KnowledgeOwner[], query: string, limit = 5): Promise<KnowledgeHit[]> {
  if (owners.length === 0) return []
  const queryEmbedding = await embedText(query, 'query')
  const ownerIds = owners.map((o) => o.ownerId)
  // Legacy rows have no ownerId — match them by agentId for the agent owners.
  const agentIds = owners.filter((o) => o.ownerType === 'agent').map((o) => o.ownerId)
  const filter = agentIds.length ? { $or: [{ ownerId: { $in: ownerIds } }, { agentId: { $in: agentIds } }] } : { ownerId: { $in: ownerIds } }

  return chunks
    .aggregate<KnowledgeHit>([
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: 'embedding',
          queryVector: queryEmbedding,
          filter,
          limit,
          numCandidates: Math.max(limit * 10, 50),
        },
      },
      {
        $project: {
          _id: 0,
          content: 1,
          score: { $meta: 'vectorSearchScore' },
          ownerType: { $ifNull: ['$ownerType', 'agent'] },
          ownerId: { $toString: { $ifNull: ['$ownerId', '$agentId'] } },
          documentId: { $toString: '$documentId' },
        },
      },
      // The document's title, for provenance. A lookup bounded to the page of hits,
      // and the base filter above already restricted them to this owner's chunks.
      { $lookup: { from: 'knowledge_documents', localField: 'documentId', foreignField: '_id', as: 'doc' } },
      { $set: { title: { $ifNull: [{ $first: '$doc.title' }, null] } } },
      { $unset: 'doc' },
    ])
    .toArray()
}

/**
 * A busca que funciona sem Atlas e sem Voyage.
 *
 * Procura nos DOCUMENTOS, não nos chunks, de propósito: quando a indexação falha — e ela
 * falha inteira sem `VOYAGE_API_KEY` — nenhum chunk é gravado, mas o texto do documento
 * está lá, completo. Era esse o buraco: uma base visível na tela, com o dado dentro, e
 * uma busca que só sabia perguntar ao vetor que nunca existiu.
 *
 * O escopo é o MESMO da vetorial: os donos já resolvidos pelo chamador. Nenhum caminho
 * aqui alcança documento de outra conta.
 */
export async function searchKnowledgeLexicallyForOwners(owners: KnowledgeOwner[], query: string, limit = 5): Promise<KnowledgeHit[]> {
  if (owners.length === 0) return []
  const termos = extractTerms(query)
  if (termos.length === 0) return []

  // Quando há identificadores, o filtro do banco usa SÓ eles: é mais barato e evita
  // trazer todo documento que por acaso repete uma palavra comum da pergunta.
  const especificos = termos.filter((t) => t.weight > 1)
  const padrao = termsToPattern(especificos.length ? especificos : termos)
  if (!padrao) return []

  const ownerIds = owners.map((o) => o.ownerId)
  const agentIds = owners.filter((o) => o.ownerType === 'agent').map((o) => o.ownerId)
  const escopo = agentIds.length
    ? { $or: [{ ownerId: { $in: ownerIds } }, { agentId: { $in: agentIds } }] }
    : { ownerId: { $in: ownerIds } }

  const encontrados = await documents
    // `padrao` já vem escapado por `termsToPattern`: um termo com `.*` procura os
    // caracteres `.*`, e não "qualquer coisa" — que devolveria a base inteira.
    .find({ ...escopo, $and: [{ $or: [{ content: { $regex: padrao, $options: 'i' } }, { title: { $regex: padrao, $options: 'i' } }] }] })
    // Um teto de leitura: o corte por nota acontece depois, em memória.
    .limit(Math.max(limit * 4, 20))
    .toArray()

  return encontrados
    .map((doc) => ({
      content: extractWindow(doc.content ?? '', termos),
      score: scoreText(`${doc.title ?? ''}\n${doc.content ?? ''}`, termos),
      ownerType: (doc.ownerType ?? 'agent') as KnowledgeOwnerType,
      ownerId: String(doc.ownerId ?? doc.agentId ?? ''),
      documentId: String(doc._id),
      title: doc.title ?? undefined,
    }))
    .filter((hit) => hit.score > 0 && hit.content)
}

export function searchKnowledge(agentId: ObjectId, query: string, limit = 5) {
  return searchKnowledgeForOwners([{ ownerType: 'agent', ownerId: agentId }], query, limit)
}

// Retrieval budget: how much context a single execution may inject. Configurable via
// env so it can be tuned without a deploy of new code.
export const RETRIEVAL_TOP_K = Number(process.env.KNOWLEDGE_TOP_K ?? 6)
export const RETRIEVAL_CHAR_BUDGET = Number(process.env.KNOWLEDGE_CHAR_BUDGET ?? 6000)
// Relevance floor. A passage the vector search ranks below this is NOT context, it is
// noise that would be presented to the model as if it were curated knowledge. 0
// keeps the previous behaviour for an install that wants it.
export const RETRIEVAL_MIN_SCORE = Number(process.env.KNOWLEDGE_MIN_SCORE ?? 0.5)

// Pure: merge hits from several owners by relevance, drop duplicates (the same
// passage curated in both bases) and cut at top-K / the character budget. No LLM call
// — ranking is the vector score only.
export function combineKnowledgeHits(hits: KnowledgeHit[], opts: { topK?: number; charBudget?: number; minScore?: number } = {}): string[] {
  return selectKnowledgeHits(hits, opts).map((hit) => (hit.content ?? '').trim())
}

// The selection itself, keeping the hit (so provenance survives): relevance floor,
// then dedup, then top-K within the character budget.
export function selectKnowledgeHits(hits: KnowledgeHit[], opts: { topK?: number; charBudget?: number; minScore?: number } = {}): KnowledgeHit[] {
  const topK = opts.topK ?? RETRIEVAL_TOP_K
  const charBudget = opts.charBudget ?? RETRIEVAL_CHAR_BUDGET
  const minScore = opts.minScore ?? RETRIEVAL_MIN_SCORE
  const seen = new Set<string>()
  const out: KnowledgeHit[] = []
  let used = 0
  for (const hit of [...hits].sort((a, b) => b.score - a.score)) {
    const content = (hit.content ?? '').trim()
    if (!content) continue
    // Below the floor it never reaches the prompt: a weak match presented as curated
    // knowledge is worse than no knowledge at all.
    if (typeof hit.score === 'number' && hit.score < minScore) continue
    const key = content.replace(/\s+/g, ' ').toLowerCase()
    if (seen.has(key)) continue // same passage from agent + sector base
    if (used + content.length > charBudget) continue
    seen.add(key)
    out.push({ ...hit, content })
    used += content.length
    if (out.length >= topK) break
  }
  return out
}

// Retrieve the context for an execution: the agent's base, plus the sector's when the
// run happens in a sector context. A vector-search failure NEVER breaks the run — it
// returns no context and logs, so the agent answers without grounding.
// `verifiedSectorId` MUST come from an owner-scoped resolution (resolveOwnedSectorId
// or a sector loaded through getSectorById): this function does not — and cannot —
// check ownership, so passing a raw client-supplied id here is a bug.
// What happened to the grounding, in a word. Recorded as telemetry and, when the
// caller requires grounding, the difference between running and refusing.
//   ok          — passages above the floor were found;
//   empty       — the bases answered, and nothing was relevant enough;
//   no_base     — there was nothing to search;
//   unavailable — embedding/vector search FAILED. Never confused with 'empty': the
//                 model must not be told "there is no knowledge" when the truth is
//                 "we could not look".
export type GroundingStatus = 'ok' | 'empty' | 'no_base' | 'unavailable'

export interface RetrievalResult {
  context: string[]
  sources: KnowledgeSource[]
  status: GroundingStatus
  failed: boolean
  /**
   * Quantos trechos correspondiam, quando dá para saber — e não quantos couberam.
   *
   * Sem isto o modelo recebe seis passagens sem saber se são seis de seis ou seis de dois
   * mil. Nos dois casos ele responde com a mesma confiança, e no segundo a resposta é um
   * recorte arbitrário apresentado como conclusão.
   */
  totalMatches?: number
  /** A seleção foi cortada: existe mais do que o que está aqui. */
  truncated?: boolean
}

export async function retrieveContext(
  agentIds: ObjectId | ObjectId[],
  query: string,
  opts: { verifiedSectorId?: ObjectId | null; topK?: number; charBudget?: number; minScore?: number } = {},
): Promise<RetrievalResult> {
  const ids = Array.isArray(agentIds) ? agentIds : [agentIds]
  const owners: KnowledgeOwner[] = ids.map((id) => ({ ownerType: 'agent' as const, ownerId: id }))
  // The sector base joins ONLY with an explicit sector context — never implied by
  // the agent's home sector.
  if (opts.verifiedSectorId) owners.push({ ownerType: 'sector', ownerId: opts.verifiedSectorId })
  if (owners.length === 0 || !query.trim()) return { context: [], sources: [], status: 'no_base', failed: false }

  const emResultado = (
    selected: KnowledgeHit[],
    status: GroundingStatus,
    failed: boolean,
    encontrados?: number,
  ): RetrievalResult => ({
    context: selected.map((hit) => hit.content),
    sources: selected.map((hit) => ({
      documentId: hit.documentId ?? null,
      // Short by construction: a title is a label, not a document.
      title: hit.title ? String(hit.title).slice(0, 120) : null,
      ownerType: hit.ownerType,
      ownerId: hit.ownerId,
    })),
    status,
    failed,
    ...(encontrados !== undefined ? { totalMatches: encontrados } : {}),
    ...(encontrados !== undefined && encontrados > selected.length ? { truncated: true } : {}),
  })

  const limite = Math.max(opts.topK ?? RETRIEVAL_TOP_K, 5) * owners.length

  // --- metade 1: o vizinho semântico ------------------------------------------------------
  let vetorialFalhou = false
  let selecionados: KnowledgeHit[] = []
  let encontrados = 0
  try {
    const brutos = await searchKnowledgeForOwners(owners, query, limite)
    encontrados = brutos.length
    selecionados = selectKnowledgeHits(brutos, opts)
  } catch (error) {
    // Sem Atlas Search ou sem chave de embedding, ela falha SEMPRE. Isso não é "não há
    // conhecimento" — é "não consegui olhar por semelhança". A busca exata ainda pode.
    console.error('knowledge retrieval (vector) failed:', (error as Error).message)
    vetorialFalhou = true
  }
  if (selecionados.length > 0) return emResultado(selecionados, 'ok', false, encontrados)

  // --- metade 2: o termo exato ------------------------------------------------------------
  //
  // Roda quando a vetorial falhou OU não trouxe nada. Um ticker, uma data e um valor são
  // exatamente o que a semelhança erra e a comparação de texto acerta — e é o caso em que
  // dizer "não há dados" seria mentira sobre uma base que tem a resposta escrita.
  try {
    const brutosLexicais = await searchKnowledgeLexicallyForOwners(owners, query, limite)
    const lexicais = selectKnowledgeHits(brutosLexicais, opts)
    if (lexicais.length > 0) return emResultado(lexicais, 'ok', false, brutosLexicais.length)
  } catch (error) {
    console.error('knowledge retrieval (lexical) failed:', (error as Error).message)
    return emResultado([], 'unavailable', true)
  }

  // Nenhuma das duas achou. Se a semântica sequer rodou, o honesto é 'unavailable': a
  // busca exata não substitui a outra, e afirmar ausência aqui seria afirmar demais.
  return emResultado([], vetorialFalhou ? 'unavailable' : 'empty', vetorialFalhou)
}
