// A CADEIA Source → History/Dataset → Flow → Monitor, e o que estava invertido nela.
//
// O compilador declarava o monitor dependendo do histórico e o Flow dependendo do monitor. A
// ordem topológica saía histórico → monitor → Flow: o monitor nascia ANTES do Flow, e o
// `flowId` dele saía `null`. Um monitor sem ação é um alarme que reconhece a transição e não
// aciona nada — ele parece configurado.
//
// E pior: quando o conjunto observado ainda não existia, a aplicação devolvia o id da FONTE
// como se o monitor tivesse sido criado. O passo ficava `created`, o `resourceMap` passava a
// apontar `monitor:x` para um documento de `monitoring_sources`, e o desfazer removeria a
// fonte achando que remove o monitor.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { applyV2Resources } = await import('../dist/architect/applyV2.js')
const { applyOrder } = await import('../dist/architect/blueprintV2.js')
const c2 = await import('../dist/architect/compileV2.js')
const t2 = await import('../dist/architect/typesV2.js')
const { emptyBrief } = await import('../dist/architect/brief.js')

const DONO = 'dono-cadeia'
let predio
let andar
let agente

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['buildings', 'offices', 'agents', 'data_stores', 'dataset_definitions', 'monitoring_sources', 'monitors', 'automations', 'automation_versions'])
    await db.collection(c).deleteMany({})
  predio = new ObjectId()
  andar = new ObjectId()
  agente = new ObjectId()
  await db.collection('buildings').insertOne({ _id: predio, ownerId: DONO, name: 'P', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: andar, ownerId: DONO, buildingId: predio, name: 'Operação', status: 'active', workMode: 'organization', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('agents').insertOne({ _id: agente, ownerId: DONO, officeId: andar, name: 'Marina', role: 'Avisa', provider: 'anthropic', createdAt: new Date() })
})

const MANIFESTO = {
  version: 1,
  presets: [],
  executorKinds: [],
  sectorModes: [],
  activationModes: [],
  functions: [],
  apps: [],
  tools: [],
  knowledgeScopes: ['agent', 'sector', 'floor', 'building'],
  channels: [{ key: 'web_chat', connected: true }],
}

/** O Brief da vigilância: é ele que produz a cadeia inteira. */
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
      action: 'avisar',
      output: 'o aviso',
      frequency: 'a cada candle',
    },
  ],
})

const compilar = () =>
  c2.compileBriefV2({
    brief: briefDeVigilancia(),
    manifest: MANIFESTO,
    inventory: null,
    base: { title: 'CXSE3', objective: 'Vigiar o RSI' },
    changeKind: 'create',
    floors: [{ key: 'operacao', name: 'Operação', action: 'create' }],
  }).blueprint

// --- a ordem ---------------------------------------------------------------------------------

test('ACEITAÇÃO: o FLOW é aplicado ANTES do monitor', async () => {
  const bp = compilar()
  const ordem = applyOrder(bp)
  const flow = bp.operations.flows[0]
  const monitor = bp.operations.monitors[0]
  assert.ok(flow && monitor, 'o Brief de vigilância precisa produzir Flow e monitor')
  assert.ok(
    ordem.indexOf(flow.key) < ordem.indexOf(monitor.key),
    `o monitor recebe o id do Flow: criá-lo antes deixa o alarme sem ação. Ordem: ${ordem.join(' → ')}`,
  )
})

test('AMEAÇA: a cadeia não tem dependência circular', () => {
  const bp = compilar()
  const porKey = new Map()
  for (const path of t2.V2_ITEM_PATHS) for (const i of t2.itemsAt(bp, path)) porKey.set(i.key, i.dependsOn ?? [])

  const visitando = new Set()
  const pronto = new Set()
  const anda = (k, caminho) => {
    if (pronto.has(k)) return
    assert.equal(visitando.has(k), false, `ciclo: ${[...caminho, k].join(' → ')}`)
    visitando.add(k)
    for (const d of porKey.get(k) ?? []) if (porKey.has(d)) anda(d, [...caminho, k])
    visitando.delete(k)
    pronto.add(k)
  }
  for (const k of porKey.keys()) anda(k, [])
})

// --- a aplicação ------------------------------------------------------------------------------

const aplicar = (bp, over = {}) =>
  applyV2Resources({
    ownerId: DONO,
    blueprint: bp,
    resourceMap: new Map([
      ['floor:operacao', andar.toString()],
      [`agent:${bp.organization.agents[0]?.key ?? 'x'}`, agente.toString()],
    ]),
    approvedKeys: new Set(t2.V2_ITEM_PATHS.flatMap((p) => t2.itemsAt(bp, p).map((i) => i.key))),
    ...over,
  })

/** O que cada `kind` do passo precisa ser, de verdade, no banco. */
const COLECAO = { database: 'data_stores', source: 'monitoring_sources', monitor: 'monitors', flow: 'automations' }

