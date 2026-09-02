import http from 'node:http'
import https from 'node:https'
import { checkPublicUrl } from '../net/safeHttp.js'
import { backoffDelay } from './health.js'
import { applyMapping } from './mapping.js'
import { gravarAoVivo, gravarNoHistorico, sourcesCollection } from './service.js'
import { registrarEvento } from './history.js'
import { esquecerEntregaDe, lembrarEntrega } from './webhookSource.js'
import type { MonitoringSource } from './types.js'

// O CLIENTE SSE — e por que ele não é o cliente de WebSocket.
//
// Os dois são "o dado chega sozinho", e é só isso que têm em comum. SSE é uma resposta
// HTTP que nunca termina: texto, uma direção só, reconexão definida pelo próprio protocolo
// (`Last-Event-ID`, `retry:`), e o guarda de rede da plataforma vale para ele inteiro
// porque ele É uma requisição HTTP. WebSocket é outro protocolo, com handshake próprio,
// quadros binários e mão dupla — e nesta plataforma ele já existe, dentro do App de
// WebSocket, com a conexão e a credencial dele.
//
// Tratar os dois como a mesma coisa produziria o pior dos dois mundos: um SSE tentando
// falar quadro, ou um WebSocket duplicado aqui sem a instalação que autentica.
//
// O que este arquivo garante, e um `fetch` num laço não garantiria:
//
//   - a conexão é feita no ENDEREÇO conferido, e cada reconexão confere de novo;
//   - silêncio é morte: sem byte nenhum por `heartbeatMs`, a conexão é derrubada e
//     refeita, porque um socket pendurado não dá erro — ele só para de entregar;
//   - a volta é com backoff e jitter (o mesmo da coleta), respeitando o `retry:` do
//     servidor como piso: cem fontes que caíram juntas não voltam juntas;
//   - o `Last-Event-ID` é reenviado, então o servidor sabe de onde continuar;
//   - a identidade do evento vira `factId`, então reconectar e receber os mesmos eventos
//     de novo NÃO duplica a série;
//   - parar é parar: o `stop()` aborta o socket, limpa os relógios e não reconecta.

/** O teto de um evento. Um `data:` sem fim é uma memória sem fim. */
const MAX_EVENTO_BYTES = 256 * 1024
/** O teto do buffer entre eventos, para uma resposta sem quebra de linha não crescer sem fim. */
const MAX_BUFFER_BYTES = 1024 * 1024

export interface SseEvent {
  id: string | null
  event: string
  data: string
  /** O `retry:` que o servidor pediu, em ms. Piso da espera, nunca teto. */
  retryMs: number | null
}

/**
 * O PARSER do formato — separado da rede, porque o formato é onde os erros moram.
 *
 * Ele acumula pedaços e devolve os eventos completos. Todas as três quebras de linha do
 * protocolo terminam uma linha; um `:` no começo é comentário, e é assim que a maioria dos
 * servidores manda batimento. Um comentário NÃO é evento, mas é sinal de vida — e é por
 * isso que quem conta silêncio conta bytes, e não eventos.
 */
export class SseParser {
  private buffer = ''
  private id: string | null = null
  private event = 'message'
  private data: string[] = []
  private retry: number | null = null

  push(pedaco: string): SseEvent[] {
    this.buffer += pedaco
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      // Uma resposta que não quebra linha não é SSE; guardar mais seria pagar memória por
      // um servidor que não fala o protocolo.
      this.buffer = ''
      return []
    }
    const saida: SseEvent[] = []
    let corte: number
    while ((corte = this.buffer.search(/\r\n|\n|\r/)) !== -1) {
      const linha = this.buffer.slice(0, corte)
      const dois = this.buffer.startsWith('\r\n', corte)
      this.buffer = this.buffer.slice(corte + (dois ? 2 : 1))
      const pronto = this.linha(linha)
      if (pronto) saida.push(pronto)
    }
    return saida
  }

  private linha(linha: string): SseEvent | null {
    // Linha em branco: o evento acumulado está pronto.
    if (linha === '') {
      if (this.data.length === 0) {
        this.event = 'message'
        return null
      }
      const evento: SseEvent = { id: this.id, event: this.event, data: this.data.join('\n'), retryMs: this.retry }
      this.event = 'message'
      this.data = []
      return evento
    }
    // Comentário — batimento na maioria dos servidores. Sinal de vida, não evento.
    if (linha.startsWith(':')) return null

    const doisPontos = linha.indexOf(':')
    const campo = doisPontos === -1 ? linha : linha.slice(0, doisPontos)
    // "Um espaço depois dos dois-pontos é ignorado" — e é só um.
    const valor = doisPontos === -1 ? '' : linha.slice(doisPontos + 1).replace(/^ /, '')

    switch (campo) {
      case 'event':
        this.event = valor.slice(0, 120)
        break
      case 'data':
        if (this.data.join('\n').length < MAX_EVENTO_BYTES) this.data.push(valor)
        break
      case 'id':
        this.id = valor.slice(0, 200)
        break
      case 'retry': {
        const n = Number(valor)
        if (Number.isFinite(n) && n >= 0) this.retry = Math.min(300_000, n)
        break
      }
      default:
        // Campo desconhecido é ignorado, como o protocolo pede.
        break
    }
    return null
  }
}

