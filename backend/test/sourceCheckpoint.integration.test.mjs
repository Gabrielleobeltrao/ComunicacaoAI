// INTEGRATION: o checkpoint e o lease contra um mongod REAL.
//
// Duas promessas que não dá para testar com objeto em memória, porque o ponto delas
// é justamente o estado estar no banco: um redeploy no meio da madrugada não pode
// fazer a rotina reentregar as notícias de ontem, e duas execuções simultâneas não
// podem chamar a LLM duas vezes com o mesmo conteúdo.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const {
  acquireSourceLease,
  advanceCheckpoint,
  backfillSourceFingerprints,
  beginCheck,
  ensureSourceCheckpointIndexes,
  getCheckpoint,
  releaseSourceLease,
  LEASE_MS,
  MAX_SEEN_KEYS,
} = await import('../dist/automations/sourceCheckpoint.js')
const { detectRssChange, sourceFingerprint, INITIAL_WINDOWS } = await import('../dist/automations/sourceChange.js')

const OWNER = 'checkpoint-owner'
const OUTRO = 'checkpoint-outro'
const AUTOMACAO = new ObjectId()
const ETAPA = 'source'
const agora = Date.parse('2026-03-10T12:00:00Z')
const QUANDO = new Date(agora)

const FONTE = sourceFingerprint('rss', 'https://exemplo.test/feed.xml')
const OUTRA_FONTE = sourceFingerprint('rss', 'https://exemplo.test/mudou.xml')

// Em produção o runner SEMPRE abre a verificação antes de avançar: é o `beginCheck`
// que cria o documento, e `advanceCheckpoint` nunca cria nenhum. Os testes seguem o
// mesmo caminho, senão estariam exercitando uma sequência que não existe.
const verificarEAvancar = async (fingerprint, avanco, quando = QUANDO, stepId = ETAPA, ownerId = OWNER) => {
  await beginCheck(ownerId, AUTOMACAO, stepId, fingerprint, quando)
  await advanceCheckpoint(ownerId, AUTOMACAO, stepId, fingerprint, avanco, quando)
}

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
  await db.collection('source_leases').deleteMany({})
})

// --- o que já foi visto -----------------------------------------------------------------

test('sem checkpoint, a primeira volta enxerga o feed inteiro dentro da janela', async () => {
  assert.equal(await getCheckpoint(OWNER, AUTOMACAO, ETAPA), null)
  const estado = await beginCheck(OWNER, AUTOMACAO, ETAPA, FONTE, QUANDO)
  assert.equal(estado.initialized, false)
  const mudanca = detectRssChange(feed(['a', 'b']), estado.seenKeys, INITIAL_WINDOWS['24h'], agora, estado.initialized)
  assert.equal(mudanca.novos.length, 2)
})

test('depois de avançar, os mesmos itens não voltam — inclusive num processo novo', async () => {
  await verificarEAvancar(FONTE, { novasChaves: ['a', 'b'] })

  // "Reinício" aqui é ler o estado DE NOVO do banco, que é o que um processo novo
  // faria. Nada é reaproveitado de memória.
  const relido = await beginCheck(OWNER, AUTOMACAO, ETAPA, FONTE, QUANDO)
  assert.deepEqual(relido.seenKeys, ['a', 'b'])
  assert.equal(relido.initialized, true)

  const mudanca = detectRssChange(feed(['a', 'b']), relido.seenKeys, INITIAL_WINDOWS['24h'], agora, relido.initialized)
  assert.equal(mudanca.changed, false, 'um redeploy não pode reentregar o que já foi entregue')
})

test('só o que é realmente novo passa na segunda volta', async () => {
  await verificarEAvancar(FONTE, { novasChaves: ['a'] })
  const estado = await beginCheck(OWNER, AUTOMACAO, ETAPA, FONTE, QUANDO)
  const mudanca = detectRssChange(feed(['a', 'b']), estado.seenKeys, INITIAL_WINDOWS['24h'], agora, estado.initialized)
  assert.deepEqual(mudanca.novasChaves, ['b'])
})

