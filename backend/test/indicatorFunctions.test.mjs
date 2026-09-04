// O RSI — a conta que um modelo de linguagem não pode fazer.
//
// Um LLM responde "RSI 28,4" com a mesma confiança para qualquer série, e erra em silêncio.
// Estes casos travam três coisas: o número é o de Wilder (o que o gráfico da pessoa mostra),
// a mesma entrada dá sempre a mesma saída, e dado insuficiente é recusa com o que falta.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { calculateRsi, RSI_PERIODO_PADRAO } = await import('../dist/executors/indicatorFunctions.js')
const { findFunction } = await import('../dist/executors/functionRegistry.js')
await import('../dist/executors/functionExecutor.js')

/** A série clássica de Wilder — a mesma dos livros, para o número ser conferível. */
const WILDER = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
]

test('ACEITAÇÃO: o RSI de 14 na série de Wilder bate com o valor conhecido', () => {
  const r = calculateRsi(WILDER, 14)
  // O valor de referência da série de Wilder é ~70,53. Meio ponto de tolerância cobre o
  // arredondamento das casas publicadas nos livros, e não esconde uma fórmula errada.
  assert.ok(Math.abs(r.rsi - 70.53) < 0.5, `esperava ~70.53, veio ${r.rsi}`)
  assert.equal(r.period, 14)
  assert.equal(r.samples, 15)
  assert.equal(r.method, 'wilder')
})

test('DETERMINÍSTICO: a mesma série dá sempre o mesmo número', () => {
  const a = calculateRsi(WILDER, 14)
  const b = calculateRsi([...WILDER], 14)
  assert.deepEqual(a, b, 'uma média que muda entre duas perguntas iguais não é uma média')
})

test('dado INSUFICIENTE é recusa com o que falta — nunca uma estimativa', () => {
  assert.throws(
    () => calculateRsi(WILDER.slice(0, 8), 14),
    /precisa de 15 fechamentos; recebi 8. Faltam 7/,
    'um número sobre menos dados do que a definição pede é errado com cara de certo',
  )
})

test('série só de ALTA é 100 — e não uma divisão por zero', () => {
  const r = calculateRsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 14)
  assert.equal(r.rsi, 100)
  assert.ok(Number.isFinite(r.rsi), 'Infinity faria o monitor comparar contra o que nenhuma condição reconhece')
})

test('série PARADA é 50, e não NaN', () => {
  const r = calculateRsi(new Array(15).fill(10), 14)
  assert.equal(r.rsi, 50)
})

test('série só de BAIXA é 0', () => {
  const r = calculateRsi([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 14)
  assert.equal(r.rsi, 0)
})

test('AMEAÇA: valor que não é número é recusado, não coagido', () => {
  assert.throws(() => calculateRsi([1, 2, 'três', 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 14), /não é número/)
  assert.throws(() => calculateRsi([1, 2, NaN, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 14), /não é número/)
})

test('AMEAÇA: período inválido é recusado', () => {
  for (const p of [0, 1, -5, 1.5, 500]) {
    assert.throws(() => calculateRsi(WILDER, p), /período/, `${p} não é um período válido`)
  }
})

// --- o registro ------------------------------------------------------------------------------

test('a função está no registry, versionada e com schemas', () => {
  const fn = findFunction('calculate_rsi')
  assert.ok(fn, 'sem registro, nenhum agente consegue chamá-la')
  assert.equal(fn.version, '1.0.0')
  assert.equal(fn.inputSchema.required[0], 'closes')
  assert.deepEqual(fn.outputSchema.required.sort(), ['method', 'period', 'rsi', 'samples'])
  assert.equal(fn.metadata.deterministic, 'true')
  assert.ok(fn.timeoutMs > 0, 'uma função sem teto é uma execução que pode não terminar')
})

test('o handler usa o período padrão quando ninguém pede outro', () => {
  const fn = findFunction('calculate_rsi')
  assert.equal(fn.handler({ closes: WILDER }).period, RSI_PERIODO_PADRAO)
})

test('o handler recusa entrada sem `closes`, dizendo o que informar', () => {
  const fn = findFunction('calculate_rsi')
  assert.throws(() => fn.handler({}), /informe `closes`/)
})
