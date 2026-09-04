// LACUNAS, PROPOSTAS, VALIDADE E CONFLITOS — a inteligência operacional da base.
//
// Cada um destes existe para impedir uma resposta errada com cara de certa: a pergunta
// que ninguém sabe que não tem resposta, o palpite do agente virando política, o
// documento de 2023 respondendo sobre hoje, e os dois textos que se contradizem chegando
// juntos ao modelo para ele escolher em silêncio.
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
const { retrieveForAgent } = await import('../dist/knowledgeRetrieval.js')
const { createDocumentFor, ensureKnowledgeIndexes, reviewStateOf, listDocumentsNeedingReview } = await import('../dist/knowledge.js')
const { ensureKnowledgeGapIndexes, listKnowledgeGaps, fingerprintOf, redigir } = await import('../dist/knowledgeGaps.js')
const { ensureKnowledgeProposalIndexes, createKnowledgeProposal } = await import('../dist/knowledgeProposals.js')
const { ensureKnowledgeConflictIndexes, detectConflicts, precedence, scanScopeForConflicts } = await import('../dist/knowledgeConflicts.js')
const { ensureContextManifestIndexes } = await import('../dist/contextManifest.js')
const { createAgent, getAgentById } = await import('../dist/agents.js')
const { createFloor } = await import('../dist/floors.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')

const DONO = 'dono-inteligencia'
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
  await ensureKnowledgeGapIndexes()
  await ensureKnowledgeProposalIndexes()
  await ensureKnowledgeConflictIndexes()
  await ensureContextManifestIndexes()
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
  for (const c of ['knowledge_documents', 'knowledge_chunks', 'agents', 'sectors', 'offices', 'buildings', 'knowledge_gaps', 'knowledge_proposals', 'knowledge_conflicts', 'context_manifests']) {
    await db.collection(c).deleteMany({})
  }
  sessao = DONO
  const andar = await createFloor(DONO, { name: 'Atendimento' })
  const agente = await createAgent(DONO, andar._id, 'Marina', { objective: 'atender' })
  const predio = await ensureDefaultBuilding(DONO)
  cena = { andar, agente, predio }
})

const recarregar = () => getAgentById(DONO, cena.agente._id)
const escopoAgente = { scopeType: 'agent', scopeId: () => cena.agente._id.toString() }

// --- lacunas -----------------------------------------------------------------------------

test('uma execução sem base vira LACUNA agregada', async () => {
  await retrieveForAgent(DONO, await recarregar(), 'qual é o horário de funcionamento aos domingos?', {
    execution: { executionId: 'exec-1', kind: 'playground' },
  })
  const { items } = await listKnowledgeGaps(DONO)
  assert.equal(items.length, 1)
  assert.equal(items[0].count, 1)
  assert.equal(items[0].status, 'open')
  assert.match(items[0].subject, /horário de funcionamento/)

  // A MESMA pergunta, escrita de outro jeito, soma na mesma lacuna.
  await retrieveForAgent(DONO, await recarregar(), 'aos domingos qual o horário de funcionamento', {
    execution: { executionId: 'exec-2', kind: 'channel' },
  })
  const depois = await listKnowledgeGaps(DONO)
  assert.equal(depois.items.length, 1, 'contar duas vezes a mesma pergunta faz o painel ordenar errado')
  assert.equal(depois.items[0].count, 2)
})

test('a lacuna NÃO guarda a conversa — e o que identifica alguém é redigido', () => {
  const bruto = 'meu cpf é 123.456.789-00, email joao@exemplo.com e telefone +55 11 98888-7777, qual o prazo de troca?'
  const limpo = redigir(bruto)
  assert.equal(/\d{3}\.\d{3}\.\d{3}/.test(limpo), false)
  assert.equal(limpo.includes('joao@exemplo.com'), false)
  assert.equal(limpo.includes('98888'), false)
  assert.match(limpo, /prazo de troca/)
  assert.ok(limpo.length <= 160, 'exemplo é amostra, não cópia da conversa')
})

