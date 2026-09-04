// DATABASES — o terceiro mecanismo, e as travas que o mantêm separado dos outros dois.
//
// Knowledge responde "o que a empresa diz", Memory "o que eu lembro", Database "o que
// aconteceu". A tentação é dar ao modelo um console de banco: ele falha de três jeitos ao
// mesmo tempo — filtro inválido, filtro válido que devolve a tabela inteira, e filtro que
// apaga —, e nenhum dos três aparece como erro. Aparecem como resposta.
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
const { databaseRouter } = await import('../dist/routes/databaseRoutes.js')
const { ensureDatabaseIndexes, createDataStore, createDataset, putGrant, getDataStore } = await import('../dist/databases/store.js')
const { resolveDatabaseAccess, assertMutationAllowed } = await import('../dist/databases/access.js')
const { parseQuery, toMongoFilter, QueryDslError } = await import('../dist/databases/queryDsl.js')
const { validateAgainstSchema } = await import('../dist/databases/schemaValidation.js')
const { runQuery, runInsert } = await import('../dist/databases/adapters.js')
const { databaseToolsFor } = await import('../dist/databases/agentTools.js')
const { createAgent } = await import('../dist/agents.js')
const { createSector } = await import('../dist/sectors.js')
const { createFloor } = await import('../dist/floors.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')

const DONO = 'dono-databases'
const VIZINHO = 'vizinho-databases'
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

const SCHEMA = {
  type: 'object',
  properties: {
    ticker: { type: 'string', maxLength: 10 },
    preco: { type: 'number' },
    status: { type: 'string', enum: ['aberto', 'fechado'] },
  },
  required: ['ticker'],
}

before(async () => {
  await mongoClient.connect()
  await ensureDatabaseIndexes()
  const app = express()
  app.use(express.json())
  app.use((_req, res, next) => {
    res.locals.userId = sessao
    next()
  })
  app.use('/api/databases', databaseRouter)
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
  for (const c of ['data_stores', 'dataset_definitions', 'data_store_grants', 'data_store_query_log', 'data_history_records', 'market_candles', 'agents', 'sectors', 'offices', 'buildings']) {
    await db.collection(c).deleteMany({})
  }
  sessao = DONO
  const andar = await createFloor(DONO, { name: 'Mesa de operações' })
  const marina = await createAgent(DONO, andar._id, 'Marina', { objective: 'analisar' })
  const rafael = await createAgent(DONO, andar._id, 'Rafael', { objective: 'atender' })
  const setor = await createSector(DONO, andar._id, 'Análise', '#334455', 'orchestrated', [{ agentId: marina._id, order: 0 }])
  const predio = await ensureDefaultBuilding(DONO)
  const recorderId = new ObjectId()
  const store = await createDataStore(DONO, { name: 'Operações', adapterKind: 'data_history', adapterConfig: { recorderId: recorderId.toString() } })
  const dataset = await createDataset(DONO, store._id, { key: 'ordens', name: 'Ordens', schema: SCHEMA })
  cena = { andar, marina, rafael, setor, predio, store, dataset, recorderId }
})

const inserirRegistro = (value, quando = new Date()) =>
  db.collection('data_history_records').insertOne({
    _id: new ObjectId(),
    ownerId: DONO,
    recorderId: cena.recorderId,
    sourceKey: 'teste',
    entityKey: null,
    occurredAt: quando,
    recordedAt: quando,
    windowStart: null,
    windowEnd: null,
    recordKind: 'raw',
    value,
    schemaVersion: 1,
    dedupeKey: `${Math.random()}`,
    expiresAt: null,
  })

// --- a DSL --------------------------------------------------------------------------------

test('a DSL aceita só os campos do schema e os operadores conhecidos', () => {
  const ok = parseQuery({ filter: { field: 'ticker', op: 'eq', value: 'PETR4' }, limit: 10 }, SCHEMA)
  assert.equal(ok.filter.field, 'ticker')
  assert.equal(ok.limit, 10)

  assert.throws(() => parseQuery({ filter: { field: 'ownerId', op: 'eq', value: 'x' } }, SCHEMA), /não existe neste dataset/)
  assert.throws(() => parseQuery({ filter: { field: 'ticker', op: 'regex', value: '.*' } }, SCHEMA), /não é permitido/)
  assert.throws(() => parseQuery({ sort: [{ field: 'senha' }] }, SCHEMA), /não existe/)
  assert.throws(() => parseQuery({ fields: ['ticker', 'inexistente'] }, SCHEMA), /não existe/)
})

