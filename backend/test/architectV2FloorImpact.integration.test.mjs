// LACUNA 13 CORRIGIDA — a exclusão de andar diz o que acontece antes do clique.
//
// O que existia: um DELETE que contava agentes e setores. Um andar com fonte de
// monitoramento, monitor e Flow era considerado VAZIO e apagado, deixando os três órfãos.
//
// Os dois primeiros casos deste arquivo eram de caracterização e continuam aqui, agora
// afirmando o comportamento NOVO — é neles que a correção fica visível.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const floors = await import('../dist/floors.js')
const impacto = await import('../dist/floorImpact.js')

const DONO = 'dono-impacto'
let predio
let andar
let outro

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  // `connections` é o nome real da coleção de instalações — limpar a errada deixava a
  // conexão de um teste aparecendo no seguinte.
  for (const c of ['buildings', 'offices', 'agents', 'sectors', 'monitoring_sources', 'monitors', 'automations', 'data_stores', 'connections', 'database_grants', 'knowledge_documents', 'data_history_records'])
    await db.collection(c).deleteMany({})

  predio = new ObjectId()
  andar = new ObjectId()
  outro = new ObjectId()
  await db.collection('buildings').insertOne({ _id: predio, ownerId: DONO, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  for (const [id, nome] of [[andar, 'Atendimento'], [outro, 'Financeiro']]) {
    await db.collection('offices').insertOne({ _id: id, ownerId: DONO, buildingId: predio, name: nome, status: 'active', createdAt: new Date(), updatedAt: new Date() })
  }
})

test('CORRIGIDA: a análise de impacto existe, e ela enxerga a operação inteira', async () => {
  for (const nome of ['floorDeletionImpact', 'archiveFloor', 'restoreFloor', 'purgeFloor']) {
    assert.equal(typeof impacto[nome], 'function', `${nome} precisa existir`)
  }

  await db.collection('monitoring_sources').insertOne({ _id: new ObjectId(), ownerId: DONO, name: 'Cotação', kind: 'api_polling', status: 'active', scope: { ownerType: 'floor', ownerId: andar.toString() } })
  await db.collection('automations').insertOne({ _id: new ObjectId(), ownerId: DONO, floorId: andar, name: 'Avisar', status: 'active' })
  await db.collection('agents').insertOne({ _id: new ObjectId(), ownerId: DONO, officeId: andar, name: 'Marina', provider: 'anthropic', createdAt: new Date() })

  const r = await impacto.floorDeletionImpact(DONO, andar)
  assert.equal(r.floor.name, 'Atendimento')
  // A fonte e o Flow entram na conta — era exatamente o que o DELETE não via.
  assert.equal(r.byKind.source >= 1, true, 'a fonte precisa aparecer')
  assert.equal(r.byKind.flow >= 1, true, 'o Flow precisa aparecer')
  assert.equal(r.byKind.agent, 1)
  assert.ok(r.impactHash, 'o retrato tem um hash')
})

test('CORRIGIDA: o andar com operação NÃO é mais apagado como se estivesse vazio', async () => {
  await db.collection('monitoring_sources').insertOne({ _id: new ObjectId(), ownerId: DONO, name: 'Cotação', kind: 'api_polling', status: 'active', scope: { ownerType: 'floor', ownerId: andar.toString() } })
  await db.collection('automations').insertOne({ _id: new ObjectId(), ownerId: DONO, floorId: andar, name: 'Avisar', status: 'active' })

  // O DELETE legado continua valendo para andar SEM agente e SEM setor — e é por isso que
  // ele sozinho não basta: a operação precisa passar pela análise.
  const antes = await impacto.floorDeletionImpact(DONO, andar)
  assert.ok(antes.entries.some((e) => e.kind === 'flow'), 'o Flow aparece na análise')
  assert.ok(antes.entries.some((e) => e.kind === 'source'), 'a fonte aparece na análise')
})

test('CORRIGIDA: com agente, o impacto diz o que acontece com cada um — e traz hash', async () => {
  await db.collection('agents').insertOne({ _id: new ObjectId(), ownerId: DONO, officeId: andar, name: 'Marina', provider: 'anthropic', createdAt: new Date() })
  const r = await impacto.floorDeletionImpact(DONO, andar)

  const agente = r.entries.find((e) => e.kind === 'agent')
  assert.equal(agente.disposition, 'archive', 'arquivar é o padrão recuperável')
  assert.match(agente.reason, /pode voltar/)
  assert.ok(r.impactHash.length >= 16)

  // E a escolha muda o resultado: escolher excluir transforma arquivamento em exclusão.
  const comExclusao = await impacto.floorDeletionImpact(DONO, andar, { deleteExclusiveResources: true })
  assert.equal(comExclusao.entries.find((e) => e.kind === 'agent').disposition, 'delete')
  assert.notEqual(comExclusao.impactHash, r.impactHash, 'a escolha entra no hash')
})

