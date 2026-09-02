import { createServer } from 'node:http'
import { verify } from './auth.mjs'
import { fetchWithSubrequests, LIMITES } from './fetchPage.mjs'
import { BlockedTarget } from './guard.mjs'

// O WORKER de páginas — separado da API, e com um interruptor.
//
// Ele roda fora do processo que tem o banco e as chaves pelo mesmo motivo do runner de
// código: buscar página de terceiro é seguir endereço que outra pessoa escolheu, e isso
// não pode acontecer de dentro da rede interna.
//
// O que ele NÃO é: um navegador completo. Ele busca e devolve o conteúdo; renderizar
// JavaScript exige um motor que não está aqui, e o worker DIZ isso (`rendered: false`) em
// vez de fingir que renderizou. Uma fonte que precise de render sabe que não foi atendida.

const SECRET = process.env.BROWSER_WORKER_SECRET ?? ''
const PORT = Number(process.env.PORT ?? 4400)
const CONCORRENCIA = Number(process.env.BROWSER_CONCURRENCY ?? 2)
/** O interruptor: liga em `1` e o worker recusa tudo, sem precisar derrubar o processo. */
const desligado = () => process.env.BROWSER_KILL_SWITCH === '1'

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
    if (tamanho > 256 * 1024) throw new Error('corpo grande demais')
    partes.push(parte)
  }
  return Buffer.concat(partes).toString('utf8')
}

export function createBrowserWorker({ secret = SECRET } = {}) {
  return createServer(async (req, res) => {
    let corpo = ''
    try {
      corpo = req.method === 'POST' ? await lerCorpo(req) : ''
    } catch {
      return responder(res, 413, { error: 'payload_too_large' })
    }

    // Sem segredo, ninguém é atendido: um worker aberto busca páginas para quem chegar.
    if (!secret) return responder(res, 503, { error: 'worker_not_configured' })
    if (!verify(secret, req.headers, corpo).ok) return responder(res, 401, { error: 'unauthorized' })

    const url = new URL(req.url ?? '/', 'http://worker')

    if (url.pathname === '/health') {
      return responder(res, 200, {
        ok: !desligado(),
        killSwitch: desligado(),
        // O worker é honesto sobre o que ele NÃO faz: sem motor de render, quem depende
        // disso precisa saber antes de configurar uma fonte que nunca vai funcionar.
        capabilities: { fetch: true, render: false, screenshot: false, vision: false },
        limits: LIMITES,
        concurrency: CONCORRENCIA,
      })
    }

    if (url.pathname === '/fetch') {
      if (desligado()) return responder(res, 503, { error: 'kill_switch' })
      if (emVoo >= CONCORRENCIA) return responder(res, 429, { error: 'busy' })

      let pedido
      try {
        pedido = JSON.parse(corpo)
      } catch {
        return responder(res, 400, { error: 'invalid_json' })
      }

      emVoo += 1
      const comecou = Date.now()
      try {
        const r = await fetchWithSubrequests(String(pedido.url ?? ''), Array.isArray(pedido.subrequests) ? pedido.subrequests.map(String) : [], {
          limits: pedido.limits,
        })
        // O log conta o que aconteceu, nunca o conteúdo: sem corpo, sem cabeçalho.
        console.log(
          JSON.stringify({
            evento: 'fetch',
            correlationId: String(pedido.correlationId ?? '').slice(0, 64),
            status: r.status,
            saltos: r.chain.length,
            sub: r.subrequests.length,
            bloqueadas: r.blocked.length,
            ms: Date.now() - comecou,
          }),
        )
        return responder(res, 200, {
          ok: true,
          status: r.status,
          contentType: r.contentType,
          body: r.body,
          finalUrl: r.finalUrl,
          chain: r.chain,
          // Sem motor de render: dizer `false` é o que impede a Central de tratar HTML cru
          // como página renderizada.
          rendered: false,
          subrequests: r.subrequests.map((s) => ({ url: s.url, status: s.status, bytes: s.bytes })),
          blocked: r.blocked,
          ms: Date.now() - comecou,
        })
      } catch (erro) {
        const bloqueado = erro instanceof BlockedTarget
        return responder(res, 200, {
          ok: false,
          error: { kind: bloqueado ? 'blocked' : /tempo esgotado|timeout/i.test(String(erro.message)) ? 'timeout' : 'fetch', message: String(erro.message).slice(0, 200) },
          ms: Date.now() - comecou,
        })
      } finally {
        emVoo -= 1
      }
    }

    responder(res, 404, { error: 'not_found' })
  })
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const servidor = createBrowserWorker()
  servidor.listen(PORT, () => console.log(JSON.stringify({ evento: 'browser_worker_up', port: servidor.address().port, concorrencia: CONCORRENCIA })))
}
