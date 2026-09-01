// O ENSAIO da operação, antes de ela existir.
//
// A pergunta que nenhuma validação responde: quando chegar uma mensagem, quem atende? E
// quando o pedido for de reembolso, alguém aprova? O desenho pode estar inteiro e ainda
// deixar um caminho sem dono — e isso só aparece quando um cliente real esbarra nele.
//
// A garantia que mais importa aqui é a ausência de efeito: nenhuma chamada sai, nenhuma
// mensagem é enviada, nada é cobrado. Uma simulação que executa de verdade não é ensaio,
// é estreia com o público dentro.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { buildCases, simulateCase, runSimulation } = await import('../dist/architect/simulate.js')
const { emptyBrief, applyBriefPatch } = await import('../dist/architect/brief.js')
const { emptyBlueprint } = await import('../dist/architect/blueprint.js')

const manifesto = {
  apps: [
    { key: 'web_chat', name: 'Chat Web', connected: true, actions: [{ key: 'reply', name: 'Responder', risk: 'write' }] },
    { key: 'stripe', name: 'Stripe', connected: true, actions: [{ key: 'refund', name: 'Reembolsar', risk: 'high_risk' }] },
    { key: 'nuvemshop', name: 'Nuvemshop', connected: false, actions: [{ key: 'get_order', name: 'Consultar', risk: 'read' }] },
  ],
  presets: [], functions: [], channels: [], tools: [], executorKinds: [], sectorModes: [], activationModes: [], knowledgeScopes: [], version: 1,
}

const brief = applyBriefPatch(emptyBrief(), {
  businessGoal: 'atender clientes',
  jobs: [
    { id: 'duvida', name: 'Responder dúvida', trigger: 'mensagem', input: 'pergunta do cliente', decision: 'qual resposta', action: 'responder', output: 'resposta' },
    { id: 'reembolso', name: 'Reembolsar', trigger: 'pedido', input: 'nota', decision: 'se cabe', action: 'reembolsar', output: 'confirmação', risk: 'high', requiresHumanApproval: true },
  ],
  humanApprovals: [{ action: 'Reembolsar', rule: 'o dono aprova' }],
})

const bp = (over = {}) => ({
  ...emptyBlueprint('Op', 'objetivo'),
  floors: [{ key: 'andar', action: 'create', name: 'Atendimento', workMode: 'organization' }],
  agents: [
    { key: 'marina', action: 'create', floorKey: 'andar', name: 'Marina', preset: 'communicator', objective: 'Responder dúvida do cliente', role: 'quando chega mensagem', handoffEnabled: true },
  ],
  appRequirements: [{ key: 'canal', appKey: 'web_chat', reason: 'canal', required: true, actionKeys: ['reply'], agentKeys: ['marina'] }],
  ...over,
})

// --- os cenários ------------------------------------------------------------------------------

test('de 3 a 8 cenários, derivados do Brief', () => {
  const casos = buildCases(brief)
  assert.ok(casos.length >= 3 && casos.length <= 8, `veio ${casos.length}`)
  // Cada trabalho vira um cenário...
  assert.ok(casos.some((c) => c.id === 'job:duvida'))
  // ...e a operação ganha o caso que descobre buraco: algo que ninguém previu.
  assert.ok(casos.some((c) => c.id === 'fora-do-previsto'))
  // Trabalho de risco carrega a expectativa de parar para alguém aprovar.
  assert.equal(casos.find((c) => c.id === 'job:reembolso').expectsApproval, true)
})

// --- nenhum efeito ------------------------------------------------------------------------------

test('a ferramenta é chamada em DUBLÊ: a intenção é registrada, a ação não acontece', () => {
  const caso = buildCases(brief).find((c) => c.id === 'job:duvida')
  const r = simulateCase(caso, bp(), manifesto)
  const chamada = r.steps.find((s) => s.kind === 'tool')
  assert.ok(chamada, 'o passo da ferramenta aparece no caminho')
  assert.match(chamada.detail, /dublê/)
  assert.deepEqual(r.sideEffectsAvoided, ['web_chat.reply'])
})

test('nada no resultado indica execução real', () => {
  const run = runSimulation(brief, bp(), manifesto, 1)
  const texto = JSON.stringify(run)
  // O ensaio registra a INTENÇÃO. Se algum dia alguém ligar a execução aqui, este teste
  // é o que percebe.
  assert.doesNotMatch(texto, /"executed"|"sent"|"charged"|"published"/)
  for (const r of run.results) {
    assert.ok(Array.isArray(r.sideEffectsAvoided))
  }
})

// --- rota esperada versus observada --------------------------------------------------------------

test('o caminho observado começa em quem recebe e passa por quem resolve', () => {
  const comSetor = bp({
    agents: [
      { key: 'bruno', action: 'create', floorKey: 'andar', name: 'Bruno', preset: 'manager', objective: 'Coordenar', delegationPolicy: 'floor', handoffEnabled: true },
      { key: 'marina', action: 'create', floorKey: 'andar', name: 'Marina', preset: 'communicator', objective: 'Responder dúvida do cliente', role: 'dúvidas', handoffEnabled: true },
    ],
    sectors: [{ key: 's', action: 'create', floorKey: 'andar', name: 'Mesa', mode: 'orchestrated', memberAgentKeys: ['bruno', 'marina'], coordinatorAgentKey: 'bruno' }],
    appRequirements: [{ key: 'canal', appKey: 'web_chat', reason: 'canal', required: true, actionKeys: ['reply'], agentKeys: ['bruno'] }],
  })
  const caso = buildCases(brief).find((c) => c.id === 'job:duvida')
  const r = simulateCase(caso, comSetor, manifesto)
  assert.deepEqual(r.observedRoute, ['Bruno', 'Marina'])
  assert.equal(r.matchedExpected, true)
})

