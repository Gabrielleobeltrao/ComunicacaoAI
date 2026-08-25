import { onEvent } from '../events/bus.js'
import { EVENT_TYPES } from '../events/types.js'
import type { PlatformEvent } from '../events/types.js'
import { seriesForAnalysis } from '../marketData/engine.js'
import { isTimeframe } from '../marketData/types.js'
import { listActivePublished } from './repository.js'
import { createRun } from './runService.js'
import type { Automation, AutomationDefinition, InternalEventTrigger } from './types.js'

/**
 * O GATILHO INTERNO: um evento do barramento faz rodar uma automação.
 *
 * É o mesmo caminho do webhook depois daqui — mesma fila, mesma idempotência, mesmas
 * execuções, mesma contabilidade. A diferença está só na porta: o webhook não sabe de
 * quem é o corpo até conferir a assinatura; aqui o dono é do evento, e nada atravessa
 * de conta.
 */

/** Quantas vezes um evento pode gerar outro antes de a corrente ser cortada. */
export const MAX_EVENT_CHAIN = Number(process.env.MAX_EVENT_CHAIN ?? 3)
/** Quantas velas entregar quando o gatilho pede a série. */
export const DEFAULT_SERIES_LENGTH = 100

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * O evento serve a este gatilho?
 *
 * Pura, e restritiva por omissão do jeito certo: filtro ausente quer dizer "qualquer",
 * porque é isso que alguém quer dizer quando não preenche o campo.
 */
export function matchesInternalTrigger(trigger: InternalEventTrigger, event: Pick<PlatformEvent, 'type' | 'payload'>): boolean {
  if (trigger.eventType !== event.type) return false
  const p = event.payload ?? {}
  if (trigger.installationId && asString(p.installationId) !== trigger.installationId) return false
  if (trigger.symbols?.length) {
    const symbol = asString(p.symbol).toUpperCase()
    if (!trigger.symbols.map((s) => s.toUpperCase()).includes(symbol)) return false
  }
  if (trigger.timeframe && asString(p.timeframe) !== trigger.timeframe) return false
  return true
}

/** O gatilho interno DESTA automação, se for o que ela publica. */
export function internalTriggerOf(a: { automation: Automation; published: AutomationDefinition | null }): InternalEventTrigger | null {
  // O que dispara é a versão PUBLICADA. Um rascunho pela metade no editor não pode
  // abrir — nem fechar — um gatilho vivo.
  const trigger = a.published?.trigger ?? (a.automation.publishedTrigger as AutomationDefinition['trigger'] | undefined)
  if (!trigger || trigger.type !== 'internal_event' || a.automation.lastPublishedVersion == null) return null
  return trigger
}

/** A profundidade da corrente que trouxe este evento até aqui. */
export const chainOf = (payload: unknown): number => {
  const n = Number((payload as { _chain?: unknown } | null)?._chain ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

export interface DispatchDeps {
  listPublished: typeof listActivePublished
  createRun: typeof createRun
  series: typeof seriesForAnalysis
}

const producao: DispatchDeps = { listPublished: listActivePublished, createRun, series: seriesForAnalysis }

/**
 * Entregar um evento a todas as automações do dono que o esperam.
 *
 * O que sai daqui é uma execução por automação, com chave de idempotência derivada do
 * evento: reprocessar o mesmo evento — porque o worker caiu no meio — encontra a
 * execução que já existe em vez de criar uma segunda.
 */
export async function dispatchInternalEvent(event: PlatformEvent, deps: DispatchDeps = producao): Promise<{ runs: number; skipped: string[] }> {
  const skipped: string[] = []

  // A corrente: um evento que nasceu de uma automação que nasceu de um evento pode
  // realimentar o barramento para sempre. O corte é aqui, e é contado — parar em
  // silêncio pareceria "nada aconteceu".
  if (chainOf(event.payload) >= MAX_EVENT_CHAIN) {
    return { runs: 0, skipped: [`corrente de eventos interrompida na profundidade ${MAX_EVENT_CHAIN}`] }
  }

  const candidatas = await deps.listPublished(event.ownerId)
  let runs = 0
  for (const item of candidatas) {
    const trigger = internalTriggerOf(item)
    if (!trigger || !matchesInternalTrigger(trigger, event)) continue

    const input = await buildTriggerInput(event, trigger, deps)
    const { created } = await deps.createRun(event.ownerId, item.automation._id, {
      triggerType: 'internal_event',
      input,
      // A identidade do EVENTO, não do instante: reprocessar não cria uma segunda
      // execução.
      idempotencyKey: `${item.automation._id.toString()}:evt:${event.eventId}`,
      requestId: `event:${event.eventId}`,
    })
    if (created) runs += 1
  }
  return { runs, skipped }
}

/**
 * O que a execução recebe.
 *
 * Estruturado, e não texto: o payload precisa alimentar `app.execute`, memória e
 * transformação sem ninguém ter que reinterpretar uma string pelo caminho.
 */
export async function buildTriggerInput(
  event: PlatformEvent,
  trigger: InternalEventTrigger,
  deps: DispatchDeps = producao,
): Promise<Record<string, unknown>> {
  const payload = (event.payload ?? {}) as Record<string, unknown>
  const input: Record<string, unknown> = {
    event: {
      eventId: event.eventId,
      type: event.type,
      source: event.source,
      schemaVersion: event.schemaVersion,
      occurredAt: event.occurredAt.toISOString(),
    },
    payload,
    _chain: chainOf(payload) + 1,
  }

  // A SÉRIE, quando o gatilho pede. Um `market.candle.closed` traz uma vela, e nenhum
  // indicador significa coisa alguma com uma vela — sem isto, todo fluxo de análise
  // precisaria de um passo só para buscar o que a plataforma já tem guardado.
  const symbol = asString(payload.symbol)
  const timeframe = payload.timeframe
  if (trigger.includeSeries && event.type === 'market.candle.closed' && symbol && isTimeframe(timeframe)) {
    input.series = await deps.series(event.ownerId, {
      symbol,
      timeframe,
      installationId: asString(payload.installationId) || undefined,
      limit: trigger.seriesLength ?? DEFAULT_SERIES_LENGTH,
    })
  }
  return input
}

/** Todo contrato do barramento pode disparar automação. Registrado uma vez, no motor. */
export function registerInternalEventTriggers(onError: (where: string, e: unknown) => void = () => undefined): void {
  for (const tipo of EVENT_TYPES) {
    onEvent(tipo, async (event) => {
      const { skipped } = await dispatchInternalEvent(event)
      for (const motivo of skipped) onError(`evento ${event.eventId}`, new Error(motivo))
    })
  }
}
