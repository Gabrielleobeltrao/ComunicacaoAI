// A SEGUNDA LEITURA: auxiliar de verdade — nunca bloqueia, nunca edita, nunca derruba.
//
// Sem banco: o que se confere aqui é o contrato da função. O cache por hash e o
// descarte da leitura obsoleta são conferidos na integração, contra o Mongo.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.NODE_ENV = 'test'
// Os módulos de conta/uso alcançam o db no import; nada aqui conecta.
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/critico-llm-test'
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { buildCritiquePrompt, describeForCritique } = await import('../dist/architect/criticLlm.js')
const { normalizeLlmFindings } = await import('../dist/architect/critic.js')

const BP = {
  version: 1,
  title: 'Atendimento',
  objective: 'atender',
  floors: [{ key: 'andar', action: 'create', name: 'Atendimento', workMode: 'organization' }],
  agents: [
    { key: 'marina', action: 'create', floorKey: 'andar', name: 'Marina', preset: 'manager', delegationPolicy: 'floor', objective: 'receber e distribuir' },
    { key: 'rafael', action: 'create', floorKey: 'andar', name: 'Rafael', preset: 'analyst', objective: 'analisar' },
  ],
  sectors: [{ key: 'mesa', action: 'create', floorKey: 'andar', name: 'Mesa', mode: 'orchestrated', memberAgentKeys: ['marina', 'rafael'], coordinatorAgentKey: 'marina' }],
  routines: [],
  appRequirements: [{ key: 'canal', appKey: 'web_chat', reason: 'receber', required: true, actionKeys: [], agentKeys: ['marina'] }],
  knowledgeRequirements: [],
  assumptions: [],
  warnings: [],
  checklist: [],
}

test('o modelo lê a proposta em português, não o JSON dela', () => {
  const texto = describeForCritique(BP)
  assert.match(texto, /Marina/)
  assert.match(texto, /coordenador: Marina/, 'a chave é traduzida para o nome de quem lê')
  assert.match(texto, /web_chat/)
  assert.doesNotMatch(texto, /"action"|"version"/, 'JSON no prompt convida o modelo a devolver JSON de blueprint')
})

test('o prompt PROÍBE reescrever a proposta', () => {
  const p = buildCritiquePrompt(BP)
  assert.match(p, /nada de reescrever a proposta/i)
  assert.match(p, /findings/)
  // As chaves vão junto: é como o achado aponta para um agente sem precisar do nome.
  assert.match(p, /\[marina\]/)
})

test('o que o modelo devolve NUNCA é erro — só aviso', () => {
  const achados = normalizeLlmFindings(
    [{ code: 'x', message: 'm', fix: 'f', severity: 'error', agentKey: 'marina' }],
    BP,
  )
  assert.equal(achados.length, 1)
  assert.equal(achados[0].severity, 'warning', 'opinião de modelo não pode travar a aplicação')
  assert.equal(achados[0].source, 'llm')
})

test('achado sobre agente que não existe é descartado', () => {
  assert.deepEqual(normalizeLlmFindings([{ code: 'x', message: 'm', fix: 'f', agentKey: 'ninguem' }], BP), [])
})

test('patch vindo do crítico é ignorado: ele não tem como editar o desenho', () => {
  const achados = normalizeLlmFindings(
    [{ code: 'x', message: 'm', fix: 'f', blueprintPatch: { agents: [] }, action: 'remove_agent' }],
    BP,
  )
  assert.equal(achados.length, 1)
  assert.deepEqual(Object.keys(achados[0]).sort(), ['code', 'evidence', 'fix', 'message', 'severity', 'source'])
})