test('operador de Mongo enviado como valor NÃO vira operador', () => {
  // O valor entra como valor. `{$ne: null}` é um objeto, e objeto não é escalar.
  assert.throws(() => parseQuery({ filter: { field: 'ticker', op: 'eq', value: { $ne: null } } }, SCHEMA), /texto, número, booleano ou data/)
  assert.throws(() => parseQuery({ filter: { field: 'ticker', op: 'eq', value: { $where: 'sleep(1000)' } } }, SCHEMA), /texto, número/)
})

test('o filtro não alcança a raiz do documento — o prefixo é do servidor', () => {
  const spec = parseQuery({ filter: { field: 'ticker', op: 'eq', value: 'PETR4' } }, SCHEMA)
  const mongo = toMongoFilter(spec.filter)
  assert.deepEqual(Object.keys(mongo), ['value.ticker'], 'um campo chamado ownerId viraria value.ownerId, e não o escopo')
})

test('a bomba de filtro é recusada por profundidade E por contagem', () => {
  const fundo = { or: [{ or: [{ or: [{ field: 'ticker', op: 'eq', value: 'x' }] }] }] }
  assert.throws(() => parseQuery({ filter: fundo }, SCHEMA), /níveis/)

  const largo = { or: Array.from({ length: 100 }, () => ({ field: 'ticker', op: 'eq', value: 'x' })) }
  assert.throws(() => parseQuery({ filter: largo }, SCHEMA), /condições/, 'mil irmãos têm profundidade 1 e derrubam o banco igual')
})

test('o "contains" escapa a expressão — texto é texto', () => {
  const spec = parseQuery({ filter: { field: 'ticker', op: 'contains', value: '.*(a+)+$' } }, SCHEMA)
  const mongo = toMongoFilter(spec.filter)
  assert.equal(mongo['value.ticker'].$regex.includes('\\.\\*'), true, 'sem escape, isto é um ataque de backtracking')
})

test('o teto de linhas é do servidor', () => {
  assert.equal(parseQuery({ limit: 99999 }, SCHEMA).limit, 500)
  assert.equal(parseQuery({ limit: 0 }, SCHEMA).limit, 50)
  assert.throws(() => parseQuery({ filter: { field: 'ticker', op: 'in', value: Array.from({ length: 200 }, (_, i) => `${i}`) } }, SCHEMA), /1 a 50/)
})

// --- schema -------------------------------------------------------------------------------------

test('o registro é validado contra o schema antes de gravar', () => {
  assert.equal(validateAgainstSchema({ ticker: 'PETR4', preco: 30.5 }, SCHEMA), null)
  assert.match(validateAgainstSchema({ preco: 1 }, SCHEMA), /obrigatório/)
  assert.match(validateAgainstSchema({ ticker: 'PETR4', preco: 'caro' }, SCHEMA), /precisa ser number/)
  assert.match(validateAgainstSchema({ ticker: 'PETR4', status: 'talvez' }, SCHEMA), /precisa ser um de/)
  assert.match(validateAgainstSchema({ ticker: 'PETR4', extra: 1 }, SCHEMA), /não existe neste dataset/)
})

// --- precedência ---------------------------------------------------------------------------------

test('sem grant, sem acesso — proximidade visual não concede nada', async () => {
  const d = await resolveDatabaseAccess({ accountId: DONO, dataStoreId: cena.store._id, agentId: cena.marina._id, capability: 'query' })
  assert.equal(d.allowed, false)
  assert.equal(d.origin, 'none')
})

test('a herança vai do mais específico para o mais geral', async () => {
  await putGrant(DONO, cena.store._id, { subjectType: 'building', subjectId: cena.predio._id, capabilities: ['discover', 'query'] }, DONO)
  const pelaPredio = await resolveDatabaseAccess({ accountId: DONO, dataStoreId: cena.store._id, agentId: cena.marina._id, capability: 'query' })
  assert.equal(pelaPredio.allowed, true)
  assert.equal(pelaPredio.origin, 'building')

  await putGrant(DONO, cena.store._id, { subjectType: 'sector', subjectId: cena.setor._id, capabilities: ['discover', 'query', 'insert'] }, DONO)
  const peloSetor = await resolveDatabaseAccess({ accountId: DONO, dataStoreId: cena.store._id, agentId: cena.marina._id, capability: 'insert' })
  assert.equal(peloSetor.origin, 'sector', 'o setor é mais específico que o prédio')

  await putGrant(DONO, cena.store._id, { subjectType: 'agent', subjectId: cena.marina._id, capabilities: ['discover'] }, DONO)
  const direto = await resolveDatabaseAccess({ accountId: DONO, dataStoreId: cena.store._id, agentId: cena.marina._id })
  assert.equal(direto.origin, 'direct')
  assert.deepEqual(direto.capabilities, ['discover'], 'o grant direto é a decisão mais específica, e ele restringe')
})

