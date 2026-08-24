// O plano compila, ou diz por que não.
//
// A falha que este arquivo existe para pegar não parece uma falha: o plano roda inteiro,
// todo mundo responde, e a resposta sai completa. Só que uma etapa precisava de um número
// que ninguém produziu — então o agente leu a prosa, não achou, e escreveu um plausível.
// Custa uma mensagem detectar isso antes; custa uma decisão errada descobrir depois.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const {
  adaptLegacyPlan,
  compilePlan,
  describePlan,
  fallbackPlan,
  inputForTask,
  memberScore,
  parseBinding,
  parseBindings,
  planExecution,
  planPrompt,
  resolveBindings,
  schemaHash,
  supplyMissing,
  validatePlan,
} = await import('../dist/sectorPlanner.js')

// Uma equipe com CONTRATO: quem coleta declara o que produz, quem calcula declara o que
// exige. É a diferença entre escolher por rótulo e escolher por capacidade.
const COLETOR = {
  agentId: 'a-coletor',
  name: 'Coletor',
  type: 'researcher',
  capabilities: ['cadastro'],
  outputJsonSchema: { type: 'object', properties: { cnpj: { type: 'string' }, faturamento: { type: 'number' } } },
}
const RISCO = {
  agentId: 'a-risco',
  name: 'Risco',
  type: 'analyst',
  capabilities: ['risco', 'credito'],
  inputJsonSchema: {
    type: 'object',
    properties: { cnpj: { type: 'string' }, faturamento: { type: 'number' } },
    required: ['cnpj', 'faturamento'],
  },
  outputJsonSchema: { type: 'object', properties: { score: { type: 'number' } } },
}
const CHEFE = { agentId: 'a-chefe', name: 'Chefe', type: 'coordinator' }
const EQUIPE = [COLETOR, RISCO, CHEFE]

const tarefa = (over) => ({ id: 't1', agentId: 'a-risco', objective: 'avaliar', ...over })
const codigos = (r) => r.diagnostics.map((d) => d.code)

// --- a gramática: nome de campo, e nada mais ------------------------------------------------

test('as três origens são lidas, e só elas', () => {
  assert.deepEqual(parseBinding('$context.cnpj').binding, { from: 'context', path: ['cnpj'] })
  assert.deepEqual(parseBinding('$steps.t1.faturamento').binding, { from: 'step', stepId: 't1', path: ['faturamento'] })
  assert.deepEqual(parseBinding(42).binding, { from: 'literal', value: 42 })
  assert.deepEqual(parseBinding('BRL').binding, { from: 'literal', value: 'BRL' })
  // `$$` escapa: um literal que por acaso começa com cifrão continua possível.
  assert.deepEqual(parseBinding('$$50').binding, { from: 'literal', value: '$50' })
})

test('expressão não é origem — nem JSONPath, nem fórmula, nem código', () => {
  for (const veneno of [
    '$steps[0].campo',
    '$..campo',
    '$context.a[?(@.b)]',
    '$eval(1+1)',
    '$steps.t1.campo * 2',
    '$jsonpath.$.a',
  ]) {
    assert.ok(parseBinding(veneno).error, `${veneno} deveria ser recusado`)
  }
})

test('uma referência escrita errado é ERRO, não um literal', () => {
  // O ponto: aceitar "$contexto.cnpj" (com typo) como texto entregaria a string literal
  // "$contexto.cnpj" ao agente como se fosse o CNPJ. Um valor inventado com passos a mais.
  const r = parseBinding('$contexto.cnpj')
  assert.ok(r.error)
  assert.equal(r.binding, undefined)
})

test('nome que chega ao protótipo não é campo de ninguém', () => {
  for (const veneno of ['$context.__proto__', '$steps.t1.constructor', '$context.a.prototype']) {
    assert.ok(parseBinding(veneno).error, `${veneno} deveria ser recusado`)
  }
  // Também no destino, e também dentro de um literal. `JSON.parse` porque um literal de
  // objeto com `__proto__` no fonte não cria a chave — e o payload que chega pela rede vem
  // exatamente por JSON.parse, que cria.
  assert.ok(parseBindings(JSON.parse('{"__proto__":"$context.a"}')).errors.length > 0)
  assert.ok(parseBindings({ ok: { constructor: { prototype: 1 } } }).errors.length > 0)
})

