// AS FERRAMENTAS DO ASSISTENTE — e a recusa que volta.
//
// O compilador só entendia o que alguém escreveu regex para entender. Aqui o modelo preenche
// estrutura e o código recusa com a razão — e a razão é o que ele usa para corrigir na mesma
// rodada, em vez de o item ser descartado em silêncio.
//
// Cada caso usa um assunto diferente de propósito: o assunto nunca se repete entre contas, e
// uma regra que só acerta no exemplo que estava na mesa está errada.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { ferramentasDoAssistente, rascunhoVazio } = await import('../dist/assistant/assistantTools.js')

const inventarioCom = (fontes) => ({
  ownerId: 'dono',
  at: new Date(),
  building: { id: 'b1', name: 'Prédio' },
  sections: {
    source: {
      kind: 'source',
      total: fontes.length,
      truncated: false,
      items: fontes.map(([label, fields], i) => ({ id: `s${i}`, label, ownerScope: 'account', meta: { fields } })),
    },
  },
})

const montar = (fontes = []) => {
  const rascunho = rascunhoVazio()
  const fs = ferramentasDoAssistente({ inventory: fontes.length ? inventarioCom(fontes) : null, rascunho })
  const pegar = (nome) => fs.find((f) => f.name === nome)
  return { rascunho, pegar }
}

// --- o catálogo ------------------------------------------------------------------------------

test('as ferramentas se declaram com schema — é o schema que impede plano malformado', () => {
  const { pegar } = montar()
  for (const nome of ['ver_inventario', 'propor_janela', 'perguntar']) {
    const f = pegar(nome)
    assert.ok(f, `faltou a ferramenta ${nome}`)
    assert.equal(f.inputSchema.type, 'object', `${nome} sem schema de objeto`)
    assert.ok(f.description.length > 40, `${nome} sem descrição que ensine a preencher`)
  }
  // Ler e escrever são coisas diferentes: só leitura ganha paralelismo no laço.
  assert.equal(pegar('ver_inventario').risk, 'read')
  assert.equal(pegar('propor_janela').risk, 'write')
})

// --- ver_inventario --------------------------------------------------------------------------

test('ver_inventario devolve o que a conta TEM, com os campos de cada fonte', async () => {
  const { pegar } = montar([['Estoque', 'sku, quantidade, atualizado_em']])
  const r = await pegar('ver_inventario').run({})
  assert.equal(r.ok, true)
  assert.match(r.result, /Estoque/)
  assert.match(r.result, /quantidade/, 'sem os campos, o modelo inventa o nome do campo')
})

test('sem inventário, ele DIZ que não sabe — não devolve vazio parecendo conta vazia', async () => {
  const { pegar } = montar()
  const r = await pegar('ver_inventario').run({})
  assert.equal(r.ok, true)
  assert.match(r.result, /não consegui ler/i)
  assert.doesNotMatch(r.result, /ainda não tem nada criado/, 'não saber é diferente de estar vazio')
})

// --- propor_janela: o que ela aceita ---------------------------------------------------------

test('ACEITAÇÃO: uma janela bem preenchida entra no rascunho, e nada é criado', async () => {
  const { rascunho, pegar } = montar([['Sensor da câmara fria', 'temperatura, lido_em']])
  const r = await pegar('propor_janela').run({ fonte: 'Sensor da câmara fria', campo: 'temperatura', intervaloMs: 600_000, contas: ['min', 'max'] })
  assert.equal(r.ok, true, r.result)
  assert.match(r.result, /Nada foi criado ainda/, 'a ferramenta não pode dar a entender que criou')
  assert.deepEqual(rascunho.janelas, [{ source: 'Sensor da câmara fria', field: 'temperatura', everyMs: 600_000, ops: ['min', 'max'] }])
})

// --- propor_janela: as regras que ela carrega ------------------------------------------------

