// O chat de teste e o resto do sistema precisam usar a MESMA busca.
//
// O Playground chamava `searchKnowledge`, que é só a metade vetorial. A outra metade — a
// comparação de texto — existe exatamente para o caso em que a vetorial não tem o que
// comparar: um documento cujos trechos nunca foram gerados, porque a indexação depende
// de um provedor externo que pode falhar.
//
// O efeito era o mais difícil de diagnosticar que existe: a página lida, o texto
// guardado e visível na tela de Conhecimento, e o chat respondendo "não tenho esse
// dado" — enquanto a MESMA pergunta, feita através de um setor, encontrava.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
delete process.env.VOYAGE_API_KEY

const { createDocumentFor, retrieveContext, searchKnowledge } = await import('../dist/knowledge.js')
const { mongoClient, db } = await import('../dist/db.js')

const AGENT = new ObjectId()
const PERGUNTA = 'Qual o valor de encerramento no dia 18 de agosto de 2026'

before(async () => {
  // O estado exato do defeito: documento com o texto certo e ZERO trechos.
  const doc = await createDocumentFor(
    { ownerType: 'agent', ownerId: AGENT },
    {
      title: 'Histórico de preços — encerramento por dia',
      content: [
        'Histórico de preços — encerramento por dia',
        'Fonte: https://exemplo.test/historico',
        '',
        'Aug 20, 2026  71.49  72.45  71.25  71.86',
        'Aug 19, 2026  72.60  73.85  71.76  72.13',
        'Aug 18, 2026  70.99  72.71  70.85  71.55',
      ].join('\n'),
    },
  )
  assert.equal(doc.indexStatus, 'error', 'sem provedor de embedding, é assim que o documento fica')
  const salvo = await db.collection('knowledge_documents').findOne({ _id: doc._id })
  assert.equal(salvo.chunkCount, 0)
})

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

test('a busca só vetorial não acha nada — e era ela que o chat de teste usava', async () => {
  // Não é defeito dela: sem trechos, não há o que comparar por semelhança.
  const r = await searchKnowledge(AGENT, PERGUNTA).catch(() => [])
  assert.equal(r.length, 0)
})

test('a busca canônica ACHA, porque tem a metade que compara texto', async () => {
  const r = await retrieveContext([AGENT], PERGUNTA)
  assert.equal(r.status, 'ok', 'a resposta está guardada; dizer que não está é a pior saída')
  assert.match(r.context.join(' '), /Aug 18, 2026/)
  assert.match(r.context.join(' '), /71\.55/)
})

test('a procedência acompanha o trecho', async () => {
  const r = await retrieveContext([AGENT], PERGUNTA)
  assert.ok(r.sources.some((f) => (f.title ?? '').includes('Histórico de preços')))
})

test('base sem nada relacionado continua não inventando', async () => {
  const outro = new ObjectId()
  await createDocumentFor({ ownerType: 'agent', ownerId: outro }, { title: 'Cardápio', content: 'A casa serve massas e saladas no almoço.' })
  const r = await retrieveContext([outro], PERGUNTA)
  assert.notEqual(r.status, 'ok')
  assert.equal(r.context.length, 0)
})