test('o protótipo continua intacto depois de resolver', () => {
  const { bindings } = parseBindings({ limite: 10 })
  const { input } = resolveBindings(bindings, { context: {} })
  assert.equal(input.limite, 10)
  assert.equal({}.polluted, undefined)
})

test('campo sem origem vira `missing`, nunca vira nulo', () => {
  const { bindings } = parseBindings({ cnpj: '$context.cnpj', faturamento: '$steps.t1.faturamento' })
  const { input, missing } = resolveBindings(bindings, { context: { cnpj: '00.000.000/0001-00' }, steps: {} })
  assert.equal(input.cnpj, '00.000.000/0001-00')
  assert.ok(!('faturamento' in input), 'ausente é ausente; um nulo aqui seria o motor inventando')
  assert.deepEqual(missing, ['faturamento'])
})

test('herança não é dado produzido', () => {
  const { bindings } = parseBindings({ x: '$steps.t1.toString' })
  const { missing } = resolveBindings(bindings, { steps: { t1: {} } })
  assert.deepEqual(missing, ['x'])
})

// --- a compilação ---------------------------------------------------------------------------

test('plano válido de várias etapas compila', () => {
  const plano = {
    tasks: [
      { id: 't1', agentId: 'a-coletor', objective: 'levantar o cadastro' },
      tarefa({
        id: 't2',
        dependsOn: ['t1'],
        inputBindings: {
          cnpj: { from: 'step', stepId: 't1', path: ['cnpj'] },
          faturamento: { from: 'step', stepId: 't1', path: ['faturamento'] },
        },
      }),
    ],
  }
  const r = compilePlan(plano, EQUIPE)
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics))
  assert.deepEqual(r.unmet, [])
})

test('dependência insuficiente: o campo obrigatório sem origem é apontado por nome', () => {
  const plano = {
    tasks: [
      { id: 't1', agentId: 'a-coletor', objective: 'levantar' },
      tarefa({ id: 't2', dependsOn: ['t1'], inputBindings: { cnpj: { from: 'step', stepId: 't1', path: ['cnpj'] } } }),
    ],
  }
  const r = compilePlan(plano, EQUIPE)
  assert.equal(r.ok, false)
  assert.ok(codigos(r).includes('missing_input'))
  assert.deepEqual(r.unmet, [{ taskId: 't2', agentId: 'a-risco', field: 'faturamento' }])
})

test('referência a etapa que não existe', () => {
  const r = compilePlan({ tasks: [tarefa({ inputBindings: { cnpj: { from: 'step', stepId: 'tX', path: ['cnpj'] } } })] }, EQUIPE)
  assert.ok(codigos(r).includes('unknown_step'))
})

test('referência para a frente é ciclo escrito de outro jeito', () => {
  const plano = {
    tasks: [
      tarefa({ id: 't1', dependsOn: ['t2'], inputBindings: { cnpj: { from: 'step', stepId: 't2', path: ['cnpj'] } } }),
      { id: 't2', agentId: 'a-coletor', objective: 'levantar' },
    ],
  }
  assert.ok(codigos(compilePlan(plano, EQUIPE)).includes('forward_reference'))
})

test('ciclo entre etapas é recusado', () => {
  const plano = {
    tasks: [
      { id: 't1', agentId: 'a-coletor', objective: 'a', dependsOn: ['t2'] },
      { id: 't2', agentId: 'a-risco', objective: 'b', dependsOn: ['t1'] },
    ],
  }
  assert.ok(codigos(compilePlan(plano, EQUIPE)).includes('cycle'))
})

