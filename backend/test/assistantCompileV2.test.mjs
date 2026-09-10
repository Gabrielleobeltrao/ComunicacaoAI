// O COMPILADOR V2 — e os quatro cenários que o plano exige.
//
// Cada bloco abaixo é uma das lacunas do V1, agora do outro lado: o mesmo Brief que produzia
// um andar genérico, um App sem ação, o canal errado e uma rotina das oito da manhã.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const c2 = await import('../dist/assistant/compileV2.js')
const v2 = await import('../dist/assistant/blueprintV2.js')
const { emptyBrief } = await import('../dist/assistant/brief.js')

const manifesto = (over = {}) => ({
  version: 1,
  presets: [],
  executorKinds: [],
  sectorModes: [],
  activationModes: [],
  functions: [],
  apps: [
    {
      key: 'whatsapp',
      name: 'WhatsApp',
      connected: false,
      actions: [
        { key: 'send_message', name: 'Enviar mensagem', risk: 'write' },
        { key: 'list_messages', name: 'Listar mensagens', risk: 'read' },
      ],
    },
    {
      key: 'google_calendar',
      name: 'Google Calendar',
      connected: true,
      actions: [
        { key: 'list_events', name: 'Listar eventos', risk: 'read' },
        { key: 'create_event', name: 'Criar evento', risk: 'write' },
        { key: 'delete_event', name: 'Apagar evento', risk: 'high_risk' },
      ],
    },
  ],
  tools: [],
  knowledgeScopes: ['agent', 'sector', 'floor', 'building'],
  channels: [
    { key: 'web_chat', connected: true },
    { key: 'whatsapp', connected: false },
  ],
  ...over,
})

const inventarioVazio = () => ({
  ownerId: 'dono',
  at: new Date(),
  building: { id: '000000000000000000000b01', name: 'Prédio' },
  sections: {},
})

const inventarioCom = (andares) => ({
  ownerId: 'dono',
  at: new Date(),
  building: { id: '000000000000000000000b01', name: 'Prédio' },
  sections: {
    floor: { kind: 'floor', total: andares.length, truncated: false, items: andares },
  },
})

const compilar = (brief, over = {}) =>
  c2.compileBriefV2({
    brief,
    manifest: manifesto(),
    inventory: inventarioVazio(),
    base: { title: 'Operação', objective: 'Operar' },
    changeKind: 'create',
    ...over,
  })

// --- a leitura da condição ---------------------------------------------------------------

test('a condição de dado é lida da frase — campo, comparador e limiar', () => {
  const r = c2.parseDataCondition('quando o RSI ficar abaixo de 30')
  assert.equal(r.field, 'rsi')
  assert.equal(r.op, 'lt')
  assert.equal(r.value, 30)
  assert.equal(r.triggerMode, 'enter')
})

test('"cruzar" é outra coisa: vira cross_up/cross_down', () => {
  assert.equal(c2.parseDataCondition('quando o preço cruzar acima de 100').triggerMode, 'cross_up')
  assert.equal(c2.parseDataCondition('quando o preço cruzar abaixo de 100').triggerMode, 'cross_down')
})

test('um HORÁRIO não é uma condição de dado', () => {
  assert.equal(c2.parseDataCondition('todo dia às 8 da manhã'), null)
  assert.equal(c2.parseDataCondition('enviar o resumo semanal'), null)
})

test('campo e limiar ausentes NÃO viram zero', () => {
  const r = c2.parseDataCondition('quando ficar abaixo')
  assert.equal(r.value, null, 'um limiar inventado dispara sempre ou nunca')
})

// --- a resolução de ações de App ------------------------------------------------------------

test('as ações resolvidas são as REAIS do manifesto, separadas em leitura e escrita', () => {
  const app = manifesto().apps.find((a) => a.key === 'google_calendar')
  const r = c2.resolveAppActions(app, { id: 'x', name: 'Agendar', trigger: '', input: '', decision: '', action: 'criar evento na agenda', output: 'a confirmação' })
  assert.deepEqual(r.write, ['create_event'])
  assert.equal(r.read.includes('delete_event'), false, 'apagar não foi pedido')
})

test('quando nada casa, a leitura mínima vale — e a escrita não', () => {
  const app = manifesto().apps.find((a) => a.key === 'google_calendar')
  const r = c2.resolveAppActions(app, { id: 'x', name: 'Coisa nenhuma', trigger: '', input: '', decision: '', action: 'zzz', output: 'zzz' })
  assert.deepEqual(r.write, [], 'dar escrita por padrão seria conceder poder que ninguém pediu')
  assert.equal(r.read.length, 1)
})

// --- LACUNA 6, do outro lado: o canal pedido ganha --------------------------------------------

test('LACUNA 6 CORRIGIDA: quem pede WhatsApp recebe WhatsApp, mesmo com o web_chat conectado', () => {
  const r = c2.resolveChannel(['whatsapp'], manifesto())
  assert.equal(r.key, 'whatsapp')
  assert.equal(r.connected, false, 'e a conexão pendente é dita, não contornada')
})

test('sem pedido nenhum, o conectado serve — não há pedido para contrariar', () => {
  const r = c2.resolveChannel([], manifesto())
  assert.equal(r.key, 'web_chat')
})

test('um canal que a conta não tem vira pendência, não substituição', () => {
  const r = c2.resolveChannel(['telegram'], manifesto())
  assert.deepEqual(r, { missing: 'telegram' })
})

// --- CENÁRIO B: CXSE3 ---------------------------------------------------------------------------

test('CENÁRIO B: "avise quando o RSI de CXSE3 ficar abaixo de 30" vira fonte + histórico + monitor + Flow', () => {
  const brief = {
    ...emptyBrief('Acompanhar CXSE3'),
    liveDataNeeds: [{ source: 'cotação CXSE3', freshness: 'até 1 minuto', required: true }],
    jobs: [
      {
        id: 'avisar-rsi',
        name: 'Avisar sobre o RSI',
        trigger: 'quando o RSI ficar abaixo de 30',
        input: 'as cotações de CXSE3',
        decision: '',
        action: 'monitorar e avisar',
        output: 'o aviso',
        frequency: 'a cada candle',
      },
    ],
  }
  const { blueprint, pending } = compilar(brief)

  // A cadeia inteira, e não uma rotina com cron.
  assert.equal(blueprint.operations.routines.length, 0, 'uma condição de dado não é um horário')
  const monitor = blueprint.operations.monitors.find((m) => m.name.includes('RSI'))
  assert.ok(monitor, 'precisa existir um monitor')
  assert.deepEqual(monitor.condition, { kind: 'compare', field: 'rsi', op: 'lt', value: 30 })
  assert.equal(monitor.onStale, 'degrade', 'dado velho não dispara')
  assert.ok(monitor.flowKey, 'e ele aciona um Flow')

  const fonte = blueprint.operations.sources.find((s) => s.key === monitor.dependsOn[0].replace('historico-', 'fonte-'))
  assert.ok(blueprint.operations.sources.length >= 1)
  assert.ok(blueprint.operations.histories.length >= 1, 'sem "antes" e "agora" não há borda')
  assert.ok(blueprint.operations.flows.some((f) => f.trigger.type === 'monitor'))
  void fonte

  // O que falta é DITO, e não preenchido com palpite.
  assert.ok(pending.some((p) => p.kind === 'source_config'), 'falta dizer de onde o dado vem')

  // E o dado ao vivo do Brief virou fonte + destino, em vez de sumir.
  assert.ok(blueprint.operations.liveDestinations.some((l) => l.alias.includes('cxse3')))
  assert.equal(blueprint.operations.liveDestinations[0].agentKeys.length, 0, 'acesso é concessão, não padrão')
  assert.equal(blueprint.operations.liveDestinations[0].staleAfterSeconds, 60, '"até 1 minuto" é 60 segundos')
})

test('CENÁRIO B: campo ausente vira pendência, e o monitor não nasce com limiar inventado', () => {
  const brief = {
    ...emptyBrief('Vigiar algo'),
    jobs: [{ id: 'vigiar', name: 'Vigiar', trigger: 'quando ficar abaixo', input: 'x', decision: '', action: 'monitorar', output: 'aviso' }],
  }
  const { blueprint, pending } = compilar(brief)
  assert.equal(blueprint.operations.monitors.length, 0, 'sem limiar, não há monitor')
  assert.ok(pending.some((p) => p.kind === 'monitor_condition'))
})

// --- CENÁRIO C: restaurante -------------------------------------------------------------------

