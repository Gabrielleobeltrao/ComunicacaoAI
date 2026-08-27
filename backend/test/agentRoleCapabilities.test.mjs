// PAPÉIS COM CAPACIDADES RÍGIDAS.
//
// O que estas provas fixam é que a separação não depende de prompt nem de tela: um papel
// que não pode uma capacidade não a recebe nem por interruptor, nem por configuração
// antiga, nem por caminho lateral. A personalização acontece DENTRO do papel.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  capabilitiesOf,
  roleAllows,
  capabilityCeiling,
  roleUIConfigOf,
  roleOf,
  CAPABILITIES,
} = await import('../dist/agentCapabilities.js')

const agente = (preset, extra = {}) => ({ preset, ...extra })

// --- o teto de cada papel ------------------------------------------------------------

test('quem COLETA pode olhar em todo lugar — e não aciona nada lá fora', () => {
  const c = capabilitiesOf(agente('researcher'))
  assert.equal(c.role, 'researcher')
  assert.equal(c.knowledge, true)
  assert.equal(c.webSources, true)
  assert.equal(c.realtime, true)
  // O ponto do papel: ele levanta fatos, não executa ações.
  assert.equal(c.externalTools, false)
  assert.equal(c.orchestrates, false)
})

test('quem ANALISA trabalha sobre o que recebeu, e não busca nada', () => {
  const c = capabilitiesOf(agente('analyst'))
  assert.equal(c.knowledge, false)
  assert.equal(c.webSources, false)
  assert.equal(c.webSearch, false)
  assert.equal(c.realtime, false)
  assert.equal(c.externalTools, false)
  assert.equal(c.orchestrates, false)
  assert.equal(c.needsInputs, true)
})

test('quem CONDUZ não pesquisa nem executa', () => {
  for (const preset of ['manager', 'secretary']) {
    const c = capabilitiesOf(agente(preset))
    assert.equal(c.role, 'coordinator')
    assert.equal(c.orchestrates, true)
    assert.equal(c.externalTools, false, `${preset}: coordenador com ferramenta usa a ferramenta`)
    assert.equal(c.knowledge, false)
    assert.equal(c.realtime, false)
    assert.equal(c.webSearch, false)
  }
})

test('quem EXECUTA aciona o que lhe foi concedido — e não pesquisa', () => {
  const c = capabilitiesOf(agente('operator'))
  assert.equal(c.role, 'executor')
  assert.equal(c.externalTools, true)
  assert.equal(c.knowledge, false, 'os dados vêm na instrução')
  assert.equal(c.webSources, false)
  assert.equal(c.webSearch, false)
  assert.equal(c.realtime, false)
  assert.equal(c.orchestrates, false)
  assert.equal(c.needsInputs, true)
})

test('quem COMUNICA escreve a partir do input, com ferramenta concedida', () => {
  const c = capabilitiesOf(agente('communicator'))
  assert.equal(c.role, 'communicator')
  assert.equal(c.externalTools, true)
  assert.equal(c.knowledge, false)
  assert.equal(c.webSearch, false)
  assert.equal(c.realtime, false)
  assert.equal(c.orchestrates, false)
  assert.equal(c.needsInputs, true)
})

// --- a brecha que foi fechada ------------------------------------------------------------

test('o interruptor de base NÃO devolve capacidade proibida — e o pedido fica visível', () => {
  // Era a brecha: `knowledgeEnabled: true` devolvia base e sites para QUALQUER papel.
  for (const preset of ['analyst', 'manager', 'operator', 'communicator']) {
    const c = capabilitiesOf(agente(preset, { knowledgeEnabled: true }))
    assert.equal(c.knowledge, false, `${preset} recuperou a base por interruptor`)
    assert.equal(c.webSources, false, `${preset} recuperou os sites por interruptor`)
    // Ignorado, e NÃO apagado em silêncio: a tela precisa poder dizer o que deixou de valer.
    assert.ok(c.legacyConflicts.includes('knowledge'), `${preset} não marcou o conflito`)
    assert.match(c.summary, /ignorado por não caber no papel/)
  }
})

test('dentro do papel, o interruptor continua mandando', () => {
  // Quem PODE ter base pode desligá-la…
  assert.equal(capabilitiesOf(agente('researcher', { knowledgeEnabled: false })).knowledge, false)
  // …e ligá-la de volta, sem conflito nenhum.
  const ligado = capabilitiesOf(agente('researcher', { knowledgeEnabled: true }))
  assert.equal(ligado.knowledge, true)
  assert.deepEqual(ligado.legacyConflicts, [])
})