test('"não pode ler" NÃO vira lacuna: falta permissão, não conhecimento', async () => {
  await db.collection('agents').updateOne({ _id: cena.agente._id }, { $set: { knowledgeAccess: { version: 1, own: false, building: false, floor: false, sectorMode: 'none', selectedSectorIds: [] } } })
  await retrieveForAgent(DONO, await recarregar(), 'qualquer pergunta sobre a política de trocas', {
    execution: { executionId: 'exec-negado', kind: 'playground' },
  })
  assert.equal((await listKnowledgeGaps(DONO)).items.length, 0, 'mandaria alguém escrever o que já existe do outro lado da política')
})

test('a lacuna só é RESOLVIDA quando a busca encontra o documento', async () => {
  await retrieveForAgent(DONO, await recarregar(), 'qual o prazo para troca de produto PROT4242?', {
    execution: { executionId: 'exec-lacuna', kind: 'playground' },
  })
  const { items } = await listKnowledgeGaps(DONO)
  const lacuna = items[0]

  // Um documento que NÃO responde a pergunta não resolve a lacuna.
  const errado = await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'Outra coisa', content: 'Assunto completamente diferente.' })
  const recusa = await pedir('POST', `/api/knowledge/gaps/${lacuna._id}/resolve`, { documentId: errado._id.toString() })
  assert.equal(recusa.status, 409)
  assert.match(recusa.body.message, /ainda não o encontra/)
  assert.equal((await listKnowledgeGaps(DONO)).items[0].status, 'open')

  // O que responde, resolve.
  const certo = await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'Prazo de troca', content: 'O prazo para troca de produto PROT4242 é de sete dias corridos.' })
  const ok = await pedir('POST', `/api/knowledge/gaps/${lacuna._id}/resolve`, { documentId: certo._id.toString() })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  const resolvida = (await listKnowledgeGaps(DONO)).items[0]
  assert.equal(resolvida.status, 'resolved')
  assert.ok(resolvida.resolvedByDocumentId.equals(certo._id))
})

test('a lacuna de outra conta não aparece nesta', async () => {
  await retrieveForAgent(DONO, await recarregar(), 'pergunta sem resposta nenhuma na base', { execution: { executionId: 'e', kind: 'playground' } })
  sessao = 'vizinho'
  const r = await pedir('GET', '/api/knowledge/gaps')
  assert.equal(r.body.total, 0)
})

// --- propostas ------------------------------------------------------------------------------

test('proposta NÃO entra na busca antes da aprovação', async () => {
  const p = await createKnowledgeProposal({
    ownerId: DONO,
    agentId: cena.agente._id,
    executionId: 'exec-proposta',
    owner: { ownerType: 'agent', ownerId: cena.agente._id },
    title: 'Desconto PROT5150',
    content: 'O desconto máximo PROT5150 é de 10 por cento.',
    evidence: [{ kind: 'document', ref: new ObjectId().toString() }],
  })
  assert.equal(p.status, 'pending')
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0, 'proposta não é documento')

  const antes = await retrieveForAgent(DONO, await recarregar(), 'PROT5150', { minScore: 0 })
  assert.notEqual(antes.status, 'ok')

  const aprovada = await pedir('POST', `/api/knowledge/proposals/${p._id}/approve`, { authority: 'procedure', note: 'confere com a política' })
  assert.equal(aprovada.status, 200)
  assert.ok(aprovada.body.documentId)

  const depois = await retrieveForAgent(DONO, await recarregar(), 'PROT5150', { minScore: 0 })
  assert.equal(depois.status, 'ok', 'aprovada, ela responde')
  assert.equal(depois.sources[0].documentId, aprovada.body.documentId)
})

test('aprovar duas vezes não cria dois documentos', async () => {
  const p = await createKnowledgeProposal({
    ownerId: DONO,
    agentId: cena.agente._id,
    owner: { ownerType: 'agent', ownerId: cena.agente._id },
    title: 'Regra X',
    content: 'texto da regra',
    evidence: [{ kind: 'document', ref: 'algo' }],
  })
  const a = await pedir('POST', `/api/knowledge/proposals/${p._id}/approve`, {})
  const b = await pedir('POST', `/api/knowledge/proposals/${p._id}/approve`, {})
  assert.equal(a.body.documentId, b.body.documentId)
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 1)
})

