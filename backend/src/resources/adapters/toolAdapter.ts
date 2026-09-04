import { ObjectId } from 'mongodb'
import { getAgentById, listAgents } from '../../agents.js'
import { getTool, listTools } from '../../tools.js'
import type { Tool } from '../../tools.js'
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

// TOOLS no catálogo comum.
//
// A regra que se preserva: um agente chama SOMENTE as ferramentas atribuídas a ele, e
// somente enquanto a ferramenta está habilitada. Atribuição é a permissão — não existe
// "todas as ferramentas da conta" para nenhum agente.
//
// Uma ferramenta que MUDA algo do outro lado (POST/PUT/PATCH/DELETE) só roda por
// iniciativa do agente quando a execução autônoma foi autorizada nela. É a mesma
// distinção dos Apps: ler é uma decisão, agir é outra.

const ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const resumoDe = (t: Tool): ResourceSummary => ({
  kind: 'tool',
  id: t._id.toString(),
  name: t.name,
  description: t.description,
  // Ferramenta é da CONTA (do escritório). O dono por andar/setor chega na fase do
  // modelo versionado; inventar um agora seria gravar um dado que ninguém escolheu.
  owner: { ownerType: 'account', ownerId: t.ownerId },
  status: t.enabled ? 'enabled' : 'disabled',
  ...(t.enabled ? {} : { flags: ['disabled'] }),
  updatedAt: t.updatedAt,
})

export const toolAdapter: ResourceAdapter = {
  kind: 'tool',
  capabilities: () => CAPABILITIES.tool,

  async list(ctx: ResourceListContext): Promise<ResourceSummary[]> {
    let lista = await listTools(ctx.accountId)
    if (ctx.search?.trim()) {
      const alvo = ctx.search.trim().toLowerCase()
      lista = lista.filter((t) => t.name.toLowerCase().includes(alvo) || t.description.toLowerCase().includes(alvo))
    }
    if (ctx.subject && ctx.access === 'available') {
      const sujeito = await resolveSubject(ctx.accountId, ctx.subject)
      if (!sujeito || sujeito.subjectType !== 'agent') return []
      const agente = await getAgentById(ctx.accountId, sujeito.subjectId)
      if (!agente) return []
      const atribuidas = new Set(agente.toolIds ?? [])
      lista = lista.filter((t) => atribuidas.has(t._id.toString()))
    }
    const inicio = Math.max(ctx.skip ?? 0, 0)
    return lista.slice(inicio, inicio + Math.min(ctx.limit ?? 100, 300)).map(resumoDe)
  },

  async get(accountId: string, resourceId: string): Promise<ResourceDetail | null> {
    if (!ObjectId.isValid(resourceId)) return null
    const t = await getTool(accountId, new ObjectId(resourceId))
    if (!t) return null
    return {
      ...resumoDe(t),
      capabilities: [...CAPABILITIES.tool],
      meta: {
        method: t.method,
        // O RISCO derivado do método: é o que decide se a execução autônoma é exigida.
        risk: ESCRITA.has(t.method) ? 'write' : 'read',
        // Domínios sim; URL completa não — ela pode carregar caminho e identificador.
        allowedDomains: t.allowedDomains,
        timeoutMs: t.timeoutMs,
        maxCallsPerRun: t.maxCallsPerRun,
        allowAutonomousExecution: t.allowAutonomousExecution,
        usesConnection: Boolean(t.installationId),
        runtimeKind: 'http',
      },
    }
  },

  async resolveAccess(ctx: ResourceAccessContext): Promise<ResourceAccessDecision> {
    if (!ObjectId.isValid(ctx.resourceId)) return denied()
    const t = await getTool(ctx.accountId, new ObjectId(ctx.resourceId))
    if (!t) return denied()

    if (!ctx.actorAgentId) {
      return { allowed: true, capabilities: [...CAPABILITIES.tool], origin: 'owner', reason: 'você administra as ferramentas desta conta' }
    }
    const agente = await getAgentById(ctx.accountId, ctx.actorAgentId)
    if (!agente) return denied()

    if (!(agente.toolIds ?? []).includes(t._id.toString())) {
      return { allowed: false, capabilities: [], origin: 'none', reason: 'esta ferramenta não está atribuída a este agente' }
    }
    if (!t.enabled) {
      return {
        allowed: false,
        capabilities: ['discover'],
        origin: 'direct',
        reason: 'a ferramenta está desligada',
        pending: { code: 'tool_desligada', message: 'Ligue a ferramenta em Ferramentas para o agente poder usá-la.' },
      }
    }
    const escreve = ESCRITA.has(t.method)
    if (escreve && !t.allowAutonomousExecution) {
      return {
        allowed: false,
        capabilities: ['discover'],
        origin: 'direct',
        reason: 'a ferramenta muda algo do outro lado e não tem execução autônoma autorizada',
        pending: { code: 'escrita_nao_autorizada', message: 'Autorize a execução autônoma se quiser que o agente a use por conta própria.' },
      }
    }
    return { allowed: true, capabilities: ['discover', 'execute'], origin: 'direct', reason: 'a ferramenta está atribuída a este agente' }
  },

  async impact(accountId: string, resourceId: string): Promise<ResourceImpact | null> {
    if (!ObjectId.isValid(resourceId)) return null
    const t = await getTool(accountId, new ObjectId(resourceId))
    if (!t) return null
    const agentes = await listAgents(accountId)
    const atribuida = agentes.filter((a) => (a.toolIds ?? []).includes(resourceId))
    return {
      resource: { kind: 'tool', id: resourceId },
      accessibleBy: atribuida.map((a) => ({ subjectType: 'agent' as const, subjectId: a._id.toString(), name: a.name })),
      usedBy: [],
      usedCount: 0,
      dependents: atribuida.map((a) => ({ kind: 'agent', id: a._id.toString(), name: a.name, reason: 'esta ferramenta está atribuída a ele' })),
      recommendation: atribuida.length > 0 ? 'prefer_archive' : 'safe_to_delete',
    }
  },
}
