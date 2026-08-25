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
// A chave que o `crypto.ts` lê de verdade. Antes daqui estes testes definiam
// `APP_ENCRYPTION_KEY`, que não existe em lugar nenhum: eles passavam porque o `.env`
// de quem desenvolve tem a chave real, e falhavam no CI, que não tem `.env`.
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { buildAlpacaTools, ORDER_ACTION_KEYS } = await import('../dist/apps/official/alpaca/adapter.js')
const { savePolicy, activePolicyFor, normalizeRules, ensurePolicyIndexes, policyHistory, PolicyFieldError } = await import(
  '../dist/policies/repository.js'
)
const { guardOrder, PolicyDenied } = await import('../dist/policies/guard.js')
const { ensureAppActionIndexes, countActionsSince } = await import('../dist/apps/actionEvents.js')
const { ValidationError } = await import('../dist/building.js')
const { encrypt } = await import('../dist/crypto.js')
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

/**
 * Funções, e não constantes.
 *
 * `fetchFalso` MARCA a resposta como usada — uma constante compartilhada entre testes
 * chega gasta no segundo, e a chamada cai no padrão vazio. O sintoma é sempre o mesmo e
 * nunca aponta para a causa: "a ordem não tem id".
 */
const ordemOk = () => ({ match: '/v2/orders', body: { id: 'o-1', symbol: 'AAPL', status: 'accepted', qty: '10' } })
const cotacao = () => ({ match: '/quotes/latest', body: { quote: { ap: 100, bp: 99.9 } } })
const conta = () => ({ match: '/v2/account', body: { equity: '10000', last_equity: '10000' } })
const semOrdemAnterior = () => ({ match: 'by_client_order_id', status: 404, body: {} })
const POSICOES = (lista = []) => ({ match: '/v2/positions', body: lista })

const contexto = (over = {}) => ({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null, ...over })

const ferramentas = (f, ctx = contexto()) => buildAlpacaTools(CRED, 'paper', { fetch: f }, ctx)
const acha = (lista, nome) => lista.find((t) => t.name === nome)

const ordemPadrao = { symbol: 'AAPL', side: 'buy', quantity: 10 }

// --- a ordem não sai -------------------------------------------------------------------

test('sem política, a ordem sai como sempre saiu', async () => {
  const f = fetchFalso([cotacao(), ordemOk()])
  const r = await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)
  assert.equal(r.ok, true)
  assert.ok(f.chamadas.some((c) => c.method === 'POST'))
})

test('a política barra e NENHUMA chamada de ordem sai', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 5 })
  const f = fetchFalso([cotacao(), ordemOk()])
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
  const r = await acha(ferramentas(fetchFalso([cotacao()])), 'alpaca_criar_ordem').run(ordemPadrao)
  assert.equal(JSON.parse(r.result).environment, 'paper')
})

test('o bracket também passa pela porteira', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { symbolAllowlist: ['MSFT'] })
  const f = fetchFalso([cotacao(), ordemOk()])
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
  const r = await acha(ferramentas(fetchFalso([conta()])), 'alpaca_conta').run({})
  assert.equal(r.ok, true)
})

// --- só busca o que precisa ---------------------------------------------------------------

test('uma regra que não precisa de saldo não consulta saldo', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 100 })
  const f = fetchFalso([cotacao(), ordemOk()])
  await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)
  assert.equal(f.chamadas.filter((c) => c.url.includes('/v2/account')).length, 0)
  assert.equal(f.chamadas.filter((c) => c.url.includes('/v2/positions')).length, 0)
})

test('a regra de carteira consulta o saldo e mede contra ele', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxPortfolioPercent: 5 })
  const f = fetchFalso([cotacao(), conta(), ordemOk()])
  const r = await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)
  // 10 × 100 = 1000, que é 10% de 10000.
  assert.equal(JSON.parse(r.result).violations[0].code, 'max_portfolio_percent')
  assert.ok(f.chamadas.some((c) => c.url.includes('/v2/account')))
})

test('a cotação que falha não libera o limite de valor', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxOrderValue: 1000 })
  const f = fetchFalso([{ match: '/quotes/latest', status: 500, body: {} }, ordemOk()])
  const r = await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)
  assert.equal(JSON.parse(r.result).status, 'policy_denied')
  assert.equal(f.chamadas.filter((c) => c.method === 'POST').length, 0)
})

test('numa ordem limitada o preço é o limite, sem consultar cotação', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxOrderValue: 1000 })
  const f = fetchFalso([ordemOk()])
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
      // Só ordem CONFIRMADA conta: é o `orderId` que prova que a corretora aceitou.
      orderId: `o-${i}`,
      createdAt: hoje,
    })
  }
  assert.equal(await countActionsSince(DONO, CONEXAO, ORDER_ACTION_KEYS, new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()))), 2)

  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxOrdersPerDay: 2 })
  const f = fetchFalso([cotacao(), ordemOk()])
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
  const f = fetchFalso([cotacao(), ordemOk()])
  assert.equal((await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)).ok, true)
})

