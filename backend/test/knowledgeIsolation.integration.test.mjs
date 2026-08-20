// INTEGRATION: tenant isolation + CRUD/reindex against a REAL MongoDB, started for
// this file by mongodb-memory-server (the actual mongod binary). Never skipped.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

// A REAL mongod is started for this file (mongodb-memory-server runs the actual
// binary), so tenant isolation is verified against MongoDB itself — never skipped.
process.env.MONGODB_URI = await startMongo()
const { mongoClient, db } = await import('../dist/db.js')
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
const { createDocumentFor, listDocumentsFor, getDocumentFor, updateDocumentFor, deleteDocumentFor, deleteAllFor, retrieveContext, countUnindexedFor, reindexDocumentFor } = await import('../dist/knowledge.js')

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

// --- a base não mente sobre si mesma -----------------------------------------------------
//
// Um documento que existe e NÃO pôde ser indexado deixava a base com cara de vazia. O
// agente lia "nada encontrado", concluía que não tinha base e respondia "não tenho acesso
// a esse tipo de dado" — com o texto guardado e visível na tela de Conhecimento.

test('documento não indexado torna a busca INDISPONÍVEL, e não vazia', async () => {
  const agentId = new ObjectId()
  const doc = await createDocumentFor(
    { ownerType: 'agent', ownerId: agentId },
    { title: 'Histórico de leituras', content: 'Uma tabela longa que o provedor de embedding recusou.' },
  )
  // O estado real do caso: texto guardado, zero trechos.
  await db.collection('knowledge_documents').updateOne({ _id: doc._id }, { $set: { indexStatus: 'error', chunkCount: 0 } })

  const r = await retrieveContext([agentId], 'uma pergunta que não casa com nada disto')
  assert.equal(r.status, 'unavailable', 'afirmar ausência sobre uma base que tem o texto é a pior resposta possível')
  assert.equal(r.context.length, 0)
})

test('a contagem de não indexados é por DONO', async () => {
  // Uma contagem que vaze para outra conta deixaria a busca de um dono indisponível por
  // causa do documento quebrado de outro. Aqui a busca inteira não distingue os estados
  // (sem chave de embedding tudo volta indisponível), então o que se prova é o escopo.
  const meu = new ObjectId()
  const outro = new ObjectId()
  const doAgente = await createDocumentFor({ ownerType: 'agent', ownerId: outro }, { title: 'Do outro', content: 'x' })
  await db.collection('knowledge_documents').updateOne({ _id: doAgente._id }, { $set: { indexStatus: 'error', chunkCount: 0 } })

  assert.equal(await countUnindexedFor([{ ownerType: 'agent', ownerId: meu }]), 0)
  assert.equal(await countUnindexedFor([{ ownerType: 'agent', ownerId: outro }]), 1)
  assert.equal(await countUnindexedFor([]), 0)
})

// --- "erro ao indexar" precisa dizer O QUE houve --------------------------------------------
//
// Sem o motivo, o dono vê o texto certo na tela, zero trechos, e uma parede. Chave
// ausente, cota estourada, modelo desconhecido e ritmo pedem ações DIFERENTES — e
// nenhuma delas dá para escolher sem saber qual é o caso.

test('a falha de indexação grava o motivo, e ele diz de quem é a vez', async () => {
  const agentId = new ObjectId()
  // Sem chave de embedding — o caso mais comum, e o mais fácil de confundir com defeito.
  const doc = await createDocumentFor({ ownerType: 'agent', ownerId: agentId }, { title: 'Nota', content: 'Um conteúdo qualquer para indexar.' })

  assert.equal(doc.indexStatus, 'error')
  const salvo = await db.collection('knowledge_documents').findOne({ _id: doc._id })
  assert.match(salvo.indexError, /não está configurado neste servidor/)
  assert.match(salvo.indexError, /VOYAGE_API_KEY/)
})

test('o motivo nunca carrega a chave nem o corpo inteiro da resposta', async () => {
  const agentId = new ObjectId()
  const doc = await createDocumentFor({ ownerType: 'agent', ownerId: agentId }, { title: 'Nota', content: 'x'.repeat(50) })
  const salvo = await db.collection('knowledge_documents').findOne({ _id: doc._id })
  assert.ok(salvo.indexError.length <= 200, 'motivo é uma frase, não um parágrafo')
  assert.ok(!/Bearer\s+\S/.test(salvo.indexError))
})

test('quando a indexação dá certo, o motivo antigo é apagado', async () => {
  const agentId = new ObjectId()
  // Conteúdo vazio não gera trecho nenhum: indexa com sucesso sem chamar o provedor.
  const doc = await createDocumentFor({ ownerType: 'agent', ownerId: agentId }, { title: 'Nota', content: 'algo' })
  await db.collection('knowledge_documents').updateOne({ _id: doc._id }, { $set: { content: '' } })

  const r = await reindexDocumentFor({ ownerType: 'agent', ownerId: agentId }, doc._id)
  assert.equal(r.indexStatus, 'indexed')
  const salvo = await db.collection('knowledge_documents').findOne({ _id: doc._id })
  assert.equal(salvo.indexError, null, 'um motivo que sobra depois do conserto vira mentira na tela')
})
