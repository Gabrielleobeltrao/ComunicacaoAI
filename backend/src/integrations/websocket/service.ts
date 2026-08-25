import { ObjectId } from 'mongodb'
import { ValidationError } from '../../building.js'
import { publishEvent } from '../../events/bus.js'
import { decryptInstallationConfig, getInstallation } from '../../apps/installations.js'
import { resolveConnection } from '../../apps/connectionProfile.js'
import { normalizeConnectionConfig } from '../../apps/official/websocket/config.js'
import type { WsConnectionConfig } from '../../apps/official/websocket/config.js'
import { buildWebSocketAdapter } from '../../apps/official/websocket/adapter.js'
import { assertPublicWebSocketUrl } from '../../net/safeWebSocket.js'
import type { StreamAdapter, StreamRecord } from '../../streams/types.js'
import {
  activeSubscriptions,
  countRecentMessages,
  countSubscriptionMessage,
  insertMessage,
  MESSAGE_RETENTION_DAYS,
  writeLog,
} from './repository.js'
import { dedupeKeyOf, parseMessage, previewOf, subscriptionFor, withinRateLimit } from './pipeline.js'
import type { WsMessage, WsMessageStatus } from './types.js'

/**
 * A ponte entre o transporte e o produto.
 *
 * O adapter traduz o socket; o pipeline decide; este arquivo é quem tem banco — e por
 * isso é ele quem conta, guarda, limita e publica.
 */

/**
 * Onde mora o quê.
 *
 * O SEGREDO — o valor da credencial — fica na configuração cifrada da instalação, que é
 * o lugar que já existe para isso e nunca volta para a tela.
 *
 * O RESTO (endereço, formato, caminhos, filtros, limites) fica no `publicMetadata`.
 * Não é segredo: é a configuração que a própria tela mostra de volta para ser editada.
 * Guardá-la cifrada junto do token pareceria mais seguro e seria só mais difícil — e
 * `normalizeConfig` descarta campo não declarado no manifesto, então ela nem chegaria lá.
 */
const CONFIG_FIELD = '__wsConfig'

export function readConnectionConfig(metadata: Record<string, string> | undefined): WsConnectionConfig {
  const bruto = metadata?.[CONFIG_FIELD]
  if (!bruto) throw new ValidationError('esta conexão ainda não foi configurada')
  return normalizeConnectionConfig(JSON.parse(bruto))
}

export const writeConnectionConfig = (config: WsConnectionConfig): Record<string, string> => ({
  [CONFIG_FIELD]: JSON.stringify(config),
})

/**
 * O adapter desta conexão, montado a partir da configuração dela.
 *
 * O endereço é CONFERIDO aqui, e não uma vez na gravação: a conferência resolve DNS, e
 * um nome que apontava para um endereço público quando foi salvo pode apontar para a
 * rede interna agora. Como isto roda a cada conexão e a cada reconexão, o rebinding não
 * tem janela.
 */
export async function websocketAdapterFor(record: StreamRecord): Promise<StreamAdapter | null> {
  if (record.appKey !== 'websocket') return null
  const id = ObjectId.isValid(record.installationId) ? new ObjectId(record.installationId) : null
  const instalacao = id ? await getInstallation(record.ownerId, id) : null
  if (!instalacao) return null

  const config = readConnectionConfig(instalacao.publicMetadata)
  const cru = decryptInstallationConfig(instalacao)
  const { url } = await assertPublicWebSocketUrl(config.endpoint)
  // A URL conferida é a que vai ser usada — não a string que foi digitada. Assim não há
  // espaço entre o que foi verificado e o que é aberto.
  return buildWebSocketAdapter({ ...config, endpoint: url.toString() }, cru.token ?? '', ingestWebSocketMessage)
}

/**
 * Uma mensagem chegou.
 *
 * A ordem das decisões é a mesma sempre, e cada recusa deixa um registro com o motivo —
 * uma mensagem que some sem explicação é a pior forma de depurar uma integração.
 */
