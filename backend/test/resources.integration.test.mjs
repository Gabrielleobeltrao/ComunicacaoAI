// O CATÁLOGO COMUM — e a promessa de que ele não afrouxa nenhum gate.
//
// A tentação desta camada é escrever uma regra genérica de herança e aplicá-la a tudo.
// Ela produziria respostas plausíveis e erradas: o gate do App é instalação utilizável
// mais ação concedida mais autorização de escrita; o do Knowledge é uma política com
// quatro modos de setor. Estes testes existem para que a camada comum continue delegando.
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
const { resourceRouter, agentResourceAccessRouter } = await import('../dist/routes/resourceRoutes.js')
const { listResources } = await import('../dist/resources/catalog.js')
const { resolveResourceAccess, resolveAgentResourceAccess } = await import('../dist/resources/access.js')
const { resolveSubject, parseSubject } = await import('../dist/resources/scope.js')
const { adapterFor, availableKinds } = await import('../dist/resources/registry.js')
const { AGENT_CAPABILITIES, CAPABILITIES, agentCapabilitiesOnly } = await import('../dist/resources/types.js')
const { ensureKnowledgeIndexes, createDocumentFor } = await import('../dist/knowledge.js')
const { ensureContextManifestIndexes } = await import('../dist/contextManifest.js')
const { createAgent, getAgentById, updateAgent } = await import('../dist/agents.js')
const { createSector } = await import('../dist/sectors.js')
const { createFloor } = await import('../dist/floors.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')
const { createTool } = await import('../dist/tools.js')

const DONO = 'dono-recursos'
const VIZINHO = 'vizinho-recursos'
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
  await ensureContextManifestIndexes()
  const app = express()
  app.use(express.json())
  app.use((_req, res, next) => {
    res.locals.userId = sessao
    next()
  })
  app.use('/api/resources', resourceRouter)
  app.use('/api/agents/:agentId', agentResourceAccessRouter)
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

async function escritorio(conta) {
  const andar = await createFloor(conta, { name: 'Atendimento' })
  const marina = await createAgent(conta, andar._id, 'Marina', { objective: 'atender' })
  const rafael = await createAgent(conta, andar._id, 'Rafael', { objective: 'analisar' })
  const setor = await createSector(conta, andar._id, 'Mesa', '#4466aa', 'orchestrated', [{ agentId: marina._id, order: 0 }])
  const predio = await ensureDefaultBuilding(conta)
  const docAgente = await createDocumentFor({ ownerType: 'agent', ownerId: marina._id }, { title: `Base da Marina (${conta})`, content: 'texto' })
  const docAndar = await createDocumentFor({ ownerType: 'floor', ownerId: andar._id }, { title: `Base do andar (${conta})`, content: 'texto' })
  const ferramenta = await createTool(conta, {
    name: `consulta_${conta.replace(/[^a-z]/g, '')}`,
    description: 'consulta alguma coisa',
    method: 'GET',
    url: 'https://exemplo.test/consulta',
    inputSchema: { type: 'object', properties: {} },
  })
  return { andar, marina, rafael, setor, predio, docAgente, docAndar, ferramenta }
}

let meu
let dele

beforeEach(async () => {
  for (const c of ['knowledge_documents', 'knowledge_chunks', 'agents', 'sectors', 'offices', 'buildings', 'tools', 'connections', 'context_manifests', 'resource_access_events']) {
    await db.collection(c).deleteMany({})
  }
  sessao = DONO
  meu = await escritorio(DONO)
  dele = await escritorio(VIZINHO)
})

const politica = (agentId, p) =>
  db.collection('agents').updateOne({ _id: agentId }, { $set: { knowledgeAccess: { version: 1, own: true, building: false, floor: false, sectorMode: 'none', selectedSectorIds: [], ...p } } })

// --- o contrato ---------------------------------------------------------------------------

test('o catálogo lista os tipos que TÊM fonte canônica, e só eles', async () => {
  const tipos = availableKinds()
  assert.deepEqual(tipos.sort(), ['app', 'database', 'knowledge', 'tool'])
  assert.ok(adapterFor('database'))
})

test('capacidade administrativa NUNCA é de agente', () => {
  for (const kind of ['knowledge', 'app', 'tool']) {
    for (const cap of AGENT_CAPABILITIES[kind]) assert.ok(CAPABILITIES[kind].includes(cap), `${kind}.${cap}`)
  }
  assert.equal(AGENT_CAPABILITIES.knowledge.includes('manage'), false)
  assert.equal(AGENT_CAPABILITIES.tool.includes('publish'), false)
  assert.equal(AGENT_CAPABILITIES.database.includes('manage_schema'), false)
  assert.equal(AGENT_CAPABILITIES.database.includes('manage_access'), false)
})

