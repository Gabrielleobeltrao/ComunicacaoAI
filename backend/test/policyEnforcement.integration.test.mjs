// A POLÍTICA APLICADA — no último instante, contra a corretora falsa.
//
// A prova que importa não é "a regra avalia certo" (isso é o teste puro): é que a
// ordem NÃO SAI. Uma política que barra num relatório e deixa a chamada partir não é
// política.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.APP_ENCRYPTION_KEY ||= 'chave-de-teste-com-32-caracteres!'

const { buildAlpacaTools, ORDER_ACTION_KEYS } = await import('../dist/apps/official/alpaca/adapter.js')
const { savePolicy, activePolicyFor, normalizeRules, ensurePolicyIndexes, policyHistory } = await import('../dist/policies/repository.js')
const { guardOrder, PolicyDenied } = await import('../dist/policies/guard.js')
const { ensureAppActionIndexes, countActionsSince } = await import('../dist/apps/actionEvents.js')
const { ValidationError } = await import('../dist/building.js')
const { db, mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const DONO = 'dono-politica'
const VIZINHO = 'dono-vizinho'
const CONEXAO = new ObjectId()
const OUTRA_CONEXAO = new ObjectId()
const AGENTE = new ObjectId()
const CRED = { keyId: 'PKTESTE0000000000000', secretKey: 'segredo-de-teste-que-nao-existe' }

before(async () => {
  await ensurePolicyIndexes()
  await ensureAppActionIndexes()
})

beforeEach(async () => {
  await db.collection('trading_policies').deleteMany({})
  await db.collection('app_action_events').deleteMany({})
})

function fetchFalso(respostas) {
  const chamadas = []
  const impl = async (url, init = {}) => {
    chamadas.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null })
    const casada = respostas.find((r) => (r.match ? String(url).includes(r.match) : false) && !r.usada)
    const r = casada ?? respostas.find((x) => !x.match && !x.usada) ?? { status: 200, body: {} }
    r.usada = true
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, text: async () => JSON.stringify(r.body ?? {}) }
  }
  impl.chamadas = chamadas
  return impl
}

const ORDEM_OK = { match: '/v2/orders', body: { id: 'o-1', symbol: 'AAPL', status: 'accepted', qty: '10' } }
const COTACAO = { match: '/quotes/latest', body: { quote: { ap: 100, bp: 99.9 } } }
const CONTA = { match: '/v2/account', body: { equity: '10000', last_equity: '10000' } }
const POSICOES = (lista = []) => ({ match: '/v2/positions', body: lista })

const contexto = (over = {}) => ({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null, ...over })

const ferramentas = (f, ctx = contexto()) => buildAlpacaTools(CRED, 'paper', { fetch: f }, ctx)
const acha = (lista, nome) => lista.find((t) => t.name === nome)

const ordemPadrao = { symbol: 'AAPL', side: 'buy', quantity: 10 }

// --- a ordem não sai -------------------------------------------------------------------

test('sem política, a ordem sai como sempre saiu', async () => {
  const f = fetchFalso([COTACAO, ORDEM_OK])
  const r = await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)
  assert.equal(r.ok, true)
  assert.ok(f.chamadas.some((c) => c.method === 'POST'))
})

test('a política barra e NENHUMA chamada de ordem sai', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 5 })
  const f = fetchFalso([COTACAO, ORDEM_OK])
  const r = await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)

  assert.equal(r.ok, false)
  const resultado = JSON.parse(r.result)
  assert.equal(resultado.status, 'policy_denied')
  assert.equal(resultado.violations[0].code, 'max_quantity')
  // O que importa: a ordem não partiu.
  assert.equal(f.chamadas.filter((c) => c.method === 'POST').length, 0)
})

test('a recusa diz o ambiente, porque simulação e produção não são a mesma decisão', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 1 })
  const r = await acha(ferramentas(fetchFalso([COTACAO])), 'alpaca_criar_ordem').run(ordemPadrao)
  assert.equal(JSON.parse(r.result).environment, 'paper')
})

test('o bracket também passa pela porteira', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { symbolAllowlist: ['MSFT'] })
  const f = fetchFalso([COTACAO, ORDEM_OK])
  const r = await acha(ferramentas(f), 'alpaca_ordem_bracket').run({ ...ordemPadrao, takeProfitPrice: 120, stopLossPrice: 90 })
  assert.equal(JSON.parse(r.result).status, 'policy_denied')
  assert.equal(f.chamadas.filter((c) => c.method === 'POST').length, 0)
})

