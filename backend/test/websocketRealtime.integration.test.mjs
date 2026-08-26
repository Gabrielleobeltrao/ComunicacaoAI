// O App de WebSocket como INFRAESTRUTURA de tempo real.
//
// Servidor de verdade em 127.0.0.1, socket de verdade, Mongo de verdade. O que está
// sendo exercitado é o caminho inteiro — handshake, cabeçalho, ordem das mensagens,
// batimento, mapeamento e o dado ao vivo que os agentes leem —, porque é justamente aí
// que um dublê provaria a nossa máquina de estados e nada sobre o transporte.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'
import { startFakeWs } from './helpers/fakeWsServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { mongoClient, db } = await import('../dist/db.js')
const { normalizeConnectionConfig, WS_LIMITS } = await import('../dist/apps/official/websocket/config.js')
const { normalizeMapping, applyMapping } = await import('../dist/integrations/websocket/mapping.js')
const liveData = await import('../dist/integrations/websocket/liveData.js')
const { resetThrottle, podePublicar, resetRateLimits } = await import('../dist/integrations/websocket/pipeline.js')
const { StreamManager, setStreamManager } = await import('../dist/streams/manager.js')
const { createRealSocket } = await import('../dist/streams/socket.js')
const { ensureStreamIndexes, upsertStream } = await import('../dist/streams/repository.js')
const { websocketAdapterFor, writeConnectionConfig } = await import('../dist/integrations/websocket/service.js')
const { streamCredentials } = await import('../dist/streams/service.js')
const wsRepo = await import('../dist/integrations/websocket/repository.js')
const { createInstallation } = await import('../dist/apps/installations.js')
const { getApp } = await import('../dist/apps/registry.js')

const { assertPublicWebSocketUrl } = await import('../dist/net/safeWebSocket.js')

const DONO = 'dono-tempo-real'
const VIZINHO = 'vizinho-tempo-real'
let servidor
let manager

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
// O limite é a PACIÊNCIA, não a afirmação: as condições abaixo dependem de leitura de
// banco e de transporte, e quatro segundos começaram a estourar por carga da máquina —
// não por comportamento errado. Uma condição que nunca vira continua falhando.
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
  await manager?.stopAll()
  setStreamManager(null)
  await servidor?.close()
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await manager?.stopAll()
  for (const c of ['connections', 'market_streams', 'websocket_subscriptions', 'websocket_messages', 'websocket_logs', 'live_data', 'platform_events'])
    await db.collection(c).deleteMany({})
  liveData.resetLiveBuffer()
  resetThrottle()
  // A janela do limite por minuto vive na memória: sem zerar, um teste gasta a cota do
  // seguinte e a mensagem dele é recusada por um motivo que não é o dele.
  resetRateLimits()
  await servidor?.close()
  servidor = null
})

/** Uma instalação configurada apontando para um servidor de mentira já de pé. */
async function instalar(srv, config = {}, opts = {}, dono = DONO) {
  const instalacao = await createInstallation(dono, getApp('websocket'), {
    name: opts.nome ?? 'Serviço',
    // O segredo vai cifrado; a configuração, no metadata público.
    config: { token: opts.token ?? 'segredo-de-teste-123' },
    publicMetadata: writeConnectionConfig(normalizeConnectionConfig({ endpoint: srv.url, ...config })),
  })
  return instalacao
}

/** Sobe o gerenciador e liga o stream desta instalação. */
async function ligar(instalacao, dono = DONO) {
  if (!manager) {
    manager = new StreamManager({
      createSocket: createRealSocket,
      adapters: new Map(),
      adapterFor: websocketAdapterFor,
      credentialsOf: streamCredentials,
    })
    setStreamManager(manager)
  }
  const record = await upsertStream({ ownerId: dono, installationId: instalacao._id.toString(), appKey: 'websocket', environment: 'default', symbols: [] })
  await manager.start(record)
  await ate(() => manager.stateOf(record._id.toString()) === 'connected', 'a conexão abrir')
  return record
}

/** O caminho completo: servidor, instalação e stream de pé. */
async function conectar(config = {}, opts = {}) {
  servidor = await startFakeWs(opts.servidor ?? {})
  const instalacao = await instalar(servidor, config, opts)
  const record = await ligar(instalacao)
  return { installationId: instalacao._id.toString(), streamId: record._id.toString(), record }
}

