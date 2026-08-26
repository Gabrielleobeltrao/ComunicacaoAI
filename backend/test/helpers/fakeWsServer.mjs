// Um servidor WebSocket de VERDADE, na própria máquina.
//
// De verdade e não um dublê porque o que precisa ser exercitado é o caminho inteiro:
// handshake, subprotocolo, cabeçalho, primeira mensagem e quadro. Um socket falso
// provaria a nossa máquina de estados e nada sobre o transporte.
//
// Ele fica em 127.0.0.1, que a guarda de endereço só aceita com
// `ALLOW_LOOPBACK_HTTP_TARGETS=1` — o mesmo interruptor que a validação de produção
// recusa. É por isso que um teste de SSRF continua sendo um teste de verdade.
import { WebSocketServer } from 'ws'

export async function startFakeWs(opts = {}) {
  const wss = new WebSocketServer({ port: 0, handleProtocols: (protocols) => [...protocols][0] ?? false })
  await new Promise((r) => wss.once('listening', r))
  const port = wss.address().port

  const estado = {
    conexoes: 0,
    /** O que os clientes mandaram — é como o teste confere auth e inscrição. */
    recebidas: [],
    /** Os cabeçalhos do handshake, para provar a autenticação por header. */
    headers: [],
    urls: [],
    protocolos: [],
    sockets: [],
    /** Quantos pings de protocolo chegaram. */
    pings: 0,
  }

  wss.on('connection', (socket, req) => {
    estado.conexoes += 1
    estado.headers.push(req.headers)
    estado.urls.push(req.url)
    estado.protocolos.push(socket.protocol)
    estado.sockets.push(socket)
    socket.on('message', (data) => estado.recebidas.push(String(data)))
    // O ping do protocolo: o `ws` responde o pong sozinho, e o que o teste precisa
    // saber é que ele CHEGOU — é a única prova de que o batimento nativo saiu.
    socket.on('ping', () => {
      estado.pings += 1
      if (opts.mudoNoPing) return // não responde: é assim que se prova o prazo do batimento
    })
    if (opts.onConnection) opts.onConnection(socket, req)
  })

  return {
    url: `ws://127.0.0.1:${port}/stream`,
    estado,
    /** Manda para todos os clientes conectados. */
    enviar(payload) {
      const texto = typeof payload === 'string' ? payload : JSON.stringify(payload)
      for (const s of estado.sockets) if (s.readyState === 1) s.send(texto)
    },
    /** Fecha o socket sem avisar — é a queda inesperada que deve reconectar. */
    derrubarComForca() {
      for (const s of estado.sockets) s.terminate()
      estado.sockets = []
    },
    derrubar() {
      for (const s of estado.sockets) s.close()
      estado.sockets = []
    },
    async close() {
      for (const s of estado.sockets) s.terminate()
      await new Promise((r) => wss.close(r))
    },
  }
}
