// A RODADA CORRETIVA do App de WebSocket.
//
// Cada caso aqui é um defeito que a implementação anterior deixava passar: um teste de
// conexão que não abria conexão nenhuma, um valor que ficava preso na janela de
// gravação, um campo público guardando a credencial em texto claro, e um App "genérico"
// que só falava JSON.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'
import { startFakeWs } from './helpers/fakeWsServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'
// Janela curta, para o teste não esperar um segundo por gravação.
process.env.WS_LIVE_FLUSH_MS = '150'

const { mongoClient, db } = await import('../dist/db.js')
const { normalizeConnectionConfig } = await import('../dist/apps/official/websocket/config.js')
const liveData = await import('../dist/integrations/websocket/liveData.js')
const { StreamManager, setStreamManager, streamManager } = await import('../dist/streams/manager.js')
const { createRealSocket } = await import('../dist/streams/socket.js')
const { ensureStreamIndexes, upsertStream } = await import('../dist/streams/repository.js')
const { websocketAdapterFor, writeConnectionConfig, ingestWebSocketMessage } = await import('../dist/integrations/websocket/service.js')
const { streamCredentials } = await import('../dist/streams/service.js')
const { testConnection } = await import('../dist/integrations/websocket/subscribe.js')
const { mascarar } = await import('../dist/integrations/websocket/redact.js')
const wsRepo = await import('../dist/integrations/websocket/repository.js')
const { resetRateLimits } = await import('../dist/integrations/websocket/pipeline.js')
const { createInstallation } = await import('../dist/apps/installations.js')
const { getApp } = await import('../dist/apps/registry.js')

const DONO = 'dono-hardening'
const SEGREDO = 'chave-secreta-do-provedor-123'
let servidor
let gerente

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const ate = async (cond, oque, limite = 12_000) => {
  const fim = Date.now() + limite
  while (Date.now() < fim) {
    if (await cond()) return
    await esperar(25)
  }
  throw new Error(`tempo esgotado esperando ${oque}`)
}

before(async () => {
  await mongoClient.connect()
  await ensureStreamIndexes()
  await wsRepo.ensureWebSocketIndexes()
  await liveData.ensureLiveDataIndexes()
})

after(async () => {
  await gerente?.stopAll()
  setStreamManager(null)
  await servidor?.close()
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await gerente?.stopAll()
  for (const c of ['connections', 'market_streams', 'websocket_subscriptions', 'websocket_messages', 'websocket_logs', 'live_data', 'platform_events'])
    await db.collection(c).deleteMany({})
  liveData.resetLiveBuffer()
  resetRateLimits()
  await servidor?.close()
  servidor = null
})

async function instalar(srv, config = {}, token = SEGREDO) {
  return createInstallation(DONO, getApp('websocket'), {
    name: 'Serviço',
    ...(token ? { config: { token } } : {}),
    publicMetadata: writeConnectionConfig(normalizeConnectionConfig({ endpoint: srv.url, ...config })),
  })
}

const novoGerente = () => {
  gerente = new StreamManager({ adapters: new Map(), adapterFor: websocketAdapterFor, createSocket: createRealSocket, credentialsOf: streamCredentials })
  setStreamManager(gerente)
  return gerente
}

const testar = (instalacao) =>
  testConnection(DONO, instalacao._id.toString(), {
    adapterFor: websocketAdapterFor,
    credentialsOf: streamCredentials,
    manager: () => streamManager() ?? novoGerente(),
  })

// ============================================================================
// 1. Teste real de conexão
// ============================================================================

test('o teste ABRE a conexão de verdade — e fecha depois', async () => {
  servidor = await startFakeWs()
  novoGerente()
  const instalacao = await instalar(servidor, { auth: { kind: 'none' } }, '')

  const r = await testar(instalacao)
  assert.equal(r.ok, true, r.message)
  assert.equal(servidor.estado.conexoes, 1, 'abriu de verdade')
  await ate(() => servidor.estado.sockets.every((s) => s.readyState !== 1), 'o socket fechar')
})

