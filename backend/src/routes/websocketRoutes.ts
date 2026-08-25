import { ObjectId } from 'mongodb'
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { ValidationError } from '../building.js'
import { normalizeConnectionConfig, connectionConfigPublic } from '../apps/official/websocket/config.js'
import type { WsConnectionConfig } from '../apps/official/websocket/config.js'
import { getInstallation, listInstallations, patchInstallation } from '../apps/installations.js'
import { resolveAppForOwner } from '../apps/privateApps.js'
import { checkWebSocketUrl } from '../net/safeWebSocket.js'
import { readConnectionConfig, websocketAdapterFor, writeConnectionConfig } from '../integrations/websocket/service.js'
import { assertFrame, sendSubscribe, sendUnsubscribe, testSubscription } from '../integrations/websocket/subscribe.js'
import { archiveManagedTrigger, assertDestinationOwned, syncManagedTrigger } from '../integrations/websocket/managedTrigger.js'
import {
  deleteSubscription,
  findSubscription,
  insertSubscription,
  listLogs,
  listMessages,
  listSubscriptions,
  messageStats,
  patchSubscription,
} from '../integrations/websocket/repository.js'
import type { WsDestination, WsSubscription } from '../integrations/websocket/types.js'
import { listStreamsForInstallation } from '../streams/repository.js'
import { ensureStream, pauseStream, reconnectStreamsForInstallation, removeStream, resumeStream, streamCredentials } from '../streams/service.js'
import { streamPublic } from '../streams/types.js'
import { listAgents } from '../agents.js'
import { listSectors } from '../sectors.js'
import { listFloors } from '../floors.js'
import { listAutomations } from '../automations/repository.js'
import { auditEntity } from './auditMiddleware.js'
import { fail, notFound, oid } from './http.js'

/**
 * O App WebSocket Genérico, do lado da API.
 *
 * Nenhuma rota daqui devolve credencial: a configuração pública sai sem o valor do
 * segredo (ele nem passa por essa estrutura), e mensagem e log saem cortados.
 */
export const websocketRouter = Router()

const APP_KEY = 'websocket'

const paginacao = (req: { query: Record<string, unknown> }) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
  const skip = Math.max(Number(req.query.skip) || 0, 0)
  return { limit, skip }
}

const texto = (v: unknown, max = 200): string => String(v ?? '').trim().slice(0, max)

/**
 * O que só vale no HANDSHAKE — e por isso exige reabrir a conexão.
 *
 * Filtro, caminho, schema e limite ficam de fora de propósito: eles são lidos a cada
 * mensagem, e derrubar a conexão por causa deles seria perder mensagem à toa.
 */
function precisaReabrir(anterior: WsConnectionConfig | null, novo: WsConnectionConfig): boolean {
  if (!anterior) return false
  return (
    anterior.endpoint !== novo.endpoint ||
    JSON.stringify(anterior.auth) !== JSON.stringify(novo.auth) ||
    JSON.stringify(anterior.protocols) !== JSON.stringify(novo.protocols) ||
    JSON.stringify(anterior.heartbeat) !== JSON.stringify(novo.heartbeat) ||
    anterior.idleTimeoutMs !== novo.idleTimeoutMs
  )
}

/** As conexões deste App, com a configuração pública e o estado do stream. */
websocketRouter.get('/connections', async (req, res) => {
  const instalacoes = (await listInstallations(res.locals.userId, APP_KEY)).filter((i) => i.status !== 'revoked')
  const saida = await Promise.all(
    instalacoes.map(async (i) => {
      const id = i._id.toString()
      const [streams, stats] = await Promise.all([listStreamsForInstallation(res.locals.userId, id), messageStats(res.locals.userId, id)])
      let config = null
      try {
        // Uma conexão criada e ainda não configurada é normal — ela aparece na lista
        // esperando configuração, em vez de derrubar a página inteira.
        config = connectionConfigPublic(readConnectionConfig(i.publicMetadata))
      } catch {
        config = null
      }
      return {
        id,
        name: i.name,
        status: i.status,
        config,
        stream: streams[0] ? streamPublic(streams[0]) : null,
        messages: { total: stats.total, accepted: stats.accepted, lastAt: stats.lastAt ? stats.lastAt.toISOString() : null },
      }
    }),
  )
  res.json(saida)
})

