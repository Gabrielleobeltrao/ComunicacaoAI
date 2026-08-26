import { ObjectId } from 'mongodb'
import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { ValidationError } from '../building.js'
import { normalizeConnectionConfig, connectionConfigPublic } from '../apps/official/websocket/config.js'
import type { WsConnectionConfig } from '../apps/official/websocket/config.js'
import { decryptInstallationConfig, getInstallation, listInstallations, patchInstallation } from '../apps/installations.js'
import { resolveAppForOwner } from '../apps/privateApps.js'
import { checkWebSocketUrl } from '../net/safeWebSocket.js'
import { readConnectionConfig, sanearConfiguracaoLegada, websocketAdapterFor, writeConnectionConfig } from '../integrations/websocket/service.js'
import { assertFrame, sendRawFrame, sendSubscribe, sendUnsubscribe, testConnection, testSubscription } from '../integrations/websocket/subscribe.js'
import { StreamManager, streamManager } from '../streams/manager.js'
import { createRealSocket } from '../streams/socket.js'
import { listLiveValues } from '../integrations/websocket/liveData.js'
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
export function precisaReabrir(anterior: WsConnectionConfig | null, novo: WsConnectionConfig): boolean {
  if (!anterior) return false
  /**
   * QUALQUER diferença na configuração normalizada reabre a conexão. Uma vez.
   *
   * A lista de campos "que só valem no handshake" existia e estava certa em teoria — e
   * errada na prática, porque o adapter guarda uma CÓPIA da configuração no momento em
   * que a conexão sobe. Filtro, mapeamento e limites eram lidos daquela cópia, não do
   * banco: mudá-los "sem reconectar" queria dizer não mudá-los.
   *
   * Comparar o normalizado inteiro é a regra que dá para explicar e que não mente:
   * salvou diferente, reconecta; salvou igual, não acontece nada. O custo é uma
   * reconexão a mais em mudanças que talvez não precisassem — e o benefício é a
   * configuração na tela ser a configuração no ar.
   */
  return JSON.stringify(anterior) !== JSON.stringify(novo)
}