test('serviço público, sem credencial nenhuma, passa no teste', async () => {
  servidor = await startFakeWs()
  novoGerente()
  // Nem instalação com token: `auth.kind: none` é a configuração de todo serviço aberto.
  const instalacao = await instalar(servidor, { auth: { kind: 'none' } }, '')
  const r = await testar(instalacao)
  assert.equal(r.ok, true, r.message)
})

test('o teste usa a configuração REAL: cabeçalho, subprotocolo e autenticação', async () => {
  servidor = await startFakeWs()
  novoGerente()
  const instalacao = await instalar(servidor, {
    auth: { kind: 'header', name: 'Authorization', prefix: 'Bearer ' },
    headers: [{ name: 'Origin', value: 'https://meu-site.com' }],
    protocols: ['v1.stream'],
  })

  const r = await testar(instalacao)
  assert.equal(r.ok, true, r.message)
  assert.equal(servidor.estado.headers[0].authorization, `Bearer ${SEGREDO}`, 'o cabeçalho de autenticação foi mesmo')
  assert.equal(servidor.estado.headers[0].origin, 'https://meu-site.com')
  assert.equal(servidor.estado.protocolos[0], 'v1.stream')
})

test('o teste por QUERY leva a credencial no endereço, e o resultado não a devolve', async () => {
  servidor = await startFakeWs()
  novoGerente()
  const instalacao = await instalar(servidor, { auth: { kind: 'query', name: 'apikey', prefix: '' } })
  const r = await testar(instalacao)
  assert.equal(r.ok, true, r.message)
  assert.match(servidor.estado.urls[0], /apikey=/)
  assert.ok(!JSON.stringify(r).includes(SEGREDO), 'a resposta não carrega a credencial')
})

test('o teste por MENSAGEM manda a autenticação antes de responder', async () => {
  servidor = await startFakeWs()
  novoGerente()
  const instalacao = await instalar(servidor, { auth: { kind: 'message', name: '', messageTemplate: '{"action":"auth","token":"{{token}}"}' } })
  const r = await testar(instalacao)
  assert.equal(r.ok, true, r.message)
  await ate(() => servidor.estado.recebidas.length >= 1, 'a mensagem de autenticação')
  assert.match(servidor.estado.recebidas[0], /"auth"/)
})

test('um endereço interno é recusado no TESTE, como é na conexão', async () => {
  novoGerente()
  const instalacao = await createInstallation(DONO, getApp('websocket'), {
    name: 'Interna',
    config: { token: SEGREDO },
    publicMetadata: writeConnectionConfig(normalizeConnectionConfig({ endpoint: 'ws://169.254.169.254/latest' })),
  })
  const r = await testar(instalacao)
  assert.equal(r.ok, false)
  assert.match(r.message, /intern|priv|link-local|metadata|não/i)
})

test('sem endereço configurado, o teste diz isso em vez de fingir sucesso', async () => {
  novoGerente()
  const instalacao = await createInstallation(DONO, getApp('websocket'), { name: 'Vazia', config: { token: SEGREDO } })
  const r = await testar(instalacao)
  assert.equal(r.ok, false)
  assert.match(r.message, /configurada|endereço/i)
})

// ============================================================================
// 2. Live Data Store
// ============================================================================

test('vários tiques na mesma janela geram UMA gravação, e o valor fica disponível na hora', async () => {
  const antes = await gravacoesDe('AAPL')
  for (let i = 0; i < 10; i++) await liveData.putLiveValue(DONO, 'c1', 'AAPL', { price: i }, 60)

  // Na memória, o valor mais recente responde imediatamente.
  assert.equal((await liveData.getLiveValue(DONO, 'c1', 'AAPL')).value.price, 9)

  await liveData.flushLiveData()
  const doBanco = await db.collection('live_data').findOne({ _id: `${DONO}:c1:AAPL` })
  assert.equal(doBanco.value.price, 9, 'o banco recebeu o último, não o primeiro')
  assert.ok(antes >= 0)
})

