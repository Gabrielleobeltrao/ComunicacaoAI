// O agente é o MESMO por qualquer porta.
//
// Este é o defeito que o resolvedor central existe para fechar: rotina, delegação,
// Playground e canal montavam o prompt cada um do seu jeito. Um campo novo era lembrado
// em um caminho e esquecido em outro — e o dono via o agente respondendo diferente
// dependendo de onde o pedido entrou, sem nada explicando.
//
// A prova aqui é de PARIDADE: os mesmos campos do agente produzem os mesmos blocos, na
// mesma ordem, venham de onde vierem.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { composeAgentPrompt, definitionOf, resolveAgentRun, resolveCache } = await import('../dist/agentDefinition.js')
const { buildTaskObjective } = await import('../dist/agentRuntime.js')

const agente = (over = {}) => ({
  _id: new ObjectId(),
  ownerId: 'o1',
  name: 'Ana',
  objective: 'OBJETIVO',
  role: 'FUNCAO',
  instructions: 'INSTRUCOES',
  constraints: 'LIMITES',
  inputContract: 'ENTRADA',
  outputContract: 'SAIDA',
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  ...over,
})

const posicao = (texto, agulha) => texto.indexOf(agulha)

// --- paridade entre os caminhos -------------------------------------------------------

test('conversa e automação produzem os MESMOS blocos, na mesma ordem', () => {
  const a = agente()
  const def = definitionOf(a)

  // O caminho de conversa (Playground, canal, widget).
  const conversa = composeAgentPrompt({ definition: def, hasUntrustedContext: true })

  // O caminho de automação (rotina, gatilho, delegação).
  const automacao = buildTaskObjective({
    objective: def.objective,
    instructions: def.instructions,
    definition: { role: def.role, constraints: def.constraints },
    contracts: def.contracts,
    context: ['material'],
  })

  for (const bloco of ['NÃO PODE SER ALTERADA', 'Sua função: FUNCAO', 'OBJETIVO', 'INSTRUCOES', 'LIMITES', 'ENTRADA', 'SAIDA']) {
    assert.ok(posicao(conversa, bloco) >= 0, `conversa não tem "${bloco}"`)
    assert.ok(posicao(automacao, bloco) >= 0, `automação não tem "${bloco}"`)
  }

  const ordem = (texto) =>
    ['NÃO PODE SER ALTERADA', 'FUNCAO', 'OBJETIVO', 'INSTRUCOES', 'LIMITES', 'ENTRADA'].map((b) => posicao(texto, b))
  const cresce = (lista) => lista.every((v, i) => i === 0 || v > lista[i - 1])
  assert.ok(cresce(ordem(conversa)), 'a ordem na conversa está errada')
  assert.ok(cresce(ordem(automacao)), 'a ordem na automação está errada')
})

test('a instrução da tarefa/canal entra DEPOIS das do agente', () => {
  // As do agente valem para todo trabalho dele; a da tarefa é o pedido do momento.
  const p = composeAgentPrompt({ definition: definitionOf(agente()), taskInstruction: 'PEDIDO DO MOMENTO' })
  assert.ok(posicao(p, 'INSTRUCOES') < posicao(p, 'PEDIDO DO MOMENTO'))
  assert.ok(posicao(p, 'PEDIDO DO MOMENTO') < posicao(p, 'LIMITES'))
})

test('agente sem os campos novos produz o prompt de antes, nos dois caminhos', () => {
  const antigo = agente({ role: undefined, instructions: undefined, constraints: undefined, inputContract: '', outputContract: '' })
  const conversa = composeAgentPrompt({ definition: definitionOf(antigo) })
  assert.equal(conversa, 'OBJETIVO')

  const automacao = buildTaskObjective({ objective: 'OBJETIVO', instructions: '' })
  assert.equal(automacao, 'OBJETIVO')
})

