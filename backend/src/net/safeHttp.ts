import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { isPrivateIp, isLoopbackIp } from './ip.js'

// A ÚNICA porta de saída para endereço escolhido por usuário.
//
// Três garantias, e nenhuma delas sobrevive sozinha:
//
// 1. TODOS os endereços do nome são conferidos — não o primeiro. Um nome com um
//    registro público e um interno passava pelo público e o sistema operacional
//    escolhia na hora.
// 2. A conexão é aberta no ENDEREÇO já conferido, com o nome viajando à parte para o
//    `Host` e o SNI. É o que fecha a janela do rebinding: entre conferir e conectar não
//    há intervalo em que o DNS possa mudar o destino.
// 3. A resposta é lida por pedaço e abortada ao passar do teto. Ler tudo e cortar
//    depois (`res.text().slice()`) já baixou o arquivo inteiro — o teto virava
//    decoração e a memória era do atacante.
//
// Cada redirecionamento repete as três. `Authorization` não atravessa troca de origem,
// e requisição com corpo não é reenviada para um host escolhido pelo primeiro servidor.

export { isPrivateIp } from './ip.js'

/** O interruptor de teste — recusado em produção por `validateConfig()`. */
const loopbackAllowed = (): boolean => process.env.ALLOW_LOOPBACK_HTTP_TARGETS === '1'
const bloqueado = (ip: string): boolean => isPrivateIp(ip) && !(loopbackAllowed() && isLoopbackIp(ip))

/** Nomes que, por convenção, nunca apontam para fora. */
const HOSTS_PROIBIDOS = [/^localhost$/i, /\.local$/i, /\.internal$/i, /^metadata(\.google)?\.internal$/i]

export type ResolvedAddress = { address: string; family: number }
export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>

const resolverPadrao: HostResolver = (hostname) => lookup(hostname, { all: true })
let resolverAtual: HostResolver = resolverPadrao

/**
 * Trocar o resolvedor — só os testes usam.
 *
 * Sem isto, provar "nome que resolve para 169.254.169.254 é recusado" exigiria um
 * domínio de verdade apontando para lá. Um teste que depende de DNS externo não é
 * teste: é um palpite que falha quando a rede pisca.
 */
export const setHttpResolver = (r: HostResolver | null): void => {
  resolverAtual = r ?? resolverPadrao
}

export interface CheckedTarget {
  url: URL
  /** O endereço em que a conexão DEVE ser aberta. */
  address: string
  family: 4 | 6
  /** Todos os endereços do nome. Todos conferidos. */
  addresses: string[]
}

/**
 * O destino conferido, ou a recusa com o motivo.
 *
 * Devolve o alvo já resolvido para quem conecta usar ESTE — não a string digitada.
 * Assim não existe espaço entre o que foi conferido e o que é usado.
 */
export async function checkPublicUrl(rawUrl: string): Promise<CheckedTarget> {
  let url: URL
  try {
    url = new URL(String(rawUrl ?? '').trim())
  } catch {
    throw new Error('URL inválida')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Só endereços http(s) são permitidos')
  }
  // `http://usuario:senha@host` esconde credencial na URL e, em alguns parsers, o host
  // verdadeiro depois do @. Nenhum destino legítimo precisa disso.
  if (url.username || url.password) throw new Error('URL com usuário ou senha não é permitida')

  const host = url.hostname.toLowerCase()
  if (!host) throw new Error('URL inválida')
  if (HOSTS_PROIBIDOS.some((r) => r.test(host))) throw new Error('Host não permitido')

  // Um IPv6 literal chega com colchetes; `net.isIP` não os reconhece.
  const literal = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (net.isIP(literal)) {
    if (bloqueado(literal)) throw new Error('Endereço de rede interna não é permitido')
    return { url, address: literal, family: net.isIPv6(literal) ? 6 : 4, addresses: [literal] }
  }

  let enderecos: ResolvedAddress[]
  try {
    enderecos = (await resolverAtual(host)) ?? []
  } catch {
    throw new Error('Não foi possível resolver o host')
  }
  const validos = enderecos.filter((e) => typeof e?.address === 'string' && net.isIP(e.address) !== 0)
  if (validos.length === 0) throw new Error('Não foi possível resolver o host')
  // Uma entrada que não dá para conferir invalida a resposta inteira: aceitar o resto
  // seria confiar num resolvedor que já devolveu algo inesperado.
  if (validos.length !== enderecos.length) throw new Error('A resolução do domínio devolveu um endereço inválido')
  if (validos.some((e) => bloqueado(e.address))) throw new Error('Host aponta para uma rede interna')

  const escolhido = validos[0]
  return {
    url,
    address: escolhido.address,
    family: net.isIPv6(escolhido.address) ? 6 : 4,
    addresses: validos.map((e) => e.address),
  }
}

