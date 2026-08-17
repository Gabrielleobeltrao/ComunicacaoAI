// INTEGRATION: o contrato HTTP que produção depende, contra o servidor de verdade.
//
// Sobe o app real (o mesmo `dist/index.js` que a imagem roda) com um mongod
// isolado e os DOMÍNIOS DOCUMENTADOS de produção, e pergunta a ele o que só se
// descobre falando HTTP: quem o CORS deixa entrar, que atributos o cookie de sessão
// carrega, se o Socket.IO respeita a mesma lista, e se um webhook sem assinatura é
// recusado.
//
// Nada sai da máquina: as origens são strings de configuração, e as requisições vão
// todas para o processo que este arquivo mesmo subiu.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

const RAIZ = new URL('..', import.meta.url).pathname
const PORTA = 4487

// Os domínios do COOLIFY_DEPLOYMENT.md. Nenhum é chamado — são a configuração
// contra a qual o servidor decide quem entra.
const SITE = 'https://comunicacaoai.onplataform.com'
const API = 'https://api.comunicacaoai.onplataform.com'
const INTRUSO = 'https://nao-e-nosso.example'

let proc
const base = `http://127.0.0.1:${PORTA}`

before(async () => {
  const uri = await startMongo()
  proc = spawn(process.execPath, ['dist/index.js'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      // Sem `.env` da máquina: o contrato tem que valer com o que está escrito aqui.
      DOTENV_CONFIG_PATH: join(RAIZ, 'test/.sem-env'),
      NODE_ENV: 'test',
      PORT: String(PORTA),
      MONGODB_URI: uri,
      BETTER_AUTH_SECRET: 'contrato-'.padEnd(40, 'x'),
      ENCRYPTION_KEY: 'contrato-'.padEnd(40, 'y'),
      CLIENT_URL: SITE,
      PUBLIC_URL: API,
      BETTER_AUTH_URL: API,
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
  throw new Error('a API não subiu para o teste de contrato')
})

after(async () => {
  if (proc && proc.exitCode === null) {
    const saiu = new Promise((r) => proc.once('exit', r))
    proc.kill('SIGTERM')
    await Promise.race([saiu, new Promise((r) => setTimeout(() => (proc.kill('SIGKILL'), r()), 15_000))])
  }
  await stopMongo()
})

// --- CORS ------------------------------------------------------------------------

test('o site documentado é aceito, com credencial', async () => {
  const res = await fetch(`${base}/api/ready`, { headers: { Origin: SITE } })
  assert.equal(res.headers.get('access-control-allow-origin'), SITE)
  // Sem isto, o navegador não envia o cookie de sessão em requisição cruzada.
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true')
})

test('uma origem de fora da lista não é ecoada de volta', async () => {
  const res = await fetch(`${base}/api/ready`, { headers: { Origin: INTRUSO } })
  // O que NÃO pode acontecer é o servidor devolver a origem do intruso ou `*`
  // junto de credenciais — é isso que abriria a sessão para qualquer site.
  const permitida = res.headers.get('access-control-allow-origin')
  assert.notEqual(permitida, INTRUSO)
  assert.notEqual(permitida, '*')
})

test('o preflight de uma rota privada responde à origem documentada', async () => {
  const res = await fetch(`${base}/api/floors`, {
    method: 'OPTIONS',
    headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  })
  assert.ok(res.status < 400, `preflight devolveu ${res.status}`)
  assert.equal(res.headers.get('access-control-allow-origin'), SITE)
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true')
})

test('a rota pública do widget aceita qualquer origem, e SEM credencial', async () => {
  // O carregador do widget roda no site do cliente, em domínio arbitrário. Por
  // isso a origem é livre — e justamente por isso o cookie não pode viajar junto.
  const res = await fetch(`${base}/api/public/widgets/inexistente/messages`, {
    method: 'OPTIONS',
    headers: { Origin: INTRUSO, 'Access-Control-Request-Method': 'POST' },
  })
  assert.equal(res.headers.get('access-control-allow-origin'), INTRUSO)
  assert.notEqual(res.headers.get('access-control-allow-credentials'), 'true')
})

// --- sessão ----------------------------------------------------------------------

test('o cookie de sessão é HttpOnly e tem caminho de raiz', async () => {
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({ name: 'Contrato', email: 'contrato@local.test', password: 'contrato-senha-123' }),
  })
  assert.ok(res.ok, `registro devolveu ${res.status}`)
  const cookies = res.headers.getSetCookie?.() ?? []
  const sessao = cookies.find((c) => /session/i.test(c))
  assert.ok(sessao, 'o registro tem que devolver um cookie de sessão')
  // HttpOnly: script de página nenhuma lê a sessão.
  assert.match(sessao, /HttpOnly/i)
  assert.match(sessao, /Path=\//i)
})

test('rota privada sem sessão é 401, não 200 vazio', async () => {
  const res = await fetch(`${base}/api/floors`, { headers: { Origin: SITE } })
  assert.equal(res.status, 401)
})

// --- Socket.IO -------------------------------------------------------------------

test('o Socket.IO usa a MESMA lista de origens da API', async () => {
  const doSite = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: SITE } })
  assert.equal(doSite.headers.get('access-control-allow-origin'), SITE)
  assert.equal(doSite.headers.get('access-control-allow-credentials'), 'true')

  const doIntruso = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: INTRUSO } })
  assert.notEqual(doIntruso.headers.get('access-control-allow-origin'), INTRUSO)
})

// --- webhook ----------------------------------------------------------------------

test('webhook de entrada sem credencial válida não executa nada', async () => {
  const res = await fetch(`${base}/api/webhooks/inexistente`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qualquer: 'coisa' }),
  })
  // Recusado — e nunca um 200 que faria o chamador acreditar que disparou algo.
  assert.ok(res.status >= 400, `o webhook devolveu ${res.status}`)
  const texto = await res.text()
  // A recusa não conta o que existe do outro lado.
  assert.doesNotMatch(texto, /secret|token|mongodb|ENCRYPTION/i)
})
