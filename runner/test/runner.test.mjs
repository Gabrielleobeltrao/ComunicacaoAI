// O RUNNER — e a única coisa que ele precisa provar: o que o código do outro NÃO consegue.
//
// Estes casos rodam código de verdade, num processo filho de verdade, e conferem o que ele
// não alcança. Um teste que só chamasse a API e olhasse a resposta não distinguiria
// "negado" de "ninguém tentou".
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRunnerServer } from '../src/server.mjs'
import { sign, __resetNonces } from '../src/auth.mjs'
import { executeJavascript, hashOf } from '../src/execute.mjs'
import { measureProfile } from '../src/profile.mjs'

const SEGREDO = 'segredo-de-teste-do-runner'
let servidor
let porta

before(async () => {
  servidor = createRunnerServer({ secret: SEGREDO })
  await new Promise((r) => servidor.listen(0, r))
  porta = servidor.address().port
})
after(() => servidor.close())

const chamar = async (caminho, corpo, over = {}) => {
  const body = JSON.stringify(corpo)
  const timestamp = over.timestamp ?? Date.now()
  const nonce = over.nonce ?? `n-${Math.random()}`
  const assinatura = over.signature ?? sign(over.secret ?? SEGREDO, { timestamp, nonce, body })
  const r = await fetch(`http://127.0.0.1:${porta}${caminho}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sandbox-timestamp': String(timestamp),
      'x-sandbox-nonce': nonce,
      'x-sandbox-signature': assinatura,
    },
    body,
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

const rodar = (source, input = {}, limits = {}) => chamar('/execute', { runtime: 'javascript', source, input, limits })

// --- a autenticação de serviço -----------------------------------------------------------

test('sem assinatura, o runner não atende', async () => {
  const r = await fetch(`http://127.0.0.1:${porta}/execute`, { method: 'POST', body: '{}' })
  assert.equal(r.status, 401)
})

test('assinatura de outro segredo não vale', async () => {
  const r = await chamar('/execute', { runtime: 'javascript', source: 'function run(){return 1}' }, { secret: 'outro' })
  assert.equal(r.status, 401)
})

test('a mesma requisição não pode ser reenviada — o nonce vale uma vez', async () => {
  const corpo = { runtime: 'javascript', source: 'function run(){return 1}', input: {}, limits: {} }
  const body = JSON.stringify(corpo)
  const timestamp = Date.now()
  const nonce = 'nonce-unico'
  const signature = sign(SEGREDO, { timestamp, nonce, body })

  const primeira = await chamar('/execute', corpo, { timestamp, nonce, signature })
  assert.equal(primeira.status, 200)
  const replay = await chamar('/execute', corpo, { timestamp, nonce, signature })
  assert.equal(replay.status, 401, 'replay é recusado')
  __resetNonces()
})

test('requisição velha demais é recusada', async () => {
  const r = await chamar('/execute', { runtime: 'javascript', source: 'function run(){return 1}' }, { timestamp: Date.now() - 120_000 })
  assert.equal(r.status, 401)
})

// --- o que o código NÃO consegue fazer ------------------------------------------------------

test('o código não lê o disco', async () => {
  const r = await rodar('async function run(){ const fs = await import("node:fs"); return fs.readFileSync("/etc/hosts","utf8") }')
  assert.equal(r.body.ok, false)
  assert.equal(r.body.error.kind, 'denied')
  // A mensagem é nossa: a do Node ensinaria qual flag ligar para contornar.
  assert.match(r.body.error.message, /não é permitida/)
})

test('o código não escreve no disco', async () => {
  const r = await rodar('async function run(){ const fs = await import("node:fs"); fs.writeFileSync("/tmp/x","y"); return "escreveu" }')
  assert.equal(r.body.ok, false)
  assert.equal(r.body.error.kind, 'denied')
})

test('o código não abre subprocesso', async () => {
  const r = await rodar('async function run(){ const cp = await import("node:child_process"); return String(cp.execSync("id")) }')
  assert.equal(r.body.ok, false)
  assert.equal(r.body.error.kind, 'denied')
})

