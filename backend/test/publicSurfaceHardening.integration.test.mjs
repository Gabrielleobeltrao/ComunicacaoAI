// A SUPERFÍCIE PÚBLICA, contra o servidor de verdade.
//
// Três portas abertas para a internet — o widget, o socket e o webhook de WhatsApp — e
// uma pergunta em cada: o que acontece quando quem bate não é quem diz ser. Aqui sobe o
// mesmo `dist/index.js` que a imagem roda, com um mongod isolado, e nada sai da máquina.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { join } from 'node:path'
import { MongoClient, ObjectId } from 'mongodb'
import { io as socketClient } from 'socket.io-client'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

const RAIZ = new URL('..', import.meta.url).pathname
const PORTA = 4491
const base = `http://127.0.0.1:${PORTA}`
const SITE = `http://127.0.0.1:${PORTA}`
const INTRUSO = 'https://nao-e-nosso.example'
const CHAVE_CIFRA = 'chave-de-cifra-so-para-teste-9f3a2b7c1d'

const DONO = 'dono-publico'
const VIZINHO = 'vizinho-publico'

let proc
let cliente
let db
let encrypt

before(async () => {
  const uri = await startMongo()
  cliente = new MongoClient(uri)
  await cliente.connect()
  db = cliente.db()

  process.env.ENCRYPTION_KEY = CHAVE_CIFRA
  ;({ encrypt } = await import('../dist/crypto.js'))

  proc = spawn(process.execPath, ['dist/index.js'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: join(RAIZ, 'test/.sem-env'),
      NODE_ENV: 'test',
      PORT: String(PORTA),
      MONGODB_URI: uri,
      BETTER_AUTH_SECRET: 'segredo-de-teste-para-a-superficie-publica-42',
      ENCRYPTION_KEY: CHAVE_CIFRA,
      CLIENT_URL: SITE,
      PUBLIC_URL: base,
      BETTER_AUTH_URL: base,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', () => undefined)
  proc.stderr.on('data', () => undefined)

  const limite = Date.now() + 60_000
  while (Date.now() < limite) {
    const res = await fetch(`${base}/api/ready`).catch(() => null)
    if (res?.status === 200) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('a API não subiu')
})

after(async () => {
  if (proc && proc.exitCode === null) {
    const saiu = new Promise((r) => proc.once('exit', r))
    proc.kill('SIGTERM')
    await Promise.race([saiu, new Promise((r) => setTimeout(() => (proc.kill('SIGKILL'), r()), 15_000))])
  }
  await cliente?.close()
  await stopMongo()
})

// --- o cenário --------------------------------------------------------------------------

const ANDAR = new ObjectId()

async function semearWidget(ownerId, publicKey) {
  const agentId = new ObjectId()
  await db.collection('agents').insertOne({ _id: agentId, ownerId, name: 'Atendente', officeId: ANDAR, objective: 'atender', provider: 'anthropic' })
  const _id = new ObjectId()
  await db.collection('widgets').insertOne({
    _id,
    ownerId,
    name: 'Chat',
    publicKey,
    createdAt: new Date(),
    primaryColor: null,
    welcomeTitle: null,
    welcomeMessage: null,
    position: 'right',
    avatarUrl: null,
    agentId,
    sectorId: null,
    channel: 'web',
  })
  await db.collection('connections').insertOne({ ownerId, appKey: 'web_chat', status: 'connected', name: 'Chat Web', createdAt: new Date(), updatedAt: new Date() })
  return _id
}

async function semearCanalWhatsApp(provider, config) {
  const agentId = new ObjectId()
  await db.collection('agents').insertOne({ _id: agentId, ownerId: DONO, name: 'Atendente', officeId: ANDAR, objective: 'atender', provider: 'anthropic' })
  const _id = new ObjectId()
  await db.collection('widgets').insertOne({
    _id,
    ownerId: DONO,
    name: `Canal ${provider}`,
    publicKey: `wa-${provider}-${_id.toString()}`,
    createdAt: new Date(),
    primaryColor: null,
    welcomeTitle: null,
    welcomeMessage: null,
    position: 'right',
    avatarUrl: null,
    agentId,
    sectorId: null,
    channel: 'whatsapp',
    whatsapp: { provider, configEnc: encrypt(JSON.stringify(config)), number: '5511999999999' },
  })
  return _id
}

beforeEach(async () => {
  for (const c of ['widgets', 'agents', 'connections', 'widget_messages', 'rate_limits', 'concurrency_slots']) {
    await db.collection(c).deleteMany({})
  }
})

const abrirSessao = (chave, corpo = {}) =>
  fetch(`${base}/api/public/widgets/${chave}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  })

// --- 1) a sessão do visitante --------------------------------------------------------------

test('sem token não se lê nem se escreve na conversa de ninguém', async () => {
  await semearWidget(DONO, 'chave-a')

  const leitura = await fetch(`${base}/api/public/widgets/chave-a/messages?conversationId=inventado-por-mim`)
  assert.equal(leitura.status, 401)

  const escrita = await fetch(`${base}/api/public/widgets/chave-a/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: 'inventado-por-mim', content: 'oi' }),
  })
  assert.equal(escrita.status, 401)
  // E nada foi gravado: o `conversationId` do cliente não abre porta nenhuma.
  assert.equal(await db.collection('widget_messages').countDocuments({}), 0)
})

