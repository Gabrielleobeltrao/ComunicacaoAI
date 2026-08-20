import { ObjectId } from 'mongodb'
import { db } from './db.js'
import { embedText } from './voyage.js'

export interface ConversationTurn {
  _id: ObjectId
  agentId: ObjectId
  widgetId: ObjectId
  conversationId: string
  role: 'visitor' | 'agent'
  content: string
  embedding: number[]
  createdAt: Date
}

const turns = db.collection<ConversationTurn>('conversation_turns')

export const TURNS_VECTOR_INDEX_NAME = 'conversation_turns_vector_index'
export const EMBEDDING_DIMENSIONS = 1024

export async function ensureConversationTurnsVectorIndex() {
  try {
    // Same lazy-collection-creation caveat as the knowledge base index: Atlas
    // Search indexes need the collection to already exist.
    await db.createCollection('conversation_turns').catch((error) => {
      if (error?.codeName !== 'NamespaceExists') throw error
    })

    const existing = await turns.listSearchIndexes(TURNS_VECTOR_INDEX_NAME).toArray()
    if (existing.length > 0) return

    await turns.createSearchIndex({
      name: TURNS_VECTOR_INDEX_NAME,
      type: 'vectorSearch',
      definition: {
        fields: [
          { type: 'vector', path: 'embedding', numDimensions: EMBEDDING_DIMENSIONS, similarity: 'cosine' },
          { type: 'filter', path: 'agentId' },
          { type: 'filter', path: 'conversationId' },
        ],
      },
    })
    console.log(
      `Created Atlas Vector Search index "${TURNS_VECTOR_INDEX_NAME}" (it can take a minute to finish building)`,
    )
  } catch (error) {
    console.error(
      'Could not create the conversation-turns Atlas Vector Search index — semantic memory will be unavailable until this is fixed:',
      error,
    )
  }
}

export async function recordTurn(
  agentId: ObjectId,
  widgetId: ObjectId,
  conversationId: string,
  role: ConversationTurn['role'],
  content: string,
) {
  const embedding = await embedText(content, 'document', { operation: 'memory:index' })
  const turn: Omit<ConversationTurn, '_id'> = {
    agentId,
    widgetId,
    conversationId,
    role,
    content,
    embedding,
    createdAt: new Date(),
  }
  await turns.insertOne(turn as ConversationTurn)
}

export async function searchRelevantTurns(
  agentId: ObjectId,
  conversationId: string,
  query: string,
  limit = 6,
) {
  const queryEmbedding = await embedText(query, 'query', { operation: 'memory:search' })

  return turns
    .aggregate<{ role: ConversationTurn['role']; content: string; score: number }>([
      {
        $vectorSearch: {
          index: TURNS_VECTOR_INDEX_NAME,
          path: 'embedding',
          queryVector: queryEmbedding,
          filter: { agentId, conversationId },
          limit,
          numCandidates: Math.max(limit * 10, 50),
        },
      },
      {
        $project: {
          _id: 0,
          role: 1,
          content: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ])
    .toArray()
}