test('ACEITAÇÃO: todo passo `created` aponta para um recurso REAL do tipo certo', async () => {
  const bp = compilar()
  // A fonte compilada nasce sem origem — declarada como pendência. Para exercitar a cadeia
  // inteira, damos a ela a origem que o Brief não tinha.
  for (const f of bp.operations.sources) {
    f.config = { url: 'https://api.exemplo.test/candles', method: 'GET' }
    f.mapping = { version: 1, fields: [{ to: 'rsi', from: 'rsi', required: true }] }
  }

  const passos = await aplicar(bp)
  const criados = passos.filter((p) => p.status === 'created')
  assert.ok(criados.length >= 3, `esperava a cadeia criada, veio: ${JSON.stringify(passos)}`)

  for (const p of criados) {
    const colecao = COLECAO[p.kind]
    if (!colecao) continue
    assert.ok(p.resourceId, `${p.kind}:${p.key} diz "created" sem id`)
    assert.ok(ObjectId.isValid(p.resourceId), `${p.kind}:${p.key} tem id inválido: ${p.resourceId}`)
    const doc = await db.collection(colecao).findOne({ _id: new ObjectId(p.resourceId), ownerId: DONO })
    assert.ok(doc, `${p.kind}:${p.key} diz "created" e não existe em ${colecao} — pendência tratada como criação`)
  }
})

test('ACEITAÇÃO: o monitor grava o ID REAL do Flow', async () => {
  /**
   * Sobre um conjunto que JÁ EXISTE — é onde esta garantia é verificável na aplicação.
   *
   * Com histórico de fonte nova o monitor é pendência honesta: o conjunto só nasce quando a
   * fonte entra no ar. A cadeia completa, com ativação, é provada ponta a ponta em
   * `architectCxse3EndToEnd`.
   */
  const bp = compilar()
  bp.resources.databases = [
    { key: 'base', action: 'create', layer: 'essential', rationale: 'x', dependsOn: [], name: 'Cotações', owner: { ownerType: 'account' }, adapterKind: 'data_history' },
  ]
  bp.resources.datasets = [
    {
      key: 'candles',
      action: 'create',
      layer: 'essential',
      rationale: 'x',
      dependsOn: ['base'],
      databaseKey: 'base',
      datasetKey: 'candles',
      name: 'Candles',
      schema: { type: 'object', properties: { rsi: {} } },
      mutability: 'append_only',
    },
  ]
  const monitor = bp.operations.monitors[0]
  monitor.observes = { kind: 'dataset', datasetKey: 'candles' }
  monitor.dependsOn = ['candles', bp.operations.flows[0].key]

  const passos = await aplicar(bp)
  const passoDoFlow = passos.find((p) => p.kind === 'flow' && p.status === 'created')
  const passoDoMonitor = passos.find((p) => p.kind === 'monitor' && p.status === 'created')
  assert.ok(passoDoFlow, `o Flow não foi criado: ${JSON.stringify(passos)}`)
  assert.ok(passoDoMonitor, `o monitor não foi criado: ${JSON.stringify(passos)}`)

  const doc = await db.collection('monitors').findOne({ _id: new ObjectId(passoDoMonitor.resourceId) })
  assert.ok(doc.action?.flowId, 'um monitor sem ação reconhece a transição e não aciona nada')
  assert.equal(String(doc.action.flowId), passoDoFlow.resourceId, 'o monitor precisa apontar para o Flow desta aplicação')
})

test('AMEAÇA: sem conjunto observável, o monitor é PENDÊNCIA — nunca o id da fonte', async () => {
  const bp = compilar()
  for (const f of bp.operations.sources) {
    f.config = { url: 'https://api.exemplo.test/c', method: 'GET' }
    f.mapping = { version: 1, fields: [{ to: 'rsi', from: 'rsi', required: true }] }
  }
  const passos = await aplicar(bp)

  const passoDoMonitor = passos.find((p) => p.kind === 'monitor')
  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  if (passoDoMonitor.status === 'created') {
    // Se ele diz que criou, tem que existir em `monitors` — e não ser a fonte disfarçada.
    assert.notEqual(passoDoMonitor.resourceId, fonte?._id.toString(), 'o id da fonte devolvido como se fosse o monitor')
    assert.ok(await db.collection('monitors').findOne({ _id: new ObjectId(passoDoMonitor.resourceId) }))
  } else {
    assert.equal(passoDoMonitor.status, 'skipped')
    assert.ok(passoDoMonitor.message?.trim(), 'uma pendência sem motivo não é retomável')
  }
})

test('a fonte nasce parada, o Flow rascunho e o monitor rascunho — nada entra no ar sozinho', async () => {
  const bp = compilar()
  for (const f of bp.operations.sources) {
    f.config = { url: 'https://api.exemplo.test/c', method: 'GET' }
    f.mapping = { version: 1, fields: [{ to: 'rsi', from: 'rsi', required: true }] }
  }
  await aplicar(bp)

  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.equal(fonte?.status, 'draft')
  const flow = await db.collection('automations').findOne({ ownerId: DONO })
  if (flow) assert.notEqual(flow.status, 'active')
  const monitor = await db.collection('monitors').findOne({ ownerId: DONO })
  if (monitor) assert.notEqual(monitor.status, 'published')
})

