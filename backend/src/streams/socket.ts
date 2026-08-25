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
}

/** Quanto tempo esperar o handshake antes de desistir. */
export const HANDSHAKE_TIMEOUT_MS = Number(process.env.WS_HANDSHAKE_TIMEOUT_MS ?? 15_000)

export const createRealSocket = (url: string, opts: SocketOptions = {}): StreamSocket => {
  const socket = new WebSocket(url, opts.protocols ?? [], {
    ...(opts.headers && Object.keys(opts.headers).length ? { headers: opts.headers } : {}),
    handshakeTimeout: opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
    // Um quadro maior que isto é recusado pelo próprio `ws`, antes de virar memória
    // nossa. O corte por conteúdo acontece depois, na leitura — este é o teto físico.
    maxPayload: Number(process.env.WS_MAX_FRAME_BYTES ?? 1_048_576),
    followRedirects: false,
  })
  return socket as unknown as StreamSocket
}
