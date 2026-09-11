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
const { runQuery, runInsert, runUpdate, runDelete } = await import('../dist/databases/adapters.js')
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
  for (const c of ['data_stores', 'dataset_definitions', 'data_store_grants', 'data_store_query_log', 'data_history_records', 'market_candles', 'agents', 'sectors', 'offices', 'buildings', 'data_recorders', 'execution_roots']) {
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

test('paginar percorre TODOS os registros: nenhum repete, nenhum some', async () => {
  /**
   * A tela de Databases só oferece "ver todos" porque `skip` funciona aqui. Se ele fosse
   * ignorado, a segunda página devolveria a primeira de novo — e a tela mostraria a mesma
   * coisa com outro rótulo, que é pior do que não paginar.
   */
  for (let i = 0; i < 5; i++) await inserirRegistro({ ticker: `T${i}`, preco: i }, new Date(1000 + i))

  const pagina = async (skip) =>
    runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: { limit: 2, skip } })

  const p1 = await pagina(0)
  const p2 = await pagina(2)
  const p3 = await pagina(4)

  assert.deepEqual([p1.rows.length, p2.rows.length, p3.rows.length], [2, 2, 1])
  assert.deepEqual(
    [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.ticker),
    // A ordem padrão é do mais novo para o mais velho.
    ['T4', 'T3', 'T2', 'T1', 'T0'],
  )
  // `total` é quantos EXISTEM — não muda de página para página.
  assert.deepEqual([p1.total, p2.total, p3.total], [5, 5, 5])
  // E a última página diz que acabou.
  assert.equal(p3.truncated, false)
  assert.equal(p1.truncated, true)
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

// --- gravar: a metade que faltava -------------------------------------------------------
//
// O agente sabia LER um Database e não sabia ESCREVER. Numa conversa real, o dono pediu
// "todo fim de dia pegue o maior valor do bitcoin e grave numa base só com data e máximo",
// e o Assistente respondeu que não dava — porque de fato não havia por onde gravar. A
// operação inteira parava na metade: ele lia a série e não tinha onde pôr o resultado.
//
// A escrita é mais perigosa que a leitura, então ela carrega as mesmas três travas da
// leitura e mais uma: a capacidade é `insert`, e não `query`.

test('sem a capacidade insert, o agente NÃO recebe a ferramenta de gravar', async () => {
  await putGrant(DONO, cena.store._id, { subjectType: 'agent', subjectId: cena.marina._id, capabilities: ['discover', 'query'] }, DONO)
  const tools = await databaseToolsFor({ accountId: DONO, agent: cena.marina })
  assert.ok(tools.find((t) => t.name === 'database_query'), 'a leitura continua')
  assert.equal(tools.find((t) => t.name === 'database_insert_rows'), undefined, 'quem só pode ler não pode ver a ferramenta de gravar')
})

test('ACEITAÇÃO: com insert, o agente grava — e o registro entra de verdade', async () => {
  await putGrant(DONO, cena.store._id, { subjectType: 'agent', subjectId: cena.marina._id, capabilities: ['discover', 'query', 'insert'] }, DONO)
  const tools = await databaseToolsFor({ accountId: DONO, agent: cena.marina })
  const gravar = tools.find((t) => t.name === 'database_insert_rows')
  assert.ok(gravar, `ferramentas: ${tools.map((t) => t.name).join(', ')}`)

  const r = await gravar.run({ databaseId: cena.store._id.toString(), datasetKey: 'ordens', rows: [{ ticker: 'BTC', preco: 71234.5 }] })
  assert.equal(r.ok, true, r.result)
  assert.match(r.result, /"inserted":1/)

  const lido = await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: { filter: { field: 'ticker', op: 'eq', value: 'BTC' } } })
  assert.equal(lido.rows.length, 1)
  assert.equal(lido.rows[0].preco, 71234.5)
})