test('AMEAÇA: resumir o RELÓGIO é recusado — é o erro que não quebra nada e mente sempre', async () => {
  const { rascunho, pegar } = montar([['Pedidos', 'valor_total, criado_em']])
  for (const campo of ['criado_em', 'timestamp', 'data_do_pedido', 'created_at']) {
    const r = await pegar('propor_janela').run({ fonte: 'Pedidos', campo, intervaloMs: 300_000, contas: ['min'] })
    assert.equal(r.ok, false, `aceitou resumir "${campo}"`)
    assert.match(r.result, /^recusado:/, 'a recusa tem de começar por "recusado" para o modelo não a ler como resultado')
    assert.match(r.result, /carimbo de tempo/)
  }
  assert.equal(rascunho.janelas.length, 0)
})

test('AMEAÇA: um campo que a fonte não tem é recusado, e a recusa LISTA os que ela tem', async () => {
  const { pegar } = montar([['Cotação', 'preco, capturado_em']])
  const r = await pegar('propor_janela').run({ fonte: 'Cotação', campo: 'volume', intervaloMs: 300_000, contas: ['avg'] })
  assert.equal(r.ok, false)
  assert.match(r.result, /não tem o campo "volume"/)
  assert.match(r.result, /preco/, 'sem dizer quais existem, o modelo chuta de novo')
})

test('AMEAÇA: janela sem tamanho, sem campo ou sem conta é recusada, cada uma com sua razão', async () => {
  const { pegar } = montar()
  const semTamanho = await pegar('propor_janela').run({ fonte: 'X', campo: 'valor', intervaloMs: 0, contas: ['sum'] })
  assert.match(semTamanho.result, /precisa de um tamanho/)
  const semCampo = await pegar('propor_janela').run({ fonte: 'X', campo: '', intervaloMs: 300_000, contas: ['sum'] })
  assert.match(semCampo.result, /qual campo resumir/)
  const semConta = await pegar('propor_janela').run({ fonte: 'X', campo: 'valor', intervaloMs: 300_000, contas: [] })
  assert.match(semConta.result, /objeto vazio/)
  assert.match(semConta.result, /min|max|avg/, 'a recusa tem de dizer entre o que escolher')
})

test('AMEAÇA: uma conta que o motor não tem é descartada, não gravada', async () => {
  const { rascunho, pegar } = montar()
  const r = await pegar('propor_janela').run({ fonte: 'X', campo: 'valor', intervaloMs: 300_000, contas: ['min', 'mediana', 'desvio'] })
  assert.equal(r.ok, true, r.result)
  assert.deepEqual(rascunho.janelas[0].ops, ['min'], 'conta inventada viraria coluna que ninguém lê')
})

test('AMEAÇA: a mesma fonte com a mesma janela duas vezes é recusada', async () => {
  const { rascunho, pegar } = montar()
  await pegar('propor_janela').run({ fonte: 'Faturamento', campo: 'valor', intervaloMs: 3_600_000, contas: ['sum'] })
  const dedois = await pegar('propor_janela').run({ fonte: 'Faturamento', campo: 'valor', intervaloMs: 3_600_000, contas: ['avg'] })
  assert.equal(dedois.ok, false)
  assert.match(dedois.result, /mesma linha duas vezes/)
  assert.equal(rascunho.janelas.length, 1)
})

// --- perguntar -------------------------------------------------------------------------------

test('ACEITAÇÃO: perguntar registra a pergunta e manda encerrar a rodada', async () => {
  const { rascunho, pegar } = montar()
  const r = await pegar('perguntar').run({
    chave: 'origem-do-estoque',
    texto: 'De onde vem a contagem de estoque hoje?',
    opcoes: [{ value: 'erp', label: 'Do ERP' }, { value: 'planilha', label: 'De uma planilha' }],
  })
  assert.equal(r.ok, true)
  assert.match(r.result, /encerre a rodada/i)
  assert.equal(rascunho.pergunta.chave, 'origem-do-estoque')
  assert.equal(rascunho.pergunta.opcoes.length, 2)
})

test('AMEAÇA: duas perguntas na mesma rodada é recusado — a segunda muda com a resposta da primeira', async () => {
  const { rascunho, pegar } = montar()
  await pegar('perguntar').run({ chave: 'a', texto: 'Primeira?' })
  const segunda = await pegar('perguntar').run({ chave: 'b', texto: 'Segunda?' })
  assert.equal(segunda.ok, false)
  assert.match(segunda.result, /uma por vez/)
  assert.equal(rascunho.pergunta.chave, 'a')
})

