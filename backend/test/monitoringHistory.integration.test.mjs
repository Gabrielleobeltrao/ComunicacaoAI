// O HISTÓRICO OPERACIONAL — o que aconteceu, nunca o que passou por dentro.
//
// A aba mostrava contadores acumulados: "12 leituras boas, 3 falhas". Isso não responde
// nenhuma das perguntas de quem abre isto às três da manhã — quando parou, quanto demorou,
// quantas linhas vieram, qual foi o erro, e se aquele Flow disparou por causa desta fonte.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { mongoClient, db } = await import('../dist/db.js')
const svc = await import('../dist/monitoring/service.js')
const hist = await import('../dist/monitoring/history.js')
const { ensureDataHistoryIndexes } = await import('../dist/dataHistory/store.js')

const DONO = 'dono-historico'
let servidor
let porta
let corpo

before(async () => {
  await mongoClient.connect()
  await svc.ensureMonitoringIndexes()
  await hist.ensureMonitoringHistoryIndexes()
  await ensureDataHistoryIndexes()
  servidor = createServer((req, res) => {
    if (req.url?.startsWith('/erro')) {
      res.writeHead(503, { 'content-type': 'application/json' })
      return res.end('{"detail":"fora do ar"}')
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(corpo)
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  porta = servidor.address().port
})

after(async () => {
  servidor?.close()
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['monitoring_sources', 'monitoring_events', 'data_recorders', 'data_history_records', 'monitors', 'monitor_states', 'automations', 'automation_versions', 'automation_runs', 'buildings', 'offices', 'dataset_definitions', 'data_stores'])
    await db.collection(c).deleteMany({})
  corpo = JSON.stringify({ dados: { preco: '10,50' } })
})

/** Ativa a fonte: sem isso ela não tem recorder, e uma leitura grava zero — de propósito. */
const noAr = async (over = {}) => {
  const f = await svc.createSource(DONO, entrada(over))
  await svc.testSource(DONO, await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')
  return await svc.getSource(DONO, f._id)
}

const entrada = (over = {}) => ({
  name: 'Fonte com histórico',
  kind: 'api_polling',
  config: { url: `http://127.0.0.1:${porta}/precos`, method: 'GET' },
  mapping: { version: 1, fields: [{ to: 'preco', from: 'dados.preco', transforms: [{ op: 'number' }], required: true }] },
  cadence: { mode: 'interval', intervalMs: 60_000 },
  destination: { history: true },
  ...over,
})

test('ACEITAÇÃO: cada coleta vira uma linha com instante, status, duração e quantidade', async () => {
  const f = await noAr()
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))

  // Testar não entra no log de coleta: o teste prova a configuração, a coleta é o trabalho.
  const { items } = await hist.listarEventos(DONO, { kind: 'collect' })
  assert.equal(items.length, 1)
  const e = items[0]
  assert.equal(e.kind, 'collect')
  assert.equal(e.outcome, 'ok')
  assert.equal(e.sourceId, f._id.toString())
  assert.equal(e.sourceName, 'Fonte com histórico')
  assert.equal(e.rows, 1)
  assert.equal(e.recorded, 1)
  assert.ok(e.at instanceof Date)
  assert.ok(typeof e.durationMs === 'number')
})

test('a falha entra com CÓDIGO e mensagem legível', async () => {
  const f = await svc.createSource(DONO, entrada({ config: { url: `http://127.0.0.1:${porta}/erro`, method: 'GET' } }))
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))

  const { items } = await hist.listarEventos(DONO, { outcome: 'failed' })
  assert.equal(items.length, 1)
  assert.ok(items[0].errorCode, 'o código é para filtrar')
  assert.ok(items[0].errorMessage, 'a mensagem é para ler')
})

test('a mensagem de erro é REDIGIDA: um log aberto numa tela não pode carregar credencial', async () => {
  // A Central já recusa criar fonte com chave na URL. Isto cobre o outro caminho: a
  // mensagem que o outro lado devolve, que ninguém controla.
  const f = await svc.createSource(DONO, entrada())
  await hist.registrarEvento({
    ownerId: DONO,
    sourceId: f._id,
    sourceName: f.name,
    kind: 'collect',
    outcome: 'failed',
    errorCode: 'http',
    errorMessage: 'falhou em https://api.exemplo.test/x?api_key=nao-pode-vazar com Bearer abc.def.ghi',
  })
  const { items } = await hist.listarEventos(DONO, { outcome: 'failed' })
  assert.ok(!items[0].errorMessage.includes('nao-pode-vazar'), `a chave vazou: ${items[0].errorMessage}`)
  assert.ok(!items[0].errorMessage.includes('abc.def.ghi'), `o token vazou: ${items[0].errorMessage}`)
  assert.match(items[0].errorMessage, /«oculto»/)
})

test('"não mudou" é um resultado próprio: saúde é uma coisa, novidade é outra', async () => {
  const f = await noAr()
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))

  const { items } = await hist.listarEventos(DONO, { kind: 'collect' })
  assert.deepEqual(items.map((i) => i.outcome), ['unchanged', 'ok'])
})

test('o log NÃO guarda o conteúdo lido', async () => {
  corpo = JSON.stringify({ dados: { preco: '10,50', segredoDoCliente: 'jamais-no-log' } })
  const f = await noAr()
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))

  const bruto = await db.collection('monitoring_events').find({ ownerId: DONO }).toArray()
  assert.ok(!JSON.stringify(bruto).includes('jamais-no-log'), 'um log de operação que guarda payload é o lugar mais fácil de vazar')
})

