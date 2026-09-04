// O QUE A EXECUÇÃO LEU — registrado pelo servidor.
//
// "Baseado em" era uma frase que o modelo escrevia: ele citava de memória, às vezes um
// documento que não foi consultado. O manifesto é o registro do lado de cá, e estes
// testes existem para que ele continue sendo isso — fato do servidor, nunca alegação.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.LLM_FAKE = '1'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.VOYAGE_API_KEY = ''

const { mongoClient, db } = await import('../dist/db.js')
const { retrieveForAgent } = await import('../dist/knowledgeRetrieval.js')
const { ensureContextManifestIndexes, getContextManifest, executionsUsingDocument, countExecutionsUsingDocument, deriveRequirement } = await import('../dist/contextManifest.js')
const { createDocumentFor, ensureKnowledgeIndexes } = await import('../dist/knowledge.js')
const { createAgent, getAgentById } = await import('../dist/agents.js')
const { createSector } = await import('../dist/sectors.js')
const { createFloor } = await import('../dist/floors.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')

const DONO = 'dono-manifesto'

before(async () => {
  await mongoClient.connect()
  await ensureKnowledgeIndexes()
  await ensureContextManifestIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

let cena
beforeEach(async () => {
  for (const c of ['knowledge_documents', 'knowledge_chunks', 'agents', 'sectors', 'offices', 'buildings', 'context_manifests']) {
    await db.collection(c).deleteMany({})
  }
  const andar = await createFloor(DONO, { name: 'Atendimento' })
  const agente = await createAgent(DONO, andar._id, 'Marina', { objective: 'atender' })
  const setor = await createSector(DONO, andar._id, 'Mesa', '#334455', 'orchestrated', [{ agentId: agente._id, order: 0 }])
  const predio = await ensureDefaultBuilding(DONO)
  const doc = await createDocumentFor({ ownerType: 'agent', ownerId: agente._id }, { title: 'Política PROT9911', content: 'O protocolo PROT9911 vale para todos os pedidos.' })
  const doAndar = await createDocumentFor({ ownerType: 'floor', ownerId: andar._id }, { title: 'Aviso PROT9911', content: 'O protocolo PROT9911 foi revisado no andar.' })
  cena = { andar, agente, setor, predio, doc, doAndar }
})

const politica = (p) => db.collection('agents').updateOne({ _id: cena.agente._id }, { $set: { knowledgeAccess: { version: 1, own: true, building: false, floor: false, sectorMode: 'none', selectedSectorIds: [], ...p } } })
const recarregar = () => getAgentById(DONO, cena.agente._id)

test('a execução grava o que pediu, o que podia e o que usou', async () => {
  await politica({ floor: true })
  const r = await retrieveForAgent(DONO, await recarregar(), 'PROT9911', {
    minScore: 0,
    execution: { executionId: 'exec-1', kind: 'playground' },
  })
  assert.equal(r.status, 'ok')

  const [m] = await getContextManifest(DONO, 'exec-1')
  assert.ok(m, 'a execução precisa deixar registro')
  assert.equal(m.executionKind, 'playground')
  assert.equal(m.version, 1)

  // O que a POLÍTICA permitiu — antes de qualquer busca.
  assert.deepEqual(m.allowed.map((a) => a.ownerType).sort(), ['agent', 'floor'])
  assert.deepEqual(m.requested.knowledge.map((k) => k.scope).sort(), ['agent', 'floor'])

  // O que foi USADO, com proveniência.
  assert.ok(m.knowledge.length > 0)
  for (const k of m.knowledge) {
    assert.ok(k.documentId, 'sem documento não há como conferir a citação')
    assert.ok(k.title)
    assert.equal(typeof k.topScore, 'number')
    assert.ok(k.reason, 'por que aquela base estava disponível')
    assert.equal(k.retrieval, 'lexical')
  }
  // E o orçamento que valia na hora.
  assert.ok(m.budget.charBudget > 0)
  assert.equal(m.budget.usedChunks, m.knowledge.length)
  assert.equal(m.groundingStatus, 'ok')
})

test('o manifesto registra o que foi IGNORADO, com o motivo', async () => {
  await politica({ floor: true })
  await retrieveForAgent(DONO, await recarregar(), 'PROT9911', {
    minScore: 0,
    topK: 1,
    execution: { executionId: 'exec-ignorado', kind: 'playground' },
  })
  const [m] = await getContextManifest(DONO, 'exec-ignorado')
  assert.equal(m.knowledge.length, 1)
  assert.ok(m.ignored.length > 0, '"não usou" sem motivo é uma reclamação sem endereço')
  assert.match(m.ignored[0].reason, /limite de trechos|orçamento|relevância|já tinha entrado/)
})

test('política que não dá base nenhuma grava "denied" — e não "não achei"', async () => {
  await politica({ own: false })
  const r = await retrieveForAgent(DONO, await recarregar(), 'PROT9911', { execution: { executionId: 'exec-negado', kind: 'playground' } })
  assert.equal(r.status, 'denied')
  const [m] = await getContextManifest(DONO, 'exec-negado')
  assert.equal(m.groundingStatus, 'denied')
  assert.deepEqual(m.allowed, [])
  assert.deepEqual(m.knowledge, [])
})

test('sem id de execução, nada é gravado — manifesto é registro de execução', async () => {
  await retrieveForAgent(DONO, await recarregar(), 'PROT9911', { minScore: 0 })
  assert.equal(await db.collection('context_manifests').countDocuments({}), 0, 'um manifesto por clique de tela seria ruído sem dono')
})

test('cobertura conta REQUISITOS obrigatórios, não confiança', async () => {
  // Sem grounding exigido, nada é obrigatório: cobertura cheia por não haver o que cobrir.
  await retrieveForAgent(DONO, await recarregar(), 'PROT9911', { minScore: 0, execution: { executionId: 'exec-cob', kind: 'playground' } })
  const [semExigir] = await getContextManifest(DONO, 'exec-cob')
  assert.equal(semExigir.coverage.required, 0)
  assert.equal(semExigir.coverage.score, 1)

  // Com grounding exigido, a base própria vira requisito — e ele foi satisfeito.
  await retrieveForAgent(DONO, await recarregar(), 'PROT9911', {
    minScore: 0,
    requireGrounding: true,
    execution: { executionId: 'exec-cob2', kind: 'playground' },
  })
  const [exigindo] = await getContextManifest(DONO, 'exec-cob2')
  assert.equal(exigindo.coverage.required, 1)
  assert.equal(exigindo.coverage.satisfied, 1)
  assert.equal(exigindo.coverage.missing, 0)

  // E quando não há o que encontrar, a falta aparece como falta.
  await retrieveForAgent(DONO, await recarregar(), 'assunto-que-nao-existe-em-lugar-nenhum', {
    requireGrounding: true,
    execution: { executionId: 'exec-cob3', kind: 'playground' },
  })
  const [semAchar] = await getContextManifest(DONO, 'exec-cob3')
  assert.equal(semAchar.coverage.required, 1)
  assert.equal(semAchar.coverage.missing, 1)
  assert.equal(semAchar.coverage.score, 0)
})

test('o manifesto NÃO guarda o conteúdo dos trechos nem a pergunta inteira', async () => {
  const segredo = 'SEGREDO-QUE-NAO-PODE-VAZAR-PARA-TELEMETRIA'
  await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'Sigiloso', content: `PROT9911 ${segredo}` })
  await retrieveForAgent(DONO, await recarregar(), `PROT9911 ${segredo}`, {
    minScore: 0,
    execution: { executionId: 'exec-sigilo', kind: 'playground' },
  })
  const [m] = await getContextManifest(DONO, 'exec-sigilo')
  const bruto = JSON.stringify({ ...m, requested: null })
  assert.equal(bruto.includes(segredo), false, 'telemetria não é uma segunda cópia do conteúdo')
  // A consulta entra recortada, para a lacuna poder ser agrupada depois — e só ela.
  assert.ok(m.requested.knowledge[0].query.length <= 300)
})

