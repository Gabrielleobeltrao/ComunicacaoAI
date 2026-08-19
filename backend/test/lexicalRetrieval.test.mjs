// A metade determinística da recuperação: achar o que é EXATO.
//
// O defeito que ela existe para corrigir: a busca era só `$vectorSearch`, que precisa de
// Atlas Search e de um embedding da Voyage. Sem os dois — qualquer mongod próprio — nada
// era encontrado, e o agente dizia "não há dados" sobre uma base que tinha o dado.
//
// Aqui nada toca o banco: extração de termos, expansão de datas, nota e recorte. É o que
// decide se "BBSE3 em 10/08/2026" é achado quando a pergunta veio escrita de outro jeito.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { escapeRegex, expandirData, extractTerms, extractWindow, mesDoNome, normalize, scoreText, termsToPattern } = await import(
  '../dist/lexicalRetrieval.js'
)

const termos = (q) => extractTerms(q).map((t) => t.term)

// --- o que vale procurar ------------------------------------------------------------------

test('um ticker é termo específico, e sobrevive à pergunta inteira', () => {
  const t = extractTerms('qual era a cotação de BBSE3?')
  const bbse3 = t.find((x) => x.term === 'BBSE3')
  assert.ok(bbse3, 'BBSE3 precisa ser extraído')
  assert.ok(bbse3.weight > 1, 'um código identifica; uma palavra comum não')
})

test('uma data em português também é procurada no formato ISO', () => {
  assert.ok(termos('preço em 10/08/2026').includes('2026-08-10'))
  assert.ok(termos('preço em 10/08/2026').includes('10/08/2026'))
})

test('e uma data ISO também é procurada no formato brasileiro', () => {
  assert.ok(termos('preço em 2026-08-10').includes('10/08/2026'))
})

test('dia e mês de um dígito casam com a forma preenchida com zero', () => {
  const t = termos('em 1/2/2026')
  assert.ok(t.includes('01/02/2026'))
  assert.ok(t.includes('2026-02-01'))
})

test('um valor com centavos é termo específico', () => {
  const t = extractTerms('fechou em 36,42 naquele dia')
  const valor = t.find((x) => x.term === '36,42')
  assert.ok(valor && valor.weight > 1)
})

test('palavras de recheio não viram termo', () => {
  const t = termos('por favor me diga qual era o valor')
  assert.deepEqual(t, [])
})

test('a lista é limitada — uma pergunta longa não vira uma consulta gigante', () => {
  const longa = Array.from({ length: 80 }, (_, i) => `palavra${i}`).join(' ')
  assert.ok(extractTerms(longa).length <= 24)
})

// --- segurança da consulta ------------------------------------------------------------------

test('metacaracteres de regex são escapados', () => {
  assert.equal(escapeRegex('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o'), 'a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o')
})

test('um termo com sintaxe de regex não vira sintaxe no padrão', () => {
  // Sem escape, `.*` casaria com qualquer coisa — uma busca que devolve a base inteira.
  const padrao = termsToPattern([{ term: 'a.*b', weight: 1 }])
  assert.equal(padrao, 'a\\.\\*b')
  assert.equal(new RegExp(padrao).test('axxb'), false)
  assert.equal(new RegExp(padrao).test('a.*b'), true)
})

test('acento não separa palavras iguais', () => {
  assert.equal(normalize('Análise'), normalize('analise'))
})

// --- a nota ------------------------------------------------------------------------------

test('o trecho que tem o ticker E a data ganha do que tem só um', () => {
  const t = extractTerms('cotação de BBSE3 em 10/08/2026')
  const completo = scoreText('BBSE3 fechou em 10/08/2026 a R$ 36,42', t)
  const parcial = scoreText('BBSE3 é uma ação da bolsa brasileira', t)
  assert.ok(completo > parcial, `${completo} deveria ser maior que ${parcial}`)
})

test('só assunto em comum fica abaixo do piso e não chega ao prompt', () => {
  const t = extractTerms('cotação de BBSE3 em 10/08/2026')
  // "cotação" casa; nenhum identificador casa.
  assert.ok(scoreText('falamos sobre cotação ontem', t) < 0.5)
})

