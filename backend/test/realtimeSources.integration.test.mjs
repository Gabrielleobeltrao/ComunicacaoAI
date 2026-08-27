// FONTES DE DADOS EM TEMPO REAL, ligadas a agentes.
//
// O que estas provas fixam é a promessa da camada: um agente consulta o valor de agora
// SEM que ninguém tenha configurado histórico, sem abrir socket nenhum, e sem enxergar
// o que não lhe foi concedido. O stream é o mesmo para todo mundo — a camada só dá nome
// a um pedaço dele e diz quem pode olhar.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const repo = await import('../dist/realtimeSources/repository.js')
const reader = await import('../dist/realtimeSources/reader.js')
const liveData = await import('../dist/integrations/websocket/liveData.js')
const { createInstallation } = await import('../dist/apps/installations.js')
const { getApp } = await import('../dist/apps/registry.js')
const { executeRegisteredFunction } = await import('../dist/executors/functionExecutor.js')

const DONO = 'dono-realtime'
const OUTRO = 'outro-dono'
const AGENTE_A = new ObjectId()
const AGENTE_B = new ObjectId()

before(async () => {
  await repo.ensureRealtimeSourceIndexes()
  await liveData.ensureLiveDataIndexes()
})
after(async () => {
  await mongoClient.close()
  await stopMongo()
})
beforeEach(async () => {
  for (const c of ['realtime_sources', 'live_data', 'connections', 'data_recorders', 'data_history_records']) await db.collection(c).deleteMany({})
  liveData.resetLiveBuffer()
})

/** Uma conexão de WebSocket de verdade — a fonte precisa apontar para algo desta conta. */
async function conectar(nome = 'WebSocket Genérico — Binance', dono = DONO) {
  const i = await createInstallation(dono, getApp('websocket'), { name: nome, config: { token: 'segredo-de-teste-123' }, publicMetadata: {} })
  return i._id.toString()
}

/** O stream escrevendo no Dado ao vivo — exatamente como o App faz. */
const publicar = async (conexao, chave, valor, quando = new Date(), dono = DONO) => {
  await liveData.putLiveValue(dono, conexao, chave, valor, 300, quando)
  await liveData.flushLiveData()
}

const criarFonte = (conexao, extra = {}, dono = DONO) =>
  repo.criarFonte(dono, {
    name: 'BTC atual',
    sourceKind: 'live_data',
    sourceRef: conexao,
    key: 'BTCUSDT',
    alias: 'btc_price',
    agentIds: [AGENTE_A.toString()],
    ...extra,
  })

const chamar = (nome, input, ctx) => executeRegisteredFunction({ kind: 'function', functionName: nome }, input, ctx)

// --- o caso principal ------------------------------------------------------------------

test('um agente consulta BTCUSDT em tempo real SEM nenhum histórico configurado', async () => {
  const conexao = await conectar()
  await criarFonte(conexao)
  await publicar(conexao, 'BTCUSDT', { symbol: 'BTCUSDT', price: 64_120.5, volume: 3.2 })

  const r = await chamar('realtime_data.get', { source: 'btc_price' }, { ownerId: DONO, agentId: AGENTE_A.toString() })
  assert.equal(r.ok, true, JSON.stringify(r.error))
  const leitura = r.structured.data
  assert.equal(leitura.found, true)
  assert.equal(leitura.value.price, 64_120.5)
  assert.equal(leitura.stale, false)
  assert.ok(leitura.ageMs >= 0 && leitura.ageMs < 5_000)
  assert.ok(typeof leitura.receivedAt === 'string')

  // E o ponto inteiro desta camada: nenhum histórico foi criado.
  assert.equal(await db.collection('data_recorders').countDocuments({}), 0, 'usar em tempo real NÃO cria regra de gravação')
  assert.equal(await db.collection('data_history_records').countDocuments({}), 0)
})