test('uso REAL por documento sai do manifesto, e não da permissão', async () => {
  await retrieveForAgent(DONO, await recarregar(), 'PROT9911', { minScore: 0, execution: { executionId: 'exec-uso-1', kind: 'routine' } })
  await retrieveForAgent(DONO, await recarregar(), 'PROT9911', { minScore: 0, execution: { executionId: 'exec-uso-2', kind: 'channel' } })

  const usos = await executionsUsingDocument(DONO, cena.doc._id.toString())
  assert.equal(usos.length, 2)
  assert.deepEqual(usos.map((u) => u.executionKind).sort(), ['channel', 'routine'])
  assert.equal(await countExecutionsUsingDocument(DONO, cena.doc._id.toString()), 2)

  // Um documento que ninguém leu tem zero — e zero aqui é evidência, não estimativa.
  assert.equal(await countExecutionsUsingDocument(DONO, new ObjectId().toString()), 0)
})

test('o manifesto de outra conta não é lido por esta', async () => {
  await retrieveForAgent(DONO, await recarregar(), 'PROT9911', { minScore: 0, execution: { executionId: 'exec-conta', kind: 'playground' } })
  assert.equal((await getContextManifest('outra-conta', 'exec-conta')).length, 0)
  assert.equal(await countExecutionsUsingDocument('outra-conta', cena.doc._id.toString()), 0)
})

test('os requisitos são DERIVADOS da política, sem chamar modelo', () => {
  const owners = [
    { ownerType: 'agent', ownerId: cena.agente._id, reason: 'own' },
    { ownerType: 'floor', ownerId: cena.andar._id, reason: 'floor' },
  ]
  const r = deriveRequirement(owners, 'qual é a política?', { requireGrounding: true })
  assert.equal(r.knowledge.length, 2)
  assert.equal(r.knowledge.find((k) => k.scope === 'agent').required, true)
  assert.equal(r.knowledge.find((k) => k.scope === 'floor').required, false, 'a base do andar não é obrigatória por si só')
  assert.deepEqual(r.liveData, [])
})