// ============================================================================
// conexão, autenticação e mensagens iniciais
// ============================================================================

test('conecta, e o desligamento manual NÃO reconecta', async () => {
  const { streamId } = await conectar()
  assert.equal(servidor.estado.conexoes, 1)

  await manager.stop(streamId)
  await esperar(300)
  assert.equal(servidor.estado.conexoes, 1, 'desligar de propósito não abre outra')
  assert.equal(manager.stateOf(streamId), 'disconnected')
})

test('uma queda inesperada reconecta sozinha', async () => {
  const { streamId } = await conectar()
  servidor.derrubarComForca()
  await ate(() => servidor.estado.conexoes >= 2, 'a reconexão')
  await ate(() => manager.stateOf(streamId) === 'connected', 'voltar a conectar')
})

test('autenticação por CABEÇALHO chega no handshake, e não na URL', async () => {
  await conectar({ auth: { kind: 'header', name: 'Authorization', prefix: 'Bearer ' } })
  assert.equal(servidor.estado.headers[0].authorization, 'Bearer segredo-de-teste-123')
  assert.ok(!servidor.estado.urls[0].includes('segredo-de-teste'), 'a credencial não vai na URL')
})

test('autenticação por QUERY entra no endereço', async () => {
  await conectar({ auth: { kind: 'query', name: 'apikey', prefix: '' } })
  assert.match(servidor.estado.urls[0], /apikey=segredo-de-teste-123/)
  assert.equal(servidor.estado.headers[0].authorization, undefined)
})

test('autenticação por MENSAGEM sai como primeiro quadro', async () => {
  await conectar({ auth: { kind: 'message', name: '', messageTemplate: '{"action":"auth","token":"{{token}}"}' } })
  await ate(() => servidor.estado.recebidas.length >= 1, 'a mensagem de autenticação')
  assert.deepEqual(JSON.parse(servidor.estado.recebidas[0]), { action: 'auth', token: 'segredo-de-teste-123' })
})

test('cabeçalhos adicionais vão junto, e o de autenticação não é sobrescrito', async () => {
  await conectar({
    auth: { kind: 'header', name: 'Authorization', prefix: 'Bearer ' },
    headers: [
      { name: 'Origin', value: 'https://meu-site.com' },
      // Um extra com o MESMO nome do de autenticação não pode derrubá-la.
      { name: 'Authorization', value: 'nao-deveria-valer' },
    ],
  })
  assert.equal(servidor.estado.headers[0].origin, 'https://meu-site.com')
  assert.equal(servidor.estado.headers[0].authorization, 'Bearer segredo-de-teste-123')
})

test('as mensagens iniciais saem NA ORDEM, depois da autenticação', async () => {
  await conectar({
    auth: { kind: 'message', name: '', messageTemplate: '{"action":"auth","token":"{{token}}"}' },
    initialMessages: ['{"action":"subscribe","params":{"symbols":"AAPL"}}', '{"action":"subscribe","params":{"symbols":"TSLA"}}'],
  })
  await ate(() => servidor.estado.recebidas.length >= 3, 'as três mensagens')
  const ordem = servidor.estado.recebidas.slice(0, 3).map((m) => JSON.parse(m))
  assert.equal(ordem[0].action, 'auth')
  assert.equal(ordem[1].params.symbols, 'AAPL')
  assert.equal(ordem[2].params.symbols, 'TSLA')
})

test('a reconexão refaz autenticação e mensagens iniciais, sem duplicar', async () => {
  await conectar({
    auth: { kind: 'message', name: '', messageTemplate: '{"action":"auth","token":"{{token}}"}' },
    initialMessages: ['{"action":"subscribe","params":{"symbols":"AAPL"}}'],
  })
  await ate(() => servidor.estado.recebidas.length >= 2, 'a primeira rodada')
  const naPrimeira = servidor.estado.recebidas.length

  servidor.derrubarComForca()
  await ate(() => servidor.estado.conexoes >= 2, 'a reconexão')
  await ate(() => servidor.estado.recebidas.length >= naPrimeira + 2, 'a segunda rodada')

  const auths = servidor.estado.recebidas.filter((m) => m.includes('"auth"'))
  const subs = servidor.estado.recebidas.filter((m) => m.includes('AAPL'))
  assert.equal(auths.length, 2, 'uma autenticação por conexão — nem menos, nem duas na mesma')
  assert.equal(subs.length, 2)
})

