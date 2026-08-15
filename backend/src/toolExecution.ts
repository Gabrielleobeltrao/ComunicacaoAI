// The single place a Custom Tool is executed. Chat, automations and
// executeAgentTask all come through here, so there is exactly one implementation
// of the sequence that matters:
//
//   permission -> argument validation -> secret injection -> SSRF-safe request
//   -> size cap -> sanitised result
//
// The model never sees a credential: the secret is decrypted inside this function
// and lives only in the outgoing header. What comes back out — for the model, the
// logs and the UI — is masked by the same function, so no call site can leak by
// forgetting to.
import { decrypt } from './crypto.js'
import { safeFetch } from './net/safeHttp.js'
import { describeErrors, validateAgainstSchema } from './jsonSchema.js'
import { SENSITIVE_HEADER, UNSAFE_METHODS } from './tools.js'
import type { Tool } from './tools.js'

export interface ToolExecutionResult {
  ok: boolean
  // What goes back to the model. Never contains a credential.
  result: string
  // For the run log / UI. Also credential-free.
  detail: {
    toolName: string
    status?: number
    durationMs: number
    // The request as it was made, with secrets masked.
    request: { method: string; url: string; headers: Record<string, string>; body?: string }
    truncated: boolean
    error?: string
  }
}

const MASK = '***'

// The name-based heuristic (defined next to the tool model, where saving such a
// header is refused) catches the usual suspects. It is NOT sufficient on its own: a
// header called "X-Minha-Chave" carries a credential and matches nothing — which is
// why the caller also passes the header names it injected a secret into, and those
// are masked unconditionally.
export function maskHeaders(headers: Record<string, string>, alwaysMask: string[] = []): Record<string, string> {
  const forced = new Set(alwaysMask.map((h) => h.toLowerCase()))
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = forced.has(key.toLowerCase()) || SENSITIVE_HEADER.test(key) ? MASK : value
  }
  return out
}

// Query strings can carry credentials too (?api_key=...). Masked for display.
export function maskUrl(raw: string): string {
  try {
    const url = new URL(raw)
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_HEADER.test(key)) url.searchParams.set(key, MASK)
    }
    if (url.username || url.password) {
      url.username = url.username ? MASK : ''
      url.password = url.password ? MASK : ''
    }
    return url.toString()
  } catch {
    return raw
  }
}

// Last line of defence: if a credential ever reaches a response body (an API that
// echoes the request), it is replaced before anyone — model, log or screen —
// sees it.
export function redactSecrets(text: string, secrets: string[]): string {
  let out = text
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join(MASK)
  }
  return out
}

// `{{arg}}` in the URL path/query or in the body template. Values are encoded for
// the URL so an argument cannot smuggle in extra query parameters.
function fillTemplate(template: string, args: Record<string, unknown>, encode: boolean): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    if (!(name in args)) return whole
    const value = args[name]
    const asText = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return encode ? encodeURIComponent(asText) : asText
  })
}

export interface ExecuteToolOptions {
  // Enforced by the caller's counter; passed in so the message can be specific.
  callsSoFar?: number
  // True when an AGENT is calling on its own initiative. A method that can change
  // something on the far side then requires the tool's explicit
  // `allowAutonomousExecution`. The owner's manual test leaves this false — that
  // path is confirmed in the UI instead.
  autonomous?: boolean
}

