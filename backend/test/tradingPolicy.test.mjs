// AS POLÍTICAS, uma regra por vez.
//
// Elas são a única camada em que dá para confiar: um prompt pode ser ignorado, uma
// instrução pode ser reinterpretada, e o frontend pode ser contornado por quem chama a
// API direto. Por isso a avaliação é pura e cada regra tem a sua prova — inclusive as
// bordas, que é onde uma política vira ou "barra tudo" ou "não barra nada".
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { evaluatePolicy, needsContext, withinTradingHours, minutesOfDay, looksLikeOption } = await import('../dist/policies/evaluate.js')

const AGORA = new Date('2026-05-12T17:30:00Z') // terça, 14:30 em São Paulo
const compra = (over = {}) => ({ symbol: 'AAPL', side: 'buy', quantity: 10, type: 'market', estimatedPrice: 100, ...over })
const ctx = (over = {}) => ({ now: AGORA, ...over })
const avaliar = (rules, intent = compra(), c = ctx()) => evaluatePolicy(rules, intent, c)
const codigos = (v) => v.violations.map((x) => x.code)

test('sem regra nenhuma, nada é barrado', () => {
  const v = avaliar({})
  assert.equal(v.allowed, true)
  assert.deepEqual(v.evaluated, [], 'e o veredito diz que nada foi avaliado — silêncio não é aprovação')
})

// --- valor e quantidade -----------------------------------------------------------------

test('o teto de valor usa preço vezes quantidade', () => {
  assert.equal(avaliar({ maxOrderValue: 1000 }).allowed, true, '10 × 100 = 1000, no limite')
  assert.deepEqual(codigos(avaliar({ maxOrderValue: 999 })), ['max_order_value'])
})

test('sem preço, a regra de valor BARRA em vez de deixar passar', () => {
  // Deixar passar transformaria "limite de mil" em "limite de mil, exceto quando a
  // cotação falhar" — que é justamente quando o mercado está estranho.
  const v = avaliar({ maxOrderValue: 1000 }, compra({ estimatedPrice: null }))
  assert.deepEqual(codigos(v), ['max_order_value'])
})

test('o teto de quantidade é sobre a quantidade, e o limite exato passa', () => {
  assert.equal(avaliar({ maxQuantity: 10 }).allowed, true)
  assert.deepEqual(codigos(avaliar({ maxQuantity: 9 })), ['max_quantity'])
})

test('o percentual da carteira precisa da carteira', () => {
  assert.equal(avaliar({ maxPortfolioPercent: 20 }, compra(), ctx({ equity: 10000 })).allowed, true, '1000 de 10000 = 10%')
  assert.deepEqual(codigos(avaliar({ maxPortfolioPercent: 5 }, compra(), ctx({ equity: 10000 }))), ['max_portfolio_percent'])
  // Sem patrimônio conhecido, não dá para medir — e o que não dá para medir barra.
  assert.deepEqual(codigos(avaliar({ maxPortfolioPercent: 20 })), ['max_portfolio_percent'])
})

// --- perda e frequência -------------------------------------------------------------------

test('a perda do dia é medida contra o fechamento anterior', () => {
  assert.equal(avaliar({ maxDailyLoss: 500 }, compra(), ctx({ equity: 9700, lastEquity: 10000 })).allowed, true, 'perdeu 300')
  assert.deepEqual(codigos(avaliar({ maxDailyLoss: 500 }, compra(), ctx({ equity: 9500, lastEquity: 10000 }))), ['max_daily_loss'])
  // Atingir o limite já basta: esperar passar dele é perder mais do que foi autorizado.
  assert.deepEqual(codigos(avaliar({ maxDailyLoss: 300 }, compra(), ctx({ equity: 9700, lastEquity: 10000 }))), ['max_daily_loss'])
})

test('ganhar no dia nunca barra por perda', () => {
  assert.equal(avaliar({ maxDailyLoss: 100 }, compra(), ctx({ equity: 11000, lastEquity: 10000 })).allowed, true)
})

