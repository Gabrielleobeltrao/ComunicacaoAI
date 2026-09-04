import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { db } from './db.js'
// Re-exported so every caller keeps importing it from here; it lives apart because
// the routine step needs it without pulling in the database.
export { buildRetrievalQuery } from './retrievalQuery.js'
import { embedText, embedTexts } from './voyage.js'
import { extractTerms, extractWindow, scoreDocument, scoreText, termsToPattern } from './lexicalRetrieval.js'

// Curated knowledge base (RAG) shared by the whole hierarchy. There is ONE store: the
// same `knowledge_documents` / `knowledge_chunks` collections, the same chunking, the
// same Voyage embeddings and the same Atlas Vector Search index — a document just
// belongs to an owner, which is a building, a floor, a sector or an agent.
//
// Quatro donos, uma base. A alternativa — uma coleção por escopo — obrigaria a busca a
// consultar quatro lugares, o orçamento de trechos a ser dividido antes de saber o que
// existe, e cada correção a ser feita quatro vezes. Aqui um documento tem UM dono
// canônico, e a busca combina escopos filtrando por `ownerType`/`ownerId`.
//
// Backwards compatibility: legacy rows only had `agentId`. Every row now also carries
// `ownerType` + `ownerId`, backfilled as ('agent', agentId) — and `agentId` keeps
// being written for agent-owned rows, so older code paths and any un-migrated reader
// keep working during the transition.
export type KnowledgeOwnerType = 'building' | 'floor' | 'sector' | 'agent'

export const KNOWLEDGE_OWNER_TYPES: readonly KnowledgeOwnerType[] = ['building', 'floor', 'sector', 'agent']

export const isKnowledgeOwnerType = (v: unknown): v is KnowledgeOwnerType => KNOWLEDGE_OWNER_TYPES.includes(v as KnowledgeOwnerType)

/**
 * O CICLO DE VIDA de um documento, e o peso dele.
 *
 * Os dois existem porque "o que a base sabe" não é uma pilha plana: uma política
 * oficial aprovada e um rascunho de alguém não podem valer a mesma coisa quando as
 * duas respondem a mesma pergunta. Os campos são gravados agora e passam a decidir
 * precedência quando o Context Engine existir; até lá, eles descrevem — não filtram.
 */
export type KnowledgeLifecycleStatus = 'draft' | 'approved' | 'archived'
export const KNOWLEDGE_LIFECYCLE_STATUSES: readonly KnowledgeLifecycleStatus[] = ['draft', 'approved', 'archived']

export type KnowledgeAuthority = 'official_policy' | 'procedure' | 'reference' | 'note'
export const KNOWLEDGE_AUTHORITIES: readonly KnowledgeAuthority[] = ['official_policy', 'procedure', 'reference', 'note']

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
  /**
   * A procedência de um documento que veio da WEB.
   *
   * Opcional: documento escrito à mão, enviado por arquivo ou salvo de uma execução não
   * tem nenhum destes campos, e continua exatamente como era. Para o que veio de um site,
   * é o que permite reconhecer a mesma página amanhã (`contentHash`), voltar à origem
   * (`canonicalUrl`) e perguntar por período (`publishedAt`).
   */
  web?: WebDocumentMeta
  // Indexing state so the UI can show "indexando…" / "erro ao indexar".
  indexStatus: 'indexed' | 'pending' | 'error'
  /**
   * POR QUE a indexação falhou. Sem isto, "erro ao indexar" é uma parede.
   *
   * O documento aparecia na tela com o texto certo e zero trechos, e não havia como
   * saber se o problema era chave ausente, cota estourada, modelo inexistente ou tamanho
   * — cada um com uma ação diferente, e nenhum deles visível para quem opera. O motivo
   * fica curto e sem segredo: nunca a chave, nunca o corpo inteiro da resposta.
   */
  indexError?: string | null
  /**
   * O hash do conteúdo que gerou os trechos ATUAIS.
   *
   * Embedding se paga por token, e reindexar um texto idêntico é gasto puro: mesma
   * conta, mesmo resultado. Salvar um documento sem mexer no texto — trocar o título,
   * reabrir o formulário, um autosave — refazia todos os trechos. Com o hash, só o que
   * mudou custa.
   */
  indexedHash?: string | null
  chunkCount: number
  /**
   * O formato do conteúdo. Markdown é o único hoje, e por isso o campo é opcional: um
   * documento antigo não o tem, e a leitura devolve 'markdown' sem reescrever nada.
   */
  format?: 'markdown'
  lifecycleStatus?: KnowledgeLifecycleStatus
  authority?: KnowledgeAuthority
  /** A janela em que este documento VALE. Ausente = vale sempre, que é o caso comum. */
  validFrom?: Date | null
  validUntil?: Date | null
  /** Quem conferiu, quando, e de quanto em quanto tempo isto precisa ser reconferido. */
  verifiedAt?: Date | null
  verifiedBy?: string | null
  reviewIntervalDays?: number | null
  /**
   * A confiança — SOMENTE quando ela vem de um processo verificável.
   *
   * Nunca preenchida pela interface e nunca por um modelo dizendo que está confiante:
   * um número inventado aqui viraria precedência real na hora de escolher o que
   * responde, e ninguém saberia de onde ele veio.
   */
  confidence?: { value: number; method: string; at: Date } | null
  /**
   * As ligações entre documentos, para a fase do grafo.
   *
   * Gravado agora, resolvido depois: o campo existe para que um documento escrito hoje
   * não precise ser reescrito quando os links passarem a ser navegáveis.
   */
  links?: { target: string; resolvedDocumentId?: ObjectId | null; label?: string }[]
  createdAt: Date
  updatedAt: Date
}

/**
 * O documento COMO ELE É LIDO — com os defaults dos campos que ainda não existiam.
 *
 * Aplicado na leitura, e não por migração: reescrever a coleção inteira para gravar
 * `format: 'markdown'` custaria uma passada em tudo o que já está lá, mudaria o
 * `updatedAt` de documentos que ninguém tocou e não acrescentaria uma informação
 * sequer — o default é a verdade sobre eles.
 *
 * `confidence` NÃO ganha default. Ausente significa "ninguém mediu", e um número
 * inventado aqui viraria precedência de verdade na hora de escolher o que responde.
 */
