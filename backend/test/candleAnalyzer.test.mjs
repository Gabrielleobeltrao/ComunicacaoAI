// O Candle Analyzer: números conferíveis, padrões reconhecidos pela regra, e entrada
// suja recusada.
//
// Este arquivo existe porque um indicador errado não parece errado. Um RSI calculado
// com a convenção errada devolve 58 em vez de 61 — plausível, comparável ao gráfico do
// dono, e diferente. Por isso as asserções são contra valores CALCULÁVEIS à mão, não
// contra o que a implementação devolveu na primeira vez que rodou.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { analyze, analyzeSeries } = await import('../dist/apps/official/candle-analyzer/analyze.js')
const { parseSeries, parseCandle, CandleInputError, MAX_CANDLES, MIN_CANDLES } = await import(
  '../dist/apps/official/candle-analyzer/candles.js'
)
const { sma, ema, rsi, atr, relativeVolume, computeIndicators } = await import('../dist/apps/official/candle-analyzer/indicators.js')
const { detectPatterns, doji, hammer, shootingStar, bullishEngulfing, bearishEngulfing, morningStar, eveningStar } = await import(
  '../dist/apps/official/candle-analyzer/patterns.js'
)
const { candleAnalyzerTools, manifest } = await import('../dist/apps/official/candle-analyzer/index.js')

const T0 = 1_700_000_000_000
const MIN = 60_000

// Uma vela com a forma que o teste quiser, e OHLC coerente por construção.
const vela = (i, { o, h, l, c, v = 1000, closed = true } = {}) => ({
  timestamp: T0 + i * MIN,
  open: o,
  high: h ?? Math.max(o, c),
  low: l ?? Math.min(o, c),
  close: c,
  volume: v,
  closed,
})

// Série chata de propósito: preços iguais, para o teste isolar a vela que interessa.
const serie = (n, preco = 100) => Array.from({ length: n }, (_, i) => vela(i, { o: preco, c: preco, h: preco, l: preco }))

// --- indicadores contra valores calculáveis à mão ------------------------------------------

test('SMA é a média dos últimos períodos, e nada além disso', () => {
  assert.equal(sma([1, 2, 3, 4, 5], 5), 3)
  assert.equal(sma([1, 2, 3, 4, 5], 3), 4, 'só os três últimos: (3+4+5)/3')
  assert.equal(sma([1, 2], 5), null, 'série curta não devolve chute')
  assert.equal(sma([1, 2, 3], 0), null)
})

test('EMA é semeada com a média simples do primeiro período', () => {
  // Com todos os valores iguais, a EMA é o próprio valor — qualquer semente errada
  // apareceria aqui.
  assert.equal(ema([5, 5, 5, 5, 5], 3), 5)
  // k = 2/(3+1) = 0,5. Semente = (1+2+3)/3 = 2. Depois: 4*0,5 + 2*0,5 = 3.
  assert.equal(ema([1, 2, 3, 4], 3), 3)
  assert.equal(ema([1, 2], 5), null)
})

test('RSI é 100 numa alta sem nenhuma queda, e 50 numa série travada', () => {
  const subindo = Array.from({ length: 20 }, (_, i) => 100 + i)
  assert.equal(rsi(subindo, 14), 100, 'sem perdas, o RSI é 100 por definição — não NaN')
  const travada = Array.from({ length: 20 }, () => 100)
  assert.equal(rsi(travada, 14), 50, 'sem ganho nem perda, 50 — não uma divisão por zero')
  assert.equal(rsi([1, 2, 3], 14), null, 'RSI(14) precisa de 15 fechamentos')
})

test('RSI de uma série alternada fica no meio, e é reproduzível', () => {
  const alternada = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 100 : 101))
  const a = rsi(alternada, 14)
  const b = rsi(alternada, 14)
  assert.equal(a, b, 'a mesma série sempre dá o mesmo número')
  assert.ok(a > 30 && a < 70, `esperado no meio da faixa, veio ${a}`)
})