test('CENÁRIO C: restaurante — ações exatas de WhatsApp e Calendar, e o vínculo do canal', () => {
  const brief = {
    ...emptyBrief('Automatizar atendimento e reservas'),
    channels: ['whatsapp'],
    jobs: [
      { id: 'atender', name: 'Atender o cliente', trigger: 'chega uma mensagem', input: 'a mensagem', decision: 'o que a pessoa quer', action: 'responder', output: 'a resposta' },
      { id: 'reservar', name: 'Reservar mesa', trigger: 'o cliente pede uma mesa', input: 'a data e o horário', decision: '', action: 'criar evento na agenda', output: 'a confirmação' },
    ],
  }
  const { blueprint } = compilar(brief)

  // LACUNA 5 CORRIGIDA: nenhum App sai sem ação.
  assert.ok(blueprint.resources.appRequirements.length > 0)
  for (const req of blueprint.resources.appRequirements) {
    assert.ok(req.actionKeys.length > 0, `${req.appKey} saiu sem ação`)
    assert.deepEqual(req.autonomousWriteActionKeys, [], 'escrita autônoma é aprovada por ação, na tela')
  }
  const cal = blueprint.resources.appRequirements.find((r) => r.appKey === 'google_calendar')
  assert.ok(cal?.actionKeys.includes('create_event'), 'criar evento é a ação real do trabalho')

  // LACUNA 7 CORRIGIDA: o canal ganha um vínculo com quem recebe.
  const vinculo = blueprint.operations.channels[0]
  assert.ok(vinculo, 'o vínculo do canal precisa existir')
  assert.equal(vinculo.appKey, 'whatsapp')
  assert.ok(vinculo.entryAgentKey, 'uma porta que não leva a ninguém é uma porta fechada')
  assert.ok(blueprint.organization.agents.some((a) => a.key === vinculo.entryAgentKey))
})

test('CENÁRIO C: as responsabilidades dos agentes nunca ficam vazias', () => {
  const brief = {
    ...emptyBrief('Atendimento'),
    jobs: [{ id: 'atender', name: 'Atender', trigger: 'chega mensagem', input: 'a mensagem', decision: 'o que a pessoa quer', action: 'responder', output: 'a resposta' }],
  }
  const { blueprint } = compilar(brief)
  for (const a of blueprint.organization.agents) {
    for (const campo of ['role', 'trigger', 'inputContract', 'outputContract']) {
      assert.ok(String(a[campo] ?? '').trim(), `${a.name} está sem ${campo}`)
    }
  }
  // E o plano inteiro passa no validador V2, que recusa agente sem responsabilidade.
  const r = v2.validateBlueprintV2(blueprint)
  const semPapel = r.issues.filter((i) => i.code?.startsWith('agent_without'))
  assert.deepEqual(semPapel, [])
})

// --- CENÁRIO D: salão existente -----------------------------------------------------------------

test('CENÁRIO D: um andar que já existe é REUSADO, não duplicado', () => {
  const brief = {
    ...emptyBrief('Adicionar recepção e agenda ao salão'),
    jobs: [{ id: 'recepcao', name: 'Atender na recepção', trigger: 'chega um cliente', input: 'o pedido', decision: 'o que ele quer', action: 'responder', output: 'a resposta' }],
  }
  const inventory = inventarioCom([
    { id: '000000000000000000000f01', label: 'Atendimento', ownerScope: 'building:000000000000000000000b01', status: 'active', meta: {} },
  ])
  const { blueprint } = c2.compileBriefV2({
    brief,
    manifest: manifesto(),
    inventory,
    base: { title: 'Salão', objective: 'Atender' },
    changeKind: 'expand',
  })

  const andar = blueprint.organization.floors.find((f) => f.name === 'Atendimento')
  assert.ok(andar, 'a área de atendimento precisa aparecer')
  assert.equal(andar.action, 'reuse', 'expandir não é criar do zero')
  assert.equal(andar.resourceId, '000000000000000000000f01')
  assert.match(andar.rationale, /já existe/)
})

test('CENÁRIO D: um andar com nome parecido mas diferente NÃO é reaproveitado', () => {
  // "Atendimento ao fornecedor" não é "Atendimento": reaproveitar por semelhança vaga faria
  // a expansão sobrescrever o que já existia.
  const brief = {
    ...emptyBrief('Atendimento ao cliente'),
    jobs: [{ id: 'atender', name: 'Atender', trigger: 'chega mensagem', input: 'x', decision: 'y', action: 'z', output: 'w' }],
  }
  const inventory = inventarioCom([
    { id: '000000000000000000000f02', label: 'Atendimento ao fornecedor', ownerScope: 'building:x', status: 'active', meta: {} },
  ])
  const { blueprint } = c2.compileBriefV2({ brief, manifest: manifesto(), inventory, base: { title: 'X', objective: 'Y' }, changeKind: 'expand' })
  assert.equal(blueprint.organization.floors[0].action, 'create')
})

// --- LACUNA 4, do outro lado: várias áreas viram vários andares ------------------------------------

test('LACUNA 4 CORRIGIDA: três áreas viram três andares, e não um andar genérico', () => {
  const brief = {
    ...emptyBrief('Uma empresa com atendimento, financeiro e logística'),
    jobs: [
      { id: 'atender', name: 'Atender o cliente', trigger: 'mensagem', input: 'x', decision: 'y', action: 'z', output: 'w' },
      { id: 'cobrar', name: 'Cobrar o financeiro', trigger: 'vencimento', input: 'x', decision: 'y', action: 'z', output: 'w' },
      { id: 'entregar', name: 'Fazer a logística', trigger: 'pedido pago', input: 'x', decision: 'y', action: 'z', output: 'w' },
    ],
  }
  const { blueprint } = compilar(brief)
  const nomes = blueprint.organization.floors.map((f) => f.name).sort()
  assert.deepEqual(nomes, ['Atendimento', 'Financeiro', 'Logística'])
  assert.notEqual(blueprint.organization.floors[0].key, 'operacao')
})

// --- determinismo ------------------------------------------------------------------------------

test('mesmo Brief, mesmo inventário → mesmo Blueprint, inclusive as chaves', () => {
  const brief = {
    ...emptyBrief('Atendimento'),
    channels: ['whatsapp'],
    jobs: [{ id: 'atender', name: 'Atender', trigger: 'chega mensagem', input: 'x', decision: 'y', action: 'responder', output: 'a resposta' }],
  }
  const a = compilar(brief).blueprint
  const b = compilar(brief).blueprint
  assert.equal(v2.computeBlueprintV2Hash(a), v2.computeBlueprintV2Hash(b))
  assert.deepEqual(
    a.organization.agents.map((x) => x.key),
    b.organization.agents.map((x) => x.key),
  )
})

test('o plano compilado passa na validação estrutural', () => {
  const brief = {
    ...emptyBrief('Atendimento e reservas'),
    channels: ['whatsapp'],
    liveDataNeeds: [{ source: 'agenda do dia', freshness: 'até 5 minutos', required: false }],
    jobs: [
      { id: 'atender', name: 'Atender', trigger: 'chega mensagem', input: 'a mensagem', decision: 'o que quer', action: 'responder', output: 'a resposta' },
      { id: 'reservar', name: 'Reservar', trigger: 'pede mesa', input: 'a data', decision: '', action: 'criar evento na agenda', output: 'a confirmação' },
    ],
  }
  const { blueprint } = compilar(brief)
  const r = v2.validateBlueprintV2(blueprint)
  assert.equal(r.valid, true, JSON.stringify(r.issues.filter((i) => i.severity === 'error'), null, 1))
})

test('a ordem de aplicação sai coerente: fonte antes de histórico, histórico antes de monitor', () => {
  const brief = {
    ...emptyBrief('Vigiar o RSI'),
    jobs: [{ id: 'rsi', name: 'Vigiar o RSI', trigger: 'quando o RSI ficar abaixo de 30', input: 'cotações', decision: '', action: 'monitorar', output: 'aviso' }],
  }
  const { blueprint } = compilar(brief)
  const ordem = v2.applyOrder(blueprint)
  const fonte = blueprint.operations.sources[0].key
  const historico = blueprint.operations.histories[0].key
  const monitor = blueprint.operations.monitors[0].key
  assert.ok(ordem.indexOf(fonte) < ordem.indexOf(historico))
  assert.ok(ordem.indexOf(historico) < ordem.indexOf(monitor))
})

// --- os andares decididos fora ---------------------------------------------------------------
//
// Enquanto a flag do V2 rola, quem cria andares e agentes continua sendo a saga do V1, a
// partir do plano V1. Se o V2 inventasse as próprias `key`s, o Flow dele apontaria para um
// andar que ninguém criou — e `floor:atendimento` nunca resolveria no `resourceMap`.

const briefDeVigilancia = () => ({
  ...emptyBrief('Acompanhar CXSE3'),
  liveDataNeeds: [{ source: 'cotação CXSE3', freshness: 'até 1 minuto', required: true }],
  jobs: [
    {
      id: 'avisar-rsi',
      name: 'Avisar sobre o RSI',
      trigger: 'quando o RSI ficar abaixo de 30',
      input: 'as cotações de CXSE3',
      decision: '',
      action: 'monitorar e avisar',
      output: 'o aviso',
      frequency: 'a cada candle',
    },
  ],
})

