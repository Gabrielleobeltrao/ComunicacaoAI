// Custom Tools — reusable HTTP integrations an owner configures once and assigns
// to any number of agents. Nothing in here knows about a domain: a broker, a CRM,
// a shop or a doorbell are all "a URL, a schema and maybe a credential".
//
// Two rules shape the whole module:
//   1. A credential is written once and never read back — not by the API, not by
//      the frontend, and above all not by the model. It is decrypted only inside
//      the executor, at the moment of the request.
//   2. The model sees name + description + inputSchema. Nothing else exists as far
//      as it is concerned.
import { ObjectId } from 'mongodb'
import { db } from './db.js'
import { isProduction } from './config.js'
import { encrypt } from './crypto.js'
import { isValidToolSchema } from './jsonSchema.js'

// Header names that carry a credential. Anything matching this belongs in `auth`
// (encrypted at rest, never read back) and is refused as a plain header — a stored
// header is returned to the UI and written to the run log in clear text.
export const SENSITIVE_HEADER = /(authorization|api[-_]?key|token|secret|password|cookie|chave|senha)/i

export type ToolMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export const TOOL_METHODS: ToolMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

// Methods that may change state on the far side: never retried automatically.
export const UNSAFE_METHODS: ToolMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE']

export type ToolAuthKind = 'none' | 'bearer' | 'api_key' | 'basic'
export const TOOL_AUTH_KINDS: ToolAuthKind[] = ['none', 'bearer', 'api_key', 'basic']

export interface ToolAuth {
  kind: ToolAuthKind
  // api_key: which header carries it (public — it is not the secret).
  headerName?: string
  // basic: the username (public); the password is the secret.
  username?: string
  // The secret itself, encrypted at rest. Never serialized outwards.
  secretEncrypted?: string | null
}

export interface ToolHeader {
  key: string
  value: string
}

export interface Tool {
  _id: ObjectId
  ownerId: string
  // The identifier the model calls. Restricted to what providers accept as a
  // function name.
  name: string
  // What teaches the model WHEN to reach for this tool. The most important field.
  description: string
  method: ToolMethod
  /**
   * O endereço.
   *
   * SEM `installationId`: a URL completa, como sempre foi.
   * COM `installationId`: apenas o CAMINHO (`/v2/account`) — base, autenticação e
   * cabeçalhos vêm da conexão, resolvidos no backend na hora de executar. Assim duas
   * ferramentas contra a mesma API param de guardar o mesmo segredo duas vezes.
   */
  url: string
  /**
   * A conexão que empresta base e credencial. Ausente = execução manual, idêntica à de
   * sempre — é isso que mantém toda ferramenta existente funcionando sem reconfiguração.
   */
  installationId?: string | null
  headers: ToolHeader[]
  // JSON Schema (object at the root) describing the arguments.
  inputSchema: Record<string, unknown>
  // Optional body template with {{arg}} placeholders; absent = send the arguments
  // as a JSON object.
  bodyTemplate?: string | null
  auth: ToolAuth
  timeoutMs: number
  maxResponseChars: number
  // Extra guard rails, independent of the URL itself: even if the URL is edited
  // later, a request outside these hosts is refused. Empty = only the tool's own host.
  allowedDomains: string[]
  // How many times ONE run may call this tool, so a loop cannot bill forever.
  maxCallsPerRun: number
  // Explicit permission for an AGENT to run this tool on its own when the method
  // can change something on the far side (POST/PUT/PATCH/DELETE). Default false:
  // reading is one decision, acting is another. The owner's manual test is not
  // affected — that one is confirmed in the UI instead.
  allowAutonomousExecution: boolean
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export const TOOL_DEFAULTS = {
  timeoutMs: 8_000,
  maxResponseChars: 4_000,
  maxCallsPerRun: 5,
} as const

export const TOOL_LIMITS = {
  minTimeoutMs: 1_000,
  maxTimeoutMs: 60_000,
  minResponseChars: 200,
  maxResponseChars: 50_000,
  maxCallsPerRun: 25,
  maxHeaders: 10,
} as const

const tools = db.collection<Tool>('tools')

export async function ensureToolIndexes(): Promise<void> {
  // A tool name is how the model addresses it, so it must be unique per owner.
  await tools.createIndex({ ownerId: 1, name: 1 }, { unique: true })
}

// Providers accept [a-zA-Z0-9_-] for function names; anything else would be
// rejected at call time, so it is rejected at save time instead.
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

const clamp = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}

