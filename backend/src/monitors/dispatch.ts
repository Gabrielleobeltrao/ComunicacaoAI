import { ObjectId } from 'mongodb'
import { getAutomation } from '../automations/service.js'
import { createRun } from '../automations/runService.js'
import { onEvent } from '../events/bus.js'
import { EVENT_TYPES } from '../events/types.js'
import type { PlatformEvent } from '../events/types.js'
import { clearPendingDispatch, getState, listPendingDispatches, markDegraded, monitorsCollection, observe } from './state.js'
import type { MonitorDefinition, ObserveInput, ObserveResult } from './state.js'

// DO MONITOR PARA O FLOW — e nenhum mecanismo novo no caminho.
//
// O monitor reconhece a transição; quem executa é o motor de automações que já existe:
// mesma fila, mesmas leases, mesma versão publicada, mesmo ExecutionRoot, mesma
// auditoria. Um segundo executor aqui seria um segundo lugar onde retry, concorrência e
// idempotência são decididos — e o dia em que os dois divergissem, um estaria executando
// duas vezes o que o outro executa uma.
//
// O caminho inteiro é determinístico: condição, borda e enfileiramento não chamam
// modelo nenhum. O que gasta token é o Flow, quando ele tiver um passo que gasta.

export type DispatchReason =
  | ObserveResult['reason']
  | 'no_action'
  | 'flow_missing'
  | 'flow_not_published'
  | 'flow_paused'

export interface DispatchResult {
  triggered: boolean
  reason: DispatchReason
  conditionIsTrue: boolean
  runId: string | null
  /** `false` quando a execução já existia — o mesmo evento entregue duas vezes. */
  created: boolean
}

export interface DispatchDeps {
  getAutomation: typeof getAutomation
  createRun: typeof createRun
}
const producao: DispatchDeps = { getAutomation, createRun }

/**
 * A chave que faz a execução ser UMA.
 *
 * Derivada do monitor e do EVENTO, nunca do instante: o mesmo evento reprocessado —
 * porque o worker caiu, porque a fonte reentregou — encontra a execução que já existe.
 */
export const monitorRunKey = (monitorId: ObjectId, eventId: string) => `${monitorId.toString()}:mon:${eventId}`

/**
 * Observar e, se houver transição, enfileirar o Flow.
 *
 * A conferência do Flow vem ANTES de observar, e isso é deliberado: observar consome a
 * borda e arma o cooldown. Se o Flow sumiu ou nunca foi publicado, consumir a borda
 * jogaria o alerta fora em silêncio — o monitor voltaria a "condição verdadeira" sem
 * nunca ter avisado ninguém, e só avisaria de novo depois de ela ficar falsa e verdadeira
 * outra vez. Em vez disso o monitor fica DEGRADADO, com a borda intacta.
 */
export async function observeAndDispatch(input: ObserveInput, deps: DispatchDeps = producao): Promise<DispatchResult> {
  const monitor = input.monitor

  // O que ficou pendurado de uma queda anterior sai primeiro — com a mesma chave, então
  // reenfileirar não cria uma segunda execução.
  await recuperarPendente(input.ownerId, monitor, deps)

  if (!monitor.action?.flowId) {
    // Monitor sem Flow é rascunho: ele observa e não faz nada. Dizer isso é melhor do
    // que gravar estado como se houvesse um destino.
    return { triggered: false, reason: 'no_action', conditionIsTrue: false, runId: null, created: false }
  }

  const problema = await conferirFlow(input.ownerId, monitor.action.flowId, deps)
  if (problema) {
    await markDegraded(input.ownerId, monitor._id, { code: problema, message: MENSAGEM[problema] })
    return { triggered: false, reason: problema, conditionIsTrue: false, runId: null, created: false }
  }

  const r = await observe(input)
  if (!r.triggered) return { ...r, runId: null, created: false }

  const saida = await enfileirar(input.ownerId, monitor, input.eventId, input.value, deps)
  return { triggered: true, reason: 'triggered', conditionIsTrue: r.conditionIsTrue, ...saida }
}

const MENSAGEM: Record<'flow_missing' | 'flow_not_published' | 'flow_paused', string> = {
  flow_missing: 'O Flow deste monitor não existe mais.',
  flow_not_published: 'O Flow deste monitor ainda não tem versão publicada.',
  flow_paused: 'O Flow deste monitor está pausado ou arquivado.',
}

/**
 * O Flow serve? Existe, é desta conta, está ativo e TEM versão publicada.
 *
 * Rascunho não dispara: o que roda por conta própria é o que alguém revisou e publicou.
 * Deixar o rascunho rodar significaria que salvar uma edição pela metade muda, na
 * mesma hora, o que acontece sozinho de madrugada.
 */