export async function executeToolCall(tool: Tool, rawArgs: unknown, options: ExecuteToolOptions = {}): Promise<ToolExecutionResult> {
  const started = Date.now()
  const fail = (error: string, extra: Partial<ToolExecutionResult['detail']> = {}): ToolExecutionResult => ({
    ok: false,
    result: error,
    detail: { toolName: tool.name, durationMs: Date.now() - started, request: { method: tool.method, url: maskUrl(tool.url), headers: {} }, truncated: false, error, ...extra },
  })

  if (!tool.enabled) return fail(`A ferramenta "${tool.name}" está desativada.`)

  // Reading on its own is one decision; acting on its own is another. Without the
  // explicit authorisation the agent is refused here — the single choke point every
  // caller goes through — rather than at each call site.
  if (options.autonomous && UNSAFE_METHODS.includes(tool.method) && !tool.allowAutonomousExecution) {
    return fail(`"${tool.name}" usa ${tool.method} e não está autorizada a executar sozinha. O proprietário precisa liberar a execução autônoma nas configurações da ferramenta.`)
  }

  if (typeof options.callsSoFar === 'number' && options.callsSoFar >= tool.maxCallsPerRun) {
    // A loop guard the model can understand and stop pushing against.
    return fail(`Limite de ${tool.maxCallsPerRun} chamada(s) a "${tool.name}" nesta execução foi atingido.`)
  }

  // --- arguments ----------------------------------------------------------
  const args = (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? rawArgs : {}) as Record<string, unknown>
  const validation = validateAgainstSchema(tool.inputSchema, args)
  if (!validation.valid) {
    // Phrased so the model can correct itself and try again.
    return fail(`Argumentos inválidos para "${tool.name}": ${describeErrors(validation.errors)}`)
  }

  // --- URL ----------------------------------------------------------------
  let url: URL
  try {
    url = new URL(fillTemplate(tool.url, args, true))
  } catch {
    return fail('Endereço da ferramenta inválido.')
  }

  // Independent of what the URL says today: the host must be on the allow list.
  const host = url.hostname.toLowerCase()
  const allowed = tool.allowedDomains.length > 0 ? tool.allowedDomains : [host]
  const hostAllowed = allowed.some((d) => host === d || host.endsWith(`.${d}`))
  if (!hostAllowed) return fail(`"${tool.name}" não tem permissão para acessar ${host}.`)

  // --- headers + credential ----------------------------------------------
  const headers: Record<string, string> = {}
  for (const h of tool.headers ?? []) {
    if (h.key?.trim()) headers[h.key.trim()] = fillTemplate(String(h.value ?? ''), args, false)
  }

  const secrets: string[] = []
  // Whatever these are called, they carry a credential and are never displayed.
  const credentialHeaders: string[] = []
  const auth = tool.auth ?? { kind: 'none' as const }
  if (auth.kind !== 'none') {
    let secret: string
    try {
      secret = auth.secretEncrypted ? decrypt(auth.secretEncrypted) : ''
    } catch {
      return fail(`Não foi possível ler a credencial de "${tool.name}".`)
    }
    if (!secret) return fail(`"${tool.name}" está sem credencial configurada.`)
    secrets.push(secret)

    if (auth.kind === 'bearer') {
      headers.Authorization = `Bearer ${secret}`
      credentialHeaders.push('Authorization')
    } else if (auth.kind === 'api_key') {
      const headerName = auth.headerName || 'X-API-Key'
      headers[headerName] = secret
      credentialHeaders.push(headerName)
    } else if (auth.kind === 'basic') {
      const encoded = Buffer.from(`${auth.username ?? ''}:${secret}`).toString('base64')
      headers.Authorization = `Basic ${encoded}`
      credentialHeaders.push('Authorization')
      // The base64 blob is itself a credential: redact it from any echoed body.
      secrets.push(encoded)
      if (auth.username) secrets.push(`${auth.username}:${secret}`)
    }
  }

  // --- body ---------------------------------------------------------------
  let body: string | undefined
  const sendsBody = tool.method !== 'GET' && tool.method !== 'DELETE'
  if (sendsBody) {
    body = tool.bodyTemplate ? fillTemplate(tool.bodyTemplate, args, false) : JSON.stringify(args)
    if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json'
  } else {
    // GET/DELETE carry the arguments as query parameters, unless the URL template
    // already consumed them.
    for (const [key, value] of Object.entries(args)) {
      if (!tool.url.includes(`{{${key}}}`)) url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
    }
  }

  const maskedRequest = { method: tool.method, url: maskUrl(url.toString()), headers: maskHeaders(headers, credentialHeaders), ...(body ? { body: redactSecrets(body, secrets) } : {}) }

  // --- request ------------------------------------------------------------
  try {
    // safeFetch enforces the SSRF rules on the initial URL AND on every redirect
    // — a public URL that 302s to 169.254.169.254 is the attack this closes.
    const res = await safeFetch(url.toString(), {
      method: tool.method,
      headers,
      body,
      timeoutMs: tool.timeoutMs,
      // A generous transport ceiling, NOT the tool's cap: safeFetch refuses a
      // response whose declared length exceeds maxBytes, and for a tool the right
      // behaviour is to truncate to maxResponseChars, not to fail the call.
      maxBytes: Math.max(tool.maxResponseChars * 4, 256 * 1024),
    })

    const raw = res.body ?? ''
    const truncated = raw.length > tool.maxResponseChars
    const text = redactSecrets(truncated ? raw.slice(0, tool.maxResponseChars) : raw, secrets)
    const detail = { toolName: tool.name, status: res.status, durationMs: Date.now() - started, request: maskedRequest, truncated }

    if (res.status < 200 || res.status >= 300) {
      return { ok: false, result: `HTTP ${res.status}: ${text || '(sem corpo)'}`, detail: { ...detail, error: `HTTP ${res.status}` } }
    }
    return { ok: true, result: text || '(resposta vazia)', detail }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      // Never echo the raw error into the model without masking: a fetch error can
      // quote the URL, which can carry a credential.
      result: `Não foi possível chamar "${tool.name}": ${redactSecrets(maskUrl(message), secrets)}`,
      detail: { toolName: tool.name, durationMs: Date.now() - started, request: maskedRequest, truncated: false, error: redactSecrets(message, secrets) },
    }
  }
}

// Never retry a method that may have changed something on the other side. A GET
// that failed to connect is safe to try once more; a POST is not.
export const isRetryable = (tool: Pick<Tool, 'method'>): boolean => !UNSAFE_METHODS.includes(tool.method)