/** Gravar a configuração. O segredo continua onde estava se não vier um novo. */
websocketRouter.patch('/connections/:id', async (req, res, next) => {
  try {
    const id = oid(req.params.id)
    if (!id) return notFound(res)
    const instalacao = await getInstallation(res.locals.userId, id)
    if (!instalacao || instalacao.appKey !== APP_KEY) return notFound(res)
    const app = await resolveAppForOwner(res.locals.userId, APP_KEY)
    if (!app) return notFound(res)

    const body = (req.body ?? {}) as { name?: string; config?: unknown; token?: string }
    const config = normalizeConnectionConfig(body.config)
    // O endereço é conferido ANTES de gravar: guardar um endpoint que a conexão vai
    // recusar seria adiar o erro para longe de quem o causou.
    const alvo = await checkWebSocketUrl(config.endpoint)
    if (!alvo.ok) throw new ValidationError(alvo.message)

    // O que já estava valendo, para saber se a mudança exige reabrir a conexão.
    let anterior = null
    try {
      anterior = readConnectionConfig(instalacao.publicMetadata)
    } catch {
      // Ainda não configurada: não há o que comparar, e ligar depois já usa o novo.
    }

    const atualizada = await patchInstallation(res.locals.userId, id, app, {
      ...(body.name ? { name: body.name } : {}),
      // A configuração é pública e vai para o metadata; o SEGREDO vai para a config
      // cifrada. `token` ausente = manter o guardado, que é como `patchInstallation`
      // já trata um campo secreto omitido.
      publicMetadata: { ...(instalacao.publicMetadata ?? {}), ...writeConnectionConfig(config) },
      ...(body.token ? { config: { token: body.token } } : {}),
    })
    if (!atualizada) return notFound(res)

    /**
     * Mudou o que define a CONEXÃO? Então a conexão de pé está errada.
     *
     * Endereço, autenticação, protocolo e credencial só valem no handshake: mantê-los
     * antigos numa conexão aberta faria a mudança parecer não ter efeito até o próximo
     * restart. Filtro e caminho, ao contrário, são lidos a cada mensagem e não pedem nada.
     */
    if (precisaReabrir(anterior, config) || Boolean(body.token)) {
      await reconnectStreamsForInstallation(res.locals.userId, id.toString()).catch(() => undefined)
    }

    auditEntity(res, { id, label: atualizada.name })
    res.json({ id: atualizada._id.toString(), name: atualizada.name, config: connectionConfigPublic(config) })
  } catch (error) {
    fail(res, error, next)
  }
})

/** Conferir um endereço sem gravar nada. É o que a tela chama enquanto se digita. */
websocketRouter.post('/check-url', async (req, res) => {
  res.json(await checkWebSocketUrl(String((req.body ?? {}).endpoint ?? '')))
})

// --- o stream da conexão ------------------------------------------------------------

websocketRouter.post('/connections/:id/start', async (req, res, next) => {
  try {
    const id = oid(req.params.id)
    if (!id) return notFound(res)
    const instalacao = await getInstallation(res.locals.userId, id)
    if (!instalacao || instalacao.appKey !== APP_KEY) return notFound(res)
    // Sem símbolos: este App não usa aquele campo, e forçar configuração genérica nele
    // era exatamente o que não podia acontecer.
    const record = await ensureStream(res.locals.userId, id.toString(), [])
    auditEntity(res, { id: record._id.toString(), label: instalacao.name })
    res.status(201).json(streamPublic(record))
  } catch (error) {
    fail(res, error, next)
  }
})

/**
 * Pausar e retomar, escritas uma a uma.
 *
 * Um laço sobre as duas economizaria quatro linhas e sumiria com elas da varredura que
 * confere se toda rota que muda algo tem decisão de auditoria — e uma rota invisível
 * para essa varredura é uma rota sem decisão.
 */
const mudarEstado = (fn: typeof pauseStream) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = oid(String(req.params.streamId))
    const r = id ? await fn(res.locals.userId, id) : null
    if (!r) return notFound(res)
    auditEntity(res, { id: r._id.toString(), label: r.appKey })
    res.json(streamPublic(r))
  } catch (error) {
    fail(res, error, next)
  }
}