test('proposta sem evidência independente nasce como needs_review', async () => {
  const semNada = await createKnowledgeProposal({
    ownerId: DONO,
    agentId: cena.agente._id,
    owner: { ownerType: 'agent', ownerId: cena.agente._id },
    title: 'Achismo',
    content: 'acho que é assim',
    evidence: [],
  })
  assert.equal(semNada.status, 'needs_review')

  // Texto de execução sozinho também não basta: é como o ciclo se fecha — o agente cita
  // a si mesmo e um palpite vira política duas voltas depois.
  const soRun = await createKnowledgeProposal({
    ownerId: DONO,
    agentId: cena.agente._id,
    owner: { ownerType: 'agent', ownerId: cena.agente._id },
    title: 'Da execução',
    content: 'o que eu respondi antes',
    evidence: [{ kind: 'run', ref: 'exec-9' }],
  })
  assert.equal(soRun.status, 'needs_review')
})

test('recusar preserva a auditoria e nunca vira documento', async () => {
  const p = await createKnowledgeProposal({
    ownerId: DONO,
    agentId: cena.agente._id,
    owner: { ownerType: 'agent', ownerId: cena.agente._id },
    title: 'Recusada',
    content: 'texto',
    evidence: [{ kind: 'document', ref: 'x' }],
  })
  const r = await pedir('POST', `/api/knowledge/proposals/${p._id}/reject`, { note: 'não confere com a política' })
  assert.equal(r.body.status, 'rejected')
  const guardada = await db.collection('knowledge_proposals').findOne({ _id: p._id })
  assert.equal(guardada.reviewNote, 'não confere com a política')
  assert.equal(guardada.reviewerId, DONO)
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0)

  // E recusada não se aprova por outro caminho.
  const depois = await pedir('POST', `/api/knowledge/proposals/${p._id}/approve`, {})
  assert.equal(depois.status, 400)
})

test('a proposta duplicada é sinalizada antes de alguém ler', async () => {
  await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'Política de troca', content: 'sete dias' })
  const p = await createKnowledgeProposal({
    ownerId: DONO,
    agentId: cena.agente._id,
    owner: { ownerType: 'agent', ownerId: cena.agente._id },
    title: 'política de troca',
    content: 'trinta dias',
    evidence: [{ kind: 'document', ref: 'x' }],
  })
  assert.ok(p.checks.duplicateOfDocumentId)
  assert.match(p.checks.reason, /já existe/)
})

// --- validade e revisão -------------------------------------------------------------------

test('o estado de revisão é ARITMÉTICA, não opinião de modelo', () => {
  const agora = new Date('2026-06-01')
  assert.equal(reviewStateOf({ validUntil: new Date('2026-01-01'), updatedAt: agora }, agora), 'expired')
  assert.equal(reviewStateOf({ validUntil: new Date('2026-06-10'), updatedAt: agora }, agora), 'expiring_soon')
  assert.equal(reviewStateOf({ validUntil: new Date('2027-01-01'), updatedAt: agora }, agora), 'ok')
  assert.equal(reviewStateOf({ reviewIntervalDays: 30, verifiedAt: new Date('2026-01-01'), updatedAt: agora }, agora), 'due_for_review')
  assert.equal(reviewStateOf({ reviewIntervalDays: 30, verifiedAt: new Date('2026-05-30'), updatedAt: agora }, agora), 'ok')
  // Sem validade e sem periodicidade, não há o que cobrar.
  assert.equal(reviewStateOf({ updatedAt: agora }, agora), 'ok')
})

test('documento VENCIDO não responde como fato atual', async () => {
  const doc = await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'Tabela PROT7000', content: 'A tabela PROT7000 vale 100 reais.' })
  const achado = await retrieveForAgent(DONO, await recarregar(), 'PROT7000', { minScore: 0 })
  assert.equal(achado.status, 'ok')

  await db.collection('knowledge_documents').updateOne({ _id: doc._id }, { $set: { validUntil: new Date('2020-01-01') } })
  const depois = await retrieveForAgent(DONO, await recarregar(), 'PROT7000', { minScore: 0 })
  assert.notEqual(depois.status, 'ok', 'o de 2020 não pode responder sobre hoje')

  // Mas ele continua existindo, e aparece no painel de revisão.
  const painel = await listDocumentsNeedingReview({ ownerType: 'agent', ownerId: cena.agente._id })
  assert.equal(painel.length, 1)
  assert.equal(painel[0].state, 'expired')
})

