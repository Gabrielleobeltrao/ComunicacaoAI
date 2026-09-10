// A BIBLIOTECA BASE — as contas que aparecem em quase todo pedido.
//
// O catálogo tinha oito funções, e qualquer coisa fora delas virava pendência: corretamente,
// e para sempre, porque ninguém estava enchendo a estante. Do dono: "a gente precisava criar
// funções que seriam reutilizáveis para qualquer outro momento que seja pedido isso".
//
// Cada caso usa um assunto diferente de propósito. Uma função que só serve ao exemplo que
// estava na mesa não é reutilizável — é o mesmo código escrito de novo com outro nome.
import { test } from 'node:test'
import assert from 'node:assert/strict'

await import('../dist/executors/basicFunctions.js')
const { findFunction, listPublicFunctions } = await import('../dist/executors/functionRegistry.js')

const rodar = async (nome, entrada) => {
  const f = findFunction(nome)
  assert.ok(f, `a função ${nome} não está registrada`)
  return f.handler(entrada, {}, { ownerId: 'dono' })
}

test('as cinco funções entram no catálogo, com contrato e versão', () => {
  const publicas = listPublicFunctions().map((f) => f.functionName)
  for (const nome of ['registros.buscar', 'valores.comparar', 'serie.variacao', 'registros.contar_por', 'registros.filtrar']) {
    assert.ok(publicas.includes(nome), `${nome} não aparece no catálogo que o Assistente lê`)
    const f = findFunction(nome)
    assert.equal(f.version, '1.0.0')
    assert.ok(f.description.length > 30, `${nome} sem descrição que ensine quando usá-la`)
    assert.equal(f.inputSchema.type, 'object')
  }
})

// --- buscar ----------------------------------------------------------------------------------

test('ACEITAÇÃO: buscar acha por id, por SKU, por qualquer campo', async () => {
  const pedidos = [{ id: 'p1', valor: 10 }, { id: 'p2', valor: 20 }]
  assert.deepEqual(await rodar('registros.buscar', { registros: pedidos, campo: 'id', valor: 'p2' }), {
    encontrado: true,
    registro: { id: 'p2', valor: 20 },
    quantos: 1,
  })
  // Outro domínio, caminho aninhado: a mesma função, sem uma linha nova.
  const estoque = [{ dados: { sku: 'ABC' }, qtd: 3 }]
  const r = await rodar('registros.buscar', { registros: estoque, campo: 'dados.sku', valor: 'ABC' })
  assert.equal(r.encontrado, true)
})

test('AMEAÇA: buscar diz QUANTOS bateram — um id que casa com três não é um id', async () => {
  const leituras = [{ sensor: 's1' }, { sensor: 's1' }, { sensor: 's2' }]
  const r = await rodar('registros.buscar', { registros: leituras, campo: 'sensor', valor: 's1' })
  assert.equal(r.quantos, 2, 'sem isso, quem chamou age sobre o primeiro achando que é o único')
})

test('não achou é "encontrado: false", e não um registro vazio parecendo achado', async () => {
  const r = await rodar('registros.buscar', { registros: [{ id: 'a' }], campo: 'id', valor: 'z' })
  assert.equal(r.encontrado, false)
  assert.equal(r.registro, null)
  assert.equal(r.quantos, 0)
})

test('AMEAÇA: um caminho perigoso não lê nada', async () => {
  const r = await rodar('registros.buscar', { registros: [{ id: 'a' }], campo: '__proto__.polluted', valor: 'x' })
  assert.equal(r.encontrado, false, 'um caminho vindo de fora é entrada, não código')
})

// --- comparar --------------------------------------------------------------------------------

test('ACEITAÇÃO: comparar diz a relação E por quanto', async () => {
  const r = await rodar('valores.comparar', { valor: 8.5, referencia: 8 })
  assert.equal(r.relacao, 'maior')
  assert.equal(r.diferenca, 0.5)
  assert.ok(Math.abs(r.variacaoPercentual - 6.25) < 0.001)
})

test('a tolerância existe porque "praticamente igual" é uma decisão de negócio', async () => {
  assert.equal((await rodar('valores.comparar', { valor: 100.02, referencia: 100, tolerancia: 0.05 })).relacao, 'igual')
  assert.equal((await rodar('valores.comparar', { valor: 100.02, referencia: 100 })).relacao, 'maior')
})

