// A ALPACA, sem falar com a Alpaca.
//
// Nenhuma prova aqui abre conexão: o `fetch` é injetado e devolve fixture. Isto não é
// só higiene de teste — é a regra. Uma suíte que fala com uma corretora de verdade é
// uma suíte que um dia manda uma ordem de verdade.
//
// O que está sendo fixado: produção não tem endereço, a credencial não sai em nenhum
// texto, o erro da corretora vira vocabulário de dentro, e ordem é sempre `high_risk`.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { buildAlpacaTools } = await import('../dist/apps/official/alpaca/adapter.js')
const { createAlpacaClient, tradingBaseFor, translateStatus, scrub, AlpacaError } = await import('../dist/apps/official/alpaca/client.js')
const { alpacaStreamAdapter } = await import('../dist/apps/official/alpaca/stream.js')
const { manifest } = await import('../dist/apps/official/alpaca/manifest.js')

const CRED = { keyId: 'PKTESTE0000000000000', secretKey: 'segredo-de-teste-que-nao-existe' }

/** Um `fetch` que grava o que foi pedido e devolve o que o teste mandou. */
function fetchFalso(respostas) {
  const chamadas = []
  const impl = async (url, init = {}) => {
    chamadas.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers, body: init.body ? JSON.parse(init.body) : null })
    const r = respostas.shift() ?? { status: 200, body: {} }
    return {
      ok: r.status < 400,
      status: r.status,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    }
  }
  impl.chamadas = chamadas
  return impl
}

const ferramentas = (fetchImpl, environment = 'paper') => buildAlpacaTools(CRED, environment, { fetch: fetchImpl })
const acha = (lista, nome) => lista.find((t) => t.name === nome)

// --- produção não existe -------------------------------------------------------------

test('não há endereço de produção compilado', () => {
  assert.equal(tradingBaseFor('paper'), 'https://paper-api.alpaca.markets')
  assert.equal(tradingBaseFor('default'), 'https://paper-api.alpaca.markets')
  // Não é uma verificação que alguém pode esquecer de chamar: não existe URL para onde
  // mandar. Ligar produção é decisão de produto, e ela não foi tomada.
  assert.throws(() => tradingBaseFor('live'), /não está liberado/)
})

test('em produção não se monta ferramenta nenhuma', () => {
  // A tranca mais forte possível: não há o que chamar.
  assert.deepEqual(ferramentas(fetchFalso([]), 'live'), [])
})

test('sem credencial não se monta ferramenta nenhuma', () => {
  assert.deepEqual(buildAlpacaTools({}, 'paper'), [])
  assert.deepEqual(buildAlpacaTools({ keyId: 'x' }, 'paper'), [])
})

// --- a credencial não sai ---------------------------------------------------------------

test('a credencial vai no cabeçalho e não aparece em nenhum resultado', async () => {
  const f = fetchFalso([{ status: 200, body: { account_number: '123', status: 'ACTIVE', currency: 'USD', equity: '1000', buying_power: '2000', cash: '1000' } }])
  const r = await acha(ferramentas(f), 'alpaca_conta').run({})
  assert.equal(r.ok, true)
  assert.ok(!r.result.includes(CRED.secretKey))
  assert.ok(!r.result.includes(CRED.keyId))
  // Ela existe onde precisa existir: no cabeçalho da chamada.
  assert.equal(f.chamadas[0].headers['APCA-API-KEY-ID'], CRED.keyId)
  assert.equal(f.chamadas[0].headers['APCA-API-SECRET-KEY'], CRED.secretKey)
})

test('um erro que ecoa a credencial é riscado antes de virar resultado', async () => {
  // Acontece de verdade: um 401 costuma vir com a chave que o causou junto, e esse
  // texto iria para o resultado da ferramenta — que o modelo lê e o trace guarda.
  const f = fetchFalso([{ status: 401, body: `invalid key ${CRED.keyId} with secret ${CRED.secretKey}` }])
  const r = await acha(ferramentas(f), 'alpaca_conta').run({})
  assert.equal(r.ok, false)
  assert.ok(!r.result.includes(CRED.secretKey))
  assert.ok(!r.result.includes(CRED.keyId))
  assert.match(r.result, /credencial/)
})

