import type { AgentTool } from './agents.js'
import { assertPublicUrl } from './net/safeHttp.js'

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