test('busca na web é porta que se abre, e só para quem coleta', () => {
  assert.equal(capabilitiesOf(agente('researcher')).webSearch, false, 'sem o interruptor, fechada')
  assert.equal(capabilitiesOf(agente('researcher', { webSearch: { enabled: true } })).webSearch, true)
  // E para quem não coleta, nem com o interruptor.
  for (const preset of ['analyst', 'manager', 'operator', 'communicator']) {
    const c = capabilitiesOf(agente(preset, { webSearch: { enabled: true } }))
    assert.equal(c.webSearch, false, `${preset} ganhou busca na web`)
    assert.ok(c.legacyConflicts.includes('webSearch'))
  }
})

test('nenhuma capacidade escapa do teto do papel, venha por onde vier', () => {
  // A varredura completa: para todo papel e toda capacidade, ligar à mão o que o papel
  // não permite não pode funcionar.
  // `custom` fica de fora de propósito: ele é a ausência de preset, e o teto dele é
  // aberto — é justamente o papel onde o dono declara tudo.
  for (const preset of ['researcher', 'analyst', 'manager', 'operator', 'communicator']) {
    const papel = roleOf(preset)
    for (const cap of CAPABILITIES) {
      const c = capabilitiesOf(agente(preset, { capabilityOverrides: { [cap]: true } }))
      if (!roleAllows(papel, cap)) {
        assert.equal(c[cap], false, `${preset}: ${cap} passou pelo teto`)
        assert.ok(c.legacyConflicts.includes(cap), `${preset}: ${cap} não foi marcado`)
      }
    }
  }
})

test('personalizado é a AUSÊNCIA de preset: teto aberto, escolha explícita', () => {
  const c = capabilitiesOf(agente('custom'))
  assert.equal(c.role, 'custom')
  // O que ele sempre teve ligado continua ligado — um agente montado à mão não perde
  // o que o dono configurou porque uma versão nova decidiu que ele "é" outra coisa.
  assert.equal(c.knowledge, true)
  assert.equal(c.webSources, true)
  assert.equal(c.externalTools, true)
  // E o que se ABRE continua fechado até alguém abrir.
  assert.equal(c.webSearch, false)
  assert.equal(c.realtime, false)
  assert.deepEqual(c.legacyConflicts, [], 'nada é incompatível: o teto é dele')

  // Cada capacidade é escolha declarada — nos dois sentidos.
  assert.equal(capabilitiesOf(agente('custom', { capabilityOverrides: { externalTools: false } })).externalTools, false)
  assert.equal(capabilitiesOf(agente('custom', { webSearch: { enabled: true } })).webSearch, true)
})

// --- a tela deriva da mesma matriz ---------------------------------------------------------

test('a tela não desenha controle de capacidade proibida', () => {
  const analista = roleUIConfigOf({ preset: 'analyst' })
  assert.equal(analista.allowedKnowledge, false)
  assert.equal(analista.allowedWeb, false)
  assert.equal(analista.allowedWebSearch, false)
  assert.equal(analista.allowedRealtime, false)
  assert.equal(analista.allowedTools, false)
  assert.ok(!analista.sections.includes('conhecimento'))
  assert.ok(!analista.sections.includes('web'))
  assert.ok(!analista.sections.includes('busca-web'))
  assert.ok(!analista.sections.includes('ferramentas'))

  const coordenador = roleUIConfigOf({ preset: 'manager' })
  assert.ok(!coordenador.sections.includes('ferramentas'))
  assert.ok(coordenador.sections.includes('orquestracao'))

  const executor = roleUIConfigOf({ preset: 'operator' })
  assert.ok(executor.sections.includes('ferramentas'))
  assert.ok(!executor.sections.includes('conhecimento'), 'executor não tem bloco de base')
  assert.ok(!executor.sections.includes('busca-web'))

  const pesquisador = roleUIConfigOf({ preset: 'researcher' })
  assert.ok(pesquisador.sections.includes('conhecimento'))
  assert.ok(pesquisador.sections.includes('busca-web'))
  assert.equal(pesquisador.allowedRealtime, true)
  assert.equal(pesquisador.allowedTools, false, 'quem coleta não aciona')
})