// --- nada do plano some em silêncio ------------------------------------------------------------

/**
 * TODO item do Blueprint vira passo — criado, reusado, ou pendência com motivo.
 *
 * O contrato do V2 declara dezoito listas. A aplicação percorre dez delas; o resto é criado pela
 * saga do V1, na MESMA operação e no mesmo `resourceMap`. A pergunta que ninguém tinha como
 * responder é a terceira possibilidade: uma lista declarada que **ninguém** percorre. Um item ali
 * não é criado, não vira pendência e não aparece na prévia — ele simplesmente não existe, e a
 * proposta diz que existe.
 *
 * `resources.memoryPolicies` é exatamente esse caso hoje: nenhum compilador o emite, então nada
 * some — mas basta alguém emitir um para ele evaporar sem nenhum sinal. Este caso trava a porta:
 * o que o plano declara, a aplicação registra.
 */
test('ACEITAÇÃO: todo item declarado no plano vira PASSO — nenhum some calado', async () => {
  const bp = compilar()
  for (const f of bp.operations.sources) {
    f.config = { url: 'https://api.exemplo.test/c', method: 'GET' }
    f.mapping = { version: 1, fields: [{ to: 'fechamento', from: 'fechamento', required: true }] }
  }
  // Um item em cada lista que a aplicação do V2 percorre, para o caso valer alguma coisa.
  bp.resources.databases.push({ key: 'base-extra', action: 'create', layer: 'essential', rationale: 'x', dependsOn: [], name: 'Extra', owner: { ownerType: 'account' }, adapterKind: 'data_history' })
  bp.resources.tools.push({ key: 'ferramenta-extra', action: 'create', layer: 'essential', rationale: 'x', dependsOn: [], name: 'calculate_rsi', description: 'a conta', provider: 'function', agentKeys: [] })

  const passos = await aplicar(bp)
  const comPasso = new Set(passos.map((p) => p.key))

  const CRIADAS_PELO_V2 = [
    'resources.databases',
    'resources.datasets',
    'resources.tools',
    'operations.channels',
    'operations.sources',
    'operations.liveDestinations',
    'operations.histories',
    'operations.monitors',
    'operations.flows',
    'operations.deliveries',
  ]
  const semPasso = []
  for (const caminho of CRIADAS_PELO_V2) {
    for (const item of t2.itemsAt(bp, caminho)) {
      if (!comPasso.has(item.key)) semPasso.push(`${caminho}:${item.key}`)
    }
  }
  assert.deepEqual(semPasso, [], `itens declarados que não viraram passo: ${semPasso.join(', ')}`)

  /**
   * E toda pendência diz POR QUÊ.
   *
   * Um passo `skipped` sem motivo é indistinguível de um esquecimento: quem retoma não sabe o
   * que fazer, e quem audita não sabe o que aconteceu.
   */
  for (const p of passos.filter((x) => x.status === 'skipped')) {
    assert.ok(String(p.message ?? '').trim(), `${p.kind}:${p.key} ficou pendente sem motivo`)
  }
})

test('AMEAÇA: nenhuma CHAVE do plano é um ObjectId — elas são estáveis, e o modelo não as inventa', async () => {
  /**
   * A chave é o que liga a proposta ao recurso aplicado, e ela precisa sobreviver a uma
   * recompilação. Um ObjectId ali significaria que o modelo escolheu um id — e um id escolhido
   * por um modelo aponta para o recurso de outra pessoa ou para nada.
   */
  const bp = compilar()
  const chaves = []
  for (const caminho of t2.V2_ITEM_PATHS) for (const i of t2.itemsAt(bp, caminho)) chaves.push(`${caminho}:${i.key}`)
  assert.ok(chaves.length > 0, 'o plano precisa ter itens para este caso dizer algo')

  for (const entrada of chaves) {
    const key = entrada.split(':').pop()
    assert.equal(ObjectId.isValid(key), false, `${entrada} é um ObjectId: a chave tem que ser estável`)
    assert.match(key, /^[a-z0-9][a-z0-9-]*$/, `${entrada} não é uma chave estável em minúsculas`)
  }

  // E a mesma compilação, de novo, produz as MESMAS chaves.
  const outra = compilar()
  const denovo = []
  for (const caminho of t2.V2_ITEM_PATHS) for (const i of t2.itemsAt(outra, caminho)) denovo.push(`${caminho}:${i.key}`)
  assert.deepEqual(denovo, chaves, 'a chave mudou entre duas compilações do mesmo Brief: uma revisão criaria recursos ao lado dos que já existem')
})
