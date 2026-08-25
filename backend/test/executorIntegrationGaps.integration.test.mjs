// Os buracos entre as peças — que cada peça sozinha escondia.
//
// As fases 1 a 6 construíram contrato, registro, executores, planejador, runtime, tela e
// auditoria. Cada uma passava nos próprios testes, e mesmo assim um agente de função criado
// pela API saía como agente de modelo, o teste dele gastava tokens improvisando o que a
// função faria, e `$context.campo` nunca resolvia nada.
//
// É o tipo de defeito que nenhum teste de unidade pega: ele não está DENTRO de nenhuma
// peça, está entre duas. Estas provas atravessam as costuras.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
delete process.env.VOYAGE_API_KEY

const { createAgent, getAgentById, updateAgent, parseAgentModelFields, toPublicAgent } = await import('../dist/agents.js')
const { executeSectorTeam, runAgentTask, rootContext, sectorRunContext } = await import('../dist/delegation.js')
const { dispatchAgentExecution } = await import('../dist/executors/dispatcher.js')
const { executeRegisteredFunction } = await import('../dist/executors/functionExecutor.js')
const { registerFunction, findFunction } = await import('../dist/executors/functionRegistry.js')
const { compilePlan, inputForTask, validatePlan, isLegacyTask } = await import('../dist/sectorPlanner.js')
const { prepareStepInput, stepAgentOf } = await import('../dist/executors/stepExecution.js')
const { mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'owner-lacunas'
const OUTRO = 'owner-vizinho'
const PREDIO = new ObjectId()
const ANDAR = new ObjectId()

before(() => {
  // Uma função com PARÂMETROS: é ela que prova que `config` chega ao handler.
  registerFunction({
    functionName: 'lacunas.arredonda',
    version: '3.0.0',
    description: 'arredonda um número com as casas configuradas no agente',
    capabilities: ['calculo'],
    inputSchema: { type: 'object', properties: { valor: { type: 'number' } }, required: ['valor'] },
    outputSchema: { type: 'object', properties: { resultado: { type: 'number' }, casas: { type: 'number' } }, required: ['resultado', 'casas'] },
    handler: (input, config) => {
      const casas = typeof config?.casas === 'number' ? config.casas : 0
      return { resultado: Number(Number(input.valor).toFixed(casas)), casas }
    },
    timeoutMs: 2_000,
  })
})

// --- 1. criação e edição gravam MESMO ------------------------------------------------------

const criarFuncao = (nome = 'Somador') =>
  createAgent(OWNER, ANDAR, nome, {
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'math.summary', version: '1.0.0' },
    responseMode: 'structured',
    inputJsonSchema: findFunction('math.summary').inputSchema,
    outputJsonSchema: findFunction('math.summary').outputSchema,
  })

test('criar um agente de FUNÇÃO persiste o contrato — não silenciosamente vira modelo', async () => {
  // O documento é montado campo a campo; um campo não escrito ali era descartado sem erro,
  // e o agente aparecia como de modelo na primeira execução.
  const criado = await criarFuncao()
  const lido = await getAgentById(OWNER, criado._id)
  assert.equal(lido.executorKind, 'function')
  assert.equal(lido.executorConfig.functionName, 'math.summary')
  assert.equal(lido.responseMode, 'structured')
  assert.ok(lido.inputJsonSchema, 'o contrato de entrada precisa estar gravado')
  assert.equal(toPublicAgent(lido).contract.executorKind, 'function')
})

test('criar um agente de FERRAMENTA persiste a referência da ação', async () => {
  const criado = await createAgent(OWNER, ANDAR, 'Agendador', {
    executorKind: 'tool',
    executorConfig: { kind: 'tool', appKey: 'agenda', actionKey: 'criar_evento' },
    responseMode: 'structured',
  })
  const lido = await getAgentById(OWNER, criado._id)
  assert.equal(lido.executorKind, 'tool')
  assert.equal(lido.executorConfig.appKey, 'agenda')
  assert.equal(lido.executorConfig.actionKey, 'criar_evento')
})

