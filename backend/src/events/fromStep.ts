import { publishEvent } from './bus.js'
import { isEventType } from './types.js'
import type { EventType } from './types.js'

/**
 * A etapa `event.publish`, do lado de dentro.
 *
 * Fica aqui e não no runner pelo mesmo motivo das etapas de memória e de App: o runner
 * não conhece banco. O que ele recebe é uma função.
 */
export interface PublishStepContext {
  ownerId: string
  runId: string
  stepId: string
  /**
   * A profundidade da corrente que trouxe esta execução até aqui.
   *
   * Uma automação disparada por evento que publica um evento pode realimentar o
   * barramento para sempre. O contador viaja no payload e é o despachante quem corta.
   */
  chain?: number
}

export class EventStepError extends Error {}

export async function publishFromStep(
  cfg: Record<string, unknown>,
  valor: unknown,
  ctx: PublishStepContext,
): Promise<{ created: boolean; eventId: string }> {
  const tipo = cfg.eventType
  // O validador já recusa isto na publicação da definição. Conferir de novo aqui é o
  // que impede um documento antigo, escrito antes da validação, de publicar um evento
  // de tipo inventado que ninguém consome.
  if (!isEventType(tipo)) throw new EventStepError(`tipo de evento desconhecido: ${String(tipo)}`)

  const extra = (typeof cfg.payload === 'object' && cfg.payload !== null ? cfg.payload : {}) as Record<string, unknown>
  const { event, created } = await publishEvent({
    ownerId: ctx.ownerId,
    type: tipo as EventType,
    source: `automation:${ctx.runId}`,
    payload: {
      ...extra,
      ownerId: ctx.ownerId,
      _chain: (ctx.chain ?? 0) + 1,
      // O resultado da etapa anterior, inteiro. Quem consome decide o que olhar — e
      // recortar aqui seria decidir por ele.
      result: valor ?? null,
    },
    // (execução, etapa): uma repetição por retry publica o MESMO fato, não um segundo.
    dedupeKey: `run:${ctx.runId}:${ctx.stepId}`,
  })
  return { created, eventId: event.eventId }
}
