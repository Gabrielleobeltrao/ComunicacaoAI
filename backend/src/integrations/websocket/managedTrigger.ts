import { ObjectId } from 'mongodb'
import { ValidationError } from '../../building.js'
import { getAgentById } from '../../agents.js'
import { resolveOwnedSectorId } from '../../sectors.js'
import { getFloor } from '../../floors.js'
import { getAutomation } from '../../automations/service.js'
import { createEventTrigger, updateEventTrigger } from '../../automations/eventTrigger.js'
import { setStatus } from '../../automations/service.js'
import type { WsDestination, WsSubscription } from './types.js'

/**
 * Agente e Setor rodam pelo CAMINHO CANÔNICO — o gatilho por evento que já existe.
 *
 * A alternativa seria chamar o agente daqui. Ela funcionaria e perderia tudo o que o
 * caminho de sempre traz junto: fila, idempotência, contrato entre etapas, permissões
 * do agente, ferramentas, contabilidade de token e auditoria. Um segundo executor "só
 * para o WebSocket" seria a forma mais rápida de perder uma dessas garantias sem
 * ninguém notar.
 *
 * A automação criada aqui é GERENCIADA pela assinatura: a relação fica explícita no
 * documento (`managedAutomationId`), muda quando a assinatura muda, e some quando ela
 * some. Ela não é uma automação órfã que alguém encontra meses depois sem saber de onde
 * veio.
 */

const id = (v: unknown): ObjectId | null => (typeof v === 'string' && ObjectId.isValid(v) ? new ObjectId(v) : null)

/**
 * O destino é DESTA conta e existe mesmo?
 *
 * Um id de outra conta não vazaria nada por si só — a execução confere de novo — mas
 * ficaria pendurado apontando para algo que o dono não controla, e um dia dispararia
 * para alguém que nunca configurou aquilo. Recusar na gravação é mais barato que
 * descobrir depois.
 */
export async function assertDestinationOwned(ownerId: string, destino: WsDestination): Promise<void> {
  const conferir = async (valor: unknown, existe: (oid: ObjectId) => Promise<unknown>, oque: string) => {
    const oid = id(valor)
    if (!oid) throw new ValidationError(`${oque}: identificador inválido.`)
    if (!(await existe(oid))) throw new ValidationError(`${oque} não encontrado nesta conta.`)
  }

  if (destino.kind === 'agent') return conferir(destino.agentId, (o) => getAgentById(ownerId, o), 'Agente')
  if (destino.kind === 'sector') return conferir(destino.sectorId, async (o) => resolveOwnedSectorId(ownerId, o.toString()), 'Setor')
  if (destino.kind === 'routine') return conferir(destino.automationId, (o) => getAutomation(ownerId, o), 'Rotina')
  if (destino.kind === 'memory') {
    const escopo = destino.memoryScope ?? 'agent'
    if (escopo === 'agent') return conferir(destino.agentId, (o) => getAgentById(ownerId, o), 'Agente')
    if (escopo === 'sector') return conferir(destino.sectorId, async (o) => resolveOwnedSectorId(ownerId, o.toString()), 'Setor')
    if (escopo === 'floor') return conferir(destino.floorId, (o) => getFloor(ownerId, o), 'Andar')
    // Prédio: a conta tem um, e ele é resolvido na escrita da memória. Conferir aqui
    // exigiria um id que a tela não tem por que pedir.
    return
  }
}

/** O agente que responde por este destino — é dele que saem as permissões da execução. */
const agenteDe = (destino: WsDestination): string | null => (destino.kind === 'agent' ? (destino.agentId ?? null) : null)

/**
 * Cria (ou atualiza) o gatilho gerenciado desta assinatura.
 *
 * Só para `agent` e `sector`: são os destinos que EXECUTAM. Os outros são escrita, e
 * escrita não precisa de fila nem de contrato entre etapas.
 */
export async function syncManagedTrigger(
  ownerId: string,
  assinatura: WsSubscription,
  anterior?: string | null,
): Promise<string | null> {
  const destino = assinatura.destination
  const precisa = destino.kind === 'agent' || destino.kind === 'sector'

  if (!precisa) {
    if (anterior) await archiveManagedTrigger(ownerId, anterior)
    return null
  }

  const agentId = agenteDe(destino)
  // Para um setor, quem executa é o coordenador dele — o mesmo caminho que o gatilho por
  // evento já usa quando alguém escolhe um setor como contexto.
  const alvo = agentId ? id(agentId) : null
  if (destino.kind === 'agent' && !alvo) throw new ValidationError('Agente: identificador inválido.')

  const spec = {
    name: `WebSocket · ${assinatura.name}`,
    objective: `Tratar o que chegar pela assinatura "${assinatura.name}" do WebSocket.`,
    // O conteúdo é de fora e não é confiável: o modo com IA é o que o dono escolheu ao
    // apontar para um agente, e o agente recebe o payload como DADO, não como instrução.
    executionMode: 'ai' as const,
    ...(destino.kind === 'sector' && destino.sectorId ? { sectorId: destino.sectorId } : {}),
    market: {
      enabled: true,
      eventType: 'integration.websocket.message',
      // A assinatura é o filtro: só o que ela reivindicou dispara este gatilho.
      installationId: assinatura.installationId,
      symbols: [],
      timeframe: null,
      includeSeries: false,
      seriesLength: 2,
    },
  }

  if (anterior) {
    const oid = id(anterior)
    if (oid && (await getAutomation(ownerId, oid))) {
      await updateEventTrigger(ownerId, alvo!, oid, spec)
      await setStatus(ownerId, oid, assinatura.active ? 'active' : 'paused')
      return anterior
    }
  }

  const { trigger } = await createEventTrigger(ownerId, alvo!, spec)
  if (!assinatura.active) await setStatus(ownerId, trigger._id, 'paused')
  return trigger._id.toString()
}

/**
 * A assinatura sumiu (ou trocou de destino): o gatilho gerenciado por ela sai do ar.
 *
 * Arquivar e não apagar: o histórico de execuções que ele produziu continua fazendo
 * sentido, e apagar a automação transformaria aquelas execuções em referências mortas.
 */
export async function archiveManagedTrigger(ownerId: string, automationId: string): Promise<void> {
  const oid = id(automationId)
  if (!oid) return
  if (!(await getAutomation(ownerId, oid))) return
  await setStatus(ownerId, oid, 'archived').catch(() => undefined)
}
