// A SIMULAÇÃO — o que aconteceria, sem tocar em estado.
//
// Ela existe porque "RSI cruzou 30 para cima" é uma frase que parece óbvia e engana: quem
// escreve não distingue ESTADO de BORDA até ver os dois lado a lado. Estes casos protegem
// exatamente essa diferença — e o fato de que simular não lê a memória de plantão, senão o
// resultado dependeria do que o monitor viu ontem.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { simulateMonitor } from '../dist/monitors/condition.js'

const RSI_BAIXO = { kind: 'compare', field: 'rsi', op: 'lt', value: 30 }

test('ENTER dispara na transição de falso para verdadeiro', () => {
  const r = simulateMonitor({ condition: RSI_BAIXO, triggerMode: 'enter', previous: { rsi: 55 }, value: { rsi: 22 } })
  assert.equal(r.conditionIsTrue, true)
  assert.equal(r.wouldTrigger, true)
  assert.match(r.explanation, /passou de falsa para verdadeira/)
})

test('ENTER NÃO dispara quando já era verdadeira: isso é estado, não borda', () => {
  const r = simulateMonitor({ condition: RSI_BAIXO, triggerMode: 'enter', previous: { rsi: 25 }, value: { rsi: 22 } })
  assert.equal(r.conditionIsTrue, true)
  assert.equal(r.wouldTrigger, false)
  assert.match(r.explanation, /já era verdadeira antes/)
})

test('LEVEL dispara sempre que a condição estiver verdadeira', () => {
  const r = simulateMonitor({ condition: RSI_BAIXO, triggerMode: 'level', previous: { rsi: 25 }, value: { rsi: 22 } })
  assert.equal(r.wouldTrigger, true)
  assert.match(r.explanation, /avisa sempre/)
})

test('sem valor anterior, CRUZAMENTO não acontece — mas ENTER sim, como no motor real', () => {
  // A simulação existe para PREVER o motor, não para discordar dele: `observe()` trata a
  // primeira observação como "era falsa", então `enter` dispara. Cruzamento precisa de
  // dois números, e um deles não existe.
  const entrar = simulateMonitor({ condition: RSI_BAIXO, triggerMode: 'enter', value: { rsi: 22 } })
  assert.equal(entrar.wouldTrigger, true)

  const cruzar = simulateMonitor({
    condition: { kind: 'compare', field: 'preco', op: 'gt', value: 100 },
    triggerMode: 'cross_up',
    threshold: 100,
    thresholdField: 'preco',
    value: { preco: 110 },
  })
  assert.equal(cruzar.wouldTrigger, false)
  assert.match(cruzar.explanation, /sem um valor anterior não existe travessia/)
})

test('CRUZAMENTO usa o campo e o limiar', () => {
  const sobe = simulateMonitor({
    condition: { kind: 'compare', field: 'preco', op: 'gt', value: 100 },
    triggerMode: 'cross_up',
    threshold: 100,
    thresholdField: 'preco',
    previous: { preco: 90 },
    value: { preco: 110 },
  })
  assert.equal(sobe.wouldTrigger, true)

  const naoCruza = simulateMonitor({
    condition: { kind: 'compare', field: 'preco', op: 'gt', value: 100 },
    triggerMode: 'cross_up',
    threshold: 100,
    thresholdField: 'preco',
    previous: { preco: 105 },
    value: { preco: 110 },
  })
  assert.equal(naoCruza.wouldTrigger, false, 'já estava acima: não houve travessia')
})

test('campo AUSENTE não vira zero na simulação', () => {
  // O mesmo defeito que o monitor já corrigiu uma vez: um campo que sumiu dispararia
  // "abaixo de 30" como se valesse zero.
  const r = simulateMonitor({ condition: RSI_BAIXO, triggerMode: 'enter', previous: { rsi: 55 }, value: {} })
  assert.equal(r.conditionIsTrue, false)
  assert.equal(r.wouldTrigger, false)
})

test('AST com AND e OR é simulada inteira', () => {
  const condicao = {
    kind: 'and',
    children: [
      { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
      { kind: 'or', children: [{ kind: 'compare', field: 'volume', op: 'gt', value: 1000 }, { kind: 'compare', field: 'alerta', op: 'eq', value: true }] },
    ],
  }
  const passa = simulateMonitor({ condition: condicao, triggerMode: 'enter', previous: { rsi: 55, volume: 10, alerta: false }, value: { rsi: 20, volume: 5000, alerta: false } })
  assert.equal(passa.wouldTrigger, true)

  const naoPassa = simulateMonitor({ condition: condicao, triggerMode: 'enter', previous: { rsi: 55, volume: 10, alerta: false }, value: { rsi: 20, volume: 5, alerta: false } })
  assert.equal(naoPassa.conditionIsTrue, false, 'o OR interno não foi satisfeito')
})

test('a prévia em português vem junto', () => {
  const r = simulateMonitor({ condition: RSI_BAIXO, triggerMode: 'enter', value: { rsi: 10 } })
  assert.equal(r.conditionText, 'rsi abaixo de 30')
})

test('condição inválida é recusada com o motivo', () => {
  // A simulação é PURA: ela mora no módulo da condição, que não abre o banco. Um teste que
  // precisasse de Mongo para conferir uma regra estaria medindo outra coisa.
  assert.throws(() => simulateMonitor({ condition: { kind: 'exec' }, triggerMode: 'enter', value: {} }), /desconhecido/)
  assert.throws(
    () => simulateMonitor({ condition: RSI_BAIXO, triggerMode: 'enter', value: {}, fields: ['preco'] }),
    /não existe nesta fonte/,
  )
})

test('simular NÃO toca em estado: duas simulações iguais dão o mesmo resultado', () => {
  const entrada = { condition: RSI_BAIXO, triggerMode: 'enter', previous: { rsi: 55 }, value: { rsi: 22 } }
  const a = simulateMonitor(entrada)
  const b = simulateMonitor(entrada)
  assert.deepEqual(a, b, 'quem simula quer entender a REGRA, não o que o monitor viu ontem')
})