test('ATR conta o salto em relação ao fechamento anterior, não só a amplitude', () => {
  // Amplitude de cada vela = 1. Todas contíguas: ATR = 1.
  const contiguas = Array.from({ length: 20 }, (_, i) => vela(i, { o: 100, c: 100, h: 100.5, l: 99.5 }))
  assert.equal(atr(contiguas, 14), 1)
  assert.equal(atr(contiguas.slice(0, 3), 14), null, 'série curta não devolve chute')
})

test('volume relativo compara com a média ANTERIOR, sem se diluir', () => {
  const velas = Array.from({ length: 21 }, (_, i) => vela(i, { o: 100, c: 100, v: i === 20 ? 2000 : 1000 }))
  // A média das 20 anteriores é 1000; a última é 2000. Incluir a última na média daria
  // 1,9 — e o pico pareceria menor do que é.
  assert.equal(relativeVolume(velas, 20), 2)
})

test('os indicadores dizem onde o preço está em relação às médias', () => {
  const subindo = Array.from({ length: 60 }, (_, i) => vela(i, { o: 100 + i, c: 100 + i }))
  const ind = computeIndicators(subindo)
  assert.equal(ind.aboveSma20, true)
  assert.equal(ind.aboveSma50, true)
  assert.equal(ind.lastClose, 159)
})

// --- padrões, um por um --------------------------------------------------------------------

test('Doji: corpo quase inexistente na amplitude', () => {
  const p = doji(vela(0, { o: 100, c: 100.02, h: 101, l: 99 }))
  assert.ok(p, 'corpo de 1% da amplitude é doji')
  assert.equal(p.direction, 'neutral', 'indecisão não tem direção')
  assert.match(p.detail, /amplitude/)
  // Corpo grande não é doji.
  assert.equal(doji(vela(0, { o: 100, c: 102, h: 102, l: 100 })), null)
  // Preço travado não tem forma para ler.
  assert.equal(doji(vela(0, { o: 100, c: 100, h: 100, l: 100 })), null)
})

test('Martelo: sombra inferior longa e superior curta', () => {
  const p = hammer(vela(0, { o: 100, c: 101, h: 101.2, l: 96 }))
  assert.ok(p)
  assert.equal(p.direction, 'bullish')
  assert.match(p.detail, /Sombra inferior/)
  // Sombra superior grande descaracteriza: a vela é volátil, não um martelo.
  assert.equal(hammer(vela(0, { o: 100, c: 101, h: 105, l: 96 })), null)
  // Sem sombra inferior longa, não é martelo.
  assert.equal(hammer(vela(0, { o: 100, c: 101, h: 101, l: 99.8 })), null)
})

test('Estrela cadente é o espelho do martelo', () => {
  const p = shootingStar(vela(0, { o: 101, c: 100, h: 105, l: 99.8 }))
  assert.ok(p)
  assert.equal(p.direction, 'bearish')
  assert.equal(shootingStar(vela(0, { o: 100, c: 101, h: 101.2, l: 96 })), null, 'um martelo não é estrela cadente')
})

test('Engolfo de alta exige cobrir o corpo anterior INTEIRO', () => {
  const anterior = vela(0, { o: 102, c: 100 })
  const p = bullishEngulfing(anterior, vela(1, { o: 99.5, c: 103 }))
  assert.ok(p)
  assert.equal(p.direction, 'bullish')
  // Cobrir parcialmente não é engolfar.
  assert.equal(bullishEngulfing(anterior, vela(1, { o: 100.5, c: 101.5 })), null)
  // A anterior precisa ser de baixa.
  assert.equal(bullishEngulfing(vela(0, { o: 100, c: 102 }), vela(1, { o: 99, c: 103 })), null)
})

test('Engolfo de baixa é o espelho', () => {
  const p = bearishEngulfing(vela(0, { o: 100, c: 102 }), vela(1, { o: 102.5, c: 99.5 }))
  assert.ok(p)
  assert.equal(p.direction, 'bearish')
})