test('realtime e histórico são independentes nas três combinações', async () => {
  const conexao = await conectar()
  const { criarRecorder } = await import('../dist/dataHistory/recorders.js')

  // 1. Tempo real SIM, histórico NÃO.
  await criarFonte(conexao, { alias: 'so_realtime' })
  assert.equal(await db.collection('data_recorders').countDocuments({}), 0)

  // 2. Tempo real SIM, histórico SIM — configurados à parte, sem um saber do outro.
  await criarRecorder(DONO, { name: 'histórico', source: { kind: 'live_data', ref: conexao }, mode: 'every_event' })
  assert.equal(await db.collection('realtime_sources').countDocuments({}), 1, 'criar histórico não criou fonte')
  assert.equal(await db.collection('data_recorders').countDocuments({}), 1)

  // 3. Tempo real NÃO, histórico SIM: apagar a fonte não toca no histórico.
  const fonte = (await repo.listarFontes(DONO))[0]
  await repo.apagarFonte(DONO, fonte._id)
  assert.equal(await db.collection('realtime_sources').countDocuments({}), 0)
  assert.equal(await db.collection('data_recorders').countDocuments({}), 1, 'o histórico continua de pé sozinho')
})

test('dois agentes leem o MESMO stream — e nada é duplicado', async () => {
  const conexao = await conectar()
  await criarFonte(conexao, { agentIds: [AGENTE_A.toString(), AGENTE_B.toString()] })
  await publicar(conexao, 'BTCUSDT', { price: 100 })

  const a = await chamar('realtime_data.get', { source: 'btc_price' }, { ownerId: DONO, agentId: AGENTE_A.toString() })
  const b = await chamar('realtime_data.get', { source: 'btc_price' }, { ownerId: DONO, agentId: AGENTE_B.toString() })
  assert.equal(a.structured.data.value.price, 100)
  assert.equal(b.structured.data.value.price, 100)

  // Uma linha no Dado ao vivo, uma fonte, dois leitores. Nenhuma conexão a mais.
  assert.equal(await db.collection('live_data').countDocuments({}), 1)
  assert.equal(await db.collection('realtime_sources').countDocuments({}), 1)
  assert.equal(await db.collection('connections').countDocuments({}), 1, 'nenhum WebSocket por agente')
})

// --- concessão e posse -------------------------------------------------------------------

test('um agente SEM concessão não enxerga a fonte — nem pelo apelido certo', async () => {
  const conexao = await conectar()
  await criarFonte(conexao, { agentIds: [AGENTE_A.toString()] })
  await publicar(conexao, 'BTCUSDT', { price: 100 })

  const r = await chamar('realtime_data.get', { source: 'btc_price' }, { ownerId: DONO, agentId: AGENTE_B.toString() })
  assert.equal(r.ok, false)
  assert.match(String(r.error.message ?? ''), /não está disponível/)

  // E listar não vaza a existência dela.
  const lista = await chamar('realtime_data.list', {}, { ownerId: DONO, agentId: AGENTE_B.toString() })
  assert.equal(lista.structured.data.count, 0)
})

test('a fonte de outra conta não é alcançável, nem com o apelido igual', async () => {
  const minha = await conectar()
  const dele = await conectar('Do vizinho', OUTRO)
  await criarFonte(minha)
  await repo.criarFonte(OUTRO, {
    name: 'BTC do vizinho',
    sourceKind: 'live_data',
    sourceRef: dele,
    key: 'BTCUSDT',
    alias: 'btc_price',
    agentIds: [AGENTE_A.toString()],
  })
  await publicar(minha, 'BTCUSDT', { price: 1 })
  await publicar(dele, 'BTCUSDT', { price: 999 }, new Date(), OUTRO)

  // O MESMO agente, o MESMO apelido: cada dono lê o seu.
  const meu = await chamar('realtime_data.get', { source: 'btc_price' }, { ownerId: DONO, agentId: AGENTE_A.toString() })
  const dele2 = await chamar('realtime_data.get', { source: 'btc_price' }, { ownerId: OUTRO, agentId: AGENTE_A.toString() })
  assert.equal(meu.structured.data.value.price, 1)
  assert.equal(dele2.structured.data.value.price, 999)
})

test('apontar para a conexão de outra conta é recusado na criação', async () => {
  const dele = await conectar('Do vizinho', OUTRO)
  await assert.rejects(() => criarFonte(dele), /não existe nesta conta/)
  await assert.rejects(() => criarFonte('nao-e-id'), /escolha uma da lista/)
})

test('sem agente na execução, a função recusa em vez de abrir para a conta toda', async () => {
  const conexao = await conectar()
  await criarFonte(conexao)
  const r = await chamar('realtime_data.get', { source: 'btc_price' }, { ownerId: DONO })
  assert.equal(r.ok, false)
  assert.match(String(r.error.message ?? ''), /execução de agente/)
})

