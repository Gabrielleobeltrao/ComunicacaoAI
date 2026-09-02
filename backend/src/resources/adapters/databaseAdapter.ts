import { ObjectId } from 'mongodb'
import { listAgents } from '../../agents.js'
import { getDataStore, listDatasets, listDataStores, listGrants } from '../../databases/store.js'
import { resolveDatabaseAccess } from '../../databases/access.js'
import type { DatabaseCapability } from '../../databases/types.js'
import { resolveSubject } from '../scope.js'
import { CAPABILITIES, denied } from '../types.js'
import type {
  ResourceAccessContext,
  ResourceAccessDecision,
  ResourceAdapter,
  ResourceDetail,
  ResourceImpact,
  ResourceListContext,
  ResourceSummary,
} from '../types.js'

// DATABASE no catálogo comum — delegando para a política que já existe.
//
// Mesma regra dos outros adapters: quem decide é `databases/access.ts`, com a precedência
// e o deny que ele implementa. O que este arquivo acrescenta é a forma comum e a
// tradução da origem — para a matriz do agente mostrar "pelo setor" com as mesmas
// palavras que usa para Knowledge.

const resumoDe = (s: Awaited<ReturnType<typeof getDataStore>>): ResourceSummary => ({
  kind: 'database',
  id: s!._id.toString(),
  name: s!.name,
  description: s!.description,
  owner: { ownerType: s!.owner.ownerType, ownerId: s!.owner.ownerId },
  status: s!.status,
  ...(s!.status !== 'active' ? { flags: [s!.status] } : {}),
  updatedAt: s!.updatedAt,
})

export const databaseAdapter: ResourceAdapter = {
  kind: 'database',
  capabilities: () => CAPABILITIES.database,

  async list(ctx: ResourceListContext): Promise<ResourceSummary[]> {
    const stores = await listDataStores(ctx.accountId)
    let lista = stores
    if (ctx.search?.trim()) {
      const alvo = ctx.search.trim().toLowerCase()
      lista = lista.filter((s) => s.name.toLowerCase().includes(alvo) || s.description.toLowerCase().includes(alvo))
    }
    if (ctx.subject && ctx.access === 'available') {
      const sujeito = await resolveSubject(ctx.accountId, ctx.subject)
      if (!sujeito || sujeito.subjectType !== 'agent') return []
      // O que ele CONSEGUE usar passa pela mesma decisão da execução.
      const alcancaveis = []
      for (const s of lista) {
        const d = await resolveDatabaseAccess({ accountId: ctx.accountId, dataStoreId: s._id, agentId: sujeito.subjectId, capability: 'discover' })
        if (d.allowed) alcancaveis.push(s)
      }
      lista = alcancaveis
    }
    const inicio = Math.max(ctx.skip ?? 0, 0)
    return lista.slice(inicio, inicio + Math.min(ctx.limit ?? 100, 300)).map((s) => resumoDe(s))
  },

  async get(accountId: string, resourceId: string): Promise<ResourceDetail | null> {
    if (!ObjectId.isValid(resourceId)) return null
    const store = await getDataStore(accountId, new ObjectId(resourceId))
    if (!store) return null
    const datasets = await listDatasets(accountId, store._id)
    return {
      ...resumoDe(store),
      capabilities: [...CAPABILITIES.database],
      meta: {
        adapterKind: store.adapterKind,
        retention: store.retention,
        datasets: datasets.map((d) => ({ key: d.key, name: d.name, mutability: d.mutability, fields: Object.keys((d.schema.properties ?? {}) as object).length })),
        // A configuração é só referência — segredo é recusado na escrita.
        adapterConfig: store.adapterConfig,
      },
    }
  },

  async resolveAccess(ctx: ResourceAccessContext): Promise<ResourceAccessDecision> {
    if (!ObjectId.isValid(ctx.resourceId)) return denied()
    const d = await resolveDatabaseAccess({
      accountId: ctx.accountId,
      dataStoreId: new ObjectId(ctx.resourceId),
      agentId: ctx.actorAgentId ?? null,
      capability: (ctx.requestedCapability as DatabaseCapability | null) ?? null,
    })
    return { allowed: d.allowed, capabilities: d.capabilities, origin: d.origin, reason: d.reason }
  },

  async impact(accountId: string, resourceId: string): Promise<ResourceImpact | null> {
    if (!ObjectId.isValid(resourceId)) return null
    const id = new ObjectId(resourceId)
    const store = await getDataStore(accountId, id)
    if (!store) return null
    const [datasets, grants, agentes] = await Promise.all([listDatasets(accountId, id), listGrants(accountId, id), listAgents(accountId)])

    const comAcesso: ResourceImpact['accessibleBy'] = []
    for (const a of agentes) {
      const d = await resolveDatabaseAccess({ accountId, dataStoreId: id, agentId: a._id, capability: 'query' })
      if (d.allowed) comAcesso.push({ subjectType: 'agent', subjectId: a._id.toString(), name: a.name })
    }

    return {
      resource: { kind: 'database', id: resourceId },
      accessibleBy: comAcesso,
      // "Quem consultou" sai do log de consultas, que é outra pergunta e outro prazo.
      usedBy: [],
      usedCount: 0,
      dependents: [
        ...datasets.map((d) => ({ kind: 'dataset', id: d.key, name: d.name, reason: 'dataset deste database' })),
        ...grants.map((g) => ({ kind: 'grant', id: g._id.toString(), name: `${g.subjectType}`, reason: 'acesso concedido a este sujeito' })),
      ],
      recommendation: comAcesso.length > 0 || datasets.length > 0 ? 'prefer_archive' : 'safe_to_delete',
    }
  },
}
