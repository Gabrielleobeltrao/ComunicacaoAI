import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { ValidationError } from '../building.js'
import { listInstallations } from '../apps/installations.js'
import { latestLiveValues } from '../integrations/websocket/liveData.js'
import { lerFonte } from '../realtimeSources/reader.js'
import { apagarFonte, atualizarFonte, criarFonte, fontesDoAgente, listarFontes, obterFonte } from '../realtimeSources/repository.js'
import { sourcePublic } from '../realtimeSources/types.js'
import { auditEntity } from './auditMiddleware.js'
import { notFound, oid } from './http.js'

/**
 * As fontes em tempo real, para a tela.
 *
 * Tudo do dono: um id que chega do cliente nunca é usado sem ele no filtro. O que sai é
 * configuração e valor — nunca credencial, porque uma fonte não tem nenhuma: ela guarda
 * a REFERÊNCIA da conexão, e a credencial continua cifrada na instalação do App.
 */
export const realtimeSourceRouter = Router()

const recusar = (res: Parameters<typeof notFound>[0], error: unknown, next: (e?: unknown) => void): void => {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: 'invalid', message: error.message })
    return
  }
  next(error)
}

/** O nome amigável de cada conexão, para a tela não mostrar id. */
async function rotulos(ownerId: string): Promise<Map<string, string>> {
  const instalacoes = await listInstallations(ownerId, 'websocket')
  return new Map(instalacoes.map((i) => [i._id.toString(), i.name]))
}

realtimeSourceRouter.get('/', async (req, res) => {
  const [lista, nomes] = await Promise.all([listarFontes(res.locals.userId), rotulos(res.locals.userId)])
  res.json(lista.map((f) => sourcePublic(f, nomes.get(f.sourceRef) ?? null)))
})

/**
 * O catálogo: as conexões da conta e as CHAVES que cada uma já recebeu.
 *
 * As chaves vêm do Dado ao vivo — o que já chegou de verdade. Oferecer uma lista fixa
 * obrigaria a pessoa a adivinhar como o provedor nomeia as coisas.
 */
realtimeSourceRouter.get('/catalog', async (req, res) => {
  const instalacoes = await listInstallations(res.locals.userId, 'websocket')
  const conexoes = await Promise.all(
    instalacoes
      .filter((i) => i.status !== 'revoked')
      .map(async (i) => {
        const chaves = await latestLiveValues(res.locals.userId, i._id.toString(), 100).catch(() => [])
        return {
          ref: i._id.toString(),
          label: i.name,
          // Só o nome da chave e quando ela chegou: o valor inteiro não é assunto desta
          // tela, e pode ser grande.
          keys: chaves.map((c) => ({ key: c.key, receivedAt: c.receivedAt.toISOString(), updates: c.updates })),
        }
      }),
  )
  res.json({ live_data: conexoes })
})

realtimeSourceRouter.post('/', async (req, res, next) => {
  try {
    const fonte = await criarFonte(res.locals.userId, (req.body ?? {}) as Record<string, unknown>)
    auditEntity(res, { id: fonte._id.toString(), label: fonte.name })
    const nomes = await rotulos(res.locals.userId)
    res.status(201).json(sourcePublic(fonte, nomes.get(fonte.sourceRef) ?? null))
  } catch (error) {
    recusar(res, error, next)
  }
})

realtimeSourceRouter.patch('/:id', async (req, res, next) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  try {
    const fonte = await atualizarFonte(res.locals.userId, id, (req.body ?? {}) as Record<string, unknown>)
    if (!fonte) return notFound(res)
    auditEntity(res, { id: fonte._id.toString(), label: fonte.name })
    const nomes = await rotulos(res.locals.userId)
    res.json(sourcePublic(fonte, nomes.get(fonte.sourceRef) ?? null))
  } catch (error) {
    recusar(res, error, next)
  }
})

realtimeSourceRouter.delete('/:id', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const fonte = await obterFonte(res.locals.userId, id)
  if (!fonte) return notFound(res)
  await apagarFonte(res.locals.userId, id)
  auditEntity(res, { id, label: fonte.name })
  res.status(204).end()
})

/** O valor de agora — é isto que a tela usa para dizer "recebendo, há 1s". */
realtimeSourceRouter.get('/:id/value', async (req, res) => {
  const id = oid(req.params.id)
  if (!id) return notFound(res)
  const fonte = await obterFonte(res.locals.userId, id)
  if (!fonte) return notFound(res)
  res.json(await lerFonte(fonte))
})

/**
 * As fontes de UM agente, com o valor de cada uma.
 *
 * É a tela do agente. Ela não cria histórico nenhum, e nem menciona: guardar é outra
 * decisão, em outro lugar.
 */
realtimeSourceRouter.get('/agent/:agentId', async (req, res) => {
  const agentId = oid(req.params.agentId)
  if (!agentId) return notFound(res)
  const [lista, nomes] = await Promise.all([fontesDoAgente(res.locals.userId, agentId), rotulos(res.locals.userId)])
  const comValor = await Promise.all(
    lista.map(async (f) => ({ ...sourcePublic(f, nomes.get(f.sourceRef) ?? null), reading: await lerFonte(f) })),
  )
  res.json(comValor)
})

/** Conceder ou retirar esta fonte de um agente — a operação da tela dele. */
realtimeSourceRouter.post('/:id/agents/:agentId', async (req, res, next) => {
  const id = oid(req.params.id)
  const agentId = oid(req.params.agentId)
  if (!id || !agentId) return notFound(res)
  try {
    const fonte = await obterFonte(res.locals.userId, id)
    if (!fonte) return notFound(res)
    const conceder = req.method === 'POST' && req.body?.granted !== false
    const atuais = fonte.agentIds.map((a) => a.toString())
    const novos = conceder ? [...new Set([...atuais, agentId.toString()])] : atuais.filter((a) => a !== agentId.toString())
    const { definirAgentes } = await import('../realtimeSources/repository.js')
    const atualizada = await definirAgentes(res.locals.userId, id, novos)
    if (!atualizada) return notFound(res)
    auditEntity(res, { id: id.toString(), label: fonte.name })
    const nomes = await rotulos(res.locals.userId)
    res.json(sourcePublic(atualizada, nomes.get(atualizada.sourceRef) ?? null))
  } catch (error) {
    recusar(res, error, next)
  }
})

void ObjectId
