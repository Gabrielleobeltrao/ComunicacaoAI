import { backoffMs, publishEvent } from '../events/bus.js'
import { claimStream, markStreamEvent, releaseStreamLease, renewStreamLease, setStreamError, setStreamState, STREAM_LEASE_MS } from './repository.js'
import type { SocketOptions } from './socket.js'
import type { ObjectId } from 'mongodb'
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
  /**
   * O ping do PROTOCOLO, quando o socket sabe mandar.
   *
   * Opcional porque o `WebSocket` do navegador não expõe: só o `ws` do Node manda ping
   * de verdade. Ausente, o batimento cai na mensagem configurada, que é o caminho de
   * sempre.
   */
  ping?(): void
  /** Chamado quando o pong volta. É o que prova que o outro lado ainda responde. */
  onpong?: (() => void) | null
}

export type SocketFactory = (url: string, opts?: SocketOptions) => StreamSocket

/** Para que serve cada relógio do gerenciador. */
export type TipoDeRelogio = 'heartbeat' | 'idle' | 'reconnect' | 'pong' | 'lease'

export interface ManagerDeps {
  /**
   * Quem é ESTA instância, para a posse do stream.
   *
   * Um valor por processo. Ausente cai num aleatório — o que basta para o caso de uma
   * instância só, que é o deploy de hoje.
   */
  instanceId?: string
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
  /**
   * A posse, injetável como o socket e o barramento.
   *
   * Não é conveniência de teste: é a mesma regra que o resto das dependências deste
   * gerenciador segue — o que fala com o mundo entra por parâmetro. E é o único jeito de
   * exercitar "o banco falhou na renovação", que é justamente o caminho onde um erro
   * silencioso significa dois donos.
   */
  claimLease?: (id: ObjectId, instanceId: string) => Promise<boolean>
  renewLease?: (id: ObjectId, instanceId: string) => Promise<boolean>
  /**
   * Agendar. O `tipo` é ignorado pelo relógio de verdade e existe para quem observa:
   * antes daqui o teste adivinhava qual timer era qual pela DURAÇÃO, e bastou aparecer
   * um quarto tipo de relógio para a adivinhação apontar para o errado.
   */
  schedule?: (fn: () => void, ms: number, tipo?: TipoDeRelogio) => { unref?: () => void }
  cancel?: (t: unknown) => void
  onError?: (where: string, error: unknown) => void
}

/** Sem notícia nenhuma por este tempo, presume-se morto e reconecta. */
const SILENCIO_MS = Number(process.env.STREAM_IDLE_TIMEOUT_MS ?? 90_000)
const HEARTBEAT_MS = Number(process.env.STREAM_HEARTBEAT_MS ?? 30_000)
/** Depois disto, para de tentar e deixa o erro visível em vez de bater para sempre. */
const MAX_TENTATIVAS = Number(process.env.STREAM_MAX_RECONNECTS ?? 10)
/**
 * O TETO dos intervalos configuráveis por conexão.
 *
 * Uma conexão pode escolher esperar menos que o padrão, e não mais: um silêncio de duas
 * horas configurado por engano seria um stream morto que ninguém percebe por duas horas.
 */
const MAX_INTERVAL_MS = Number(process.env.STREAM_MAX_INTERVAL_MS ?? 300_000)
/** Prazo do teste de conexão. Curto: alguém está olhando a tela esperando. */
const PROBE_MS = Number(process.env.STREAM_PROBE_TIMEOUT_MS ?? 8_000)

