import { backoffMs, publishEvent } from '../events/bus.js'
import { markStreamEvent, setStreamError, setStreamState } from './repository.js'
import type { StreamAdapter, StreamContext, StreamRecord, StreamState } from './types.js'

/**
 * O GERENCIADOR de streams: mantém conexões de longa duração de pé e traduz o que
 * chega em evento interno.
 *
 * Ele não sabe nada de nenhum provider. URL, formato de subscribe, nome do campo do
 * preço — tudo isso mora no adapter. O que mora aqui é só a parte chata que todo
 * provider precisa e ninguém quer escrever duas vezes: reconectar com espera
 * crescente, não reconectar o que foi pausado de propósito, perceber que o outro lado
 * calou, e nunca deixar a credencial vazar para um log.
 */

/** O pedaço de WebSocket que usamos. O `WebSocket` do Node cabe aqui sem adaptador. */
export interface StreamSocket {
  send(data: string): void
  close(): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export type SocketFactory = (url: string) => StreamSocket

export interface ManagerDeps {
  createSocket?: SocketFactory
  /** Onde os adapters vivem. A Fase 5 registra o da Alpaca aqui. */
  adapters: Map<string, StreamAdapter>
  /**
   * A credencial, buscada na hora de conectar e nunca guardada no gerenciador.
   *
   * Devolver `null` é recusa legítima: conexão revogada não reconecta.
   */
  credentialsOf: (ownerId: string, installationId: string) => Promise<Record<string, string> | null>
  publish?: typeof publishEvent
  schedule?: (fn: () => void, ms: number) => { unref?: () => void }
  cancel?: (t: unknown) => void
  onError?: (where: string, error: unknown) => void
}

/** Sem notícia nenhuma por este tempo, presume-se morto e reconecta. */
const SILENCIO_MS = Number(process.env.STREAM_IDLE_TIMEOUT_MS ?? 90_000)
const HEARTBEAT_MS = Number(process.env.STREAM_HEARTBEAT_MS ?? 30_000)
/** Depois disto, para de tentar e deixa o erro visível em vez de bater para sempre. */
const MAX_TENTATIVAS = Number(process.env.STREAM_MAX_RECONNECTS ?? 10)

interface Vivo {
  record: StreamRecord
  adapter: StreamAdapter
  socket: StreamSocket | null
  state: StreamState
  tentativas: number
  symbols: Set<string>
  timers: unknown[]
  /** Marcado no stop: um close que chega depois disso não deve reconectar. */
  encerrado: boolean
  /**
   * Os valores da credencial em uso, para RISCAR de qualquer texto que vá ser gravado.
   *
   * Não é paranoia: um erro de autenticação costuma vir do provider com a mensagem que
   * a causou junto — e a mensagem que a causou é a que tem a chave. Sem isto, a
   * credencial acaba no `lastError` do stream, que a tela mostra.
   */
  segredos: string[]
}

/**
 * O único caminho por onde um texto vira registro. Corta o tamanho e risca a credencial.
 */
function naoLoga(texto: string, segredos: readonly string[] = []): string {
  let limpo = String(texto ?? '')
  for (const segredo of segredos) limpo = limpo.split(segredo).join('***')
  return limpo.slice(0, 300)
}

export class StreamManager {
  private readonly vivos = new Map<string, Vivo>()
  private readonly deps: Required<Pick<ManagerDeps, 'createSocket' | 'publish' | 'schedule' | 'cancel' | 'onError'>> & ManagerDeps

  constructor(deps: ManagerDeps) {
    this.deps = {
      ...deps,
      createSocket: deps.createSocket ?? ((url) => new WebSocket(url) as unknown as StreamSocket),
      publish: deps.publish ?? publishEvent,
      schedule: deps.schedule ?? ((fn, ms) => setTimeout(fn, ms)),
      cancel: deps.cancel ?? ((t) => clearTimeout(t as NodeJS.Timeout)),
      onError: deps.onError ?? (() => undefined),
    }
  }

  stateOf(id: string): StreamState {
    return this.vivos.get(id)?.state ?? 'disconnected'
  }

  get activeCount(): number {
    return this.vivos.size
  }

