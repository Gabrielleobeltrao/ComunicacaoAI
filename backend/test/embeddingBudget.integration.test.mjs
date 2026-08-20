// A franquia gratuita do provedor de embedding, e a garantia de não passar dela.
//
// O dia em que a franquia acaba, o sistema não para: ele começa a COBRAR, em silêncio,
// uma chamada de cada vez, e ninguém percebe até a fatura. Este arquivo prova que ele
// para — inclusive quando vinte indexações acontecem ao mesmo tempo, que é o caso em que
// "somar e comparar" falha.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()

const budget = await import('../dist/embeddings/budget.js')
const { estimateTokens, reserveTokens, settleReservation, releaseReservation, resetEmbeddingBudget, embeddingUsageReport } = budget
const { mongoClient, db } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await resetEmbeddingBudget('voyage')
})

/** Uma configuração de teste: números pequenos, para o comportamento aparecer. */
const cfg = (over = {}) => ({
  provider: 'voyage',
  paidUsageEnabled: false,
  hardLimitEnabled: true,
  freeTokenLimit: 1000,
  hardStopTokens: 1000,
  maxTokensPerRequest: 10_000,
  dailyTokenLimit: 0,
  monthlyTokenLimit: 0,
  ...over,
})

const gastar = async (tokens, c = cfg()) => {
  const r = await reserveTokens(tokens, c)
  if (r.ok) {
    await settleReservation({
      provider: 'voyage',
      model: 'voyage-4',
      operation: 'teste',
      estimatedTokens: tokens,
      actualTokens: tokens,
      texts: 1,
      ok: true,
    })
  }
  return r
}

// --- a estimativa é o que decide antes de gastar ------------------------------------------

test('a estimativa é pessimista: subestimar é o único jeito de o corte falhar', () => {
  // Quatro caracteres por token, arredondando para cima. Não precisa ser exata; precisa
  // não ser otimista.
  assert.ok(estimateTokens(['a'.repeat(400)]) >= 100)
  assert.equal(estimateTokens([]), 0)
  assert.ok(estimateTokens(['x', 'y']) >= 2, 'cada texto tem um custo mínimo')
})

// --- 1, 2, 3) abaixo, na borda, e acima do corte -------------------------------------------

test('1) uso normal, bem abaixo do corte: passa', async () => {
  const r = await gastar(100)
  assert.equal(r.ok, true)
})

test('2) exatamente no corte: passa — o limite é o que cabe, não o que sobra', async () => {
  const r = await gastar(1000)
  assert.equal(r.ok, true)
  // E a próxima, por menor que seja, não passa mais.
  assert.equal((await gastar(1)).ok, false)
})

test('3) uma chamada que ultrapassaria o corte é recusada ANTES da API', async () => {
  await gastar(900)
  const r = await reserveTokens(200, cfg())
  assert.equal(r.ok, false)
  assert.equal(r.code, 'HARD_STOP')
  assert.match(r.reason, /franquia gratuita/)
})

test('4) com uso pago desligado, a mensagem diz que nada foi cobrado', async () => {
  await gastar(1000)
  const r = await reserveTokens(50, cfg({ paidUsageEnabled: false }))
  assert.match(r.reason, /nada é cobrado/)

  // Com uso pago LIGADO, o texto muda: aí o limite é uma escolha, não uma proteção.
  await resetEmbeddingBudget('voyage')
  await gastar(1000, cfg({ paidUsageEnabled: true }))
  const pago = await reserveTokens(50, cfg({ paidUsageEnabled: true }))
  assert.equal(pago.ok, false)
  assert.match(pago.reason, /Aumente VOYAGE_HARD_STOP_TOKENS/)
})

test('teto desligado e uso pago ligado: não há recusa, mas o consumo é contado', async () => {
  const c = cfg({ paidUsageEnabled: true, hardLimitEnabled: false })
  for (let i = 0; i < 5; i++) assert.equal((await gastar(1000, c)).ok, true)
  const doc = await db.collection('embedding_budget').findOne({ _id: 'voyage' })
  assert.equal(doc.used, 5000, 'saber quanto se gastou não depende de haver limite')
})

// --- 5) CONCORRÊNCIA — o teste que justifica a reserva atômica --------------------------------

test('5) vinte chamadas paralelas não estouram o limite juntas', async () => {
  // Este é o defeito que "ler o saldo e depois decidir" produz: cada uma lê 0, cada uma
  // conclui que cabe, e as vinte passam. A condição vive no FILTRO do update, então o
  // banco resolve uma por vez.
  const c = cfg({ hardStopTokens: 1000 })
  const resultados = await Promise.all(Array.from({ length: 20 }, () => reserveTokens(100, c)))
  const aprovadas = resultados.filter((r) => r.ok).length

  assert.equal(aprovadas, 10, `deveriam caber exatamente 10 de 100 em 1000 — passaram ${aprovadas}`)
  const doc = await db.collection('embedding_budget').findOne({ _id: 'voyage' })
  assert.equal(doc.reserved, 1000, 'nem um token além do teto foi comprometido')
})