interface Vivo {
  record: StreamRecord
  /** Remontado a cada tentativa quando ele vem da conexão — ver `conectar`. */
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
  /** Armado ao mandar o batimento, desarmado quando a resposta chega. */
  timerPong: unknown
  /**
   * A gravação de estado ainda EM VOO.
   *
   * O "conectado" é disparado sem espera de propósito — a mensagem seguinte não pode
   * ficar atrás de uma ida ao banco. O efeito colateral é que ela pode chegar DEPOIS de
   * um "desconectado" escrito logo em seguida, e o stream fica registrado como no ar
   * para sempre. Guardar a promessa deixa o fim esperar por ela.
   */
  escritaDeEstado: Promise<void> | null
  /** Renovação periódica da posse. Perder a posse solta o socket. */
  timerLease: unknown
  /**
   * Até quando a posse está CONFIRMADA por este processo.
   *
   * É o relógio local que decide se ainda há margem para insistir numa renovação que o
   * banco não respondeu. Sem ele, "tentar de novo" não teria fim.
   */
  leaseAte: number
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
 * Como uma mensagem vira QUADRO.
 *
 * Texto sai como texto; o resto é serializado. É uma regra só, e ela mora aqui porque
 * existiam duas: a conexão viva fazia certo e a sonda fazia `JSON.stringify` sempre —
 * então uma autenticação de texto (`AUTH xxx`) saía do teste como `"AUTH xxx"`, com
 * aspas, e o serviço recusava. O teste culpava a credencial.
 */
export const comoQuadro = (mensagem: unknown): string => (typeof mensagem === 'string' ? mensagem : JSON.stringify(mensagem))

/**
 * O único caminho por onde um texto vira registro. Corta o tamanho e risca a credencial.
 */
function naoLoga(texto: string, segredos: readonly string[] = []): string {
  let limpo = String(texto ?? '')
  for (const segredo of segredos) limpo = limpo.split(segredo).join('***')
  return limpo.slice(0, 300)
}

/** Quem é este stream, do ponto de vista de quem recebe uma mensagem dele. */
const contextOf = (vivo: Vivo): StreamContext => ({
  ownerId: vivo.record.ownerId,
  streamId: vivo.record._id.toString(),
  installationId: vivo.record.installationId,
  environment: vivo.record.environment,
  source: `${vivo.record.appKey}:${vivo.record.environment}`,
})

export class StreamManager {
  private readonly vivos = new Map<string, Vivo>()
  /** As subidas em andamento, por stream. Ver o comentário em `start`. */
  private readonly subindo = new Map<string, Promise<boolean>>()
  /** A identidade desta instância, usada na posse dos streams. */
  readonly instanceId: string
  private readonly deps: Required<Pick<ManagerDeps, 'createSocket' | 'publish' | 'schedule' | 'cancel' | 'onError' | 'claimLease' | 'renewLease'>> & ManagerDeps

  constructor(deps: ManagerDeps) {
    this.instanceId = deps.instanceId ?? `${process.pid}-${Math.random().toString(36).slice(2, 10)}`
    this.deps = {
      ...deps,
      createSocket: deps.createSocket ?? ((url) => new WebSocket(url) as unknown as StreamSocket),
      publish: deps.publish ?? publishEvent,
      schedule: deps.schedule ?? ((fn, ms) => setTimeout(fn, ms)),
      cancel: deps.cancel ?? ((t) => clearTimeout(t as NodeJS.Timeout)),
      onError: deps.onError ?? (() => undefined),
      claimLease: deps.claimLease ?? claimStream,
      renewLease: deps.renewLease ?? renewStreamLease,
    }
  }

  /**
   * Encurta o prazo confirmado de um stream, para o teste conseguir chegar ao caso
   * "sem margem" sem esperar um arrendamento inteiro de relógio real.
   *
   * Não há caminho de produção que chame isto — nenhuma rota, nenhuma configuração.
   */
  forcarVencimentoDoLease(id: string): void {
    const vivo = this.vivos.get(id)
    if (vivo) vivo.leaseAte = Date.now()
  }

  /** Este stream já é responsabilidade deste processo — vivo ou subindo agora? */
  isTracked(id: string): boolean {
    return this.vivos.has(id) || this.subindo.has(id)
  }

  stateOf(id: string): StreamState {
    return this.vivos.get(id)?.state ?? 'disconnected'
  }

  get activeCount(): number {
    return this.vivos.size
  }

  /**
   * Mandar um quadro CRU por um stream que está de pé.
   *
   * É como uma assinatura criada agora entra numa conexão que já está aberta, sem
   * derrubar o que já estava assinado. `false` quer dizer que não havia conexão — quem
   * chama decide se isso é erro (não é: assinar com o stream desligado é legítimo, e o
   * envio acontece no próximo `framesOnConnect`).
   *
   * O conteúdo NÃO é registrado: uma inscrição pode conter identificador de conta, e o
   * log diz que assinou, não o que assinou.
   */
  send(id: string, quadro: string): boolean {
    const vivo = this.vivos.get(id)
    if (!vivo || vivo.state !== 'connected' || !vivo.socket) return false
    this.enviar(vivo, quadro)
    return true
  }

