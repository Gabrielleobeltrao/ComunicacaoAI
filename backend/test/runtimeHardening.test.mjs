// Regressions for the last production pass on the autonomous runtime. Each block is
// one defect that would be expensive in production and invisible in a demo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/runtime-hardening-test'
process.env.ENCRYPTION_KEY ||= 'test-encryption-key'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { executeAgentTask } = await import('../dist/agentRuntime.js')
const { legacyToolToExecutable, resolveHttpTool, runResolvedTool } = await import('../dist/agentTools.js')
const { executeToolCall } = await import('../dist/toolExecution.js')
const { buildDelegationTools, checkStageOutput, rootContext } = await import('../dist/delegation.js')
const { formatContextWithSources } = await import('../dist/retrievalQuery.js')
const { toPublicAgent, MASKED_HEADER_VALUE } = await import('../dist/agents.js')

// --- 1. the JSON repair must not be able to DO anything ------------------------------

test('the repair round-trip runs with NO tools — a POST is never repeated', async () => {
  let posts = 0
  const postTool = {
    name: 'criar_pedido',
    description: 'Cria um pedido',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => ((posts += 1), { ok: true, result: 'criado' }),
  }

  const toolsSeen = []
  let call = 0
  const reply = async (_objective, _knowledge, _memory, _history, _p, _m, _k, _i, _g, _s, _c, tools) => {
    call += 1
    toolsSeen.push(tools)
    // The first call really uses the tool, then answers with invalid JSON.
    if (call === 1) {
      await postTool.run({})
      return { text: 'não é json', usage: { inputTokens: 10, outputTokens: 5 }, toolCalls: [{ name: 'criar_pedido', arguments: {}, ok: true, result: 'criado' }] }
    }
    return { text: '{"titulo":"ok"}', usage: { inputTokens: 3, outputTokens: 2 }, toolCalls: [] }
  }

  const result = await executeAgentTask(
    { objective: 'faça', instructions: 'faça', tools: [postTool], output: { format: 'json' } },
    reply,
  )

  assert.equal(call, 2, 'exactly one correction')
  assert.equal(posts, 1, 'the POST happened once — the repair could not repeat it')
  assert.deepEqual(toolsSeen[0].map((t) => t.name), ['criar_pedido'], 'the first call had the tool')
  assert.deepEqual(toolsSeen[1], [], 'the repair call had none at all')
  // Tokens of BOTH calls are charged; the tool calls are the original execution's.
  assert.deepEqual(result.usage, { inputTokens: 13, outputTokens: 7 })
  assert.equal(result.toolCalls.length, 1)
  assert.equal(result.toolCalls[0].name, 'criar_pedido')
  assert.equal(result.format.repaired, true)
})

// --- 2. the delegation tools declare what they really accept -------------------------

const AGENT_ID = new ObjectId().toString()
const SECTOR_ID = new ObjectId().toString()

