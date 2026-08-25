// O App de WebSocket contra um servidor WebSocket DE VERDADE, na própria máquina.
//
// Handshake, cabeçalho, subprotocolo, primeira mensagem e quadro passam pelo transporte
// real. O que um socket falso não provaria: que o `ws` fala com o servidor, que o
// cabeçalho chega, e que a conexão volta sozinha depois de cair.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'
import { startFakeWs } from './helpers/fakeWsServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
// O servidor de teste vive em 127.0.0.1. Este é o MESMO interruptor do HTTP, e a
// validação de produção recusa subir com ele ligado.
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { getApp } = await import('../dist/apps/registry.js')
const { createInstallation, patchInstallation, revokeInstallation } = await import('../dist/apps/installations.js')
const { StreamManager, setStreamManager } = await import('../dist/streams/manager.js')
const { createRealSocket } = await import('../dist/streams/socket.js')
const { ensureStreamIndexes, upsertStream } = await import('../dist/streams/repository.js')
const { streamCredentials } = await import('../dist/streams/service.js')
const { websocketAdapterFor, writeConnectionConfig } = await import('../dist/integrations/websocket/service.js')
const { getApp: _getApp } = await import('../dist/apps/registry.js')
const repo = await import('../dist/integrations/websocket/repository.js')
const bus = await import('../dist/events/bus.js')
const { db, mongoClient } = await import('../dist/db.js')

const DONO = 'dono-ws'
const VIZINHO = 'dono-vizinho-ws'
const SEGREDO = 'credencial-secreta-do-servico'

let servidor
let gerente

before(async () => {
  await ensureStreamIndexes()
  await repo.ensureWebSocketIndexes()
  await bus.ensureEventIndexes()
})

after(async () => {
  await servidor?.close()
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  // Tudo que um teste pode deixar para trás. Uma execução sobrando do teste anterior
  // faz o seguinte falhar por um motivo que não é dele.
  for (const c of [
    'connections',
    'market_streams',
    'websocket_subscriptions',
    'websocket_messages',
    'websocket_logs',
    'platform_events',
    'event_handler_runs',
    'automation_runs',
    'automations',
    'automation_versions',
    'agents',
    'offices',
    'buildings',
    'memory_records',
  ])
    await db.collection(c).deleteMany({})
  bus.resetHandlers()
  // A janela do limite por minuto vive na memória do processo: sem zerar, um teste
  // gasta a cota do próximo.
  const { resetRateLimits } = await import('../dist/integrations/websocket/pipeline.js')
  resetRateLimits()
  await servidor?.close()
})

/** Sobe o servidor falso e cria a conexão configurada apontando para ele. */
async function comConexao(config = {}, opts = {}, dono = DONO) {
  servidor = await startFakeWs(opts)
  const app = getApp('websocket')
  const conexao = await createInstallation(dono, app, {
    name: 'Serviço externo',
    // O segredo vai cifrado; a configuração, no metadata público.
    config: { token: SEGREDO },
    publicMetadata: writeConnectionConfig(normalizar({ endpoint: servidor.url, ...config })),
  })
  return conexao
}

const { normalizeConnectionConfig: normalizar } = await import('../dist/apps/official/websocket/config.js')

function novoGerente() {
  gerente = new StreamManager({
    adapters: new Map(),
    adapterFor: websocketAdapterFor,
    createSocket: createRealSocket,
    credentialsOf: streamCredentials,
  })
  setStreamManager(gerente)
  return gerente
}

const ligar = async (conexao, dono = DONO) => {
  const record = await upsertStream({ ownerId: dono, installationId: conexao._id.toString(), appKey: 'websocket', environment: 'default', symbols: [] })
  await novoGerente().start(record)
  return record
}