test('scrub risca as duas chaves, e não risca texto legítimo curto', () => {
  assert.equal(scrub(`erro com ${CRED.secretKey}`, CRED), 'erro com ***')
  assert.equal(scrub('conta em usd', CRED), 'conta em usd')
})

// --- tradução de erro ---------------------------------------------------------------------

test('o número HTTP vira o que fazer, e não o que aconteceu', () => {
  // Quem lê não precisa do código: precisa saber se reconecta, espera, corrige ou desiste.
  assert.equal(translateStatus(401, '').kind, 'auth')
  assert.equal(translateStatus(403, '').kind, 'auth')
  assert.equal(translateStatus(429, '').kind, 'rate_limit')
  assert.equal(translateStatus(422, 'insufficient buying power').kind, 'refused')
  assert.match(translateStatus(422, 'insufficient buying power').message, /insufficient buying power/)
  assert.equal(translateStatus(500, '').kind, 'unavailable')
  assert.equal(translateStatus(503, '').kind, 'unavailable')
})

test('o limite de chamadas chega como limite, e não como falha genérica', async () => {
  const f = fetchFalso([{ status: 429, body: 'too many requests' }])
  const r = await acha(ferramentas(f), 'alpaca_conta').run({})
  assert.equal(r.ok, false)
  assert.match(r.result, /rate_limit/)
})

test('a corretora fora do ar não vira exceção crua', async () => {
  const quebrado = async () => {
    throw new Error('ECONNRESET')
  }
  const r = await acha(ferramentas(quebrado), 'alpaca_conta').run({})
  assert.equal(r.ok, false)
  assert.match(r.result, /network/)
})

// --- os contratos de saída -------------------------------------------------------------

test('a conta sai no contrato de dentro, com números como números', async () => {
  const f = fetchFalso([
    { status: 200, body: { account_number: 'PA123', status: 'ACTIVE', currency: 'USD', equity: '10500.25', cash: '500.10', buying_power: '21000.50', trading_blocked: false } },
  ])
  const r = JSON.parse((await acha(ferramentas(f), 'alpaca_conta').run({})).result)
  // Na Alpaca é string; quem consome não deveria precisar saber disso.
  assert.equal(r.equity, 10500.25)
  assert.equal(r.buyingPower, 21000.5)
  assert.equal(r.tradingBlocked, false)
})

test('as velas saem no mesmo formato que o App de análise recebe', async () => {
  const f = fetchFalso([
    { status: 200, body: { bars: [{ t: '2026-04-06T13:00:00Z', o: 10, h: 12, l: 9, c: 11, v: 1000 }] } },
  ])
  const r = JSON.parse((await acha(ferramentas(f), 'alpaca_barras').run({ symbol: 'aapl', timeframe: '5Min' })).result)
  assert.deepEqual(r[0], { timestamp: Date.parse('2026-04-06T13:00:00Z'), open: 10, high: 12, low: 9, close: 11, volume: 1000, closed: true })
  // Símbolo normalizado, e o timeframe pedido vai na query.
  assert.match(f.chamadas[0].url, /stocks\/AAPL\/bars/)
  assert.match(f.chamadas[0].url, /timeframe=5Min/)
})

// --- ordens ------------------------------------------------------------------------------

test('toda ação que mexe em ordem ou posição é high_risk', () => {
  const perigosas = ['alpaca_criar_ordem', 'alpaca_ordem_bracket', 'alpaca_cancelar_ordem', 'alpaca_substituir_ordem', 'alpaca_fechar_posicao']
  for (const key of perigosas) {
    assert.equal(manifest.actions.find((a) => a.key === key)?.risk, 'high_risk', key)
    assert.equal(acha(ferramentas(fetchFalso([])), key).risk, 'high_risk', key)
  }
  // E consulta é consulta: roda sozinha, sem autorização extra.
  for (const key of ['alpaca_conta', 'alpaca_posicoes', 'alpaca_ordens', 'alpaca_cotacao', 'alpaca_barras']) {
    assert.equal(manifest.actions.find((a) => a.key === key)?.risk, 'read', key)
  }
})

