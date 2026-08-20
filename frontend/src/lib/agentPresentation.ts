import { papelDe } from './agentRoles'
import { MEMORY_LABELS } from './agentLabels'
import type { AgentSummary } from './types'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// A short "role" line for an agent — its model, or the provider as a fallback.
/**
 * A FUNÇÃO do agente — o que ele é, não em que motor ele roda.
 *
 * Isto devolvia o modelo (ou o nome do provedor), e a tela mostrava "Função: Anthropic".
 * Provedor não é função: quem abre a visão geral quer saber o que o agente faz na
 * operação, e "Anthropic" não responde nada disso. O modelo continua visível, na linha
 * dele.
 *
 * A frase escrita pelo dono manda; sem ela, o cargo do tipo escolhido na contratação.
 */
export function roleLabelOf(agent: AgentSummary): string {
  const escrita = (agent.role ?? '').trim()
  if (escrita) return escrita.slice(0, 120)
  return papelDe(agent.preset)?.cargo ?? '—'
}

/** Em que motor ele roda. Era isto que aparecia como "Função". */
export function modelLabelOf(agent: AgentSummary): string {
  return agent.model || `${agent.provider === 'openai' ? 'OpenAI' : 'Anthropic'} · padrão do sistema`
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
