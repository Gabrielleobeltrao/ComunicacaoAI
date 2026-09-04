// O MAPA, AS LIGAÇÕES E O IMPACTO.
//
// Três garantias aqui: "ver como agente" REMOVE o que ele não pode ler (esconder por CSS
// entrega o dado na primeira aba de rede aberta), a ligação sobrevive a um rename, e a
// análise de impacto nunca confunde quem PODE ler com quem LEU.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import express from 'express'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.LLM_FAKE = '1'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.VOYAGE_API_KEY = ''

const { mongoClient, db } = await import('../dist/db.js')
const { knowledgeRouter } = await import('../dist/routes/knowledgeRoutes.js')
const { ensureKnowledgeIndexes, createDocumentFor } = await import('../dist/knowledge.js')
const { ensureKnowledgeGraphIndexes, buildKnowledgeGraph, analyzeDocumentImpact } = await import('../dist/knowledgeGraph.js')
const { parseLinks, neighborsOf } = await import('../dist/knowledgeLinks.js')
const { saveDocument } = await import('../dist/knowledgeService.js')
const { retrieveForAgent } = await import('../dist/knowledgeRetrieval.js')
const { ensureContextManifestIndexes } = await import('../dist/contextManifest.js')
const { ensureKnowledgeGapIndexes } = await import('../dist/knowledgeGaps.js')
const { ensureKnowledgeConflictIndexes } = await import('../dist/knowledgeConflicts.js')
const { ensureKnowledgeProposalIndexes } = await import('../dist/knowledgeProposals.js')
const { createAgent, getAgentById } = await import('../dist/agents.js')
const { createSector } = await import('../dist/sectors.js')
const { createFloor } = await import('../dist/floors.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')

const DONO = 'dono-grafo'
let sessao = DONO
let server
let port