test('ler de uma etapa sem declará-la em dependsOn é apontado', () => {
  const plano = {
    tasks: [
      { id: 't1', agentId: 'a-coletor', objective: 'levantar' },
      tarefa({
        id: 't2',
        inputBindings: {
          cnpj: { from: 'step', stepId: 't1', path: ['cnpj'] },
          faturamento: { from: 'step', stepId: 't1', path: ['faturamento'] },
        },
      }),
    ],
  }
  // Sem a declaração, o runtime rodaria as duas na MESMA onda: a leitora começaria antes
  // de existir o que ler.
  assert.ok(codigos(compilePlan(plano, EQUIPE)).includes('undeclared_dependency'))
})

test('capacidade incompatível: quem conduz não executa etapa, quem analisa não parte do nada', () => {
  const chefe = compilePlan({ tasks: [{ id: 't1', agentId: 'a-chefe', objective: 'levantar' }] }, EQUIPE)
  assert.ok(codigos(chefe).includes('capability_mismatch'))

  const analistaSozinho = compilePlan({ tasks: [{ id: 't1', agentId: 'a-risco', objective: 'analisar' }] }, EQUIPE)
  assert.ok(codigos(analistaSozinho).includes('capability_mismatch'))
})

test('agente que não é membro do setor não compila', () => {
  assert.ok(codigos(compilePlan({ tasks: [{ id: 't1', agentId: 'a-de-fora', objective: 'x' }] }, EQUIPE)).includes('unknown_agent'))
})

test('a saída da origem precisa conter o campo, e no mesmo tipo', () => {
  const plano = {
    tasks: [
      { id: 't1', agentId: 'a-coletor', objective: 'levantar' },
      tarefa({
        id: 't2',
        dependsOn: ['t1'],
        inputBindings: {
          cnpj: { from: 'step', stepId: 't1', path: ['cnpj'] },
          faturamento: { from: 'step', stepId: 't1', path: ['cnpj'] },
        },
      }),
    ],
  }
  // `faturamento` é number no destino e o coletor entrega `cnpj` como string.
  assert.ok(codigos(compilePlan(plano, EQUIPE)).includes('incompatible_output'))

  const inexistente = {
    tasks: [
      { id: 't1', agentId: 'a-coletor', objective: 'levantar' },
      tarefa({ id: 't2', dependsOn: ['t1'], inputBindings: { cnpj: { from: 'step', stepId: 't1', path: ['inventado'] } } }),
    ],
  }
  assert.ok(codigos(compilePlan(inexistente, EQUIPE)).includes('incompatible_output'))
})

test('a função de um agente de função precisa existir', () => {
  const membro = {
    agentId: 'a-calc',
    name: 'Calc',
    type: 'executor',
    executorKind: 'function',
    executorConfig: { functionName: 'nao.existe' },
  }
  const r = compilePlan({ tasks: [{ id: 't1', agentId: 'a-calc', objective: 'somar' }] }, [membro])
  assert.ok(codigos(r).includes('unknown_function'))

  // A do registro real passa — é o mesmo registro fechado da fase 2.
  const boa = compilePlan({ tasks: [{ id: 't1', agentId: 'a-calc', objective: 'somar' }] }, [
    { ...membro, executorConfig: { functionName: 'math.summary' } },
  ])
  assert.equal(boa.ok, true, JSON.stringify(boa.diagnostics))
})

test('ação de App fora do que foi autorizado não compila', () => {
  const membro = {
    agentId: 'a-app',
    name: 'App',
    type: 'executor',
    executorKind: 'tool',
    executorConfig: { appKey: 'agenda', actionKey: 'apagar_tudo' },
    actions: ['agenda.criar_evento'],
  }
  assert.ok(codigos(compilePlan({ tasks: [{ id: 't1', agentId: 'a-app', objective: 'x' }] }, [membro])).includes('unknown_function'))
})

test('o contexto declarado é conferido; o não declarado passa', () => {
  const plano = { tasks: [tarefa({ inputBindings: { cnpj: { from: 'context', path: ['cnpj'] }, faturamento: { from: 'context', path: ['faturamento'] } } })] }
  // Sem saber quais campos o pedido traz, não dá para acusar ninguém.
  assert.equal(compilePlan(plano, EQUIPE).ok, true)
  // Sabendo, dá.
  const r = compilePlan(plano, EQUIPE, { contextFields: ['cnpj'] })
  assert.ok(codigos(r).includes('unknown_context_field'))
})