  /** O stream está pronto para receber um quadro agora? */
  isConnected(id: string): boolean {
    return this.vivos.get(id)?.state === 'connected'
  }

  /**
   * Subir um stream. Chamar de novo para o mesmo id não abre uma segunda conexão —
   * atualiza os símbolos e pronto.
   *
   * Devolve se o stream está sob a responsabilidade DESTE processo. `false` não é erro:
   * é outra instância sendo a dona, e quem chamou precisa saber para não contar como
   * restaurado o que não subiu.
   */
  async start(record: StreamRecord): Promise<boolean> {
    const id = record._id.toString()
    if (record.paused) return false
    const existente = this.vivos.get(id)
    if (existente) {
      await this.subscribe(id, record.symbols)
      return true
    }
    /**
     * Duas chamadas ao mesmo tempo compartilham a MESMA subida.
     *
     * `vivos` só recebe o stream depois de resolver o adapter e a credencial — duas
     * idas ao banco. Duas chamadas simultâneas atravessavam essa janela juntas, as duas
     * viam o mapa vazio e as duas abriam socket; e a segunda ainda passava pela posse,
     * porque o dono já era esta instância. O resultado era exatamente o que o
     * arrendamento existe para evitar, dentro de um processo só.
     */
    const subindo = this.subindo.get(id)
    if (subindo) return subindo
    const promessa = this.iniciar(record, id).finally(() => this.subindo.delete(id))
    this.subindo.set(id, promessa)
    return promessa
  }

  private async iniciar(record: StreamRecord, id: string): Promise<boolean> {
    /**
     * A POSSE, antes de qualquer coisa.
     *
     * Duas instâncias restaurando os mesmos streams abririam dois sockets no mesmo
     * serviço — mensagem dobrada, evento dobrado e, num provedor que limita conexões por
     * conta, as duas derrubadas. Quem não pega a posse simplesmente não sobe; quando o
     * arrendamento do outro vencer, a próxima tentativa pega.
     */
    if (!(await this.deps.claimLease(record._id, this.instanceId))) return false

    /**
     * Primeiro o adapter montado a partir da conexão; depois o estático do App.
     *
     * O `try` não é decoração: `adapterFor` confere o endereço e resolve o DNS, e
     * RECUSA lançando. A posse já foi tomada na linha acima — sem capturar aqui, o
     * arrendamento ficava preso até vencer por causa de uma configuração que nunca vai
     * funcionar, e nenhuma outra instância podia sequer tentar.
     */
    let adapter: StreamAdapter | null = null
    try {
      adapter = (await this.deps.adapterFor?.(record)) ?? this.deps.adapters.get(record.appKey) ?? null
    } catch (error) {
      await setStreamError(record._id, naoLoga(error instanceof Error ? error.message : 'configuração recusada'), new Date(), this.instanceId).catch(() => undefined)
      await releaseStreamLease(record._id, this.instanceId).catch(() => undefined)
      return false
    }
    if (!adapter) {
      // A posse já foi tomada e o `Vivo` ainda não existe: gravar com a cerca de pé e
      // devolver o arrendamento é o mesmo fim de sempre, escrito à mão porque não há
      // objeto para passar a `finalizar`.
      await setStreamError(record._id, `nenhum adapter registrado para "${record.appKey}"`, new Date(), this.instanceId).catch(() => undefined)
      await releaseStreamLease(record._id, this.instanceId).catch(() => undefined)
      return false
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
      timerPong: null,
      escritaDeEstado: null,
      timerLease: null,
      leaseAte: Date.now() + STREAM_LEASE_MS,
      encerrado: false,
      segredos: [],
    }
    this.vivos.set(id, vivo)
    this.armarRenovacao(vivo)
    await this.conectar(vivo)
    return true
  }

