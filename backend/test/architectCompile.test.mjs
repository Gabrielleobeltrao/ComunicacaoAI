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