test('AMEAÇA: revogar o insert bloqueia a PRÓXIMA gravação da ferramenta já montada', async () => {
  /**
   * Entre montar a lista e o modelo decidir chamar cabe uma revogação — e é justamente
   * nesse intervalo que uma permissão retirada precisa valer. Vale para gravar ainda mais
   * que para ler: uma leitura a mais é um vazamento, uma escrita a mais é um dado falso.
   */
  await putGrant(DONO, cena.store._id, { subjectType: 'agent', subjectId: cena.marina._id, capabilities: ['discover', 'query', 'insert'] }, DONO)
  const gravar = (await databaseToolsFor({ accountId: DONO, agent: cena.marina })).find((t) => t.name === 'database_insert_rows')
  await putGrant(DONO, cena.store._id, { subjectType: 'agent', subjectId: cena.marina._id, capabilities: ['discover', 'query'] }, DONO)

  const r = await gravar.run({ databaseId: cena.store._id.toString(), datasetKey: 'ordens', rows: [{ ticker: 'XPTO', preco: 1 }] })
  assert.equal(r.ok, false)
  assert.match(r.result, /sem_permissao/)
  const lido = await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: { filter: { field: 'ticker', op: 'eq', value: 'XPTO' } } })
  assert.equal(lido.rows.length, 0, 'gravou apesar da recusa')
})

test('AMEAÇA: uma linha fora do schema é recusada COM o motivo', async () => {
  // Recusar em silêncio faria o modelo repetir a mesma linha errada até acabar o orçamento.
  await putGrant(DONO, cena.store._id, { subjectType: 'agent', subjectId: cena.marina._id, capabilities: ['discover', 'query', 'insert'] }, DONO)
  const gravar = (await databaseToolsFor({ accountId: DONO, agent: cena.marina })).find((t) => t.name === 'database_insert_rows')
  const r = await gravar.run({ databaseId: cena.store._id.toString(), datasetKey: 'ordens', rows: [{ preco: 1 }] })
  assert.equal(r.ok, false)
  assert.match(r.result, /obrigat/i)
})

// --- controle até o VALOR ----------------------------------------------------------------
//
// DO RELATO: "quero conseguir editar, deletar e mais também nos arquivos dentro da pasta e
// nos valores todos também."
//
// O Database tinha criar, consultar e inserir. Editar e apagar UMA LINHA não existiam em
// lugar nenhum — nem rota, nem adapter. Quem gravou um valor errado convivia com ele.
//
// A trava de mutabilidade continua valendo por baixo, e é ela que dá sentido ao resto: uma
// série `append_only` recusa alterar e apagar, porque mudar o passado de uma série é o
// mesmo que perder o passado. Quem quiser mudar isso muda a REGRA do conjunto, e aí sim
// mexe nas linhas — a decisão fica declarada, e não escondida numa exceção.

test('ACEITAÇÃO: numa base mutável, dá para corrigir uma linha errada', async () => {
  await db.collection('dataset_definitions').updateOne({ ownerId: DONO, key: 'ordens' }, { $set: { mutability: 'mutable' } })
  await inserirRegistro({ ticker: 'PETR4', preco: 30 })
  const antes = await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: {} })
  const id = String(antes.rows[0].rowId)

  const r = await runUpdate({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', rowId: id, row: { ticker: 'PETR4', preco: 31.5 } })
  assert.equal(r.updated, 1)

  const depois = await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: {} })
  assert.equal(depois.rows.length, 1, 'a correção duplicou a linha')
  assert.equal(depois.rows[0].preco, 31.5)
})

test('ACEITAÇÃO: e dá para apagar uma linha', async () => {
  await db.collection('dataset_definitions').updateOne({ ownerId: DONO, key: 'ordens' }, { $set: { mutability: 'mutable' } })
  await inserirRegistro({ ticker: 'VALE3', preco: 60 })
  const antes = await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: {} })
  const id = String(antes.rows[0].rowId)

  assert.equal((await runDelete({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', rowId: id })).deleted, 1)
  assert.equal((await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: {} })).rows.length, 0)
})

