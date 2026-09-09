// O COMPILADOR: do entendimento para o desenho, sem passar pelo modelo.
//
// Enquanto o Blueprint vinha da LLM, duas conversas iguais produziam desenhos
// diferentes — e "por que este agente existe?" só tinha a resposta que o modelo
// resolvesse dar naquele dia. Aqui o desenho é derivado, e a mesma entrada dá o mesmo
// resultado, inclusive as chaves.
//
// A estabilidade das chaves não é preciosismo: elas ligam a proposta ao recurso já
// aplicado. Se `marina` virasse `agent-2` na revisão seguinte, o diff diria que um
// agente sumiu e outro nasceu — e a aplicação criaria um segundo ao lado do que existe.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { compileBrief, selectLayer, layerCounts, slug } = await import('../dist/architect/compile.js')
const { emptyBrief, applyBriefPatch } = await import('../dist/architect/brief.js')
const { computeBlueprintHash } = await import('../dist/architect/blueprint.js')
const { runCritic } = await import('../dist/architect/critic.js')
const { validateOfficeBlueprint, emptyOwnershipContext } = await import('../dist/architect/validate.js')
const { diffBlueprints } = await import('../dist/architect/diff.js')

const manifesto = {
  presets: [
    { preset: 'manager', label: 'Gerente', description: '', capabilities: [], delegationPolicy: 'all', activationModes: [], requiresTool: false },
    { preset: 'communicator', label: 'Comunicador', description: '', capabilities: [], delegationPolicy: 'none', activationModes: [], requiresTool: false },
    { preset: 'analyst', label: 'Analista', description: '', capabilities: [], delegationPolicy: 'none', activationModes: [], requiresTool: false },
    { preset: 'researcher', label: 'Pesquisador', description: '', capabilities: [], delegationPolicy: 'none', activationModes: [], requiresTool: false },
    { preset: 'operator', label: 'Operador', description: '', capabilities: [], delegationPolicy: 'none', activationModes: [], requiresTool: false },
    { preset: 'monitor', label: 'Monitor', description: '', capabilities: [], delegationPolicy: 'none', activationModes: [], requiresTool: false },
    { preset: 'custom', label: 'Custom', description: '', capabilities: [], delegationPolicy: 'none', activationModes: [], requiresTool: false },
  ],
  functions: [{ functionName: 'lista.ordenar', description: '', capabilities: [], version: '1', hasConfig: false }],
  apps: [
    { key: 'web_chat', name: 'Chat Web', connected: true, actions: [{ key: 'reply', name: 'Responder', risk: 'write' }] },
    { key: 'nuvemshop', name: 'Nuvemshop', connected: true, actions: [{ key: 'get_order', name: 'Consultar', risk: 'read' }] },
  ],
  channels: [{ key: 'web_chat', connected: true }],
  tools: [], executorKinds: [], sectorModes: [], activationModes: [], knowledgeScopes: [], version: 1,
}

const briefCompleto = () =>
  applyBriefPatch(emptyBrief(), {
    businessGoal: 'atender o cliente do restaurante',
    channels: ['web_chat'],
    jobs: [
      { id: 'duvida', name: 'Responder dúvidas do cardápio', trigger: 'chega uma mensagem', input: 'a pergunta', decision: 'qual resposta cabe', action: 'responder', output: 'a resposta' },
      { id: 'pedido', name: 'Consultar pedido na Nuvemshop', trigger: 'o cliente pergunta do pedido', input: 'o número', action: 'consultar pedido', output: 'o status' },
      { id: 'resumo', name: 'Monitorar reclamações do dia', trigger: 'todo dia de manhã', action: 'acompanhar reclamações', output: 'um resumo', frequency: 'diário' },
    ],
    knowledgeNeeds: [{ subject: 'Cardápio com preços', required: true }],
  })

const base = { title: 'Atendimento', objective: 'atender' }

// --- determinismo ------------------------------------------------------------------------------

test('mesmo Brief, mesmo desenho — inclusive o hash', () => {
  const a = compileBrief(briefCompleto(), manifesto, base)
  const b = compileBrief(briefCompleto(), manifesto, base)
  assert.deepEqual(a.blueprint, b.blueprint)
  assert.equal(computeBlueprintHash(a.blueprint), computeBlueprintHash(b.blueprint))
})

