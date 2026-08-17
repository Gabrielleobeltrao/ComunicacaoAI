import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { ValidationError } from '../building.js'
import { getAgentById, updateAgent } from '../agents.js'
import { getApp } from '../apps/registry.js'
import { resolveAppForOwner } from '../apps/privateApps.js'
import { getInstallation } from '../apps/installations.js'
import type { AgentAppGrant } from '../apps/types.js'
import { auditEntity } from './auditMiddleware.js'
import { fail, notFound, oid } from './http.js'

// A grant is the permission itself: which installation, which actions, and which of
// those may run without being asked. Validated against the manifest, replaced
// atomically, and never allowed to carry a credential into the agent document.

// --- permissões do agente --------------------------------------------------------

export const appGrantRouter = Router({ mergeParams: true })

const grantPublic = (g: AgentAppGrant) => ({
  installationId: g.installationId,
  appKey: g.appKey,
  actionKeys: g.actionKeys,
  resourceConfig: g.resourceConfig,
  autonomousWriteActionKeys: g.autonomousWriteActionKeys,
})

appGrantRouter.get('/app-grants', async (req, res) => {
  const agentId = oid(String((req.params as Record<string, string>).agentId))
  if (!agentId) return notFound(res)
  const agent = await getAgentById(res.locals.userId, agentId)
  if (!agent) return notFound(res)
  res.json((agent.appGrants ?? []).map(grantPublic))
})

/**
 * As ações que este agente pode de fato executar, com nome e risco.
 *
 * Existe para o formulário de Rotinas/Gatilhos poder oferecer SOMENTE App conectado e
 * ação concedida. Oferecer o catálogo inteiro ali levaria o dono a montar um fluxo que
 * falha na primeira execução — e a mensagem de recusa chegaria horas depois, no
 * histórico.
 *
 * Instalação ausente ou inutilizável derruba o App da lista: sem conexão não há o que
 * executar, e mostrar a ação seria prometer o que não acontece.
 */
appGrantRouter.get('/app-actions', async (req, res) => {
  const agentId = oid(String((req.params as Record<string, string>).agentId))
  if (!agentId) return notFound(res)
  const agent = await getAgentById(res.locals.userId, agentId)
  if (!agent) return notFound(res)

  const saida: {
    appKey: string
    appName: string
    actionKey: string
    actionName: string
    risk: string
    autonomous: boolean
  }[] = []

  for (const grant of agent.appGrants ?? []) {
    const app = await resolveAppForOwner(res.locals.userId, grant.appKey)
    if (!app) continue
    const id = ObjectId.isValid(grant.installationId) ? new ObjectId(grant.installationId) : null
    const installation = id ? await getInstallation(res.locals.userId, id) : null
    // App que exige conexão e não tem uma utilizável não entra na lista.
    if (app.auth?.kind !== 'none' && !installation) continue

    const autonomas = new Set(grant.autonomousWriteActionKeys ?? [])
    for (const action of app.actions) {
      if (!(grant.actionKeys ?? []).includes(action.key)) continue
      saida.push({
        appKey: app.key,
        appName: app.name,
        actionKey: action.key,
        actionName: action.name,
        risk: action.risk,
        // Ação de escrita sem autorização autônoma seria recusada em execução
        // automática; a interface precisa poder avisar antes.
        autonomous: action.risk === 'read' || autonomas.has(action.key),
      })
    }
  }

  res.json(saida)
})

// The whole permission set is replaced atomically: a partial write is what turns an
// "I removed that action" into an agent that still has it.
appGrantRouter.patch('/app-grants', async (req, res, next) => {
  const agentId = oid(String((req.params as Record<string, string>).agentId))
  if (!agentId) return notFound(res)
  try {
    const agent = await getAgentById(res.locals.userId, agentId)
    if (!agent) return notFound(res)
    const raw = (req.body ?? {}) as { grants?: unknown }
    if (!Array.isArray(raw.grants)) throw new ValidationError('grants deve ser uma lista')

    const grants: AgentAppGrant[] = []
    const seen = new Set<string>()
    for (const entry of raw.grants) {
      const grant = await validateGrant(res.locals.userId, entry)
      if (seen.has(grant.installationId)) throw new ValidationError('conexão repetida')
      seen.add(grant.installationId)
      grants.push(grant)
    }

    const updated = await updateAgent(res.locals.userId, agentId, { appGrants: grants })
    if (!updated) return notFound(res)
    auditEntity(res, { id: agentId.toString(), label: agent.name })
    res.json(grants.map(grantPublic))
  } catch (error) {
    fail(res, error, next)
  }
})

async function validateGrant(ownerId: string, input: unknown): Promise<AgentAppGrant> {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const installationId = String(o.installationId ?? '')
  if (!ObjectId.isValid(installationId)) throw new ValidationError('conexão inválida')

  // Resolved with the owner in the query: an id from another account is simply absent.
  const installation = await getInstallation(ownerId, new ObjectId(installationId))
  if (!installation) throw new ValidationError('conexão não encontrada')
  // Owner-scoped: a private App's actions are grantable, and another account's App
  // simply does not resolve here.
  const app = await resolveAppForOwner(ownerId, installation.appKey)
  if (!app) throw new ValidationError('App desconhecido')

  const known = new Set(app.actions.map((a) => a.key))
  const actionKeys = [...new Set((Array.isArray(o.actionKeys) ? o.actionKeys : []).map((k) => String(k)))]
  for (const key of actionKeys) if (!known.has(key)) throw new ValidationError(`ação desconhecida: ${key}`)

  // A write can only be authorised among the actions actually granted, and only for
  // an action that really writes.
  const autonomous = [...new Set((Array.isArray(o.autonomousWriteActionKeys) ? o.autonomousWriteActionKeys : []).map((k) => String(k)))]
  for (const key of autonomous) {
    if (!actionKeys.includes(key)) throw new ValidationError(`ação não concedida: ${key}`)
    const action = app.actions.find((a) => a.key === key)
    if (action?.risk === 'read') throw new ValidationError(`ação de leitura não precisa de autorização: ${key}`)
  }

  // Only non-secret resource keys the manifest declares survive: this is where a
  // client could otherwise smuggle a credential into a document that is not encrypted.
  const declared = new Set(app.actions.flatMap((a) => (a.resourceFields ?? []).map((f) => f.key)))
  const secretKeys = new Set((app.auth.fields ?? []).filter((f) => f.secret).map((f) => f.key))
  const rawResource = (typeof o.resourceConfig === 'object' && o.resourceConfig !== null ? o.resourceConfig : {}) as Record<string, unknown>
  const resourceConfig: Record<string, string> = {}
  for (const [key, value] of Object.entries(rawResource)) {
    if (secretKeys.has(key)) throw new ValidationError('credencial não pode ser salva no agente')
    if (!declared.has(key)) continue
    const text = String(value ?? '').trim()
    if (text.length > 200) throw new ValidationError(`valor muito longo em ${key}`)
    if (text) resourceConfig[key] = text
  }
  for (const action of app.actions.filter((a) => actionKeys.includes(a.key))) {
    for (const field of action.resourceFields ?? []) {
      if (field.required && !resourceConfig[field.key]) throw new ValidationError(`${action.name}: "${field.label}" é obrigatório.`)
    }
  }

  return { installationId, appKey: installation.appKey, actionKeys, resourceConfig, autonomousWriteActionKeys: autonomous }
}