test('o teto de operações do dia conta o que já saiu', () => {
  assert.equal(avaliar({ maxOrdersPerDay: 3 }, compra(), ctx({ ordersToday: 2 })).allowed, true)
  assert.deepEqual(codigos(avaliar({ maxOrdersPerDay: 3 }, compra(), ctx({ ordersToday: 3 }))), ['max_orders_per_day'])
})

// --- proteção obrigatória ------------------------------------------------------------------

test('stop e alvo obrigatórios barram a ordem que não os traz', () => {
  assert.deepEqual(codigos(avaliar({ requireStopLoss: true })), ['stop_loss_required'])
  assert.equal(avaliar({ requireStopLoss: true }, compra({ stopLossPrice: 90 })).allowed, true)
  assert.deepEqual(codigos(avaliar({ requireTakeProfit: true })), ['take_profit_required'])
  assert.equal(avaliar({ requireTakeProfit: true }, compra({ takeProfitPrice: 120 })).allowed, true)
})

// --- posição ---------------------------------------------------------------------------------

test('posição duplicada barra a ABERTURA, e não a saída', () => {
  const comPosicao = ctx({ positions: [{ symbol: 'AAPL', quantity: 5, side: 'long' }] })
  assert.deepEqual(codigos(avaliar({ blockDuplicatePosition: true }, compra(), comPosicao)), ['duplicate_position'])
  // Barrar a venda trancaria o dono dentro da própria posição.
  assert.equal(avaliar({ blockDuplicatePosition: true }, compra({ side: 'sell', quantity: 5 }), comPosicao).allowed, true)
  assert.equal(avaliar({ blockDuplicatePosition: true }, compra({ symbol: 'MSFT' }), comPosicao).allowed, true)
})

test('bloquear short proíbe vender mais do que se tem, não vender', () => {
  const comPosicao = ctx({ positions: [{ symbol: 'AAPL', quantity: 10, side: 'long' }] })
  assert.equal(avaliar({ blockShort: true }, compra({ side: 'sell', quantity: 10 }), comPosicao).allowed, true)
  assert.deepEqual(codigos(avaliar({ blockShort: true }, compra({ side: 'sell', quantity: 11 }), comPosicao)), ['short_blocked'])
  // Sem posição nenhuma, qualquer venda é short.
  assert.deepEqual(codigos(avaliar({ blockShort: true }, compra({ side: 'sell', quantity: 1 }))), ['short_blocked'])
})

// --- ativo ---------------------------------------------------------------------------------

test('a allowlist é exaustiva quando existe, e some quando está vazia', () => {
  assert.equal(avaliar({ symbolAllowlist: ['AAPL', 'MSFT'] }).allowed, true)
  assert.deepEqual(codigos(avaliar({ symbolAllowlist: ['MSFT'] })), ['symbol_not_allowed'])
  assert.equal(avaliar({ symbolAllowlist: [] }).allowed, true, 'lista vazia é ausência de regra, não proibição total')
  // Caixa não decide nada.
  assert.equal(avaliar({ symbolAllowlist: ['aapl'] }, compra({ symbol: 'aapl' })).allowed, true)
})

test('opção é reconhecida pela forma do símbolo', () => {
  // Consultar o provider antes de cada ordem seria uma consulta que pode falhar — e
  // liberar justamente o que devia barrar.
  assert.equal(looksLikeOption('AAPL260515C00150000'), true)
  assert.equal(looksLikeOption('AAPL'), false)
  assert.deepEqual(codigos(avaliar({ blockOptions: true }, compra({ symbol: 'AAPL260515C00150000' }))), ['options_blocked'])
  assert.equal(avaliar({ blockOptions: true }).allowed, true)
})

// --- horário -----------------------------------------------------------------------------------

const janela = (over = {}) => ({ timezone: 'America/Sao_Paulo', start: '10:00', end: '17:00', ...over })

