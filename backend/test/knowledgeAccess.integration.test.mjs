// O QUE CADA AGENTE PODE LER — a política, e a resolução dela em bases reais.
//
// A pergunta que estes testes respondem não é "a função devolve uma lista": é se a
// MESMA política produz as mesmas bases em todo executor, e se um id que veio de fora
// consegue virar permissão. Antes disto, cada fluxo montava a própria lista — e uma
// lista errada só aparece quando um agente responde com o que não devia ter lido.
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
const { knowledgeAccessRouter } = await import('../dist/routes/knowledgeAccessRoutes.js')
const { resolveKnowledgeOwnersForExecution, policyOf, LEGACY_POLICY, parseKnowledgeAccess, KnowledgeAccessError } = await import('../dist/knowledgeAccess.js')
const { retrieveForAgent } = await import('../dist/knowledgeRetrieval.js')
const { createDocumentFor, ensureKnowledgeIndexes } = await import('../dist/knowledge.js')
const { createAgent, getAgentById } = await import('../dist/agents.js')
const { createSector } = await import('../dist/sectors.js')
const { createFloor } = await import('../dist/floors.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')

const DONO = 'dono-acesso'
const VIZINHO = 'vizinho-acesso'
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
  app.use('/api/agents/:agentId', knowledgeAccessRouter)
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
  for (const c of ['knowledge_documents', 'knowledge_chunks', 'agents', 'sectors', 'offices', 'buildings']) {
    await db.collection(c).deleteMany({})
  }
  sessao = DONO
  cena = await montar(DONO)
})

/** Um escritório com os quatro donos, cada um com um documento próprio. */
async function montar(conta) {
  const andar = await createFloor(conta, { name: 'Atendimento' })
  const agente = await createAgent(conta, andar._id, 'Marina', { objective: 'atender' })
  const outro = await createAgent(conta, andar._id, 'Rafael', { objective: 'analisar' })
  const meuSetor = await createSector(conta, andar._id, 'Mesa', '#334455', 'orchestrated', [{ agentId: agente._id, order: 0 }])
  const outroSetor = await createSector(conta, andar._id, 'Retaguarda', '#556677', 'orchestrated', [{ agentId: outro._id, order: 0 }])
  const predio = await ensureDefaultBuilding(conta)

  // Um termo distintivo em todas: é ele que faz a busca exata encontrar as quatro bases
  // sem depender do provedor de embedding, que a suíte não tem.
  await createDocumentFor({ ownerType: 'agent', ownerId: agente._id }, { title: 'Base do agente', content: 'O protocolo PROT7788 no atendimento de Marina.' })
  await createDocumentFor({ ownerType: 'floor', ownerId: andar._id }, { title: 'Base do andar', content: 'O protocolo PROT7788 vale para o andar inteiro.' })
  await createDocumentFor({ ownerType: 'building', ownerId: predio._id }, { title: 'Base do prédio', content: 'O protocolo PROT7788 é política da empresa.' })
  await createDocumentFor({ ownerType: 'sector', ownerId: meuSetor._id }, { title: 'Base da mesa', content: 'O protocolo PROT7788 na mesa de atendimento.' })
  await createDocumentFor({ ownerType: 'sector', ownerId: outroSetor._id }, { title: 'Base da retaguarda', content: 'O protocolo PROT7788 na retaguarda.' })

  return { andar, agente, outro, meuSetor, outroSetor, predio }
}

const salvar = (politica, agentId) => db.collection('agents').updateOne({ _id: agentId ?? cena.agente._id }, { $set: { knowledgeAccess: politica } })
const recarregar = async (id) => getAgentById(DONO, id ?? cena.agente._id)

const tipos = (r) => r.owners.map((o) => o.ownerType).sort()
const motivos = (r) => Object.fromEntries(r.owners.map((o) => [o.ownerType, o.reason]))

// --- o legado --------------------------------------------------------------------------

test('agente sem política salva mantém EXATAMENTE o comportamento de hoje', async () => {
  const agente = await recarregar()
  assert.equal(agente.knowledgeAccess, undefined, 'nada foi gravado no agente')
  const p = policyOf(agente)
  assert.deepEqual(
    { own: p.own, building: p.building, floor: p.floor, sectorMode: p.sectorMode },
    { own: LEGACY_POLICY.own, building: LEGACY_POLICY.building, floor: LEGACY_POLICY.floor, sectorMode: LEGACY_POLICY.sectorMode },
  )

  // Base própria, e só. O setor entra apenas com contexto de execução validado.
  const sozinho = await resolveKnowledgeOwnersForExecution(DONO, agente)
  assert.deepEqual(tipos(sozinho), ['agent'])

  const comSetor = await resolveKnowledgeOwnersForExecution(DONO, agente, { verifiedSectorId: cena.meuSetor._id })
  assert.deepEqual(tipos(comSetor), ['agent', 'sector'])
  assert.equal(motivos(comSetor).sector, 'execution_sector')
})