test('AMEAÇA: variação sobre base ZERO é null, e não infinito', async () => {
  const r = await rodar('valores.comparar', { valor: 5, referencia: 0 })
  assert.equal(r.variacaoPercentual, null, '"aumentou infinito" é uma pergunta mal formada')
  assert.equal(r.diferenca, 5, 'a diferença absoluta continua existindo e sendo útil')
})

// --- variação --------------------------------------------------------------------------------

test('ACEITAÇÃO: a variação da série vai do primeiro ao último ponto', async () => {
  const temperaturas = [{ temp: 4 }, { temp: 6 }, { temp: 9 }]
  const r = await rodar('serie.variacao', { registros: temperaturas, campo: 'temp' })
  assert.deepEqual({ de: r.de, para: r.para, diferenca: r.diferenca, pontos: r.pontos }, { de: 4, para: 9, diferenca: 5, pontos: 3 })
  assert.equal(Math.round(r.variacaoPercentual), 125)
})

test('AMEAÇA: um ponto só RECUSA — zero diria "não mudou", que é outra coisa', async () => {
  await assert.rejects(() => rodar('serie.variacao', { registros: [{ v: 10 }], campo: 'v' }), /ao menos 2 pontos/)
  // E texto que não é número não conta como ponto.
  await assert.rejects(() => rodar('serie.variacao', { registros: [{ v: 'a' }, { v: 'b' }], campo: 'v' }), /vieram 0/)
})

test('valor em texto vira número: "77131.82" e 77131.82 são o mesmo preço', async () => {
  const r = await rodar('serie.variacao', { registros: [{ p: '10.5' }, { p: '12.5' }], campo: 'p' })
  assert.equal(r.diferenca, 2)
})

// --- contar ----------------------------------------------------------------------------------

test('ACEITAÇÃO: contar por categoria ordena do maior para o menor', async () => {
  const pedidos = [{ st: 'pago' }, { st: 'pago' }, { st: 'pago' }, { st: 'aberto' }, { st: 'cancelado' }, { st: 'aberto' }]
  const r = await rodar('registros.contar_por', { registros: pedidos, campo: 'st' })
  assert.deepEqual(r.grupos, [{ valor: 'pago', quantos: 3 }, { valor: 'aberto', quantos: 2 }, { valor: 'cancelado', quantos: 1 }])
  assert.equal(r.total, 6)
})

test('AMEAÇA: o campo AUSENTE é contado à parte, e não vira um grupo chamado "undefined"', async () => {
  const r = await rodar('registros.contar_por', { registros: [{ st: 'a' }, {}, {}], campo: 'st' })
  assert.equal(r.semValor, 2)
  assert.deepEqual(r.grupos, [{ valor: 'a', quantos: 1 }], 'somar o ausente a um grupo inventaria uma categoria que ninguém tem')
})

test('AMEAÇA: empate tem ordem estável — uma função que muda de resposta não é determinística', async () => {
  const registros = [{ c: 'zebra' }, { c: 'alfa' }]
  const a = await rodar('registros.contar_por', { registros, campo: 'c' })
  const b = await rodar('registros.contar_por', { registros: [...registros].reverse(), campo: 'c' })
  assert.deepEqual(a.grupos, b.grupos)
})

// --- filtrar ---------------------------------------------------------------------------------

test('ACEITAÇÃO: filtrar devolve só quem passa, e conta quem passou', async () => {
  const leituras = [{ v: 5 }, { v: 15 }, { v: 25 }]
  const r = await rodar('registros.filtrar', { registros: leituras, campo: 'v', operador: 'gt', valor: 10 })
  assert.equal(r.quantos, 2)
  assert.deepEqual(r.registros.map((x) => x.v), [15, 25])
})

test('AMEAÇA: quem não tem o campo é IGNORADO, não reprovado', async () => {
  const r = await rodar('registros.filtrar', { registros: [{ v: 20 }, { outro: 1 }], campo: 'v', operador: 'gt', valor: 10 })
  assert.equal(r.quantos, 1)
  assert.equal(r.ignorados, 1, 'quem não tem o dado não passa nem reprova: ele não foi medido')
})

test('os seis operadores fazem o que dizem', async () => {
  const registros = [{ v: 10 }, { v: 20 }]
  const esperado = { gt: [20], gte: [10, 20], lt: [], lte: [10], eq: [10], ne: [20] }
  for (const [op, vs] of Object.entries(esperado)) {
    const r = await rodar('registros.filtrar', { registros, campo: 'v', operador: op, valor: 10 })
    assert.deepEqual(r.registros.map((x) => x.v), vs, op)
  }
})
