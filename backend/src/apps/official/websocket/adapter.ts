import type { PublishInput } from '../../../events/types.js'
import type { StreamAdapter } from '../../../streams/types.js'
import { fillToken } from './config.js'
import type { WsConnectionConfig } from './config.js'

/**
 * O adapter DESTA conexão.
 *
 * Diferente do adapter de mercado, que é um só para o App inteiro: aqui endereço,
 * assinatura e formato são configuração de cada conexão, então o adapter é montado a
 * partir dela. É por isso que o gerenciador ganhou `adapterFor` — e é a única coisa que
 * ele precisou ganhar.
 *
 * `parse` devolve UM evento cru por mensagem. Toda a decisão — tamanho, schema, filtro,
 * dedupe, limite — acontece depois, no serviço, porque ela precisa do banco. O adapter
 * é a tradução do transporte, e só.
 */
export const WEBSOCKET_EVENT = 'integration.websocket.message'

/**
 * Quem recebe a mensagem de verdade.
 *
 * Injetado em vez de importado para o adapter não puxar o serviço, que puxa o banco:
 * assim ele continua sendo testável sem mongod, e o ciclo de import não existe.
 */
export type WsIngest = (
  ownerId: string,
  installationId: string,
  raw: string,
  config: WsConnectionConfig,
) => Promise<{ status: string; eventId: string | null }>

export function buildWebSocketAdapter(config: WsConnectionConfig, credencial: string, ingest: WsIngest): StreamAdapter {
  return {
    appKey: 'websocket',

    url: () => {
      // Autenticação por query: o valor entra no endereço na hora de conectar. Ele não
      // é registrado em lugar nenhum — nem no log, nem no documento do stream.
      if (config.auth.kind !== 'query' || !credencial) return config.endpoint
      const url = new URL(config.endpoint)
      url.searchParams.set(config.auth.name, `${config.auth.prefix}${credencial}`)
      return url.toString()
    },

    handshakeHeaders: () =>
      config.auth.kind === 'header' && credencial ? { [config.auth.name]: `${config.auth.prefix}${credencial}` } : {},

    protocols: () => config.protocols,

    // A primeira mensagem, quando é assim que o serviço autentica. `{{token}}` é o único
    // template que existe: uma substituição, de um nome conhecido, por um valor conhecido.
    authMessage: config.auth.kind === 'message' ? () => JSON.parse(fillToken(config.auth.messageTemplate, credencial)) : undefined,

    /**
     * As assinaturas são mandadas pelo SERVIÇO, não daqui.
     *
     * O gerenciador chama isto com `symbols`, que este App não usa — forçar a
     * configuração genérica naquele campo era exatamente o que não podia acontecer.
     * Devolver `undefined` faz o gerenciador não mandar nada.
     */
    subscribeMessage: () => undefined,
    unsubscribeMessage: () => undefined,

    heartbeatMessage: config.heartbeat.enabled ? () => JSON.parse(config.heartbeat.message) : undefined,

    /**
     * A decisão inteira acontece no serviço, porque ela precisa de banco: teto por
     * minuto, deduplicação e assinatura ativa não cabem numa função pura.
     *
     * `parse` fica vazio e nunca é chamado — o gerenciador usa `ingest` quando ele
     * existe. Está aqui porque o contrato o exige.
     */
    parse: (): PublishInput[] => [],

    ingest: async (raw, ctx) => {
      const { status } = await ingest(ctx.ownerId, ctx.installationId, raw, config)
      return status === 'accepted' ? 1 : 0
    },
  }
}