function delegationTools(over = {}) {
  const ctx = rootContext({
    ownerId: 'o1',
    buildingId: new ObjectId().toString(),
    agent: { _id: new ObjectId(), delegationPolicy: 'all', callerPolicy: 'all' },
    correlationId: 'c1',
  })
  const deps = {
    loadAgent: async () => null,
    loadSector: async () => null,
    listAgentsInBuilding: async () => [],
    buildingIdForFloor: async () => ctx.buildingId,
    resolveTools: async () => [],
    apiKeyFor: async () => 'k',
    runTask: async () => ({ output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
    startDelegation: async () => new ObjectId(),
    finishDelegation: async () => undefined,
    ...over,
  }
  return buildDelegationTools(ctx, deps)
}

// Everything below goes through runResolvedTool — the dispatcher both providers use.
const dispatch = (tools, name, args) => runResolvedTool(tools, name, args)

test('delegate_to_agent accepts an OBJECT input through the real dispatcher', async () => {
  const tools = delegationTools()
  const out = await dispatch(tools, 'delegate_to_agent', { agentId: AGENT_ID, objective: 'resuma', input: { pedido: 'A-1', itens: [1, 2] } })
  // It gets past validation (the target does not exist in this fixture, which is a
  // different failure — what matters is that the ARGUMENTS were accepted).
  assert.ok(!out.result.includes('invalid_arguments'), out.result)
})

test('an ARRAY input is accepted too', async () => {
  const out = await dispatch(delegationTools(), 'delegate_to_agent', { agentId: AGENT_ID, objective: 'resuma', input: [1, 2, 3] })
  assert.ok(!out.result.includes('invalid_arguments'), out.result)
})

test('a plain string input still works', async () => {
  const out = await dispatch(delegationTools(), 'delegate_to_agent', { agentId: AGENT_ID, objective: 'resuma', input: 'texto simples' })
  assert.ok(!out.result.includes('invalid_arguments'), out.result)
})

test('format is declared, and only the three values are accepted', async () => {
  const tools = delegationTools()
  const agentTool = tools.find((t) => t.name === 'delegate_to_agent')
  assert.deepEqual(agentTool.inputSchema.properties.format.enum, ['text', 'markdown', 'json'])
  assert.equal(agentTool.inputSchema.additionalProperties, false)

  for (const format of ['text', 'markdown', 'json']) {
    const ok = await dispatch(tools, 'delegate_to_agent', { agentId: AGENT_ID, objective: 'x', format })
    assert.ok(!ok.result.includes('invalid_arguments'), `${format} should be accepted`)
  }
  const bad = await dispatch(tools, 'delegate_to_agent', { agentId: AGENT_ID, objective: 'x', format: 'yaml' })
  assert.equal(bad.ok, false)
  assert.equal(JSON.parse(bad.result).status, 'invalid_arguments')
})

test('an unknown field is still refused by the dispatcher', async () => {
  const out = await dispatch(delegationTools(), 'delegate_to_agent', { agentId: AGENT_ID, objective: 'x', inventado: true })
  assert.equal(out.ok, false)
  assert.equal(JSON.parse(out.result).status, 'invalid_arguments')
})

test('delegate_to_sector declares the same contract', async () => {
  const tools = delegationTools()
  const sectorTool = tools.find((t) => t.name === 'delegate_to_sector')
  assert.deepEqual(sectorTool.inputSchema.properties.format.enum, ['text', 'markdown', 'json'])
  assert.equal(sectorTool.inputSchema.additionalProperties, false)
  const out = await dispatch(tools, 'delegate_to_sector', { sectorId: SECTOR_ID, objective: 'x', input: { a: 1 } })
  assert.ok(!out.result.includes('invalid_arguments'), out.result)
})

// --- 3. requireGrounding applies to delegation too ------------------------------------

const FLOOR = new ObjectId()
const targetAgent = (over = {}) => ({
  _id: new ObjectId(),
  ownerId: 'o1',
  officeId: FLOOR,
  name: 'Alvo',
  objective: 'objetivo',
  provider: 'anthropic',
  model: null,
  preset: 'custom',
  delegationPolicy: 'all',
  callerPolicy: 'all',
  callableAgentIds: [],
  allowedCallerAgentIds: [],
  inputContract: '',
  outputContract: '',
  ...over,
})

async function delegateTo(target, retrieveContext) {
  const caller = targetAgent()
  const ctx = rootContext({ ownerId: 'o1', buildingId: 'B', agent: caller, correlationId: 'c1' })
  let ran = false
  const tools = buildDelegationTools(ctx, {
    loadAgent: async (_o, id) => (id.toString() === target._id.toString() ? target : caller),
    loadSector: async () => null,
    listAgentsInBuilding: async () => [caller, target],
    buildingIdForFloor: async () => 'B',
    resolveTools: async () => [],
    apiKeyFor: async () => 'k',
    runTask: async () => ((ran = true), { output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
    startDelegation: async () => new ObjectId(),
    finishDelegation: async () => undefined,
    retrieveContext,
  })
  const out = await dispatch(tools, 'delegate_to_agent', { agentId: target._id.toString(), objective: 'resuma isso' })
  return { out, ran }
}

test('a delegated agent that requires grounding does not run when the base failed', async () => {
  const { out, ran } = await delegateTo(targetAgent({ requireGrounding: true }), async () => ({ context: [], sources: [], status: 'unavailable', failed: true }))
  assert.equal(ran, false, 'no inference was paid for')
  const parsed = JSON.parse(out.result)
  assert.equal(parsed.status, 'knowledge_unavailable')
  assert.equal(parsed.grounding, 'unavailable', 'which of the three problems it was')
  assert.match(parsed.reason, /não pôde ser consultada/)
})

test('"found nothing" and "no base" are reported as themselves, not as a failure', async () => {
  for (const [status, expected] of [
    ['empty', /nenhum trecho relevante/i],
    ['no_base', /não tem base/i],
  ]) {
    const { out, ran } = await delegateTo(targetAgent({ requireGrounding: true }), async () => ({ context: [], sources: [], status, failed: false }))
    assert.equal(ran, false)
    const parsed = JSON.parse(out.result)
    assert.equal(parsed.grounding, status)
    assert.match(parsed.reason, expected)
  }
})

test('with grounding found, the delegation runs and can cite its sources', async () => {
  const caller = targetAgent()
  const target = targetAgent({ requireGrounding: true })
  const ctx = rootContext({ ownerId: 'o1', buildingId: 'B', agent: caller, correlationId: 'c1' })
  let request = null
  const tools = buildDelegationTools(ctx, {
    loadAgent: async (_o, id) => (id.toString() === target._id.toString() ? target : caller),
    loadSector: async () => null,
    listAgentsInBuilding: async () => [caller, target],
    buildingIdForFloor: async () => 'B',
    resolveTools: async () => [],
    apiKeyFor: async () => 'k',
    runTask: async (req) => ((request = req), { output: 'ok', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }),
    startDelegation: async () => new ObjectId(),
    finishDelegation: async () => undefined,
    retrieveContext: async () => ({ context: ['Trocas em até 30 dias.'], sources: [{ documentId: 'doc-1', title: 'Política de trocas' }], status: 'ok', failed: false }),
  })
  const out = await dispatch(tools, 'delegate_to_agent', { agentId: target._id.toString(), objective: 'qual a política?' })
  assert.equal(out.ok, true)
  assert.match(request.context[0], /\[1\] Política de trocas · doc doc-1/)
  assert.match(request.context[0], /Trocas em até 30 dias/)
})

test('an agent without the flag still answers when the base is unavailable', async () => {
  const { out, ran } = await delegateTo(targetAgent(), async () => ({ context: [], sources: [], status: 'unavailable', failed: true }))
  assert.equal(ran, true, 'the default is unchanged')
  assert.equal(JSON.parse(out.result).status, 'ok')
})

// --- 4. no legacy header value ever escapes -------------------------------------------

const withServer = async (handler, run) => {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, resolve))
  try {
    return await run(server.address().port)
  } finally {
    server.close()
  }
}

const SECRET = 'chave-super-secreta-123'

test('a header with an UNUSUAL name is masked in the detail and redacted from the echo', async () => {
  await withServer(
    (req, res) => {
      // An API that echoes what it received — the classic way a secret comes back.
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ recebido: req.headers['x-minha-chave'], ok: true }))
    },
    async (port) => {
      const tool = {
        name: 'consultar',
        description: 'Consulta',
        method: 'GET',
        url: `http://127.0.0.1:${port}/`,
        // Nothing in this name matches the sensitive-header heuristic.
        headers: [{ key: 'X-Minha-Chave', value: SECRET }],
        parameters: [],
      }
      const outcome = await executeToolCall(legacyToolToExecutable(tool), {}, { autonomous: true, allHeadersAreSecret: true })
      assert.equal(outcome.ok, true)
      // Not in what the model reads…
      assert.ok(!outcome.result.includes(SECRET), 'the echoed response must not carry it')
      // …nor in the request detail the UI and the run log show.
      assert.equal(outcome.detail.request.headers['X-Minha-Chave'], '***')
      assert.ok(!JSON.stringify(outcome.detail).includes(SECRET))

      // And through the resolved tool the model actually calls.
      const viaTool = await resolveHttpTool(tool).run({})
      assert.ok(!viaTool.result.includes(SECRET))
    },
  )
})