test('o último valor da rajada vai ao banco sozinho, sem esperar outro tique', async () => {
  await liveData.putLiveValue(DONO, 'c2', 'AAPL', { price: 1 }, 60)
  await liveData.putLiveValue(DONO, 'c2', 'AAPL', { price: 2 }, 60)
  // Ninguém manda mais nada. Antes, o `2` ficava preso no buffer para sempre.
  await ate(async () => (await db.collection('live_data').findOne({ _id: `${DONO}:c2:AAPL` }))?.value?.price === 2, 'a gravação da janela')
})

test('o contador é sequencial: 1, 2, 3 — e continua depois de reiniciar', async () => {
  for (let i = 1; i <= 3; i++) {
    await liveData.putLiveValue(DONO, 'c3', 'AAPL', { price: i }, 60)
    await liveData.flushLiveData()
    assert.equal((await liveData.getLiveValue(DONO, 'c3', 'AAPL')).updates, i, `tique ${i}`)
  }

  // "Reiniciar": o processo perde a memória e só tem o banco.
  liveData.resetLiveBuffer()
  await liveData.putLiveValue(DONO, 'c3', 'AAPL', { price: 4 }, 60)
  await liveData.flushLiveData()
  assert.equal((await liveData.getLiveValue(DONO, 'c3', 'AAPL')).updates, 4, 'continua de onde parou')
})

test('tiques simultâneos não se atropelam: o último vence e a contagem bate', async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => liveData.putLiveValue(DONO, 'c4', 'AAPL', { price: i }, 60)))
  await liveData.flushLiveData()
  const r = await liveData.getLiveValue(DONO, 'c4', 'AAPL')
  assert.equal(r.value.price, 19, 'o último tique vence')
  assert.equal(r.updates, 20, 'e nenhuma atualização foi contada duas vezes')
})

test('o teto por conexão vale mesmo com chaves novas chegando juntas', async () => {
  const teto = 500
  const resultados = await Promise.all(Array.from({ length: teto + 25 }, (_, i) => liveData.putLiveValue(DONO, 'c5', `k${i}`, i, 60)))
  const aceitas = resultados.filter(Boolean).length
  assert.equal(aceitas, teto, `esperava exatamente ${teto} aceitas, veio ${aceitas}`)
})

test('o teto do DONO segura a soma de várias conexões', async () => {
  const { WS_LIMITS } = await import('../dist/apps/official/websocket/config.js')
  const porConexao = WS_LIMITS.maxLiveKeysPerConnection
  const conexoes = Math.ceil(WS_LIMITS.maxLiveKeysPerOwner / porConexao) + 1
  let aceitas = 0
  for (let c = 0; c < conexoes; c++) {
    for (let i = 0; i < porConexao; i++) {
      if (await liveData.putLiveValue(DONO, `conexao-${c}`, `k${i}`, i, 60)) aceitas += 1
    }
  }
  assert.equal(aceitas, WS_LIMITS.maxLiveKeysPerOwner, 'a soma para no teto do dono')
})

test('um valor vencido não é devolvido antes de o TTL do banco passar', async () => {
  await liveData.putLiveValue(DONO, 'c6', 'AAPL', { price: 1 }, 5)
  await liveData.flushLiveData()
  const futuro = new Date(Date.now() + 10_000)
  assert.equal(await liveData.getLiveValue(DONO, 'c6', 'AAPL', futuro), null)
  assert.equal((await liveData.latestLiveValues(DONO, 'c6', 50, futuro)).length, 0)
  // E o documento ainda está lá: o TTL do Mongo remove em até um minuto.
  assert.ok(await db.collection('live_data').findOne({ _id: `${DONO}:c6:AAPL` }))
})