test('os andares recebidos de fora são usados COMO ESTÃO — nenhuma key é inventada', () => {
  const r = compilar(briefDeVigilancia(), { floors: [{ key: 'operacao', name: 'Operação' }] })
  assert.deepEqual(
    r.blueprint.organization.floors.map((f) => f.key),
    ['operacao'],
  )
  // A AÇÃO vem junto: `reuse` sem `resourceId` seria dizer que existe um andar que não
  // existe, e o validador recusa isso.
  assert.equal(r.blueprint.organization.floors[0].action, 'create')
})

test('TUDO que o V2 aponta para andar aponta para um andar que existe no plano', () => {
  const r = compilar(briefDeVigilancia(), { floors: [{ key: 'operacao', name: 'Operação' }] })
  const chaves = new Set(r.blueprint.organization.floors.map((f) => f.key))
  const referencias = [
    ...r.blueprint.organization.agents.map((a) => a.floorKey),
    ...r.blueprint.organization.sectors.map((s) => s.floorKey),
    ...r.blueprint.operations.flows.map((f) => f.floorKey),
    ...r.blueprint.operations.routines.map((x) => x.floorKey),
  ].filter(Boolean)
  assert.ok(referencias.length > 0, 'o brief de vigilância tem que gerar pelo menos um Flow ou agente')
  for (const ref of referencias) assert.ok(chaves.has(ref), `aponta para "${ref}", que não é um andar do plano`)
})

test('SEM andares de fora, o V2 continua decidindo os próprios — o caminho antigo não muda', () => {
  const r = compilar(briefDeVigilancia())
  assert.equal(r.blueprint.organization.floors.length >= 1, true)
  assert.equal(r.blueprint.organization.floors[0].action, 'create')
})

// --- o casamento de ação, palavra por palavra --------------------------------------------------
//
// `alvo.includes('criar evento')` falha em "criar o evento na agenda" — a frase que qualquer
// pessoa escreve. Perder o App por causa de um artigo no meio cria um agente que não alcança
// o sistema de que ele precisa, e ninguém descobre até a primeira reserva não entrar na
// agenda.

test('a ação casa mesmo com artigo no meio da frase', () => {
  const app = manifesto().apps.find((a) => a.key === 'google_calendar')
  const r = c2.resolveAppActions(app, { id: 'j', name: 'Reservar mesa', action: 'criar o evento na agenda', output: 'a confirmação', decision: 'se há vaga' })
  assert.ok(r.write.includes('create_event'), JSON.stringify(r))
})

test('e continua conservador: a ação que NÃO foi citada não entra', () => {
  const app = manifesto().apps.find((a) => a.key === 'google_calendar')
  const r = c2.resolveAppActions(app, { id: 'j', name: 'Reservar mesa', action: 'criar o evento na agenda', output: '', decision: '' })
  assert.equal(r.write.includes('delete_event'), false, 'apagar evento é destrutivo e ninguém pediu')
  assert.equal(r.read.includes('list_events'), false, '"listar" não aparece em lugar nenhum')
})

test('o andar existente é reconhecido pela MESMA ÁREA, e não só pelo nome igual', () => {
  const salao = inventarioCom([{ id: '000000000000000000000f01', label: 'Recepção' }])
  // "adicione recepção" vira a área "Atendimento"; o andar da pessoa se chama "Recepção".
  const achado = c2.findExistingFloor(salao, 'Atendimento')
  assert.equal(achado?.id, '000000000000000000000f01', 'propor "Atendimento" ao lado de "Recepção" cria dois andares para a mesma coisa')
  assert.equal(achado.label, 'Recepção', 'o nome que fica é o que a pessoa já usa')
})

test('AMEAÇA: uma área DIFERENTE não sequestra o andar existente', () => {
  const salao = inventarioCom([{ id: '000000000000000000000f01', label: 'Recepção' }])
  assert.equal(c2.findExistingFloor(salao, 'Financeiro'), null)
  assert.equal(c2.findExistingFloor(salao, 'Logística'), null)
})

// --- §10.1: o que precisa ficar GUARDADO ------------------------------------------------------
//
// "Quanto está agora" e "como variou" são perguntas diferentes. Sem `recordsToKeep`, toda
// proposta nascia sem Database nenhum — e a cadeia parava no monitor, que precisa de um
// conjunto para observar.

const briefComRegistros = (over = {}) => ({
  ...emptyBrief('Guardar o histórico de atendimento'),
  recordsToKeep: [{ subject: 'Atendimentos', fields: ['cliente', 'assunto', 'duração'], retentionDays: 365 }],
  jobs: [{ id: 'atender', name: 'Atender o cliente', trigger: 'chega mensagem', input: 'a mensagem', decision: 'o que responder', action: 'responder', output: 'a resposta' }],
  ...over,
})

test('um registro a guardar vira Database + conjunto, com os campos declarados', () => {
  const { blueprint } = compilar(briefComRegistros())
  const db = blueprint.resources.databases[0]
  assert.ok(db, 'nenhum Database foi proposto')
  assert.equal(db.action, 'create')
  assert.equal(db.name, 'Atendimentos')
  assert.equal(db.retentionDays, 365)

  const conjunto = blueprint.resources.datasets[0]
  assert.ok(conjunto, 'um Database sem conjunto não tem o que guardar')
  assert.equal(conjunto.dependsOn[0], db.key, 'o conjunto tem que ser criado depois do Database')
  assert.deepEqual(Object.keys(conjunto.schema.properties).sort(), ['assunto', 'cliente', 'duracao'])
  assert.equal(conjunto.mutability, 'append_only', 'corrigir o valor de ontem mudaria o gráfico sem registro')
})

test('sem CAMPOS declarados, o conjunto vira pendência — nunca um schema que aceita tudo', () => {
  const r = compilar(briefComRegistros({ recordsToKeep: [{ subject: 'Atendimentos', fields: [], retentionDays: null }] }))
  assert.equal(r.blueprint.resources.databases.length, 1, 'o Database ainda faz sentido')
  assert.equal(r.blueprint.resources.datasets.length, 0)
  assert.ok(
    r.pending.some((p) => p.kind === 'dataset_fields'),
    JSON.stringify(r.pending),
  )
})

test('o registro guardado ganha um teste de aceitação obrigatório', () => {
  const { blueprint } = compilar(briefComRegistros())
  const teste = blueprint.acceptanceTests.find((t) => t.kind === 'database_permission')
  assert.ok(teste, `nenhum teste do Database: ${JSON.stringify(blueprint.acceptanceTests)}`)
  assert.equal(teste.targetKey, blueprint.resources.databases[0].key)
  assert.equal(teste.required, true)
})

test('um Database que JÁ existe é reusado, e não duplicado', () => {
  const inventory = {
    ownerId: 'dono',
    at: new Date(),
    building: { id: '000000000000000000000b01', name: 'Prédio' },
    sections: { database: { kind: 'database', total: 1, truncated: false, items: [{ id: '000000000000000000000d01', label: 'Atendimentos' }] } },
  }
  const { blueprint } = compilar(briefComRegistros(), { inventory })
  assert.equal(blueprint.resources.databases[0].action, 'reuse')
  assert.equal(blueprint.resources.databases[0].resourceId, '000000000000000000000d01')
})

