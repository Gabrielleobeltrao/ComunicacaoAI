import { Router } from 'express'
import { listActivity } from '../activity/timeline.js'
import type { ActivityQuery } from '../activity/timeline.js'

// A rota da Atividade — leitura, e só.
//
// Não existe POST aqui de propósito: a linha do tempo é uma PROJEÇÃO do que aconteceu.
// Um endpoint que escrevesse nela criaria uma verdade paralela ao histórico que ela lê.

export const activityRouter = Router()

const naData = (v: unknown): Date | undefined => {
  const d = new Date(String(v ?? ''))
  return Number.isNaN(d.getTime()) ? undefined : d
}

activityRouter.get('/', async (req, res) => {
  const q: ActivityQuery = {
    ownerId: res.locals.userId,
    ...(typeof req.query.floorId === 'string' ? { floorId: req.query.floorId } : {}),
    ...(typeof req.query.status === 'string' ? { status: req.query.status as ActivityQuery['status'] } : {}),
    ...(typeof req.query.source === 'string' ? { source: req.query.source as ActivityQuery['source'] } : {}),
    // Os recortes que ligam a linha do tempo ao resto: qual monitor pediu, qual operação
    // rodou, quem apareceu nela.
    ...(typeof req.query.monitorId === 'string' ? { monitorId: req.query.monitorId } : {}),
    ...(typeof req.query.flowId === 'string' ? { flowId: req.query.flowId } : {}),
    ...(typeof req.query.agentId === 'string' ? { agentId: req.query.agentId } : {}),
    ...(typeof req.query.sectorId === 'string' ? { sectorId: req.query.sectorId } : {}),
    ...(req.query.limit ? { limit: Number(req.query.limit) } : {}),
    ...(naData(req.query.before) ? { before: naData(req.query.before) } : {}),
  }
  res.json(await listActivity(q))
})