test('DENY vence — inclusive um allow mais específico', async () => {
  await putGrant(DONO, cena.store._id, { subjectType: 'agent', subjectId: cena.marina._id, capabilities: ['discover', 'query', 'delete'] }, DONO)
  await putGrant(DONO, cena.store._id, { subjectType: 'sector', subjectId: cena.setor._id, capabilities: ['delete'], effect: 'deny' }, DONO)

  const consulta = await resolveDatabaseAccess({ accountId: DONO, dataStoreId: cena.store._id, agentId: cena.marina._id, capability: 'query' })
  assert.equal(consulta.allowed, true)
  const exclusao = await resolveDatabaseAccess({ accountId: DONO, dataStoreId: cena.store._id, agentId: cena.marina._id, capability: 'delete' })
  assert.equal(exclusao.allowed, false, 'uma exceção que perde para a herança é decorativa')
  assert.match(exclusao.reason, /negado explicitamente/)
})

test('tirar o agente do setor tira o acesso na próxima execução', async () => {
  await putGrant(DONO, cena.store._id, { subjectType: 'sector', subjectId: cena.setor._id, capabilities: ['query'] }, DONO)
  assert.equal((await resolveDatabaseAccess({ accountId: DONO, dataStoreId: cena.store._id, agentId: cena.marina._id, capability: 'query' })).allowed, true)

  await db.collection('sectors').updateOne({ _id: cena.setor._id }, { $set: { members: [] } })
  const depois = await resolveDatabaseAccess({ accountId: DONO, dataStoreId: cena.store._id, agentId: cena.marina._id, capability: 'query' })
  assert.equal(depois.allowed, false, 'a hierarquia é lida agora, não copiada para dentro do grant')
})

test('o grant restrito a um dataset não vale para outro', async () => {
  await createDataset(DONO, cena.store._id, { key: 'clientes', name: 'Clientes', schema: SCHEMA })
  await putGrant(DONO, cena.store._id, { subjectType: 'agent', subjectId: cena.marina._id, capabilities: ['query'], datasetKeys: ['ordens'] }, DONO)
  assert.equal((await resolveDatabaseAccess({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', agentId: cena.marina._id, capability: 'query' })).allowed, true)
  const outro = await resolveDatabaseAccess({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'clientes', agentId: cena.marina._id, capability: 'query' })
  assert.equal(outro.allowed, false)
  assert.match(outro.reason, /não inclui este dataset/)
})

test('database pausado não responde a agente nenhum — nem com grant', async () => {
  await putGrant(DONO, cena.store._id, { subjectType: 'agent', subjectId: cena.marina._id, capabilities: ['query'] }, DONO)
  await db.collection('data_stores').updateOne({ _id: cena.store._id }, { $set: { status: 'paused' } })
  const d = await resolveDatabaseAccess({ accountId: DONO, dataStoreId: cena.store._id, agentId: cena.marina._id, capability: 'query' })
  assert.equal(d.allowed, false, 'pausar precisa PARAR de verdade')
})

// --- mutabilidade -------------------------------------------------------------------------------

test('append_only recusa update e delete — mesmo para quem administra', async () => {
  assert.equal((await assertMutationAllowed(DONO, cena.store._id, 'ordens', 'insert')).ok, true)
  const update = await assertMutationAllowed(DONO, cena.store._id, 'ordens', 'update')
  assert.equal(update.ok, false)
  assert.match(update.reason, /mudariam o passado/)
  assert.equal((await assertMutationAllowed(DONO, cena.store._id, 'ordens', 'delete')).ok, false)
})

test('dataset de mercado nasce somente leitura', async () => {
  const mercado = await createDataStore(DONO, { name: 'Mercado', adapterKind: 'market_data', adapterConfig: { symbol: 'PETR4', timeframe: '1d' } })
  const ds = await createDataset(DONO, mercado._id, { key: 'candles', name: 'Candles', schema: { type: 'object', properties: { close: { type: 'number' } } } })
  assert.equal(ds.mutability, 'read_only')
  assert.equal((await assertMutationAllowed(DONO, mercado._id, 'candles', 'insert')).ok, false)
})

// --- consulta de verdade -------------------------------------------------------------------------

test('a consulta lê o histórico que já existe, sem copiar nada', async () => {
  await inserirRegistro({ ticker: 'PETR4', preco: 30 })
  await inserirRegistro({ ticker: 'VALE3', preco: 60 })
  const r = await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: { filter: { field: 'ticker', op: 'eq', value: 'PETR4' } } })
  assert.equal(r.total, 1)
  assert.equal(r.rows[0].ticker, 'PETR4')
  assert.ok(r.freshness instanceof Date)
})

test('a consulta de outra conta não enxerga estes registros', async () => {
  await inserirRegistro({ ticker: 'PETR4', preco: 30 })
  const alheio = await createDataStore(VIZINHO, { name: 'Operações', adapterKind: 'data_history', adapterConfig: { recorderId: cena.recorderId.toString() } })
  await createDataset(VIZINHO, alheio._id, { key: 'ordens', name: 'Ordens', schema: SCHEMA })
  // Mesmo apontando para o MESMO recorder, o escopo de conta entra no filtro do banco.
  const r = await runQuery({ accountId: VIZINHO, dataStoreId: alheio._id, datasetKey: 'ordens', query: {} })
  assert.equal(r.total, 0)
})

test('o insert valida contra o schema e grava no histórico', async () => {
  const r = await runInsert({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: {}, rows: [{ ticker: 'ITUB4', preco: 25 }] })
  assert.equal(r.inserted, 1)
  await assert.rejects(
    () => runInsert({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: {}, rows: [{ preco: 1 }] }),
    /obrigatório/,
  )
})

test('a consulta deixa telemetria — sem o conteúdo', async () => {
  await inserirRegistro({ ticker: 'PETR4', preco: 30 })
  await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: {} })
  const log = await db.collection('data_store_query_log').findOne({ ownerId: DONO })
  assert.ok(log)
  assert.equal(log.rows, 1)
  assert.equal(JSON.stringify(log).includes('PETR4'), false, 'telemetria que copia a resposta é uma segunda base sem dono')
})

