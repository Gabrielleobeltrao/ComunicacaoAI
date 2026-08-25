import { backoffMs, publishEvent } from '../events/bus.js'
import { markStreamEvent, setStreamError, setStreamState } from './repository.js'
import type { SocketOptions } from './socket.js'
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

export type SocketFactory = (url: string, opts?: SocketOptions) => StreamSocket

export interface ManagerDeps {
  createSocket?: SocketFactory
  /** Onde os adapters ESTÁTICOS vivem — um por App, o mesmo para toda conexão. */
  adapters: Map<string, StreamAdapter>
  /**
   * O adapter DESTE stream, quando ele não pode ser estático.
   *
   * Um App de mercado tem um endereço e um formato só: o adapter é o mesmo para todas
   * as conexões, e o mapa acima resolve. Um App genérico de WebSocket não tem isso —
   * endereço, assinatura e formato são configuração de cada conexão, então o adapter
   * precisa ser MONTADO a partir dela.
   *
   * Devolver `null` cai no mapa estático, que é o caminho de sempre.
   */
  adapterFor?: (record: StreamRecord) => Promise<StreamAdapter | null>
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
/** Prazo do teste de conexão. Curto: alguém está olhando a tela esperando. */
const PROBE_MS = Number(process.env.STREAM_PROBE_TIMEOUT_MS ?? 8_000)

interface Vivo {
  record: StreamRecord
  adapter: StreamAdapter
  socket: StreamSocket | null
  state: StreamState
  tentativas: number
  symbols: Set<string>
  /**
   * Qual TENTATIVA de conexão está valendo.
   *
   * Cada `conectar` incrementa, e os handlers do socket guardam a geração em que
   * nasceram. Um `onclose` de um socket antigo — o que o detector de silêncio acabou
   * de fechar, por exemplo — chega depois e é ignorado.
   *
   * Sem isto, fechar por silêncio disparava DUAS quedas para o mesmo evento: a que o
   * detector reporta e a que o `onclose` do fechamento dispara em seguida. Duas quedas
   * são duas reconexões agendadas, e duas reconexões são dois sockets.
   */
  geracao: number
  /**
   * Os relógios, em campos separados em vez de uma lista.
   *
   * Eles têm vidas diferentes: o de silêncio é rearmado a cada mensagem, o batimento
   * corre sozinho de tempos em tempos, e o de reconexão existe só entre uma queda e a
   * próxima tentativa. Guardados juntos numa lista, rearmar um cancelava os outros — e
   * era assim que o batimento acontecia uma vez só e nunca mais.
   */
  timerHeartbeat: unknown
  timerIdle: unknown
  timerReconnect: unknown
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
    // Primeiro o adapter montado a partir da conexão; depois o estático do App.
    const adapter = (await this.deps.adapterFor?.(record)) ?? this.deps.adapters.get(record.appKey) ?? null
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
      geracao: 0,
      timerHeartbeat: null,
      timerIdle: null,
      timerReconnect: null,
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