// --- dado velho ----------------------------------------------------------------------------

test('dado velho volta COM o valor e marcado como velho', async () => {
  const conexao = await conectar()
  await criarFonte(conexao, { staleAfterSeconds: 5 })
  // Chegou há doze segundos: existe, mas não é "o preço de agora".
  await publicar(conexao, 'BTCUSDT', { price: 100 }, new Date(Date.now() - 12_000))

  const r = await chamar('realtime_data.get', { source: 'btc_price' }, { ownerId: DONO, agentId: AGENTE_A.toString() })
  const leitura = r.structured.data
  assert.equal(leitura.found, true)
  assert.equal(leitura.stale, true, 'não pode parecer atual em silêncio')
  assert.ok(leitura.ageMs >= 11_000, `idade ${leitura.ageMs}`)
  assert.equal(leitura.value.price, 100, 'e o valor volta junto: quem chamou decide se serve')
})

test('chave que nunca recebeu nada responde "não encontrado", e não velho', async () => {
  const conexao = await conectar()
  await criarFonte(conexao, { key: 'NAO-EXISTE' })
  const r = await chamar('realtime_data.get', { source: 'btc_price' }, { ownerId: DONO, agentId: AGENTE_A.toString() })
  assert.equal(r.ok, true, JSON.stringify(r.error))
  const leitura = r.structured.data
  assert.equal(leitura.found, false)
  assert.equal(leitura.value, null)
  // Sem valor não há o que estar velho — marcar aqui faria parecer que existe algo.
  assert.equal(leitura.stale, false)
})

// --- campos e listagem ----------------------------------------------------------------------

test('os campos concedidos limitam o que o agente enxerga', async () => {
  const conexao = await conectar()
  await criarFonte(conexao, { allowedFields: ['symbol', 'price'] })
  await publicar(conexao, 'BTCUSDT', { symbol: 'BTCUSDT', price: 100, interno: 'nao-deveria-sair', volume: 9 })

  const r = await chamar('realtime_data.get', { source: 'btc_price' }, { ownerId: DONO, agentId: AGENTE_A.toString() })
  assert.deepEqual(Object.keys(r.structured.data.value).sort(), ['price', 'symbol'])
})

test('listar traz as fontes do agente com o valor de cada uma', async () => {
  const conexao = await conectar()
  await criarFonte(conexao, { alias: 'btc' })
  await criarFonte(conexao, { alias: 'eth', key: 'ETHUSDT', name: 'ETH atual' })
  await publicar(conexao, 'BTCUSDT', { price: 100 })
  await publicar(conexao, 'ETHUSDT', { price: 5 })

  const r = await chamar('realtime_data.list', {}, { ownerId: DONO, agentId: AGENTE_A.toString() })
  const { count, sources } = r.structured.data
  assert.equal(count, 2)
  assert.deepEqual(sources.map((s) => s.alias).sort(), ['btc', 'eth'])
  assert.equal(sources.find((s) => s.alias === 'btc').value.price, 100)
})

// --- as duas execuções --------------------------------------------------------------------

test('a ferramenta do agente de LLM lê a MESMA coisa que o agente de código', async () => {
  const { realtimeSourceTool } = await import('../dist/realtimeSources/tool.js')
  const conexao = await conectar()
  await criarFonte(conexao)
  await publicar(conexao, 'BTCUSDT', { price: 64_000 })

  const ferramenta = realtimeSourceTool(DONO, AGENTE_A)
  const daLlm = JSON.parse((await ferramenta.run({ source: 'btc_price' })).result)
  const doCodigo = (await chamar('realtime_data.get', { source: 'btc_price' }, { ownerId: DONO, agentId: AGENTE_A.toString() })).structured.data

  assert.equal(daLlm.value.price, doCodigo.value.price)
  assert.equal(daLlm.found, doCodigo.found)
  assert.equal(daLlm.stale, doCodigo.stale)
  // A ferramenta é de LEITURA: pode ir em paralelo com outras leituras.
  assert.equal(ferramenta.risk, 'read')
})