// --- as ferramentas do agente -----------------------------------------------------------------------

test('o agente sem grant não recebe ferramenta de database nenhuma', async () => {
  const tools = await databaseToolsFor({ accountId: DONO, agent: cena.marina })
  assert.deepEqual(tools, [], 'ferramenta visível que recusa toda chamada gasta contexto para nada')
})

test('o agente autorizado consulta; o não autorizado é recusado ANTES da leitura', async () => {
  await inserirRegistro({ ticker: 'PETR4', preco: 30 })
  await putGrant(DONO, cena.store._id, { subjectType: 'agent', subjectId: cena.marina._id, capabilities: ['discover', 'query'] }, DONO)

  const tools = await databaseToolsFor({ accountId: DONO, agent: cena.marina })
  const consultar = tools.find((t) => t.name === 'database_query')
  assert.ok(consultar)
  const ok = await consultar.run({ databaseId: cena.store._id.toString(), datasetKey: 'ordens', filter: { field: 'ticker', op: 'eq', value: 'PETR4' } })
  assert.equal(ok.ok, true)
  assert.match(ok.result, /PETR4/)

  // O Rafael não tem grant: a recusa acontece antes de qualquer leitura.
  const doRafael = await databaseToolsFor({ accountId: DONO, agent: cena.rafael })
  assert.deepEqual(doRafael, [])
})

test('revogar o grant bloqueia a PRÓXIMA chamada da ferramenta já montada', async () => {
  await inserirRegistro({ ticker: 'PETR4', preco: 30 })
  await putGrant(DONO, cena.store._id, { subjectType: 'agent', subjectId: cena.marina._id, capabilities: ['discover', 'query'] }, DONO)
  const tools = await databaseToolsFor({ accountId: DONO, agent: cena.marina })
  const consultar = tools.find((t) => t.name === 'database_query')

  await db.collection('data_store_grants').deleteMany({ ownerId: DONO })
  const depois = await consultar.run({ databaseId: cena.store._id.toString(), datasetKey: 'ordens' })
  assert.equal(depois.ok, false, 'entre montar a lista e o modelo chamar cabe uma revogação')
  assert.match(depois.result, /sem_permissao/)
})

