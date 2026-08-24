// A linguagem de fórmula: o que ela CALCULA, e o que ela não consegue fazer.
//
// O pedido era colar código no agente. Numa plataforma multi-inquilino isso significa o
// código de um cliente rodando no mesmo processo que tem a chave do banco, as credenciais
// dos Apps e os dados de todas as outras contas.
//
// A saída foi não dar capacidade nenhuma, em vez de dar e depois bloquear: este
// interpretador não tem rede, disco nem acesso ao processo porque essas operações não
// existem nele. E a gramática não tem laço nem recursão, então toda fórmula termina — não
// por um limite imposto, mas por uma propriedade do que se pode escrever.
//
// A metade de baixo deste arquivo é o que garante isso. Ela é a razão de a linguagem
// existir; a de cima só mostra que ela serve para alguma coisa.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { compilarFormula, executarFormula, schemaDeEntrada, schemaDeSaida, FUNCOES } = await import('../dist/executors/formula.js')

const rodar = (fonte, entrada = {}) => {
  const c = compilarFormula(fonte)
  assert.equal(c.ok, true, JSON.stringify(c.errors))
  const r = executarFormula(c.compilada, entrada)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  return r.data
}
const falhaAoRodar = (fonte, entrada = {}) => {
  const c = compilarFormula(fonte)
  assert.equal(c.ok, true, JSON.stringify(c.errors))
  const r = executarFormula(c.compilada, entrada)
  assert.equal(r.ok, false, 'deveria falhar')
  return r.error
}

// --- ela calcula ------------------------------------------------------------------------------

test('o caso que motivou tudo: margem a partir de receita e custo', () => {
  const d = rodar('margem = arred((receita - custo) / receita * 100, 2)', { receita: 200000, custo: 140000 })
  assert.equal(d.margem, 30)
})

test('várias linhas, e uma usa o resultado da outra', () => {
  const d = rodar(
    [
      'margem = (receita - custo) / receita * 100',
      'faixa = se(margem >= 30, "alta", "baixa")',
      'resumo = concat("margem de ", texto(arred(margem, 1)), "% (", faixa, ")")',
    ].join('\n'),
    { receita: 200000, custo: 140000 },
  )
  assert.equal(d.faixa, 'alta')
  assert.equal(d.resumo, 'margem de 30% (alta)')
})

test('listas: soma, média, mínimo, máximo e tamanho', () => {
  const d = rodar(
    ['total = soma(valores)', 'media_ = media(valores)', 'menor = min(valores)', 'maior = max(valores)', 'quantos = tamanho(valores)'].join('\n'),
    { valores: [12, 7, 31, 4, 26] },
  )
  assert.deepEqual([d.total, d.media_, d.menor, d.maior, d.quantos], [80, 16, 4, 31, 5])
})

test('comparação, e/ou/não, com curto-circuito', () => {
  // Sem curto-circuito, o lado direito dividiria por zero antes de a condição decidir.
  const d = rodar('seguro = x <> 0 e 10 / x > 1', { x: 0 })
  assert.equal(d.seguro, false)
  assert.equal(rodar('r = nao (a ou b)', { a: false, b: false }).r, true)
})

test('texto: juntar, trocar, caixa e conter', () => {
  const d = rodar(
    ['nome = maiusc(cliente)', 'limpo = substituir(doc, ".", "")', 'tem = contem(cliente, "Ltda")'].join('\n'),
    { cliente: 'Acme Ltda', doc: '12.345.678' },
  )
  assert.deepEqual([d.nome, d.limpo, d.tem], ['ACME LTDA', '12345678', true])
})

test('comentários e linhas em branco são ignorados', () => {
  const d = rodar('# a margem do pedido\n\ntotal = a + b\n', { a: 2, b: 3 })
  assert.equal(d.total, 5)
})

// --- o contrato sai da própria fórmula ---------------------------------------------------------

test('as variáveis livres são a ENTRADA; os nomes atribuídos são a SAÍDA', () => {
  // Um schema escrito à mão ao lado do cálculo começa igual e envelhece — e o que
  // envelhece recusa entrada boa ou aceita entrada ruim sem ninguém perceber.
  const c = compilarFormula('margem = (receita - custo) / receita\nfaixa = se(margem > 0.3, "alta", "baixa")')
  assert.deepEqual(c.compilada.entradas, ['custo', 'receita'])
  assert.deepEqual(c.compilada.saidas, ['margem', 'faixa'])
  // `margem` é lida na segunda linha, mas foi DEFINIDA na primeira: é interna, não entrada.
  assert.ok(!c.compilada.entradas.includes('margem'))
})

