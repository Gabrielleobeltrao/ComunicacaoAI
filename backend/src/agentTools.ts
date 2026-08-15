import type { AgentTool } from './agents.js'
import { executeToolCall } from './toolExecution.js'
import type { ExecutableTool } from './toolExecution.js'
import { TOOL_DEFAULTS } from './tools.js'
import { describeErrors, validateAgainstSchema } from './jsonSchema.js'

// Cap how many tool round-trips a single reply may make before we force the
// model to answer, so a misbehaving tool loop can't run forever. Enforced by BOTH
// provider loops (claude.ts / openai.ts), for every kind of tool.
export const MAX_TOOL_ITERATIONS = 6

export interface ToolCallRecord {
  name: string
  arguments: Record<string, unknown>
  ok: boolean
  result: string
}

// A tool the model can call, decoupled from how it runs. Custom HTTP tools,
// legacy per-agent HTTP tools, built-in integrations and delegation all resolve to
// this shape, so the provider loop only ever deals with name + schema + run().
export interface ResolvedTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (args: Record<string, unknown>) => Promise<{ ok: boolean; result: string }>
}

// A refusal the model cannot mistake for a result. It is structured on purpose: a
// prose "não foi possível" reads like an outcome, and agents have been observed
// reporting those as if the action had happened. `executed: false` is explicit.
export function missingCapability(name: string, reason: string, detail?: string): { ok: false; result: string } {
  return {
    ok: false,
    result: JSON.stringify({
      status: 'capability_unavailable',
      executed: false,
      tool: name,
      reason,
      ...(detail ? { detail } : {}),
      instruction: 'A ação NÃO foi executada. Não afirme que foi. Informe a limitação a quem pediu.',
    }),
  }
}

// --- legacy per-agent HTTP tools ---------------------------------------------------
// The old `agent.tools[]` format predates Custom Tools and used to be executed by a
// second, weaker implementation (a bare fetch with no schema validation, no domain
// allow list, no response cap and no masking). That executor is GONE: a legacy tool
// is now adapted into the canonical shape and runs through executeToolCall, so every
// HTTP call the model makes takes exactly one path.
//
// Deliberate consequence: a legacy tool with a state-changing method now requires the
// same explicit authorisation as any other, and reports a missing capability without
// it. Nothing is deleted or migrated in the database — the adaptation happens at
// resolution time, so an owner's data keeps working as it is.
export function legacyToolToExecutable(tool: AgentTool): ExecutableTool {
  const url = String(tool.url ?? '')
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    host = ''
  }
  return {
    name: tool.name,
    description: tool.description,
    method: tool.method,
    url,
    headers: tool.headers ?? [],
    inputSchema: toolInputSchema(tool),
    bodyTemplate: null,
    // The legacy format has no credential store: a secret, if any, sits in a plain
    // header. It is masked on the way out like any other (toolExecution's rules).
    auth: { kind: 'none' },
    timeoutMs: TOOL_DEFAULTS.timeoutMs,
    maxResponseChars: TOOL_DEFAULTS.maxResponseChars,
    // Its own host only, exactly like a Custom Tool created from this URL.
    allowedDomains: host ? [host] : [],
    maxCallsPerRun: TOOL_DEFAULTS.maxCallsPerRun,
    // Never inferred: acting on its own is a decision the owner takes per tool.
    allowAutonomousExecution: false,
    enabled: true,
  }
}

export function resolveHttpTool(tool: AgentTool): ResolvedTool {
  const executable = legacyToolToExecutable(tool)
  let callsSoFar = 0
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: executable.inputSchema,
    run: async (args) => {
      const outcome = await executeToolCall(executable, args, {
        callsSoFar,
        autonomous: true,
        // The legacy format keeps its credential in a plain header of any name, so
        // every header it carries is treated as one: masked in the detail and
        // redacted from the body, the response and any error.
        allHeadersAreSecret: true,
      })
      callsSoFar++
      return { ok: outcome.ok, result: outcome.result }
    },
  }
}

// JSON Schema for a legacy tool's arguments, shared by both providers' tool defs.
export function toolInputSchema(tool: AgentTool) {
  const properties: Record<string, { type: string; description: string }> = {}
  const required: string[] = []
  for (const p of tool.parameters ?? []) {
    properties[p.name] = { type: p.type, description: p.description }
    if (p.required) required.push(p.name)
  }
  return { type: 'object' as const, properties, required, additionalProperties: false }
}

// Look up a tool the model asked for by name and run it, returning a record the
// loop feeds back to the model and the UI shows for observability.
//
// This is the ONE dispatcher every tool goes through — custom, legacy, built-in and
// delegation alike — so the argument check lives here: a built-in adapter can no
// longer receive a field it never declared, and a hallucinated tool name comes back
// as a structured missing capability rather than a sentence the model may read as
// success.
export async function runResolvedTool(
  tools: ResolvedTool[],
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallRecord> {
  const tool = tools.find((t) => t.name === name)
  if (!tool) {
    const { result } = missingCapability(name, 'tool_not_available', 'A ferramenta não está atribuída a este agente ou não existe.')
    return { name, arguments: args, ok: false, result }
  }

  // Runtime validation for EVERY tool. Custom tools validate again inside the
  // executor (defence in depth); built-ins and delegation get it only here.
  const validation = validateAgainstSchema(tool.inputSchema, args)
  if (!validation.valid) {
    return {
      name,
      arguments: args,
      ok: false,
      result: JSON.stringify({
        status: 'invalid_arguments',
        executed: false,
        tool: name,
        detail: describeErrors(validation.errors),
        instruction: 'Corrija os argumentos e chame novamente, ou informe a limitação.',
      }),
    }
  }

  const { ok, result } = await tool.run(args)
  return { name, arguments: args, ok, result }
}