test('documento ARQUIVADO sai da busca sem ser apagado', async () => {
  const doc = await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'Antigo PROT8000', content: 'O PROT8000 já não vale.' })
  await db.collection('knowledge_documents').updateOne({ _id: doc._id }, { $set: { lifecycleStatus: 'archived' } })
  const r = await retrieveForAgent(DONO, await recarregar(), 'PROT8000', { minScore: 0 })
  assert.notEqual(r.status, 'ok', 'voltar pela busca desfaria a decisão de quem arquivou')
  assert.equal(await db.collection('knowledge_documents').countDocuments({ _id: doc._id }), 1)
})

test('rascunho não responde em nome da empresa', async () => {
  const doc = await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'Rascunho PROT8100', content: 'Talvez o PROT8100 seja assim.' })
  await db.collection('knowledge_documents').updateOne({ _id: doc._id }, { $set: { lifecycleStatus: 'draft' } })
  const r = await retrieveForAgent(DONO, await recarregar(), 'PROT8100', { minScore: 0 })
  assert.notEqual(r.status, 'ok')
})

// --- conflitos --------------------------------------------------------------------------------

test('a detecção compara valores do MESMO assunto', () => {
  const achados = detectConflicts([
    { id: 'a', title: 'Política', content: 'O prazo de troca é de 7 dias.', authority: 'official_policy' },
    { id: 'b', title: 'Nota do setor', content: 'O prazo de troca é de 30 dias.', authority: 'note' },
  ])
  assert.equal(achados.length, 1)
  assert.deepEqual(achados[0].documentIds.sort(), ['a', 'b'])
  assert.equal(achados[0].values.length, 2)

  // Dois números de assuntos diferentes não são contradição: são dois fatos.
  const semConflito = detectConflicts([
    { id: 'a', title: 'x', content: 'O prazo de troca é de 7 dias.', authority: 'note' },
    { id: 'b', title: 'y', content: 'A garantia legal é de 90 dias.', authority: 'note' },
  ])
  assert.deepEqual(semConflito, [])
})

test('a precedência é determinística — e admite não saber', () => {
  const politica = { id: 'p', title: '', content: '', authority: 'official_policy' }
  const nota = { id: 'n', title: '', content: '', authority: 'note' }
  assert.equal(precedence(politica, nota).id, 'p')
  assert.equal(precedence(nota, politica).id, 'p', 'a ordem dos argumentos não pode mudar a resposta')

  const rascunho = { id: 'r', title: '', content: '', authority: 'official_policy', lifecycleStatus: 'draft' }
  assert.equal(precedence(rascunho, nota).id, 'n', 'aprovado supera rascunho, mesmo com autoridade maior')

  const velho = { id: 'v', title: '', content: '', authority: 'note', verifiedAt: new Date('2025-01-01') }
  const novo = { id: 'x', title: '', content: '', authority: 'note', verifiedAt: new Date('2026-01-01') }
  assert.equal(precedence(velho, novo).id, 'x', 'entre iguais, ganha o verificado mais recentemente')

  // Empatados de verdade: a regra não decide, e fingir que decide é escolher no par.
  assert.equal(precedence({ id: '1', title: '', content: '', authority: 'note' }, { id: '2', title: '', content: '', authority: 'note' }), null)
})

