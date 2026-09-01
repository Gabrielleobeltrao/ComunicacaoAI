// A BASE ÚNICA, com quatro donos — conferida contra um MongoDB de verdade.
//
// O que se exercita aqui não é "a função grava": é que a MESMA regra vale nos quatro
// escopos e nas duas portas. Antes desta camada, o caminho do agente conferia a cota e o
// do setor não — não por decisão, mas porque um nasceu depois e não recebeu a regra. Um
// teste por escopo é o que impede a próxima porta de repetir isso.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import express from 'express'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.LLM_FAKE = '1'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
// Nenhum teste fala com o provedor de embedding. Documento entra com `indexStatus:
// 'error'` e continua sendo documento — é o comportamento real de quem não configurou.
process.env.VOYAGE_API_KEY = ''

const { mongoClient, db } = await import('../dist/db.js')
const { knowledgeRouter } = await import('../dist/routes/knowledgeRoutes.js')
const { sectorKnowledgeRouter } = await import('../dist/routes/sectorKnowledgeRoutes.js')
const { ensureKnowledgeIndexes, listDocumentsFor, createDocumentFor, withKnowledgeDefaults } = await import('../dist/knowledge.js')
const { resolveKnowledgeOwner } = await import('../dist/knowledgeScope.js')
const { createAgent } = await import('../dist/agents.js')
const { createSector } = await import('../dist/sectors.js')
const { createFloor } = await import('../dist/floors.js')
const { deleteFloor } = await import('../dist/floors.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')

const DONO = 'dono-conhecimento'
const VIZINHO = 'vizinho-conhecimento'
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
  const app = express()
  app.use(express.json())
  app.use((_req, res, next) => {
    res.locals.userId = sessao
    next()
  })
  app.use('/api/knowledge', knowledgeRouter)
  app.use('/api/sectors/:sectorId', sectorKnowledgeRouter)
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

/** Um escritório completo para cada conta: os quatro donos possíveis. */
async function escritorio(conta) {
  const andar = await createFloor(conta, { name: 'Atendimento' })
  const agente = await createAgent(conta, andar._id, 'Marina', { objective: 'atender' })
  const setor = await createSector(conta, andar._id, 'Mesa', '#3355ff', 'orchestrated', [{ agentId: agente._id, order: 0 }])
  const predio = await ensureDefaultBuilding(conta)
  return {
    building: { scopeType: 'building', scopeId: predio._id.toString() },
    floor: { scopeType: 'floor', scopeId: andar._id.toString() },
    sector: { scopeType: 'sector', scopeId: setor._id.toString() },
    agent: { scopeType: 'agent', scopeId: agente._id.toString() },
  }
}

let meu
let dele

beforeEach(async () => {
  for (const c of ['knowledge_documents', 'knowledge_chunks', 'agents', 'sectors', 'offices', 'buildings', 'audit_events']) {
    await db.collection(c).deleteMany({})
  }
  delete process.env.OWNER_STORAGE_QUOTA_BYTES
  sessao = DONO
  meu = await escritorio(DONO)
  dele = await escritorio(VIZINHO)
})

const ESCOPOS = ['building', 'floor', 'sector', 'agent']

// --- CRUD nos quatro escopos ----------------------------------------------------------

