import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import type { ConditionAst, TriggerMode } from './condition.js'
import { evaluateCondition, shouldTrigger } from './condition.js'

// O ESTADO DE PLANTÃO — persistido, e a transição é atômica.
//
// Um monitor precisa lembrar o que era verdade antes: sem isso não existe borda, e sem
// borda ele avisa a cada tique ou avisa uma vez e cala para sempre. Guardar esse estado na
// memória do processo funcionaria até o primeiro restart — e um restart é justamente
// quando ninguém está olhando.
//
// A transição é um `findOneAndUpdate` com o estado ANTERIOR no filtro. Dois workers
// recebendo o mesmo evento ao mesmo tempo: um encontra documento e dispara, o outro não
// encontra e não dispara. Não é uma trava; é a mesma operação atômica do banco que o
// resto do sistema já usa.

export type MonitorStatus = 'watching' | 'paused' | 'degraded' | 'error'

export interface MonitorDefinition {
  _id: ObjectId
  ownerId: string
  name: string
  /** De onde vem a observação: um dataset de database, um recorder, um evento interno. */
  source: { kind: 'database'; dataStoreId: ObjectId; datasetKey: string; field?: string } | { kind: 'internal_event'; eventType: string }
  condition: ConditionAst
  triggerMode: TriggerMode
  /** Para as bordas de cruzamento: o limiar comparado. */
  threshold: number | null
  thresholdField: string | null
  debounceMs: number
  cooldownMs: number
  /** O Flow acionado. Sem ele o monitor observa e não faz nada — e isso é um rascunho. */
  action: { flowId: ObjectId; version?: number } | null
  status: 'draft' | 'published' | 'paused'
  createdAt: Date
  updatedAt: Date
}

export interface MonitorState {
  _id: ObjectId
  monitorId: ObjectId
  ownerId: string
  previousValue: unknown
  currentValue: unknown
  conditionWasTrue: boolean
  conditionIsTrue: boolean
  lastObservedAt: Date | null
  lastTriggeredAt: Date | null
  cooldownUntil: Date | null
  lastEventId: string | null
  status: MonitorStatus
  error: { code: string; message: string } | null
  version: number
}

const monitors = db.collection<MonitorDefinition>('monitors')
const states = db.collection<MonitorState>('monitor_states')

export async function ensureMonitorIndexes(): Promise<void> {
  await monitors.createIndex({ ownerId: 1, status: 1 })
  await states.createIndex({ monitorId: 1 }, { unique: true })
  await states.createIndex({ ownerId: 1, status: 1 })
}

export const getMonitor = (ownerId: string, id: ObjectId) => monitors.findOne({ _id: id, ownerId })
export const listMonitors = (ownerId: string) => monitors.find({ ownerId }).sort({ name: 1 }).toArray()
export const getState = (ownerId: string, monitorId: ObjectId) => states.findOne({ ownerId, monitorId })

export interface ObserveInput {
  ownerId: string
  monitor: MonitorDefinition
  value: Record<string, unknown>
  /** A identidade do evento. É ela que faz a MESMA entrega duas vezes disparar uma. */
  eventId: string
  now?: Date
}

export interface ObserveResult {
  triggered: boolean
  reason: 'triggered' | 'no_transition' | 'cooldown' | 'debounce' | 'duplicate' | 'paused' | 'lost_race'
  conditionIsTrue: boolean
}

/**
 * Uma observação — e no máximo UM disparo por transição.
 *
 * A ordem das recusas importa: duplicado antes de tudo (o mesmo evento entregue duas
 * vezes não é uma transição nova), depois pausado, debounce, transição e cooldown. Cada
 * uma responde a uma pergunta diferente, e trocar a ordem faria um evento repetido
 * consumir o debounce de um evento legítimo.
 */