export function withKnowledgeDefaults<T extends Partial<KnowledgeDocument>>(doc: T): T & {
  format: 'markdown'
  lifecycleStatus: KnowledgeLifecycleStatus
  authority: KnowledgeAuthority
} {
  return {
    ...doc,
    format: doc.format ?? 'markdown',
    // `approved` é o default porque é o que os documentos existentes SÃO: eles já
    // respondem hoje. Nascer `draft` tiraria da busca tudo o que está gravado.
    lifecycleStatus: doc.lifecycleStatus ?? 'approved',
    authority: doc.authority ?? 'reference',
  }
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
  // Só o agente tem passado: linha antiga não tem `ownerType`, e casa por `agentId`.
  // Prédio, andar e setor nasceram com o modelo novo — não há linha legada deles.
  if (owner.ownerType === 'agent') {
    return { $or: [{ ownerType: 'agent', ownerId: owner.ownerId }, { ownerType: { $exists: false }, agentId: owner.ownerId }] }
  }
  return { ownerType: owner.ownerType, ownerId: owner.ownerId }
}


export interface WebDocumentMeta {
  sourceType: 'web'
  /** O endereço cadastrado que produziu este documento. */
  sourceId: string
  url: string
  canonicalUrl: string
  domain: string
  title: string | null
  author?: string | null
  publishedAt?: Date | null
  modifiedAt?: Date | null
  fetchedAt: Date
  /** Hash do TEXTO limpo. É ele que decide se vale reindexar. */
  contentHash: string
  /** Como esta página foi lida — HTTP direto ou navegador. */
  readMethod?: 'http' | 'browser'
  /**
   * Quem trouxe esta página: um site CADASTRADO pelo dono, ou uma BUSCA.
   *
   * A diferença governa o tempo de vida. Um site cadastrado tem política de releitura —
   * o dono mandou reler. Uma página achada por busca não tem: foi encontrada uma vez,
   * para uma pergunta, e sem prazo viraria um dado velho respondido como atual.
   */
  discoveredBy?: 'source' | 'search'
  /** A pergunta que levou até esta página. Ajuda a entender por que ela está na base. */
  query?: string | null
  /** Depois disto ela não é mais usada para responder. Ausente = não expira. */
  expiresAt?: Date | null
  /**
   * O que a página trazia em forma de dado, e não de prosa: tabelas, JSON-LD, pares
   * rótulo/valor. Vem com a HORA DA CAPTURA porque, para um número que muda, "quando
   * isto valia" é metade da informação.
   */
  structured?: {
    capturedAt: Date
    tables?: { caption?: string | null; headers: string[]; rows: string[][] }[]
    jsonLd?: unknown[]
    pairs?: Record<string, string>
  }
}

