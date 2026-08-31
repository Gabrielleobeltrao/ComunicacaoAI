// Os freios que moram no BANCO: contador atômico, vaga de execução e cota de espaço.
//
// Em memória, cada um deles vale por instância — com duas réplicas o teto vira o dobro e
// um restart zera tudo. Aqui os três são exercitados contra um Mongo de verdade, que é o
// único jeito de provar que a corrida entre duas chamadas simultâneas termina certo.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'chave-de-teste-para-os-freios-1a2b3c4d'

const { mongoClient, db } = await import('../dist/db.js')
const { consumeRate, withConcurrencySlot, anonymizeIp, checkOwnerStorage, ensureAbuseGuardIndexes, ownerWithinBudget } = await import('../dist/abuseGuards.js')

before(async () => {
  await mongoClient.connect()
  await ensureAbuseGuardIndexes()
})

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['rate_limits', 'concurrency_slots', 'knowledge_documents', 'agents', 'user_settings', 'token_usage']) {
    await db.collection(c).deleteMany({})
  }
})

test('o contador conta certo mesmo com tudo chegando ao mesmo tempo', async () => {
  // Ler-e-depois-escrever perderia a corrida, e perder a corrida num limite de abuso é
  // não ter limite. Vinte chamadas simultâneas contra um teto de cinco: cinco passam.
  const veredictos = await Promise.all(Array.from({ length: 20 }, () => consumeRate('teste:corrida', 5, 60_000)))
  assert.equal(veredictos.filter((v) => v.allowed).length, 5)
  assert.ok(veredictos.every((v) => v.retryAfterSeconds > 0), 'a recusa sempre diz quando voltar')
})

test('a janela expira sozinha, e a seguinte começa do zero', async () => {
  const agora = new Date()
  for (let i = 0; i < 3; i++) await consumeRate('teste:janela', 3, 1_000, agora)
  assert.equal((await consumeRate('teste:janela', 3, 1_000, agora)).allowed, false)

  const depois = new Date(agora.getTime() + 1_500)
  assert.equal((await consumeRate('teste:janela', 3, 1_000, depois)).allowed, true)
})

test('chaves diferentes não se misturam', async () => {
  await consumeRate('a', 1, 60_000)
  assert.equal((await consumeRate('a', 1, 60_000)).allowed, false)
  assert.equal((await consumeRate('b', 1, 60_000)).allowed, true)
})

test('a vaga de execução erra para o lado de RECUSAR', async () => {
  const executadas = []
  const resultados = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      withConcurrencySlot('dono-x', 2, 60_000, async () => {
        executadas.push(i)
        await new Promise((r) => setTimeout(r, 120))
        return i
      }),
    ),
  )
  // Nunca MAIS que o teto: passar do teto é gastar dinheiro que ninguém autorizou.
  assert.ok(executadas.length <= 2, `rodaram ${executadas.length}`)
  assert.equal(resultados.filter((r) => r === null).length, 6 - executadas.length)
  // E a vaga é devolvida no fim: sem isso, o dono ficaria trancado fora da própria conta.
  assert.equal(await db.collection('concurrency_slots').countDocuments({ key: 'dono-x' }), 0)
})

test('o IP conta sem ser guardado', async () => {
  const a = anonymizeIp('203.0.113.9')
  assert.equal(a, anonymizeIp('203.0.113.9'), 'o mesmo IP conta no mesmo balde')
  assert.notEqual(a, anonymizeIp('203.0.113.10'))
  assert.doesNotMatch(a, /203|113/, 'e o endereço não fica legível em lugar nenhum')
})

test('a cota de espaço soma o que é DO DONO — e não zero', async () => {
  const dono = 'dono-espaco'
  const agente = new ObjectId()
  await db.collection('agents').insertOne({ _id: agente, ownerId: dono, name: 'A' })
  // O documento aponta para o AGENTE, não para a conta: somar pela conta daria zero
  // sempre, e uma cota que nunca dispara é pior que nenhuma.
  await db.collection('knowledge_documents').insertOne({ ownerId: agente, ownerType: 'agent', content: 'x'.repeat(5_000) })

  process.env.OWNER_STORAGE_QUOTA_BYTES = '6000'
  const cabe = await checkOwnerStorage(dono, 500)
  assert.equal(cabe.usedBytes, 5_000)
  assert.equal(cabe.allowed, true)
  assert.equal((await checkOwnerStorage(dono, 2_000)).allowed, false, 'o que estouraria a cota não entra')

  // Conta vizinha não paga pelo espaço de ninguém.
  assert.equal((await checkOwnerStorage('outro-dono', 2_000)).usedBytes, 0)
  delete process.env.OWNER_STORAGE_QUOTA_BYTES
})

test('o teto de gasto FECHA quando não dá para conferir', async () => {
  const { setMonthlyTokenCap } = await import('../dist/userSettings.js')
  await setMonthlyTokenCap('dono-teto', 1000)
  assert.equal(await ownerWithinBudget('dono-teto'), true, 'quem está dentro do teto continua atendendo')

  // Sem teto configurado não há freio — é a escolha do dono, e ela é respeitada.
  assert.equal(await ownerWithinBudget('dono-sem-teto'), true)

  // Estourou: para.
  assert.equal(await ownerWithinBudget('dono-teto', { cap: async () => 1000, used: async () => 1000 }), false)

  // E o caso que o `try/catch` existe para cobrir: o banco fora do ar no meio de uma
  // enxurrada é exatamente quando gastar custa mais caro. Um teto que abre quando o
  // banco tosse não é um teto.
  const quebrado = {
    cap: async () => {
      throw new Error('banco indisponível')
    },
    used: async () => 0,
  }
  assert.equal(await ownerWithinBudget('dono-teto', quebrado), false, 'sem conseguir conferir, não se gasta')
})