  /** Descer. Idempotente: parar o que já está parado é um no-op, não um erro. */
  async stop(id: string): Promise<void> {
    const vivo = this.vivos.get(id)
    if (!vivo) return
    await this.finalizar(vivo, { estado: 'disconnected' })
  }

  /**
   * O ÚNICO fim de um stream que ainda é desta instância.
   *
   * Ele existe porque a saída estava escrita em quatro lugares, e cada um esquecia uma
   * coisa diferente: os caminhos de erro removiam do mapa e deixavam o relógio da posse
   * correndo — um stream morto renovando o arrendamento para sempre, que nenhuma outra
   * instância conseguia assumir e nenhuma tela mostrava.
   *
   * A ORDEM não é arbitrária. O estado final é gravado ENQUANTO a posse ainda existe:
   * a escrita é cercada por `leaseOwner`, então soltar antes faz a gravação não achar
   * nada e o stream ficar eternamente "conectado" depois de ter parado. Foi exatamente
   * o que a versão anterior fazia.
   */
  private async finalizar(vivo: Vivo, fim: { estado: StreamState } | { erro: string }): Promise<void> {
    const id = vivo.record._id.toString()
    vivo.encerrado = true
    // A gravação em voo primeiro: um "conectado" disparado há um instante chegaria
    // DEPOIS do estado final e deixaria o stream registrado no ar para sempre.
    await vivo.escritaDeEstado?.catch(() => undefined)
    vivo.escritaDeEstado = null
    this.limparTimers(vivo)
    this.pararRenovacao(vivo)
    try {
      vivo.socket?.close()
    } catch {
      // Fechar um socket já morto não é notícia.
    }
    vivo.socket = null
    // Sai do mapa antes de qualquer espera: nada que rode depois pode encontrá-lo vivo.
    this.vivos.delete(id)

    if ('erro' in fim) {
      vivo.state = 'error'
      await setStreamError(vivo.record._id, fim.erro, new Date(), this.instanceId).catch(() => undefined)
    } else {
      vivo.state = fim.estado
      await setStreamState(vivo.record._id, fim.estado, new Date(), this.instanceId).catch(() => undefined)
    }

    // E só então a posse volta a ficar livre — para outra instância poder assumir, e
    // para um deploy não deixar os streams travados pelo prazo do arrendamento.
    await releaseStreamLease(vivo.record._id, this.instanceId).catch(() => undefined)
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
  async probe(
    adapter: StreamAdapter,
    environment: string,
    credencial: Record<string, string>,
    timeoutMs = PROBE_MS,
    /**
     * Uma prova mais funda: mandar um quadro depois de autenticar e esperar uma
     * resposta que sirva.
     *
     * É o "testar assinatura": abrir e autenticar responde "a credencial vale"; só
     * mandar a inscrição e receber algo responde "esta assinatura funciona", que é a
     * pergunta de quem a escreveu.
     */
    depoisDeAutenticar?: { frame: string; aceita: (bruto: unknown) => boolean; mensagemOk: string },
  ): Promise<{ ok: boolean; message: string }> {
    const segredos = Object.values(credencial).filter((v) => typeof v === 'string' && v.length >= 8)
    let socket: StreamSocket
    try {
      /**
       * O teste abre a conexão COM A CONFIGURAÇÃO DE VERDADE.
       *
       * Antes daqui ele abria só com a URL: sem cabeçalho, sem subprotocolo, sem o
       * endereço já conferido e sem o prazo de handshake da conexão. Um serviço que
       * autentica por cabeçalho recusava — e o teste dizia que a credencial estava
       * errada quando o que estava errado era o teste. Pior: um serviço permissivo
       * aceitava a conexão nua e o teste passava, prometendo que a configuração real
       * funcionava.
       */
      socket = this.deps.createSocket(adapter.url(environment), {
        headers: adapter.handshakeHeaders?.(credencial),
        protocols: adapter.protocols?.(),
        pinnedAddress: adapter.pinnedAddress?.(),
        handshakeTimeoutMs: adapter.connectTimeoutMs?.(),
      })
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
          depoisDeAutenticar
            ? // Conectou e não veio nada que sirva. Não é falha da credencial: é a
              // resposta honesta de que aquela inscrição não trouxe mensagem no prazo.
              encerrar(false, 'A conexão abriu, mas nenhuma mensagem compatível chegou no prazo.')
            : semConfirmacao
              ? encerrar(true, 'Conexão de tempo real aberta; este provedor não confirma a credencial.')
              : encerrar(false, 'O provedor não respondeu a tempo.'),
        timeoutMs,
      )
      prazo.unref?.()

      /** O quadro extra sai depois da autenticação — antes dela, o serviço recusaria. */
      const mandarExtra = () => {
        if (!depoisDeAutenticar?.frame) return
        try {
          socket.send(depoisDeAutenticar.frame)
        } catch (error) {
          encerrar(false, naoLoga(error instanceof Error ? error.message : 'falha ao enviar a inscrição', segredos))
        }
      }

      socket.onopen = () => {
        const auth = adapter.authMessage?.(credencial)
        if (auth === undefined) {
          // Sem autenticação por mensagem: manda a inscrição já, ou abrir é a resposta.
          if (!depoisDeAutenticar) return encerrar(true, 'Conexão de tempo real aberta.')
          return mandarExtra()
        }
        try {
          socket.send(comoQuadro(auth))
          // Sem confirmação de autenticação, a inscrição vai logo em seguida: esperar um
          // aviso que o serviço não manda seria esperar para sempre.
          if (!adapter.authOkOf) mandarExtra()
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
        if (adapter.authOkOf?.(bruto)) {
          // Autenticou. Com inscrição a provar, a resposta ainda não chegou.
          if (!depoisDeAutenticar) return encerrar(true, 'Credencial aceita pelo tempo real.')
          return mandarExtra()
        }
        // Uma mensagem que serve à assinatura é a prova de que ela funciona.
        if (depoisDeAutenticar?.aceita(bruto)) return encerrar(true, depoisDeAutenticar.mensagemOk)
      }
      socket.onerror = () => encerrar(false, 'O provedor recusou a conexão de tempo real.')
      socket.onclose = () => encerrar(false, 'O provedor fechou a conexão antes de confirmar a credencial.')
    })
  }

