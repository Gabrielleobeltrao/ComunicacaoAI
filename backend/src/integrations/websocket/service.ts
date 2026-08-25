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
  countSubscriptionMessage,
  insertMessage,
  MESSAGE_RETENTION_DAYS,
  writeLog,
} from './repository.js'
import { dedupeKeyOf, parseMessage, podePublicar, previewOf, registerOverflow, subscriptionsFor } from './pipeline.js'
import { applyMapping } from './mapping.js'
import { putLiveValue } from './liveData.js'
import { framesOnConnect } from './subscribe.js'
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
  const alvo = await assertPublicWebSocketUrl(config.endpoint)
  // A URL conferida é a que vai ser usada — não a string que foi digitada —, e a conexão
  // abre no ENDEREÇO já conferido, não num nome resolvido de novo lá na frente.
  return buildWebSocketAdapter(
    { ...config, endpoint: alvo.url.toString() },
    cru.token ?? '',
    ingestWebSocketMessage,
    framesOnConnect,
    { address: alvo.address, family: alvo.family },
  )
}

/**
 * Uma mensagem chegou.
 *
 * A ordem das decisões é a mesma sempre, e cada recusa deixa um registro com o motivo —
 * uma mensagem que some sem explicação é a pior forma de depurar uma integração.
 */
/**
 * Uma mensagem chegou.
 *
 * A ordem das decisões é a mesma sempre, e cada recusa deixa registro com o motivo —
 * uma mensagem que some sem explicação é a pior forma de depurar uma integração.
 *
 * A regra que muda tudo no fim: **sem assinatura não há evento**. A mensagem entra no
 * histórico e para ali. Publicar assim mesmo criaria um fato que ninguém pediu, que
 * ocupa o barramento e que um gatilho escrito à mão poderia pegar — e o dono nunca
 * disse que queria aquilo.
 */