test('a política de outra conexão não vale para esta — simulação e produção não se misturam', async () => {
  await savePolicy({ ownerId: DONO, installationId: OUTRA_CONEXAO.toString(), agentId: null }, { maxQuantity: 1 })
  const f = fetchFalso([cotacao(), ordemOk()])
  assert.equal((await acha(ferramentas(f), 'alpaca_criar_ordem').run(ordemPadrao)).ok, true)
})

test('a política do agente ganha da política da conexão', async () => {
  // Não é união nem interseção: é a mais específica. Somar regras de dois lugares
  // produziria um resultado que ninguém configurou.
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 1 })
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: AGENTE.toString() }, { maxQuantity: 50 })
  const f = fetchFalso([cotacao(), ordemOk()])
  const r = await acha(ferramentas(f, contexto({ agentId: AGENTE.toString() })), 'alpaca_criar_ordem').run(ordemPadrao)
  assert.equal(r.ok, true)
  // E o agente sem política própria continua sob a da conexão.
  const g = fetchFalso([cotacao(), ordemOk()])
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

test('valor inválido é RECUSADO com o campo, e nunca vira "sem limite"', async () => {
  // O comportamento antigo era o pior possível para uma trava: quem digitava `-5` ou
  // `abc` achava que tinha apertado a regra, e na verdade tinha desligado.
  const casos = [
    [{ maxQuantity: 'muitas' }, 'maxQuantity', /número/],
    [{ maxOrderValue: -5 }, 'maxOrderValue', /maior que zero/],
    [{ maxDailyLoss: 0 }, 'maxDailyLoss', /maior que zero/],
    [{ maxPortfolioPercent: 150 }, 'maxPortfolioPercent', /não pode passar de 100/],
    [{ maxOrdersPerDay: 99999 }, 'maxOrdersPerDay', /não pode passar/],
    [{ requireStopLoss: 'sim' }, 'requireStopLoss', /ligado ou desligado/],
    [{ symbolAllowlist: 'AAPL' }, 'symbolAllowlist', /lista/],
  ]
  for (const [regras, campo, mensagem] of casos) {
    assert.throws(
      () => normalizeRules(regras),
      (e) => e instanceof PolicyFieldError && e.field === campo && mensagem.test(e.message),
      `${campo} deveria ser recusado`,
    )
  }
  // Em branco continua sendo "sem esta regra" — é assim que se desliga uma trava.
  assert.deepEqual(normalizeRules({ maxQuantity: '', maxOrderValue: null }), {})
  assert.deepEqual(normalizeRules({ symbolAllowlist: [' aapl ', 'AAPL', ''] }).symbolAllowlist, ['AAPL'])
})

test('uma janela de horário malformada é recusada com o campo certo', () => {
  const casos = [
    [{ start: '10:00', end: '17:00' }, 'tradingHours.timezone'],
    [{ start: 'dez', end: '17:00', timezone: 'UTC' }, 'tradingHours.start'],
    [{ start: '10:00', end: 'cinco', timezone: 'UTC' }, 'tradingHours.end'],
    [{ start: '10:00', end: '17:00', timezone: 'Marte/Olimpo' }, 'tradingHours.timezone'],
    [{ start: '10:00', end: '17:00', timezone: 'UTC', days: [1, 9] }, 'tradingHours.days'],
  ]
  for (const [janela, campo] of casos) {
    assert.throws(() => normalizeRules({ tradingHours: janela }), (e) => e instanceof PolicyFieldError && e.field === campo, campo)
  }
  const ok = normalizeRules({ tradingHours: { start: '10:00', end: '17:00', timezone: 'America/Sao_Paulo', days: [1, 2, 3, 4, 5] } })
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

// --- alterar ordem também passa pela porteira ---------------------------------------------

// Função, e não constante: `fetchFalso` MARCA a resposta como usada, então uma
// constante compartilhada chegaria gasta no segundo teste.
const ordemAtual = () => ({ match: '/v2/orders/', body: { id: 'o-1', symbol: 'AAPL', side: 'buy', type: 'limit', qty: '10', limit_price: '100' } })

test('aumentar a quantidade de uma ordem aberta passa pela política', async () => {
  // Sem isto o teto era contornável em dois passos: mandar o mínimo, e depois alterar
  // para o dobro.
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 10 })
  const f = fetchFalso([ordemAtual(), { match: '/v2/orders/', body: { id: 'o-1', status: 'replaced' } }])
  const r = await acha(ferramentas(f), 'alpaca_substituir_ordem').run({ orderId: 'o-1', quantity: 50 })
  assert.equal(JSON.parse(r.result).status, 'policy_denied')
  assert.equal(f.chamadas.filter((c) => c.method === 'PATCH').length, 0, 'o PATCH não saiu')
})