test('operação sem agente nenhum não tem por onde entrar', () => {
  const r = simulateCase(buildCases(brief)[0], bp({ agents: [], appRequirements: [] }), manifesto)
  assert.equal(r.problems[0].code, 'no_entry_point')
  assert.equal(r.matchedExpected, false)
})

// --- o que o ensaio descobre ------------------------------------------------------------------

test('App não conectado interrompe o caminho — e isso vira problema, não silêncio', () => {
  const comPendencia = bp({
    appRequirements: [{ key: 'pedidos', appKey: 'nuvemshop', reason: 'consultar', required: true, actionKeys: ['get_order'], agentKeys: ['marina'] }],
  })
  const r = simulateCase(buildCases(brief)[0], comPendencia, manifesto)
  assert.ok(r.problems.some((p) => p.code === 'app_not_connected'))
  assert.ok(r.steps.some((s) => s.kind === 'dead_end'))
})

test('ação sensível sem aprovação aparece no cenário que não a esperava', () => {
  const comReembolso = bp({
    appRequirements: [{ key: 'r', appKey: 'stripe', reason: 'reembolso', required: true, actionKeys: ['refund'], agentKeys: ['marina'] }],
  })
  const caso = buildCases(brief).find((c) => c.id === 'job:duvida') // não espera aprovação
  const r = simulateCase(caso, comReembolso, manifesto)
  assert.ok(r.problems.some((p) => p.code === 'unapproved_sensitive_action'))
})

test('cenário que exige aprovação para em alguém — ou é reportado', () => {
  const caso = buildCases(brief).find((c) => c.id === 'job:reembolso')

  const comHandoff = simulateCase(caso, bp(), manifesto)
  assert.ok(comHandoff.steps.some((s) => s.kind === 'approval' && /para e espera/.test(s.detail)))

  const semHandoff = simulateCase(
    caso,
    bp({ agents: [{ key: 'marina', action: 'create', floorKey: 'andar', name: 'Marina', preset: 'operator', objective: 'Reembolsar', handoffEnabled: false }] }),
    manifesto,
  )
  assert.ok(semHandoff.problems.some((p) => p.code === 'missing_approval'))
})

test('conhecimento pendente aparece como problema do caminho', () => {
  const b = bp({
    knowledgeRequirements: [{ key: 'k', scope: 'agent', targetKey: 'marina', title: 'Cardápio', description: '', required: true, expectedSource: 'upload', state: 'missing' }],
  })
  const r = simulateCase(buildCases(brief)[0], b, manifesto)
  assert.ok(r.problems.some((p) => p.code === 'missing_knowledge' && /Cardápio/.test(p.message)))
})

// --- a corrida inteira, versionada ---------------------------------------------------------------

test('a corrida é versionada e conta quantos cenários passaram', () => {
  const run = runSimulation(brief, bp(), manifesto, 3, new Date(0))
  assert.equal(run.version, 3)
  assert.equal(run.createdAt, new Date(0).toISOString())
  // Sem relógio, não há carimbo: é o que mantém a prévia idêntica a si mesma entre
  // duas leituras — e é sobre a prévia que a confirmação carrega o hash.
  assert.equal(runSimulation(brief, bp(), manifesto, 3).createdAt, undefined)
  assert.equal(run.results.length, run.cases.length)
  assert.ok(run.passed >= 0 && run.passed <= run.results.length)
  // Determinística: a mesma proposta ensaia igual, e duas revisões dão para comparar.
  assert.deepEqual(runSimulation(brief, bp(), manifesto, 3, new Date(0)), run)
})

// --- compatibilidade: o projeto que não tem Brief ------------------------------------------

test('sem trabalhos no Brief, os cenários saem do DESENHO', () => {
  // É o caso dos projetos anteriores ao Brief e o da proposta pedida direto. Eles têm
  // agentes com responsabilidade declarada, e cada uma é um caminho a ensaiar — sem
  // isto, ficariam com um cenário só, e um ensaio de um cenário não descobre nada.
  const semBrief = emptyBrief()
  const desenho = bp({
    agents: [
      { key: 'marina', action: 'create', floorKey: 'andar', name: 'Marina', preset: 'communicator', objective: 'Responder dúvidas do cardápio', handoffEnabled: true },
      { key: 'rafael', action: 'create', floorKey: 'andar', name: 'Rafael', preset: 'researcher', objective: 'Buscar na base o que responde', handoffEnabled: true },
    ],
  })
  const casos = buildCases(semBrief, desenho)
  assert.ok(casos.length >= 3, `veio ${casos.length}`)
  assert.ok(casos.some((c) => c.id === 'agent:marina'))
  assert.ok(casos.some((c) => c.id === 'fora-do-previsto'))
  // A operação tem App: existe um cenário em que alguém deveria aprovar, mesmo que
  // ninguém tenha escrito a regra.
  assert.ok(casos.some((c) => c.expectsApproval))
})
