// O SCRIPT de extração — na SANDBOX, sobre dado sanitizado, e versionado.
//
// Este arquivo sobe o runner isolado DE VERDADE, em processo separado. O DSL fechado
// continua sendo o caminho normal; o script existe para a transformação que ele não faz —
// e o custo de passar pela sandbox é exatamente o custo que essa escolha deve ter.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const SEGREDO = 'segredo-do-runner-no-script'
const RUNNER = fileURLToPath(new URL('../../runner/src/server.mjs', import.meta.url))

const { mongoClient, db } = await import('../dist/db.js')
const svc = await import('../dist/monitoring/service.js')
const provider = await import('../dist/extensionRuntime/provider.js')
const { httpSandboxProvider } = await import('../dist/extensionRuntime/httpProvider.js')

const DONO = 'dono-script'
let runner
let baseUrl
let site
let portaSite
let corpo

const PERFIL_ACEITO = {
  ok: true,
  profile: { nonRoot: true, readOnlyRootFs: true, networkDenied: true, noNewPrivileges: true, seccomp: true, ephemeral: true, verifiedCleanup: true },
  runtimes: ['javascript'],
}

before(async () => {
  await mongoClient.connect()
  await svc.ensureMonitoringIndexes()

  site = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(corpo)
  })
  await new Promise((r) => site.listen(0, '127.0.0.1', r))
  portaSite = site.address().port

  const p = spawn(process.execPath, [RUNNER], {
    env: { ...process.env, PORT: '0', SANDBOX_RUNNER_SECRET: SEGREDO },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const porta = await new Promise((resolve, reject) => {
    const relogio = setTimeout(() => reject(new Error('o runner não subiu')), 15_000)
    p.stdout.on('data', (d) => {
      for (const linha of String(d).split('\n')) {
        try {
          const j = JSON.parse(linha)
          if (j.evento === 'runner_up') {
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
  runner = p
  baseUrl = `http://127.0.0.1:${porta}`
})

after(async () => {
  provider.resetSandboxProvider()
  runner?.kill('SIGKILL')
  await new Promise((r) => site.close(r))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

/** O perfil é substituído para exercitar o CAMINHO; a execução atravessa a rede de verdade. */
const comSandbox = () => {
  const real = httpSandboxProvider({ baseUrl, secret: SEGREDO })
  provider.registerSandboxProvider({ execute: (r) => real.execute(r), testVersion: (r) => real.testVersion(r), health: async () => PERFIL_ACEITO })
}

beforeEach(async () => {
  await db.collection('monitoring_sources').deleteMany({})
  provider.resetSandboxProvider()
  corpo = JSON.stringify({ itens: [{ v: '10' }, { v: '20' }, { v: '30' }] })
})

const fonte = (over = {}) => ({
  name: `Fonte ${Math.random()}`,
  kind: 'api_polling',
  config: { url: `http://127.0.0.1:${portaSite}/x`, ...over.config },
  cadence: { mode: 'interval', intervalMs: 60_000 },
  mapping: { version: 1, fields: [{ to: 'total', from: 'total' }] },
  destination: { history: true },
  ...over,
  ...(over.config ? { config: { url: `http://127.0.0.1:${portaSite}/x`, ...over.config } } : {}),
})

// --- a validação ------------------------------------------------------------------------

test('o script é versionado, e a versão é inteiro positivo', async () => {
  await assert.rejects(
    () => svc.createSource(DONO, fonte({ config: { extractScript: { version: 0, source: 'function extract(d){return d}' } } })),
    /inteiro positivo/,
  )
})

test('script grande demais é recusado — programa tem outro lugar', async () => {
  await assert.rejects(
    () => svc.createSource(DONO, fonte({ config: { extractScript: { version: 1, source: 'x'.repeat(9000) } } })),
    /passa de 8000/,
  )
})

test('script não faz parte de uma fonte de webhook', async () => {
  await assert.rejects(
    () =>
      svc.createSource(DONO, fonte({
        kind: 'webhook',
        cadence: { mode: 'stream' },
        config: { extractScript: { version: 1, source: 'function extract(d){return d}' } },
      })),
    /não faz parte/,
  )
})

// --- fail-closed -------------------------------------------------------------------------

test('sem sandbox saudável, a fonte com script FALHA — e não segue sem ele', async () => {
  // Seguir aplicaria o mapeamento a um dado ainda não transformado, e produziria valores
  // errados com cara de certos.
  const r = await svc.testSource(DONO, fonte({ config: { extractScript: { version: 1, source: 'function extract(d){return d}' } } }))
  assert.equal(r.ok, false)
  assert.match(r.error.message, /runtime isolado/)
})

// --- o caminho real ------------------------------------------------------------------------

test('ACEITAÇÃO: o script roda na SANDBOX e o resultado é mapeado', async () => {
  comSandbox()
  const r = await svc.testSource(DONO, fonte({
    config: {
      extractScript: {
        version: 1,
        // A transformação que o DSL fechado não faz: somar uma lista.
        source: 'function extract(d) { return { total: d.itens.reduce((s, i) => s + Number(i.v), 0) } }',
      },
    },
  }))

  assert.equal(r.ok, true, JSON.stringify(r.error ?? {}))
  assert.deepEqual(r.rows, [{ total: 60 }])
})

test('a AMOSTRA continua sendo o bruto: é ele que explica o que o script fez', async () => {
  comSandbox()
  const r = await svc.testSource(DONO, fonte({
    config: { extractScript: { version: 1, source: 'function extract(d) { return { total: 999 } }' } },
  }))
  assert.deepEqual(r.sample, { itens: [{ v: '10' }, { v: '20' }, { v: '30' }] })
  assert.deepEqual(r.rows, [{ total: 999 }])
})

test('AMEAÇA: o script não alcança disco, subprocesso nem rede', async () => {
  comSandbox()
  for (const fonteMaliciosa of [
    'async function extract(){ const fs = await import("node:fs"); return { total: fs.readFileSync("/etc/hosts").length } }',
    'async function extract(){ const cp = await import("node:child_process"); return { total: String(cp.execSync("id")).length } }',
    'async function extract(){ const r = await fetch("http://169.254.169.254/"); return { total: 1 } }',
  ]) {
    const r = await svc.testSource(DONO, fonte({ config: { extractScript: { version: 1, source: fonteMaliciosa } } }))
    assert.equal(r.ok, false, fonteMaliciosa.slice(0, 40))
    assert.match(r.error.message, /script de extração falhou/)
  }
})

test('AMEAÇA: o script não recebe credencial nem identidade da conta', async () => {
  comSandbox()
  const r = await svc.testSource(DONO, fonte({
    config: {
      extractScript: {
        version: 1,
        // Ele tenta enxergar o que foi passado além do dado.
        source: 'function extract(d, ...resto) { return { total: JSON.stringify({ chaves: Object.keys(globalThis.__input ?? {}), resto: resto.length }) } }',
      },
    },
  }))
  const texto = JSON.stringify(r)
  assert.ok(!texto.includes(DONO), 'nenhum id de conta atravessa')
  assert.ok(!/ENCRYPTION_KEY|ANTHROPIC|senha/i.test(texto))
})

test('laço infinito no script é cortado pelo runner', async () => {
  comSandbox()
  const r = await svc.testSource(DONO, fonte({
    config: { extractScript: { version: 1, source: 'function extract(){ while(true){} }' } },
    retry: { timeoutMs: 2_000, maxAttempts: 1, backoffMs: 1_000, jitterRatio: 0, rateLimitPerMinute: null },
  }))
  assert.equal(r.ok, false)
  assert.match(r.error.message, /script de extração falhou/)
})

test('script que não devolve nada é recusado, e não vira linha vazia', async () => {
  comSandbox()
  const r = await svc.testSource(DONO, fonte({
    config: { extractScript: { version: 1, source: 'function extract(){ }' } },
  }))
  assert.equal(r.ok, false)
  assert.match(r.error.message, /não devolveu nada/)
})

test('sem script, nada muda: o DSL continua sendo o caminho normal', async () => {
  comSandbox()
  corpo = JSON.stringify({ total: 7 })
  const r = await svc.testSource(DONO, fonte())
  assert.equal(r.ok, true)
  assert.deepEqual(r.rows, [{ total: 7 }])
})