/** A forma antiga, mantida para quem só precisa da URL conferida. */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  return (await checkPublicUrl(rawUrl)).url
}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  contentTypeAllowlist?: string[] // substring match against Content-Type
  /** Devolve os bytes crus além do texto. Para mídia, onde `utf8` destruiria o arquivo. */
  asBytes?: boolean
  /**
   * Recusa qualquer resposta que não seja 2xx.
   *
   * Desligado por padrão porque a ferramenta HTTP genérica do agente PRECISA ver o
   * 404 e o 500 — eles são a resposta que ela foi buscar. Para uma FONTE de
   * monitoramento é o contrário: uma página de erro tem conteúdo próprio, que muda
   * sozinho, e sem esta porteira ela seria lida como "o site mudou" a cada
   * instabilidade do servidor.
   */
  requireOk?: boolean
  /** Só estes hosts (comparação exata ou por sufixo `.dominio`). Para mídia de provedor. */
  hostAllowlist?: string[]
}

export interface SafeFetchResult {
  status: number
  contentType: string
  body: string
  bytes?: Buffer
  finalUrl: string
  /**
   * Quantos segundos o servidor pediu para esperar (`Retry-After`), quando pediu.
   *
   * Só faz sentido em 429 e 503. Existe porque insistir contra um site que acabou de
   * pedir calma é a maneira mais rápida de trocar um limite temporário por um bloqueio
   * permanente — e o número certo de segundos está na resposta, não num chute nosso.
   */
  retryAfterSeconds?: number
}

const DEFAULTS = { timeoutMs: 10_000, maxBytes: 2_000_000, maxRedirects: 3 }

/** `api.twilio.com` casa com `twilio.com` na lista; `evil-twilio.com` não. */
export function hostPermitido(host: string, allowlist: string[]): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return allowlist.some((permitido) => {
    const p = permitido.toLowerCase().replace(/^\./, '')
    return h === p || h.endsWith(`.${p}`)
  })
}

/** Segundos de `Retry-After`, aceitando as duas formas (número e data HTTP). */
function retryAfterDe(bruto: string | undefined): number | undefined {
  if (!bruto) return undefined
  const segundos = Number(bruto)
  if (Number.isFinite(segundos) && segundos >= 0) return Math.min(segundos, 86_400)
  const quando = Date.parse(bruto)
  if (Number.isFinite(quando)) return Math.max(0, Math.min(Math.round((quando - Date.now()) / 1000), 86_400))
  return undefined
}

interface RespostaCrua {
  status: number
  headers: http.IncomingHttpHeaders
  bytes: Buffer
  excedeu: boolean
}

/**
 * Uma requisição, no endereço já conferido.
 *
 * `node:https` em vez de `fetch` por um motivo só: aqui dá para fixar o endereço
 * (`lookup`) mantendo `Host` e SNI do nome original, e dá para cortar o corpo no meio
 * do download. Com `fetch` não há como fazer nem um nem outro sem dependência nova.
 */