export async function ingestWebSocketMessage(
  ownerId: string,
  installationId: string,
  bruto: string,
  config: WsConnectionConfig,
  now = new Date(),
): Promise<{ status: WsMessageStatus; eventIds: string[] }> {
  const guardar = async (status: WsMessageStatus, dados: Partial<WsMessage> = {}) => {
    const doc: WsMessage = {
      _id: new ObjectId(),
      ownerId,
      installationId,
      subscriptionId: null,
      subscriptionIds: [],
      channel: '',
      status,
      preview: '',
      messageId: null,
      eventId: null,
      eventIds: [],
      occurredAt: now,
      receivedAt: now,
      expiresAt: new Date(now.getTime() + MESSAGE_RETENTION_DAYS * 86_400_000),
      ...dados,
    }
    return insertMessage(doc)
  }

  /**
   * O teto por minuto vem ANTES de qualquer trabalho, e uma rajada custa QUASE NADA.
   *
   * A contagem é síncrona e em memória: sem ela, mil mensagens simultâneas leem o mesmo
   * total no banco e passam todas, que é justamente a rajada que o limite existe para
   * conter.
   *
   * E o excedente não vira duas escritas por mensagem. A primeira do minuto fica
   * registrada — para a tela mostrar que aconteceu — e o resto só incrementa um contador
   * na memória, resumido num log por janela. Um serviço em loop chegava a duas escritas
   * por mensagem descartada, que é o oposto de proteger o banco.
   */
  const excesso = registerOverflow(ownerId, installationId, config.maxMessagesPerMinute, now.getTime())
  if (excesso.limited) {
    if (excesso.first) {
      await guardar('rate_limited', { preview: previewOf(bruto), reason: `acima de ${config.maxMessagesPerMinute} mensagens por minuto` })
      await writeLog(ownerId, installationId, 'dropped', `limite de ${config.maxMessagesPerMinute} mensagens por minuto atingido`, null, now)
    } else if (excesso.summarize) {
      // Um resumo por janela, e não uma linha por mensagem.
      await writeLog(ownerId, installationId, 'dropped', `${excesso.dropped} mensagens descartadas por limite nesta janela`, null, now)
    }
    return { status: 'rate_limited', eventIds: [] }
  }

  const lida = parseMessage(bruto, config)
  if (lida.status !== 'accepted') {
    await guardar(lida.status, { preview: lida.preview, reason: lida.reason })
    await writeLog(ownerId, installationId, lida.status === 'filtered' ? 'dropped' : 'invalid', lida.reason, null, now)
    return { status: lida.status, eventIds: [] }
  }

  const chave = dedupeKeyOf(config, lida.messageId, lida.payload)
  const brutaJson = config.format === 'json' ? JSON.parse(bruto) : bruto

  /**
   * O objeto NORMALIZADO, e o último valor da chave.
   *
   * Acontece antes das assinaturas de propósito: o dado ao vivo é da CONEXÃO, não de
   * quem a está ouvindo. Uma cotação que nenhuma assinatura reivindicou continua sendo
   * a cotação — e é ela que um cálculo vai querer daqui a um segundo.
   *
   * E é aqui que a promessa "sem LLM por tique" se cumpre: guardar o valor não publica
   * evento, não dispara rotina e não chama modelo nenhum.
   */
  const mapeado = applyMapping(lida.payload, config.mapping)
  if (mapeado && config.liveKeyPath) {
    const chaveViva = mapeado[config.liveKeyPath]
    if (typeof chaveViva === 'string' || typeof chaveViva === 'number') {
      const coube = await putLiveValue(ownerId, installationId, String(chaveViva), mapeado, config.liveTtlSeconds, now)
      if (!coube) await writeLog(ownerId, installationId, 'dropped', 'limite de chaves de dado ao vivo atingido nesta conexão', null, now)
    }
  }

  /**
   * TODAS as assinaturas que a reivindicam — não a primeira.
   *
   * Duas assinaturas com canais que se sobrepõem faziam a segunda nunca receber nada, e
   * nada na tela explicava por quê.
   */
  const ativas = await activeSubscriptions(ownerId, installationId)
  const reivindicaram = subscriptionsFor(brutaJson, lida.channel, ativas)

  const comum = {
    preview: lida.preview,
    channel: lida.channel,
    messageId: chave,
    occurredAt: lida.occurredAt ?? now,
  }

  // Nenhuma assinatura: histórico, e nada mais. Sem evento, sem destino, sem token.
  if (reivindicaram.length === 0) {
    const so = await guardar('ignored', { ...comum, reason: 'nenhuma assinatura ativa reivindicou esta mensagem' })
    if (!so) return registrarDuplicata(ownerId, installationId, comum, now)
    return { status: 'ignored', eventIds: [] }
  }

  const ids = reivindicaram.map((s) => s._id.toString())
  const gravada = await guardar('accepted', { ...comum, subscriptionId: ids[0], subscriptionIds: ids })
  if (!gravada) return registrarDuplicata(ownerId, installationId, { ...comum, subscriptionId: ids[0], subscriptionIds: ids }, now)

  /**
   * UM evento por assinatura.
   *
   * É o que dá isolamento e idempotência de verdade: a chave de dedupe carrega a
   * assinatura, então a retentativa de uma não repete a outra, e uma falha na entrega
   * de uma não impede a seguinte de sair.
   */
  const eventIds: string[] = []
  for (const assinatura of reivindicaram) {
    /**
     * O ESPAÇO mínimo entre dois eventos da mesma chave.
     *
     * O Live Data Store aceita todo tique porque guardar é barato e o valor substitui o
     * anterior. O barramento é o contrário: cada evento é durável, entregue e pode
     * disparar trabalho. Sem este freio, uma cotação ativa vira seiscentos eventos por
     * minuto — e o dono só descobre na fatura.
     *
     * O que é engolido aqui não se perde: o valor está no Live Data Store, com o
     * horário, e quem precisa dele o lê quando precisar.
     */
    if (config.publishThrottleMs > 0) {
      const chaveThrottle = `${assinatura._id.toString()}:${mapeado && config.liveKeyPath ? String(mapeado[config.liveKeyPath] ?? '') : ''}`
      if (!podePublicar(installationId, chaveThrottle, config.publishThrottleMs, now.getTime())) continue
    }
    try {
      const { event } = await publishEvent(
        {
          ownerId,
          type: 'integration.websocket.message',
          source: `websocket:${installationId}`,
          payload: {
            ownerId,
            connectionId: installationId,
            subscriptionId: assinatura._id.toString(),
            channel: lida.channel,
            occurredAt: (lida.occurredAt ?? now).toISOString(),
            /**
             * O conteúdo é de FORA e não é confiável.
             *
             * A marca viaja com o dado para quem consumir saber disso — um agente que
             * receba isto trata como texto de terceiro, não como instrução.
             */
            untrusted: true,
            /** O quadro cru, já recortado pelo caminho configurado. */
            payload: lida.payload,
            /** O mesmo fato com os nomes normalizados, quando há mapeamento. */
            ...(mapeado ? { mappedData: mapeado } : {}),
            receivedAt: now.toISOString(),
          },
          occurredAt: lida.occurredAt ?? now,
          dedupeKey: `ws:${installationId}:${assinatura._id.toString()}:${chave ?? gravada._id.toString()}`,
        },
        now,
      )
      eventIds.push(event.eventId)
      await countSubscriptionMessage(assinatura._id, now)
    } catch (error) {
      // Uma assinatura que falha não leva as outras junto. O motivo fica registrado, e
      // a mensagem continua no histórico com o que deu certo.
      await writeLog(
        ownerId,
        installationId,
        'error',
        `assinatura "${assinatura.name}": não foi possível publicar o evento`,
        assinatura._id.toString(),
        now,
      )
      void error
    }
  }

  await linkEvents(gravada._id, eventIds, eventIds.length < reivindicaram.length)
  return { status: eventIds.length ? 'accepted' : 'failed', eventIds }
}

