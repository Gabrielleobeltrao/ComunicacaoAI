// Linear runner tests (plan §10/§11). IO is faked; RSS parsing + template
// rendering are the real modules. No Redis/Mongo.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { runDefinition } = await import('../dist/automations/runner.js')

const RSS = `<rss><channel><item><title>N1</title><link>https://ex.com/1</link><guid>g1</guid><pubDate>Wed, 12 Aug 2026 08:00:00 GMT</pubDate></item></channel></rss>`

const step = (id, type, config, dependsOn = [], retryPolicy = { maxAttempts: 1, backoffMs: 0 }, continueOnError = false) => ({
  id,
  name: id,
  type,
  enabled: true,
  dependsOn,
  inputMapping: {},
  config,
  timeoutMs: 0,
  retryPolicy,
  continueOnError,
})
const def = (steps) => ({ trigger: { type: 'manual' }, inputs: [], steps, resultFormat: 'markdown', deliveries: [], limits: {} })

const baseDeps = () => ({
  fetchUrl: async () => ({ body: RSS, contentType: 'application/xml' }),
  runAgent: async () => ({ output: 'RESUMO' }),
  deliver: async () => ({ providerMessageId: 'm1' }),
  now: () => Date.parse('2026-08-12T10:00:00Z'),
})

test('runs rss -> agent -> transform end to end', async () => {
  const out = await runDefinition(
    def([
      step('s1', 'source.rss', { url: 'https://ex.com/feed' }),
      step('s2', 'agent.execute', { agentId: 'a1', instruction: 'resuma' }, ['s1']),
      step('s3', 'transform.template', { template: 'Resultado: {{s2}}' }, ['s2']),
    ]),
    baseDeps(),
  )
  assert.equal(out.status, 'succeeded')
  assert.equal(out.finalOutput, 'Resultado: RESUMO')
  assert.equal(out.steps.length, 3)
})

test('retries a transient step error then succeeds', async () => {
  const deps = baseDeps()
  let calls = 0
  deps.fetchUrl = async () => {
    calls++
    if (calls < 2) throw new Error('network blip')
    return { body: RSS, contentType: 'xml' }
  }
  const out = await runDefinition(def([step('s1', 'source.rss', { url: 'x' }, [], { maxAttempts: 3, backoffMs: 0 })]), deps)
  assert.equal(out.status, 'succeeded')
  assert.equal(out.steps[0].attempts, 2)
})

test('a non-retryable failure stops the run', async () => {
  const out = await runDefinition(
    def([step('s1', 'transform.template', { template: '{{missing}}' }), step('s2', 'transform.template', { template: 'never' })]),
    baseDeps(),
  )
  assert.equal(out.status, 'failed')
  assert.equal(out.steps.length, 1) // stopped before s2
  assert.equal(out.steps[0].errorKind, 'validation')
})

test('continueOnError keeps going but the run is still failed', async () => {
  const out = await runDefinition(
    def([
      step('s1', 'transform.template', { template: '{{missing}}' }, [], { maxAttempts: 1, backoffMs: 0 }, true),
      step('s2', 'transform.template', { template: 'ok' }),
    ]),
    baseDeps(),
  )
  assert.equal(out.status, 'failed')
  assert.equal(out.steps.length, 2)
  assert.equal(out.finalOutput, 'ok')
})

test('cancellation stops remaining steps cooperatively', async () => {
  let n = 0
  const deps = { ...baseDeps(), isCanceled: () => n++ >= 1 }
  const out = await runDefinition(
    def([step('s1', 'transform.template', { template: 'a' }), step('s2', 'transform.template', { template: 'b' })]),
    deps,
  )
  assert.equal(out.status, 'canceled')
  assert.equal(out.steps[1].status, 'canceled')
})

// --- MISTURAR AS FUNÇÕES: buscar, e com o resultado filtrar ----------------------------------
//
// Do dono: "seria legal a gente poder misturar elas também — eu querer fazer uma busca, e aí
// com o resultado da busca fazer algum outro tipo de filtro".
//
// As funções existiam e não eram alcançáveis de um Flow. Duas contas em sequência viravam um
// agente fazendo as duas — e um modelo somando devolve um número plausível, não uma soma.
await import('../dist/executors/basicFunctions.js')