export interface ToolInput {
  name: string
  description: string
  method: ToolMethod
  url: string
  /** O caminho vira relativo quando há conexão; ausente = manual, como sempre. */
  installationId?: string | null
  headers?: ToolHeader[]
  inputSchema: Record<string, unknown>
  bodyTemplate?: string | null
  auth?: { kind: ToolAuthKind; headerName?: string; username?: string; secret?: string }
  timeoutMs?: number
  maxResponseChars?: number
  allowedDomains?: string[]
  maxCallsPerRun?: number
  allowAutonomousExecution?: boolean
  enabled?: boolean
}

export class ToolValidationError extends Error {
  field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = 'ToolValidationError'
    this.field = field
  }
}

// Shared by create and update. Throws a field-tagged error the API turns into a
// 400 the UI can point at.
/**
 * Os cabeçalhos declarados na ferramenta — nunca os que carregam credencial.
 *
 * Um segredo num cabeçalho simples ficaria em texto claro no banco e voltaria para a
 * tela. Ele vai para a seção de autenticação, cifrado; a recusa é explícita porque quem
 * escreveu precisa movê-lo, e aceitar em silêncio esconderia o problema.
 */
function headersDe(input: ToolInput): { key: string; value: string }[] {
  const headers = (input.headers ?? []).filter((h) => h && String(h.key ?? '').trim()).slice(0, TOOL_LIMITS.maxHeaders)
  for (const h of headers) {
    const key = String(h.key).trim()
    if (SENSITIVE_HEADER.test(key)) {
      throw new ToolValidationError('headers', `O cabeçalho "${key}" carrega uma credencial. Use a seção Autenticação: o valor é guardado criptografado e nunca é exibido.`)
    }
  }
  return headers
}

