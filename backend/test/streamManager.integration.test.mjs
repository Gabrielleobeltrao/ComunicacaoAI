// O GERENCIADOR de streams: manter uma conexão de longa duração de pé sem virar um
// cliente que martela o provider, e sem nunca deixar a credencial escapar.
//
// Nada de rede aqui: o socket é falso e o relógio é nosso. O que está sendo provado é
// a máquina de estados — quando reconecta, quando NÃO reconecta, e o que fica gravado.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.APP_ENCRYPTION_KEY ||= 'chave-de-teste-com-32-caracteres!'
// Marcados para o relógio falso saber qual timer é qual. O de reconexão é o único que
// não tem duração fixa (é o backoff), e é assim que ele é reconhecido abaixo.
process.env.STREAM_HEARTBEAT_MS = '11111'
process.env.STREAM_IDLE_TIMEOUT_MS = '22222'
process.env.STREAM_MAX_RECONNECTS = '3'

const { StreamManager, setStreamManager } = await import('../dist/streams/manager.js')
const { upsertStream, ensureStreamIndexes, findStream, setStreamPaused } = await import('../dist/streams/repository.js')
const { ensureStream, registerStreamAdapter, clearStreamAdapters, streamAdapters, restoreStreams, normalizeSymbols, testStreamConnection } =
  await import('../dist/streams/service.js')
const { MAX_STREAMS_PER_OWNER } = await import('../dist/streams/types.js')
const { createPrivateApp, resolveAppForOwner } = await import('../dist/apps/privateApps.js')
const { createInstallation, patchInstallation } = await import('../dist/apps/installations.js')
const { db, mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const DONO = 'dono-stream'
const SEGREDO = 'chave-secreta-do-provider'

const MANIFESTO = {
  key: 'corretora_teste',
  version: '1.0.0',
  source: 'private',
  name: 'Corretora de Teste',
  description: 'Um provider de mercado de exemplo.',
  categories: ['finance'],
  auth: { kind: 'api_key', fields: [{ key: 'apiKey', label: 'Chave', secret: true }], scopes: [] },
  allowedDomains: ['stream.corretora-teste.com'],
  supportsMultipleConnections: true,
  actions: [],
  status: 'active',
}

// --- o socket falso ------------------------------------------------------------------

class SocketFalso {
  constructor(url) {
    this.url = url
    this.enviadas = []
    this.fechado = false
    SocketFalso.abertos.push(this)
  }
  send(data) {
    this.enviadas.push(data)
  }
  close() {
    this.fechado = true
  }
  // Simular o outro lado.
  abrir() {
    this.onopen?.({})
  }
  receber(obj) {
    this.onmessage?.({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) })
  }
  cair() {
    this.fechado = true
    this.onclose?.({})
  }
}
SocketFalso.abertos = []

