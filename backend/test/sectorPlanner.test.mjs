// Quem trabalha nesta pergunta — decidido antes de alguém trabalhar.
//
// O modo orquestrado dependia de o coordenador resolver, no meio da resposta, chamar
// alguém. Um modelo que recebe uma pergunta respondível responde: a equipe existia e um
// agente só trabalhava. O plano transforma essa decisão num passo declarado, e é aqui
// que se prova que ele escolhe pouco e escolhe certo.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const {
  MAX_ORCHESTRATION_ROUNDS,
  MAX_TASKS,
  MAX_TASKS_TOTAL,
  ORCHESTRATION_TIMEOUT_MS,
  assembleWithoutModel,
  buildSynthesisContext,
  dedupeAgainst,
  describePlan,
  fallbackPlan,
  inputFromDependencies,
  limitationNote,
  memberScore,
  parsePlanJson,
  parseSufficiency,
  planExecution,
  planPrompt,
  readyTasks,
  shouldRun,
  taskKey,
  validatePlan,
} = await import('../dist/sectorPlanner.js')

// Uma equipe genérica de propósito: o motor não pode ter regra de assunto nenhum.
const JURIDICO = {
  agentId: 'a-juridico',
  name: 'Jurídico',
  routingDescription: 'quando envolver contrato, cláusula ou risco jurídico',
  role: 'analisa contratos',
  capabilities: ['contratos', 'compliance'],
  knowledgeTitles: ['Modelo de contrato de prestação'],
}
const FINANCEIRO = {
  agentId: 'a-financeiro',
  name: 'Financeiro',
  routingDescription: 'quando envolver custo, orçamento ou pagamento',
  role: 'cuida do orçamento',
  capabilities: ['orcamento', 'faturamento'],
  knowledgeTitles: ['Tabela de custos 2026'],
}
const COZINHA = {
  agentId: 'a-cozinha',
  name: 'Cozinha',
  routingDescription: 'quando for sobre o cardápio ou o preparo dos pratos',
  role: 'cuida do cardápio',
  capabilities: ['cardapio', 'estoque'],
}
const EQUIPE = [JURIDICO, FINANCEIRO, COZINHA]

const responde = (obj) => async () => JSON.stringify(obj)

// --- selecionar pouco, e certo -------------------------------------------------------------

test('pergunta de um assunto só seleciona um agente só', async () => {
  const { plan } = await planExecution({
    question: 'essa cláusula de rescisão do contrato é um risco para a gente?',
    members: EQUIPE,
    ask: responde({ tasks: [{ id: 't1', agentId: 'a-juridico', objective: 'avaliar a cláusula de rescisão' }] }),
  })
  assert.equal(plan.tasks.length, 1)
  assert.equal(plan.tasks[0].agentId, 'a-juridico')
  assert.match(plan.tasks[0].objective, /rescisão/)
})

test('pergunta que atravessa dois assuntos seleciona os dois', async () => {
  const { plan } = await planExecution({
    question: 'qual o risco jurídico da cláusula e quanto isso custaria no orçamento?',
    members: EQUIPE,
    ask: responde({
      tasks: [
        { id: 'x', agentId: 'a-juridico', objective: 'avaliar o risco da cláusula' },
        { id: 'y', agentId: 'a-financeiro', objective: 'estimar o custo', dependsOn: ['x'] },
      ],
      synthesisObjective: 'risco e custo numa resposta só',
    }),
  })
  assert.deepEqual(plan.tasks.map((t) => t.agentId), ['a-juridico', 'a-financeiro'])
  // A dependência sobrevive, renomeada para os ids do plano.
  assert.deepEqual(plan.tasks[1].dependsOn, ['t1'])
  assert.equal(plan.synthesisObjective, 'risco e custo numa resposta só')
})

