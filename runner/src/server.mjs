import { createServer } from 'node:http'
import { verify } from './auth.mjs'
import { RUNTIMES, executeJavascript } from './execute.mjs'
import { measureProfile } from './profile.mjs'

// O SERVIDOR do runner — pequeno de propósito.
//
// Três rotas, um método, um formato. Ele não conhece conta, agente, App nem banco: recebe
// código, entrada e limites, devolve resultado e métricas. Tudo o que é permissão fica do
// outro lado da fronteira, no backend — se este processo soubesse decidir permissão, ele
// precisaria das credenciais para isso, e aí não seria mais o lugar onde código de
// terceiro roda.

const SECRET = process.env.SANDBOX_RUNNER_SECRET ?? ''
const PORT = Number(process.env.PORT ?? 4300)
/** Quantas execuções ao mesmo tempo. Um por vez é o padrão: previsível e sem disputa. */
const CONCORRENCIA = Number(process.env.SANDBOX_CONCURRENCY ?? 1)
const MAX_CORPO = 1024 * 1024

let emVoo = 0

const responder = (res, status, corpo) => {
  const texto = JSON.stringify(corpo)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(texto) })
  res.end(texto)
}

async function lerCorpo(req) {
  const partes = []
  let tamanho = 0
  for await (const parte of req) {
    tamanho += parte.length
    if (tamanho > MAX_CORPO) throw new Error('corpo grande demais')
    partes.push(parte)
  }
  return Buffer.concat(partes).toString('utf8')
}

export function createRunnerServer({ secret = SECRET } = {}) {
  return createServer(async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET') return responder(res, 405, { error: 'method_not_allowed' })

    let corpo = ''
    try {
      corpo = req.method === 'POST' ? await lerCorpo(req) : ''
    } catch {
      return responder(res, 413, { error: 'payload_too_large' })
    }

    /**
     * Sem segredo configurado, o runner não atende NINGUÉM.
     *
     * Um runner aberto é pior do que um runner ausente: ele roda código para quem chegar,
     * e quem chegar não precisa ser o backend.
     */
    if (!secret) return responder(res, 503, { error: 'runner_not_configured' })
    const conferido = verify(secret, req.headers, corpo)
    if (!conferido.ok) return responder(res, 401, { error: 'unauthorized' })

    const url = new URL(req.url ?? '/', 'http://runner')

    if (url.pathname === '/health') {
      const profile = await measureProfile()
      return responder(res, 200, { ok: true, profile, runtimes: RUNTIMES, version: '1.0.0' })
    }

    if (url.pathname === '/execute' || url.pathname === '/test') {
      let pedido
      try {
        pedido = JSON.parse(corpo)
      } catch {
        return responder(res, 400, { error: 'invalid_json' })
      }
      if (!RUNTIMES.includes(pedido.runtime)) {
        return responder(res, 200, { ok: false, error: { kind: 'unavailable', message: `runtime "${pedido.runtime}" não existe neste runner` } })
      }
      if (emVoo >= CONCORRENCIA) {
        // Recusar é melhor do que enfileirar: o backend tem teto de tempo, e uma fila
        // aqui viraria espera lá, com a mesma execução contando duas vezes.
        return responder(res, 200, { ok: false, error: { kind: 'unavailable', message: 'o runner está ocupado' } })
      }

      emVoo += 1
      try {
        const resultado = await executeJavascript({
          source: String(pedido.source ?? ''),
          input: pedido.input ?? null,
          limits: pedido.limits ?? {},
          sha256: pedido.sha256 ?? null,
        })
        // O log do runner conta O QUE aconteceu, nunca o que passou por aqui: sem fonte,
        // sem entrada, sem saída.
        console.log(
          JSON.stringify({
            evento: url.pathname === '/test' ? 'test' : 'execute',
            correlationId: String(pedido.correlationId ?? '').slice(0, 64),
            sha256: String(pedido.sha256 ?? '').slice(0, 64),
            ok: resultado.ok,
            kind: resultado.error?.kind ?? null,
            wallMs: resultado.metrics?.wallMs ?? null,
          }),
        )
        return responder(res, 200, resultado)
      } finally {
        emVoo -= 1
      }
    }

    return responder(res, 404, { error: 'not_found' })
  })
}

// Só sobe sozinho quando é o programa principal — assim o teste monta o servidor sem
// herdar porta nem estado de outro.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const servidor = createRunnerServer()
  // A porta ANUNCIADA é a que o sistema deu, e não a que foi pedida: com `PORT=0` quem
  // escolhe é o sistema, e anunciar o pedido faria quem lê procurar no lugar errado.
  servidor.listen(PORT, () => console.log(JSON.stringify({ evento: 'runner_up', port: servidor.address().port, concorrencia: CONCORRENCIA })))
}
