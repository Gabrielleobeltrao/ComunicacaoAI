// O TIPO `browser` — buscado pelo WORKER isolado, nunca por este processo.
//
// Este arquivo sobe o worker DE VERDADE, num processo separado, e faz a Central coletar
// através dele. É a diferença entre "o contrato existe" e "o contrato funciona".
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const SEGREDO = 'segredo-do-worker-no-teste'
const WORKER = fileURLToPath(new URL('../../browser-worker/src/server.mjs', import.meta.url))

const { mongoClient, db } = await import('../dist/db.js')
const svc = await import('../dist/monitoring/service.js')
const bp = await import('../dist/monitoring/browserProvider.js')

const DONO = 'dono-browser'
let worker
let baseUrl
let site
let portaSite
let respostas

before(async () => {
  await mongoClient.connect()
  await svc.ensureMonitoringIndexes()

  site = createServer((req, res) => {
    const r = respostas[req.url] ?? respostas['*'] ?? { status: 404, headers: { 'content-type': 'text/plain' }, body: 'nao' }
    res.writeHead(r.status ?? 200, r.headers ?? { 'content-type': 'text/html' })
    res.end(r.body ?? '')
  })
  await new Promise((r) => site.listen(0, '127.0.0.1', r))
  portaSite = site.address().port

  const p = spawn(process.execPath, [WORKER], {
    env: { ...process.env, PORT: '0', BROWSER_WORKER_SECRET: SEGREDO, BROWSER_ALLOW_LOOPBACK: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const porta = await new Promise((resolve, reject) => {
    const relogio = setTimeout(() => reject(new Error('o worker não subiu')), 15_000)
    p.stdout.on('data', (d) => {
      for (const linha of String(d).split('\n')) {
        try {
          const j = JSON.parse(linha)
          if (j.evento === 'browser_worker_up') {
            clearTimeout(relogio)
            resolve(j.port)
          }
        } catch {
          // linha que não é JSON não interessa
        }
      }
    })
    p.on('error', reject)
  })
  worker = p
  baseUrl = `http://127.0.0.1:${porta}`
})

after(async () => {
  bp.resetBrowserWorker()
  worker?.kill('SIGKILL')
  await new Promise((r) => site.close(r))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await db.collection('monitoring_sources').deleteMany({})
  bp.resetBrowserWorker()
  respostas = {}
})

const fonte = (over = {}) => ({
  name: `Página ${Math.random()}`,
  kind: 'browser',
  config: { url: `http://127.0.0.1:${portaSite}/p` },
  cadence: { mode: 'interval', intervalMs: 60_000 },
  mapping: { version: 1, fields: [{ to: 'preco', from: 'preco', transforms: [{ op: 'number', locale: 'pt-BR' }] }] },
  destination: { history: true },
  ...over,
})

// --- fail-closed --------------------------------------------------------------------

test('sem worker configurado, o tipo browser RECUSA', async () => {
  const r = await svc.testSource(DONO, fonte())
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_supported')
  assert.match(r.error.message, /worker de páginas/)
})

// --- o caminho real, pelo worker de verdade -------------------------------------------

test('ACEITAÇÃO: a página é buscada PELO WORKER e mapeada', async () => {
  bp.registerBrowserWorker(bp.httpBrowserWorker({ baseUrl, secret: SEGREDO }))
  respostas = { '/p': { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preco: '1.234,56' }) } }

  const r = await svc.testSource(DONO, fonte())
  assert.equal(r.ok, true)
  assert.equal(r.strategy, 'json')
  assert.deepEqual(r.rows, [{ preco: 1234.56 }])
})

test('JSON-LD da página é lido antes do seletor', async () => {
  bp.registerBrowserWorker(bp.httpBrowserWorker({ baseUrl, secret: SEGREDO }))
  respostas = { '/p': { body: '<html><script type="application/ld+json">{"preco":"9,90"}</script></html>' } }

  const r = await svc.testSource(DONO, fonte({ config: { url: `http://127.0.0.1:${portaSite}/p`, selector: '.x' } }))
  assert.equal(r.strategy, 'jsonld')
  assert.deepEqual(r.rows, [{ preco: 9.9 }])
})

test('o seletor DOM é o terceiro degrau', async () => {
  bp.registerBrowserWorker(bp.httpBrowserWorker({ baseUrl, secret: SEGREDO }))
  respostas = { '/p': { body: '<html><div class="preco">R$ 7,50</div></html>' } }

  const r = await svc.testSource(DONO, fonte({
    config: { url: `http://127.0.0.1:${portaSite}/p`, selector: '.preco' },
    mapping: { version: 1, fields: [{ to: 'preco', from: 'texto', transforms: [{ op: 'number', locale: 'pt-BR' }] }] },
  }))
  assert.equal(r.strategy, 'dom')
  assert.deepEqual(r.rows, [{ preco: 7.5 }])
})

test('sem dado estruturado, o degrau caro é tentado — e a recusa diz o que aconteceu', async () => {
  // "Precisou renderizar e ainda assim não trouxe dado" é diferente de "não achei": a
  // primeira diz que o caminho caro já foi tentado, e que o problema é a página.
  bp.registerBrowserWorker(bp.httpBrowserWorker({ baseUrl, secret: SEGREDO }))
  respostas = { '/p': { body: '<html><body>só texto</body></html>' } }

  const r = await svc.testSource(DONO, fonte())
  assert.equal(r.ok, false)
  // Dizer que ela JÁ foi renderizada muda o que a pessoa faz em seguida: sem isso, ela vai
  // procurar um motor que já rodou em vez de olhar a página.
  assert.match(r.error.message, /mesmo renderizada/)
})

test('ACEITAÇÃO: a página que só existe DEPOIS do JavaScript é lida', async () => {
  // É a diferença que o motor faz: o HTML cru não tem o dado; o renderizado tem.
  bp.registerBrowserWorker(bp.httpBrowserWorker({ baseUrl, secret: SEGREDO }))
  respostas = {
    '/p': {
      body: `<html><body><div id="preco">carregando</div>
        <script>document.getElementById('preco').textContent='R$ 42,50'</script></body></html>`,
    },
  }

  const r = await svc.testSource(DONO, fonte({
    config: { url: `http://127.0.0.1:${portaSite}/p`, selector: '#preco', strategy: ['json', 'jsonld', 'dom', 'browser'] },
    mapping: { version: 1, fields: [{ to: 'preco', from: 'texto', transforms: [{ op: 'number', locale: 'pt-BR' }] }] },
  }))

  assert.equal(r.ok, true, JSON.stringify(r.error ?? {}))
  assert.deepEqual(r.rows, [{ preco: 42.5 }], 'o seletor pegou o texto que o JavaScript escreveu')
})

test('o degrau caro NÃO é pago quando o barato resolve', async () => {
  bp.registerBrowserWorker(bp.httpBrowserWorker({ baseUrl, secret: SEGREDO }))
  respostas = { '/p': { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preco: '1,50' }) } }

  const comecou = Date.now()
  const r = await svc.testSource(DONO, fonte())
  assert.equal(r.ok, true)
  assert.equal(r.strategy, 'json')
  // Subir um navegador para ler um JSON custa segundos; o caminho barato custa
  // milissegundos. A diferença é grande o bastante para ser medida.
  assert.ok(Date.now() - comecou < 3_000, 'não subiu navegador para ler JSON')
})

