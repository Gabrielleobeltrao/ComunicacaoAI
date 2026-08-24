// O contrato de execução de um agente — a fundação, antes de existir mais de um executor.
//
// A regra que governa tudo, e que estes testes existem para proteger: AUSENTE é o
// comportamento de HOJE. Um campo que falta nunca pode significar uma mudança. É isso que
// permite adicionar a fundação inteira sem migração e sem tocar em um único documento
// existente — e é a primeira coisa que uma refatoração futura quebraria sem perceber.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { agentContractOf, parseAgentContract, normalizeExecutorConfig, responseModeFromLegacy, EXECUTOR_KINDS, RESPONSE_MODES } =
  await import('../dist/executors/contract.js')

// --- retrocompatibilidade: o agente que nunca ouviu falar destes campos ----------------------

test('agente ANTIGO lê como o que ele sempre foi: modelo e texto', () => {
  const c = agentContractOf({})
  assert.equal(c.executorKind, 'llm')
  assert.equal(c.responseMode, 'text')
  assert.deepEqual(c.executorConfig, { kind: 'llm' })
  assert.equal(c.inputJsonSchema, null)
  assert.equal(c.outputJsonSchema, null)
})

test('documento nulo ou indefinido não derruba a leitura', () => {
  // Este caminho roda ao carregar QUALQUER agente: um documento estranho não pode tornar
  // o agente inacessível.
  for (const entrada of [null, undefined]) {
    assert.equal(agentContractOf(entrada).executorKind, 'llm')
  }
})

test('`defaultOutputFormat: json` já significava "quero dado" — e vira structured', () => {
  assert.equal(agentContractOf({ defaultOutputFormat: 'json' }).responseMode, 'structured')
  assert.equal(responseModeFromLegacy('json'), 'structured')
})

test('qualquer outro formato antigo continua sendo texto', () => {
  for (const antigo of ['text', 'markdown', undefined, null, '']) {
    assert.equal(agentContractOf({ defaultOutputFormat: antigo }).responseMode, 'text', String(antigo))
  }
})

test('o campo NOVO manda sobre o antigo quando os dois existem', () => {
  const c = agentContractOf({ defaultOutputFormat: 'json', responseMode: 'text' })
  assert.equal(c.responseMode, 'text', 'quem escreveu o campo novo decidiu')
})

test('valor inválido cai no padrão em vez de derrubar — a recusa é na ESCRITA', () => {
  assert.equal(agentContractOf({ executorKind: 'quantico' }).executorKind, 'llm')
  assert.equal(agentContractOf({ responseMode: 'telepatia' }).responseMode, 'text')
})

// --- os schemas -------------------------------------------------------------------------------

test('schema válido é preservado; inválido lê como ausente', () => {
  const bom = { type: 'object', properties: { titulo: { type: 'string' } }, required: ['titulo'] }
  assert.deepEqual(agentContractOf({ inputJsonSchema: bom }).inputJsonSchema, bom)
  assert.deepEqual(agentContractOf({ outputJsonSchema: bom }).outputJsonSchema, bom)

  for (const ruim of [{ type: 'string' }, [], 'schema', 42, { properties: [] }]) {
    assert.equal(agentContractOf({ inputJsonSchema: ruim }).inputJsonSchema, null, JSON.stringify(ruim))
  }
})

test('a escrita RECUSA um schema que ninguém consegue verificar', () => {
  const r = parseAgentContract({ inputJsonSchema: { type: 'string' } })
  assert.match(r.error, /inputJsonSchema/)

  // Limpar é uma escolha legítima e explícita.
  assert.equal(parseAgentContract({ inputJsonSchema: null }).fields.inputJsonSchema, null)
  assert.equal(parseAgentContract({ inputJsonSchema: '' }).fields.inputJsonSchema, null)
})

// --- a configuração por tipo -------------------------------------------------------------------

test('llm não carrega configuração própria — provedor e modelo já são campos do agente', () => {
  // Duplicá-los aqui criaria duas verdades sobre qual modelo roda.
  const c = normalizeExecutorConfig('llm', { functionName: 'somar', provider: 'openai', apiKey: 'segredo' })
  assert.deepEqual(c, { kind: 'llm' })
})

test('function guarda NOME e versão — nunca o código', () => {
  const c = normalizeExecutorConfig('function', { functionName: '  somar  ', version: 'v2', config: { casas: 2 } })
  assert.deepEqual(c, { kind: 'function', functionName: 'somar', version: 'v2', config: { casas: 2 } })
})

test('function sem nome é recusada na escrita', () => {
  const r = parseAgentContract({ executorKind: 'function', executorConfig: {} })
  assert.match(r.error, /functionName is required/)
})

test('tool guarda REFERÊNCIA, e a credencial não passa por aqui', () => {
  const c = normalizeExecutorConfig('tool', { toolId: 't1', apiKey: 'segredo', headers: { Authorization: 'Bearer x' } })
  assert.deepEqual(c, { kind: 'tool', toolId: 't1' })
  assert.ok(!JSON.stringify(c).includes('segredo'))
  assert.ok(!JSON.stringify(c).toLowerCase().includes('authorization'))
})

test('tool aceita App + ação, e recusa referência incompleta', () => {
  assert.equal(parseAgentContract({ executorKind: 'tool', executorConfig: { appKey: 'google', actionKey: 'criar_evento' } }).error, undefined)
  const semAcao = parseAgentContract({ executorKind: 'tool', executorConfig: { appKey: 'google' } })
  assert.match(semAcao.error, /toolId, or appKey with actionKey/)
})