export async function ingestWebSocketMessage(
  ownerId: string,
  installationId: string,
  bruto: string,
  config: WsConnectionConfig,
  now = new Date(),
): Promise<{ status: WsMessageStatus; eventId: string | null }> {
  const guardar = async (status: WsMessageStatus, dados: Partial<WsMessage> = {}) => {
    const doc: WsMessage = {
      _id: new ObjectId(),
      ownerId,
      installationId,
      subscriptionId: null,
      channel: '',
      status,
      preview: '',
      messageId: null,
      eventId: null,
      occurredAt: now,
      receivedAt: now,
      expiresAt: new Date(now.getTime() + MESSAGE_RETENTION_DAYS * 86_400_000),
      ...dados,
    }
    return insertMessage(doc)
  }

  /**
   * O teto por minuto vem ANTES de qualquer trabalho: um serviço que dispara mil
   * mensagens por segundo não pode custar mil validações por segundo.
   *
   * A contagem em memória é a que vale, e é SÍNCRONA — sem ela, quatro mensagens
   * simultâneas leem o mesmo total no banco e passam todas, que é justamente a rajada
   * que o limite existe para conter. O banco é o piso depois de um restart, quando a
   * memória zerou.
   */
  const dentroDaJanela = withinRateLimit(`${ownerId}:${installationId}`, config.maxMessagesPerMinute, now.getTime())
  const janela = new Date(now.getTime() - 60_000)
  if (!dentroDaJanela || (await countRecentMessages(ownerId, installationId, janela)) >= config.maxMessagesPerMinute) {
    await guardar('rate_limited', { preview: previewOf(bruto) })
    await writeLog(ownerId, installationId, 'dropped', `limite de ${config.maxMessagesPerMinute} mensagens por minuto atingido`, null, now)
    return { status: 'rate_limited', eventId: null }
  }

  const lida = parseMessage(bruto, config)
  if (lida.status !== 'accepted') {
    await guardar(lida.status, { preview: lida.preview })
    await writeLog(ownerId, installationId, lida.status === 'filtered' ? 'dropped' : 'invalid', lida.reason, null, now)
    return { status: lida.status, eventId: null }
  }

  // A dedupe é do índice único: duas mensagens simultâneas com o mesmo id não passam as
  // duas, o que uma leitura seguida de escrita não garante.
  const chave = dedupeKeyOf(config, lida.messageId, lida.payload)
  const brutaJson = config.format === 'json' ? JSON.parse(bruto) : bruto

  // Só uma assinatura ATIVA reivindica a mensagem. Sem nenhuma, ela é histórico — foi
  // recebida, está registrada, e não dispara nada.
  const assinaturas = await activeSubscriptions(ownerId, installationId)
  const assinatura = subscriptionFor(brutaJson, lida.channel, assinaturas)

  const gravada = await guardar('accepted', {
    preview: lida.preview,
    channel: lida.channel,
    messageId: chave,
    subscriptionId: assinatura?._id.toString() ?? null,
    occurredAt: lida.occurredAt ?? now,
  })
  if (!gravada) {
    await writeLog(ownerId, installationId, 'dropped', 'mensagem repetida (deduplicação)', assinatura?._id.toString() ?? null, now)
    return { status: 'duplicate', eventId: null }
  }

  if (assinatura) await countSubscriptionMessage(assinatura._id, now)

  const { event } = await publishEvent(
    {
      ownerId,
      type: 'integration.websocket.message',
      source: `websocket:${installationId}`,
      payload: {
        ownerId,
        connectionId: installationId,
        subscriptionId: assinatura?._id.toString() ?? null,
        channel: lida.channel,
        occurredAt: (lida.occurredAt ?? now).toISOString(),
        /**
         * O conteúdo é de FORA e não é confiável.
         *
         * A marca viaja com o dado para quem consumir saber disso — um agente que
         * receba isto trata como texto de terceiro, não como instrução.
         */
        untrusted: true,
        payload: lida.payload,
      },
      occurredAt: lida.occurredAt ?? now,
      // A identidade da mensagem, quando ela tem uma; senão, o instante — que é o melhor
      // que dá quando o serviço não identifica nada.
      dedupeKey: `ws:${installationId}:${chave ?? gravada._id.toString()}`,
    },
    now,
  )

  await messagesEventLink(gravada._id, event.eventId)
  return { status: 'accepted', eventId: event.eventId }
}

/** O fio entre a tela de Mensagens e o barramento. */
async function messagesEventLink(id: ObjectId, eventId: string): Promise<void> {
  const { messagesCollection } = await import('./repository.js')
  await messagesCollection.updateOne({ _id: id }, { $set: { eventId } }).catch(() => undefined)
}

/**
 * A conexão está mesmo em pé e é desta conta?
 *
 * Reaproveita a mesma resolução das ferramentas conectadas — dono, status e ambiente
 * conferidos no mesmo lugar, em vez de uma segunda regra que diverge na primeira
 * mudança.
 */
export async function assertUsableConnection(ownerId: string, installationId: string): Promise<void> {
  const r = await resolveConnection(ownerId, installationId, { requireConnectable: false })
  if (!r.ok) throw new ValidationError(r.message)
}
