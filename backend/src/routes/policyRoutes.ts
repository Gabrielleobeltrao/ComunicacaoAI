import { Router } from 'express'
import { activePolicyFor, listPolicies, normalizeRules, policyHistory, PolicyFieldError, policyPublic, savePolicy } from '../policies/repository.js'
import { getInstallation } from '../apps/installations.js'
import { getAgentById } from '../agents.js'
import { ValidationError } from '../building.js'
import { fail, oid } from './http.js'

// As políticas de negociação. Só regras entram e saem daqui — nenhum valor da conta,
// nenhum dado da corretora, nenhuma credencial.
export const policyRouter = Router()

const escopoDe = (body: Record<string, unknown>) => ({
  installationId: typeof body.installationId === 'string' && body.installationId.trim() ? body.installationId.trim() : null,
  agentId: typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : null,
})

/**
 * A conexão e o agente são MESMO desta conta?
 *
 * Sem esta conferência, alguém podia gravar uma política apontando para a instalação de
 * outra pessoa. A política em si não vazaria nada — mas ficaria pendurada num escopo
 * que o dono não controla, e um dia valeria para alguém que nunca a configurou.
 */
async function conferirEscopo(ownerId: string, escopo: { installationId: string | null; agentId: string | null }): Promise<void> {
  if (escopo.installationId) {
    const id = oid(escopo.installationId)
    if (!id || !(await getInstallation(ownerId, id))) throw new ValidationError('conexão não encontrada nesta conta')
  }
  if (escopo.agentId) {
    const id = oid(escopo.agentId)
    if (!id || !(await getAgentById(ownerId, id))) throw new ValidationError('agente não encontrado nesta conta')
  }
}

policyRouter.get('/', async (req, res) => {
  res.json((await listPolicies(res.locals.userId)).map(policyPublic))
})

// O que VALE agora para uma conexão (e opcionalmente um agente). É o que a tela mostra
// antes de alguém autorizar uma ação crítica.
policyRouter.get('/active', async (req, res) => {
  const installationId = typeof req.query.installationId === 'string' && req.query.installationId ? req.query.installationId : null
  const agentId = typeof req.query.agentId === 'string' && req.query.agentId ? req.query.agentId : null
  const policy = await activePolicyFor({ ownerId: res.locals.userId, installationId, agentId })
  res.json(policy ? policyPublic(policy) : null)
})

policyRouter.get('/history', async (req, res) => {
  const installationId = typeof req.query.installationId === 'string' && req.query.installationId ? req.query.installationId : null
  const agentId = typeof req.query.agentId === 'string' && req.query.agentId ? req.query.agentId : null
  res.json((await policyHistory(res.locals.userId, installationId, agentId)).map(policyPublic))
})

// Salvar cria uma VERSÃO nova; a anterior fica no histórico.
policyRouter.post('/', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const escopo = escopoDe(body)
    await conferirEscopo(res.locals.userId, escopo)
    const policy = await savePolicy({ ownerId: res.locals.userId, ...escopo }, normalizeRules(body.rules))
    res.status(201).json(policyPublic(policy))
  } catch (error) {
    // Um erro de campo diz QUAL campo: com doze limites no formulário, "valor inválido"
    // sozinho obriga a caçar.
    if (error instanceof PolicyFieldError) {
      return res.status(400).json({ code: 'invalid_field', field: error.field, message: error.message })
    }
    fail(res, error, next)
  }
})