test('a legacy secret is not in the error path either', async () => {
  const tool = {
    name: 'consultar',
    description: 'Consulta',
    method: 'GET',
    // A host that will not resolve: the failure message quotes the URL.
    url: 'https://nao-existe.invalido.exemplo/',
    headers: [{ key: 'X-Assinatura', value: SECRET }],
    parameters: [],
  }
  const outcome = await executeToolCall(legacyToolToExecutable(tool), {}, { autonomous: true, allHeadersAreSecret: true })
  assert.equal(outcome.ok, false)
  assert.ok(!outcome.result.includes(SECRET))
  assert.ok(!JSON.stringify(outcome.detail).includes(SECRET))
})

test('the API never returns a legacy header value', () => {
  const agent = { name: 'Ana', tools: [{ name: 't', description: 'd', method: 'GET', url: 'https://x.com', headers: [{ key: 'X-Minha-Chave', value: SECRET }], parameters: [] }] }
  const publicAgent = toPublicAgent(agent)
  assert.equal(publicAgent.tools[0].headers[0].value, MASKED_HEADER_VALUE)
  assert.ok(!JSON.stringify(publicAgent).includes(SECRET))
  // The original document is untouched — masking is on the way OUT only.
  assert.equal(agent.tools[0].headers[0].value, SECRET)
})

