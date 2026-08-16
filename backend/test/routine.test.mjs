// Pure tests for agent routines (Phase 3): the routine→AutomationDefinition compiler
// and the friendly-recurrence cron round-trip. Dummy MONGODB_URI so imports don't
// connect.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { buildRoutineDefinition } = await import('../dist/automations/routine.js')
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
