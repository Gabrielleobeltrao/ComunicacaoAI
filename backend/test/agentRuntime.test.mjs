// Generic agent runtime tests. A fake replyFn is injected, so no provider SDK,
// no network and no MongoDB are touched (agentRuntime imports only types from
// llm.js). Covers: attendance-free objective, structured output, limits, timeout
// and typed errors (plan §9 / §21.1).
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { buildTaskObjective, parseJsonOutput, executeAgentTask, AgentRunError } = await import('../dist/agentRuntime.js')

const reply = (text, extra = {}) => async (...args) => ({
  text,
  usage: { inputTokens: 1, outputTokens: 2 },
  toolCalls: [],
  __args: args,
  ...extra,
})

test('buildTaskObjective carries no visitor/attendance language and adds directives', () => {
  const obj = buildTaskObjective({
    objective: 'Você é um pesquisador',
    instructions: 'Faça um resumo',
    context: ['fonte externa X'],
    output: { format: 'json' },
  })
  assert.doesNotMatch(obj.toLowerCase(), /visitante|atendimento|handoff/)
  assert.match(obj, /JSON/)
  assert.match(obj, /NÃO CONFIÁVEL/) // untrusted-content marker when context is present
})

test('executeAgentTask passes empty attendance instructions and no memory', async () => {
  let captured
  const fake = async (...args) => {
    captured = args
    return { text: 'hello', usage: { inputTokens: 1, outputTokens: 2 }, toolCalls: [] }
  }
  const r = await executeAgentTask({ objective: 'Pesquisador', instructions: 'Resuma', context: ['fonte X'] }, fake)
  assert.equal(r.output, 'hello')
  // [objective, knowledge, memory, history, provider, model, apiKey, identity, guardrail, responseStyle, caching, tools]
  assert.equal(captured[2], '') // memory
  assert.equal(captured[7], '') // identity
  assert.equal(captured[8], '') // guardrail
  assert.equal(captured[9], '') // response style
  assert.deepEqual(captured[1], ['fonte X']) // knowledge = context
})

test('json output is parsed and returned', async () => {
  const r = await executeAgentTask({ objective: 'o', instructions: 'i', output: { format: 'json' } }, reply('{"a":1}'))
  assert.deepEqual(r.json, { a: 1 })
})

test('invalid json raises a validation error', async () => {
  await assert.rejects(
    executeAgentTask({ objective: 'o', instructions: 'i', output: { format: 'json' } }, reply('not json')),
    (e) => e instanceof AgentRunError && e.kind === 'validation',
  )
})

test('maxOutputChars truncates the output', async () => {
  const r = await executeAgentTask({ objective: 'o', instructions: 'i', limits: { maxOutputChars: 10 } }, reply('x'.repeat(100)))
  assert.equal(r.output.length, 10)
})

test('timeout produces a typed timeout error', async () => {
  const slow = () => new Promise((res) => setTimeout(() => res({ text: 'late', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [] }), 60))
  await assert.rejects(
    executeAgentTask({ objective: 'o', instructions: 'i', limits: { timeoutMs: 10 } }, slow),
    (e) => e instanceof AgentRunError && e.kind === 'timeout',
  )
})

test('parseJsonOutput tolerates code fences', () => {
  assert.deepEqual(parseJsonOutput('```json\n{"b":2}\n```'), { b: 2 })
})
