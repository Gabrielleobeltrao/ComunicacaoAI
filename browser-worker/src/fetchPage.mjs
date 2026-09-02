import { request } from 'node:https'
import { request as requestHttp } from 'node:http'
import { checkTarget, BlockedTarget } from './guard.mjs'

// BUSCAR UMA PÁGINA — com cada salto revalidado, e um orçamento que não estica.
//
// O que este arquivo não faz é tão importante quanto o que faz: ele não segue redirect sem
// olhar, não baixa arquivo, não escreve em disco e não guarda cookie entre requisições. Um
// worker que aceita download vira um jeito de fazer a plataforma buscar um binário e
// guardá-lo; um que guarda cookie vira um jeito de reusar sessão de outra pessoa.

export const LIMITES = {
  maxRedirects: 3,
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 15_000,
  /** O orçamento da RENDERIZAÇÃO inteira: página mais subrequisições. */
  maxSubrequests: 12,
  maxTotalBytes: 6 * 1024 * 1024,
}

/** Tipos que uma fonte de monitoramento lê. Um binário não é um deles. */
const TIPOS_ACEITOS = /^(text\/|application\/(json|xml|xhtml|rss|atom|ld\+json))/i

export async function fetchOnce(rawUrl, opcoes = {}) {
  const limites = { ...LIMITES, ...opcoes.limits }
  const resolver = opcoes.resolver
  let alvo = rawUrl
  let saltos = 0
  const cadeia = []

  while (true) {
    // A REVALIDAÇÃO acontece a cada salto. Validar só a URL digitada e seguir redirects
    // alegremente é como a metadata da nuvem sai pela porta da frente.
    const conferido = await checkTarget(alvo, resolver)
    cadeia.push(conferido.url.toString())

    const resposta = await umaRequisicao(conferido, limites, opcoes.headers)
    if (resposta.redirectTo) {
      if (++saltos > limites.maxRedirects) throw new BlockedTarget('redirects demais')
      // O destino do redirect volta para o começo do laço — e é conferido igual.
      alvo = new URL(resposta.redirectTo, conferido.url).toString()
      continue
    }
    return { ...resposta, chain: cadeia, finalUrl: conferido.url.toString() }
  }
}

function umaRequisicao(conferido, limites, headersExtra) {
  return new Promise((resolve, reject) => {
    const ehHttps = conferido.url.protocol === 'https:'
    const fazer = ehHttps ? request : requestHttp
    const req = fazer(
      {
        // O ENDEREÇO conferido, e não o nome: é isto que fecha o rebinding, porque a
        // conexão não pergunta ao DNS de novo.
        host: conferido.address,
        servername: ehHttps ? conferido.url.hostname : undefined,
        port: conferido.url.port || (ehHttps ? 443 : 80),
        path: `${conferido.url.pathname}${conferido.url.search}`,
        method: 'GET',
        headers: {
          host: conferido.url.host,
          'user-agent': 'ComunicacaoAI-Monitor/1.0',
          accept: 'text/html,application/json,application/xml;q=0.9,*/*;q=0.1',
          // Nenhum cookie, nunca: guardar sessão aqui seria oferecer um jeito de reusar a
          // de outra pessoa.
          ...headersExtra,
        },
        timeout: limites.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0
        const location = res.headers.location
        if (status >= 300 && status < 400 && location) {
          res.destroy()
          return resolve({ redirectTo: String(location) })
        }

        const tipo = String(res.headers['content-type'] ?? '')
        if (!TIPOS_ACEITOS.test(tipo)) {
          res.destroy()
          return reject(new BlockedTarget(`tipo de conteúdo não é lido aqui: ${tipo.split(';')[0] || 'desconhecido'}`))
        }
        // Anexo é download, e download não acontece neste worker.
        if (/attachment/i.test(String(res.headers['content-disposition'] ?? ''))) {
          res.destroy()
          return reject(new BlockedTarget('download não é permitido'))
        }

        let bytes = 0
        const partes = []
        res.on('data', (c) => {
          bytes += c.length
          if (bytes > limites.maxBytes) {
            res.destroy()
            return reject(new BlockedTarget('a resposta passou do limite de tamanho'))
          }
          partes.push(c)
        })
        res.on('end', () => resolve({ status, contentType: tipo, body: Buffer.concat(partes).toString('utf8'), bytes }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => {
      req.destroy(new Error('tempo esgotado'))
    })
    req.on('error', (e) => reject(e))
    req.end()
  })
}

/**
 * As SUBREQUISIÇÕES de uma página — cada uma conferida como se fosse a primeira.
 *
 * É aqui que o descuido costuma morar: valida-se a página e depois se busca o `<script>`,
 * o `<img>` e o `fetch()` dela sem olhar. Cada um desses é um pedido para um endereço que
 * a página escolheu, e a página é de terceiro.
 */
export async function fetchWithSubrequests(rawUrl, urlsExtras = [], opcoes = {}) {
  const limites = { ...LIMITES, ...opcoes.limits }
  const principal = await fetchOnce(rawUrl, opcoes)

  const subrequests = []
  let orcamentoBytes = limites.maxTotalBytes - principal.bytes
  const bloqueadas = []

  for (const extra of urlsExtras.slice(0, limites.maxSubrequests)) {
    /**
     * O orçamento é conferido ANTES de pedir.
     *
     * Deixar a requisição sair e falhar pelo teto de tamanho reportava "resposta grande
     * demais" quando a verdade era "não há mais orçamento" — e ainda gastava uma ida à
     * rede que não tinha como caber. O piso é o menor tamanho em que uma resposta ainda
     * diz alguma coisa.
     */
    const MINIMO_UTIL = 1024
    if (orcamentoBytes < MINIMO_UTIL) {
      bloqueadas.push({ url: extra, reason: 'orçamento de bytes esgotado' })
      continue
    }
    // Quando o teto desta requisição vem do ORÇAMENTO e não do limite por resposta, uma
    // recusa por tamanho é, na verdade, o orçamento acabando — e reportar "resposta grande
    // demais" mandaria quem lê investigar a página errada.
    const tetoDaVez = Math.min(limites.maxBytes, orcamentoBytes)
    const limitadoPeloOrcamento = tetoDaVez < limites.maxBytes

    try {
      const absoluta = new URL(extra, principal.finalUrl).toString()
      const r = await fetchOnce(absoluta, { ...opcoes, limits: { ...limites, maxBytes: tetoDaVez } })
      orcamentoBytes -= r.bytes
      subrequests.push({ url: absoluta, status: r.status, bytes: r.bytes, body: r.body })
    } catch (erro) {
      // Uma subrequisição bloqueada NÃO derruba a página: ela é reportada, e a leitura
      // segue com o que veio. Derrubar tudo faria um `<img>` para rede interna esconder o
      // conteúdo legítimo — e a informação de que alguém tentou.
      const mensagem = String(erro.message ?? erro)
      bloqueadas.push({
        url: extra,
        reason: limitadoPeloOrcamento && /limite de tamanho/.test(mensagem) ? 'orçamento de bytes esgotado' : mensagem.slice(0, 120),
      })
    }
  }

  return { ...principal, subrequests, blocked: bloqueadas }
}