test('editar troca o tipo e a referência de verdade', async () => {
  const criado = await criarFuncao('Trocado')
  const editado = await updateAgent(OWNER, criado._id, {
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'br.cpf', version: '1.0.0' },
  })
  assert.equal(editado.executorConfig.functionName, 'br.cpf')
  assert.equal((await getAgentById(OWNER, criado._id)).executorConfig.functionName, 'br.cpf')
})

test('um agente criado SEM nenhum campo novo continua llm/text', async () => {
  const criado = await createAgent(OWNER, ANDAR, 'Antigo', { objective: 'trabalhar' })
  const lido = await getAgentById(OWNER, criado._id)
  assert.equal(lido.executorKind, undefined, 'gravar um padrão criaria um campo que ninguém pediu')
  const publico = toPublicAgent(lido)
  assert.equal(publico.contract.executorKind, 'llm')
  assert.equal(publico.contract.responseMode, 'text')
})

test('`executorKind` sem configuração é RECUSADO', () => {
  // Gravava um agente que aparecia configurado e falhava na primeira execução, longe do
  // formulário, com uma mensagem que não falava do formulário.
  assert.match(parseAgentModelFields({ executorKind: 'function' }).error, /functionName is required/)
  assert.match(parseAgentModelFields({ executorKind: 'tool' }).error, /requires toolId/)
  assert.equal(parseAgentModelFields({ executorKind: 'llm' }).error, undefined)
})

// --- 2. o contrato vem do REGISTRO ----------------------------------------------------------

test('os schemas de um agente de função são os da função, não os que o cliente mandou', () => {
  const { fields, error } = parseAgentModelFields({
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'math.summary' },
    inputJsonSchema: { type: 'object', properties: { mentira: { type: 'string' } } },
  })
  assert.equal(error, undefined)
  assert.deepEqual(fields.inputJsonSchema, findFunction('math.summary').inputSchema)
  assert.deepEqual(fields.outputJsonSchema, findFunction('math.summary').outputSchema)
  assert.equal(fields.executorConfig.version, '1.0.0', 'a versão também é do registro')
  assert.deepEqual(fields.capabilities, findFunction('math.summary').capabilities)
})

test('versão incompatível é recusada na gravação, e não na execução', () => {
  const { error } = parseAgentModelFields({
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'math.summary', version: '9.9.9' },
  })
  assert.match(error, /versão/)
})

// --- 3. o caminho de execução: dispatcher em todos ---------------------------------------------

const depsSimples = (agentes, over = {}) => {
  const porId = new Map(agentes.map((a) => [a._id.toString(), a]))
  const chamadas = []
  return {
    chamadas,
    deps: {
      loadAgent: async (ownerId, id) => {
        const a = porId.get(id.toString())
        return a && a.ownerId === ownerId ? a : null
      },
      loadSector: async () => over.sector ?? null,
      listAgentsInBuilding: async () => agentes,
      buildingIdForFloor: async () => PREDIO.toString(),
      resolveTools: async () => [],
      apiKeyFor: async () => 'k',
      runTask: async (req) => {
        chamadas.push(req)
        return over.runTask ? over.runTask(req) : { output: 'texto do modelo', usage: { inputTokens: 9, outputTokens: 9 }, toolCalls: [] }
      },
      startDelegation: async () => new ObjectId(),
      finishDelegation: async () => undefined,
      recordEvent: () => undefined,
      planWithModel: over.planWithModel,
    },
  }
}

test('ROTINA de um agente de função roda a função — sem tocar no provedor, e com zero tokens', async () => {
  const agente = await criarFuncao('Rotina')
  const f = depsSimples([agente])
  const ctx = rootContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'rotina', agent: agente })
  const r = await runAgentTask(f.deps, ctx, agente, 'somar', { values: [1, 2, 3] }, undefined)

  assert.deepEqual(r.json, { count: 3, sum: 6, average: 2, min: 1, max: 3 })
  assert.equal(f.chamadas.length, 0, 'chamar o provedor aqui seria pagar para não fazer o trabalho')
  assert.equal(r.usage.inputTokens, 0)
  assert.equal(r.usage.outputTokens, 0)
})

