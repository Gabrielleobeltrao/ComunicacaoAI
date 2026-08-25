// The automation engine: two loops over MongoDB, no broker.
//
//   runs      — claim a queued run atomically, execute it, release it;
//   scheduler — plan `nextRunAt` for active schedules and fire the due ones.
//
// It runs INSIDE the API process by default (one deployable service instead of
// two), and the standalone `npm run start:worker` entrypoint starts exactly the
// same thing — so a bigger install can split them later without behaving
// differently. Several instances are safe: claiming is a single atomic update and
// every scheduled fire carries a unique idempotency key.
import { randomUUID } from 'node:crypto'
import { claimNextRun, ensureRunIndexes, recoverRun, releaseRun, renewLease } from './runRepository.js'
import { ensureSchedulerIndexes, tickScheduler } from './scheduler.js'
import { refreshScheduledWebSources } from '../webKnowledge.js'
import { processRun } from './runProcessor.js'
import { claimNextEvent, ensureEventIndexes, processEvent } from '../events/bus.js'
import { ensureStreamIndexes } from '../streams/repository.js'
import { createStreamManager, restoreStreams, shutdownStreams } from '../streams/service.js'
import { closeDueCandles, registerMarketDataHandlers } from '../marketData/engine.js'
import { ensureCandleIndexes } from '../marketData/candleStore.js'
import { ensureMarketStateIndexes } from '../marketData/state.js'
import { registerInternalEventTriggers } from './internalEvents.js'

// How often to look for work. Polling replaces Redis's push delivery: a routine
// fires within one tick of its instant, which for daily/weekly schedules is
// invisible, and the database load is one indexed query per tick.
const RUN_POLL_MS = Number(process.env.RUN_POLL_MS ?? 3_000)
const SCHEDULER_POLL_MS = Number(process.env.SCHEDULER_POLL_MS ?? 15_000)
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4)
// Renew a claim well before the lease expires, so a long run is never stolen.
const LEASE_RENEW_MS = Number(process.env.LEASE_RENEW_MS ?? 60_000)
// O barramento interno tem o próprio ritmo: um evento de mercado não pode esperar o
// intervalo de uma rotina agendada.
const EVENT_POLL_MS = Number(process.env.EVENT_POLL_MS ?? 1_000)
// Quantos eventos drenar por passada. Sem teto, uma rajada de preços monopoliza a
// passada e as rotinas ficam esperando.
const EVENT_BATCH = Number(process.env.EVENT_BATCH ?? 20)
// De quanto em quanto tempo procurar vela vencida. O menor balde é de um minuto, então
// dez segundos fecham qualquer uma com atraso desprezível.
const CANDLE_SWEEP_MS = Number(process.env.CANDLE_SWEEP_MS ?? 10_000)

export interface EngineHandle {
  // Identifies this instance in `claimedBy`, so an abandoned run is traceable.
  readonly id: string
  stop: () => Promise<void>
}

export interface EngineOptions {
  concurrency?: number
  // Injected in tests to observe without waiting on real timers.
  onError?: (where: string, error: unknown) => void
}