// --- ameaça, pelo caminho real ------------------------------------------------------------

test('AMEAÇA: a metadata da nuvem é bloqueada PELO WORKER', async () => {
  bp.registerBrowserWorker(bp.httpBrowserWorker({ baseUrl, secret: SEGREDO }))
  const r = await svc.testSource(DONO, fonte({ config: { url: 'http://169.254.169.254/latest/meta-data/' } }))
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'blocked')
  assert.ok(!JSON.stringify(r).includes('meta-data/'), 'nem o conteúdo do alvo vaza')
})

test('AMEAÇA: o redirect para a metadata é bloqueado no SEGUNDO salto', async () => {
  bp.registerBrowserWorker(bp.httpBrowserWorker({ baseUrl, secret: SEGREDO }))
  respostas = { '/vai': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } } }
  const r = await svc.testSource(DONO, fonte({ config: { url: `http://127.0.0.1:${portaSite}/vai` } }))
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'blocked')
})

test('AMEAÇA: segredo errado no adapter derruba a chamada', async () => {
  bp.registerBrowserWorker(bp.httpBrowserWorker({ baseUrl, secret: 'errado' }))
  const r = await svc.testSource(DONO, fonte())
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_supported', 'o worker respondeu 401, e isso é indisponibilidade para a fonte')
})

test('worker fora do ar é INDISPONIBILIDADE, não falha da página', async () => {
  bp.registerBrowserWorker(bp.httpBrowserWorker({ baseUrl: 'http://127.0.0.1:9', secret: SEGREDO }))
  const r = await svc.testSource(DONO, fonte())
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_supported')
})

test('o health do worker diz o que ele faz e o que não faz', async () => {
  const h = await bp.httpBrowserWorker({ baseUrl, secret: SEGREDO }).health()
  assert.equal(h.ok, true)
  assert.equal(h.capabilities.fetch, true)
  // Screenshot e visão continuam fora — e dizer isso é o que impede alguém de configurar
  // uma fonte que depende deles.
  assert.equal(h.capabilities.screenshot, false)
  assert.equal(h.capabilities.vision, false)
})