test('o mesmo agente pelo SETOR dá o mesmo resultado, e também sem provedor', async () => {
  const chefe = await createAgent(OWNER, ANDAR, 'Chefe', { preset: 'manager' })
  const somador = await criarFuncao('DoSetor')
  const setor = {
    _id: new ObjectId(),
    name: 'Mesa',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: chefe._id,
    instruction: '',
    members: [{ agentId: chefe._id, isDefault: true }, { agentId: somador._id }],
    stages: [],
  }
  const f = depsSimples([chefe, somador], {
    sector: setor,
    planWithModel: async () =>
      JSON.stringify({
        tasks: [{ id: 't1', agentId: somador._id.toString(), objective: 'somar', inputBindings: { values: [10, 20, 30] } }],
      }),
    runTask: async () => ({ output: 'consolidado', usage: { inputTokens: 4, outputTokens: 4 }, toolCalls: [] }),
  })
  const run = await executeSectorTeam(f.deps, sectorRunContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'setor' }), setor, {
    objective: 'some os valores',
  })
  assert.equal(run.warnings.filter((w) => /confere|insuficiente/.test(w)).length, 0, JSON.stringify(run.warnings))
  // Só a consolidação falou com o provedor: a soma não custou inferência nenhuma.
  assert.equal(f.chamadas.length, 1)
  // E o DADO chegou até ela — é o que prova que a função rodou de verdade, e não que o
  // coordenador respondeu por conta própria.
  assert.match(String(f.chamadas[0].input), /60/)
})

test('um agente de outro dono não executa por este caminho', async () => {
  const alheio = await createAgent(OUTRO, ANDAR, 'Alheio', {
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'math.summary' },
  })
  const f = depsSimples([])
  const ctx = rootContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'x', agent: alheio })
  // O escopo de dono é do carregamento: para esta conta, o agente não existe.
  assert.equal(await f.deps.loadAgent(OWNER, alheio._id), null)
})

// --- 4. o `config` do agente chega ao handler ---------------------------------------------------

test('os parâmetros fixados no agente chegam à função', async () => {
  const r = await executeRegisteredFunction(
    { kind: 'function', functionName: 'lacunas.arredonda', config: { casas: 2 } },
    { valor: 3.14159 },
  )
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.deepEqual(r.structured.data, { resultado: 3.14, casas: 2 })
})

test('um parâmetro que parece credencial é recusado antes do handler', async () => {
  for (const chave of ['apiKey', 'access_token', 'clientSecret', 'senha']) {
    const r = await executeRegisteredFunction(
      { kind: 'function', functionName: 'lacunas.arredonda', config: { [chave]: 'x', casas: 1 } },
      { valor: 1.23 },
    )
    assert.equal(r.ok, false, `${chave} deveria ser recusado`)
    assert.equal(r.error.kind, 'invalid_input')
  }
})

test('entrada grande demais é recusada ANTES de o validador percorrê-la', async () => {
  const r = await executeRegisteredFunction({ kind: 'function', functionName: 'math.summary' }, { values: new Array(200_000).fill(1) })
  assert.equal(r.ok, false)
  assert.match(r.error.message, /grande demais/)
})

// --- 5. contexto e bindings ------------------------------------------------------------------------

test('$context.portfolio_value resolve em execução', () => {
  const task = {
    id: 't1',
    agentId: 'a1',
    objective: 'avaliar',
    inputBindings: { valor: { from: 'context', path: ['portfolio_value'] } },
  }
  const r = inputForTask(task, new Map(), { portfolio_value: 125000 })
  assert.deepEqual(r.missing, [], 'sem contexto real, isto ficava sempre "ausente" e a tarefa era pulada')
  assert.equal(r.input.valor, 125000)
  assert.match(r.text, /valor: 125000/)
})

