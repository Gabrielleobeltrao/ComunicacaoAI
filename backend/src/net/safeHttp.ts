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
    if (isPrivateIp(host)) throw new Error('Endereço de rede interna não é permitido')
    return url
  }
  const { address } = await lookup(host)
  if (isPrivateIp(address)) throw new Error('Host aponta para uma rede interna')
  return url
}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  contentTypeAllowlist?: string[] // substring match against Content-Type
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
      current = new URL(location, url).toString()
      continue // re-assert the next hop
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
