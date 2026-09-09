// A MUDANÇA DE NOME não pode custar os dados de ninguém.
//
// "Arquiteto" virou "Assistente" — no produto, nas rotas, no código e nos nomes das
// coleções. O que NÃO pode mudar é o que já está gravado: os projetos, as conversas e as
// operações de quem já usava estão em `architect_*`, e o código passou a ler `assistant_*`.
// Sem migração, subir isso é uma conta que abre vazia.
//
// A migração é IDEMPOTENTE de propósito: ela roda em todo boot, e num banco já migrado —
// ou num banco novo, que nunca teve o nome antigo — ela não faz nada.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()

const { mongoClient, db } = await import('../dist/db.js')
const { migrarNomesDoAssistente } = await import('../dist/assistant/repository.js')

before(async () => { await mongoClient.connect() })
after(async () => { await mongoClient.close().catch(() => undefined); await stopMongo() })

beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).drop().catch(() => undefined)
})

test('ACEITAÇÃO: os projetos gravados com o nome antigo continuam lá', async () => {
  const id = new ObjectId()
  await db.collection('architect_projects').insertOne({ _id: id, ownerId: 'dono', title: 'Máximo do bitcoin' })
  await db.collection('architect_messages').insertOne({ _id: new ObjectId(), ownerId: 'dono', projectId: id, role: 'user', content: 'oi' })

  await migrarNomesDoAssistente()

  assert.equal(await db.collection('assistant_projects').countDocuments({ ownerId: 'dono' }), 1, 'o projeto sumiu na renomeação')
  assert.equal((await db.collection('assistant_projects').findOne({ _id: id })).title, 'Máximo do bitcoin')
  assert.equal(await db.collection('assistant_messages').countDocuments({ projectId: id }), 1, 'a conversa sumiu')
})

test('a MARCA de origem dentro dos recursos criados também acompanha', async () => {
  // É por ela que "desfazer" sabe o que a aplicação criou. Deixada para trás, o rollback
  // deixaria de reconhecer o que ele mesmo tinha feito.
  await db.collection('agents').insertOne({ _id: new ObjectId(), ownerId: 'dono', name: 'Marina', architect: { operationId: 'op1', blueprintKey: 'marina' } })
  await migrarNomesDoAssistente()
  const a = await db.collection('agents').findOne({ ownerId: 'dono' })
  assert.deepEqual(a.assistant, { operationId: 'op1', blueprintKey: 'marina' })
  assert.equal('architect' in a, false, 'ficou o campo velho junto — duas verdades sobre a mesma coisa')
})

test('AMEAÇA: rodar DUAS vezes não perde nada, e num banco novo não faz nada', async () => {
  const id = new ObjectId()
  await db.collection('architect_projects').insertOne({ _id: id, ownerId: 'dono', title: 'X' })
  await migrarNomesDoAssistente()
  await migrarNomesDoAssistente()
  assert.equal(await db.collection('assistant_projects').countDocuments({}), 1)

  // Banco novo: nada a migrar, e nenhuma exceção.
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).drop().catch(() => undefined)
  await migrarNomesDoAssistente()
  assert.equal(await db.collection('assistant_projects').countDocuments({}), 0)
})

test('AMEAÇA: se o nome NOVO já tem dados, a migração não os sobrescreve', async () => {
  /**
   * Os dois nomes existindo ao mesmo tempo é o estado de um deploy pela metade. Renomear por
   * cima trocaria o que já foi gravado no nome novo pelo retrato antigo — e o que se perde
   * aí é justamente o trabalho mais recente.
   */
  await db.collection('architect_projects').insertOne({ _id: new ObjectId(), ownerId: 'dono', title: 'velho' })
  await db.collection('assistant_projects').insertOne({ _id: new ObjectId(), ownerId: 'dono', title: 'novo' })
  await migrarNomesDoAssistente()
  const titulos = (await db.collection('assistant_projects').find({}).toArray()).map((p) => p.title)
  assert.ok(titulos.includes('novo'), 'sobrescreveu o que já estava no nome novo')
})
