import { ObjectId } from 'mongodb'
import { onEvent } from '../../events/bus.js'
import type { PlatformEvent } from '../../events/types.js'
import { writeFromStep } from '../../memory/fromStep.js'
import { createRun } from '../../automations/runService.js'
import { getAutomation } from '../../automations/service.js'
import { activeSubscriptions, writeLog } from './repository.js'
import type { WsDestination, WsSubscription } from './types.js'

/**
 * O que acontece DEPOIS que a mensagem virou evento.
 *
 * Cada destino reusa o caminho que já existe: memória é a mesma etapa de memória das
 * rotinas, rotina é a mesma fila de execuções, e agente e setor passam pelo gatilho
 * interno — que por sua vez roda uma automação com as permissões do agente responsável.
 *
 * É por isso que este arquivo é curto e não tem regra de permissão nenhuma: um evento
 * NÃO pode ganhar ferramenta ou autorização por ter chegado de fora. Ele entra pelas
 * mesmas portas, com as mesmas travas.
 */

const idValido = (v: unknown): ObjectId | null => (typeof v === 'string' && ObjectId.isValid(v) ? new ObjectId(v) : null)

/**
 * Guardar na memória, sem passar por modelo nenhum.
 *
 * O conteúdo é marcado como de fora: quem ler depois — inclusive um agente — sabe que
 * aquilo é texto de terceiro, e não instrução.
 */
async function paraMemoria(event: PlatformEvent, destino: WsDestination, assinatura: WsSubscription): Promise<void> {
  const escopo = destino.memoryScope ?? 'agent'
  const cfg: Record<string, unknown> = {
    scope: escopo,
    ...(destino.agentId ? { ownerAgentId: destino.agentId } : {}),
    ...(destino.sectorId ? { sectorId: destino.sectorId } : {}),
    ...(destino.floorId ? { floorId: destino.floorId } : {}),
    ...(destino.buildingId ? { buildingId: destino.buildingId } : {}),
    key: assinatura.name,
    strategy: 'append',
  }
  await writeFromStep(cfg, event.payload, {
    ownerId: event.ownerId,
    sourceType: 'internal_event',
    sourceId: event.eventId,
  })
}

/** Rodar uma rotina, pela MESMA fila e com a mesma idempotência de sempre. */
async function paraRotina(event: PlatformEvent, destino: WsDestination): Promise<void> {
  const id = idValido(destino.automationId)
  if (!id) return
  // A rotina precisa ser desta conta: `getAutomation` já consulta escopado por dono.
  const automacao = await getAutomation(event.ownerId, id)
  if (!automacao) return
  await createRun(event.ownerId, id, {
    triggerType: 'internal_event',
    input: event.payload,
    // A identidade do EVENTO: reprocessar não cria uma segunda execução.
    idempotencyKey: `${id.toString()}:evt:${event.eventId}`,
    requestId: `websocket:${event.eventId}`,
  })
}

/**
 * O despachante das assinaturas.
 *
 * Só a assinatura que RECLAMOU a mensagem age — e ela é escolhida no momento em que a
 * mensagem chega, não aqui. Aqui é só a execução do que ela pediu.
 *
 * `agent` e `sector` não têm caminho próprio: eles já são gatilho interno, e uma
 * automação com gatilho `internal_event` filtrando por esta assinatura roda com as
 * permissões do agente dela. Duplicar isso aqui seria uma segunda porta com uma segunda
 * chance de esquecer uma trava.
 */
export async function deliverWebSocketEvent(event: PlatformEvent): Promise<void> {
  const p = (event.payload ?? {}) as Record<string, unknown>
  const installationId = typeof p.connectionId === 'string' ? p.connectionId : ''
  const subscriptionId = typeof p.subscriptionId === 'string' ? p.subscriptionId : ''
  if (!installationId || !subscriptionId) return

  const assinatura = (await activeSubscriptions(event.ownerId, installationId)).find((s) => s._id.toString() === subscriptionId)
  // Desativada entre o recebimento e a entrega: não age. É o mesmo motivo pelo qual a
  // conexão revogada é conferida na hora de executar, e não na hora de listar.
  if (!assinatura) return

  const destino = assinatura.destination
  try {
    if (destino.kind === 'memory') await paraMemoria(event, destino, assinatura)
    else if (destino.kind === 'routine') await paraRotina(event, destino)
    // 'history' guarda e para — a mensagem já está registrada. 'agent' e 'sector'
    // são atendidos pelo gatilho interno, que roda no mesmo evento.
    if (destino.kind !== 'history') {
      await writeLog(event.ownerId, installationId, 'triggered', `destino "${destino.kind}" acionado`, subscriptionId)
    }
  } catch (error) {
    // Falhar aqui devolve o evento para a fila: a entrega é retentável, e o registro
    // conta o motivo sem citar o conteúdo.
    await writeLog(event.ownerId, installationId, 'error', `destino "${destino.kind}" falhou: ${(error as Error).message}`, subscriptionId)
    throw error
  }
}

export function registerWebSocketDestinations(): void {
  onEvent('integration.websocket.message', 'websocket.destination', deliverWebSocketEvent)
}