/**
 * A duplicata, REGISTRADA.
 *
 * O índice único recusa a segunda gravação — e antes daqui isso era tudo: a tela
 * oferecia o filtro "Repetida" e nunca tinha o que mostrar nele. Agora fica uma linha
 * sem `messageId` (que é o campo do índice), com a situação e o motivo.
 */
async function registrarDuplicata(
  ownerId: string,
  installationId: string,
  dados: Partial<WsMessage>,
  now: Date,
): Promise<{ status: WsMessageStatus; eventIds: string[] }> {
  await insertMessage({
    _id: new ObjectId(),
    ownerId,
    installationId,
    subscriptionId: dados.subscriptionId ?? null,
    subscriptionIds: dados.subscriptionIds ?? [],
    channel: dados.channel ?? '',
    status: 'duplicate',
    preview: dados.preview ?? '',
    reason: 'já recebida antes (deduplicação)',
    // Sem `messageId`: ele é a chave do índice único, e é justamente por ela que esta
    // mensagem foi recusada.
    messageId: null,
    eventId: null,
    eventIds: [],
    occurredAt: dados.occurredAt ?? now,
    receivedAt: now,
    expiresAt: new Date(now.getTime() + MESSAGE_RETENTION_DAYS * 86_400_000),
  })
  await writeLog(ownerId, installationId, 'dropped', 'mensagem repetida (deduplicação)', dados.subscriptionId ?? null, now)
  return { status: 'duplicate', eventIds: [] }
}

/** O fio entre a tela de Mensagens e o barramento. */
async function linkEvents(id: ObjectId, eventIds: string[], parcial: boolean): Promise<void> {
  const { messagesCollection } = await import('./repository.js')
  await messagesCollection
    .updateOne(
      { _id: id },
      {
        $set: {
          eventIds,
          eventId: eventIds[0] ?? null,
          // Alguma assinatura ficou sem evento: a mensagem não foi entregue por inteiro,
          // e a tela precisa dizer isso em vez de mostrar "Recebida".
          ...(parcial ? { status: 'failed' as const, reason: 'nem todas as assinaturas receberam o evento' } : {}),
        },
      },
    )
    .catch(() => undefined)
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