websocketRouter.post('/streams/:streamId/pause', mudarEstado(pauseStream))
websocketRouter.post('/streams/:streamId/resume', mudarEstado(resumeStream))

websocketRouter.delete('/streams/:streamId', async (req, res, next) => {
  try {
    const id = oid(req.params.streamId)
    if (!id || !(await removeStream(res.locals.userId, id))) return notFound(res)
    res.status(204).end()
  } catch (error) {
    fail(res, error, next)
  }
})

// --- assinaturas ---------------------------------------------------------------------

const DESTINOS = ['history', 'memory', 'routine', 'agent', 'sector'] as const

/**
 * O destino, saneado — e conferido contra a conta.
 *
 * Um destino apontando para o agente de outra pessoa não vazaria nada por si só, mas
 * ficaria pendurado num lugar que o dono não controla. O escopo é conferido aqui, uma
 * vez, em vez de na hora do disparo.
 */
function normalizeDestination(bruto: unknown): WsDestination {
  const d = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Record<string, unknown>
  const kind = DESTINOS.find((k) => k === d.kind) ?? 'history'
  const dest: WsDestination = { kind }
  if (kind === 'memory') {
    const escopo = (['agent', 'sector', 'floor', 'building'] as const).find((e) => e === d.memoryScope) ?? 'agent'
    dest.memoryScope = escopo
    const campo = escopo === 'agent' ? 'agentId' : escopo === 'sector' ? 'sectorId' : escopo === 'floor' ? 'floorId' : 'buildingId'
    const valor = texto(d[campo], 40)
    if (!valor) throw new ValidationError('Escolha onde a informação será guardada.')
    dest[campo] = valor
  }
  if (kind === 'routine') {
    dest.automationId = texto(d.automationId, 40)
    if (!dest.automationId) throw new ValidationError('Escolha a rotina que deve rodar.')
  }
  if (kind === 'agent' || kind === 'sector') {
    const campo = kind === 'agent' ? 'agentId' : 'sectorId'
    dest[campo] = texto(d[campo], 40)
    if (!dest[campo]) throw new ValidationError(`Escolha o ${kind === 'agent' ? 'agente' : 'setor'} que deve receber.`)
  }
  return dest
}

/**
 * As entidades que um destino pode apontar — SÓ as desta conta.
 *
 * Uma rota só, e não quatro: a tela precisa das quatro listas ao mesmo tempo para
 * montar os seletores, e quatro requisições para preencher um formulário é latência
 * que ninguém pediu.
 *
 * Nada sensível sai daqui: id e nome, que é o que um seletor mostra.
 */
websocketRouter.get('/targets', async (req, res) => {
  const [agentes, setores, andares, rotinas] = await Promise.all([
    listAgents(res.locals.userId),
    listSectors(res.locals.userId),
    listFloors(res.locals.userId),
    listAutomations(res.locals.userId, { limit: 100, skip: 0 }),
  ])
  res.json({
    agents: agentes.map((a) => ({ id: a._id.toString(), name: a.name })),
    sectors: setores.map((s) => ({ id: s._id.toString(), name: s.name })),
    floors: andares.map((f) => ({ id: f._id.toString(), name: f.name })),
    // Só as que rodam: oferecer um rascunho seria oferecer um destino que não dispara.
    routines: rotinas.items.filter((r) => r.status === 'active').map((r) => ({ id: r._id.toString(), name: r.name })),
  })
})

websocketRouter.get('/subscriptions', async (req, res) => {
  const installationId = typeof req.query.installationId === 'string' ? req.query.installationId : undefined
  res.json((await listSubscriptions(res.locals.userId, installationId)).map(subscriptionPublic))
})

const subscriptionPublic = (s: WsSubscription) => ({
  id: s._id.toString(),
  installationId: s.installationId,
  name: s.name,
  subscribeMessage: s.subscribeMessage,
  unsubscribeMessage: s.unsubscribeMessage,
  filters: s.filters,
  channel: s.channel,
  active: s.active,
  destination: s.destination,
  managedAutomationId: s.managedAutomationId ?? null,
  messageCount: s.messageCount,
  lastMessageAt: s.lastMessageAt ? s.lastMessageAt.toISOString() : null,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
})