  // --- conexão -------------------------------------------------------------------

  private async conectar(vivo: Vivo): Promise<void> {
    const id = vivo.record._id.toString()
    const ctx = contextOf(vivo)
    // A partir daqui, tudo que vier de um socket anterior é passado.
    const geracao = (vivo.geracao += 1)
    this.limparTimers(vivo)

    /**
     * O adapter é REMONTADO a cada tentativa, quando ele é montado a partir da conexão.
     *
     * Duas coisas dependem disso. O DNS é resolvido e conferido de novo — um nome que
     * apontava para um endereço público na primeira vez pode apontar para a rede interna
     * na reconexão, e sem isto a conferência só valia para a primeira. E a configuração
     * que mudou passa a valer sem esperar um restart.
     */
    if (this.deps.adapterFor) {
      try {
        const novo = await this.deps.adapterFor(vivo.record)
        if (novo) vivo.adapter = novo
      } catch (error) {
        // Recusado agora: a conexão não sobe, e o motivo fica visível.
        await this.finalizar(vivo, { erro: naoLoga(error instanceof Error ? error.message : 'endereço recusado', vivo.segredos) })
        return
      }
    }
    vivo.state = vivo.tentativas === 0 ? 'connecting' : 'reconnecting'
    await setStreamState(vivo.record._id, vivo.state, new Date(), this.instanceId)

    const credencial = await this.deps.credentialsOf(vivo.record.ownerId, vivo.record.installationId)
    if (!credencial) {
      // Conexão revogada ou sumida. Reconectar seria bater numa porta que foi fechada
      // de propósito — e com uma credencial que já não vale.
      await this.finalizar(vivo, { erro: 'conexão indisponível: revogada, expirada ou removida' })
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
        pinnedAddress: vivo.adapter.pinnedAddress?.(),
        handshakeTimeoutMs: vivo.adapter.connectTimeoutMs?.(),
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
      vivo.escritaDeEstado = setStreamState(vivo.record._id, 'connected', new Date(), this.instanceId).catch((e) => this.deps.onError(`stream ${id} estado`, e))
      // A autenticação vai direto para o socket. Ela não passa por log, não entra no
      // documento do stream e não vira trace: o único registro é que foi enviada.
      const auth = vivo.adapter.authMessage?.(credencial)
      if (auth !== undefined) this.enviar(vivo, auth)
      if (vivo.symbols.size) this.enviar(vivo, vivo.adapter.subscribeMessage([...vivo.symbols]))
      /**
       * As inscrições guardadas, mandadas DEPOIS da autenticação.
       *
       * Assíncrono porque elas vêm do banco — e é por isso que este bloco existe em vez
       * de caber em `subscribeMessage`, que é síncrono e recebe símbolos. A ordem
       * importa: um serviço que ainda não autenticou recusa a inscrição.
       */
      void vivo.adapter
        .framesOnConnect?.(ctx)
        .then((quadros) => {
          if (vivo.geracao !== geracao) return
          for (const q of quadros) this.enviar(vivo, q)
        })
        .catch((e) => this.deps.onError(`stream ${id} inscrições`, e))
      this.armarBatimento(vivo)
      this.armarSilencio(vivo)
    }

    socket.onmessage = (ev) => {
      if (vivo.geracao !== geracao) return
      // Só o detector de silêncio é rearmado: o batimento corre no ritmo dele.
      this.armarSilencio(vivo)
      // Mensagem é sinal de vida tanto quanto o pong: um serviço que respondeu alguma
      // coisa está vivo, e exigir o pong exato derrubaria quem responde de outro jeito.
      if (vivo.timerPong) {
        this.deps.cancel(vivo.timerPong)
        vivo.timerPong = null
      }
      void this.receber(vivo, ev.data).catch((e) => this.deps.onError(`stream ${id} mensagem`, e))
    }

    socket.onerror = (ev) => {
      if (vivo.geracao !== geracao) return
      // O quadro cru NÃO entra: um erro de autenticação costuma vir com a mensagem
      // que continha a credencial.
      const msg = typeof ev === 'object' && ev !== null && typeof (ev as { message?: unknown }).message === 'string' ? (ev as { message: string }).message : 'erro no socket'
      void setStreamError(vivo.record._id, naoLoga(msg, vivo.segredos), new Date(), this.instanceId).catch((e) => this.deps.onError(`stream ${id} erro`, e))
    }

    socket.onclose = () => {
      if (vivo.encerrado) return
      void this.quebrou(vivo, 'conexão encerrada pelo outro lado', geracao).catch((e) => this.deps.onError(`stream ${id} fechamento`, e))
    }
  }