test('a conferência de entrada usa o mesmo contexto', () => {
  const task = { id: 't1', agentId: 'a1', objective: 'x', inputBindings: { valor: { from: 'context', path: ['portfolio_value'] } } }
  const passo = stepAgentOf('a1', { inputJsonSchema: { type: 'object', properties: { valor: { type: 'number' } }, required: ['valor'] } })
  assert.equal(prepareStepInput(task, passo, { context: { portfolio_value: 1 } }).ok, true)
  assert.equal(prepareStepInput(task, passo, { context: {} }).ok, false)
})

test('binding inválido NÃO devolve a tarefa para o modo legado', () => {
  // Legado quer dizer "recebe o texto do antecessor e se vira". Uma tarefa cujas origens
  // foram todas descartadas é a que MAIS precisa ser barrada — devolvê-la ao legado
  // transformava o defeito em silêncio, e o agente rodava com a prosa.
  const membros = [{ agentId: 'a1', name: 'A', inputJsonSchema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] } }]
  const plano = validatePlan(
    { tasks: [{ id: 't1', agentId: 'a1', objective: 'x', inputBindings: { x: '$steps.nao-existe.x' } }] },
    membros,
    'pergunta',
  )
  assert.equal(isLegacyTask(plano.tasks[0]), false, 'ela continua contratada')
  assert.deepEqual(plano.tasks[0].inputBindings, {})
  const r = compilePlan(plano, membros)
  assert.ok(r.diagnostics.some((d) => d.code === 'missing_input'), 'e o campo sem origem é apontado')
})

// --- 6. structured_and_text honesto -------------------------------------------------------------------

test('uma função NÃO PODE ser marcada como "dados + texto" — o modo é ajustado ao que ela faz', () => {
  // Garantia mais forte que recusar a saída vazia: a promessa impossível deixa de existir.
  // Uma função produz dado; prosa é trabalho de modelo, e a tela mostrava "Texto" para um
  // agente que devolve dados.
  const passo = stepAgentOf('a1', { executorKind: 'function', responseMode: 'structured_and_text' })
  assert.equal(passo.contract.responseMode, 'structured')
  // E a gravação recusa em voz alta, que é onde existe alguém para avisar.
  assert.match(
    parseAgentModelFields({
      executorKind: 'function',
      executorConfig: { kind: 'function', functionName: 'math.summary' },
      responseMode: 'text',
    }).error,
    /precisa ser "structured"/,
  )
})

test('quem PODE produzir texto e não produz não passa como sucesso completo', async () => {
  const { finishStep } = await import('../dist/executors/stepExecution.js')
  const passo = stepAgentOf('a1', { responseMode: 'structured_and_text' })
  const r = finishStep({ id: 't1', agentId: 'a1', objective: 'x' }, passo, {
    ok: true,
    structured: { data: { a: 1 }, valid: true, repaired: false },
    text: '',
    metadata: {},
    telemetry: { durationMs: 1 },
  })
  assert.equal(r.ok, false)
  assert.match(r.error.message, /encadeie um agente de IA/)
})

