// A SAÚDE de uma fonte — calculada, nunca gravada.
//
// Um campo `health` no banco vira mentira no primeiro processo que esquece de atualizá-lo:
// a fonte para às três da manhã e a tela continua verde porque ninguém rodou o job. Estes
// casos protegem a derivação — e o estado que o produto mais precisa dizer: `degraded`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backoffDelay, computeHealth, isDue, nextReadAt, FALHAS_PARA_DEGRADAR } from '../dist/monitoring/health.js'

const AGORA = new Date('2026-01-01T12:00:00.000Z')
const base = (over = {}) => ({
  status: 'active',
  freshness: { staleAfterMs: 60_000, onStale: 'degrade' },
  cadence: { mode: 'interval', intervalMs: 30_000 },
  retry: { timeoutMs: 5000, maxAttempts: 5, backoffMs: 1000, jitterRatio: 0.5, rateLimitPerMinute: null },
  telemetry: {
    lastReadAt: new Date(AGORA.getTime() - 10_000),
    lastOkAt: new Date(AGORA.getTime() - 10_000),
    lastErrorAt: null,
    lastErrorCode: null,
    lastLatencyMs: 120,
    consecutiveFailures: 0,
    readsOk: 10,
    readsFailed: 0,
    reconnects: 0,
  },
  ...over,
})

test('lendo dentro da janela é ONLINE', () => {
  const r = computeHealth(base(), AGORA)
  assert.equal(r.health, 'online')
  assert.ok(r.ageMs >= 10_000)
})

test('dado velho é DEGRADADO — responde, mas já não vale', () => {
  const velha = base({
    telemetry: { ...base().telemetry, lastOkAt: new Date(AGORA.getTime() - 10 * 60_000) },
  })
  const r = computeHealth(velha, AGORA)
  assert.equal(r.health, 'degraded')
  assert.match(r.reason, /última leitura boa tem 10 min/)
  assert.ok(r.staleAt < AGORA)
})

test('falhas seguidas degradam antes de o dado envelhecer', () => {
  const falhando = base({ telemetry: { ...base().telemetry, consecutiveFailures: FALHAS_PARA_DEGRADAR } })
  const r = computeHealth(falhando, AGORA)
  assert.equal(r.health, 'degraded')
  assert.match(r.reason, /falhas seguidas/)
})

test('uma falha isolada não derruba: pode ser azar', () => {
  const r = computeHealth(base({ telemetry: { ...base().telemetry, consecutiveFailures: 1 } }), AGORA)
  assert.equal(r.health, 'online')
})

test('nunca leu NÃO é online — dizer online seria afirmar sobre algo que não aconteceu', () => {
  const nova = base({ telemetry: { ...base().telemetry, lastOkAt: null, lastReadAt: null } })
  assert.equal(computeHealth(nova, AGORA).health, 'never_read')

  const comErro = base({
    telemetry: { ...base().telemetry, lastOkAt: null, lastErrorAt: AGORA, lastErrorCode: 'timeout' },
  })
  const r = computeHealth(comErro, AGORA)
  assert.equal(r.health, 'never_read')
  assert.match(r.reason, /timeout/)
})

test('pausada e rascunho são estados próprios, e dizem por quê', () => {
  assert.equal(computeHealth(base({ status: 'paused' }), AGORA).health, 'paused')
  assert.match(computeHealth(base({ status: 'draft' }), AGORA).reason, /rascunho/)
})

test('sem janela de validade, idade não degrada sozinha', () => {
  const semJanela = base({
    freshness: { staleAfterMs: 0, onStale: 'ignore' },
    telemetry: { ...base().telemetry, lastOkAt: new Date(AGORA.getTime() - 86_400_000) },
  })
  assert.equal(computeHealth(semJanela, AGORA).health, 'online')
})

// --- próximo disparo ------------------------------------------------------------------

test('o próximo disparo vem da cadência e da última leitura', () => {
  const r = nextReadAt(base(), AGORA)
  assert.equal(r.getTime(), AGORA.getTime() - 10_000 + 30_000)
})

test('fonte que EMPURRA não tem próximo disparo — ela chega, não é chamada', () => {
  assert.equal(nextReadAt(base({ cadence: { mode: 'stream' } }), AGORA), null)
  assert.equal(nextReadAt(base({ status: 'paused' }), AGORA), null)
})