test('as chaves são estáveis: elas ligam a proposta ao recurso já aplicado', () => {
  const primeiro = compileBrief(briefCompleto(), manifesto, base)
  const chaves = primeiro.blueprint.agents.map((a) => a.key)
  assert.deepEqual(chaves, ['duvida'], 'a chave sai do trabalho, não da ordem de criação')

  // Uma revisão que acrescenta trabalho NÃO renomeia o que já existia.
  const comMais = applyBriefPatch(briefCompleto(), {
    jobs: [
      ...briefCompleto().jobs,
      { id: 'reembolso', name: 'Avaliar pedido de reembolso', trigger: 'o cliente pede', input: 'a nota', decision: 'se cabe', action: 'responder', output: 'a decisão', risk: 'high' },
    ],
  })
  const segundo = compileBrief(comMais, manifesto, base)
  assert.ok(segundo.blueprint.agents.some((a) => a.key === 'duvida'), 'o agente de antes continua com a mesma chave')
})

test('os nomes são de PESSOA e vêm por posição, não por sorteio', () => {
  const r = compileBrief(briefCompleto(), manifesto, base)
  assert.equal(r.blueprint.agents[0].name, 'Marina')
  // O cargo está no papel e no objetivo; o nome é como o dono chama por ele.
  assert.doesNotMatch(r.blueprint.agents[0].name, /agente|analista|atendente/i)
  assert.equal(compileBrief(briefCompleto(), manifesto, base).blueprint.agents[0].name, 'Marina')
})

// --- o que existe e o que não existe -------------------------------------------------------------

test('o trabalho vira o recurso que o classificador decidiu', () => {
  const r = compileBrief(briefCompleto(), manifesto, base)
  // Um agente (a dúvida), uma ferramenta (o pedido), uma rotina (o monitoramento).
  assert.equal(r.blueprint.agents.length, 1)
  assert.ok(r.blueprint.appRequirements.some((a) => a.appKey === 'nuvemshop'))
  assert.equal(r.blueprint.routines.length, 1)
  assert.equal(r.blueprint.routines[0].ownerAgentKey, 'duvida', 'a rotina tem dono')
})

test('recurso sem correspondência vira PENDÊNCIA — nunca invenção', () => {
  const semCatalogo = compileBrief(briefCompleto(), { ...manifesto, apps: [], channels: [] }, base)
  assert.ok(semCatalogo.pending.some((p) => p.kind === 'tool'))
  assert.equal(semCatalogo.blueprint.appRequirements.length, 0, 'nenhum App inventado entrou no desenho')
  // E a pendência é dita em voz alta, junto da proposta.
  assert.ok(semCatalogo.blueprint.warnings.some((w) => /pendência/.test(w.message)))
})

test('o canal entra quando existe, e vira pendência quando não', () => {
  const com = compileBrief(briefCompleto(), manifesto, base)
  assert.equal(com.blueprint.appRequirements[0].appKey, 'web_chat')
  assert.deepEqual(com.blueprint.appRequirements[0].agentKeys, ['duvida'])

  const sem = compileBrief(applyBriefPatch(briefCompleto(), { channels: ['telegram'] }), { ...manifesto, channels: [] }, base)
  assert.ok(sem.pending.some((p) => p.kind === 'channel'))
})

test('setor só existe com mais de um agente para coordenar', () => {
  const um = compileBrief(briefCompleto(), manifesto, base)
  assert.equal(um.blueprint.sectors.length, 0, 'setor com um agente é agrupar uma pessoa')

  const dois = applyBriefPatch(briefCompleto(), {
    jobs: [
      ...briefCompleto().jobs,
      { id: 'analise', name: 'Analisar as reclamações e recomendar ação', trigger: 'fim do dia', input: 'as reclamações', decision: 'o que priorizar', action: 'recomendar', output: 'a recomendação' },
    ],
  })
  const r = compileBrief(dois, manifesto, base)
  assert.equal(r.blueprint.agents.length, 2)
  assert.equal(r.blueprint.sectors.length, 1)
  assert.equal(r.blueprint.sectors[0].coordinatorAgentKey, r.blueprint.agents[0].key)
  assert.equal(r.blueprint.agents[0].preset, 'manager', 'quem recebe passa a coordenar')
  assert.equal(r.blueprint.agents[0].delegationPolicy, 'floor', 'sem alcance, a coordenação não acontece')
})