test('o plano com Database continua passando na validação estrutural', () => {
  const { blueprint } = compilar(briefComRegistros())
  const r = v2.validateBlueprintV2(blueprint)
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('um canal NATIVO, sem ação declarada, não vira requisito de App vazio', () => {
  // `web_chat` é porta de entrada do próprio produto, não um sistema de terceiro. Um
  // requisito de App sem ação nenhuma é recusado pelo validador — e derrubava a proposta
  // inteira com um erro vermelho que ninguém conseguia resolver na tela.
  const brief = {
    ...emptyBrief('Atender pelo chat do site'),
    channels: ['web_chat'],
    jobs: [{ id: 'atender', name: 'Atender o cliente', trigger: 'chega mensagem', input: 'a mensagem', decision: 'o que responder', action: 'responder', output: 'a resposta' }],
  }
  const { blueprint } = compilar(brief)
  assert.equal(blueprint.resources.appRequirements.some((r) => r.appKey === 'web_chat'), false)
  // Mas o VÍNCULO existe: quem chega precisa de um agente que receba.
  const vinculo = blueprint.operations.channels.find((c) => c.appKey === 'web_chat')
  assert.ok(vinculo, 'sem vínculo, a mensagem não chega a lugar nenhum')
  assert.deepEqual(vinculo.dependsOn, [blueprint.organization.agents[0].key], 'depender de um item que não está no plano é recusado pelo validador')
  assert.equal(v2.validateBlueprintV2(blueprint).valid, true)
})

test('um canal COM ações declaradas continua virando requisito de App', () => {
  const brief = {
    ...emptyBrief('Atender pelo WhatsApp'),
    channels: ['whatsapp'],
    jobs: [{ id: 'atender', name: 'Atender o cliente', trigger: 'chega mensagem', input: 'a mensagem', decision: 'o que responder', action: 'responder', output: 'a resposta' }],
  }
  const { blueprint } = compilar(brief)
  const req = blueprint.resources.appRequirements.find((r) => r.appKey === 'whatsapp')
  assert.ok(req, 'o WhatsApp declara ações, e elas precisam ser pedidas')
  assert.ok(req.actionKeys.length > 0)
})

// --- o setor, que o V2 não produzia ------------------------------------------------------------
//
// Enquanto a organização é aplicada pelo plano V1, os dois documentos precisam falar do MESMO
// setor. Uma chave diferente criaria um segundo setor ao lado do primeiro.

const briefDeDoisAgentes = () => ({
  ...emptyBrief('Atender e cobrar'),
  jobs: [
    { id: 'atender', name: 'Atender o cliente', trigger: 'chega mensagem', input: 'a mensagem', decision: 'o que responder', action: 'responder', output: 'a resposta' },
    { id: 'cobrar', name: 'Cobrar o cliente', trigger: 'quando a fatura vence', input: 'a fatura', decision: 'se cobra agora', action: 'avisar', output: 'o aviso' },
  ],
})

test('dois agentes no mesmo andar viram um setor coordenado', () => {
  const { blueprint } = compilar(briefDeDoisAgentes(), { floors: [{ key: 'operacao', name: 'Operação' }] })
  const setor = blueprint.organization.sectors[0]
  assert.ok(setor, `nenhum setor: ${JSON.stringify(blueprint.organization.agents.map((a) => a.key))}`)
  assert.equal(setor.key, 'mesa', 'a chave é a mesma do V1: outra criaria um segundo setor')
  assert.equal(setor.mode, 'orchestrated')
  assert.equal(setor.memberAgentKeys.length, 2)
  assert.equal(setor.coordinatorAgentKey, blueprint.organization.agents[0].key)
  // O setor depende do andar E dos membros: sem isso, a equipe aplicada seria menor.
  assert.ok(setor.dependsOn.includes('operacao'))
  for (const a of setor.memberAgentKeys) assert.ok(setor.dependsOn.includes(a), `falta ${a} em dependsOn`)
})

test('UM agente não vira setor — agrupar uma pessoa é o que a constituição proíbe', () => {
  const brief = { ...emptyBrief('Só atender'), jobs: [briefDeDoisAgentes().jobs[0]] }
  const { blueprint } = compilar(brief, { floors: [{ key: 'operacao', name: 'Operação' }] })
  assert.equal(blueprint.organization.agents.length, 1)
  assert.deepEqual(blueprint.organization.sectors, [])
})

test('o plano com setor continua passando na validação estrutural', () => {
  const { blueprint } = compilar(briefDeDoisAgentes(), { floors: [{ key: 'operacao', name: 'Operação' }] })
  const r = v2.validateBlueprintV2(blueprint)
  assert.equal(r.valid, true, JSON.stringify(r.issues))
})

test('o andar recebido de fora carrega a ação DELE, com o resourceId junto', () => {
  const r = compilar(briefDeDoisAgentes(), {
    floors: [{ key: 'operacao', name: 'Atendimento', action: 'reuse', resourceId: '000000000000000000000f01' }],
  })
  const andar = r.blueprint.organization.floors[0]
  assert.equal(andar.action, 'reuse')
  assert.equal(andar.resourceId, '000000000000000000000f01')
  assert.equal(v2.validateBlueprintV2(r.blueprint).valid, true, JSON.stringify(v2.validateBlueprintV2(r.blueprint).issues))
})

test('AMEAÇA: `reuse` sem resourceId não sai daqui — seria apontar para um andar que não existe', () => {
  const r = compilar(briefDeDoisAgentes(), { floors: [{ key: 'operacao', name: 'Operação', action: 'reuse' }] })
  const andar = r.blueprint.organization.floors[0]
  assert.equal(andar.resourceId, undefined)
  // Sem id, o compilador não pode honrar o `reuse`: ele cai para `create`, que é o que a
  // aplicação vai fazer de verdade.
  assert.equal(andar.action, 'create')
  assert.equal(v2.validateBlueprintV2(r.blueprint).valid, true)
})

// --- o dado que JÁ ESTÁ NA CONTA ------------------------------------------------------------
//
// O CENÁRIO QUE FALHOU DE VERDADE: a conta tem um Database "Bitcoin" que já recebe cotação
// a cada quinze segundos. O pedido foi "pegue esse dado e guarde a máxima e a mínima do
// dia". O Assistente criou uma fonte nova do zero, deixou uma pendência pedindo "de onde
// este dado vem" — e abriu um andar novo para uma operação que não precisava de andar
// nenhum.
//
// A causa é estreita e verificável: `compilarFonteDeDado` nascia com `action: 'create'`
// fixo e não recebia o inventário. Andar e Database já sabiam procurar o que existe
// (`findExistingFloor`, `acharDatabase`); a fonte de dado, não. O resultado é o pior tipo
// de proposta: ela parece completa, e o que ela monta ignora o que a pessoa já tem.

const inventarioComBase = (nome) => ({
  ownerId: 'dono',
  at: new Date(),
  building: { id: '000000000000000000000b01', name: 'Prédio' },
  sections: {
    database: {
      kind: 'database',
      total: 1,
      truncated: false,
      items: [{ id: '000000000000000000000db1', label: nome, ownerScope: 'account:', status: 'active', meta: { adapterKind: 'data_history' } }],
    },
    dataset: {
      kind: 'dataset',
      total: 1,
      truncated: false,
      items: [
        {
          id: '000000000000000000000db1:cotacoes',
          label: 'Cotações',
          ownerScope: 'database:000000000000000000000db1',
          meta: { dataStoreId: '000000000000000000000db1', key: 'cotacoes', mutability: 'append_only' },
        },
      ],
    },
  },
})

test('ACEITAÇÃO: um dado que já está numa Database da conta é REUSADO, não recriado', () => {
  const brief = {
    ...emptyBrief('Guardar a máxima e a mínima do dia do Bitcoin'),
    liveDataNeeds: [{ source: 'Bitcoin', freshness: '15s', required: true }],
  }
  const { blueprint, pending } = compilar(brief, { inventory: inventarioComBase('Bitcoin') })

  // A proposta APONTA para a base que existe, em vez de abrir uma fonte do zero.
  const usoDaBase = blueprint.resources.databases.find((d) => d.action === 'reuse')
  assert.ok(usoDaBase, `nenhum Database reusado; propostos: ${JSON.stringify(blueprint.resources.databases.map((d) => [d.key, d.action]))}`)
  assert.equal(usoDaBase.resourceId, '000000000000000000000db1')

  // E não sobra a pendência que manda a pessoa dizer de onde vem um dado que já chega.
  const semFonte = pending.filter((p) => p.kind === 'source_config')
  assert.deepEqual(semFonte, [], `pendência sobrando: ${JSON.stringify(semFonte)}`)
})

test('AMEAÇA: uma base de OUTRO assunto não é confundida com a pedida', () => {
  /**
   * O erro oposto, e pior: reusar por parecer. Uma base de "Notas fiscais" respondendo a um
   * pedido sobre Bitcoin gravaria dado de um assunto dentro do outro — e ninguém veria,
   * porque a proposta diria "reusando o que você já tem".
   */
  const brief = {
    ...emptyBrief('Guardar a máxima e a mínima do dia do Bitcoin'),
    liveDataNeeds: [{ source: 'Bitcoin', freshness: '15s', required: true }],
  }
  const { blueprint, pending } = compilar(brief, { inventory: inventarioComBase('Notas fiscais') })

  assert.equal(blueprint.resources.databases.filter((d) => d.action === 'reuse').length, 0)
  // Sem base para reusar, a fonte volta a ser criada — e a pendência honesta reaparece.
  assert.ok(pending.some((p) => p.kind === 'source_config'), 'sem base compatível, a pendência tem de aparecer')
})

const inventarioComAndares = (nomes) => ({
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

test('ACEITAÇÃO: numa conta com UM andar, um trabalho sem área não abre andar novo', () => {
  /**
   * O SEGUNDO SINTOMA DO MESMO PEDIDO: "cara, ele criou um novo andar".
   *
   * Sem palavra de área no texto ("atendimento", "financeiro"...), o nome do andar virava o
   * TÍTULO DA OPERAÇÃO — e um título nunca casa com um andar existente, então nascia um
   * andar por operação. Guardar a máxima do Bitcoin não é uma área da empresa; é trabalho
   * que mora num andar que já existe.
   */
  const brief = { ...emptyBrief('Guardar a máxima e a mínima do dia do Bitcoin') }
  const { blueprint } = compilar(brief, {
    inventory: inventarioComAndares(['Operações']),
    base: { title: 'Máxima e mínima do Bitcoin', objective: 'Guardar as pontas do dia' },
  })

  const andares = blueprint.organization.floors
  assert.equal(andares.length, 1, `andares propostos: ${JSON.stringify(andares.map((f) => [f.name, f.action]))}`)
  assert.equal(andares[0].action, 'reuse')
  assert.equal(andares[0].resourceId, '00000000000000000000f000')
})

test('AMEAÇA: com VÁRIOS andares e nenhuma área dita, o Assistente PERGUNTA em vez de escolher', () => {
  /**
   * Escolher sozinho entre três andares é adivinhar onde o trabalho da pessoa mora — e a
   * proposta sairia montada no lugar errado, parecendo certa. Perguntar é mais barato que
   * desfazer.
   */
  const brief = { ...emptyBrief('Guardar a máxima e a mínima do dia do Bitcoin') }
  const { blueprint, pending } = compilar(brief, {
    inventory: inventarioComAndares(['Atendimento', 'Financeiro', 'Logística']),
    base: { title: 'Máxima e mínima do Bitcoin', objective: 'Guardar as pontas do dia' },
  })

  assert.ok(
    pending.some((p) => p.kind === 'floor_choice'),
    `faltou a pendência de escolha de andar: ${JSON.stringify(pending)}`,
  )
  // E ela não inventa um andar novo enquanto a resposta não vem.
  assert.equal(blueprint.organization.floors.filter((f) => f.action === 'create').length, 0)
})

test('ACEITAÇÃO: o dado que já chega por uma FONTE da conta também é reconhecido', () => {
  /**
   * O CASO REAL: a pessoa diz "já tenho uma base com o valor do bitcoin". Na plataforma,
   * o que existe é uma FONTE chamada "Bitcoin" gravando num Database chamado "Históricos".
   * O nome que ela usa está na fonte, não na base — e o casador só olhava a base e os
   * conjuntos, então não achava nada e mandava criar uma coleta nova em cima de uma coleta
   * que já roda há 13 mil leituras.
   */
  const inventario = {
    ownerId: 'dono',
    at: new Date(),
    building: { id: '000000000000000000000b01', name: 'Prédio' },
    sections: {
      database: {
        kind: 'database',
        total: 1,
        truncated: false,
        items: [{ id: '000000000000000000000db1', label: 'Históricos', ownerScope: 'account:', status: 'active', meta: { adapterKind: 'data_history' } }],
      },
      source: {
        kind: 'source',
        total: 1,
        truncated: false,
        items: [{ id: '000000000000000000000f01', label: 'Bitcoin', ownerScope: 'account:', status: 'active', meta: { kind: 'api_polling', history: true } }],
      },
    },
  }
  const brief = {
    ...emptyBrief('Guardar a máxima e a mínima do dia do Bitcoin'),
    liveDataNeeds: [{ source: 'Bitcoin', freshness: '15s', required: true }],
  }
  const { blueprint, pending } = compilar(brief, { inventory: inventario })

  // Nada de coleta nova: a fonte que já roda é a fonte.
  assert.equal(blueprint.operations.sources.filter((s) => s.action === 'create').length, 0, JSON.stringify(blueprint.operations.sources))
  assert.deepEqual(pending.filter((p) => p.kind === 'source_config'), [])
})

test('ACEITAÇÃO: a base que a operação usa é CONCEDIDA aos agentes dela', () => {
  /**
   * Sem isto o plano cria a base, cria o agente, e o agente não alcança a base: a operação
   * fica montada e muda. O acesso é concessão — quem concede é o dono, na aprovação — mas
   * o plano precisa DIZER de quem é o acesso, senão não há o que aprovar.
   */
  const brief = {
    ...emptyBrief('Guardar o máximo diário do Bitcoin'),
    recordsToKeep: [{ subject: 'máximo diário do bitcoin', fields: ['data', 'maximo'], retentionDays: null }],
    jobs: [
      {
        id: 'j1',
        name: 'Registrar o máximo do dia',
        trigger: 'todo fim de dia',
        input: 'as cotações do dia',
        decision: 'conferir se já existe registro do dia',
        action: 'gravar data e máximo',
        output: 'uma linha por dia',
      },
    ],
  }
  const { blueprint } = compilar(brief)
  const base = blueprint.resources.databases[0]
  assert.ok(base, 'a proposta precisa ter a base de destino')
  assert.ok(Array.isArray(base.agentKeys), 'a base precisa declarar de quem é o acesso')
  assert.ok(base.agentKeys.length > 0, `nenhum agente alcança a base: ${JSON.stringify(base)}`)
})

// --- Fase 2: porta de entrada só onde alguém entra --------------------------------------
//
// O DEFEITO MAIS IRÔNICO DA SÉRIE. O dono pediu duas vezes para tirar o web_chat, e
// conseguiu esvaziar `brief.channels`. Só que `resolveChannel` diz:
//
//   // Ninguém pediu canal: aí sim o conectado serve, porque não há pedido para contrariar.
//   const conectado = canais.find((c) => c.connected)
//
// Esvaziar a lista é EXATAMENTE o que dispara o padrão. Ele insistiu até acionar o gatilho
// do que estava tentando evitar — e a aplicação saiu com `["channel","created"]`.
//
// A regra certa é o que o canal É: uma porta para alguém FALAR com o agente. Numa operação
// que roda sozinha no fim do dia não há quem fale.

const soRotina = () => ({
  ...emptyBrief('Guardar o máximo diário do Bitcoin'),
  channels: [],
  jobs: [
    {
      id: 'j1',
      name: 'Registrar o máximo do dia',
      trigger: 'todo fim de dia, por rotina agendada',
      input: 'as cotações do dia',
      decision: 'conferir se já existe registro daquela data',
      action: 'gravar data e máximo',
      output: 'uma linha por dia',
    },
  ],
})

test('ACEITAÇÃO: operação só-rotina não ganha canal, mesmo com web_chat conectado', () => {
  const { blueprint } = compilar(soRotina())
  assert.deepEqual(blueprint.operations.channels, [], `canal aberto sem ninguém para entrar: ${JSON.stringify(blueprint.operations.channels)}`)
  assert.equal(blueprint.resources.appRequirements.filter((r) => r.key.startsWith('canal-')).length, 0)
})

test('quem ATENDE continua ganhando a porta', () => {
  const brief = {
    ...emptyBrief('Atender quem escreve pelo site'),
    channels: [],
    jobs: [{ id: 'j1', name: 'Responder a dúvida do cliente', trigger: 'quando o cliente escreve', input: 'a pergunta', decision: 'entender o pedido', action: 'responder', output: 'a resposta' }],
  }
  const { blueprint } = compilar(brief)
  assert.equal(blueprint.operations.channels.length, 1, 'sem canal, ninguém alcança quem atende')
})

test('AMEAÇA: pedir um canal explicitamente continua valendo, mesmo sem conversa no texto', () => {
  // Pedido é pedido. A regra tira o PADRÃO silencioso, não a escolha de quem pediu.
  const { blueprint } = compilar({ ...soRotina(), channels: ['web_chat'] })
  assert.equal(blueprint.operations.channels.length, 1, 'o canal pedido por escrito sumiu')
})

// --- Fase 3: a base de ORIGEM entra no plano --------------------------------------------
//
// O agente aplicado sabia GRAVAR e não sabia LER: o `resourceMap` da aplicação real tinha
// uma base só, a de destino. A de origem — a que já recebe o preço do bitcoin — não entrou
// no plano, e por isso não recebeu concessão nenhuma.
//
// A causa foi minha: ao reconhecer que a fonte já existe, o compilador `return`ava sem
// declarar nada. Não duplicar a coleta estava certo; sair sem dizer DE ONDE SE LÊ, não —
// a operação inteira existe para ler dali.

test('ACEITAÇÃO: a fonte que já existe vira base de LEITURA no plano, com acesso', () => {
  const inventario = {
    ownerId: 'dono',
    at: new Date(),
    building: { id: '000000000000000000000b01', name: 'Prédio' },
    sections: {
      database: { kind: 'database', total: 1, truncated: false, items: [{ id: '000000000000000000000db1', label: 'Históricos', ownerScope: 'account:', status: 'active', meta: { adapterKind: 'data_history' } }] },
      source: { kind: 'source', total: 1, truncated: false, items: [{ id: '000000000000000000000f01', label: 'Bitcoin', ownerScope: 'account:', status: 'active', meta: { kind: 'api_polling', history: true, dataStoreId: '000000000000000000000db1' } }] },
    },
  }
  const brief = {
    ...soRotina(),
    liveDataNeeds: [{ source: 'Base de preços do bitcoin a cada 15 segundos', freshness: '15s', required: true }],
    recordsToKeep: [{ subject: 'máximo diário do bitcoin', fields: ['data', 'maximo'], retentionDays: null }],
  }
  const { blueprint, pending } = compilar(brief, { inventory: inventario })

  // Nenhuma coleta nova: a fonte que já roda continua sendo a fonte.
  assert.equal(blueprint.operations.sources.filter((s) => s.action === 'create').length, 0)
  assert.deepEqual(pending.filter((p) => p.kind === 'source_config'), [])

  // DUAS bases: de onde se lê e onde se grava — cada uma com o seu acesso.
  const leitura = blueprint.resources.databases.find((d) => d.agentAccess === 'read')
  const escrita = blueprint.resources.databases.find((d) => d.agentAccess === 'write')
  assert.ok(leitura, `sem base de leitura, o agente não alcança o dado: ${JSON.stringify(blueprint.resources.databases)}`)
  assert.equal(leitura.action, 'reuse')
  assert.equal(leitura.resourceId, '000000000000000000000db1')
  assert.ok(escrita, 'sem base de destino, não há onde gravar')
  assert.ok((leitura.agentKeys ?? []).length > 0, 'a leitura precisa dizer de quem é')
})

test('ACEITAÇÃO: respondida "é outra origem", ele NÃO reusa — abre a coleta nova', () => {
  /**
   * A pergunta só vale se a resposta mandar. Se a pessoa disse que a base que ele achou não
   * é a dela, insistir no reuso seria pior que nunca ter perguntado: ela responderia e veria
   * a proposta ignorar a resposta.
   */
  const inventario = {
    ownerId: 'dono',
    at: new Date(),
    building: { id: '000000000000000000000b01', name: 'Prédio' },
    sections: {
      database: { kind: 'database', total: 1, truncated: false, items: [{ id: '000000000000000000000db1', label: 'Históricos', ownerScope: 'account:', meta: { adapterKind: 'data_history' } }] },
      source: { kind: 'source', total: 1, truncated: false, items: [{ id: '000000000000000000000f01', label: 'Bitcoin', ownerScope: 'account:', meta: { kind: 'api_polling', dataStoreId: '000000000000000000000db1' } }] },
    },
  }
  const brief = { ...soRotina(), liveDataNeeds: [{ source: 'valor do bitcoin', freshness: '15s', required: true }] }

  // Sem resposta: ele reusa e declara a leitura.
  const reusa = compilar(brief, { inventory: inventario })
  assert.ok(reusa.blueprint.resources.databases.some((d) => d.agentAccess === 'read'))

  // "é outra origem": ele volta a criar a coleta, e a pendência honesta reaparece.
  const cria = compilar(brief, { inventory: inventario, answers: { 'origem:valor-do-bitcoin': 'criar' } })
  assert.equal(cria.blueprint.resources.databases.some((d) => d.agentAccess === 'read'), false, 'ignorou a resposta e reusou assim mesmo')
  assert.ok(cria.pending.some((p) => p.kind === 'source_config'))
})

// --- O NOME DE QUEM CHEGA -------------------------------------------------------------------
//
// Toda montagem recomeçava no índice 0 da lista de nomes: a conta acumulava uma Marina,
// depois outra Marina, e o dono não conseguia dizer por quem estava chamando. Quem já está
// no escritório é quem decide o que sobrou.
const inventarioComAgentes = (nomes) => ({
  ownerId: 'dono',
  at: new Date(),
  building: { id: '000000000000000000000b01', name: 'Prédio' },
  sections: {
    agent: { kind: 'agent', total: nomes.length, truncated: false, items: nomes.map((n, i) => ({ id: `a${i}`, label: n, ownerScope: 'building:x' })) },
  },
})

const agentesDe = (bp) => bp.organization.agents

test('o nome do agente pula quem já existe na conta', () => {
  const brief = {
    ...emptyBrief('Atendimento'),
    jobs: [{ id: 'atender', name: 'Atender o cliente', trigger: 'chega mensagem', input: 'x', decision: 'y', action: 'z', output: 'w' }],
  }
  const semNinguem = agentesDe(compilar(brief).blueprint)
  assert.ok(semNinguem.length > 0, 'a montagem tem de produzir ao menos um agente')

  const usado = semNinguem[0].name
  const comEle = agentesDe(c2.compileBriefV2({ brief, manifest: manifesto(), inventory: inventarioComAgentes([usado]), base: { title: 'X', objective: 'Y' } }).blueprint)
  assert.notEqual(comEle[0].name, usado, 'o nome já em uso não pode ser oferecido de novo')
})

// --- O PEDIDO DO BITCOIN, LITERAL ------------------------------------------------------------
//
// "Salvar o valor mínimo e máximo de bitcoin em um intervalo de 5 minutos."
//
// O motor de Históricos faz isso desde sempre — `window_aggregate` com `min` e `max` são
// operações determinísticas de primeira classe. O compilador não lia o pedido assim: procurava
// uma função registrada no catálogo, não achava nenhuma, e devolvia pendência rodada após
// rodada. Depois de aplicar, a pergunta do dono foi "onde está a função?".

const briefDoBitcoin = (over = {}) => ({
  ...emptyBrief('Guardar o mínimo e o máximo do bitcoin'),
  jobs: [
    {
      id: 'consolidar',
      name: 'Salvar o valor mínimo e máximo de bitcoin em um intervalo de 5 minutos',
      trigger: 'a cada janela fechada',
      input: 'preço do bitcoin em tempo real',
      decision: '',
      action: 'consolidar mínimo e máximo em janelas de 5 minutos',
      output: 'uma linha por janela',
    },
  ],
  liveDataNeeds: [{ source: 'preço do bitcoin em tempo real', freshness: '15s', required: true }],
  recordsToKeep: [{ subject: 'preço do bitcoin', fields: ['price'], retentionDays: null }],
  ...over,
})

test('ACEITAÇÃO: "mínimo e máximo a cada 5 minutos" vira uma janela no plano, não uma pendência', () => {
  const { blueprint, pending } = compilar(briefDoBitcoin())
  const janela = blueprint.operations.histories.find((h) => h.window)
  assert.ok(janela, `nenhuma janela no plano: ${JSON.stringify(blueprint.operations.histories.map((h) => h.key))}`)
  assert.equal(janela.window.everyMs, 300_000)
  assert.deepEqual(
    janela.window.rules.map((r) => `${r.from}:${r.op}:${r.to}`).sort(),
    ['price:max:maximo', 'price:min:minimo'],
    'as contas têm de ser as que a frase pediu, sobre o campo que a pessoa declarou',
  )
  // E o que sumiu: a pendência de "nenhuma função registrada faz este cálculo".
  assert.equal(
    pending.some((p) => /função|funcao/i.test(p.because ?? '')),
    false,
    `a conta existe no motor — declarar pendência dela é mandar a pessoa esperar por nada: ${JSON.stringify(pending)}`,
  )
})

test('a fonte que a conta JÁ TEM é reaproveitada, não duplicada', () => {
  const inventory = {
    ownerId: 'dono',
    at: new Date(),
    building: { id: '000000000000000000000b01', name: 'Prédio' },
    sections: { source: { kind: 'source', total: 1, truncated: false, items: [{ id: 's1', label: 'Bitcoin', ownerScope: 'account', meta: { fields: 'price' } }] } },
  }
  const { blueprint } = c2.compileBriefV2({ brief: briefDoBitcoin(), manifest: manifesto(), inventory, base: { title: 'X', objective: 'Y' } })
  const fonte = blueprint.operations.sources.find((f) => f.key.startsWith('fonte-'))
  assert.ok(fonte, 'a janela precisa de uma fonte')
  assert.equal(fonte.action, 'reuse', 'criar outra coleta do mesmo endereço produz dois históricos que divergem')
  assert.equal(fonte.name, 'Bitcoin')
})

test('AMEAÇA: sem campo declarado NÃO há janela — resumir o campo errado mente em todo gráfico', () => {
  const { blueprint } = compilar(briefDoBitcoin({ recordsToKeep: [] }))
  assert.equal(blueprint.operations.histories.some((h) => h.window), false)
})

test('AMEAÇA: "guardar o preço do bitcoin" não vira janela — isso é toda ocorrência', () => {
  const brief = briefDoBitcoin({
    jobs: [{ id: 'guardar', name: 'Guardar o preço do bitcoin', trigger: 'chega leitura', input: 'preço', decision: '', action: 'gravar', output: 'linha' }],
  })
  const { blueprint } = compilar(brief)
  assert.equal(blueprint.operations.histories.some((h) => h.window), false, 'sem tamanho de janela e sem conta, não é uma série resumida')
})

// --- O QUE O TESTE REAL DO DONO MOSTROU ------------------------------------------------------
//
// A janela passou a ser compilada — e o plano nasceu com três defeitos que só aparecem com
// dado de verdade:
//
//   from: "timestamp_da_janela"          → mínimo e máximo do RELÓGIO, não do preço
//   fontes: reuse:Bitcoin | reuse:Bitcoin → duas coletas do mesmo endereço
//   resourceId: null                      → "reuse" sem dizer qual, e o apply estourou

const inventarioComBitcoin = () => ({
  ownerId: 'dono',
  at: new Date(),
  building: { id: '000000000000000000000b01', name: 'Prédio' },
  sections: {
    source: {
      kind: 'source',
      total: 1,
      truncated: false,
      items: [{ id: '000000000000000000000501', label: 'Bitcoin', ownerScope: 'account', meta: { fields: 'price, timestamp' } }],
    },
  },
})

const briefDeDoisTrabalhos = () => ({
  ...emptyBrief('Guardar o mínimo e o máximo do bitcoin'),
  jobs: [
    { id: 'consolidar', name: 'Consolidar mínimo e máximo do bitcoin em janelas de 5 minutos', trigger: 'janela fechada', input: 'preço do bitcoin', decision: '', action: 'consolidar mínimo e máximo a cada 5 minutos', output: 'uma linha' },
    { id: 'armazenar', name: 'Armazenar histórico consolidado do bitcoin a cada 5 minutos', trigger: 'janela fechada', input: 'preço do bitcoin', decision: '', action: 'gravar o mínimo e o máximo a cada 5 minutos', output: 'linha gravada' },
  ],
  liveDataNeeds: [{ source: 'preço do bitcoin', freshness: '15s', required: true }],
  // O modelo listou o carimbo de tempo PRIMEIRO — foi assim no teste real.
  recordsToKeep: [{ subject: 'bitcoin', fields: ['timestamp_da_janela', 'preco'], retentionDays: null }],
})

test('AMEAÇA: a janela resume o PREÇO, nunca o carimbo de tempo', () => {
  const { blueprint } = c2.compileBriefV2({ brief: briefDeDoisTrabalhos(), manifest: manifesto(), inventory: inventarioComBitcoin(), base: { title: 'X', objective: 'Y' } })
  const janela = blueprint.operations.histories.find((h) => h.window)
  assert.ok(janela, 'a janela tem de existir')
  assert.equal(janela.window.rules[0].from, 'price', 'mínimo e máximo do relógio é uma série que parece certa e mente')
  assert.equal(janela.window.rules.every((r) => !/timestamp|data|hora/i.test(r.from)), true)
})

test('AMEAÇA: dois trabalhos sobre a MESMA série não viram duas séries', () => {
  const { blueprint } = c2.compileBriefV2({ brief: briefDeDoisTrabalhos(), manifest: manifesto(), inventory: inventarioComBitcoin(), base: { title: 'X', objective: 'Y' } })
  const janelas = blueprint.operations.histories.filter((h) => h.window)
  assert.equal(janelas.length, 1, `duas séries iguais gravam a mesma linha duas vezes: ${JSON.stringify(janelas.map((j) => j.key))}`)
  const fontes = blueprint.operations.sources.filter((f) => f.key.startsWith('fonte-'))
  assert.equal(fontes.length, 1, 'duas coletas do mesmo endereço divergem no primeiro erro de rede')
})

test('AMEAÇA: reaproveitar diz QUAL — um "reuse" sem id só falha na aplicação', () => {
  const { blueprint } = c2.compileBriefV2({ brief: briefDeDoisTrabalhos(), manifest: manifesto(), inventory: inventarioComBitcoin(), base: { title: 'X', objective: 'Y' } })
  const fonte = blueprint.operations.sources.find((f) => f.key.startsWith('fonte-'))
  assert.equal(fonte.action, 'reuse')
  assert.equal(fonte.resourceId, '000000000000000000000501', 'sem o id, o apply estoura com "a fonte não foi criada"')
})

test('sem fonte conhecida, a janela ainda sai — e a origem vira pendência declarada', () => {
  const { blueprint, pending } = compilar(briefDeDoisTrabalhos())
  const fonte = blueprint.operations.sources.find((f) => f.key.startsWith('fonte-'))
  assert.equal(fonte.action, 'create')
  assert.ok(pending.some((p) => p.kind === 'source_config'), 'de onde vem o dado precisa ser perguntado, não inventado')
  // E sem campos da fonte, vale o que a pessoa declarou — ainda sem carimbo de tempo.
  assert.equal(blueprint.operations.histories.find((h) => h.window).window.rules[0].from, 'preco')
})

// --- A REGRA VALE PARA QUALQUER CONTA --------------------------------------------------------
//
// "Todas as correções têm que ser gerais, nunca vai ser o mesmo assunto entre os usuários."
//
// A versão anterior pegava "o primeiro campo que não é data". Passou no caso que estava na
// mesa (`price, timestamp`) e escolheria `sku` numa fonte `sku, quantidade`. Uma regra que só
// acerta no exemplo da mesa está errada — por isso cada caso aqui é de um domínio diferente.

const fonteChamada = (label, fields) => ({
  ownerId: 'dono',
  at: new Date(),
  building: { id: '000000000000000000000b01', name: 'Prédio' },
  sections: { source: { kind: 'source', total: 1, truncated: false, items: [{ id: '000000000000000000000777', label, ownerScope: 'account', meta: { fields } }] } },
})

const pedido = (nome, acao, origem) => ({
  ...emptyBrief(nome),
  jobs: [{ id: 'j', name: nome, trigger: 'janela fechada', input: origem, decision: '', action: acao, output: 'uma linha por janela' }],
  liveDataNeeds: [{ source: origem, freshness: '1m', required: true }],
  recordsToKeep: [],
})

test('ACEITAÇÃO: o campo é o que o PEDIDO nomeia — em qualquer assunto', () => {
  const casos = [
    // [fonte, campos da fonte, pedido, ação, campo esperado, conta esperada]
    ['Bitcoin', 'price, timestamp', 'Guardar o mínimo e o máximo do price a cada 5 minutos', 'consolidar por janela', 'price', 'min'],
    ['Estoque', 'sku, quantidade, atualizado_em', 'Guardar a média de quantidade a cada 1 hora', 'resumir por janela', 'quantidade', 'avg'],
    ['Pedidos', 'pedido_id, valor_total, criado_em', 'Somar valor_total a cada 1 hora', 'resumir por janela', 'valor_total', 'sum'],
    ['Sensor', 'sensor_id, temperatura, lido_em', 'Guardar a maior temperatura a cada 10 minutos', 'resumir por janela', 'temperatura', 'max'],
  ]
  for (const [label, campos, nome, acao, esperado, conta] of casos) {
    const { blueprint } = c2.compileBriefV2({ brief: pedido(nome, acao, label), manifest: manifesto(), inventory: fonteChamada(label, campos), base: { title: 'X', objective: 'Y' } })
    const janela = blueprint.operations.histories.find((h) => h.window)
    assert.ok(janela, `${label}: a janela não saiu`)
    assert.equal(janela.window.rules[0].from, esperado, `${label}: resumiu o campo errado`)
    assert.ok(janela.window.rules.some((r) => r.op === conta), `${label}: a conta pedida não entrou`)
  }
})

test('com um candidato só na fonte, não há o que escolher — nem precisa nomear', () => {
  const { blueprint } = c2.compileBriefV2({
    brief: pedido('Guardar o menor e o maior valor a cada 5 minutos', 'resumir', 'Cotação'),
    manifest: manifesto(),
    inventory: fonteChamada('Cotação', 'preco, capturado_em'),
    base: { title: 'X', objective: 'Y' },
  })
  assert.equal(blueprint.operations.histories.find((h) => h.window).window.rules[0].from, 'preco')
})

test('AMEAÇA: com DOIS candidatos e nenhum nomeado, a janela vira PERGUNTA — não palpite', () => {
  const r = c2.compileBriefV2({
    brief: pedido('Guardar o mínimo e o máximo a cada 5 minutos', 'resumir por janela', 'Estoque'),
    manifest: manifesto(),
    inventory: fonteChamada('Estoque', 'sku, quantidade, atualizado_em'),
    base: { title: 'X', objective: 'Y' },
  })
  assert.equal(r.blueprint.operations.histories.some((h) => h.window), false, 'escolher entre sku e quantidade é chutar')
  const p = r.pending.find((x) => x.kind === 'window_field')
  assert.ok(p, `a janela pedida não pode sumir calada: ${JSON.stringify(r.pending)}`)
  assert.match(p.because, /sku/, 'a pergunta tem de dizer entre o que escolher')
  assert.match(p.because, /quantidade/)
})

test('AMEAÇA: nenhum campo de tempo é resumido, em português ou inglês', () => {
  for (const campos of ['created_at, updated_at', 'timestamp, date, time', 'inicio_da_janela, fim_da_janela']) {
    const r = c2.compileBriefV2({
      brief: pedido('Guardar o mínimo e o máximo a cada 5 minutos', 'resumir', 'Coisa'),
      manifest: manifesto(),
      inventory: fonteChamada('Coisa', campos),
      base: { title: 'X', objective: 'Y' },
    })
    assert.equal(r.blueprint.operations.histories.some((h) => h.window), false, `resumiu um carimbo de tempo: ${campos}`)
  }
})

test('ACEITAÇÃO: "grave em um novo database" liga a janela ao conjunto que o plano cria', () => {
  /**
   * É uma frase só — "grave em um novo database o máximo e o mínimo a cada 5 minutos" — e
   * eram duas partes do compilador decidindo onde o dado mora, sem se falarem.
   */
  const brief = {
    ...emptyBrief('Consolidar por janela'),
    jobs: [{ id: 'j', name: 'Gravar o máximo e o mínimo do preco a cada 5 minutos', trigger: 'janela fechada', input: 'Cotação', decision: '', action: 'consolidar por janela', output: 'uma linha' }],
    liveDataNeeds: [{ source: 'Cotação', freshness: '15s', required: true }],
    recordsToKeep: [{ subject: 'consolidado do preco', fields: ['minimo', 'maximo'], retentionDays: null }],
  }
  const { blueprint } = compilar(brief)
  const janela = blueprint.operations.histories.find((h) => h.window)
  assert.ok(janela, 'a janela tem de existir')
  const conjunto = blueprint.resources.datasets.find((d) => d.key === janela.datasetKey)
  assert.ok(conjunto, `a janela aponta para um conjunto que o plano não cria: ${janela.datasetKey}`)
  assert.ok(janela.dependsOn.includes(conjunto.key), 'sem a dependência, a janela é aplicada antes do conjunto existir')
})

// --- O MODELO DECLARA, O CÓDIGO DECIDE -------------------------------------------------------
//
// "Do jeito que está não está legal": cada forma nova de pedir exigia regex nova minha.
// "somar" não casava com "soma"; inglês não casava com nada. Esse era o teto.
//
// Agora o modelo devolve ESTRUTURA — `windows[]`, validado campo a campo — e ela vence a
// leitura por expressão regular. O compilador continua decidindo se a série entra no plano.

const briefLivre = (nome, origem) => ({
  ...emptyBrief(nome),
  jobs: [{ id: 'j', name: nome, trigger: 'janela fechada', input: origem, decision: '', action: nome, output: 'uma linha' }],
  liveDataNeeds: [{ source: origem, freshness: '1m', required: true }],
  recordsToKeep: [],
})

test('ACEITAÇÃO: uma frase que a regex NÃO entende vira janela quando o modelo declara', () => {
  // Inglês: `parseJanela` não casa com nada disto. O modelo entende, e é esse o ponto.
  const brief = briefLivre('Keep the highest and lowest reading every 5 minutes', 'Sensor')
  assert.equal(c2.parseJanela('Keep the highest and lowest reading every 5 minutes', 'leitura'), null, 'a regex não entende — é a premissa do caso')

  const { blueprint } = c2.compileBriefV2({
    brief,
    manifest: manifesto(),
    inventory: fonteChamada('Sensor', 'leitura, lido_em'),
    base: { title: 'X', objective: 'Y' },
    windows: [{ source: 'Sensor', field: 'leitura', everyMs: 300_000, ops: ['min', 'max'] }],
  })
  const janela = blueprint.operations.histories.find((h) => h.window)
  assert.ok(janela, 'o que o modelo declarou tem de entrar no plano')
  assert.equal(janela.window.everyMs, 300_000)
  assert.deepEqual(janela.window.rules.map((r) => `${r.from}:${r.op}:${r.to}`).sort(), ['leitura:max:maximo', 'leitura:min:minimo'])
})

test('o declarado VENCE a regex quando os dois falam da mesma frase', () => {
  // A regex leria "media" sobre `preco`; o modelo declarou `quantidade` com `sum`. Manda quem
  // entendeu a frase, não quem casou um padrão.
  const { blueprint } = c2.compileBriefV2({
    brief: briefLivre('Guardar a média a cada 1 hora de quantidade', 'Estoque'),
    manifest: manifesto(),
    inventory: fonteChamada('Estoque', 'preco, quantidade, criado_em'),
    base: { title: 'X', objective: 'Y' },
    windows: [{ source: 'Estoque', field: 'quantidade', everyMs: 3_600_000, ops: ['sum'] }],
  })
  const j = blueprint.operations.histories.find((h) => h.window)
  assert.equal(j.window.rules.length, 1)
  assert.equal(j.window.rules[0].from, 'quantidade')
  assert.equal(j.window.rules[0].op, 'sum')
})

test('AMEAÇA: janela declarada sem tamanho, sem campo ou com conta inventada NÃO entra', () => {
  // A validação é do turno (`normalizeTurn`); aqui prendemos o outro lado: o compilador não
  // aceita o que chegar. Uma conta que o motor não tem gravaria uma coluna que ninguém lê.
  for (const w of [
    { source: 'S', field: 'leitura', everyMs: 0, ops: ['min'] },
    { source: 'S', field: '', everyMs: 300_000, ops: ['min'] },
    { source: 'S', field: 'leitura', everyMs: 300_000, ops: [] },
  ]) {
    const { blueprint } = c2.compileBriefV2({
      brief: briefLivre('Keep the lowest every 5 minutes', 'Sensor'),
      manifest: manifesto(),
      inventory: fonteChamada('Sensor', 'leitura, lido_em'),
      base: { title: 'X', objective: 'Y' },
      windows: [w],
    })
    assert.equal(blueprint.operations.histories.some((h) => h.window), false, `entrou uma janela quebrada: ${JSON.stringify(w)}`)
  }
})

test('sem nada declarado, a regex continua valendo — nada do que funcionava se perdeu', () => {
  const { blueprint } = c2.compileBriefV2({
    brief: briefLivre('Guardar o mínimo e o máximo de temperatura a cada 10 minutos', 'Sensor'),
    manifest: manifesto(),
    inventory: fonteChamada('Sensor', 'temperatura, lido_em'),
    base: { title: 'X', objective: 'Y' },
  })
  const j = blueprint.operations.histories.find((h) => h.window)
  assert.ok(j, 'a rede de segurança sumiu')
  assert.equal(j.window.everyMs, 600_000)
  assert.equal(j.window.rules[0].from, 'temperatura')
})

test('ACEITAÇÃO: o Database e o conjunto que a FERRAMENTA anotou viram itens do plano', () => {
  const { blueprint } = c2.compileBriefV2({
    brief: { ...emptyBrief('Guardar as leituras'), jobs: [{ id: 'j', name: 'Guardar leituras', trigger: 'chega leitura', input: 'sensor', decision: '', action: 'gravar', output: 'linha' }] },
    manifest: manifesto(),
    inventory: null,
    base: { title: 'X', objective: 'Y' },
    declarados: {
      databases: [{ chave: 'base-camara-fria', nome: 'Câmara fria', descricao: 'leituras', tipo: 'data_history', agentes: ['vigia'], acesso: 'write' }],
      conjuntos: [{ databaseChave: 'base-camara-fria', chave: 'leituras', nome: 'Leituras', campos: [{ nome: 'temperatura', tipo: 'number' }], podeEditar: false }],
    },
  })
  const base = blueprint.resources.databases.find((d) => d.key === 'base-camara-fria')
  assert.ok(base, `o Database declarado não entrou: ${JSON.stringify(blueprint.resources.databases.map((d) => d.key))}`)
  assert.equal(base.action, 'create')
  assert.deepEqual(base.agentKeys, ['vigia'], 'sem a concessão declarada, a base nasce inalcançável')
  assert.equal(base.agentAccess, 'write')

  const conjunto = blueprint.resources.datasets.find((d) => d.datasetKey === 'leituras')
  assert.ok(conjunto, 'o conjunto declarado não entrou')
  assert.equal(conjunto.databaseKey, 'base-camara-fria')
  assert.ok(conjunto.dependsOn.includes('base-camara-fria'), 'sem a dependência, o conjunto é aplicado antes do Database existir')
  // O schema é o que a consulta e a condição do monitor leem.
  assert.deepEqual(conjunto.schema.properties, { temperatura: { type: 'number' } })
  assert.equal(conjunto.mutability, 'append_only')
})

test('o Database declarado que a conta JÁ TEM vira reuse, apontando para o recurso', () => {
  const inv = {
    ownerId: 'dono',
    at: new Date(),
    building: { id: '000000000000000000000b01', name: 'Prédio' },
    sections: { database: { kind: 'database', total: 1, truncated: false, items: [{ id: '000000000000000000000d09', label: 'Históricos', ownerScope: 'account' }] } },
  }
  const { blueprint } = c2.compileBriefV2({
    brief: { ...emptyBrief('x'), jobs: [{ id: 'j', name: 'Guardar', trigger: 't', input: 'i', decision: '', action: 'a', output: 'o' }] },
    manifest: manifesto(),
    inventory: inv,
    base: { title: 'X', objective: 'Y' },
    declarados: { databases: [{ chave: 'base-historicos', nome: 'Históricos', descricao: '', tipo: 'data_history', agentes: [], acesso: 'read' }], conjuntos: [] },
  })
  const base = blueprint.resources.databases.find((d) => d.key === 'base-historicos')
  assert.equal(base.action, 'reuse', 'criar outra base com o mesmo nome é recusado pelo domínio, tarde demais')
  assert.equal(base.resourceId, '000000000000000000000d09')
})