test('quem não tem nada a ver com o pedido fica de fora', async () => {
  const { plan } = await planExecution({
    question: 'qual o risco jurídico da cláusula e quanto isso custaria?',
    members: EQUIPE,
    ask: responde({
      tasks: [
        { id: 't1', agentId: 'a-juridico', objective: 'risco' },
        { id: 't2', agentId: 'a-financeiro', objective: 'custo' },
      ],
    }),
  })
  assert.ok(!plan.tasks.some((t) => t.agentId === 'a-cozinha'), 'a cozinha não tem nada com isso')
})

// --- o que o modelo devolve é sugestão, não comando ---------------------------------------

test('agente que não é membro do setor não entra no plano', () => {
  const plan = validatePlan(
    { tasks: [{ id: 't1', agentId: 'a-de-outro-setor', objective: 'x' }, { id: 't2', agentId: 'a-juridico', objective: 'y' }] },
    EQUIPE,
    'pergunta',
  )
  assert.deepEqual(plan.tasks.map((t) => t.agentId), ['a-juridico'])
})

test('o mesmo agente duas vezes é uma vez só', () => {
  const plan = validatePlan(
    { tasks: [{ id: 't1', agentId: 'a-juridico', objective: 'a' }, { id: 't2', agentId: 'a-juridico', objective: 'b' }] },
    EQUIPE,
    'pergunta',
  )
  assert.equal(plan.tasks.length, 1)
})

test('dependência circular ou para o futuro é descartada, não executada', () => {
  const plan = validatePlan(
    {
      tasks: [
        { id: 'a', agentId: 'a-juridico', objective: 'x', dependsOn: ['b'] },
        { id: 'b', agentId: 'a-financeiro', objective: 'y', dependsOn: ['a'] },
      ],
    },
    EQUIPE,
    'pergunta',
  )
  // A primeira não pode esperar pela segunda: isso é um ciclo escrito de outro jeito.
  assert.equal(plan.tasks[0].dependsOn, undefined)
  assert.deepEqual(plan.tasks[1].dependsOn, ['t1'])
})

test('o plano tem teto: cobertura suficiente, não exaustiva', () => {
  const muitos = Array.from({ length: 10 }, (_, i) => ({ agentId: `a${i}`, name: `Agente ${i}` }))
  const plan = validatePlan({ tasks: muitos.map((m, i) => ({ id: `t${i}`, agentId: m.agentId, objective: 'x' })) }, muitos, 'p')
  assert.equal(plan.tasks.length, MAX_TASKS)
})

test('objetivo vazio vira o pedido original, e não uma tarefa sem sentido', () => {
  const plan = validatePlan({ tasks: [{ id: 't1', agentId: 'a-juridico', objective: '   ' }] }, EQUIPE, 'o pedido inteiro')
  assert.equal(plan.tasks[0].objective, 'o pedido inteiro')
})

// --- sem modelo, e quando o modelo falha ---------------------------------------------------

test('sem modelo o plano sai determinístico, e continua escolhendo por afinidade', async () => {
  const { plan, source } = await planExecution({ question: 'quanto custa o orçamento deste mês?', members: EQUIPE })
  assert.equal(source, 'fallback')
  assert.equal(plan.tasks.length, 1)
  assert.equal(plan.tasks[0].agentId, 'a-financeiro')
})

test('modelo que devolve lixo não derruba nada', async () => {
  const { plan, source } = await planExecution({
    question: 'contrato e cláusula',
    members: EQUIPE,
    ask: async () => 'desculpa, não entendi',
  })
  assert.equal(source, 'fallback')
  assert.ok(plan.tasks.length >= 1)
})

test('modelo que explode não derruba nada', async () => {
  const { plan } = await planExecution({
    question: 'cardápio de hoje',
    members: EQUIPE,
    ask: async () => {
      throw new Error('provider caiu')
    },
  })
  assert.equal(plan.tasks[0].agentId, 'a-cozinha')
})

test('pergunta que não casa com ninguém aciona UM, não todos', async () => {
  const { plan } = await planExecution({ question: 'xpto zzz', members: EQUIPE })
  assert.equal(plan.tasks.length, 1)
})

