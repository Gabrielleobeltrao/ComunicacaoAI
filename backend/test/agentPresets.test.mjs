// Pure tests for the agent preset catalog (Phase 2).
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'
const { AGENT_PRESET_SPECS, presetSpec, suggestPresetForCapability } = await import('../dist/agentPresets.js')
const { AGENT_PRESETS } = await import('../dist/agents.js')

test('every AgentPreset has exactly one spec', () => {
  assert.equal(AGENT_PRESET_SPECS.length, AGENT_PRESETS.length)
  for (const p of AGENT_PRESETS) assert.ok(AGENT_PRESET_SPECS.some((s) => s.preset === p), `missing spec for ${p}`)
})

test('researcher is reachable by agents via callerPolicy (not agent_only); manager is manual+scheduled', () => {
  const r = presetSpec('researcher')
  // Being callable by a manager is a PERMISSION now, not a fake trigger.
  assert.ok(!r.activationModes.includes('agent_only'))
  assert.equal(r.callerPolicy, 'all')
  assert.equal(r.delegationPolicy, 'none') // a researcher does not coordinate
  assert.ok(r.capabilities.includes('pesquisa'))
  assert.deepEqual(presetSpec('manager').activationModes, ['manual', 'scheduled'])
})

test('presetSpec falls back to custom for an unknown preset', () => {
  assert.equal(presetSpec('boss').preset, 'custom')
})

test('suggestPresetForCapability maps hints to presets (default researcher)', () => {
  assert.equal(suggestPresetForCapability('pesquisa política na web'), 'researcher')
  assert.equal(suggestPresetForCapability('analisar os dados de vendas'), 'analyst')
  assert.equal(suggestPresetForCapability('enviar um e-mail de resumo'), 'communicator')
  assert.equal(suggestPresetForCapability('executar ação na API do estoque'), 'operator')
  assert.equal(suggestPresetForCapability('orquestrar a equipe'), 'manager')
  assert.equal(suggestPresetForCapability('monitorar o site e alertar mudanças'), 'monitor')
  assert.equal(suggestPresetForCapability('algo totalmente desconhecido'), 'researcher')
})