// --- o que fazer com o campo que ninguém produz ---------------------------------------------

test('o fornecedor que faltava entra ANTES de quem precisa', () => {
  const plano = { tasks: [tarefa({ inputBindings: {} })] }
  const primeira = compilePlan(plano, EQUIPE)
  const reforcado = supplyMissing(plano, EQUIPE, primeira.unmet, 4)
  assert.equal(reforcado.tasks[0].agentId, 'a-coletor', 'quem produz o dado roda primeiro')
  assert.equal(compilePlan(reforcado, EQUIPE).ok, true)
})

test('sem ninguém que produza o campo, o plano PERGUNTA em vez de inventar', async () => {
  const soRisco = [RISCO, CHEFE]
  const { clarification, diagnostics } = await planExecution({
    question: 'qual o risco dessa empresa?',
    members: soRisco,
    ask: async () => JSON.stringify({ tasks: [{ id: 't1', agentId: 'a-risco', objective: 'avaliar', inputBindings: {} }] }),
  })
  assert.match(clarification, /cnpj/)
  assert.match(clarification, /faturamento/)
  assert.ok(diagnostics.some((d) => d.code === 'missing_input'))
})

test('nenhum valor é inventado para preencher a lacuna', async () => {
  const { plan } = await planExecution({
    question: 'qual o risco?',
    members: [RISCO, CHEFE],
    ask: async () => JSON.stringify({ tasks: [{ id: 't1', agentId: 'a-risco', objective: 'avaliar', inputBindings: {} }] }),
  })
  for (const t of plan.tasks) {
    for (const b of Object.values(t.inputBindings ?? {})) {
      assert.notEqual(b.from, 'literal', 'um literal aqui seria o motor decidindo o faturamento da empresa')
    }
  }
})

// --- planos antigos --------------------------------------------------------------------------

test('plano legado continua válido — e continua recebendo texto', () => {
  const legado = adaptLegacyPlan({
    tasks: [
      { id: 't1', agentId: 'a-coletor', objective: 'levantar' },
      { id: 't2', agentId: 'a-risco', objective: 'analisar', dependsOn: ['t1'] },
    ],
    synthesisObjective: 'juntar',
  })
  assert.equal(legado.tasks[0].inputBindings, undefined, 'ausência de bindings é o que marca a tarefa como legada')
  assert.equal(compilePlan(legado, EQUIPE).ok, true, 'um plano gravado antes desta fase não vira erro por não falar a língua nova')
  assert.equal(legado.synthesisObjective, 'juntar')

  const resultados = new Map([
    ['t1', { taskId: 't1', agentId: 'a-coletor', agentName: 'Coletor', objective: 'levantar', dependsOn: [], status: 'succeeded', output: 'faturamento de 120 mil', durationMs: 1 }],
  ])
  const entrada = inputForTask(legado.tasks[1], resultados)
  assert.deepEqual(entrada.missing, [], 'tarefa legada não tem campo declarado para faltar')
  assert.match(entrada.text, /120 mil/)
  assert.match(entrada.text, /\[Coletor\]/, 'o texto do antecessor continua vindo com autoria')
})

test('a entrada declarada chega como campo, e o que falta é dito', () => {
  const resultados = new Map([
    ['t1', { taskId: 't1', agentId: 'a-coletor', agentName: 'Coletor', objective: 'levantar', dependsOn: [], status: 'succeeded', output: 'ok', structured: { cnpj: '00.000.000/0001-00' }, durationMs: 1 }],
  ])
  const task = tarefa({
    id: 't2',
    dependsOn: ['t1'],
    inputBindings: {
      cnpj: { from: 'step', stepId: 't1', path: ['cnpj'] },
      faturamento: { from: 'step', stepId: 't1', path: ['faturamento'] },
    },
  })
  const r = inputForTask(task, resultados)
  assert.match(r.text, /cnpj: 00\.000\.000\/0001-00/)
  assert.deepEqual(r.missing, ['faturamento'], 'o campo prometido e não entregue aparece; ele NÃO é preenchido')
})

