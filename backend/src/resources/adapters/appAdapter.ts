import { ObjectId } from 'mongodb'
import { getAgentById } from '../../agents.js'
import { listAppsForOwner, resolveAppForOwner } from '../../apps/privateApps.js'
import { getInstallation, isInstallationUsable, listInstallations } from '../../apps/installations.js'
import { isVersionCompatible } from '../../apps/grants.js'
import { isUsableManifest } from '../../apps/privateApps.js'
import { isUsableApp } from '../../apps/types.js'
import type { AgentAppGrant, AppDefinition } from '../../apps/types.js'
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

// APPS no catálogo comum — sem afrouxar um único gate.
//
// Um App só executa quando TRÊS coisas valem ao mesmo tempo: existe uma instalação
// utilizável, a ação está concedida àquele agente, e — quando a ação escreve — a execução
// autônoma foi autorizada para ela. São três decisões distintas de propósito: instalar não
// é conceder, e conceder leitura não é conceder escrita.
//
// Aqui elas continuam intactas. O que este adapter faz é RELATAR o resultado, com a
// pendência acionável quando ela existe — conexão pausada, versão incompatível ou App
// marcado como "em breve" aparecem como pendência, e não como acesso funcional.

/** O recurso é o App; a instalação é o que o torna utilizável. Os dois são coisas diferentes. */
const resumoDe = (app: AppDefinition, instalacoes: number): ResourceSummary => ({
  kind: 'app',
  id: app.key,
  name: app.name,
  description: app.description,
  owner: { ownerType: app.source === 'system' ? 'platform' : 'account', ownerId: app.source === 'system' ? 'platform' : 'account' },
  status: instalacoes > 0 ? 'connected' : 'not_connected',
  ...(instalacoes === 0 ? { flags: ['not_connected'] } : {}),
})