test('criar, ler, editar, reindexar e apagar — nos QUATRO escopos', async () => {
  for (const escopo of ESCOPOS) {
    const criado = await pedir('POST', '/api/knowledge/documents', { ...meu[escopo], title: `Política do ${escopo}`, content: `o que vale no ${escopo}` })
    assert.equal(criado.status, 201, `${escopo}: ${JSON.stringify(criado.body)}`)
    assert.equal(criado.body.scopeType, escopo)
    assert.equal(criado.body.scopeId, meu[escopo].scopeId)
    // A criação não devolve o conteúdo: quem quer o texto pede o documento.
    assert.equal(criado.body.content, undefined)

    const lido = await pedir('GET', `/api/knowledge/documents/${criado.body.id}`)
    assert.equal(lido.status, 200)
    assert.equal(lido.body.content, `o que vale no ${escopo}`, `${escopo}: o conteúdo vem na leitura de UM documento`)

    const editado = await pedir('PATCH', `/api/knowledge/documents/${criado.body.id}`, { title: 'Política revisada' })
    assert.equal(editado.status, 200)
    assert.equal(editado.body.title, 'Política revisada')

    const reindex = await pedir('POST', `/api/knowledge/documents/${criado.body.id}/reindex`)
    assert.equal(reindex.status, 200, `${escopo}: reindexar precisa funcionar em todo escopo`)
    // Sem provedor de embedding a indexação falha — e o documento continua existindo.
    assert.ok(['indexed', 'error', 'pending'].includes(reindex.body.indexStatus))

    const apagado = await pedir('DELETE', `/api/knowledge/documents/${criado.body.id}`)
    assert.equal(apagado.status, 204)
    assert.equal((await pedir('GET', `/api/knowledge/documents/${criado.body.id}`)).status, 404)
  }
})

test('a listagem NÃO carrega o conteúdo integral, e pagina', async () => {
  for (let i = 0; i < 3; i++) {
    await pedir('POST', '/api/knowledge/documents', { ...meu.floor, title: `Doc ${i}`, content: 'x'.repeat(5000) })
  }
  const pagina = await pedir('GET', `/api/knowledge/documents?scopeType=floor&scopeId=${meu.floor.scopeId}&limit=2`)
  assert.equal(pagina.status, 200)
  assert.equal(pagina.body.items.length, 2)
  assert.equal(pagina.body.total, 3)
  for (const item of pagina.body.items) {
    assert.equal(item.content, undefined, 'uma base com centenas de artigos viraria megabytes por lista')
  }
  const segunda = await pedir('GET', `/api/knowledge/documents?scopeType=floor&scopeId=${meu.floor.scopeId}&limit=2&skip=2`)
  assert.equal(segunda.body.items.length, 1)
  // E a busca por título encontra sem varrer o texto.
  const busca = await pedir('GET', `/api/knowledge/documents?scopeType=floor&scopeId=${meu.floor.scopeId}&q=Doc 1`)
  assert.equal(busca.body.items.length, 1)
  assert.equal(busca.body.items[0].title, 'Doc 1')
})

// --- isolamento -----------------------------------------------------------------------

test('o id de outra conta responde 404 — sem nome, sem existência, sem contagem', async () => {
  for (const escopo of ESCOPOS) {
    const criar = await pedir('POST', '/api/knowledge/documents', { ...dele[escopo], title: 'invasão', content: 'não' })
    assert.equal(criar.status, 404, `${escopo}: escrever na conta alheia`)
    assert.deepEqual(criar.body, { code: 'not_found', message: 'not found' }, `${escopo}: a recusa não pode contar nada`)

    const listar = await pedir('GET', `/api/knowledge/documents?scopeType=${escopo}&scopeId=${dele[escopo].scopeId}`)
    assert.equal(listar.status, 404, `${escopo}: listar a conta alheia`)
    assert.equal(listar.body.total, undefined, `${escopo}: nem a contagem pode vazar`)
  }
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0)
})

test('o documento de outra conta não é lido, editado nem apagado pelo id', async () => {
  sessao = VIZINHO
  const alheio = await pedir('POST', '/api/knowledge/documents', { ...dele.agent, title: 'Segredo', content: 'só dele' })
  assert.equal(alheio.status, 201)
  sessao = DONO

  assert.equal((await pedir('GET', `/api/knowledge/documents/${alheio.body.id}`)).status, 404)
  assert.equal((await pedir('PATCH', `/api/knowledge/documents/${alheio.body.id}`, { title: 'meu agora' })).status, 404)
  assert.equal((await pedir('POST', `/api/knowledge/documents/${alheio.body.id}/reindex`)).status, 404)
  assert.equal((await pedir('DELETE', `/api/knowledge/documents/${alheio.body.id}`)).status, 404)

  const ainda = await db.collection('knowledge_documents').findOne({ _id: new ObjectId(alheio.body.id) })
  assert.equal(ainda.title, 'Segredo', 'intacto para quem é dono')
})

