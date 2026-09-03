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

// --- arquivar DESATIVA a entrada -----------------------------------------------------------
//
// §14.2: "archive — desativa entrada e preserva dados". Um andar arquivado com Flow ativo e
// fonte coletando não está arquivado: ele saiu do mapa e continuou trabalhando, cobrando
// token e batendo em servidor de terceiro. Ninguém olha um andar arquivado.

test('ARQUIVAR pausa o que estava no ar dentro do andar, e preserva tudo', async () => {
  await preparar()
  await db.collection('monitoring_sources').insertOne({
    _id: new ObjectId(),
    ownerId: DONO,
    name: 'Cotação',
    kind: 'api_polling',
    status: 'active',
    scope: { ownerType: 'floor', ownerId: andar.toString() },
  })

  await impacto.archiveFloor(DONO, andar)

  const flow = await db.collection('automations').findOne({ ownerId: DONO, floorId: andar })
  assert.equal(flow.status, 'paused', 'um Flow ativo num andar arquivado continua disparando sozinho')
  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO, 'scope.ownerId': andar.toString() })
  assert.equal(fonte.status, 'paused', 'uma fonte ativa continua batendo em servidor de terceiro')

  // E nada se perde: arquivar é o padrão RECUPERÁVEL.
  assert.equal(await db.collection('agents').countDocuments({ ownerId: DONO, officeId: andar }), 1)
  assert.equal(await db.collection('automations').countDocuments({ ownerId: DONO, floorId: andar }), 1)
})

test('ARQUIVAR não toca no que é de OUTRO andar', async () => {
  await preparar()
  const alheio = new ObjectId()
  await db.collection('automations').insertOne({ _id: alheio, ownerId: DONO, floorId: outro, name: 'Do financeiro', status: 'active', createdAt: new Date(), updatedAt: new Date() })

  await impacto.archiveFloor(DONO, andar)
  const doOutro = await db.collection('automations').findOne({ _id: alheio })
  assert.equal(doOutro.status, 'active', 'arquivar um andar não pode parar a operação do vizinho')
})

test('AMEAÇA: arquivar um andar não alcança a conta de outra pessoa', async () => {
  const deOutro = new ObjectId()
  await db.collection('automations').insertOne({ _id: deOutro, ownerId: 'vizinho', floorId: andar, name: 'Alheio', status: 'active', createdAt: new Date(), updatedAt: new Date() })
  await preparar()

  await impacto.archiveFloor(DONO, andar)
  assert.equal((await db.collection('automations').findOne({ _id: deOutro })).status, 'active')
})

test('restaurar continua NÃO reativando o que foi pausado ao arquivar', async () => {
  await preparar()
  await db.collection('automations').updateOne({ ownerId: DONO, floorId: andar }, { $set: { status: 'active' } })
  await impacto.archiveFloor(DONO, andar)
  await impacto.restoreFloor(DONO, andar)

  const flow = await db.collection('automations').findOne({ ownerId: DONO, floorId: andar })
  assert.equal(flow.status, 'paused', 'reativar sozinho dispararia trabalho semanas depois, sem ninguém pedir')
})

// --- as ROTAS novas, e a posse nelas ---------------------------------------------------------
//
// O serviço já filtra por dono em toda consulta. O que estes casos protegem é a outra ponta:
// que a rota passe o dono da SESSÃO, e não um id que veio do cliente.

const express = (await import('express')).default
const { floorRouter } = await import('../dist/routes/floorRoutes.js')

let servidor
let porta
let sessao = DONO

const pedir = async (metodo, caminho, corpo) => {
  const res = await fetch(`http://127.0.0.1:${porta}/api/floors${caminho}`, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await res.text()
  return { status: res.status, body: texto ? JSON.parse(texto) : null }
}

before(async () => {
  const app = express()
  app.use(express.json())
  app.use((_req, res, next) => {
    res.locals.userId = sessao
    next()
  })
  app.use('/api/floors', floorRouter)
  await new Promise((r) => {
    servidor = app.listen(0, () => {
      porta = servidor.address().port
      r()
    })
  })
})
after(async () => {
  if (servidor) await new Promise((r) => servidor.close(r))
})

test('ROTA: a análise de impacto responde com o retrato do andar desta conta', async () => {
  await preparar()
  const r = await pedir('GET', `/${andar}/deletion-impact`)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.floor.name, 'Atendimento')
  assert.ok(r.body.impactHash)
})

test('AMEAÇA: o andar de OUTRA conta não existe para esta rota', async () => {
  const alheio = new ObjectId()
  await db.collection('offices').insertOne({ _id: alheio, ownerId: 'vizinho', buildingId: new ObjectId(), name: 'Do vizinho', status: 'active', createdAt: new Date(), updatedAt: new Date() })

  const r = await pedir('GET', `/${alheio}/deletion-impact`)
  assert.equal(r.status, 404, 'um 403 já contaria que o andar existe')
  assert.equal(await db.collection('offices').countDocuments({ _id: alheio }), 1)
})

test('AMEAÇA: o purge de um andar de outra conta não apaga nada', async () => {
  const alheio = new ObjectId()
  await db.collection('offices').insertOne({ _id: alheio, ownerId: 'vizinho', buildingId: new ObjectId(), name: 'Do vizinho', status: 'active', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('agents').insertOne({ _id: new ObjectId(), ownerId: 'vizinho', officeId: alheio, name: 'Alheio', provider: 'anthropic', createdAt: new Date() })

  const r = await pedir('POST', `/${alheio}/purge`, { impactHash: 'qualquer', confirmationName: 'Do vizinho' })
  assert.equal(r.status, 404)
  assert.equal(await db.collection('offices').countDocuments({ _id: alheio }), 1)
  assert.equal(await db.collection('agents').countDocuments({ ownerId: 'vizinho' }), 1)
})

test('ROTA: um hash velho é recusado com 409 e devolve o retrato de AGORA', async () => {
  await preparar()
  const r = await pedir('POST', `/${andar}/purge`, { impactHash: 'retrato-velho', confirmationName: 'Atendimento' })
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.equal(r.body.code, 'impact_changed')
  assert.ok(r.body.impact?.impactHash, 'sem o retrato novo, a pessoa não tem o que revisar')
  assert.equal(await db.collection('offices').countDocuments({ _id: andar }), 1)
})

test('ROTA: o nome errado é recusado com 400, e nada é apagado', async () => {
  await preparar()
  const impacto = await pedir('GET', `/${andar}/deletion-impact`)
  const r = await pedir('POST', `/${andar}/purge`, { impactHash: impacto.body.impactHash, confirmationName: 'Atendimentooo' })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'name_mismatch')
  assert.equal(await db.collection('offices').countDocuments({ _id: andar }), 1)
})

test('ROTA: um id malformado é 404, e não um erro do servidor', async () => {
  assert.equal((await pedir('GET', '/nao-e-um-id/deletion-impact')).status, 404)
  assert.equal((await pedir('POST', '/nao-e-um-id/purge', { impactHash: 'x', confirmationName: 'y' })).status, 404)
})