test('o token de UM widget não abre a conversa de OUTRO — nem do mesmo dono', async () => {
  await semearWidget(DONO, 'chave-a')
  await semearWidget(DONO, 'chave-b')
  await semearWidget(VIZINHO, 'chave-vizinho')

  const { token } = await (await abrirSessao('chave-a')).json()
  for (const outra of ['chave-b', 'chave-vizinho']) {
    const res = await fetch(`${base}/api/public/widgets/${outra}/messages`, { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(res.status, 401, outra)
  }
})

test('o id da conversa vem do SERVIDOR, e o do corpo é ignorado', async () => {
  await semearWidget(DONO, 'chave-a')
  const sessao = await (await abrirSessao('chave-a')).json()
  assert.match(sessao.conversationId, /[0-9a-f-]{36}/)
  assert.ok(sessao.token && sessao.expiresAt)

  const res = await fetch(`${base}/api/public/widgets/chave-a/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.token}` },
    // O cliente tenta escrever em OUTRA conversa. O token manda.
    body: JSON.stringify({ conversationId: 'conversa-de-outra-pessoa', content: 'oi' }),
  })
  assert.equal(res.status, 201)
  const gravada = await db.collection('widget_messages').findOne({})
  assert.equal(gravada.conversationId, sessao.conversationId)
})

test('token adulterado, expirado ou de outro segredo não vale', async () => {
  await semearWidget(DONO, 'chave-a')
  const { token } = await (await abrirSessao('chave-a')).json()
  const [versao, carga, assinatura] = token.split('.')

  const adulterados = [
    `${versao}.${carga}.${'A'.repeat(assinatura.length)}`,
    `${versao}.${Buffer.from(JSON.stringify({ widgetId: 'outro', conversationId: 'x', exp: Date.now() + 1e6 })).toString('base64url')}.${assinatura}`,
    'v1.nao.assinado',
    '',
  ]
  for (const ruim of adulterados) {
    const res = await fetch(`${base}/api/public/widgets/chave-a/messages`, { headers: { Authorization: `Bearer ${ruim}` } })
    assert.equal(res.status, 401, ruim.slice(0, 20))
  }
})

test('quem já estava conversando troca a sessão antiga sem perder o histórico', async () => {
  const widgetId = await semearWidget(DONO, 'chave-a')
  await db.collection('widget_messages').insertOne({
    _id: new ObjectId(),
    widgetId,
    conversationId: 'conversa-antiga-do-navegador',
    role: 'visitor',
    content: 'mensagem de antes',
    createdAt: new Date(),
  })

  const sessao = await (await abrirSessao('chave-a', { conversationId: 'conversa-antiga-do-navegador' })).json()
  assert.equal(sessao.conversationId, 'conversa-antiga-do-navegador')
  const historico = await (await fetch(`${base}/api/public/widgets/chave-a/messages`, { headers: { Authorization: `Bearer ${sessao.token}` } })).json()
  assert.equal(historico.length, 1)
  assert.equal(historico[0].content, 'mensagem de antes')
})

// --- 2) as salas do socket ------------------------------------------------------------------

const conectar = () =>
  new Promise((resolve, reject) => {
    const s = socketClient(base, { transports: ['websocket'], extraHeaders: { Origin: SITE } })
    s.on('connect', () => resolve(s))
    s.on('connect_error', reject)
  })

test('entrar numa sala exige a sessão — e a de outro widget é recusada', async () => {
  await semearWidget(DONO, 'chave-a')
  await semearWidget(DONO, 'chave-b')
  const sessaoB = await (await abrirSessao('chave-b')).json()

  const socket = await conectar()
  try {
    const recusas = []
    socket.on('conversation-denied', (m) => recusas.push(m))

    socket.emit('join-conversation', { widgetPublicKey: 'chave-a' }) // sem token
    socket.emit('join-conversation', { widgetPublicKey: 'chave-a', token: sessaoB.token }) // token do OUTRO widget
    socket.emit('join-conversation', { widgetPublicKey: 'nao-existe', token: sessaoB.token })
    await new Promise((r) => setTimeout(r, 600))
    assert.equal(recusas.length, 3, 'as três tentativas foram recusadas')
  } finally {
    socket.close()
  }
})

