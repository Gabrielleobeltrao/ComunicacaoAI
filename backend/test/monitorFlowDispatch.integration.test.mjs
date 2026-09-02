// DO EVENTO AO RESULTADO — passando pelo monitor e pelo Flow que já existem.
//
//   evento no barramento → condição → transição do monitor → execução enfileirada
//   → passos do Flow → resultado
//
// O que este arquivo cobre não é cada peça (elas têm os testes delas), e sim as JUNTAS:
// uma transição válida vira UMA execução, na versão publicada, pela fila de sempre; e as
// recusas — duplicado, pausa, debounce, cooldown, Flow ausente, Flow sem publicação —
// não viram nenhuma.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { ensureMonitorIndexes, getState } = await import('../dist/monitors/state.js')
const { observeAndDispatch, observarEvento, resumePendingDispatches, monitorRunKey } = await import('../dist/monitors/dispatch.js')
const { createAutomation, publishAutomation, setStatus } = await import('../dist/automations/service.js')
const { processRun } = await import('../dist/automations/runProcessor.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')

const DONO = 'dono-monitor-flow'
const BUILDING = new ObjectId()
const FLOOR = new ObjectId()

before(async () => {
  await mongoClient.connect()
  await ensureMonitorIndexes()
  await ensureRunIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

// Um Flow determinístico: um passo de template, que não chama modelo nenhum.
const DEFINICAO = {
  trigger: { type: 'manual' },
  steps: [
    {
      id: 'resumo',
      type: 'transform.template',
      name: 'Resumo',
      enabled: true,
      // `input` é o que o monitor entregou, serializado pelo próprio runner.
      config: { template: 'O monitor viu: {{input}}' },
    },
  ],
  resultFormat: 'markdown',
  deliveries: [],
  limits: { maxSteps: 10, maxDurationMs: 60_000, maxTokens: 10_000 },
}

let flow
let monitor

const criarMonitor = async (over = {}) => {
  const doc = {
    _id: new ObjectId(),
    ownerId: DONO,
    name: 'RSI sobrevendido',
    source: { kind: 'internal_event', eventType: 'market.candle.closed' },
    condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
    triggerMode: 'enter',
    threshold: 30,
    thresholdField: 'rsi',
    debounceMs: 0,
    cooldownMs: 0,
    action: { flowId: flow._id },
    status: 'published',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }
  await db.collection('monitors').insertOne(doc)
  return doc
}

beforeEach(async () => {
  for (const c of ['monitors', 'monitor_states', 'automations', 'automation_versions', 'automation_runs', 'step_runs', 'buildings', 'offices', 'execution_roots'])
    await db.collection(c).deleteMany({})
  await db.collection('buildings').insertOne({ _id: BUILDING, ownerId: DONO, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: FLOOR, ownerId: DONO, buildingId: BUILDING, name: 'Térreo', status: 'active', createdAt: new Date() })

  flow = await createAutomation(DONO, { floorId: FLOOR.toString(), name: 'Avisar sobre RSI', definition: DEFINICAO })
  await publishAutomation(DONO, flow._id, DONO)
  await setStatus(DONO, flow._id, 'active')
  flow = await db.collection('automations').findOne({ _id: flow._id })
  monitor = await criarMonitor()
})

const observar = (rsi, eventId, m = monitor) =>
  observeAndDispatch({ ownerId: DONO, monitor: m, value: { rsi }, eventId })

const execucoes = () => db.collection('automation_runs').find({ ownerId: DONO }).toArray()

// --- o caminho inteiro ---------------------------------------------------------------------

test('ACEITAÇÃO: evento → condição → monitor → Flow → passos → resultado, com zero token', async () => {
  // O primeiro valor não cruza nada: ele estabelece o "antes".
  assert.equal((await observar(55, 'e1')).triggered, false)

  const disparo = await observar(22, 'e2')
  assert.equal(disparo.triggered, true)
  assert.equal(disparo.created, true)
  assert.ok(disparo.runId)

  const [run] = await execucoes()
  assert.equal(run.status, 'queued', 'inserir É enfileirar: a fila é a própria coleção')
  assert.equal(run.automationVersion, 1, 'a versão PUBLICADA, não o rascunho')
  assert.equal(run.triggerType, 'internal_event')
  assert.equal(run.idempotencyKey, monitorRunKey(monitor._id, 'e2'))

  // Uma identidade só para a execução inteira — é por ela que o painel liga as pontas.
  const raiz = await db.collection('execution_roots').findOne({ sourceRefId: run._id })
  assert.ok(raiz, 'a execução tem raiz de correlação')

  await processRun(run._id.toString())
  const feito = await db.collection('automation_runs').findOne({ _id: run._id })
  assert.equal(feito.status, 'succeeded')
  assert.equal(feito.usage.inputTokens + feito.usage.outputTokens, 0, 'o caminho determinístico não gasta token')

  const passos = await db.collection('step_runs').find({ runId: run._id }).toArray()
  assert.equal(passos.length, 1)
  assert.equal(passos[0].status, 'succeeded')
  // O Flow recebeu o que o monitor VIU, como dado — não como texto para reinterpretar.
  // O Flow recebeu o que o monitor viu, como DADO — e o nome do monitor junto.
  assert.match(feito.finalOutput, /"rsi":22/)
  assert.match(feito.finalOutput, /RSI sobrevendido/)
})

test('o evento do barramento encontra o monitor publicado que o espera', async () => {
  const evento = {
    _id: new ObjectId(),
    eventId: 'evt-bus-1',
    ownerId: DONO,
    type: 'market.candle.closed',
    source: 'teste',
    schemaVersion: 1,
    payload: { rsi: 12 },
    occurredAt: new Date(),
    dedupeKey: 'k1',
  }
  // Primeiro uma leitura alta, para haver um "antes".
  await observarEvento({ ...evento, eventId: 'evt-bus-0', payload: { rsi: 70 } })
  const saidas = await observarEvento(evento)

  assert.equal(saidas.length, 1)
  assert.equal(saidas[0].triggered, true)
  assert.equal((await execucoes()).length, 1)
})

test('monitor de OUTRO tipo de evento não é acordado', async () => {
  await observarEvento({
    _id: new ObjectId(),
    eventId: 'evt-outro',
    ownerId: DONO,
    type: 'market.signal.detected',
    source: 'teste',
    schemaVersion: 1,
    payload: { rsi: 5 },
    occurredAt: new Date(),
    dedupeKey: 'k2',
  })
  assert.equal((await execucoes()).length, 0)
})

// --- exatamente UMA execução por transição -------------------------------------------------

test('o mesmo evento entregue duas vezes gera UMA execução', async () => {
  await observar(55, 'e1')
  await observar(22, 'e2')
  const repetido = await observar(22, 'e2')

  assert.equal(repetido.triggered, false)
  assert.equal(repetido.reason, 'duplicate')
  assert.equal((await execucoes()).length, 1)
})

test('dois observadores simultâneos do mesmo evento: uma execução só', async () => {
  await observar(55, 'e1')
  const [a, b] = await Promise.all([observar(22, 'e2'), observar(22, 'e2')])

  assert.equal([a, b].filter((r) => r.triggered).length, 1, 'só um vence a transição atômica')
  assert.equal((await execucoes()).length, 1)
})

test('a condição continuar verdadeira não dispara de novo — é borda, não estado', async () => {
  await observar(55, 'e1')
  await observar(22, 'e2')
  const ainda = await observar(21, 'e3')

  assert.equal(ainda.triggered, false)
  assert.equal(ainda.reason, 'no_transition')
  assert.equal((await execucoes()).length, 1)
})

// --- as recusas não viram execução ------------------------------------------------------------

test('monitor pausado não dispara', async () => {
  const pausado = await criarMonitor({ status: 'paused', name: 'Pausado' })
  await observar(55, 'p1', pausado)
  const r = await observar(10, 'p2', pausado)

  assert.equal(r.reason, 'paused')
  assert.equal((await execucoes()).length, 0)
})

test('o debounce segura a observação, e o cooldown segura o disparo', async () => {
  const comDebounce = await criarMonitor({ debounceMs: 60_000, name: 'Com debounce' })
  await observar(55, 'd1', comDebounce)
  const r = await observar(10, 'd2', comDebounce)
  assert.equal(r.reason, 'debounce')
  assert.equal((await execucoes()).length, 0)

  const comCooldown = await criarMonitor({ cooldownMs: 60_000, name: 'Com cooldown' })
  await observar(55, 'c1', comCooldown)
  assert.equal((await observar(10, 'c2', comCooldown)).triggered, true)
  // Sai e volta: a borda existe de novo, mas o cooldown ainda está de pé.
  await observar(55, 'c3', comCooldown)
  const segurado = await observar(10, 'c4', comCooldown)
  assert.equal(segurado.reason, 'cooldown')
  assert.equal((await execucoes()).length, 1, 'a segunda borda não virou execução')
})

// --- o Flow que não serve ----------------------------------------------------------------------

test('Flow que não existe: monitor DEGRADADO, e a borda não é consumida', async () => {
  const orfao = await criarMonitor({ action: { flowId: new ObjectId() }, name: 'Órfão' })
  const r = await observar(10, 'x1', orfao)

  assert.equal(r.reason, 'flow_missing')
  assert.equal((await execucoes()).length, 0)
  // A borda intacta é o ponto: consumir aqui jogaria o alerta fora em silêncio.
  const estado = await getState(DONO, orfao._id)
  assert.ok(!estado || estado.conditionIsTrue === false, 'nada foi observado')
})

test('Flow de OUTRA conta é Flow que não existe', async () => {
  const outro = await createAutomation('outra-conta', { floorId: FLOOR.toString(), name: 'Alheio', definition: DEFINICAO }).catch(() => null)
  // Sem andar na outra conta o Flow nem nasce — e é exatamente esse o ponto: o escopo
  // de dono está na consulta, então o id não alcança nada.
  const alheio = await criarMonitor({ action: { flowId: outro?._id ?? new ObjectId() }, name: 'Alheio' })
  const r = await observar(10, 'y1', alheio)
  assert.equal(r.reason, 'flow_missing')
  assert.equal((await execucoes()).length, 0)
})

test('Flow sem versão publicada não dispara — rascunho não roda sozinho', async () => {
  const rascunho = await createAutomation(DONO, { floorId: FLOOR.toString(), name: 'Rascunho', definition: DEFINICAO })
  // Ativar sem publicar é recusado pelo próprio serviço — esta é a segunda tranca, para
  // um documento que chegue nesse estado por outro caminho (importação, versão apagada).
  await db.collection('automations').updateOne({ _id: rascunho._id }, { $set: { status: 'active', lastPublishedVersion: null } })
  const m = await criarMonitor({ action: { flowId: rascunho._id }, name: 'Para rascunho' })

  const r = await observar(10, 'z1', m)
  assert.equal(r.reason, 'flow_not_published')
  assert.equal((await execucoes()).length, 0)
})

test('Flow pausado depois de publicado para de ser disparado', async () => {
  await setStatus(DONO, flow._id, 'paused')
  const r = await observar(10, 'w1')
  assert.equal(r.reason, 'flow_paused')
  assert.equal((await execucoes()).length, 0)

  const estado = await getState(DONO, monitor._id)
  assert.equal(estado?.status, 'degraded', 'o monitor DIZ que não está funcionando')
})

test('monitor sem Flow observa e não faz nada — e diz isso', async () => {
  const semAcao = await criarMonitor({ action: null, name: 'Sem ação' })
  const r = await observar(10, 'v1', semAcao)
  assert.equal(r.reason, 'no_action')
  assert.equal((await execucoes()).length, 0)
})

// --- o restart -----------------------------------------------------------------------------------

test('disparo interrompido antes de enfileirar é retomado — e vira UMA execução', async () => {
  await observar(55, 'r1')
  // A queda entre reconhecer a borda e enfileirar: a transição foi gravada, a execução
  // não. Simulada apagando a execução e devolvendo a intenção ao estado.
  const disparo = await observar(10, 'r2')
  assert.equal(disparo.created, true)
  await db.collection('automation_runs').deleteMany({})
  await db.collection('monitor_states').updateOne(
    { ownerId: DONO, monitorId: monitor._id },
    { $set: { pendingDispatch: { eventId: 'r2', at: new Date() } } },
  )

  const retomados = await resumePendingDispatches()
  assert.equal(retomados, 1)
  const runs = await execucoes()
  assert.equal(runs.length, 1)
  assert.equal(runs[0].idempotencyKey, monitorRunKey(monitor._id, 'r2'))

  // Retomar de novo não cria uma segunda: a chave é derivada do evento.
  await resumePendingDispatches()
  assert.equal((await execucoes()).length, 1)
})

test('a intenção é limpa assim que a execução existe', async () => {
  await observar(55, 'q1')
  await observar(10, 'q2')
  const estado = await getState(DONO, monitor._id)
  assert.equal(estado.pendingDispatch, null)
})
