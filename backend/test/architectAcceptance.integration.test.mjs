// OS TESTES DE ACEITAÇÃO — a diferença entre "criado" e "funciona".
//
// No V1, "pronto" queria dizer "o documento existe". Estes casos protegem a outra
// definição: pronto é o que passou num teste observável, e o que não passou não entra no ar.
//
// A fonte é testada contra um servidor HTTP DE VERDADE, subido aqui. Um mock devolvendo o
// que o teste espera provaria só que o mock funciona.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
// O guarda de SSRF recusa loopback por padrão. Os casos felizes precisam do alvo local.
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { mongoClient, db } = await import('../dist/db.js')
const { runAcceptanceTests, acceptanceChecklist, acceptanceBlockers, activatableKeys } = await import('../dist/architect/acceptance.js')
const t2 = await import('../dist/architect/typesV2.js')
const svc = await import('../dist/monitoring/service.js')
const { createMonitor } = await import('../dist/monitors/service.js')
const { createDataStore, createDataset } = await import('../dist/databases/store.js')
const { ensureExecutionRootIndexes } = await import('../dist/executionRoots.js')

const DONO = 'dono-aceitacao'
let servidor
let porta
let corpo = { rsi: 22.5, nome: 'CXSE3' }

before(async () => {
  await mongoClient.connect()
  await ensureExecutionRootIndexes()
  servidor = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(corpo))
  })
  await new Promise((r) => servidor.listen(0, r))
  porta = servidor.address().port
})
after(async () => {
  servidor?.close()
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['monitoring_sources', 'monitors', 'agents', 'offices', 'automations', 'data_stores', 'dataset_definitions', 'execution_roots'])
    await db.collection(c).deleteMany({})
  corpo = { rsi: 22.5, nome: 'CXSE3' }
})

const teste = (over) => ({ key: 't1', kind: 'source', targetKey: 'fonte', expectation: 'responde', required: true, ...over })

const rodar = (testes, mapa) => {
  const bp = t2.emptyBlueprintV2('T', 'O', 'create')
  bp.acceptanceTests = testes
  return runAcceptanceTests({ ownerId: DONO, blueprint: bp, resourceMap: new Map(mapa), operationId: new ObjectId() })
}

const criarFonte = async (over = {}) =>
  svc.createSource(DONO, {
    name: 'Cotações',
    kind: 'api_polling',
    config: { url: `http://127.0.0.1:${porta}/c`, method: 'GET' },
    mapping: { version: 1, fields: [{ to: 'rsi', from: 'rsi', transforms: [{ op: 'number' }], required: true }] },
    cadence: { mode: 'interval', intervalMs: 60_000 },
    destination: { history: true },
    ...over,
  })

// --- fonte: o teste bate na origem de verdade -------------------------------------------------

test('ACEITAÇÃO: a fonte que responde e traz o campo obrigatório PASSA', async () => {
  const fonte = await criarFonte()
  const [r] = await rodar([teste()], [['source:fonte', fonte._id.toString()]])
  assert.equal(r.status, 'passed', r.observed)
  assert.match(r.observed, /respondeu/)
})

test('a fonte que responde mas NÃO traz o campo obrigatório reprova', async () => {
  // O servidor responde 200 com um corpo sem `rsi`. É o caso perigoso: a fonte parece
  // viva, e o monitor em cima dela nunca dispararia.
  corpo = { outra: 1 }
  const fonte = await criarFonte()
  const [r] = await rodar([teste()], [['source:fonte', fonte._id.toString()]])
  assert.equal(r.status, 'failed', r.observed)
  assert.match(r.observed, /não trouxe rsi/)
})

test('a fonte que não responde reprova com o motivo', async () => {
  const fonte = await criarFonte({ config: { url: 'http://127.0.0.1:1/nada', method: 'GET' } })
  const [r] = await rodar([teste()], [['source:fonte', fonte._id.toString()]])
  assert.equal(r.status, 'failed')
  assert.match(r.observed, /não respondeu/)
})

