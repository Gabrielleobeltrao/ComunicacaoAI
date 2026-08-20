// Um documento grande não pode ficar SEM trechos.
//
// `embedTexts` mandava o documento inteiro numa requisição só. Funciona enquanto o
// documento é pequeno e falha inteiro quando não é — e "falha inteiro" quer dizer
// documento com zero trechos: o texto fica guardado, aparece na tela de Conhecimento, e
// a busca não alcança nada dele.
//
// Foi exatamente o que aconteceu com uma página de tabela: ela cabe nos 20 mil
// caracteres que a leitura guarda, e não cabe numa chamada só. Na ponta, o agente
// respondeu "não tenho acesso a esse tipo de dado" com a resposta na própria base.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { loteDeTextos } = await import('../dist/voyage.js')
const { chunkText } = await import('../dist/knowledge.js')

test('respeita o teto de ITENS por requisição', () => {
  const lotes = loteDeTextos(Array.from({ length: 150 }, () => 'x'), 64, 1_000_000)
  assert.deepEqual(lotes.map((l) => l.length), [64, 64, 22])
})

test('respeita o teto de TAMANHO, mesmo com poucos itens', () => {
  const grande = 'a'.repeat(30_000)
  const lotes = loteDeTextos([grande, grande, grande, grande], 64, 80_000)
  // Dois cabem em 80 mil; o terceiro abre lote novo.
  assert.deepEqual(lotes.map((l) => l.length), [2, 2])
})

test('um item sozinho maior que o teto vai sozinho, e inteiro', () => {
  // Cortar aqui mudaria o conteúdo indexado sem que ninguém soubesse.
  const gigante = 'b'.repeat(200_000)
  const lotes = loteDeTextos(['curto', gigante, 'curto'], 64, 80_000)
  assert.equal(lotes.flat().join('').length, 200_000 + 10)
  assert.ok(lotes.some((l) => l.length === 1 && l[0].length === 200_000))
})

test('nada se perde e a ORDEM se mantém — o embedding volta por posição', () => {
  const textos = Array.from({ length: 137 }, (_, i) => `trecho ${i}`)
  const lotes = loteDeTextos(textos, 64, 80_000)
  assert.deepEqual(lotes.flat(), textos)
})

test('lista vazia não vira requisição', () => {
  assert.deepEqual(loteDeTextos([]), [])
})

test('a página de tabela que quebrava agora entra em vários lotes', () => {
  // O tamanho real: o teto de uma leitura de página são 20 mil caracteres.
  const tabela = Array.from({ length: 400 }, (_, i) => `Dia: ${i} | Abertura: 71.${i} | Fechamento: 72.${i} | Volume: ${i}00.000`).join('\n')
  const trechos = chunkText(`Histórico\nFonte: https://exemplo.test/x\n\n${tabela}`)
  assert.ok(trechos.length > 1, 'uma tabela dessas não é um trecho só')
  const lotes = loteDeTextos(trechos)
  assert.deepEqual(lotes.flat(), trechos, 'nada se perde ao dividir')
  for (const lote of lotes) {
    assert.ok(lote.length <= 64)
    assert.ok(lote.reduce((s, t) => s + t.length, 0) <= 80_000 || lote.length === 1)
  }
})