test('o código não abre worker nem carrega addon nativo', async () => {
  const worker = await rodar('async function run(){ const w = await import("node:worker_threads"); new w.Worker("", {eval:true}); return "abriu" }')
  assert.equal(worker.body.ok, false)
  const addon = await rodar('async function run(){ const p = await import("node:process"); p.dlopen({}, "/x.node"); return "carregou" }')
  assert.equal(addon.body.ok, false)
})

test('o código não constrói código a partir de texto', async () => {
  const r = await rodar('function run(){ return new Function("return 41+1")() }')
  assert.equal(r.body.ok, false)
})

test('o `fetch` global está fora do alcance', async () => {
  const r = await rodar('async function run(){ return await fetch("http://127.0.0.1:1/") }')
  assert.equal(r.body.ok, false)
  assert.match(r.body.error.message, /rede bloqueada/)
})

test('o ambiente do filho não carrega segredo do runner', async () => {
  process.env.SEGREDO_DO_RUNNER = 'nao-pode-vazar'
  try {
    const r = await rodar('function run(){ return { visto: Object.keys(process.env), valor: process.env.SEGREDO_DO_RUNNER ?? null } }')
    assert.equal(r.body.ok, true)
    assert.equal(r.body.output.valor, null)
    // O que o runner passa é só o PATH. O sistema pode acrescentar variável própria ao
    // criar o processo (o macOS acrescenta a de codificação), e afirmar a lista exata
    // testaria o sistema operacional em vez do runner — o que importa é que nada do
    // ambiente DELE atravessa.
    assert.ok(r.body.output.visto.includes('PATH'))
    assert.ok(!r.body.output.visto.some((k) => /SEGREDO|SECRET|TOKEN|KEY/i.test(k)), 'nenhuma variável de segredo atravessa')
  } finally {
    delete process.env.SEGREDO_DO_RUNNER
  }
})

// --- os limites ---------------------------------------------------------------------------------

test('laço infinito é cortado no tempo, com SIGKILL', async () => {
  const r = await rodar('function run(){ while (true) {} }', {}, { wallMs: 500 })
  assert.equal(r.body.ok, false)
  assert.equal(r.body.error.kind, 'timeout')
})

test('estourar memória vira erro tipado, não um processo pendurado', async () => {
  const r = await rodar('function run(){ const a = []; while (true) a.push(new Array(1e6).fill(7)) }', {}, { memoryMb: 32, wallMs: 20_000 })
  assert.equal(r.body.ok, false)
  assert.ok(['oom', 'runtime'].includes(r.body.error.kind), `veio ${r.body.error.kind}`)
})

test('saída gigante é cortada', async () => {
  const r = await rodar('function run(){ return "x".repeat(200000) }', {}, { outputBytes: 2048 })
  assert.equal(r.body.ok, false)
  assert.match(r.body.error.message, /limite/)
})

// --- o hash e o contrato --------------------------------------------------------------------------

test('código que não corresponde ao hash revisado não roda', async () => {
  const source = 'function run(){ return 1 }'
  const certo = await chamar('/execute', { runtime: 'javascript', source, input: {}, limits: {}, sha256: hashOf(source) })
  assert.equal(certo.body.ok, true)

  const trocado = await chamar('/execute', { runtime: 'javascript', source: 'function run(){ return 2 }', input: {}, limits: {}, sha256: hashOf(source) })
  assert.equal(trocado.body.ok, false)
  assert.equal(trocado.body.error.kind, 'denied')
  assert.match(trocado.body.error.message, /hash revisado/)
})

test('código sem função run diz isso em vez de fingir sucesso', async () => {
  const r = await rodar('const x = 1')
  assert.equal(r.body.ok, false)
  assert.match(r.body.error.message, /run\(input\)/)
})

test('o caminho feliz devolve dado e métricas', async () => {
  const r = await rodar('function run(entrada){ return { dobro: entrada.n * 2 } }', { n: 21 })
  assert.equal(r.body.ok, true)
  assert.deepEqual(r.body.output, { dobro: 42 })
  assert.ok(r.body.metrics.wallMs >= 0)
  assert.ok(r.body.metrics.outputBytes > 0)
})

