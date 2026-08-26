// O GERENCIADOR de streams: manter uma conexão de longa duração de pé sem virar um
// cliente que martela o provider, e sem nunca deixar a credencial escapar.
//
// Nada de rede aqui: o socket é falso e o relógio é nosso. O que está sendo provado é
// a máquina de estados — quando reconecta, quando NÃO reconecta, e o que fica gravado.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
// A chave que o `crypto.ts` lê de verdade. Antes daqui estes testes definiam
// `APP_ENCRYPTION_KEY`, que não existe em lugar nenhum: eles passavam porque o `.env`
// de quem desenvolve tem a chave real, e falhavam no CI, que não tem `.env`.
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
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
const { streamCredentials } = await import('../dist/streams/service.js')
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
  // Folgado de propósito: a suíte inteira roda em paralelo, e um segundo de orçamento
  // vira um teste que passa sozinho e falha em conjunto.
  for (let i = 0; i < 1_000; i += 1) {
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
    schedule: (fn, ms, tipo) => {
      const id = (seq += 1)
      pendentes.set(id, { fn, ms, tipo })
      return { id, unref() {} }
    },
    cancel: (t) => pendentes.delete(t?.id),
    // Cada relógio DIZ para que serve. Antes ele era adivinhado pela duração — e bastou
    // aparecer um quarto tipo para a adivinhação apontar para o errado.
    ehReconexao: (t) => t.tipo === 'reconnect',
    temReconexao() {
      return [...pendentes.values()].some((t) => t.tipo === 'reconnect')
    },
    /** Os relógios de posse pendentes, para o teste poder correr o arrendamento. */
    temLease() {
      return [...pendentes.values()].some((t) => t.tipo === 'lease')
    },
    async dispararLease() {
      for (const [id, t] of [...pendentes]) {
        if (t.tipo !== 'lease') continue
        pendentes.delete(id)
        await t.fn()
      }
    },
    dispararReconexao() {
      for (const [id, t] of [...pendentes]) {
        if (t.tipo === 'reconnect') {
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
    dispararBatimento() {
      for (const [id, t] of [...pendentes]) {
        if (t.ms === 11111) {
          pendentes.delete(id)
          t.fn()
        }
      }
    },
    quantos(ms) {
      return [...pendentes.values()].filter((t) => t.ms === ms).length
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
  authOkOf: (raw) => raw?.T === 'success' && raw?.msg === 'authenticated',
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

test('o que estava de pé volta depois do restart LIMPO do worker', async () => {
  const { m } = gerente()
  const record = await streamDe(['PETR4'])
  await m.start(record)
  SocketFalso.abertos[0].abrir()

  // Encerramento limpo: a posse é devolvida, e a instância nova sobe sem esperar nada.
  await m.stopAll()
  SocketFalso.abertos = []
  const { m: novo } = gerente()
  setStreamManager(novo)
  const quantos = await restoreStreams()
  assert.equal(quantos, 1)
  assert.equal(SocketFalso.abertos.length, 1)
  assert.equal(SocketFalso.abertos[0].url, 'wss://stream.corretora-teste.com/default')
})

test('depois de uma QUEDA, a instância nova espera a posse vencer — e aí assume', async () => {
  const { m } = gerente()
  const record = await streamDe(['PETR4'])
  await m.start(record)
  SocketFalso.abertos[0].abrir()

  // A instância morre sem devolver nada: a memória some, o documento e a posse ficam.
  SocketFalso.abertos = []
  const { m: novo } = gerente()
  setStreamManager(novo)

  // Enquanto a posse do morto vale, a nova NÃO abre um segundo socket no mesmo serviço.
  assert.equal(await restoreStreams(), 0)
  assert.equal(SocketFalso.abertos.length, 0)

  // Passado o prazo, ela assume — que é o que impede um stream ficar órfão para sempre.
  await db.collection('market_streams').updateOne({ _id: record._id }, { $set: { leaseUntil: new Date(Date.now() - 1000) } })
  assert.equal(await restoreStreams(), 1)
  assert.equal(SocketFalso.abertos.length, 1)
})

test('devolver a posse não segura o encerramento quando o banco não responde', async () => {
  const record = await streamDe(['PETR4'])
  const { m } = gerente()
  await m.start(record)

  // O banco some ANTES do encerramento — é a ordem do smoke, e o caso em que o processo
  // mais precisa morrer. A devolução da posse tem prazo próprio e não pode atrasar isso.
  const { releaseStreamLease } = await import('../dist/streams/repository.js')
  const colecao = db.collection('market_streams')
  const original = colecao.updateOne.bind(colecao)
  colecao.updateOne = () => new Promise(() => undefined) // nunca resolve
  try {
    const comecou = Date.now()
    await releaseStreamLease(record._id, m.instanceId)
    const levou = Date.now() - comecou
    assert.ok(levou < 5_000, `a devolução segurou o encerramento por ${levou}ms`)
  } finally {
    colecao.updateOne = original
  }
})

test('duas instâncias não abrem o mesmo stream', async () => {
  const record = await streamDe(['PETR4'])
  const { m: primeira } = gerente()
  const { m: segunda } = gerente()

  await primeira.start(record)
  await segunda.start(record)

  // Um socket, e só. Sem a posse, os dois abririam — mensagem dobrada, evento dobrado, e
  // num provedor que limita conexões por conta, as duas derrubadas.
  assert.equal(SocketFalso.abertos.length, 1)
  assert.equal(segunda.stateOf(record._id.toString()), 'disconnected')
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

test('o teste de conexão abre, autentica e FECHA — sem deixar nada de pé', async () => {
  // Conferir se há credencial guardada responde "está configurado", não "funciona".
  // Uma chave errada passava naquele teste e só falhava quando o stream fosse ligado de
  // verdade, longe de quem clicou em testar.
  const { m } = gerente()
  setStreamManager(m)
  const c = await conectar()
  const promessa = testStreamConnection(DONO, c._id.toString())
  await ate(async () => SocketFalso.abertos.length === 1, 'o socket do teste')
  const s = SocketFalso.abertos[0]
  s.abrir()
  assert.deepEqual(JSON.parse(s.enviadas[0]), { action: 'auth', key: SEGREDO }, 'autentica de verdade')
  s.receber({ T: 'success', msg: 'authenticated' })

  const ok = await promessa
  assert.equal(ok.ok, true)
  assert.ok(!JSON.stringify(ok).includes(SEGREDO), 'um teste que ecoa a credencial é um teste que vaza')
  // Nada pendurado: um teste que deixa socket aberto, repetido, vira vazamento.
  assert.equal(s.fechado, true)
  assert.equal(m.activeCount, 0, 'e nenhum stream passou a ser gerenciado por causa de um teste')
})

test('credencial recusada no tempo real é recusa, não sucesso', async () => {
  const { m } = gerente()
  setStreamManager(m)
  const c = await conectar()
  const promessa = testStreamConnection(DONO, c._id.toString())
  await ate(async () => SocketFalso.abertos.length === 1, 'o socket do teste')
  const s = SocketFalso.abertos[0]
  s.abrir()
  s.receber({ T: 'error', code: 402, msg: `auth failed for ${SEGREDO}` })
  const r = await promessa
  assert.equal(r.ok, false)
  assert.match(r.message, /auth failed/)
  assert.ok(!r.message.includes(SEGREDO), 'a credencial é riscada até na recusa')
  assert.equal(s.fechado, true)
})

test('o provedor que fecha antes de confirmar não vira sucesso', async () => {
  const { m } = gerente()
  setStreamManager(m)
  const c = await conectar()
  const promessa = testStreamConnection(DONO, c._id.toString())
  await ate(async () => SocketFalso.abertos.length === 1, 'o socket do teste')
  SocketFalso.abertos[0].cair()
  const r = await promessa
  assert.equal(r.ok, false)
  assert.match(r.message, /antes de confirmar/)
})

test('sem adapter de stream, o teste diz isso e não abre nada', async () => {
  const c = await conectar()
  clearStreamAdapters()
  const semAdapter = await testStreamConnection(DONO, c._id.toString())
  assert.equal(semAdapter.ok, false)
  assert.match(semAdapter.message, /streaming/)
  assert.equal(SocketFalso.abertos.length, 0)
})

test('um erro logo depois do handshake não é apagado pela gravação do "conectado"', async () => {
  // A corrida real: a gravação do estado "conectado" sai sem espera, e a recusa de
  // autenticação chega enquanto ela ainda está no ar. Limpando às cegas, a mensagem que
  // explica a queda sumia e o stream ficava "conectado, sem erro" — e mudo.
  const { m } = gerente()
  const record = await streamDe()
  await m.start(record)
  const s = SocketFalso.abertos[0]
  s.abrir()
  s.receber({ T: 'error', msg: 'auth failed' })
  await ate(async () => (await findStream(DONO, record._id))?.lastError, 'o erro ser gravado')
  await new Promise((r) => setTimeout(r, 40))
  const doc = await findStream(DONO, record._id)
  assert.match(doc.lastError.message, /auth failed/, 'a explicação sobrevive')
})

// --- batimento e silêncio: os dois relógios, cada um no seu ritmo -----------------------

test('o batimento é periódico, e não uma vez só', async () => {
  // Antes daqui ele era rearmado junto com o detector de silêncio, a cada mensagem: num
  // stream ATIVO nunca disparava (toda mensagem cancelava o timer pendente) e num stream
  // parado disparava uma vez e nunca mais. Um batimento que bate uma vez não mantém
  // conexão nenhuma viva.
  const { m, relogio } = gerente()
  const record = await streamDe()
  await m.start(record)
  const s = SocketFalso.abertos[0]
  s.abrir()
  const antes = s.enviadas.length

  relogio.dispararBatimento()
  assert.deepEqual(JSON.parse(s.enviadas[antes]), { action: 'ping' })
  // E se reagenda sozinho: o segundo batimento não depende de mais nada acontecer.
  assert.equal(relogio.quantos(11111), 1, 'o próximo já está marcado')
  relogio.dispararBatimento()
  assert.deepEqual(JSON.parse(s.enviadas[antes + 1]), { action: 'ping' })
  assert.equal(relogio.quantos(11111), 1)
})

test('uma mensagem rearma o silêncio sem cancelar o batimento', async () => {
  const { m, relogio } = gerente()
  const record = await streamDe()
  await m.start(record)
  const s = SocketFalso.abertos[0]
  s.abrir()
  assert.equal(relogio.quantos(11111), 1)
  s.receber({ T: 't', S: 'PETR4', p: 10, i: 1, t: '2026-01-05T12:00:00Z' })
  await new Promise((r) => setTimeout(r, 20))
  // O batimento continua marcado; num stream movimentado ele era exatamente o que sumia.
  assert.equal(relogio.quantos(11111), 1)
  assert.equal(relogio.quantos(22222), 1)
})

test('fechar por silêncio conta UMA queda, e não duas', async () => {
  // O detector fecha o socket, e fechar dispara o `onclose` — que também reporta queda.
  // Duas quedas são duas reconexões agendadas, e duas reconexões são dois sockets.
  const { m, relogio } = gerente()
  const record = await streamDe()
  await m.start(record)
  const s = SocketFalso.abertos[0]
  s.abrir()

  relogio.dispararSilencio()
  await ate(async () => relogio.temReconexao(), 'a reconexão ser agendada')
  s.cair() // o onclose que o próprio fechamento provoca
  await new Promise((r) => setTimeout(r, 30))

  relogio.dispararReconexao()
  await ate(async () => SocketFalso.abertos.length === 2, 'a reconexão')
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(SocketFalso.abertos.length, 2, 'uma conexão nova, não duas')
  assert.equal(m.activeCount, 1)
})

test('o socket mudo é fechado de verdade, e não fica pendurado', async () => {
  const { m, relogio } = gerente()
  const record = await streamDe()
  await m.start(record)
  const s = SocketFalso.abertos[0]
  s.abrir()
  relogio.dispararSilencio()
  assert.equal(s.fechado, true, 'aberto e calado é o pior estado possível')
})

test('o que chega por um socket velho não mexe no novo', async () => {
  const { m, relogio } = gerente()
  const record = await streamDe()
  await m.start(record)
  const velho = SocketFalso.abertos[0]
  velho.abrir()
  velho.cair()
  await ate(async () => relogio.temReconexao(), 'a reconexão ser agendada')
  relogio.dispararReconexao()
  await ate(async () => SocketFalso.abertos.length === 2, 'a segunda conexão')
  const novo = SocketFalso.abertos[1]
  novo.abrir()

  // O provider atrasado ainda manda pelo socket antigo.
  velho.receber({ T: 't', S: 'PETR4', p: 99, i: 500, t: '2026-01-05T12:00:00Z' })
  velho.cair()
  await new Promise((r) => setTimeout(r, 30))

  assert.equal(m.stateOf(record._id.toString()), 'connected', 'a queda do socket velho não derruba o novo')
  assert.equal(SocketFalso.abertos.length, 2)
})

// --- o stream segue o ciclo de vida da conexão ---------------------------------------

test('revogar a conexão derruba o stream na hora e não o deixa voltar', async () => {
  // Duas coisas precisam acontecer, e nenhuma sozinha basta: parar a conexão viva (senão
  // ela continua recebendo com a credencial revogada) e marcar como pausado (senão o
  // próximo restart do worker ressuscita o stream a partir do documento).
  const { disableStreamsForInstallation, restoreStreams } = await import('../dist/streams/service.js')
  const { m } = gerente()
  setStreamManager(m)
  const conexao = await conectar()
  const record = await upsertStream({
    ownerId: DONO,
    installationId: conexao._id.toString(),
    appKey: MANIFESTO.key,
    environment: 'default',
    symbols: ['PETR4'],
  })
  await m.start(record)
  SocketFalso.abertos[0].abrir()

  const quantos = await disableStreamsForInstallation(DONO, conexao._id.toString())
  assert.equal(quantos, 1)
  assert.equal(m.activeCount, 0, 'a conexão viva caiu')
  assert.equal(SocketFalso.abertos[0].fechado, true)

  SocketFalso.abertos = []
  assert.equal(await restoreStreams(), 0, 'e não volta no restart')
  assert.equal(SocketFalso.abertos.length, 0)
})

test('remover a conexão apaga o stream, para ele não ficar órfão', async () => {
  const { deleteStreamsForInstallation } = await import('../dist/streams/service.js')
  const { m } = gerente()
  setStreamManager(m)
  const conexao = await conectar()
  const record = await upsertStream({
    ownerId: DONO,
    installationId: conexao._id.toString(),
    appKey: MANIFESTO.key,
    environment: 'default',
    symbols: ['PETR4'],
  })
  await m.start(record)
  await deleteStreamsForInstallation(DONO, conexao._id.toString())
  assert.equal(await db.collection('market_streams').countDocuments({}), 0)
  assert.equal(m.activeCount, 0)
})

test('trocar a credencial reabre o stream com a chave nova', async () => {
  // Sem isto, o stream continuaria de pé com a chave antiga até ela ser recusada — e
  // trocar a credencial pareceria não ter efeito nenhum.
  const { reconnectStreamsForInstallation } = await import('../dist/streams/service.js')
  const app = await resolveAppForOwner(DONO, MANIFESTO.key)
  const conexao = await conectar()
  const record = await upsertStream({
    ownerId: DONO,
    installationId: conexao._id.toString(),
    appKey: MANIFESTO.key,
    environment: 'default',
    symbols: ['PETR4'],
  })
  // O gerenciador lê a credencial de verdade, para provar que a nova chega ao socket.
  const { m } = gerente({ credentialsOf: undefined })
  const real = new StreamManager({
    adapters: streamAdapters(),
    createSocket: (url) => new SocketFalso(url),
    credentialsOf: (await import('../dist/streams/service.js')).streamCredentials,
    publish: publicarFalso,
    schedule: (fn, ms) => ({ id: 0, unref() {} }),
    cancel: () => undefined,
  })
  setStreamManager(real)
  await real.start(record)
  SocketFalso.abertos[0].abrir()
  assert.deepEqual(JSON.parse(SocketFalso.abertos[0].enviadas[0]), { action: 'auth', key: SEGREDO })

  await patchInstallation(DONO, conexao._id, app, { config: { apiKey: 'chave-novinha-em-folha' } })
  await reconnectStreamsForInstallation(DONO, conexao._id.toString())
  await ate(async () => SocketFalso.abertos.length === 2, 'a reconexão com a chave nova')
  SocketFalso.abertos[1].abrir()
  assert.deepEqual(JSON.parse(SocketFalso.abertos[1].enviadas[0]), { action: 'auth', key: 'chave-novinha-em-folha' })
  assert.ok(m)
})

test('um stream pausado não é reaberto por uma troca de credencial', async () => {
  const { reconnectStreamsForInstallation } = await import('../dist/streams/service.js')
  const { m } = gerente()
  setStreamManager(m)
  const conexao = await conectar()
  const record = await upsertStream({
    ownerId: DONO,
    installationId: conexao._id.toString(),
    appKey: MANIFESTO.key,
    environment: 'default',
    symbols: ['PETR4'],
  })
  await setStreamPaused(DONO, record._id, true)
  assert.equal(await reconnectStreamsForInstallation(DONO, conexao._id.toString()), 0)
  assert.equal(SocketFalso.abertos.length, 0)
})


// ============================================================================
// A POSSE, entre instâncias — com relógio controlado
// ============================================================================
//
// O relógio é falso de propósito: um arrendamento de sessenta segundos não cabe num
// teste, e esperar por ele provaria menos, não mais. O que interessa é a ORDEM dos
// acontecimentos, e ela é determinística aqui.

const { setStreamState, markStreamEvent, renewStreamLease, claimStream } = await import('../dist/streams/repository.js')

test('a renovação continua correndo por mais de dois períodos', async () => {
  const { m, relogio } = gerente()
  const record = await streamDe(['PETR4'])
  await m.start(record)
  SocketFalso.abertos[0].abrir()

  for (let volta = 1; volta <= 3; volta++) {
    assert.equal(relogio.temLease(), true, `volta ${volta}: a renovação some depois de ${volta - 1} períodos`)
    await relogio.dispararLease()
  }
  // E o stream continua de pé, com a posse deste processo.
  assert.equal(m.stateOf(record._id.toString()), 'connected')
  const doc = await db.collection('market_streams').findOne({ _id: record._id })
  assert.equal(doc.leaseOwner, m.instanceId)
})

test('reconectar NÃO cancela a renovação', async () => {
  const { m, relogio } = gerente()
  const record = await streamDe(['PETR4'])
  await m.start(record)
  SocketFalso.abertos[0].abrir()

  // A queda e a volta: é aqui que o relógio da posse era cancelado junto com os outros.
  SocketFalso.abertos[0].cair()
  await ate(() => relogio.temReconexao(), 'a reconexão agendada')
  await relogio.dispararReconexao()
  await ate(() => SocketFalso.abertos.length === 2, 'a segunda conexão')
  SocketFalso.abertos[1].abrir()

  assert.equal(relogio.temLease(), true, 'a renovação sobreviveu à reconexão')
  await relogio.dispararLease()
  const doc = await db.collection('market_streams').findOne({ _id: record._id })
  assert.equal(doc.leaseOwner, m.instanceId, 'e a posse continua sendo confirmada')
})

test('perder a posse fecha o socket local — e NÃO devolve o arrendamento da nova dona', async () => {
  const { m, relogio } = gerente()
  const record = await streamDe(['PETR4'])
  await m.start(record)
  SocketFalso.abertos[0].abrir()

  // Outra instância assume: o arrendamento vence e ela reivindica.
  await db.collection('market_streams').updateOne({ _id: record._id }, { $set: { leaseUntil: new Date(Date.now() - 1000) } })
  assert.equal(await claimStream(record._id, 'outra-instancia'), true)

  await relogio.dispararLease()
  assert.equal(m.stateOf(record._id.toString()), 'disconnected', 'a antiga largou o stream')
  assert.equal(SocketFalso.abertos[0].fechado, true, 'e fechou o socket local')

  const doc = await db.collection('market_streams').findOne({ _id: record._id })
  assert.equal(doc.leaseOwner, 'outra-instancia', 'o arrendamento da nova dona ficou intacto')
})

/** Ligado por um teste para o banco "falhar" na renovação — ver `renewLease` nas deps. */
let falharRenovacao = false

test('erro de banco na renovação NÃO conta como renovação — e fecha antes de operar sem posse', async () => {
  const { m, relogio } = gerente({
    renewLease: async (id, instanceId) => {
      if (falharRenovacao) throw new Error('banco indisponível')
      return renewStreamLease(id, instanceId)
    },
  })
  const record = await streamDe(['PETR4'])
  await m.start(record)
  SocketFalso.abertos[0].abrir()

  falharRenovacao = true
  try {
    // Enquanto há margem no prazo confirmado, ele insiste em vez de largar.
    await relogio.dispararLease()
    assert.equal(m.stateOf(record._id.toString()), 'connected', 'uma falha momentânea não derruba o stream')
    assert.equal(relogio.temLease(), true, 'e a próxima tentativa está agendada')

    // Sem margem: fecha, em vez de seguir sem prova de posse.
    m.forcarVencimentoDoLease(record._id.toString())
    await relogio.dispararLease()
    assert.equal(m.stateOf(record._id.toString()), 'disconnected')
    assert.equal(SocketFalso.abertos[0].fechado, true)
  } finally {
    falharRenovacao = false
  }
})

test('a instância antiga não altera estado nem contadores depois do takeover', async () => {
  const record = await streamDe(['PETR4'])
  const { m: antiga } = gerente()
  await antiga.start(record)

  // A nova assume.
  await db.collection('market_streams').updateOne({ _id: record._id }, { $set: { leaseUntil: new Date(Date.now() - 1000) } })
  assert.equal(await claimStream(record._id, 'nova'), true)
  await setStreamState(record._id, 'connected', new Date(), 'nova')
  await markStreamEvent(record._id, 5, new Date(), 'nova')

  // A antiga tenta gravar, como faria um socket que ainda não sabe que perdeu.
  await setStreamState(record._id, 'error', new Date(), antiga.instanceId)
  await markStreamEvent(record._id, 99, new Date(), antiga.instanceId)

  const doc = await db.collection('market_streams').findOne({ _id: record._id })
  assert.equal(doc.state, 'connected', 'o estado é o que a DONA gravou')
  assert.equal(doc.eventCount, 5, 'e o contador não foi somado pela antiga')
})

test('uma ação administrativa continua funcionando com o stream de outra instância', async () => {
  const record = await streamDe(['PETR4'])
  await claimStream(record._id, 'outra-instancia')
  // Pausar vem pelo serviço, sem posse — é decisão do dono da conta, não da instância.
  const r = await setStreamPaused(DONO, record._id, true)
  assert.equal(r.paused, true)
})

test('a segunda instância assume sozinha depois da queda, sem ninguém chamar nada', async () => {
  const record = await streamDe(['PETR4'])
  const { m: primeira } = gerente()
  await primeira.start(record)
  SocketFalso.abertos[0].abrir()

  // A primeira morre sem devolver nada. A segunda sobe e liga o reconciliador.
  SocketFalso.abertos = []
  const { m: segunda } = gerente()
  setStreamManager(segunda)

  const { startStreamReconciler, stopStreamReconciler } = await import('../dist/streams/service.js')
  process.env.STREAM_RECONCILE_MS = '50'
  try {
    startStreamReconciler()
    // Com o arrendamento da morta ainda válido, ninguém abre nada.
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(SocketFalso.abertos.length, 0, 'não abre um segundo socket enquanto a posse vale')

    // Vencido o prazo, a reconciliação assume sozinha.
    await db.collection('market_streams').updateOne({ _id: record._id }, { $set: { leaseUntil: new Date(Date.now() - 1000) } })
    await ate(() => SocketFalso.abertos.length === 1, 'a segunda instância assumir')
    const doc = await db.collection('market_streams').findOne({ _id: record._id })
    assert.equal(doc.leaseOwner, segunda.instanceId)
  } finally {
    await stopStreamReconciler()
    delete process.env.STREAM_RECONCILE_MS
  }
})

test('um stream pausado não é assumido pela reconciliação', async () => {
  const record = await streamDe(['PETR4'])
  await setStreamPaused(DONO, record._id, true)
  const { m } = gerente()
  setStreamManager(m)

  const { startStreamReconciler, stopStreamReconciler } = await import('../dist/streams/service.js')
  process.env.STREAM_RECONCILE_MS = '50'
  try {
    startStreamReconciler()
    await new Promise((r) => setTimeout(r, 250))
    assert.equal(SocketFalso.abertos.length, 0)
  } finally {
    await stopStreamReconciler()
    delete process.env.STREAM_RECONCILE_MS
  }
})

test('o encerramento para a renovação e o reconciliador', async () => {
  const { m, relogio } = gerente()
  setStreamManager(m)
  const record = await streamDe(['PETR4'])
  await m.start(record)
  SocketFalso.abertos[0].abrir()
  assert.equal(relogio.temLease(), true)

  const { shutdownStreams } = await import('../dist/streams/service.js')
  await shutdownStreams()

  assert.equal(relogio.temLease(), false, 'a renovação parou')
  assert.equal(relogio.temReconexao(), false, 'e nada ficou agendado')
  const doc = await db.collection('market_streams').findOne({ _id: record._id })
  assert.equal(doc.leaseOwner, null, 'o encerramento limpo devolve a posse')
})


// ============================================================================
// Encerramento completo: nada continua correndo depois da saída
// ============================================================================

/** O relógio da posse é o que sobrava; conferir isso é o ponto de metade destes casos. */
// Nenhum relógio de tipo NENHUM — não só posse e reconexão. Um batimento ou um detector
// de silêncio esquecido segura o processo de pé e volta a mexer num stream já largado.
const semRelogios = (relogio) => relogio.pendentes.size === 0

test('credencial indisponível encerra por completo: sem relógio e sem posse', async () => {
  const record = await streamDe(['PETR4'])
  const { m, relogio } = gerente({ credentialsOf: async () => null })
  assert.equal(await m.start(record), true, 'a posse foi tomada antes de descobrir o problema')

  assert.equal(m.stateOf(record._id.toString()), 'disconnected', 'saiu do mapa')
  assert.equal(semRelogios(relogio), true, 'nenhum relógio ficou correndo')
  const doc = await db.collection('market_streams').findOne({ _id: record._id })
  assert.equal(doc.state, 'error', 'o motivo ficou gravado, com a cerca de pé')
  assert.equal(doc.leaseOwner, null, 'e a posse voltou a ficar livre')
})

test('adapter ausente encerra por completo, mesmo antes de existir um Vivo', async () => {
  const record = await streamDe(['PETR4'])
  const { m, relogio } = gerente({ adapters: new Map(), adapterFor: async () => null })
  assert.equal(await m.start(record), false)

  assert.equal(semRelogios(relogio), true)
  const doc = await db.collection('market_streams').findOne({ _id: record._id })
  assert.equal(doc.state, 'error')
  assert.equal(doc.leaseOwner, null, 'a posse tomada no claim foi devolvida')
})

test('desistir depois do limite de tentativas cancela o relógio da posse e libera', async () => {
  const record = await streamDe(['PETR4'])
  const { m, relogio } = gerente()
  await m.start(record)

  /**
   * Cada queda é ASSÍNCRONA: `onclose` dispara `quebrou`, que agenda a reconexão sem
   * ninguém esperar por ela. Conferir logo depois de `cair()` lê o estado de antes — foi
   * assim que a primeira versão deste teste ficou instável no CI.
   */
  for (let i = 0; i < 12 && m.activeCount > 0; i += 1) {
    const antes = SocketFalso.abertos.length
    SocketFalso.abertos[antes - 1].cair()
    await ate(async () => relogio.temReconexao() || m.activeCount === 0, 'a próxima decisão')
    if (m.activeCount === 0) break
    relogio.dispararReconexao()
    await ate(async () => SocketFalso.abertos.length > antes || m.activeCount === 0, 'reconectar ou desistir')
  }

  assert.equal(m.stateOf(record._id.toString()), 'disconnected', 'desistiu')
  assert.equal(semRelogios(relogio), true, 'e não ficou relógio nenhum — nem o da posse')
  // O gerenciador larga o stream ANTES de terminar de gravar: esperar a gravação é do
  // teste, não sintoma de defeito.
  await ate(async () => (await findStream(DONO, record._id))?.state === 'error', 'o motivo ser gravado')
  const doc = await findStream(DONO, record._id)
  assert.match(doc.lastError.message, /desistindo/)
  await ate(async () => (await findStream(DONO, record._id))?.leaseOwner === null, 'a posse ser devolvida')
  assert.equal((await findStream(DONO, record._id)).leaseUntil, null, 'e o prazo dela junto')
})

test('o stop grava disconnected ANTES de liberar a posse', async () => {
  const record = await streamDe(['PETR4'])
  const { m } = gerente()
  await m.start(record)
  SocketFalso.abertos[0].abrir()

  await m.stop(record._id.toString())
  const doc = await db.collection('market_streams').findOne({ _id: record._id })
  // Com a ordem invertida, a escrita cercada não acharia o dono e o estado ficaria
  // "connected" para sempre — que é o que acontecia antes desta correção.
  assert.equal(doc.state, 'disconnected')
  assert.equal(doc.leaseOwner, null)
})

test('pausar não é sobrescrito por um stop posterior', async () => {
  const record = await streamDe(['PETR4'])
  const { m } = gerente()
  await m.start(record)
  await setStreamPaused(DONO, record._id, true)

  await m.stop(record._id.toString())
  const doc = await db.collection('market_streams').findOne({ _id: record._id })
  assert.equal(doc.paused, true, 'a decisão do dono da conta continua valendo')
})

// ============================================================================
// start() concorrente
// ============================================================================

test('dois start ao mesmo tempo abrem exatamente UM socket', async () => {
  const record = await streamDe(['PETR4'])
  const { m } = gerente()
  const [a, b] = await Promise.all([m.start(record), m.start(record)])
  assert.equal(a, true)
  assert.equal(b, true, 'a segunda chamada compartilha a mesma subida')
  assert.equal(SocketFalso.abertos.length, 1, `abriu ${SocketFalso.abertos.length} sockets`)
})

test('adapterFor que LANÇA devolve a posse, e não deixa nada para trás', async () => {
  const record = await streamDe(['PETR4'])
  const SEGREDO_NA_MENSAGEM = 'endereço interno recusado'
  let falhar = true
  const { m, relogio } = gerente({
    adapterFor: async (r) => {
      if (falhar) throw new Error(SEGREDO_NA_MENSAGEM)
      return streamAdapters().get(r.appKey) ?? null
    },
  })

  // O erro é tratado por dentro: quem chamou recebe `false`, não uma exceção.
  assert.equal(await m.start(record), false, 'não sobe com configuração recusada')

  const depoisDaFalha = await findStream(DONO, record._id)
  assert.equal(depoisDaFalha.state, 'error')
  assert.match(depoisDaFalha.lastError.message, /interno/, 'o motivo ficou legível')
  // Sem devolver a posse, o arrendamento ficaria preso até vencer por causa de uma
  // configuração que nunca vai funcionar — e nenhuma instância poderia sequer tentar.
  assert.equal(depoisDaFalha.leaseOwner, null, 'a posse foi devolvida')
  assert.equal(depoisDaFalha.leaseUntil, null, 'e o prazo dela também')

  // Nada ficou pendurado: nem socket, nem stream gerenciado, nem relógio.
  assert.equal(SocketFalso.abertos.length, 0, 'nenhum socket foi aberto')
  assert.equal(m.activeCount, 0, 'nenhum stream ficou no mapa')
  assert.equal(m.isTracked(record._id.toString()), false, 'nem em subida')
  assert.equal(semRelogios(relogio), true, 'nenhum relógio ficou agendado')

  // E a subida seguinte corre de novo, em vez de receber a promessa antiga.
  falhar = false
  assert.equal(await m.start(record), true, 'a segunda tentativa sobe')
  assert.equal(SocketFalso.abertos.length, 1)
})

test('a mensagem do erro de configuração passa pelo saneador antes de ser gravada', async () => {
  const record = await streamDe(['PETR4'])
  // Um provedor que despeja o corpo inteiro da resposta no erro é comum — e `lastError`
  // vai para a tela. Sem sanear, o documento do stream vira o depósito daquele despejo.
  const { m } = gerente({
    adapterFor: async () => {
      throw new Error(`recusado: ${'x'.repeat(5_000)}`)
    },
  })
  assert.equal(await m.start(record), false)

  const doc = await findStream(DONO, record._id)
  assert.ok(doc.lastError.message.length <= 300, `mensagem gravada crua: ${doc.lastError.message.length} caracteres`)
  assert.match(doc.lastError.message, /^recusado/, 'e o motivo continua legível')
})

// ============================================================================
// Reconciliador
// ============================================================================

test('parar o reconciliador espera a volta em andamento e não reabre nada', async () => {
  const record = await streamDe(['PETR4'])
  const { m } = gerente()
  setStreamManager(m)

  const { startStreamReconciler, stopStreamReconciler } = await import('../dist/streams/service.js')
  process.env.STREAM_RECONCILE_MS = '30'
  try {
    startStreamReconciler()
    // Encerra logo no começo de uma volta: uma consulta que voltasse depois disto
    // chamaria start e abriria um socket que ninguém fecharia.
    await new Promise((r) => setTimeout(r, 40))
    await stopStreamReconciler()
    const quantos = SocketFalso.abertos.length

    await new Promise((r) => setTimeout(r, 150))
    assert.equal(SocketFalso.abertos.length, quantos, 'nenhuma volta rodou depois de parar')
  } finally {
    await stopStreamReconciler()
    delete process.env.STREAM_RECONCILE_MS
    await m.stopAll()
  }
})

test('o reconciliador não reabre o que já está de pé nesta instância', async () => {
  const record = await streamDe(['PETR4'])
  const { m } = gerente()
  setStreamManager(m)
  await m.start(record)
  SocketFalso.abertos[0].abrir()

  const { startStreamReconciler, stopStreamReconciler } = await import('../dist/streams/service.js')
  process.env.STREAM_RECONCILE_MS = '30'
  try {
    startStreamReconciler()
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(SocketFalso.abertos.length, 1, 'continua um socket só')
  } finally {
    await stopStreamReconciler()
    delete process.env.STREAM_RECONCILE_MS
    await m.stopAll()
  }
})