export interface SseDeps {
  /** Injetável no teste: os cabeçalhos que a conexão do cofre preenche. */
  headers?: Record<string, string>
  onError?: (erro: unknown) => void
  /** Injetável no teste, para medir a fórmula em vez de medir a sorte. */
  random?: () => number
}

export interface SseHandle {
  stop(): Promise<void>
  /** Só para o teste observar; a verdade operacional está na telemetria da fonte. */
  readonly estado: { conectado: boolean; reconexoes: number; eventos: number }
}

/**
 * Abre e MANTÉM a assinatura de um fluxo SSE.
 *
 * Devolve na hora: quem chama não espera a primeira conexão, porque uma fonte que demora a
 * subir não pode segurar o arranque do worker inteiro.
 */
export function startSseSource(fonte: MonitoringSource, deps: SseDeps = {}): SseHandle {
  const url = fonte.config.url
  const heartbeatMs = Math.min(300_000, Math.max(5_000, Number(fonte.config.heartbeatMs ?? 30_000)))
  const estado = { conectado: false, reconexoes: 0, eventos: 0 }

  let parando = false
  let pedidoAtual: http.ClientRequest | null = null
  let relogioDeSilencio: ReturnType<typeof setTimeout> | null = null
  let relogioDeVolta: ReturnType<typeof setTimeout> | null = null
  let ultimoId: string | null = null
  let tentativa = 0
  let retryDoServidor: number | null = null

  const limparRelogios = () => {
    if (relogioDeSilencio) clearTimeout(relogioDeSilencio)
    if (relogioDeVolta) clearTimeout(relogioDeVolta)
    relogioDeSilencio = null
    relogioDeVolta = null
  }

  const anotarFalha = async (code: string, mensagem: string) => {
    await sourcesCollection
      .updateOne(
        { _id: fonte._id },
        {
          $set: { 'telemetry.lastErrorAt': new Date(), 'telemetry.lastErrorCode': code, updatedAt: new Date() },
          $inc: { 'telemetry.readsFailed': 1, 'telemetry.consecutiveFailures': 1 },
        },
      )
      .catch(() => undefined)
    await registrarEvento({
      ownerId: fonte.ownerId,
      sourceId: fonte._id,
      sourceName: fonte.name,
      kind: 'delivery',
      outcome: 'failed',
      errorCode: code,
      errorMessage: mensagem,
    })
  }

  const reconectar = (motivo: string) => {
    if (parando) return
    estado.conectado = false
    limparRelogios()
    if (pedidoAtual) {
      pedidoAtual.destroy()
      pedidoAtual = null
    }
    tentativa += 1
    estado.reconexoes += 1
    /**
     * A espera é o backoff da fonte, com o `retry:` do servidor como PISO.
     *
     * Piso, e não teto: um servidor pedindo "volte em 1s" enquanto está caindo receberia
     * uma tempestade de reconexões justo quando menos aguenta. O backoff sobe; o pedido
     * dele só impede que a gente volte antes do que ele pediu.
     */
    const espera = Math.max(backoffDelay(fonte.retry, tentativa, deps.random), retryDoServidor ?? 0)
    void sourcesCollection.updateOne({ _id: fonte._id }, { $inc: { 'telemetry.reconnects': 1 } }).catch(() => undefined)
    void anotarFalha(`stream_${motivo}`, `o fluxo caiu (${motivo}); voltando em ${Math.round(espera / 1000)}s`)
    relogioDeVolta = setTimeout(() => void conectar(), espera)
    relogioDeVolta.unref?.()
  }

  const armarSilencio = () => {
    if (relogioDeSilencio) clearTimeout(relogioDeSilencio)
    /**
     * SILÊNCIO É MORTE — e é o defeito que um cliente ingênuo não vê.
     *
     * Um socket pendurado não dá erro: ele simplesmente para de entregar. Sem este
     * relógio, a fonte fica "conectada", verde e muda, e o único jeito de descobrir é
     * alguém notar que o dado parou. Qualquer byte serve como vida, inclusive o comentário
     * que os servidores mandam de batimento.
     */
    relogioDeSilencio = setTimeout(() => reconectar('silencio'), heartbeatMs)
    relogioDeSilencio.unref?.()
  }

  const entregar = async (evento: SseEvent) => {
    const agora = new Date()
    let corpo: unknown
    try {
      corpo = JSON.parse(evento.data)
    } catch {
      // Um evento que não é JSON ainda pode ser mapeado como texto: é o que um fluxo de log
      // ou de preço em texto puro manda.
      corpo = { data: evento.data, event: evento.event }
    }

    const mapeado = applyMapping(corpo, fonte.mapping)
    if (mapeado.missing.length) {
      await anotarFalha('schema', `faltou: ${mapeado.missing.join(', ')}`)
      return
    }

    /**
     * A IDENTIDADE do evento é o `id:` do protocolo, quando ele existe.
     *
     * É ela que faz reconectar não duplicar: o servidor reenvia a partir do
     * `Last-Event-ID`, e os que já chegaram são reconhecidos e descartados pelo motor de
     * histórico. Sem `id:`, o conteúdo responde — que é o melhor disponível.
     */
    const base = evento.id ? `sse:${evento.id}` : null
    /**
     * A MEMÓRIA DE ENTREGA é quem impede a reconexão de duplicar a série.
     *
     * O `factId` sozinho não basta: a identidade do fato no motor de histórico inclui o
     * INSTANTE em que ele ocorreu, e o instante da segunda chegada é outro. É a mesma
     * memória que o webhook usa, pelo mesmo motivo — entrega repetida não é fato novo.
     *
     * Sem `id:` não há identidade estável, e aí quem decide é a dedupe por conteúdo da
     * própria fonte, que é o melhor disponível.
     */
    if (base && !(await lembrarEntrega(fonte.ownerId, fonte._id, base, agora))) return

    let recorded = 0
    try {
      recorded = await gravarNoHistorico(fonte, mapeado.rows, agora, base ? (_linha, i) => `${base}:${i}` : undefined)
      await gravarAoVivo(fonte, mapeado.rows, agora)
    } catch (erro) {
      // Nada foi gravado: manter a lembrança faria o mesmo evento, reenviado, ser
      // descartado como duplicado para sempre.
      if (base) await esquecerEntregaDe(fonte._id, base)
      throw erro
    }

    estado.eventos += 1
    await sourcesCollection
      .updateOne(
        { _id: fonte._id },
        {
          $set: {
            'telemetry.lastReadAt': agora,
            'telemetry.lastOkAt': agora,
            'telemetry.consecutiveFailures': 0,
            'telemetry.lastErrorCode': null,
            updatedAt: agora,
          },
          $inc: { 'telemetry.readsOk': 1 },
        },
      )
      .catch(() => undefined)
    await registrarEvento({
      ownerId: fonte.ownerId,
      sourceId: fonte._id,
      sourceName: fonte.name,
      kind: 'delivery',
      outcome: 'ok',
      at: agora,
      rows: mapeado.rows.length,
      recorded,
    })
  }

  const conectar = async () => {
    if (parando) return
    if (!url) {
      await anotarFalha('config', 'esta fonte SSE não tem endereço de fluxo')
      return
    }

    let alvo
    try {
      // Conferido a CADA reconexão: um nome que apontava para fora pode passar a apontar
      // para dentro entre uma conexão e a seguinte.
      alvo = await checkPublicUrl(url)
    } catch (erro) {
      await anotarFalha('blocked', String((erro as Error).message).slice(0, 200))
      if (!parando) {
        tentativa += 1
        relogioDeVolta = setTimeout(() => void conectar(), backoffDelay(fonte.retry, tentativa, deps.random))
        relogioDeVolta.unref?.()
      }
      return
    }

    const transporte = alvo.url.protocol === 'https:' ? https : http
    const parser = new SseParser()

    const req = transporte.request(
      {
        protocol: alvo.url.protocol,
        hostname: alvo.url.hostname.replace(/^\[|\]$/g, ''),
        port: alvo.url.port || (alvo.url.protocol === 'https:' ? 443 : 80),
        path: `${alvo.url.pathname}${alvo.url.search}`,
        method: 'GET',
        headers: {
          host: alvo.url.host,
          accept: 'text/event-stream',
          'cache-control': 'no-cache',
          ...(deps.headers ?? {}),
          // De onde continuar. É isto que transforma reconexão em retomada.
          ...(ultimoId ? { 'last-event-id': ultimoId } : {}),
        },
        // O endereço conferido, entregue direto à conexão — o nome fica no `Host` e no SNI.
        lookup: ((_hostname: string, options: { all?: boolean }, callback: unknown) => {
          if (options?.all) {
            ;(callback as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: alvo.address, family: alvo.family }])
            return
          }
          ;(callback as (e: null, a: string, f: number) => void)(null, alvo.address, alvo.family)
        }) as unknown as undefined,
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status !== 200) {
          res.destroy()
          return reconectar(`status_${status}`)
        }
        const tipo = String(res.headers['content-type'] ?? '')
        if (!/text\/event-stream/i.test(tipo)) {
          // Um servidor que responde JSON a um pedido de fluxo não está falando SSE, e
          // insistir seria reconectar para sempre contra a resposta errada.
          res.destroy()
          return reconectar('tipo_errado')
        }

        estado.conectado = true
        // Conectou: o backoff volta ao começo. Manter a escala penalizaria por horas uma
        // fonte que teve um problema momentâneo e já voltou.
        tentativa = 0
        armarSilencio()

        res.setEncoding('utf8')
        res.on('data', (pedaco: string) => {
          armarSilencio()
          for (const evento of parser.push(pedaco)) {
            if (evento.retryMs !== null) retryDoServidor = evento.retryMs
            if (evento.id) ultimoId = evento.id
            void entregar(evento).catch((e) => deps.onError?.(e))
          }
        })
        res.on('end', () => reconectar('fim'))
        res.on('error', () => reconectar('erro'))
      },
    )

    pedidoAtual = req
    req.on('error', (e) => {
      if (parando) return
      deps.onError?.(e)
      reconectar('conexao')
    })
    req.end()
    /**
     * O relógio começa AQUI, e não quando a resposta chega.
     *
     * Um servidor que aceita a conexão e nunca manda nem os cabeçalhos deixaria o cliente
     * pendurado para sempre: sem resposta não há `data`, sem `data` não havia relógio, e a
     * fonte ficava "conectando" em silêncio até alguém notar. Silêncio é silêncio, antes ou
     * depois do cabeçalho.
     */
    armarSilencio()
  }

  void conectar()

  return {
    estado,
    async stop() {
      // Parar é PARAR: sem isto, o `destroy()` no socket cairia no `reconectar` do `error`
      // e a fonte voltaria sozinha durante o desligamento do processo.
      parando = true
      limparRelogios()
      pedidoAtual?.destroy()
      pedidoAtual = null
      estado.conectado = false
    },
  }
}