websocketRouter.post('/subscriptions', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const installationId = texto(body.installationId, 40)
    const id = oid(installationId)
    const instalacao = id ? await getInstallation(res.locals.userId, id) : null
    if (!instalacao || instalacao.appKey !== APP_KEY) throw new ValidationError('Conexão não encontrada nesta conta.')

    // O formato da CONEXÃO decide o que vale como mensagem de inscrição: numa conexão
    // JSON, texto solto é erro de configuração e precisa aparecer agora — não na
    // primeira vez que o serviço recusar o quadro.
    const daConexao = readConnectionConfig(instalacao.publicMetadata)
    const config = normalizeConnectionConfig({ ...(body as object), endpoint: 'wss://x', filters: body.filters })
    const destination = normalizeDestination(body.destination)
    await assertDestinationOwned(res.locals.userId, destination)

    const now = new Date()
    const doc = await insertSubscription({
      _id: new ObjectId(),
      ownerId: res.locals.userId,
      installationId,
      name: texto(body.name, 120) || 'Assinatura',
      subscribeMessage: assertFrame(texto(body.subscribeMessage, 4_000), daConexao, 'Mensagem de inscrição'),
      unsubscribeMessage: assertFrame(texto(body.unsubscribeMessage, 4_000), daConexao, 'Mensagem de cancelamento'),
      filters: config.filters,
      channel: texto(body.channel, 120),
      active: body.active !== false,
      destination,
      managedAutomationId: null,
      messageCount: 0,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now,
    })

    // Agente e setor executam pelo gatilho canônico; os outros destinos não executam.
    const gerenciada = await syncManagedTrigger(res.locals.userId, doc)
    if (gerenciada) await patchSubscription(res.locals.userId, doc._id, { managedAutomationId: gerenciada })
    // E a inscrição sai AGORA se o socket já está de pé: esperar a próxima reconexão
    // faria a assinatura recém-criada não receber nada por tempo indefinido.
    if (doc.active) await sendSubscribe(res.locals.userId, installationId, doc)

    auditEntity(res, { id: doc._id.toString(), label: doc.name })
    res.status(201).json(subscriptionPublic({ ...doc, managedAutomationId: gerenciada }))
  } catch (error) {
    fail(res, error, next)
  }
})

websocketRouter.patch('/subscriptions/:id', async (req, res, next) => {
  try {
    const id = oid(req.params.id)
    const atual = id ? await findSubscription(res.locals.userId, id) : null
    if (!id || !atual) return notFound(res)
    const body = (req.body ?? {}) as Record<string, unknown>
    const set: Partial<WsSubscription> = {}
    if (body.name !== undefined) set.name = texto(body.name, 120)
    if (body.channel !== undefined) set.channel = texto(body.channel, 120)
    if (body.active !== undefined) set.active = body.active === true
    if (body.subscribeMessage !== undefined) set.subscribeMessage = texto(body.subscribeMessage, 4_000)
    if (body.unsubscribeMessage !== undefined) set.unsubscribeMessage = texto(body.unsubscribeMessage, 4_000)
    if (body.filters !== undefined) set.filters = normalizeConnectionConfig({ endpoint: 'wss://x', filters: body.filters }).filters
    if (body.destination !== undefined) {
      set.destination = normalizeDestination(body.destination)
      await assertDestinationOwned(res.locals.userId, set.destination)
    }
    if (body.installationId !== undefined) {
      const novaId = oid(texto(body.installationId, 40))
      const nova = novaId ? await getInstallation(res.locals.userId, novaId) : null
      if (!nova || nova.appKey !== APP_KEY) throw new ValidationError('Conexão não encontrada nesta conta.')
      set.installationId = novaId!.toString()
    }

    // A mensagem é conferida contra o formato da conexão que vai valer depois da edição.
    const conexaoAlvo = set.installationId ?? atual.installationId
    const instalacao = await getInstallation(res.locals.userId, oid(conexaoAlvo)!)
    if (instalacao) {
      const daConexao = readConnectionConfig(instalacao.publicMetadata)
      if (set.subscribeMessage !== undefined) set.subscribeMessage = assertFrame(set.subscribeMessage, daConexao, 'Mensagem de inscrição')
      if (set.unsubscribeMessage !== undefined) set.unsubscribeMessage = assertFrame(set.unsubscribeMessage, daConexao, 'Mensagem de cancelamento')
    }

    const atualizada = await patchSubscription(res.locals.userId, id, set)
    if (!atualizada) return notFound(res)

    // O gatilho gerenciado acompanha: some quando o destino deixa de executar, muda
    // quando o destino muda, e pausa junto com a assinatura.
    const gerenciada = await syncManagedTrigger(res.locals.userId, atualizada, atual.managedAutomationId ?? null)
    if (gerenciada !== (atual.managedAutomationId ?? null)) {
      await patchSubscription(res.locals.userId, id, { managedAutomationId: gerenciada })
    }

    /**
     * Ligar manda a inscrição; desligar manda o cancelamento.
     *
     * Sem isto, pausar tirava a assinatura da entrega mas deixava o serviço mandando —
     * a mensagem continuava chegando e sendo descartada, gastando banda e limite.
     */
    if (set.active === true && !atual.active) await sendSubscribe(res.locals.userId, atualizada.installationId, atualizada)
    if (set.active === false && atual.active) await sendUnsubscribe(res.locals.userId, atual.installationId, atual)

    auditEntity(res, { id: atualizada._id.toString(), label: atualizada.name })
    res.json(subscriptionPublic({ ...atualizada, managedAutomationId: gerenciada }))
  } catch (error) {
    fail(res, error, next)
  }
})

