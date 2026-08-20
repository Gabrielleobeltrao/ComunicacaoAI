// O que cada TIPO de agente faz — e o que ele não faz.
//
// O preset era só texto inicial: um analista nascia com uma frase sobre analisar e, no
// resto, era idêntico a um pesquisador. Isto aqui é a diferença virando comportamento.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { ROLE_LABEL, capabilitiesOf, roleOf } = await import('../dist/agentCapabilities.js')

test('quem coleta usa base e sites; quem analisa, não', () => {
  assert.equal(capabilitiesOf({ preset: 'researcher' }).knowledge, true)
  assert.equal(capabilitiesOf({ preset: 'researcher' }).webSources, true)
  // O ponto do tipo: analisar o que RECEBE. Buscar base própria aqui é o caminho curto
  // para uma análise isolada sobre o que o próprio agente guardou.
  assert.equal(capabilitiesOf({ preset: 'analyst' }).knowledge, false)
  assert.equal(capabilitiesOf({ preset: 'analyst' }).webSources, false)
  assert.equal(capabilitiesOf({ preset: 'analyst' }).needsInputs, true)
})

test('quem conduz não tem base operacional própria', () => {
  for (const preset of ['manager', 'secretary']) {
    assert.equal(capabilitiesOf({ preset }).knowledge, false, preset)
    assert.equal(capabilitiesOf({ preset }).orchestrates, true, preset)
  }
})

test('quem executa mantém base: ferramenta é o principal, mas o dono pode dar uma base', () => {
  assert.equal(capabilitiesOf({ preset: 'operator' }).knowledge, true)
  // E o perfil personalizado não perde nada: sem declaração, tirar capacidade quebraria
  // agentes que já funcionam.
  assert.equal(capabilitiesOf({ preset: 'custom' }).knowledge, true)
  assert.equal(capabilitiesOf({}).knowledge, true, 'agente antigo, sem preset')
})

test('a escolha explícita do dono manda sobre o tipo', () => {
  const analista = { preset: 'analyst', knowledgeEnabled: true }
  assert.equal(capabilitiesOf(analista).knowledge, true)
  assert.match(capabilitiesOf(analista).summary, /ligada manualmente/)

  const pesquisador = { preset: 'researcher', knowledgeEnabled: false }
  assert.equal(capabilitiesOf(pesquisador).knowledge, false)
  assert.match(capabilitiesOf(pesquisador).summary, /desligada manualmente/)
})

test('cada preset tem um papel, e cada papel tem um nome legível', () => {
  assert.equal(roleOf('researcher'), 'researcher')
  assert.equal(roleOf('monitor'), 'researcher')
  assert.equal(roleOf('analyst'), 'analyst')
  assert.equal(roleOf('manager'), 'coordinator')
  assert.equal(roleOf('operator'), 'executor')
  assert.equal(roleOf(undefined), 'executor', 'agente antigo cai no papel mais permissivo')
  assert.deepEqual(Object.keys(ROLE_LABEL).sort(), ['analyst', 'coordinator', 'executor', 'researcher'])
})