test('o prédio não vem do cliente: um id de prédio alheio não vira dono', async () => {
  const dono = await resolveKnowledgeOwner(DONO, { scopeType: 'building', scopeId: dele.building.scopeId })
  assert.equal(dono, null)
  // Sem id, o prédio é o desta conta — resolvido pelo servidor.
  const meuPredio = await resolveKnowledgeOwner(DONO, { scopeType: 'building', scopeId: null })
  assert.equal(meuPredio.ownerId.toString(), meu.building.scopeId)
})

// --- legado ---------------------------------------------------------------------------

test('documento legado (só agentId) continua visível e editável', async () => {
  // A forma exata de antes do modelo de donos: sem `ownerType`, sem `ownerId`.
  const agentId = new ObjectId(meu.agent.scopeId)
  const legado = {
    _id: new ObjectId(),
    agentId,
    title: 'Documento antigo',
    content: 'gravado antes dos donos',
    source: 'manual',
    sourceRef: null,
    authorId: null,
    indexStatus: 'indexed',
    chunkCount: 1,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  }
  await db.collection('knowledge_documents').insertOne(legado)

  const lista = await pedir('GET', `/api/knowledge/documents?scopeType=agent&scopeId=${meu.agent.scopeId}`)
  assert.equal(lista.body.total, 1, 'o que foi gravado antes não pode sumir da tela')
  // E os campos que ele não tem recebem defaults seguros NA LEITURA — sem reescrever.
  assert.equal(lista.body.items[0].format, 'markdown')
  assert.equal(lista.body.items[0].lifecycleStatus, 'approved')
  assert.equal(lista.body.items[0].authority, 'reference')
  assert.equal(lista.body.items[0].confidence, null, 'ninguém mediu: o campo fica vazio, e não inventado')

  const lido = await pedir('GET', `/api/knowledge/documents/${legado._id}`)
  assert.equal(lido.status, 200)
  assert.equal(lido.body.content, 'gravado antes dos donos')

  const editado = await pedir('PATCH', `/api/knowledge/documents/${legado._id}`, { title: 'Documento antigo (revisado)' })
  assert.equal(editado.status, 200)

  // A leitura não reescreveu o documento: `format` continua ausente no banco.
  const bruto = await db.collection('knowledge_documents').findOne({ _id: legado._id })
  assert.equal(bruto.format, undefined, 'default na leitura não é migração silenciosa')
  assert.equal(bruto.createdAt.toISOString(), '2025-01-01T00:00:00.000Z')
})

// --- a porta antiga -------------------------------------------------------------------

test('a rota antiga do setor continua com o MESMO contrato — e agora confere cota', async () => {
  const antiga = await pedir('POST', `/api/sectors/${meu.sector.scopeId}/documents`, { title: 'Política de troca', content: 'sete dias' })
  assert.equal(antiga.status, 201)
  // A forma que a tela do setor já lia: `_id`, e não `id`.
  assert.ok(antiga.body._id)
  assert.equal(antiga.body.title, 'Política de troca')
  assert.equal(antiga.body.content, undefined)

  // E o documento é o MESMO objeto que a API unificada enxerga.
  const pela_nova = await pedir('GET', `/api/knowledge/documents/${antiga.body._id}`)
  assert.equal(pela_nova.status, 200)
  assert.equal(pela_nova.body.scopeType, 'sector')
  assert.equal(pela_nova.body.content, 'sete dias')
})