export const appAdapter: ResourceAdapter = {
  kind: 'app',
  capabilities: () => CAPABILITIES.app,

  async list(ctx: ResourceListContext): Promise<ResourceSummary[]> {
    const apps = await listAppsForOwner(ctx.accountId)
    const instalacoes = await listInstallations(ctx.accountId)
    const porApp = new Map<string, number>()
    for (const i of instalacoes) porApp.set(i.appKey, (porApp.get(i.appKey) ?? 0) + 1)

    let lista = apps.filter(isUsableManifest)
    if (ctx.search?.trim()) {
      const alvo = ctx.search.trim().toLowerCase()
      lista = lista.filter((a) => a.name.toLowerCase().includes(alvo) || a.key.toLowerCase().includes(alvo))
    }

    if (ctx.subject && ctx.access === 'available') {
      const sujeito = await resolveSubject(ctx.accountId, ctx.subject)
      if (!sujeito || sujeito.subjectType !== 'agent') return []
      const agente = await getAgentById(ctx.accountId, sujeito.subjectId)
      if (!agente) return []
      // O que ele CONSEGUE usar são os Apps de que ele tem grant — e só eles.
      const concedidos = new Set((agente.appGrants ?? []).map((g) => g.appKey))
      lista = lista.filter((a) => concedidos.has(a.key))
    }

    return lista.slice(Math.max(ctx.skip ?? 0, 0), Math.max(ctx.skip ?? 0, 0) + Math.min(ctx.limit ?? 100, 300)).map((a) => resumoDe(a, porApp.get(a.key) ?? 0))
  },

  async get(accountId: string, resourceId: string): Promise<ResourceDetail | null> {
    const app = await resolveAppForOwner(accountId, resourceId)
    if (!app || !isUsableManifest(app)) return null
    const instalacoes = await listInstallations(accountId, app.key)
    return {
      ...resumoDe(app, instalacoes.length),
      capabilities: [...CAPABILITIES.app],
      meta: {
        version: app.version,
        source: app.source,
        // As ações com o RISCO declarado pelo manifesto — a fonte única desse dado.
        actions: app.actions.map((a) => ({ key: a.key, name: a.name, risk: a.risk })),
        allowedDomains: app.allowedDomains,
        installations: instalacoes.map((i) => ({ id: i._id.toString(), name: i.name, status: i.status, environment: i.environment ?? 'default' })),
      },
    }
  },

  async resolveAccess(ctx: ResourceAccessContext): Promise<ResourceAccessDecision> {
    const app = await resolveAppForOwner(ctx.accountId, ctx.resourceId)
    if (!app || !isUsableManifest(app)) return denied()

    if (!ctx.actorAgentId) {
      return { allowed: true, capabilities: [...CAPABILITIES.app], origin: 'owner', reason: 'você administra os Apps desta conta' }
    }
    const agente = await getAgentById(ctx.accountId, ctx.actorAgentId)
    if (!agente) return denied()

    const grant = (agente.appGrants ?? []).find((g: AgentAppGrant) => g.appKey === app.key)
    if (!grant || (grant.actionKeys ?? []).length === 0) {
      return { allowed: false, capabilities: [], origin: 'none', reason: 'este agente não tem nenhuma ação concedida deste App' }
    }

    // App "em breve" não executa nem com grant — e a recusa precisa dizer isso.
    if (!isUsableApp(app)) {
      return {
        allowed: false,
        capabilities: ['discover'],
        origin: 'direct',
        reason: `${app.name} aparece no catálogo como "Em breve"`,
        pending: { code: 'app_em_breve', message: `${app.name} ainda não está disponível.` },
      }
    }

    const id = ObjectId.isValid(grant.installationId) ? new ObjectId(grant.installationId) : null
    const instalacao = id ? await getInstallation(ctx.accountId, id) : null
    if (!instalacao) {
      return {
        allowed: false,
        capabilities: ['discover'],
        origin: 'direct',
        reason: 'o grant aponta para uma conexão que não existe mais',
        pending: { code: 'conexao_ausente', message: `Conecte o App ${app.name} e autorize este agente.` },
      }
    }
    if (!isInstallationUsable(instalacao)) {
      return {
        allowed: false,
        capabilities: ['discover'],
        origin: 'direct',
        reason: `a conexão "${instalacao.name}" precisa ser reconectada`,
        pending: { code: instalacao.status === 'needs_reauth' ? 'conexao_expirada' : 'conexao_revogada', message: `Reconecte "${instalacao.name}" em Apps.` },
      }
    }
    if (!isVersionCompatible(instalacao.appVersion, app.version)) {
      return {
        allowed: false,
        capabilities: ['discover'],
        origin: 'direct',
        reason: 'a conexão precisa ser revisada por causa de uma versão nova do App',
        pending: { code: 'versao_incompativel', message: `Revise a conexão "${instalacao.name}" em Apps.` },
      }
    }

    /**
     * As ações efetivas, com a regra de escrita preservada: uma ação que MUDA algo do
     * outro lado só roda por iniciativa do agente quando ela está na lista de escrita
     * autônoma. Ler é uma decisão; agir é outra.
     */
    const autonomas = new Set(grant.autonomousWriteActionKeys ?? [])
    const concedidas = app.actions.filter((a) => grant.actionKeys.includes(a.key))
    const executaveis = concedidas.filter((a) => a.risk === 'read' || autonomas.has(a.key))
    return {
      allowed: executaveis.length > 0,
      capabilities: executaveis.length > 0 ? ['discover', 'execute'] : ['discover'],
      origin: 'direct',
      reason:
        executaveis.length > 0
          ? `${executaveis.length} de ${concedidas.length} ação(ões) concedida(s) podem ser executadas por conta própria`
          : 'as ações concedidas escrevem, e nenhuma delas tem execução autônoma autorizada',
      ...(executaveis.length < concedidas.length
        ? { pending: { code: 'escrita_nao_autorizada', message: 'Algumas ações concedidas exigem autorização de escrita autônoma.' } }
        : {}),
    }
  },

  async impact(accountId: string, resourceId: string): Promise<ResourceImpact | null> {
    const app = await resolveAppForOwner(accountId, resourceId)
    if (!app) return null
    const { listAgents } = await import('../../agents.js')
    const agentes = await listAgents(accountId)
    const comGrant = agentes.filter((a) => (a.appGrants ?? []).some((g) => g.appKey === app.key))
    const instalacoes = await listInstallations(accountId, app.key)
    return {
      resource: { kind: 'app', id: app.key },
      accessibleBy: comGrant.map((a) => ({ subjectType: 'agent' as const, subjectId: a._id.toString(), name: a.name })),
      // Uso real de App vem do log de ações, que é outro subsistema; aqui não se inventa.
      usedBy: [],
      usedCount: 0,
      dependents: instalacoes.map((i) => ({ kind: 'installation', id: i._id.toString(), name: i.name, reason: 'conexão desta conta usa este App' })),
      recommendation: comGrant.length > 0 || instalacoes.length > 0 ? 'prefer_archive' : 'safe_to_delete',
    }
  },
}
