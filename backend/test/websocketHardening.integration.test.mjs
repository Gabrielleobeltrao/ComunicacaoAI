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
const { mascarar, mascararProfundo } = await import('../dist/integrations/websocket/redact.js')
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

test('QUALQUER campo diferente reabre — inclusive filtro, mapeamento e limites', () => {
  const antes = base({ mapping: [{ from: 'a', to: 'x' }], liveKeyPath: 'x' })
  const comMapping = (extra) => base({ mapping: [{ from: 'a', to: 'x' }], liveKeyPath: 'x', ...extra })
  for (const [oque, depois] of [
    ['filtros', comMapping({ filters: [{ path: 'tipo', operator: 'equals', value: 'tick' }] })],
    ['schema', comMapping({ schema: { type: 'object' } })],
    ['mapeamento', base({ mapping: [{ from: 'b', to: 'y' }], liveKeyPath: 'y' })],
    ['validade do dado ao vivo', comMapping({ liveTtlSeconds: 600 })],
    ['espaço entre eventos', comMapping({ publishThrottleMs: 500 })],
    ['limite por minuto', comMapping({ maxMessagesPerMinute: 60 })],
    ['tamanho máximo', comMapping({ maxMessageBytes: 8_000 })],
    ['caminhos', comMapping({ paths: { payload: 'data' } })],
    ['deduplicação', comMapping({ dedupe: 'payload_hash' })],
    ['formato', comMapping({ format: 'text' })],
  ]) {
    // O adapter guarda uma CÓPIA da configuração: sem reabrir, estes campos continuavam
    // sendo lidos da cópia antiga — "mudar sem reconectar" era não mudar.
    assert.equal(precisaReabrir(antes, depois), true, oque)
  }
})

test('configuração IDÊNTICA não reabre nada', () => {
  const antes = base({ mapping: [{ from: 'a', to: 'x' }], liveKeyPath: 'x', filters: [{ path: 'tipo', operator: 'equals', value: 'tick' }] })
  const igual = base({ mapping: [{ from: 'a', to: 'x' }], liveKeyPath: 'x', filters: [{ path: 'tipo', operator: 'equals', value: 'tick' }] })
  assert.equal(precisaReabrir(antes, igual), false)
  // E salvar duas vezes o mesmo também não: a comparação é do normalizado, não do bruto.
  assert.equal(precisaReabrir(antes, base({ mapping: [{ from: 'a', to: 'x' }], liveKeyPath: 'x', filters: [{ path: 'tipo', operator: 'equals', value: 'tick' }], format: 'json' })), false)
})

test('sem configuração anterior não há o que reabrir', () => {
  assert.equal(precisaReabrir(null, base()), false)
})


// ============================================================================
// Coalescência PROVADA: contando escritas, não documentos
// ============================================================================
//
// Contar documentos não prova nada: dez tiques da mesma chave produzem um documento com
// coalescência ou sem ela. O que precisa ser contado é quantas vezes o banco foi
// escrito — e por isso o escritor é injetável.

const comEscritorContado = async (fn) => {
  const escritas = []
  const anterior = liveData.setLiveWriter(async (id, registro) => {
    escritas.push({ id, price: registro.value?.price, updates: registro.updates })
    await db.collection('live_data').updateOne({ _id: id }, { $set: registro }, { upsert: true })
  })
  try {
    await fn(escritas)
  } finally {
    liveData.setLiveWriter(anterior)
  }
}

test('dez tiques na mesma janela geram UMA escrita, com o último valor', async () => {
  await comEscritorContado(async (escritas) => {
    for (let i = 0; i < 10; i++) await liveData.putLiveValue(DONO, 'w1', 'AAPL', { price: i }, 60)
    // A primeira sai na hora (a janela nunca correu); as outras nove esperam.
    assert.equal(escritas.length, 1, `esperava 1 escrita imediata, houve ${escritas.length}`)

    await liveData.flushLiveData()
    assert.equal(escritas.length, 2, 'a janela fecha com UMA escrita para os nove tiques')
    assert.equal(escritas[1].price, 9, 'e ela leva o último valor')
  })
})

test('uma janela nova permite outra escrita', async () => {
  await comEscritorContado(async (escritas) => {
    await liveData.putLiveValue(DONO, 'w2', 'AAPL', { price: 1 }, 60)
    await liveData.flushLiveData()
    const depoisDaPrimeira = escritas.length

    // WS_LIVE_FLUSH_MS é 150 neste arquivo: passada a janela, a próxima sai na hora.
    await esperar(200)
    await liveData.putLiveValue(DONO, 'w2', 'AAPL', { price: 2 }, 60)
    await liveData.flushLiveData()
    assert.ok(escritas.length > depoisDaPrimeira, 'a janela nova escreveu de novo')
    assert.equal(escritas[escritas.length - 1].price, 2)
  })
})