  /**
   * Abrir, autenticar, fechar. Nada mais.
   *
   * É o teste que responde a pergunta que interessa — "esta credencial entra no
   * stream?" — sem deixar nada de pé: sem reconexão, sem batimento, sem documento e sem
   * socket. Um teste que deixa conexão pendurada é um teste que, repetido, vira um
   * vazamento de sockets.
   */
  async probe(adapter: StreamAdapter, environment: string, credencial: Record<string, string>, timeoutMs = PROBE_MS): Promise<{ ok: boolean; message: string }> {
    const segredos = Object.values(credencial).filter((v) => typeof v === 'string' && v.length >= 8)
    let socket: StreamSocket
    try {
      socket = this.deps.createSocket(adapter.url(environment))
    } catch (error) {
      return { ok: false, message: naoLoga(error instanceof Error ? error.message : 'não foi possível abrir o socket', segredos) }
    }

    return new Promise((resolve) => {
      let terminou = false
      const encerrar = (ok: boolean, message: string) => {
        if (terminou) return
        terminou = true
        if (prazo) this.deps.cancel(prazo)
        // Os handlers saem antes do close: um `onclose` chegando depois da resposta não
        // pode resolver a promessa uma segunda vez nem mexer em nada.
        socket.onopen = null
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null
        try {
          socket.close()
        } catch {
          // já era
        }
        resolve({ ok, message })
      }

      /**
       * Sem `authOkOf`, o provedor não avisa que aceitou — e aí o prazo É a resposta.
       *
       * "Abriu, mandei a credencial e ninguém reclamou" é o melhor que dá para afirmar
       * nesse caso, e a mensagem diz isso em vez de prometer que a credencial vale.
       * Ficar esperando para sempre por uma confirmação que não existe seria pior: o
       * teste nunca terminaria.
       */
      const semConfirmacao = !adapter.authOkOf
      const prazo = this.deps.schedule(
        () =>
          semConfirmacao
            ? encerrar(true, 'Conexão de tempo real aberta; este provedor não confirma a credencial.')
            : encerrar(false, 'O provedor não respondeu a tempo.'),
        timeoutMs,
      )
      prazo.unref?.()

      socket.onopen = () => {
        const auth = adapter.authMessage?.(credencial)
        // Sem autenticação por mensagem, abrir já é a resposta.
        if (auth === undefined) return encerrar(true, 'Conexão de tempo real aberta.')
        try {
          socket.send(JSON.stringify(auth))
        } catch (error) {
          encerrar(false, naoLoga(error instanceof Error ? error.message : 'falha ao autenticar', segredos))
        }
      }
      socket.onmessage = (ev) => {
        let bruto: unknown = ev.data
        if (typeof ev.data === 'string') {
          try {
            bruto = JSON.parse(ev.data)
          } catch {
            return
          }
        }
        const problema = adapter.errorOf?.(bruto)
        if (problema) return encerrar(false, naoLoga(problema, segredos))
        if (adapter.authOkOf?.(bruto)) return encerrar(true, 'Credencial aceita pelo tempo real.')
      }
      socket.onerror = () => encerrar(false, 'O provedor recusou a conexão de tempo real.')
      socket.onclose = () => encerrar(false, 'O provedor fechou a conexão antes de confirmar a credencial.')
    })
  }

  // --- conexão -------------------------------------------------------------------

  private async conectar(vivo: Vivo): Promise<void> {
    const id = vivo.record._id.toString()
    // A partir daqui, tudo que vier de um socket anterior é passado.
    const geracao = (vivo.geracao += 1)
    this.limparTimers(vivo)
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
      // Cabeçalho e subprotocolo são do adapter: só ele sabe como o serviço dele
      // autentica. Eles podem carregar credencial, e por isso não passam por log.
      socket = this.deps.createSocket(vivo.adapter.url(vivo.record.environment), {
        headers: vivo.adapter.handshakeHeaders?.(credencial),
        protocols: vivo.adapter.protocols?.(),
      })
    } catch (error) {
      await this.quebrou(vivo, error instanceof Error ? error.message : 'falha ao abrir o socket', geracao)
      return
    }
    vivo.socket = socket

    socket.onopen = () => {
      if (vivo.geracao !== geracao) return
      vivo.tentativas = 0
      vivo.state = 'connected'
      void setStreamState(vivo.record._id, 'connected').catch((e) => this.deps.onError(`stream ${id} estado`, e))
      // A autenticação vai direto para o socket. Ela não passa por log, não entra no
      // documento do stream e não vira trace: o único registro é que foi enviada.
      const auth = vivo.adapter.authMessage?.(credencial)
      if (auth !== undefined) this.enviar(vivo, auth)
      if (vivo.symbols.size) this.enviar(vivo, vivo.adapter.subscribeMessage([...vivo.symbols]))
      this.armarBatimento(vivo)
      this.armarSilencio(vivo)
    }

    socket.onmessage = (ev) => {
      if (vivo.geracao !== geracao) return
      // Só o detector de silêncio é rearmado: o batimento corre no ritmo dele.
      this.armarSilencio(vivo)
      void this.receber(vivo, ev.data).catch((e) => this.deps.onError(`stream ${id} mensagem`, e))
    }

    socket.onerror = (ev) => {
      if (vivo.geracao !== geracao) return
      // O quadro cru NÃO entra: um erro de autenticação costuma vir com a mensagem
      // que continha a credencial.
      const msg = typeof ev === 'object' && ev !== null && typeof (ev as { message?: unknown }).message === 'string' ? (ev as { message: string }).message : 'erro no socket'
      void setStreamError(vivo.record._id, naoLoga(msg, vivo.segredos)).catch((e) => this.deps.onError(`stream ${id} erro`, e))
    }