test('a leitura NÃO grava política nenhuma no agente', async () => {
  await resolveKnowledgeOwnersForExecution(DONO, await recarregar(), { verifiedSectorId: cena.meuSetor._id })
  const bruto = await db.collection('agents').findOne({ _id: cena.agente._id })
  assert.equal(bruto.knowledgeAccess, undefined, 'default na leitura não é migração silenciosa')
})

// --- a matriz --------------------------------------------------------------------------

test('a matriz da política: cada chave liga exatamente uma base', async () => {
  const casos = [
    [{ own: true, building: false, floor: false, sectorMode: 'none' }, ['agent']],
    [{ own: false, building: false, floor: true, sectorMode: 'none' }, ['floor']],
    [{ own: false, building: true, floor: false, sectorMode: 'none' }, ['building']],
    [{ own: true, building: true, floor: true, sectorMode: 'none' }, ['agent', 'building', 'floor']],
    [{ own: false, building: false, floor: false, sectorMode: 'none' }, []],
  ]
  for (const [politica, esperado] of casos) {
    await salvar({ ...politica, selectedSectorIds: [], version: 1 })
    const r = await resolveKnowledgeOwnersForExecution(DONO, await recarregar())
    assert.deepEqual(tipos(r), esperado, JSON.stringify(politica))
  }
})

test('cada base diz POR QUE entrou', async () => {
  await salvar({ own: true, building: true, floor: true, sectorMode: 'home_sector', selectedSectorIds: [], version: 1 })
  const r = await resolveKnowledgeOwnersForExecution(DONO, await recarregar())
  assert.deepEqual(motivos(r), { agent: 'own', floor: 'floor', building: 'building', sector: 'home_sector' })
})

// --- os modos de setor -------------------------------------------------------------------

test('execution_context: só o setor EXPLÍCITO da execução, nunca o de casa', async () => {
  await salvar({ own: true, building: false, floor: false, sectorMode: 'execution_context', selectedSectorIds: [], version: 1 })
  const agente = await recarregar()

  // Marina é membro da Mesa. Sem contexto de execução, a base da Mesa não entra —
  // ser membro não é o mesmo que estar respondendo pelo setor.
  const sem = await resolveKnowledgeOwnersForExecution(DONO, agente)
  assert.deepEqual(tipos(sem), ['agent'])

  const com = await resolveKnowledgeOwnersForExecution(DONO, agente, { verifiedSectorId: cena.meuSetor._id })
  assert.deepEqual(
    com.owners.filter((o) => o.ownerType === 'sector').map((o) => o.ownerId.toString()),
    [cena.meuSetor._id.toString()],
  )
})

test('home_sector: a associação REAL do agente, e nada além', async () => {
  await salvar({ own: false, building: false, floor: false, sectorMode: 'home_sector', selectedSectorIds: [], version: 1 })
  const r = await resolveKnowledgeOwnersForExecution(DONO, await recarregar())
  assert.deepEqual(
    r.owners.map((o) => o.ownerId.toString()),
    [cena.meuSetor._id.toString()],
    'o setor do outro agente não é de casa',
  )
})

test('selected: só os setores persistidos, e reconferidos a cada execução', async () => {
  await salvar({ own: false, building: false, floor: false, sectorMode: 'selected', selectedSectorIds: [cena.outroSetor._id], version: 1 })
  const r = await resolveKnowledgeOwnersForExecution(DONO, await recarregar())
  assert.deepEqual(r.owners.map((o) => o.ownerId.toString()), [cena.outroSetor._id.toString()])
  assert.equal(motivos(r).sector, 'selected_sector')

  // O setor apagado para de entrar sem ninguém precisar limpar a política.
  await db.collection('sectors').deleteOne({ _id: cena.outroSetor._id })
  const depois = await resolveKnowledgeOwnersForExecution(DONO, await recarregar())
  assert.deepEqual(depois.owners, [])
})

test('none: setor nenhum, nem com contexto de execução', async () => {
  await salvar({ own: true, building: false, floor: false, sectorMode: 'none', selectedSectorIds: [], version: 1 })
  const r = await resolveKnowledgeOwnersForExecution(DONO, await recarregar(), { verifiedSectorId: cena.meuSetor._id })
  assert.deepEqual(tipos(r), ['agent'], 'quem escolheu "nenhum" não recebe setor por contexto')
})

test('o mesmo setor por dois caminhos é UMA base, não duas', async () => {
  await salvar({ own: false, building: false, floor: false, sectorMode: 'selected', selectedSectorIds: [cena.meuSetor._id], version: 1 })
  const r = await resolveKnowledgeOwnersForExecution(DONO, await recarregar(), { verifiedSectorId: cena.meuSetor._id })
  assert.equal(r.owners.length, 1, 'base repetida é orçamento gasto duas vezes com o mesmo texto')
})