  /**
   * Subir um stream. Chamar de novo para o mesmo id não abre uma segunda conexão —
   * atualiza os símbolos e pronto.
   */
  async start(record: StreamRecord): Promise<void> {
    const id = record._id.toString()
    if (record.paused) return
    const existente = this.vivos.get(id)
    if (existente) {
      await this.subscribe(id, record.symbols)
      return
    }
    const adapter = this.deps.adapters.get(record.appKey)
    if (!adapter) {
      await setStreamError(record._id, `nenhum adapter registrado para "${record.appKey}"`)
      return
    }
    const vivo: Vivo = {
      record,
      adapter,
      socket: null,
      state: 'disconnected',
      tentativas: 0,
      symbols: new Set(record.symbols),
      timers: [],
      encerrado: false,
      segredos: [],
    }
    this.vivos.set(id, vivo)
    await this.conectar(vivo)
  }

  /** Descer. Idempotente: parar o que já está parado é um no-op, não um erro. */
  async stop(id: string): Promise<void> {
    const vivo = this.vivos.get(id)
    if (!vivo) return
    vivo.encerrado = true
    this.limparTimers(vivo)
    try {
      vivo.socket?.close()
    } catch {
      // Fechar um socket já morto não é notícia.
    }
    this.vivos.delete(id)
    await setStreamState(vivo.record._id, 'disconnected')
  }

  async subscribe(id: string, symbols: readonly string[]): Promise<void> {
    const vivo = this.vivos.get(id)
    if (!vivo) return
    const novos = symbols.filter((s) => !vivo.symbols.has(s))
    for (const s of symbols) vivo.symbols.add(s)
    // Já inscrito é já inscrito: mandar de novo só gera ruído do outro lado.
    if (novos.length && vivo.state === 'connected') this.enviar(vivo, vivo.adapter.subscribeMessage(novos))
  }

  async unsubscribe(id: string, symbols: readonly string[]): Promise<void> {
    const vivo = this.vivos.get(id)
    if (!vivo) return
    const tinha = symbols.filter((s) => vivo.symbols.has(s))
    for (const s of symbols) vivo.symbols.delete(s)
    if (tinha.length && vivo.state === 'connected') this.enviar(vivo, vivo.adapter.unsubscribeMessage(tinha))
  }

