// INTEGRATION: uma execução obsoleta não vai adiante, contra um mongod REAL e um
// servidor HTTP REAL.
//
// A execução é enfileirada com a fonte de agora e pode só ser processada minutos
// depois. Se nesse meio-tempo o dono mudou a rotina — outra URL, ou monitoramento
// desligado —, ela carrega uma fonte que ninguém mais pediu para vigiar.
//
// Continuar teria dois preços. O visível: buscar um endereço que o dono removeu,
// gastar tokens e entregar conteúdo que ele não quer mais. O invisível, e pior: o
// `beginCheck` dela veria "fingerprint diferente" e redefiniria o checkpoint para a
// fonte antiga — apagando a linha de base que a fonte nova acabou de formar.
//
// O servidor HTTP daqui existe para uma asserção só: se a porteira falhar, ele
// registra a visita. "Zero buscas" precisa ser medido, não deduzido.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'
// Deixa o teste alcançar o servidor que ele mesmo subiu. SÓ loopback — o resto da
// rede privada continua bloqueado, então os testes de SSRF seguem honestos. E é
// justamente por a URL ser alcançável que "zero buscas" vira uma prova: se a
// porteira deixasse passar, a requisição chegaria.
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { mongoClient, db } = await import('../dist/db.js')
const { createRoutine, updateRoutine } = await import('../dist/automations/routine.js')
const { createRun } = await import('../dist/automations/runService.js')
const { processRun } = await import('../dist/automations/runProcessor.js')
const { ensureSourceCheckpointIndexes, getCheckpoint } = await import('../dist/automations/sourceCheckpoint.js')

const OWNER = 'stale-owner'
const FLOOR = new ObjectId()
const BUILDING = new ObjectId()
const AGENT = new ObjectId()

const FEED = '<?xml version="1.0"?><rss><channel><item><title>Novidade</title><guid>g1</guid></item></channel></rss>'

let server
let base
let buscas = 0