test('Estrela da manhã: queda cheia, indecisão, e recuperação de mais da metade', () => {
  const a = vela(0, { o: 110, c: 100 })
  const b = vela(1, { o: 99.5, c: 99.8 })
  const p = morningStar(a, b, vela(2, { o: 100, c: 107 }))
  assert.ok(p, 'fecha acima do meio da primeira (105)')
  assert.equal(p.direction, 'bullish')
  // Fechar abaixo do meio não conta: a reversão não se confirmou.
  assert.equal(morningStar(a, b, vela(2, { o: 100, c: 103 })), null)
  // A vela do meio precisa ser pequena.
  assert.equal(morningStar(a, vela(1, { o: 99, c: 108 }), vela(2, { o: 100, c: 107 })), null)
})

test('Estrela da noite é o espelho', () => {
  const p = eveningStar(vela(0, { o: 100, c: 110 }), vela(1, { o: 110.2, c: 110.5 }), vela(2, { o: 110, c: 103 }))
  assert.ok(p)
  assert.equal(p.direction, 'bearish')
})

test('só a PONTA da série é examinada', () => {
  // Um martelo trinta velas atrás não é uma oportunidade agora. Devolver o histórico
  // daria ao agente uma lista para escolher — justamente a decisão que este App existe
  // para não delegar.
  const velas = [...serie(20), vela(20, { o: 100, c: 101, h: 101.2, l: 96 }), ...serie(5).map((c, i) => ({ ...c, timestamp: T0 + (21 + i) * MIN }))]
  assert.equal(detectPatterns(velas).length, 0, 'o martelo está no meio, não na ponta')
})

test('dá para restringir quais padrões procurar', () => {
  const velas = [...serie(20), vela(20, { o: 100, c: 101, h: 101.2, l: 96 })]
  assert.equal(detectPatterns(velas, ['hammer']).length, 1)
  assert.equal(detectPatterns(velas, ['doji']).length, 0)
  assert.equal(detectPatterns(velas, []).length, 1, 'lista vazia procura todos')
})

// --- entrada inválida: recusada, não saneada -------------------------------------------------

test('campo que não é número finito derruba a série', () => {
  for (const ruim of [{ open: 'cem' }, { high: NaN }, { low: Infinity }, { close: null }, { timestamp: undefined }]) {
    assert.throws(() => parseCandle({ timestamp: T0, open: 100, high: 101, low: 99, close: 100, ...ruim }, 0), CandleInputError)
  }
})

test('OHLC incoerente é recusado: a série não descreve um mercado', () => {
  // `high` menor que `low`, ou menor que o fechamento, é dado corrompido. Calcular
  // sobre isso não dá erro — dá um número, e alguém usa.
  assert.throws(() => parseCandle({ timestamp: T0, open: 100, high: 98, low: 99, close: 100 }, 0), /high/)
  assert.throws(() => parseCandle({ timestamp: T0, open: 100, high: 100.5, low: 99, close: 105 }, 0), /high/)
  assert.throws(() => parseCandle({ timestamp: T0, open: 100, high: 101, low: 100.5, close: 100 }, 0), /low/)
  assert.throws(() => parseCandle({ timestamp: T0, open: 0, high: 1, low: 0, close: 0 }, 0), /positivo/)
})

test('volume negativo é recusado; ausente é zero', () => {
  assert.throws(() => parseCandle({ timestamp: T0, open: 100, high: 101, low: 99, close: 100, volume: -5 }, 0), /volume/)
  assert.equal(parseCandle({ timestamp: T0, open: 100, high: 101, low: 99, close: 100 }, 0).volume, 0)
})

test('timestamp repetido é recusado, não deduplicado', () => {
  // A mesma vela duas vezes significa origem enviando errado. Escolher qual manter
  // seria um palpite sobre dados de mercado.
  const velas = [...serie(20), { ...vela(19, { o: 100, c: 100 }) }]
  assert.throws(() => parseSeries(velas), /mais de uma vez/)
})