test('o schema de entrada exige exatamente os campos livres', () => {
  const c = compilarFormula('r = a + b')
  const s = schemaDeEntrada(c.compilada)
  assert.deepEqual(s.required, ['a', 'b'])
  assert.equal(s.type, 'object')
})

test('o schema de saída sai de uma execução real — o tipo depende do valor', () => {
  // `se(x > 0, "alta", 0)` não tem tipo estático honesto. Executar responde de verdade, e
  // como a linguagem não tem efeito colateral, executar de novo não custa nada.
  const c = compilarFormula('faixa = se(x > 0, "alta", "baixa")\ntotal = x * 2')
  const amostra = executarFormula(c.compilada, { x: 5 })
  const s = schemaDeSaida(c.compilada, amostra.data)
  assert.equal(s.properties.faixa.type, 'string')
  assert.equal(s.properties.total.type, 'number')
})

// --- O QUE ELA NÃO CONSEGUE FAZER --------------------------------------------------------------
//
// Esta é a parte que justifica a linguagem existir.

test('não existe laço nem recursão: toda fórmula termina', () => {
  for (const veneno of ['x = while(1)', 'x = for(i, 1, 9)', 'x = x + 1', 'f = f(1)']) {
    const c = compilarFormula(veneno)
    const falhou = !c.ok || !executarFormula(c.compilada, {}).ok
    assert.ok(falhou, `${veneno} deveria falhar`)
  }
})

test('não há acesso a rede, disco, processo ou tempo', () => {
  // Elas não são bloqueadas: elas NÃO EXISTEM. A lista de funções é a fronteira inteira.
  for (const nome of ['fetch', 'require', 'import', 'process', 'eval', 'Function', 'readFile', 'exec', 'agora', 'random']) {
    assert.equal(FUNCOES[nome], undefined, `${nome} não pode existir na linguagem`)
    const c = compilarFormula(`x = ${nome}(1)`)
    const falhou = !c.ok || !executarFormula(c.compilada, {}).ok
    assert.ok(falhou, `${nome}() deveria falhar`)
  }
})

test('uma variável não alcança o protótipo', () => {
  // Sem `hasOwnProperty`, `constructor` resolveria para algo herdado — e uma variável
  // passaria a alcançar o motor.
  for (const nome of ['constructor', 'toString', '__proto__', 'valueOf']) {
    const e = falhaAoRodar(`x = ${nome}`, { a: 1 })
    assert.match(e.message, /não veio na entrada/)
  }
  assert.equal({}.poluido, undefined)
})

test('o protótipo global segue intacto depois de rodar entrada hostil', () => {
  rodar('r = a + 1', JSON.parse('{"a":1,"__proto__":{"poluido":true}}'))
  assert.equal({}.poluido, undefined)
})

test('a entrada só aceita o que a linguagem sabe manipular', () => {
  // Um objeto aninhado não vira variável: não há como navegá-lo, e deixá-lo entrar só
  // adiaria o erro para o meio do cálculo.
  const e = falhaAoRodar('x = obj', { obj: { a: 1 } })
  assert.match(e.message, /não veio na entrada/)
})

test('texto e aninhamento absurdos são recusados antes de qualquer conta', () => {
  assert.equal(compilarFormula(`x = ${'1+'.repeat(3000)}1`).ok, false)
  assert.equal(compilarFormula(`x = ${'('.repeat(60)}1${')'.repeat(60)}`).ok, false)
  assert.equal(compilarFormula(Array.from({ length: 60 }, (_, i) => `a${i} = 1`).join('\n')).ok, false)
})

test('divisão por zero e resultado não-finito são erro, não Infinity', () => {
  // Infinity atravessaria o resto do sistema disfarçado de número.
  assert.match(falhaAoRodar('x = 1 / 0').message, /divisão por zero/)
  assert.match(falhaAoRodar('x = a * a', { a: 1e200 }).message, /não é um número finito/)
})