test('um feed vazio FICA inicializado, e não reaplica a janela para sempre', async () => {
  // O caso que motivou o campo próprio: zero chave não é "nunca inicializado". Sem
  // isso, o primeiro item a aparecer seria julgado pela janela — e um item com data
  // antiga cairia fora dela e sumiria.
  await verificarEAvancar(FONTE, { novasChaves: [] })
  const estado = await beginCheck(OWNER, AUTOMACAO, ETAPA, FONTE, QUANDO)
  assert.deepEqual(estado.seenKeys, [])
  assert.equal(estado.initialized, true)
})

test('verificar e mudar são registrados em campos diferentes', async () => {
  await beginCheck(OWNER, AUTOMACAO, ETAPA, FONTE, QUANDO)
  let cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.deepEqual(cp.lastCheckedAt, QUANDO)
  // Verificou e não achou nada: `lastChangedAt` continua vazio. É isso que permite
  // à lista dizer "verificado agora, sem novidade desde terça".
  assert.equal(cp.lastChangedAt, null)

  const depois = new Date(agora + 60_000)
  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, FONTE, { novasChaves: ['novo'] }, depois)
  cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.deepEqual(cp.lastChangedAt, depois)
  assert.deepEqual(cp.lastCheckedAt, depois)
})

test('a linha de base não inventa uma novidade que não houve', async () => {
  // O avanço da estreia registra o que EXISTIA, sem nada ter sido entregue. Se ele
  // mexesse em `lastChangedAt`, a lista diria "última novidade agora" para uma
  // rotina que verificou e não achou nada — exatamente a confusão que a separação
  // entre "verificado" e "mudou" existe para evitar.
  await beginCheck(OWNER, AUTOMACAO, ETAPA, FONTE, QUANDO)
  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, FONTE, { novasChaves: ['velho'], baseline: true }, QUANDO)

  const cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.deepEqual(cp.seenKeys, ['velho'], 'a linha de base fica gravada')
  assert.equal(cp.initialized, true)
  assert.equal(cp.lastChangedAt, null, 'não houve novidade, então não há data de novidade')

  // E quando algo é de fato entregue, aí sim.
  const depois = new Date(agora + 60_000)
  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, FONTE, { novasChaves: ['novo'] }, depois)
  assert.deepEqual((await getCheckpoint(OWNER, AUTOMACAO, ETAPA)).lastChangedAt, depois)
})

test('a lista de chaves tem teto, e o que sai é o mais antigo', async () => {
  const muitas = Array.from({ length: MAX_SEEN_KEYS + 50 }, (_, i) => `k${i}`)
  await verificarEAvancar(FONTE, { novasChaves: muitas })
  const cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.equal(cp.seenKeys.length, MAX_SEEN_KEYS)
  assert.equal(cp.seenKeys.at(-1), muitas.at(-1))
  assert.ok(!cp.seenKeys.includes('k0'))
})

test('o checkpoint de HTTP guarda o hash, não a lista', async () => {
  await verificarEAvancar(FONTE, { contentHash: 'abc123' })
  const cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.equal(cp.contentHash, 'abc123')
  assert.deepEqual(cp.seenKeys, [])
})

test('o checkpoint de uma conta não é visível para outra', async () => {
  await verificarEAvancar(FONTE, { novasChaves: ['a'] })
  assert.equal(await getCheckpoint(OUTRO, AUTOMACAO, ETAPA), null)
})

test('duas etapas da mesma automação têm checkpoints separados', async () => {
  await verificarEAvancar(FONTE, { novasChaves: ['x'] }, QUANDO, 'fonte-a')
  await verificarEAvancar(FONTE, { novasChaves: ['y'] }, QUANDO, 'fonte-b')
  assert.deepEqual((await getCheckpoint(OWNER, AUTOMACAO, 'fonte-a')).seenKeys, ['x'])
  assert.deepEqual((await getCheckpoint(OWNER, AUTOMACAO, 'fonte-b')).seenKeys, ['y'])
})

test('duas voltas seguidas acumulam, não substituem', async () => {
  await verificarEAvancar(FONTE, { novasChaves: ['a'] })
  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, FONTE, { novasChaves: ['b'] }, new Date(agora + 1000))
  const cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.deepEqual(cp.seenKeys, ['a', 'b'])
})

