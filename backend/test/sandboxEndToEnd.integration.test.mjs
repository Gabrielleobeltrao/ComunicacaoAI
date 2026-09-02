// O CAMINHO INTEIRO do código: ferramenta → portão → adapter assinado → runner isolado.
//
// Este arquivo sobe o RUNNER DE VERDADE, num processo separado, e faz o backend executar
// através dele. É a diferença entre "o contrato existe" e "o contrato funciona": as juntas
// são onde as coisas quebram — uma assinatura que não bate, um hash conferido de um lado
// só, um limite que ninguém aplica.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { ObjectId } from 'mongodb'
import { fileURLToPath } from 'node:url'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const SEGREDO = 'segredo-de-servico-do-teste'
const RUNNER = fileURLToPath(new URL('../../runner/src/server.mjs', import.meta.url))

const { mongoClient, db } = await import('../dist/db.js')
const { executeAgentTool } = await import('../dist/executors/toolExecutor.js')
const { publishVersion, ensureToolVersionIndexes } = await import('../dist/toolVersions.js')
const { httpSandboxProvider } = await import('../dist/extensionRuntime/httpProvider.js')
const { registerSandboxProvider, resetSandboxProvider, profileIsAcceptable } = await import('../dist/extensionRuntime/provider.js')
const { ensureBrokerIndexes } = await import('../dist/extensionRuntime/broker.js')
const { ensureKillSwitchIndexes, killSwitch, canExecuteCode } = await import('../dist/extensionRuntime/gate.js')
const { ensureReviewIndexes, recordReview } = await import('../dist/extensionRuntime/review.js')
const { scanSource } = await import('../dist/extensionRuntime/scanner.js')

const DONO = 'dono-sandbox-e2e'
let runner
let baseUrl