test('sem equipe não há plano', async () => {
  const { plan, source } = await planExecution({ question: 'qualquer coisa', members: [] })
  assert.deepEqual(plan.tasks, [])
  assert.equal(source, 'empty')
})

// --- a nota, o prompt e o log ---------------------------------------------------------------

test('a nota olha o perfil inteiro do membro, não só o nome', () => {
  assert.ok(memberScore('preciso revisar uma cláusula de contrato', JURIDICO) > 0)
  assert.equal(memberScore('preciso revisar uma cláusula de contrato', COZINHA), 0)
})

test('o prompt leva id, função e base de cada membro — e proíbe responder', () => {
  const p = planPrompt('pergunta qualquer', EQUIPE)
  assert.match(p, /Não responda ao pedido/)
  assert.match(p, /a-juridico/)
  assert.match(p, /Tabela de custos 2026/, 'o TÍTULO da base ajuda a escolher quem tem o dado')
  assert.match(p, /COBERTURA, não chamar todos/)
})

test('o JSON é lido mesmo vindo com cerca de código e conversa em volta', () => {
  const lido = parsePlanJson('claro!\n```json\n{"tasks":[{"id":"t1","agentId":"a","objective":"o"}]}\n```\nespero ter ajudado')
  assert.equal(lido.tasks.length, 1)
})

test('o log do plano tem nomes, ids e objetivo — e nada mais', () => {
  const plan = { tasks: [{ id: 't1', agentId: 'a-juridico', objective: 'avaliar a cláusula' }] }
  const linha = describePlan(plan, EQUIPE)
  assert.match(linha, /t1=Jurídico\(a-juridico\)/)
  assert.match(linha, /avaliar a cláusula/)
})

test('o plano determinístico nunca inventa agente', () => {
  const plan = fallbackPlan('qualquer coisa', EQUIPE)
  for (const t of plan.tasks) assert.ok(EQUIPE.some((m) => m.agentId === t.agentId))
})

// --- limites, repetição e suficiência --------------------------------------------------------
//
// Um motor que decide sozinho quando parar precisa de um lugar onde a decisão não seja
// dele. É este.

test('os limites são pequenos, e existem', () => {
  assert.equal(MAX_ORCHESTRATION_ROUNDS, 2)
  assert.equal(MAX_TASKS, 4)
  assert.equal(MAX_TASKS_TOTAL, 6)
  assert.ok(ORCHESTRATION_TIMEOUT_MS > 0 && ORCHESTRATION_TIMEOUT_MS <= 600_000)
})

test('a mesma tarefa é a mesma: agente + objetivo, sem se importar com espaço ou caixa', () => {
  assert.equal(taskKey('a1', 'Buscar  o Contrato'), taskKey('a1', 'buscar o contrato'))
  assert.notEqual(taskKey('a1', 'buscar o contrato'), taskKey('a2', 'buscar o contrato'))
  // Outro pedido ao mesmo agente é trabalho novo, não repetição.
  assert.notEqual(taskKey('a1', 'buscar o contrato'), taskKey('a1', 'resumir o contrato'))
})

test('o que já foi feito não volta, e o teto total é respeitado', () => {
  const plano = {
    tasks: [
      { id: 't1', agentId: 'a1', objective: 'x' },
      { id: 't2', agentId: 'a2', objective: 'y' },
      { id: 't3', agentId: 'a3', objective: 'z', dependsOn: ['t1'] },
    ],
  }
  const feitas = new Set([taskKey('a1', 'x')])
  const cortado = dedupeAgainst(plano, feitas, 5)
  assert.deepEqual(cortado.tasks.map((t) => t.agentId), ['a2', 'a3'])
  // A dependência que apontava para a tarefa removida some: esperar por algo que não vem
  // é travar de propósito.
  assert.equal(cortado.tasks[1].dependsOn, undefined)
  // E o teto total corta o resto.
  assert.equal(dedupeAgainst(plano, new Set(), 1).tasks.length, 1)
})