test('o catálogo mostra os recursos da conta, agrupados por tipo', async () => {
  const r = await pedir('GET', '/api/resources')
  assert.equal(r.status, 200)
  assert.ok(r.body.byKind.knowledge >= 2)
  assert.equal(r.body.byKind.tool, 1)
  // E nada da outra conta.
  const nomes = r.body.items.map((i) => i.name).join(' ')
  assert.equal(nomes.includes(VIZINHO), false, 'recurso de outra conta no catálogo')
})

// --- isolamento ------------------------------------------------------------------------------

test('o id de outra conta responde 404 — a MESMA recusa de um id que não existe', async () => {
  const casos = [
    ['knowledge', dele.docAgente._id.toString()],
    ['tool', dele.ferramenta._id.toString()],
  ]
  for (const [kind, id] of casos) {
    const r = await pedir('GET', `/api/resources/${kind}/${id}`)
    assert.equal(r.status, 404, kind)
    assert.deepEqual(r.body, { code: 'not_found', message: 'not found' })
    const inexistente = await pedir('GET', `/api/resources/${kind}/${new ObjectId()}`)
    assert.deepEqual(inexistente.body, r.body, `${kind}: as duas recusas precisam ser iguais`)
  }
})

test('o escopo de outra conta não filtra nada', async () => {
  const r = await pedir('GET', `/api/resources?scopeType=agent&scopeId=${dele.marina._id}`)
  assert.equal(r.status, 404)
  assert.equal(await resolveSubject(DONO, { subjectType: 'agent', subjectId: dele.marina._id.toString() }), null)
  assert.equal(await resolveSubject(DONO, { subjectType: 'sector', subjectId: dele.setor._id.toString() }), null)
  assert.equal(await resolveSubject(DONO, { subjectType: 'floor', subjectId: dele.andar._id.toString() }), null)
  assert.equal(await resolveSubject(DONO, { subjectType: 'building', subjectId: dele.predio._id.toString() }), null)
})

test('perguntar o acesso com um agente de OUTRA conta não devolve a política dele', async () => {
  const r = await resolveResourceAccess({
    accountId: DONO,
    kind: 'knowledge',
    resourceId: meu.docAgente._id.toString(),
    actorAgentId: dele.marina._id,
  })
  assert.equal(r.allowed, false)
  assert.equal(r.origin, 'none')
})

test('id malformado não vira consulta', async () => {
  assert.equal(parseSubject('agent', ''), null)
  assert.equal(parseSubject('planeta', 'x'), null)
  assert.equal(await resolveSubject(DONO, { subjectType: 'agent', subjectId: 'nao-e-um-id' }), null)
})

// --- Knowledge: a decisão continua sendo da política especializada -------------------------------

test('o acesso a Knowledge sai da política do agente — com a origem certa', async () => {
  await politica(meu.marina._id, { own: true, floor: false })
  const propria = await resolveResourceAccess({ accountId: DONO, kind: 'knowledge', resourceId: meu.docAgente._id.toString(), actorAgentId: meu.marina._id })
  assert.equal(propria.allowed, true)
  assert.equal(propria.origin, 'direct')
  assert.deepEqual(propria.capabilities, ['discover', 'retrieve'], 'agente lê; curar é ação de gente')

  const doAndar = await resolveResourceAccess({ accountId: DONO, kind: 'knowledge', resourceId: meu.docAndar._id.toString(), actorAgentId: meu.marina._id })
  assert.equal(doAndar.allowed, false)
  assert.match(doAndar.reason, /não inclui esta base/)

  // Ligando o andar na política, o mesmo documento passa a valer — e a origem diz de onde.
  await politica(meu.marina._id, { own: true, floor: true })
  const depois = await resolveResourceAccess({ accountId: DONO, kind: 'knowledge', resourceId: meu.docAndar._id.toString(), actorAgentId: meu.marina._id })
  assert.equal(depois.allowed, true)
  assert.equal(depois.origin, 'floor')
  assert.match(depois.reason, /andar/)
})

test('o setor entra pelo modo da política, e a origem é "sector"', async () => {
  const doSetor = await createDocumentFor({ ownerType: 'sector', ownerId: meu.setor._id }, { title: 'Base da mesa', content: 'x' })
  await politica(meu.marina._id, { own: false, sectorMode: 'home_sector' })
  const r = await resolveResourceAccess({ accountId: DONO, kind: 'knowledge', resourceId: doSetor._id.toString(), actorAgentId: meu.marina._id })
  assert.equal(r.allowed, true)
  assert.equal(r.origin, 'sector')
  assert.match(r.reason, /membro/)

  // O Rafael não é membro: mesmo documento, decisão oposta.
  await politica(meu.rafael._id, { own: false, sectorMode: 'home_sector' })
  const outro = await resolveResourceAccess({ accountId: DONO, kind: 'knowledge', resourceId: doSetor._id.toString(), actorAgentId: meu.rafael._id })
  assert.equal(outro.allowed, false)
})

