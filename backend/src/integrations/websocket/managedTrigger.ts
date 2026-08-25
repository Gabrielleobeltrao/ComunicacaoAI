import { ObjectId } from 'mongodb'
import { ValidationError } from '../../building.js'
import { getAgentById } from '../../agents.js'
import { getSectorById, resolveOwnedSectorId } from '../../sectors.js'
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

/**
 * O agente que EXECUTA por este destino.
 *
 * Para um agente, é ele mesmo. Para um setor, é a porta de entrada dele — e qual é
 * depende do modo, que já é o mesmo critério que o resto do sistema usa:
 *
 *   `orchestrated`: o coordenador recebe, delega e consolida;
 *   `pipeline`: a primeira etapa é por onde a entrada passa;
 *   `organization`: não existe porta única — o setor é um grupo, não um ponto de entrada.
 *
 * Sem porta, a resposta é um erro de configuração e não um `null` empurrado adiante:
 * antes daqui `createEventTrigger` recebia `agentId` nulo e estourava com uma mensagem
 * que não dizia nada sobre setor.
 */
async function agenteExecutor(ownerId: string, destino: WsDestination): Promise<ObjectId> {
  if (destino.kind === 'agent') {
    const oid = id(destino.agentId)
    if (!oid) throw new ValidationError('Agente: identificador inválido.')
    return oid
  }

  const setorId = id(destino.sectorId)
  if (!setorId) throw new ValidationError('Setor: identificador inválido.')
  const setor = await getSectorById(ownerId, setorId)
  if (!setor) throw new ValidationError('Setor não encontrado nesta conta.')

  if (setor.mode === 'orchestrated') {
    if (!setor.coordinatorAgentId) {
      throw new ValidationError(`O setor "${setor.name}" ainda não tem coordenador — escolha um antes de usá-lo como destino.`)
    }
    return setor.coordinatorAgentId
  }
  if (setor.mode === 'pipeline') {
    const primeira = (setor.stages ?? [])[0]
    if (!primeira?.agentId) {
      throw new ValidationError(`O setor "${setor.name}" não tem a primeira etapa configurada — sem ela não há por onde a mensagem entrar.`)
    }
    return primeira.agentId
  }
  throw new ValidationError(
    `O setor "${setor.name}" trabalha em modo organização, que não tem uma porta de entrada única. Escolha um agente, ou mude o setor para coordenado ou sequencial.`,
  )
}

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

  // Quem executa. Para setor, é a porta de entrada dele — resolvida, nunca nula.
  const alvo = await agenteExecutor(ownerId, destino)

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
      installationId: assinatura.installationId,
      /**
       * A ASSINATURA é o filtro — não só a conexão.
       *
       * Duas assinaturas na mesma conexão têm destinos diferentes, e filtrar só por
       * conexão fazia a mensagem de uma disparar o destino da outra. O evento carrega o
       * `subscriptionId`, e é por ele que este gatilho reconhece o que é dele.
       */
      subscriptionId: assinatura._id.toString(),
      symbols: [],
      timeframe: null,
      includeSeries: false,
      seriesLength: 2,
    },
  }

  if (anterior) {
    const oid = id(anterior)
    if (oid && (await getAutomation(ownerId, oid))) {
      await updateEventTrigger(ownerId, alvo, oid, spec)
      await setStatus(ownerId, oid, assinatura.active ? 'active' : 'paused')
      return anterior
    }
  }

  const { trigger } = await createEventTrigger(ownerId, alvo, spec)
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