export interface CreateDocumentInput {
  title: string
  content: string
  source?: string | null
  sourceRef?: string | null
  authorId?: string | null
  web?: WebDocumentMeta
  lifecycleStatus?: KnowledgeLifecycleStatus
  authority?: KnowledgeAuthority
  validFrom?: Date | null
  validUntil?: Date | null
  verifiedAt?: Date | null
  verifiedBy?: string | null
  reviewIntervalDays?: number | null
  links?: KnowledgeDocument['links']
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
    ...(input.web ? { web: input.web } : {}),
    authorId: input.authorId ?? null,
    indexStatus: 'pending',
    chunkCount: 0,
    // Gravados no documento novo; ausentes continuam válidos nos antigos, onde o
    // default da leitura diz a mesma coisa.
    format: 'markdown',
    lifecycleStatus: input.lifecycleStatus ?? 'approved',
    authority: input.authority ?? 'reference',
    ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
    ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
    ...(input.verifiedAt !== undefined ? { verifiedAt: input.verifiedAt } : {}),
    ...(input.verifiedBy !== undefined ? { verifiedBy: input.verifiedBy } : {}),
    ...(input.reviewIntervalDays !== undefined ? { reviewIntervalDays: input.reviewIntervalDays } : {}),
    ...(input.links ? { links: input.links } : {}),
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
/**
 * O motivo em uma frase, sem segredo e sem parágrafo.
 *
 * A mensagem do provedor pode carregar a chave numa URL ou repetir o texto enviado. Aqui
 * sai só o suficiente para AGIR: qual é o problema e de quem é a vez de resolver.
 */
function limparMotivo(mensagem: string): string {
  return mensagem
    .replace(/(Bearer\s+|api[_-]?key["'\s:=]+)\S+/gi, '$1***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

function motivoDeIndexacao(error: unknown): string {
  const bruto = error instanceof Error ? error.message : String(error)
  // Os casos que têm ação conhecida ganham a frase que diz QUAL é a ação.
  if (/VOYAGE_API_KEY is not set/i.test(bruto)) return 'o provedor de embedding não está configurado neste servidor (VOYAGE_API_KEY ausente)'
  if (/\(401\)|unauthorized|invalid api key/i.test(bruto)) return 'o provedor de embedding recusou a chave (401)'
  if (/\(402\)|quota|insufficient|billing|credit/i.test(bruto)) return 'a conta do provedor de embedding está sem crédito ou cota (402)'
  if (/\(429\)|rate limit/i.test(bruto)) return 'o provedor de embedding pediu para diminuir o ritmo (429) — a próxima leitura tenta de novo'
  if (/model|not found|\(404\)/i.test(bruto)) return `o provedor não reconheceu o modelo de embedding configurado: ${limparMotivo(bruto)}`
  return limparMotivo(bruto)
}

async function indexDocumentChunks(
  owner: KnowledgeOwner,
  documentId: ObjectId,
  content: string,
): Promise<{ indexStatus: KnowledgeDocument['indexStatus']; chunkCount: number; indexError?: string }> {
  /**
   * Mesmo texto, mesmos trechos: não há o que refazer.
   *
   * `indexDocumentChunks` é o funil de TODA indexação — criar, atualizar e o "tentar
   * novamente". Colocar a comparação aqui cobre os três de uma vez, e evita o pior caso:
   * uma reindexação em laço (salvar → indexar → salvar) gastando franquia a cada volta
   * para chegar exatamente ao mesmo resultado.
   *
   * A verificação só vale quando os trechos EXISTEM. Um documento com hash igual e zero
   * trechos é o que falhou ao indexar — esse precisa tentar de novo.
   */
  const hash = hashDoConteudo(content)
  const atual = await documents.findOne({ _id: documentId }, { projection: { indexedHash: 1, chunkCount: 1 } })
  // A condição é "existem trechos, e eles vieram DESTE texto". O `indexStatus` não entra:
  // quem atualiza marca `pending` antes de chamar aqui, e olhar para ele faria a
  // verificação nunca valer justamente no caminho que ela existe para proteger.
  if (atual?.indexedHash === hash && (atual.chunkCount ?? 0) > 0) {
    await documents.updateOne({ _id: documentId }, { $set: { indexStatus: 'indexed', indexError: null } })
    return { indexStatus: 'indexed', chunkCount: atual.chunkCount ?? 0 }
  }

  const pieces = chunkText(content)
  if (pieces.length === 0) {
    await chunks.deleteMany({ documentId })
    await documents.updateOne({ _id: documentId }, { $set: { indexStatus: 'indexed', chunkCount: 0, indexError: null, indexedHash: hash } })
    return { indexStatus: 'indexed', chunkCount: 0 }
  }
  // Embed FIRST, swap after: the previous chunks stay searchable until the new ones
  // exist, so a failing embedding call never leaves the document unsearchable.
  let embeddings: number[][]
  try {
    embeddings = await embedTexts(pieces, 'document', {
      operation: 'knowledge:index',
      ownerId: owner.ownerType === 'agent' ? null : owner.ownerId.toString(),
      agentId: owner.ownerType === 'agent' ? owner.ownerId.toString() : null,
      sectorId: owner.ownerType === 'sector' ? owner.ownerId.toString() : null,
    })
  } catch (error) {
    const motivo = motivoDeIndexacao(error)
    console.error('knowledge indexing failed (previous version kept searchable):', motivo)
    const kept = await chunks.countDocuments({ documentId })
    await documents.updateOne({ _id: documentId }, { $set: { indexStatus: 'error', chunkCount: kept, indexError: motivo } })
    return { indexStatus: 'error', chunkCount: kept, indexError: motivo }
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
    const motivo = `ao gravar os trechos: ${limparMotivo((error as Error).message)}`
    console.error('knowledge chunk write failed (previous version kept searchable):', motivo)
    await chunks.deleteMany({ documentId, generation }) // roll back the partial write
    const kept = await chunks.countDocuments({ documentId })
    await documents.updateOne({ _id: documentId }, { $set: { indexStatus: 'error', chunkCount: kept, indexError: motivo } })
    return { indexStatus: 'error', chunkCount: kept, indexError: motivo }
  }
  // New generation is live — now drop the old one.
  await chunks.deleteMany({ documentId, generation: { $ne: generation } })
  await documents.updateOne({ _id: documentId }, { $set: { indexStatus: 'indexed', chunkCount: chunkDocs.length, indexError: null, indexedHash: hash } })
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
/**
 * O filtro de "isto veio da web".
 *
 * Duas escritas porque houve duas gerações: os primeiros documentos web trazem só
 * `source: 'web'`; os de agora trazem também `web.sourceType`. Perguntar pelas duas é o
 * que faz o que já estava gravado continuar aparecendo na aba certa.
 */
const FILTRO_WEB = { $or: [{ 'web.sourceType': 'web' }, { source: 'web' }] }

export interface DocumentQuery {
  kind?: 'all' | 'manual' | 'web'
  /** Só os documentos que ESTA fonte cadastrada produziu. */
  sourceId?: string | null
  status?: KnowledgeDocument['indexStatus'] | null
  /** Título, domínio ou endereço. O CONTEÚDO fica de fora — ver a nota abaixo. */
  search?: string | null
  limit?: number
  skip?: number
}

export interface DocumentPage {
  items: Omit<KnowledgeDocument, 'content'>[]
  total: number
  summary: { manual: number; web: number; total: number; lastWebFetchAt: Date | null }
}

const escaparRegex = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Uma página da base, com metadados e SEM o conteúdo.
 *
 * O conteúdo fica de fora de propósito: uma base alimentada por um site tem centenas de
 * artigos, e mandar todos inteiros para a tela seria megabytes para desenhar uma lista. O
 * texto vem quando alguém abre um documento, e só o dele.
 *
 * A busca cobre título, domínio e endereço — o que identifica um documento numa lista.
 * Procurar dentro do texto exigiria varrer a coleção inteira a cada tecla; para isso
 * existe a busca de conhecimento, que é o que o agente usa.
 */
export async function listDocumentsPage(owner: KnowledgeOwner, query: DocumentQuery = {}): Promise<DocumentPage> {
  const escopo = ownerFilter(owner)
  /**
   * O escopo do dono entra por `$and`, e nunca por espalhamento.
   *
   * `ownerFilter` devolve `{$or: […]}` para um agente (o formato antigo, sem `ownerType`,
   * casa por `agentId`). O filtro de "isto veio da web" TAMBÉM é um `$or` — e espalhar os
   * dois no mesmo objeto fazia o segundo apagar o primeiro. O resultado não era um número
   * errado: era uma listagem SEM dono, capaz de mostrar documento de outro agente e de
   * outra conta.
   */
  const partes: Record<string, unknown>[] = [escopo]
  if (query.kind === 'web') partes.push(FILTRO_WEB)
  if (query.kind === 'manual') partes.push({ $nor: [FILTRO_WEB] })
  const filtro: Record<string, unknown> = { $and: partes }
  if (query.sourceId) partes.push({ 'web.sourceId': query.sourceId })
  if (query.status) partes.push({ indexStatus: query.status })
  if (query.search?.trim()) {
    const padrao = escaparRegex(query.search.trim())
    // Mais uma cláusula do MESMO `$and`: sobrescrevê-lo apagaria o escopo do dono.
    partes.push({
      $or: [
        { title: { $regex: padrao, $options: 'i' } },
        { 'web.canonicalUrl': { $regex: padrao, $options: 'i' } },
        { 'web.domain': { $regex: padrao, $options: 'i' } },
      ],
    })
  }

  const limite = Math.min(Math.max(Number(query.limit) || 50, 1), 200)
  const pular = Math.max(Number(query.skip) || 0, 0)
  const [items, total, web, todos, ultimo] = await Promise.all([
    documents.find(filtro, { projection: { content: 0 } }).sort({ updatedAt: -1, createdAt: -1 }).skip(pular).limit(limite).toArray(),
    documents.countDocuments(filtro),
    documents.countDocuments({ $and: [escopo, FILTRO_WEB] }),
    documents.countDocuments(escopo),
    documents.find({ $and: [escopo, FILTRO_WEB] }, { projection: { 'web.fetchedAt': 1 } }).sort({ 'web.fetchedAt': -1 }).limit(1).toArray(),
  ])
  return {
    items: items as Omit<KnowledgeDocument, 'content'>[],
    total,
    summary: { manual: todos - web, web, total: todos, lastWebFetchAt: ultimo[0]?.web?.fetchedAt ?? null },
  }
}

/** Quantos documentos ESTA fonte cadastrada produziu. É a resposta de "o que ela me deu". */
export function countDocumentsFromSource(owner: KnowledgeOwner, sourceId: string): Promise<number> {
  return documents.countDocuments({ ...ownerFilter(owner), 'web.sourceId': sourceId })
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

export interface UpdateDocumentInput {
  title?: string
  content?: string
  web?: WebDocumentMeta
  lifecycleStatus?: KnowledgeLifecycleStatus
  authority?: KnowledgeAuthority
  validFrom?: Date | null
  validUntil?: Date | null
  verifiedAt?: Date | null
  verifiedBy?: string | null
  reviewIntervalDays?: number | null
  links?: KnowledgeDocument['links']
}

export async function updateDocumentFor(owner: KnowledgeOwner, documentId: ObjectId, updates: UpdateDocumentInput) {
  const setFields: Partial<KnowledgeDocument> = { updatedAt: new Date() }
  if (updates.title !== undefined) setFields.title = updates.title
  if (updates.web !== undefined) setFields.web = updates.web
  for (const campo of ['lifecycleStatus', 'authority', 'validFrom', 'validUntil', 'verifiedAt', 'verifiedBy', 'reviewIntervalDays', 'links'] as const) {
    if (updates[campo] !== undefined) (setFields as Record<string, unknown>)[campo] = updates[campo]
  }
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

/** O hash de um conteúdo, para decidir se vale gastar embedding com ele. */
const hashDoConteudo = (texto: string): string => createHash('sha256').update(texto).digest('hex')
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
/**
 * Andar e prédio apagados levam a base deles junto.
 *
 * Sem isto, apagar um andar deixaria documentos e chunks apontando para um dono que
 * não existe: invisíveis em qualquer tela, contados na cota da conta para sempre, e
 * ainda alcançáveis pela busca vetorial, que filtra por `ownerId` e não pergunta se
 * aquele id ainda é de alguém.
 */
export function deleteAllForFloor(floorId: ObjectId) {
  return deleteAllFor({ ownerType: 'floor', ownerId: floorId })
}
export function deleteAllForBuilding(buildingId: ObjectId) {
  return deleteAllFor({ ownerType: 'building', ownerId: buildingId })
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
  // A listagem ordena por `updatedAt` — sem este índice ela ordena em memória, e uma
  // base grande passa a custar uma varredura por página.
  await documents.createIndex({ ownerType: 1, ownerId: 1, updatedAt: -1 })
  await chunks.createIndex({ ownerType: 1, ownerId: 1 })
  await chunks.createIndex({ documentId: 1 })
  /**
   * Um documento por endereço, por dono — garantido pelo BANCO.
   *
   * Duas buscas simultâneas podem achar a mesma página. Sem esta garantia, as duas
   * "não encontram nada" ao mesmo tempo e as duas criam: viram duas cópias, dois
   * embeddings pagos e o mesmo texto aparecendo duas vezes na resposta.
   *
   * PARCIAL de propósito: só vale onde `sourceRef` existe. Documento escrito à mão não
   * tem o campo e fica de fora — a regra não pode impedir dois documentos manuais.
   *
   * A criação é tolerante: numa base que já tenha duplicados de antes, o índice único
   * falha ao ser criado. Nesse caso o aviso fica no log e o sistema segue — a proteção
   * de escrita (abaixo) não depende dele para funcionar, e apagar dado de alguém para
   * criar um índice não é uma troca aceitável.
   */
  await documents
    .createIndex(
      { ownerType: 1, ownerId: 1, sourceRef: 1 },
      { unique: true, partialFilterExpression: { sourceRef: { $type: 'string' } }, name: 'owner_sourceRef_unico' },
    )
    .catch((erro) => {
      console.warn(
        '[conhecimento] não foi possível criar o índice único de sourceRef (provavelmente há duplicados anteriores). ' +
          'A gravação continua protegida contra corrida; convém consolidar os duplicados:',
        (erro as Error).message,
      )
    })
}

/**
 * O documento deste dono com esta marca de origem — ou nada.
 *
 * Existe para não carregar a base inteira só para procurar um endereço. Numa base de
 * quinhentos documentos, achar um por varredura em memória é meio segundo e um pico de
 * memória por busca.
 */
export async function findBySourceRef(owner: KnowledgeOwner, sourceRef: string): Promise<KnowledgeDocument | null> {
  return documents.findOne({ ...ownerFilter(owner), sourceRef }, { projection: { content: 0 } }) as Promise<KnowledgeDocument | null>
}

/**
 * O ESTADO DE REVISÃO de um documento — calculado, nunca perguntado a um modelo.
 *
 * Comparar datas é aritmética. Uma LLM decidindo se um documento venceu erraria de vez
 * em quando, custaria por documento e não teria como ser reproduzida — três razões, e
 * qualquer uma bastaria.
 */
export type ReviewState = 'ok' | 'due_for_review' | 'expiring_soon' | 'expired'

export function reviewStateOf(
  doc: Pick<KnowledgeDocument, 'validUntil' | 'verifiedAt' | 'reviewIntervalDays' | 'updatedAt'>,
  now: Date = new Date(),
  soonDays = 14,
): ReviewState {
  const venceEm = doc.validUntil ? new Date(doc.validUntil).getTime() : null
  if (venceEm !== null && venceEm <= now.getTime()) return 'expired'
  if (venceEm !== null && venceEm - now.getTime() <= soonDays * 86400_000) return 'expiring_soon'
  if (doc.reviewIntervalDays && doc.reviewIntervalDays > 0) {
    // Sem verificação registrada, a última edição é o melhor que existe — e é honesto
    // dizer que ela conta como "a última vez que alguém olhou".
    const base = doc.verifiedAt ? new Date(doc.verifiedAt).getTime() : new Date(doc.updatedAt).getTime()
    if (now.getTime() - base >= doc.reviewIntervalDays * 86400_000) return 'due_for_review'
  }
  return 'ok'
}

/**
 * Os documentos que precisam de atenção — vencidos, vencendo e com revisão atrasada.
 *
 * Uma varredura por escopo, com o cálculo feito no banco: trazer a base inteira para
 * decidir em memória é exatamente o que a cota existe para impedir.
 */
export async function listDocumentsNeedingReview(owner: KnowledgeOwner, now: Date = new Date(), soonDays = 14) {
  const limite = new Date(now.getTime() + soonDays * 86400_000)
  const docs = await documents
    .find(
      {
        $and: [
          ownerFilter(owner),
          { $or: [{ validUntil: { $lte: limite } }, { reviewIntervalDays: { $gt: 0 } }] },
        ],
      },
      { projection: { content: 0 } },
    )
    .limit(500)
    .toArray()
  return docs
    .map((d) => ({ document: d as Omit<KnowledgeDocument, 'content'>, state: reviewStateOf(d, now, soonDays) }))
    .filter((x) => x.state !== 'ok')
}

/**
 * A busca encontra ESTE documento por ESTE assunto, neste escopo?
 *
 * É a conferência de que uma lacuna foi mesmo resolvida. Fica na camada de conhecimento,
 * e não na rota, porque quem sabe buscar é quem sabe buscar — e porque a regra de que
 * ninguém procura por donos fora daqui vale inclusive para uma conferência.
 *
 * Não envolve política de acesso: aqui não há agente respondendo, há um escopo sendo
 * conferido contra um assunto.
 */
export async function scopeSearchFinds(owner: KnowledgeOwner, subject: string, documentId: ObjectId): Promise<boolean> {
  const r = await retrieveForOwners([owner], subject, { minScore: 0 })
  return r.sources.some((s) => s.documentId === documentId.toString())
}

/** Só o carimbo de validade: renovar não reescreve texto e não gera embedding. */
export async function touchWebDocument(owner: KnowledgeOwner, documentId: ObjectId, fetchedAt: Date, expiresAt: Date | null): Promise<void> {
  await documents.updateOne(
    { _id: documentId, ...ownerFilter(owner) },
    { $set: { 'web.fetchedAt': fetchedAt, 'web.expiresAt': expiresAt, updatedAt: new Date() } },
  )
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
  /** QUANDO este conteúdo foi capturado. Para um dado que muda, é metade da informação. */
  capturedAt?: Date
  /**
   * De onde este trecho veio: escrito à mão ou lido de um site.
   *
   * Para quem PERGUNTA os dois são a mesma coisa — a resposta. Para quem confere, não:
   * um número lido de um site tem uma hora de captura e um endereço para voltar; um
   * texto escrito à mão tem um autor. Sem a marca, uma resposta que mistura os dois não
   * dá para auditar.
   */
  origin?: 'manual' | 'web' | 'search'
}

// Where a passage came from. Never crosses accounts: the hits it is built from are
// already restricted to owner-resolved bases.
export interface KnowledgeSource {
  documentId: string | null
  title: string | null
  ownerType: KnowledgeOwnerType
  ownerId: string
  /** Quanto este trecho casou com a pergunta. É o que torna a seleção discutível. */
  score?: number
  /**
   * Como este trecho chegou: por semelhança, por termo exato ou por expansão de ligação.
   *
   * As três erram de jeitos diferentes, e é por esta marca que o eval consegue medir se
   * a expansão pelo grafo ajudou ou só ocupou o orçamento.
   */
  retrieval?: 'vector' | 'lexical' | 'graph_expansion'
  /** Por que a base deste trecho estava disponível: própria, do andar, do setor… */
  reason?: string
  /** QUANDO foi capturado. Uma resposta sobre "hoje" precisa saber a idade da fonte. */
  capturedAt?: string | null
  /** Escrito à mão ou lido de um site. Ausente quando a origem não foi resolvida. */
  origin?: 'manual' | 'web' | 'search'
}

// Vector search across one or more owners (an agent plus, when the execution runs in
// a sector context, that sector). Owners are resolved server-side from
// ownership-checked ids, so a tenant can never reach another tenant's chunks.
export async function searchKnowledgeForOwners(
  owners: KnowledgeOwner[],
  query: string,
  limit = 5,
  filtros?: KnowledgeFilters | null,
): Promise<KnowledgeHit[]> {
  if (owners.length === 0) return []
  const queryEmbedding = await embedText(query, 'query', {
    operation: 'knowledge:search',
    agentId: owners.find((o) => o.ownerType === 'agent')?.ownerId.toString() ?? null,
    sectorId: owners.find((o) => o.ownerType === 'sector')?.ownerId.toString() ?? null,
  })
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
      // O recorte por metadado mora no DOCUMENTO, não no chunk. Aplicá-lo aqui evita
      // duplicar `publishedAt`/`domain` em cada pedaço — que envelheceria em separado.
      // O que VENCEU não responde — nem aqui, nem na busca exata. E o recorte por
      // metadado mora no DOCUMENTO, não no chunk.
      {
        $match: {
          $or: [{ 'doc.web.expiresAt': { $exists: false } }, { 'doc.web.expiresAt': null }, { 'doc.web.expiresAt': { $gt: new Date() } }],
        },
      },
      // Arquivado, rascunho e vencido não respondem como fato atual. O recorte vem do
      // DOCUMENTO — o chunk não guarda ciclo de vida, e duplicá-lo nele envelheceria
      // em separado na primeira edição.
      { $match: prefixarDoc(curationFilter()) },
      ...(Object.keys(metadataFilter(filtros)).length > 0
        ? [
            {
              $match: Object.fromEntries(
                Object.entries(metadataFilter(filtros)).map(([chave, valor]) => [`doc.${chave.replace(/^web\./, 'web.')}`, valor]),
              ),
            },
          ]
        : []),
      {
        $set: {
          title: { $ifNull: [{ $first: '$doc.title' }, null] },
          // A origem vem do documento, e não do chunk: é o documento que sabe se nasceu
          // de um site ou da mão de alguém.
          origin: {
            $cond: [
              { $eq: [{ $first: '$doc.web.discoveredBy' }, 'search'] },
              'search',
              { $cond: [{ $ifNull: [{ $first: '$doc.web' }, false] }, 'web', 'manual'] },
            ],
          },
          capturedAt: { $first: '$doc.web.fetchedAt' },
        },
      },
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
/**
 * Recortes por METADADO, para conteúdo que tem tempo.
 *
 * Uma base de notícias sem "só o que saiu esta semana" obriga o modelo a ler tudo e
 * decidir por conta — que é caro e erra. O recorte é determinístico e acontece ANTES da
 * busca: o que está fora do período nem chega a ser comparado.
 *
 * Ausente = tudo, que é como a busca sempre funcionou.
 */
/**
 * O que NÃO responde uma pergunta sobre o estado atual.
 *
 * Arquivado nunca: ele foi tirado de circulação por alguém, e voltar pela busca seria
 * desfazer a decisão em silêncio. Vencido também não — mas por outro motivo: ele PODE
 * ser a única evidência histórica que existe, e por isso o filtro é opcional. Quem
 * pergunta "qual é a política hoje" não pode receber a de 2023 como fato; quem pergunta
 * "o que valia em 2023" precisa dela, e aí ela vem marcada como histórica.
 *
 * Rascunho e proposta ficam de fora pelo mesmo motivo que uma proposta não vira
 * documento sozinha: o que ainda não foi aprovado não responde em nome da empresa.
 */
/**
 * O mesmo recorte, escrito para o documento que veio por `$lookup`.
 *
 * O `$lookup` traz `doc` como ARRAY, e um filtro sobre `doc.campo` casa quando qualquer
 * elemento casa — que aqui é o único, então a semântica é a desejada. O prefixo é
 * aplicado por função para as duas buscas usarem a MESMA regra: duas cópias divergiriam
 * na primeira mudança de política, e a que erra seria a que ninguém está lendo.
 */
export function prefixarDoc(filtro: Record<string, unknown>): Record<string, unknown> {
  const prefixar = (f: Record<string, unknown>): Record<string, unknown> => {
    const fora: Record<string, unknown> = {}
    for (const [chave, valor] of Object.entries(f)) {
      if (chave === '$and' || chave === '$or' || chave === '$nor') {
        fora[chave] = (valor as Record<string, unknown>[]).map(prefixar)
      } else {
        fora[`doc.${chave}`] = valor
      }
    }
    return fora
  }
  return prefixar(filtro)
}

export function curationFilter(now: Date = new Date(), opts: { includeExpired?: boolean; includeDrafts?: boolean } = {}): Record<string, unknown> {
  const partes: Record<string, unknown>[] = [
    // Ausente = aprovado: é o default de leitura dos documentos que já existiam.
    opts.includeDrafts
      ? { lifecycleStatus: { $ne: 'archived' } }
      : { $or: [{ lifecycleStatus: { $exists: false } }, { lifecycleStatus: 'approved' }] },
  ]
  if (!opts.includeExpired) {
    partes.push({ $or: [{ validUntil: { $exists: false } }, { validUntil: null }, { validUntil: { $gt: now } }] })
    partes.push({ $or: [{ validFrom: { $exists: false } }, { validFrom: null }, { validFrom: { $lte: now } }] })
  }
  return { $and: partes }
}

export interface KnowledgeFilters {
  /** Só documentos publicados a partir desta data (metadado declarado pela página). */
  publishedAfter?: Date | null
  publishedBefore?: Date | null
  /** Só de um domínio, ou de um endereço cadastrado específico. */
  domain?: string | null
  sourceId?: string | null
}

/** O filtro Mongo equivalente. Vazio quando não há recorte nenhum — nada muda. */
export function metadataFilter(filtros?: KnowledgeFilters | null): Record<string, unknown> {
  if (!filtros) return {}
  const filtro: Record<string, unknown> = {}
  const publicado: Record<string, Date> = {}
  if (filtros.publishedAfter) publicado.$gte = filtros.publishedAfter
  if (filtros.publishedBefore) publicado.$lte = filtros.publishedBefore
  if (Object.keys(publicado).length > 0) filtro['web.publishedAt'] = publicado
  if (filtros.domain) filtro['web.domain'] = filtros.domain
  if (filtros.sourceId) filtro['web.sourceId'] = filtros.sourceId
  return filtro
}

/**
 * Quantos documentos DESTES donos existem com a indexação falhada.
 *
 * Exportada porque o escopo de dono é a parte que precisa de teste: uma contagem que
 * vaze para outra conta faria a busca de um dono ficar indisponível por causa do
 * documento quebrado de outro.
 */
export async function countUnindexedFor(owners: KnowledgeOwner[]): Promise<number> {
  if (owners.length === 0) return 0
  return documents.countDocuments({ $and: [{ $or: owners.map(ownerFilter) }, { indexStatus: 'error' }] }).catch(() => 0)
}

/**
 * O filtro que exclui o que VENCEU.
 *
 * Uma página que um buscador trouxe tem prazo: ela foi encontrada uma vez, para uma
 * pergunta, e ninguém mandou relê-la. Passado o prazo, ela não responde mais — nem por
 * semelhança, nem por texto exato.
 *
 * Documento sem `expiresAt` (tudo que o dono curou, e todo site cadastrado) não expira:
 * a ausência do campo é o comportamento de sempre, o que mantém as bases existentes
 * intactas.
 */
const naoVencido = (agora: Date) => ({ $or: [{ 'web.expiresAt': { $exists: false } }, { 'web.expiresAt': null }, { 'web.expiresAt': { $gt: agora } }] })

export async function searchKnowledgeLexicallyForOwners(
  owners: KnowledgeOwner[],
  query: string,
  limit = 5,
  filtros?: KnowledgeFilters | null,
): Promise<KnowledgeHit[]> {
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
    .find({
      ...escopo,
      // O recorte por metadado entra ANTES da comparação de texto: o que está fora do
      // período nem chega a ser lido.
      ...metadataFilter(filtros),
      $and: [
        naoVencido(new Date()),
        // O MESMO recorte curatorial da busca vetorial: arquivado, rascunho e vencido
        // não respondem como fato atual, e a regra não pode depender de qual das duas
        // buscas atendeu a pergunta.
        curationFilter(),
        { $or: [{ content: { $regex: padrao, $options: 'i' } }, { title: { $regex: padrao, $options: 'i' } }] },
      ],
    })
    // Um teto de leitura: o corte por nota acontece depois, em memória.
    .limit(Math.max(limit * 4, 20))
    .toArray()

  return encontrados
    .map((doc) => ({
      content: extractWindow(doc.content ?? '', termos),
      // O título conta como evidência específica: é a etiqueta que o dono escreveu.
      score: scoreDocument(doc.title, doc.content ?? '', termos),
      ownerType: (doc.ownerType ?? 'agent') as KnowledgeOwnerType,
      ownerId: String(doc.ownerId ?? doc.agentId ?? ''),
      documentId: String(doc._id),
      title: doc.title ?? undefined,
      // Três origens, e a diferença governa a CONFIANÇA: o que o dono escreveu, o site
      // que ele cadastrou, e o que um buscador trouxe uma vez. A última é a que envelhece
      // sem ninguém mandar reler.
      origin: doc.web?.discoveredBy === 'search' ? ('search' as const) : doc.web ? ('web' as const) : ('manual' as const),
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
export interface IgnoredHit {
  kind: string
  ref: string
  reason: string
}

/**
 * A seleção, com o motivo de cada descarte.
 *
 * "Não usou" sem motivo é uma reclamação sem endereço: o dono vê o documento na tela,
 * vê o agente respondendo sem ele, e não tem como saber se foi score baixo, orçamento
 * cheio ou texto repetido. Cada um desses tem uma ação diferente.
 */
export function selectKnowledgeHitsDetailed(
  hits: KnowledgeHit[],
  opts: { topK?: number; charBudget?: number; minScore?: number } = {},
): { selected: KnowledgeHit[]; ignored: IgnoredHit[] } {
  const topK = opts.topK ?? RETRIEVAL_TOP_K
  const charBudget = opts.charBudget ?? RETRIEVAL_CHAR_BUDGET
  const minScore = opts.minScore ?? RETRIEVAL_MIN_SCORE
  const seen = new Set<string>()
  const out: KnowledgeHit[] = []
  const ignored: IgnoredHit[] = []
  const descartar = (hit: KnowledgeHit, reason: string) => {
    if (ignored.length < 20) ignored.push({ kind: 'chunk', ref: hit.documentId ?? hit.title ?? '(sem id)', reason })
  }
  let used = 0
  for (const hit of [...hits].sort((a, b) => b.score - a.score)) {
    const content = (hit.content ?? '').trim()
    if (!content) continue
    if (out.length >= topK) {
      descartar(hit, 'o limite de trechos já tinha sido alcançado')
      continue
    }
    // Below the floor it never reaches the prompt: a weak match presented as curated
    // knowledge is worse than no knowledge at all.
    if (typeof hit.score === 'number' && hit.score < minScore) {
      descartar(hit, `relevância abaixo do mínimo (${hit.score.toFixed(2)} < ${minScore})`)
      continue
    }
    const key = content.replace(/\s+/g, ' ').toLowerCase()
    if (seen.has(key)) {
      // same passage from agent + sector base
      descartar(hit, 'o mesmo texto já tinha entrado por outra base')
      continue
    }
    if (used + content.length > charBudget) {
      descartar(hit, 'não cabia no orçamento de caracteres')
      continue
    }
    seen.add(key)
    out.push({ ...hit, content })
    used += content.length
  }
  return { selected: out, ignored }
}

export function selectKnowledgeHits(hits: KnowledgeHit[], opts: { topK?: number; charBudget?: number; minScore?: number } = {}): KnowledgeHit[] {
  return selectKnowledgeHitsDetailed(hits, opts).selected
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
/**
 * O que aconteceu na busca — e os quatro casos precisam continuar distinguíveis.
 *
 * `empty` é "procurei e não achei". `unavailable` é "não consegui procurar" — e é o que
 * impede o agente de afirmar ausência sobre uma base que tem a resposta escrita.
 * `no_base` é "não há base para procurar". `denied` é a política: este agente não tem
 * base nenhuma, e isso não é o mesmo que não existir conhecimento. `conflict` é o pior
 * de todos para esconder — dois documentos dizem coisas diferentes e a regra não decidiu
 * qual vale.
 */
export type GroundingStatus = 'ok' | 'empty' | 'no_base' | 'unavailable' | 'denied' | 'conflict'

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
  /**
   * A RELEVÂNCIA do melhor trecho, de 0 a 1.
   *
   * Ela era calculada e jogada fora aqui. Quem decide se vale procurar na web recebia só a
   * CONTAGEM de trechos — e dois trechos que apenas mencionam o assunto contam igual a
   * dois que respondem a pergunta. Era por isso que uma base com informação incompleta
   * bloqueava a busca: "trouxe 2 trechos" parecia suficiente.
   */
  topScore?: number
  /** A seleção foi cortada: existe mais do que o que está aqui. */
  truncated?: boolean
  /** O que foi visto e NÃO entrou, com o motivo. Vai para o manifesto. */
  ignored?: IgnoredHit[]
  /** Autoridade e validade de cada documento selecionado, para o manifesto e a precedência. */
  documentMeta?: Map<string, { authority: string | null; validAtExecution: boolean | null }>
}

/**
 * A busca nas bases QUE ESTE AGENTE PODE LER — quatro escopos, um orçamento só.
 *
 * O orçamento é global de propósito: `topK`, teto de caracteres e score mínimo valem
 * para a seleção inteira, e não por escopo. Um orçamento por escopo daria quatro vezes
 * mais contexto para quem tem quatro bases ligadas — e o trecho fraco do prédio entraria
 * na frente do trecho forte do agente só porque cada um tinha sua cota.
 *
 * Quem decide QUAIS bases é `resolveKnowledgeOwnersForExecution`. Aqui já chegam
 * resolvidas: esta função não sabe de política e não recebe id de cliente.
 */
export async function retrieveForOwners(
  owners: (KnowledgeOwner & { reason?: string })[],
  query: string,
  opts: { topK?: number; charBudget?: number; minScore?: number; filters?: KnowledgeFilters | null } = {},
): Promise<RetrievalResult> {
  if (owners.length === 0 || !query.trim()) return { context: [], sources: [], status: 'no_base', failed: false }

  // De qual base veio, e por quê — para a proveniência dizer "do setor Mesa, porque a
  // execução começou nele" em vez de repetir um id.
  const motivo = new Map<string, string>()
  for (const o of owners) if (o.reason) motivo.set(`${o.ownerType}:${o.ownerId.toString()}`, o.reason)

  let descartados: IgnoredHit[] = []
  const emResultado = (
    selected: KnowledgeHit[],
    status: GroundingStatus,
    failed: boolean,
    retrieval?: 'vector' | 'lexical',
    encontrados?: number,
  ): RetrievalResult => ({
    ignored: descartados,
    context: selected.map((hit) => hit.content),
    ...(selected.length > 0 ? { topScore: Math.max(...selected.map((h) => (typeof h.score === 'number' ? h.score : 0))) } : {}),
    sources: selected.map((hit) => ({
      documentId: hit.documentId ?? null,
      // Short by construction: a title is a label, not a document.
      title: hit.title ? String(hit.title).slice(0, 120) : null,
      ownerType: hit.ownerType,
      ownerId: hit.ownerId,
      ...(typeof hit.score === 'number' ? { score: hit.score } : {}),
      ...(retrieval ? { retrieval } : {}),
      ...(motivo.has(`${hit.ownerType}:${hit.ownerId}`) ? { reason: motivo.get(`${hit.ownerType}:${hit.ownerId}`) } : {}),
      ...(hit.origin ? { origin: hit.origin } : {}),
      ...(hit.capturedAt ? { capturedAt: new Date(hit.capturedAt).toISOString() } : {}),
    })),
    status,
    failed,
    ...(encontrados !== undefined ? { totalMatches: encontrados } : {}),
    ...(encontrados !== undefined && encontrados > selected.length ? { truncated: true } : {}),
  })

  /**
   * O quanto se BUSCA cresce com o número de bases; o quanto se ESCOLHE, não.
   *
   * Trazer poucos candidatos de quatro bases faria a seleção global escolher entre
   * sobras: cada base devolveria só os seus melhores, e o melhor do conjunto poderia
   * nem ter sido lido. O corte continua sendo um só, depois.
   */
  const limite = Math.max(opts.topK ?? RETRIEVAL_TOP_K, 5) * owners.length

  // --- metade 1: o vizinho semântico ------------------------------------------------------
  let vetorialFalhou = false
  let selecionados: KnowledgeHit[] = []
  let encontrados = 0
  try {
    const brutos = await searchKnowledgeForOwners(owners, query, limite, opts.filters)
    encontrados = brutos.length
    const escolha = selectKnowledgeHitsDetailed(brutos, opts)
    selecionados = escolha.selected
    descartados = escolha.ignored
  } catch (error) {
    // Sem Atlas Search ou sem chave de embedding, ela falha SEMPRE. Isso não é "não há
    // conhecimento" — é "não consegui olhar por semelhança". A busca exata ainda pode.
    console.error('knowledge retrieval (vector) failed:', (error as Error).message)
    vetorialFalhou = true
  }
  if (selecionados.length > 0) return await comMetadados(emResultado(selecionados, 'ok', false, 'vector', encontrados))

  // --- metade 2: o termo exato ------------------------------------------------------------
  //
  // Roda quando a vetorial falhou OU não trouxe nada. Um ticker, uma data e um valor são
  // exatamente o que a semelhança erra e a comparação de texto acerta — e é o caso em que
  // dizer "não há dados" seria mentira sobre uma base que tem a resposta escrita.
  try {
    const brutosLexicais = await searchKnowledgeLexicallyForOwners(owners, query, limite, opts.filters)
    const escolhaLexical = selectKnowledgeHitsDetailed(brutosLexicais, opts)
    if (escolhaLexical.selected.length > 0) {
      descartados = escolhaLexical.ignored
      return await comMetadados(emResultado(escolhaLexical.selected, 'ok', false, 'lexical', brutosLexicais.length))
    }
  } catch (error) {
    console.error('knowledge retrieval (lexical) failed:', (error as Error).message)
    return emResultado([], 'unavailable', true)
  }

  /**
   * Nenhuma das duas achou. Mas "não achei" e "não consegui procurar" são coisas
   * diferentes, e a base pode estar num terceiro estado: TEM o documento e não conseguiu
   * indexá-lo.
   *
   * Esse caso produzia a pior resposta possível. O agente lia "nada encontrado",
   * concluía que não tinha base e respondia "não tenho acesso a esse tipo de dado" — com
   * o texto guardado, visível na tela de Conhecimento, e sem um único trecho para a
   * busca semântica alcançar. Dizer 'unavailable' aqui não conserta a indexação; impede
   * a resposta que afirma ausência sobre uma base que tem a informação.
   */
  if ((await countUnindexedFor(owners)) > 0) return emResultado([], 'unavailable', true)

  // Se a semântica sequer rodou, o honesto é 'unavailable': a busca exata não substitui
  // a outra, e afirmar ausência aqui seria afirmar demais.
  return emResultado([], vetorialFalhou ? 'unavailable' : 'empty', vetorialFalhou)
}

/**
 * A autoridade e a validade de cada documento selecionado.
 *
 * Uma leitura a mais por busca, e ela paga por si: é o que permite ao manifesto dizer
 * "isto veio de uma política oficial e estava válida na hora", e é o que a precedência
 * usa quando dois trechos se contradizem. Sem ela, os dois chegariam ao modelo com o
 * mesmo peso e ele escolheria sozinho, sem dizer que escolheu.
 */
async function comMetadados(r: RetrievalResult): Promise<RetrievalResult> {
  const ids = [...new Set(r.sources.map((s) => s.documentId).filter(Boolean))] as string[]
  if (ids.length === 0) return r
  const agora = new Date()
  const docs = await documents
    .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } }, { projection: { authority: 1, lifecycleStatus: 1, validFrom: 1, validUntil: 1 } })
    .toArray()
  const meta = new Map<string, { authority: string | null; validAtExecution: boolean | null }>()
  for (const d of docs) {
    // `null` quando o documento não declara janela nenhuma: "sem validade declarada" não
    // é o mesmo que "válido", e um `true` aqui inventaria uma conferência que ninguém fez.
    const temJanela = d.validFrom || d.validUntil
    const valido = !temJanela
      ? null
      : (!d.validFrom || new Date(d.validFrom) <= agora) && (!d.validUntil || new Date(d.validUntil) > agora)
    meta.set(d._id.toString(), { authority: (d.authority as string) ?? null, validAtExecution: valido })
  }
  return { ...r, documentMeta: meta }
}

/**
 * A forma ANTIGA: agentes mais, se houver, o setor validado da execução.
 *
 * Mantida porque há um chamador que ainda não tem agente carregado (o widget monta a
 * lista a partir do canal). Ela não decide política nenhuma — monta os mesmos donos que
 * o comportamento legado sempre montou e entrega para a busca acima.
 */
export async function retrieveContext(
  agentIds: ObjectId | ObjectId[],
  query: string,
  opts: { verifiedSectorId?: ObjectId | null; topK?: number; charBudget?: number; minScore?: number; filters?: KnowledgeFilters | null } = {},
): Promise<RetrievalResult> {
  const ids = Array.isArray(agentIds) ? agentIds : [agentIds]
  const owners: (KnowledgeOwner & { reason?: string })[] = ids.map((id) => ({ ownerType: 'agent' as const, ownerId: id, reason: 'own' }))
  // The sector base joins ONLY with an explicit sector context — never implied by
  // the agent's home sector.
  if (opts.verifiedSectorId) owners.push({ ownerType: 'sector', ownerId: opts.verifiedSectorId, reason: 'execution_sector' })
  return retrieveForOwners(owners, query, opts)
}
