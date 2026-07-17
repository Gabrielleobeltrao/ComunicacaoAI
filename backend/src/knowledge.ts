import { ObjectId } from 'mongodb'
import { db } from './db.js'
import { embedText, embedTexts } from './voyage.js'

export interface KnowledgeDocument {
  _id: ObjectId
  agentId: ObjectId
  title: string
  content: string
  createdAt: Date
  updatedAt: Date
}

export interface KnowledgeChunk {
  _id: ObjectId
  agentId: ObjectId
  documentId: ObjectId
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

export async function createDocument(agentId: ObjectId, title: string, content: string) {
  const now = new Date()
  const document: Omit<KnowledgeDocument, '_id'> = {
    agentId,
    title,
    content,
    createdAt: now,
    updatedAt: now,
  }
  const result = await documents.insertOne(document as KnowledgeDocument)
  const documentId = result.insertedId

  await indexDocumentChunks(agentId, documentId, content)

  return { ...document, _id: documentId }
}

async function indexDocumentChunks(agentId: ObjectId, documentId: ObjectId, content: string) {
  await chunks.deleteMany({ documentId })

  const pieces = chunkText(content)
  if (pieces.length === 0) return

  const embeddings = await embedTexts(pieces, 'document')

  const chunkDocs: Omit<KnowledgeChunk, '_id'>[] = pieces.map((piece, index) => ({
    agentId,
    documentId,
    content: piece,
    embedding: embeddings[index],
    createdAt: new Date(),
  }))

  await chunks.insertMany(chunkDocs as KnowledgeChunk[])
}

export function listDocuments(agentId: ObjectId) {
  return documents
    .find({ agentId }, { projection: { content: 0 } })
    .sort({ createdAt: -1 })
    .toArray()
}

export function getDocument(agentId: ObjectId, documentId: ObjectId) {
  return documents.findOne({ _id: documentId, agentId })
}

export async function updateDocument(
  agentId: ObjectId,
  documentId: ObjectId,
  updates: { title?: string; content?: string },
) {
  const setFields: Partial<KnowledgeDocument> = { updatedAt: new Date() }
  if (updates.title !== undefined) setFields.title = updates.title
  if (updates.content !== undefined) setFields.content = updates.content

  const result = await documents.findOneAndUpdate(
    { _id: documentId, agentId },
    { $set: setFields },
    { returnDocument: 'after' },
  )
  if (!result) return null

  if (updates.content !== undefined) {
    await indexDocumentChunks(agentId, documentId, updates.content)
  }

  return result
}

export async function deleteDocument(agentId: ObjectId, documentId: ObjectId) {
  await chunks.deleteMany({ agentId, documentId })
  const result = await documents.deleteOne({ _id: documentId, agentId })
  return result.deletedCount > 0
}

export const VECTOR_INDEX_NAME = 'knowledge_vector_index'
export const EMBEDDING_DIMENSIONS = 1024

export async function ensureVectorIndex() {
  try {
    // Atlas Search indexes can only be created on a collection that already
    // exists — and MongoDB only creates collections lazily on first write,
    // so before any knowledge document has been saved this is a no-op.
    await db.createCollection('knowledge_chunks').catch((error) => {
      if (error?.codeName !== 'NamespaceExists') throw error
    })

    const existing = await chunks.listSearchIndexes(VECTOR_INDEX_NAME).toArray()
    if (existing.length > 0) return

    await chunks.createSearchIndex({
      name: VECTOR_INDEX_NAME,
      type: 'vectorSearch',
      definition: {
        fields: [
          { type: 'vector', path: 'embedding', numDimensions: EMBEDDING_DIMENSIONS, similarity: 'cosine' },
          { type: 'filter', path: 'agentId' },
        ],
      },
    })
    console.log(`Created Atlas Vector Search index "${VECTOR_INDEX_NAME}" (it can take a minute to finish building)`)
  } catch (error) {
    console.error(
      'Could not create the Atlas Vector Search index — knowledge search will be unavailable until this is fixed:',
      error,
    )
  }
}

export async function searchKnowledge(agentId: ObjectId, query: string, limit = 5) {
  const queryEmbedding = await embedText(query, 'query')

  return chunks
    .aggregate<{ content: string; score: number }>([
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: 'embedding',
          queryVector: queryEmbedding,
          filter: { agentId },
          limit,
          numCandidates: Math.max(limit * 10, 50),
        },
      },
      {
        $project: {
          _id: 0,
          content: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ])
    .toArray()
}
