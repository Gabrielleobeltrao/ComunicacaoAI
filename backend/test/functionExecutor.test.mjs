// Executar uma função registrada — e a fronteira que este caminho protege.
//
// A regra é: o agente guarda uma CHAVE, e a chave só vale se estiver no registry, que é
// código deste repositório. A pergunta que separa o seguro do inseguro não é "o que a
// função faz", é "quem escolheu o código".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { executeRegisteredFunction } = await import('../dist/executors/functionExecutor.js')
const { registerFunction, findFunction, listPublicFunctions, registerAdapter } = await import('../dist/executors/functionRegistry.js')

// --- a fronteira -------------------------------------------------------------------------------

test('o registry não abre nenhuma porta para código de fora', () => {
  // Uma leitura do FONTE, porque isto é uma promessa de segurança e não um detalhe de
  // implementação: se alguém acrescentar `eval` amanhã, este teste é o que avisa.
  const fonte = readFileSync(resolve(import.meta.dirname, '../src/executors/functionRegistry.ts'), 'utf8')
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  for (const proibido of ['eval(', 'new Function(', 'child_process', 'execSync', 'spawn(', 'vm.runIn']) {
    assert.ok(!codigo.includes(proibido), `o registry não pode conter ${proibido}`)
  }
  // Import dinâmico com caminho variável é o mesmo problema com outra roupa.
  assert.ok(!/import\s*\(\s*[^'"]/.test(codigo), 'caminho de módulo configurável seria escolher o que roda de fora')
})

test('função que não está no registry não executa', async () => {
  const r = await executeRegisteredFunction({ kind: 'function', functionName: 'rm.rf' }, {})
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_configured')
  assert.match(r.error.message, /não está disponível/)
})

// --- o caminho feliz ----------------------------------------------------------------------------

test('a função registrada executa e devolve DADO, não texto', async () => {
  const r = await executeRegisteredFunction({ kind: 'function', functionName: 'math.summary' }, { values: [2, 4, 6] })
  assert.equal(r.ok, true)
  assert.deepEqual(r.structured.data, { count: 3, sum: 12, average: 4, min: 2, max: 6 })
  assert.equal(r.structured.valid, true)
  assert.equal(r.text, undefined, 'uma função determinística não produz prosa')
  assert.equal(typeof r.telemetry.durationMs, 'number')
  assert.equal(r.metadata.functionName, 'math.summary')
  assert.equal(r.metadata.version, '1.0.0')
  // Sem token: função não chama modelo.
  assert.equal(r.telemetry.inputTokens, undefined)
})

// --- os contratos --------------------------------------------------------------------------------

test('entrada fora do contrato NÃO chega ao handler', async () => {
  const r = await executeRegisteredFunction({ kind: 'function', functionName: 'math.summary' }, { values: 'dez' })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'invalid_input')
  assert.match(r.error.message, /Entrada fora do contrato/)
})

test('entrada faltando campo obrigatório é recusada', async () => {
  const r = await executeRegisteredFunction({ kind: 'function', functionName: 'br.cpf' }, {})
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'invalid_input')
})

test('saída fora do contrato falha SEM pedir correção a ninguém', async () => {
  // Um modelo que responde torto pode ter escrito errado; uma função determinística que
  // devolve fora do contrato tem defeito no código, e repetir daria no mesmo.
  registerFunction({
    functionName: 'teste.saidaTorta',
    version: '1.0.0',
    description: 'devolve fora do contrato de propósito',
    capabilities: [],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
    timeoutMs: 1000,
    handler: () => ({ n: 'não é número' }),
  })
  const r = await executeRegisteredFunction({ kind: 'function', functionName: 'teste.saidaTorta' }, {})
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'invalid_output')
})

// --- o que dá errado -------------------------------------------------------------------------------

test('a função que não termina é interrompida pelo teto de tempo', async () => {
  registerFunction({
    functionName: 'teste.travada',
    version: '1.0.0',
    description: 'nunca termina',
    capabilities: [],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    timeoutMs: 60,
    handler: () => new Promise(() => undefined),
  })
  const r = await executeRegisteredFunction({ kind: 'function', functionName: 'teste.travada' }, {})
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'timeout')
  assert.match(r.error.message, /60ms/)
})

test('exceção vira erro tipado — sem stack e sem caminho de arquivo', async () => {
  registerFunction({
    functionName: 'teste.explode',
    version: '1.0.0',
    description: 'lança',
    capabilities: [],
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    timeoutMs: 1000,
    handler: () => {
      throw new Error('/Users/alguem/segredo.ts:42 — token=abc123')
    },
  })
  const r = await executeRegisteredFunction({ kind: 'function', functionName: 'teste.explode' }, {})
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'tool')
  const texto = JSON.stringify(r)
  assert.ok(!texto.includes('segredo.ts'), 'stack conta caminho de arquivo')
  assert.ok(!texto.includes('abc123'), 'mensagem crua costuma carregar valor de variável')
})

test('versão fixada que não bate recusa — o agente não muda sozinho', async () => {
  const r = await executeRegisteredFunction({ kind: 'function', functionName: 'math.summary', version: '0.9.0' }, { values: [1] })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_configured')
  assert.match(r.error.message, /versão/)
})

// --- o catálogo ------------------------------------------------------------------------------------

test('o catálogo descreve, e NÃO entrega o código', () => {
  const publicas = listPublicFunctions()
  const soma = publicas.find((f) => f.functionName === 'math.summary')
  assert.ok(soma)
  assert.equal(soma.version, '1.0.0')
  assert.ok(soma.inputSchema)
  assert.ok(soma.outputSchema)
  assert.equal(soma.handler, undefined, 'handler é código, e código não sai para o cliente')
  assert.ok(!JSON.stringify(publicas).includes('function ('))
})

test('nome duplicado é recusado no registro', () => {
  assert.throws(() => {
    registerFunction({
      functionName: 'math.summary',
      version: '2.0.0',
      description: 'duplicada',
      capabilities: [],
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: {} },
      timeoutMs: 100,
      handler: () => ({}),
    })
  }, /duplicada no registry/)
})

// --- o adaptador futuro ------------------------------------------------------------------------------

test('o adaptador recebe NOME, nunca código', async () => {
  // A porta para um worker Python existe; o que ela não faz é aceitar script. Ela recebe
  // o nome de uma função que o outro lado já conhece — a mesma regra do registry.
  let recebido = null
  registerAdapter({
    name: 'worker-de-teste',
    supports: (nome) => nome.startsWith('py.'),
    invoke: async (nome, input) => {
      recebido = { nome, input }
      return { eco: input.valor }
    },
  })
  const r = await executeRegisteredFunction({ kind: 'function', functionName: 'py.qualquer' }, { valor: 7 })
  assert.equal(r.ok, true)
  assert.deepEqual(r.structured.data, { eco: 7 })
  assert.equal(r.metadata.via, 'worker-de-teste')
  assert.deepEqual(recebido, { nome: 'py.qualquer', input: { valor: 7 } })
  assert.equal(findFunction('py.qualquer'), null, 'ele não entra no registry local')
})