test('a rota antiga do setor recusa por COTA — o buraco que existia', async () => {
  // Era esta a exceção: o caminho do agente conferia a cota, o do setor não. Dava para
  // encher o disco escolhendo a porta.
  process.env.OWNER_STORAGE_QUOTA_BYTES = '50'
  const r = await pedir('POST', `/api/sectors/${meu.sector.scopeId}/documents`, { title: 'Grande', content: 'x'.repeat(500) })
  assert.equal(r.status, 413)
  assert.equal(r.body.code, 'storage_quota_exceeded')
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0, 'nada foi gravado')
})

test('a porta do AGENTE continua aceitando texto grande — o adaptador não ganhou teto novo', async () => {
  // A rota do agente nunca teve teto de caracteres: quem limita ali é a cota. O teto de
  // cem mil nasceu no setor, e aplicá-lo ao agente agora recusaria em silêncio um texto
  // que ontem entrava. É o que `maxContent: null` preserva.
  const { saveDocument, MAX_CONTENT } = await import('../dist/knowledgeService.js')
  const grande = 'x'.repeat(MAX_CONTENT + 5000)
  const doc = await saveDocument(DONO, { ownerType: 'agent', ownerId: new ObjectId(meu.agent.scopeId) }, { title: 'PDF extraído', content: grande, maxContent: null })
  assert.equal(doc.content.length, grande.length)

  // Sem `maxContent`, vale o teto da nota curada. (Pela rota JSON o corpo grande nem
  // chega aqui: o parser do Express recusa antes, com o limite dele.)
  await assert.rejects(
    () => saveDocument(DONO, { ownerType: 'agent', ownerId: new ObjectId(meu.agent.scopeId) }, { title: 'Colado', content: grande }),
    /at most/,
  )
})

// --- cota nos quatro ------------------------------------------------------------------

test('a cota vale nos QUATRO escopos, e conta o tamanho real', async () => {
  process.env.OWNER_STORAGE_QUOTA_BYTES = '50'
  for (const escopo of ESCOPOS) {
    const r = await pedir('POST', '/api/knowledge/documents', { ...meu[escopo], title: 'Grande', content: 'x'.repeat(500) })
    assert.equal(r.status, 413, `${escopo}: a cota precisa valer aqui também`)
    assert.equal(r.body.code, 'storage_quota_exceeded')
  }
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0)

  // E com espaço, entra.
  process.env.OWNER_STORAGE_QUOTA_BYTES = '100000'
  const ok = await pedir('POST', '/api/knowledge/documents', { ...meu.building, title: 'Cabe', content: 'pequeno' })
  assert.equal(ok.status, 201)
})

test('a cota também vale na EDIÇÃO: não dá para crescer depois de entrar pequeno', async () => {
  const criado = await pedir('POST', '/api/knowledge/documents', { ...meu.floor, title: 'Pequeno', content: 'ok' })
  assert.equal(criado.status, 201)
  process.env.OWNER_STORAGE_QUOTA_BYTES = '50'
  const cresceu = await pedir('PATCH', `/api/knowledge/documents/${criado.body.id}`, { content: 'y'.repeat(500) })
  assert.equal(cresceu.status, 413)
  const bruto = await db.collection('knowledge_documents').findOne({ _id: new ObjectId(criado.body.id) })
  assert.equal(bruto.content, 'ok', 'o texto anterior fica')
})

// --- curadoria ------------------------------------------------------------------------

test('ciclo de vida e autoridade são gravados; confiança não vem do cliente', async () => {
  const r = await pedir('POST', '/api/knowledge/documents', {
    ...meu.building,
    title: 'Política oficial',
    content: 'o que vale',
    lifecycleStatus: 'draft',
    authority: 'official_policy',
    validUntil: '2027-01-01T00:00:00.000Z',
    reviewIntervalDays: 90,
    confidence: { value: 0.99, method: 'achei' },
  })
  assert.equal(r.status, 201)
  assert.equal(r.body.lifecycleStatus, 'draft')
  assert.equal(r.body.authority, 'official_policy')
  assert.equal(r.body.reviewIntervalDays, 90)
  assert.equal(r.body.confidence, null, 'confiança não é opinião de quem envia')
  const bruto = await db.collection('knowledge_documents').findOne({ _id: new ObjectId(r.body.id) })
  assert.equal(bruto.confidence, undefined)

  // Valor fora do catálogo é recusado — e não gravado como texto livre.
  const invalido = await pedir('POST', '/api/knowledge/documents', { ...meu.building, title: 'x', content: 'y', authority: 'lei_divina' })
  assert.equal(invalido.status, 400)
  assert.match(invalido.body.error, /authority/)
})