test('conhecimento e memória NUNCA entram no prompt do sistema', () => {
  // Colá-los aqui é o que transforma um documento carregado pelo usuário em ordem para o
  // agente. O compositor nem RECEBE o conteúdo — ele só é avisado de que existe material
  // externo, para emitir a regra. Não há por onde o texto vazar.
  const conteudoSensivel = 'SENHA-DO-BANCO-4321'
  const p = composeAgentPrompt({ definition: definitionOf(agente()), hasUntrustedContext: true })
  assert.doesNotMatch(p, new RegExp(conteudoSensivel))
  assert.match(p, /NÃO CONFIÁVEL/, 'mas a regra sobre esse material precisa estar lá')

  // E o caminho de automação, que RECEBE o contexto, também não o cola no sistema.
  const automacao = buildTaskObjective({ objective: 'X', instructions: '', context: [conteudoSensivel] })
  assert.doesNotMatch(automacao, new RegExp(conteudoSensivel))
})

// --- o resolvedor -----------------------------------------------------------------------

test('automação nunca faz stream; conversa também não, enquanto o transporte não existir', () => {
  const a = agente({ runConfig: { stream: true } })
  assert.equal(resolveAgentRun(a, { context: 'automation' }).runConfig.stream, undefined)
  assert.equal(resolveAgentRun(a, { context: 'chat' }).runConfig.stream, undefined)
})

test('o risco das ferramentas decide o paralelismo, e o resolvedor recebe isso pronto', () => {
  const a = agente({ runConfig: { parallelTools: true } })
  assert.equal(resolveAgentRun(a, { context: 'automation', toolRisks: ['read', 'read'] }).runConfig.parallelTools, true)
  assert.equal(resolveAgentRun(a, { context: 'automation', toolRisks: ['read', 'write'] }).runConfig.parallelTools, undefined)
})

test('a configuração da rotina ganha da do agente, campo a campo', () => {
  const a = agente({ runConfig: { temperature: 0.2, maxOutputTokens: 500 } })
  const r = resolveAgentRun(a, { context: 'automation', overrides: { maxOutputTokens: 900 } })
  assert.equal(r.runConfig.temperature, 0.2, 'o que a rotina não mencionou continua valendo')
  assert.equal(r.runConfig.maxOutputTokens, 900)
})

// --- cache: campo novo, legado preservado -------------------------------------------------

test('sem escolha nova, vale o legado `promptCaching`', () => {
  // Quem desligou o cache antes desta tela não pode vê-lo religado sozinho.
  assert.equal(resolveCache(agente({ promptCaching: false }), {}), false)
  assert.equal(resolveCache(agente({ promptCaching: true }), {}), true)
})

test('a escolha nova ganha do legado', () => {
  assert.equal(resolveCache(agente({ promptCaching: true }), { cache: false }), false)
  assert.equal(resolveCache(agente({ promptCaching: false }), { cache: true }), true)
})

test('`false` explícito NÃO é confundido com "não escolhido"', () => {
  // Este é o erro clássico do booleano opcional: um `config.cache || agent.promptCaching`
  // religaria o cache de quem desligou.
  assert.equal(resolveCache(agente({ promptCaching: true }), { cache: false }), false)
})

test('sem nada configurado, o cache continua ligado — como sempre esteve', () => {
  assert.equal(resolveCache(agente({ promptCaching: undefined }), {}), true)
})

// --- o que a definição lê do documento -------------------------------------------------------

test('campo ausente vira string vazia, e string vazia não gera bloco', () => {
  const def = definitionOf(agente({ role: null, constraints: undefined }))
  assert.equal(def.role, '')
  assert.equal(def.constraints, '')
  const p = composeAgentPrompt({ definition: def })
  assert.doesNotMatch(p, /Sua função/)
  assert.doesNotMatch(p, /Limites que você/)
})

test('o formato de saída sai do agente, e o schema só vale em JSON', () => {
  const comJson = definitionOf(agente({ defaultOutputFormat: 'json', outputJsonSchema: { type: 'object' } }))
  assert.equal(comJson.output.format, 'json')
  assert.deepEqual(comJson.output.jsonSchema, { type: 'object' })

  const comTexto = definitionOf(agente({ defaultOutputFormat: 'text', outputJsonSchema: { type: 'object' } }))
  assert.equal(comTexto.output.jsonSchema, null, 'um schema num agente de texto não deve viajar')
})
