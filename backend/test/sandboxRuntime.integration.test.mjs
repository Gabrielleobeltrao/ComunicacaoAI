// A SUÍTE DE AMEAÇA — e a primeira coisa que ela prova é que nada executa.
//
// O plano é explícito: sem runtime isolado saudável, código não publica e não roda. Não
// existe `eval`, `new Function`, `vm`, `child_process` nem Python local neste caminho — e
// isso é conferido lendo o próprio fonte do runtime, porque um teste que só chama a API
// não distingue "não executa" de "executa em outro lugar".
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const provider = await import('../dist/extensionRuntime/provider.js')
const scanner = await import('../dist/extensionRuntime/scanner.js')
const broker = await import('../dist/extensionRuntime/broker.js')
const gate = await import('../dist/extensionRuntime/gate.js')

const DONO = 'dono-sandbox'

const SAUDAVEL = {
  ok: true,
  profile: { nonRoot: true, readOnlyRootFs: true, networkDenied: true, noNewPrivileges: true, seccomp: true, ephemeral: true, verifiedCleanup: true },
  runtimes: ['python'],
}

const providerFalso = (health = SAUDAVEL) => ({
  testVersion: async () => ({ ok: true, output: null }),
  execute: async () => ({ ok: true, output: { feito: true } }),
  health: async () => health,
})

before(async () => {
  await mongoClient.connect()
  await broker.ensureBrokerIndexes()
  await gate.ensureKillSwitchIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['sandbox_capability_handles', 'sandbox_kill_switches', 'agents', 'data_stores']) await db.collection(c).deleteMany({})
  provider.resetSandboxProvider()
  delete process.env.CODE_TOOLS_ENABLED
})

// --- a fronteira: nada executa aqui ------------------------------------------------------

