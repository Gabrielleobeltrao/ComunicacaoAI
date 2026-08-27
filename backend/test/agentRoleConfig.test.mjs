// Cada TIPO de agente é uma coisa diferente — na tela e no motor, pela mesma regra.
//
// O defeito que estes testes existem para impedir tem duas caras, e as duas já
// aconteceram: a tela esconde um campo que o motor ainda lê (o dono não configura, e o
// comportamento acontece assim mesmo), ou a tela oferece um campo que o motor ignora (o
// dono configura uma coisa e vê outra). Por isso a tela e o runtime derivam da MESMA
// matriz, e é essa derivação que se prova aqui.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { capabilitiesOf, roleUIConfigOf, roleOf } = await import('../dist/agentCapabilities.js')
const { validatePlan, fallbackPlan } = await import('../dist/sectorPlanner.js')

const cfg = (preset, extra = {}) => roleUIConfigOf({ preset, ...extra })

// --- 1) quem CONDUZ não vê nem recebe -------------------------------------------------------

test('1) coordenador: sem base, sem site, sem app, sem ferramenta HTTP', () => {
  for (const preset of ['manager', 'secretary']) {
    const c = cfg(preset)
    assert.equal(c.role, 'coordinator', preset)
    assert.equal(c.allowedKnowledge, false, preset)
    assert.equal(c.allowedWeb, false, preset)
    assert.equal(c.allowedTools, false, preset)
    assert.equal(c.allowedApps, false, preset)
    // E nada disso aparece na tela: a seção simplesmente não existe.
    for (const secao of ['conhecimento', 'web', 'ferramentas', 'entrada']) {
      assert.ok(!c.sections.includes(secao), `${preset} não deveria desenhar "${secao}"`)
    }
    // O que ele TEM: orquestração e roteamento.
    assert.deepEqual(c.sections, ['definicao', 'orquestracao', 'roteamento'], preset)
    // A memória operacional também não: quem só conduz não tem operação para lembrar.
    assert.equal(capabilitiesOf({ preset }).memory, false, preset)
  }
})

// --- 2) quem ANALISA trabalha sobre o que recebe ---------------------------------------------

test('2) analista: não consulta base própria nem aciona ferramenta', () => {
  const c = cfg('analyst')
  assert.equal(c.allowedKnowledge, false)
  assert.equal(c.allowedWeb, false)
  assert.equal(c.allowedTools, false)
  assert.ok(!c.sections.includes('conhecimento'))
  assert.ok(!c.sections.includes('ferramentas'))
  // O que ele tem no lugar: o que espera RECEBER, e em que forma entrega a conclusão.
  assert.ok(c.sections.includes('entrada'))
  assert.ok(c.sections.includes('entrega'))
  assert.equal(capabilitiesOf({ preset: 'analyst' }).needsInputs, true)
})

// --- 3) quem COLETA mantém tudo o que serve para coletar --------------------------------------

test('3) pesquisador: base, sites e ferramentas de consulta continuam', () => {
  for (const preset of ['researcher', 'monitor']) {
    const c = cfg(preset)
    assert.equal(c.role, 'researcher', preset)
    assert.equal(c.allowedKnowledge, true, preset)
    assert.equal(c.allowedWeb, true, preset)
    // Quem coleta NÃO aciona: levantar fatos e agir sobre o mundo são papéis diferentes.
    assert.equal(c.allowedTools, false, preset)
    assert.equal(c.allowedRealtime, true, preset)
    for (const secao of ['conhecimento', 'web', 'busca-web', 'entrega', 'roteamento']) {
      assert.ok(c.sections.includes(secao), `${preset} precisa de "${secao}"`)
    }
    assert.ok(!c.sections.includes('ferramentas'), `${preset} não desenha ferramenta de execução`)
  }
})

// --- 4) quem EXECUTA recebe ferramenta ---------------------------------------------------------

test('4) executor e comunicador: ferramentas e o que precisam receber para agir', () => {
  for (const [preset, papel] of [['operator', 'executor'], ['communicator', 'communicator'], ['custom', 'custom']]) {
    const c = cfg(preset)
    assert.equal(c.role, papel, preset)
    assert.equal(c.allowedTools, true, preset)
    assert.equal(c.allowedApps, true, preset)
    assert.ok(c.sections.includes('ferramentas'), preset)
    assert.ok(c.sections.includes('entrada'), preset)
  }
  // E nenhum dos dois pesquisa: os dados vêm na instrução.
  for (const preset of ['operator', 'communicator']) {
    const c = cfg(preset)
    assert.equal(c.allowedKnowledge, false, preset)
    assert.equal(c.allowedWebSearch, false, preset)
    assert.equal(c.allowedRealtime, false, preset)
  }
})

// --- 5) o plano não manda trabalho para quem conduz --------------------------------------------

const membro = (id, type, nome, extra = {}) => ({ agentId: id, name: nome, type, ...extra })

