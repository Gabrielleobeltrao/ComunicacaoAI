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

const { resumoDaMudanca, tamanhoDaJanela } = await import('../dist/assistant/diff.js')

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

// --- O QUE A PROPOSTA VAI GRAVAR -------------------------------------------------------------
//
// O diff só conhece o Blueprint V1, que não tem `histories`: a série resumida por janela não
// aparecia em "Criei:", então a ÚNICA coisa descrevendo ela era a prosa do modelo — e a prosa
// passou cinco rodadas dizendo "depende de uma função determinística que não existe".

const janelaDoBitcoin = () => [{ nome: 'minimo e maximo a cada 5 min', contas: ['minimo', 'maximo'], campo: 'price', everyMs: 300_000 }]

test('a janela entra no resumo do SERVIDOR, com a conta e o campo', () => {
  const r = resumoDaMudanca([], [], { janelas: janelaDoBitcoin() })
  assert.match(r, /\*\*Vai gravar:\*\*/)
  assert.match(r, /minimo e maximo/)
  assert.match(r, /"price"/, 'sem o campo, "vai gravar o mínimo" não diz o mínimo DE QUE')
  assert.match(r, /a cada 5 min/)
  // O desmentido, na mesma mensagem em que o modelo pode ter hedgeado.
  assert.match(r, /sem função a cadastrar/)
})

test('janela em segundos é dita em segundos — 5 min e 30s não são a mesma coisa', () => {
  const r = resumoDaMudanca([], [], { janelas: [{ nome: 'x', contas: ['media'], campo: 'temp', everyMs: 30_000 }] })
  assert.match(r, /a cada 30s/)
})

test('sem janela nenhuma, o resumo não inventa a linha', () => {
  assert.doesNotMatch(resumoDaMudanca([], [], {}), /Vai gravar/)
  assert.doesNotMatch(resumoDaMudanca([], []), /Vai gravar/)
})

test('AMEAÇA: o tamanho da janela nunca é arredondado para outro número', () => {
  // A pessoa confere o número da série contra o intervalo que ela pediu. "30 segundos"
  // reportado como "1 min" é a mentira silenciosa que mais custa aqui.
  const casos = [
    [30_000, '30s'],
    [15_000, '15s'],
    [60_000, '1 min'],
    [300_000, '5 min'],
    [90_000, '1.5 min'],
    [3_600_000, '1 h'],
  ]
  for (const [ms, esperado] of casos) assert.equal(tamanhoDaJanela(ms), esperado, `${ms}ms`)
})

// --- O PLANO QUE SÓ EXISTE NO V2 -------------------------------------------------------------
//
// Da conta do dono, quatro rodadas seguidas: o texto do modelo descrevendo a base nascendo
// ("Uma nova base de dados de histórico", "Um conjunto dentro dessa base", "Uma janela de
// consolidação"), e logo abaixo, escrito pelo servidor, **Nada mudou na proposta nesta
// rodada.** Base, conjunto, fonte e janela vivem só no V2, e o diff só conhecia o V1.
//
// É o defeito que esta suíte inteira existe para impedir, com os papéis invertidos: aqui o
// modelo estava certo e o servidor é que contava outra história.

const { diffBlueprints } = await import('../dist/assistant/diff.js')

const v1Vazio = { version: 1, title: 'X', objective: 'Y', floors: [], agents: [], sectors: [], routines: [], appRequirements: [], knowledgeRequirements: [] }

const v2Com = (over) => ({
  version: 2,
  organization: { floors: [], sectors: [], agents: [] },
  resources: { knowledge: [], memoryPolicies: [], appRequirements: [], databases: [], datasets: [], tools: [] },
  operations: { channels: [], sources: [], liveDestinations: [], histories: [], monitors: [], flows: [], routines: [], deliveries: [] },
  ...over,
})

test('a base, o conjunto e a janela que só existem no V2 ENTRAM no que mudou', () => {
  const depois = v2Com({
    resources: { knowledge: [], memoryPolicies: [], appRequirements: [], tools: [], databases: [{ key: 'base-x', action: 'create', name: 'Histórico consolidado' }], datasets: [{ key: 'conj-x', action: 'create', name: 'Consolidado 10min' }] },
    operations: { channels: [], sources: [], liveDestinations: [], monitors: [], flows: [], routines: [], deliveries: [], histories: [{ key: 'jan-x', action: 'create', name: 'minimo e maximo a cada 10 min' }] },
  })
  const m = diffBlueprints(v1Vazio, v1Vazio, { antes: v2Com({}), depois })
  assert.deepEqual(
    m.map((x) => `${x.kind}:${x.change}:${x.label}`).sort(),
    ['database:added:Histórico consolidado', 'dataset:added:Consolidado 10min', 'history:added:minimo e maximo a cada 10 min'],
  )
  assert.match(resumoDaMudanca(m, []), /Criei/)
})

test('AMEAÇA: reaproveitar NÃO é criar — a base que já existia fica de fora', () => {
  const depois = v2Com({
    resources: { knowledge: [], memoryPolicies: [], appRequirements: [], tools: [], datasets: [], databases: [{ key: 'base-historicos', action: 'reuse', name: 'Históricos' }] },
  })
  const m = diffBlueprints(v1Vazio, v1Vazio, { antes: v2Com({}), depois })
  assert.deepEqual(m, [], '"Criei: Históricos" manda a pessoa procurar uma base duplicada que ela não tem')
})

test('`null` de qualquer lado é "não há o que comparar" — e o chat passa o escritório VAZIO', () => {
  const depois = { ...v1Vazio, agents: [{ key: 'a1', name: 'Marina', action: 'create' }] }
  // A TELA de mudanças compara duas revisões: na primeira proposta não existe a anterior.
  assert.deepEqual(diffBlueprints(null, depois), [])
  assert.deepEqual(diffBlueprints(v1Vazio, null), [])
  assert.deepEqual(diffBlueprints(null, null, { antes: v2Com({}), depois: null }), [])
  assert.deepEqual(diffBlueprints(v1Vazio, v1Vazio, { antes: null, depois: v2Com({}) }), [])
  // O RESUMO DA CONVERSA passa o vazio, porque era isso que a conta tinha.
  assert.deepEqual(diffBlueprints(v1Vazio, depois).map((x) => `${x.change}:${x.label}`), ['added:Marina'])
})

test('a janela que teve o tamanho trocado aparece como ALTERADA, e diz o campo', () => {
  const janela = (everyMs) =>
    v2Com({ operations: { channels: [], sources: [], liveDestinations: [], monitors: [], flows: [], routines: [], deliveries: [], histories: [{ key: 'jan-x', action: 'create', name: 'a série', window: { everyMs, rules: [] } }] } })
  const m = diffBlueprints(v1Vazio, v1Vazio, { antes: janela(300_000), depois: janela(600_000) })
  assert.equal(m.length, 1)
  assert.equal(m[0].change, 'changed')
  assert.ok(m[0].fields.length > 0, 'trocar 5 min por 10 min sem dizer o que mudou é a revisão invisível')
})
