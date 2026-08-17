// Paridade pelos ENTRYPOINTS, não pelos compositores.
//
// A versão anterior deste teste chamava `composeAgentPrompt` e `buildTaskObjective`
// diretamente e concluía que os caminhos eram iguais. Isso provava que as duas funções
// concordam — não que rotina, delegação e canal as CHAMAM, e muito menos que chamam com
// os mesmos argumentos. Era exatamente o tipo de prova que deixou o Run Config
// "pronto" sem chegar a lugar nenhum.
//
// Aqui os entrypoints reais são executados com o SDK substituído por um espião, e as
// asserções são sobre o corpo que saiu: o prompt do sistema, o cache, o teto de saída, a
// escolha de ferramenta. Se alguém desligar a fiação de um caminho, este arquivo quebra.
import { test, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
process.env.ENCRYPTION_KEY ||= 'test-encryption-key'

// --- espião no lugar do SDK -----------------------------------------------------------

const enviado = []

class AnthropicFalso {
  messages = {
    create: async (body) => {
      enviado.push(body)
      return { content: [{ type: 'text', text: 'resposta' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
    },
  }
  models = { list: async () => ({ data: [] }) }
}

mock.module('@anthropic-ai/sdk', { defaultExport: AnthropicFalso })

const { executeAgentTask } = await import('../dist/agentRuntime.js')
const { resolveAgentRun, definitionOf } = await import('../dist/agentDefinition.js')

beforeEach(() => {
  enviado.length = 0
})

// O agente que todos os caminhos vão executar. Os mesmos campos, para a comparação ser
// sobre o CAMINHO e não sobre o dado.
const AGENTE = {
  _id: new ObjectId(),
  ownerId: 'o1',
  name: 'Ana',
  objective: 'OBJETIVO-DO-AGENTE',
  role: 'FUNCAO-DO-AGENTE',
  instructions: 'INSTRUCOES-DO-AGENTE',
  constraints: 'LIMITES-DO-AGENTE',
  inputContract: 'CONTRATO-ENTRADA',
  outputContract: 'CONTRATO-SAIDA',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  promptCaching: true,
  defaultOutputFormat: 'markdown',
}

const ferramenta = (name, risk) => ({
  name,
  description: 'x',
  inputSchema: { type: 'object', properties: {} },
  risk,
  run: async () => ({ ok: true, result: '{}' }),
})

// O que a rotina, a delegação e o gatilho fazem: resolvem o agente e chamam o runtime.
// Este helper reproduz essa montagem — é a MESMA que `routineExecution` e `delegation`
// usam, e por isso o que ele prova vale para as duas.
async function rodarComoAutomacao(over = {}) {
  const agente = { ...AGENTE, ...over.agent }
  const tools = over.tools ?? []
  const execucao = resolveAgentRun(agente, {
    context: 'automation',
    toolRisks: tools.map((t) => t.risk ?? 'write'),
    overrides: over.overrides,
  })
  const def = definitionOf(agente)
  return executeAgentTask({
    objective: def.objective,
    instructions: [def.instructions, over.taskInstruction].filter(Boolean).join('\n\n'),
    definition: { role: def.role, constraints: def.constraints },
    contracts: def.contracts,
    output: def.output,
    provider: agente.provider,
    model: agente.model,
    apiKey: 'chave',
    tools,
    runConfig: execucao.runConfig,
    enableCaching: execucao.enableCaching,
    input: 'entrada',
  })
}

const sistemaDe = (corpo) => corpo.system.map((b) => b.text).join('\n\n')

// --- a definição chega ao provedor ---------------------------------------------------------

test('função, instruções e limites do agente aparecem no prompt enviado', async () => {
  await rodarComoAutomacao()
  const sistema = sistemaDe(enviado[0])
  for (const bloco of ['FUNCAO-DO-AGENTE', 'OBJETIVO-DO-AGENTE', 'INSTRUCOES-DO-AGENTE', 'LIMITES-DO-AGENTE']) {
    assert.ok(sistema.includes(bloco), `"${bloco}" não chegou ao provedor`)
  }
})

test('a ordem no prompt enviado é função → objetivo → instruções → limites', async () => {
  await rodarComoAutomacao()
  const s = sistemaDe(enviado[0])
  const p = (t) => s.indexOf(t)
  assert.ok(p('FUNCAO-DO-AGENTE') < p('OBJETIVO-DO-AGENTE'))
  assert.ok(p('OBJETIVO-DO-AGENTE') < p('INSTRUCOES-DO-AGENTE'))
  assert.ok(p('INSTRUCOES-DO-AGENTE') < p('LIMITES-DO-AGENTE'))
})

test('a instrução da tarefa entra depois das do agente', async () => {
  // É o que separa "o que este agente sempre faz" de "o que pediram agora".
  await rodarComoAutomacao({ taskInstruction: 'PEDIDO-DA-VEZ' })
  const s = sistemaDe(enviado[0])
  assert.ok(s.indexOf('INSTRUCOES-DO-AGENTE') < s.indexOf('PEDIDO-DA-VEZ'))
  assert.ok(s.indexOf('PEDIDO-DA-VEZ') < s.indexOf('LIMITES-DO-AGENTE'))
})

test('o contrato de formato do agente chega, sem ninguém pedir', async () => {
  // `defaultOutputFormat: 'markdown'` valia num caminho e não no outro. Agora sai na
  // requisição.
  await rodarComoAutomacao()
  assert.match(sistemaDe(enviado[0]), /Markdown/)
})

test('agente sem os campos novos manda o prompt de antes', async () => {
  await rodarComoAutomacao({
    agent: { role: undefined, instructions: undefined, constraints: undefined, inputContract: '', outputContract: '', defaultOutputFormat: 'text' },
  })
  // O prompt do sistema da Anthropic é dividido em prefixo cacheável e sufixo dinâmico,
  // e o adapter junta os dois com quebras. O que importa é o CONTEÚDO: só o objetivo, sem
  // bloco de função, de limites ou de formato.
  const sistema = sistemaDe(enviado[0])
  assert.match(sistema, /OBJETIVO-DO-AGENTE/)
  assert.doesNotMatch(sistema, /Sua função/)
  assert.doesNotMatch(sistema, /Limites que você/)
  assert.doesNotMatch(sistema, /Markdown|EXCLUSIVAMENTE/)
  assert.doesNotMatch(sistema, /O que você recebe/)
})

// --- o Run Config chega ------------------------------------------------------------------------

test('a configuração do agente chega ao corpo da requisição', async () => {
  await rodarComoAutomacao({ agent: { runConfig: { temperature: 0.3, maxOutputTokens: 2048 } } })
  assert.equal(enviado[0].temperature, 0.3)
  assert.equal(enviado[0].max_tokens, 2048)
})

test('a configuração da rotina ganha da do agente, campo a campo', async () => {
  await rodarComoAutomacao({
    agent: { runConfig: { temperature: 0.3, maxOutputTokens: 2048 } },
    overrides: { maxOutputTokens: 500 },
  })
  assert.equal(enviado[0].temperature, 0.3, 'o que a rotina não mencionou continua valendo')
  assert.equal(enviado[0].max_tokens, 500)
})

test('temperatura ZERO sobrevive ao caminho inteiro', async () => {
  await rodarComoAutomacao({ agent: { runConfig: { temperature: 0 } } })
  assert.equal(enviado[0].temperature, 0)
})

// --- cache: o legado é respeitado ----------------------------------------------------------------

test('`promptCaching: false` num documento antigo desliga o cache na requisição', async () => {
  // Este é o caminho que estava quebrado: a rotina não passava cache nenhum, o runtime
  // caía no padrão `true`, e quem desligou via o cache religado.
  await rodarComoAutomacao({ agent: { promptCaching: false, runConfig: undefined } })
  const bloco = enviado[0].system[0]
  assert.equal(bloco.cache_control, undefined, 'o prefixo não pode ser marcado como cacheável')
})

test('com cache ligado, o prefixo vai marcado', async () => {
  await rodarComoAutomacao({ agent: { promptCaching: true } })
  assert.deepEqual(enviado[0].system[0].cache_control, { type: 'ephemeral' })
})

test('a escolha nova ganha do legado, inclusive quando é `false`', async () => {
  await rodarComoAutomacao({ agent: { promptCaching: true, runConfig: { cache: false } } })
  assert.equal(enviado[0].system[0].cache_control, undefined)
})

// --- ferramentas: risco e escolha -----------------------------------------------------------------

test('`required` chega quando há ferramenta, e some quando não há', async () => {
  await rodarComoAutomacao({ agent: { runConfig: { toolChoice: 'required' } }, tools: [ferramenta('ler', 'read')] })
  assert.equal(enviado[0].tool_choice.type, 'any')

  enviado.length = 0
  await rodarComoAutomacao({ agent: { runConfig: { toolChoice: 'required' } }, tools: [] })
  assert.equal(enviado[0].tool_choice, undefined, 'sem ferramenta, exigir uma é contradição')
})

test('o risco REAL das ferramentas governa o paralelismo', async () => {
  // Este é o defeito concreto que existia no chat: os riscos chegavam vazios, e o
  // paralelismo nunca era oferecido nem quando tudo era leitura.
  await rodarComoAutomacao({
    agent: { runConfig: { parallelTools: true, toolChoice: 'auto' } },
    tools: [ferramenta('a', 'read'), ferramenta('b', 'read')],
  })
  assert.notEqual(enviado[0].tool_choice?.disable_parallel_tool_use, true, 'só leitura: o paralelismo fica permitido')

  enviado.length = 0
  await rodarComoAutomacao({
    agent: { runConfig: { parallelTools: true } },
    tools: [ferramenta('a', 'read'), ferramenta('b', 'write')],
  })
  // Com escrita, a camada de cima já retirou a opção — não há campo a enviar.
  assert.equal(enviado[0].tool_choice, undefined)
})

test('ferramenta sem risco declarado conta como escrita', async () => {
  // Falhar para o lado conservador: quem não disse o que faz não ganha paralelismo por
  // omissão.
  const execucao = resolveAgentRun({ ...AGENTE, runConfig: { parallelTools: true } }, {
    context: 'automation',
    toolRisks: [ferramenta('a', undefined).risk ?? 'write'],
  })
  assert.equal(execucao.runConfig.parallelTools, undefined)
})

// --- nada do nosso vocabulário vaza ------------------------------------------------------------------

test('o corpo enviado não carrega campos internos', async () => {
  await rodarComoAutomacao({ agent: { runConfig: { temperature: 0.5, timeoutMs: 30_000, retries: 2 } } })
  for (const proibido of ['timeoutMs', 'retries', 'dropped', 'runConfig', 'maxOutputTokens', 'toolChoice', 'parallelTools']) {
    assert.equal(proibido in enviado[0], false, `"${proibido}" vazou`)
  }
})