  private async receber(vivo: Vivo, data: unknown): Promise<void> {
    const ctx = contextOf(vivo)
    /**
     * O adapter que cuida da mensagem inteira recebe o quadro CRU.
     *
     * Antes de qualquer interpretação, de propósito: o formato (JSON ou texto) é
     * configuração de quem conectou, e adivinhar aqui obrigaria a desfazer o palpite lá.
     */
    if (vivo.adapter.ingest) {
      const texto = typeof data === 'string' ? data : String(data)
      await markStreamEvent(vivo.record._id, await vivo.adapter.ingest(texto, ctx), new Date(), this.instanceId)
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
      await setStreamError(vivo.record._id, naoLoga(problema, vivo.segredos), new Date(), this.instanceId)
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
    await markStreamEvent(vivo.record._id, publicados, new Date(), this.instanceId)
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
      await this.finalizar(vivo, { erro: `${naoLoga(motivo, vivo.segredos)} — desistindo após ${MAX_TENTATIVAS} tentativas` })
      return
    }
    vivo.state = 'reconnecting'
    await setStreamState(vivo.record._id, 'reconnecting', new Date(), this.instanceId)
    // Espera crescente com jitter — a mesma do barramento. Sem o jitter, cem streams
    // que caíram junto voltam junto e derrubam de novo o que acabou de subir.
    const daQueda = vivo.geracao
    const timer = this.deps.schedule(() => {
      // Outra reconexão pode ter começado no meio do caminho — a desta queda perdeu a vez.
      if (vivo.encerrado || vivo.geracao !== daQueda) return
      void this.conectar(vivo).catch((e) => this.deps.onError(`stream ${id} reconexão`, e))
    }, backoffMs(vivo.tentativas), 'reconnect')
    timer.unref?.()
    vivo.timerReconnect = timer
  }

