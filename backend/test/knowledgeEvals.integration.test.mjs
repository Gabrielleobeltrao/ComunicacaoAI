// OS EVALS — e a limpeza que exige confirmação.
//
// O eval existe para responder uma pergunta com dado em vez de impressão: a expansão pelo
// grafo ajuda? A resposta decide se a flag fica ligada. E o caso que mais importa não é
// "encontrou": é "não vazou" — um retrieval que traz tudo acerta todos os casos de
// encontrar e entrega o setor que o agente não podia ler.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.LLM_FAKE = '1'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.VOYAGE_API_KEY = ''

const { mongoClient, db } = await import('../dist/db.js')
const { ensureKnowledgeIndexes, createDocumentFor } = await import('../dist/knowledge.js')
const { runContextEvals, compareRuns } = await import('../dist/knowledgeEvals.js')
const { cleanupMigratedMemories, migrateArchitectKnowledge, ensureKnowledgeMigrationIndexes, auditArchitectMemoryMigration } = await import('../dist/knowledgeMigration.js')
const { ensureContextManifestIndexes } = await import('../dist/contextManifest.js')
const { ensureKnowledgeGapIndexes } = await import('../dist/knowledgeGaps.js')
const { ensureKnowledgeConflictIndexes } = await import('../dist/knowledgeConflicts.js')
const { createAgent, getAgentById } = await import('../dist/agents.js')
const { createSector } = await import('../dist/sectors.js')
const { createFloor } = await import('../dist/floors.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')
const { writeMemory } = await import('../dist/memory/records.js')

const DONO = 'dono-evals'

