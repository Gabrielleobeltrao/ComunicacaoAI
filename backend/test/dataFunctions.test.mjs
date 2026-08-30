// AS FUNÇÕES DE DADOS — o trabalho que hoje gastava um modelo.
//
// Agrupar, filtrar, conferir formato e recortar campos aparecem em quase todo fluxo.
// Feitas por modelo, cada uma custa uma inferência e devolve resultado diferente para a
// mesma entrada. Estas provas fixam o contrário: mesma entrada, mesma saída.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { executeRegisteredFunction } = await import('../dist/executors/functionExecutor.js')

const rodar = async (functionName, input) => {
  const r = await executeRegisteredFunction({ kind: 'function', functionName }, input)
  assert.equal(r.ok, true, JSON.stringify(r.error))
  return r.structured.data
}
const recusa = async (functionName, input) => {
  const r = await executeRegisteredFunction({ kind: 'function', functionName }, input)
  assert.equal(r.ok, false, 'deveria recusar')
  return String(r.error.message ?? '')
}

// --- lista.agrupar -------------------------------------------------------------------

const PEDIDOS = [
  { loja: 'centro', total: 80, itens: 2 },
  { loja: 'centro', total: 120, itens: 3 },
  { loja: 'bairro', total: 40, itens: 1 },
]

test('agrupa e calcula as sete operações', async () => {
  const r = await rodar('lista.agrupar', {
    items: PEDIDOS,
    por: 'loja',
    operacoes: [
      { de: 'total', op: 'soma', como: 'faturamento' },
      { op: 'contagem', como: 'pedidos' },
      { de: 'total', op: 'media', como: 'ticket' },
      { de: 'total', op: 'minimo', como: 'menor' },
      { de: 'total', op: 'maximo', como: 'maior' },
      { de: 'total', op: 'primeiro', como: 'primeiro' },
      { de: 'total', op: 'ultimo', como: 'ultimo' },
    ],
  })
  assert.equal(r.count, 2)
  const centro = r.grupos.find((g) => g.chave === 'centro')
  assert.equal(centro.faturamento, 200)
  assert.equal(centro.pedidos, 2)
  assert.equal(centro.ticket, 100)
  assert.equal(centro.menor, 80)
  assert.equal(centro.maior, 120)
  assert.equal(centro.primeiro, 80)
  assert.equal(centro.ultimo, 120)
  assert.equal(centro.itens, 2, 'a contagem do grupo vem sempre')
})

test('a ordem dos grupos é a de aparição — ordenar sozinho mudaria o resultado', async () => {
  const r = await rodar('lista.agrupar', { items: PEDIDOS, por: 'loja', operacoes: [] })
  assert.deepEqual(r.grupos.map((g) => g.chave), ['centro', 'bairro'])
})

test('campo vazio não vira zero: zero é um valor', async () => {
  const r = await rodar('lista.agrupar', {
    items: [{ g: 'a', v: 10 }, { g: 'a' }, { g: 'a', v: 'não é número' }],
    por: 'g',
    operacoes: [{ de: 'v', op: 'media', como: 'media' }, { de: 'v', op: 'soma', como: 'soma' }],
  })
  // Média de 10 é 10 — se o ausente virasse zero, seria 3,33 e a conta mentiria.
  assert.equal(r.grupos[0].media, 10)
  assert.equal(r.grupos[0].soma, 10)
})

test('agrupar por campo aninhado, e o mesmo em duas chamadas dá o mesmo', async () => {
  const entrada = { items: [{ c: { plano: 'ouro' }, v: 5 }, { c: { plano: 'ouro' }, v: 7 }], por: 'c.plano', operacoes: [{ de: 'v', op: 'soma', como: 's' }] }
  const a = await rodar('lista.agrupar', entrada)
  const b = await rodar('lista.agrupar', entrada)
  assert.deepEqual(a, b, 'determinística: é o ponto inteiro de não usar modelo')
  assert.equal(a.grupos[0].chave, 'ouro')
  assert.equal(a.grupos[0].s, 12)
})

// --- lista.filtrar -------------------------------------------------------------------

test('filtra por condições, em "todas" e em "qualquer"', async () => {
  const items = [
    { sku: 'A', qty: 3, ativo: true },
    { sku: 'B', qty: 50, ativo: true },
    { sku: 'C', qty: 2, ativo: false },
  ]
  const todas = await rodar('lista.filtrar', {
    items,
    condicoes: [{ caminho: 'qty', operador: 'lt', valor: 10 }, { caminho: 'ativo', operador: 'equals', valor: true }],
  })
  assert.deepEqual(todas.items.map((i) => i.sku), ['A'])
  assert.equal(todas.removidos, 2)

  const qualquer = await rodar('lista.filtrar', {
    items,
    modo: 'qualquer',
    condicoes: [{ caminho: 'qty', operador: 'gt', valor: 40 }, { caminho: 'ativo', operador: 'equals', valor: false }],
  })
  assert.deepEqual(qualquer.items.map((i) => i.sku), ['B', 'C'])
})