  /** Descer tudo, sem apagar nada: o que estava de pé volta no próximo start. */
  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.vivos.keys()].map((id) => this.stop(id)))
  }

  // --- conexão -------------------------------------------------------------------

  private async conectar(vivo: Vivo): Promise<void> {
    const id = vivo.record._id.toString()
    vivo.state = vivo.tentativas === 0 ? 'connecting' : 'reconnecting'
    await setStreamState(vivo.record._id, vivo.state)

    const credencial = await this.deps.credentialsOf(vivo.record.ownerId, vivo.record.installationId)
    if (!credencial) {
      // Conexão revogada ou sumida. Reconectar seria bater numa porta que foi fechada
      // de propósito — e com uma credencial que já não vale.
      vivo.state = 'error'
      this.vivos.delete(id)
      await setStreamError(vivo.record._id, 'conexão indisponível: revogada, expirada ou removida')
      return
    }
    // Um valor curto demais riscaria pedaços de mensagem legítima — `paper`, `usd`.
    vivo.segredos = Object.values(credencial).filter((v) => typeof v === 'string' && v.length >= 8)

    let socket: StreamSocket
    try {
      socket = this.deps.createSocket(vivo.adapter.url(vivo.record.environment))
    } catch (error) {
      await this.quebrou(vivo, error instanceof Error ? error.message : 'falha ao abrir o socket')
      return
    }
    vivo.socket = socket

    socket.onopen = () => {
      vivo.tentativas = 0
      vivo.state = 'connected'
      void setStreamState(vivo.record._id, 'connected').catch((e) => this.deps.onError(`stream ${id} estado`, e))
      // A autenticação vai direto para o socket. Ela não passa por log, não entra no
      // documento do stream e não vira trace: o único registro é que foi enviada.
      const auth = vivo.adapter.authMessage?.(credencial)
      if (auth !== undefined) this.enviar(vivo, auth)
      if (vivo.symbols.size) this.enviar(vivo, vivo.adapter.subscribeMessage([...vivo.symbols]))
      this.armarRelogios(vivo)
    }

    socket.onmessage = (ev) => {
      this.armarRelogios(vivo)
      void this.receber(vivo, ev.data).catch((e) => this.deps.onError(`stream ${id} mensagem`, e))
    }

    socket.onerror = (ev) => {
      // O quadro cru NÃO entra: um erro de autenticação costuma vir com a mensagem
      // que continha a credencial.
      const msg = typeof ev === 'object' && ev !== null && typeof (ev as { message?: unknown }).message === 'string' ? (ev as { message: string }).message : 'erro no socket'
      void setStreamError(vivo.record._id, naoLoga(msg, vivo.segredos)).catch((e) => this.deps.onError(`stream ${id} erro`, e))
    }

    socket.onclose = () => {
      if (vivo.encerrado) return
      void this.quebrou(vivo, 'conexão encerrada pelo outro lado').catch((e) => this.deps.onError(`stream ${id} fechamento`, e))
    }
  }

  private async receber(vivo: Vivo, data: unknown): Promise<void> {
    const ctx: StreamContext = {
      ownerId: vivo.record.ownerId,
      streamId: vivo.record._id.toString(),
      installationId: vivo.record.installationId,
      environment: vivo.record.environment,
      source: `${vivo.record.appKey}:${vivo.record.environment}`,
    }
    let bruto: unknown = data
    if (typeof data === 'string') {
      try {
        bruto = JSON.parse(data)
      } catch {
        // Um quadro que não é JSON não é fato de mercado — é ping, texto de controle
        // ou lixo. Ignorar é a resposta certa; derrubar a conexão não é.
        return
      }
    }
    const problema = vivo.adapter.errorOf?.(bruto)
    if (problema) {
      await setStreamError(vivo.record._id, naoLoga(problema, vivo.segredos))
      return
    }
    const entradas = vivo.adapter.parse(bruto, ctx)
    if (!entradas.length) return
    let publicados = 0
    for (const entrada of entradas) {
      // Um evento por vez: a chave de dedupe do adapter é o que impede o eco da
      // reconexão de virar um segundo fato.
      const { created } = await this.deps.publish(entrada)
      if (created) publicados += 1
    }
    await markStreamEvent(vivo.record._id, publicados)
  }

  private async quebrou(vivo: Vivo, motivo: string): Promise<void> {
    const id = vivo.record._id.toString()
    this.limparTimers(vivo)
    vivo.socket = null
    vivo.tentativas += 1
    if (vivo.tentativas > MAX_TENTATIVAS) {
      vivo.state = 'error'
      this.vivos.delete(id)
      await setStreamError(vivo.record._id, `${naoLoga(motivo, vivo.segredos)} — desistindo após ${MAX_TENTATIVAS} tentativas`)
      return
    }
    vivo.state = 'reconnecting'
    await setStreamState(vivo.record._id, 'reconnecting')
    // Espera crescente com jitter — a mesma do barramento. Sem o jitter, cem streams
    // que caíram junto voltam junto e derrubam de novo o que acabou de subir.
    const timer = this.deps.schedule(() => {
      if (vivo.encerrado) return
      void this.conectar(vivo).catch((e) => this.deps.onError(`stream ${id} reconexão`, e))
    }, backoffMs(vivo.tentativas))
    timer.unref?.()
    vivo.timers.push(timer)
  }

  private enviar(vivo: Vivo, mensagem: unknown): void {
    try {
      vivo.socket?.send(typeof mensagem === 'string' ? mensagem : JSON.stringify(mensagem))
    } catch (error) {
      // Falhar ao enviar é sintoma de socket morto: o `onclose` vem em seguida e a
      // reconexão é dele. Registrar aqui só duplicaria o mesmo erro.
      this.deps.onError(`stream ${vivo.record._id.toString()} envio`, error)
    }
  }

  /** Heartbeat e detector de silêncio, rearmados a cada mensagem. */
  private armarRelogios(vivo: Vivo): void {
    this.limparTimers(vivo)
    if (vivo.adapter.heartbeatMessage) {
      const bater = this.deps.schedule(() => this.enviar(vivo, vivo.adapter.heartbeatMessage?.()), HEARTBEAT_MS)
      bater.unref?.()
      vivo.timers.push(bater)
    }
    const mudo = this.deps.schedule(() => {
      // Um socket que não fecha mas também não fala é o pior caso: sem isto o stream
      // fica "connected" para sempre sem entregar nada.
      try {
        vivo.socket?.close()
      } catch {
        // já era
      }
      void this.quebrou(vivo, 'sem mensagens do provider').catch(() => undefined)
    }, SILENCIO_MS)
    mudo.unref?.()
    vivo.timers.push(mudo)
  }

  private limparTimers(vivo: Vivo): void {
    for (const t of vivo.timers) this.deps.cancel(t)
    vivo.timers = []
  }
}

/** Uma instância por processo, criada quando o worker sobe. */
let atual: StreamManager | null = null
export const setStreamManager = (m: StreamManager | null): void => {
  atual = m
}
export const streamManager = (): StreamManager | null => atual