test('a fonte que não foi criada nesta aplicação fica `skipped`, e não aprovada', async () => {
  const [r] = await rodar([teste()], [])
  assert.equal(r.status, 'skipped')
  assert.notEqual(r.status, 'passed', 'ausência de recurso não é prova de nada')
})

// --- o resultado entra na Activity -------------------------------------------------------------

test('cada teste deixa uma execução em ambiente `test` na Activity', async () => {
  const fonte = await criarFonte()
  await rodar([teste()], [['source:fonte', fonte._id.toString()]])

  const raiz = await db.collection('execution_roots').findOne({ ownerId: DONO })
  assert.ok(raiz, 'sem raiz de execução o resultado não aparece na linha do tempo')
  assert.equal(raiz.environment, 'test', 'um teste não pode contar como produção')
  assert.equal(raiz.status, 'succeeded')
  assert.equal(raiz.source, 'manual')
})

test('um teste reprovado marca a execução como falha, com o tipo do erro', async () => {
  corpo = { outra: 1 }
  const fonte = await criarFonte()
  await rodar([teste()], [['source:fonte', fonte._id.toString()]])
  const raiz = await db.collection('execution_roots').findOne({ ownerId: DONO })
  assert.equal(raiz.status, 'failed')
  assert.equal(raiz.errorKind, 'acceptance_failed')
})

// --- monitor: a regra dispara na transição que ela descreve ---------------------------------------

const criarMonitorDe = async (condition, over = {}) => {
  const store = await createDataStore(DONO, { name: 'Base', adapterKind: 'data_history' })
  await createDataset(DONO, store._id, { key: 'candles', name: 'C', schema: { type: 'object', properties: { rsi: {} } } })
  return createMonitor(DONO, {
    name: 'RSI',
    source: { kind: 'database', dataStoreId: store._id, datasetKey: 'candles' },
    condition,
    triggerMode: 'enter',
    threshold: 30,
    thresholdField: 'rsi',
    debounceMs: 0,
    cooldownMs: 0,
    ...over,
  })
}

test('ACEITAÇÃO: a regra que reconhece a própria transição PASSA', async () => {
  const m = await criarMonitorDe({ kind: 'compare', field: 'rsi', op: 'lt', value: 30 })
  const [r] = await rodar([teste({ kind: 'monitor_simulation', targetKey: 'mon' })], [['monitor:mon', m._id.toString()]])
  assert.equal(r.status, 'passed', r.observed)
})

test('a regra que NÃO dispara na própria transição reprova', async () => {
  // "maior que 30" com a transição 31 → 29 não entra: é o erro clássico de escrever a
  // comparação invertida, e publicar isso entregaria um monitor que nunca fala.
  const m = await criarMonitorDe({ kind: 'compare', field: 'rsi', op: 'gt', value: 30 })
  const [r] = await rodar([teste({ kind: 'monitor_simulation', targetKey: 'mon' })], [['monitor:mon', m._id.toString()]])
  assert.equal(r.status, 'failed', r.observed)
  assert.match(r.observed, /não disparou/)
})

// --- Flow, agente e Database ----------------------------------------------------------------------