test('a janela de horário é avaliada no fuso dela', () => {
  // 17:30 UTC é 14:30 em São Paulo — dentro. O mesmo instante é 19:30 em Berlim — fora.
  assert.equal(withinTradingHours(janela(), AGORA), true)
  assert.equal(withinTradingHours(janela({ timezone: 'Europe/Berlin' }), AGORA), false)
})

test('a janela respeita o horário de verão em vez de somar horas', () => {
  // Somar offset fixo funciona metade do ano e erra a outra metade, sempre numa semana
  // que ninguém está olhando. Em julho Nova York está em UTC-4; em janeiro, UTC-5.
  const julho = new Date('2026-07-14T13:30:00Z') // 09:30 em NY
  const janeiro = new Date('2026-01-14T13:30:00Z') // 08:30 em NY
  const pregao = { timezone: 'America/New_York', start: '09:00', end: '16:00' }
  assert.equal(withinTradingHours(pregao, julho), true)
  assert.equal(withinTradingHours(pregao, janeiro), false)
})

test('a janela pode atravessar a meia-noite', () => {
  const noturna = { timezone: 'UTC', start: '22:00', end: '02:00' }
  assert.equal(withinTradingHours(noturna, new Date('2026-05-12T23:00:00Z')), true)
  assert.equal(withinTradingHours(noturna, new Date('2026-05-12T01:00:00Z')), true)
  assert.equal(withinTradingHours(noturna, new Date('2026-05-12T12:00:00Z')), false)
})

test('os dias da semana restringem, e vazio é todos', () => {
  assert.equal(withinTradingHours(janela({ days: [2] }), AGORA), true, 'terça')
  assert.equal(withinTradingHours(janela({ days: [0, 6] }), AGORA), false, 'só fim de semana')
})

test('janela malformada barra, em vez de liberar geral', () => {
  // Uma configuração que ninguém consegue interpretar é motivo para barrar.
  assert.equal(withinTradingHours(janela({ start: 'dez horas' }), AGORA), false)
  assert.equal(withinTradingHours(janela({ timezone: 'Marte/Olimpo' }), AGORA), false)
  assert.equal(minutesOfDay('25:00'), null)
  assert.equal(minutesOfDay('10:00'), 600)
  assert.deepEqual(codigos(avaliar({ tradingHours: janela({ start: 'dez horas' }) })), ['outside_trading_hours'])
})

// --- o conjunto ------------------------------------------------------------------------------

test('todas as violações são reportadas, não só a primeira', () => {
  // Corrigir uma e descobrir a próxima, uma por vez, é a pior forma de configurar isso.
  const v = avaliar({ maxQuantity: 1, symbolAllowlist: ['MSFT'], requireStopLoss: true })
  assert.deepEqual(codigos(v).sort(), ['max_quantity', 'stop_loss_required', 'symbol_not_allowed'])
  assert.equal(v.allowed, false)
})

test('o veredito registra as regras REALMENTE avaliadas', () => {
  const v = avaliar({ maxQuantity: 100, blockOptions: true })
  assert.deepEqual(v.evaluated.sort(), ['blockOptions', 'maxQuantity'])
  assert.equal(v.allowed, true)
})

test('só se busca o que alguma regra precisa', () => {
  // Uma consulta a mais antes de cada ordem é latência que ninguém pediu.
  assert.deepEqual(needsContext({}), { account: false, positions: false, ordersToday: false, price: false })
  assert.equal(needsContext({ maxDailyLoss: 100 }).account, true)
  assert.equal(needsContext({ blockShort: true }).positions, true)
  assert.equal(needsContext({ maxOrdersPerDay: 3 }).ordersToday, true)
  assert.equal(needsContext({ maxOrderValue: 10 }).price, true)
  assert.equal(needsContext({ maxQuantity: 10 }).price, false, 'quantidade não precisa de preço')
})
