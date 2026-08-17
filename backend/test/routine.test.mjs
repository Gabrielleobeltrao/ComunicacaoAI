// Pure tests for agent routines (Phase 3): the routine→AutomationDefinition compiler
// and the friendly-recurrence cron round-trip. Dummy MONGODB_URI so imports don't
// connect.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { buildRoutineDefinition, recorrenciaIncompativelComFonte, readSourceFromDefinition } = await import('../dist/automations/routine.js')
const { validateDefinition } = await import('../dist/automations/validate.js')
const { recurrenceToCron, cronToRecurrence } = await import('../dist/automations/schedule.js')

const agentId = new ObjectId()

test('buildRoutineDefinition compiles to a valid scheduled agent.execute definition', () => {
  const def = buildRoutineDefinition({ name: 'Resumo', objective: 'Resuma as notícias', recurrence: { kind: 'daily', time: '07:00' }, timezone: 'America/Sao_Paulo', input: 'política' }, agentId)
  assert.equal(def.trigger.type, 'schedule')
  assert.equal(def.trigger.cron, '0 7 * * *')
  assert.equal(def.trigger.timezone, 'America/Sao_Paulo')
  assert.equal(def.steps.length, 1)
  const step = def.steps[0]
  assert.equal(step.type, 'agent.execute')
  assert.equal(step.config.agentId, agentId.toString())
  assert.match(String(step.config.instruction), /política/)
  assert.equal(validateDefinition(def).valid, true)
})

test('buildRoutineDefinition with delivery adds a delivery.send step depending on the agent step', () => {
  const def = buildRoutineDefinition(
    { name: 'Diário', objective: 'Gerar relatório', recurrence: { kind: 'weekly', time: '08:30', weekdays: [1, 3, 5] }, timezone: 'UTC', delivery: { provider: 'email', connectionId: 'conn1' } },
    agentId,
  )
  assert.equal(def.steps.length, 2)
  const delivery = def.steps.find((s) => s.type === 'delivery.send')
  assert.ok(delivery)
  assert.equal(delivery.config.connectionId, 'conn1')
  assert.equal(delivery.config.fromStepId, def.steps[0].id)
  assert.deepEqual(delivery.dependsOn, [def.steps[0].id])
  assert.equal(def.deliveries.length, 1)
  assert.equal(validateDefinition(def).valid, true)
})

test('cronToRecurrence inverts recurrenceToCron for the friendly patterns', () => {
  const cases = [
    { kind: 'daily', time: '07:00' },
    { kind: 'weekly', time: '09:30', weekdays: [1, 3, 5] },
    { kind: 'monthly', time: '06:15', day: 10 },
  ]
  for (const r of cases) {
    const back = cronToRecurrence(recurrenceToCron(r))
    assert.deepEqual(back, r)
  }
  // `*/5` passou a ser representável: é a frequência de monitoramento "a cada 5
  // minutos". Antes caía no fallback porque a recorrência não tinha esse conceito.
  assert.deepEqual(cronToRecurrence('*/5 * * * *'), { kind: 'minutes', every: 5 })
  // O fallback continua existindo para o que o vocabulário amigável não cobre: um
  // intervalo que a interface não oferece, e um cron com faixa.
  assert.equal(cronToRecurrence('*/7 * * * *'), null)
  assert.equal(cronToRecurrence('0 9 * * 1-5'), null)
})

// --- proteção de custo: frequência curta é privilégio de quem monitora ----------------

test('rotina de entrada fixa não pode rodar de 5 em 5 minutos', () => {
  // 288 execuções por dia com exatamente a mesma entrada é conta alta em troca de
  // nada. Quem monitora pode: a verificação é de graça, e a LLM só roda se mudar.
  const fixa = { name: 'x', objective: 'y', recurrence: { kind: 'minutes', every: 5 } }
  assert.match(recorrenciaIncompativelComFonte(fixa) ?? '', /monitoram uma fonte/)
  assert.match(recorrenciaIncompativelComFonte({ ...fixa, recurrence: { kind: 'hourly' } }) ?? '', /monitoram uma fonte/)
  // Fonte declarada como fixa, ou com URL vazia, é entrada fixa do mesmo jeito.
  assert.notEqual(recorrenciaIncompativelComFonte({ ...fixa, source: { kind: 'fixed' } }), null)
  assert.notEqual(recorrenciaIncompativelComFonte({ ...fixa, source: { kind: 'rss', url: '  ', initialWindow: '24h' } }), null)
})

test('quem monitora pode usar as frequências curtas', () => {
  const source = { kind: 'rss', url: 'https://exemplo.test/f.xml', initialWindow: '24h' }
  assert.equal(recorrenciaIncompativelComFonte({ name: 'x', objective: 'y', recurrence: { kind: 'minutes', every: 5 }, source }), null)
  assert.equal(recorrenciaIncompativelComFonte({ name: 'x', objective: 'y', recurrence: { kind: 'hourly' }, source }), null)
})

test('as frequências longas continuam valendo para as duas', () => {
  const diaria = { kind: 'daily', time: '08:00' }
  assert.equal(recorrenciaIncompativelComFonte({ name: 'x', objective: 'y', recurrence: diaria }), null)
  assert.equal(
    recorrenciaIncompativelComFonte({ name: 'x', objective: 'y', recurrence: diaria, source: { kind: 'http', url: 'https://e.test/p' } }),
    null,
  )
})

// --- troca de fonte, lida de volta da definição ---------------------------------------

test('a fonte volta da definição do jeito que entrou', () => {
  const agentId = new ObjectId()
  const spec = { name: 'r', objective: 'vigiar', recurrence: { kind: 'minutes', every: 15 } }
  const rss = buildRoutineDefinition({ ...spec, source: { kind: 'rss', url: 'https://e.test/f.xml', initialWindow: '3d', focus: 'preços' } }, agentId)
  assert.deepEqual(readSourceFromDefinition(rss), { kind: 'rss', url: 'https://e.test/f.xml', initialWindow: '3d', focus: 'preços' })

  // RSS → HTTP, e de volta: cada uma compila a sua etapa, sem sobra da outra.
  const http = buildRoutineDefinition({ ...spec, source: { kind: 'http', url: 'https://e.test/p' } }, agentId)
  assert.deepEqual(readSourceFromDefinition(http), { kind: 'http', url: 'https://e.test/p' })
  assert.equal(http.steps.filter((s) => s.type.startsWith('source.')).length, 1)

  // E de volta para fixa: a etapa de fonte simplesmente não existe.
  const fixa = buildRoutineDefinition({ ...spec, recurrence: { kind: 'daily', time: '08:00' }, source: { kind: 'fixed' } }, agentId)
  assert.deepEqual(readSourceFromDefinition(fixa), { kind: 'fixed' })
  assert.equal(fixa.steps.some((s) => s.type.startsWith('source.')), false)
})