before(async () => {
  await mongoClient.connect()
  await ensureKnowledgeIndexes()
  await ensureKnowledgeMigrationIndexes()
  await ensureContextManifestIndexes()
  await ensureKnowledgeGapIndexes()
  await ensureKnowledgeConflictIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

let cena
beforeEach(async () => {
  for (const c of ['knowledge_documents', 'knowledge_chunks', 'agents', 'sectors', 'offices', 'buildings', 'memories', 'knowledge_migrations', 'context_manifests', 'knowledge_gaps', 'knowledge_conflicts']) {
    await db.collection(c).deleteMany({})
  }
  const andar = await createFloor(DONO, { name: 'Atendimento' })
  const marina = await createAgent(DONO, andar._id, 'Marina', { objective: 'atender' })
  const outroAgente = await createAgent(DONO, andar._id, 'Rafael', { objective: 'analisar' })
  const setorAlheio = await createSector(DONO, andar._id, 'Retaguarda', '#556677', 'orchestrated', [{ agentId: outroAgente._id, order: 0 }])
  const predio = await ensureDefaultBuilding(DONO)
  cena = { andar, marina, outroAgente, setorAlheio, predio }
})

const politica = (p) =>
  db.collection('agents').updateOne({ _id: cena.marina._id }, { $set: { knowledgeAccess: { version: 1, own: true, building: false, floor: false, sectorMode: 'none', selectedSectorIds: [], ...p } } })
const recarregar = () => getAgentById(DONO, cena.marina._id)

test('o eval mede acerto, vazamento, orçamento e latência', async () => {
  await politica({ own: true, floor: true })
  const daBase = await createDocumentFor({ ownerType: 'agent', ownerId: cena.marina._id }, { title: 'Política PROT1000', content: 'A política PROT1000 diz que o prazo é curto.' })
  const doSetorAlheio = await createDocumentFor({ ownerType: 'sector', ownerId: cena.setorAlheio._id }, { title: 'Segredo PROT1000', content: 'O PROT1000 da retaguarda é outro assunto.' })

  const r = await runContextEvals(DONO, await recarregar(), [
    { id: 'acha-a-propria', query: 'PROT1000', expectDocumentIds: [daBase._id.toString()], forbidDocumentIds: [doSetorAlheio._id.toString()] },
    // A base TEM documentos que não puderam ser indexados (não há provedor de embedding
    // aqui). O estado honesto é "não consegui procurar direito", e não "não há nada" —
    // é justamente a confusão que produzia o agente afirmando ausência sobre base cheia.
    { id: 'nao-conseguiu-procurar', query: 'assunto-que-nao-existe-em-lugar-nenhum', expectDocumentIds: [], expectStatus: 'unavailable' },
  ], { label: 'baseline' })

  assert.equal(r.cases, 2)
  assert.equal(r.passed, 2, JSON.stringify(r.outcomes, null, 1))
  assert.deepEqual(r.outcomes[0].leaked, [], 'o setor que ela não lê não pode aparecer')
  assert.ok(r.avgLatencyMs >= 0)
  assert.ok(r.avgChunks >= 0)
})

test('o eval REPROVA quando vaza escopo não autorizado', async () => {
  // Com o setor ligado, o documento proibido aparece — e o eval precisa dizer isso, e não
  // comemorar que "encontrou".
  await politica({ own: true, sectorMode: 'selected', selectedSectorIds: [cena.setorAlheio._id] })
  const proibido = await createDocumentFor({ ownerType: 'sector', ownerId: cena.setorAlheio._id }, { title: 'Proibido PROT2000', content: 'O PROT2000 é da retaguarda.' })

  const r = await runContextEvals(DONO, await recarregar(), [
    { id: 'nao-pode-vazar', query: 'PROT2000', expectDocumentIds: [], forbidDocumentIds: [proibido._id.toString()] },
  ], { label: 'vazamento' })
  assert.equal(r.passed, 0)
  assert.deepEqual(r.outcomes[0].leaked, [proibido._id.toString()])
})

test('a comparação decide a flag com DADO, e recusa empate caro', async () => {
  await politica({ own: true, floor: true })
  const principal = await createDocumentFor({ ownerType: 'agent', ownerId: cena.marina._id }, { title: 'Principal PROT3000', content: 'O procedimento PROT3000 tem um anexo.' })
  const anexo = await createDocumentFor({ ownerType: 'floor', ownerId: cena.andar._id }, { title: 'Anexo PROT3000', content: 'O anexo do PROT3000 detalha os passos.' })
  await db.collection('knowledge_documents').updateOne({ _id: principal._id }, { $set: { links: [{ target: 'Anexo PROT3000', resolvedDocumentId: anexo._id }] } })

  const casos = [{ id: 'com-anexo', query: 'PROT3000', expectDocumentIds: [principal._id.toString(), anexo._id.toString()] }]
  const baseline = await runContextEvals(DONO, await recarregar(), casos, { label: 'sem expansão', graphExpansion: false, topK: 10 })
  const expandido = await runContextEvals(DONO, await recarregar(), casos, { label: 'com expansão', graphExpansion: true, topK: 10 })
  const veredito = compareRuns(baseline, expandido)

  // Aqui a busca exata já encontra os dois (os dois citam PROT3000), então a expansão não
  // acrescenta acerto — e a recomendação precisa ser NÃO. É o caso que a flag protege.
  assert.equal(typeof veredito.recommendExpansion, 'boolean')
  if (veredito.deltaPassed === 0) {
    assert.equal(veredito.recommendExpansion, false)
    assert.match(veredito.reason, /não acertou mais nada/)
  }
  assert.equal(typeof veredito.deltaChars, 'number')
  assert.equal(typeof veredito.deltaLatencyMs, 'number')
})

test('vazamento na expansão REPROVA a flag, mesmo acertando mais', () => {
  const baseline = { label: 'a', cases: 2, passed: 0, avgLatencyMs: 10, avgChunks: 1, avgChars: 100, outcomes: [] }
  const expandido = {
    label: 'b',
    cases: 2,
    passed: 2,
    avgLatencyMs: 12,
    avgChunks: 2,
    avgChars: 200,
    outcomes: [{ caseId: 'x', passed: true, found: [], missing: [], leaked: ['doc-alheio'], status: 'ok', chunks: 1, chars: 10, latencyMs: 1 }],
  }
  const v = compareRuns(baseline, expandido)
  assert.equal(v.recommendExpansion, false)
  assert.match(v.reason, /não podia ler/)
})

// --- a limpeza -----------------------------------------------------------------------------

const memoriaDoArquiteto = (titulo, conteudo) =>
  writeMemory({
    tenantId: DONO,
    target: { scope: 'floor', floorId: cena.andar._id },
    key: `arquiteto:${titulo}`,
    payload: { titulo, conteudo },
    strategy: 'upsert',
    sourceType: 'architect',
  })

test('a limpeza é SIMULAÇÃO por padrão — e não apaga nada', async () => {
  await memoriaDoArquiteto('Horários', 'Aberto das 11h às 23h')
  await migrateArchitectKnowledge({ tenantId: DONO })

  const simulacao = await cleanupMigratedMemories(DONO)
  assert.equal(simulacao.dryRun, true)
  assert.equal(simulacao.eligible, 1)
  assert.equal(simulacao.deleted, 0)
  assert.equal(await db.collection('memories').countDocuments({ tenantId: DONO }), 1, 'sem confirmação, nada sai')
})

test('com confirmação, só sai o que tem cópia conferida NA HORA', async () => {
  await memoriaDoArquiteto('Horários', 'Aberto das 11h às 23h')
  await memoriaDoArquiteto('Cardápio', 'Pizza 40 reais')
  await migrateArchitectKnowledge({ tenantId: DONO })

  // Alguém apagou UM dos documentos depois de migrado: aquela memória volta a ser a
  // única cópia que resta, e não pode sair.
  const docs = await db.collection('knowledge_documents').find({}).toArray()
  await db.collection('knowledge_documents').deleteOne({ _id: docs[0]._id })

  const r = await cleanupMigratedMemories(DONO, { confirm: true })
  assert.equal(r.deleted, 1)
  assert.equal(r.skipped.length, 1)
  assert.equal(await db.collection('memories').countDocuments({ tenantId: DONO }), 1)
})

test('a limpeza é retomável: rodar de novo termina o que faltou', async () => {
  await memoriaDoArquiteto('A', 'texto A')
  await memoriaDoArquiteto('B', 'texto B')
  await migrateArchitectKnowledge({ tenantId: DONO })

  const docs = await db.collection('knowledge_documents').find({}).toArray()
  const removido = docs[0]
  await db.collection('knowledge_documents').deleteOne({ _id: removido._id })
  const primeira = await cleanupMigratedMemories(DONO, { confirm: true })
  assert.equal(primeira.deleted, 1)

  // Recriada a cópia que faltava, a rodada seguinte resolve só ela.
  await db.collection('knowledge_documents').insertOne(removido)
  const segunda = await cleanupMigratedMemories(DONO, { confirm: true })
  assert.equal(segunda.deleted, 1)
  assert.equal(await db.collection('memories').countDocuments({ tenantId: DONO }), 0)
})

test('nada é apagado automaticamente em lugar nenhum', async () => {
  await memoriaDoArquiteto('Horários', 'Aberto das 11h às 23h')
  await migrateArchitectKnowledge({ tenantId: DONO })
  await migrateArchitectKnowledge({ tenantId: DONO })
  await auditArchitectMemoryMigration(DONO)
  await auditArchitectMemoryMigration(DONO)
  assert.equal(await db.collection('memories').countDocuments({ tenantId: DONO }), 1, 'só o comando explícito apaga')
})