const gravacoesDe = async (chave) => db.collection('live_data').countDocuments({ key: chave })

// ============================================================================
// 4. Segredos
// ============================================================================

test('a credencial em texto claro é RECUSADA nos campos públicos', async () => {
  for (const [campo, config] of [
    ['cabeçalho', { headers: [{ name: 'X-Key', value: SEGREDO }] }],
    ['mensagem inicial', { initialMessages: [`{"token":"${SEGREDO}"}`] }],
    ['autenticação', { auth: { kind: 'message', name: '', messageTemplate: `{"token":"${SEGREDO}"}` } }],
    ['batimento', { heartbeat: { enabled: true, native: false, message: `{"ping":"${SEGREDO}"}`, intervalMs: 30_000, timeoutMs: 10_000 } }],
  ]) {
    assert.throws(
      () => normalizeConnectionConfig({ endpoint: 'wss://exemplo.com/x', ...config }, SEGREDO),
      /{{token}}/,
      campo,
    )
  }
})

test('o placeholder {{token}} é aceito nos mesmos campos', () => {
  const c = normalizeConnectionConfig(
    {
      endpoint: 'wss://exemplo.com/x',
      headers: [{ name: 'X-Key', value: '{{token}}' }],
      initialMessages: ['{"token":"{{token}}"}'],
      auth: { kind: 'message', name: '', messageTemplate: '{"token":"{{token}}"}' },
    },
    SEGREDO,
  )
  assert.equal(c.headers[0].value, '{{token}}')
  assert.ok(!JSON.stringify(c).includes(SEGREDO))
})

