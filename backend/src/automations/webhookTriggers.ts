// Which agents are really reachable by an EVENT (webhook) right now.
//
// An agent is webhook-triggered when a published, active automation with a webhook
// trigger runs it — either because the automation IS its routine (`agentId`) or
// because one of its enabled `agent.execute` steps names it. Anything else (a draft,
// a paused/archived automation, a schedule, a disabled step) does not count, so
// "Evento: configurado" always corresponds to something that can actually fire.
//
// Pure on purpose: the callers supply owner-scoped automations, and every rule here
// is unit-tested without a database.
import type { Automation, AutomationDefinition } from './types.js'

// What RUNS is the last published version, never the draft. An automation whose
// draft was edited but not republished keeps behaving — and therefore keeps being
// reported — exactly as it was published.
export interface PublishedAutomation {
  automation: Pick<Automation, 'agentId' | 'trigger' | 'draftDefinition' | 'status' | 'lastPublishedVersion'>
  // The definition of `lastPublishedVersion`; absent when nothing was published.
  published: AutomationDefinition | null
}

// The definition to reason about: the published one. The draft is only a fallback
// for legacy documents whose version rows were never written.
const liveDefinition = (p: PublishedAutomation): AutomationDefinition | undefined => p.published ?? undefined

/**
 * Um gatilho por EVENTO que está mesmo de pé.
 *
 * "Evento" são dois: o webhook, que ouve de fora, e o `internal_event`, que ouve o
 * barramento. Para o dono é a mesma coisa — algo acontece e o agente reage — e a
 * permissão de ativação é a mesma. Contar só o webhook faria a página do agente dizer
 * "Evento: desligado" para um gatilho de mercado que dispara a cada vela.
 */
export function isLiveWebhook(p: PublishedAutomation): boolean {
  const { automation } = p
  if (automation.status !== 'active' || automation.lastPublishedVersion == null) return false
  const def = liveDefinition(p)
  // No published definition on record → fall back to the automation's own trigger,
  // which is what older documents carry.
  const tipo = def?.trigger?.type ?? automation.trigger?.type
  return tipo === 'webhook' || tipo === 'internal_event'
}

// Every agent this ONE automation would run, according to its PUBLISHED definition.
export function agentsReferencedBy(p: PublishedAutomation): string[] {
  const ids = new Set<string>()
  if (p.automation.agentId) ids.add(p.automation.agentId.toString())
  const def = liveDefinition(p) ?? p.automation.draftDefinition
  for (const step of def?.steps ?? []) {
    if (step.type !== 'agent.execute' || step.enabled === false) continue
    const id = step.config?.agentId
    if (typeof id === 'string' && id) ids.add(id)
  }
  return [...ids]
}

// agentId -> how many live webhooks fire it. The count matters: removing ONE webhook
// must not take the 'event' permission away while another is still active.
export function liveWebhookCountByAgent(automations: PublishedAutomation[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of automations) {
    if (!isLiveWebhook(a)) continue
    for (const id of agentsReferencedBy(a)) out.set(id, (out.get(id) ?? 0) + 1)
  }
  return out
}

export const liveWebhookCountFor = (automations: PublishedAutomation[], agentId: string): number =>
  liveWebhookCountByAgent(automations).get(agentId) ?? 0