test('5) a tarefa que precisa de ferramenta vai para quem TEM a ferramenta', () => {
  const equipe = [
    membro('a1', 'coordinator', 'Gerente'),
    membro('a2', 'executor', 'Executor', { tools: ['enviar_email'] }),
    membro('a3', 'researcher', 'Pesquisador', { knowledgeTitles: ['Tabela de preços'] }),
  ]
  // Mesmo quando o modelo pede explicitamente pelo coordenador — e ele pede.
  const plano = validatePlan(
    { tasks: [{ id: 'x', agentId: 'a1', objective: 'enviar o email de cobrança' }] },
    equipe,
    'enviar o email de cobrança',
  )
  assert.ok(
    plano.tasks.every((t) => t.agentId !== 'a1'),
    'um coordenador dentro do plano é a equipe inteira parada esperando por quem também esperava',
  )
  assert.equal(plano.tasks[0].agentId, 'a2', 'quem tem a ferramenta com o nome do pedido')
})

test('5b) sem modelo, o determinístico também não escolhe quem conduz', () => {
  const equipe = [membro('a1', 'coordinator', 'Gerente'), membro('a2', 'executor', 'Executor')]
  const plano = fallbackPlan('qualquer pedido', equipe)
  assert.ok(plano.tasks.length > 0)
  assert.ok(plano.tasks.every((t) => t.agentId !== 'a1'))
})

test('5c) equipe só de coordenadores: alguém precisa trabalhar', () => {
  // Não é o caso comum, mas devolver plano vazio faria o coordenador responder sozinho —
  // exatamente o que a regra existe para evitar.
  const plano = fallbackPlan('pedido', [membro('a1', 'coordinator', 'Gerente A'), membro('a2', 'coordinator', 'Gerente B')])
  assert.equal(plano.tasks.length, 1)
})

// --- 6) trocar o tipo muda a tela E o motor ----------------------------------------------------

test('6) trocar o tipo muda o que ele pode fazer, na mesma hora', () => {
  const antes = cfg('researcher')
  const depois = cfg('manager')
  assert.notDeepEqual(antes.sections, depois.sections)
  assert.equal(antes.allowedKnowledge, true)
  assert.equal(depois.allowedKnowledge, false)
  // E a regra que a tela lê é a MESMA que o runtime lê.
  assert.equal(depois.allowedKnowledge, capabilitiesOf({ preset: 'manager' }).knowledge)
  assert.equal(depois.allowedTools, capabilitiesOf({ preset: 'manager' }).externalTools)
})

// --- 7) o que já estava configurado não quebra -------------------------------------------------

test('7) configuração antiga carrega: sem preset, sem campo novo, nada explode', () => {
  const legado = cfg(undefined)
  assert.equal(legado.role, 'custom', 'sem tipo declarado, mantém tudo — tirar capacidade quebraria quem funciona')
  assert.equal(legado.allowedKnowledge, true)
  assert.equal(legado.allowedTools, true)
  assert.equal(roleOf(undefined), 'custom')
  // Um preset que não existe mais no código também não derruba a leitura do agente.
  assert.equal(cfg('perfil_que_nao_existe').role, 'custom')
})

test('7b) o override incompatível NÃO traz o bloco de volta — nem na tela, nem no motor', () => {
  // Os dois lados da mesma brecha, fechados juntos: o motor ignora, e a tela não
  // desenha um controle que o motor ignoraria.
  const ligado = cfg('analyst', { knowledgeEnabled: true })
  assert.equal(ligado.allowedKnowledge, false)
  assert.ok(!ligado.sections.includes('conhecimento'))
  assert.ok(!ligado.sections.includes('web'))
  assert.ok(ligado.legacyConflicts.includes('knowledge'), 'mas a tela sabe o que foi ignorado')

  const desligado = cfg('researcher', { knowledgeEnabled: false })
  assert.equal(desligado.allowedKnowledge, false)
  assert.ok(!desligado.sections.includes('conhecimento'))
  // Desligar a base não mexe no resto do que o papel permite — e o pesquisador nunca
  // teve ferramenta de execução para perder.
  assert.equal(desligado.allowedWebSearch, true, 'a porta continua disponível para ser aberta')
  assert.deepEqual(desligado.legacyConflicts, [], 'desligar o que se pode ter não é conflito')
})

// --- 8) o roteamento vale para todos -----------------------------------------------------------

test('8) "quando chamar este agente" existe em todo papel', () => {
  for (const preset of ['researcher', 'analyst', 'manager', 'secretary', 'operator', 'communicator', 'monitor', 'custom']) {
    assert.ok(cfg(preset).sections.includes('roteamento'), `${preset} precisa poder dizer quando ser chamado`)
    assert.ok(cfg(preset).sections.includes('definicao'), `${preset} precisa da própria definição`)
  }
})

test('o id do agente não muda nada disto: a regra é do TIPO', () => {
  const a = roleUIConfigOf({ preset: 'analyst', _id: new ObjectId() })
  const b = roleUIConfigOf({ preset: 'analyst' })
  assert.deepEqual(a.sections, b.sections)
})
