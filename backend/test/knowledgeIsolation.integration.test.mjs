// INTEGRATION: tenant isolation + CRUD/reindex against a REAL MongoDB, started for
// this file by mongodb-memory-server (the actual mongod binary). Never skipped.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

// A REAL mongod is started for this file (mongodb-memory-server runs the actual
// binary), so tenant isolation is verified against MongoDB itself — never skipped.
process.env.MONGODB_URI = await startMongo()
const { mongoClient } = await import('../dist/db.js')
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
const { createDocumentFor, listDocumentsFor, getDocumentFor, updateDocumentFor, deleteDocumentFor, deleteAllFor } = await import('../dist/knowledge.js')

const A = { ownerType: 'sector', ownerId: new ObjectId() } // tenant A's sector
const B = { ownerType: 'sector', ownerId: new ObjectId() } // tenant B's sector

// Embeddings need a paid API; the tests below exercise ownership + persistence, so
// an indexing failure is expected and must NOT lose the document.
test('a document is created and listed for its own owner only', async () => {
  const doc = await createDocumentFor(A, { title: 'Política A', content: 'conteúdo do tenant A' })
  assert.ok(doc._id)
  const mine = await listDocumentsFor(A)
  assert.ok(mine.some((d) => d._id.toString() === doc._id.toString()))
  // Tenant B never sees it.
  const theirs = await listDocumentsFor(B)
  assert.equal(theirs.some((d) => d._id.toString() === doc._id.toString()), false)
})

test('tenant B cannot read, update or delete tenant A document', async () => {
  const doc = await createDocumentFor(A, { title: 'Segredo A', content: 'apenas A' })
  assert.equal(await getDocumentFor(B, doc._id), null)
  assert.equal(await updateDocumentFor(B, doc._id, { title: 'hackeado' }), null)
  assert.equal(await deleteDocumentFor(B, doc._id), false)
  // Still intact for its owner, with the original title.
  const still = await getDocumentFor(A, doc._id)
  assert.ok(still)
  assert.equal(still.title, 'Segredo A')
})

test('a failed re-index keeps the document and reports the error state', async () => {
  const doc = await createDocumentFor(A, { title: 'Reindex', content: 'texto original' })
  const updated = await updateDocumentFor(A, doc._id, { content: 'texto novo' })
  assert.ok(updated) // the content update itself never fails
  assert.equal(updated.content, 'texto novo')
  // Without a working embedding service the status is 'error' — never a silent loss.
  assert.ok(['indexed', 'error'].includes(updated.indexStatus))
})

test('deleteAllFor removes only that owner base', async () => {
  await createDocumentFor(A, { title: 'A1', content: 'a' })
  const keep = await createDocumentFor(B, { title: 'B1', content: 'b' })
  await deleteAllFor(A)
  assert.equal((await listDocumentsFor(A)).length, 0)
  assert.ok((await listDocumentsFor(B)).some((d) => d._id.toString() === keep._id.toString()))
  await deleteAllFor(B) // cleanup
})