export async function startAutomationEngine(options: EngineOptions = {}): Promise<EngineHandle> {
  const id = `${process.env.HOSTNAME ?? 'local'}-${randomUUID().slice(0, 8)}`
  const concurrency = options.concurrency ?? CONCURRENCY
  const onError = options.onError ?? ((where, error) => console.error(`automation ${where} failed:`, error instanceof Error ? error.message : error))

  await ensureRunIndexes()
  await ensureSchedulerIndexes()
  await ensureEventIndexes()
  await ensureStreamIndexes()
  await ensureCandleIndexes()
  await ensureMarketStateIndexes()
  // O motor de mercado escuta o barramento. Registrar aqui, e não na importação, deixa
  // o teste montar o mesmo motor sem herdar handlers de outro teste.
  registerMarketDataHandlers()
  // E o gatilho interno: é ele que transforma um evento do barramento em execução.
  registerInternalEventTriggers(onError)

  let stopping = false
  // In-flight runs, so shutdown can wait for them instead of cutting them off.
  const active = new Set<Promise<void>>()

  const executeClaimed = async (run: Awaited<ReturnType<typeof claimNextRun>>) => {
    if (!run) return
    const runId = run._id.toString()
    // Keep the claim alive while a long run is genuinely progressing. A renewal that
    // does not land is REPORTED (the run is about to be reclaimed by someone else),
    // with the run id only — never the payload it is working on.
    const renew = setInterval(() => {
      void renewLease(run._id, id).then(
        (held) => {
          if (!held) onError(`run ${runId} lease`, new Error('lease renewal did not match this worker'))
        },
        (error) => onError(`run ${runId} lease`, error),
      )
    }, LEASE_RENEW_MS)
    renew.unref()
    try {
      await processRun(runId)
      // processRun wrote the terminal status; drop the claim so nothing reclaims it.
      await releaseRun(run._id).catch((error) => onError(`run ${runId} release`, error))
    } catch (error) {
      onError(`run ${runId}`, error)
      // An unexpected throw must NEVER leave the run stuck in 'running' with no
      // lease — nothing would ever pick it up again. Requeue it (or park it as
      // failed once it has burned its claims) with the reason recorded.
      await recoverRun(run._id, error instanceof Error ? error.message : 'erro inesperado').catch((e) => onError(`run ${runId} recovery`, e))
    } finally {
      clearInterval(renew)
    }
  }

  // Drain as much as concurrency allows on each tick, so a burst does not wait
  // one poll interval per run.
  const pumpRuns = async () => {
    while (!stopping && active.size < concurrency) {
      const run = await claimNextRun(id)
      if (!run) return
      const task = executeClaimed(run).finally(() => active.delete(task))
      active.add(task)
    }
  }

  // O barramento interno: reivindica, processa, devolve. Mesma mecânica dos runs, e é
  // de propósito — dois jeitos diferentes de tentar de novo seriam dois lugares para o
  // retry estar errado.
  const pumpEvents = async () => {
    for (let i = 0; i < EVENT_BATCH && !stopping; i += 1) {
      const evento = await claimNextEvent(id)
      if (!evento) return
      await processEvent(evento)
    }
  }

  const runTimer = setInterval(() => {
    void pumpRuns().catch((error) => onError('run poll', error))
  }, RUN_POLL_MS)
  const eventTimer = setInterval(() => {
    void pumpEvents().catch((error) => onError('event poll', error))
  }, EVENT_POLL_MS)
  // A varredura que fecha vela. É ela — e não a chegada do próximo negócio — que fecha
  // a última vela do dia, quando o mercado para de mandar dado.
  const candleTimer = setInterval(() => {
    void closeDueCandles()
      .then(({ closed }) => closed && console.log(`Candles: ${closed} fechado(s)`))
      .catch((error) => onError('candles', error))
  }, CANDLE_SWEEP_MS)
  // As fontes web por horário entram na mesma varredura do agendador — não há relógio
  // novo. O intervalo mínimo de uma fonte é 5 min, então uma passada por minuto do
  // agendador é mais que suficiente para nenhuma atrasar.
  const fontesTimer = setInterval(() => {
    void refreshScheduledWebSources()
      .then((quantas) => {
        if (quantas) console.log(`Fontes web: ${quantas} atualizada(s)`)
      })
      .catch((error) => onError('fontes web', error))
  }, SCHEDULER_POLL_MS)
  const schedulerTimer = setInterval(() => {
    void tickScheduler()
      .then(({ fired, skipped }) => {
        if (fired || skipped) console.log(`Schedules: ${fired} disparada(s)${skipped ? `, ${skipped} perdida(s) ignorada(s)` : ''}`)
      })
      .catch((error) => onError('scheduler', error))
  }, SCHEDULER_POLL_MS)
  // Never keep the process alive just to poll.
  runTimer.unref()
  schedulerTimer.unref()
  fontesTimer.unref()
  eventTimer.unref()
  candleTimer.unref()

  // Do one pass immediately: a restart should pick up pending work at once.
  await tickScheduler().catch((error) => onError('scheduler', error))
  await pumpRuns().catch((error) => onError('run poll', error))

  // Os streams que estavam de pé antes do restart voltam a ficar. Sem isto, reiniciar
  // o worker significaria silenciar todo mundo até alguém reparar.
  createStreamManager(onError)
  await restoreStreams(onError)
    .then((quantos) => quantos && console.log(`Streams: ${quantos} restaurado(s)`))
    .catch((error) => onError('streams', error))

  console.log(`Automation engine up (${id}, concurrency ${concurrency}) — runs a cada ${RUN_POLL_MS}ms, agendador a cada ${SCHEDULER_POLL_MS}ms`)

  return {
    id,
    stop: async () => {
      if (stopping) return
      stopping = true
      clearInterval(fontesTimer)
      clearInterval(runTimer)
      clearInterval(schedulerTimer)
      clearInterval(eventTimer)
      clearInterval(candleTimer)
      await shutdownStreams().catch((error) => onError('streams', error))
      // Let in-flight runs finish; their leases keep them ours meanwhile.
      await Promise.allSettled([...active])
      console.log('Automation engine stopped')
    },
  }
}