test('a lista "disponível" de um agente é exatamente o que a política resolve', async () => {
  await politica(meu.marina._id, { own: true, floor: true })
  const r = await listResources({ accountId: DONO, kinds: ['knowledge'], subject: { subjectType: 'agent', subjectId: meu.marina._id.toString() }, access: 'available' })
  const ids = r.items.map((i) => i.id).sort()
  assert.deepEqual(ids, [meu.docAgente._id.toString(), meu.docAndar._id.toString()].sort())

  await politica(meu.marina._id, { own: true, floor: false })
  const menor = await listResources({ accountId: DONO, kinds: ['knowledge'], subject: { subjectType: 'agent', subjectId: meu.marina._id.toString() }, access: 'available' })
  assert.deepEqual(menor.items.map((i) => i.id), [meu.docAgente._id.toString()])
})

// --- Tools: atribuição é a permissão --------------------------------------------------------------

test('ferramenta não atribuída é negada — atribuir É conceder', async () => {
  const negada = await resolveResourceAccess({ accountId: DONO, kind: 'tool', resourceId: meu.ferramenta._id.toString(), actorAgentId: meu.marina._id })
  assert.equal(negada.allowed, false)
  assert.match(negada.reason, /não está atribuída/)

  await updateAgent(DONO, meu.marina._id, { toolIds: [meu.ferramenta._id.toString()] })
  const permitida = await resolveResourceAccess({ accountId: DONO, kind: 'tool', resourceId: meu.ferramenta._id.toString(), actorAgentId: meu.marina._id })
  assert.equal(permitida.allowed, true)
  assert.deepEqual(permitida.capabilities, ['discover', 'execute'])
})

test('ferramenta desligada vira PENDÊNCIA, e não acesso funcional', async () => {
  await updateAgent(DONO, meu.marina._id, { toolIds: [meu.ferramenta._id.toString()] })
  await db.collection('tools').updateOne({ _id: meu.ferramenta._id }, { $set: { enabled: false } })
  const r = await resolveResourceAccess({ accountId: DONO, kind: 'tool', resourceId: meu.ferramenta._id.toString(), actorAgentId: meu.marina._id })
  assert.equal(r.allowed, false)
  assert.equal(r.pending.code, 'tool_desligada')
  assert.ok(r.pending.message)
})

test('ferramenta que ESCREVE exige execução autônoma autorizada', async () => {
  const escreve = await createTool(DONO, {
    name: 'registrar_pedido',
    description: 'registra um pedido',
    method: 'POST',
    url: 'https://exemplo.test/pedidos',
    inputSchema: { type: 'object', properties: {} },
  })
  await updateAgent(DONO, meu.marina._id, { toolIds: [escreve._id.toString()] })

  const semAutorizar = await resolveResourceAccess({ accountId: DONO, kind: 'tool', resourceId: escreve._id.toString(), actorAgentId: meu.marina._id })
  assert.equal(semAutorizar.allowed, false, 'ler é uma decisão; agir é outra')
  assert.equal(semAutorizar.pending.code, 'escrita_nao_autorizada')

  await db.collection('tools').updateOne({ _id: escreve._id }, { $set: { allowAutonomousExecution: true } })
  const autorizada = await resolveResourceAccess({ accountId: DONO, kind: 'tool', resourceId: escreve._id.toString(), actorAgentId: meu.marina._id })
  assert.equal(autorizada.allowed, true)
})

// --- Apps: os três gates ------------------------------------------------------------------------------

test('App sem grant é negado; com grant e sem conexão vira pendência', async () => {
  const semGrant = await resolveResourceAccess({ accountId: DONO, kind: 'app', resourceId: 'web_chat', actorAgentId: meu.marina._id })
  assert.equal(semGrant.allowed, false)
  assert.match(semGrant.reason, /nenhuma ação concedida/)

  // Grant apontando para uma conexão que não existe: pendência acionável, não acesso.
  await db.collection('agents').updateOne(
    { _id: meu.marina._id },
    { $set: { appGrants: [{ installationId: new ObjectId().toString(), appKey: 'web_chat', actionKeys: ['reply'], resourceConfig: {}, autonomousWriteActionKeys: [] }] } },
  )
  const semConexao = await resolveResourceAccess({ accountId: DONO, kind: 'app', resourceId: 'web_chat', actorAgentId: meu.marina._id })
  assert.equal(semConexao.allowed, false)
  assert.ok(['conexao_ausente', 'app_em_breve'].includes(semConexao.pending.code))
})