before(async () => {
  await mongoClient.connect()
  await ensureSourceCheckpointIndexes()
  server = createServer((req, res) => {
    buscas++
    if ((req.url ?? '').startsWith('/feed')) {
      res.writeHead(200, { 'content-type': 'application/xml' })
      return res.end(FEED)
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end('<html><body><p>Conteúdo</p></body></html>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  buscas = 0
  await Promise.all([
    db.collection('automations').deleteMany({}),
    db.collection('automation_versions').deleteMany({}),
    db.collection('automation_runs').deleteMany({}),
    db.collection('automation_step_runs').deleteMany({}),
    db.collection('automation_deliveries').deleteMany({}),
    db.collection('source_checkpoints').deleteMany({}),
    db.collection('source_leases').deleteMany({}),
    db.collection('agents').deleteMany({}),
    db.collection('offices').deleteMany({}),
    db.collection('buildings').deleteMany({}),
  ])
  await db.collection('buildings').insertOne({ _id: BUILDING, ownerId: OWNER, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: FLOOR, ownerId: OWNER, buildingId: BUILDING, name: 'Térreo', status: 'active', createdAt: new Date() })
  await db.collection('agents').insertOne({ _id: AGENT, ownerId: OWNER, name: 'Ana', objective: 'Vigiar', officeId: FLOOR, activationModes: [] })
})

const specMonitor = (over = {}) => ({
  name: 'Vigia',
  objective: 'Avisar do que aparecer',
  recurrence: { kind: 'minutes', every: 15 },
  timezone: 'America/Sao_Paulo',
  source: { kind: 'rss', url: `${base}/feed.xml`, initialWindow: '24h' },
  ...over,
})

const specFixa = (over = {}) => ({
  name: 'Vigia',
  objective: 'Avisar do que aparecer',
  recurrence: { kind: 'daily', time: '09:00' },
  timezone: 'America/Sao_Paulo',
  ...over,
})

// Enfileira com a fonte de AGORA. O que acontecer com a rotina depois disto é o
// assunto de cada teste.
async function enfileirar(spec = specMonitor()) {
  const rotina = await createRoutine(OWNER, AGENT, spec)
  const { run } = await createRun(OWNER, rotina._id, { triggerType: 'schedule' })
  return { rotina, run }
}

const lerRun = (id) => db.collection('automation_runs').findOne({ _id: id })

async function conferirDescartada(runId, etapa) {
  const depois = await lerRun(runId)
  assert.equal(depois.status, 'succeeded', `${etapa}: descartar uma execução obsoleta não é falha`)
  assert.equal(depois.sourceOutcome, 'skipped_stale', etapa)
  assert.equal(buscas, 0, `${etapa}: a URL não pode nem ser consultada`)
  assert.equal(depois.usage.inputTokens + depois.usage.outputTokens, 0, `${etapa}: zero token`)
  assert.equal(await db.collection('automation_deliveries').countDocuments({}), 0, `${etapa}: nada foi entregue`)
  assert.equal(await db.collection('source_leases').countDocuments({}), 0, `${etapa}: nenhum lease foi tomado`)
  return depois
}

// --- o caso que motivou tudo ------------------------------------------------------------

test('monitoramento desligado depois de enfileirar: a execução antiga é descartada', async () => {
  const { rotina, run } = await enfileirar()
  // O dono desliga o monitoramento. A execução que já estava na fila continua
  // carregando a fonte RSS.
  await updateRoutine(OWNER, AGENT, rotina._id, specFixa({ source: { kind: 'fixed' } }))

  await processRun(run._id.toString())

  await conferirDescartada(run._id, 'desligou para fixa')
  assert.equal(await getCheckpoint(OWNER, rotina._id, 'source'), null, 'nem chegou a criar checkpoint')
})

test('URL trocada depois de enfileirar: idem, e o checkpoint da fonte NOVA fica intacto', async () => {
  const { rotina, run } = await enfileirar()

  // A fonte nova já formou a linha de base dela. É exatamente isto que uma execução
  // antiga apagaria ao reabrir o checkpoint com o fingerprint dela.
  await updateRoutine(OWNER, AGENT, rotina._id, specMonitor({ source: { kind: 'rss', url: `${base}/outro.xml`, initialWindow: '24h' } }))
  const { publishedSourceFingerprint } = await import('../dist/automations/routine.js')
  const { beginCheck, advanceCheckpoint } = await import('../dist/automations/sourceCheckpoint.js')
  const atual = await db.collection('automations').findOne({ _id: rotina._id })
  const versao = await db.collection('automation_versions').findOne({ automationId: rotina._id, version: atual.lastPublishedVersion })
  const fpNovo = publishedSourceFingerprint(versao.definition)
  await beginCheck(OWNER, rotina._id, 'source', fpNovo, new Date())
  await advanceCheckpoint(OWNER, rotina._id, 'source', fpNovo, { novasChaves: ['ja-visto'], baseline: true }, new Date())

  await processRun(run._id.toString())

  await conferirDescartada(run._id, 'trocou a URL')
  const cp = await getCheckpoint(OWNER, rotina._id, 'source')
  assert.equal(cp.sourceFingerprint, fpNovo, 'o checkpoint continua sendo o da fonte nova')
  assert.deepEqual(cp.seenKeys, ['ja-visto'], 'e a linha de base dela não foi apagada')
  assert.equal(cp.initialized, true)
})

test('religar a mesma URL também descarta a execução da vez anterior', async () => {
  const { rotina, run } = await enfileirar()
  await updateRoutine(OWNER, AGENT, rotina._id, specFixa({ source: { kind: 'fixed' } }))
  await updateRoutine(OWNER, AGENT, rotina._id, specMonitor())

  await processRun(run._id.toString())

  // Mesma URL, mesmo tipo — e mesmo assim obsoleta: entre uma vez e outra o feed
  // andou, e o que esta execução ia processar não é mais o que a rotina vigia.
  await conferirDescartada(run._id, 'religou')
})

// --- a rotina sumiu do mapa --------------------------------------------------------------

test('rotina apagada: a execução dela não sai consultando endereço por conta própria', async () => {
  const { rotina, run } = await enfileirar()
  await db.collection('automations').deleteOne({ _id: rotina._id })

  await processRun(run._id.toString())

  await conferirDescartada(run._id, 'rotina apagada')
})

test('versão publicada que sumiu: fecha na dúvida', async () => {
  const { rotina, run } = await enfileirar()
  // O ponteiro continua lá, a linha da versão não. Sem saber o que está publicado,
  // não dá para afirmar que esta fonte ainda vale.
  await db.collection('automation_versions').deleteMany({ automationId: rotina._id })

  await processRun(run._id.toString())

  await conferirDescartada(run._id, 'versão sumida')
})

test('rotina sem nada publicado: idem', async () => {
  const { rotina, run } = await enfileirar()
  await db.collection('automations').updateOne({ _id: rotina._id }, { $set: { lastPublishedVersion: null } })

  await processRun(run._id.toString())

  await conferirDescartada(run._id, 'nada publicado')
})

// --- e o controle: sem mudança, a execução roda -------------------------------------------

test('rotina intacta: a execução busca de verdade — a porteira não bloqueia todo mundo', async () => {
  // Sem este teste, `isCurrent` podendo devolver `false` sempre passaria em todos os
  // anteriores e quebraria o recurso inteiro em silêncio.
  const { rotina, run } = await enfileirar()

  await processRun(run._id.toString())

  const depois = await lerRun(run._id)
  assert.notEqual(depois.sourceOutcome, 'skipped_stale', 'nada mudou: esta execução é a atual')
  assert.equal(buscas, 1, 'e ela consultou o feed')
  // O checkpoint foi aberto para a fonte que ela carrega.
  const cp = await getCheckpoint(OWNER, rotina._id, 'source')
  assert.ok(cp, 'a execução atual abre o checkpoint normalmente')
})