test('cancelar e encerrar posição NUNCA são barrados por política', async () => {
  // Uma regra que impede alguém de sair de uma posição é pior do que regra nenhuma.
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 1, symbolAllowlist: ['NADA'] })
  const f = fetchFalso([{ match: '/v2/orders/', body: {} }, { match: '/v2/positions/', body: { id: 'o-9', status: 'accepted' } }])
  const lista = ferramentas(f)
  assert.equal((await acha(lista, 'alpaca_cancelar_ordem').run({ orderId: 'o-1' })).ok, true)
  assert.equal((await acha(lista, 'alpaca_fechar_posicao').run({ symbol: 'AAPL' })).ok, true)
})

test('a leitura não é barrada por política de ordem', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 1 })
  const r = await acha(ferramentas(fetchFalso([CONTA])), 'alpaca_conta').run({})
  assert.equal(r.ok, true)
})

// --- só busca o que precisa ---------------------------------------------------------------

test('uma regra que não precisa de saldo não consulta saldo', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 100 })
  const f = fetchFalso([COTACAO, ORDEM_OK])
  await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)
  assert.equal(f.chamadas.filter((c) => c.url.includes('/v2/account')).length, 0)
  assert.equal(f.chamadas.filter((c) => c.url.includes('/v2/positions')).length, 0)
})

test('a regra de carteira consulta o saldo e mede contra ele', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxPortfolioPercent: 5 })
  const f = fetchFalso([COTACAO, CONTA, ORDEM_OK])
  const r = await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)
  // 10 × 100 = 1000, que é 10% de 10000.
  assert.equal(JSON.parse(r.result).violations[0].code, 'max_portfolio_percent')
  assert.ok(f.chamadas.some((c) => c.url.includes('/v2/account')))
})

test('a cotação que falha não libera o limite de valor', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxOrderValue: 1000 })
  const f = fetchFalso([{ match: '/quotes/latest', status: 500, body: {} }, ORDEM_OK])
  const r = await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)
  assert.equal(JSON.parse(r.result).status, 'policy_denied')
  assert.equal(f.chamadas.filter((c) => c.method === 'POST').length, 0)
})

test('numa ordem limitada o preço é o limite, sem consultar cotação', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxOrderValue: 1000 })
  const f = fetchFalso([ORDEM_OK])
  const r = await acha(ferramentas(f), 'alpaca_criar_ordem').run({ ...ordemPadrao, type: 'limit', limitPrice: 50 })
  assert.equal(r.ok, true, '10 × 50 = 500, dentro do limite')
  assert.equal(f.chamadas.filter((c) => c.url.includes('quotes')).length, 0)
})

// --- o teto do dia conta o que saiu -----------------------------------------------------------

test('o teto diário conta as ordens executadas hoje nesta conexão', async () => {
  const hoje = new Date()
  for (let i = 0; i < 2; i += 1) {
    await db.collection('app_action_events').insertOne({
      ownerId: DONO,
      agentId: null,
      appKey: 'alpaca',
      actionKey: 'alpaca_criar_ordem',
      installationId: CONEXAO,
      ok: true,
      status: 'executed',
      durationMs: 10,
      createdAt: hoje,
    })
  }
  assert.equal(await countActionsSince(DONO, CONEXAO, ORDER_ACTION_KEYS, new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()))), 2)

  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxOrdersPerDay: 2 })
  const f = fetchFalso([COTACAO, ORDEM_OK])
  const r = await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)
  assert.equal(JSON.parse(r.result).violations[0].code, 'max_orders_per_day')
})

test('uma ordem recusada não conta contra o teto do dia', async () => {
  // Ela não gastou nada e não saiu daqui.
  await db.collection('app_action_events').insertOne({
    ownerId: DONO,
    agentId: null,
    appKey: 'alpaca',
    actionKey: 'alpaca_criar_ordem',
    installationId: CONEXAO,
    ok: false,
    status: 'refused',
    durationMs: 1,
    createdAt: new Date(),
  })
  const inicio = new Date(Date.now() - 3_600_000)
  assert.equal(await countActionsSince(DONO, CONEXAO, ORDER_ACTION_KEYS, inicio), 0)
})

// --- escopo -------------------------------------------------------------------------------------