test('AMEAÇA: uma série que SÓ ACRESCENTA recusa alterar e apagar — com o motivo', async () => {
  // O `append_only` do conjunto do bitcoin existe por isto: mudar o valor de ontem faria o
  // gráfico mudar sem que nada registre a mudança.
  await inserirRegistro({ ticker: 'PETR4', preco: 30 })
  const linhas = await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: {} })
  const id = String(linhas.rows[0].rowId)

  await assert.rejects(
    () => runUpdate({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', rowId: id, row: { ticker: 'PETR4', preco: 99 } }),
    /só aceita novos registros|append/i,
  )
  await assert.rejects(() => runDelete({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', rowId: id }), /só aceita novos registros|append/i)
  assert.equal((await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: {} })).rows[0].preco, 30)
})

test('AMEAÇA: a linha de OUTRA conta não é alcançada', async () => {
  await db.collection('dataset_definitions').updateOne({ ownerId: DONO, key: 'ordens' }, { $set: { mutability: 'mutable' } })
  await inserirRegistro({ ticker: 'PETR4', preco: 30 })
  const linhas = await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: {} })
  const id = String(linhas.rows[0].rowId)

  await assert.rejects(() => runDelete({ accountId: 'vizinho', dataStoreId: cena.store._id, datasetKey: 'ordens', rowId: id }), /não encontrado|not_found/i)
  assert.equal((await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: {} })).rows.length, 1)
})