test('um identificador exato fica no piso ou acima — é evidência, não vizinhança', () => {
  const t = extractTerms('BBSE3')
  assert.ok(scoreText('a série de BBSE3 está anexa', t) >= 0.5)
})

test('nada casa, nota zero', () => {
  assert.equal(scoreText('texto sobre outra coisa inteiramente', extractTerms('BBSE3 10/08/2026')), 0)
})

test('sem termo nenhum, nota zero — e não uma divisão por zero', () => {
  assert.equal(scoreText('qualquer texto', []), 0)
})

// --- o recorte ---------------------------------------------------------------------------

test('a passagem devolvida cerca o termo mais específico', () => {
  const ruido = 'linha de enchimento. '.repeat(120)
  const texto = `${ruido}BBSE3 em 10/08/2026 fechou a R$ 36,42.${ruido}`
  const janela = extractWindow(texto, extractTerms('BBSE3 em 10/08/2026'), 400)
  assert.ok(janela.includes('36,42'), 'a resposta precisa estar dentro da janela')
  assert.ok(janela.length <= 400)
})

test('documento curto volta inteiro, sem recorte', () => {
  const curto = 'BBSE3 em 10/08/2026: R$ 36,42'
  assert.equal(extractWindow(curto, extractTerms('BBSE3'), 600), curto)
})

test('sem casar nada, devolve o começo — e não uma string vazia', () => {
  const texto = 'a'.repeat(1000)
  assert.equal(extractWindow(texto, extractTerms('BBSE3'), 100).length, 100)
})

// --- a data como as pessoas escrevem, e como as tabelas escrevem ---------------------------
//
// "4 de agosto" nunca encontrava "Aug 4, 2026" — e nem "04/08/2026" encontrava. Uma base
// exportada de qualquer serviço de cotação vem com o mês em inglês; a pergunta vem em
// português. Sem esta ponte, a busca respondia com o começo do documento, e o modelo
// entregava a linha errada com toda a confiança do mundo.

test('a data escrita por extenso vira termo de busca', () => {
  const t = termos('qual foi o valor da vale 4 de agosto ?')
  assert.ok(t.includes('4 de agosto'), 'a forma em português')
  assert.ok(t.some((x) => x.startsWith('aug 4')), 'a forma que a tabela usa')
})

test('a data numérica também procura a escrita em inglês', () => {
  const t = termos('VALE3 em 06/08/2026')
  assert.ok(t.includes('06/08/2026'))
  assert.ok(t.includes('2026-08-06'))
  assert.ok(t.includes('aug 6, 2026'), 'é assim que a linha está escrita no documento')
})

test('a data em inglês na pergunta encontra a escrita brasileira', () => {
  const t = termos('what happened on Aug 6, 2026?')
  assert.ok(t.includes('06/08/2026'))
  assert.ok(t.includes('6 de agosto de 2026'))
})

test('mês inventado não vira data', () => {
  assert.equal(mesDoNome('blurgo'), null)
  // "3 de abacaxi" não é uma data, e não pode virar termo de peso 4.
  const t = extractTerms('3 de abacaxi')
  assert.ok(!t.some((x) => x.weight === 4))
})

test('sem o ano, o dia não casa dentro de outro dia', () => {
  const formas = expandirData('4', '8')
  // "aug 4," e "aug 4 " existem porque as duas escritas existem — e as duas impedem que
  // "4" case dentro de "40".
  assert.ok(formas.includes('aug 4,'))
  assert.ok(!formas.some((f) => f === 'aug 4'), 'sem delimitador, casaria "Aug 40"')
})

test('a janela leva o cabeçalho da tabela junto', () => {
  const doc = ['Vale S.A. (VALE3.BA)', 'Currency in BRL.', 'Date Open High Low Close', ...Array.from({ length: 60 }, (_, i) => `Jul ${i + 1}, 2026 22,100.00`), 'Aug 6, 2026 23,760.00'].join('\n')
  const janela = extractWindow(doc, extractTerms('VALE3 em 6 de agosto'), 300)
  assert.match(janela, /Aug 6, 2026/, 'a linha pedida')
  assert.match(janela, /Date Open High Low Close/, 'e as colunas, senão qual número é a abertura é chute')
})