// --- upload ---------------------------------------------------------------------------

/** Um envio multipart de verdade: é o formato que a rota recebe do navegador. */
const enviarArquivo = async (campos, { nome, tipo, conteudo }) => {
  const form = new FormData()
  for (const [k, v] of Object.entries(campos)) form.append(k, v)
  form.append('file', new Blob([conteudo], { type: tipo }), nome)
  const res = await fetch(`http://127.0.0.1:${port}/api/knowledge/documents/upload`, { method: 'POST', body: form })
  const texto = await res.text()
  return { status: res.status, body: texto ? JSON.parse(texto) : null }
}

test('o upload entra nos quatro escopos, com o texto extraído do arquivo', async () => {
  for (const escopo of ESCOPOS) {
    const r = await enviarArquivo(
      { ...meu[escopo], title: `Manual do ${escopo}` },
      { nome: 'manual.txt', tipo: 'text/plain', conteudo: `procedimento do ${escopo}` },
    )
    assert.equal(r.status, 201, `${escopo}: ${JSON.stringify(r.body)}`)
    assert.equal(r.body.scopeType, escopo)
    const lido = await pedir('GET', `/api/knowledge/documents/${r.body.id}`)
    assert.equal(lido.body.content, `procedimento do ${escopo}`)
  }
})

test('o upload confere a cota com o tamanho REAL do texto extraído', async () => {
  process.env.OWNER_STORAGE_QUOTA_BYTES = '50'
  const r = await enviarArquivo({ ...meu.floor, title: 'Grande' }, { nome: 'g.txt', tipo: 'text/plain', conteudo: 'x'.repeat(500) })
  assert.equal(r.status, 413)
  assert.equal(r.body.code, 'storage_quota_exceeded')
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0)
})

test('imagem fora do escopo do agente é RECUSADA — o provedor não se inventa', async () => {
  // Transcrever imagem exige um modelo, e modelo exige provedor. No andar não há de
  // quem herdar isso, e escolher "um que a conta tenha" seria inventar quem paga.
  const r = await enviarArquivo({ ...meu.floor, title: 'Foto' }, { nome: 'f.png', tipo: 'image/png', conteudo: 'binário' })
  assert.equal(r.status, 400)
  assert.match(r.body.error, /provider|agent/i)
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0)
})

test('o upload para a conta alheia é 404, e nada é extraído', async () => {
  const r = await enviarArquivo({ ...dele.agent, title: 'invasão' }, { nome: 'a.txt', tipo: 'text/plain', conteudo: 'não' })
  assert.equal(r.status, 404)
})

// --- limpeza --------------------------------------------------------------------------

test('apagar o documento apaga os pedaços dele', async () => {
  const r = await pedir('POST', '/api/knowledge/documents', { ...meu.sector, title: 'Com pedaços', content: 'texto' })
  const documentId = new ObjectId(r.body.id)
  await db.collection('knowledge_chunks').insertMany([
    { _id: new ObjectId(), documentId, ownerType: 'sector', ownerId: new ObjectId(meu.sector.scopeId), content: 'a', createdAt: new Date() },
    { _id: new ObjectId(), documentId, ownerType: 'sector', ownerId: new ObjectId(meu.sector.scopeId), content: 'b', createdAt: new Date() },
  ])

  assert.equal((await pedir('DELETE', `/api/knowledge/documents/${r.body.id}`)).status, 204)
  assert.equal(await db.collection('knowledge_chunks').countDocuments({ documentId }), 0, 'pedaço órfão continua respondendo na busca')
})

