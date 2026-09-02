import { ObjectId } from 'mongodb'
import { adapterFor, availableKinds } from './registry.js'
import { resolveAgentSubject } from './scope.js'
import { agentCapabilitiesOnly, denied } from './types.js'
import type { ResourceAccessContext, ResourceAccessDecision, ResourceKind } from './types.js'

// A RESOLUÇÃO COMUM de acesso — que delega, e é isso que a torna confiável.
//
// A tentação aqui seria escrever uma regra genérica de herança (agente → setor → andar →
// prédio) e aplicá-la a tudo. Ela produziria respostas plausíveis e erradas: o gate do App
// não é herança, é instalação utilizável mais ação concedida mais autorização de escrita;
// o do Knowledge é uma política com quatro modos de setor. Uma regra genérica por cima
// desses dois só poderia afrouxá-los.
//
// O que é comum é a FORMA da resposta: permitido ou não, com quais capacidades, vindo de
// onde, e por quê — mais a pendência acionável quando existe.

export interface AccessQuery {
  accountId: string
  kind: ResourceKind
  resourceId: string
  actorAgentId?: ObjectId | null
  requestedCapability?: string | null
  executionContext?: { verifiedSectorId?: ObjectId | null } | null
}

export async function resolveResourceAccess(q: AccessQuery): Promise<ResourceAccessDecision> {
  const adapter = adapterFor(q.kind)
  if (!adapter) return denied()

  /**
   * O AGENTE é resolvido contra a conta antes de qualquer coisa.
   *
   * Um `actorAgentId` que chega do cliente é um pedido: sem esta conferência, perguntar
   * "o agente X pode?" com um id de outra conta devolveria a política daquele agente —
   * que já é um vazamento, mesmo sem executar nada.
   */
  if (q.actorAgentId) {
    const sujeito = await resolveAgentSubject(q.accountId, q.actorAgentId)
    if (!sujeito) return denied()
  }

  const ctx: ResourceAccessContext = {
    accountId: q.accountId,
    actorAgentId: q.actorAgentId ?? null,
    resourceId: q.resourceId,
    requestedCapability: q.requestedCapability ?? null,
    executionContext: q.executionContext ?? null,
  }
  const decisao = await adapter.resolveAccess(ctx)

  /**
   * Capacidade ADMINISTRATIVA nunca é de agente.
   *
   * Mesmo que um adapter devolvesse `manage` para um agente — por bug, por grant
   * malformado, por um tipo novo escrito às pressas —, ela é cortada aqui. É a trava que
   * impede "publicar", "editar schema" e "conceder acesso" de virarem ferramenta de LLM
   * por um caminho que ninguém revisou.
   */
  const capacidades = q.actorAgentId ? agentCapabilitiesOnly(q.kind, decisao.capabilities) : decisao.capabilities

  const pedida = q.requestedCapability
  if (pedida && !capacidades.includes(pedida)) {
    return {
      ...decisao,
      allowed: false,
      capabilities: capacidades,
      reason: decisao.allowed ? `a capacidade "${pedida}" não está entre as permitidas aqui` : decisao.reason,
    }
  }
  return { ...decisao, capabilities: capacidades, allowed: decisao.allowed && capacidades.length > 0 }
}

/** A matriz de UM agente: tudo o que ele alcança, com origem e pendência. */
export async function resolveAgentResourceAccess(
  accountId: string,
  agentId: ObjectId,
  opts: { kinds?: ResourceKind[]; limit?: number } = {},
): Promise<{ kind: ResourceKind; resourceId: string; name: string; decision: ResourceAccessDecision }[]> {
  const sujeito = await resolveAgentSubject(accountId, agentId)
  if (!sujeito) return []

  const tipos = (opts.kinds?.length ? opts.kinds : availableKinds()).filter((k) => adapterFor(k))
  const fora: { kind: ResourceKind; resourceId: string; name: string; decision: ResourceAccessDecision }[] = []
  for (const kind of tipos) {
    const adapter = adapterFor(kind)!
    /**
     * Percorre o que EXISTE, e não o que o agente alcança.
     *
     * A diferença importa: a matriz precisa mostrar o recurso NEGADO com o motivo, senão
     * quem configura não descobre por que o agente não usa aquele App — ele simplesmente
     * não estaria na lista.
     */
    const todos = await adapter.list({ accountId, limit: opts.limit ?? 200 })
    for (const item of todos) {
      const decision = await resolveResourceAccess({ accountId, kind, resourceId: item.id, actorAgentId: agentId })
      fora.push({ kind, resourceId: item.id, name: item.name, decision })
    }
  }
  return fora
}