test('suficiência ilegível é tratada como suficiente', () => {
  // Uma rodada extra por causa de um parse ruim custa uma equipe inteira de inferências.
  assert.deepEqual(parseSufficiency('sei lá'), { sufficient: true })
  assert.deepEqual(parseSufficiency('{"sufficient":true}'), { sufficient: true })
  const falta = parseSufficiency('{"sufficient":false,"missing":"os números de julho"}')
  assert.equal(falta.sufficient, false)
  assert.equal(falta.missing, 'os números de julho')
})

test('a limitação é dita com o que faltou, e proíbe preencher com suposição', () => {
  const nota = limitationNote('os números de julho', 2)
  assert.match(nota, /2 rodada/)
  assert.match(nota, /os números de julho/)
  assert.match(nota, /não preencha a lacuna com suposição/i)
})

test('a montagem sem modelo entrega o trabalho com o nome de quem fez', () => {
  const texto = assembleWithoutModel([
    { taskId: 't1', agentId: 'a', agentName: 'Agente A', objective: 'o', dependsOn: [], status: 'succeeded', output: 'achei isto', durationMs: 1 },
    { taskId: 't2', agentId: 'b', agentName: 'Agente B', objective: 'o', dependsOn: [], status: 'failed', error: 'falha', durationMs: 1 },
  ])
  assert.match(texto, /Agente A/)
  assert.match(texto, /achei isto/)
  assert.ok(!texto.includes('Agente B'), 'quem falhou não tem resultado para montar')
  assert.match(texto, /não foi possível consolidar/i)
  // Sem nada que tenha dado certo, não há montagem nenhuma.
  assert.equal(assembleWithoutModel([]), '')
})

test('a síntese recebe cada resultado rotulado, e a falha aparece como falha', () => {
  const plano = { tasks: [{ id: 't1', agentId: 'a', objective: 'parte A' }, { id: 't2', agentId: 'b', objective: 'parte B' }] }
  const texto = buildSynthesisContext('a pergunta original', plano, [
    { taskId: 't1', agentId: 'a', agentName: 'Agente A', objective: 'parte A', dependsOn: [], status: 'succeeded', output: 'resultado A', durationMs: 1 },
    { taskId: 't2', agentId: 'b', agentName: 'Agente B', objective: 'parte B', dependsOn: [], status: 'failed', error: 'tempo esgotado', durationMs: 1 },
  ])
  assert.match(texto, /ORIGINAL USER QUESTION\na pergunta original/)
  assert.match(texto, /EXECUTION PLAN/)
  assert.match(texto, /\[Agente A\]\nobjective: parte A\nresult:\nresultado A/)
  assert.match(texto, /\[Agente B\][\s\S]*FALHOU \(tempo esgotado\)/)
  assert.match(texto, /SYNTHESIS INSTRUCTIONS/)
  assert.match(texto, /contradiz/i)
})

test('uma tarefa cujas dependências falharam TODAS não roda', () => {
  const task = { id: 't3', agentId: 'c', objective: 'junta', dependsOn: ['t1', 't2'] }
  const falhou = (id) => [id, { taskId: id, agentId: 'x', agentName: 'X', objective: 'o', dependsOn: [], status: 'failed', durationMs: 0 }]
  const ok = (id) => [id, { taskId: id, agentId: 'x', agentName: 'X', objective: 'o', dependsOn: [], status: 'succeeded', output: 'v', durationMs: 0 }]
  assert.equal(shouldRun(task, new Map([falhou('t1'), falhou('t2')])), false)
  // Com uma que deu certo, roda com o que existe: meia entrada vale mais que nenhuma resposta.
  assert.equal(shouldRun(task, new Map([falhou('t1'), ok('t2')])), true)
})