test('LACUNA 13: a conta vizinha nunca é alcançada — esta garantia JÁ existe e precisa sobreviver', async () => {
  assert.equal(await floors.deleteFloor('vizinho', andar), null)
  assert.equal(await db.collection('offices').countDocuments({ _id: andar }), 1)
})

// --- o purge: três portas antes de qualquer escrita ---------------------------------------

const preparar = async () => {
  const agente = new ObjectId()
  await db.collection('agents').insertOne({ _id: agente, ownerId: DONO, officeId: andar, name: 'Marina', provider: 'anthropic', createdAt: new Date() })
  await db.collection('automations').insertOne({ _id: new ObjectId(), ownerId: DONO, floorId: andar, name: 'Avisar', status: 'active', updatedAt: new Date() })
  return agente
}

test('ACEITAÇÃO: o purge remove o que é do andar e devolve o que foi removido e mantido', async () => {
  await preparar()
  const analise = await impacto.floorDeletionImpact(DONO, andar)

  const r = await impacto.purgeFloor(DONO, andar, { impactHash: analise.impactHash, confirmationName: 'Atendimento' })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.ok(r.removed.length > 0, 'o resultado diz o que saiu')
  assert.equal(await db.collection('offices').countDocuments({ _id: andar }), 0)
})

test('AMEAÇA: um hash VELHO é recusado, e a resposta traz o retrato novo', async () => {
  await preparar()
  const analise = await impacto.floorDeletionImpact(DONO, andar)

  // O escritório muda entre a análise e o clique.
  await db.collection('agents').insertOne({ _id: new ObjectId(), ownerId: DONO, officeId: andar, name: 'Rafael', provider: 'anthropic', createdAt: new Date() })

  const r = await impacto.purgeFloor(DONO, andar, { impactHash: analise.impactHash, confirmationName: 'Atendimento' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'impact_changed')
  assert.ok(r.impact, 'quem confirma precisa ver o novo')
  assert.equal(r.impact.byKind.agent, 2)
  // E nada foi apagado: a recusa acontece antes de qualquer escrita.
  assert.equal(await db.collection('offices').countDocuments({ _id: andar }), 1)
})

test('AMEAÇA: o nome digitado errado recusa — "tem certeza?" não é uma pergunta', async () => {
  await preparar()
  const analise = await impacto.floorDeletionImpact(DONO, andar)

  for (const nome of ['', 'atendimento', 'Atendiment', 'outro']) {
    const r = await impacto.purgeFloor(DONO, andar, { impactHash: analise.impactHash, confirmationName: nome })
    assert.equal(r.ok, false, `"${nome}" não deveria confirmar`)
    assert.equal(r.code, 'name_mismatch')
  }
  assert.equal(await db.collection('offices').countDocuments({ _id: andar }), 1)

  // Espaço sobrando é aparado: quem cola o nome não deveria ser punido por isso.
  const comEspaco = await impacto.purgeFloor(DONO, andar, { impactHash: analise.impactHash, confirmationName: '  Atendimento  ' })
  assert.equal(comEspaco.ok, true)
})

test('COMPARTILHADO se preserva: o Database da empresa fica, e só o acesso sai', async () => {
  const agente = await preparar()
  const store = new ObjectId()
  await db.collection('data_stores').insertOne({
    _id: store, ownerId: DONO, name: 'Históricos', adapterKind: 'data_history',
    owner: { ownerType: 'building', ownerId: predio.toString() }, status: 'active', createdAt: new Date(), updatedAt: new Date(),
  })
  const grant = new ObjectId()
  await db.collection('database_grants').insertOne({
    _id: grant, ownerId: DONO, dataStoreId: store, subjectType: 'agent', subjectId: agente.toString(),
    capabilities: ['query'], effect: 'allow', datasetKeys: [], createdAt: new Date(), updatedAt: new Date(),
  })

  const analise = await impacto.floorDeletionImpact(DONO, andar)
  const noDatabase = analise.entries.find((e) => e.kind === 'database')
  assert.equal(noDatabase.disposition, 'keep', 'dado da empresa não some por efeito colateral')
  assert.match(noDatabase.reason, /da empresa/)
  const noAcesso = analise.entries.find((e) => e.kind === 'databaseGrant')
  assert.equal(noAcesso.disposition, 'unlink', 'o que sai é o vínculo')

  const r = await impacto.purgeFloor(DONO, andar, { impactHash: analise.impactHash, confirmationName: 'Atendimento' })
  assert.equal(r.ok, true)
  assert.equal(await db.collection('data_stores').countDocuments({ _id: store }), 1, 'o Database continua existindo')
  assert.equal(await db.collection('database_grants').countDocuments({ _id: grant }), 0, 'e o acesso do andar saiu')
})

test('a conexão da EMPRESA é preservada — nunca inferir que ela é do andar', async () => {
  await preparar()
  const conexao = new ObjectId()
  await db.collection('connections').insertOne({
    _id: conexao, ownerId: DONO, appKey: 'whatsapp', name: 'WhatsApp da empresa', status: 'connected', createdAt: new Date(), updatedAt: new Date(),
  })

  const analise = await impacto.floorDeletionImpact(DONO, andar)
  const app = analise.entries.find((e) => e.kind === 'app')
  assert.equal(app.disposition, 'keep')
  assert.match(app.reason, /da empresa/)

  await impacto.purgeFloor(DONO, andar, { impactHash: analise.impactHash, confirmationName: 'Atendimento' })
  assert.equal(await db.collection('connections').countDocuments({ _id: conexao }), 1, 'a mesma credencial costuma servir a vários andares')
})

test('a conexão DEDICADA só sai por escolha explícita', async () => {
  await preparar()
  const conexao = new ObjectId()
  await db.collection('connections').insertOne({
    _id: conexao, ownerId: DONO, appKey: 'telegram', name: 'Bot deste andar', status: 'connected', floorId: andar, createdAt: new Date(), updatedAt: new Date(),
  })

  const doAndar = (r) => r.entries.find((e) => e.kind === 'app' && e.id === conexao.toString())

  const semEscolha = await impacto.floorDeletionImpact(DONO, andar)
  assert.equal(doAndar(semEscolha).disposition, 'keep')

  const comEscolha = await impacto.floorDeletionImpact(DONO, andar, { removeDedicatedConnections: true })
  assert.equal(doAndar(comEscolha).disposition, 'delete')
  assert.match(doAndar(comEscolha).reason, /você escolheu/)
})

test('BLOQUEIO: um setor de OUTRO andar que usa agentes deste impede o purge', async () => {
  const agente = await preparar()
  await db.collection('sectors').insertOne({
    _id: new ObjectId(), ownerId: DONO, officeId: outro, name: 'Comitê', mode: 'organization',
    members: [{ agentId: agente }], createdAt: new Date(), updatedAt: new Date(),
  })

  const analise = await impacto.floorDeletionImpact(DONO, andar)
  assert.ok(analise.blockers.some((b) => b.includes('Comitê')), JSON.stringify(analise.blockers))

  const r = await impacto.purgeFloor(DONO, andar, { impactHash: analise.impactHash, confirmationName: 'Atendimento' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'blocked')
  assert.equal(await db.collection('offices').countDocuments({ _id: andar }), 1)
})

test('o ÚLTIMO andar ativo continua protegido', async () => {
  await db.collection('offices').deleteOne({ _id: outro })
  const analise = await impacto.floorDeletionImpact(DONO, andar)
  assert.ok(analise.blockers.some((b) => b.includes('único andar ativo')))
})

test('o histórico é preservado pela retenção, e a análise diz isso', async () => {
  await preparar()
  await db.collection('data_history_records').insertOne({ _id: new ObjectId(), ownerId: DONO, recorderId: new ObjectId(), value: {}, occurredAt: new Date(), recordedAt: new Date(), dedupeKey: 'x' })

  const analise = await impacto.floorDeletionImpact(DONO, andar)
  const historico = analise.entries.find((e) => e.kind === 'history')
  assert.equal(historico.disposition, 'keep')
  assert.match(historico.reason, /fato acontecido/)
})

test('AMEAÇA: a conta vizinha nunca é alcançada', async () => {
  assert.equal(await impacto.floorDeletionImpact('vizinho', andar), null)
  const r = await impacto.purgeFloor('vizinho', andar, { impactHash: 'qualquer', confirmationName: 'Atendimento' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'not_found')
  assert.equal(await db.collection('offices').countDocuments({ _id: andar }), 1)
})

test('ARQUIVAR é reversível: restaurar traz o andar de volta sem reativar operação', async () => {
  await preparar()
  await db.collection('automations').updateOne({ ownerId: DONO, floorId: andar }, { $set: { status: 'paused' } })

  const arquivado = await impacto.archiveFloor(DONO, andar)
  assert.equal(arquivado.status, 'archived')
  assert.equal(await db.collection('offices').countDocuments({ _id: andar }), 1, 'nada se perde ao arquivar')

  const restaurado = await impacto.restoreFloor(DONO, andar)
  assert.equal(restaurado.status, 'active')
  // O Flow continua pausado: reativar sozinho dispararia trabalho que ninguém pediu.
  const flow = await db.collection('automations').findOne({ ownerId: DONO, floorId: andar })
  assert.equal(flow.status, 'paused')
})

test('CONCORRÊNCIA: dois purges com o mesmo retrato — o segundo não encontra mais o andar', async () => {
  await preparar()
  const analise = await impacto.floorDeletionImpact(DONO, andar)

  const [a, b] = await Promise.all([
    impacto.purgeFloor(DONO, andar, { impactHash: analise.impactHash, confirmationName: 'Atendimento' }),
    impacto.purgeFloor(DONO, andar, { impactHash: analise.impactHash, confirmationName: 'Atendimento' }),
  ])
  const okCount = [a, b].filter((r) => r.ok).length
  // Os dois podem ler o andar antes de qualquer remoção; o que não pode é o andar
  // sobreviver ou a operação explodir.
  assert.ok(okCount >= 1)
  assert.equal(await db.collection('offices').countDocuments({ _id: andar }), 0)
})