test('aumentar o preço limite também passa pela política', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxOrderValue: 1500 })
  const f = fetchFalso([ordemAtual(), { match: '/v2/orders/', body: { id: 'o-1', status: 'replaced' } }])
  // 10 × 300 = 3000, acima do teto.
  const r = await acha(ferramentas(f), 'alpaca_substituir_ordem').run({ orderId: 'o-1', limitPrice: 300 })
  assert.equal(JSON.parse(r.result).status, 'policy_denied')
  assert.equal(f.chamadas.filter((c) => c.method === 'PATCH').length, 0)
})

test('REDUZIR uma ordem continua livre, mesmo com política apertada', async () => {
  // Uma regra que impede diminuir posição é uma regra que prende alguém dentro dela.
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 1 })
  const f = fetchFalso([ordemAtual(), { match: '/v2/orders/', body: { id: 'o-1', status: 'replaced' } }])
  const r = await acha(ferramentas(f), 'alpaca_substituir_ordem').run({ orderId: 'o-1', quantity: 5 })
  assert.equal(r.ok, true)
  assert.equal(f.chamadas.filter((c) => c.method === 'PATCH').length, 1)
})

// --- a chave da ordem é derivada, não sorteada ---------------------------------------------

test('a mesma etapa tentando de novo produz a MESMA chave de ordem', async () => {
  const { clientOrderId } = await import('../dist/apps/official/alpaca/adapter.js')
  const corpo = { symbol: 'AAPL', side: 'buy', qty: '10', type: 'market' }
  const a = clientOrderId('run:r1:acao', corpo)
  const b = clientOrderId('run:r1:acao', { ...corpo })
  assert.equal(a, b, 'com chave nova a cada tentativa, um retry manda a segunda ordem')
  // Ordem diferente na mesma etapa é outra ordem.
  assert.notEqual(a, clientOrderId('run:r1:acao', { ...corpo, qty: '20' }))
  // Etapa diferente é outra ordem.
  assert.notEqual(a, clientOrderId('run:r1:outra', corpo))
  // Sem execução (playground, chamada direta) não há o que derivar: volta a ser sorteada.
  assert.notEqual(clientOrderId(null, corpo), clientOrderId(null, corpo))
})

test('a ordem é procurada ANTES de ser mandada quando há execução', async () => {
  // Uma tentativa anterior pode ter chegado e a resposta ter se perdido. Perguntar
  // primeiro custa uma leitura e evita a falha que não dá para desfazer.
  const f = fetchFalso([
    { match: 'by_client_order_id', body: { id: 'o-ja-existe', symbol: 'AAPL', status: 'accepted' } },
  ])
  const ctx = { ...contexto(), executionRef: 'run:r1:acao' }
  const r = await acha(ferramentas(f, ctx), 'alpaca_criar_ordem').run({ symbol: 'AAPL', side: 'buy', quantity: 1, type: 'limit', limitPrice: 10 })
  assert.equal(JSON.parse(r.result).id, 'o-ja-existe')
  assert.equal(f.chamadas.filter((c) => c.method === 'POST').length, 0, 'nenhuma segunda ordem saiu')
})

test('sem execução, não há chave para perguntar — e nada é consultado antes', async () => {
  const f = fetchFalso([{ match: '/v2/orders', body: { id: 'o-1', status: 'accepted' } }])
  const r = await acha(ferramentas(f), 'alpaca_criar_ordem').run({ symbol: 'AAPL', side: 'buy', quantity: 1, type: 'limit', limitPrice: 10 })
  assert.equal(r.ok, true)
  assert.equal(f.chamadas.filter((c) => c.url.includes('by_client_order_id')).length, 0)
})

// --- auditoria: o que fica registrado, e o que nunca fica -------------------------------

/**
 * Troca o `fetch` global ANTES de montar a ferramenta.
 *
 * O cliente da Alpaca guarda a função no momento em que é criado — e ele é criado
 * dentro de `resolveGrant`. Trocar depois não teria efeito nenhum, e o teste falharia
 * dizendo "a ordem não saiu" por um motivo que não tem nada a ver com o que ele testa.
 */
async function comFetch(f, trabalho) {
  const original = globalThis.fetch
  globalThis.fetch = f
  try {
    return await trabalho()
  } finally {
    globalThis.fetch = original
  }
}