// --- isolamento ---------------------------------------------------------------------------

test('setor de OUTRA conta não vira permissão por ter sido enviado', async () => {
  const alheio = await montar(VIZINHO)
  await assert.rejects(
    () => parseKnowledgeAccess(DONO, { own: true, sectorMode: 'selected', selectedSectorIds: [alheio.meuSetor._id.toString()] }),
    (e) => e instanceof KnowledgeAccessError && /não encontrado/.test(e.message),
  )
  // E a recusa é a mesma de um id que não existe em lugar nenhum.
  await assert.rejects(
    () => parseKnowledgeAccess(DONO, { own: true, sectorMode: 'selected', selectedSectorIds: [new ObjectId().toString()] }),
    /não encontrado/,
  )
  await assert.rejects(() => parseKnowledgeAccess(DONO, { own: true, sectorMode: 'selected', selectedSectorIds: ['nao-e-id'] }), /não encontrado/)
})

test('um setor gravado à força na política não é lido se não for desta conta', async () => {
  // A política é conferida A CADA execução, e não só na hora de salvar: um setor que
  // mudou de dono, ou que entrou no banco por outro caminho, não vira base.
  const alheio = await montar(VIZINHO)
  await salvar({ own: false, building: false, floor: false, sectorMode: 'selected', selectedSectorIds: [alheio.meuSetor._id], version: 1 })
  const r = await resolveKnowledgeOwnersForExecution(DONO, await recarregar())
  assert.deepEqual(r.owners, [])
})

test('agente de outra conta não resolve base nenhuma', async () => {
  const alheio = await montar(VIZINHO)
  const r = await resolveKnowledgeOwnersForExecution(DONO, alheio.agente)
  assert.deepEqual(r.owners, [])
})

// --- a API ---------------------------------------------------------------------------------

test('a API mostra o padrão e diz que ele NÃO foi configurado', async () => {
  const r = await pedir('GET', `/api/agents/${cena.agente._id}/knowledge-access`)
  assert.equal(r.status, 200)
  assert.equal(r.body.configured, false, 'dizer "configurado" sobre um padrão é mentir sobre uma escolha')
  assert.equal(r.body.own, true)
  assert.equal(r.body.sectorMode, 'execution_context')
})

test('salvar a política grava explicitamente, e passa a valer', async () => {
  const r = await pedir('PUT', `/api/agents/${cena.agente._id}/knowledge-access`, {
    own: true,
    building: true,
    floor: true,
    sectorMode: 'selected',
    selectedSectorIds: [cena.outroSetor._id.toString()],
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.configured, true)
  assert.deepEqual(r.body.selectedSectorIds, [cena.outroSetor._id.toString()])

  const resolvido = await resolveKnowledgeOwnersForExecution(DONO, await recarregar())
  assert.deepEqual(tipos(resolvido), ['agent', 'building', 'floor', 'sector'])
})

test('a API recusa valores inválidos, e não grava nada', async () => {
  for (const corpo of [
    { sectorMode: 'qualquer_coisa' },
    { own: 'sim' },
    { sectorMode: 'selected', selectedSectorIds: [] },
    { sectorMode: 'selected', selectedSectorIds: [new ObjectId().toString()] },
  ]) {
    const r = await pedir('PUT', `/api/agents/${cena.agente._id}/knowledge-access`, corpo)
    assert.equal(r.status, 400, JSON.stringify(corpo))
  }
  assert.equal((await db.collection('agents').findOne({ _id: cena.agente._id })).knowledgeAccess, undefined)
})

test('o agente de outra conta responde 404 — igual ao que não existe', async () => {
  const alheio = await montar(VIZINHO)
  for (const [metodo, corpo] of [['GET', undefined], ['PUT', { own: true }]]) {
    const r = await pedir(metodo, `/api/agents/${alheio.agente._id}/knowledge-access`, corpo)
    assert.equal(r.status, 404)
    assert.deepEqual(r.body, { code: 'not_found', message: 'not found' })
  }
  const inexistente = await pedir('GET', `/api/agents/${new ObjectId()}/knowledge-access`)
  assert.equal(inexistente.status, 404)
  assert.deepEqual(inexistente.body, { code: 'not_found', message: 'not found' })
})

test('a política resolvida mostra as bases com nome — regra não se confere lendo regra', async () => {
  await pedir('PUT', `/api/agents/${cena.agente._id}/knowledge-access`, { own: true, floor: true, sectorMode: 'none' })
  const r = await pedir('GET', `/api/agents/${cena.agente._id}/knowledge-access/resolved`)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.owners.map((o) => o.ownerType).sort(), ['agent', 'floor'])
  assert.equal(r.body.owners.find((o) => o.ownerType === 'floor').name, 'Atendimento')
  assert.equal(r.body.owners.find((o) => o.ownerType === 'agent').reason, 'own')
})