  private enviar(vivo: Vivo, mensagem: unknown): void {
    try {
      vivo.socket?.send(comoQuadro(mensagem))
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
  /**
   * Renova a posse enquanto o stream vive — e SOLTA o socket se ela for perdida.
   *
   * Perder a posse quer dizer que outra instância já assumiu (o arrendamento venceu por
   * uma pausa longa deste processo). Continuar com o socket aberto seria exatamente o
   * caso que a posse existe para impedir.
   */
  private armarRenovacao(vivo: Vivo): void {
    const intervalo = Math.max(1_000, Math.floor(STREAM_LEASE_MS / 3))

    /**
     * Renovar é a única coisa que autoriza este processo a continuar com o socket.
     *
     * Três decisões, e cada uma cobre um jeito diferente de agir sem posse:
     *
     * `false` é PERDA. Outra instância assumiu. O socket local fecha e o arrendamento
     * NÃO é devolvido — ele já é de outro, e devolvê-lo entregaria o stream de volta
     * para o vazio no meio do trabalho da dona nova.
     *
     * ERRO NÃO É SUCESSO. O banco pode estar momentaneamente fora; enquanto houver
     * margem no prazo que já foi confirmado, tenta de novo em intervalos curtos. Tratar
     * a exceção como "renovado" — que era o que o `catch(() => true)` fazia — é operar
     * sem nenhuma prova de posse, pelo tempo que a falha durar.
     *
     * SEM MARGEM, FECHA. Se o prazo confirmado vai vencer e a confirmação não veio, o
     * pressuposto é que outra instância vai assumir. Continuar seria o caso exato de
     * dois sockets no mesmo serviço — e é melhor um stream a menos por um minuto do que
     * dois donos gravando por cima um do outro.
     */
    const renovar = async () => {
      if (vivo.encerrado) return
      const agoraMs = Date.now()

      let confirmada: boolean | null = null
      try {
        confirmada = await this.deps.renewLease(vivo.record._id, this.instanceId)
      } catch (error) {
        this.deps.onError(`stream ${vivo.record._id.toString()} renovação`, error)
        confirmada = null
      }

      if (confirmada === true) {
        vivo.leaseAte = agoraMs + STREAM_LEASE_MS
        const proximo = this.deps.schedule(renovar, intervalo, 'lease')
        proximo.unref?.()
        vivo.timerLease = proximo
        return
      }

      if (confirmada === false) {
        this.deps.onError(`stream ${vivo.record._id.toString()} posse`, new Error('outra instância assumiu este stream'))
        await this.soltarLocal(vivo)
        return
      }

      // Falha de banco: tenta de novo, mas só enquanto o prazo já confirmado aguentar.
      const margem = vivo.leaseAte - agoraMs
      if (margem <= intervalo) {
        this.deps.onError(`stream ${vivo.record._id.toString()} posse`, new Error('não foi possível confirmar a posse antes do vencimento'))
        await this.soltarLocal(vivo)
        return
      }
      const tentarDeNovo = this.deps.schedule(renovar, Math.max(1_000, Math.floor(intervalo / 3)), 'lease')
      tentarDeNovo.unref?.()
      vivo.timerLease = tentarDeNovo
    }

    const primeiro = this.deps.schedule(renovar, intervalo, 'lease')
    primeiro.unref?.()
    vivo.timerLease = primeiro
  }

  /**
   * Larga o stream SEM mexer no arrendamento.
   *
   * É o caminho de quem perdeu a posse ou não conseguiu prová-la: fecha o socket, para
   * os relógios, sai da memória — e não escreve nada no documento, porque ele já pode
   * ser de outra instância.
   */
  private async soltarLocal(vivo: Vivo): Promise<void> {
    vivo.encerrado = true
    this.limparTimers(vivo)
    this.pararRenovacao(vivo)
    try {
      vivo.socket?.close()
    } catch {
      // Fechar um socket já morto não é notícia.
    }
    vivo.socket = null
    this.vivos.delete(vivo.record._id.toString())
  }

  private armarBatimento(vivo: Vivo): void {
    const nativo = vivo.adapter.heartbeatNative?.() === true && typeof vivo.socket?.ping === 'function'
    if (!nativo && !vivo.adapter.heartbeatMessage) return
    const geracao = vivo.geracao
    // O intervalo da CONEXÃO, quando ela tem um — limitado pelo teto do ambiente.
    const intervalo = Math.min(vivo.adapter.heartbeatIntervalMs?.() ?? HEARTBEAT_MS, MAX_INTERVAL_MS)
    const prazoResposta = vivo.adapter.heartbeatTimeoutMs?.() ?? 0

    /**
     * A resposta ao batimento chegou. Vale o pong do protocolo E qualquer mensagem: um
     * serviço que respondeu alguma coisa está vivo, e exigir o pong exato derrubaria
     * conexões saudáveis de quem responde o ping com uma mensagem comum.
     */
    const respondeu = () => {
      if (vivo.timerPong) this.deps.cancel(vivo.timerPong)
      vivo.timerPong = null
    }
    if (nativo && vivo.socket) vivo.socket.onpong = respondeu

    const bater = () => {
      if (vivo.encerrado || vivo.geracao !== geracao) return
      if (nativo) {
        try {
          vivo.socket?.ping?.()
        } catch (error) {
          this.deps.onError(`stream ${vivo.record._id.toString()} ping`, error)
        }
      } else {
        this.enviar(vivo, vivo.adapter.heartbeatMessage?.())
      }

      /**
       * O PRAZO da resposta.
       *
       * Sem ele, um serviço que aceita o ping e nunca responde ficava "conectado" até o
       * detector de silêncio — que é muito mais longo de propósito, porque silêncio de
       * dados é normal fora do pregão. Falta de resposta ao ping não é: é conexão morta
       * que ainda não fechou.
       */
      if (prazoResposta > 0) {
        if (vivo.timerPong) this.deps.cancel(vivo.timerPong)
        const semResposta = this.deps.schedule(() => {
          if (vivo.encerrado || vivo.geracao !== geracao) return
          const morto = vivo.socket
          void this.quebrou(vivo, 'o serviço não respondeu ao batimento', geracao).catch(() => undefined)
          try {
            morto?.close()
          } catch {
            // já era
          }
        }, prazoResposta, 'pong')
        semResposta.unref?.()
        vivo.timerPong = semResposta
      }

      const proximo = this.deps.schedule(bater, intervalo, 'heartbeat')
      proximo.unref?.()
      vivo.timerHeartbeat = proximo
    }
    const primeiro = this.deps.schedule(bater, intervalo, 'heartbeat')
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
    }, Math.min(vivo.adapter.idleTimeoutMs?.() ?? SILENCIO_MS, MAX_INTERVAL_MS), 'idle')
    mudo.unref?.()
    vivo.timerIdle = mudo
  }