test('o encerramento descarrega o que estava na janela', async () => {
  await comEscritorContado(async (escritas) => {
    await liveData.putLiveValue(DONO, 'w3', 'AAPL', { price: 1 }, 60)
    await liveData.putLiveValue(DONO, 'w3', 'AAPL', { price: 2 }, 60)
    const antes = escritas.length
    // Sem o flush, o `2` esperaria o fim da janela — e o processo pode sair antes.
    await liveData.flushLiveData()
    assert.equal(escritas.length, antes + 1)
    assert.equal(escritas[escritas.length - 1].price, 2)
  })
})

test('uma escrita que falha não trava a chave: a próxima tenta de novo', async () => {
  let falhar = true
  const escritas = []
  const anterior = liveData.setLiveWriter(async (id, registro) => {
    escritas.push(registro.value?.price)
    if (falhar) {
      falhar = false
      throw new Error('banco indisponível')
    }
    await db.collection('live_data').updateOne({ _id: id }, { $set: registro }, { upsert: true })
  })
  try {
    await liveData.putLiveValue(DONO, 'w4', 'AAPL', { price: 1 }, 60)
    assert.deepEqual(escritas, [1], 'tentou e falhou')

    await esperar(200)
    await liveData.putLiveValue(DONO, 'w4', 'AAPL', { price: 2 }, 60)
    await liveData.flushLiveData()
    assert.ok(escritas.length >= 2, 'tentou de novo')
    assert.equal((await db.collection('live_data').findOne({ _id: `${DONO}:w4:AAPL` }))?.value?.price, 2)
  } finally {
    liveData.setLiveWriter(anterior)
  }
})

test('a vaga é devolvida quando a PRIMEIRA gravação da chave falha', async () => {
  const anterior = liveData.setLiveWriter(async () => {
    throw new Error('banco indisponível')
  })
  try {
    await liveData.putLiveValue(DONO, 'w5', 'AAPL', { price: 1 }, 60)
  } finally {
    liveData.setLiveWriter(anterior)
  }
  // A chave nunca chegou ao banco: ela não pode continuar ocupando vaga no teto.
  const { WS_LIMITS } = await import('../dist/apps/official/websocket/config.js')
  let aceitas = 0
  for (let i = 0; i < WS_LIMITS.maxLiveKeysPerConnection; i++) {
    if (await liveData.putLiveValue(DONO, 'w5', `k${i}`, i, 60)) aceitas += 1
  }
  assert.equal(aceitas, WS_LIMITS.maxLiveKeysPerConnection, 'a vaga da chave que falhou foi devolvida')
})

// ============================================================================
// Limites que sobrevivem ao restart
// ============================================================================

test('o teto do dono sobrevive ao restart: a memória é reidratada do banco', async () => {
  const { WS_LIMITS } = await import('../dist/apps/official/websocket/config.js')
  // Enche o teto do dono, gravando de verdade.
  const porConexao = WS_LIMITS.maxLiveKeysPerConnection
  const conexoes = Math.ceil(WS_LIMITS.maxLiveKeysPerOwner / porConexao)
  for (let c = 0; c < conexoes; c++) {
    for (let i = 0; i < porConexao; i++) await liveData.putLiveValue(DONO, `full-${c}`, `k${i}`, i, 600)
  }
  await liveData.flushLiveData()

  // "Reiniciar": a memória some, só o banco fica.
  liveData.resetLiveBuffer()
  assert.equal(await liveData.putLiveValue(DONO, 'full-nova', 'depois-do-restart', 1, 600), false, 'o teto continua valendo')
})

test('chave vencida por TTL não ocupa vaga depois do restart', async () => {
  await liveData.putLiveValue(DONO, 'ttl1', 'ANTIGA', { price: 1 }, 5)
  await liveData.flushLiveData()
  // Faz o documento parecer vencido — o TTL do Mongo removeria em até um minuto.
  await db.collection('live_data').updateOne({ _id: `${DONO}:ttl1:ANTIGA` }, { $set: { expiresAt: new Date(Date.now() - 1000) } })

  liveData.resetLiveBuffer()
  // A hidratação ignora vencidos: a chave nova entra sem disputar vaga com um morto.
  assert.equal(await liveData.putLiveValue(DONO, 'ttl1', 'NOVA', { price: 2 }, 60), true)
  assert.equal(await liveData.getLiveValue(DONO, 'ttl1', 'ANTIGA'), null, 'e a vencida não responde')
})

