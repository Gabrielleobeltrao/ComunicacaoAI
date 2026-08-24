// O ciclo inteiro de um agente de função, pela API de verdade.
//
// Criar → testar sozinho → pôr num setor → executar com JSON → conferir que o resultado é
// o MESMO nos dois caminhos e que nenhum deles custou token.
//
// Cada peça disso já tinha teste. O ciclo não tinha, e era exatamente no ciclo que estava o
// defeito: o agente era criado pela API sem o contrato, o teste dele chamava o modelo para
// improvisar o que a função faria, e o dono via uma resposta plausível — em prosa — que não
// passou perto do código que ele configurou. Tudo "funcionando", nada certo.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
delete process.env.VOYAGE_API_KEY

const { createAgent, getAgentById, parseAgentModelFields, toPublicAgent } = await import('../dist/agents.js')
const { dispatchAgentExecution } = await import('../dist/executors/dispatcher.js')
const { executeSectorTeam, sectorRunContext } = await import('../dist/delegation.js')
const { listPublicFunctions } = await import('../dist/executors/functionRegistry.js')
const { mongoClient } = await import('../dist/db.js')

after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const OWNER = 'owner-ciclo'
const PREDIO = new ObjectId()
const ANDAR = new ObjectId()
const VALORES = [12, 7, 31, 4, 26]
const ESPERADO = { count: 5, sum: 80, average: 16, min: 4, max: 31 }

test('o ciclo completo: criar, testar, pôr no setor, executar — mesmo resultado, zero tokens', async () => {
  // --- 1. o catálogo oferece a função, sem entregar o código dela -------------------------
  const catalogo = listPublicFunctions()
  const escolhida = catalogo.find((f) => f.functionName === 'math.summary')
  assert.ok(escolhida, 'a função precisa estar no catálogo para alguém poder escolhê-la')
  assert.equal(escolhida.handler, undefined, 'o corpo da função nunca sai para o cliente')

  // --- 2. CRIAR, pelo mesmo caminho que a API usa -----------------------------------------
  const { fields, error } = parseAgentModelFields({
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'math.summary' },
    responseMode: 'structured',
    // O cliente manda um schema errado de propósito: o registro é que manda.
    inputJsonSchema: { type: 'object', properties: { inventado: { type: 'string' } } },
  })
  assert.equal(error, undefined)
  const agente = await createAgent(OWNER, ANDAR, 'Estatística', fields)

  const gravado = await getAgentById(OWNER, agente._id)
  assert.equal(gravado.executorKind, 'function', 'o tipo precisa chegar ao banco')
  assert.equal(gravado.executorConfig.functionName, 'math.summary')
  assert.equal(gravado.executorConfig.version, '1.0.0', 'a versão vem do registro')
  assert.deepEqual(gravado.inputJsonSchema, escolhida.inputSchema, 'o contrato é o da função')
  assert.deepEqual(gravado.outputJsonSchema, escolhida.outputSchema)
  assert.equal(toPublicAgent(gravado).contract.responseMode, 'structured')

  // --- 3. TESTAR sozinho, com JSON — o caminho do Playground -------------------------------
  let modeloChamado = 0
  const teste = await dispatchAgentExecution(
    gravado,
    { agentId: gravado._id, ownerId: OWNER, objective: 'resumir os valores', input: { values: VALORES } },
    {
      runLlm: async () => {
        modeloChamado += 1
        return { output: 'o modelo improvisaria isto', usage: { inputTokens: 50, outputTokens: 50 }, toolCalls: [] }
      },
    },
  )
  assert.equal(teste.ok, true, JSON.stringify(teste.error))
  assert.deepEqual(teste.structured.data, ESPERADO)
  assert.equal(modeloChamado, 0, 'testar uma função chamando o modelo testa outra coisa')
  assert.equal(teste.telemetry.inputTokens, undefined)
  assert.equal(teste.telemetry.outputTokens, undefined)
  // `structured`: dado, e nada de prosa. Não é omissão — é o modo escolhido.
  assert.equal(teste.text, undefined)

  // --- 4. PÔR NO SETOR e executar com a mesma entrada ---------------------------------------
  const chefe = await createAgent(OWNER, ANDAR, 'Coordenador', { preset: 'manager' })
  const setor = {
    _id: new ObjectId(),
    name: 'Mesa de dados',
    officeId: ANDAR,
    mode: 'orchestrated',
    coordinatorAgentId: chefe._id,
    instruction: '',
    members: [{ agentId: chefe._id, isDefault: true }, { agentId: agente._id }],
    stages: [],
  }

  const chamadasAoModelo = []
  const deps = {
    loadAgent: async (ownerId, id) =>
      ownerId === OWNER ? [chefe, gravado].find((a) => a._id.toString() === id.toString()) ?? null : null,
    loadSector: async () => setor,
    listAgentsInBuilding: async () => [chefe, gravado],
    buildingIdForFloor: async () => PREDIO.toString(),
    resolveTools: async () => [],
    apiKeyFor: async () => 'k',
    runTask: async (req) => {
      chamadasAoModelo.push(req)
      return { output: 'consolidado para quem perguntou', usage: { inputTokens: 6, outputTokens: 6 }, toolCalls: [] }
    },
    startDelegation: async () => new ObjectId(),
    finishDelegation: async () => undefined,
    recordEvent: () => undefined,
    // O plano liga o campo ao CONTEXTO do pedido — a metade estruturada da gramática.
    planWithModel: async () =>
      JSON.stringify({
        tasks: [
          {
            id: 's1',
            agentId: agente._id.toString(),
            objective: 'resumir a carteira',
            inputBindings: { values: '$context.portfolio_values' },
          },
        ],
      }),
  }

  const run = await executeSectorTeam(
    deps,
    sectorRunContext({ ownerId: OWNER, buildingId: PREDIO.toString(), correlationId: 'ciclo' }),
    setor,
    { objective: 'resuma a carteira', context: { portfolio_values: VALORES } },
  )

  assert.equal(
    run.warnings.filter((w) => /confere|insuficiente/.test(w)).length,
    0,
    `a etapa não podia ser recusada: ${JSON.stringify(run.warnings)}`,
  )
  // --- 5. o MESMO resultado, pelos dois caminhos ---------------------------------------------
  const entradaDaSintese = String(chamadasAoModelo[0]?.input ?? '')
  for (const [campo, valor] of Object.entries(ESPERADO)) {
    assert.match(entradaDaSintese, new RegExp(`"?${campo}"?\\s*:\\s*${valor}`), `${campo} precisa chegar à consolidação`)
  }
  // --- 6. e o custo: só a consolidação falou com o provedor ----------------------------------
  assert.equal(chamadasAoModelo.length, 1, 'a função não custou inferência nenhuma')
})

test('o mesmo agente, com entrada que não cumpre o contrato, é recusado antes de rodar', async () => {
  const { fields } = parseAgentModelFields({
    executorKind: 'function',
    executorConfig: { kind: 'function', functionName: 'math.summary' },
    responseMode: 'structured',
  })
  const agente = await createAgent(OWNER, ANDAR, 'Estrito', fields)
  const r = await dispatchAgentExecution(agente, {
    agentId: agente._id,
    ownerId: OWNER,
    objective: 'resumir',
    // `values` precisa ser lista de números.
    input: { values: 'doze, sete, trinta e um' },
  })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'invalid_input')
  assert.match(r.error.message, /values/, 'o diagnóstico diz QUAL campo')
})