    socket.onclose = () => {
      if (vivo.encerrado) return
      void this.quebrou(vivo, 'conexão encerrada pelo outro lado', geracao).catch((e) => this.deps.onError(`stream ${id} fechamento`, e))
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
    /**
     * O adapter que cuida da mensagem inteira recebe o quadro CRU.
     *
     * Antes de qualquer interpretação, de propósito: o formato (JSON ou texto) é
     * configuração de quem conectou, e adivinhar aqui obrigaria a desfazer o palpite lá.
     */
    if (vivo.adapter.ingest) {
      const texto = typeof data === 'string' ? data : String(data)
      await markStreamEvent(vivo.record._id, await vivo.adapter.ingest(texto, ctx))
      return
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

  /**
   * Uma queda, contada UMA vez.
   *
   * `geracao` é o que garante isso: quem reporta a queda diz de qual tentativa está
   * falando, e um aviso de uma tentativa que já foi substituída é descartado. Sem ela,
   * fechar por silêncio contava duas quedas (a nossa e o `onclose` que ela provoca),
   * dobrando as tentativas e agendando duas reconexões — dois sockets.
   */
  private async quebrou(vivo: Vivo, motivo: string, geracao?: number): Promise<void> {
    if (geracao !== undefined && vivo.geracao !== geracao) return
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
    const daQueda = vivo.geracao
    const timer = this.deps.schedule(() => {
      // Outra reconexão pode ter começado no meio do caminho — a desta queda perdeu a vez.
      if (vivo.encerrado || vivo.geracao !== daQueda) return
      void this.conectar(vivo).catch((e) => this.deps.onError(`stream ${id} reconexão`, e))
    }, backoffMs(vivo.tentativas))
    timer.unref?.()
    vivo.timerReconnect = timer
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

  /**
   * O BATIMENTO: de tempos em tempos, para sempre, enquanto a conexão viver.
   *
   * Ele se reagenda sozinho. Antes daqui era um `setTimeout` rearmado junto com o
   * detector de silêncio, a cada mensagem — o que significava que num stream ATIVO ele
   * nunca disparava (toda mensagem cancelava o timer pendente) e num stream parado
   * disparava uma vez só. Um batimento que bate uma vez não mantém nada vivo.
   */
  private armarBatimento(vivo: Vivo): void {
    if (!vivo.adapter.heartbeatMessage) return
    const geracao = vivo.geracao
    const bater = () => {
      if (vivo.encerrado || vivo.geracao !== geracao) return
      this.enviar(vivo, vivo.adapter.heartbeatMessage?.())
      const proximo = this.deps.schedule(bater, HEARTBEAT_MS)
      proximo.unref?.()
      vivo.timerHeartbeat = proximo
    }
    const primeiro = this.deps.schedule(bater, HEARTBEAT_MS)
    primeiro.unref?.()
    vivo.timerHeartbeat = primeiro
  }

  /**
   * O detector de SILÊNCIO, rearmado a cada mensagem.
   *
   * Um socket que não fecha mas também não fala é o pior caso: sem isto o stream fica
   * "connected" para sempre sem entregar nada.
   */
  private armarSilencio(vivo: Vivo): void {
    if (vivo.timerIdle) this.deps.cancel(vivo.timerIdle)
    const geracao = vivo.geracao
    const mudo = this.deps.schedule(() => {
      if (vivo.encerrado || vivo.geracao !== geracao) return
      // A referência é guardada ANTES: `quebrou` limpa `vivo.socket` de imediato, e sem
      // isto o socket mudo nunca seria fechado — ficaria pendurado, aberto e calado,
      // enquanto uma conexão nova subia ao lado.
      const morto = vivo.socket
      // A queda é reportada UMA vez. Fechar vai disparar o `onclose` logo em seguida, e
      // é a geração que faz aquele segundo aviso ser ignorado.
      void this.quebrou(vivo, 'sem mensagens do provider', geracao).catch(() => undefined)
      try {
        morto?.close()
      } catch {
        // já era
      }
    }, SILENCIO_MS)
    mudo.unref?.()
    vivo.timerIdle = mudo
  }

  private limparTimers(vivo: Vivo): void {
    for (const t of [vivo.timerHeartbeat, vivo.timerIdle, vivo.timerReconnect]) if (t) this.deps.cancel(t)
    vivo.timerHeartbeat = null
    vivo.timerIdle = null
    vivo.timerReconnect = null
  }
}

/** Uma instância por processo, criada quando o worker sobe. */
let atual: StreamManager | null = null
export const setStreamManager = (m: StreamManager | null): void => {
  atual = m
}
export const streamManager = (): StreamManager | null => atual