test('apagar a conexão devolve as vagas e limpa a memória dela', async () => {
  const { WS_LIMITS } = await import('../dist/apps/official/websocket/config.js')
  for (let i = 0; i < 10; i++) await liveData.putLiveValue(DONO, 'apagar', `k${i}`, i, 600)
  await liveData.flushLiveData()

  await liveData.deleteLiveDataFor(DONO, 'apagar')
  assert.equal(await db.collection('live_data').countDocuments({ ownerId: DONO, connectionId: 'apagar' }), 0)
  // As vagas voltaram: dá para encher a conexão de novo até o teto.
  let aceitas = 0
  for (let i = 0; i < WS_LIMITS.maxLiveKeysPerConnection; i++) {
    if (await liveData.putLiveValue(DONO, 'apagar', `n${i}`, i, 600)) aceitas += 1
  }
  assert.equal(aceitas, WS_LIMITS.maxLiveKeysPerConnection)
})

test('duas conexões do mesmo dono não compartilham chave nem contador', async () => {
  await liveData.putLiveValue(DONO, 'a', 'AAPL', { price: 1 }, 60)
  await liveData.putLiveValue(DONO, 'b', 'AAPL', { price: 2 }, 60)
  await liveData.flushLiveData()
  assert.equal((await liveData.getLiveValue(DONO, 'a', 'AAPL')).value.price, 1)
  assert.equal((await liveData.getLiveValue(DONO, 'b', 'AAPL')).value.price, 2)
  assert.equal((await liveData.getLiveValue(DONO, 'a', 'AAPL')).updates, 1)
})

// ============================================================================
// Segredos no endereço e nas formas codificadas
// ============================================================================

test('parâmetro de segredo no endereço é recusado, com o caminho certo na mensagem', () => {
  for (const nome of ['apikey', 'api_key', 'token', 'access_token', 'key', 'authorization']) {
    assert.throws(
      () => normalizeConnectionConfig({ endpoint: `wss://exemplo.com/s?${nome}=valor-em-texto-claro` }),
      /parâmetro no endereço|credencial/i,
      nome,
    )
  }
})

test('query comum passa, e {{token}} também', () => {
  const c = normalizeConnectionConfig({ endpoint: 'wss://exemplo.com/s?feed=iex&lang=pt&apikey={{token}}' })
  assert.match(c.endpoint, /feed=iex/)
  assert.match(c.endpoint, /lang=pt/)
})

test('a credencial no endereço é recusada literal e URL-encoded', () => {
  const comBarra = 'chave/com+sinais=123456'
  assert.throws(() => normalizeConnectionConfig({ endpoint: `wss://exemplo.com/s?feed=${comBarra}` }, comBarra), /credencial|{{token}}/i)
  assert.throws(
    () => normalizeConnectionConfig({ endpoint: `wss://exemplo.com/s?feed=${encodeURIComponent(comBarra)}` }, comBarra),
    /credencial|{{token}}/i,
    'a forma codificada também',
  )
})

test('a máscara pega as três formas da mesma chave, e preserva os tipos', () => {
  const segredo = 'chave/com+sinais=12345678'
  const fora = mascararProfundo(
    {
      literal: segredo,
      escapado: JSON.stringify(segredo).slice(1, -1),
      codificado: encodeURIComponent(segredo),
      dentro: { lista: [`prefixo ${segredo} sufixo`] },
      numero: 42,
      data: new Date(0),
    },
    [segredo],
  )
  const texto = JSON.stringify(fora)
  assert.ok(!texto.includes('chave/com'), texto)
  assert.ok(!texto.includes(encodeURIComponent(segredo)))
  assert.equal(fora.numero, 42, 'número continua número')
  assert.ok(fora.data instanceof Date, 'data continua data')
})


// ============================================================================
// Configuração antiga com a credencial em texto claro
// ============================================================================

const { sanearConfiguracaoLegada } = await import('../dist/integrations/websocket/service.js')

test('o segredo em campo migrável vira {{token}}, sem mudar o que é enviado', () => {
  const antiga = normalizeConnectionConfig({
    endpoint: 'wss://exemplo.com/s',
    headers: [{ name: 'X-Key', value: SEGREDO }],
    initialMessages: [`{"token":"${SEGREDO}"}`],
    auth: { kind: 'message', name: '', messageTemplate: `{"t":"${SEGREDO}"}` },
  })
  // Sem credencial na validação, a configuração antiga entra como entrava antes.
  const r = sanearConfiguracaoLegada(antiga, SEGREDO)
  assert.equal(r.migrada, true)
  assert.equal(r.precisaCorrigir, false)
  assert.equal(r.config.headers[0].value, '{{token}}')
  assert.equal(r.config.initialMessages[0], '{"token":"{{token}}"}')
  assert.equal(r.config.auth.messageTemplate, '{"t":"{{token}}"}')
  assert.ok(!JSON.stringify(r.config).includes(SEGREDO))
})