// The engine runs inside the API unless explicitly disabled (for an install that
// prefers a dedicated worker process). Defaulting to ON is deliberate: the whole
// class of bug this replaced was a deployment where nobody ran the worker and
// every routine silently never fired.
export const embeddedEngineEnabled = (): boolean => (process.env.EMBEDDED_WORKER ?? 'true').trim().toLowerCase() !== 'false'

// --- lifecycle owned by the API process --------------------------------------
// One place knows whether the embedded engine is actually up, so /api/ready can
// answer honestly. An API serving HTTP with a dead engine is NOT a healthy backend:
// it accepts routines it will never run.
let embedded: EngineHandle | null = null
let startError: string | null = null

export interface EngineStatus {
  mode: 'embedded' | 'separate'
  running: boolean
  error: string | null
  // Readiness verdict for this mode: embedded requires a live engine here;
  // 'separate' trusts the dedicated worker process (it has its own health).
  ok: boolean
}

export function engineStatus(): EngineStatus {
  const mode: EngineStatus['mode'] = embeddedEngineEnabled() ? 'embedded' : 'separate'
  const running = embedded !== null
  return { mode, running, error: startError, ok: mode === 'separate' || running }
}

// The /api/ready verdict, as a pure function of the only two things that matter —
// so the route is a two-liner and the rule itself is unit-testable. Nothing about
// the failure is echoed back to the caller beyond "down".
export function readiness(mongoOk: boolean): { code: 200 | 503; body: { status: string; mongo: string; engine: string } } {
  const engine = engineStatus()
  const ok = mongoOk && engine.ok
  return {
    code: ok ? 200 : 503,
    body: { status: ok ? 'ready' : 'unavailable', mongo: mongoOk ? 'ok' : 'down', engine: engine.ok ? engine.mode : 'down' },
  }
}

// Start it (or explain, loudly, why it is not running here). Never throws: a
// failure is recorded and turns readiness red instead of being swallowed.
// `starter` is injectable so the failure path is testable.
export async function startEmbeddedEngine(
  options: EngineOptions = {},
  starter: (o: EngineOptions) => Promise<EngineHandle> = startAutomationEngine,
): Promise<EngineHandle | null> {
  if (!embeddedEngineEnabled()) {
    embedded = null
    startError = null
    console.warn(
      'Automation engine NOT embedded here (EMBEDDED_WORKER=false): a separate `npm run start:worker` process MUST be running, otherwise no routine will ever fire. Readiness accepts this mode by design.',
    )
    return null
  }
  try {
    embedded = await starter(options)
    startError = null
    return embedded
  } catch (error) {
    embedded = null
    startError = error instanceof Error ? error.message : String(error)
    console.error('Automation engine failed to start — this instance will report NOT READY:', startError)
    return null
  }
}

export async function stopEmbeddedEngine(): Promise<void> {
  const handle = embedded
  embedded = null
  if (handle) await handle.stop()
}
