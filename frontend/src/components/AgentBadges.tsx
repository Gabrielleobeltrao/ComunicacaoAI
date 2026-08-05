import type { ReactNode } from 'react'
import { GUARDRAIL_LABELS, MEMORY_LABELS } from '../lib/agentLabels'
import type { AgentSummary } from '../lib/types'

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300">{children}</span>
  )
}

// Quick config facts about an agent, shown on its cards (list, team members,
// agent page overview).
export function AgentBadges({ agent }: { agent: AgentSummary }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Chip>{agent.provider === 'openai' ? 'OpenAI' : 'Anthropic'}</Chip>
      {agent.model && <Chip>{agent.model}</Chip>}
      {agent.memoryType !== 'none' && <Chip>{MEMORY_LABELS[agent.memoryType]}</Chip>}
      {agent.guardrailMode !== 'none' && <Chip>{GUARDRAIL_LABELS[agent.guardrailMode]}</Chip>}
      {agent.handoffEnabled && <Chip>Handoff</Chip>}
      {agent.identityEnabled && <Chip>Identificação</Chip>}
      {agent.structuredOutputEnabled && <Chip>Dados estruturados</Chip>}
    </div>
  )
}