test('duas verificações simultâneas não perdem as chaves uma da outra', async () => {
  // Se o avanço lesse o checkpoint para depois gravá-lo, a segunda escrita apagaria
  // o que a primeira acabou de registrar — e esses itens voltariam como novos.
  await beginCheck(OWNER, AUTOMACAO, ETAPA, FONTE, QUANDO)
  await Promise.all([
    advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, FONTE, { novasChaves: ['a', 'b'] }, QUANDO),
    advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, FONTE, { novasChaves: ['c', 'd'] }, QUANDO),
  ])
  const cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.deepEqual([...cp.seenKeys].sort(), ['a', 'b', 'c', 'd'])
})

// --- troca de fonte ---------------------------------------------------------------------

test('trocar a URL recomeça do zero: o que foi visto na anterior não vale', async () => {
  await verificarEAvancar(FONTE, { novasChaves: ['a', 'b'] })

  const estado = await beginCheck(OWNER, AUTOMACAO, ETAPA, OUTRA_FONTE, QUANDO)
  assert.deepEqual(estado.seenKeys, [], 'as chaves da fonte antiga não dizem nada sobre a nova')
  assert.equal(estado.initialized, false, 'a janela inicial vale de novo')
  assert.equal((await getCheckpoint(OWNER, AUTOMACAO, ETAPA)).sourceFingerprint, OUTRA_FONTE)
})

test('a mesma fonte NÃO recomeça: mudar foco ou horário não apaga nada', async () => {
  // O fingerprint só olha tipo + URL. Foco, horário, formato e destino não entram
  // nele de propósito: mudar qualquer um deles é ajustar a rotina, não trocar o que
  // ela vigia.
  await verificarEAvancar(FONTE, { novasChaves: ['a'] })
  const estado = await beginCheck(OWNER, AUTOMACAO, ETAPA, FONTE, QUANDO)
  assert.deepEqual(estado.seenKeys, ['a'])
  assert.equal(estado.initialized, true)
})

test('RSS → HTTP e HTTP → RSS são fontes diferentes, mesmo na mesma URL', async () => {
  const comoRss = sourceFingerprint('rss', 'https://exemplo.test/x')
  const comoHttp = sourceFingerprint('http', 'https://exemplo.test/x')
  await verificarEAvancar(comoRss, { novasChaves: ['item'] })

  const viraHttp = await beginCheck(OWNER, AUTOMACAO, ETAPA, comoHttp, QUANDO)
  assert.deepEqual(viraHttp.seenKeys, [])
  assert.equal(viraHttp.contentHash, null)

  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, comoHttp, { contentHash: 'h1' }, QUANDO)
  const voltaRss = await beginCheck(OWNER, AUTOMACAO, ETAPA, comoRss, QUANDO)
  assert.equal(voltaRss.contentHash, null, 'o hash da leitura HTTP não vale para o feed')
  assert.equal(voltaRss.initialized, false)
})

test('uma execução da fonte ANTIGA não consegue gravar no checkpoint da nova', async () => {
  // A corrida real: a execução começou com a URL antiga, o dono trocou a URL no meio
  // e a execução antiga terminou depois. Sem o fingerprint no filtro, ela gravaria
  // conteúdo de uma fonte dentro do checkpoint de outra.
  await beginCheck(OWNER, AUTOMACAO, ETAPA, OUTRA_FONTE, QUANDO)
  await advanceCheckpoint(OWNER, AUTOMACAO, ETAPA, FONTE, { novasChaves: ['da-fonte-velha'] }, QUANDO)

  const cp = await getCheckpoint(OWNER, AUTOMACAO, ETAPA)
  assert.equal(cp.sourceFingerprint, OUTRA_FONTE)
  assert.deepEqual(cp.seenKeys, [], 'o conteúdo da fonte velha não contamina a nova')
})

test('duas execuções que descobrem a troca ao mesmo tempo não zeram duas vezes', async () => {
  await verificarEAvancar(FONTE, { novasChaves: ['a'] })
  const [um, dois] = await Promise.all([
    beginCheck(OWNER, AUTOMACAO, ETAPA, OUTRA_FONTE, QUANDO),
    beginCheck(OWNER, AUTOMACAO, ETAPA, OUTRA_FONTE, QUANDO),
  ])
  assert.deepEqual(um.seenKeys, [])
  assert.deepEqual(dois.seenKeys, [])
  assert.equal((await getCheckpoint(OWNER, AUTOMACAO, ETAPA)).sourceFingerprint, OUTRA_FONTE)
})

