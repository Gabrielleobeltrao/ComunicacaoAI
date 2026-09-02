import { createHmac, randomUUID } from 'node:crypto'

// O ADAPTADOR do worker de páginas — o único lugar do backend que fala com ele.
//
// A URL vem da CONFIGURAÇÃO do servidor, nunca de um pedido: deixar o cliente escolher o
// endereço do worker seria entregar a ele um proxy para a rede interna — exatamente o que
// o worker existe para impedir.
//
// Sem `BROWSER_WORKER_URL` e `BROWSER_WORKER_SECRET`, nada é registrado e o tipo `browser`
// continua recusando. É a mesma regra do runner de código: o que não foi configurado não
// existe.

export interface BrowserFetchRequest {
  url: string
  subrequests?: string[]
  correlationId?: string
  limits?: { timeoutMs?: number; maxBytes?: number; maxTotalBytes?: number }
}

export interface BrowserFetchResult {
  ok: boolean
  status?: number
  contentType?: string
  body?: string
  finalUrl?: string
  chain?: string[]
  /** `false` enquanto não houver motor de renderização. Dito, nunca presumido. */
  rendered?: boolean
  subrequests?: { url: string; status: number; bytes: number }[]
  blocked?: { url: string; reason: string }[]
  error?: { kind: 'blocked' | 'timeout' | 'fetch' | 'unavailable'; message: string }
}

export interface BrowserWorker {
  fetchPage(request: BrowserFetchRequest): Promise<BrowserFetchResult>
  health(): Promise<{ ok: boolean; capabilities: { fetch: boolean; render: boolean; screenshot: boolean; vision: boolean }; killSwitch?: boolean }>
}

const recusaTudo: BrowserWorker = {
  fetchPage: async () => ({ ok: false, error: { kind: 'unavailable', message: 'não há worker de páginas configurado' } }),
  health: async () => ({ ok: false, capabilities: { fetch: false, render: false, screenshot: false, vision: false } }),
}

let worker: BrowserWorker = recusaTudo
export const browserWorker = (): BrowserWorker => worker
export const registerBrowserWorker = (w: BrowserWorker): void => {
  worker = w
}
export const resetBrowserWorker = (): void => {
  worker = recusaTudo
}

export function httpBrowserWorker(config: { baseUrl: string; secret: string; timeoutMs?: number }): BrowserWorker {
  const base = config.baseUrl.replace(/\/$/, '')
  const timeoutMs = config.timeoutMs ?? 30_000

  async function chamar(caminho: string, corpo: unknown): Promise<unknown> {
    const body = JSON.stringify(corpo ?? {})
    const timestamp = Date.now()
    const nonce = randomUUID()
    const controle = new AbortController()
    const relogio = setTimeout(() => controle.abort(), timeoutMs)
    try {
      const r = await fetch(`${base}${caminho}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sandbox-timestamp': String(timestamp),
          'x-sandbox-nonce': nonce,
          'x-sandbox-signature': createHmac('sha256', config.secret).update(`${timestamp}.${nonce}.${body}`).digest('hex'),
        },
        body,
        signal: controle.signal,
      })
      if (!r.ok) return { ok: false, error: { kind: 'unavailable', message: `o worker respondeu ${r.status}` } }
      return await r.json()
    } finally {
      clearTimeout(relogio)
    }
  }

  return {
    async fetchPage(request) {
      try {
        const bruto = (await chamar('/fetch', request)) as BrowserFetchResult
        // A resposta é conferida antes de virar resultado: tratar o que vem do outro lado
        // da fronteira como já válido é deixar o worker escolher no que o backend acredita.
        if (bruto?.ok === true) {
          return {
            ok: true,
            status: Number(bruto.status ?? 0),
            contentType: String(bruto.contentType ?? ''),
            body: String(bruto.body ?? ''),
            finalUrl: String(bruto.finalUrl ?? ''),
            chain: Array.isArray(bruto.chain) ? bruto.chain.map(String) : [],
            rendered: bruto.rendered === true,
            subrequests: Array.isArray(bruto.subrequests) ? bruto.subrequests : [],
            blocked: Array.isArray(bruto.blocked) ? bruto.blocked : [],
          }
        }
        const tipos = ['blocked', 'timeout', 'fetch', 'unavailable'] as const
        const kind = tipos.includes(bruto?.error?.kind as (typeof tipos)[number]) ? bruto!.error!.kind : 'fetch'
        return { ok: false, error: { kind, message: String(bruto?.error?.message ?? 'a busca falhou').slice(0, 200) } }
      } catch {
        return { ok: false, error: { kind: 'unavailable', message: 'o worker de páginas não respondeu' } }
      }
    },
    async health() {
      try {
        const bruto = (await chamar('/health', {})) as { ok?: boolean; capabilities?: Record<string, unknown>; killSwitch?: boolean }
        return {
          ok: bruto?.ok === true,
          capabilities: {
            fetch: bruto?.capabilities?.fetch === true,
            render: bruto?.capabilities?.render === true,
            screenshot: bruto?.capabilities?.screenshot === true,
            vision: bruto?.capabilities?.vision === true,
          },
          killSwitch: bruto?.killSwitch === true,
        }
      } catch {
        return { ok: false, capabilities: { fetch: false, render: false, screenshot: false, vision: false } }
      }
    },
  }
}

/** Monta a partir do ambiente do SERVIDOR — ou não monta, e o padrão fail-closed vale. */
export function browserWorkerFromEnv(): BrowserWorker | null {
  const baseUrl = process.env.BROWSER_WORKER_URL
  const secret = process.env.BROWSER_WORKER_SECRET
  if (!baseUrl || !secret) return null
  return httpBrowserWorker({ baseUrl, secret, ...(process.env.BROWSER_WORKER_TIMEOUT_MS ? { timeoutMs: Number(process.env.BROWSER_WORKER_TIMEOUT_MS) } : {}) })
}