export async function observe(input: ObserveInput): Promise<ObserveResult> {
  const agora = input.now ?? new Date()
  const monitor = input.monitor
  const anterior = await states.findOne({ ownerId: input.ownerId, monitorId: monitor._id })

  /**
   * A MARCA DO EVENTO vem antes de tudo.
   *
   * A mesma entrega processada duas vezes não é uma transição nova — e a ordem importa:
   * conferir isto depois do debounce faria um evento repetido consumir a janela de um
   * evento legítimo.
   */
  if (anterior?.lastEventId && anterior.lastEventId === input.eventId) {
    return { triggered: false, reason: 'duplicate', conditionIsTrue: anterior.conditionIsTrue }
  }

  if (monitor.status !== 'published' || anterior?.status === 'paused') {
    return { triggered: false, reason: 'paused', conditionIsTrue: anterior?.conditionIsTrue ?? false }
  }

  const anteriorValor = (anterior?.currentValue as Record<string, unknown> | undefined) ?? null
  const ehVerdade = evaluateCondition(monitor.condition, { value: input.value, previous: anteriorValor })
  const era = anterior?.conditionIsTrue ?? false

  const campo = monitor.thresholdField ?? undefined
  const disparou = shouldTrigger({
    mode: monitor.triggerMode,
    was: era,
    is: ehVerdade,
    previousValue: campo && anteriorValor ? Number(anteriorValor[campo]) : null,
    currentValue: campo ? Number(input.value[campo]) : null,
    threshold: monitor.threshold,
    valueChanged: JSON.stringify(anteriorValor) !== JSON.stringify(input.value),
  })

  /**
   * O debounce mede a distância da última OBSERVAÇÃO; o cooldown, a do último DISPARO.
   *
   * São coisas diferentes: o primeiro protege contra uma fonte tagarela, o segundo contra
   * avisar demais sobre a mesma coisa. Um monitor com os dois iguais não tem os dois.
   */
  if (monitor.debounceMs > 0 && anterior?.lastObservedAt && agora.getTime() - anterior.lastObservedAt.getTime() < monitor.debounceMs) {
    await states.updateOne(
      { ownerId: input.ownerId, monitorId: monitor._id },
      { $set: { lastEventId: input.eventId, lastObservedAt: agora } },
    )
    return { triggered: false, reason: 'debounce', conditionIsTrue: ehVerdade }
  }

  const emCooldown = Boolean(disparou && anterior?.cooldownUntil && anterior.cooldownUntil > agora)

  /**
   * A ESCRITA da transição, com o estado anterior no filtro.
   *
   * Dois workers com o mesmo evento: o primeiro casa com `conditionIsTrue: era` e escreve;
   * o segundo não encontra documento e sai sem disparar. É o mesmo mecanismo atômico que
   * o resto do sistema usa — e não uma trava, que precisaria ser liberada.
   */
  const vaiDisparar = disparou && !emCooldown
  const filtro: Record<string, unknown> = { ownerId: input.ownerId, monitorId: monitor._id }
  if (anterior) filtro.version = anterior.version


  const atualizado = await states.findOneAndUpdate(
    filtro,
    {
      $set: {
        previousValue: anteriorValor,
        currentValue: input.value,
        conditionWasTrue: era,
        conditionIsTrue: ehVerdade,
        lastObservedAt: agora,
        lastEventId: input.eventId,
        status: 'watching' as MonitorStatus,
        error: null,
        ...(vaiDisparar
          ? {
              lastTriggeredAt: agora,
              cooldownUntil: monitor.cooldownMs > 0 ? new Date(agora.getTime() + monitor.cooldownMs) : null,
            }
          : {}),
      },
      $inc: { version: 1 },
      $setOnInsert: { _id: new ObjectId(), ownerId: input.ownerId, monitorId: monitor._id, ...(vaiDisparar ? {} : { lastTriggeredAt: null, cooldownUntil: null }) },
    },
    { upsert: !anterior, returnDocument: 'after' },
  )

  if (!atualizado) {
    // Outro worker escreveu primeiro. Ele disparou (ou não) pela mesma regra; este sai.
    return { triggered: false, reason: 'lost_race', conditionIsTrue: ehVerdade }
  }
  if (emCooldown) return { triggered: false, reason: 'cooldown', conditionIsTrue: ehVerdade }
  return { triggered: vaiDisparar, reason: vaiDisparar ? 'triggered' : 'no_transition', conditionIsTrue: ehVerdade }
}

/** Um monitor que não consegue observar fica DEGRADADO — e isso é dito, não escondido. */
export async function markDegraded(ownerId: string, monitorId: ObjectId, error: { code: string; message: string }): Promise<void> {
  await states.updateOne(
    { ownerId, monitorId },
    { $set: { status: 'degraded' as MonitorStatus, error: { code: error.code, message: error.message.slice(0, 300) } }, $inc: { version: 1 } },
    { upsert: false },
  )
}

export { monitors as monitorsCollection, states as monitorStatesCollection }
