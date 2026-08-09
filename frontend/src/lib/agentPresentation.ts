import { MEMORY_LABELS } from './agentLabels'
import type { AgentSummary } from './types'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// A short "role" line for an agent — its model, or the provider as a fallback.
export function roleLabelOf(agent: AgentSummary): string {
  return agent.model || (agent.provider === 'openai' ? 'OpenAI' : 'Anthropic')
}

// Skill tags derived from what the agent can actually do. Tolerant of older
// agent documents that predate the tools/builtinTools fields.
export function skillsOf(agent: AgentSummary): string[] {
  return Array.from(
    new Set([
      ...(agent.tools ?? []).map((t) => t.name),
      ...(agent.builtinTools ?? []).map((t) => cap(t.key)),
      ...(agent.memoryType && agent.memoryType !== 'none' ? [MEMORY_LABELS[agent.memoryType]] : []),
      ...(agent.handoffEnabled ? ['Atendimento humano'] : []),
      ...(agent.structuredOutputEnabled ? ['Dados estruturados'] : []),
    ]),
  ).slice(0, 8)
}