async function conferirFlow(
  ownerId: string,
  flowId: ObjectId,
  deps: DispatchDeps,
): Promise<'flow_missing' | 'flow_not_published' | 'flow_paused' | null> {
  // Escopo de dono na consulta: um id de outra conta resolve para nada.
  const flow = await deps.getAutomation(ownerId, flowId)
  if (!flow) return 'flow_missing'
  if (flow.status !== 'active') return 'flow_paused'
  if (flow.lastPublishedVersion == null) return 'flow_not_published'
  return null
}

async function enfileirar(
  ownerId: string,
  monitor: MonitorDefinition,
  eventId: string,
  valor: Record<string, unknown>,
  deps: DispatchDeps,
): Promise<{ runId: string | null; created: boolean }> {
  try {
    const { run, created } = await deps.createRun(ownerId, monitor.action!.flowId, {
      triggerType: 'internal_event',
      input: {
        monitor: { id: monitor._id.toString(), name: monitor.name },
        // O que o monitor VIU. É dado, não texto: o Flow usa direto, sem reinterpretar.
        value: valor,
        eventId,
      },
      idempotencyKey: monitorRunKey(monitor._id, eventId),
      // Correlação sem payload: dá para seguir a execução até o monitor que a pediu.
      requestId: `monitor:${monitor._id.toString()}:${eventId}`,
    })
    await clearPendingDispatch(ownerId, monitor._id, eventId)
    return { runId: run._id.toString(), created }
  } catch (erro) {
    // A intenção fica gravada: o Flow existia na conferência e falhou ao enfileirar, e a
    // próxima observação (ou o arranque do worker) tenta de novo com a mesma chave.
    await markDegraded(ownerId, monitor._id, { code: 'enqueue_failed', message: (erro as Error).message })
    return { runId: null, created: false }
  }
}

/** O disparo que a queda deixou para trás. Mesma chave, então no máximo uma execução. */
async function recuperarPendente(ownerId: string, monitor: MonitorDefinition, deps: DispatchDeps): Promise<void> {
  const estado = await getState(ownerId, monitor._id)
  const pendente = estado?.pendingDispatch
  if (!pendente || !monitor.action?.flowId) return
  if (await conferirFlow(ownerId, monitor.action.flowId, deps)) return
  await enfileirar(ownerId, monitor, pendente.eventId, (estado.currentValue ?? {}) as Record<string, unknown>, deps)
}

/**
 * O que ficou pendente quando o processo caiu — varrido no arranque do worker.
 *
 * Sem isto, a recuperação depende de o monitor observar de novo, e uma fonte que só
 * publica de hora em hora deixaria o alerta parado por uma hora.
 */
export async function resumePendingDispatches(deps: DispatchDeps = producao): Promise<number> {
  const pendentes = await listPendingDispatches()
  let retomados = 0
  for (const estado of pendentes) {
    const monitor = await monitorsCollection.findOne({ _id: estado.monitorId, ownerId: estado.ownerId })
    if (!monitor?.action?.flowId || !estado.pendingDispatch) continue
    if (await conferirFlow(estado.ownerId, monitor.action.flowId, deps)) continue
    const { runId } = await enfileirar(
      estado.ownerId,
      monitor,
      estado.pendingDispatch.eventId,
      (estado.currentValue ?? {}) as Record<string, unknown>,
      deps,
    )
    if (runId) retomados += 1
  }
  return retomados
}

/**
 * Os monitores que esperam um EVENTO da plataforma.
 *
 * Escuta o mesmo barramento das automações — o monitor não é uma segunda fonte de
 * verdade sobre o que aconteceu, é outro consumidor do que já foi publicado.
 */
export function registerMonitorObservers(onError: (where: string, e: unknown) => void = () => undefined): void {
  for (const tipo of EVENT_TYPES) {
    onEvent(tipo, 'monitors.observe', async (event) => {
      try {
        await observarEvento(event)
      } catch (erro) {
        onError(`monitor do evento ${event.eventId}`, erro)
      }
    })
  }
}

export async function observarEvento(event: PlatformEvent, deps: DispatchDeps = producao): Promise<DispatchResult[]> {
  const interessados = await monitorsCollection
    .find({ ownerId: event.ownerId, status: 'published', 'source.kind': 'internal_event', 'source.eventType': event.type })
    .toArray()

  const saidas: DispatchResult[] = []
  for (const monitor of interessados) {
    saidas.push(
      await observeAndDispatch(
        {
          ownerId: event.ownerId,
          monitor,
          value: event.payload ?? {},
          // A identidade do EVENTO: reentrega não é transição nova.
          eventId: event.eventId,
          now: event.occurredAt,
        },
        deps,
      ),
    )
  }
  return saidas
}
