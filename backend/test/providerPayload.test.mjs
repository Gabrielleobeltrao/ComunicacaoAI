// O que chega DE FATO ao SDK do provedor.
//
// A rodada anterior testou os helpers e declarou a configuração pronta — e ela não
// chegava a lugar nenhum. Testar `effectiveRunConfig` prova que a função calcula certo;
// não prova que o número sai na requisição. Só a requisição prova isso.
//
// Aqui os SDKs são substituídos por espiões que guardam o corpo. As asserções são sobre
// esse corpo: o campo escolhido está lá com o valor certo, e o campo incompatível NÃO
// está — nem como `undefined`, porque um `undefined` numa requisição JSON some, mas um
// `null` não, e a diferença entre os dois já derrubou chamada.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

// --- espiões no lugar dos SDKs -----------------------------------------------------------
//
// `mock.module` é o único jeito de substituir um SDK importado por ESM: o adapter faz
// `import Anthropic from '@anthropic-ai/sdk'` no topo, e nada em tempo de execução
// alcança isso. Precisa da flag `--experimental-test-module-mocks`, que o runner passa.

import { mock } from 'node:test'

const enviado = { anthropic: [], openai: [] }

const respostaAnthropic = { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
const respostaOpenAI = { choices: [{ message: { content: 'ok', tool_calls: [] } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }

// O que o dublê responde. Variável de módulo, e não método de protótipo: a classe define
// `messages` como CAMPO DE INSTÂNCIA, e campo de instância vence protótipo — sobrescrever
// o protótipo depois não teria efeito nenhum, e o teste passaria medindo nada.
let responderAnthropic = async () => respostaAnthropic

class AnthropicFalso {
  messages = {
    create: async (body) => {
      enviado.anthropic.push(body)
      return responderAnthropic(body)
    },
  }
  models = { list: async () => ({ data: [] }) }
}

class OpenAIFalso {
  chat = {
    completions: {
      create: async (body) => {
        enviado.openai.push(body)
        return respostaOpenAI
      },
    },
  }
  models = { list: async () => ({ data: [] }) }
}

mock.module('@anthropic-ai/sdk', { defaultExport: AnthropicFalso })
mock.module('openai', { defaultExport: OpenAIFalso })

const anthropic = await import('../dist/claude.js')
const openai = await import('../dist/openai.js')
const { effectiveRunConfig } = await import('../dist/runConfig.js')

beforeEach(() => {
  enviado.anthropic = []
  enviado.openai = []
})

const chamarAnthropic = (runConfig, tools = []) =>
  anthropic.generateAgentReply('objetivo', [], '', [{ role: 'user', content: 'oi' }], 'claude-sonnet-5', 'chave', '', '', '', true, tools, {
    runConfig,
  })

const chamarOpenAI = (runConfig, tools = []) =>
  openai.generateAgentReply('objetivo', [], '', [{ role: 'user', content: 'oi' }], 'gpt-4o', 'chave', '', '', '', true, tools, { runConfig })

const ferramenta = (name, risk) => ({
  name,
  description: 'x',
  inputSchema: { type: 'object', properties: {} },
  risk,
  run: async () => ({ ok: true, result: '{}' }),
})

// --- o padrão de antes continua sendo o padrão -------------------------------------------

test('sem configuração, a Anthropic recebe exatamente o que recebia antes', async () => {
  // 1024 tokens e esforço baixo eram hardcode. Continuam sendo o padrão: mudá-los aqui
  // alteraria o comportamento de TODOS os agentes existentes de uma vez.
  await chamarAnthropic(undefined)
  const corpo = enviado.anthropic[0]
  assert.equal(corpo.max_tokens, 1024)
  assert.deepEqual(corpo.output_config, { effort: 'low' })
  assert.deepEqual(corpo.thinking, { type: 'disabled' })
  assert.equal(corpo.temperature, undefined)
})

test('sem configuração, a OpenAI recebe exatamente o que recebia antes', async () => {
  await chamarOpenAI(undefined)
  const corpo = enviado.openai[0]
  assert.equal(corpo.max_completion_tokens, 1024)
  assert.equal(corpo.temperature, undefined)
  assert.equal(corpo.reasoning_effort, undefined)
})

// --- o que o dono escolheu chega ------------------------------------------------------------

test('temperatura escolhida chega à Anthropic', async () => {
  await chamarAnthropic({ temperature: 0.2 })
  assert.equal(enviado.anthropic[0].temperature, 0.2)
})

test('temperatura escolhida chega à OpenAI', async () => {
  await chamarOpenAI({ temperature: 0.9 })
  assert.equal(enviado.openai[0].temperature, 0.9)
})

test('temperatura ZERO chega, e não é confundida com "não escolhido"', async () => {
  // 0 é "sempre igual", uma escolha forte. Um `if (temperature)` a perderia.
  await chamarAnthropic({ temperature: 0 })
  assert.equal(enviado.anthropic[0].temperature, 0)
})

test('o teto de saída substitui o padrão nos dois provedores', async () => {
  await chamarAnthropic({ maxOutputTokens: 4096 })
  assert.equal(enviado.anthropic[0].max_tokens, 4096)
  await chamarOpenAI({ maxOutputTokens: 2048 })
  assert.equal(enviado.openai[0].max_completion_tokens, 2048)
})

test('o esforço de raciocínio é traduzido para o nome de cada provedor', async () => {
  await chamarAnthropic({ reasoningEffort: 'high' })
  assert.deepEqual(enviado.anthropic[0].output_config, { effort: 'high' })
  // Pedir esforço e desligar o raciocínio na linha seguinte anularia a escolha.
  assert.equal(enviado.anthropic[0].thinking, undefined)

  await chamarOpenAI({ reasoningEffort: 'medium' })
  assert.equal(enviado.openai[0].reasoning_effort, 'medium')
})

// --- o que o modelo não aceita NÃO é enviado ---------------------------------------------------

test('temperatura removida pela matriz não aparece na requisição', async () => {
  // Este é o teste que a rodada anterior não tinha: a matriz calculava certo, e o valor
  // ia para o provedor do mesmo jeito.
  const cfg = effectiveRunConfig({ temperature: 0.7 }, { provider: 'openai', model: 'o3-mini', context: 'chat' })
  await chamarOpenAI(cfg)
  const corpo = enviado.openai[0]
  assert.equal('temperature' in corpo, false, 'a chave não pode existir, nem como undefined')
})

test('o cache não vira parâmetro na OpenAI: lá ele é automático', async () => {
  const cfg = effectiveRunConfig({ cache: true }, { provider: 'openai', model: 'gpt-4o', context: 'chat' })
  await chamarOpenAI(cfg)
  const corpo = enviado.openai[0]
  assert.equal('cache' in corpo, false)
  assert.equal('cache_control' in corpo, false)
})

test('streaming nunca chega ao provedor: o transporte não existe', async () => {
  const cfg = effectiveRunConfig({ stream: true }, { provider: 'openai', model: 'gpt-4o', context: 'chat' })
  await chamarOpenAI(cfg)
  assert.equal(enviado.openai[0].stream, undefined)
})

// --- ferramentas ---------------------------------------------------------------------------------

test('toolChoice "required" chega nos dois, com o nome de cada um', async () => {
  await chamarOpenAI({ toolChoice: 'required' }, [ferramenta('buscar', 'read')])
  assert.equal(enviado.openai[0].tool_choice, 'required')

  await chamarAnthropic({ toolChoice: 'required' }, [ferramenta('buscar', 'read')])
  assert.equal(enviado.anthropic[0].tool_choice.type, 'any', 'na Anthropic "obrigatório" se chama any')
})

test('toolChoice "none" não manda ferramenta nenhuma', async () => {
  // Mandar a lista e pedir para não usar gasta tokens descrevendo o que não pode ser
  // chamado.
  await chamarOpenAI({ toolChoice: 'none' }, [ferramenta('buscar', 'read')])
  assert.equal(enviado.openai[0].tools, undefined)

  await chamarAnthropic({ toolChoice: 'none' }, [ferramenta('buscar', 'read')])
  assert.equal(enviado.anthropic[0].tools, undefined)
})

test('sem escolha, as ferramentas vão e o provedor decide — como sempre foi', async () => {
  await chamarOpenAI(undefined, [ferramenta('buscar', 'read')])
  assert.equal(enviado.openai[0].tools.length, 1)
  assert.equal(enviado.openai[0].tool_choice, undefined)
})

test('paralelismo DESLIGADO chega como o campo de cada provedor', async () => {
  await chamarOpenAI({ parallelTools: false }, [ferramenta('a', 'read')])
  assert.equal(enviado.openai[0].parallel_tool_calls, false)

  await chamarAnthropic({ parallelTools: false }, [ferramenta('a', 'read')])
  assert.equal(enviado.anthropic[0].tool_choice.disable_parallel_tool_use, true)
})

test('paralelismo LIGADO não vira campo: já é o padrão do provedor', async () => {
  // Um campo a mais na requisição é uma chance a mais de incompatibilidade num modelo
  // futuro, sem ganho nenhum.
  await chamarOpenAI({ parallelTools: true }, [ferramenta('a', 'read')])
  assert.equal(enviado.openai[0].parallel_tool_calls, undefined)
})

test('com ferramenta de escrita, a matriz já tirou o paralelismo antes do adapter', async () => {
  // A decisão é da camada de cima; o adapter só recebe o que sobrou. Assim a regra vale
  // igual nos dois provedores sem ser reimplementada em cada um.
  const cfg = effectiveRunConfig(
    { parallelTools: true },
    { provider: 'openai', model: 'gpt-4o', context: 'automation', toolRisks: ['read', 'write'] },
  )
  await chamarOpenAI(cfg, [ferramenta('a', 'read'), ferramenta('b', 'write')])
  assert.equal(enviado.openai[0].parallel_tool_calls, undefined)
})

// --- o corpo não carrega o que não devia ------------------------------------------------------------

test('nenhum campo do nosso vocabulário vaza para a requisição', async () => {
  // `timeoutMs` e `retries` são regras deste produto, não parâmetros de provedor.
  // `dropped` é diagnóstico. Nada disso pode viajar junto.
  await chamarOpenAI({ temperature: 0.3, timeoutMs: 30_000, retries: 2, dropped: [{ field: 'x', reason: 'y' }] })
  const corpo = enviado.openai[0]
  for (const proibido of ['timeoutMs', 'retries', 'dropped', 'runConfig', 'reasoningEffort', 'maxOutputTokens', 'toolChoice', 'parallelTools']) {
    assert.equal(proibido in corpo, false, `"${proibido}" vazou para a requisição`)
  }
})

// --- paralelismo de verdade, medido -----------------------------------------------------
//
// O commit anterior mandava `parallel_tool_calls` ao provedor e executava o lote num
// `for/await`. O campo dizia "pode ir junto" e o código ia um de cada vez: promessa
// falsa. Aqui a prova é temporal — duas leituras que dormem 60 ms cada terminam em ~60 ms
// se forem paralelas, e em ~120 ms se não forem.

const lenta = (name, risk, ms = 60) => ({
  name,
  description: 'x',
  inputSchema: { type: 'object', properties: {} },
  risk,
  run: async () => {
    await new Promise((r) => setTimeout(r, ms))
    return { ok: true, result: '{}' }
  },
})

// Uma resposta que pede DUAS ferramentas e, na volta, responde.
const pedindoDuas = (nomes) => ({
  content: nomes.map((n, i) => ({ type: 'tool_use', id: `t${i}`, name: n, input: {} })),
  usage: { input_tokens: 1, output_tokens: 1 },
  stop_reason: 'tool_use',
})

async function medirAnthropic({ parallelTools, riscos }) {
  const nomes = riscos.map((_, i) => `f${i}`)
  const tools = riscos.map((r, i) => lenta(nomes[i], r))
  let volta = 0
  // Primeira resposta pede as ferramentas; a segunda encerra.
  responderAnthropic = async () => {
    volta += 1
    return volta === 1 ? pedindoDuas(nomes) : respostaAnthropic
  }
  const inicio = Date.now()
  await anthropic.generateAgentReply('o', [], '', [{ role: 'user', content: 'oi' }], 'claude-sonnet-5', 'k', '', '', '', true, tools, {
    runConfig: { parallelTools },
  })
  const duracao = Date.now() - inicio
  responderAnthropic = async () => respostaAnthropic
  return duracao
}

test('duas LEITURAS com paralelismo ligado rodam juntas', async () => {
  const ms = await medirAnthropic({ parallelTools: true, riscos: ['read', 'read'] })
  assert.ok(ms < 110, `esperado ~60ms (paralelo), levou ${ms}ms`)
})

test('as mesmas duas leituras SEM paralelismo rodam em sequência', async () => {
  const ms = await medirAnthropic({ parallelTools: undefined, riscos: ['read', 'read'] })
  assert.ok(ms >= 110, `esperado ~120ms (sequencial), levou ${ms}ms`)
})

test('uma ESCRITA no lote força a sequência, mesmo com paralelismo pedido', async () => {
  // A ordem em que duas escritas chegam ao outro lado é o que o dono configurou.
  const ms = await medirAnthropic({ parallelTools: true, riscos: ['read', 'write'] })
  assert.ok(ms >= 110, `esperado sequencial, levou ${ms}ms`)
})

test('risco AUSENTE conta como escrita e mantém a sequência', async () => {
  const ms = await medirAnthropic({ parallelTools: true, riscos: ['read', undefined] })
  assert.ok(ms >= 110, `ferramenta sem risco declarado não pode ganhar paralelismo, levou ${ms}ms`)
})