test('a legacy WRITE stays blocked and points at the safe alternative', async () => {
  const out = await resolveHttpTool({ name: 'criar', description: 'Cria', method: 'POST', url: 'https://api.exemplo.com/', headers: [], parameters: [] }).run({})
  assert.equal(out.ok, false)
  const parsed = JSON.parse(out.result)
  assert.equal(parsed.reason, 'autonomous_execution_not_authorized')
  assert.match(parsed.detail, /Custom Tool/, 'the owner is told how to do it safely')
})

// --- 5. provenance the model can cite --------------------------------------------------

test('context passages are numbered and carry title + document id', () => {
  const out = formatContextWithSources(
    ['Trocas em até 30 dias.', 'Frete grátis acima de R$ 200.'],
    [
      { documentId: 'doc-1', title: 'Política de trocas' },
      { documentId: 'doc-2', title: 'Frete' },
    ],
  )
  assert.match(out[0], /^\[1\] Política de trocas · doc doc-1\n/)
  assert.match(out[1], /^\[2\] Frete · doc doc-2\n/)
  assert.match(out[0], /Trocas em até 30 dias/)
})

test('a passage with no provenance is still numbered', () => {
  const out = formatContextWithSources(['sem origem'], [])
  assert.equal(out[0], '[1]\nsem origem')
})

test('the owner is never named to the model', () => {
  const out = formatContextWithSources(['trecho'], [{ documentId: 'doc-1', title: 'T', ownerId: 'owner-secreto', ownerType: 'agent' }])
  assert.ok(!out[0].includes('owner-secreto'))
})

test('a long title is cut, and newlines cannot break the reference line', () => {
  const out = formatContextWithSources(['x'], [{ documentId: 'd', title: `${'t'.repeat(400)}\ncom quebra` }])
  const [reference] = out[0].split('\n')
  assert.ok(reference.length < 200)
  assert.ok(!reference.includes('\n'))
})

// --- 6. a stage hand-off is checked for what it claims ---------------------------------

test('an empty hand-off is refused whatever the contract', () => {
  assert.equal(checkStageOutput('   ', {}).ok, false)
  assert.equal(checkStageOutput('algum texto', {}).ok, true)
})

test('a JSON stage is checked STRUCTURALLY, not just for being non-empty', () => {
  const target = { defaultOutputFormat: 'json', outputJsonSchema: { type: 'object', properties: { total: { type: 'number' } }, required: ['total'] } }
  assert.equal(checkStageOutput('isso não é json', target).ok, false)
  const wrongShape = checkStageOutput('{"outra":"coisa"}', target)
  assert.equal(wrongShape.ok, false)
  assert.match(wrongShape.problem, /não cumpre o contrato/)
  assert.equal(checkStageOutput('{"total":10}', target).ok, true)
  // Fenced JSON from a chatty model still passes.
  assert.equal(checkStageOutput('```json\n{"total":10}\n```', target).ok, true)
})

test('a JSON stage without a schema only has to parse', () => {
  const target = { defaultOutputFormat: 'json' }
  assert.equal(checkStageOutput('{"qualquer":"coisa"}', target).ok, true)
  assert.equal(checkStageOutput('prosa', target).ok, false)
})

test('a text stage is only checked for emptiness — and nothing claims more', () => {
  // expectedOutput is prose; there is no deterministic way to verify it was honoured,
  // and the code does not pretend to.
  const target = { defaultOutputFormat: 'markdown' }
  assert.equal(checkStageOutput('qualquer coisa que o modelo escreveu', target).ok, true)
})

test('the explicit stage format wins over the agent default', () => {
  const target = { defaultOutputFormat: 'markdown', outputJsonSchema: null }
  assert.equal(checkStageOutput('prosa', target, 'json').ok, false, 'asked for JSON, checked as JSON')
})
