// O caminho interativo — Playground, chat manual e canais — com as mesmas regras das automações.
//
// Antes, estes três chamavam o provedor direto: o `timeoutMs` do dono valia numa rotina e
// não valia no chat, um JSON malformado seguia para o cliente sem ninguém conferir, e o
// prazo estourado deixava a chamada viva com a escrita disparando depois.
//
// Aqui a prova é sobre `runInteractive`, o caminho único dos três. O provedor é uma função
// controlável: dá para medir quantas vezes foi chamado, o que recebeu, e se o sinal de
// cancelamento chegou até ele.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { runInteractive, describeDropped } = await import('../dist/interactiveRun.js')

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const resposta = (text, inputTokens = 10, outputTokens = 5) => ({
  text,
  usage: { inputTokens, outputTokens },
  toolCalls: [],
})

const base = (over = {}) => ({ objective: 'responder', history: [], ...over })

// Um provedor que registra cada chamada e responde conforme um roteiro.
const provedor = (roteiro) => {
  const chamadas = []
  const reply = async (opts) => {
    const i = chamadas.length
    chamadas.push({ tools: opts.tools, signal: opts.signal, history: opts.history, objective: opts.objective })
    const passo = roteiro[Math.min(i, roteiro.length - 1)]
    return typeof passo === 'function' ? passo(opts, i) : passo
  }
  return { reply, chamadas }
}

// --- prazo que cancela de verdade ---------------------------------------------------------

test('o prazo do runConfig vale no interativo, e o erro é timeout', async () => {
  const { reply } = provedor([async () => { await espera(400); return resposta('tarde demais') }])

  await assert.rejects(
    () => runInteractive(base({ reply, runConfig: { timeoutMs: 100, retries: 0 } })),
    (e) => {
      assert.equal(e.kind, 'timeout')
      return true
    },
  )
})

test('estourado o prazo, o sinal chega ao provedor — a chamada é cancelada, não abandonada', async () => {
  // Rejeitar sem abortar deixaria a chamada viva: o modelo responde depois, o laço de
  // ferramentas continua, e uma escrita acontece quando ninguém mais espera por ela.
  let abortado = false
  const { reply } = provedor([
    async (opts) => {
      opts.signal.addEventListener('abort', () => {
        abortado = true
      })
      await espera(400)
      return resposta('tarde demais')
    },
  ])

  await runInteractive(base({ reply, runConfig: { timeoutMs: 80, retries: 0 } })).catch(() => undefined)
  await espera(50)

  assert.equal(abortado, true, 'o provedor precisa receber o cancelamento')
})

test('cada tentativa tem o seu sinal: abortar a primeira não cancela a segunda', async () => {
  const sinais = []
  const { reply, chamadas } = provedor([
    async (opts) => {
      sinais.push(opts.signal)
      await espera(400)
      return resposta('tarde')
    },
    async (opts) => {
      sinais.push(opts.signal)
      return resposta('no prazo')
    },
  ])

  const r = await runInteractive(base({ reply, runConfig: { timeoutMs: 100, retries: 1 } }))

  assert.equal(chamadas.length, 2)
  assert.equal(r.text, 'no prazo')
  assert.equal(sinais[0].aborted, true, 'a tentativa vencida fica cancelada')
  assert.equal(sinais[1].aborted, false, 'a tentativa nova começa limpa')
})

// --- efeito duplicado -----------------------------------------------------------------------

test('começada a ESCRITA, não há nova tentativa — nem em timeout', async () => {
  // É justamente no timeout que não se sabe se a escrita completou do outro lado. Repetir
  // manda o segundo e-mail, faz a segunda cobrança.
  const { reply, chamadas } = provedor([
    async (opts) => {
      opts.onToolStart('write')
      await espera(400)
      return resposta('nunca chega')
    },
    resposta('segunda tentativa'),
  ])

  await assert.rejects(() => runInteractive(base({ reply, runConfig: { timeoutMs: 100, retries: 3 } })))
  await espera(100)

  assert.equal(chamadas.length, 1, 'a escrita já tinha começado: não se repete')
})

test('risco desconhecido conta como escrita e também bloqueia a repetição', async () => {
  const { reply, chamadas } = provedor([
    async (opts) => {
      opts.onToolStart(undefined)
      throw Object.assign(new Error('sobrecarga'), { status: 503 })
    },
    resposta('segunda'),
  ])

  await assert.rejects(() => runInteractive(base({ reply, runConfig: { retries: 2 } })))
  assert.equal(chamadas.length, 1, 'quem não disse o que faz não ganha nova tentativa')
})

test('uma LEITURA não impede nova tentativa: repetir uma consulta não muda nada', async () => {
  const { reply, chamadas } = provedor([
    async (opts) => {
      opts.onToolStart('read')
      throw Object.assign(new Error('sobrecarga'), { status: 503 })
    },
    resposta('ok'),
  ])

  const r = await runInteractive(base({ reply, runConfig: { retries: 2 } }))
  assert.equal(chamadas.length, 2)
  assert.equal(r.text, 'ok')
})

