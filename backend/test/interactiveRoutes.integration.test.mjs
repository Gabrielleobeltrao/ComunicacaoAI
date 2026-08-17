// INTEGRAÇÃO: as rotas interativas contra o servidor de verdade.
//
// Duas garantias que só aparecem atravessando a rota inteira:
//
// 1. Contrato de saída quebrado NÃO é sucesso e NÃO sai de graça. O provedor cobrou a
//    resposta e cobrou o reparo; o registro precisa mostrar os dois. A versão anterior
//    lançava antes de copiar o uso e gravava zero token numa chamada que custou duas.
//
// 2. Trocar de modelo-base preenche o que está vazio e nada além disso — e uma definição
//    escrita por gente não é tocada nem quando a troca é confirmada.
//
// O modelo é o adaptador falso (LLM_FAKE=1, só existe com NODE_ENV=test): ele responde
// `[fake] ...`, que nunca é JSON válido. Um agente com contrato JSON portanto falha as
// duas vezes — a resposta e o reparo —, que é exatamente o caso a provar.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { MongoClient } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

const RAIZ = new URL('..', import.meta.url).pathname
const PORTA = 4491
const base = `http://127.0.0.1:${PORTA}`

let proc
let cliente
let cookie = ''

const comSessao = (extra = {}) => ({ ...extra, Cookie: cookie, 'Content-Type': 'application/json' })

