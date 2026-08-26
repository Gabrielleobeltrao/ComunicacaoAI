// O PORTÃO do gasto: limite conferido antes, e cobrança exatamente uma vez.
//
// Precisa de banco porque o limite e a contabilização moram nele. O provedor é o dublê:
// o que está sendo exercitado é a ordem das operações, não o modelo.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.LLM_FAKE = '1'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { runArchitectTurn } = await import('../dist/architect/turn.js')
const { buildArchitectPrompt } = await import('../dist/architect/prompt.js')
const { setProviderApiKey, setMonthlyTokenCap } = await import('../dist/userSettings.js')
const { ensureTokenUsageIndexes, getMonthlyTokens } = await import('../dist/tokenUsage.js')

const DONO = 'dono-arquiteto-turno'

const prompt = () =>
  buildArchitectPrompt({
    project: { title: 'Restaurante', objective: 'atendimento', locale: 'pt', answers: {}, blueprint: null },
    messages: [{ role: 'user', content: 'quero automatizar o atendimento' }],
    apps: [],
  })

before(async () => {
  await mongoClient.connect()
  await ensureTokenUsageIndexes()
})
after(async () => {
  await mongoClient.close()
  await stopMongo()
})
beforeEach(async () => {
  await db.collection('token_usage').deleteMany({})
  await db.collection('token_usage_charges').deleteMany({})
  await db.collection('user_settings').deleteMany({})
})

test('sem chave de provedor, o Arquiteto recusa em vez de tentar', async () => {
  const r = await runArchitectTurn({ ownerId: DONO, provider: 'anthropic', model: null, prompt: prompt(), chargeKey: 'k1' })
  assert.equal(r.ok, false)
  assert.equal(r.failure.code, 'no_provider_key')
  assert.match(r.failure.message, /Configurações/)
  assert.equal(await getMonthlyTokens(DONO), 0, 'não gastou nada')
})

test('o limite mensal é conferido ANTES da chamada', async () => {
  await setProviderApiKey(DONO, 'anthropic', 'chave-de-teste')
  await setMonthlyTokenCap(DONO, 10)
  // Gasto anterior que já estoura o teto.
  const { recordReplyUsage } = await import('../dist/tokenUsage.js')
  await recordReplyUsage(DONO, { inputTokens: 20, outputTokens: 0 })

  const antes = await getMonthlyTokens(DONO)
  const r = await runArchitectTurn({ ownerId: DONO, provider: 'anthropic', model: null, prompt: prompt(), chargeKey: 'k2' })
  assert.equal(r.ok, false)
  assert.equal(r.failure.code, 'budget_exceeded')
  assert.equal(await getMonthlyTokens(DONO), antes, 'nem um token a mais depois da recusa')
})

test('a rodada cobra, e a MESMA rodada repetida não cobra de novo', async () => {
  await setProviderApiKey(DONO, 'anthropic', 'chave-de-teste')

  const primeira = await runArchitectTurn({ ownerId: DONO, provider: 'anthropic', model: null, prompt: prompt(), chargeKey: 'rodada-1' })
  assert.equal(primeira.ok, true)
  assert.ok(primeira.usage.inputTokens > 0)
  const depoisDaPrimeira = await getMonthlyTokens(DONO)
  assert.ok(depoisDaPrimeira > 0, 'cobrou')

  const repetida = await runArchitectTurn({ ownerId: DONO, provider: 'anthropic', model: null, prompt: prompt(), chargeKey: 'rodada-1' })
  assert.equal(repetida.ok, true)
  assert.equal(await getMonthlyTokens(DONO), depoisDaPrimeira, 'a mesma chave de cobrança não cobra duas vezes')

  const outra = await runArchitectTurn({ ownerId: DONO, provider: 'anthropic', model: null, prompt: prompt(), chargeKey: 'rodada-2' })
  assert.equal(outra.ok, true)
  assert.ok((await getMonthlyTokens(DONO)) > depoisDaPrimeira, 'uma rodada nova cobra')
})

test('resposta ilegível falha de forma segura — e o que já foi gasto fica contabilizado', async () => {
  await setProviderApiKey(DONO, 'anthropic', 'chave-de-teste')
  // Um prompt sem a marca do Arquiteto: o dublê devolve vazio, que não é JSON.
  const r = await runArchitectTurn({ ownerId: DONO, provider: 'anthropic', model: null, prompt: 'sem a marca', chargeKey: 'ilegivel' })
  assert.equal(r.ok, false)
  assert.equal(r.failure.code, 'unreadable_response')
  assert.ok(r.usage.inputTokens > 0, 'o provedor cobrou as duas tentativas, e elas foram registradas')
  assert.ok((await getMonthlyTokens(DONO)) > 0)

  // DUAS cobranças e não mais: a tentativa e UM reparo. Insistir em ciclo transformaria
  // uma resposta ruim numa conta alta.
  const cobrancas = await db.collection('token_usage_charges').find({ _id: /^ilegivel/ }).toArray()
  assert.deepEqual(cobrancas.map((c) => c._id).sort(), ['ilegivel', 'ilegivel:repair'])
})

test('a falha não vaza mensagem de provedor para a tela', async () => {
  await setProviderApiKey(DONO, 'anthropic', 'chave-de-teste')
  const r = await runArchitectTurn({ ownerId: DONO, provider: 'anthropic', model: null, prompt: 'sem a marca', chargeKey: 'ilegivel-2' })
  assert.equal(r.ok, false)
  assert.ok(!/http|api|key|token/i.test(r.failure.message), r.failure.message)
})
