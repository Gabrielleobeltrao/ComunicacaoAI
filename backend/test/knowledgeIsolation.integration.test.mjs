// INTEGRATION: tenant isolation + CRUD/reindex against a real MongoDB.
// Runs only when a Mongo is reachable (compose.dev.yml or a local mongod); it is
// SKIPPED — loudly, never silently green — otherwise:
//   MONGODB_URI=mongodb://127.0.0.1:27017/comunicacaoai_it node --test test/knowledgeIsolation.integration.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, ObjectId } from 'mongodb'

const URI = process.env.MONGODB_IT_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/comunicacaoai_it'

// Probe the server before importing app modules (they build lazy clients).
let reachable = false
try {
  const probe = new MongoClient(URI, { serverSelectionTimeoutMS: 800 })
  await probe.connect()
  await probe.db().command({ ping: 1 })
  await probe.close()
  reachable = true
} catch {
  reachable = false
}

if (!reachable) {
  console.warn(`[SKIP] knowledgeIsolation.integration: no MongoDB at ${URI} — start compose.dev.yml to run it.`)
}

process.env.MONGODB_URI = URI
const { createDocumentFor, listDocumentsFor, getDocumentFor, updateDocumentFor, deleteDocumentFor, deleteAllFor } = await import('../dist/knowledge.js')

const A = { ownerType: 'sector', ownerId: new ObjectId() } // tenant A's sector
const B = { ownerType: 'sector', ownerId: new ObjectId() } // tenant B's sector

// Embeddings need a paid API; the tests below exercise ownership + persistence, so
// an indexing failure is expected and must NOT lose the document.
test('a document is created and listed for its own owner only', { skip: !reachable }, async () => {
  const doc = await createDocumentFor(A, { title: 'Política A', content: 'conteúdo do tenant A' })
  assert.ok(doc._id)
  const mine = await listDocumentsFor(A)
  assert.ok(mine.some((d) => d._id.toString() === doc._id.toString()))
  // Tenant B never sees it.
  const theirs = await listDocumentsFor(B)
  assert.equal(theirs.some((d) => d._id.toString() === doc._id.toString()), false)
})

test('tenant B cannot read, update or delete tenant A document', { skip: !reachable }, async () => {
  const doc = await createDocumentFor(A, { title: 'Segredo A', content: 'apenas A' })
  assert.equal(await getDocumentFor(B, doc._id), null)
  assert.equal(await updateDocumentFor(B, doc._id, { title: 'hackeado' }), null)
  assert.equal(await deleteDocumentFor(B, doc._id), false)
  // Still intact for its owner, with the original title.
  const still = await getDocumentFor(A, doc._id)
  assert.ok(still)
  assert.equal(still.title, 'Segredo A')
})

test('a failed re-index keeps the document and reports the error state', { skip: !reachable }, async () => {
  const doc = await createDocumentFor(A, { title: 'Reindex', content: 'texto original' })
  const updated = await updateDocumentFor(A, doc._id, { content: 'texto novo' })
  assert.ok(updated) // the content update itself never fails
  assert.equal(updated.content, 'texto novo')
  // Without a working embedding service the status is 'error' — never a silent loss.
  assert.ok(['indexed', 'error'].includes(updated.indexStatus))
})

test('deleteAllFor removes only that owner base', { skip: !reachable }, async () => {
  await createDocumentFor(A, { title: 'A1', content: 'a' })
  const keep = await createDocumentFor(B, { title: 'B1', content: 'b' })
  await deleteAllFor(A)
  assert.equal((await listDocumentsFor(A)).length, 0)
  assert.ok((await listDocumentsFor(B)).some((d) => d._id.toString() === keep._id.toString()))
  await deleteAllFor(B) // cleanup
})