test('mudar o Brief é uma REVISÃO: hash novo, e ninguém é renomeado', () => {
  // Esta é a promessa que sustenta continuar conversando depois de aplicar. Se o
  // compilador trocasse as chaves a cada revisão, o diff diria que a equipe inteira
  // saiu e outra entrou — e a aplicação criaria um segundo escritório ao lado do que
  // já roda.
  const antes = compileBrief(briefCompleto(), manifesto, base).blueprint
  const depois = compileBrief(
    applyBriefPatch(briefCompleto(), {
      jobs: [
        ...briefCompleto().jobs,
        { id: 'reembolso', name: 'Avaliar pedido de reembolso', trigger: 'o cliente pede', input: 'a nota', decision: 'se cabe', action: 'responder', output: 'a decisão' },
      ],
    }),
    manifesto,
    base,
  ).blueprint

  assert.notEqual(computeBlueprintHash(antes), computeBlueprintHash(depois), 'Brief novo precisa pedir aprovação de novo')
  const mudancas = diffBlueprints(antes, depois)
  assert.ok(mudancas.some((c) => c.change === 'added' && c.key === 'reembolso'))
  assert.deepEqual(mudancas.filter((c) => c.change === 'removed'), [], 'nada foi removido: as chaves são as mesmas')
})

// --- as camadas -----------------------------------------------------------------------------------

test('as três camadas são recortes do MESMO plano', () => {
  const r = compileBrief(briefCompleto(), manifesto, base)
  const contagens = layerCounts(r.blueprint)

  // O núcleo é o caminho mínimo: alguém recebe e responde.
  assert.equal(contagens.essential.agents, 1)
  assert.equal(contagens.essential.routines, 0, 'o que roda sozinho pode esperar o primeiro teste')
  // O completo contém o núcleo — não é outra proposta.
  assert.ok(contagens.complete.agents >= contagens.essential.agents)
  assert.ok(contagens.complete.routines >= contagens.recommended.routines)

  const essencial = selectLayer(r.blueprint, 'essential')
  const completo = selectLayer(r.blueprint, 'complete')
  assert.deepEqual(
    essencial.agents.map((a) => a.key),
    completo.agents.filter((a) => (a.layer ?? 'essential') === 'essential').map((a) => a.key),
    'o mesmo agente, com a mesma chave, nas duas camadas',
  )
})

test('cada item diz POR QUE está na camada em que está', () => {
  const r = compileBrief(briefCompleto(), manifesto, base)
  for (const item of [...r.blueprint.agents, ...r.blueprint.routines, ...r.blueprint.appRequirements]) {
    assert.ok(item.layerReason && item.layerReason.length > 10, `${item.key} sem motivo de camada`)
  }
  assert.match(r.blueprint.routines[0].layerReason, /pode esperar/)
})

test('o recorte preserva as dependências: nada fica pendurado', () => {
  const dois = applyBriefPatch(briefCompleto(), {
    jobs: [
      ...briefCompleto().jobs,
      { id: 'analise', name: 'Analisar as reclamações e recomendar', trigger: 'fim do dia', input: 'as reclamações', decision: 'o que priorizar', action: 'recomendar', output: 'a recomendação' },
    ],
  })
  const r = compileBrief(dois, manifesto, base)
  const essencial = selectLayer(r.blueprint, 'essential')

  // O segundo agente é "recomendado": no essencial o setor não sobrevive, porque um
  // setor de um membro não é setor.
  assert.equal(essencial.agents.length, 1)
  assert.equal(essencial.sectors.length, 0)
  assert.equal(essencial.routines.length, 0, 'rotina sem dono na camada não entra')
  // E o agente que sobrou não fica coordenando o vazio.
  assert.notEqual(essencial.agents[0].delegationPolicy, 'floor')
  assert.notEqual(essencial.agents[0].preset, 'manager')
})

