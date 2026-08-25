import { Router } from 'express'
import { isEventType } from '../events/types.js'
import { listEvents } from '../events/bus.js'
import { listOwnerStreams, pauseStream, reconnectStream, resumeStream, testStreamConnection } from '../streams/service.js'
import { streamManager } from '../streams/manager.js'
import { streamPublic } from '../streams/types.js'
import { fail, notFound, oid } from './http.js'

// O estado dos streams para a tela: onde cada conexão está, quando falou pela última
// vez e o que deu errado. Nenhuma rota daqui devolve credencial nem quadro cru do
// provider — o que sai é estado, contagem e uma frase de erro.
export const streamRouter = Router()

streamRouter.get('/', async (req, res) => {
  const lista = await listOwnerStreams(res.locals.userId)
  const gerente = streamManager()
  res.json(
    lista.map((s) => {
      const publico = streamPublic(s)
      // O estado VIVO deste processo ganha do guardado: o documento pode estar
      // desatualizado por um instante, a memória não. Pausado continua pausado.
      return s.paused ? publico : { ...publico, state: gerente?.stateOf(publico.id) ?? publico.state }
    }),
  )
})

streamRouter.post('/:id/pause', async (req, res, next) => {
  try {
    const id = oid(req.params.id)
    const r = id ? await pauseStream(res.locals.userId, id) : null
    if (!r) return notFound(res)
    res.json(streamPublic(r))
  } catch (error) {
    fail(res, error, next)
  }
})

streamRouter.post('/:id/resume', async (req, res, next) => {
  try {
    const id = oid(req.params.id)
    const r = id ? await resumeStream(res.locals.userId, id) : null
    if (!r) return notFound(res)
    res.json(streamPublic(r))
  } catch (error) {
    fail(res, error, next)
  }
})

streamRouter.post('/:id/reconnect', async (req, res, next) => {
  try {
    const id = oid(req.params.id)
    const r = id ? await reconnectStream(res.locals.userId, id) : null
    if (!r) return notFound(res)
    res.json(streamPublic(r))
  } catch (error) {
    fail(res, error, next)
  }
})

// Testar a CONEXÃO, não o stream: confere credencial e adapter sem abrir socket.
streamRouter.post('/test', async (req, res, next) => {
  try {
    const installationId = String((req.body ?? {}).installationId ?? '')
    res.json(await testStreamConnection(res.locals.userId, installationId))
  } catch (error) {
    fail(res, error, next)
  }
})

// O diagnóstico detalhado — a "área avançada" da tela. Escopado por dono na consulta.
streamRouter.get('/events', async (req, res) => {
  const type = typeof req.query.type === 'string' && isEventType(req.query.type) ? req.query.type : undefined
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  const limit = Number(req.query.limit ?? 50)
  const lista = await listEvents(res.locals.userId, { type, status, limit: Number.isFinite(limit) ? limit : 50 })
  res.json(
    lista.map((e) => ({
      eventId: e.eventId,
      type: e.type,
      source: e.source,
      schemaVersion: e.schemaVersion,
      occurredAt: e.occurredAt.toISOString(),
      status: e.status,
      attempts: e.attempts,
      error: e.error?.message ?? null,
    })),
  )
})
