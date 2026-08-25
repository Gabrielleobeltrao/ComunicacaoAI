import WebSocket from 'ws'
import type { StreamSocket } from './manager.js'

/**
 * O socket de verdade.
 *
 * `ws` e não o `WebSocket` global do Node por uma razão só: o global não deixa mandar
 * cabeçalho no handshake, e há serviço que só autentica assim. Um caminho para
 * cabeçalho e outro para o resto seriam dois caminhos com dois conjuntos de defeitos.
 *
 * Os handlers são atribuídos por propriedade (`onopen`, `onmessage`…), que é o que o
 * gerenciador espera — e o `ws` implementa exatamente isso.
 */
export interface SocketOptions {
  /** Cabeçalhos do handshake. Podem conter credencial: nunca são registrados. */
  headers?: Record<string, string>
  /** Subprotocolos oferecidos ao servidor. */
  protocols?: string[]
  handshakeTimeoutMs?: number
  /**
   * O endereço já conferido. Quando presente, é NELE que a conexão é aberta.
   *
   * O nome continua na URL — e por isso o SNI e o `Host` continuam certos —, mas a
   * resolução não acontece de novo na hora de conectar. É o que fecha a janela entre
   * conferir e abrir, que é onde o rebinding mora.
   */
  pinnedAddress?: { address: string; family: 4 | 6 } | null
}

/** Quanto tempo esperar o handshake antes de desistir. */
export const HANDSHAKE_TIMEOUT_MS = Number(process.env.WS_HANDSHAKE_TIMEOUT_MS ?? 15_000)

export const createRealSocket = (url: string, opts: SocketOptions = {}): StreamSocket => {
  const socket = new WebSocket(url, opts.protocols ?? [], {
    ...(opts.headers && Object.keys(opts.headers).length ? { headers: opts.headers } : {}),
    /**
     * A resolução JÁ ACONTECEU e já foi conferida: esta função só devolve o resultado.
     *
     * Sem ela, o `ws` resolveria o nome de novo na hora de abrir o socket — e entre a
     * nossa conferência e aquele momento o DNS pode ter mudado de ideia.
     */
    ...(opts.pinnedAddress
      ? {
          lookup: (_hostname: string, _options: unknown, callback: (err: Error | null, address: string, family: number) => void) => {
            callback(null, opts.pinnedAddress!.address, opts.pinnedAddress!.family)
          },
        }
      : {}),
    handshakeTimeout: opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
    // Um quadro maior que isto é recusado pelo próprio `ws`, antes de virar memória
    // nossa. O corte por conteúdo acontece depois, na leitura — este é o teto físico.
    maxPayload: Number(process.env.WS_MAX_FRAME_BYTES ?? 1_048_576),
    followRedirects: false,
  })

  /**
   * O pong, ligado por evento e exposto como propriedade.
   *
   * O `ws` entrega `pong` por `on(...)`, e o gerenciador atribui handlers por
   * propriedade — como faz com todos os outros. Um ouvinte registrado aqui, uma vez,
   * traduz uma coisa na outra sem espalhar `on(...)` pelo gerenciador, que precisa
   * continuar funcionando com o socket falso dos testes.
   */
  const fora = socket as unknown as StreamSocket
  socket.on('pong', () => fora.onpong?.())
  return fora
}