test('a mensagem chega SÓ na sala do próprio widget', async () => {
  await semearWidget(DONO, 'chave-a')
  await semearWidget(DONO, 'chave-b')
  const sessaoA = await (await abrirSessao('chave-a')).json()
  const sessaoB = await (await abrirSessao('chave-b')).json()

  const [socketA, socketB] = await Promise.all([conectar(), conectar()])
  try {
    const recebidasA = []
    const recebidasB = []
    socketA.on('message', (m) => recebidasA.push(m))
    socketB.on('message', (m) => recebidasB.push(m))
    socketA.emit('join-conversation', { widgetPublicKey: 'chave-a', token: sessaoA.token })
    socketB.emit('join-conversation', { widgetPublicKey: 'chave-b', token: sessaoB.token })
    await new Promise((r) => setTimeout(r, 400))

    await fetch(`${base}/api/public/widgets/chave-a/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessaoA.token}` },
      body: JSON.stringify({ content: 'só para a sala A' }),
    })
    await new Promise((r) => setTimeout(r, 800))

    assert.equal(recebidasA.length, 1, 'o dono da conversa recebe')
    assert.equal(recebidasA[0].content, 'só para a sala A')
    assert.equal(recebidasB.length, 0, 'o outro widget não recebe nada')
  } finally {
    socketA.close()
    socketB.close()
  }
})

test('a sala do dono exige sessão do Better Auth', async () => {
  const socket = await conectar()
  try {
    const recusas = []
    socket.on('conversation-denied', (m) => recusas.push(m))
    socket.emit('join-owner')
    await new Promise((r) => setTimeout(r, 500))
    assert.equal(recusas.length, 1, 'sem sessão não se entra na sala do dono')
  } finally {
    socket.close()
  }
})

// --- 3) o limite que o id novo burlava --------------------------------------------------------

test('inventar conversas novas não burla o limite', async () => {
  await semearWidget(DONO, 'chave-a')

  // O ataque antigo: um `conversationId` novo a cada mensagem zerava o contador.
  let bloqueou = false
  let enviadas = 0
  for (let i = 0; i < 40; i++) {
    const sessao = await (await abrirSessao('chave-a')).json()
    if (!sessao.token) {
      bloqueou = true // o teto de conversas novas por IP também conta
      break
    }
    const res = await fetch(`${base}/api/public/widgets/chave-a/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.token}` },
      body: JSON.stringify({ content: `mensagem ${i}` }),
    })
    if (res.status === 429) {
      bloqueou = true
      assert.ok(Number(res.headers.get('Retry-After')) > 0, 'o 429 diz quando voltar')
      const corpo = await res.json()
      // A resposta não conta qual teto foi atingido nem quanto ele vale.
      assert.doesNotMatch(JSON.stringify(corpo), /\d{2,}/)
      break
    }
    enviadas += 1
  }
  assert.equal(bloqueou, true, `nenhum limite atuou depois de ${enviadas} mensagens com ids diferentes`)
})

// --- 4) o webhook de WhatsApp -------------------------------------------------------------------

const esperarProcessar = () => new Promise((r) => setTimeout(r, 900))

test('entrega FORJADA da Meta não vira mensagem', async () => {
  const canal = await semearCanalWhatsApp('meta', { phoneNumberId: '123', accessToken: 'nao-e-real', verifyToken: 'v', appSecret: 'segredo-do-app-de-teste' })
  const corpo = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{ from: '5511888888888', id: 'wamid.1', type: 'text', text: { body: 'oi' } }] } }] }],
  })

  for (const assinatura of [undefined, 'sha256=00', `sha256=${'a'.repeat(64)}`]) {
    const res = await fetch(`${base}/api/whatsapp/meta/webhook/${canal.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(assinatura ? { 'x-hub-signature-256': assinatura } : {}) },
      body: corpo,
    })
    assert.equal(res.status, 200, 'o provedor recebe 200 para não reentregar em laço')
  }
  await esperarProcessar()
  assert.equal(await db.collection('widget_messages').countDocuments({}), 0, 'nada foi gravado')
})

test('entrega ASSINADA da Meta é aceita — a porta não ficou fechada para o legítimo', async () => {
  const segredo = 'segredo-do-app-de-teste'
  const canal = await semearCanalWhatsApp('meta', { phoneNumberId: '123', accessToken: 'nao-e-real', verifyToken: 'v', appSecret: segredo })
  const corpo = JSON.stringify({
    entry: [{ changes: [{ value: { messages: [{ from: '5511888888888', id: 'wamid.2', type: 'text', text: { body: 'oi de verdade' } }] } }] }],
  })
  const assinatura = `sha256=${createHmac('sha256', segredo).update(Buffer.from(corpo, 'utf8')).digest('hex')}`

  await fetch(`${base}/api/whatsapp/meta/webhook/${canal.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': assinatura },
    body: corpo,
  })
  await esperarProcessar()
  const gravada = await db.collection('widget_messages').findOne({})
  assert.ok(gravada, 'a entrega autêntica virou mensagem')
  assert.equal(gravada.content, 'oi de verdade')
})