// As transições passam por escrita no banco, e escrita no banco não cabe num
// `setImmediate`. Esperar a CONDIÇÃO em vez de um tique evita um teste que passa na
// máquina rápida e falha na lenta.
async function ate(condicao, oque = 'condição') {
  for (let i = 0; i < 200; i += 1) {
    if (await condicao()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error(`esperei demais por: ${oque}`)
}

// Um relógio que não passa sozinho: nada acontece até o teste mandar.
function relogioFalso() {
  const pendentes = new Map()
  let seq = 0
  return {
    pendentes,
    schedule: (fn, ms) => {
      const id = (seq += 1)
      pendentes.set(id, { fn, ms })
      return { id, unref() {} }
    },
    cancel: (t) => pendentes.delete(t?.id),
    // O timer de reconexão é o único com duração variável (o backoff) — é assim que
    // ele é reconhecido, sem o teste precisar saber o número.
    ehReconexao: (t) => t.ms !== 11111 && t.ms !== 22222,
    temReconexao() {
      return [...pendentes.values()].some((t) => t.ms !== 11111 && t.ms !== 22222)
    },
    dispararReconexao() {
      for (const [id, t] of [...pendentes]) {
        if (t.ms !== 11111 && t.ms !== 22222) {
          pendentes.delete(id)
          t.fn()
        }
      }
    },
    dispararSilencio() {
      for (const [id, t] of [...pendentes]) {
        if (t.ms === 22222) {
          pendentes.delete(id)
          t.fn()
        }
      }
    },
  }
}

const ADAPTER = {
  appKey: 'corretora_teste',
  url: (env) => `wss://stream.corretora-teste.com/${env}`,
  authMessage: (cred) => ({ action: 'auth', key: cred.apiKey }),
  subscribeMessage: (symbols) => ({ action: 'subscribe', trades: symbols }),
  unsubscribeMessage: (symbols) => ({ action: 'unsubscribe', trades: symbols }),
  heartbeatMessage: () => ({ action: 'ping' }),
  errorOf: (raw) => (raw?.T === 'error' ? String(raw.msg) : null),
  parse: (raw, ctx) => {
    if (raw?.T !== 't') return []
    return [
      {
        ownerId: ctx.ownerId,
        type: 'market.price.updated',
        source: ctx.source,
        payload: { symbol: raw.S, price: raw.p },
        occurredAt: new Date(raw.t),
        dedupeKey: `${ctx.streamId}:${raw.S}:${raw.i}`,
      },
    ]
  },
}

let publicados = []
const publicarFalso = async (entrada) => {
  const repetido = publicados.some((p) => p.dedupeKey === entrada.dedupeKey)
  publicados.push(entrada)
  return { event: { ...entrada, _id: 'x' }, created: !repetido }
}

function gerente(over = {}) {
  const relogio = over.relogio ?? relogioFalso()
  const m = new StreamManager({
    adapters: streamAdapters(),
    createSocket: (url) => new SocketFalso(url),
    credentialsOf: over.credentialsOf ?? (async () => ({ apiKey: SEGREDO })),
    publish: publicarFalso,
    schedule: relogio.schedule,
    cancel: relogio.cancel,
    ...over,
  })
  return { m, relogio }
}

const app = () => resolveAppForOwner(DONO, MANIFESTO.key)
const conectar = async (over = {}) =>
  createInstallation(DONO, await app(), { name: over.name ?? 'Corretora principal', config: { apiKey: SEGREDO }, ...over })

before(async () => {
  await ensureStreamIndexes()
  await createPrivateApp(DONO, MANIFESTO)
})

beforeEach(async () => {
  await db.collection('market_streams').deleteMany({})
  await db.collection('connections').deleteMany({})
  SocketFalso.abertos = []
  publicados = []
  clearStreamAdapters()
  registerStreamAdapter(ADAPTER)
  setStreamManager(null)
})

const streamDe = async (symbols = ['PETR4']) => {
  const conexao = await conectar()
  return upsertStream({ ownerId: DONO, installationId: conexao._id.toString(), appKey: MANIFESTO.key, environment: 'default', symbols })
}

// --- ligar --------------------------------------------------------------------------

test('ao abrir, manda a autenticação e depois o subscribe — nessa ordem', async () => {
  const { m } = gerente()
  const record = await streamDe(['PETR4', 'VALE3'])
  await m.start(record)
  const [socket] = SocketFalso.abertos
  assert.equal(socket.url, 'wss://stream.corretora-teste.com/default')
  socket.abrir()
  assert.equal(m.stateOf(record._id.toString()), 'connected')
  assert.deepEqual(JSON.parse(socket.enviadas[0]), { action: 'auth', key: SEGREDO })
  assert.deepEqual(JSON.parse(socket.enviadas[1]), { action: 'subscribe', trades: ['PETR4', 'VALE3'] })
})

test('a credencial vai para o socket e para lugar nenhum mais', async () => {
  const { m } = gerente()
  const record = await streamDe()
  await m.start(record)
  SocketFalso.abertos[0].abrir()
  // Um erro do provider costuma vir com o eco da mensagem de autenticação junto.
  SocketFalso.abertos[0].receber({ T: 'error', msg: `auth failed for key ${SEGREDO}` })
  await ate(async () => (await findStream(DONO, record._id))?.lastError, 'o erro ser gravado')
  const doc = await db.collection('market_streams').findOne({ _id: record._id })
  const json = JSON.stringify(doc)
  assert.ok(!json.includes(SEGREDO), 'o documento do stream não guarda credencial, nem dentro da mensagem de erro')
  assert.match(doc.lastError.message, /auth failed/)
})

test('ligar duas vezes não abre uma segunda conexão', async () => {
  const { m } = gerente()
  const record = await streamDe()
  await m.start(record)
  await m.start(record)
  assert.equal(SocketFalso.abertos.length, 1)
  assert.equal(m.activeCount, 1)
})

test('um stream pausado não sobe', async () => {
  const { m } = gerente()
  const record = await streamDe()
  await m.start({ ...record, paused: true })
  assert.equal(SocketFalso.abertos.length, 0)
})

test('sem adapter registrado, o stream não sobe e diz por quê', async () => {
  clearStreamAdapters()
  const { m } = gerente()
  const record = await streamDe()
  await m.start(record)
  assert.equal(SocketFalso.abertos.length, 0)
  const doc = await findStream(DONO, record._id)
  assert.match(doc.lastError.message, /adapter/)
})

// --- receber ------------------------------------------------------------------------

test('um trade vira evento; um ack de controle não vira nada', async () => {
  const { m } = gerente()
  const record = await streamDe()
  await m.start(record)
  const s = SocketFalso.abertos[0]
  s.abrir()
  s.receber({ T: 'subscription', trades: ['PETR4'] })
  s.receber({ T: 't', S: 'PETR4', p: 38.4, i: 1, t: '2026-01-05T12:00:00Z' })
  await ate(async () => (await findStream(DONO, record._id))?.eventCount === 1, 'o evento ser contado')
  assert.equal(publicados.length, 1)
  assert.equal(publicados[0].type, 'market.price.updated')
  assert.deepEqual(publicados[0].payload, { symbol: 'PETR4', price: 38.4 })
  const doc = await findStream(DONO, record._id)
  assert.equal(doc.eventCount, 1)
  assert.ok(doc.lastEventAt)
})

test('o eco da reconexão não conta como fato novo', async () => {
  const { m } = gerente()
  const record = await streamDe()
  await m.start(record)
  const s = SocketFalso.abertos[0]
  s.abrir()
  const trade = { T: 't', S: 'PETR4', p: 38.4, i: 7, t: '2026-01-05T12:00:00Z' }
  s.receber(trade)
  s.receber(trade)
  await ate(async () => publicados.length === 2, 'as duas mensagens serem processadas')
  await ate(async () => (await findStream(DONO, record._id))?.eventCount === 1, 'a primeira ser contada')
  // E fica em uma: a segunda não incrementa nunca, não é só demora.
  await new Promise((r) => setTimeout(r, 30))
  const doc = await findStream(DONO, record._id)
  // Duas mensagens, uma contagem: a dedupeKey do adapter é quem segura isso.
  assert.equal(doc.eventCount, 1)
})

test('um quadro que não é JSON é ignorado sem derrubar a conexão', async () => {
  const { m } = gerente()
  const record = await streamDe()
  await m.start(record)
  const s = SocketFalso.abertos[0]
  s.abrir()
  s.receber('pong')
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(m.stateOf(record._id.toString()), 'connected')
  assert.equal(publicados.length, 0)
})

// --- reconectar ---------------------------------------------------------------------

test('caiu, reconecta — e a espera é crescente, não imediata', async () => {
  const { m, relogio } = gerente()
  const record = await streamDe()
  await m.start(record)
  SocketFalso.abertos[0].abrir()
  SocketFalso.abertos[0].cair()
  // Esperar o AGENDAMENTO, não só o estado: entre virar `reconnecting` e o timer
  // existir há uma escrita no banco, e disparar antes disso não dispararia nada.
  await ate(async () => relogio.temReconexao(), 'a reconexão ser agendada')

  assert.equal(m.stateOf(record._id.toString()), 'reconnecting')
  // Reconexão AGENDADA, não imediata: bater no mesmo instante em que caiu é como um
  // provider fora do ar continua fora do ar.
  assert.equal(SocketFalso.abertos.length, 1)
  relogio.dispararReconexao()
  await ate(async () => SocketFalso.abertos.length === 2, 'a segunda conexão')
  assert.equal(SocketFalso.abertos.length, 2, 'a segunda conexão só existe depois da espera')
  SocketFalso.abertos[1].abrir()
  assert.equal(m.stateOf(record._id.toString()), 'connected')
})

test('depois de reconectar, os símbolos voltam sozinhos', async () => {
  const { m, relogio } = gerente()
  const record = await streamDe(['PETR4'])
  await m.start(record)
  SocketFalso.abertos[0].abrir()
  SocketFalso.abertos[0].cair()
  await ate(async () => relogio.temReconexao(), 'a reconexão ser agendada')
  relogio.dispararReconexao()
  await ate(async () => SocketFalso.abertos.length === 2, 'a segunda conexão')
  SocketFalso.abertos[1].abrir()
  // Sem isto o stream voltaria conectado e mudo — o pior estado possível, porque
  // parece que está funcionando.
  assert.deepEqual(JSON.parse(SocketFalso.abertos[1].enviadas[1]), { action: 'subscribe', trades: ['PETR4'] })
})

test('conectado e mudo é tratado como caído', async () => {
  const { m, relogio } = gerente()
  const record = await streamDe()
  await m.start(record)
  SocketFalso.abertos[0].abrir()
  relogio.dispararSilencio()
  await ate(async () => m.stateOf(record._id.toString()) === 'reconnecting', 'tratar o silêncio como queda')
  assert.equal(SocketFalso.abertos[0].fechado, true)
  assert.equal(m.stateOf(record._id.toString()), 'reconnecting')
})

test('desiste depois do limite em vez de bater para sempre', async () => {
  const { m, relogio } = gerente()
  const record = await streamDe()
  await m.start(record)
  // Nunca abre: um provider fora do ar aceita a conexão TCP e fecha em seguida. Se
  // abrisse, o contador zeraria a cada vez — como zera de verdade quando a conexão
  // volta — e ele bateria para sempre, que é exatamente o que este teste proíbe.
  for (let i = 0; i < 10 && m.activeCount > 0; i += 1) {
    const antes = SocketFalso.abertos.length
    SocketFalso.abertos[antes - 1].cair()
    await ate(async () => relogio.temReconexao() || m.activeCount === 0, 'a próxima decisão')
    if (m.activeCount === 0) break
    relogio.dispararReconexao()
    await ate(async () => SocketFalso.abertos.length > antes || m.activeCount === 0, 'reconectar ou desistir')
  }
  assert.equal(m.stateOf(record._id.toString()), 'disconnected', 'saiu do ar: não está mais sendo gerenciado')
  // O gerenciador larga o stream ANTES de terminar de gravar o motivo — esperar a
  // gravação é do teste, não um sintoma.
  await ate(async () => (await findStream(DONO, record._id))?.state === 'error', 'o motivo ser gravado')
  const doc = await findStream(DONO, record._id)
  assert.equal(doc.state, 'error')
  assert.match(doc.lastError.message, /desistindo/)
})

test('parar é definitivo: o fechamento que chega depois não reconecta', async () => {
  const { m, relogio } = gerente()
  const record = await streamDe()
  await m.start(record)
  const s = SocketFalso.abertos[0]
  s.abrir()
  await m.stop(record._id.toString())
  s.cair()
  relogio.dispararReconexao()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(SocketFalso.abertos.length, 1)
  assert.equal(m.activeCount, 0)
})

test('parar o que já está parado não é erro', async () => {
  const { m } = gerente()
  await m.stop('000000000000000000000000')
  assert.equal(m.activeCount, 0)
})

test('conexão revogada não reconecta — e o motivo fica gravado', async () => {
  const conexao = await conectar()
  const record = await upsertStream({
    ownerId: DONO,
    installationId: conexao._id.toString(),
    appKey: MANIFESTO.key,
    environment: 'default',
    symbols: ['PETR4'],
  })
  const { m } = gerente({ credentialsOf: async () => null })
  await m.start(record)
  assert.equal(SocketFalso.abertos.length, 0, 'não se bate numa porta que foi fechada de propósito')
  const doc = await findStream(DONO, record._id)
  assert.match(doc.lastError.message, /indispon/)
})

// --- inscrições ---------------------------------------------------------------------

test('inscrever o que já está inscrito não manda mensagem nova', async () => {
  const { m } = gerente()
  const record = await streamDe(['PETR4'])
  await m.start(record)
  const s = SocketFalso.abertos[0]
  s.abrir()
  const antes = s.enviadas.length
  await m.subscribe(record._id.toString(), ['PETR4'])
  assert.equal(s.enviadas.length, antes)
  await m.subscribe(record._id.toString(), ['PETR4', 'VALE3'])
  assert.deepEqual(JSON.parse(s.enviadas[antes]), { action: 'subscribe', trades: ['VALE3'] })
})

test('desinscrever o que não estava inscrito não manda mensagem', async () => {
  const { m } = gerente()
  const record = await streamDe(['PETR4'])
  await m.start(record)
  const s = SocketFalso.abertos[0]
  s.abrir()
  const antes = s.enviadas.length
  await m.unsubscribe(record._id.toString(), ['ITUB4'])
  assert.equal(s.enviadas.length, antes)
})

// --- restart e limites ----------------------------------------------------------------

test('o que estava de pé volta depois do restart do worker', async () => {
  const { m } = gerente()
  const record = await streamDe(['PETR4'])
  await m.start(record)
  SocketFalso.abertos[0].abrir()

  // O worker morre: a memória some, o documento fica.
  SocketFalso.abertos = []
  const { m: novo } = gerente()
  setStreamManager(novo)
  const quantos = await restoreStreams()
  assert.equal(quantos, 1)
  assert.equal(SocketFalso.abertos.length, 1)
  assert.equal(SocketFalso.abertos[0].url, 'wss://stream.corretora-teste.com/default')
})

test('um stream pausado não volta no restart', async () => {
  const record = await streamDe()
  await setStreamPaused(DONO, record._id, true)
  const { m } = gerente()
  setStreamManager(m)
  assert.equal(await restoreStreams(), 0)
  assert.equal(SocketFalso.abertos.length, 0)
})

test('o teto de streams por conta é respeitado', async () => {
  const { m } = gerente()
  setStreamManager(m)
  const ids = []
  for (let i = 0; i < MAX_STREAMS_PER_OWNER; i += 1) {
    const c = await conectar({ name: `Corretora ${i}` })
    ids.push(c._id.toString())
    await ensureStream(DONO, c._id.toString(), ['PETR4'])
  }
  const excedente = await conectar({ name: 'Corretora a mais' })
  await assert.rejects(() => ensureStream(DONO, excedente._id.toString(), ['PETR4']), /limite/)
  // E renovar um que já existe nunca esbarra no teto.
  await ensureStream(DONO, ids[0], ['PETR4', 'VALE3'])
})

test('pedir o mesmo stream de novo não cria um segundo', async () => {
  const { m } = gerente()
  setStreamManager(m)
  const c = await conectar()
  const a = await ensureStream(DONO, c._id.toString(), ['PETR4'])
  const b = await ensureStream(DONO, c._id.toString(), ['PETR4'])
  assert.equal(a._id.toString(), b._id.toString())
  assert.equal(await db.collection('market_streams').countDocuments({}), 1)
})

test('uma conexão revogada não vira stream', async () => {
  const { m } = gerente()
  setStreamManager(m)
  const c = await conectar()
  await patchInstallation(DONO, c._id, await app(), { status: 'revoked' })
  await assert.rejects(() => ensureStream(DONO, c._id.toString(), ['PETR4']), /revogada/)
})

test('símbolos são saneados e limitados', () => {
  assert.deepEqual(normalizeSymbols([' petr4 ', 'PETR4', '', null, 'vale3']), ['PETR4', 'VALE3'])
  assert.throws(() => normalizeSymbols(Array.from({ length: 500 }, (_, i) => `S${i}`)), /símbolos/)
})

test('o teste de conexão confere credencial e adapter sem abrir socket', async () => {
  const c = await conectar()
  const ok = await testStreamConnection(DONO, c._id.toString())
  assert.equal(ok.ok, true)
  assert.ok(!JSON.stringify(ok).includes(SEGREDO), 'um teste que ecoa a credencial é um teste que vaza')
  assert.equal(SocketFalso.abertos.length, 0)

  clearStreamAdapters()
  const semAdapter = await testStreamConnection(DONO, c._id.toString())
  assert.equal(semAdapter.ok, false)
  assert.match(semAdapter.message, /streaming/)
})
