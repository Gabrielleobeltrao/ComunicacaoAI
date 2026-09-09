// O QUE MUDOU, dito pelo servidor — e não pelo modelo.
//
// O DEFEITO QUE ISTO EXISTE PARA IMPEDIR, lido de uma conversa real de 46 mensagens:
//
//   dono:      "E pq está com web-chat, não vamos precisar disso"
//   assistente: "Você tem razão… vou ajustar a proposta removendo qualquer canal"
//   dono:      "E pq está com web-chat, não vamos precisar disso"   ← de novo, igual
//   assistente: "Você tem razão… vou remover"
//   aplicação: ["channel","created","canal do site criado e apontado para quem recebe"]
//
// E seis respostas seguidas começando por "Ajustei", "Montei", "Redesenhei do zero", com o
// plano idêntico entre elas.
//
// A resposta é escrita pelo modelo; o plano é montado pelo compilador; ninguém compara os
// dois. O problema não é o Assistente errar — é ele DIZER QUE FEZ. Aqui o servidor passa a
// dizer o que aconteceu de verdade, e a frase do modelo deixa de ser a única fonte.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { resumoDaMudanca } = await import('../dist/assistant/diff.js')

test('nada mudou: a resposta DIZ que nada mudou', () => {
  const r = resumoDaMudanca([], [])
  assert.match(r, /nada mudou/i)
})

test('o que foi criado e removido aparece com nome', () => {
  const r = resumoDaMudanca(
    [
      { kind: 'agent', key: 'a1', label: 'Marina', change: 'added', fields: [] },
      { kind: 'app', key: 'canal-web_chat', label: 'web_chat', change: 'removed', fields: [] },
    ],
    [],
  )
  assert.match(r, /Marina/)
  assert.match(r, /web_chat/)
  assert.match(r, /criei|adicionei/i)
  assert.match(r, /removi|tirei/i)
})

test('a mudança de um item existente diz QUAIS campos', () => {
  const r = resumoDaMudanca([{ kind: 'routine', key: 'r1', label: 'Resumo diário', change: 'changed', fields: ['horário', 'fuso'] }], [])
  assert.match(r, /Resumo diário/)
  assert.match(r, /horário/)
})

test('as pendências entram junto — é o que a pessoa precisa resolver', () => {
  const r = resumoDaMudanca([], [{ kind: 'routine_time', ref: 'Máximo diário', because: 'confirme o horário' }])
  assert.match(r, /Máximo diário/)
  assert.match(r, /confirme o horário/)
})

test('AMEAÇA: uma lista enorme não vira parede de texto', () => {
  // Uma resposta que não cabe na tela não é informação, é ruído — e o ruído esconde
  // justamente a linha que importava.
  const muitas = Array.from({ length: 40 }, (_, i) => ({ kind: 'agent', key: `a${i}`, label: `Agente ${i}`, change: 'added', fields: [] }))
  const r = resumoDaMudanca(muitas, [])
  assert.ok(r.split('\n').length <= 12, `resumo com ${r.split('\n').length} linhas`)
  assert.match(r, /\+ ?\d+|mais \d+|outros/i, 'precisa dizer quantos ficaram de fora')
})

// --- Fase 6: a repetição vira sinal -----------------------------------------------------
//
// Na conversa real o dono escreveu "E pq está com web-chat, não vamos precisar disso" e
// repetiu a MESMA frase, palavra por palavra. E "Anexa para mim" duas vezes. E "Corrige a
// proposta" / "Crie uma nova proposta" quatro vezes em variações.
//
// Nada percebeu. Cada rodada respondeu com uma frase animada e nova sobre um plano que não
// mudava — o que ensina a pessoa a repetir mais alto, e depois a desistir.
//
// Repetir é informação: quer dizer que a resposta anterior não resolveu. Quando o pedido
// volta E o plano não mudou, o servidor para de redigir novidade e diz o que está travando.

const { ehRepeticaoSemEfeito } = await import('../dist/assistant/diff.js')

test('a mesma frase duas vezes, com o plano igual, É repetição', () => {
  assert.equal(ehRepeticaoSemEfeito('E pq está com web-chat, não vamos precisar disso', ['oi', 'E pq está com web-chat, não vamos precisar disso'], []), true)
})

test('quase a mesma frase também conta — ninguém repete igualzinho', () => {
  assert.equal(ehRepeticaoSemEfeito('e por que está com web chat? não vamos precisar', ['E pq está com web-chat, não vamos precisar disso'], []), true)
})

test('AMEAÇA: se o plano MUDOU, repetir não é sintoma — é continuar', () => {
  // A pessoa pode repetir para reforçar algo que já está sendo feito. Acusar travamento aí
  // seria o sistema chamando de inútil um trabalho que aconteceu.
  const mudou = [{ kind: 'agent', key: 'a1', label: 'Marina', change: 'added', fields: [] }]
  assert.equal(ehRepeticaoSemEfeito('tira o web chat', ['tira o web chat'], mudou), false)
})

test('assunto novo não é repetição', () => {
  assert.equal(ehRepeticaoSemEfeito('agora quero avisar no slack', ['tira o web chat'], []), false)
})

test('o resumo de uma repetição sem efeito DIZ que está travado', () => {
  const r = resumoDaMudanca([], [], { repetido: true })
  assert.match(r, /pediu isto de novo|já tinha pedido|não mudou/i)
})

// --- a repetição que NÃO era repetição --------------------------------------------------
//
// DE UM TESTE REAL, e é um defeito meu. O dono escreveu "quero montar um agente" e, na
// mensagem seguinte, "Quero criar um agente para salvar em uma nova database o valor mínimo
// do dia do bitcoin" — um pedido novo, com todo o conteúdo. E recebeu de volta:
//
//   "Você pediu isto de novo e o plano continua igual"
//
// A conta era `comuns / Math.min(a, b)`: a frase curta anterior tinha duas palavras
// significativas, "agente" aparecia nas duas, e 1/2 já batia o limiar. Uma abertura vaga
// passava a "contaminar" qualquer pedido seguinte que repetisse uma só palavra dela.
//
// Acusar repetição onde houve pedido novo é pior que não acusar nenhuma: o sistema diz que
// não vai fazer nada logo na primeira vez que a pessoa explica o que quer.

test('AMEAÇA: uma abertura vaga não transforma o pedido seguinte em repetição', () => {
  assert.equal(
    ehRepeticaoSemEfeito('Quero criar um agente para salvar em uma nova database o valor mínimo do dia do bitcoin', ['quero montar um agente'], []),
    false,
  )
})

test('AMEAÇA: frase curta demais não serve de base para acusar', () => {
  // "ok", "isso", "sim" repetidos não são o mesmo pedido feito de novo.
  assert.equal(ehRepeticaoSemEfeito('isso mesmo', ['isso'], []), false)
})

test('e a repetição de VERDADE continua sendo vista', () => {
  const mesma = 'E pq está com web-chat, não vamos precisar disso'
  assert.equal(ehRepeticaoSemEfeito(mesma, ['oi', mesma], []), true)
  assert.equal(ehRepeticaoSemEfeito('e por que está com web chat? não vamos precisar dele', [mesma], []), true)
})
