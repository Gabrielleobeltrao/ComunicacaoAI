import { API_URL } from './api'

// Client for the Custom Tools API. A stored credential is never part of this
// contract: the backend only ever tells us WHETHER one exists (`auth.hasSecret`),
// so there is nothing here that could put it on screen.

export type ToolMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export const TOOL_METHODS: ToolMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

// Methods that can change something on the far side. They need the owner's explicit
// permission before an agent may use them, and a confirmation for a manual test.
export const UNSAFE_METHODS: ToolMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE']
export const isUnsafe = (method: ToolMethod): boolean => UNSAFE_METHODS.includes(method)

export type ToolAuthKind = 'none' | 'bearer' | 'api_key' | 'basic'
export const TOOL_AUTH_KINDS: ToolAuthKind[] = ['none', 'bearer', 'api_key', 'basic']

// The parameter types the editor offers. The backend accepts full JSON Schema;
// the form builds a schema from these, and a schema written elsewhere still works.
export type ToolParamType = 'string' | 'number' | 'integer' | 'boolean'

export interface ToolParam {
  name: string
  type: ToolParamType
  description: string
  required: boolean
  // Comma-separated in the form; becomes `enum` in the schema.
  options?: string[]
}

export interface Tool {
  /**
   * A conexão que empresta base e credencial. Ausente = manual, como sempre foi — e é
   * essa ausência que mantém toda ferramenta já criada funcionando sem reconfiguração.
   */
  installationId?: string | null
  _id: string
  name: string
  description: string
  method: ToolMethod
  url: string
  headers: { key: string; value: string }[]
  inputSchema: Record<string, unknown>
  bodyTemplate?: string | null
  auth: { kind: ToolAuthKind; headerName?: string; username?: string; hasSecret: boolean }
  timeoutMs: number
  maxResponseChars: number
  allowedDomains: string[]
  maxCallsPerRun: number
  // Whether an agent may run this tool by itself when the method changes state.
  allowAutonomousExecution?: boolean
  enabled: boolean
  usedBy?: { _id: string; name: string }[]
}

export interface ToolTestResult {
  ok: boolean
  result: string
  detail: {
    toolName: string
    status?: number
    durationMs: number
    request: { method: string; url: string; headers: Record<string, string>; body?: string }
    truncated: boolean
    error?: string
  }
}

// Carries the backend's `field` so the form can point at the offending input.
export class ToolApiError extends Error {
  field?: string
  constructor(message: string, field?: string) {
    super(message)
    this.name = 'ToolApiError'
    this.field = field
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; field?: string }
    throw new ToolApiError(body.error ?? `HTTP ${res.status}`, body.field)
  }
  return res.json() as Promise<T>
}

const opts = (method: string, body?: unknown): RequestInit => ({
  method,
  credentials: 'include',
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const listTools = () => fetch(`${API_URL}/api/tools`, opts('GET')).then(json<Tool[]>)
export const createTool = (input: unknown) => fetch(`${API_URL}/api/tools`, opts('POST', input)).then(json<Tool>)
export const updateTool = (id: string, input: unknown) => fetch(`${API_URL}/api/tools/${id}`, opts('PATCH', input)).then(json<Tool>)
// `confirm` is required by the backend for a state-changing method: the operator
// has to say yes to a real POST/DELETE against a live system.
export const testTool = (id: string, args: Record<string, unknown>, confirm = false) =>
  fetch(`${API_URL}/api/tools/${id}/test`, opts('POST', { arguments: args, confirm })).then(json<ToolTestResult>)

export async function deleteTool(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/tools/${id}`, opts('DELETE'))
  if (!res.ok && res.status !== 204) throw new ToolApiError(`HTTP ${res.status}`)
}

// --- schema <-> form -----------------------------------------------------------
// The form edits a friendly list of fields; the wire format is JSON Schema. These
// two functions are the only place that mapping lives.

export function paramsToSchema(params: ToolParam[]): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []
  for (const p of params) {
    const name = p.name.trim()
    if (!name) continue
    properties[name] = {
      type: p.type,
      ...(p.description.trim() ? { description: p.description.trim() } : {}),
      ...(p.options && p.options.length > 0 ? { enum: p.options } : {}),
    }
    if (p.required) required.push(name)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

export function schemaToParams(schema: Record<string, unknown> | undefined): ToolParam[] {
  const properties = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = new Set(Array.isArray(schema?.required) ? (schema.required as string[]) : [])
  return Object.entries(properties).map(([name, spec]) => ({
    name,
    type: (typeof spec.type === 'string' && ['string', 'number', 'integer', 'boolean'].includes(spec.type) ? spec.type : 'string') as ToolParamType,
    description: typeof spec.description === 'string' ? spec.description : '',
    required: required.has(name),
    options: Array.isArray(spec.enum) ? (spec.enum as unknown[]).map(String) : undefined,
  }))
}