test('a chave da pergunta é normalizada — ela identifica a resposta depois', async () => {
  const { rascunho, pegar } = montar()
  await pegar('perguntar').run({ chave: 'Origem Do Preço!', texto: 'De onde?' })
  assert.match(rascunho.pergunta.chave, /^[a-z0-9:-]+$/)
})

// --- FASE 2: Database e conjunto -------------------------------------------------------------

test('ACEITAÇÃO: um Database proposto entra no rascunho, com quem alcança ele', async () => {
  const { rascunho, pegar } = montar()
  const r = await pegar('propor_database').run({
    nome: 'Leituras da câmara fria',
    tipo: 'data_history',
    descricao: 'temperatura minuto a minuto',
    agentes: ['vigia'],
    acesso: 'write',
  })
  assert.equal(r.ok, true, r.result)
  assert.match(r.result, /Nada foi criado ainda/)
  assert.equal(rascunho.databases[0].nome, 'Leituras da câmara fria')
  assert.deepEqual(rascunho.databases[0].agentes, ['vigia'])
  assert.equal(rascunho.databases[0].acesso, 'write')
})

test('AMEAÇA: sem agente listado, a resposta AVISA que a base nasce inalcançável', async () => {
  const { pegar } = montar()
  const r = await pegar('propor_database').run({ nome: 'Notas fiscais', tipo: 'data_history' })
  assert.equal(r.ok, true)
  assert.match(r.result, /inalcançável/, 'uma base sem concessão não parece defeito até alguém perguntar por que o agente não lê')
})

test('AMEAÇA: propor um Database que a conta JÁ TEM é recusado', async () => {
  const rascunho = rascunhoVazio()
  const inv = {
    ownerId: 'dono',
    at: new Date(),
    building: { id: 'b1', name: 'P' },
    sections: { database: { kind: 'database', total: 1, truncated: false, items: [{ id: 'd1', label: 'Históricos', ownerScope: 'account' }] } },
  }
  const fs = ferramentasDoAssistente({ inventory: inv, rascunho })
  const r = await fs.find((f) => f.name === 'propor_database').run({ nome: 'Históricos', tipo: 'data_history' })
  assert.equal(r.ok, false)
  assert.match(r.result, /já existe um Database/)
  assert.equal(rascunho.databases.length, 0)
})

test('AMEAÇA: tipo de Database inventado é recusado, com a lista do que existe', async () => {
  const { pegar } = montar()
  const r = await pegar('propor_database').run({ nome: 'X', tipo: 'planilha' })
  assert.equal(r.ok, false)
  assert.match(r.result, /não é um tipo de Database/)
  assert.match(r.result, /data_history/)
})

test('ACEITAÇÃO: o conjunto declara os campos, e é isso que a consulta lê depois', async () => {
  const { rascunho, pegar } = montar()
  await pegar('propor_database').run({ nome: 'Pedidos do site', tipo: 'data_history' })
  const r = await pegar('propor_conjunto').run({
    databaseNome: 'Pedidos do site',
    chave: 'pedidos',
    nome: 'Pedidos',
    campos: [{ nome: 'pedido_id', tipo: 'string' }, { nome: 'valor_total', tipo: 'number' }],
  })
  assert.equal(r.ok, true, r.result)
  assert.equal(rascunho.conjuntos[0].databaseChave, rascunho.databases[0].chave)
  assert.equal(rascunho.conjuntos[0].campos.length, 2)
  assert.equal(rascunho.conjuntos[0].podeEditar, false, 'série temporal só acrescenta, por padrão')
})

test('AMEAÇA: conjunto sem campo nenhum é recusado — ele não poderia ser consultado', async () => {
  const { pegar } = montar()
  await pegar('propor_database').run({ nome: 'Base', tipo: 'data_history' })
  const r = await pegar('propor_conjunto').run({ databaseNome: 'Base', chave: 'x', nome: 'X', campos: [] })
  assert.equal(r.ok, false)
  assert.match(r.result, /não declara nenhum campo/)
  assert.match(r.result, /consultado nem observado/)
})