test('a política de outra conta não alcança esta', async () => {
  await savePolicy({ ownerId: VIZINHO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 1 })
  const f = fetchFalso([COTACAO, ORDEM_OK])
  assert.equal((await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)).ok, true)
})

test('a política de outra conexão não vale para esta — simulação e produção não se misturam', async () => {
  await savePolicy({ ownerId: DONO, installationId: OUTRA_CONEXAO.toString(), agentId: null }, { maxQuantity: 1 })
  const f = fetchFalso([COTACAO, ORDEM_OK])
  assert.equal((await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)).ok, true)
})

test('a política do agente ganha da política da conexão', async () => {
  // Não é união nem interseção: é a mais específica. Somar regras de dois lugares
  // produziria um resultado que ninguém configurou.
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 1 })
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: AGENTE.toString() }, { maxQuantity: 50 })
  const f = fetchFalso([COTACAO, ORDEM_OK])
  const r = await acha(ferramentas(f, contexto({ agentId: AGENTE.toString() })), 'alpaca_criar_ordem').run(ordemPadrao)
  assert.equal(r.ok, true)
  // E o agente sem política própria continua sob a da conexão.
  const g = fetchFalso([COTACAO, ORDEM_OK])
  assert.equal((await acha(ferramentas(g), 'alpaca_criar_ordem').run(ordemPadrao)).ok, false)
})

// --- versionamento -------------------------------------------------------------------------------

test('salvar cria uma versão nova e só a última vale', async () => {
  const scope = { ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }
  const v1 = await savePolicy(scope, { maxQuantity: 1 })
  const v2 = await savePolicy(scope, { maxQuantity: 100 })
  assert.equal(v1.version, 1)
  assert.equal(v2.version, 2)
  const ativa = await activePolicyFor(scope)
  assert.equal(ativa.version, 2)
  // A anterior FICA: "por que essa ordem passou em março" tem que ter resposta.
  const historico = await policyHistory(DONO, CONEXAO.toString(), null)
  assert.equal(historico.length, 2)
  assert.equal(historico.filter((p) => p.active).length, 1)
})

// --- saneamento ---------------------------------------------------------------------------------

test('valor inválido vira ausência de limite, não um limite quebrado', async () => {
  const regras = normalizeRules({ maxQuantity: 'muitas', maxOrderValue: -5, maxDailyLoss: 0, requireStopLoss: 'sim', symbolAllowlist: [' aapl ', 'AAPL', ''] })
  assert.equal(regras.maxQuantity, undefined)
  assert.equal(regras.maxOrderValue, undefined)
  assert.equal(regras.maxDailyLoss, undefined)
  assert.equal(regras.requireStopLoss, undefined, 'só `true` liga uma trava')
  assert.deepEqual(regras.symbolAllowlist, ['AAPL'])
})

test('uma janela de horário sem fuso ou malformada é recusada na gravação', () => {
  assert.throws(() => normalizeRules({ tradingHours: { start: '10:00', end: '17:00' } }), ValidationError)
  assert.throws(() => normalizeRules({ tradingHours: { start: 'dez', end: '17:00', timezone: 'UTC' } }), ValidationError)
  assert.throws(() => normalizeRules({ tradingHours: { start: '10:00', end: '17:00', timezone: 'Marte/Olimpo' } }), /fuso/)
  assert.throws(() => normalizeRules({ maxPortfolioPercent: 150 }), /100/)
  const ok = normalizeRules({ tradingHours: { start: '10:00', end: '17:00', timezone: 'America/Sao_Paulo', days: [1, 2, 3, 4, 5, 9] } })
  assert.deepEqual(ok.tradingHours.days, [1, 2, 3, 4, 5])
})

// --- guardOrder direto ------------------------------------------------------------------------------

test('guardOrder devolve o veredito quando deixa passar, e lança quando barra', async () => {
  const scope = { ownerId: DONO, installationId: CONEXAO.toString(), agentId: null, environment: 'paper' }
  const intent = { symbol: 'AAPL', side: 'buy', quantity: 10, type: 'market', estimatedPrice: 100 }
  // Sem política: passa, e o veredito diz que nada foi avaliado.
  const livre = await guardOrder(scope, intent)
  assert.equal(livre.allowed, true)
  assert.deepEqual(livre.evaluated, [])

  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 5 })
  await assert.rejects(() => guardOrder(scope, intent), (e) => e instanceof PolicyDenied && e.environment === 'paper')
})