/** Sobe o runner como PROCESSO SEPARADO — que é o que ele é em produção. */
async function subirRunner() {
  const p = spawn(process.execPath, [RUNNER], {
    env: { ...process.env, PORT: '0', SANDBOX_RUNNER_SECRET: SEGREDO, SANDBOX_CONCURRENCY: '2' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // A porta 0 pede uma livre ao sistema; o runner anuncia qual foi.
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
  return { processo: p, url: `http://127.0.0.1:${porta}` }
}

before(async () => {
  await mongoClient.connect()
  await ensureToolVersionIndexes()
  await ensureBrokerIndexes()
  await ensureKillSwitchIndexes()
  await ensureReviewIndexes()
  const subiu = await subirRunner()
  runner = subiu.processo
  baseUrl = subiu.url
})

after(async () => {
  resetSandboxProvider()
  runner?.kill('SIGKILL')
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const FONTE = 'function run(entrada) { return { dobro: entrada.n * 2 } }'

let toolId
let agentId

beforeEach(async () => {
  for (const c of ['tools', 'tool_versions', 'tool_version_calls', 'agents', 'sandbox_capability_handles', 'sandbox_kill_switches', 'extension_reviews'])
    await db.collection(c).deleteMany({})
  process.env.PLATFORM_REVIEWERS = 'revisor-da-plataforma'
  resetSandboxProvider()
  process.env.CODE_TOOLS_ENABLED = '1'
  registerSandboxProvider(httpSandboxProvider({ baseUrl, secret: SEGREDO }))

  const t = await db.collection('tools').insertOne({
    ownerId: DONO,
    name: 'calcular_dobro',
    description: 'dobra um número',
    enabled: true,
    method: 'GET',
    url: 'https://exemplo.test/nao-usado',
    headers: [],
    inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    allowedDomains: [],
    timeoutMs: 8_000,
    maxResponseChars: 4_000,
    maxCallsPerRun: 5,
    allowAutonomousExecution: true,
  })
  toolId = t.insertedId

  agentId = new ObjectId()
  await db.collection('agents').insertOne({
    _id: agentId,
    ownerId: DONO,
    name: 'Operador',
    objective: 'operar',
    provider: 'anthropic',
    toolIds: [toolId.toString()],
    appGrants: [],
    createdAt: new Date(),
  })
})

const agente = () => ({ _id: agentId, ownerId: DONO, name: 'Operador', toolIds: [toolId.toString()], appGrants: [] })

/**
 * Publica uma versão de código — com a aprovação gravada pelo SERVIDOR antes.
 *
 * A aprovação é presa ao hash do código: mudar a fonte no `over` significa aprovar outra
 * coisa, e é por isso que o hash é calculado da fonte que vai de fato.
 */
const publicarCodigo = async (over = {}) => {
  const manifest = { runtime: 'javascript', source: FONTE, ...over }
  await recordReview({
    subjectType: 'tool',
    subjectId: toolId,
    version: '1.0.0',
    sha256: scanSource(manifest.source, 'javascript').sha256,
    decision: 'approved',
    reviewerId: 'revisor-da-plataforma',
  }).catch((e) => {
    // Reaprovar o mesmo hash é recusado pelo registro imutável; para o teste isso é ok.
    if (e.code !== 'duplicate') throw e
  })
  return publishVersion(DONO, toolId, {
    version: '1.0.0',
    runtimeKind: 'code',
    manifest,
    inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    outputSchema: { type: 'object', properties: { dobro: { type: 'number' } }, required: ['dobro'] },
  })
}

const chamar = (args) => executeAgentTool(agente(), DONO, { kind: 'tool', toolId: toolId.toString() }, args)

// --- o perfil decide se publica e se executa ------------------------------------------------

test('o perfil medido nesta máquina NÃO é aceitável — e por isso código não roda', async () => {
  // A máquina de desenvolvimento tem rede e não é efêmera. O runner mede e diz isso; o
  // backend recusa. É o fail-closed acontecendo por medição, não por lembrança.
  const health = await httpSandboxProvider({ baseUrl, secret: SEGREDO }).health()
  const perfil = profileIsAcceptable(health)
  assert.equal(perfil.ok, false)
  assert.ok(perfil.missing.length > 0)

  const portao = await canExecuteCode({ sha256: 'x'.repeat(64) })
  assert.equal(portao.ok, false)
  assert.equal(portao.code, 'profile_incomplete')
})

// A partir daqui, o perfil é dado como aceitável para exercitar o CAMINHO — o que se
// testa é a execução, e não a decisão de habilitar, que o caso acima já cobre.
const comPerfilAceito = () => {
  const real = httpSandboxProvider({ baseUrl, secret: SEGREDO })
  registerSandboxProvider({
    execute: (r) => real.execute(r),
    testVersion: (r) => real.testVersion(r),
    // O perfil é o único ponto substituído: o resto atravessa a rede de verdade.
    health: async () => ({
      ok: true,
      profile: { nonRoot: true, readOnlyRootFs: true, networkDenied: true, noNewPrivileges: true, seccomp: true, ephemeral: true, verifiedCleanup: true },
      runtimes: ['javascript'],
    }),
  })
}

// --- publicar e executar ponta a ponta ---------------------------------------------------------

test('ACEITAÇÃO: a ferramenta de código publica e EXECUTA pelo runner isolado', async () => {
  comPerfilAceito()
  const v = await publicarCodigo()
  assert.equal(v.runtimeKind, 'code')

  const r = await chamar({ n: 21 })
  assert.equal(r.ok, true, JSON.stringify(r.error ?? {}))
  assert.deepEqual(r.structured.data, { dobro: 42 })
  assert.ok(r.metadata.metrics.wallMs >= 0, 'as métricas do runner chegam ao executor')
  assert.equal(r.metadata.runtimeKind, 'code')
})

test('a entrada é validada contra o contrato PUBLICADO antes de o código rodar', async () => {
  comPerfilAceito()
  await publicarCodigo()
  const r = await chamar({ n: 'vinte' })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'invalid_input')
})

test('saída fora do contrato publicado é recusada, e não repassada', async () => {
  comPerfilAceito()
  await publicarCodigo({ source: 'function run(){ return { texto: "outra forma" } }' })
  const r = await chamar({ n: 1 })
  assert.equal(r.ok, false)
  assert.match(r.error.message, /contrato publicado/)
})

test('o scanner recusa na PUBLICAÇÃO o que não deveria nem ser tentado', async () => {
  comPerfilAceito()
  await assert.rejects(
    () => publicarCodigo({ source: 'async function run(){ const fs = await import("node:fs"); return { dobro: 1 } }' }),
    (e) => {
      assert.equal(e.code, 'scan_failed')
      return true
    },
  )
})

test('e o que passa pelo scanner ainda é negado pelo RUNTIME — defesa em profundidade', async () => {
  comPerfilAceito()
  // `process.dlopen` carrega código nativo e não está nas regras léxicas: ele publica. O
  // modelo de permissão do runner é quem nega — que é exatamente o ponto de a sandbox não
  // ser substituível por um scanner.
  await publicarCodigo({ source: 'function run(){ process.dlopen({}, "/tmp/x.node"); return { dobro: 1 } }' })
  const r = await chamar({ n: 1 })
  assert.equal(r.ok, false)
  assert.match(r.error.message, /não é permitida/)
})

test('laço infinito é cortado pelo runner, e vira timeout tipado', async () => {
  comPerfilAceito()
  await publicarCodigo({ source: 'function run(){ while(true){} }', wallMs: 700 })
  const r = await chamar({ n: 1 })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'timeout')
})

test('o kill switch pelo hash desliga a execução que já estava publicada', async () => {
  comPerfilAceito()
  const v = await publicarCodigo()
  assert.equal((await chamar({ n: 2 })).ok, true)

  await killSwitch({ sha256: v.sha256, reason: 'lia entrada de outra conta', createdBy: 'seguranca' })
  const r = await chamar({ n: 2 })
  assert.equal(r.ok, false)
  assert.match(r.error.message, /lia entrada de outra conta/)
})

test('runner fora do ar é INDISPONIBILIDADE, não falha de quem escreveu o código', async () => {
  comPerfilAceito()
  await publicarCodigo()
  // Aponta para uma porta onde não há ninguém.
  registerSandboxProvider({
    ...httpSandboxProvider({ baseUrl: 'http://127.0.0.1:9', secret: SEGREDO }),
    health: async () => ({
      ok: true,
      profile: { nonRoot: true, readOnlyRootFs: true, networkDenied: true, noNewPrivileges: true, seccomp: true, ephemeral: true, verifiedCleanup: true },
      runtimes: ['javascript'],
    }),
  })
  const r = await chamar({ n: 1 })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_configured')
})

test('segredo errado no adapter derruba a chamada — a assinatura é conferida do outro lado', async () => {
  comPerfilAceito()
  await publicarCodigo()
  registerSandboxProvider({
    ...httpSandboxProvider({ baseUrl, secret: 'segredo-errado' }),
    health: async () => ({
      ok: true,
      profile: { nonRoot: true, readOnlyRootFs: true, networkDenied: true, noNewPrivileges: true, seccomp: true, ephemeral: true, verifiedCleanup: true },
      runtimes: ['javascript'],
    }),
  })
  const r = await chamar({ n: 1 })
  assert.equal(r.ok, false)
})

// --- os bilhetes de capacidade ----------------------------------------------------------------------

test('os bilhetes emitidos para a execução são revogados no fim, sempre', async () => {
  comPerfilAceito()
  await publicarCodigo({ capabilities: [{ kind: 'database_query', target: `${new ObjectId()}:vendas` }] })

  await chamar({ n: 1 })
  assert.equal(await db.collection('sandbox_capability_handles').countDocuments({}), 0, 'bilhete que sobrevive à execução é chave esquecida na fechadura')

  // E também quando a execução falha.
  await db.collection('tool_versions').deleteMany({})
  await publicarCodigo({ source: 'function run(){ throw new Error("quebrou") }', capabilities: [{ kind: 'database_query', target: `${new ObjectId()}:vendas` }] })
  await chamar({ n: 1 })
  assert.equal(await db.collection('sandbox_capability_handles').countDocuments({}), 0)
})

test('a trilha registra a execução de código com o hash, e sem a entrada', async () => {
  comPerfilAceito()
  const v = await publicarCodigo()
  await chamar({ n: 7 })
  const [linha] = await db.collection('tool_version_calls').find({ ownerId: DONO }).toArray()
  assert.equal(linha.runtimeKind, 'code')
  assert.equal(linha.risk, 'high_risk')
  assert.equal(linha.sha256, v.sha256)
  assert.ok(!JSON.stringify(linha).includes('"n"'))
})
