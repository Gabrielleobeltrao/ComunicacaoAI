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
import type { Automation } from './types.js'

// The live trigger is the top-level one; the draft is the fallback for documents
// written before it was mirrored there.
const triggerType = (a: Pick<Automation, 'trigger' | 'draftDefinition'>) => a.trigger?.type ?? a.draftDefinition?.trigger?.type

export function isLiveWebhook(a: Pick<Automation, 'trigger' | 'draftDefinition' | 'status' | 'lastPublishedVersion'>): boolean {
  return triggerType(a) === 'webhook' && a.status === 'active' && a.lastPublishedVersion != null
}

// Every agent this ONE automation would run.
export function agentsReferencedBy(a: Pick<Automation, 'agentId' | 'draftDefinition'>): string[] {
  const ids = new Set<string>()
  if (a.agentId) ids.add(a.agentId.toString())
  for (const step of a.draftDefinition?.steps ?? []) {
    if (step.type !== 'agent.execute' || step.enabled === false) continue
    const id = step.config?.agentId
    if (typeof id === 'string' && id) ids.add(id)
  }
  return [...ids]
}

// agentId -> how many live webhooks fire it. The count matters: removing ONE webhook
// must not take the 'event' permission away while another is still active.
export function liveWebhookCountByAgent(automations: Pick<Automation, 'agentId' | 'draftDefinition' | 'trigger' | 'status' | 'lastPublishedVersion'>[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of automations) {
    if (!isLiveWebhook(a)) continue
    for (const id of agentsReferencedBy(a)) out.set(id, (out.get(id) ?? 0) + 1)
  }
  return out
}

export const liveWebhookCountFor = (automations: Parameters<typeof liveWebhookCountByAgent>[0], agentId: string): number =>
  liveWebhookCountByAgent(automations).get(agentId) ?? 0