test('AMEAÇA: conjunto num Database que o plano não propõe é recusado, dizendo quais existem', async () => {
  const { pegar } = montar()
  await pegar('propor_database').run({ nome: 'Estoque diário', tipo: 'data_history' })
  const r = await pegar('propor_conjunto').run({ databaseNome: 'Outra base', chave: 'x', nome: 'X', campos: [{ nome: 'a', tipo: 'string' }] })
  assert.equal(r.ok, false)
  assert.match(r.result, /não é um Database deste plano/)
  assert.match(r.result, /Estoque diário/, 'sem dizer quais existem, o modelo chuta de novo')
})

// --- FASE 3: a fonte, e o link que o dono manda configurar ------------------------------------
//
// "Toma esse link e configura pra mim." É a ferramenta com mais regra, e é onde a recusa que
// volta mais paga: trinta e tantas checagens, cada uma com uma frase que diz o que fazer.

test('ACEITAÇÃO: um endereço bem preenchido vira fonte, e ela nasce RASCUNHO', async () => {
  const { rascunho, pegar } = montar()
  const r = await pegar('propor_fonte').run({
    nome: 'Pedidos do site',
    tipo: 'api_polling',
    endereco: 'https://api.loja.exemplo/pedidos',
    metodo: 'GET',
    intervaloMs: 60_000,
    campos: [{ to: 'pedido_id', from: 'data.id', obrigatorio: true }, { to: 'valor_total', from: 'data.total' }],
  })
  assert.equal(r.ok, true, r.result)
  assert.match(r.result, /nasce rascunho/, 'o dono precisa saber que ela não entra no ar sozinha')
  assert.match(r.result, /Nada foi criado ainda/)
  assert.equal(rascunho.fontes[0].campos.length, 2)
})

test('AMEAÇA: credencial no endereço é recusada — ela vaza em log e em print', async () => {
  const { pegar } = montar()
  const comUsuario = await pegar('propor_fonte').run({ nome: 'A', tipo: 'api_polling', endereco: 'https://user:senha@api.x/y', intervaloMs: 60_000 })
  assert.equal(comUsuario.ok, false)
  assert.match(comUsuario.result, /tire a credencial do endereço/)

  const comToken = await pegar('propor_fonte').run({ nome: 'B', tipo: 'api_polling', endereco: 'https://api.x/y?api_key=abc123', intervaloMs: 60_000 })
  assert.equal(comToken.ok, false)
  assert.match(comToken.result, /parece uma credencial/)
  assert.match(comToken.result, /conexão/, 'a recusa tem de dizer para onde a credencial vai')
})

test('AMEAÇA: a cadência tem de casar com o tipo da fonte', async () => {
  const { pegar } = montar()
  const semIntervalo = await pegar('propor_fonte').run({ nome: 'C', tipo: 'api_polling', endereco: 'https://api.x/y' })
  assert.equal(semIntervalo.ok, false)
  assert.match(semIntervalo.result, /lida por consulta/)

  const rapidoDemais = await pegar('propor_fonte').run({ nome: 'D', tipo: 'api_polling', endereco: 'https://api.x/y', intervaloMs: 1000 })
  assert.match(rapidoDemais.result, /entre 15s e 24h/)

  const empurraComIntervalo = await pegar('propor_fonte').run({ nome: 'E', tipo: 'webhook', intervaloMs: 60_000 })
  assert.equal(empurraComIntervalo.ok, false)
  assert.match(empurraComIntervalo.result, /chega sozinha/)
})

test('AMEAÇA: campo mapeado duas vezes, ou com nome inválido, é recusado', async () => {
  const { pegar } = montar()
  const doisIguais = await pegar('propor_fonte').run({
    nome: 'F', tipo: 'api_polling', endereco: 'https://api.x/y', intervaloMs: 60_000,
    campos: [{ to: 'preco', from: 'a' }, { to: 'preco', from: 'b' }],
  })
  assert.equal(doisIguais.ok, false)
  assert.match(doisIguais.result, /mapeado duas vezes/)

  const nomeRuim = await pegar('propor_fonte').run({
    nome: 'G', tipo: 'api_polling', endereco: 'https://api.x/y', intervaloMs: 60_000,
    campos: [{ to: '2preco', from: 'a' }],
  })
  assert.match(nomeRuim.result, /não é um nome de campo válido/)
})