before(async () => {
  const uri = await startMongo()
  cliente = await MongoClient.connect(uri)
  proc = spawn(process.execPath, ['dist/index.js'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: join(RAIZ, 'test/.sem-env'),
      NODE_ENV: 'test',
      LLM_FAKE: '1',
      PORT: String(PORTA),
      MONGODB_URI: uri,
      BETTER_AUTH_SECRET: 'interativo-'.padEnd(40, 'x'),
      ENCRYPTION_KEY: 'interativo-'.padEnd(40, 'y'),
      CLIENT_URL: `http://127.0.0.1:${PORTA}`,
      PUBLIC_URL: `http://127.0.0.1:${PORTA}`,
      BETTER_AUTH_URL: `http://127.0.0.1:${PORTA}`,
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', () => undefined)
  proc.stderr.on('data', () => undefined)

  const limite = Date.now() + 60_000
  let dePe = false
  while (Date.now() < limite) {
    const res = await fetch(`${base}/api/ready`).catch(() => null)
    if (res?.status === 200) {
      dePe = true
      break
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  if (!dePe) throw new Error('a API não subiu para o teste das rotas interativas')

  const registro = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dono', email: 'dono@interativo.test', password: 'senha-de-teste-123' }),
  })
  assert.ok(registro.ok, `registro devolveu ${registro.status}`)
  cookie = (registro.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  assert.ok(cookie, 'sem cookie de sessão não há como testar rota privada')
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

const criarAgente = async (corpo = {}) => {
  const res = await fetch(`${base}/api/agents`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({ name: 'Agente de teste', ...corpo }),
  })
  assert.ok(res.ok, `criação devolveu ${res.status}`)
  return res.json()
}

const patch = (id, corpo) =>
  fetch(`${base}/api/agents/${id}`, { method: 'PATCH', headers: comSessao(), body: JSON.stringify(corpo) })

const somar = (docs) =>
  docs.reduce(
    (soma, d) => ({
      inputTokens: soma.inputTokens + (d.inputTokens ?? 0),
      outputTokens: soma.outputTokens + (d.outputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  )

// A cobrança é disparada sem `await` na rota — a resposta do visitante não espera pelo
// contador. Por isso o teste ESPERA por ela em vez de ler uma vez: ler antes da escrita
// chegar seria um falso verde do defeito que este arquivo existe para pegar.
const tokensDoDono = async () => somar(await cliente.db().collection('token_usage').find({}).toArray())

const esperarCobranca = async (antes, limiteMs = 8000) => {
  const fim = Date.now() + limiteMs
  let atual = await tokensDoDono()
  while (Date.now() < fim && atual.inputTokens === antes.inputTokens && atual.outputTokens === antes.outputTokens) {
    await new Promise((r) => setTimeout(r, 200))
    atual = await tokensDoDono()
  }
  return atual
}

// --- contrato de saída quebrado ---------------------------------------------------------

test('output_invalid: erro controlado, sem 500 e sem a resposta do modelo', async () => {
  const agente = await criarAgente()
  // Contrato JSON com schema: o `[fake] ...` do dublê falha no parse, e falha de novo no
  // reparo. É a segunda resposta inválida que o teste precisa exercitar.
  const r = await patch(agente._id, {
    defaultOutputFormat: 'json',
    outputJsonSchema: { type: 'object', required: ['nome'], properties: { nome: { type: 'string' } } },
  })
  assert.ok(r.ok, `patch do contrato devolveu ${r.status}`)

  const antes = await tokensDoDono()

  const res = await fetch(`${base}/api/agents/${agente._id}/playground`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({ messages: [{ role: 'user', content: 'me devolva um json' }] }),
  })

  assert.equal(res.status, 502, 'contrato quebrado é erro de upstream, não 500 genérico')
  const corpo = await res.json()
  assert.equal(corpo.code, 'output_invalid', 'o código precisa ser estável para quem consome a API')
  assert.equal(corpo.reply, undefined, 'a resposta inválida não pode ser entregue')
  // O diagnóstico diz o que o SCHEMA recusou, e não o que o modelo escreveu.
  assert.doesNotMatch(JSON.stringify(corpo), /\[fake\]/, 'o texto do modelo não sai na resposta')
  assert.doesNotMatch(JSON.stringify(corpo), /me devolva um json/, 'o prompt não sai na resposta')

  // --- e o que foi gasto aparece -------------------------------------------------------
  const depois = await esperarCobranca(antes)
  const gastos = {
    inputTokens: depois.inputTokens - antes.inputTokens,
    outputTokens: depois.outputTokens - antes.outputTokens,
  }
  assert.ok(gastos.inputTokens > 0, 'a chamada custou tokens de entrada e eles precisam ser cobrados')
  assert.ok(gastos.outputTokens > 0, 'idem para os de saída')

  // O dublê responde `[fake] ` + até 160 caracteres e cobra ceil(len/4) na saída. Uma
  // chamada só devolveria os tokens de "[fake] me devolva um json" (6 de saída). Exigir
  // mais que isso é exigir que o REPARO também tenha entrado na conta.
  const umaChamadaSo = Math.ceil('[fake] me devolva um json'.length / 4)
  assert.ok(
    gastos.outputTokens > umaChamadaSo,
    `o reparo precisa estar somado: ${gastos.outputTokens} não é mais que ${umaChamadaSo}`,
  )
})

test('output_invalid: a execução fica registrada como falha, com o motivo', async () => {
  const buscar = async () => cliente.db().collection('agent_execution_events').find({ source: 'manual' }).toArray()
  let falho
  const fim = Date.now() + 8000
  while (Date.now() < fim && !falho) {
    falho = (await buscar()).find((e) => e.metadata?.errorKind === 'output_invalid')
    if (!falho) await new Promise((r) => setTimeout(r, 200))
  }
  assert.ok(falho, 'o evento precisa dizer POR QUE falhou, e não só que falhou')
  assert.equal(falho.status, 'failed')
  assert.ok((falho.inputTokens ?? 0) > 0, 'o evento carrega o que foi gasto')
  // Nada de prompt nem de resposta na telemetria.
  assert.doesNotMatch(JSON.stringify(falho.metadata ?? {}), /\[fake\]|me devolva um json/)
})

test('contrato cumprido continua sendo 200 — o erro é do JSON, não da rota', async () => {
  const agente = await criarAgente()
  const res = await fetch(`${base}/api/agents/${agente._id}/playground`, {
    method: 'POST',
    headers: comSessao(),
    body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }] }),
  })
  assert.equal(res.status, 200)
  const corpo = await res.json()
  assert.match(corpo.reply, /\[fake\]/)
})

// --- troca de modelo-base -----------------------------------------------------------------

test('trocar de modelo-base preenche os campos VAZIOS quando confirmado', async () => {
  const agente = await criarAgente({ name: 'Vazio' })
  assert.equal(agente.role ?? '', '', 'o agente nasce sem definição escrita')

  const res = await patch(agente._id, { preset: 'researcher', applyPresetSuggestions: true })
  assert.ok(res.ok, `patch devolveu ${res.status}`)
  const atualizado = await res.json()

  assert.equal(atualizado.preset, 'researcher', 'o modelo-base escolhido fica gravado')
  assert.match(atualizado.role, /Pesquisador/)
  assert.ok(atualizado.instructions.trim(), 'as instruções do molde entram no campo vazio')
  assert.ok(atualizado.constraints.trim())
  assert.ok(atualizado.objective.trim(), 'o objetivo também é um campo vazio a preencher')
})

test('sem confirmação, a troca muda só o modelo-base', async () => {
  const agente = await criarAgente({ name: 'Só o molde' })
  const res = await patch(agente._id, { preset: 'analyst' })
  assert.ok(res.ok)
  const atualizado = await res.json()

  assert.equal(atualizado.preset, 'analyst')
  assert.equal(atualizado.role ?? '', '', 'sem applyPresetSuggestions, nada é preenchido')
  assert.equal(atualizado.instructions ?? '', '')
  assert.equal(atualizado.objective ?? '', '')
})

test('texto escrito à mão nunca é sobrescrito por uma troca de molde', async () => {
  const agente = await criarAgente({ name: 'Escrito' })
  const meu = 'Atendente do plano empresarial, e mais ninguém.'
  const escreveu = await patch(agente._id, { role: meu })
  assert.ok(escreveu.ok)

  const res = await patch(agente._id, { preset: 'manager', applyPresetSuggestions: true })
  const atualizado = await res.json()

  assert.equal(atualizado.role, meu, 'o que a pessoa escreveu fica exatamente como estava')
  // E a marca de edição bloqueia o resto: sugerir por cima de uma definição humana, ainda
  // que num campo vazio, é decidir pelo dono sem ele ver.
  assert.equal(atualizado.instructions ?? '', '')
  assert.equal(atualizado.preset, 'manager', 'o molde escolhido ainda assim é gravado')
})

test('salvar o formulário sem mudar nada não conta como escrever à mão', async () => {
  // O autosave manda os quatro campos da definição em TODO salvamento. Marcar a edição
  // pela presença fazia o primeiro salvamento matar a sugestão para sempre.
  const agente = await criarAgente({ name: 'Autosave' })
  const comoVeio = await patch(agente._id, {
    name: 'Autosave',
    objective: agente.objective ?? '',
    role: agente.role ?? '',
    instructions: agente.instructions ?? '',
    constraints: agente.constraints ?? '',
  })
  assert.ok(comoVeio.ok)
  assert.equal((await comoVeio.json()).definitionEditedAt ?? null, null, 'salvar igual não é editar')

  const res = await patch(agente._id, { preset: 'communicator', applyPresetSuggestions: true })
  const atualizado = await res.json()
  assert.ok(atualizado.role.trim(), 'a sugestão continua disponível depois de um autosave')
})
