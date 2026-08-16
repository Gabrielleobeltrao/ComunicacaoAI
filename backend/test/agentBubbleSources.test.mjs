// Which bubble states the runtime can ACTUALLY emit.
//
// The enum has 18 states. That is the vocabulary the map can draw, not a promise
// that all 18 happen. A state with no verifiable transition behind it must never be
// emitted — inferring one from the preset, the schedule or the text the model wrote
// would put a bubble on the map that describes nothing that happened.
//
// This test reads the source and pins the split. It fails when someone starts
// emitting a state without a real event, and equally when a state gains a real
// source and this list is not updated to say so.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = new URL('../src/', import.meta.url).pathname

function sources(dir = SRC, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // The seeding script exists to DEMO the bubbles; it is not the runtime.
      if (entry !== 'scripts') sources(full, acc)
    } else if (entry.endsWith('.ts')) {
      acc.push(full)
    }
  }
  return acc
}

const files = sources().filter((f) => !f.endsWith('agentLiveState.ts'))
// Comments are stripped first: a line explaining why a state is NOT emitted has to
// name it, and that must not read as an emission.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const code = files.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n')

// A state is "emitted" when the runtime NAMES it as a literal. Terminals arrive
// through a variable (`finish(canceled ? 'canceled' : 'failed')`), so matching the
// call shape would miss them; what matters is whether any runtime file mentions the
// state at all. For the dormant list that is exactly the question — nobody mentions
// it, so nobody can be emitting it.
const emitted = (state) => new RegExp(`['\`]${state}['\`]`).test(code)

// Has a real transition behind it today.
const WITH_SOURCE = [
  'queued', // runService, when the run is accepted
  'thinking', // agentRuntime, before inference and after each tool returns
  'reading_knowledge', // routineExecution, when a knowledge query runs
  'using_tool', // instrumentTools, wrapping every tool call
  'validating_output', // agentRuntime, when the output schema is checked
  'retrying', // agentRuntime, on a real retry
  'delivering', // runProcessor, when the answer goes to a channel
  'blocked', // routineExecution, on a refusal
  'completed',
  'failed',
  'canceled',
]

// In the enum and drawable, but nothing in the runtime observes them yet. The plan
// is explicit: instrument only when there is a verifiable event, never infer.
const DORMANT = ['researching', 'waiting_external', 'waiting_input', 'responding', 'generating_output']

test('todo estado que o runtime emite tem uma transição real por trás', () => {
  for (const state of WITH_SOURCE) {
    assert.ok(emitted(state), `"${state}" está na lista de estados com fonte, mas nada no runtime o emite`)
  }
})

test('estado sem fonte verificável não é emitido por ninguém', () => {
  for (const state of DORMANT) {
    assert.ok(
      !emitted(state),
      `"${state}" foi emitido sem evento correspondente. Se agora existe um evento real, mova-o para WITH_SOURCE e diga qual é.`,
    )
  }
})

test('a delegação emite os dois estados de delegação', () => {
  assert.ok(emitted('delegating_agent') || /delegating_agent/.test(code))
  assert.ok(emitted('delegating_sector') || /delegating_sector/.test(code))
})

test('o enum e as duas listas cobrem exatamente os mesmos estados', () => {
  // Lido da fonte para não precisar de banco: o enum é a declaração do contrato.
  const enumSrc = readFileSync(join(SRC, 'agentLiveState.ts'), 'utf8')
  // Cuidado com o `[]` da anotação de tipo: o corte é no `= [`.
  const block = enumSrc.split('export const AGENT_BUBBLE_STATES')[1].split('= [')[1].split(']')[0]
  const inEnum = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  const declared = [...WITH_SOURCE, ...DORMANT, 'delegating_agent', 'delegating_sector'].sort()
  // Se alguém adicionar um estado ao enum, tem que dizer aqui se ele tem fonte real.
  assert.deepEqual(inEnum, declared)
})