test('sem mapeamento a fonte ainda vale — e a resposta DIZ que vira pendência', async () => {
  const { pegar } = montar()
  const r = await pegar('propor_fonte').run({ nome: 'Feed', tipo: 'rss', endereco: 'https://exemplo.test/feed.xml', intervaloMs: 3_600_000 })
  assert.equal(r.ok, true, r.result)
  assert.match(r.result, /pendência/, 'sem isso o modelo inventa campos para "completar"')
})

// --- FASE 3: o monitor -----------------------------------------------------------------------

test('ACEITAÇÃO: o monitor observa um conjunto do plano, e avisa que não age sozinho', async () => {
  const { rascunho, pegar } = montar()
  await pegar('propor_database').run({ nome: 'Câmara fria', tipo: 'data_history' })
  await pegar('propor_conjunto').run({ databaseNome: 'Câmara fria', chave: 'leituras', nome: 'Leituras', campos: [{ nome: 'temperatura', tipo: 'number' }] })
  const r = await pegar('propor_monitor').run({ nome: 'Temperatura alta', conjunto: 'leituras', campo: 'temperatura', operador: 'gt', valor: 8 })
  assert.equal(r.ok, true, r.result)
  assert.match(r.result, /sem um Flow, ele só observa/)
  assert.equal(rascunho.monitores[0].valor, 8)
})

test('AMEAÇA: condição sobre campo que o conjunto não declara é recusada', async () => {
  const { pegar } = montar()
  await pegar('propor_database').run({ nome: 'Base', tipo: 'data_history' })
  await pegar('propor_conjunto').run({ databaseNome: 'Base', chave: 'linhas', nome: 'L', campos: [{ nome: 'quantidade', tipo: 'number' }] })
  const r = await pegar('propor_monitor').run({ nome: 'M', conjunto: 'linhas', campo: 'preco', operador: 'lt', valor: 5 })
  assert.equal(r.ok, false)
  assert.match(r.result, /o campo "preco" não existe nesta fonte/)
  assert.match(r.result, /quantidade/, 'um monitor sobre campo inexistente nunca dispara, e não avisa que não vai')
})

test('AMEAÇA: operador inventado e limiar ausente são recusados', async () => {
  const { pegar } = montar()
  await pegar('propor_database').run({ nome: 'B2', tipo: 'data_history' })
  await pegar('propor_conjunto').run({ databaseNome: 'B2', chave: 'l2', nome: 'L2', campos: [{ nome: 'valor', tipo: 'number' }] })
  const op = await pegar('propor_monitor').run({ nome: 'M', conjunto: 'l2', campo: 'valor', operador: 'entre', valor: 1 })
  assert.match(op.result, /não é permitido/)
  const semValor = await pegar('propor_monitor').run({ nome: 'M', conjunto: 'l2', campo: 'valor', operador: 'lt', valor: 'muito' })
  assert.match(semValor.result, /dispara sempre ou nunca/)
})

// --- FASE 4: agente e setor ------------------------------------------------------------------
//
// As quatro recusas do agente não são burocracia: elas são a diferença entre um agente e uma
// função. Sem saber quando ele entra, o que recebe e o que entrega, o que está sendo proposto
// é um cálculo procurando dono.

test('ACEITAÇÃO: um agente bem descrito entra no rascunho, com o que ele NÃO faz', async () => {
  const { rascunho, pegar } = montar()
  const r = await pegar('propor_agente').run({
    nome: 'Tereza',
    andar: 'Atendimento',
    papel: 'Responde dúvidas sobre entrega',
    quandoEntra: 'Quando o cliente pergunta onde está o pedido',
    recebe: 'A mensagem do cliente e o número do pedido',
    entrega: 'Uma resposta com o status e a previsão',
    limites: ['Nunca prometer data que o sistema não confirma'],
  })
  assert.equal(r.ok, true, r.result)
  assert.equal(rascunho.agentes[0].quandoEntra, 'Quando o cliente pergunta onde está o pedido')
  assert.deepEqual(rascunho.agentes[0].limites, ['Nunca prometer data que o sistema não confirma'])
})