test('filtra por fonte, por tipo e por resultado', async () => {
  const boa = await noAr({ name: 'Boa' })
  const ruim = await svc.createSource(DONO, entrada({ name: 'Ruim', config: { url: `http://127.0.0.1:${porta}/erro`, method: 'GET' } }))
  await svc.readSourceOnce(await svc.getSource(DONO, boa._id))
  await svc.readSourceOnce(await svc.getSource(DONO, ruim._id))

  assert.equal((await hist.listarEventos(DONO)).items.length, 2)
  assert.equal((await hist.listarEventos(DONO, { sourceId: boa._id })).items.length, 1)
  assert.equal((await hist.listarEventos(DONO, { outcome: 'failed' })).items[0].sourceName, 'Ruim')
  assert.equal((await hist.listarEventos(DONO, { kind: 'delivery' })).items.length, 0)
})

test('pagina do mais recente para trás, sem repetir nem pular no empate', async () => {
  const f = await svc.createSource(DONO, entrada())
  // Vinte eventos no mesmo instante: paginar por instante repetiria o empate ou pularia um.
  const agora = new Date()
  for (let i = 0; i < 20; i++) {
    await hist.registrarEvento({ ownerId: DONO, sourceId: f._id, sourceName: f.name, kind: 'collect', outcome: 'ok', at: agora, rows: i })
  }

  const vistos = new Set()
  let cursor = null
  let paginas = 0
  do {
    const p = await hist.listarEventos(DONO, { limit: 7, cursor })
    for (const i of p.items) {
      assert.ok(!vistos.has(i.id), 'nenhum evento pode aparecer duas vezes')
      vistos.add(i.id)
    }
    cursor = p.nextCursor
    paginas += 1
  } while (cursor && paginas < 10)

  assert.equal(vistos.size, 20, 'nenhum evento pode ser pulado')
})

test('a conta de um não enxerga a do outro', async () => {
  const f = await noAr()
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  assert.equal((await hist.listarEventos('vizinho')).items.length, 0)
})

test('o log é observação: uma falha de escrita nele não derruba a coleta', async () => {
  const f = await svc.createSource(DONO, entrada())
  // Um evento impossível (sourceName gigantesco já é cortado; aqui o insert falha de fato
  // porque a coleção some no meio) não pode virar exceção para quem chamou.
  await hist.registrarEvento({ ownerId: DONO, sourceId: f._id, sourceName: 'x'.repeat(5000), kind: 'collect', outcome: 'ok' })
  const { items } = await hist.listarEventos(DONO)
  assert.equal(items[0].sourceName.length, 160, 'o nome é cortado, e não recusado')
})

// --- o fio entre a fonte, o monitor e o Flow ---------------------------------------------
//
// "Este Flow disparou por causa desta fonte?" não tinha resposta em lugar nenhum: o painel
// de execuções sabe do Flow, o monitor sabe da condição, e ninguém guardava o fio.

test('ACEITAÇÃO: o disparo entra no histórico com o monitor e a execução', async () => {
  const { registerDatabaseMonitors, resetDispatchListeners } = await import('../dist/monitors/dataSource.js')
  const { resetRecordListeners } = await import('../dist/dataHistory/store.js')
  const { ensureMonitorIndexes } = await import('../dist/monitors/state.js')
  const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
  const { createAutomation, publishAutomation, setStatus } = await import('../dist/automations/service.js')
  await ensureMonitorIndexes()
  await ensureRunIndexes()

  resetRecordListeners()
  resetDispatchListeners()
  registerDatabaseMonitors()
  hist.registerMonitoringHistoryBridge()
  // A ponte registra o ouvinte por import dinâmico: um tique de laço basta para ela existir.
  await new Promise((r) => setImmediate(r))

  // Um Flow mora num andar, como todo Flow desta plataforma.
  const predio = new ObjectId()
  const andar = new ObjectId()
  await db.collection('buildings').insertOne({ _id: predio, ownerId: DONO, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: andar, ownerId: DONO, buildingId: predio, name: 'Térreo', status: 'active', createdAt: new Date() })

  const flow = await createAutomation(DONO, {
    floorId: andar.toString(),
    name: 'Avisar o time',
    definition: {
      trigger: { type: 'manual' },
      steps: [{ id: 'r', type: 'transform.template', name: 'Resumo', enabled: true, config: { template: 'viu: {{input}}' } }],
      resultFormat: 'markdown',
      deliveries: [],
      limits: { maxSteps: 10, maxDurationMs: 60_000, maxTokens: 10_000 },
    },
  })
  await publishAutomation(DONO, flow._id, DONO)
  await setStatus(DONO, flow._id, 'active')

  const f = await noAr({ name: 'Preço vigiado' })
  const m = await svc.createMonitorForSource(DONO, f._id, {
    name: 'Preço abaixo de 100',
    condition: { kind: 'compare', field: 'preco', op: 'lt', value: 100 },
    triggerMode: 'enter',
    debounceMs: 0,
    cooldownMs: 0,
    flowId: flow._id.toString(),
  })
  await db.collection('monitors').updateOne({ _id: new ObjectId(m.id) }, { $set: { status: 'published' } })

  const leitura = await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  assert.ok(leitura.recorded > 0, 'sem registro gravado não há o que observar')
  // O ouvinte de gravação é assíncrono: ele roda depois que o registro existe.
  await new Promise((r) => setTimeout(r, 300))

  const { items } = await hist.listarEventos(DONO, { kind: 'dispatch' })
  assert.equal(items.length, 1, 'o disparo precisa aparecer no histórico da fonte')
  assert.equal(items[0].sourceName, 'Preço vigiado')
  assert.equal(items[0].monitorId, m.id)
  assert.equal(items[0].monitorName, 'Preço abaixo de 100')
  assert.ok(items[0].runId, 'e com a execução que ele pediu — é ela que liga o Flow à fonte')

  resetRecordListeners()
  resetDispatchListeners()
})