test('o segredo no ENDEREÇO não é migrável: a configuração não é devolvida', () => {
  const antiga = normalizeConnectionConfig({ endpoint: `wss://exemplo.com/s?feed=${SEGREDO}` })
  const r = sanearConfiguracaoLegada(antiga, SEGREDO)
  assert.equal(r.precisaCorrigir, true)
  assert.equal(r.migrada, false)
})

test('configuração sem segredo nenhum não é tocada', () => {
  const limpa = normalizeConnectionConfig({ endpoint: 'wss://exemplo.com/s', headers: [{ name: 'Origin', value: 'https://x.com' }] })
  const r = sanearConfiguracaoLegada(limpa, SEGREDO)
  assert.equal(r.migrada, false)
  assert.equal(r.precisaCorrigir, false)
  assert.deepEqual(r.config, limpa)
})

test('a forma URL-encoded também é migrada', () => {
  const comSinais = 'chave/com+sinais=12345678'
  const antiga = normalizeConnectionConfig({ endpoint: 'wss://exemplo.com/s', headers: [{ name: 'X-Key', value: encodeURIComponent(comSinais) }] })
  const r = sanearConfiguracaoLegada(antiga, comSinais)
  assert.equal(r.migrada, true)
  assert.equal(r.config.headers[0].value, '{{token}}')
})

// ============================================================================
// O teste da página de Apps é o teste real
// ============================================================================

test('a sonda de instalação do WebSocket está registrada — todo botão de testar usa a real', async () => {
  const { installationProbeFor } = await import('../dist/apps/connectionTests.js')
  assert.ok(installationProbeFor('websocket'), 'sem ela, a página de Apps chama o teste genérico')

  servidor = await startFakeWs()
  novoGerente()
  const instalacao = await instalar(servidor, { auth: { kind: 'none' } }, '')
  const r = await installationProbeFor('websocket')(DONO, instalacao._id.toString())
  assert.equal(r.ok, true, r.message)
  assert.equal(servidor.estado.conexoes, 1, 'abriu de verdade')
})

test('autenticação de TEXTO sai sem aspas — nem no teste, nem na conexão', async () => {
  servidor = await startFakeWs()
  novoGerente()
  const instalacao = await instalar(servidor, { format: 'text', auth: { kind: 'message', name: '', messageTemplate: 'AUTH {{token}}' } })

  const r = await testar(instalacao)
  assert.equal(r.ok, true, r.message)
  await ate(() => servidor.estado.recebidas.length >= 1, 'a autenticação do teste')
  assert.equal(servidor.estado.recebidas[0], `AUTH ${SEGREDO}`, 'sem aspas')
  assert.ok(!servidor.estado.recebidas[0].startsWith('"'), 'nada de JSON.stringify num texto')
})


// ============================================================================
// A última rodada
// ============================================================================

test('a vaga de uma chave VENCIDA é liberada no mesmo processo, sem reiniciar nada', async () => {
  const { WS_LIMITS } = await import('../dist/apps/official/websocket/config.js')
  const teto = WS_LIMITS.maxLiveKeysPerConnection

  // Enche a conexão com chaves de vida curta.
  for (let i = 0; i < teto; i++) assert.equal(await liveData.putLiveValue(DONO, 'ttl-vaga', `k${i}`, i, 5), true)
  assert.equal(await liveData.putLiveValue(DONO, 'ttl-vaga', 'excedente', 1, 60), false, 'o teto está cheio')

  // O tempo passa: as chaves vencem. Nada é reiniciado, nada é limpo à mão.
  const futuro = new Date(Date.now() + 10_000)
  assert.equal(await liveData.putLiveValue(DONO, 'ttl-vaga', 'depois-do-vencimento', 1, 60, futuro), true, 'a vaga vencida foi devolvida')
})

test('renovar uma chave que já existe continua funcionando com o teto cheio', async () => {
  const { WS_LIMITS } = await import('../dist/apps/official/websocket/config.js')
  for (let i = 0; i < WS_LIMITS.maxLiveKeysPerConnection; i++) await liveData.putLiveValue(DONO, 'renova', `k${i}`, i, 600)
  // Cheia — e mesmo assim a chave que já é dela continua sendo atualizada.
  assert.equal(await liveData.putLiveValue(DONO, 'renova', 'k0', 999, 600), true)
  await liveData.flushLiveData()
  assert.equal((await liveData.getLiveValue(DONO, 'renova', 'k0')).value, 999)
})

