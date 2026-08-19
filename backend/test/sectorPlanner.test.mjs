// Quem trabalha nesta pergunta — decidido antes de alguém trabalhar.
//
// O modo orquestrado dependia de o coordenador resolver, no meio da resposta, chamar
// alguém. Um modelo que recebe uma pergunta respondível responde: a equipe existia e um
// agente só trabalhava. O plano transforma essa decisão num passo declarado, e é aqui
// que se prova que ele escolhe pouco e escolhe certo.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { MAX_TASKS, describePlan, fallbackPlan, memberScore, parsePlanJson, planExecution, planPrompt, validatePlan } =
  await import('../dist/sectorPlanner.js')

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