test('o módulo de runtime não contém NENHUMA forma de executar código neste processo', () => {
  const dir = new URL('../src/extensionRuntime/', import.meta.url)
  // O que se procura é USO, e não menção: o scanner cita esses nomes dentro das próprias
  // regras dele, e um teste que confundisse as duas coisas impediria de escrever a regra.
  const proibidos = [
    /\beval\s*\(/,
    /new\s+Function\s*\(/,
    /from\s+['"]node:vm['"]/,
    /require\s*\(\s*['"](vm|node:vm|child_process|node:child_process)['"]/,
    /from\s+['"](child_process|node:child_process)['"]/,
    /\b(execSync|spawnSync|execFile|fork)\s*\(/,
  ]
  for (const arquivo of readdirSync(dir)) {
    const fonte = readFileSync(new URL(arquivo, dir), 'utf8')
    // Os comentários FALAM dessas construções de propósito; o que não pode é usá-las.
    const semComentarios = fonte
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
      .join('\n')
    // E a conferência mais direta: nenhum arquivo aqui importa um módulo de execução.
    assert.ok(!/from\s+['"](node:)?(vm|child_process|worker_threads)['"]/.test(semComentarios), `${arquivo} importa um módulo de execução`)
    for (const padrao of proibidos) {
      assert.ok(!padrao.test(semComentarios), `${arquivo} usa ${padrao}`)
    }
  }
})

test('sem provider configurado, testar e executar RECUSAM', async () => {
  const p = provider.sandboxProvider()
  assert.equal((await p.execute({})).ok, false)
  assert.equal((await p.testVersion({})).ok, false)
  assert.equal((await p.health()).ok, false)
})

test('um runner de teste não pode ser registrado em produção', () => {
  const antes = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    assert.throws(() => provider.registerSandboxProvider(providerFalso(), { testOnly: true }), /não pode ser registrado em produção/)
  } finally {
    process.env.NODE_ENV = antes
  }
})

test('o perfil é conferido item a item — um "ok: true" não basta', () => {
  const semRede = { ...SAUDAVEL, profile: { ...SAUDAVEL.profile, networkDenied: false, seccomp: false } }
  const r = provider.profileIsAcceptable(semRede)
  assert.equal(r.ok, false)
  assert.deepEqual(r.missing, ['networkDenied', 'seccomp'])
  assert.equal(provider.profileIsAcceptable(SAUDAVEL).ok, true)
})

// --- o portão -----------------------------------------------------------------------------

test('a flag sozinha não libera nada: sem provider saudável, continua recusado', async () => {
  process.env.CODE_TOOLS_ENABLED = '1'
  const r = await gate.runtimeIsUsable()
  assert.equal(r.ok, false)
  assert.equal(r.code, 'provider_unavailable')
})

test('provider saudável sem a flag também não libera', async () => {
  provider.registerSandboxProvider(providerFalso())
  const r = await gate.runtimeIsUsable()
  assert.equal(r.ok, false)
  assert.equal(r.code, 'flag_off')
})

test('perfil incompleto recusa dizendo o que falta', async () => {
  process.env.CODE_TOOLS_ENABLED = '1'
  provider.registerSandboxProvider(providerFalso({ ...SAUDAVEL, profile: { ...SAUDAVEL.profile, readOnlyRootFs: false } }))
  const r = await gate.runtimeIsUsable()
  assert.equal(r.code, 'profile_incomplete')
  assert.deepEqual(r.detail, ['readOnlyRootFs'])
})

// --- o scanner ------------------------------------------------------------------------------

const bloqueado = (fonte, runtime = 'python') => scanner.scanSource(fonte, runtime).findings.filter((f) => f.severity === 'block')

test('subprocesso, disco, rede, código dinâmico e reflexão são bloqueados', () => {
  assert.ok(bloqueado('import subprocess\nsubprocess.run(["ls"])').length)
  assert.ok(bloqueado('open("/etc/passwd")').length)
  assert.ok(bloqueado('import socket').length)
  assert.ok(bloqueado('exec("x=1")').length)
  assert.ok(bloqueado('print(__builtins__)').length)
  assert.ok(bloqueado('import os\nos.environ["X"]').length)
  assert.ok(bloqueado('require("child_process")', 'javascript').length)
  assert.ok(bloqueado('const f = new Function("return 1")', 'javascript').length)
  assert.ok(bloqueado('await import("./x.js")', 'javascript').length)
})

test('código honesto passa', () => {
  const r = scanner.scanSource('import json\nimport math\n\ndef run(entrada):\n    return {"total": math.fsum(entrada["valores"])}\n', 'python')
  assert.equal(r.ok, true)
  assert.deepEqual(r.imports, ['json', 'math'])
  assert.ok(r.sha256)
})

test('comentário e string não derrubam a publicação — o que conta é a forma do código', () => {
  const fonte = '# não use subprocess aqui\nmsg = "socket eval exec"\nimport json\n'
  assert.equal(scanner.scanSource(fonte, 'python').ok, true)
})

test('import fora da allowlist é bloqueio, e a lista é fechada', () => {
  const r = scanner.scanSource('import requests\n', 'python')
  assert.equal(r.ok, false)
  assert.ok(r.findings.some((f) => f.rule === 'import_not_allowed' || f.rule === 'network'))
  // JavaScript não tem allowlist nenhuma nesta versão: nenhum import passa.
  assert.equal(scanner.scanSource('import x from "lodash"', 'javascript').ok, false)
})

test('ofuscação é AVISO, não bloqueio — e a revisão humana é quem olha', () => {
  const r = scanner.scanSource('import base64\nx = base64.b64decode("YQ==")\n', 'python')
  const aviso = r.findings.find((f) => f.rule === 'obfuscation')
  assert.ok(aviso)
  assert.equal(aviso.severity, 'warn')
})

test('o achado diz a LINHA, e não devolve o fonte', () => {
  const r = scanner.scanSource('import json\nimport socket\n', 'python')
  const achado = r.findings.find((f) => f.rule === 'network')
  assert.equal(achado.line, 2)
  assert.ok(!JSON.stringify(r.findings).includes('import socket'))
})

// --- publicar ----------------------------------------------------------------------------------

const publicavel = 'import json\n\ndef run(e):\n    return {"ok": True}\n'

test('publicar exige runtime, scanner limpo E revisão humana', async () => {
  process.env.CODE_TOOLS_ENABLED = '1'
  provider.registerSandboxProvider(providerFalso())

  const semRevisao = await gate.canPublishCode({ runtime: 'python', source: publicavel })
  assert.equal(semRevisao.code, 'review_required')

  const sujo = await gate.canPublishCode({ runtime: 'python', source: 'import socket\n', humanReview: { reviewerId: 'r', at: new Date() } })
  assert.equal(sujo.code, 'scan_failed')

  const bom = await gate.canPublishCode({ runtime: 'python', source: publicavel, humanReview: { reviewerId: 'r', at: new Date() } })
  assert.equal(bom.ok, true)
  assert.ok(bom.value.sha256)
  assert.deepEqual(bom.value.imports, ['json'])
})

test('o kill switch desliga por HASH, em qualquer conta', async () => {
  process.env.CODE_TOOLS_ENABLED = '1'
  provider.registerSandboxProvider(providerFalso())
  const { value } = await gate.canPublishCode({ runtime: 'python', source: publicavel, humanReview: { reviewerId: 'r', at: new Date() } })

  await gate.killSwitch({ sha256: value.sha256, reason: 'exfiltrava dado por timing', createdBy: 'seguranca' })

  const publicar = await gate.canPublishCode({ runtime: 'python', source: publicavel, humanReview: { reviewerId: 'r', at: new Date() } })
  assert.equal(publicar.code, 'killed')
  const executar = await gate.canExecuteCode({ sha256: value.sha256 })
  assert.equal(executar.code, 'killed')
  assert.match(executar.message, /exfiltrava dado/)
})

test('o kill switch sem versão desliga o PACOTE inteiro', async () => {
  process.env.CODE_TOOLS_ENABLED = '1'
  provider.registerSandboxProvider(providerFalso())
  const packageId = new ObjectId()
  await gate.killSwitch({ packageId, reason: 'autor comprometido', createdBy: 'seguranca' })

  assert.equal((await gate.canExecuteCode({ packageId, version: '1.0.0', sha256: 'x' })).code, 'killed')
  assert.equal((await gate.canExecuteCode({ packageId, version: '9.9.9', sha256: 'y' })).code, 'killed')
  assert.equal((await gate.canExecuteCode({ packageId: new ObjectId(), sha256: 'z' })).ok, true)
})

test('desligar exige alvo e motivo', async () => {
  await assert.rejects(() => gate.killSwitch({ reason: 'x', createdBy: 'y' }), /o que está sendo desligado/)
  await assert.rejects(() => gate.killSwitch({ sha256: 'a', reason: '', createdBy: 'y' }), /por que/)
})

// --- o broker ------------------------------------------------------------------------------------

test('o token NUNCA é gravado: o banco guarda só o hash', async () => {
  const { token } = await broker.issueHandle({
    ownerId: DONO,
    executionKey: 'run:1',
    capability: { kind: 'database_query', target: `${new ObjectId()}:vendas` },
  })
  const guardado = await db.collection('sandbox_capability_handles').findOne({})
  assert.ok(!JSON.stringify(guardado).includes(token), 'um banco vazado não pode virar acesso vazado')
  assert.ok(guardado.tokenHash)
})

test('o bilhete vale para UMA execução — o de outra não abre nada', async () => {
  const { token } = await broker.issueHandle({ ownerId: DONO, executionKey: 'run:1', capability: { kind: 'app_action', target: 'a:b' } })
  const r = await broker.redeem(token, 'run:2')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'handle_invalido')
})

test('os usos são contados, e o excedente é recusado', async () => {
  const { token } = await broker.issueHandle({ ownerId: DONO, executionKey: 'run:1', capability: { kind: 'app_action', target: 'a:b' }, uses: 2 })
  assert.equal((await broker.redeem(token, 'run:1')).ok, true)
  assert.equal((await broker.redeem(token, 'run:1')).ok, true)
  assert.equal((await broker.redeem(token, 'run:1')).ok, false)
})

test('o bilhete expira — e expirado é igual a inexistente', async () => {
  const { token } = await broker.issueHandle({ ownerId: DONO, executionKey: 'run:1', capability: { kind: 'app_action', target: 'a:b' } })
  const daquiUmMinuto = new Date(Date.now() + 60_000)
  assert.equal((await broker.redeem(token, 'run:1', daquiUmMinuto)).ok, false)
})

test('token inventado não abre nada', async () => {
  assert.equal((await broker.redeem('nao-existe', 'run:1')).ok, false)
})

test('pedir OUTRA capacidade com o mesmo bilhete é recusado', async () => {
  const { token } = await broker.issueHandle({ ownerId: DONO, executionKey: 'run:1', capability: { kind: 'app_action', target: 'agenda:criar' } })
  const r = await broker.useCapability({ token, executionKey: 'run:1', capability: { kind: 'app_action', target: 'agenda:apagar' } })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'fora_do_escopo')
})

test('a permissão é RECONFERIDA no resolvedor canônico, e não no bilhete', async () => {
  const agentId = new ObjectId()
  await db.collection('agents').insertOne({
    _id: agentId,
    ownerId: DONO,
    name: 'Operador',
    objective: 'operar',
    provider: 'anthropic',
    appGrants: [{ appKey: 'agenda', installationId: new ObjectId().toString(), actionKeys: ['criar'] }],
    createdAt: new Date(),
  })
  const { token } = await broker.issueHandle({ ownerId: DONO, agentId, executionKey: 'run:1', capability: { kind: 'app_action', target: 'agenda:criar' }, uses: 3 })

  // O grant é retirado DEPOIS de o bilhete existir.
  await db.collection('agents').updateOne({ _id: agentId }, { $set: { appGrants: [] } })
  const r = await broker.useCapability({ token, executionKey: 'run:1', capability: { kind: 'app_action', target: 'agenda:criar' } })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'sem_permissao', 'o bilhete responde "pediu?", o resolvedor responde "ainda pode?"')
})

test('o fim da execução leva os bilhetes junto', async () => {
  await broker.issueHandle({ ownerId: DONO, executionKey: 'run:1', capability: { kind: 'app_action', target: 'a:b' } })
  await broker.issueHandle({ ownerId: DONO, executionKey: 'run:1', capability: { kind: 'app_action', target: 'c:d' } })
  await broker.issueHandle({ ownerId: DONO, executionKey: 'run:2', capability: { kind: 'app_action', target: 'e:f' } })

  assert.equal(await broker.revokeForExecution('run:1'), 2)
  assert.equal(await db.collection('sandbox_capability_handles').countDocuments({}), 1)
})

// --- a ligação com a ferramenta de código -------------------------------------------------

test('publicar uma ferramenta de código passa pelo portão inteiro', async () => {
  const { publishVersion, ensureToolVersionIndexes } = await import('../dist/toolVersions.js')
  await ensureToolVersionIndexes()
  const toolId = new ObjectId()
  const versaoCode = (over = {}) => ({
    version: '1.0.0',
    runtimeKind: 'code',
    manifest: { runtime: 'python', source: 'import json\n\ndef run(e):\n    return {"ok": True}\n', ...over },
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  })

  // Sem a flag: recusa com o código que a tela sabe explicar.
  await assert.rejects(
    () => publishVersion(DONO, toolId, versaoCode()),
    (e) => {
      assert.equal(e.code, 'code_runtime_disabled')
      return true
    },
  )

  // Com a flag e sem provider saudável: continua recusado, por outro motivo.
  process.env.CODE_TOOLS_ENABLED = '1'
  await assert.rejects(
    () => publishVersion(DONO, toolId, versaoCode()),
    (e) => {
      assert.equal(e.code, 'provider_unavailable')
      return true
    },
  )

  // Com provider saudável, mas com código sujo: o scanner recusa.
  provider.registerSandboxProvider(providerFalso())
  await assert.rejects(
    () => publishVersion(DONO, toolId, versaoCode({ source: 'import socket\n' })),
    (e) => {
      assert.equal(e.code, 'scan_failed')
      return true
    },
  )

  // Limpo, mas sem revisão humana: ainda não publica.
  await assert.rejects(
    () => publishVersion(DONO, toolId, versaoCode()),
    (e) => {
      assert.equal(e.code, 'review_required')
      return true
    },
  )

  // Tudo no lugar: publica.
  const v = await publishVersion(DONO, toolId, versaoCode({ humanReview: { reviewerId: 'revisor', at: new Date() } }))
  assert.equal(v.runtimeKind, 'code')
  assert.equal(v.risk, 'high_risk', 'código é high_risk por definição')

  await db.collection('tool_versions').deleteMany({})
})

test('executar código desligado pelo kill switch recusa na EXECUÇÃO, não na próxima publicação', async () => {
  process.env.CODE_TOOLS_ENABLED = '1'
  provider.registerSandboxProvider(providerFalso())
  const sha = 'a'.repeat(64)
  assert.equal((await gate.canExecuteCode({ sha256: sha })).ok, true)
  await gate.killSwitch({ sha256: sha, reason: 'lia variável de ambiente por reflexão', createdBy: 'seguranca' })
  const r = await gate.canExecuteCode({ sha256: sha })
  assert.equal(r.code, 'killed')
})