/**
 * Provar uma assinatura numa conexão à parte.
 *
 * Não muda nada: não grava mensagem, não publica evento e não mexe no stream de pé.
 */
websocketRouter.post('/subscriptions/:id/test', async (req, res, next) => {
  try {
    const id = oid(req.params.id)
    const assinatura = id ? await findSubscription(res.locals.userId, id) : null
    if (!assinatura) return notFound(res)
    res.json(await testSubscription(res.locals.userId, assinatura, { adapterFor: websocketAdapterFor, credentialsOf: streamCredentials }))
  } catch (error) {
    fail(res, error, next)
  }
})

websocketRouter.delete('/subscriptions/:id', async (req, res, next) => {
  try {
    const id = oid(req.params.id)
    const atual = id ? await findSubscription(res.locals.userId, id) : null
    if (!id || !atual) return notFound(res)
    // Cancelar ANTES de apagar: depois não haveria mais o que mandar, e o serviço
    // continuaria enviando para sempre.
    if (atual.active) await sendUnsubscribe(res.locals.userId, atual.installationId, atual)
    if (atual.managedAutomationId) await archiveManagedTrigger(res.locals.userId, atual.managedAutomationId)
    if (!(await deleteSubscription(res.locals.userId, id))) return notFound(res)
    auditEntity(res, { id: id.toString(), label: atual.name })
    res.status(204).end()
  } catch (error) {
    fail(res, error, next)
  }
})

// --- histórico -------------------------------------------------------------------------

websocketRouter.get('/messages', async (req, res) => {
  const { limit, skip } = paginacao(req as never)
  const { items, total } = await listMessages(res.locals.userId, {
    installationId: typeof req.query.installationId === 'string' ? req.query.installationId : undefined,
    subscriptionId: typeof req.query.subscriptionId === 'string' ? req.query.subscriptionId : undefined,
    channel: typeof req.query.channel === 'string' ? req.query.channel : undefined,
    status: typeof req.query.status === 'string' ? (req.query.status as never) : undefined,
    limit,
    skip,
  })
  res.json({
    total,
    items: items.map((m) => ({
      id: m._id.toString(),
      installationId: m.installationId,
      subscriptionId: m.subscriptionId,
      channel: m.channel,
      status: m.status,
      // Um trecho, e nunca a mensagem inteira: ela vem de fora e ninguém a revisou.
      preview: m.preview,
      eventId: m.eventId,
      occurredAt: m.occurredAt.toISOString(),
      receivedAt: m.receivedAt.toISOString(),
    })),
  })
})

websocketRouter.get('/logs', async (req, res) => {
  const installationId = typeof req.query.installationId === 'string' ? req.query.installationId : undefined
  const lista = await listLogs(res.locals.userId, installationId, Number(req.query.limit) || 100)
  res.json(
    lista.map((l) => ({
      id: l._id.toString(),
      installationId: l.installationId,
      kind: l.kind,
      message: l.message,
      subscriptionId: l.subscriptionId,
      createdAt: l.createdAt.toISOString(),
    })),
  )
})
