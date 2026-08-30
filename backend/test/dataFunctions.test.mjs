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

// ============================================================================
// O segundo lote: ordenar, cruzar, limpar texto, formatar e ler série
// ============================================================================

test('ordena por número como número — e não como texto', async () => {
  // A armadilha clássica: comparando como texto, "10" vem antes de "9".
  const r = await rodar('lista.ordenar', { items: [{ v: 9 }, { v: 10 }, { v: 2 }], por: 'v' })
  assert.deepEqual(r.items.map((i) => i.v), [2, 9, 10])

  const desc = await rodar('lista.ordenar', { items: [{ v: 9 }, { v: 10 }], por: 'v', ordem: 'decrescente' })
  assert.deepEqual(desc.items.map((i) => i.v), [10, 9])

  // Texto ordena como texto, respeitando acento.
  const txt = await rodar('lista.ordenar', { items: [{ n: 'Ísis' }, { n: 'Ana' }, { n: 'Bruno' }], por: 'n' })
  assert.deepEqual(txt.items.map((i) => i.n), ['Ana', 'Bruno', 'Ísis'])
})

test('ordenar com limite devolve os primeiros, e conta o total', async () => {
  const r = await rodar('lista.ordenar', { items: [{ v: 1 }, { v: 5 }, { v: 3 }], por: 'v', ordem: 'decrescente', limite: 2 })
  assert.equal(r.count, 3, 'o total continua sendo o da lista inteira')
  assert.deepEqual(r.items.map((i) => i.v), [5, 3])
})

test('unicos mantém o PRIMEIRO de cada e conta quantos saíram', async () => {
  const r = await rodar('lista.unicos', {
    items: [{ e: 'a@x.com', n: 1 }, { e: 'b@x.com', n: 2 }, { e: 'a@x.com', n: 3 }],
    por: 'e',
  })
  assert.equal(r.count, 2)
  assert.equal(r.removidos, 1)
  assert.equal(r.items[0].n, 1, 'o primeiro vence — o terceiro é a repetição')
})

test('juntar cruza duas listas, e o item principal manda nos campos repetidos', async () => {
  const r = await rodar('lista.juntar', {
    items: [{ id: 1, nome: 'Ana', origem: 'principal' }, { id: 2, nome: 'Bruno' }],
    com: [{ id: 1, plano: 'ouro', origem: 'secundaria' }],
    chave: 'id',
  })
  assert.equal(r.count, 2)
  assert.equal(r.semPar, 1)
  assert.equal(r.items[0].plano, 'ouro', 'trouxe o campo da segunda lista')
  assert.equal(r.items[0].origem, 'principal', 'quem chamou pediu para enriquecer, não para sobrescrever')
  assert.equal(r.items[1].plano, undefined, 'sem par, fica como estava')
})

test('juntar por chaves de nomes diferentes, e descartando quem não achou par', async () => {
  const r = await rodar('lista.juntar', {
    items: [{ sku: 'A' }, { sku: 'B' }],
    com: [{ codigo: 'A', preco: 10 }],
    chave: 'sku',
    chaveDe: 'codigo',
    somenteComPar: true,
  })
  assert.equal(r.count, 1)
  assert.equal(r.items[0].preco, 10)
})

test('mesclar: o segundo manda, e profundo junta os de dentro', async () => {
  const raso = await rodar('json.mesclar', { base: { a: 1, c: { x: 1 } }, sobrepor: { a: 2, c: { y: 2 } } })
  assert.deepEqual(raso.resultado, { a: 2, c: { y: 2 } }, 'raso substitui o objeto inteiro')

  const fundo = await rodar('json.mesclar', { base: { a: 1, c: { x: 1 } }, sobrepor: { c: { y: 2 } }, profundo: true })
  assert.deepEqual(fundo.resultado, { a: 1, c: { x: 1, y: 2 } })
})

test('mesclar não deixa passar nome que mexe no protótipo', async () => {
  const r = await rodar('json.mesclar', { base: { a: 1 }, sobrepor: JSON.parse('{"__proto__":{"poluido":true},"b":2}') })
  assert.equal(r.resultado.b, 2)
  assert.equal(({}).poluido, undefined, 'o protótipo continua limpo')
})

test('normalizar tem as quatro formas', async () => {
  const t = '  Olá   Mundo Ção  '
  assert.equal((await rodar('texto.normalizar', { texto: t })).resultado, 'Olá Mundo Ção')
  assert.equal((await rodar('texto.normalizar', { texto: t, forma: 'minusculas' })).resultado, 'olá mundo ção')
  assert.equal((await rodar('texto.normalizar', { texto: t, forma: 'sem_acento' })).resultado, 'Ola Mundo Cao')
  assert.equal((await rodar('texto.normalizar', { texto: t, forma: 'identificador' })).resultado, 'ola-mundo-cao')
})