test('série fora de ordem é ordenada, e o aviso aparece', () => {
  const velas = serie(20)
  const trocada = [velas[1], velas[0], ...velas.slice(2)]
  const { candles, warnings } = parseSeries(trocada)
  assert.equal(candles[0].timestamp, velas[0].timestamp)
  assert.ok(warnings.some((w) => /fora de ordem/.test(w)))
})

test('vela em formação é ignorada por padrão, e o dono é avisado', () => {
  const velas = [...serie(20), vela(20, { o: 100, c: 105, closed: false })]
  const { candles, warnings } = parseSeries(velas)
  assert.equal(candles.length, 20, 'a vela aberta muda até fechar: analisá-la é analisar um número provisório')
  assert.ok(warnings.some((w) => /em formação/.test(w)))

  // Quem quiser incluir, inclui explicitamente.
  assert.equal(parseSeries(velas, { closedOnly: false }).candles.length, 21)
})

test('lista vazia, longa demais ou curta demais é recusada com o número', () => {
  assert.throws(() => parseSeries([]), /vazia/)
  assert.throws(() => parseSeries('nada'), /lista/)
  assert.throws(() => parseSeries(serie(MAX_CANDLES + 1)), new RegExp(String(MAX_CANDLES)))
  assert.throws(() => parseSeries(serie(MIN_CANDLES - 1)), new RegExp(String(MIN_CANDLES)))
})

// --- a análise completa ------------------------------------------------------------------------

test('a saída tem a forma prometida, com razões para o escore', () => {
  const velas = [...serie(30), vela(30, { o: 100, c: 101, h: 101.2, l: 96 })]
  const r = analyze({ candles: velas }, { symbol: 'PETR4', timeframe: '5m' })

  assert.equal(r.schemaVersion, 1)
  assert.equal(r.symbol, 'PETR4')
  assert.equal(r.timeframe, '5m')
  assert.equal(r.candleCount, 31)
  assert.equal(r.lastClosedAt, T0 + 30 * MIN)
  assert.ok(['bullish', 'bearish', 'neutral'].includes(r.direction))
  assert.ok(r.score >= 0 && r.score <= 100)
  assert.ok(Array.isArray(r.patterns))
  assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0, 'um número sem razões é impossível de contestar')
  assert.ok(Array.isArray(r.warnings))
  assert.equal(typeof r.opportunityFound, 'boolean')
})

test('a mesma entrada dá exatamente a mesma saída', () => {
  // Reprodutibilidade não é preciosismo: um agente que decide com base num número que
  // varia entre execuções é impossível de depurar.
  const velas = [...serie(30), vela(30, { o: 100, c: 101, h: 101.2, l: 96 })]
  const a = analyze({ candles: velas }, { symbol: 'X', timeframe: '1m' })
  const b = analyze({ candles: velas }, { symbol: 'X', timeframe: '1m' })
  assert.deepEqual(a, b)
})

test('sem padrão na ponta, não há oportunidade — e o motivo é dito', () => {
  const r = analyze({ candles: serie(30) }, { symbol: 'X', timeframe: '1m' })
  assert.equal(r.opportunityFound, false)
  assert.equal(r.direction, 'neutral')
  assert.equal(r.score, 0)
  assert.ok(r.reasons.some((m) => /Nenhum padrão/.test(m)))
})

test('padrões opostos na mesma vela se cancelam, em vez de escolher pela ordem da lista', () => {
  // Uma vela com as duas sombras longas encaixaria nas duas regras. Chamar de alta ou
  // de baixa seria decidir pelo acaso.
  const velas = [...serie(30), vela(30, { o: 100, c: 100.05, h: 106, l: 94 })]
  const r = analyze({ candles: velas }, { symbol: 'X', timeframe: '1m' })
  assert.equal(r.direction, 'neutral')
  assert.equal(r.opportunityFound, false)
})