// --- a matriz do agente ---------------------------------------------------------------------------------

test('a matriz mostra o NEGADO com o motivo — senão ninguém descobre por que não funciona', async () => {
  await politica(meu.marina._id, { own: true, floor: false })
  const linhas = await resolveAgentResourceAccess(DONO, meu.marina._id)
  const doAndar = linhas.find((l) => l.resourceId === meu.docAndar._id.toString())
  assert.ok(doAndar, 'o recurso negado precisa aparecer na matriz')
  assert.equal(doAndar.decision.allowed, false)
  assert.ok(doAndar.decision.reason)
  const propria = linhas.find((l) => l.resourceId === meu.docAgente._id.toString())
  assert.equal(propria.decision.allowed, true)
})

test('a matriz de um agente de outra conta é vazia', async () => {
  assert.deepEqual(await resolveAgentResourceAccess(DONO, dele.marina._id), [])
  const r = await pedir('GET', `/api/agents/${dele.marina._id}/resource-access`)
  assert.deepEqual(r.body.items, [])
})

test('a rota da matriz devolve origem, pendência e capacidades', async () => {
  await updateAgent(DONO, meu.marina._id, { toolIds: [meu.ferramenta._id.toString()] })
  const r = await pedir('GET', `/api/agents/${meu.marina._id}/resource-access`)
  assert.equal(r.status, 200)
  const ferramenta = r.body.items.find((i) => i.kind === 'tool')
  assert.equal(ferramenta.allowed, true)
  assert.equal(ferramenta.origin, 'direct')
  assert.deepEqual(ferramenta.capabilities, ['discover', 'execute'])
})

// --- capacidade pedida ------------------------------------------------------------------------------------

test('a trava corta capacidade administrativa mesmo que um adapter a devolva', () => {
  // Redundante por desenho: os adapters já limitam. Esta é a garantia de que um tipo
  // novo escrito às pressas — ou um `return CAPABILITIES[kind]` copiado do ramo
  // administrativo — não transforma "publicar" numa ferramenta de LLM.
  assert.deepEqual(agentCapabilitiesOnly('tool', ['discover', 'execute', 'publish', 'manage_access']), ['discover', 'execute'])
  assert.deepEqual(agentCapabilitiesOnly('knowledge', ['retrieve', 'manage', 'curate']), ['retrieve'])
  assert.deepEqual(agentCapabilitiesOnly('database', ['query', 'manage_schema', 'manage_access']), ['query'])
  assert.deepEqual(agentCapabilitiesOnly('app', ['execute', 'manage']), ['execute'])
})

test('pedir uma capacidade administrativa como agente é sempre negado', async () => {
  await politica(meu.marina._id, { own: true })
  const r = await resolveResourceAccess({
    accountId: DONO,
    kind: 'knowledge',
    resourceId: meu.docAgente._id.toString(),
    actorAgentId: meu.marina._id,
    requestedCapability: 'manage',
  })
  assert.equal(r.allowed, false, '"administrar" não vira ferramenta de LLM por um caminho que ninguém revisou')
})

test('sem agente, a pergunta é administrativa — e quem administra a conta administra', async () => {
  const r = await resolveResourceAccess({ accountId: DONO, kind: 'knowledge', resourceId: meu.docAgente._id.toString() })
  assert.equal(r.allowed, true)
  assert.equal(r.origin, 'owner')
  assert.ok(r.capabilities.includes('manage'))
})

// --- impacto -----------------------------------------------------------------------------------------------

test('o impacto separa quem pode usar de quem usou', async () => {
  await updateAgent(DONO, meu.marina._id, { toolIds: [meu.ferramenta._id.toString()] })
  const r = await pedir('GET', `/api/resources/tool/${meu.ferramenta._id}/impact`)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.accessibleBy.map((a) => a.name), ['Marina'])
  assert.equal(r.body.usedCount, 0, 'zero aqui é evidência, não estimativa')
  assert.equal(r.body.recommendation, 'prefer_archive')
})

test('o impacto de um recurso de outra conta é 404', async () => {
  const r = await pedir('GET', `/api/resources/tool/${dele.ferramenta._id}/impact`)
  assert.equal(r.status, 404)
})

// --- a flag ----------------------------------------------------------------------------------------------------

test('a flag desligada NEGA a rota, e não só esconde a tela', async () => {
  process.env.RESOURCE_PLATFORM_ENABLED = '0'
  try {
    const r = await pedir('GET', '/api/resources')
    assert.equal(r.status, 404)
    const matriz = await pedir('GET', `/api/agents/${meu.marina._id}/resource-access`)
    assert.equal(matriz.status, 404)
  } finally {
    delete process.env.RESOURCE_PLATFORM_ENABLED
  }
})
