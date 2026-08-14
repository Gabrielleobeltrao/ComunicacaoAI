// Shared knowledge: chunking + the pure combine step used when an execution reads
// the agent's base AND the sector's (relevance order, dedupe, top-K, char budget).
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { chunkText, combineKnowledgeHits, RETRIEVAL_TOP_K } = await import('../dist/knowledge.js')

const hit = (content, score, ownerType = 'agent') => ({ content, score, ownerType, ownerId: 'o1' })

test('chunkText splits paragraphs and long text with overlap', () => {
  assert.deepEqual(chunkText(''), [])
  assert.deepEqual(chunkText('um\n\ndois'), ['um', 'dois'])
  const long = 'x'.repeat(2000)
  const pieces = chunkText(long)
  assert.ok(pieces.length > 1)
  assert.ok(pieces.every((p) => p.length <= 800))
})

test('combineKnowledgeHits orders by relevance across owners', () => {
  const out = combineKnowledgeHits([hit('menos relevante', 0.2), hit('mais relevante', 0.9, 'sector'), hit('meio', 0.5)])
  assert.deepEqual(out, ['mais relevante', 'meio', 'menos relevante'])
})

test('combineKnowledgeHits dedupes the same passage curated in both bases', () => {
  const out = combineKnowledgeHits([hit('Politica de troca: 30 dias', 0.9), hit('politica de troca:   30 DIAS', 0.8, 'sector'), hit('outro', 0.7)])
  assert.equal(out.length, 2)
  assert.equal(out[0], 'Politica de troca: 30 dias')
})

test('combineKnowledgeHits honours top-K', () => {
  const many = Array.from({ length: 20 }, (_, i) => hit(`trecho ${i}`, 1 - i / 100))
  assert.equal(combineKnowledgeHits(many, { topK: 3 }).length, 3)
  assert.equal(combineKnowledgeHits(many).length, RETRIEVAL_TOP_K)
})

test('combineKnowledgeHits honours the character budget and skips oversized passages', () => {
  const out = combineKnowledgeHits([hit('a'.repeat(90), 0.9), hit('b'.repeat(90), 0.8), hit('c'.repeat(5), 0.7)], { charBudget: 100, topK: 10 })
  // first fits (90), second would exceed 100 and is skipped, third still fits
  assert.deepEqual(out, ['a'.repeat(90), 'c'.repeat(5)])
})

test('combineKnowledgeHits ignores empty passages', () => {
  assert.deepEqual(combineKnowledgeHits([hit('   ', 0.9), hit('real', 0.5)]), ['real'])
})