test('runtime que este runner não tem é recusado, e não adivinhado', async () => {
  const r = await chamar('/execute', { runtime: 'python', source: 'def run(e): return 1', input: {}, limits: {} })
  assert.equal(r.body.ok, false)
  assert.equal(r.body.error.kind, 'unavailable')
})

// --- o perfil ----------------------------------------------------------------------------------------

test('o health MEDE o perfil em vez de declarar', async () => {
  const r = await chamar('/health', {})
  assert.equal(r.status, 200)
  // O modelo de permissão é medido rodando um filho e olhando o que ele conseguiu.
  assert.equal(r.body.profile.permissionModel, true)
  // E o que depende do deploy é falso por omissão — inclusive nesta máquina.
  assert.equal(r.body.profile.ephemeral, false)
  assert.equal(r.body.profile.seccomp, false)
})

test('a medição de perfil não inventa: sem as marcas do deploy, os itens ficam falsos', async () => {
  const perfil = await measureProfile()
  assert.equal(perfil.noNewPrivileges, false)
  assert.equal(perfil.verifiedCleanup, false)
  assert.equal(typeof perfil.networkDenied, 'boolean')
})

// --- a função pura, sem servidor ---------------------------------------------------------------------

test('executeJavascript nunca lança: erro vira dado', async () => {
  const r = await executeJavascript({ source: 'function run(){ throw new Error("quebrou de propósito") }', input: {}, limits: {} })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'runtime')
  assert.match(r.error.message, /quebrou de propósito/)
  assert.ok(!JSON.stringify(r).includes('at run'), 'sem stack: ele conta caminho de arquivo')
})

// --- sem modelo de permissão, não roda -------------------------------------------------------

test('a fronteira do Node que sabe armar o sandbox', async () => {
  /**
   * `--permission` passou a ter esse nome no 22.13. Antes ele era
   * `--experimental-permission`, e um Node mais velho recebe `--permission` como opção
   * desconhecida: sai na largada.
   */
  const { permissaoDisponivel } = await import('../src/execute.mjs')
  for (const velho of ['18.20.4', '20.19.0', '22.0.0', '22.12.9']) {
    assert.equal(permissaoDisponivel(velho), false, `${velho} não tem o flag e precisa ser recusado`)
  }
  for (const novo of ['22.13.0', '22.17.1', '23.5.0', '24.0.0']) {
    assert.equal(permissaoDisponivel(novo), true, `${novo} tem o flag`)
  }
})

test('AMEAÇA: sem o modelo de permissão o runner RECUSA — e diz que o motivo é ele', async () => {
  /**
   * A pergunta é de segurança, não de compatibilidade: sem o modelo de permissão o processo
   * filho enxerga o disco, abre subprocesso e carrega addon nativo. O código do autor rodaria
   * sem isolamento nenhum, e a única resposta segura é não rodar.
   *
   * E a recusa precisa dizer que o problema é o RUNNER. Antes disto o filho morria em
   * milissegundos e a resposta era "a execução falhou" — que aponta para o script de quem
   * escreveu, e manda essa pessoa depurar um código que está correto.
   */
  const mod = await import('../src/execute.mjs')
  const versaoReal = process.versions.node
  Object.defineProperty(process.versions, 'node', { value: '20.19.0', configurable: true })
  try {
    const r = await mod.executeJavascript({ source: 'function extract(d) { return d }', input: {} })
    assert.equal(r.ok, false)
    assert.equal(r.error.kind, 'denied', 'recusar é diferente de falhar rodando')
    assert.match(r.error.message, /22\.13\.0|modelo de permiss/i, `a recusa precisa dizer o motivo: ${r.error.message}`)
    assert.equal(/execução falhou/.test(r.error.message), false, 'a mensagem antiga culpava o script do autor')
  } finally {
    Object.defineProperty(process.versions, 'node', { value: versaoReal, configurable: true })
  }
})
