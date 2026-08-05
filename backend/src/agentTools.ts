import { lookup } from 'node:dns/promises'
import net from 'node:net'
import type { AgentTool } from './agents.js'

// Cap how many tool round-trips a single reply may make before we force the
// model to answer, so a misbehaving tool loop can't run forever.
export const MAX_TOOL_ITERATIONS = 6
const TIMEOUT_MS = 8000
const MAX_RESULT_CHARS = 4000

export interface ToolCallRecord {
  name: string
  arguments: Record<string, unknown>
  ok: boolean
  result: string
}

// A tool the model can call, decoupled from how it runs. Custom HTTP tools and
// built-in integrations (Google, etc.) both resolve to this shape, so the
// provider loop only ever deals with name + schema + run().
export interface ResolvedTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (args: Record<string, unknown>) => Promise<{ ok: boolean; result: string }>
}

export function resolveHttpTool(tool: AgentTool): ResolvedTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: toolInputSchema(tool),
    run: (args) => executeTool(tool, args),
  }
}

// JSON Schema for a tool's arguments, shared by both providers' tool defs.
export function toolInputSchema(tool: AgentTool) {
  const properties: Record<string, { type: string; description: string }> = {}
  const required: string[] = []
  for (const p of tool.parameters ?? []) {
    properties[p.name] = { type: p.type, description: p.description }
    if (p.required) required.push(p.name)
  }
  return { type: 'object' as const, properties, required, additionalProperties: false }
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
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

// SSRF guard: only public http(s) endpoints. Blocks localhost, private ranges
// and hostnames that resolve to a private IP.
async function assertPublicUrl(rawUrl: string) {
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
    return
  }
  const { address } = await lookup(host)
  if (isPrivateIp(address)) throw new Error('Host aponta para uma rede interna')
}

async function executeTool(tool: AgentTool, args: Record<string, unknown>): Promise<{ ok: boolean; result: string }> {
  try {
    await assertPublicUrl(tool.url)
    const url = new URL(tool.url)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    for (const h of tool.headers ?? []) {
      if (h.key.trim()) headers[h.key] = h.value
    }

    let body: string | undefined
    if (tool.method === 'GET') {
      for (const [key, value] of Object.entries(args)) url.searchParams.set(key, String(value))
    } else {
      body = JSON.stringify(args)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(url, { method: tool.method, headers, body, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }

    const text = (await res.text()).slice(0, MAX_RESULT_CHARS)
    if (!res.ok) return { ok: false, result: `HTTP ${res.status}: ${text}` }
    return { ok: true, result: text || '(resposta vazia)' }
  } catch (error) {
    return { ok: false, result: `Não foi possível chamar a ferramenta: ${(error as Error).message}` }
  }
}

// Look up a tool the model asked for by name and run it, returning a record the
// loop feeds back to the model and the UI shows for observability.
export async function runResolvedTool(
  tools: ResolvedTool[],
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallRecord> {
  const tool = tools.find((t) => t.name === name)
  if (!tool) {
    return { name, arguments: args, ok: false, result: `A ferramenta "${name}" não existe.` }
  }
  const { ok, result } = await tool.run(args)
  return { name, arguments: args, ok, result }
}
