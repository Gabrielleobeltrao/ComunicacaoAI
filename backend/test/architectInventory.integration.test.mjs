// O INVENTÁRIO — o que a conta REALMENTE tem, e nada além.
//
// Três garantias, e as três valem mais do que a listagem em si: a conta vizinha nunca
// aparece; nenhuma credencial atravessa o inventário; e o resumo que vai para o modelo não
// carrega ObjectId — um id no contexto é um id que o modelo pode devolver, e um id devolvido
// pelo modelo é um id inventado.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const inv = await import('../dist/architect/inventory.js')

const DONO = 'dono-inventario'
const VIZINHO = 'vizinho'
let predio
let andar

const COLECOES = [
  'buildings', 'offices', 'agents', 'sectors', 'connections', 'data_stores',
  'dataset_definitions', 'database_grants', 'monitoring_sources', 'monitors', 'automations', 'tools', 'widgets',
]

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of COLECOES) await db.collection(c).deleteMany({})
  predio = new ObjectId()
  andar = new ObjectId()
  await db.collection('buildings').insertOne({ _id: predio, ownerId: DONO, name: 'Prédio QA', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: andar, ownerId: DONO, buildingId: predio, name: 'Atendimento', status: 'active', workMode: 'organization', createdAt: new Date(), updatedAt: new Date() })
})

test('ACEITAÇÃO: o inventário lê os domínios canônicos e diz quantos existem de cada tipo', async () => {
  const agenteId = new ObjectId()
  await db.collection('agents').insertOne({ _id: agenteId, ownerId: DONO, officeId: andar, name: 'Marina', role: 'Recebe o cliente', provider: 'anthropic', createdAt: new Date() })
  await db.collection('sectors').insertOne({ _id: new ObjectId(), ownerId: DONO, officeId: andar, name: 'Recepção', mode: 'orchestrated', members: [{ agentId: agenteId }], createdAt: new Date() })

  const i = await inv.loadOfficeInventory(DONO)
  assert.equal(i.ownerId, DONO)
  assert.equal(i.building.name, 'Prédio QA')
  assert.equal(i.sections.floor.total, 1)
  assert.equal(i.sections.agent.total, 1)
  assert.equal(i.sections.sector.total, 1)
  assert.equal(i.sections.agent.items[0].ownerScope, `floor:${andar.toString()}`)
  assert.equal(i.sections.agent.items[0].meta.hasRole, true)
})