// --- lease ------------------------------------------------------------------------------

test('só uma execução leva a fonte; a outra desiste', async () => {
  const primeira = await acquireSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, 'run-1', QUANDO)
  const segunda = await acquireSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, 'run-2', QUANDO)
  assert.equal(primeira, true)
  assert.equal(segunda, false, 'duas execuções não podem processar o mesmo conteúdo')
})

test('a corrida de verdade: dez execuções ao mesmo tempo, uma ganha', async () => {
  const resultados = await Promise.all(
    Array.from({ length: 10 }, (_, i) => acquireSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, `run-${i}`, QUANDO)),
  )
  assert.equal(resultados.filter(Boolean).length, 1)
})

test('liberado, o próximo pega', async () => {
  await acquireSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, 'run-1', QUANDO)
  await releaseSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, 'run-1')
  assert.equal(await acquireSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, 'run-2', QUANDO), true)
})

test('uma execução não libera o lease de outra', async () => {
  await acquireSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, 'run-1', QUANDO)
  await releaseSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, 'run-intruso')
  assert.equal(await acquireSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, 'run-2', QUANDO), false)
})

test('lease vencido é recuperado: um processo que morreu não trava a rotina', async () => {
  await acquireSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, 'run-morto', QUANDO)
  // Nada foi liberado — o processo simplesmente sumiu. Antes do prazo, ninguém entra.
  assert.equal(await acquireSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, 'run-novo', new Date(agora + LEASE_MS - 1000)), false)
  // Passado o prazo, a fonte volta a estar disponível.
  assert.equal(await acquireSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, 'run-novo', new Date(agora + LEASE_MS + 1000)), true)
})

test('o lease é por FONTE: trocar a URL não fica preso ao lease da anterior', async () => {
  await acquireSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, 'run-1', QUANDO)
  assert.equal(await acquireSourceLease(OWNER, AUTOMACAO, ETAPA, OUTRA_FONTE, 'run-2', QUANDO), true)
})

test('o lease de uma conta não bloqueia a outra', async () => {
  await acquireSourceLease(OWNER, AUTOMACAO, ETAPA, FONTE, 'run-1', QUANDO)
  assert.equal(await acquireSourceLease(OUTRO, AUTOMACAO, ETAPA, FONTE, 'run-2', QUANDO), true)
})

// --- migração ---------------------------------------------------------------------------

test('checkpoints anteriores ao fingerprint recebem identidade em vez de recomeçar', async () => {
  // Sem a migração, o primeiro `beginCheck` veria "fingerprint diferente" (ausente ≠
  // o atual), zeraria tudo e reentregaria o que já tinha sido entregue.
  await db.collection('source_checkpoints').insertOne({
    ownerId: OWNER,
    automationId: AUTOMACAO,
    stepId: ETAPA,
    seenKeys: ['ja-entregue'],
    contentHash: null,
    lastCheckedAt: QUANDO,
    lastChangedAt: QUANDO,
    updatedAt: QUANDO,
  })

  const carimbados = await backfillSourceFingerprints(async () => FONTE)
  assert.equal(carimbados, 1)

  const estado = await beginCheck(OWNER, AUTOMACAO, ETAPA, FONTE, QUANDO)
  assert.deepEqual(estado.seenKeys, ['ja-entregue'], 'nada foi apagado')
  assert.equal(estado.initialized, true, 'quem já tinha checkpoint já estava inicializado')

  // Roda uma vez só: na segunda não há mais o que carimbar.
  assert.equal(await backfillSourceFingerprints(async () => FONTE), 0)
})

test('checkpoint que não dá para identificar é deixado como está, não chutado', async () => {
  await db.collection('source_checkpoints').insertOne({
    ownerId: OWNER,
    automationId: AUTOMACAO,
    stepId: ETAPA,
    seenKeys: ['x'],
    contentHash: null,
    lastCheckedAt: QUANDO,
    lastChangedAt: null,
    updatedAt: QUANDO,
  })
  // Um fingerprint errado custaria silêncio; recomeçar custa uma reentrega. Entre os
  // dois, recomeçar é o erro barato.
  assert.equal(await backfillSourceFingerprints(async () => null), 0)
  assert.equal((await getCheckpoint(OWNER, AUTOMACAO, ETAPA)).sourceFingerprint, undefined)
})