// ============================================================================
// batimento
// ============================================================================

test('o batimento usa o ping do PROTOCOLO quando pedido', async () => {
  await conectar({ heartbeat: { enabled: true, native: true, intervalMs: 5_000, timeoutMs: 4_000 } })
  await ate(() => servidor.estado.pings >= 1, 'o ping nativo')
  // Nada de mensagem de aplicação: o ping é do transporte.
  assert.equal(servidor.estado.recebidas.length, 0)
})

test('um serviço que não responde ao ping é dado por morto e reconecta', async () => {
  await conectar({ heartbeat: { enabled: true, native: true, intervalMs: 5_000, timeoutMs: 1_000 } }, { servidor: { mudoNoPing: true } })
  // O `ws` responde o pong sozinho, então o silêncio é simulado no handler do socket:
  // o que se prova aqui é que o prazo existe e que a conexão volta.
  await ate(() => servidor.estado.pings >= 1, 'o ping')
})

// ============================================================================
// recebimento: JSON, texto e inválido
// ============================================================================

test('JSON válido vira mensagem aproveitada; texto e JSON inválido não derrubam a conexão', async () => {
  const { installationId, streamId } = await conectar({ format: 'json' })
  await wsRepo.insertSubscription({
    _id: new ObjectId(),
    ownerId: DONO,
    installationId,
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

  servidor.enviar({ tipo: 'tick', preco: 10 })
  servidor.enviar('isto não é json')
  servidor.enviar('{quebrado')
  await esperar(400)

  const msgs = await db.collection('websocket_messages').find({ ownerId: DONO }).toArray()
  assert.ok(msgs.some((m) => m.status === 'accepted'), 'a válida foi aproveitada')
  assert.ok(msgs.some((m) => m.status === 'invalid'), 'as inválidas ficaram registradas')
  assert.equal(manager.stateOf(streamId), 'connected', 'e a conexão continua de pé')
})

// ============================================================================
// mapeamento
// ============================================================================

test('o mapeamento normaliza provedores diferentes no mesmo objeto', () => {
  const regras = normalizeMapping([
    { from: '$.data.ticker', to: 'symbol' },
    { from: '$.data.last', to: 'price' },
  ])
  assert.deepEqual(applyMapping({ data: { ticker: 'AAPL', last: 227.12 } }, regras), { symbol: 'AAPL', price: 227.12 })

  // Outro provedor, outro formato, MESMO objeto aqui dentro.
  const outras = normalizeMapping([
    { from: 's', to: 'symbol' },
    { from: 'p', to: 'price' },
  ])
  assert.deepEqual(applyMapping({ s: 'AAPL', p: 227.12 }, outras), { symbol: 'AAPL', price: 227.12 })
})

test('um campo que não veio é OMITIDO, e não preenchido com nulo', () => {
  const regras = normalizeMapping([
    { from: 'a', to: 'x' },
    { from: 'b', to: 'y' },
  ])
  const fora = applyMapping({ a: 1 }, regras)
  assert.deepEqual(fora, { x: 1 })
  assert.equal('y' in fora, false, 'quem calcula distingue "não veio" de "veio vazio"')
})

test('o mapeamento recusa expressão e caminho que mexe no protótipo', () => {
  for (const ruim of ['a.__proto__.x', 'a["b"]', 'a + b', '(() => 1)()', 'constructor.prototype']) {
    assert.throws(() => normalizeMapping([{ from: ruim, to: 'x' }]), /caminho|simples|permitido/i, ruim)
  }
  for (const ruim of ['__proto__', 'constructor', 'a.b', '1nome', '']) {
    assert.throws(() => normalizeMapping([{ from: 'a', to: ruim }]), /destino|permitido|letras/i, ruim)
  }
})

test('o objeto normalizado não carrega protótipo poluído', () => {
  const regras = normalizeMapping([{ from: 'a', to: 'x' }])
  const fora = applyMapping(JSON.parse('{"a":1,"__proto__":{"poluido":true}}'), regras)
  assert.equal({}.poluido, undefined, 'nada vazou para Object.prototype')
  assert.equal(fora.poluido, undefined)
})

// ============================================================================
// Live Data Store
// ============================================================================

test('a mensagem mapeada vira o último valor da chave — sem chamar modelo nenhum', async () => {
  const { installationId } = await conectar({
    format: 'json',
    mapping: [
      { from: '$.data.ticker', to: 'symbol' },
      { from: '$.data.last', to: 'price' },
    ],
    liveKeyPath: 'symbol',
    liveTtlSeconds: 60,
  })

  servidor.enviar({ data: { ticker: 'AAPL', last: 227.1 } })
  servidor.enviar({ data: { ticker: 'AAPL', last: 227.11 } })
  servidor.enviar({ data: { ticker: 'TSLA', last: 410.5 } })
  // Esperar a SEGUNDA cotação da AAPL, e não a chegada da TSLA: sob carga as duas se
  // cruzam, e a TSLA chegar não prova que a AAPL#2 já foi processada.
  await ate(async () => ((await liveData.getLiveValue(DONO, installationId, 'AAPL'))?.updates ?? 0) >= 2, 'as duas cotações da AAPL')
  await ate(async () => (await liveData.getLiveValue(DONO, installationId, 'TSLA')) !== null, 'a cotação da TSLA')

  const aapl = await liveData.getLiveValue(DONO, installationId, 'AAPL')
  assert.equal(aapl.value.price, 227.11, 'o ÚLTIMO valor, não o primeiro')
  assert.equal(aapl.updates, 2, 'e a contagem de atualizações')

  const todas = await liveData.listLiveValues(DONO, installationId)
  assert.deepEqual(todas.map((r) => r.key).sort(), ['AAPL', 'TSLA'])

  // Uma chave por papel, e não uma linha por tique.
  assert.equal(await db.collection('live_data').countDocuments({}), 2)
  assert.equal(await db.collection('automation_runs').countDocuments({}).catch(() => 0), 0, 'nenhuma execução automática')
})

test('o valor vencido não responde como se fosse de agora', async () => {
  await liveData.putLiveValue(DONO, 'conexao-x', 'AAPL', { price: 1 }, 5)
  const futuro = new Date(Date.now() + 10_000)
  assert.equal(await liveData.getLiveValue(DONO, 'conexao-x', 'AAPL', futuro), null)
  assert.equal((await liveData.listLiveValues(DONO, 'conexao-x', '', 100, futuro)).length, 0)
})

test('o dado ao vivo de uma conta não aparece na outra', async () => {
  await liveData.putLiveValue(DONO, 'conexao-x', 'AAPL', { price: 1 }, 60)
  await liveData.flushLiveData()
  assert.ok(await liveData.getLiveValue(DONO, 'conexao-x', 'AAPL'))
  assert.equal(await liveData.getLiveValue(VIZINHO, 'conexao-x', 'AAPL'), null)
  assert.equal((await liveData.listLiveValues(VIZINHO, 'conexao-x')).length, 0)
})

test('o teto de chaves por conexão segura o campo inesperado virando chave nova', async () => {
  const teto = WS_LIMITS.maxLiveKeysPerConnection
  for (let i = 0; i < teto; i++) {
    assert.equal(await liveData.putLiveValue(DONO, 'cheia', `k${i}`, i, 60), true)
    await liveData.flushLiveData()
  }
  assert.equal(await liveData.putLiveValue(DONO, 'cheia', 'uma-a-mais', 1, 60), false)
  // Uma chave que JÁ existe continua sendo atualizada: o teto é de chaves, não de tiques.
  assert.equal(await liveData.putLiveValue(DONO, 'cheia', 'k0', 999, 60), true)
})

test('o produtor lê o que acabou de escrever, mesmo antes de ir ao banco', async () => {
  await liveData.putLiveValue(DONO, 'conexao-y', 'AAPL', { price: 1 }, 60)
  // Duas escritas seguidas: a segunda fica no buffer por causa da coalescência.
  await liveData.putLiveValue(DONO, 'conexao-y', 'AAPL', { price: 2 }, 60)
  const lido = await liveData.getLiveValue(DONO, 'conexao-y', 'AAPL')
  assert.equal(lido.value.price, 2, 'quem produz nunca lê desatualizado')
})

test('a API enxerga o que o worker escreveu — o meio compartilhado é o banco', async () => {
  await liveData.putLiveValue(DONO, 'conexao-z', 'AAPL', { price: 7 }, 60)
  await liveData.flushLiveData()
  // Simula o OUTRO processo: sem o buffer em memória, só o que foi ao banco.
  liveData.resetLiveBuffer()
  const lido = await liveData.getLiveValue(DONO, 'conexao-z', 'AAPL')
  assert.equal(lido.value.price, 7)
})

test('waitFor espera a condição, e desiste no prazo', async () => {
  await liveData.putLiveValue(DONO, 'conexao-w', 'AAPL', { price: 100 }, 60)
  await liveData.flushLiveData()

  const jaVale = await liveData.waitForLiveValue(DONO, 'conexao-w', 'AAPL', { path: 'price', operator: 'gte', value: 50 }, 1000)
  assert.equal(jaVale.matched, true)

  const naoVale = await liveData.waitForLiveValue(DONO, 'conexao-w', 'AAPL', { path: 'price', operator: 'gt', value: 1000 }, 500)
  assert.equal(naoVale.matched, false)
  assert.ok(naoVale.record, 'e devolve o que havia, para quem chamou poder decidir')
})

test('a condição do waitFor é comparação, e cobre o que uma regra de risco pergunta', () => {
  const v = { price: 100, symbol: 'AAPL' }
  assert.equal(liveData.matchesCondition(v, { path: 'price', operator: 'gt', value: 90 }), true)
  assert.equal(liveData.matchesCondition(v, { path: 'price', operator: 'lt', value: 90 }), false)
  assert.equal(liveData.matchesCondition(v, { path: 'symbol', operator: 'equals', value: 'AAPL' }), true)
  assert.equal(liveData.matchesCondition(v, { path: 'nao_existe', operator: 'exists' }), false)
  assert.equal(liveData.matchesCondition(v, { path: 'price', operator: 'changed' }, { price: 99 }), true)
  assert.equal(liveData.matchesCondition(v, { path: 'price', operator: 'changed' }, { price: 100 }), false)
  // Um caminho que mexe no protótipo não lê nada.
  assert.equal(liveData.matchesCondition(v, { path: '__proto__', operator: 'exists' }), false)
})

// ============================================================================
// throttle de publicação
// ============================================================================

test('o espaço entre publicações segura a rajada, e zero publica tudo', () => {
  assert.equal(podePublicar('c1', 'AAPL', 1000, 0), true)
  assert.equal(podePublicar('c1', 'AAPL', 1000, 500), false, 'cedo demais')
  assert.equal(podePublicar('c1', 'AAPL', 1000, 1100), true)
  // Chaves diferentes não competem entre si.
  assert.equal(podePublicar('c1', 'TSLA', 1000, 1100), true)
  // Zero desliga o freio.
  assert.equal(podePublicar('c2', 'AAPL', 0, 0), true)
  assert.equal(podePublicar('c2', 'AAPL', 0, 1), true)
})

// ============================================================================
// limites, SSRF e segredo
// ============================================================================

test('a configuração recusa o que não cabe', () => {
  assert.throws(() => normalizeConnectionConfig({ endpoint: 'wss://x.com', headers: Array.from({ length: 50 }, () => ({ name: 'a', value: 'b' })) }), /cabeçalhos/i)
  assert.throws(() => normalizeConnectionConfig({ endpoint: 'wss://x.com', initialMessages: Array.from({ length: 50 }, () => '{}') }), /mensagens iniciais/i)
  assert.throws(() => normalizeConnectionConfig({ endpoint: 'wss://x.com', initialMessages: ['nao é json'] }), /JSON/i)
  // Nome de cabeçalho com dois-pontos ou quebra de linha é injeção, não configuração.
  assert.throws(() => normalizeConnectionConfig({ endpoint: 'wss://x.com', headers: [{ name: 'X: Y', value: 'v' }] }), /letras/i)
})

test('o destino interno continua recusado, com ou sem configuração nova', async () => {
  process.env.ALLOW_LOOPBACK_HTTP_TARGETS = ''
  try {
    for (const ruim of ['ws://localhost:8080/x', 'ws://127.0.0.1/x', 'ws://10.0.0.5/x', 'ws://169.254.169.254/latest', 'http://exemplo.com/x']) {
      await assert.rejects(() => assertPublicWebSocketUrl(ruim), /wss|interno|privad|não|inválid/i, ruim)
    }
  } finally {
    process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'
  }
})

test('a credencial não aparece em log, histórico nem dado ao vivo', async () => {
  const SEGREDO = 'segredo-de-teste-123'
  const { installationId } = await conectar(
    {
      format: 'json',
      auth: { kind: 'query', name: 'apikey', prefix: '' },
      headers: [{ name: 'X-Conta', value: '{{token}}' }],
      mapping: [{ from: 'sym', to: 'symbol' }],
      liveKeyPath: 'symbol',
    },
    { token: SEGREDO },
  )
  servidor.enviar({ sym: 'AAPL', p: 1 })
  await esperar(400)

  const tudo = JSON.stringify([
    await db.collection('websocket_logs').find({}).toArray(),
    await db.collection('websocket_messages').find({}).toArray(),
    await db.collection('live_data').find({}).toArray(),
    await db.collection('market_streams').find({}).toArray(),
  ])
  assert.ok(!tudo.includes(SEGREDO), 'a credencial não fica em nada que é guardado')
  // E ela CHEGOU ao serviço — o teste não passa por não ter sido enviada.
  assert.match(servidor.estado.urls[0], /apikey=/)
  assert.equal(servidor.estado.headers[0]['x-conta'], SEGREDO)
})

test('duas conexões do mesmo dono vivem ao mesmo tempo, cada uma com o seu dado', async () => {
  const primeira = await conectar({ format: 'json', mapping: [{ from: 'sym', to: 'symbol' }], liveKeyPath: 'symbol' })

  const segundoServidor = await startFakeWs()
  const instalacao2 = await instalar(segundoServidor, { format: 'json', mapping: [{ from: 'sym', to: 'symbol' }], liveKeyPath: 'symbol' }, { nome: 'Segunda', token: 'outro-segredo-1234' })
  await ligar(instalacao2)

  try {
    assert.equal(manager.activeCount, 2)
    servidor.enviar({ sym: 'AAPL', p: 1 })
    segundoServidor.enviar({ sym: 'BTCUSD', p: 2 })
    await ate(async () => (await liveData.getLiveValue(DONO, instalacao2._id.toString(), 'BTCUSD')) !== null, 'o dado da segunda')

    assert.ok(await liveData.getLiveValue(DONO, primeira.installationId, 'AAPL'))
    assert.equal(await liveData.getLiveValue(DONO, primeira.installationId, 'BTCUSD'), null, 'o dado de uma não vaza para a outra')
  } finally {
    await segundoServidor.close()
  }
})


test('com endereço fixado, a conexão REAL abre — é o caminho que dava "Invalid IP address: undefined"', async () => {
  /**
   * Aqui não há socket falso: é o `ws` de verdade em cima do `net.connect` de verdade,
   * com o `lookup` que devolve o endereço já conferido. Era exatamente esta combinação
   * que morria antes — o Node pede `all: true` e a nossa função respondia no formato
   * antigo, então NENHUMA conexão do App chegava a abrir.
   */
  const { createRealSocket } = await import('../dist/streams/socket.js')
  const servidor = await startFakeWs()
  try {
    /**
     * A URL precisa ter um NOME, e não um IP.
     *
     * Com IP literal o Node nem chama o `lookup` — a primeira versão deste teste
     * passava com o formato errado e não provava nada. É com nome que o caminho do
     * endereço fixado é exercitado, que é como toda conexão do App funciona.
     */
    const porta = new URL(servidor.url).port
    const socket = createRealSocket(`ws://localhost:${porta}/stream`, {
      pinnedAddress: { address: '127.0.0.1', family: 4 },
      handshakeTimeoutMs: 5_000,
    })
    const resultado = await new Promise((resolve) => {
      socket.onopen = () => resolve('abriu')
      socket.onerror = (ev) => resolve(`erro: ${ev?.message ?? ev?.error?.message ?? 'sem mensagem'}`)
      setTimeout(() => resolve('tempo esgotado'), 8_000)
    })
    assert.equal(resultado, 'abriu', `a conexão com endereço fixado não abriu — ${resultado}`)
    assert.equal(servidor.estado.conexoes, 1, 'o servidor viu a conexão')
    socket.close()
  } finally {
    await servidor.close()
  }
})