  /**
   * Os relógios DA CONEXÃO. O do arrendamento não está aqui, e é o ponto.
   *
   * `conectar` limpa os timers a cada tentativa — é assim que uma reconexão não deixa
   * dois batimentos correndo. Enquanto o relógio da posse estava nesta lista, cada
   * reconexão cancelava a renovação: o socket voltava, o arrendamento vencia em silêncio
   * e outra instância assumia um stream que estava perfeitamente vivo.
   *
   * A posse é armada UMA vez, ao adquiri-la, e só some no `stop`, no encerramento ou
   * quando ela é perdida.
   */
  private limparTimers(vivo: Vivo): void {
    for (const t of [vivo.timerHeartbeat, vivo.timerIdle, vivo.timerReconnect, vivo.timerPong]) if (t) this.deps.cancel(t)
    vivo.timerHeartbeat = null
    vivo.timerIdle = null
    vivo.timerReconnect = null
    vivo.timerPong = null
  }

  private pararRenovacao(vivo: Vivo): void {
    if (vivo.timerLease) this.deps.cancel(vivo.timerLease)
    vivo.timerLease = null
  }
}

/** Uma instância por processo, criada quando o worker sobe. */
let atual: StreamManager | null = null
export const setStreamManager = (m: StreamManager | null): void => {
  atual = m
}
export const streamManager = (): StreamManager | null => atual