// --- a busca conjunta ------------------------------------------------------------------------

test('a busca cobre as quatro bases num orçamento SÓ', async () => {
  await salvar({ own: true, building: true, floor: true, sectorMode: 'execution_context', selectedSectorIds: [], version: 1 })
  const r = await retrieveForAgent(DONO, await recarregar(), 'PROT7788', { verifiedSectorId: cena.meuSetor._id, minScore: 0, topK: 10 })
  assert.deepEqual(r.owners.map((o) => o.ownerType).sort(), ['agent', 'building', 'floor', 'sector'])

  // Sem provedor de embedding a vetorial não roda; a exata responde — e é ela que prova
  // que as quatro bases entraram na MESMA seleção, e não em quatro seleções somadas.
  assert.equal(r.status, 'ok', JSON.stringify(r))
  const donos = new Set(r.sources.map((s) => s.ownerType))
  assert.deepEqual([...donos].sort(), ['agent', 'building', 'floor', 'sector'], 'a seleção mistura escopos')
  // A proveniência de cada trecho: de onde veio, por quê, quanto casou e por qual busca.
  for (const fonte of r.sources) {
    assert.ok(fonte.documentId, 'sem documento não há como conferir a citação')
    assert.ok(fonte.title)
    assert.ok(fonte.reason, 'cada trecho diz por que aquela base estava disponível')
    assert.equal(typeof fonte.score, 'number')
    assert.equal(fonte.retrieval, 'lexical')
  }
  assert.equal(r.sources.find((s) => s.ownerType === 'sector').reason, 'execution_sector')
})

test('o orçamento global não cresce por base ligada', async () => {
  await salvar({ own: true, building: true, floor: true, sectorMode: 'home_sector', selectedSectorIds: [], version: 1 })
  const r = await retrieveForAgent(DONO, await recarregar(), 'PROT7788', { topK: 2, minScore: 0 })
  assert.equal(r.status, 'ok')
  assert.equal(r.context.length, 2, `quatro bases não podem virar quatro cotas: ${r.context.length}`)

  // O teto de caracteres também é um só.
  const curto = await retrieveForAgent(DONO, await recarregar(), 'PROT7788', { topK: 10, charBudget: 60, minScore: 0 })
  assert.ok(curto.context.join('').length <= 60, 'o orçamento de caracteres vale para a seleção inteira')
})

test('trecho repetido em duas bases entra UMA vez', async () => {
  const mesmoTexto = 'A política de troca vale por sete dias corridos.'
  await createDocumentFor({ ownerType: 'agent', ownerId: cena.agente._id }, { title: 'Cópia A', content: mesmoTexto })
  await createDocumentFor({ ownerType: 'floor', ownerId: cena.andar._id }, { title: 'Cópia B', content: mesmoTexto })
  await salvar({ own: true, building: false, floor: true, sectorMode: 'none', selectedSectorIds: [], version: 1 })

  const r = await retrieveForAgent(DONO, await recarregar(), 'política de troca sete dias', { minScore: 0 })
  const iguais = r.context.filter((c) => c.includes('sete dias corridos'))
  assert.ok(iguais.length <= 1, 'o mesmo texto duas vezes é orçamento gasto duas vezes com a mesma coisa')
})

test('política que não dá base nenhuma é "não permitido", e não "não encontrei"', async () => {
  await salvar({ own: false, building: false, floor: false, sectorMode: 'none', selectedSectorIds: [], version: 1 })
  const r = await retrieveForAgent(DONO, await recarregar(), 'qualquer coisa')
  assert.equal(r.status, 'denied')
  assert.deepEqual(r.context, [])
  assert.deepEqual(r.owners, [])
  assert.equal(r.failed, false, 'não é falha: é uma decisão do dono')
})

test('falha na busca NÃO vira "não há conhecimento"', async () => {
  // O caso que produzia a pior resposta possível: o agente lia "nada encontrado",
  // concluía que não tinha base e afirmava ausência sobre uma base cheia.
  const { retrieveForOwners } = await import('../dist/knowledge.js')
  const documentos = db.collection('knowledge_documents')
  await documentos.updateOne({ ownerType: 'agent', ownerId: cena.agente._id }, { $set: { indexStatus: 'error' } })
  const r = await retrieveForOwners([{ ownerType: 'agent', ownerId: cena.agente._id, reason: 'own' }], 'termo-que-nao-existe-em-lugar-nenhum')
  assert.equal(r.status, 'unavailable')
  assert.equal(r.failed, true)
})