/** As conexões deste App, com a configuração pública e o estado do stream. */
websocketRouter.get('/connections', async (req, res) => {
  const instalacoes = (await listInstallations(res.locals.userId, APP_KEY)).filter((i) => i.status !== 'revoked')
  const app = await resolveAppForOwner(res.locals.userId, APP_KEY)
  const saida = await Promise.all(
    instalacoes.map(async (i) => {
      const id = i._id.toString()
      const [streams, stats] = await Promise.all([listStreamsForInstallation(res.locals.userId, id), messageStats(res.locals.userId, id)])
      let config = null
      let precisaCorrigir = false
      try {
        // Uma conexão criada e ainda não configurada é normal — ela aparece na lista
        // esperando configuração, em vez de derrubar a página inteira.
        const lida = readConnectionConfig(i.publicMetadata)
        /**
         * Configuração antiga com a credencial em texto claro: migra quando dá, e
         * quando não dá não devolve o conteúdo.
         *
         * A migração é gravada aqui mesmo, na leitura: o próximo salvamento passaria
         * pela validação nova e falharia num campo que a pessoa nem editou.
         */
        const credencial = decryptInstallationConfig(i).token ?? ''
        const saneada = sanearConfiguracaoLegada(lida, credencial)
        precisaCorrigir = saneada.precisaCorrigir
        if (saneada.migrada && app) {
          await patchInstallation(res.locals.userId, i._id, app, {
            publicMetadata: { ...(i.publicMetadata ?? {}), ...writeConnectionConfig(saneada.config) },
          }).catch(() => undefined)
        }
        config = saneada.precisaCorrigir ? null : connectionConfigPublic(saneada.config)
      } catch {
        config = null
      }
      return {
        id,
        name: i.name,
        status: i.status,
        config,
        // A tela precisa saber a diferença entre "ainda não configurada" e "configurada
        // de um jeito que não dá para mostrar": as duas chegam com `config: null`.
        needsFix: precisaCorrigir,
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
    /**
     * A credencial em vigor — a nova, se veio uma; a guardada, se não.
     *
     * Ela entra só para a validação RECUSAR um campo público que a contenha em texto
     * claro. Não é gravada por este caminho e não sai na resposta.
     */
    const credencialAtual = body.token || decryptInstallationConfig(instalacao).token || ''
    const config = normalizeConnectionConfig(body.config, credencialAtual)
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
/**
 * TESTAR A CONEXÃO: abre de verdade, com a configuração de verdade, e fecha.
 *
 * Rota própria do App porque a genérica de instalação só sabe conferir campos
 * preenchidos: ela não tem o endereço nem os cabeçalhos, que moram na configuração
 * pública desta conexão e não na credencial.
 */
websocketRouter.post('/connections/:id/test', async (req, res, next) => {
  try {
    const id = oid(req.params.id)
    if (!id) return notFound(res)
    const instalacao = await getInstallation(res.locals.userId, id)
    if (!instalacao || instalacao.appKey !== APP_KEY) return notFound(res)

    const r = await testConnection(res.locals.userId, id.toString(), {
      adapterFor: websocketAdapterFor,
      credentialsOf: streamCredentials,
      /**
       * O gerenciador do processo quando ele existe; um descartável quando não.
       *
       * A sonda não usa o estado dele — nem o mapa de conexões vivas, nem os relógios —,
       * e com `EMBEDDED_WORKER=false` a API não tem gerenciador nenhum. Sem isto, testar
       * a conexão respondia "o motor não está no ar" numa instalação perfeitamente sadia.
       */
      manager: () => streamManager() ?? new StreamManager({ adapters: new Map(), createSocket: createRealSocket, credentialsOf: streamCredentials }),
    })
    auditEntity(res, { id: id.toString(), label: instalacao.name })
    res.status(r.ok ? 200 : 400).json(r)
  } catch (error) {
    fail(res, error, next)
  }
})

/**
 * Mandar um quadro por uma conexão que está de pé.
 *
 * É a ferramenta de quem está configurando: um serviço novo quase sempre exige um
 * quadro que ninguém previu, e sem isto a única forma de descobrir o formato certo era
 * salvar, reconectar e olhar. O conteúdo NÃO é registrado — ele pode carregar
 * identificador de conta ou token de sessão.
 */
websocketRouter.post('/connections/:id/send', async (req, res, next) => {
  try {
    const id = oid(req.params.id)
    if (!id) return notFound(res)
    const instalacao = await getInstallation(res.locals.userId, id)
    if (!instalacao || instalacao.appKey !== APP_KEY) return notFound(res)

    const frame = String((req.body ?? {}).frame ?? '').slice(0, 8_000)
    if (!frame.trim()) throw new ValidationError('Escreva a mensagem que você quer enviar.')
    // O formato é o DA CONEXÃO: exigir JSON de uma conexão de texto recusaria
    // exatamente o quadro que aquele serviço espera.
    let formato: WsConnectionConfig['format'] = 'json'
    try {
      formato = readConnectionConfig(instalacao.publicMetadata).format
    } catch {
      // Não configurada ainda: vale o padrão, e o envio vai falhar por falta de conexão.
    }
    assertFrame(frame, { format: formato }, 'Mensagem')

    const enviado = await sendRawFrame(res.locals.userId, id.toString(), frame)
    auditEntity(res, { id: id.toString(), label: instalacao.name })
    res.json({ sent: enviado, message: enviado ? 'Mensagem enviada.' : 'A conexão não está aberta agora.' })
  } catch (error) {
    fail(res, error, next)
  }
})

/**
 * O DADO AO VIVO desta conexão: o último valor de cada chave.
 *
 * Leitura pura, do dono. É a mesma coisa que os Code Agents leem por `liveData.*` — a
 * tela mostra o que o cálculo vai ver, e não uma segunda versão da verdade.
 */
websocketRouter.get('/live', async (req, res) => {
  const installationId = typeof req.query.installationId === 'string' ? req.query.installationId : ''
  if (!installationId) return res.json({ count: 0, items: [] })
  const id = oid(installationId)
  if (!id) return res.json({ count: 0, items: [] })
  const instalacao = await getInstallation(res.locals.userId, id)
  if (!instalacao || instalacao.appKey !== APP_KEY) return notFound(res)

  const registros = await listLiveValues(res.locals.userId, installationId, String(req.query.prefix ?? ''), 100)
  const agora = Date.now()
  res.json({
    count: registros.length,
    items: registros.map((r) => ({
      key: r.key,
      value: r.value,
      updates: r.updates,
      receivedAt: r.receivedAt.toISOString(),
      ageMs: agora - r.receivedAt.getTime(),
    })),
  })
})

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
     * O ciclo da edição: CANCELA com o que valia, e ASSINA com o que passou a valer.
     *
     * Cancelar com a configuração nova é o defeito clássico daqui: trocar de canal, de
     * frame ou de conexão mandaria o cancelamento do canal novo — que ninguém assinou —
     * e deixaria o antigo assinado para sempre. Uma assinatura fantasma continua
     * chegando, gastando banda e limite, e não aparece em lugar nenhum da tela.
     *
     * Por isso os dois lados usam o documento certo: `atual` para sair, `atualizada`
     * para entrar. Se o cancelamento falhar, a inscrição nova ainda acontece — ficar
     * sem as duas seria pior do que ficar com uma sobrando.
     */
    const eraAtiva = atual.active
    const ficouAtiva = atualizada.active
    const mudouOQueSeAssina =
      atual.installationId !== atualizada.installationId ||
      atual.subscribeMessage !== atualizada.subscribeMessage ||
      atual.unsubscribeMessage !== atualizada.unsubscribeMessage ||
      atual.channel !== atualizada.channel ||
      JSON.stringify(atual.filters) !== JSON.stringify(atualizada.filters)

    if (eraAtiva && (!ficouAtiva || mudouOQueSeAssina)) {
      await sendUnsubscribe(res.locals.userId, atual.installationId, atual).catch(() => undefined)
    }
    if (ficouAtiva && (!eraAtiva || mudouOQueSeAssina)) {
      await sendSubscribe(res.locals.userId, atualizada.installationId, atualizada).catch(() => undefined)
    }

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
    res.json(
      await testSubscription(res.locals.userId, assinatura, {
        adapterFor: websocketAdapterFor,
        credentialsOf: streamCredentials,
        // Onde o canal mora é configuração da CONEXÃO, e não um nome fixo.
        configOf: async (dono, instalacaoId) => {
          const inst = await getInstallation(dono, oid(instalacaoId)!)
          if (!inst) return null
          try {
            return readConnectionConfig(inst.publicMetadata)
          } catch {
            return null
          }
        },
      }),
    )
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
      subscriptionIds: m.subscriptionIds ?? (m.subscriptionId ? [m.subscriptionId] : []),
      channel: m.channel,
      status: m.status,
      // Por que ela não virou evento. Uma frase nossa, sobre a configuração.
      reason: m.reason ?? null,
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
