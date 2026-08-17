// INTEGRATION: o checkpoint sobrevive ao reinício, contra um mongod REAL.
//
// A promessa que este arquivo protege: um redeploy no meio da madrugada não pode
// fazer a rotina reentregar as notícias de ontem. Isso não dá para testar com um
// objeto em memória — o ponto é justamente que o estado está no banco.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { advanceCheckpoint, ensureSourceCheckpointIndexes, getCheckpoint, markChecked, MAX_SEEN_KEYS } = await import(
  '../dist/automations/sourceCheckpoint.js'
)
const { detectRssChange, INITIAL_WINDOWS } = await import('../dist/automations/sourceChange.js')

const OWNER = 'checkpoint-owner'
const OUTRO = 'checkpoint-outro'
const AUTOMACAO = new ObjectId()
const ETAPA = 'source'
const agora = Date.parse('2026-03-10T12:00:00Z')

const feed = (guids) =>
  `<rss><channel>${guids.map((g) => `<item><title>Item ${g}</title><guid>${g}</guid></item>`).join('')}</channel></rss>`

before(async () => {
  await mongoClient.connect()
  await ensureSourceCheckpointIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})
beforeEach(async () => {
  await db.collection('source_checkpoints').deleteMany({})
})

test('sem checkpoint, a primeira volta enxerga o feed inteiro dentro da janela', async () => {
  const cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.equal(cp, null)
  const mudanca = detectRssChange(feed(['a', 'b']), [], INITIAL_WINDOWS['24h'], agora)
  assert.equal(mudanca.novos.length, 2)
})

test('depois de avançar, os mesmos itens não voltam — inclusive num processo novo', async () => {
  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, { novasChaves: ['a', 'b'] }, new Date(agora))

  // "Reinício" aqui é ler o estado DE NOVO do banco, que é o que um processo novo
  // faria. Nada é reaproveitado de memória.
  const relido = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.deepEqual(relido.seenKeys, ['a', 'b'])

  const mudanca = detectRssChange(feed(['a', 'b']), relido.seenKeys, INITIAL_WINDOWS['24h'], agora)
  assert.equal(mudanca.changed, false, 'um redeploy não pode reentregar o que já foi entregue')
})

test('só o que é realmente novo passa na segunda volta', async () => {
  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, { novasChaves: ['a'] }, new Date(agora))
  const cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  const mudanca = detectRssChange(feed(['a', 'b']), cp.seenKeys, INITIAL_WINDOWS['24h'], agora)
  assert.deepEqual(mudanca.novasChaves, ['b'])
})

test('verificar e mudar são registrados em campos diferentes', async () => {
  const t1 = new Date(agora)
  await markChecked(OWNER, AUTOMACAO, ETAPA, t1)
  let cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.deepEqual(cp.lastCheckedAt, t1)
  // Verificou e não achou nada: `lastChangedAt` continua vazio. É isso que permite
  // à lista dizer "verificado agora, sem novidade desde terça".
  assert.equal(cp.lastChangedAt, null)

  const t2 = new Date(agora + 60_000)
  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, { novasChaves: ['novo'] }, t2)
  cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.deepEqual(cp.lastChangedAt, t2)
  assert.deepEqual(cp.lastCheckedAt, t2)
})

test('a lista de chaves tem teto, e o que sai é o mais antigo', async () => {
  const muitas = Array.from({ length: MAX_SEEN_KEYS + 50 }, (_, i) => `k${i}`)
  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, { novasChaves: muitas }, new Date(agora))
  const cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.equal(cp.seenKeys.length, MAX_SEEN_KEYS)
  // O começo foi cortado; o fim, que é o mais recente, ficou.
  assert.equal(cp.seenKeys.at(-1), muitas.at(-1))
  assert.ok(!cp.seenKeys.includes('k0'))
})

test('o checkpoint de HTTP guarda o hash, não a lista', async () => {
  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, { contentHash: 'abc123' }, new Date(agora))
  const cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.equal(cp.contentHash, 'abc123')
  assert.deepEqual(cp.seenKeys, [])
})

test('o checkpoint de uma conta não é visível para outra', async () => {
  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, { novasChaves: ['a'] }, new Date(agora))
  assert.equal(await getCheckpoint(OUTRO, AUTOMACAO, ETAPA), null)
})

test('duas etapas da mesma automação têm checkpoints separados', async () => {
  await advanceCheckpoint(OWNER, AUTOMACAO, 'fonte-a', { novasChaves: ['x'] }, new Date(agora))
  await advanceCheckpoint(OWNER, AUTOMACAO, 'fonte-b', { novasChaves: ['y'] }, new Date(agora))
  assert.deepEqual((await getCheckpoint(OWNER, AUTOMACAO, 'fonte-a')).seenKeys, ['x'])
  assert.deepEqual((await getCheckpoint(OWNER, AUTOMACAO, 'fonte-b')).seenKeys, ['y'])
})

test('duas voltas seguidas acumulam, não substituem', async () => {
  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, { novasChaves: ['a'] }, new Date(agora))
  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, { novasChaves: ['b'] }, new Date(agora + 1000))
  const cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.deepEqual(cp.seenKeys, ['a', 'b'])
})

test('duas verificações simultâneas não perdem as chaves uma da outra', async () => {
  // O caso real: uma verificação agendada roda enquanto o dono clica em "Verificar
  // agora". Se o avanço lesse o checkpoint para depois gravá-lo, a segunda escrita
  // apagaria o que a primeira acabou de registrar — e esses itens voltariam como
  // novos no ciclo seguinte.
  await Promise.all([
    advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, { novasChaves: ['a', 'b'] }, new Date(agora)),
    advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, { novasChaves: ['c', 'd'] }, new Date(agora)),
  ])
  const cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.deepEqual([...cp.seenKeys].sort(), ['a', 'b', 'c', 'd'])
})