test('o Flow com dependência órfã reprova, dizendo qual passo', async () => {
  const id = new ObjectId()
  await db.collection('automations').insertOne({
    _id: id,
    ownerId: DONO,
    name: 'F',
    definition: { steps: [{ id: 'a', name: 'Resumir', dependsOn: ['nao-existe'] }] },
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  const [r] = await rodar([teste({ kind: 'flow', targetKey: 'flow' })], [['flow:flow', id.toString()]])
  assert.equal(r.status, 'failed')
  assert.match(r.observed, /Resumir → nao-existe/)
})

test('o agente SEM função escrita reprova — a responsabilidade nunca fica vazia', async () => {
  const id = new ObjectId()
  await db.collection('agents').insertOne({ _id: id, ownerId: DONO, name: 'Sem função', role: '   ', createdAt: new Date() })
  const [r] = await rodar([teste({ kind: 'agent_contract', targetKey: 'ag' })], [['agent:ag', id.toString()]])
  assert.equal(r.status, 'failed')
  assert.match(r.observed, /sem função escrita/)
})

test('o Database sem conjunto reprova: não há o que ler nem gravar', async () => {
  const store = await createDataStore(DONO, { name: 'Vazio', adapterKind: 'data_history' })
  const [r] = await rodar([teste({ kind: 'database_permission', targetKey: 'db' })], [['database:db', store._id.toString()]])
  assert.equal(r.status, 'failed')
  assert.match(r.observed, /nenhum conjunto/)
})

test('AMEAÇA: um Database de OUTRA conta reprova em vez de responder', async () => {
  const alheio = await createDataStore('vizinho', { name: 'Do vizinho', adapterKind: 'data_history' })
  const [r] = await rodar([teste({ kind: 'database_permission', targetKey: 'db' })], [['database:db', alheio._id.toString()]])
  assert.equal(r.status, 'failed')
  assert.match(r.observed, /não existe mais nesta conta/)
})

// --- o que não dá para observar fica pendente, nunca aprovado ----------------------------------------

test('canal, dry-run e entrega ficam PENDENTES com o motivo — jamais aprovados', async () => {
  const rs = await rodar(
    [
      teste({ key: 'a', kind: 'channel', targetKey: 'x' }),
      teste({ key: 'b', kind: 'app_dry_run', targetKey: 'y' }),
      teste({ key: 'c', kind: 'delivery', targetKey: 'z' }),
    ],
    [],
  )
  for (const r of rs) {
    assert.equal(r.status, 'pending', `${r.kind} não pode ser aprovado sem ninguém observar nada`)
    assert.ok(r.observed.length > 20, 'a pendência precisa dizer o que fazer')
  }
})

// --- do resultado para a prontidão e para a ativação ---------------------------------------------------

test('o item de checklist do teste não pode ser marcado à mão', () => {
  const itens = acceptanceChecklist([
    { key: 'a', kind: 'source', targetKey: 'f', required: true, status: 'failed', observed: 'não respondeu', at: new Date() },
  ])
  assert.equal(itens[0].completionMode, 'test_result')
  assert.equal(itens[0].status, 'blocked')
})

test('só o obrigatório que não passou vira bloqueio', () => {
  const b = acceptanceBlockers([
    { key: 'a', kind: 'source', targetKey: 'f', required: true, status: 'failed', observed: 'caiu', at: new Date() },
    { key: 'b', kind: 'delivery', targetKey: 'd', required: false, status: 'pending', observed: 'confirme', at: new Date() },
    { key: 'c', kind: 'flow', targetKey: 'x', required: true, status: 'passed', observed: 'ok', at: new Date() },
  ])
  assert.equal(b.length, 1)
  assert.match(b[0], /caiu/)
})

test('ATIVAÇÃO: só entra na lista o alvo cujo teste passou', () => {
  const ativaveis = activatableKeys(
    [
      { key: 'a', kind: 'source', targetKey: 'boa', required: true, status: 'passed', observed: 'ok', at: new Date() },
      { key: 'b', kind: 'source', targetKey: 'ruim', required: true, status: 'failed', observed: 'caiu', at: new Date() },
      { key: 'c', kind: 'source', targetKey: 'incerta', required: false, status: 'pending', observed: '?', at: new Date() },
    ],
    'source',
  )
  assert.deepEqual([...ativaveis], ['boa'])
})

test('AMEAÇA: um alvo com dois testes, um passando e um falhando, NÃO é ativável', () => {
  const ativaveis = activatableKeys(
    [
      { key: 'a', kind: 'source', targetKey: 'f', required: true, status: 'passed', observed: 'ok', at: new Date() },
      { key: 'b', kind: 'source', targetKey: 'f', required: true, status: 'failed', observed: 'caiu', at: new Date() },
    ],
    'source',
  )
  assert.equal(ativaveis.size, 0, 'o que reprova manda: ligar assim seria escolher a evidência conveniente')
})

test('um alvo SEM teste declarado não é ativável', () => {
  assert.equal(activatableKeys([], 'source').size, 0, 'ausência de teste não é prova')
})
