import { GUARDRAIL_LABELS, MEMORY_LABELS } from '../lib/agentLabels'
import type { AgentSummary } from '../lib/types'
import { Badge } from '../ui'

// Quick config facts about an agent, shown on its cards (list, team members,
// agent page header).
export function AgentBadges({ agent }: { agent: AgentSummary }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone="neutral">{agent.provider === 'openai' ? 'OpenAI' : 'Anthropic'}</Badge>
      {agent.model && <Badge tone="neutral">{agent.model}</Badge>}
      {agent.memoryType !== 'none' && <Badge tone="brand">{MEMORY_LABELS[agent.memoryType]}</Badge>}
      {agent.guardrailMode !== 'none' && <Badge tone="warning">{GUARDRAIL_LABELS[agent.guardrailMode]}</Badge>}
      {agent.handoffEnabled && <Badge tone="creative">Handoff</Badge>}
      {agent.identityEnabled && <Badge tone="neutral">Identificação</Badge>}
      {agent.structuredOutputEnabled && <Badge tone="success">Dados estruturados</Badge>}
    </div>
  )
}