test('a mensagem de erro diz a LINHA e o campo', () => {
  const e = falhaAoRodar('a = 1\nb = a + faltando')
  assert.equal(e.line, 2)
  assert.match(e.message, /faltando/)
})

test('erro de escrita é apontado na compilação, não na execução', () => {
  const c = compilarFormula('margem = (receita - custo')
  assert.equal(c.ok, false)
  assert.equal(c.errors[0].line, 1)

  const semAtribuicao = compilarFormula('receita - custo')
  assert.match(semAtribuicao.errors[0].message, /nome = expressão/)

  const repetido = compilarFormula('x = 1\nx = 2')
  assert.match(repetido.errors[0].message, /já foi definido/)

  const palavra = compilarFormula('soma = 1')
  assert.match(palavra.errors[0].message, /palavra da linguagem/)
})

// --- como agente: o ciclo inteiro ---------------------------------------------------------

test('um agente de FÓRMULA declara o contrato sozinho, e é recusado se não compilar', async () => {
  const { parseAgentModelFields } = await import('../dist/agents.js')

  const bom = parseAgentModelFields({
    executorKind: 'formula',
    executorConfig: { kind: 'formula', expression: 'margem = arred((receita - custo) / receita * 100, 2)' },
  })
  assert.equal(bom.error, undefined)
  // Ninguém escreveu schema nenhum: a fórmula declarou os dois.
  assert.deepEqual(bom.fields.inputJsonSchema.required, ['custo', 'receita'])
  assert.deepEqual(bom.fields.outputJsonSchema.required, ['margem'])
  assert.equal(bom.fields.outputJsonSchema.properties.margem.type, 'number')
  // Ela calcula: prosa é trabalho de modelo.
  assert.equal(bom.fields.responseMode, 'structured')

  // Uma fórmula quebrada é recusada AQUI, com a linha — não na primeira execução, longe
  // do formulário e com uma mensagem que não fala do formulário.
  const ruim = parseAgentModelFields({
    executorKind: 'formula',
    executorConfig: { kind: 'formula', expression: 'margem = (receita - custo' },
  })
  assert.match(ruim.error, /Linha 1/)

  // O tipo sem a fórmula é uma promessa sem cumprimento.
  assert.match(parseAgentModelFields({ executorKind: 'formula' }).error, /expression is required/)
})

test('o agente roda pelo dispatcher, sem tocar no provedor e com zero token', async () => {
  const { dispatchAgentExecution } = await import('../dist/executors/dispatcher.js')
  const { ObjectId } = await import('mongodb')

  let modeloChamado = 0
  const agente = {
    _id: new ObjectId(),
    ownerId: 'dono',
    name: 'Margem',
    executorKind: 'formula',
    executorConfig: { kind: 'formula', expression: 'margem = (receita - custo) / receita * 100\nfaixa = se(margem >= 30, "alta", "baixa")' },
    responseMode: 'structured',
    inputJsonSchema: { type: 'object', properties: { receita: { type: 'number' }, custo: { type: 'number' } }, required: ['custo', 'receita'] },
  }
  const r = await dispatchAgentExecution(
    agente,
    { agentId: agente._id, ownerId: 'dono', objective: 'calcular', input: { receita: 200000, custo: 140000 } },
    { runLlm: async () => ((modeloChamado += 1), { output: 'x', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] }) },
  )
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal(r.structured.data.margem, 30)
  assert.equal(r.structured.data.faixa, 'alta')
  assert.equal(modeloChamado, 0, 'calcular uma margem não pode custar uma inferência')
  assert.equal(r.telemetry.inputTokens, undefined)
})

test('entrada fora do contrato é recusada antes de a fórmula rodar', async () => {
  const { dispatchAgentExecution } = await import('../dist/executors/dispatcher.js')
  const { ObjectId } = await import('mongodb')
  const agente = {
    _id: new ObjectId(),
    ownerId: 'dono',
    name: 'Margem',
    executorKind: 'formula',
    executorConfig: { kind: 'formula', expression: 'm = receita - custo' },
    inputJsonSchema: { type: 'object', properties: { receita: { type: 'number' }, custo: { type: 'number' } }, required: ['custo', 'receita'] },
  }
  const r = await dispatchAgentExecution(agente, { agentId: agente._id, ownerId: 'dono', objective: 'x', input: { receita: 10 } })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'invalid_input')
  assert.match(r.error.message, /custo/)
})