function normalize(input: ToolInput): Omit<Tool, '_id' | 'ownerId' | 'createdAt' | 'updatedAt' | 'auth'> & { authPublic: Omit<ToolAuth, 'secretEncrypted'> } {
  const name = String(input.name ?? '').trim()
  if (!TOOL_NAME_PATTERN.test(name)) {
    throw new ToolValidationError('name', 'Use apenas letras, números, _ e - (até 64 caracteres).')
  }
  const description = String(input.description ?? '').trim()
  if (description.length < 10) {
    // The description is what the model reasons over; a vague one makes the tool
    // unusable in practice, so it is a validation error rather than a warning.
    throw new ToolValidationError('description', 'Descreva em pelo menos 10 caracteres quando esta ferramenta deve ser usada.')
  }
  if (!TOOL_METHODS.includes(input.method)) throw new ToolValidationError('method', 'Método HTTP inválido.')

  /**
   * COM conexão, o endereço é um CAMINHO; sem ela, a URL completa de sempre.
   *
   * As duas validações são diferentes porque as duas coisas são diferentes: um caminho
   * não tem protocolo nem host para conferir, e a base — com o domínio permitido — vem do
   * App no momento de executar.
   */
  const installationId = typeof input.installationId === 'string' && input.installationId.trim() ? input.installationId.trim() : null
  if (installationId) {
    const caminho = String(input.url ?? '').trim()
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(caminho)) {
      throw new ToolValidationError('url', 'Com uma conexão, informe apenas o caminho (ex.: /v2/account) — a base vem da conexão.')
    }
    return {
      name,
      description,
      method: input.method,
      url: caminho,
      installationId,
      headers: headersDe(input),
      inputSchema: input.inputSchema,
      bodyTemplate: typeof input.bodyTemplate === 'string' && input.bodyTemplate.trim() ? input.bodyTemplate : null,
      timeoutMs: clamp(input.timeoutMs, TOOL_DEFAULTS.timeoutMs, TOOL_LIMITS.minTimeoutMs, TOOL_LIMITS.maxTimeoutMs),
      maxResponseChars: clamp(input.maxResponseChars, TOOL_DEFAULTS.maxResponseChars, TOOL_LIMITS.minResponseChars, TOOL_LIMITS.maxResponseChars),
      // A lista vem do App, no momento de executar. Guardá-la aqui criaria uma segunda
      // verdade sobre onde a conexão pode chegar.
      allowedDomains: [],
      maxCallsPerRun: clamp(input.maxCallsPerRun, TOOL_DEFAULTS.maxCallsPerRun, 1, TOOL_LIMITS.maxCallsPerRun),
      allowAutonomousExecution: input.allowAutonomousExecution === true,
      enabled: input.enabled !== false,
      // A credencial é da CONEXÃO. Aceitar uma aqui seria guardar um segundo segredo para
      // a mesma chamada, e o que estivesse errado mandaria em silêncio.
      authPublic: { kind: 'none' as ToolAuthKind },
    }
  }

  let parsed: URL
  try {
    parsed = new URL(String(input.url ?? ''))
  } catch {
    throw new ToolValidationError('url', 'Endereço inválido.')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ToolValidationError('url', 'O endereço deve começar com http:// ou https://.')
  }

  if (!isValidToolSchema(input.inputSchema)) {
    throw new ToolValidationError('inputSchema', 'Os parâmetros precisam ser um objeto JSON Schema.')
  }

  const headers = headersDe(input)
  const kind: ToolAuthKind = TOOL_AUTH_KINDS.includes(input.auth?.kind as ToolAuthKind) ? (input.auth!.kind as ToolAuthKind) : 'none'
  if (kind === 'api_key' && !String(input.auth?.headerName ?? '').trim()) {
    throw new ToolValidationError('auth.headerName', 'Informe o nome do cabeçalho da chave.')
  }
  if (kind === 'basic' && !String(input.auth?.username ?? '').trim()) {
    throw new ToolValidationError('auth.username', 'Informe o usuário.')
  }
  // In production a credential may only travel over TLS: plain http would put the
  // secret on the wire in clear text. Local/dev keeps http for testing.
  if (isProduction && kind !== 'none' && parsed.protocol !== 'https:') {
    throw new ToolValidationError('url', 'Uma ferramenta com credencial precisa de um endereço https:// — em http a credencial trafega aberta.')
  }

  // The tool's own host is always allowed; extra hosts are opt-in.
  const allowedDomains = [...new Set([parsed.hostname, ...(input.allowedDomains ?? []).map((d) => String(d).trim().toLowerCase()).filter(Boolean)])]

  return {
    name,
    description,
    method: input.method,
    url: parsed.toString(),
    installationId: null,
    headers,
    inputSchema: input.inputSchema,
    bodyTemplate: typeof input.bodyTemplate === 'string' && input.bodyTemplate.trim() ? input.bodyTemplate : null,
    timeoutMs: clamp(input.timeoutMs, TOOL_DEFAULTS.timeoutMs, TOOL_LIMITS.minTimeoutMs, TOOL_LIMITS.maxTimeoutMs),
    maxResponseChars: clamp(input.maxResponseChars, TOOL_DEFAULTS.maxResponseChars, TOOL_LIMITS.minResponseChars, TOOL_LIMITS.maxResponseChars),
    allowedDomains,
    maxCallsPerRun: clamp(input.maxCallsPerRun, TOOL_DEFAULTS.maxCallsPerRun, 1, TOOL_LIMITS.maxCallsPerRun),
    // Opt-in, never inferred: anything but an explicit true is a no.
    allowAutonomousExecution: input.allowAutonomousExecution === true,
    enabled: input.enabled !== false,
    authPublic: {
      kind,
      ...(kind === 'api_key' ? { headerName: String(input.auth?.headerName).trim() } : {}),
      ...(kind === 'basic' ? { username: String(input.auth?.username).trim() } : {}),
    },
  }
}