test('todo recorte passa no crítico determinístico', () => {
  // Uma camada que não é aplicável sozinha não é uma camada: é uma proposta quebrada.
  const dois = applyBriefPatch(briefCompleto(), {
    jobs: [
      ...briefCompleto().jobs,
      { id: 'analise', name: 'Analisar reclamações e recomendar', trigger: 'fim do dia', input: 'as reclamações', decision: 'o que priorizar', action: 'recomendar', output: 'a recomendação' },
    ],
  })
  const r = compileBrief(dois, manifesto, base)
  for (const camada of ['essential', 'recommended', 'complete']) {
    const critica = runCritic(selectLayer(r.blueprint, camada), manifesto)
    const erros = critica.findings.filter((f) => f.severity === 'error')
    assert.deepEqual(erros, [], `a camada ${camada} nasce com erro: ${JSON.stringify(erros, null, 1)}`)
  }
})

test('todo recorte é APLICÁVEL: passa no validador estrutural', () => {
  // O crítico avalia o desenho; o validador é quem barra a aplicação. Um plano que
  // compila e não aplica é pior do que nenhum plano: ele chega até a aprovação.
  const dois = applyBriefPatch(briefCompleto(), {
    jobs: [
      ...briefCompleto().jobs,
      { id: 'analise', name: 'Analisar reclamações e recomendar', trigger: 'fim do dia', input: 'as reclamações', decision: 'o que priorizar', action: 'recomendar', output: 'a recomendação' },
    ],
  })
  const r = compileBrief(dois, manifesto, base)
  for (const camada of ['essential', 'recommended', 'complete']) {
    const v = validateOfficeBlueprint(selectLayer(r.blueprint, camada), emptyOwnershipContext())
    const erros = v.issues.filter((i) => i.severity === 'error')
    assert.deepEqual(erros, [], `a camada ${camada} não aplica: ${JSON.stringify(erros, null, 1)}`)
  }
})

// --- forma ------------------------------------------------------------------------------------------

test('a chave é derivada e legível', () => {
  assert.equal(slug('Responder dúvidas do CARDÁPIO'), 'responder-duvidas-do-cardapio')
  assert.equal(slug('  ação!!  '), 'acao')
})

test('Brief vazio compila um desenho vazio — e não quebra', () => {
  const r = compileBrief(emptyBrief(), manifesto, base)
  assert.equal(r.blueprint.agents.length, 0)
  assert.equal(r.blueprint.floors.length, 1)
  assert.deepEqual(r.pending, [])
})

// --- o andar que já existe --------------------------------------------------------------
//
// O SINTOMA RELATADO: "cara, ele criou um novo andar". Toda operação abria um andar com o
// nome do próprio título, sempre, porque `compileBrief` fixava `action: 'create'` e nem
// recebia o inventário. Guardar a máxima do Bitcoin não é uma área nova da empresa — é
// trabalho que mora onde a pessoa já trabalha.

const inventarioAndares = (nomes) => ({
  ownerId: 'dono',
  at: new Date(),
  building: { id: '000000000000000000000b01', name: 'Prédio' },
  sections: {
    floor: {
      kind: 'floor',
      total: nomes.length,
      truncated: false,
      items: nomes.map((n, i) => ({ id: `00000000000000000000f${String(i).padStart(3, '0')}`, label: n, ownerScope: 'building:000000000000000000000b01', status: 'active' })),
    },
  },
})

test('ACEITAÇÃO: com um andar na conta, a operação MORA nele — não abre outro', () => {
  const brief = { ...briefCompleto(), businessGoal: 'Guardar a máxima e a mínima do dia do Bitcoin' }
  const { blueprint } = compileBrief(brief, manifesto, { title: 'Máxima e mínima do Bitcoin', objective: 'x' }, inventarioAndares(['Operações']))
  assert.equal(blueprint.floors.length, 1)
  assert.equal(blueprint.floors[0].action, 'reuse')
  assert.equal(blueprint.floors[0].resourceId, '00000000000000000000f000')
  assert.equal(blueprint.floors[0].name, 'Operações')
})

test('a conta VAZIA continua ganhando o primeiro andar', () => {
  // O oposto não pode quebrar: quem está começando precisa do andar criado.
  const { blueprint } = compileBrief(briefCompleto(), manifesto, { title: 'Atendimento', objective: 'x' }, null)
  assert.equal(blueprint.floors[0].action, 'create')
})