test('entrega da Twilio sem assinatura válida não vira mensagem, e a assinada vira', async () => {
  const authToken = 'auth-token-de-teste-1234567890'
  const canal = await semearCanalWhatsApp('twilio', { accountSid: 'AC123', authToken, fromNumber: '+14155238886' })
  const url = `${base}/api/whatsapp/twilio/webhook/${canal.toString()}`
  const params = { From: 'whatsapp:+5511888888888', Body: 'oi pela twilio', MessageSid: 'SM1', NumMedia: '0' }
  const corpo = new URLSearchParams(params).toString()

  const forjada = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'nada-a-ver' },
    body: corpo,
  })
  assert.equal(forjada.status, 200)
  await esperarProcessar()
  assert.equal(await db.collection('widget_messages').countDocuments({}), 0)

  // A assinatura de verdade: URL pública + parâmetros em ordem alfabética.
  const dados = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url)
  const assinatura = createHmac('sha1', authToken).update(Buffer.from(dados, 'utf8')).digest('base64')
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': assinatura },
    body: corpo,
  })
  await esperarProcessar()
  const gravada = await db.collection('widget_messages').findOne({})
  assert.ok(gravada, 'a entrega assinada virou mensagem')
  assert.equal(gravada.content, 'oi pela twilio')
})

test('Evolution sem segredo combinado não entrega nada', async () => {
  const segredo = 'segredo-do-webhook-evolution'
  const canal = await semearCanalWhatsApp('evolution', { baseUrl: 'https://exemplo.test', instance: 'i', apiKey: 'k', webhookSecret: segredo })
  const corpo = JSON.stringify({
    event: 'messages.upsert',
    data: { key: { remoteJid: '5511888888888@s.whatsapp.net', id: 'evo1', fromMe: false }, message: { conversation: 'oi pela evolution' } },
  })

  await fetch(`${base}/api/whatsapp/evolution/webhook/${canal.toString()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo })
  await fetch(`${base}/api/whatsapp/evolution/webhook/${canal.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'chute' },
    body: corpo,
  })
  await esperarProcessar()
  assert.equal(await db.collection('widget_messages').countDocuments({}), 0)

  await fetch(`${base}/api/whatsapp/evolution/webhook/${canal.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': segredo },
    body: corpo,
  })
  await esperarProcessar()
  assert.equal((await db.collection('widget_messages').findOne({}))?.content, 'oi pela evolution')
})

// --- 5) CSRF -----------------------------------------------------------------------------------

test('mutação privada com cookie e origem de fora é recusada', async () => {
  const res = await fetch(`${base}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'comunicacaoai.session_token=qualquer-coisa', Origin: INTRUSO },
    body: JSON.stringify({ name: 'Agente do atacante' }),
  })
  assert.equal(res.status, 403)
  const corpo = await res.json()
  assert.equal(corpo.code, 'origin_not_allowed')
  // A recusa não diz quais origens valem — isso é mapa para quem está tentando.
  assert.doesNotMatch(JSON.stringify(corpo), /127\.0\.0\.1|localhost/)
})

test('o webhook público continua funcionando SEM origem — ele não usa cookie', async () => {
  const canal = await semearCanalWhatsApp('meta', { phoneNumberId: '1', accessToken: 'x', verifyToken: 'v', appSecret: 's'.repeat(20) })
  const res = await fetch(`${base}/api/whatsapp/meta/webhook/${canal.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(res.status, 200, 'a isenção de CSRF vale para os webhooks autenticados por assinatura')
})

// --- 6) os cabeçalhos ---------------------------------------------------------------------------

test('a aplicação não pode ser embutida; o widget pode', async () => {
  const api = await fetch(`${base}/api/health`)
  assert.equal(api.headers.get('x-frame-options'), 'DENY')
  assert.match(api.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(api.headers.get('referrer-policy'), 'no-referrer')
  assert.match(api.headers.get('permissions-policy'), /camera=\(\)/)

  await semearWidget(DONO, 'chave-a')
  const publico = await fetch(`${base}/api/public/widgets/chave-a`)
  assert.equal(publico.headers.get('x-frame-options'), null, 'o widget existe para ser embutido')
  assert.match(publico.headers.get('content-security-policy'), /frame-ancestors \*/)
})