test('a ordem é montada no formato da corretora', async () => {
  const f = fetchFalso([{ status: 200, body: { id: 'o-1', symbol: 'AAPL', side: 'buy', type: 'limit', qty: '10', status: 'accepted' } }])
  const r = JSON.parse((await acha(ferramentas(f), 'alpaca_criar_ordem').run({ symbol: 'aapl', side: 'BUY', quantity: 10, type: 'limit', limitPrice: 150.5 })).result)
  assert.equal(r.id, 'o-1')
  assert.deepEqual(f.chamadas[0].body, { symbol: 'AAPL', side: 'buy', qty: '10', type: 'limit', time_in_force: 'day', limit_price: '150.5' })
  assert.equal(f.chamadas[0].method, 'POST')
  assert.match(f.chamadas[0].url, /paper-api\.alpaca\.markets/)
})

test('uma ordem malformada é recusada aqui, sem gastar uma ida à corretora', async () => {
  const f = fetchFalso([])
  const ordem = acha(ferramentas(f), 'alpaca_criar_ordem')
  for (const args of [{ side: 'buy', quantity: 1 }, { symbol: 'AAPL', side: 'talvez', quantity: 1 }, { symbol: 'AAPL', side: 'buy', quantity: 0 }, { symbol: 'AAPL', side: 'buy', quantity: 1, type: 'limit' }]) {
    const r = await ordem.run(args)
    assert.equal(r.ok, false)
  }
  assert.equal(f.chamadas.length, 0, 'nenhuma chamada saiu')
})

test('bracket sem uma das pernas não é bracket', async () => {
  const f = fetchFalso([])
  const r = await acha(ferramentas(f), 'alpaca_ordem_bracket').run({ symbol: 'AAPL', side: 'buy', quantity: 1, takeProfitPrice: 200 })
  assert.equal(r.ok, false)
  // Uma ordem solta com a falsa sensação de ter proteção é pior do que uma ordem solta.
  assert.match(r.result, /take-profit E do stop-loss/)
  assert.equal(f.chamadas.length, 0)
})

test('o bracket leva entrada, stop e alvo numa ordem só', async () => {
  const f = fetchFalso([{ status: 200, body: { id: 'o-2', symbol: 'AAPL', status: 'accepted' } }])
  await acha(ferramentas(f), 'alpaca_ordem_bracket').run({ symbol: 'AAPL', side: 'buy', quantity: 2, takeProfitPrice: 210, stopLossPrice: 190 })
  assert.deepEqual(f.chamadas[0].body, {
    symbol: 'AAPL',
    side: 'buy',
    qty: '2',
    type: 'market',
    time_in_force: 'gtc',
    order_class: 'bracket',
    take_profit: { limit_price: '210' },
    stop_loss: { stop_price: '190' },
  })
})

test('cancelar e substituir usam o método certo e exigem o id', async () => {
  const f = fetchFalso([{ status: 200, body: {} }, { status: 200, body: { id: 'o-3', status: 'replaced' } }])
  const lista = ferramentas(f)
  assert.equal((await acha(lista, 'alpaca_cancelar_ordem').run({})).ok, false)
  await acha(lista, 'alpaca_cancelar_ordem').run({ orderId: 'o-3' })
  assert.equal(f.chamadas[0].method, 'DELETE')
  await acha(lista, 'alpaca_substituir_ordem').run({ orderId: 'o-3', quantity: 5 })
  assert.equal(f.chamadas[1].method, 'PATCH')
  assert.deepEqual(f.chamadas[1].body, { qty: '5' })
})

test('substituir sem dizer o que muda é recusado', async () => {
  const f = fetchFalso([])
  const r = await acha(ferramentas(f), 'alpaca_substituir_ordem').run({ orderId: 'o-3' })
  assert.equal(r.ok, false)
  assert.equal(f.chamadas.length, 0)
})