// --- a escolha da pessoa chega ao DESENHO ------------------------------------------------
//
// O classificador já respeita a escolha; o que este caso prova é o caminho inteiro: a
// resposta entra pelo compilador e sai como recurso no plano. Sem isto, a pergunta seria
// teatro — perguntar e montar do mesmo jeito é pior que não perguntar.

const trabalhoDeCalculo = () => ({
  id: 'j1',
  name: 'quero um agente que calcule a máxima do dia',
  trigger: 'quando chegar cotação nova',
  input: 'as cotações do dia',
  decision: '',
  action: 'calcular a máxima',
  output: 'a máxima do dia',
})

test('ACEITAÇÃO: sem resposta, vale a recomendação — o cálculo NÃO vira agente', () => {
  const brief = { ...briefCompleto(), jobs: [trabalhoDeCalculo()] }
  const { blueprint } = compileBrief(brief, manifesto, { title: 'Máxima do dia', objective: 'x' }, null, {})
  assert.equal(blueprint.agents.length, 0, `agentes: ${JSON.stringify(blueprint.agents.map((a) => a.name))}`)
})

test('ACEITAÇÃO: respondida "agente", o plano SAI com o agente que a pessoa pediu', () => {
  const brief = { ...briefCompleto(), jobs: [trabalhoDeCalculo()] }
  const { blueprint } = compileBrief(brief, manifesto, { title: 'Máxima do dia', objective: 'x' }, null, { 'forma:j1': 'agent' })
  assert.equal(blueprint.agents.length, 1, `agentes: ${JSON.stringify(blueprint.agents.map((a) => a.name))}`)
})

test('AMEAÇA: uma resposta que não é uma forma não muda nada', () => {
  // O caminho da resposta passa pelo modelo. Se qualquer texto valesse, o modelo poderia
  // escolher a forma por escrito — que é o que a classificação existe para impedir.
  const brief = { ...briefCompleto(), jobs: [trabalhoDeCalculo()] }
  const { blueprint } = compileBrief(brief, manifesto, { title: 'Máxima do dia', objective: 'x' }, null, { 'forma:j1': 'superagente' })
  assert.equal(blueprint.agents.length, 0)
})

// --- o trabalho que acontece SOZINHO precisa de quem o dispare ---------------------------
//
// DA CONVERSA REAL: "porém não quero uma conversa, quero que sempre no final do dia ele faça
// a anotação". O trabalho tem julgamento (conferir se já existe registro do dia), então a
// regra o resolve como AGENTE — e está certa. Mas ninguém compilou a ROTINA, e a operação
// nasceu sem nada que a acionasse: um agente pronto, esperando uma conversa que a pessoa
// tinha acabado de dizer que não queria.
//
// Agente e rotina não competem: um é o TRABALHADOR, a outra é o GATILHO. A causa era de uma
// linha — `texto(job)` junta nome, ação, decisão e saída, e não o TRIGGER. A frase que diz
// quando a coisa acontece era a única que ninguém lia.

const trabalhoAgendado = () => ({
  id: 'j1',
  name: 'Registrar o máximo do dia',
  trigger: 'Rotina diária agendada, no fim do dia',
  input: 'as cotações do dia',
  decision: 'conferir se já existe registro daquela data e decidir criar ou atualizar',
  action: 'gravar data e máximo na base diária',
  output: 'uma linha por dia',
})

test('ACEITAÇÃO: trabalho com julgamento E horário vira AGENTE e ROTINA', () => {
  const brief = { ...briefCompleto(), jobs: [trabalhoAgendado()] }
  const { blueprint } = compileBrief(brief, manifesto, { title: 'Máximo diário', objective: 'x' }, null, {})

  assert.equal(blueprint.agents.length, 1, 'o julgamento continua sendo de um agente')
  assert.equal(blueprint.routines.length, 1, `sem rotina, nada dispara: ${JSON.stringify(blueprint.routines)}`)
  assert.equal(blueprint.routines[0].ownerAgentKey, blueprint.agents[0].key, 'a rotina precisa acionar o agente do trabalho')
  // O QUE A PESSOA DISSE fica escrito: um horário inventado sem dizer que foi inventado é
  // um alarme que toca na hora errada e ninguém sabe por quê.
  assert.match(String(blueprint.routines[0].description ?? ''), /fim do dia/i)
})

