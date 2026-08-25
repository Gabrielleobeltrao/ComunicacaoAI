import type { ObjectId } from 'mongodb'
import type { PublishInput } from '../events/types.js'

/**
 * O ESTADO de um stream, do jeito que a tela precisa contar.
 *
 * `paused` é diferente de `disconnected` de propósito: pausado foi decisão de alguém e
 * não deve reconectar sozinho; desconectado é acidente e deve.
 */
export type StreamState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'paused'

export const STREAM_STATES: readonly StreamState[] = ['disconnected', 'connecting', 'connected', 'reconnecting', 'error', 'paused']

/**
 * O que um provider precisa saber fazer para virar um stream aqui.
 *
 * Tudo que é específico do provider — URL, formato do subscribe, nome do campo do
 * preço — mora no adapter. Nenhum `if (provider === 'alpaca')` no gerenciador: é
 * exatamente assim que uma integração vira dez condicionais espalhadas.
 */
export interface StreamAdapter {
  /** A chave do App a que este adapter pertence. */
  readonly appKey: string
  /** O endereço por ambiente. `live` nunca é entregue neste ciclo (ver connectionProfile). */
  url(environment: string): string
  /**
   * A primeira mensagem, com a credencial.
   *
   * Ela é montada aqui e entregue direto ao socket: não passa por log, não entra em
   * trace e não aparece no documento do stream. Quem for depurar vê `auth enviada`.
   */
  authMessage?(credencial: Record<string, string>): unknown
  subscribeMessage(symbols: readonly string[]): unknown
  unsubscribeMessage(symbols: readonly string[]): unknown
  /** O que mandar de tempos em tempos para o outro lado saber que ainda estamos aqui. */
  heartbeatMessage?(): unknown
  /**
   * Cabeçalhos do handshake, quando o serviço autentica assim.
   *
   * Recebem a credencial e por isso NUNCA são registrados — nem em log, nem no
   * documento do stream, nem em trace.
   */
  handshakeHeaders?(credencial: Record<string, string>): Record<string, string>
  /** Subprotocolos oferecidos. Alguns serviços exigem um para aceitar a conexão. */
  protocols?(): string[]
  /**
   * Os intervalos DESTA conexão, quando ela tem os seus.
   *
   * Ausentes, valem os do ambiente. Presentes, ganham — quem conectou sabe melhor do
   * que uma variável global de quanto em quanto tempo aquele serviço espera um ping.
   * O teto continua sendo do ambiente: a configuração escolhe abaixo dele.
   */
  heartbeatIntervalMs?(): number
  idleTimeoutMs?(): number
  /**
   * Traduzir um quadro do provider em eventos internos.
   *
   * Devolver lista vazia é resposta legítima e comum: ack de subscribe, pong e
   * mensagem de controle não são fato de mercado.
   */
  parse(raw: unknown, ctx: StreamContext): PublishInput[]
  /**
   * Os quadros a mandar DEPOIS de conectar e autenticar.
   *
   * Existe porque a inscrição de um App genérico não cabe em `subscribeMessage`: aquilo
   * recebe símbolos, e o que precisa ser enviado aqui é o que está guardado no banco —
   * as assinaturas ativas daquela conexão, que mudam sem o stream cair.
   *
   * Chamado a cada conexão E a cada reconexão: um serviço que caiu esqueceu tudo que
   * tinha sido pedido, e voltar conectado sem reassinar é voltar mudo.
   */
  framesOnConnect?(ctx: StreamContext): Promise<string[]>
  /**
   * Cuida da mensagem INTEIRA, no lugar de `parse`.
   *
   * Existe porque nem todo provedor traduz uma mensagem em um fato. Um stream de
   * mercado traduz: cada negócio é um evento, e a decisão é pura. Um serviço genérico
   * não: o que fazer com a mensagem depende de limite por minuto, deduplicação e
   * assinatura ativa — tudo estado no banco, e nada disso cabe numa função pura.
   *
   * Recebe o quadro CRU, antes de qualquer interpretação: o formato é configuração de
   * quem conectou, não do gerenciador. Devolve quantas viraram evento, que é o que a
   * contagem do stream precisa saber.
   */
  ingest?(raw: string, ctx: StreamContext): Promise<number>
  /** Um quadro que o provider chama de erro. Sem isto, um erro de auth vira silêncio. */
  errorOf?(raw: unknown): string | null
  /**
   * O provider confirmou a autenticação?
   *
   * Existe para o TESTE de conexão poder responder a pergunta certa. Sem isto, o teste
   * só saberia dizer que o socket abriu — e um socket abre com credencial errada
   * também; a recusa vem depois, na mensagem.
   */
  authOkOf?(raw: unknown): boolean
}

export interface StreamContext {
  ownerId: string
  streamId: string
  installationId: string
  environment: string
  source: string
}

/**
 * O stream como ele fica GUARDADO — a intenção, não a conexão.
 *
 * A conexão viva mora na memória do worker e morre com ele. O que sobrevive é isto:
 * quais streams deviam estar de pé e com quais símbolos. É o que faz o restart
 * restaurar em vez de esquecer.
 */
export interface StreamRecord {
  _id: ObjectId
  ownerId: string
  installationId: string
  appKey: string
  environment: string
  symbols: string[]
  /** Desejo do dono: pausado não sobe no restart. */
  paused: boolean
  state: StreamState
  lastConnectedAt: Date | null
  lastEventAt: Date | null
  /** Só a mensagem, e curta. Nunca o quadro cru, que pode conter credencial. */
  lastError: { message: string; at: Date } | null
  eventCount: number
  createdAt: Date
  updatedAt: Date
}

export interface StreamPublic {
  id: string
  installationId: string
  appKey: string
  environment: string
  symbols: string[]
  state: StreamState
  lastConnectedAt: string | null
  lastEventAt: string | null
  lastError: { message: string; at: string } | null
  eventCount: number
}

export const streamPublic = (s: StreamRecord): StreamPublic => ({
  id: s._id.toString(),
  installationId: s.installationId,
  appKey: s.appKey,
  environment: s.environment,
  symbols: s.symbols,
  state: s.paused ? 'paused' : s.state,
  lastConnectedAt: s.lastConnectedAt ? s.lastConnectedAt.toISOString() : null,
  lastEventAt: s.lastEventAt ? s.lastEventAt.toISOString() : null,
  lastError: s.lastError ? { message: s.lastError.message, at: s.lastError.at.toISOString() } : null,
  eventCount: s.eventCount,
})

/** Teto por dono. Um stream por símbolo, mil símbolos, e o worker vira um cliente de DDoS. */
export const MAX_STREAMS_PER_OWNER = Number(process.env.MAX_STREAMS_PER_OWNER ?? 5)
export const MAX_SYMBOLS_PER_STREAM = Number(process.env.MAX_SYMBOLS_PER_STREAM ?? 50)