test('leitura atrasada devolve o instante VERDADEIRO, mesmo no passado', () => {
  // A primeira versão empurrava o horário atrasado para o futuro, para a tela não mostrar
  // o passado — e com isso a varredura nunca considerava vencida uma fonte atrasada: ela
  // ficava parada para sempre, com o painel prometendo uma leitura que não vinha.
  const atrasada = base({ telemetry: { ...base().telemetry, lastReadAt: new Date(AGORA.getTime() - 300_000) } })
  const proximo = nextReadAt(atrasada, AGORA)
  assert.ok(proximo < AGORA, 'quem decide precisa da verdade; quem mostra é que arredonda')
  assert.equal(isDue(atrasada, AGORA), true)
  assert.equal(isDue(base(), AGORA), false, 'acabou de ler: não venceu')
})

// --- backoff ----------------------------------------------------------------------------

test('o backoff dobra a cada tentativa', () => {
  const semJitter = { backoffMs: 1000, jitterRatio: 0, maxAttempts: 5 }
  assert.equal(backoffDelay(semJitter, 1, () => 0), 1000)
  assert.equal(backoffDelay(semJitter, 2, () => 0), 2000)
  assert.equal(backoffDelay(semJitter, 3, () => 0), 4000)
})

test('o jitter espalha as tentativas — senão cem fontes voltam juntas', () => {
  const comJitter = { backoffMs: 1000, jitterRatio: 0.5, maxAttempts: 5 }
  // Com o aleatório no extremo, a espera cai até metade; com zero, fica no teto.
  assert.equal(backoffDelay(comJitter, 3, () => 1), 2000)
  assert.equal(backoffDelay(comJitter, 3, () => 0), 4000)
})

test('o backoff tem teto: insistir de hora em hora não é insistir', () => {
  const agressivo = { backoffMs: 60_000, jitterRatio: 0, maxAttempts: 20 }
  assert.equal(backoffDelay(agressivo, 20, () => 0), 15 * 60_000)
})

// --- CRON: o horário que dispara de verdade ---------------------------------------------
//
// `cadence.mode: 'cron'` era aceito pelo modelo e ignorado pela varredura, que só procurava
// `interval`. A fonte ficava ativa, verde e muda para sempre.

test('cron: o próximo disparo sai do relógio das rotinas, no fuso configurado', () => {
  const f = base({
    cadence: { mode: 'cron', intervalMs: null, cron: '0 9 * * *', timezone: 'UTC' },
    telemetry: { ...base().telemetry, lastReadAt: new Date('2026-01-01T08:00:00.000Z') },
  })
  assert.deepEqual(nextReadAt(f, AGORA), new Date('2026-01-01T09:00:00.000Z'))
})

test('cron: o disparo PERDIDO continua no passado, e a fonte vence', () => {
  // A conta sai da última leitura, e não de agora — senão a fonte atrasada seria sempre
  // reagendada para amanhã e nunca leria.
  const f = base({
    cadence: { mode: 'cron', intervalMs: null, cron: '0 9 * * *', timezone: 'UTC' },
    telemetry: { ...base().telemetry, lastReadAt: new Date('2026-01-01T07:00:00.000Z') },
  })
  assert.equal(isDue(f, AGORA), true)
})

test('cron: quem já leu depois do horário de hoje espera o de amanhã', () => {
  const f = base({
    cadence: { mode: 'cron', intervalMs: null, cron: '0 9 * * *', timezone: 'UTC' },
    telemetry: { ...base().telemetry, lastReadAt: new Date('2026-01-01T09:00:30.000Z') },
  })
  assert.equal(isDue(f, AGORA), false)
  assert.deepEqual(nextReadAt(f, AGORA), new Date('2026-01-02T09:00:00.000Z'))
})

test('cron: expressão que o relógio não entende não vira horário inventado', () => {
  const f = base({ cadence: { mode: 'cron', intervalMs: null, cron: 'todo dia às nove', timezone: 'UTC' } })
  assert.equal(nextReadAt(f, AGORA), null)
  assert.equal(isDue(f, AGORA), false)
})