test('sem horário nenhum, nada de rotina — quem dispara é a conversa', () => {
  const brief = { ...briefCompleto(), jobs: [{ ...trabalhoAgendado(), trigger: 'quando o cliente escreve' }] }
  const { blueprint } = compileBrief(brief, manifesto, { title: 'Atendimento', objective: 'x' }, null, {})
  assert.equal(blueprint.routines.length, 0, `rotina inventada: ${JSON.stringify(blueprint.routines)}`)
})

// --- porta de entrada só onde alguém entra ----------------------------------------------
//
// DA CONVERSA REAL: a pessoa disse "porém não quero uma conversa" e a proposta saiu com um
// canal de chat web mesmo assim — porque `brief.channels` tinha "web_chat" de uma rodada
// anterior e o entendimento ACUMULA sem retratar. O canal virou a única porta de uma
// operação que roda sozinha no fim do dia.
//
// A regra é o que o canal É: uma porta para alguém FALAR com o agente. Se nenhum trabalho
// começa com uma pessoa falando, não há porta a abrir — e abrir uma é prometer um
// atendimento que ninguém vai atender.

test('ACEITAÇÃO: operação que roda sozinha NÃO ganha canal de entrada', () => {
  const brief = {
    ...briefCompleto(),
    channels: ['web_chat'],
    jobs: [trabalhoAgendado()],
  }
  const { blueprint } = compileBrief(brief, manifesto, { title: 'Máximo diário', objective: 'x' }, null, {})
  const canal = blueprint.appRequirements.find((r) => r.key.startsWith('canal-'))
  assert.equal(canal, undefined, `canal aberto numa operação sem conversa: ${JSON.stringify(canal)}`)
})

test('quem ATENDE continua ganhando a porta', () => {
  const brief = {
    ...briefCompleto(),
    channels: ['web_chat'],
    jobs: [{ id: 'j1', name: 'Responder dúvida do cliente', trigger: 'quando o cliente escreve', input: 'a pergunta', decision: 'entender o que ele quer', action: 'responder', output: 'a resposta' }],
  }
  const { blueprint } = compileBrief(brief, manifesto, { title: 'Atendimento', objective: 'x' }, null, {})
  assert.ok(blueprint.appRequirements.find((r) => r.key.startsWith('canal-')), 'sem canal, ninguém alcança quem atende')
})

test('ACEITAÇÃO: com VÁRIOS andares e nenhuma área dita, ele PERGUNTA em qual', () => {
  /**
   * Escolher sozinho entre três andares é adivinhar onde o trabalho mora — e a proposta sai
   * montada no lugar errado parecendo certa. Foi o que aconteceu: o trabalho do Bitcoin
   * nasceu no "Salão", que é o andar do restaurante, só por ser o primeiro da lista.
   */
  const brief = { ...briefCompleto(), businessGoal: 'Guardar o máximo diário do Bitcoin' }
  const { blueprint, pending } = compileBrief(
    brief,
    manifesto,
    { title: 'Máximo do Bitcoin', objective: 'x' },
    inventarioAndares(['Salão', 'Financeiro', 'Logística']),
    {},
  )
  assert.ok(pending.some((p) => p.kind === 'floor_choice'), `faltou perguntar o andar: ${JSON.stringify(pending)}`)
  // O plano continua válido enquanto a resposta não vem — e não inventa andar novo.
  assert.equal(blueprint.floors[0].action, 'reuse')
})

test('com UM andar só, não há o que perguntar', () => {
  const brief = { ...briefCompleto(), businessGoal: 'Guardar o máximo diário do Bitcoin' }
  const { pending } = compileBrief(brief, manifesto, { title: 'Máximo', objective: 'x' }, inventarioAndares(['Operações']), {})
  assert.equal(pending.some((p) => p.kind === 'floor_choice'), false)
})

// --- Fase 5: nenhum default silencioso ---------------------------------------------------
//
// O QUE FOI APLICADO DE VERDADE, para um pedido que dizia "fim do dia em Orlando, com
// horário de verão": `cron: "0 8 * * *"`, `timezone: America/Sao_Paulo`, status `draft`.
// Três valores escolhidos pelo sistema, nenhum dito para quem ia usar. Oito da manhã de
// São Paulo é o meio da madrugada em Orlando, e a rotina nem roda porque nasce parada.
//
// O padrão pode existir — a rotina precisa de um horário para nascer. O que não pode é
// nascer calado.