test('erro definitivo não vira retry: 401 é problema de credencial, não de trânsito', async () => {
  const { reply, chamadas } = provedor([
    async () => {
      throw Object.assign(new Error('chave inválida'), { status: 401 })
    },
  ])

  await assert.rejects(() => runInteractive(base({ reply, runConfig: { retries: 3 } })))
  assert.equal(chamadas.length, 1)
})

// --- contrato de saída ----------------------------------------------------------------------

const jsonOutput = { format: 'json', jsonSchema: { type: 'object', required: ['nome'], properties: { nome: { type: 'string' } } } }

test('resposta já válida não gasta um reparo', async () => {
  const { reply, chamadas } = provedor([resposta('{"nome":"ana"}')])

  const r = await runInteractive(base({ reply, output: jsonOutput }))

  assert.equal(chamadas.length, 1)
  assert.equal(r.outputValid, true)
  assert.equal(r.outputRepaired, false)
})

test('JSON quebrado é reparado uma vez, e o reparo válido é o que sai', async () => {
  const { reply, chamadas } = provedor([resposta('desculpe, aqui vai: {nome: ana}'), resposta('{"nome":"ana"}', 4, 3)])

  const r = await runInteractive(base({ reply, output: jsonOutput }))

  assert.equal(chamadas.length, 2)
  assert.equal(r.outputValid, true)
  assert.equal(r.outputRepaired, true)
  assert.equal(r.text, '{"nome":"ana"}')
})

test('o reparo roda SEM ferramentas — reescrever texto não pode repetir ações', async () => {
  const ferramenta = { name: 'cobrar', description: 'x', inputSchema: { type: 'object' }, risk: 'write', run: async () => ({ ok: true, result: '{}' }) }
  const { reply, chamadas } = provedor([resposta('não é json'), resposta('{"nome":"ana"}')])

  await runInteractive(base({ reply, tools: [ferramenta], output: jsonOutput }))

  assert.equal(chamadas[0].tools.length, 1, 'a resposta normal tem as ferramentas do agente')
  assert.deepEqual(chamadas[1].tools, [], 'o reparo não tem nenhuma')
})

test('os tokens do reparo entram no usage — quem paga precisa ver a conta inteira', async () => {
  const { reply } = provedor([resposta('não é json', 10, 5), resposta('{"nome":"ana"}', 4, 3)])

  const r = await runInteractive(base({ reply, output: jsonOutput }))

  assert.equal(r.usage.inputTokens, 14)
  assert.equal(r.usage.outputTokens, 8)
})

test('segunda resposta inválida: sai marcado como inválido, e não como sucesso', async () => {
  // O canal não envia, o Playground mostra o diagnóstico. Entregar como sucesso seria
  // mandar ao cliente um texto que o próprio sistema sabe estar errado.
  const { reply, chamadas } = provedor([resposta('não é json', 10, 5), resposta('continua não sendo', 4, 3)])

  const r = await runInteractive(base({ reply, output: jsonOutput }))

  assert.equal(chamadas.length, 2, 'um único reparo — não se insiste indefinidamente')
  assert.equal(r.outputValid, false)
  assert.equal(r.outputRepaired, true)
  assert.ok(r.outputProblem, 'o motivo precisa chegar ao diagnóstico')
  assert.equal(r.usage.inputTokens, 14, 'o reparo falho custou tokens do mesmo jeito')
})

test('JSON que passa no parse mas viola o schema também é reparado', async () => {
  const { reply } = provedor([resposta('{"outro":1}'), resposta('{"nome":"ana"}')])

  const r = await runInteractive(base({ reply, output: jsonOutput }))
  assert.equal(r.outputValid, true)
  assert.equal(r.outputRepaired, true)
})

test('o reparo usa o mesmo orçamento de prazo, e estourá-lo não derruba a resposta', async () => {
  const { reply } = provedor([
    resposta('não é json', 10, 5),
    async () => {
      await espera(400)
      return resposta('{"nome":"ana"}')
    },
  ])

  const r = await runInteractive(base({ reply, output: jsonOutput, runConfig: { timeoutMs: 120, retries: 0 } }))

  assert.equal(r.outputValid, false, 'sem reparo dentro do prazo, o contrato não foi cumprido')
  assert.equal(r.outputRepaired, false)
  assert.equal(r.usage.inputTokens, 10, 'o reparo cancelado não somou tokens que não gastou')
})

test('sem contrato JSON, nada é conferido e nada é reparado', async () => {
  const { reply, chamadas } = provedor([resposta('um texto qualquer')])

  const r = await runInteractive(base({ reply }))
  assert.equal(chamadas.length, 1)
  assert.equal(r.outputValid, true)
  assert.equal(r.text, 'um texto qualquer')
})

// --- diagnóstico ------------------------------------------------------------------------------

test('describeDropped diz campo e motivo, e nada além disso', async () => {
  const texto = describeDropped({ dropped: [{ field: 'stream', reason: 'não suportado' }, { field: 'cache', reason: 'automático' }] })
  assert.equal(texto, 'stream: não suportado; cache: automático')
  assert.equal(describeDropped(undefined), '')
  assert.equal(describeDropped({}), '')
})
