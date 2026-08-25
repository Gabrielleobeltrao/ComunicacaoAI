import { Router } from 'express'
import { activePolicyFor, listPolicies, normalizeRules, policyHistory, policyPublic, savePolicy } from '../policies/repository.js'
import { fail } from './http.js'

// As políticas de negociação. Só regras entram e saem daqui — nenhum valor da conta,
// nenhum dado da corretora, nenhuma credencial.
export const policyRouter = Router()

const escopoDe = (body: Record<string, unknown>) => ({
  installationId: typeof body.installationId === 'string' && body.installationId.trim() ? body.installationId.trim() : null,
  agentId: typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : null,
})

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
    const policy = await savePolicy({ ownerId: res.locals.userId, ...escopoDe(body) }, normalizeRules(body.rules))
    res.status(201).json(policyPublic(policy))
  } catch (error) {
    fail(res, error, next)
  }
})
