// MONITORS — a diferença entre "está acima de 30" e "cruzou 30 para cima".
//
// A primeira é um estado; a segunda é uma TRANSIÇÃO, e só existe comparando o agora com o
// antes. Confundi-las é o defeito clássico: ou o monitor avisa a cada tique, ou avisa uma
// vez e cala para sempre. E o estado precisa sobreviver a um restart, porque restart é
// justamente quando ninguém está olhando.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { parseCondition, evaluateCondition, shouldTrigger, describeCondition, ConditionError } = await import('../dist/monitors/condition.js')
const { ensureMonitorIndexes, observe, getState, markDegraded } = await import('../dist/monitors/state.js')

const DONO = 'dono-monitores'
const CAMPOS = ['rsi', 'preco', 'status']

before(async () => {
  await mongoClient.connect()
  await ensureMonitorIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

let monitor
beforeEach(async () => {
  for (const c of ['monitors', 'monitor_states']) await db.collection(c).deleteMany({})
  monitor = {
    _id: new ObjectId(),
    ownerId: DONO,
    name: 'RSI sobrevendido',
    source: { kind: 'database', dataStoreId: new ObjectId(), datasetKey: 'candles' },
    condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
    triggerMode: 'enter',
    threshold: 30,
    thresholdField: 'rsi',
    debounceMs: 0,
    cooldownMs: 0,
    action: { flowId: new ObjectId() },
    status: 'published',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  await db.collection('monitors').insertOne(monitor)
})

const observar = (value, eventId, extra = {}) => observe({ ownerId: DONO, monitor: { ...monitor, ...extra }, value, eventId })

// --- a condição ------------------------------------------------------------------------

test('a condição só aceita campos da fonte e operadores conhecidos', () => {
  assert.ok(parseCondition({ kind: 'compare', field: 'rsi', op: 'lt', value: 30 }, CAMPOS))
  assert.throws(() => parseCondition({ kind: 'compare', field: 'senha', op: 'lt', value: 1 }, CAMPOS), ConditionError)
  assert.throws(() => parseCondition({ kind: 'compare', field: 'rsi', op: 'regex', value: 1 }, CAMPOS), /não é permitido/)
  assert.throws(() => parseCondition({ kind: 'exec', field: 'rsi' }, CAMPOS), /desconhecido/)
})

test('a condição tem teto de profundidade e de partes', () => {
  const fundo = { kind: 'and', children: [{ kind: 'and', children: [{ kind: 'and', children: [{ kind: 'and', children: [{ kind: 'compare', field: 'rsi', op: 'lt', value: 1 }] }] }] }] }
  assert.throws(() => parseCondition(fundo, CAMPOS), /níveis/)
  const largo = { kind: 'or', children: Array.from({ length: 40 }, () => ({ kind: 'compare', field: 'rsi', op: 'lt', value: 1 })) }
  assert.throws(() => parseCondition(largo, CAMPOS), /partes/)
})

test('comparar número com o que não é número é FALSO, e não erro', () => {
  const ast = { kind: 'compare', field: 'rsi', op: 'lt', value: 30 }
  assert.equal(evaluateCondition(ast, { value: { rsi: 25 } }), true)
  // Uma fonte que devolveu null num tique não pode derrubar o monitor nem disparar.
  assert.equal(evaluateCondition(ast, { value: { rsi: null } }), false)
  assert.equal(evaluateCondition(ast, { value: {} }), false)
})

test('delta compara com o valor anterior — e sem anterior não há variação', () => {
  const ast = { kind: 'delta', field: 'preco', op: 'lt', value: -5, mode: 'percent' }
  assert.equal(evaluateCondition(ast, { value: { preco: 90 }, previous: { preco: 100 } }), true)
  assert.equal(evaluateCondition(ast, { value: { preco: 99 }, previous: { preco: 100 } }), false)
  assert.equal(evaluateCondition(ast, { value: { preco: 90 }, previous: null }), false, '"não existe" é falso, nunca zero')
})

test('a frase da condição é conferível antes de publicar', () => {
  const ast = parseCondition({ kind: 'and', children: [{ kind: 'compare', field: 'rsi', op: 'lt', value: 30 }, { kind: 'compare', field: 'preco', op: 'gt', value: 10 }] }, CAMPOS)
  assert.equal(describeCondition(ast), 'rsi abaixo de 30 e preco acima de 10')
})

// --- os modos de disparo -----------------------------------------------------------------

test('level dispara enquanto for verdade; enter só na entrada', () => {
  assert.equal(shouldTrigger({ mode: 'level', was: true, is: true }), true)
  assert.equal(shouldTrigger({ mode: 'enter', was: true, is: true }), false, 'já estava dentro')
  assert.equal(shouldTrigger({ mode: 'enter', was: false, is: true }), true)
  assert.equal(shouldTrigger({ mode: 'exit', was: true, is: false }), true)
  assert.equal(shouldTrigger({ mode: 'exit', was: false, is: false }), false)
})

test('cross_up é a BORDA — não é "está acima"', () => {
  // Estava abaixo e passou: dispara.
  assert.equal(shouldTrigger({ mode: 'cross_up', was: false, is: true, previousValue: 28, currentValue: 32, threshold: 30 }), true)
  // Continua acima: NÃO dispara de novo.
  assert.equal(shouldTrigger({ mode: 'cross_up', was: true, is: true, previousValue: 32, currentValue: 35, threshold: 30 }), false)
  // Desceu: não é cruzamento para cima.
  assert.equal(shouldTrigger({ mode: 'cross_up', was: true, is: false, previousValue: 32, currentValue: 28, threshold: 30 }), false)
  assert.equal(shouldTrigger({ mode: 'cross_down', was: false, is: true, previousValue: 32, currentValue: 28, threshold: 30 }), true)
  // Sem valor anterior não há travessia — o primeiro tique não inventa uma.
  assert.equal(shouldTrigger({ mode: 'cross_up', was: false, is: true, previousValue: null, currentValue: 32, threshold: 30 }), false)
})

// --- o estado ------------------------------------------------------------------------------

test('a mesma condição verdadeira dispara UMA vez no modo enter', async () => {
  const primeiro = await observar({ rsi: 25 }, 'e1')
  assert.equal(primeiro.triggered, true)
  const segundo = await observar({ rsi: 24 }, 'e2')
  assert.equal(segundo.triggered, false, 'continuar dentro não é entrar de novo')
  assert.equal(segundo.reason, 'no_transition')

  // Saiu e voltou: é uma entrada nova.
  await observar({ rsi: 40 }, 'e3')
  const devolta = await observar({ rsi: 20 }, 'e4')
  assert.equal(devolta.triggered, true)
})

test('o MESMO evento entregue duas vezes dispara uma', async () => {
  const primeiro = await observar({ rsi: 25 }, 'evento-repetido')
  assert.equal(primeiro.triggered, true)
  const repetido = await observar({ rsi: 25 }, 'evento-repetido')
  assert.equal(repetido.triggered, false)
  assert.equal(repetido.reason, 'duplicate')
})

test('o estado sobrevive ao restart — ele mora no banco', async () => {
  await observar({ rsi: 25 }, 'e1')
  const estado = await getState(DONO, monitor._id)
  assert.equal(estado.conditionIsTrue, true)
  assert.ok(estado.lastTriggeredAt)
  // "Reiniciar" aqui é simplesmente ler de novo: não há nada na memória do processo.
  const depoisDoRestart = await observar({ rsi: 24 }, 'e2')
  assert.equal(depoisDoRestart.triggered, false, 'sem o estado persistido, isto dispararia de novo')
})

test('o cooldown segura o disparo seguinte; o debounce segura a observação', async () => {
  const comCooldown = { ...monitor, triggerMode: 'level', cooldownMs: 60_000 }
  const primeiro = await observe({ ownerId: DONO, monitor: comCooldown, value: { rsi: 25 }, eventId: 'c1' })
  assert.equal(primeiro.triggered, true)
  const segundo = await observe({ ownerId: DONO, monitor: comCooldown, value: { rsi: 24 }, eventId: 'c2' })
  assert.equal(segundo.triggered, false)
  assert.equal(segundo.reason, 'cooldown', 'level avisaria a cada tique sem isto')

  await db.collection('monitor_states').deleteMany({})
  const comDebounce = { ...monitor, debounceMs: 60_000 }
  await observe({ ownerId: DONO, monitor: comDebounce, value: { rsi: 40 }, eventId: 'd1' })
  const rapido = await observe({ ownerId: DONO, monitor: comDebounce, value: { rsi: 25 }, eventId: 'd2' })
  assert.equal(rapido.reason, 'debounce')
})

test('a MESMA entrega chegando por dois caminhos produz UM disparo', async () => {
  // O caso real de uma fila com entrega ao-menos-uma-vez: o mesmo evento processado duas
  // vezes ao mesmo tempo. A marca do evento resolve, e resolve de forma determinística.
  const [a, b] = await Promise.all([observar({ rsi: 25 }, 'entrega-1'), observar({ rsi: 25 }, 'entrega-1')])
  const disparos = [a, b].filter((r) => r.triggered).length
  assert.equal(disparos, 1, 'dois workers, uma execução')

  /**
   * Para eventos DISTINTOS chegando juntos, a segunda linha de defesa é a versão do
   * estado no filtro da escrita: quem perde a corrida não encontra documento e sai como
   * `lost_race`. Não existe teste determinístico para essa janela — ela depende do
   * intercalamento real —, e afirmar que existe seria pior do que dizer isto.
   */
  const estado = await getState(DONO, monitor._id)
  assert.ok(estado.version >= 1)
})

test('monitor em rascunho não dispara', async () => {
  const rascunho = { ...monitor, status: 'draft' }
  const r = await observe({ ownerId: DONO, monitor: rascunho, value: { rsi: 25 }, eventId: 'r1' })
  assert.equal(r.triggered, false)
  assert.equal(r.reason, 'paused', 'salvar nunca publica')
})

test('monitor que não consegue observar fica DEGRADADO, e diz por quê', async () => {
  await observar({ rsi: 40 }, 'e1')
  await markDegraded(DONO, monitor._id, { code: 'fonte_indisponivel', message: 'a fonte não respondeu' })
  const estado = await getState(DONO, monitor._id)
  assert.equal(estado.status, 'degraded')
  assert.equal(estado.error.code, 'fonte_indisponivel')
})

test('o monitor de outra conta não é observado nem lido', async () => {
  await observar({ rsi: 25 }, 'e1')
  assert.equal(await getState('vizinho', monitor._id), null)
})

test('nenhum token é gasto no caminho determinístico', async () => {
  // Não há provedor configurado neste teste: se qualquer parte do caminho chamasse um
  // modelo, ela falharia. Ela não falha — e é essa a garantia.
  for (let i = 0; i < 20; i++) await observar({ rsi: 25 + (i % 2) * 20 }, `t${i}`)
  const estado = await getState(DONO, monitor._id)
  assert.ok(estado.version >= 20)
})