test('ACEITAÇÃO: a saída de uma função entra na próxima, sem passar por modelo', async () => {
  const pedidos = [
    { id: 'p1', loja: 'centro', valor: 50 },
    { id: 'p2', loja: 'centro', valor: 150 },
    { id: 'p3', loja: 'zona sul', valor: 300 },
    { id: 'p4', loja: 'centro', valor: 20 },
  ]
  const r = await runDefinition(
    def([
      // 1. os da loja do centro
      step('daLoja', 'function.call', {
        functionName: 'registros.filtrar',
        input: { registros: pedidos, campo: 'valor', operador: 'gte', valor: 0 },
      }),
      // 2. e, DENTRE ELES, os acima de 100
      step('acimaDeCem', 'function.call', { functionName: 'registros.filtrar', input: { campo: 'valor', operador: 'gt', valor: 100 } }, ['daLoja']),
      // 3. e quantos de cada loja
      step('porLoja', 'function.call', { functionName: 'registros.contar_por', input: { campo: 'loja' } }, ['acimaDeCem']),
    ]),
    baseDeps(),
  )
  assert.equal(r.status, 'succeeded', JSON.stringify(r.steps?.map((s) => [s.id, s.status, s.error])))
  // A lista atravessou desembrulhada: a próxima função recebeu os registros, não o envelope.
  assert.equal(r.context.acimaDeCem.quantos, 2)
  assert.deepEqual(
    r.context.porLoja.grupos,
    [{ valor: 'centro', quantos: 1 }, { valor: 'zona sul', quantos: 1 }],
  )
  // E nenhum passo falou com modelo: é o ponto inteiro de encadear funções.
  assert.equal(r.usedAI ?? false, false)
})

test('ACEITAÇÃO: buscar e depois comparar — outro domínio, mesma mecânica', async () => {
  const leituras = [{ sensor: 's1', temp: 4.2 }, { sensor: 's2', temp: 9.8 }]
  const r = await runDefinition(
    def([
      step('achar', 'function.call', { functionName: 'registros.buscar', input: { registros: leituras, campo: 'sensor', valor: 's2' } }),
      // A saída de `buscar` é `{encontrado, registro, quantos}`: aqui o que interessa é um
      // campo dela, e o plano diz isso explicitamente em vez de a etapa adivinhar.
      step('comparar', 'function.call', { functionName: 'valores.comparar', input: { valor: 9.8, referencia: 8 } }, ['achar']),
    ]),
    baseDeps(),
  )
  assert.equal(r.status, 'succeeded')
  assert.equal(r.context.achar.encontrado, true)
  assert.equal(r.context.comparar.relacao, 'maior')
})

test('AMEAÇA: função que não existe é erro de PLANO — não adianta tentar de novo', async () => {
  let tentativas = 0
  const deps = baseDeps()
  const r = await runDefinition(
    def([
      step(
        'inventada',
        'function.call',
        { functionName: 'calcular.o.que.ninguem.registrou', input: {} },
        [],
        { maxAttempts: 3, backoffMs: 0 },
      ),
    ]),
    { ...deps, now: () => { tentativas += 1; return deps.now() } },
  )
  assert.equal(r.status, 'failed')
  const passo = r.steps.find((s) => s.stepId === 'inventada')
  assert.match(passo.errorMessage, /não está registrada/)
  assert.equal(passo.errorKind, 'validation', 'erro de plano, e não falha temporária')
  assert.equal(passo.attempts, 1, 'repetir um erro de plano gasta tempo e não muda o resultado')
})

test('AMEAÇA: recusa deliberada da função não vira retentativa', async () => {
  // "Variação precisa de ao menos 2 pontos" não melhora tentando de novo: o dado é esse.
  const r = await runDefinition(
    def([
      step('variacao', 'function.call', { functionName: 'serie.variacao', input: { registros: [{ v: 1 }], campo: 'v' } }, [], {
        maxAttempts: 3,
        backoffMs: 0,
      }),
    ]),
    baseDeps(),
  )
  assert.equal(r.status, 'failed')
  const passo = r.steps.find((s) => s.stepId === 'variacao')
  assert.match(passo.errorMessage, /ao menos 2 pontos/)
  assert.equal(passo.errorKind, 'validation')
  assert.equal(passo.attempts, 1)
})