/** Espera uma condição de verdade: o transporte é assíncrono e não avisa quando terminou. */
async function ate(condicao, oque = 'condição', tentativas = 400) {
  for (let i = 0; i < tentativas; i += 1) {
    if (await condicao()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`esperei demais por: ${oque}`)
}

const mensagens = (dono = DONO) => db.collection('websocket_messages').find({ ownerId: dono }).sort({ receivedAt: 1 }).toArray()

// --- conectar, autenticar, assinar --------------------------------------------------------

test('conecta de verdade e autentica pela primeira mensagem', async () => {
  const conexao = await comConexao({ auth: { kind: 'message', messageTemplate: '{"action":"auth","token":"{{token}}"}' } })
  await ligar(conexao)
  await ate(async () => servidor.estado.recebidas.length > 0, 'a mensagem de autenticação')
  assert.deepEqual(JSON.parse(servidor.estado.recebidas[0]), { action: 'auth', token: SEGREDO })
})

test('autentica por cabeçalho no handshake', async () => {
  // É o caso que o WebSocket nativo do Node não faz — e o motivo de usar `ws`.
  const conexao = await comConexao({ auth: { kind: 'header', name: 'Authorization', prefix: 'Bearer ' } })
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  assert.equal(servidor.estado.headers[0].authorization, `Bearer ${SEGREDO}`)
})

test('autentica por parâmetro no endereço', async () => {
  const conexao = await comConexao({ auth: { kind: 'query', name: 'token', prefix: '' } })
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  assert.match(servidor.estado.urls[0], new RegExp(`token=${SEGREDO}`))
})

test('oferece o subprotocolo pedido', async () => {
  const conexao = await comConexao({ protocols: ['graphql-ws'] })
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  assert.equal(servidor.estado.protocolos[0], 'graphql-ws')
})

// --- receber ---------------------------------------------------------------------------------

test('recebe JSON e guarda o que interessa', async () => {
  const conexao = await comConexao({ paths: { payload: 'data', messageId: 'id', channel: 'canal', occurredAt: '' } })
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  servidor.enviar({ id: 'm-1', canal: 'pedidos', data: { total: 42 } })

  // Esperar o EVENTO, e não a mensagem: guardar e publicar são duas escritas, e a
  // segunda ainda não terminou quando a primeira aparece.
  await ate(async () => (await bus.listEvents(DONO, { type: 'integration.websocket.message' })).length === 1, 'o evento')
  const [m] = await mensagens()
  assert.equal(m.status, 'accepted')
  assert.equal(m.channel, 'pedidos')
  assert.match(m.preview, /42/)

  const [evento] = await bus.listEvents(DONO, { type: 'integration.websocket.message' })
  assert.ok(evento)
  assert.equal(evento.payload.connectionId, conexao._id.toString())
  assert.equal(evento.payload.channel, 'pedidos')
  assert.equal(evento.payload.untrusted, true, 'conteúdo de fora é marcado como não confiável')
  assert.deepEqual(evento.payload.payload, { total: 42 })
})

test('recebe texto quando o formato é texto', async () => {
  const conexao = await comConexao({ format: 'text' })
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  servidor.enviar('uma linha de log')
  await ate(async () => (await mensagens()).length === 1, 'a mensagem')
  const [m] = await mensagens()
  assert.equal(m.status, 'accepted')
  assert.match(m.preview, /uma linha de log/)
})

test('o que não passa no filtro é registrado como filtrado, e não vira evento', async () => {
  const conexao = await comConexao({ filters: [{ path: 'tipo', operator: 'equals', value: 'pedido' }] })
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  servidor.enviar({ tipo: 'outro' })
  await ate(async () => (await mensagens()).length === 1, 'a mensagem')
  const [m] = await mensagens()
  assert.equal(m.status, 'filtered')
  assert.equal((await bus.listEvents(DONO, { type: 'integration.websocket.message' })).length, 0)
})

test('schema inválido é recusado e fica registrado com o motivo', async () => {
  const conexao = await comConexao({ schema: { type: 'object', properties: { total: { type: 'number' } }, required: ['total'] } })
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  servidor.enviar({ semTotal: true })
  await ate(async () => (await mensagens()).length === 1, 'a mensagem')
  assert.equal((await mensagens())[0].status, 'invalid')
  const logs = await repo.listLogs(DONO)
  assert.ok(logs.some((l) => l.kind === 'invalid' && /schema/.test(l.message)))
})

test('a mesma mensagem duas vezes é guardada uma vez', async () => {
  const conexao = await comConexao({ dedupe: 'message_id', paths: { payload: '', messageId: 'id', channel: '', occurredAt: '' } })
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  servidor.enviar({ id: 'repetida', v: 1 })
  await ate(async () => (await mensagens()).length === 1, 'a primeira')
  servidor.enviar({ id: 'repetida', v: 1 })
  await new Promise((r) => setTimeout(r, 150))
  assert.equal((await mensagens()).length, 1, 'a segunda não entra')
  assert.equal((await bus.listEvents(DONO, { type: 'integration.websocket.message' })).length, 1)
})

test('acima do limite por minuto, a mensagem é descartada com registro', async () => {
  const conexao = await comConexao({ maxMessagesPerMinute: 2 })
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  for (let i = 0; i < 4; i += 1) servidor.enviar({ n: i })
  await ate(async () => (await mensagens()).length >= 3, 'as mensagens')
  const todas = await mensagens()
  assert.ok(todas.some((m) => m.status === 'rate_limited'), 'o limite foi aplicado')
  assert.equal(todas.filter((m) => m.status === 'accepted').length, 2)
})

test('mensagem grande demais é recusada sem ser interpretada', async () => {
  const conexao = await comConexao({ maxMessageBytes: 300 })
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  servidor.enviar({ grande: 'x'.repeat(1000) })
  await ate(async () => (await mensagens()).length === 1, 'a mensagem')
  assert.equal((await mensagens())[0].status, 'too_large')
})

// --- reconexão e ciclo de vida ------------------------------------------------------------

test('a conexão cai e volta sozinha', async () => {
  const conexao = await comConexao()
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes === 1, 'a primeira conexão')
  servidor.derrubar()
  // A espera é curta no teste, mas o backoff é o mesmo do resto do sistema.
  await ate(async () => servidor.estado.conexoes === 2, 'a reconexão', 800)
  assert.ok(servidor.estado.conexoes >= 2)
})