export async function createTool(ownerId: string, input: ToolInput): Promise<Tool> {
  const { authPublic, ...fields } = normalize(input)
  const secret = input.auth?.secret
  if (authPublic.kind !== 'none' && !secret) {
    throw new ToolValidationError('auth.secret', 'Informe a credencial.')
  }
  const now = new Date()
  const doc: Tool = {
    _id: new ObjectId(),
    ownerId,
    ...fields,
    auth: { ...authPublic, secretEncrypted: secret ? encrypt(secret) : null },
    createdAt: now,
    updatedAt: now,
  }
  try {
    await tools.insertOne(doc)
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new ToolValidationError('name', 'Já existe uma ferramenta com esse nome.')
    throw error
  }
  return doc
}

export async function updateTool(ownerId: string, id: ObjectId, input: ToolInput): Promise<Tool | null> {
  const existing = await tools.findOne({ _id: id, ownerId })
  if (!existing) return null

  const { authPublic, ...fields } = normalize(input)
  const secret = input.auth?.secret
  // An omitted secret KEEPS the stored one — the UI never receives it, so it
  // cannot send it back. Changing the auth kind without a new secret is refused
  // rather than silently reusing a credential meant for another scheme.
  let secretEncrypted = existing.auth?.secretEncrypted ?? null
  if (secret) secretEncrypted = encrypt(secret)
  else if (authPublic.kind !== existing.auth?.kind && authPublic.kind !== 'none') {
    throw new ToolValidationError('auth.secret', 'Informe a credencial para o novo tipo de autenticação.')
  }
  if (authPublic.kind === 'none') secretEncrypted = null

  try {
    const doc = await tools.findOneAndUpdate(
      { _id: id, ownerId },
      { $set: { ...fields, auth: { ...authPublic, secretEncrypted }, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )
    return doc ?? null
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new ToolValidationError('name', 'Já existe uma ferramenta com esse nome.')
    throw error
  }
}

export const listTools = (ownerId: string): Promise<Tool[]> => tools.find({ ownerId }).sort({ name: 1 }).toArray()

export const getTool = (ownerId: string, id: ObjectId): Promise<Tool | null> => tools.findOne({ _id: id, ownerId })

// Owner-scoped resolution of the ids an agent carries. Silently drops anything
// that is not this owner's — a stale or foreign id must never reach the executor.
export async function getToolsByIds(ownerId: string, ids: string[]): Promise<Tool[]> {
  const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id))
  if (objectIds.length === 0) return []
  return tools.find({ ownerId, _id: { $in: objectIds } }).toArray()
}

export async function deleteTool(ownerId: string, id: ObjectId): Promise<boolean> {
  const res = await tools.deleteOne({ _id: id, ownerId })
  return res.deletedCount === 1
}

// What leaves the backend. The encrypted secret is stripped here, once, so no
// route can forget to do it; `hasSecret` is enough for the UI to show "stored".
export interface ToolPublic extends Omit<Tool, 'auth' | '_id'> {
  _id: string
  auth: Omit<ToolAuth, 'secretEncrypted'> & { hasSecret: boolean }
}

export function toPublicTool(tool: Tool): ToolPublic {
  const { secretEncrypted, ...authPublic } = tool.auth ?? { kind: 'none' as const }
  return {
    ...tool,
    _id: tool._id.toString(),
    // Saving one is refused now, but a tool stored before that rule may still carry
    // a credential-bearing header: it is masked on the way out, so it cannot be read
    // back from the API.
    headers: (tool.headers ?? []).map((h) => (SENSITIVE_HEADER.test(String(h.key)) ? { key: h.key, value: '***' } : h)),
    allowAutonomousExecution: tool.allowAutonomousExecution === true,
    auth: { ...authPublic, hasSecret: Boolean(secretEncrypted) },
  }
}