test('a reserva de uma chamada que falhou volta inteira', async () => {
  const c = cfg()
  await reserveTokens(600, c)
  await releaseReservation('voyage', 600)
  // O espaço voltou: uma chamada de 600 cabe de novo.
  assert.equal((await reserveTokens(600, c)).ok, true)
})

test('o acerto usa o número REAL do provedor, não a estimativa', async () => {
  const c = cfg({ hardStopTokens: 10_000 })
  await reserveTokens(500, c)
  // Estimamos 500, o provedor cobrou 120: a diferença volta para a franquia.
  await settleReservation({
    provider: 'voyage',
    model: 'voyage-4',
    operation: 'teste',
    estimatedTokens: 500,
    actualTokens: 120,
    texts: 1,
    ok: true,
  })
  const doc = await db.collection('embedding_budget').findOne({ _id: 'voyage' })
  assert.equal(doc.used, 120)
  assert.equal(doc.reserved, 120, 'o que sobrou da estimativa não fica preso')
})

// --- 6) limites do operador ------------------------------------------------------------------

test('6) o limite diário recusa, e devolve a reserva', async () => {
  const c = cfg({ hardStopTokens: 1_000_000, dailyTokenLimit: 500 })
  assert.equal((await gastar(400, c)).ok, true)
  const r = await reserveTokens(200, c)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'DAILY_LIMIT')

  const doc = await db.collection('embedding_budget').findOne({ _id: 'voyage' })
  assert.equal(doc.reserved, 400, 'a recusa não pode consumir franquia')
})

test('uma chamada grande demais é recusada por si só', async () => {
  const r = await reserveTokens(50_000, cfg({ maxTokensPerRequest: 1000 }))
  assert.equal(r.ok, false)
  assert.equal(r.code, 'REQUEST_TOO_LARGE')
})

// --- 7) o contador sobrevive ao restart --------------------------------------------------------

test('7) o consumo é do BANCO: reiniciar o processo não zera nada', async () => {
  await gastar(700)
  // Um novo import do módulo é o mais perto de um restart que um teste alcança — e o
  // ponto é que o número não mora em memória nenhuma.
  const outro = await import(`../dist/embeddings/budget.js?restart=${Date.now()}`)
  const r = await outro.reserveTokens(400, cfg())
  assert.equal(r.ok, false, 'o que foi gasto antes do restart continua gasto')
})

// --- 8) o que o painel mostra -------------------------------------------------------------------

test('8) o relatório soma por modelo, por agente, por dia e por mês', async () => {
  const c = cfg({ hardStopTokens: 10_000, freeTokenLimit: 10_000 })
  await reserveTokens(300, c)
  await settleReservation({
    provider: 'voyage', model: 'voyage-4', operation: 'knowledge:index',
    estimatedTokens: 300, actualTokens: 300, texts: 3, ok: true, agentId: 'a1',
  })
  await reserveTokens(200, c)
  await settleReservation({
    provider: 'voyage', model: 'voyage-4-lite', operation: 'knowledge:search',
    estimatedTokens: 200, actualTokens: 200, texts: 1, ok: true, agentId: 'a2',
  })

  const r = await embeddingUsageReport(c, 'voyage-4', 'voyage-4-lite')
  assert.equal(r.usedTokens, 500)
  assert.equal(r.remainingTokens, 9500)
  assert.equal(r.percentUsed, 5)
  assert.equal(r.requests, 2)
  assert.equal(r.tokensToday, 500)
  assert.equal(r.tokensThisMonth, 500)
  assert.deepEqual(r.byModel.map((m) => m.model).sort(), ['voyage-4', 'voyage-4-lite'])
  assert.deepEqual(r.byAgent.map((a) => a.agentId).sort(), ['a1', 'a2'])
  assert.equal(r.paidUsageEnabled, false, 'o padrão é seguro')
})

test('a última falha aparece no relatório, com o motivo', async () => {
  await settleReservation({
    provider: 'voyage', model: 'voyage-4', operation: 'knowledge:index',
    estimatedTokens: 100, actualTokens: null, texts: 1, ok: false, error: 'HARD_STOP: a franquia acabou',
  })
  const r = await embeddingUsageReport(cfg(), 'voyage-4', null)
  assert.match(r.lastError.reason, /HARD_STOP/)
  assert.equal(r.requests, 0, 'uma chamada que falhou não conta como requisição feita')
})