test('o interruptor incompatível não traz o bloco de volta para a tela', () => {
  // O outro lado da mesma brecha: a tela desenhava um controle que o motor ignoraria.
  const c = roleUIConfigOf({ preset: 'analyst', knowledgeEnabled: true })
  assert.ok(!c.sections.includes('conhecimento'))
  assert.equal(c.allowedKnowledge, false)
  assert.ok(c.legacyConflicts.includes('knowledge'), 'mas a tela sabe o que foi ignorado')
})

test('o teto é consultável por papel — é dele que todo guarda pergunta', () => {
  assert.equal(roleAllows('researcher', 'webSearch'), true)
  assert.equal(roleAllows('executor', 'webSearch'), false)
  assert.equal(roleAllows('coordinator', 'externalTools'), false)
  assert.equal(roleAllows('executor', 'externalTools'), true)
  assert.equal(roleAllows('analyst', 'realtime'), false)
  assert.deepEqual(Object.keys(capabilityCeiling('analyst')).sort(), [...CAPABILITIES].sort())
})

// --- os guards de RUNTIME ---------------------------------------------------------------
// A matriz acima é a regra; o que segue prova que ela é APLICADA. Uma separação que
// existisse só no prompt ou na tela seria uma sugestão, não uma garantia.

const { validatePlan, capacidadeExigida, membroPode } = await import('../dist/sectorPlanner.js')

test('o planejador não manda pesquisar para quem não pesquisa', () => {
  const membros = [
    { agentId: 'a1', name: 'Analista', type: 'analyst' },
    { agentId: 'a2', name: 'Pesquisador', type: 'researcher' },
  ]
  const plano = validatePlan(
    { tasks: [{ id: 'x', agentId: 'a1', objective: 'pesquisar os concorrentes no mercado' }] },
    membros,
    'pergunta',
  )
  // Reatribuída a quem pode, e não descartada: o trabalho continua sendo necessário.
  assert.equal(plano.tasks.length, 1)
  assert.equal(plano.tasks[0].agentId, 'a2')
})

test('sem ninguém capaz, a etapa vira PENDÊNCIA declarada — não improviso', () => {
  const membros = [{ agentId: 'a1', name: 'Analista', type: 'analyst' }]
  const plano = validatePlan({ tasks: [{ id: 'x', agentId: 'a1', objective: 'enviar o e-mail para o cliente' }] }, membros, 'pergunta')
  assert.equal(plano.tasks.length, 0, 'não atribui a quem não pode')
  assert.equal(plano.pendencies?.length, 1)
  assert.equal(plano.pendencies[0].missing, 'externalTools')
  assert.match(plano.pendencies[0].reason, /nenhum agente/)
})

test('a exigência é lida do que a etapa pede', () => {
  assert.equal(capacidadeExigida('pesquisar os concorrentes'), 'webSearch')
  assert.equal(capacidadeExigida('enviar e-mail para o cliente'), 'externalTools')
  assert.equal(capacidadeExigida('montar o plano e definir dependências'), 'orchestrates')
  // Conservador de propósito: na dúvida, não exige nada.
  assert.equal(capacidadeExigida('comparar as evidências recebidas'), null)
  assert.equal(capacidadeExigida('resumir o texto'), null)
})

test('quem pode o quê, do ponto de vista do planejador', () => {
  assert.equal(membroPode({ agentId: 'x', name: 'p', type: 'researcher' }, 'webSearch'), true)
  assert.equal(membroPode({ agentId: 'x', name: 'a', type: 'analyst' }, 'webSearch'), false)
  assert.equal(membroPode({ agentId: 'x', name: 'e', type: 'executor' }, 'externalTools'), true)
  assert.equal(membroPode({ agentId: 'x', name: 'c', type: 'coordinator' }, 'externalTools'), false)
})

test('quem CONDUZ continua fora das tarefas operacionais', () => {
  const membros = [
    { agentId: 'c1', name: 'Gerente', type: 'coordinator' },
    { agentId: 'e1', name: 'Operador', type: 'executor' },
  ]
  const plano = validatePlan({ tasks: [{ id: 'x', agentId: 'c1', objective: 'redigir a resposta' }] }, membros, 'pergunta')
  // O trabalho continua sendo necessário — o que não pode é ser DELE. Quem conduz
  // conduz; quem executa recebe a tarefa.
  assert.ok(plano.tasks.every((t) => t.agentId !== 'c1'), 'o coordenador virou executor de tarefa')
})