test('a ferramenta do LLM sem nome lista o que existe, e recusa o que não foi concedido', async () => {
  const { realtimeSourceTool } = await import('../dist/realtimeSources/tool.js')
  const conexao = await conectar()
  await criarFonte(conexao)

  const daA = JSON.parse((await realtimeSourceTool(DONO, AGENTE_A).run({})).result)
  assert.deepEqual(daA.sources.map((s) => s.source), ['btc_price'])

  const daB = await realtimeSourceTool(DONO, AGENTE_B).run({ source: 'btc_price' })
  assert.equal(daB.ok, false)
  const corpo = JSON.parse(daB.result)
  assert.equal(corpo.executed, false)
  assert.deepEqual(corpo.disponiveis, [])
})

test('a ferramenta só aparece para o agente de LLM quando há fonte concedida', async () => {
  const { resolveAgentTools } = await import('../dist/builtinTools.js')
  const conexao = await conectar()
  const agente = { _id: AGENTE_A, ownerId: DONO, name: 'Analista', capabilities: [] }

  const semFonte = await resolveAgentTools(agente, DONO)
  assert.equal(semFonte.some((t) => t.name === 'consultar_tempo_real'), false, 'sem fonte, sem ferramenta')

  await criarFonte(conexao)
  const comFonte = await resolveAgentTools(agente, DONO)
  assert.equal(comFonte.some((t) => t.name === 'consultar_tempo_real'), true)
  assert.equal(comFonte.some((t) => t.name === 'esperar_tempo_real'), true)
})

// --- o Dado ao vivo continua sendo o que era ------------------------------------------------

test('a camada só LÊ: o Dado ao vivo continua uma linha por chave, com TTL', async () => {
  const conexao = await conectar()
  await criarFonte(conexao)
  for (const p of [1, 2, 3]) await publicar(conexao, 'BTCUSDT', { price: p }, new Date(Date.now() + p))

  await chamar('realtime_data.get', { source: 'btc_price' }, { ownerId: DONO, agentId: AGENTE_A.toString() })
  assert.equal(await db.collection('live_data').countDocuments({}), 1, 'uma chave, uma linha — nada virou série')
  const vivo = await liveData.getLiveValue(DONO, conexao, 'BTCUSDT')
  assert.equal(vivo.value.price, 3)
})

test('apagar a fonte não apaga o Dado ao vivo — ele é de quem publica', async () => {
  const conexao = await conectar()
  const fonte = await criarFonte(conexao)
  await publicar(conexao, 'BTCUSDT', { price: 1 })
  await repo.apagarFonte(DONO, fonte._id)
  assert.equal(await db.collection('live_data').countDocuments({}), 1)
})

// --- validação e limites ----------------------------------------------------------------------

test('o apelido é único por conta, e não aceita nome que mexa no protótipo', async () => {
  const conexao = await conectar()
  await criarFonte(conexao)
  await assert.rejects(() => criarFonte(conexao, { key: 'OUTRA' }), /já existe uma fonte/)
  await assert.rejects(() => criarFonte(conexao, { alias: '__proto__' }), /não permitido|nome/)
  await assert.rejects(() => criarFonte(conexao, { alias: 'com espaço' }), /letras|nome/)
})

test('conceder e retirar o acesso de um agente', async () => {
  const conexao = await conectar()
  const fonte = await criarFonte(conexao, { agentIds: [] })
  assert.equal((await repo.fontesDoAgente(DONO, AGENTE_A)).length, 0)

  await repo.definirAgentes(DONO, fonte._id, [AGENTE_A.toString()])
  assert.equal((await repo.fontesDoAgente(DONO, AGENTE_A)).length, 1)

  await repo.definirAgentes(DONO, fonte._id, [])
  assert.equal((await repo.fontesDoAgente(DONO, AGENTE_A)).length, 0)

  // Desligada não é consultável, mesmo concedida.
  await repo.definirAgentes(DONO, fonte._id, [AGENTE_A.toString()])
  await repo.atualizarFonte(DONO, fonte._id, { enabled: false })
  assert.equal((await repo.fontesDoAgente(DONO, AGENTE_A)).length, 0)
})

test('a fonte não guarda credencial nenhuma', async () => {
  const conexao = await conectar()
  const fonte = await criarFonte(conexao)
  const doc = await db.collection('realtime_sources').findOne({ _id: fonte._id })
  const texto = JSON.stringify(doc)
  assert.ok(!texto.includes('segredo-de-teste-123'), 'a credencial da conexão não pode estar aqui')
  assert.equal(doc.sourceRef, conexao, 'só a referência')
})