test('o mínimo de escore é do dono, e o resultado respeita', () => {
  const velas = [...serie(30), vela(30, { o: 100, c: 101, h: 101.2, l: 96, v: 5000 })]
  const exigente = analyze({ candles: velas }, { symbol: 'X', timeframe: '1m', minimumScore: 100 })
  const frouxo = analyze({ candles: velas }, { symbol: 'X', timeframe: '1m', minimumScore: 1 })
  assert.equal(exigente.opportunityFound, false)
  assert.equal(frouxo.opportunityFound, true)
  assert.ok(frouxo.reasons.some((m) => /mínimo de 1/.test(m)))
})

test('o que não pôde ser calculado vira aviso, para o escore não parecer completo', () => {
  const r = analyzeSeries(serie(16).map((c, i) => ({ ...c, close: 100 + i, open: 100 + i })), [], { symbol: 'X', timeframe: '1m' })
  assert.ok(r.warnings.some((w) => /média de 20/.test(w)), 'metade dos fatores ficou de fora e isso é dito')
})

test('a análise NUNCA diz para comprar ou vender', () => {
  // A fronteira do App: ele descreve o que a série mostra. Decidir operar é de gente,
  // ou de um App de risco que ainda não existe.
  const velas = [...serie(30), vela(30, { o: 100, c: 101, h: 101.2, l: 96, v: 9000 })]
  const texto = JSON.stringify(analyze({ candles: velas }, { symbol: 'X', timeframe: '1m', minimumScore: 1 }))
  for (const proibido of ['BUY', 'SELL', 'comprar', 'vender', 'compre', 'venda']) {
    assert.doesNotMatch(texto, new RegExp(proibido, 'i'), `a saída não pode conter "${proibido}"`)
  }
})

// --- o App em si -------------------------------------------------------------------------------

test('o manifesto não pede credencial nem alcança domínio nenhum', () => {
  // É o contrato que torna o App reaproveitável para qualquer origem de dados — e a
  // garantia de que ele não busca cotação por conta própria.
  assert.equal(manifest.key, 'candle_analyzer')
  assert.equal(manifest.auth.kind, 'none')
  assert.deepEqual(manifest.allowedDomains, [])
  assert.equal(manifest.activation, 'instant')
  assert.equal(manifest.source, 'system')
})

test('as três ações são de leitura: nada aqui altera nada', () => {
  const chaves = manifest.actions.map((a) => a.key)
  assert.deepEqual(chaves, ['candles_calculate_indicators', 'candles_detect_patterns', 'candles_find_opportunities'])
  for (const a of manifest.actions) assert.equal(a.risk, 'read', `${a.key} deveria ser read`)
})

test('as ferramentas rodam e devolvem JSON utilizável por uma condição', async () => {
  const tools = candleAnalyzerTools()
  const velas = [...serie(30), vela(30, { o: 100, c: 101, h: 101.2, l: 96, v: 9000 })]
  const oportunidade = tools.find((t) => t.name === 'candles_find_opportunities')

  const r = await oportunidade.run({ symbol: 'X', timeframe: '1m', candles: velas, minimumScore: 1 })
  assert.equal(r.ok, true)
  const dados = JSON.parse(r.result)
  // `opportunityFound` é o campo que uma condição de rotina vai ler.
  assert.equal(dados.opportunityFound, true)
  assert.equal(typeof dados.score, 'number')
})

test('entrada inválida volta como recusa explícita, não como resultado vazio', async () => {
  const tools = candleAnalyzerTools()
  const r = await tools[0].run({ symbol: 'X', timeframe: '1m', candles: [{ timestamp: 1, open: 100, high: 98, low: 99, close: 100 }] })
  assert.equal(r.ok, false)
  const dados = JSON.parse(r.result)
  assert.equal(dados.executed, false, 'o agente precisa saber que a análise NÃO aconteceu')
  assert.match(dados.reason, /high/)
  assert.match(dados.instruction, /não invente/i)
})

test('falta de símbolo é dita antes de qualquer cálculo', async () => {
  const tools = candleAnalyzerTools()
  const r = await tools[0].run({ timeframe: '1m', candles: serie(20) })
  assert.equal(r.ok, false)
  assert.match(JSON.parse(r.result).reason, /symbol/)
})
