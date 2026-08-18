// A pergunta com alternativas em TEXTO, e a resposta curta entendida sem modelo.
//
// Botão não existe em WhatsApp, e-mail nem SMS — e é para lá que estas conversas vão. Uma
// interface que só funciona no Playground é uma demonstração, não uma interface. Então as
// alternativas são escritas, e "2" é lido aqui: mandar o número cru adiante gastaria uma
// inferência para adivinhar o que já está na tela, e erraria justamente quando a conversa
// é longa e a lista ficou para trás.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { formatOptions, resolveChoice } = await import('../dist/clarifyChoice.js')

const OPCOES = ['A que enviamos', 'A que recebemos']

// --- a pergunta escrita ------------------------------------------------------------------

test('as alternativas saem numeradas, com instrução de como responder', () => {
  const texto = formatOptions(OPCOES)
  assert.match(texto, /1\) A que enviamos/)
  assert.match(texto, /2\) A que recebemos/)
  assert.match(texto, /número da opção/i)
  assert.match(texto, /ou escreva sua resposta/i, 'quem não quer nenhuma precisa saber que pode escrever')
})

test('sem alternativas, nada é acrescentado à resposta', () => {
  assert.equal(formatOptions([]), '')
  assert.equal(formatOptions(['   ']), '')
})

test('a lista tem teto — nove alternativas já é uma lista que ninguém lê', () => {
  const muitas = Array.from({ length: 20 }, (_, i) => `opção ${i}`)
  assert.equal(formatOptions(muitas).match(/^\d\)/gm).length, 9)
})

// --- a resposta lida ---------------------------------------------------------------------

test('o número vira a alternativa, escrito de várias formas', () => {
  for (const resposta of ['2', '2)', '2.', ' 2 ', 'opção 2', 'Alternativa 2', 'nº 2']) {
    assert.equal(resolveChoice(resposta, OPCOES), 'A que recebemos', resposta)
  }
})

test('a letra também, porque cada canal tem seu costume', () => {
  for (const resposta of ['a', 'A)', 'letra a']) {
    assert.equal(resolveChoice(resposta, OPCOES), 'A que enviamos', resposta)
  }
})

test('número fora da lista não escolhe nada', () => {
  assert.equal(resolveChoice('7', OPCOES), null)
  assert.equal(resolveChoice('0', OPCOES), null)
})

test('o texto da opção vale, com ou sem acento e maiúscula', () => {
  assert.equal(resolveChoice('a que ENVIAMOS', OPCOES), 'A que enviamos')
  assert.equal(resolveChoice('A que recebemos', OPCOES), 'A que recebemos')
})

test('um pedaço que identifica UMA opção também vale', () => {
  assert.equal(resolveChoice('enviamos', OPCOES), 'A que enviamos')
})

test('um pedaço ambíguo NÃO escolhe — escolher aí seria adivinhar', () => {
  // "que" está nas duas: preferir uma seria decidir pelo visitante.
  assert.equal(resolveChoice('que', OPCOES), null)
})

test('uma frase inteira é resposta livre, e não escolha da lista', () => {
  // Quem escreveu uma frase não quis escolher; tratar como opção apagaria o que ele disse.
  assert.equal(resolveChoice('na verdade quero as duas, do mês passado', OPCOES), null)
})

test('sem alternativas, não há o que resolver', () => {
  assert.equal(resolveChoice('2', []), null)
  assert.equal(resolveChoice('', OPCOES), null)
})