test('apagar o ANDAR leva a base dele — documentos e pedaços', async () => {
  const criado = await pedir('POST', '/api/knowledge/documents', { ...meu.floor, title: 'Do andar', content: 'horário' })
  const documentId = new ObjectId(criado.body.id)
  await db.collection('knowledge_chunks').insertOne({ _id: new ObjectId(), documentId, ownerType: 'floor', ownerId: new ObjectId(meu.floor.scopeId), content: 'horário', createdAt: new Date() })

  // O andar precisa estar VAZIO para sair (o domínio recusa levar gente junto), e o
  // prédio nunca fica sem andar — as duas regras valem aqui como valem na tela.
  await createFloor(DONO, { name: 'Outro' })
  await db.collection('sectors').deleteMany({ ownerId: DONO })
  await db.collection('agents').deleteMany({ ownerId: DONO })
  const r = await deleteFloor(DONO, new ObjectId(meu.floor.scopeId))
  assert.equal(r.ok, true, JSON.stringify(r))

  assert.equal(await db.collection('knowledge_documents').countDocuments({ _id: documentId }), 0)
  assert.equal(await db.collection('knowledge_chunks').countDocuments({ documentId }), 0, 'documento e pedaço pendurados em ninguém, para sempre')
})

// --- a base é uma só ------------------------------------------------------------------

test('os quatro donos moram na MESMA coleção, com o mesmo formato', async () => {
  for (const escopo of ESCOPOS) {
    await pedir('POST', '/api/knowledge/documents', { ...meu[escopo], title: `T ${escopo}`, content: `c ${escopo}` })
  }
  const todos = await db.collection('knowledge_documents').find({}).toArray()
  assert.equal(todos.length, 4, 'nenhuma base paralela')
  assert.deepEqual(todos.map((d) => d.ownerType).sort(), ['agent', 'building', 'floor', 'sector'])
  for (const d of todos) {
    assert.equal(withKnowledgeDefaults(d).format, 'markdown')
    assert.ok(d.ownerId instanceof ObjectId)
  }
  // E cada dono só enxerga o seu.
  for (const escopo of ESCOPOS) {
    const docs = await listDocumentsFor({ ownerType: escopo, ownerId: new ObjectId(meu[escopo].scopeId) })
    assert.equal(docs.length, 1, escopo)
    assert.equal(docs[0].title, `T ${escopo}`)
  }
})

test('escopo desconhecido não vira dono', async () => {
  const r = await pedir('POST', '/api/knowledge/documents', { scopeType: 'planeta', scopeId: new ObjectId().toString(), title: 'x', content: 'y' })
  assert.equal(r.status, 404)
  assert.equal(await resolveKnowledgeOwner(DONO, { scopeType: 'floor', scopeId: 'nao-e-um-id' }), null)
})

test('documento sem título ou sem conteúdo é recusado, e nada é gravado', async () => {
  for (const corpo of [{ title: '', content: 'x' }, { title: 'x', content: '   ' }, { title: 'x' }]) {
    const r = await pedir('POST', '/api/knowledge/documents', { ...meu.agent, ...corpo })
    assert.equal(r.status, 400, JSON.stringify(corpo))
  }
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0)
})

test('o dono do documento é derivado do documento — o cliente não escolhe', async () => {
  // Criado no setor; a rota de leitura não recebe escopo nenhum e mesmo assim resolve o
  // dono certo. É isso que impede "leia o documento X como se fosse do meu agente".
  const criado = await createDocumentFor({ ownerType: 'sector', ownerId: new ObjectId(meu.sector.scopeId) }, { title: 'Do setor', content: 'texto' })
  const lido = await pedir('GET', `/api/knowledge/documents/${criado._id}`)
  assert.equal(lido.body.scopeType, 'sector')
  assert.equal(lido.body.scopeId, meu.sector.scopeId)
})