test('ACEITAÇÃO: o horário inventado é DECLARADO, com a frase da pessoa', () => {
  const brief = { ...briefCompleto(), jobs: [{ ...trabalhoAgendado(), trigger: 'no fim do dia, no fuso de Orlando, com horário de verão' }] }
  const { blueprint, pending } = compileBrief(brief, manifesto, { title: 'Máximo diário', objective: 'x' }, null, {})

  const p = pending.find((x) => x.kind === 'routine_time')
  assert.ok(p, `o horário foi escolhido em silêncio: ${JSON.stringify(pending)}`)
  assert.match(p.because, /Orlando/i, 'a pendência precisa citar o que a pessoa disse')

  // E a rotina diz na própria descrição que nasce parada — senão a pessoa espera um
  // alarme que nunca vai tocar.
  assert.match(String(blueprint.routines[0].description ?? ''), /parada|publique|Rotinas/i)
})

test('ACEITAÇÃO: um fuso NOMEADO pela pessoa não é trocado pelo padrão em silêncio', () => {
  const brief = { ...briefCompleto(), jobs: [{ ...trabalhoAgendado(), trigger: 'todo fim de dia no fuso de Orlando' }] }
  const { pending } = compileBrief(brief, manifesto, { title: 'Máximo', objective: 'x' }, null, {})
  const p = pending.find((x) => x.kind === 'routine_timezone')
  assert.ok(p, `o fuso pedido foi ignorado sem dizer: ${JSON.stringify(pending)}`)
  assert.match(p.because, /Orlando/i)
})

test('sem fuso nomeado, não há o que declarar', () => {
  const brief = { ...briefCompleto(), jobs: [{ ...trabalhoAgendado(), trigger: 'todo dia de manhã' }] }
  const { pending } = compileBrief(brief, manifesto, { title: 'Resumo', objective: 'x' }, null, {})
  assert.equal(pending.some((x) => x.kind === 'routine_timezone'), false)
})

// --- Fase 8: o agente nasce sabendo trabalhar --------------------------------------------
//
// O QUE FOI CRIADO DE VERDADE: `Marina | preset=analyst exec=llm tools=0 | objetivo:
// "Capturar maior valor diário do bitcoin e registrar em base histórica: entrega Um
// registro…"`. O objetivo é o NOME DO TRABALHO, e a instrução não diz de onde ler, onde
// gravar, nem o que fazer quando faltar dado.
//
// O Brief tinha tudo isso escrito. Ele simplesmente não descia para o agente.

test('ACEITAÇÃO: a instrução do agente cita a origem, o destino e o que fazer sem dado', () => {
  const brief = {
    ...briefCompleto(),
    liveDataNeeds: [{ source: 'Base de preços do bitcoin a cada 15 segundos', freshness: '15s', required: true }],
    recordsToKeep: [{ subject: 'máximo diário do bitcoin', fields: ['data', 'maximo'], retentionDays: null }],
    jobs: [trabalhoAgendado()],
  }
  const { blueprint } = compileBrief(brief, manifesto, { title: 'Máximo diário', objective: 'x' }, null, {})
  const instrucao = String(blueprint.agents[0].instructions ?? '')

  assert.match(instrucao, /bitcoin/i, `a instrução não diz de onde ler: ${instrucao}`)
  assert.match(instrucao, /máximo diário|maximo diario/i, 'a instrução não diz onde gravar')
  // O que fazer quando o dado falta é o que separa um agente de um que trava — ou pior,
  // de um que inventa o número.
  assert.match(instrucao, /faltar|sem dado|não invente|nao invente/i)
})

test('sem dado declarado, a instrução continua sendo a do trabalho — sem inventar origem', () => {
  const brief = { ...briefCompleto(), jobs: [trabalhoAgendado()] }
  const { blueprint } = compileBrief(brief, manifesto, { title: 'x', objective: 'x' }, null, {})
  const instrucao = String(blueprint.agents[0].instructions ?? '')
  assert.equal(/bitcoin/i.test(instrucao), false, 'inventou uma origem que ninguém declarou')
})