test('dois trechos conflitantes NUNCA vão juntos para o modelo', async () => {
  const politica = await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'Política oficial', content: 'O prazo de troca PROT6060 é de 7 dias.' })
  const nota = await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'Nota', content: 'O prazo de troca PROT6060 é de 30 dias.' })
  await db.collection('knowledge_documents').updateOne({ _id: politica._id }, { $set: { authority: 'official_policy' } })
  await db.collection('knowledge_documents').updateOne({ _id: nota._id }, { $set: { authority: 'note' } })

  await scanScopeForConflicts(DONO, { ownerType: 'agent', ownerId: cena.agente._id })
  const abertos = await db.collection('knowledge_conflicts').find({ ownerId: DONO }).toArray()
  assert.equal(abertos.length, 1)

  const r = await retrieveForAgent(DONO, await recarregar(), 'PROT6060 prazo de troca', { minScore: 0, topK: 10 })
  const usados = r.sources.map((s) => s.documentId)
  assert.equal(usados.includes(nota._id.toString()), false, 'a nota perde para a política oficial')
  assert.ok(r.ignored.some((i) => /precedência/.test(i.reason)))
})

test('conflito que a regra NÃO decide vira groundingStatus conflict', async () => {
  const a = await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'Nota A', content: 'O desconto PROT6161 é de 10 por cento.' })
  const b = await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'Nota B', content: 'O desconto PROT6161 é de 25 por cento.' })
  for (const id of [a._id, b._id]) await db.collection('knowledge_documents').updateOne({ _id: id }, { $set: { authority: 'note' } })
  await scanScopeForConflicts(DONO, { ownerType: 'agent', ownerId: cena.agente._id })

  const r = await retrieveForAgent(DONO, await recarregar(), 'PROT6161 desconto', { minScore: 0, topK: 10 })
  assert.equal(r.status, 'conflict')
  assert.equal(r.sources.length, 0, 'mandar os dois e torcer é a decisão silenciosa que isto existe para não ter')
  assert.ok(r.ignored.some((i) => /não resolvido/.test(i.reason)))
})

test('varrer duas vezes não duplica o conflito', async () => {
  await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'A', content: 'O prazo de envio é de 3 dias.' })
  await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'B', content: 'O prazo de envio é de 9 dias.' })
  await pedir('POST', '/api/knowledge/conflicts/scan', { scopeType: 'agent', scopeId: cena.agente._id.toString() })
  await pedir('POST', '/api/knowledge/conflicts/scan', { scopeType: 'agent', scopeId: cena.agente._id.toString() })
  assert.equal(await db.collection('knowledge_conflicts').countDocuments({ ownerId: DONO }), 1)
})

test('resolver um conflito exige dizer POR QUÊ', async () => {
  await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'A', content: 'A taxa é de 5 por cento.' })
  await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'B', content: 'A taxa é de 12 por cento.' })
  await pedir('POST', '/api/knowledge/conflicts/scan', { scopeType: 'agent', scopeId: cena.agente._id.toString() })
  const { body } = await pedir('GET', '/api/knowledge/conflicts')
  const conflito = body.items[0]

  const semMotivo = await pedir('POST', `/api/knowledge/conflicts/${conflito.id}/resolve`, {})
  assert.equal(semMotivo.status, 400)

  const ok = await pedir('POST', `/api/knowledge/conflicts/${conflito.id}/resolve`, { note: 'a taxa correta é 12%', winnerDocumentId: conflito.documentIds[1] })
  assert.equal(ok.body.status, 'resolved')
  const guardado = await db.collection('knowledge_conflicts').findOne({ _id: new ObjectId(conflito.id) })
  assert.equal(guardado.resolvedBy, DONO)
  assert.equal(guardado.resolutionNote, 'a taxa correta é 12%')
})

test('conflito de outra conta não aparece nesta', async () => {
  await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'A', content: 'O limite é de 2 dias.' })
  await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'B', content: 'O limite é de 8 dias.' })
  await scanScopeForConflicts(DONO, { ownerType: 'agent', ownerId: cena.agente._id })
  sessao = 'vizinho'
  const r = await pedir('GET', '/api/knowledge/conflicts')
  assert.deepEqual(r.body.items, [])
})

test('a impressão digital agrupa a mesma pergunta escrita de outro jeito', () => {
  assert.equal(fingerprintOf('qual o prazo de entrega?'), fingerprintOf('prazo entrega qual'))
  assert.notEqual(fingerprintOf('qual o prazo de entrega?'), fingerprintOf('qual o prazo de troca?'))
})