test('configuração que declara OUTRO tipo é ambígua — e recusada', () => {
  // Qual dos dois vale? Escolher um em silêncio é o dono descobrir depois, em produção.
  const r = parseAgentContract({ executorKind: 'llm', executorConfig: { kind: 'function', functionName: 'somar' } })
  assert.match(r.error, /does not match executorKind/)
})

test('sem `executorKind` no corpo, vale o que já está gravado', () => {
  // A função precisa EXISTIR: o contrato de um agente de função vem do registro, e um nome
  // inventado passaria pela API para falhar na primeira execução.
  const r = parseAgentContract({ executorConfig: { functionName: 'math.summary' } }, { executorKind: 'function' })
  assert.equal(r.error, undefined)
  assert.equal(r.fields.executorConfig.functionName, 'math.summary')
})

test('função que não está no registro é recusada na gravação', () => {
  const r = parseAgentContract({ executorConfig: { functionName: 'somar' } }, { executorKind: 'function' })
  assert.match(r.error, /não está disponível/)
})

test('o contrato de uma função vem do REGISTRO, não do que o cliente mandou', () => {
  // Duas verdades sobre o que a função aceita começam iguais e divergem na primeira
  // mudança — e a errada é descoberta em produção, recusando entrada boa ou aceitando má.
  const r = parseAgentContract({
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'math.summary' },
    inputJsonSchema: { type: 'object', properties: { inventado: { type: 'string' } } },
    outputJsonSchema: { type: 'object', properties: { tambemInventado: { type: 'string' } } },
  })
  assert.equal(r.error, undefined)
  assert.ok(!('inventado' in r.fields.inputJsonSchema.properties), 'o schema do cliente não pode vencer o do registro')
  assert.ok('values' in r.fields.inputJsonSchema.properties)
  assert.ok('sum' in r.fields.outputJsonSchema.properties)
  // Versão e capacidades também: são da função, não do formulário.
  assert.ok(r.fields.executorConfig.version)
  assert.ok(Array.isArray(r.fields.capabilities))
})

test('executorConfig que não é objeto é recusado', () => {
  assert.match(parseAgentContract({ executorConfig: 'somar' }).error, /must be an object/)
  assert.match(parseAgentContract({ executorConfig: ['somar'] }).error, /must be an object/)
})

// --- a API antiga continua aceita ------------------------------------------------------------

test('payload SEM nenhum campo novo não grava nenhum campo novo', () => {
  // É isto que mantém as APIs anteriores funcionando: o agente é gravado exatamente como
  // sempre foi, sem ganhar campo que ninguém pediu.
  const r = parseAgentContract({ name: 'Agente', objective: 'trabalhar', defaultOutputFormat: 'json' })
  assert.equal(r.error, undefined)
  assert.deepEqual(r.fields, {})
})

test('os valores aceitos são exatamente os do desenho', () => {
  // `formula` entrou: é o único executor cujo "código" mora no documento do agente, e só
  // é seguro porque a linguagem não tem capacidade nenhuma além de calcular.
  assert.deepEqual([...EXECUTOR_KINDS], ['llm', 'function', 'tool', 'formula'])
  assert.deepEqual([...RESPONSE_MODES], ['structured', 'text', 'structured_and_text'])
  // `llm` sozinho é completo: ele não tem configuração própria.
  assert.equal(parseAgentContract({ executorKind: 'llm' }).error, undefined)
  /**
   * Os outros dois NÃO são completos sozinhos.
   *
   * `executorKind: 'function'` sem função é uma promessa sem cumprimento: gravava um
   * agente que aparecia configurado na tela e falhava na primeira execução com "não
   * configurado" — longe daqui, e sem nada que apontasse para o pedido que o criou.
   */
  assert.match(parseAgentContract({ executorKind: 'function' }).error, /functionName is required/)
  assert.match(parseAgentContract({ executorKind: 'tool' }).error, /requires toolId/)
  assert.match(parseAgentContract({ executorKind: 'formula' }).error, /expression is required/)
  assert.match(parseAgentContract({ executorKind: 'executionMode' }).error, /executorKind must be one of/)
})

// --- o DTO: a tela recebe o contrato resolvido, como recebe o roleConfig -----------------

const { toPublicAgent } = await import('../dist/agents.js')

test('a API entrega o contrato pronto, mesmo para um agente antigo', () => {
  // Derivar do lado do cliente criaria uma segunda cópia da regra, e uma das duas
  // envelheceria — foi assim que a matriz de papéis divergiu uma vez.
  const publico = toPublicAgent({ _id: 'a1', name: 'Antigo', preset: 'custom' })
  assert.equal(publico.contract.executorKind, 'llm')
  assert.equal(publico.contract.responseMode, 'text')
  assert.deepEqual(publico.contract.executorConfig, { kind: 'llm' })
})

test('o contrato é DERIVADO, nunca gravado — o documento não ganha campo por ser lido', () => {
  const agente = { _id: 'a1', name: 'X', preset: 'custom', defaultOutputFormat: 'json' }
  const publico = toPublicAgent(agente)
  assert.equal(publico.contract.responseMode, 'structured')
  assert.equal(agente.contract, undefined)
  // E o campo antigo continua lá: apagá-lo nesta fase quebraria quem ainda o lê.
  assert.equal(publico.defaultOutputFormat, 'json')
})