test('preencher troca os campos e AVISA o que faltou', async () => {
  const r = await rodar('texto.preencher', {
    modelo: 'Olá, {{cliente.nome}}. Seu pedido {{pedido}} está {{status}}.',
    dados: { cliente: { nome: 'Ana' }, pedido: 42 },
  })
  assert.equal(r.resultado, 'Olá, Ana. Seu pedido 42 está .')
  // Um texto com buraco parece pronto — quem chamou precisa poder decidir se manda.
  assert.deepEqual(r.faltantes, ['status'])

  const mantido = await rodar('texto.preencher', { modelo: 'Oi {{x}}', dados: {}, manterFaltantes: true })
  assert.equal(mantido.resultado, 'Oi {{x}}')
})

test('preencher não resolve caminho que mexe no protótipo', async () => {
  const r = await rodar('texto.preencher', { modelo: '{{__proto__.x}}|{{constructor}}', dados: { a: 1 } })
  assert.equal(r.resultado, '|')
})

test('extrair conhece os padrões, tira repetidos e recusa o que não está na lista', async () => {
  const texto = 'Fale com ana@x.com ou ana@x.com. Site: https://exemplo.test/a. CEP 01310-100.'
  assert.deepEqual((await rodar('texto.extrair', { texto, tipo: 'email' })).encontrados, ['ana@x.com'])
  assert.deepEqual((await rodar('texto.extrair', { texto, tipo: 'url' })).encontrados, ['https://exemplo.test/a.'])
  assert.deepEqual((await rodar('texto.extrair', { texto, tipo: 'cep' })).encontrados, ['01310-100'])
  // Sem expressão regular de fora: dar esse poder a quem chama é dar como travar o
  // processo com uma expressão que não termina.
  assert.match(await recusa('texto.extrair', { texto, tipo: '(a+)+$' }), /fora do contrato|escolha um de/)
})

test('formatar usa o fuso pedido — o horário é o de quem lê', async () => {
  const data = '2026-03-10T14:00:00Z'
  const sp = await rodar('data.formatar', { data, fuso: 'America/Sao_Paulo', formato: 'hora' })
  const utc = await rodar('data.formatar', { data, fuso: 'UTC', formato: 'hora' })
  assert.equal(utc.resultado, '14:00')
  assert.equal(sp.resultado, '11:00', 'São Paulo é UTC-3')
  assert.equal(sp.iso, '2026-03-10T14:00:00.000Z', 'o instante não muda — muda como se escreve')
})

test('formatar recusa fuso desconhecido em vez de devolver a hora errada', async () => {
  assert.match(await recusa('data.formatar', { data: '2026-03-10T14:00:00Z', fuso: 'Marte/Olympus' }), /desconhecido/)
  assert.match(await recusa('data.formatar', { data: 'ontem' }), /ISO 8601/)
})

test('serie lê variação, tendência, mediana e percentil', async () => {
  const r = await rodar('math.serie', { values: [100, 110, 105, 120], percentil: 50 })
  assert.equal(r.count, 4)
  assert.equal(r.primeiro, 100)
  assert.equal(r.ultimo, 120)
  assert.equal(r.variacao, 20)
  assert.equal(r.variacaoPercentual, 20)
  assert.equal(r.tendencia, 'subindo')
  assert.equal(r.mediana, 107.5)
  assert.equal(r.percentil, 107.5, 'o percentil 50 é a mediana')
})

test('variação de um centavo é ESTÁVEL — agir sobre ruído é pior que não agir', async () => {
  assert.equal((await rodar('math.serie', { values: [1000, 1000.5] })).tendencia, 'estavel')
  assert.equal((await rodar('math.serie', { values: [1000, 900] })).tendencia, 'descendo')
})

test('sair de zero não tem variação percentual', async () => {
  // Dividir por zero daria infinito, e "cresceu infinito por cento" não é resposta.
  const r = await rodar('math.serie', { values: [0, 50] })
  assert.equal(r.variacao, 50)
  assert.equal(r.variacaoPercentual, null)
})

test('série vazia responde sem dados, e não com zeros', async () => {
  const r = await rodar('math.serie', { values: [] })
  assert.equal(r.count, 0)
  assert.equal(r.tendencia, 'sem_dados')
  assert.equal(r.mediana, null, 'zero seria um valor, e não é o caso')
})