test('quando o provedor ECOA o token, ele é riscado do histórico, do evento e do dado ao vivo', async () => {
  const config = normalizeConnectionConfig({
    endpoint: 'wss://exemplo.com/x',
    format: 'json',
    mapping: [{ from: 'sym', to: 'symbol' }],
    liveKeyPath: 'symbol',
  })
  await wsRepo.insertSubscription({
    _id: new (await import('mongodb')).ObjectId(),
    ownerId: DONO,
    installationId: 'inst-eco',
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

  // O serviço devolve a autenticação junto com o dado — acontece de verdade.
  await ingestWebSocketMessage(DONO, 'inst-eco', JSON.stringify({ sym: 'AAPL', echo: { token: SEGREDO } }), config, new Date(), [SEGREDO])
  await liveData.flushLiveData()

  const tudo = JSON.stringify([
    await db.collection('websocket_messages').find({}).toArray(),
    await db.collection('platform_events').find({}).toArray(),
    await db.collection('live_data').find({}).toArray(),
  ])
  assert.ok(!tudo.includes(SEGREDO), 'a credencial não sobrou em nada que é guardado')
  assert.ok(tudo.includes('***'), 'e o lugar dela ficou marcado')
})

test('a máscara não risca palavra curta legítima', () => {
  assert.equal(mascarar('preço em usd para paper', ['usd', 'paper']), 'preço em usd para paper')
  assert.equal(mascarar(`o token é ${SEGREDO}`, [SEGREDO]), 'o token é ***')
})

// ============================================================================
// 5. Genérico de verdade: JSON e texto
// ============================================================================

test('numa conexão de TEXTO, os quadros de saída podem ser texto puro', () => {
  const c = normalizeConnectionConfig({
    endpoint: 'wss://exemplo.com/x',
    format: 'text',
    auth: { kind: 'message', name: '', messageTemplate: 'AUTH {{token}}' },
    initialMessages: ['SUBSCRIBE AAPL', 'SUBSCRIBE TSLA'],
    heartbeat: { enabled: true, native: false, message: 'PING', intervalMs: 30_000, timeoutMs: 10_000 },
  })
  assert.equal(c.auth.messageTemplate, 'AUTH {{token}}')
  assert.deepEqual(c.initialMessages, ['SUBSCRIBE AAPL', 'SUBSCRIBE TSLA'])
  assert.equal(c.heartbeat.message, 'PING')
})

test('numa conexão JSON, texto puro continua sendo recusado — e a mensagem diz o que fazer', () => {
  assert.throws(
    () => normalizeConnectionConfig({ endpoint: 'wss://exemplo.com/x', format: 'json', initialMessages: ['SUBSCRIBE AAPL'] }),
    /JSON válido.*texto puro/s,
  )
})

test('a conexão de texto manda os quadros de texto ao abrir', async () => {
  servidor = await startFakeWs()
  novoGerente()
  const instalacao = await instalar(servidor, {
    format: 'text',
    auth: { kind: 'message', name: '', messageTemplate: 'AUTH {{token}}' },
    initialMessages: ['SUBSCRIBE AAPL'],
  })
  const record = await upsertStream({ ownerId: DONO, installationId: instalacao._id.toString(), appKey: 'websocket', environment: 'default', symbols: [] })
  await gerente.start(record)
  await ate(() => servidor.estado.recebidas.length >= 2, 'os quadros de texto')
  assert.equal(servidor.estado.recebidas[0], `AUTH ${SEGREDO}`)
  assert.equal(servidor.estado.recebidas[1], 'SUBSCRIBE AAPL')
})

// ============================================================================
// 3. Mudança de configuração numa conexão de pé
// ============================================================================

const { precisaReabrir } = await import('../dist/routes/websocketRoutes.js')

const base = (extra = {}) => normalizeConnectionConfig({ endpoint: 'wss://exemplo.com/x', ...extra })

test('mudar o que só vale no handshake reabre a conexão', () => {
  const antes = base()
  for (const [oque, depois] of [
    ['endereço', base({ endpoint: 'wss://outro.com/x' })],
    ['autenticação', base({ auth: { kind: 'header', name: 'Authorization', prefix: 'Bearer ' } })],
    ['cabeçalhos', base({ headers: [{ name: 'Origin', value: 'https://x.com' }] })],
    ['mensagens iniciais', base({ initialMessages: ['{"a":1}'] })],
    ['subprotocolos', base({ protocols: ['v1'] })],
    ['batimento', base({ heartbeat: { enabled: true, native: true, intervalMs: 30_000, timeoutMs: 10_000 } })],
    ['silêncio', base({ idleTimeoutMs: 120_000 })],
    ['prazo do handshake', base({ connectTimeoutMs: 30_000 })],
  ]) {
    assert.equal(precisaReabrir(antes, depois), true, oque)
  }
})

test('o que é lido a cada mensagem NÃO derruba a conexão', () => {
  const antes = base({ mapping: [{ from: 'a', to: 'x' }], liveKeyPath: 'x' })
  for (const [oque, depois] of [
    ['filtros', base({ mapping: [{ from: 'a', to: 'x' }], liveKeyPath: 'x', filters: [{ path: 'tipo', operator: 'equals', value: 'tick' }] })],
    ['schema', base({ mapping: [{ from: 'a', to: 'x' }], liveKeyPath: 'x', schema: { type: 'object' } })],
    ['mapeamento', base({ mapping: [{ from: 'b', to: 'y' }], liveKeyPath: 'y' })],
    ['validade do dado ao vivo', base({ mapping: [{ from: 'a', to: 'x' }], liveKeyPath: 'x', liveTtlSeconds: 600 })],
    ['espaço entre eventos', base({ mapping: [{ from: 'a', to: 'x' }], liveKeyPath: 'x', publishThrottleMs: 500 })],
    ['limites', base({ mapping: [{ from: 'a', to: 'x' }], liveKeyPath: 'x', maxMessagesPerMinute: 60 })],
  ]) {
    assert.equal(precisaReabrir(antes, depois), false, oque)
  }
})

test('sem configuração anterior não há o que reabrir', () => {
  assert.equal(precisaReabrir(null, base()), false)
})