const pedir = async (metodo, caminho, corpo) => {
  const res = await fetch(`http://127.0.0.1:${port}${caminho}`, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await res.text()
  return { status: res.status, body: texto ? JSON.parse(texto) : null }
}

before(async () => {
  await mongoClient.connect()
  await ensureKnowledgeIndexes()
  await ensureKnowledgeGraphIndexes()
  await ensureContextManifestIndexes()
  await ensureKnowledgeGapIndexes()
  await ensureKnowledgeConflictIndexes()
  await ensureKnowledgeProposalIndexes()
  const app = express()
  app.use(express.json())
  app.use((_req, res, next) => {
    res.locals.userId = sessao
    next()
  })
  app.use('/api/knowledge', knowledgeRouter)
  await new Promise((r) => {
    server = app.listen(0, () => {
      port = server.address().port
      r()
    })
  })
})
after(async () => {
  await new Promise((r) => server.close(r))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

let cena
beforeEach(async () => {
  for (const c of ['knowledge_documents', 'knowledge_chunks', 'agents', 'sectors', 'offices', 'buildings', 'context_manifests', 'knowledge_gaps', 'knowledge_conflicts', 'knowledge_proposals', 'knowledge_graph_layouts']) {
    await db.collection(c).deleteMany({})
  }
  sessao = DONO
  const andar = await createFloor(DONO, { name: 'Atendimento' })
  const marina = await createAgent(DONO, andar._id, 'Marina', { objective: 'atender' })
  const rafael = await createAgent(DONO, andar._id, 'Rafael', { objective: 'analisar' })
  const setor = await createSector(DONO, andar._id, 'Mesa', '#4466aa', 'orchestrated', [{ agentId: marina._id, order: 0 }])
  const predio = await ensureDefaultBuilding(DONO)
  cena = { andar, marina, rafael, setor, predio }
})

const politica = (agentId, p) =>
  db.collection('agents').updateOne({ _id: agentId }, { $set: { knowledgeAccess: { version: 1, own: true, building: false, floor: false, sectorMode: 'none', selectedSectorIds: [], ...p } } })

// --- o mapa ---------------------------------------------------------------------------

test('o grafo desenha a hierarquia real do andar', async () => {
  await createDocumentFor({ ownerType: 'agent', ownerId: cena.marina._id }, { title: 'Base da Marina', content: 'texto' })
  const g = await buildKnowledgeGraph(DONO, { floorId: cena.andar._id })

  const tipos = g.nodes.map((n) => n.kind)
  assert.ok(tipos.includes('building') && tipos.includes('floor') && tipos.includes('sector') && tipos.includes('agent') && tipos.includes('document'))
  // O setor leva a cor real; o agente leva o ID para o retrato, e não a imagem.
  const setor = g.nodes.find((n) => n.kind === 'sector')
  assert.equal(setor.color, '#4466aa')
  const agente = g.nodes.find((n) => n.kind === 'agent' && n.label === 'Marina')
  assert.equal(agente.portraitKey, cena.marina._id.toString())
  assert.equal(JSON.stringify(g).includes('base64'), false, 'imagem no DTO seria megabytes por carregamento')

  // As arestas de hierarquia existem e apontam para nós presentes.
  for (const e of g.edges) {
    assert.ok(g.nodes.some((n) => n.id === e.source), `origem ausente: ${e.id}`)
    assert.ok(g.nodes.some((n) => n.id === e.target), `destino ausente: ${e.id}`)
  }
})

test('"ver como agente" REMOVE o que ele não pode ler', async () => {
  await politica(cena.marina._id, { own: true })
  await politica(cena.rafael._id, { own: true })
  const daMarina = await createDocumentFor({ ownerType: 'agent', ownerId: cena.marina._id }, { title: 'Só da Marina', content: 'x' })
  const doRafael = await createDocumentFor({ ownerType: 'agent', ownerId: cena.rafael._id }, { title: 'Só do Rafael', content: 'y' })

  const g = await buildKnowledgeGraph(DONO, { floorId: cena.andar._id, viewAsAgentId: cena.marina._id })
  const ids = g.nodes.map((n) => n.id)
  assert.ok(ids.includes(`document:${daMarina._id}`))
  assert.equal(ids.includes(`document:${doRafael._id}`), false, 'esconder por CSS entregaria o dado na aba de rede')
  assert.equal(g.nodes.some((n) => n.kind === 'agent' && n.label === 'Rafael'), false)
})

test('a aresta "pode acessar" sai da política — a mesma da execução', async () => {
  await politica(cena.marina._id, { own: true, floor: true })
  await createDocumentFor({ ownerType: 'floor', ownerId: cena.andar._id }, { title: 'Do andar', content: 'z' })
  const g = await buildKnowledgeGraph(DONO, { floorId: cena.andar._id })
  const acesso = g.edges.filter((e) => e.kind === 'can_access')
  assert.ok(acesso.some((e) => e.source === `agent:${cena.marina._id}` && e.target === `floor:${cena.andar._id}`))
  assert.equal(acesso.some((e) => e.source === `agent:${cena.rafael._id}` && e.target === `floor:${cena.andar._id}`), false)
})

test('o andar de outra conta não desenha mapa nenhum', async () => {
  const alheio = await createFloor('vizinho', { name: 'Outro' })
  const r = await pedir('GET', `/api/knowledge/graph?floorId=${alheio._id}`)
  assert.equal(r.status, 404)
  assert.deepEqual(r.body, { code: 'not_found', message: 'not found' })
})

test('o grafo pagina e diz o total real', async () => {
  for (let i = 0; i < 5; i++) await createDocumentFor({ ownerType: 'agent', ownerId: cena.marina._id }, { title: `Doc ${i}`, content: 'x' })
  const g = await buildKnowledgeGraph(DONO, { floorId: cena.andar._id, limit: 2 })
  assert.equal(g.nodes.filter((n) => n.kind === 'document').length, 2)
  assert.equal(g.documentTotal, 5, 'contagem real, não a que coube')
  assert.equal(g.truncated, true)
})

// --- o layout -------------------------------------------------------------------------

test('a posição arrastada é guardada, devolvida e apagada por visão', async () => {
  await createDocumentFor({ ownerType: 'agent', ownerId: cena.marina._id }, { title: 'Doc', content: 'x' })
  const viewKey = `floor:${cena.andar._id}`
  const salvo = await pedir('PUT', '/api/knowledge/graph/layout', { viewKey, positions: [{ nodeId: `agent:${cena.marina._id}`, x: 120, y: 340 }] })
  assert.equal(salvo.body.saved, 1)

  const g = await pedir('GET', `/api/knowledge/graph?floorId=${cena.andar._id}`)
  const no = g.body.nodes.find((n) => n.id === `agent:${cena.marina._id}`)
  assert.deepEqual(no.position, { x: 120, y: 340 })
  // Quem não foi arrastado não ganha posição inventada.
  assert.equal(g.body.nodes.find((n) => n.kind === 'document').position, null)

  const limpo = await pedir('DELETE', `/api/knowledge/graph/layout?viewKey=${encodeURIComponent(viewKey)}`)
  assert.equal(limpo.body.cleared, 1)
  const depois = await pedir('GET', `/api/knowledge/graph?floorId=${cena.andar._id}`)
  assert.equal(depois.body.nodes.find((n) => n.id === `agent:${cena.marina._id}`).position, null)
})

test('o layout de outra conta não é lido nem sobrescrito', async () => {
  const viewKey = `floor:${cena.andar._id}`
  await pedir('PUT', '/api/knowledge/graph/layout', { viewKey, positions: [{ nodeId: 'agent:x', x: 1, y: 2 }] })
  sessao = 'vizinho'
  const g = await pedir('GET', `/api/knowledge/graph?floorId=${cena.andar._id}`)
  assert.equal(g.status, 404, 'nem o andar é dele')
  await pedir('PUT', '/api/knowledge/graph/layout', { viewKey, positions: [{ nodeId: 'agent:x', x: 99, y: 99 }] })
  sessao = DONO
  const meu = await db.collection('knowledge_graph_layouts').findOne({ ownerId: DONO, nodeId: 'agent:x' })
  assert.equal(meu.x, 1, 'a posição do vizinho não pode sobrescrever a minha')
})

// --- as ligações ----------------------------------------------------------------------

test('a ligação é escrita por título e guardada por ID', async () => {
  const alvo = await createDocumentFor({ ownerType: 'agent', ownerId: cena.marina._id }, { title: 'Política de troca', content: 'sete dias' })
  const origem = await saveDocument(DONO, { ownerType: 'agent', ownerId: cena.marina._id }, {
    title: 'Guia',
    content: 'Veja [[Política de troca]] e também [[Documento que não existe|este aqui]].',
  })

  const resolvido = origem.links.find((l) => l.target === 'Política de troca')
  assert.ok(resolvido.resolvedDocumentId.equals(alvo._id))
  // O que não existe fica como PENDÊNCIA visível, sem inventar destino.
  const pendente = origem.links.find((l) => l.target === 'Documento que não existe')
  assert.equal(pendente.resolvedDocumentId, null)
  assert.equal(pendente.label, 'este aqui')

  // Renomear o alvo NÃO quebra a ligação.
  await db.collection('knowledge_documents').updateOne({ _id: alvo._id }, { $set: { title: 'Política de trocas e devoluções' } })
  const g = await buildKnowledgeGraph(DONO, { floorId: cena.andar._id })
  assert.ok(g.edges.some((e) => e.kind === 'references' && e.source === `document:${origem._id}` && e.target === `document:${alvo._id}`))
})

test('parseLinks lê as duas formas e não repete', () => {
  const links = parseLinks('[[A]] e [[B|rótulo]] e [[A]] de novo')
  assert.deepEqual(links, [{ target: 'A' }, { target: 'B', label: 'rótulo' }])
})

test('a expansão de um salto NÃO atravessa escopo sem permissão', async () => {
  const doAndar = await createDocumentFor({ ownerType: 'floor', ownerId: cena.andar._id }, { title: 'Manual do andar', content: 'conteúdo do andar' })
  const daMarina = await saveDocument(DONO, { ownerType: 'agent', ownerId: cena.marina._id }, {
    title: 'Guia da Marina',
    content: 'Detalhes em [[Manual do andar]].',
  })
  // Ligação resolvida na mão: escopos diferentes não se resolvem por título ao salvar.
  await db.collection('knowledge_documents').updateOne({ _id: daMarina._id }, { $set: { links: [{ target: 'Manual do andar', resolvedDocumentId: doAndar._id }] } })

  // Sem acesso ao andar, o vizinho não vem.
  const semAndar = await neighborsOf([daMarina._id], [{ ownerType: 'agent', ownerId: cena.marina._id }])
  assert.deepEqual(semAndar, [])

  // Com acesso, vem.
  const comAndar = await neighborsOf([daMarina._id], [{ ownerType: 'agent', ownerId: cena.marina._id }, { ownerType: 'floor', ownerId: cena.andar._id }])
  assert.equal(comAndar.length, 1)
  assert.ok(comAndar[0]._id.equals(doAndar._id))
})

test('a expansão respeita o orçamento global e fica marcada no resultado', async () => {
  await politica(cena.marina._id, { own: true, floor: true })
  const doAndar = await createDocumentFor({ ownerType: 'floor', ownerId: cena.andar._id }, { title: 'Anexo PROT3030', content: 'O anexo do PROT3030 detalha o procedimento.' })
  const daMarina = await createDocumentFor({ ownerType: 'agent', ownerId: cena.marina._id }, { title: 'Principal PROT3030', content: 'O PROT3030 é o procedimento padrão.' })
  await db.collection('knowledge_documents').updateOne({ _id: daMarina._id }, { $set: { links: [{ target: 'Anexo PROT3030', resolvedDocumentId: doAndar._id }] } })

  const agente = await getAgentById(DONO, cena.marina._id)
  const semExpansao = await retrieveForAgent(DONO, agente, 'PROT3030', { minScore: 0, topK: 10, graphExpansion: false })
  const comExpansao = await retrieveForAgent(DONO, agente, 'PROT3030', { minScore: 0, topK: 10, graphExpansion: true })
  assert.ok(comExpansao.sources.length >= semExpansao.sources.length)

  // E com o orçamento apertado, a expansão NÃO fura o teto.
  const apertado = await retrieveForAgent(DONO, agente, 'PROT3030', { minScore: 0, topK: 1, graphExpansion: true })
  assert.equal(apertado.context.length, 1, 'relação no grafo não compra vaga fora do orçamento')
})

// --- impacto ---------------------------------------------------------------------------

test('o impacto separa quem PODE ler de quem LEU', async () => {
  await politica(cena.marina._id, { own: true, floor: true })
  await politica(cena.rafael._id, { own: true, floor: true })
  const doAndar = await createDocumentFor({ ownerType: 'floor', ownerId: cena.andar._id }, { title: 'Política PROT4040', content: 'A política PROT4040 vale para todos.' })

  // Os dois PODEM ler. Só a Marina leu.
  await retrieveForAgent(DONO, await getAgentById(DONO, cena.marina._id), 'PROT4040', {
    minScore: 0,
    execution: { executionId: 'exec-marina', kind: 'playground' },
  })

  const impacto = await analyzeDocumentImpact(DONO, doAndar._id)
  assert.deepEqual(impacto.accessibleBy.map((a) => a.name).sort(), ['Marina', 'Rafael'])
  assert.equal(impacto.usedCount, 1, 'ter acesso não é ter usado')
  assert.deepEqual(impacto.actuallyUsedBy.map((u) => u.executionId), ['exec-marina'])
  assert.equal(impacto.recommendation, 'prefer_archive', 'com histórico de uso, arquivar preserva os manifestos')
})

test('documento sem uso nem lacuna é seguro para excluir', async () => {
  const doc = await createDocumentFor({ ownerType: 'agent', ownerId: cena.marina._id }, { title: 'Nunca usado', content: 'x' })
  const impacto = await analyzeDocumentImpact(DONO, doc._id)
  assert.equal(impacto.usedCount, 0)
  assert.equal(impacto.recommendation, 'safe_to_delete')
})

test('o impacto de um documento de outra conta é 404', async () => {
  const alheio = await createDocumentFor({ ownerType: 'agent', ownerId: new ObjectId() }, { title: 'Alheio', content: 'x' })
  const r = await pedir('GET', `/api/knowledge/documents/${alheio._id}/impact`)
  assert.equal(r.status, 404)
})

test('o impacto lista as ligações que apontam para o documento', async () => {
  const alvo = await createDocumentFor({ ownerType: 'agent', ownerId: cena.marina._id }, { title: 'Alvo', content: 'x' })
  const origem = await saveDocument(DONO, { ownerType: 'agent', ownerId: cena.marina._id }, { title: 'Origem', content: 'Veja [[Alvo]].' })
  const impacto = await analyzeDocumentImpact(DONO, alvo._id)
  assert.deepEqual(impacto.linkedFrom.map((l) => l.documentId), [origem._id.toString()])
})
