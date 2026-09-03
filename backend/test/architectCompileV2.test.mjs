// O COMPILADOR V2 — e os quatro cenários que o plano exige.
//
// Cada bloco abaixo é uma das lacunas do V1, agora do outro lado: o mesmo Brief que produzia
// um andar genérico, um App sem ação, o canal errado e uma rotina das oito da manhã.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const c2 = await import('../dist/architect/compileV2.js')
const v2 = await import('../dist/architect/blueprintV2.js')
const { emptyBrief } = await import('../dist/architect/brief.js')

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
  // E o andar recebido nasce como `reuse`: quem o cria é a aplicação da organização.
  assert.equal(r.blueprint.organization.floors[0].action, 'reuse')
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