test('sem condição nenhuma, recusa em vez de devolver tudo', async () => {
  // Devolver a lista inteira seria dizer "filtrei" sobre algo que não foi filtrado.
  assert.match(await recusa('lista.filtrar', { items: [{ a: 1 }], condicoes: [] }), /ao menos uma/)
})

// --- dados.validar -------------------------------------------------------------------

const SCHEMA = {
  type: 'object',
  properties: { nome: { type: 'string' }, idade: { type: 'number' } },
  required: ['nome', 'idade'],
}

test('diz se o dado serve, e o que falta quando não serve', async () => {
  const ok = await rodar('dados.validar', { dados: { nome: 'Ana', idade: 30 }, schema: SCHEMA })
  assert.equal(ok.valido, true)
  assert.deepEqual(ok.erros, [])

  const ruim = await rodar('dados.validar', { dados: { nome: 'Ana' }, schema: SCHEMA })
  assert.equal(ruim.valido, false)
  assert.ok(ruim.erros.length > 0)
  assert.match(ruim.erros.join(' '), /idade/)
})

test('tipo errado é apontado, e não convertido em silêncio', async () => {
  const r = await rodar('dados.validar', { dados: { nome: 'Ana', idade: 'trinta' }, schema: SCHEMA })
  assert.equal(r.valido, false)
  assert.match(r.erros.join(' '), /idade/)
})

// --- json.selecionar -----------------------------------------------------------------

const PAYLOAD = { cliente: { nome: 'Ana', doc: 'sigiloso' }, total: 99, ruido: { a: 1 } }

test('recorta só o que foi pedido — achatado ou aninhado', async () => {
  const achatado = await rodar('json.selecionar', { dados: PAYLOAD, campos: ['cliente.nome', 'total'] })
  assert.deepEqual(achatado.resultado, { cliente_nome: 'Ana', total: 99 })

  const aninhado = await rodar('json.selecionar', { dados: PAYLOAD, campos: ['cliente.nome', 'total'], achatar: false })
  assert.deepEqual(aninhado.resultado, { cliente: { nome: 'Ana' }, total: 99 })
})

test('campo ausente não vira nulo — some', async () => {
  // Nulo diria "o valor é vazio"; ausente diz "não veio". São coisas diferentes.
  const r = await rodar('json.selecionar', { dados: PAYLOAD, campos: ['total', 'nao_existe'] })
  assert.deepEqual(Object.keys(r.resultado), ['total'])
})

// --- a fronteira ---------------------------------------------------------------------

test('caminho que mexe no protótipo é recusado nas três que leem caminho', async () => {
  for (const [fn, input] of [
    ['lista.agrupar', { items: [{ a: 1 }], por: '__proto__' }],
    ['lista.filtrar', { items: [{ a: 1 }], condicoes: [{ caminho: 'constructor', operador: 'exists' }] }],
    ['json.selecionar', { dados: { a: 1 }, campos: ['prototype'] }],
  ]) {
    assert.match(await recusa(fn, input), /não permitido|caminho/, fn)
  }
})

test('expressão no lugar de caminho é recusada — aqui não se executa nada', async () => {
  // `process.env` fica de fora: ele É um caminho simples e legítimo — ler um campo com
  // esse nome não executa nada, só não encontra. Recusá-lo seria proibir um nome.
  for (const ruim of ['a[0]()', 'a.b || c', "a['b']", 'a-b', 'a b']) {
    assert.match(await recusa('json.selecionar', { dados: { a: 1 }, campos: [ruim] }), /caminho simples|não permitido/, ruim)
  }
})

test('lista maior que o teto é recusada em vez de comer a memória', async () => {
  const gigante = Array.from({ length: 1001 }, (_, i) => ({ g: 'x', v: i }))
  assert.match(await recusa('lista.agrupar', { items: gigante, por: 'g' }), /1000 itens/)
})

test('o que não é lista é recusado ANTES do handler, pelo contrato', async () => {
  // O `inputSchema` já diz `array`, então a recusa acontece na porta — o handler nem
  // roda. É a mesma conferência que vale para toda função registrada.
  assert.match(await recusa('lista.agrupar', { items: 'não é lista', por: 'g' }), /fora do contrato|array/)
})

test('valor solto na lista vira objeto, em vez de quebrar', async () => {
  // Uma lista de números é entrada legítima: agrupar por "valor" tem de funcionar.
  const r = await rodar('lista.agrupar', { items: [1, 1, 2], por: 'valor', operacoes: [{ op: 'contagem', como: 'quantos' }] })
  assert.equal(r.count, 2)
  assert.equal(r.grupos.find((g) => g.chave === '1').quantos, 2)
})