/** A ferramenta instrumentada — o mesmo caminho do modelo e da automação. */
async function comGrant(actionKeys = ['alpaca_criar_ordem'], autonomas = ['alpaca_criar_ordem']) {
  const { resolveGrant } = await import('../dist/apps/grants.js')
  const { getApp } = await import('../dist/apps/registry.js')
  const app = getApp('alpaca')
  await db.collection('connections').deleteMany({ _id: CONEXAO })
  await db.collection('connections').insertOne({
    _id: CONEXAO,
    ownerId: DONO,
    appKey: 'alpaca',
    appVersion: app.version,
    name: 'Alpaca',
    status: 'connected',
    encryptedConfig: encrypt(JSON.stringify(CRED)),
    environment: 'paper',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.collection('agents').deleteMany({ _id: AGENTE })
  await db.collection('agents').insertOne({ _id: AGENTE, ownerId: DONO, name: 'Ana', objective: 'x', officeId: new ObjectId(), activationModes: [] })
  return resolveGrant(
    DONO,
    { appKey: 'alpaca', installationId: CONEXAO.toString(), actionKeys, resourceConfig: {}, autonomousWriteActionKeys: autonomas },
    { agentId: AGENTE, executionRef: 'run:r-audit:acao' },
  )
}

test('o registro guarda ambiente, id da ordem e o veredito da política', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 100 })
  const f = fetchFalso([cotacao(), semOrdemAnterior(), ordemOk()])
  await comFetch(f, async () => {
    const ferramentas = await comGrant()
    await ferramentas.find((t) => t.name === 'alpaca_criar_ordem').run(ordemPadrao)
  })

  const [evento] = await db.collection('app_action_events').find({ ownerId: DONO }).toArray()
  assert.ok(evento, 'a ação deixou registro')
  assert.equal(evento.environment, 'paper', 'simulação e produção não podem ficar indistinguíveis')
  assert.equal(evento.orderId, 'o-1')
  assert.equal(evento.policy.allowed, true)
  assert.deepEqual(evento.policy.evaluated, ['maxQuantity'], 'quais regras foram conferidas')
  assert.deepEqual(evento.policy.violations, [])
})

test('a recusa por política também é registrada, com o que barrou', async () => {
  await savePolicy({ ownerId: DONO, installationId: CONEXAO.toString(), agentId: null }, { maxQuantity: 1 })
  await comFetch(fetchFalso([cotacao()]), async () => {
    const ferramentas = await comGrant()
    await ferramentas.find((t) => t.name === 'alpaca_criar_ordem').run(ordemPadrao)
  })
  const [evento] = await db.collection('app_action_events').find({ ownerId: DONO }).toArray()
  assert.equal(evento.policy.allowed, false)
  assert.deepEqual(evento.policy.violations, ['max_quantity'])
  assert.equal(evento.orderId ?? null, null, 'nenhuma ordem foi criada')
})

test('o registro NÃO guarda argumento, resposta, saldo nem credencial', async () => {
  await comFetch(fetchFalso([{ match: '/v2/account', body: { status: 'ACTIVE', equity: '999999', cash: '888888', trading_blocked: false } }]), async () => {
    const ferramentas = await comGrant(['alpaca_conta'], [])
    await ferramentas.find((t) => t.name === 'alpaca_conta').run({})
  })
  const [evento] = await db.collection('app_action_events').find({ ownerId: DONO }).toArray()
  const json = JSON.stringify(evento)
  // Um registro de auditoria que guarda o payload vira o lugar mais fácil de vazar o
  // que todo o resto do sistema protege.
  for (const proibido of ['999999', '888888', CRED.secretKey, CRED.keyId]) {
    assert.ok(!json.includes(proibido), `vazou ${proibido.slice(0, 6)}… na auditoria`)
  }
  assert.equal(evento.actionKey, 'alpaca_conta')
})

test('a chave da chamada nunca chega à corretora nem ao schema da ação', async () => {
  // Ela viaja nos argumentos para o adapter poder contar o que aconteceu — e sai deles
  // antes de qualquer coisa. Se vazasse, a corretora receberia um campo inventado.
  const chamadas = []
  await comFetch(
    async (url, init = {}) => {
      chamadas.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null })
      // A consulta prévia precisa dizer "não existe": respondendo com uma ordem, o
      // adapter acha que a dela já saiu e não manda nada — e o teste não veria o corpo.
      if (String(url).includes('by_client_order_id')) return { ok: false, status: 404, text: async () => '{}' }
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'o-1', symbol: 'AAPL', status: 'accepted' }) }
    },
    async () => {
      const ferramentas = await comGrant()
      const criar = ferramentas.find((t) => t.name === 'alpaca_criar_ordem')
      assert.equal(criar.inputSchema.properties.__actionCallId, undefined, 'o modelo nunca vê o campo')
      await criar.run({ ...ordemPadrao, type: 'limit', limitPrice: 10 })
    },
  )
  const post = chamadas.find((c) => c.body?.symbol)
  assert.ok(post, 'a ordem saiu')
  assert.equal(post.body.__actionCallId, undefined)
})