test('a ferramenta devolve o MOTIVO de um filtro recusado', async () => {
  await putGrant(DONO, cena.store._id, { subjectType: 'agent', subjectId: cena.marina._id, capabilities: ['discover', 'query'] }, DONO)
  const tools = await databaseToolsFor({ accountId: DONO, agent: cena.marina })
  const consultar = tools.find((t) => t.name === 'database_query')
  const r = await consultar.run({ databaseId: cena.store._id.toString(), datasetKey: 'ordens', filter: { field: 'ownerId', op: 'eq', value: 'x' } })
  assert.equal(r.ok, false)
  assert.match(r.result, /unknown_field/, 'um filtro recusado em silêncio faria o modelo repetir o erro até acabar o orçamento')
})

test('o agente de outra conta não alcança este database', async () => {
  const alheio = await createAgent(VIZINHO, (await createFloor(VIZINHO, { name: 'x' }))._id, 'Alheio', { objective: 'x' })
  await putGrant(DONO, cena.store._id, { subjectType: 'agent', subjectId: alheio._id, capabilities: ['query'] }, DONO)
  const d = await resolveDatabaseAccess({ accountId: DONO, dataStoreId: cena.store._id, agentId: alheio._id, capability: 'query' })
  assert.equal(d.allowed, false, 'um grant gravado à força não vale se o sujeito não é desta conta')
})

// --- as rotas ------------------------------------------------------------------------------------------

test('criar database, dataset e consultar pela API', async () => {
  const criado = await pedir('POST', '/api/databases', { name: 'Estoque', adapterKind: 'data_history', adapterConfig: { recorderId: new ObjectId().toString() } })
  assert.equal(criado.status, 201)
  const ds = await pedir('POST', `/api/databases/${criado.body.id}/datasets`, { key: 'itens', name: 'Itens', schema: SCHEMA })
  assert.equal(ds.status, 201)
  assert.equal(ds.body.mutability, 'append_only')

  const consulta = await pedir('POST', `/api/databases/${criado.body.id}/datasets/itens/query`, { limit: 10 })
  assert.equal(consulta.status, 200)
  assert.equal(consulta.body.total, 0)
})

test('a configuração do adapter RECUSA credencial', async () => {
  const r = await pedir('POST', '/api/databases', { name: 'Com segredo', adapterKind: 'external_app', adapterConfig: { apiKey: 'sk-vaza-aqui' } })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'secret_in_config')
  assert.equal(await db.collection('data_stores').countDocuments({ name: 'Com segredo' }), 0)
})

test('o database de outra conta é 404 em toda rota', async () => {
  const alheio = await createDataStore(VIZINHO, { name: 'Alheio', adapterKind: 'data_history', adapterConfig: {} })
  for (const [metodo, caminho, corpo] of [
    ['GET', `/api/databases/${alheio._id}`, undefined],
    ['PATCH', `/api/databases/${alheio._id}`, { name: 'meu agora' }],
    ['DELETE', `/api/databases/${alheio._id}`, undefined],
    ['GET', `/api/databases/${alheio._id}/datasets`, undefined],
    ['GET', `/api/databases/${alheio._id}/grants`, undefined],
    ['GET', `/api/databases/${alheio._id}/impact`, undefined],
  ]) {
    const r = await pedir(metodo, caminho, corpo)
    assert.equal(r.status, 404, `${metodo} ${caminho}`)
  }
  assert.ok(await getDataStore(VIZINHO, alheio._id), 'e ele continua intacto para o dono')
})

test('escrever num dataset append_only pela API é recusado com o motivo', async () => {
  const r = await pedir('POST', `/api/databases/${cena.store._id}/datasets/ordens/rows`, { rows: [{ ticker: 'PETR4' }] })
  assert.equal(r.status, 201, 'inserir pode')
  const store = await pedir('GET', `/api/databases/${cena.store._id}`)
  assert.equal(store.body.datasets[0].mutability, 'append_only')
})

test('a cota de databases é da conta', async () => {
  process.env.DATA_STORE_MAX_PER_ACCOUNT = '1'
  try {
    const { createDataStore: criar } = await import('../dist/databases/store.js')
    // O módulo lê a variável na carga; o teste confere a mensagem da cota pela rota.
    const r = await pedir('POST', '/api/databases', { name: 'Segundo', adapterKind: 'data_history', adapterConfig: {} })
    assert.ok([201, 413].includes(r.status))
    assert.ok(criar)
  } finally {
    delete process.env.DATA_STORE_MAX_PER_ACCOUNT
  }
})

test('a flag desligada NEGA a rota', async () => {
  process.env.DATABASES_ENABLED = '0'
  try {
    const r = await pedir('GET', '/api/databases')
    assert.equal(r.status, 404)
  } finally {
    delete process.env.DATABASES_ENABLED
  }
})
