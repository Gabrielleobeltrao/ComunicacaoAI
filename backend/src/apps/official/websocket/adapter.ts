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
  now?: Date,
  /** A credencial em uso, para ser riscada do que for guardado. */
  segredos?: readonly string[],
) => Promise<{ status: string; eventIds: string[] }>

/** As inscrições guardadas desta conexão. Injetado para o adapter não puxar o banco. */
export type WsFrames = (ownerId: string, installationId: string) => Promise<string[]>

export function buildWebSocketAdapter(
  config: WsConnectionConfig,
  credencial: string,
  ingest: WsIngest,
  frames: WsFrames,
  /** O endereço já conferido. A conexão abre nele; o nome vai à parte, no SNI. */
  pinned?: { address: string; family: 4 | 6 } | null,
): StreamAdapter {
  return {
    appKey: 'websocket',

    /**
     * O endereço COM a credencial, montado na hora de conectar.
     *
     * Duas coisas acontecem aqui, e as duas só nos VALORES da query:
     *
     * `{{token}}` escrito num parâmetro é substituído. A configuração aceita isso — é
     * como se guarda um endereço com chave sem guardar a chave —, e sem esta linha o
     * socket abria com o marcador literal e o serviço recusava por uma razão que a tela
     * não tinha como explicar.
     *
     * `auth.kind: "query"` acrescenta o parâmetro dele. Quando os dois estão
     * configurados para o MESMO nome, o de autenticação ganha: ele é a configuração
     * explícita de autenticação, e ter dois valores para o mesmo parâmetro seria
     * ambíguo — o servidor escolheria um deles e ninguém saberia qual.
     *
     * Host e caminho não passam por substituição nenhuma: um `{{token}}` ali mudaria
     * PARA ONDE a conexão vai, e o endereço já foi conferido contra destino interno.
     * `URLSearchParams` cuida da codificação; concatenar texto não cuidaria.
     */
    url: () => {
      if (!credencial) return config.endpoint
      const url = new URL(config.endpoint)
      let mudou = false
      for (const [nome, valor] of [...url.searchParams]) {
        if (!valor.includes('{{token}}')) continue
        url.searchParams.set(nome, fillToken(valor, credencial))
        mudou = true
      }
      if (config.auth.kind === 'query' && config.auth.name) {
        url.searchParams.set(config.auth.name, `${config.auth.prefix}${credencial}`)
        mudou = true
      }
      return mudou ? url.toString() : config.endpoint
    },

    handshakeHeaders: () => {
      const fora: Record<string, string> = {}
      // Os extras primeiro: assim o de autenticação nunca é sobrescrito por um extra
      // com o mesmo nome — o que seria uma forma silenciosa de derrubar a autenticação.
      for (const h of config.headers) fora[h.name] = fillToken(h.value, credencial)
      if (config.auth.kind === 'header' && credencial) fora[config.auth.name] = `${config.auth.prefix}${credencial}`
      return fora
    },

    protocols: () => config.protocols,

    pinnedAddress: () => pinned ?? null,

    /**
     * A primeira mensagem, quando é assim que o serviço autentica.
     *
     * O formato manda: numa conexão de texto o quadro sai como texto. Antes daqui ele
     * era sempre `JSON.parse`ado, então uma conexão de texto que autenticasse por
     * mensagem quebrava na abertura — num App que se diz genérico.
     *
     * `{{token}}` é o único template que existe: uma substituição, de um nome conhecido,
     * por um valor conhecido.
     */
    authMessage:
      config.auth.kind === 'message'
        ? () => {
            const quadro = fillToken(config.auth.messageTemplate, credencial)
            return config.format === 'text' ? quadro : JSON.parse(quadro)
          }
        : undefined,

    /**
     * `symbols` não é usado por este App — forçar configuração genérica naquele campo
     * era exatamente o que não podia acontecer. Devolver `undefined` faz o gerenciador
     * não mandar nada por este caminho.
     */
    subscribeMessage: () => undefined,
    unsubscribeMessage: () => undefined,

    /**
     * O que sai depois de conectar, NA ORDEM: primeiro as mensagens iniciais que a
     * conexão declara, depois as inscrições guardadas.
     *
     * A ordem é a regra dos serviços, não uma preferência: quem exige autenticar antes
     * de assinar recusa a inscrição que chega primeiro — e recusa calado, com a conexão
     * de pé e nenhum dado chegando.
     *
     * As inscrições vêm do banco, e por isso isto é assíncrono. A cada reconexão tudo
     * vai de novo: um serviço que caiu esqueceu tudo que foi pedido.
     */
    framesOnConnect: async (ctx) => [
      ...config.initialMessages.map((m) => fillToken(m, credencial)),
      ...(await frames(ctx.ownerId, ctx.installationId)),
    ],

    // Ping do protocolo quando dá: ele não vira mensagem para a aplicação do outro lado.
    heartbeatNative: () => config.heartbeat.enabled && config.heartbeat.native,
    heartbeatMessage:
      config.heartbeat.enabled && !config.heartbeat.native ? () => (config.format === 'text' ? config.heartbeat.message : JSON.parse(config.heartbeat.message)) : undefined,
    heartbeatTimeoutMs: () => config.heartbeat.timeoutMs,
    connectTimeoutMs: () => config.connectTimeoutMs,

    /**
     * Os intervalos DESTA conexão.
     *
     * O `.env` fica como padrão e como teto; quem conectou sabe melhor do que uma
     * variável global de quanto em quanto tempo aquele serviço espera um ping e quanto
     * silêncio dele é normal.
     */
    heartbeatIntervalMs: () => config.heartbeat.intervalMs,
    idleTimeoutMs: () => config.idleTimeoutMs,

    /**
     * A decisão inteira acontece no serviço, porque ela precisa de banco: teto por
     * minuto, deduplicação e assinatura ativa não cabem numa função pura.
     *
     * `parse` fica vazio e nunca é chamado — o gerenciador usa `ingest` quando ele
     * existe. Está aqui porque o contrato o exige.
     */
    parse: (): PublishInput[] => [],

    ingest: async (raw, ctx) => {
      // A contagem do stream é de EVENTOS publicados: uma mensagem que serviu a duas
      // assinaturas produziu dois fatos, e uma que não serviu a nenhuma produziu zero.
      // A credencial vai junto para ser RISCADA: um serviço que ecoa a autenticação de
      // volta manda a chave de volta como conteúdo.
      const { eventIds } = await ingest(ctx.ownerId, ctx.installationId, raw, config, undefined, credencial ? [credencial] : [])
      return eventIds.length
    },
  }
}