test('AMEAÇA: o inventário de uma conta não enxerga nada da outra', async () => {
  const outroPredio = new ObjectId()
  await db.collection('buildings').insertOne({ _id: outroPredio, ownerId: VIZINHO, name: 'Prédio do vizinho', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: new ObjectId(), ownerId: VIZINHO, buildingId: outroPredio, name: 'Andar alheio', status: 'active', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('agents').insertOne({ _id: new ObjectId(), ownerId: VIZINHO, name: 'Agente alheio', provider: 'anthropic', createdAt: new Date() })

  const i = await inv.loadOfficeInventory(DONO)
  const inteiro = JSON.stringify(i)
  assert.equal(inteiro.includes('alheio'), false, 'nada do vizinho pode aparecer')
  assert.equal(inteiro.includes(outroPredio.toString()), false)
  assert.equal(i.sections.floor.total, 1)
})

test('AMEAÇA: nenhuma credencial atravessa o inventário', async () => {
  await db.collection('connections').insertOne({
    _id: new ObjectId(),
    ownerId: DONO,
    appKey: 'whatsapp',
    name: 'WhatsApp da loja',
    status: 'connected',
    // O que uma instalação real guarda, cifrado — e que não pode sair daqui de jeito nenhum.
    configEncrypted: 'v1:AAAA:BBBB:segredo-cifrado-que-nao-pode-vazar',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.collection('tools').insertOne({
    _id: new ObjectId(),
    ownerId: DONO,
    name: 'consultar_cep',
    description: 'Consulta um CEP',
    method: 'GET',
    url: 'https://viacep.com.br/ws/{{cep}}/json',
    headers: [{ key: 'Authorization', value: 'Bearer token-que-nao-pode-vazar' }],
    inputSchema: { type: 'object' },
    auth: { kind: 'api_key', secretEncrypted: 'cifrado-tambem' },
    createdAt: new Date(),
  })

  const i = await inv.loadOfficeInventory(DONO)
  const inteiro = JSON.stringify(i)
  for (const proibido of ['segredo-cifrado-que-nao-pode-vazar', 'token-que-nao-pode-vazar', 'cifrado-tambem', 'configEncrypted', 'secretEncrypted']) {
    assert.equal(inteiro.includes(proibido), false, `${proibido} vazou no inventário`)
  }
  assert.equal(i.sections.app.items[0].meta.connected, true, 'o que interessa é se está conectado')
})

test('o RESUMO não carrega ObjectId — um id no contexto é um id que o modelo pode devolver', async () => {
  await db.collection('agents').insertOne({ _id: new ObjectId(), ownerId: DONO, officeId: andar, name: 'Marina', role: 'Recebe', provider: 'anthropic', createdAt: new Date() })
  const i = await inv.loadOfficeInventory(DONO)
  const resumo = inv.summarizeInventory(i)

  assert.equal(resumo.building, 'Prédio QA')
  assert.equal(resumo.counts.agent, 1)
  assert.deepEqual(resumo.samples.agent, ['Marina'])
  // Nenhum ObjectId de 24 hex em lugar nenhum do resumo.
  assert.equal(/[0-9a-f]{24}/.test(JSON.stringify(resumo)), false, 'o resumo não pode levar id')
})

test('o resumo aponta o que está pela metade e muda a decisão', async () => {
  // O vocabulário é o do domínio: reautenticar não é o mesmo que reconectar, e o resumo
  // precisa dizer qual dos dois — é isso que muda a ação de quem lê.
  await db.collection('connections').insertOne({ _id: new ObjectId(), ownerId: DONO, appKey: 'google_calendar', name: 'Agenda', status: 'needs_reauth', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('connections').insertOne({ _id: new ObjectId(), ownerId: DONO, appKey: 'whatsapp', name: 'Zap', status: 'revoked', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('agents').insertOne({ _id: new ObjectId(), ownerId: DONO, officeId: andar, name: 'Sem papel', provider: 'anthropic', createdAt: new Date() })

  const resumo = inv.summarizeInventory(await inv.loadOfficeInventory(DONO))
  assert.ok(resumo.attention.some((a) => a.includes('Agenda') && a.includes('reautenticado')), JSON.stringify(resumo.attention))
  assert.ok(resumo.attention.some((a) => a.includes('Zap') && a.includes('revogado')))
  assert.ok(resumo.attention.some((a) => a.includes('Sem papel') && a.includes('sem responsabilidade')))
})

test('o inventário TRUNCA e diz que truncou, em vez de devolver o banco', async () => {
  const muitos = Array.from({ length: inv.INVENTORY_LIMITS.perKind + 25 }, (_, n) => ({
    _id: new ObjectId(),
    ownerId: DONO,
    officeId: andar,
    name: `Agente ${n}`,
    provider: 'anthropic',
    createdAt: new Date(),
  }))
  await db.collection('agents').insertMany(muitos)

  const i = await inv.loadOfficeInventory(DONO)
  assert.equal(i.sections.agent.items.length, inv.INVENTORY_LIMITS.perKind)
  assert.equal(i.sections.agent.total, inv.INVENTORY_LIMITS.perKind + 25, 'o total é o verdadeiro')
  assert.equal(i.sections.agent.truncated, true, 'e a resposta diz que cortou')

  const resumo = inv.summarizeInventory(i)
  assert.equal(resumo.samples.agent.length, inv.INVENTORY_LIMITS.summaryPerKind)
  assert.equal(resumo.counts.agent, inv.INVENTORY_LIMITS.perKind + 25)
})

// --- o grafo de dependências --------------------------------------------------------------

test('o grafo liga agente e setor ao andar — e a ligação é obrigatória', async () => {
  const agenteId = new ObjectId()
  await db.collection('agents').insertOne({ _id: agenteId, ownerId: DONO, officeId: andar, name: 'Marina', provider: 'anthropic', createdAt: new Date() })
  await db.collection('sectors').insertOne({ _id: new ObjectId(), ownerId: DONO, officeId: andar, name: 'Recepção', mode: 'organization', members: [], createdAt: new Date() })

  const g = inv.buildDependencyGraph(await inv.loadOfficeInventory(DONO))
  const paraOAndar = g.edges.filter((e) => e.to === inv.floorRef(andar))
  assert.equal(paraOAndar.length, 2)
  assert.ok(paraOAndar.every((e) => e.relation === 'mora_em' && e.required))
})

test('o grafo distingue "alimenta" de "observa": a fonte é dispensável, o dataset não', async () => {
  const store = new ObjectId()
  const recorder = new ObjectId()
  await db.collection('data_stores').insertOne({ _id: store, ownerId: DONO, name: 'Históricos', adapterKind: 'data_history', owner: { ownerType: 'building', ownerId: predio.toString() }, status: 'active', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('dataset_definitions').insertOne({ _id: new ObjectId(), ownerId: DONO, dataStoreId: store, key: recorder.toString(), name: 'Cotações', schema: {}, mutability: 'append_only', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('monitoring_sources').insertOne({
    _id: new ObjectId(), ownerId: DONO, name: 'Cotação CXSE3', kind: 'api_polling', status: 'active',
    scope: { ownerType: 'account', ownerId: DONO }, destination: { live: false, history: true, recorderId: recorder },
    telemetry: { lastReadAt: new Date(), lastOkAt: new Date(), lastErrorAt: null, lastErrorCode: null, lastLatencyMs: 10, consecutiveFailures: 0, readsOk: 1, readsFailed: 0, reconnects: 0 },
    freshness: { staleAfterMs: 900000, onStale: 'degrade' }, cadence: { mode: 'interval', intervalMs: 60000 },
  })
  await db.collection('monitors').insertOne({
    _id: new ObjectId(), ownerId: DONO, name: 'RSI baixo', status: 'published',
    source: { kind: 'database', dataStoreId: store, datasetKey: recorder.toString() },
    condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 }, triggerMode: 'enter',
    threshold: null, thresholdField: null, debounceMs: 0, cooldownMs: 0, action: null,
    createdAt: new Date(), updatedAt: new Date(),
  })

  const inventario = await inv.loadOfficeInventory(DONO)
  const g = inv.buildDependencyGraph(inventario)
  const dataset = inventario.sections.dataset.items[0]
  const paraODataset = g.edges.filter((e) => e.to === inv.nodeRef('dataset', dataset.id))

  const alimenta = paraODataset.find((e) => e.relation === 'alimenta')
  const observa = paraODataset.find((e) => e.relation === 'observa')
  assert.ok(alimenta, 'a fonte alimenta o conjunto')
  assert.equal(alimenta.required, false, 'sem a fonte a série para, não deixa de existir')
  assert.ok(observa, 'o monitor observa o conjunto')
  assert.equal(observa.required, true, 'sem o conjunto o monitor nunca dispara')
})

test('dependentsOf responde "o que quebra se isto sumir", sem entrar em laço', async () => {
  await db.collection('agents').insertOne({ _id: new ObjectId(), ownerId: DONO, officeId: andar, name: 'Marina', provider: 'anthropic', createdAt: new Date() })
  await db.collection('automations').insertOne({ _id: new ObjectId(), ownerId: DONO, floorId: andar, name: 'Avisar', status: 'active', createdAt: new Date(), updatedAt: new Date() })

  const g = inv.buildDependencyGraph(await inv.loadOfficeInventory(DONO))
  const dependentes = inv.dependentsOf(g, inv.floorRef(andar))
  assert.equal(dependentes.length, 2, 'o agente e o Flow dependem do andar')

  // Um ciclo forjado não pode transformar a análise num laço.
  const comCiclo = { nodes: g.nodes, edges: [...g.edges, { from: inv.floorRef(andar), to: g.edges[0].from, relation: 'forjada', required: false }] }
  const r = inv.dependentsOf(comCiclo, inv.floorRef(andar), 6)
  assert.ok(r.length <= comCiclo.edges.length, 'a travessia termina')
})

// --- canais e entregas -------------------------------------------------------------------------
//
// Sem eles, o Arquiteto propunha criar o canal que já existe, e a análise de impacto de um
// andar não sabia dizer o que a exclusão levaria junto.

test('o inventário lista CANAIS, dizendo se levam a alguém', async () => {
  const { createWidget } = await import('../dist/widgets.js')
  const agente = new ObjectId()
  await db.collection('agents').insertOne({ _id: agente, ownerId: DONO, officeId: andar, name: 'Marina', provider: 'anthropic', createdAt: new Date() })
  await createWidget(DONO, 'Chat do site', { agentId: agente })
  await createWidget(DONO, 'Chat órfão', {})

  const i = await inv.loadOfficeInventory(DONO)
  const canais = i.sections.channel.items
  assert.equal(canais.length, 2)
  assert.equal(canais.find((c) => c.label === 'Chat do site').status, 'bound')
  // Um canal sem quem receba é uma porta que não leva a lugar nenhum — e ele aparece.
  assert.equal(canais.find((c) => c.label === 'Chat órfão').status, 'unbound')
})

test('o inventário lista ENTREGAS — sem endereço nenhum', async () => {
  const { createConnection } = await import('../dist/connections/service.js')
  await createConnection(DONO, {
    provider: 'email',
    name: 'Meu e-mail',
    config: { host: 'smtp.exemplo.test', port: 587, secure: false, user: 'a@b.test', pass: 'nao-e-um-segredo-real', from: 'a@b.test' },
  })

  const i = await inv.loadOfficeInventory(DONO)
  const entregas = i.sections.delivery.items
  assert.equal(entregas.length, 1)
  assert.equal(entregas[0].label, 'Meu e-mail')
  assert.equal(entregas[0].meta.provider, 'email')
  // O endereço é dado pessoal: ele não viaja no inventário nem no resumo que vai ao modelo.
  assert.equal(/@/.test(JSON.stringify(entregas)), false)
})

test('AMEAÇA: canal e entrega de OUTRA conta não entram', async () => {
  const { createWidget } = await import('../dist/widgets.js')
  const { createConnection } = await import('../dist/connections/service.js')
  await createWidget('vizinho', 'Do vizinho', {})
  await createConnection('vizinho', {
    provider: 'email',
    name: 'E-mail do vizinho',
    config: { host: 'smtp.exemplo.test', port: 587, secure: false, user: 'v@b.test', pass: 'nao-e-um-segredo-real', from: 'v@b.test' },
  })

  const i = await inv.loadOfficeInventory(DONO)
  assert.equal(i.sections.channel.items.some((c) => c.label === 'Do vizinho'), false)
  assert.equal(i.sections.delivery.items.some((c) => c.label === 'E-mail do vizinho'), false)
})
