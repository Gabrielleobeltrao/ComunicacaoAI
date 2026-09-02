import { Router } from 'express'
import { ObjectId } from 'mongodb'
import {
  MONITOR_EVENT_TYPES,
  MonitorError,
  createMonitor,
  deleteMonitor,
  describeMonitors,
  publishMonitor,
  setMonitorStatus,
  updateMonitor,
} from '../monitors/service.js'
import { COMPARISON_OPS, TRIGGER_MODES } from '../monitors/condition.js'
import { getState } from '../monitors/state.js'
import { notFound, oid } from './http.js'

// AS ROTAS de monitor — e a separação entre salvar e publicar mora aqui também.
//
// `PUT` sempre grava rascunho; publicar é um `POST` próprio. Não é cerimônia: um monitor
// age sozinho, e uma edição pela metade não pode virar comportamento em produção no
// instante em que alguém aperta salvar.

export const monitorRouter = Router()

// A flag NEGA de verdade: `MONITORS_ENABLED=0` responde 404, e não esconde o botão. Uma
// flag cosmética deixa a rota aberta para quem souber o caminho — que é exatamente quem
// não deveria entrar.
monitorRouter.use((_req, res, next) => {
  if (process.env.MONITORS_ENABLED === '0') {
    res.status(404).json({ code: 'not_found', message: 'not found' })
    return
  }
  next()
})

const recusa = (res: Parameters<typeof notFound>[0], erro: unknown): boolean => {
  if (erro instanceof MonitorError) {
    res.status(erro.code === 'not_found' ? 404 : 400).json({ code: erro.code, message: erro.message, error: erro.message })
    return true
  }
  return false
}

/** O vocabulário fechado que a tela precisa para montar o construtor. */
monitorRouter.get('/meta', (_req, res) => {
  res.json({ eventTypes: MONITOR_EVENT_TYPES, triggerModes: TRIGGER_MODES, operators: COMPARISON_OPS })
})

monitorRouter.get('/', async (_req, res) => {
  res.json(await describeMonitors(res.locals.userId))
})

monitorRouter.post('/', async (req, res, next) => {
  try {
    const m = await createMonitor(res.locals.userId, req.body ?? {})
    res.status(201).json({ id: m._id.toString(), status: m.status })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

monitorRouter.put('/:id', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  try {
    const m = await updateMonitor(res.locals.userId, id, req.body ?? {})
    if (!m) return notFound(res)
    res.json({ id: m._id.toString(), status: m.status })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

monitorRouter.post('/:id/publish', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  try {
    const m = await publishMonitor(res.locals.userId, id)
    if (!m) return notFound(res)
    res.json({ id: m._id.toString(), status: m.status })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

monitorRouter.post('/:id/pause', async (req, res, next) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  try {
    const m = await setMonitorStatus(res.locals.userId, id, 'paused')
    if (!m) return notFound(res)
    res.json({ id: m._id.toString(), status: m.status })
  } catch (erro) {
    if (!recusa(res, erro)) next(erro as Error)
  }
})

monitorRouter.get('/:id/state', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  const estado = await getState(res.locals.userId, id)
  // Estado ausente é resposta legítima: o monitor ainda não observou nada.
  res.json(
    estado
      ? {
          status: estado.status,
          conditionIsTrue: estado.conditionIsTrue,
          lastObservedAt: estado.lastObservedAt,
          lastTriggeredAt: estado.lastTriggeredAt,
          cooldownUntil: estado.cooldownUntil,
          error: estado.error,
        }
      : null,
  )
})

monitorRouter.delete('/:id', async (req, res) => {
  const id = oid(String(req.params.id))
  if (!id) return notFound(res)
  if (!(await deleteMonitor(res.locals.userId, id))) return notFound(res)
  res.status(204).end()
})