function requisitar(alvo: CheckedTarget, opts: SafeFetchOptions, timeoutMs: number, maxBytes: number): Promise<RespostaCrua> {
  return new Promise((resolve, reject) => {
    const { url } = alvo
    const transporte = url.protocol === 'https:' ? https : http
    const req = transporte.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: opts.method ?? 'GET',
        headers: { host: url.host, ...(opts.headers ?? {}) },
        // O endereço conferido, entregue direto à conexão. O nome continua no `Host` e
        // no SNI, então o servidor legítimo responde normalmente.
        lookup: (_hostname, options, callback) => {
          const familia = alvo.family
          if ((options as { all?: boolean }).all) {
            ;(callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: alvo.address, family: familia }])
            return
          }
          callback(null, alvo.address, familia)
        },
      },
      (res) => {
        const pedacos: Buffer[] = []
        let total = 0
        let excedeu = false
        res.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > maxBytes) {
            // Abortar aqui é o ponto: o resto do arquivo nunca é baixado.
            excedeu = true
            res.destroy()
            req.destroy()
            return
          }
          pedacos.push(chunk)
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, bytes: Buffer.concat(pedacos), excedeu }))
        res.on('close', () => {
          if (excedeu) resolve({ status: res.statusCode ?? 0, headers: res.headers, bytes: Buffer.concat(pedacos), excedeu })
        })
        res.on('error', reject)
      },
    )
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Tempo esgotado'))
    })
    req.on('error', reject)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

/**
 * Uma requisição HTTP para fora, com SSRF conferido a cada salto.
 *
 * Todo destino externo escolhido por usuário passa por aqui: fonte de automação,
 * ferramenta HTTP do agente, webhook de saída, mídia de WhatsApp e API de instância
 * Evolution. Um `fetch` direto em qualquer um desses é a mesma falha reaberta.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes
  const maxRedirects = opts.maxRedirects ?? DEFAULTS.maxRedirects
  const comecou = Date.now()

  let current = rawUrl
  let headers = { ...(opts.headers ?? {}) }
  let origemInicial: string | null = null

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const alvo = await checkPublicUrl(current)
    if (opts.hostAllowlist && !hostPermitido(alvo.url.hostname, opts.hostAllowlist)) {
      throw new Error('Host não permitido para este download')
    }
    origemInicial ??= alvo.url.origin

    // O tempo é do PEDIDO inteiro, e não de cada salto: cinco redirecionamentos de
    // nove segundos não podem virar quarenta e cinco.
    const restante = timeoutMs - (Date.now() - comecou)
    if (restante <= 0) throw new Error('Tempo esgotado')

    const res = await requisitar(alvo, { ...opts, headers }, restante, maxBytes)

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location
      if (!location) throw new Error(`Redirecionamento sem destino (${res.status})`)
      // Um corpo não é reenviado: 307/308 exigiriam repetir o POST num host escolhido
      // pelo PRIMEIRO servidor, e isso é entregar a requisição a quem redirecionou.
      if (opts.body !== undefined) throw new Error(`Redirecionamento não seguido para requisição com corpo (${res.status})`)
      const proxima = new URL(location, alvo.url)
      // Credencial não atravessa troca de origem. O destino seguinte foi escolhido pelo
      // servidor anterior — mandar o `Authorization` para lá é vazar a chave.
      if (proxima.origin !== origemInicial) {
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(authorization|cookie|proxy-authorization)$/i.test(k)))
      }
      current = proxima.toString()
      continue // e o próximo salto é conferido de novo, do zero
    }

    if (res.excedeu) throw new Error(`Resposta grande demais (limite de ${maxBytes} bytes)`)
    if (opts.requireOk && (res.status < 200 || res.status > 299)) throw new Error(`A fonte respondeu ${res.status}`)

    const contentType = String(res.headers['content-type'] ?? '')
    if (opts.contentTypeAllowlist && !opts.contentTypeAllowlist.some((t) => contentType.includes(t))) {
      throw new Error(`Content-Type não permitido: ${contentType || '(vazio)'}`)
    }
    const declared = Number(res.headers['content-length'] ?? '')
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`Resposta grande demais (${declared} bytes)`)

    const retryAfterSeconds = retryAfterDe(typeof res.headers['retry-after'] === 'string' ? res.headers['retry-after'] : undefined)
    return {
      status: res.status,
      contentType,
      body: res.bytes.toString('utf8'),
      ...(opts.asBytes ? { bytes: res.bytes } : {}),
      finalUrl: alvo.url.toString(),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    }
  }
  throw new Error('Redirecionamentos demais')
}