// --- a escolha por capacidade -----------------------------------------------------------------

test('o nome é o último critério, não o primeiro', () => {
  // Dois membros, o mesmo pedido: um se CHAMA como a pergunta, o outro SABE FAZER o que ela
  // pede. Antes desta fase, o rótulo ganhava.
  const rotulo = { agentId: 'a1', name: 'Risco Contratual', capabilities: ['cardapio'], role: 'cuida do cardápio' }
  const capaz = { agentId: 'a2', name: 'Equipe Dois', capabilities: ['risco', 'contratual'], routingDescription: 'avalia risco contratual' }
  const pergunta = 'preciso avaliar o risco contratual desse fornecedor'
  assert.ok(memberScore(pergunta, capaz) > memberScore(pergunta, rotulo))
})

test('o plano determinístico liga os campos que têm origem — e só esses', () => {
  const plano = fallbackPlan('preciso do risco de credito com faturamento e cnpj', [COLETOR, RISCO], 4)
  const risco = plano.tasks.find((t) => t.agentId === 'a-risco')
  assert.ok(risco.inputBindings, 'quem declara contrato de entrada recebe campos, não prosa')
  assert.equal(risco.inputBindings.cnpj.from, 'step')
  assert.ok(risco.dependsOn.includes(risco.inputBindings.cnpj.stepId))
  const coletor = plano.tasks.find((t) => t.agentId === 'a-coletor')
  assert.equal(coletor.inputBindings, undefined, 'sem contrato de entrada, a tarefa segue legada')
})

test('o hash do contrato acompanha o plano e muda com o contrato', () => {
  const plano = fallbackPlan('risco', [RISCO], 4)
  assert.equal(plano.tasks[0].outputSchemaHash, schemaHash(RISCO.outputJsonSchema))
  assert.notEqual(schemaHash({ a: 1 }), schemaHash({ a: 2 }))
  assert.equal(schemaHash({ a: 1, b: 2 }), schemaHash({ b: 2, a: 1 }), 'a ordem das chaves não é o contrato')
})

test('os ids do modelo viram os ids do plano — inclusive dentro dos bindings', () => {
  const plano = validatePlan(
    {
      tasks: [
        { id: 'coleta', agentId: 'a-coletor', objective: 'levantar' },
        {
          id: 'analise',
          agentId: 'a-risco',
          objective: 'avaliar',
          dependsOn: ['coleta'],
          inputBindings: { cnpj: '$steps.coleta.cnpj', faturamento: '$steps.coleta.faturamento' },
        },
      ],
    },
    EQUIPE,
    'pergunta',
  )
  assert.deepEqual(plano.tasks.map((t) => t.id), ['t1', 't2'])
  assert.equal(plano.tasks[1].inputBindings.cnpj.stepId, 't1', 'sem a tradução, o campo apontaria para uma etapa que não existe')
  assert.equal(compilePlan(plano, EQUIPE).ok, true)
})

test('o log do plano diz de onde o campo vem, e não o que estava nele', () => {
  const plano = {
    tasks: [tarefa({ inputBindings: { cnpj: { from: 'step', stepId: 't0', path: ['cnpj'] }, segredo: { from: 'literal', value: 'valor-sensível' } } })],
  }
  const linha = describePlan(plano, EQUIPE)
  assert.match(linha, /cnpj=\$steps\.t0\.cnpj/)
  assert.doesNotMatch(linha, /valor-sensível/, 'a origem é log; o valor é conteúdo')
})

test('o prompt ensina a gramática e proíbe inventar', () => {
  const p = planPrompt('pergunta', EQUIPE, 4, ['cnpj'])
  assert.match(p, /\$steps\.<id>\.campo/)
  assert.match(p, /NÃO INVENTE/)
  assert.match(p, /CAPACIDADE e por CONTRATO/)
  assert.match(p, /Campos que o pedido traz: cnpj/)
  assert.match(p, /entrada:\{cnpj\*,faturamento\*\}/, 'o obrigatório vai marcado')
})
