import { lookup } from 'node:dns/promises'
import net from 'node:net'

// Shared SSRF-safe HTTP. Extracted from the agent HTTP tool and strengthened for
// automation sources (plan §11.4/§11.5/§17.2): every redirect hop is re-checked,
// responses are byte-capped and content types can be allowlisted. Only public
// http(s) endpoints are reachable — localhost, private ranges, link-local,
// metadata services and hostnames that resolve to a private IP are blocked.

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
  }
  const v = ip.toLowerCase()
  if (v === '::1' || v === '::') return true
  if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice('::ffff:'.length))
  return false
}

// Throws if the URL is not a public http(s) endpoint. Resolves DNS for hostnames
// so a name pointing at an internal IP (DNS rebinding) is rejected too.
// Tests need to talk to a server they started on 127.0.0.1. This opens LOOPBACK
// ONLY — every other private range (10/8, 192.168, and above all 169.254 metadata)
// stays blocked, so an SSRF test remains a real test. validateConfig() refuses to
// boot production with this set, so it cannot be turned on where it would matter.
const loopbackAllowed = (): boolean => process.env.ALLOW_LOOPBACK_HTTP_TARGETS === '1'
const isLoopback = (ip: string): boolean => ip === '127.0.0.1' || ip.startsWith('127.') || ip === '::1'

export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('URL inválida')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Só endereços http(s) são permitidos')
  }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Host não permitido')
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host) && !(loopbackAllowed() && isLoopback(host))) throw new Error('Endereço de rede interna não é permitido')
    return url
  }
  const { address } = await lookup(host)
  if (isPrivateIp(address) && !(loopbackAllowed() && isLoopback(address))) throw new Error('Host aponta para uma rede interna')
  return url
}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  contentTypeAllowlist?: string[] // substring match against Content-Type
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
}

export interface SafeFetchResult {
  status: number
  contentType: string
  body: string
  finalUrl: string
}

const DEFAULTS = { timeoutMs: 10_000, maxBytes: 2_000_000, maxRedirects: 3 }

// Fetch with per-hop SSRF revalidation and hard limits. Redirects are followed
// manually so each Location is re-asserted before the next request.
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes
  const maxRedirects = opts.maxRedirects ?? DEFAULTS.maxRedirects

  let current = rawUrl
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        body: opts.body,
        redirect: 'manual',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new Error(`Redirecionamento sem destino (${res.status})`)
      // A body is not replayed across a redirect: 307/308 would require resending
      // it, and silently re-POSTing to a host chosen by the FIRST server is not a
      // risk worth taking. GET/DELETE follow; anything with a body stops here.
      if (opts.body !== undefined) throw new Error(`Redirecionamento não seguido para requisição com corpo (${res.status})`)
      current = new URL(location, url).toString()
      continue // re-assert the next hop
    }

    if (opts.requireOk && (res.status < 200 || res.status > 299)) {
      throw new Error(`A fonte respondeu ${res.status}`)
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (opts.contentTypeAllowlist && !opts.contentTypeAllowlist.some((t) => contentType.includes(t))) {
      throw new Error(`Content-Type não permitido: ${contentType || '(vazio)'}`)
    }
    const declared = Number(res.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`Resposta grande demais (${declared} bytes)`)
    }
    const text = (await res.text()).slice(0, maxBytes)
    return { status: res.status, contentType, body: text, finalUrl: url.toString() }
  }
  throw new Error('Redirecionamentos demais')
}