test('revogar a conexão desliga o stream e pausa as assinaturas', async () => {
  const conexao = await comConexao()
  await repo.insertSubscription({
    _id: new ObjectId(),
    ownerId: DONO,
    installationId: conexao._id.toString(),
    name: 'Tudo',
    subscribeMessage: '',
    unsubscribeMessage: '',
    filters: [],
    channel: '',
    active: true,
    destination: { kind: 'history' },
    messageCount: 0,
    lastMessageAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')

  await revokeInstallation(DONO, conexao._id)
  const { disableStreamsForInstallation } = await import('../dist/streams/service.js')
  await disableStreamsForInstallation(DONO, conexao._id.toString())
  await repo.deactivateForInstallation(DONO, conexao._id.toString())

  assert.equal(gerente.activeCount, 0)
  assert.equal((await repo.activeSubscriptions(DONO, conexao._id.toString())).length, 0)
})

// --- isolamento -------------------------------------------------------------------------------

test('a mensagem de uma conta não aparece na outra', async () => {
  const conexao = await comConexao()
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  servidor.enviar({ a: 1 })
  await ate(async () => (await mensagens()).length === 1, 'a mensagem')

  // O dono está na CONSULTA, e não numa conferência depois de ler.
  assert.equal((await mensagens(VIZINHO)).length, 0)
  assert.equal((await repo.listLogs(VIZINHO)).length, 0)
  assert.equal((await bus.listEvents(VIZINHO)).length, 0)
})

test('um endereço de rede interna não vira conexão', async () => {
  // O `ALLOW_LOOPBACK_HTTP_TARGETS` libera 127.0.0.1 — e só ele. O resto continua barrado.
  const app = getApp('websocket')
  const conexao = await createInstallation(DONO, app, {
    name: 'Interna',
    config: { token: '' },
    publicMetadata: writeConnectionConfig(normalizar({ endpoint: 'wss://169.254.169.254/latest' })),
  })
  await assert.rejects(() => websocketAdapterFor({ ownerId: DONO, appKey: 'websocket', installationId: conexao._id.toString(), environment: 'default' }), /interna/)
})

// --- zero token -------------------------------------------------------------------------------

test('coletar não gasta token nenhum', async () => {
  // A promessa do modo "só coletar": nenhuma execução, nenhuma inferência, nenhum
  // registro de consumo. Medido, e não presumido.
  const conexao = await comConexao()
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  servidor.enviar({ a: 1 })
  await ate(async () => (await mensagens()).length === 1, 'a mensagem')

  assert.equal(await db.collection('automation_runs').countDocuments({}), 0)
  assert.equal(await db.collection('token_usage').countDocuments({}).catch(() => 0), 0)
})

// --- do evento ao destino ------------------------------------------------------------------

test('evento → MEMÓRIA, sem passar por modelo nenhum', async () => {
  // O modo "coletar e guardar": a memória é escrita pelo mesmo caminho das rotinas, e
  // nenhuma inferência acontece.
  const { registerWebSocketDestinations } = await import('../dist/integrations/websocket/destinations.js')
  const { ensureMemoryIndexes, searchMemory } = await import('../dist/memory/records.js')
  await ensureMemoryIndexes()
  registerWebSocketDestinations()

  const agente = new ObjectId()
  const andar = new ObjectId()
  await db.collection('agents').insertOne({ _id: agente, ownerId: DONO, name: 'Ana', objective: 'x', officeId: andar, activationModes: [] })

  const conexao = await comConexao()
  await repo.insertSubscription({
    _id: new ObjectId(),
    ownerId: DONO,
    installationId: conexao._id.toString(),
    name: 'Pedidos',
    subscribeMessage: '',
    unsubscribeMessage: '',
    filters: [],
    channel: '',
    active: true,
    destination: { kind: 'memory', memoryScope: 'agent', agentId: agente.toString() },
    messageCount: 0,
    lastMessageAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  servidor.enviar({ pedido: 'p-1', total: 99 })
  await ate(async () => (await bus.listEvents(DONO, { type: 'integration.websocket.message' })).length === 1, 'o evento')

  const evento = await bus.claimNextEvent('w1')
  assert.equal(await bus.processEvent(evento), 'done')

  const guardado = await searchMemory({ tenantId: DONO, scopeKeys: [`agent:${agente.toString()}`] })
  assert.equal(guardado.total, 1, 'o que chegou foi guardado')
  assert.equal(guardado.items[0].payload.untrusted, true, 'e continua marcado como conteúdo de fora')
  // Zero token: nenhuma execução foi criada por causa disto.
  assert.equal(await db.collection('automation_runs').countDocuments({}), 0)
})

test('evento → ROTINA, pela mesma fila e com a mesma idempotência', async () => {
  const { registerWebSocketDestinations } = await import('../dist/integrations/websocket/destinations.js')
  const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
  const { createAutomation, publishAutomation, setStatus } = await import('../dist/automations/service.js')
  await ensureRunIndexes()
  registerWebSocketDestinations()

  const predio = new ObjectId()
  const andar = new ObjectId()
  await db.collection('buildings').insertOne({ _id: predio, ownerId: DONO, name: 'P', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: andar, ownerId: DONO, buildingId: predio, name: 'T', status: 'active', createdAt: new Date() })
  const rotina = await createAutomation(DONO, {
    floorId: andar.toString(),
    name: 'Registrar',
    description: 'Guarda o que chegou',
    definition: {
      trigger: { type: 'internal_event', eventType: 'integration.websocket.message' },
      executionMode: 'collect_only',
      inputs: [],
      steps: [
        {
          id: 'evento',
          name: 'Evento recebido',
          type: 'transform.template',
          enabled: true,
          dependsOn: [],
          inputMapping: {},
          config: { template: '{{input}}' },
          timeoutMs: 5000,
          retryPolicy: { maxAttempts: 1, backoffMs: 0 },
          continueOnError: false,
        },
      ],
      resultFormat: 'text',
      deliveries: [],
      limits: { maxSteps: 10, maxDurationMs: 60000, maxTokens: 0 },
    },
  })
  await publishAutomation(DONO, rotina._id, DONO)
  await setStatus(DONO, rotina._id, 'active')

  const conexao = await comConexao()
  await repo.insertSubscription({
    _id: new ObjectId(),
    ownerId: DONO,
    installationId: conexao._id.toString(),
    name: 'Para a rotina',
    subscribeMessage: '',
    unsubscribeMessage: '',
    filters: [],
    channel: '',
    active: true,
    destination: { kind: 'routine', automationId: rotina._id.toString() },
    messageCount: 0,
    lastMessageAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  servidor.enviar({ chegou: true })
  await ate(async () => (await bus.listEvents(DONO, { type: 'integration.websocket.message' })).length === 1, 'o evento')

  const evento = await bus.claimNextEvent('w1')
  await bus.processEvent(evento)
  await ate(async () => (await db.collection('automation_runs').countDocuments({ ownerId: DONO })) === 1, 'a execução')

  // Reprocessar o mesmo evento não cria uma segunda execução.
  const { deliverWebSocketEvent } = await import('../dist/integrations/websocket/destinations.js')
  await deliverWebSocketEvent(evento)
  assert.equal(await db.collection('automation_runs').countDocuments({ ownerId: DONO }), 1)
})

test('assinatura pausada não dispara nada', async () => {
  const { registerWebSocketDestinations, deliverWebSocketEvent } = await import('../dist/integrations/websocket/destinations.js')
  registerWebSocketDestinations()
  const conexao = await comConexao()
  const assinatura = await repo.insertSubscription({
    _id: new ObjectId(),
    ownerId: DONO,
    installationId: conexao._id.toString(),
    name: 'Pausada',
    subscribeMessage: '',
    unsubscribeMessage: '',
    filters: [],
    channel: '',
    active: false,
    destination: { kind: 'routine', automationId: new ObjectId().toString() },
    messageCount: 0,
    lastMessageAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  // Desativada entre o recebimento e a entrega: não age. É o mesmo motivo pelo qual a
  // conexão revogada é conferida na hora de executar, e não na hora de listar.
  await deliverWebSocketEvent({
    ownerId: DONO,
    eventId: 'e-1',
    type: 'integration.websocket.message',
    payload: { connectionId: conexao._id.toString(), subscriptionId: assinatura._id.toString() },
  })
  assert.equal(await db.collection('automation_runs').countDocuments({}), 0)
})

test('nem log nem mensagem guardam credencial', async () => {
  // O log é lido por quem administra e às vezes por quem dá suporte — é o lugar mais
  // fácil de vazar o que o resto do sistema protege.
  const conexao = await comConexao({ auth: { kind: 'header', name: 'Authorization', prefix: 'Bearer ' } })
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  servidor.enviar({ a: 1 })
  await ate(async () => (await mensagens()).length === 1, 'a mensagem')

  const tudo = JSON.stringify([await mensagens(), await repo.listLogs(DONO), await bus.listEvents(DONO)])
  assert.ok(!tudo.includes(SEGREDO), 'a credencial não aparece em nada que fica guardado')
})

// --- as inscrições saem de verdade ------------------------------------------------------

const assinaturaDe = (installationId, over = {}) => ({
  _id: new ObjectId(),
  ownerId: DONO,
  installationId,
  name: 'Pedidos',
  subscribeMessage: JSON.stringify({ action: 'subscribe', canal: 'pedidos' }),
  unsubscribeMessage: JSON.stringify({ action: 'unsubscribe', canal: 'pedidos' }),
  filters: [],
  channel: '',
  active: true,
  destination: { kind: 'history' },
  managedAutomationId: null,
  messageCount: 0,
  lastMessageAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
})

test('as inscrições ativas são mandadas DEPOIS de autenticar', async () => {
  // Guardar a mensagem e nunca mandá-la é a diferença entre uma conexão que recebe e uma
  // que fica aberta em silêncio — e o silêncio parece funcionamento.
  const conexao = await comConexao({ auth: { kind: 'message', messageTemplate: '{"action":"auth","token":"{{token}}"}' } })
  await repo.insertSubscription(assinaturaDe(conexao._id.toString()))
  await ligar(conexao)
  await ate(async () => servidor.estado.recebidas.length >= 2, 'auth + inscrição')
  assert.deepEqual(JSON.parse(servidor.estado.recebidas[0]), { action: 'auth', token: SEGREDO }, 'a autenticação vem primeiro')
  assert.deepEqual(JSON.parse(servidor.estado.recebidas[1]), { action: 'subscribe', canal: 'pedidos' })
})

test('uma assinatura pausada NÃO é mandada', async () => {
  const conexao = await comConexao()
  await repo.insertSubscription(assinaturaDe(conexao._id.toString(), { active: false }))
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  await new Promise((r) => setTimeout(r, 120))
  assert.equal(servidor.estado.recebidas.length, 0)
})

test('depois de reconectar, as inscrições vão de novo', async () => {
  // Um serviço que caiu esqueceu tudo que foi pedido: voltar conectado sem reassinar é
  // voltar mudo.
  const conexao = await comConexao()
  await repo.insertSubscription(assinaturaDe(conexao._id.toString()))
  await ligar(conexao)
  await ate(async () => servidor.estado.recebidas.length === 1, 'a primeira inscrição')
  servidor.derrubar()
  await ate(async () => servidor.estado.recebidas.length === 2, 'a inscrição depois da reconexão', 800)
  assert.deepEqual(JSON.parse(servidor.estado.recebidas[1]), { action: 'subscribe', canal: 'pedidos' })
})

test('assinar com o socket de pé manda a inscrição na hora', async () => {
  // Esperar a próxima reconexão faria a assinatura recém-criada não receber nada por
  // tempo indefinido.
  const { sendSubscribe, sendUnsubscribe } = await import('../dist/integrations/websocket/subscribe.js')
  const conexao = await comConexao()
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  const assinatura = await repo.insertSubscription(assinaturaDe(conexao._id.toString()))

  assert.equal(await sendSubscribe(DONO, conexao._id.toString(), assinatura), true)
  await ate(async () => servidor.estado.recebidas.length === 1, 'a inscrição')
  assert.deepEqual(JSON.parse(servidor.estado.recebidas[0]), { action: 'subscribe', canal: 'pedidos' })

  // E pausar manda o cancelamento: sem isso, o serviço continuaria mandando e a
  // mensagem chegaria só para ser descartada.
  assert.equal(await sendUnsubscribe(DONO, conexao._id.toString(), assinatura), true)
  await ate(async () => servidor.estado.recebidas.length === 2, 'o cancelamento')
  assert.deepEqual(JSON.parse(servidor.estado.recebidas[1]), { action: 'unsubscribe', canal: 'pedidos' })
})

test('com o stream desligado, assinar não falha — o quadro sai ao conectar', async () => {
  const { sendSubscribe } = await import('../dist/integrations/websocket/subscribe.js')
  const conexao = await comConexao()
  const assinatura = await repo.insertSubscription(assinaturaDe(conexao._id.toString()))
  assert.equal(await sendSubscribe(DONO, conexao._id.toString(), assinatura), false, 'não havia conexão')

  await ligar(conexao)
  await ate(async () => servidor.estado.recebidas.length === 1, 'a inscrição ao conectar')
})

test('o log diz que assinou, e nunca O QUE assinou', async () => {
  // Uma inscrição pode conter identificador de conta ou chave de canal privado.
  const conexao = await comConexao()
  await repo.insertSubscription(assinaturaDe(conexao._id.toString(), { subscribeMessage: JSON.stringify({ action: 'subscribe', conta: 'segredo-do-cliente' }) }))
  await ligar(conexao)
  await ate(async () => (await repo.listLogs(DONO)).some((l) => l.kind === 'subscribed'), 'o registro')
  const logs = JSON.stringify(await repo.listLogs(DONO))
  assert.ok(!logs.includes('segredo-do-cliente'))
})

test('a mensagem de inscrição é conferida contra o formato da conexão', async () => {
  const { assertFrame } = await import('../dist/integrations/websocket/subscribe.js')
  const { ValidationError } = await import('../dist/building.js')
  // Numa conexão JSON, texto solto é erro de configuração e precisa aparecer ao salvar.
  assert.throws(() => assertFrame('não é json', { format: 'json' }, 'Mensagem'), ValidationError)
  assert.equal(assertFrame('{"a":1}', { format: 'json' }, 'Mensagem'), '{"a":1}')
  // Numa conexão de texto, texto é o formato.
  assert.equal(assertFrame('SUBSCRIBE pedidos', { format: 'text' }, 'Mensagem'), 'SUBSCRIBE pedidos')
  assert.equal(assertFrame('', { format: 'json' }, 'Mensagem'), '')
})

// --- os intervalos da conexão valem de verdade ---------------------------------------------

test('o intervalo de silêncio da CONEXÃO é o que vale', async () => {
  // O `.env` é padrão e teto; quem conectou sabe melhor quanto silêncio daquele serviço
  // é normal.
  const conexao = await comConexao({ idleTimeoutMs: 5_000, heartbeat: { enabled: true, message: '{"t":"ping"}', intervalMs: 5_000 } })
  const adapter = await websocketAdapterFor({ ownerId: DONO, appKey: 'websocket', installationId: conexao._id.toString(), environment: 'default' })
  assert.equal(adapter.idleTimeoutMs(), 5_000)
  assert.equal(adapter.heartbeatIntervalMs(), 5_000)
})

// --- testar assinatura -------------------------------------------------------------------------

test('testar a assinatura abre, autentica, inscreve, espera e fecha', async () => {
  const { testSubscription } = await import('../dist/integrations/websocket/subscribe.js')
  // O servidor responde à inscrição com uma mensagem que serve.
  servidor = await startFakeWs({
    onConnection: (socket) => {
      socket.on('message', () => socket.send(JSON.stringify({ canal: 'pedidos', total: 1 })))
    },
  })
  const app = getApp('websocket')
  const conexao = await createInstallation(DONO, app, {
    name: 'Serviço',
    config: { token: SEGREDO },
    publicMetadata: writeConnectionConfig(normalizar({ endpoint: servidor.url })),
  })
  novoGerente()
  const assinatura = assinaturaDe(conexao._id.toString())

  const antes = servidor.estado.conexoes
  const r = await testSubscription(DONO, assinatura, { adapterFor: websocketAdapterFor, credentialsOf: streamCredentials })
  assert.equal(r.ok, true)
  assert.match(r.message, /compatível/)
  assert.ok(!JSON.stringify(r).includes(SEGREDO), 'o teste não ecoa a credencial')
  // Nada ficou de pé: um teste que deixa socket aberto, repetido, vira vazamento.
  assert.equal(gerente.activeCount, 0)
  assert.ok(servidor.estado.conexoes > antes)
})

test('testar uma assinatura que não recebe nada devolve isso, sem inventar sucesso', async () => {
  const { testSubscription } = await import('../dist/integrations/websocket/subscribe.js')
  process.env.WS_TEST_TIMEOUT_MS = '300'
  try {
    const conexao = await comConexao()
    novoGerente()
    const r = await testSubscription(DONO, assinaturaDe(conexao._id.toString()), {
      adapterFor: websocketAdapterFor,
      credentialsOf: streamCredentials,
    })
    assert.equal(r.ok, false)
    assert.match(r.message, /nenhuma mensagem compatível/)
  } finally {
    delete process.env.WS_TEST_TIMEOUT_MS
  }
})

// --- uma mensagem sem assinatura ------------------------------------------------------------

test('mensagem sem assinatura vira histórico — e não dispara nada', async () => {
  const { registerWebSocketDestinations } = await import('../dist/integrations/websocket/destinations.js')
  registerWebSocketDestinations()
  const conexao = await comConexao()
  await ligar(conexao)
  await ate(async () => servidor.estado.conexoes > 0, 'a conexão')
  servidor.enviar({ a: 1 })
  await ate(async () => (await mensagens()).length === 1, 'a mensagem')

  const [m] = await mensagens()
  assert.equal(m.status, 'accepted', 'ela foi recebida')
  assert.equal(m.subscriptionId, null, 'e nenhuma assinatura a reivindicou')

  // O evento existe — o histórico é durável —, mas processá-lo não produz execução
  // nenhuma: sem assinatura não há destino.
  const evento = await bus.claimNextEvent('w1')
  assert.equal(await bus.processEvent(evento), 'done')
  assert.equal(await db.collection('automation_runs').countDocuments({}), 0)
})
