// HARDENING do fluxo de mercado: as promessas que ele faz, conferidas onde quebram.
//
// Cada prova aqui existe por causa de uma forma específica de errar — e não por causa
// de uma função específica. Elas atravessam camadas de propósito.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { readFileSync, readdirSync } from 'node:fs'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.APP_ENCRYPTION_KEY ||= 'chave-de-teste-com-32-caracteres!'

const { buildAlpacaTools } = await import('../dist/apps/official/alpaca/adapter.js')
const { createAlpacaClient, tradingBaseFor } = await import('../dist/apps/official/alpaca/client.js')
const { savePolicy, ensurePolicyIndexes, policyPublic } = await import('../dist/policies/repository.js')
const { normalizeEnvironment, createInstallation, installationPublic } = await import('../dist/apps/installations.js')
const { resolveConnection } = await import('../dist/apps/connectionProfile.js')
const { createPrivateApp, resolveAppForOwner } = await import('../dist/apps/privateApps.js')
const { ensureAppActionIndexes } = await import('../dist/apps/actionEvents.js')
const { getApp } = await import('../dist/apps/registry.js')
const { streamPublic } = await import('../dist/streams/types.js')
const { upsertStream, ensureStreamIndexes } = await import('../dist/streams/repository.js')
const engine = await import('../dist/marketData/engine.js')
const store = await import('../dist/marketData/candleStore.js')
const { ensureMarketStateIndexes } = await import('../dist/marketData/state.js')
const bus = await import('../dist/events/bus.js')
const { db, mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const DONO = 'dono-hardening'
const CONEXAO = new ObjectId()
const SEGREDO = 'segredo-que-nunca-pode-sair-daqui'
const CRED = { keyId: 'PKTESTE0000000000000', secretKey: SEGREDO }

before(async () => {
  await ensurePolicyIndexes()
  await ensureAppActionIndexes()
  await ensureStreamIndexes()
  await store.ensureCandleIndexes()
  await ensureMarketStateIndexes()
  await bus.ensureEventIndexes()
})

beforeEach(async () => {
  for (const c of ['trading_policies', 'app_action_events', 'market_streams', 'market_candles', 'market_state', 'platform_events', 'connections'])
    await db.collection(c).deleteMany({})
})

// --- LIVE não opera, em nenhuma camada ---------------------------------------------------

test('produção é recusada em todas as camadas, não em uma', async () => {
  // Uma tranca só é uma tranca que alguém pode esquecer de chamar num caminho novo.
  assert.throws(() => normalizeEnvironment('live'), /não está liberado/)
  assert.throws(() => tradingBaseFor('live'), /não está liberado/)
  assert.throws(() => createAlpacaClient(CRED, 'live'), /não está liberado/)
  assert.deepEqual(buildAlpacaTools(CRED, 'live'), [], 'nem ferramenta existe')

  // E na resolução da conexão, para um documento gravado fora da API.
  await db.collection('connections').insertOne({
    _id: CONEXAO,
    ownerId: DONO,
    appKey: 'alpaca',
    appVersion: '1.0.0',
    name: 'Produção',
    status: 'connected',
    encryptedConfig: '',
    environment: 'live',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const r = await resolveConnection(DONO, CONEXAO.toString(), { requireConnectable: false })
  assert.equal(r.ok, false)
  assert.equal(r.problem, 'environment_blocked')
})

// --- a política é reavaliada NA HORA -------------------------------------------------------

test('mudar a política vale para a próxima ordem, e não só para a próxima sessão', async () => {
  // A ferramenta é montada uma vez e vive na memória do processo. Se a política fosse
  // lida na montagem, apertar um limite não teria efeito até alguém reiniciar.
  const chamadas = []
  const f = async (url, init = {}) => {
    chamadas.push({ url: String(url), method: init.method ?? 'GET' })
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'o-1', symbol: 'AAPL', status: 'accepted' }) }
  }
  const ctx = { ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }
  const ferramenta = buildAlpacaTools(CRED, 'paper', { fetch: f }, ctx).find((t) => t.name === 'alpaca_criar_ordem')
  const ordem = { symbol: 'AAPL', side: 'buy', quantity: 10, type: 'limit', limitPrice: 10 }

  assert.equal((await ferramenta.run(ordem)).ok, true)
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 1 })
  // A MESMA ferramenta, já montada.
  const depois = await ferramenta.run(ordem)
  assert.equal(depois.ok, false)
  assert.equal(JSON.parse(depois.result).status, 'policy_denied')
})

// --- o tick não vira auditoria ---------------------------------------------------------------

test('milhares de preços não viram milhares de linhas de auditoria', async () => {
  // Um ativo líquido faz milhares de negócios por minuto. Registrar cada um como evento
  // de ação encheria a auditoria com ruído e esconderia o que importa nela.
  const K = { ownerId: DONO, provider: 'alpaca', installationId: CONEXAO.toString(), environment: 'paper', symbol: 'AAPL' }
  const T0 = Date.parse('2026-05-12T14:00:00Z')
  for (let i = 0; i < 50; i += 1) {
    await engine.ingestTrade(K, { symbol: 'AAPL', price: 100 + i * 0.01, size: 1, at: new Date(T0 + i * 1000), tradeId: `t${i}` })
  }
  assert.equal(await db.collection('app_action_events').countDocuments({}), 0)
  // O que fica é a VELA: uma linha para os cinquenta negócios.
  assert.equal(await db.collection('market_candles').countDocuments({ timeframe: '1m' }), 1)
})