/**
 * O SUPERVISOR — quem sobe, quem derruba, e quem percebe a mudança.
 *
 * Ele reconcilia periodicamente: as fontes SSE ativas desta conta viram assinaturas, e as
 * que foram pausadas ou apagadas têm a assinatura fechada. Reconciliar em vez de "ligar no
 * arranque" é o que faz ativar uma fonte na tela ter efeito sem reiniciar o processo — e o
 * que faz pausar realmente parar de consumir a rede do outro lado.
 */
export interface SseSupervisor {
  stop(): Promise<void>
  /** Quantas assinaturas estão de pé. Para o teste e para quem for depurar. */
  readonly ativas: number
}

export function startSseSupervisor(deps: SseDeps & { intervalMs?: number } = {}): SseSupervisor {
  const abertas = new Map<string, SseHandle>()
  let parando = false

  const reconciliar = async () => {
    if (parando) return
    const ativas = await sourcesCollection
      .find({ status: 'active', kind: 'websocket', 'config.protocol': 'sse' })
      .limit(200)
      .toArray()
    const querendo = new Set(ativas.map((f) => f._id.toString()))

    for (const [id, handle] of abertas) {
      if (!querendo.has(id)) {
        await handle.stop()
        abertas.delete(id)
      }
    }
    for (const fonte of ativas) {
      const id = fonte._id.toString()
      if (abertas.has(id)) continue
      abertas.set(id, startSseSource(fonte, deps))
    }
  }

  const relogio = setInterval(() => void reconciliar().catch((e) => deps.onError?.(e)), Math.max(5_000, deps.intervalMs ?? 30_000))
  relogio.unref?.()
  void reconciliar().catch((e) => deps.onError?.(e))

  return {
    get ativas() {
      return abertas.size
    },
    async stop() {
      parando = true
      clearInterval(relogio)
      for (const handle of abertas.values()) await handle.stop()
      abertas.clear()
    },
  }
}