test('AMEAÇA: cada campo que falta tem sua PRÓPRIA recusa, e ela diz o que falta', async () => {
  const { pegar } = montar()
  const base = { nome: 'X', andar: 'A', papel: 'p', quandoEntra: 'q', recebe: 'r', entrega: 'e' }
  const casos = [
    [{ ...base, papel: '' }, /sem responsabilidade/],
    [{ ...base, quandoEntra: '' }, /não diz quando entra/],
    [{ ...base, recebe: '' }, /não diz o que recebe/],
    [{ ...base, entrega: '' }, /não diz o que entrega/],
  ]
  for (const [args, esperado] of casos) {
    const r = await pegar('propor_agente').run(args)
    assert.equal(r.ok, false, JSON.stringify(args))
    assert.match(r.result, esperado)
  }
})

test('ACEITAÇÃO: um setor orquestrado exige coordenador, e ele tem de estar na equipe', async () => {
  const { rascunho, pegar } = montar()
  const fazer = (nome) => pegar('propor_agente').run({ nome, andar: 'Operações', papel: 'p', quandoEntra: 'q', recebe: 'r', entrega: 'e' })
  await fazer('Marina')
  await fazer('Rafael')

  const semCoordenador = await pegar('propor_setor').run({ nome: 'Mesa', andar: 'Operações', modo: 'orchestrated', membros: ['Marina', 'Rafael'] })
  assert.equal(semCoordenador.ok, false)
  assert.match(semCoordenador.result, /não tem coordenador/)

  const foraDaEquipe = await pegar('propor_setor').run({ nome: 'Mesa', andar: 'Operações', modo: 'orchestrated', membros: ['Marina'], coordenador: 'Rafael' })
  assert.match(foraDaEquipe.result, /coordena e não está na equipe/)

  const ok2 = await pegar('propor_setor').run({ nome: 'Mesa', andar: 'Operações', modo: 'orchestrated', membros: ['Marina', 'Rafael'], coordenador: 'Marina' })
  assert.equal(ok2.ok, true, ok2.result)
  assert.equal(rascunho.setores[0].membros.length, 2)
})

test('AMEAÇA: membro de outro andar é recusado — o setor não seria válido', async () => {
  const { pegar } = montar()
  await pegar('propor_agente').run({ nome: 'Ana', andar: 'Vendas', papel: 'p', quandoEntra: 'q', recebe: 'r', entrega: 'e' })
  const r = await pegar('propor_setor').run({ nome: 'Time', andar: 'Suporte', modo: 'organization', membros: ['Ana'] })
  assert.equal(r.ok, false)
  assert.match(r.result, /está no andar "Vendas"/)
  assert.match(r.result, /não é válido/)
})

test('AMEAÇA: só o coordenador na equipe é recusado — não há a quem delegar', async () => {
  const { pegar } = montar()
  await pegar('propor_agente').run({ nome: 'Só', andar: 'A', papel: 'p', quandoEntra: 'q', recebe: 'r', entrega: 'e' })
  const r = await pegar('propor_setor').run({ nome: 'T', andar: 'A', modo: 'orchestrated', membros: ['Só'], coordenador: 'Só' })
  assert.equal(r.ok, false)
  assert.match(r.result, /não há a quem delegar/)
})

test('AMEAÇA: membro que o plano não propõe é recusado, dizendo quais existem', async () => {
  const { pegar } = montar()
  await pegar('propor_agente').run({ nome: 'Bia', andar: 'A', papel: 'p', quandoEntra: 'q', recebe: 'r', entrega: 'e' })
  const r = await pegar('propor_setor').run({ nome: 'T', andar: 'A', modo: 'organization', membros: ['Fantasma'] })
  assert.equal(r.ok, false)
  assert.match(r.result, /não é um agente deste plano/)
  assert.match(r.result, /Bia/)
})