test('a recusa da corretora chega inteira, para dar para corrigir', async () => {
  const f = fetchFalso([{ status: 422, body: 'insufficient buying power' }])
  const r = await acha(ferramentas(f), 'alpaca_criar_ordem').run({ symbol: 'AAPL', side: 'buy', quantity: 1000 })
  assert.equal(r.ok, false)
  assert.match(r.result, /insufficient buying power/)
})

// --- o stream ------------------------------------------------------------------------------

const ctx = { ownerId: 'o1', streamId: 's1', installationId: 'i1', environment: 'paper', source: 'alpaca:paper' }

test('o quadro de negócio vira evento de preço; o de controle não vira nada', () => {
  const eventos = alpacaStreamAdapter.parse([{ T: 't', S: 'AAPL', p: 190.25, s: 100, t: '2026-04-06T13:00:00Z', i: 77 }], ctx)
  assert.equal(eventos.length, 1)
  assert.equal(eventos[0].type, 'market.price.updated')
  assert.equal(eventos[0].payload.price, 190.25)
  assert.equal(eventos[0].payload.provider, 'alpaca')
  assert.equal(eventos[0].dedupeKey, 'alpaca:i1:AAPL:77')

  for (const controle of [[{ T: 'success', msg: 'authenticated' }], [{ T: 'subscription', trades: ['AAPL'] }], 'texto', null]) {
    assert.deepEqual(alpacaStreamAdapter.parse(controle, ctx), [])
  }
})

test('um negócio sem preço ou sem hora é descartado, não vira preço zero', () => {
  assert.deepEqual(alpacaStreamAdapter.parse([{ T: 't', S: 'AAPL', t: '2026-04-06T13:00:00Z' }], ctx), [])
  assert.deepEqual(alpacaStreamAdapter.parse([{ T: 't', S: 'AAPL', p: 10, t: 'ontem' }], ctx), [])
})

test('o erro do stream é reconhecido, em vez de virar silêncio', () => {
  assert.match(alpacaStreamAdapter.errorOf([{ T: 'error', code: 402, msg: 'auth failed' }]), /auth failed/)
  assert.equal(alpacaStreamAdapter.errorOf([{ T: 't', S: 'AAPL' }]), null)
})

test('a autenticação do stream é uma mensagem, e o subscribe pede os negócios', () => {
  const auth = alpacaStreamAdapter.authMessage(CRED)
  assert.deepEqual(auth, { action: 'auth', key: CRED.keyId, secret: CRED.secretKey })
  assert.deepEqual(alpacaStreamAdapter.subscribeMessage(['AAPL', 'MSFT']), { action: 'subscribe', trades: ['AAPL', 'MSFT'] })
  assert.match(alpacaStreamAdapter.url('paper'), /^wss:\/\/stream\.data\.alpaca\.markets/)
})

// --- o manifesto -----------------------------------------------------------------------------

test('o manifesto só alcança os domínios da Alpaca', () => {
  assert.deepEqual(manifest.allowedDomains, ['paper-api.alpaca.markets', 'data.alpaca.markets', 'stream.data.alpaca.markets'])
  // O endereço de produção não está na lista: mesmo que algum caminho tentasse montá-lo,
  // o App não teria permissão de alcançá-lo.
  assert.ok(!manifest.allowedDomains.includes('api.alpaca.markets'))
})

test('o nome diz que é simulação, porque a consequência de confundir é dinheiro', () => {
  assert.match(manifest.name, /simula/i)
  assert.ok(manifest.dataAccess.some((d) => /simula/i.test(d)))
})

test('as duas credenciais são secretas', () => {
  assert.equal(manifest.auth.fields.length, 2)
  assert.ok(manifest.auth.fields.every((f) => f.secret === true && f.required === true))
})

test('uma conexão nova da Alpaca nasce marcada como simulação', () => {
  // Sem isto ela nasceria "default", ficaria com cara de produção na tela, e o selo —
  // que é a única defesa contra confundir as duas — nunca apareceria.
  assert.equal(manifest.defaultEnvironment, 'paper')
})