test('o tick cru também não vira documento sem alguém pedir', async () => {
  assert.equal(await db.listCollections({ name: 'market_ticks' }).toArray().then((c) => c.length), 0)
})

// --- nenhum DTO carrega credencial -------------------------------------------------------------

test('nenhuma superfície nova devolve credencial, nem cifrada', async () => {
  const manifesto = {
    key: 'segredo_teste',
    version: '1.0.0',
    source: 'private',
    name: 'App com Segredo',
    description: 'Um App para provar que o segredo não sai.',
    categories: ['dados'],
    auth: { kind: 'api_key', fields: [{ key: 'token', label: 'Token', secret: true }], scopes: [] },
    allowedDomains: ['api.exemplo.com'],
    supportsMultipleConnections: true,
    actions: [],
    status: 'active',
  }
  await createPrivateApp(DONO, manifesto)
  const app = await resolveAppForOwner(DONO, 'segredo_teste')
  const conexao = await createInstallation(DONO, app, { name: 'Com segredo', config: { token: SEGREDO } })

  const stream = await upsertStream({
    ownerId: DONO,
    installationId: conexao._id.toString(),
    appKey: 'segredo_teste',
    environment: 'default',
    symbols: ['AAPL'],
  })
  const streamLido = await db.collection('market_streams').findOne({ _id: stream._id })

  const policy = await savePolicy({ ownerId: DONO, installationId: conexao._id.toString(), agentId: null }, { maxQuantity: 10 })
  const { event } = await bus.publishEvent({
    ownerId: DONO,
    type: 'market.price.updated',
    source: 'alpaca:paper',
    payload: { symbol: 'AAPL', price: 10 },
    dedupeKey: 'hardening-1',
  })

  const superficies = [installationPublic(conexao), streamPublic(streamLido), policyPublic(policy), event]
  for (const dto of superficies) {
    const json = JSON.stringify(dto)
    assert.ok(!json.includes(SEGREDO), `o segredo em claro vazou em ${JSON.stringify(Object.keys(dto)).slice(0, 60)}`)
    assert.ok(!json.includes(conexao.encryptedConfig), 'nem o cifrado — ele também é o segredo')
  }
})

test('o texto do provider só entra no banco pelas mãos de quem sabe riscar a credencial', () => {
  /**
   * O `lastError` do stream vai para a tela, e o texto que o alimenta vem do provider —
   * onde um erro de autenticação chega com a chave que o causou junto.
   *
   * Quem tem a credencial em mãos para riscá-la é o gerenciador, e só ele. Esta prova
   * não confere o riscar (isso é o teste do gerenciador): ela confere que ninguém MAIS
   * grava ali. Um segundo gravador é como esse tipo de vazamento reaparece.
   */
  const dir = new URL('../src/', import.meta.url)
  const permitidos = new Set(['streams/manager.ts', 'streams/repository.ts'])
  const pendentes = ['']
  const infratores = []
  while (pendentes.length) {
    const rel = pendentes.pop()
    for (const entrada of readdirSync(new URL(rel, dir), { withFileTypes: true })) {
      const caminho = `${rel}${entrada.name}`
      if (entrada.isDirectory()) pendentes.push(`${caminho}/`)
      else if (caminho.endsWith('.ts') && !permitidos.has(caminho)) {
        if (/setStreamError\s*\(/.test(readFileSync(new URL(caminho, dir), 'utf8'))) infratores.push(caminho)
      }
    }
  }
  assert.deepEqual(infratores, [])
})

// --- isolamento por dono, nas coleções novas ------------------------------------------------------

test('nenhuma coleção nova é legível de outra conta', async () => {
  const { listEvents } = bus
  const { listStreams } = await import('../dist/streams/repository.js')
  const { listPolicies } = await import('../dist/policies/repository.js')
  const { closedSeries } = store

  await bus.publishEvent({ ownerId: DONO, type: 'market.price.updated', source: 't', payload: {}, dedupeKey: 'iso-1' })
  await upsertStream({ ownerId: DONO, installationId: CONEXAO.toString(), appKey: 'alpaca', environment: 'paper', symbols: [] })
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 1 })
  await engine.ingestTrade(
    { ownerId: DONO, provider: 'alpaca', installationId: CONEXAO.toString(), environment: 'paper', symbol: 'AAPL' },
    { symbol: 'AAPL', price: 10, size: 1, at: new Date('2026-05-12T14:00:00Z'), tradeId: 'x' },
  )
  await engine.closeDueCandles(new Date('2026-05-12T14:02:00Z'))

  // O dono está na CONSULTA, e não numa conferência depois de ler.
  assert.equal((await listEvents('outro')).length, 0)
  assert.equal((await listStreams('outro')).length, 0)
  assert.equal((await listPolicies('outro')).length, 0)
  assert.equal((await closedSeries('outro', { symbol: 'AAPL', timeframe: '1m' })).length, 0)
  // E cada uma delas tem algo para o dono certo — senão a prova passaria vazia.
  assert.ok((await listEvents(DONO)).length > 0)
  assert.ok((await listStreams(DONO)).length > 0)
  assert.ok((await listPolicies(DONO)).length > 0)
  assert.ok((await closedSeries(DONO, { symbol: 'AAPL', timeframe: '1m' })).length > 0)
})