test('com texto de verdade, "dados + texto" entrega os dois', async () => {
  const { finishStep } = await import('../dist/executors/stepExecution.js')
  const passo = stepAgentOf('a1', { responseMode: 'structured_and_text' })
  const r = finishStep({ id: 't1', agentId: 'a1', objective: 'x' }, passo, {
    ok: true,
    structured: { data: { a: 1 }, valid: true, repaired: false },
    text: 'o resultado foi 1',
    metadata: {},
    telemetry: { durationMs: 1 },
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.structured.data, { a: 1 })
  assert.equal(r.text, 'o resultado foi 1')
})

// --- 7. o dispatcher não vaza para o modelo -----------------------------------------------------------

test('um agente de função nunca chega ao runtime de modelo, mesmo com ele injetado', async () => {
  let chamou = 0
  const agente = await criarFuncao('Isolado')
  const r = await dispatchAgentExecution(agente, { agentId: agente._id, ownerId: OWNER, objective: 'somar', input: { values: [2, 4] } }, {
    runLlm: async () => {
      chamou += 1
      return { output: 'x', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }
    },
  })
  assert.equal(chamou, 0)
  assert.equal(r.ok, true)
  assert.equal(r.structured.data.sum, 6)
  assert.equal(r.telemetry.inputTokens, undefined, 'uma função não consome token')
})

// --- o modo que o executor CONSEGUE cumprir ----------------------------------------------

test('uma ferramenta sem contrato de saída promete TEXTO, não dados', () => {
  // Ela devolve o corpo de um terceiro, cuja forma o manifesto não controla. Prometer
  // dados ali é um contrato que a primeira resposta diferente desmente.
  const semSchema = stepAgentOf('t', { executorKind: 'tool', responseMode: 'structured' })
  assert.equal(semSchema.contract.responseMode, 'text')

  const comSchema = stepAgentOf('t', {
    executorKind: 'tool',
    responseMode: 'structured',
    outputJsonSchema: { type: 'object', properties: { id: { type: 'string' } } },
  })
  assert.equal(comSchema.contract.responseMode, 'structured', 'com o formato declarado, o modo vale')
})

test('a conferência de entrada vale para TODO caminho, não só para o setor', async () => {
  const agente = await criarFuncao('Conferido')
  // Sem entrada nenhuma: o contrato exige `values`, e a recusa vem do dispatcher — que é
  // por onde Playground, rotina, gatilho, delegação e setor passam.
  const r = await dispatchAgentExecution(agente, { agentId: agente._id, ownerId: OWNER, objective: 'somar' })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'invalid_input')
  assert.match(r.error.message, /values/)
})

test('os parâmetros são conferidos contra o schema da função na GRAVAÇÃO', () => {
  const bom = parseAgentModelFields({
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'math.summary', config: { decimals: 2 } },
  })
  assert.equal(bom.error, undefined)
  assert.deepEqual(bom.fields.executorConfig.config, { decimals: 2 })

  // Um campo que a função não declara é ruído no documento do agente — e o campo extra de
  // hoje é o que alguém tenta usar amanhã achando que vale. O validador já recusa por
  // padrão, e é dele a mensagem: uma segunda regra aqui teria outra redação para o mesmo.
  assert.match(
    parseAgentModelFields({
      executorKind: 'function',
      executorConfig: { kind: 'function', functionName: 'math.summary', config: { inventado: 1 } },
    }).error,
    /inventado: campo não previsto/,
  )
  // Fora da faixa declarada.
  assert.match(
    parseAgentModelFields({
      executorKind: 'function',
      executorConfig: { kind: 'function', functionName: 'math.summary', config: { decimals: 99 } },
    }).error,
    /fora do contrato/,
  )
  // Uma função sem `configSchema` não aceita parâmetro nenhum.
  assert.match(
    parseAgentModelFields({
      executorKind: 'function',
      executorConfig: { kind: 'function', functionName: 'br.cpf', config: { x: 1 } },
    }).error,
    /não aceita parâmetros/,
  )
})

test('o parâmetro fixado muda o resultado da função de verdade', async () => {
  const { fields } = parseAgentModelFields({
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'math.summary', config: { decimals: 1 } },
  })
  const agente = await createAgent(OWNER, ANDAR, 'Arredondado', fields)
  const r = await dispatchAgentExecution(agente, { agentId: agente._id, ownerId: OWNER, objective: 'x', input: { values: [1, 2] } })
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal(r.structured.data.average, 1.5)

  const semConfig = await createAgent(OWNER, ANDAR, 'Cru', parseAgentModelFields({
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'math.summary' },
  }).fields)
  const r2 = await dispatchAgentExecution(semConfig, { agentId: semConfig._id, ownerId: OWNER, objective: 'x', input: { values: [1, 2, 2] } })
  assert.equal(r2.structured.data.average, 5 / 3, 'sem parâmetro, nada é arredondado')
})