test('AMEAÇA: um campo de negócio chamado "id" não rouba a identidade da linha', async () => {
  /**
   * O schema é escrito por quem usa, e "id" é nome de campo comum — o número do pedido, a
   * matrícula. Se a identidade da linha viesse antes do valor, ela seria sobrescrita por
   * esse campo, e o conjunto que mais tem o que corrigir seria justamente o que não dá
   * para corrigir.
   */
  await db.collection('dataset_definitions').updateOne(
    { ownerId: DONO, key: 'ordens' },
    { $set: { mutability: 'mutable', schema: { type: 'object', properties: { id: { type: 'string' }, preco: { type: 'number' } }, required: ['id'] } } },
  )
  await inserirRegistro({ id: 'PEDIDO-7', preco: 10 })
  const r = await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: {} })
  assert.equal(r.rows[0].id, 'PEDIDO-7', 'o campo de negócio sumiu')
  assert.match(String(r.rows[0].rowId), /^[a-f0-9]{24}$/, 'a linha ficou sem identidade')

  // E a identidade serve: dá para apagar por ela.
  assert.equal((await runDelete({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', rowId: String(r.rows[0].rowId) })).deleted, 1)
})

test('AMEAÇA: nem um campo chamado "rowId" rouba a identidade da linha', async () => {
  /**
   * O nome `rowId` foi escolhido por ser improvável num schema de negócio — mas improvável
   * não é impossível, e quem escreve o schema não sabe que este nome é reservado. A ordem
   * do espalhamento é o que decide: a identidade vem DEPOIS do valor, sempre.
   */
  await db.collection('dataset_definitions').updateOne(
    { ownerId: DONO, key: 'ordens' },
    { $set: { mutability: 'mutable', schema: { type: 'object', properties: { rowId: { type: 'string' }, preco: { type: 'number' } }, required: ['rowId'] } } },
  )
  await inserirRegistro({ rowId: 'ESCRITO-A-MAO', preco: 10 })
  const r = await runQuery({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', query: {} })
  assert.match(String(r.rows[0].rowId), /^[a-f0-9]{24}$/, 'o campo do schema virou a identidade da linha')
  assert.equal((await runDelete({ accountId: DONO, dataStoreId: cena.store._id, datasetKey: 'ordens', rowId: String(r.rows[0].rowId) })).deleted, 1)
})

// --- CONJUNTOS MUDOS, COMPLETADOS NO BOOT ----------------------------------------------------
//
// Do dono: "parece que já atualizou a produção porém ainda não mudou nada na tela". A linha
// estava gravada e o conjunto dizia "este dataset não declara campos" — e a correção anterior
// só valia ao APLICAR, porque nada chama o materializador ao abrir a tela. Reaplicar um plano
// para ver o que já está no banco não é conserto: é pedir desculpa com trabalho.

test('ACEITAÇÃO: uma série que grava e não declara campos passa a declarar', async () => {
  const { criarRecorder } = await import('../dist/dataHistory/recorders.js')
  const { ensureDatasetForRecorder, completarConjuntosSemCampos } = await import('../dist/databases/migration.js')
  const { listDatasets } = await import('../dist/databases/store.js')

  const r = await criarRecorder(DONO, {
    name: 'minimo e maximo a cada 5 min',
    source: { kind: 'manual', ref: 'monitoring:boot' },
    mode: 'window_aggregate',
    intervalMs: 300_000,
    persistPolicy: 'aggregate_only',
    aggregations: [{ from: 'preco_bitcoin', op: 'min', to: 'minimo' }, { from: 'preco_bitcoin', op: 'max', to: 'maximo' }],
    retention: { mode: 'forever' },
  })
  // Como a conta dele ficou: o conjunto existe, a série grava, e o schema é mudo.
  const { dataStoreId, datasetKey } = await ensureDatasetForRecorder(DONO, { ...r, selectedFields: null })
  const antes = (await listDatasets(DONO, dataStoreId)).find((d) => d.key === datasetKey)
  assert.deepEqual(Object.keys(antes.schema?.properties ?? {}), [], 'o caso só vale se ele nasceu mudo')

  const n = await completarConjuntosSemCampos()
  assert.ok(n >= 1, 'a varredura não completou nada')

  const depois = (await listDatasets(DONO, dataStoreId)).find((d) => d.key === datasetKey)
  assert.deepEqual(Object.keys(depois.schema?.properties ?? {}).sort(), ['maximo', 'minimo'])
})

test('AMEAÇA: um schema que ALGUÉM declarou não é sobrescrito', async () => {
  const { createDataStore, createDataset, listDatasets } = await import('../dist/databases/store.js')
  const { completarConjuntosSemCampos } = await import('../dist/databases/migration.js')
  const store = await createDataStore(DONO, { name: `Base de quem declarou ${Date.now()}`, adapterKind: 'data_history' })
  await createDataset(DONO, store._id, {
    key: 'meu_conjunto',
    name: 'Meu',
    schema: { type: 'object', properties: { escolhido: { type: 'string' } } },
    mutability: 'append_only',
  })
  await completarConjuntosSemCampos()
  const d = (await listDatasets(DONO, store._id)).find((x) => x.key === 'meu_conjunto')
  assert.deepEqual(Object.keys(d.schema.properties), ['escolhido'], 'a varredura só preenche o vazio')
})

// --- a coluna calculada ---------------------------------------------------------------------
//
// "Não são essas funções? quero o mesmo no database." As trinta e poucas funções do registro
// só alcançavam o agente e o Flow: um conjunto com preço mínimo e máximo a cada dez minutos
// não tinha como ganhar uma terceira coluna com a variação — a conta estava pronta e não
// chegava no dado.
//
// O motor é o de `derivedFrom`, que já existia. O que estes casos prendem é o que faltava:
// criar sem passar pelo Assistente, aparecer como COLUNA da tabela de origem, e preencher o
// histórico que já estava lá.

const PRECOS = [100, 102, 101, 104, 110]

/** Cinco leituras, uma por minuto, da mais antiga para a mais nova. */
const cincoLeituras = async () => {
  const base = Date.UTC(2026, 0, 1, 12, 0, 0)
  for (const [i, preco] of PRECOS.entries()) await inserirRegistro({ ticker: 'PETR4', preco }, new Date(base + i * 60_000))
}

const colunaDeVariacao = (extra = {}) => ({
  name: 'variacao',
  functionName: 'math.serie',
  inputField: 'preco',
  inputArg: 'values',
  lookback: 3,
  outputField: 'variacaoPercentual',
  ...extra,
})

test('ACEITAÇÃO: a coluna calculada nasce, PREENCHE o histórico e aparece na consulta', async () => {
  await cincoLeituras()
  const r = await pedir('POST', `/api/databases/${cena.store._id}/datasets/ordens/columns`, colunaDeVariacao())
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal(r.body.name, 'variacao')

  const q = await pedir('POST', `/api/databases/${cena.store._id}/datasets/ordens/query`, { limit: 10 })
  assert.equal(q.status, 200, JSON.stringify(q.body))
  const linhas = [...q.body.rows].reverse() // a consulta vem do mais novo para o mais antigo

  // As duas primeiras leituras não têm três pontos para trás: a célula fica AUSENTE, que é a
  // verdade. Um zero ali seria uma queda de 100% que nunca aconteceu.
  assert.equal(linhas[0].variacao, undefined, 'a primeira linha não tem passado suficiente')
  assert.equal(linhas[1].variacao, undefined)

  // 100 → 101 nos três últimos pontos da terceira linha: +1%.
  assert.equal(typeof linhas[2].variacao, 'number', `a terceira linha já tem três pontos: ${JSON.stringify(linhas[2])}`)
  assert.ok(Math.abs(linhas[2].variacao - 1) < 0.001, `esperava +1%, veio ${linhas[2].variacao}`)
  // 101 → 110: +8,91%.
  assert.ok(Math.abs(linhas[4].variacao - 8.91) < 0.01, `esperava +8,91%, veio ${linhas[4].variacao}`)

  // E o dado da fonte continua inteiro ao lado da conta.
  assert.equal(linhas[4].preco, 110)
  assert.equal(linhas[4].ticker, 'PETR4')
})

test('a listagem DIZ quais colunas são conta — a tela não pode confundir com dado da fonte', async () => {
  await cincoLeituras()
  await pedir('POST', `/api/databases/${cena.store._id}/datasets/ordens/columns`, colunaDeVariacao())
  const r = await pedir('GET', `/api/databases/${cena.store._id}/datasets`)
  const ds = r.body.items.find((d) => d.key === 'ordens')
  assert.deepEqual(ds.computedColumns, [{ name: 'variacao', functionName: 'math.serie', version: '1.0.0', outputField: 'variacaoPercentual' }])
})

test('AMEAÇA: uma coluna com o nome de um campo do conjunto é RECUSADA', async () => {
  // Aceitar sobrescreveria o preço gravado pela fonte na hora de montar a linha: o valor real
  // sumiria da tela e ninguém procuraria a causa numa coluna que "só acrescenta".
  const r = await pedir('POST', `/api/databases/${cena.store._id}/datasets/ordens/columns`, colunaDeVariacao({ name: 'preco' }))
  assert.equal(r.status, 400)
  assert.match(r.body.message ?? r.body.error ?? '', /já é um campo/i)
})

test('AMEAÇA: função, campo, argumento e saída inventados são recusados — cada um com a lista', async () => {
  const casos = [
    [colunaDeVariacao({ functionName: 'math.inventada' }), /não está registrada/i],
    [colunaDeVariacao({ inputField: 'volume' }), /não é um campo deste conjunto/i],
    [colunaDeVariacao({ inputArg: 'numeros' }), /não é um argumento/i],
    [colunaDeVariacao({ outputField: 'desvio' }), /não devolve/i],
    [colunaDeVariacao({ name: 'Variação!' }), /comece com letra/i],
  ]
  for (const [corpo, esperado] of casos) {
    const r = await pedir('POST', `/api/databases/${cena.store._id}/datasets/ordens/columns`, corpo)
    assert.equal(r.status, 400, `${JSON.stringify(corpo)} devia ser recusado: ${JSON.stringify(r.body)}`)
    assert.match(r.body.message ?? r.body.error ?? '', esperado)
  }
  const q = await pedir('GET', `/api/databases/${cena.store._id}/datasets`)
  assert.deepEqual(q.body.items.find((d) => d.key === 'ordens').computedColumns, [], 'nenhuma recusa pode ter deixado coluna pela metade')
})

test('AMEAÇA: a mesma coluna duas vezes é recusada — duas séries gravariam a mesma conta', async () => {
  await cincoLeituras()
  assert.equal((await pedir('POST', `/api/databases/${cena.store._id}/datasets/ordens/columns`, colunaDeVariacao())).status, 201)
  const r = await pedir('POST', `/api/databases/${cena.store._id}/datasets/ordens/columns`, colunaDeVariacao())
  assert.equal(r.status, 400)
  assert.match(r.body.message ?? r.body.error ?? '', /já existe uma coluna/i)
})

test('remover a coluna tira ela da tabela — e NÃO apaga o que a conta já apurou', async () => {
  await cincoLeituras()
  await pedir('POST', `/api/databases/${cena.store._id}/datasets/ordens/columns`, colunaDeVariacao())
  const antes = await db.collection('data_history_records').countDocuments({ ownerId: DONO })
  assert.ok(antes > PRECOS.length, 'a conta gravou linhas próprias')

  assert.equal((await pedir('DELETE', `/api/databases/${cena.store._id}/datasets/ordens/columns/variacao`)).status, 204)
  const q = await pedir('POST', `/api/databases/${cena.store._id}/datasets/ordens/query`, { limit: 10 })
  assert.ok(q.body.rows.every((l) => l.variacao === undefined), 'a coluna saiu da tabela')
  assert.equal(await db.collection('data_history_records').countDocuments({ ownerId: DONO }), antes, 'tirar a coluna não é apagar histórico')
})

test('AMEAÇA: o conjunto do vizinho não ganha coluna nenhuma', async () => {
  sessao = VIZINHO
  const r = await pedir('POST', `/api/databases/${cena.store._id}/datasets/ordens/columns`, colunaDeVariacao())
  assert.ok(r.status === 404 || r.status === 403, `esperava recusa, veio ${r.status}`)
  sessao = DONO
})

// --- a database criada À MÃO -----------------------------------------------------------------
//
// "Por que aparece 'Como este dado chega' nas databases e, quando eu crio uma manualmente,
// não aparece? Parece que tem coisas que só o Assistente consegue fazer, e isso não pode
// acontecer." Estava certo, e o buraco era maior que o bloco que faltava.

test('ACEITAÇÃO: a database criada à mão LÊ e ESCREVE — como a que o Assistente cria', async () => {
  // Exatamente o que o formulário manda: nome + tipo, sem configuração nenhuma. Antes disto,
  // as duas rotas recusavam com "este database não aponta para um histórico válido": a base
  // nascia quebrada, antes do primeiro uso.
  const store = await createDataStore(DONO, { name: 'Minha base', adapterKind: 'data_history' })
  const ds = await createDataset(DONO, store._id, { key: 'vendas', name: 'Vendas', schema: { type: 'object', properties: { valor: { type: 'number' } } } })

  const w = await pedir('POST', `/api/databases/${store._id}/datasets/vendas/rows`, { rows: [{ valor: 10 }, { valor: 20 }] })
  assert.equal(w.status, 201, JSON.stringify(w.body))

  const r = await pedir('POST', `/api/databases/${store._id}/datasets/vendas/query`, { limit: 10 })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(r.body.rows.map((l) => l.valor).sort(), [10, 20])

  // E a série é DELA, não a de outro conjunto: duas bases à mão não podem se misturar.
  assert.ok(ds.recorderId, 'o conjunto nasce amarrado à série dele')
})

test('ACEITAÇÃO: o conjunto criado à mão também DIZ como o dado chega', async () => {
  // "Por que aparece 'Como este dado chega' nas databases e, quando eu crio uma manualmente,
  // não aparece? Parece que tem coisas que só o Assistente consegue fazer."
  const store = await createDataStore(DONO, { name: 'Base à mão', adapterKind: 'data_history' })
  await createDataset(DONO, store._id, { key: 'vendas', name: 'Vendas', schema: { type: 'object', properties: { valor: { type: 'number' } } } })

  const d = await pedir('GET', `/api/databases/${store._id}`)
  const conjunto = d.body.datasets.find((x) => x.key === 'vendas')
  assert.ok(conjunto.serie, `o conjunto criado à mão tem de dizer de onde o dado vem: ${JSON.stringify(conjunto)}`)
  assert.equal(conjunto.serie.modo, 'every_event')
  assert.equal(conjunto.serie.ativa, true)
  // Sem fonte externa: ele recebe o que for gravado, e dizer isso é melhor que inventar uma
  // origem que não existe.
  assert.equal(conjunto.serie.fonte, null)
  // E a regra é EDITÁVEL: o id da série é o que a tela usa para abrir a edição.
  assert.match(conjunto.serie.id, /^[a-f0-9]{24}$/)
})

test('duas bases criadas à mão NÃO compartilham linha', async () => {
  const a = await createDataStore(DONO, { name: 'Base A', adapterKind: 'data_history' })
  const b = await createDataStore(DONO, { name: 'Base B', adapterKind: 'data_history' })
  const esquema = { type: 'object', properties: { valor: { type: 'number' } } }
  await createDataset(DONO, a._id, { key: 'vendas', name: 'Vendas', schema: esquema })
  await createDataset(DONO, b._id, { key: 'vendas', name: 'Vendas', schema: esquema })

  await pedir('POST', `/api/databases/${a._id}/datasets/vendas/rows`, { rows: [{ valor: 1 }] })
  const naB = await pedir('POST', `/api/databases/${b._id}/datasets/vendas/query`, { limit: 10 })
  assert.deepEqual(naB.body.rows, [], 'a chave "vendas" é a mesma nas duas; a série não pode ser')
})

test('mercado e App externo NÃO ganham série: eles respondem de fora', async () => {
  // Uma série vazia ao lado deles seria um recurso que nunca recebe nada.
  const mercado = await createDataStore(DONO, { name: 'Mercado', adapterKind: 'market_data' })
  const ds = await createDataset(DONO, mercado._id, { key: 'candles', name: 'Candles', schema: { type: 'object', properties: { close: { type: 'number' } } } })
  assert.equal(ds.recorderId, undefined)
})

// --- a base é a coisa principal, a pasta é organização ---------------------------------------
//
// "E por que temos pasta e conjunto?" Na conta do dono era 1:1: duas pastas, uma tabela em
// cada, e o nome da pasta era a descrição da tabela lá dentro. A pasta continua existindo — é
// ela que carrega o grant e a configuração de mercado e de App —, mas só APARECE como pasta
// quando alguém decidiu criá-la.

const criarBaseHttp = (corpo) => pedir('POST', '/api/databases/bases', corpo)

test('ACEITAÇÃO: criar uma base é UM passo — nome e campos, sem pasta nenhuma', async () => {
  const r = await criarBaseHttp({ name: 'Vendas do mês', fields: [{ name: 'valor', type: 'number' }, { name: 'vendedor', type: 'string' }] })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal(r.body.name, 'Vendas do mês')
  assert.equal(r.body.folder, null, 'sem pasta escolhida, a base nasce solta')
  assert.deepEqual(r.body.fields.sort(), ['valor', 'vendedor'])

  // E ela FUNCIONA: era o que não acontecia quando criar exigia dois passos.
  const w = await pedir('POST', `/api/databases/${r.body.dataStoreId}/datasets/${r.body.key}/rows`, { rows: [{ valor: 10, vendedor: 'ana' }] })
  assert.equal(w.status, 201, JSON.stringify(w.body))
  const q = await pedir('POST', `/api/databases/${r.body.dataStoreId}/datasets/${r.body.key}/query`, { limit: 5 })
  assert.equal(q.body.rows.length, 1)
})

test('as pastas que o sistema inventou por dentro NÃO aparecem como pasta', async () => {
  // É assim que a conta do dono achata: nenhum registro se move para isso acontecer.
  const r = await criarBaseHttp({ name: 'Solta', fields: [{ name: 'x', type: 'number' }] })
  const lista = await pedir('GET', '/api/databases/bases')
  const base = lista.body.items.find((b) => b.id === r.body.id)
  assert.equal(base.folder, null)
  // A pasta de origem existe no banco — ela só não é uma pasta na tela.
  assert.ok(base.dataStoreId)
})

test('ACEITAÇÃO: uma pasta CRIADA de propósito aparece, e a base entra nela', async () => {
  const pasta = await pedir('POST', '/api/databases/folders', { name: 'Financeiro' })
  assert.equal(pasta.status, 201, JSON.stringify(pasta.body))
  const base = await criarBaseHttp({ name: 'Cotações', fields: [{ name: 'preco', type: 'number' }], folderId: pasta.body.id })
  assert.deepEqual(base.body.folder, { id: pasta.body.id, name: 'Financeiro' })
})

test('ACEITAÇÃO: mover uma base de pasta NÃO move registro nenhum', async () => {
  const base = await criarBaseHttp({ name: 'Vendas', fields: [{ name: 'valor', type: 'number' }] })
  await pedir('POST', `/api/databases/${base.body.dataStoreId}/datasets/${base.body.key}/rows`, { rows: [{ valor: 7 }] })
  const pasta = await pedir('POST', '/api/databases/folders', { name: 'Comercial' })

  const m = await pedir('PATCH', `/api/databases/bases/${base.body.id}/folder`, { folderId: pasta.body.id })
  assert.equal(m.status, 200, JSON.stringify(m.body))
  assert.deepEqual(m.body.folder, { id: pasta.body.id, name: 'Comercial' })

  // As linhas ficam penduradas na SÉRIE, não na pasta.
  const q = await pedir('POST', `/api/databases/${pasta.body.id}/datasets/${base.body.key}/query`, { limit: 5 })
  assert.equal(q.status, 200, JSON.stringify(q.body))
  assert.deepEqual(q.body.rows.map((l) => l.valor), [7])
})

test('mover DIZ quantos grants a base deixa para trás — permissão mora na pasta', async () => {
  const base = await criarBaseHttp({ name: 'Sensível', fields: [{ name: 'valor', type: 'number' }] })
  await pedir('PUT', `/api/databases/${base.body.dataStoreId}/grants`, {
    subjectType: 'agent',
    subjectId: cena.marina._id.toString(),
    capabilities: ['query'],
  })
  const pasta = await pedir('POST', '/api/databases/folders', { name: 'Outra' })
  const m = await pedir('PATCH', `/api/databases/bases/${base.body.id}/folder`, { folderId: pasta.body.id })
  assert.ok(m.body.perdeuGrants >= 1, `mover em silêncio tira acesso de quem tinha: ${JSON.stringify(m.body)}`)
})

test('AMEAÇA: mover para uma pasta que já tem base com a mesma chave é recusado', async () => {
  const pasta = await pedir('POST', '/api/databases/folders', { name: 'Destino' })
  const a = await criarBaseHttp({ name: 'Vendas', fields: [{ name: 'x', type: 'number' }] })
  await criarBaseHttp({ name: 'Vendas', fields: [{ name: 'x', type: 'number' }], folderId: pasta.body.id })
  const m = await pedir('PATCH', `/api/databases/bases/${a.body.id}/folder`, { folderId: pasta.body.id })
  assert.equal(m.status, 400)
  assert.match(m.body.message ?? '', /já tem uma base com a chave/i)
})

test('AMEAÇA: uma base sem campo nenhum é recusada — ela não poderia ser consultada', async () => {
  const r = await criarBaseHttp({ name: 'Vazia', fields: [] })
  assert.equal(r.status, 400)
  assert.match(r.body.message ?? '', /ao menos um campo/i)
})

test('AMEAÇA: a base do vizinho não se move', async () => {
  const base = await criarBaseHttp({ name: 'Minha', fields: [{ name: 'x', type: 'number' }] })
  sessao = VIZINHO
  const m = await pedir('PATCH', `/api/databases/bases/${base.body.id}/folder`, { folderId: null })
  assert.ok(m.status === 404 || m.status === 400, `esperava recusa, veio ${m.status}`)
  sessao = DONO
})