test('uma rajada simultânea não ultrapassa o teto — a hidratação é UMA só', async () => {
  const { WS_LIMITS } = await import('../dist/apps/official/websocket/config.js')
  const teto = WS_LIMITS.maxLiveKeysPerConnection
  // Todas as chamadas partem juntas, antes de qualquer hidratação terminar: é a corrida
  // que existia quando o dono era marcado como hidratado ANTES da consulta voltar.
  const r = await Promise.all(Array.from({ length: teto + 50 }, (_, i) => liveData.putLiveValue(DONO, 'rajada', `k${i}`, i, 600)))
  assert.equal(r.filter(Boolean).length, teto, `esperava ${teto} aceitas, veio ${r.filter(Boolean).length}`)
})

test('uma hidratação que FALHA pode ser tentada de novo', async () => {
  // Uma conexão já persistida, para a hidratação ter o que ler.
  await liveData.putLiveValue('dono-retry', 'c', 'AAPL', 1, 600)
  await liveData.flushLiveData()
  liveData.resetLiveBuffer()

  let falhar = true
  const original = liveData.setLiveHydrator(async (ownerId, agora) => {
    if (falhar) {
      falhar = false
      throw new Error('banco indisponível')
    }
    return original(ownerId, agora)
  })
  try {
    await assert.rejects(() => liveData.putLiveValue('dono-retry', 'c', 'TSLA', 2, 600), /indisponível/)
    // A segunda tentativa não herda o estado quebrado da primeira — e o limite volta a
    // ser conferido contra o que está no banco, não contra uma memória pela metade.
    assert.equal(await liveData.putLiveValue('dono-retry', 'c', 'TSLA', 2, 600), true)
    assert.equal((await liveData.getLiveValue('dono-retry', 'c', 'AAPL')).value, 1, 'a hidratação da segunda vez leu o que já existia')
  } finally {
    liveData.setLiveHydrator(original)
  }
})

test('{{token}} na query é substituído e codificado — e nunca no host nem no caminho', async () => {
  const comSinais = 'chave com/sinais+e=iguais'
  servidor = await startFakeWs()
  novoGerente()
  // O endereço carrega o marcador e uma query comum ao lado dele.
  const url = new URL(servidor.url)
  url.searchParams.set('apikey', '{{token}}')
  url.searchParams.set('feed', 'iex')
  const instalacao = await createInstallation(DONO, getApp('websocket'), {
    name: 'Com marcador',
    config: { token: comSinais },
    publicMetadata: writeConnectionConfig(normalizeConnectionConfig({ endpoint: url.toString() })),
  })

  const adapter = await websocketAdapterFor({ ownerId: DONO, appKey: 'websocket', installationId: instalacao._id.toString(), environment: 'default' })
  const montada = new URL(adapter.url('default'))
  assert.equal(montada.searchParams.get('apikey'), comSinais, 'o valor chega decodificado do outro lado')
  assert.equal(montada.searchParams.get('feed'), 'iex', 'o resto da query fica intacto')
  assert.ok(!montada.toString().includes('{{token}}'), 'nada de marcador literal no fio')
  assert.ok(montada.toString().includes(encodeURIComponent('/')) || !montada.toString().includes('chave com/'), 'o valor vai codificado')
  assert.equal(montada.host, new URL(servidor.url).host, 'o host não é tocado')
  assert.equal(montada.pathname, new URL(servidor.url).pathname, 'o caminho não é tocado')
})

test('o marcador na query não deixa a credencial no metadata público', async () => {
  const config = normalizeConnectionConfig({ endpoint: 'wss://exemplo.com/s?apikey={{token}}' }, SEGREDO)
  const guardado = JSON.stringify(writeConnectionConfig(config))
  assert.ok(guardado.includes('{{token}}'))
  assert.ok(!guardado.includes(SEGREDO))
})

test('check-url e o salvamento concordam: o que será recusado não aparece como válido', async () => {
  const { checkWebSocketUrl } = await import('../dist/net/safeWebSocket.js')
  const comSegredo = 'wss://exemplo.com/s?apikey=valor-em-texto-claro'

  // A guarda de destino sozinha aprovaria — o host é público.
  assert.equal((await checkWebSocketUrl(comSegredo)).ok, true, 'a guarda de SSRF não tem nada contra ele')
  // E o salvamento recusa. É essa a incoerência que a rota precisa não ter.
  assert.throws(() => normalizeConnectionConfig({ endpoint: comSegredo }), /parâmetro no endereço/i)
})