test('a onda só libera quem tem as dependências prontas', () => {
  const plano = {
    tasks: [
      { id: 't1', agentId: 'a', objective: 'A' },
      { id: 't2', agentId: 'b', objective: 'B' },
      { id: 't3', agentId: 'c', objective: 'C', dependsOn: ['t1', 't2'] },
    ],
  }
  assert.deepEqual(readyTasks(plano, new Set()).map((t) => t.id), ['t1', 't2'])
  assert.deepEqual(readyTasks(plano, new Set(['t1'])).map((t) => t.id), ['t2'])
  assert.deepEqual(readyTasks(plano, new Set(['t1', 't2'])).map((t) => t.id), ['t3'])
})

test('a entrada de quem depende traz autoria, e ignora quem falhou', () => {
  const task = { id: 't3', agentId: 'c', objective: 'junta', dependsOn: ['t1', 't2'] }
  const entrada = inputFromDependencies(
    task,
    new Map([
      ['t1', { taskId: 't1', agentId: 'a', agentName: 'Agente A', objective: 'parte A', dependsOn: [], status: 'succeeded', output: 'valor A', durationMs: 1 }],
      ['t2', { taskId: 't2', agentId: 'b', agentName: 'Agente B', objective: 'parte B', dependsOn: [], status: 'failed', durationMs: 1 }],
    ]),
  )
  assert.match(entrada, /\[Agente A\]/)
  assert.match(entrada, /valor A/)
  assert.ok(!entrada.includes('Agente B'))
})

// --- o planejador conhece o TIPO ------------------------------------------------------------
//
// Quem analisa trabalha sobre o que recebe. Um plano que o aciona sem dependência produz
// uma leitura sem evidência — com toda a aparência de análise fundamentada.

const COLETOR = { agentId: 'a-coleta', name: 'Coletor', type: 'researcher', capabilities: ['dados'] }
const ANALISTA = { agentId: 'a-analise', name: 'Analista', type: 'analyst', capabilities: ['comparacao'] }
const TIME = [COLETOR, ANALISTA]

test('o analista sem dependência passa a depender de quem coleta', () => {
  const plan = validatePlan(
    {
      tasks: [
        { id: 't1', agentId: 'a-coleta', objective: 'levantar' },
        { id: 't2', agentId: 'a-analise', objective: 'analisar' },
      ],
    },
    TIME,
    'pergunta',
  )
  assert.equal(plan.tasks.length, 2)
  assert.deepEqual(plan.tasks[1].dependsOn, ['t1'], 'a correção é ligar, não descartar')
})

test('o analista sem ninguém antes dele sai do plano', () => {
  // Não selecionar é melhor que selecionar para produzir texto sobre o nada.
  const plan = validatePlan({ tasks: [{ id: 't1', agentId: 'a-analise', objective: 'analisar' }] }, TIME, 'pergunta')
  assert.ok(!plan.tasks.some((t) => t.agentId === 'a-analise' && !t.dependsOn?.length))
})

test('a dependência declarada pelo modelo é respeitada', () => {
  const plan = validatePlan(
    {
      tasks: [
        { id: 'x', agentId: 'a-coleta', objective: 'levantar' },
        { id: 'y', agentId: 'a-analise', objective: 'analisar', dependsOn: ['x'] },
      ],
    },
    TIME,
    'pergunta',
  )
  assert.deepEqual(plan.tasks[1].dependsOn, ['t1'])
})

test('sem modelo, o determinístico prefere quem coleta', () => {
  const plan = fallbackPlan('qualquer pergunta', TIME)
  assert.equal(plan.tasks.length, 1)
  assert.equal(plan.tasks[0].agentId, 'a-coleta')
})

test('o prompt do planejador leva o tipo de cada membro e a regra', () => {
  const p = planPrompt('pergunta', TIME)
  assert.match(p, /\[researcher\]/)
  assert.match(p, /\[analyst\]/)
  assert.match(p, /acione um \[analyst\] apenas com dependsOn/)
  assert.match(p, /\[coordinator\]\) não é pesquisador/)
})
