import { Router } from 'express'
import { db } from '../db.js'
import { getAgentById } from '../agents.js'
import { KnowledgeAccessError, hasStoredPolicy, parseKnowledgeAccess, policyOf, resolveKnowledgeOwnersForExecution } from '../knowledgeAccess.js'
import { oid, notFound } from './http.js'

// "O que este agente pode ler" — declarado pelo dono, validado pelo servidor.
//
// Montado em /api/agents/:agentId. O agente de outra conta responde 404 como sempre: a
// recusa não muda de forma por causa de um recurso novo.

export const knowledgeAccessRouter = Router({ mergeParams: true })

const publico = (agent: Parameters<typeof policyOf>[0] & { _id: unknown }) => {
  const p = policyOf(agent)
  return {
    own: p.own,
    building: p.building,
    floor: p.floor,
    sectorMode: p.sectorMode,
    selectedSectorIds: p.selectedSectorIds.map((id) => id.toString()),
    version: p.version,
    /**
     * A política está SALVA, ou é a de sempre?
     *
     * A tela precisa saber a diferença: dizer "configurado" sobre um padrão faria o dono
     * acreditar que escolheu o que nunca escolheu — e a próxima mudança de default o
     * pegaria de surpresa.
     */
    configured: hasStoredPolicy(agent),
  }
}

knowledgeAccessRouter.get('/knowledge-access', async (req, res) => {
  const agentId = oid(String((req.params as Record<string, string>).agentId))
  if (!agentId) return notFound(res)
  const agent = await getAgentById(res.locals.userId, agentId)
  if (!agent) return notFound(res)
  res.json(publico(agent))
})

knowledgeAccessRouter.put('/knowledge-access', async (req, res, next) => {
  const agentId = oid(String((req.params as Record<string, string>).agentId))
  if (!agentId) return notFound(res)
  const agent = await getAgentById(res.locals.userId, agentId)
  if (!agent) return notFound(res)
  try {
    const politica = await parseKnowledgeAccess(res.locals.userId, req.body)
    // Gravada no agente, explicitamente. A partir daqui ele deixa de seguir o padrão —
    // e é isso que `configured` passa a dizer.
    await db.collection('agents').updateOne({ _id: agent._id, ownerId: res.locals.userId }, { $set: { knowledgeAccess: politica, updatedAt: new Date() } })
    const atualizado = await getAgentById(res.locals.userId, agentId)
    res.json(publico(atualizado!))
  } catch (erro) {
    if (erro instanceof KnowledgeAccessError) {
      res.status(400).json({ code: 'invalid', message: erro.message, error: erro.message })
      return
    }
    next(erro as Error)
  }
})

/**
 * O que ele leria AGORA — a política resolvida em bases reais.
 *
 * Existe porque uma política é um conjunto de regras, e regra não se confere lendo: o
 * dono precisa ver que "andar" virou o andar dele, com nome, e que o setor que ele
 * escolheu e apagou simplesmente não está mais na lista.
 */
knowledgeAccessRouter.get('/knowledge-access/resolved', async (req, res) => {
  const agentId = oid(String((req.params as Record<string, string>).agentId))
  if (!agentId) return notFound(res)
  const agent = await getAgentById(res.locals.userId, agentId)
  if (!agent) return notFound(res)

  const r = await resolveKnowledgeOwnersForExecution(res.locals.userId, agent)
  const nomes = await nomesDe(res.locals.userId, r.owners)
  res.json({
    policy: publico(agent),
    owners: r.owners.map((o) => ({
      ownerType: o.ownerType,
      ownerId: o.ownerId.toString(),
      reason: o.reason,
      name: nomes.get(`${o.ownerType}:${o.ownerId.toString()}`) ?? null,
    })),
  })
})

/** O nome de cada base, para a tela falar de coisas e não de ids. */
async function nomesDe(accountId: string, owners: { ownerType: string; ownerId: { toString(): string } }[]): Promise<Map<string, string>> {
  const COLECAO: Record<string, string> = { agent: 'agents', sector: 'sectors', floor: 'offices', building: 'buildings' }
  const fora = new Map<string, string>()
  for (const [tipo, colecao] of Object.entries(COLECAO)) {
    const ids = owners.filter((o) => o.ownerType === tipo).map((o) => o.ownerId)
    if (ids.length === 0) continue
    // Owner-scoped: o nome só sai se o recurso for desta conta.
    const docs = await db.collection(colecao).find({ _id: { $in: ids as never[] }, ownerId: accountId }, { projection: { name: 1 } }).toArray()
    for (const d of docs) fora.set(`${tipo}:${d._id.toString()}`, String(d.name ?? ''))
  }
  return fora
}
