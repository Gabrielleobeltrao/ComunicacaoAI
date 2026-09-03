// A SAGA DO V2 — recursos e operações, pelos serviços canônicos.
//
// Três garantias que estes casos protegem, e que não são preferências:
//
//   NADA NASCE LIGADO. Uma fonte nasce rascunho; um monitor e um Flow nascem rascunho. Criar
//   já ativo é entregar uma operação que ninguém provou que funciona, e que começa a agir
//   sozinha na mesma hora.
//
//   A ORDEM VEM DO PLANO. Sem `dependsOn`, a aplicação criaria um monitor antes do dataset
//   que ele observa e falharia num passo que não tem defeito.
//
//   QUEM CRIA É O DOMÍNIO. Nenhuma coleção é escrita direto: cada criação passa pelo serviço
//   canônico, com a validação, a cota e os índices que já existem.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { applyV2Resources } = await import('../dist/architect/applyV2.js')
const t = await import('../dist/architect/typesV2.js')

const DONO = 'dono-saga-v2'
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
  for (const c of ['buildings', 'offices', 'agents', 'sectors', 'data_stores', 'dataset_definitions', 'monitoring_sources', 'monitors', 'automations', 'automation_versions', 'widgets', 'connections', 'tools'])
    await db.collection(c).deleteMany({})

  predio = new ObjectId()
  andar = new ObjectId()
  agente = new ObjectId()
  await db.collection('buildings').insertOne({ _id: predio, ownerId: DONO, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: andar, ownerId: DONO, buildingId: predio, name: 'Operação', status: 'active', workMode: 'organization', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('agents').insertOne({ _id: agente, ownerId: DONO, officeId: andar, name: 'Marina', role: 'Avisa', provider: 'anthropic', createdAt: new Date() })
})

const base = (over = {}) => {
  const bp = t.emptyBlueprintV2('CXSE3', 'Vigiar o RSI', 'create')
  Object.assign(bp, over)
  return bp
}

/** O mapa que a saga do V1 já preencheu com andares e agentes. */
const mapaInicial = () => new Map([[`floor:operacao`, andar.toString()], [`agent:marina`, agente.toString()]])

const aplicar = (bp, aprovadas) =>
  applyV2Resources({
    ownerId: DONO,
    blueprint: bp,
    resourceMap: mapaInicial(),
    approvedKeys: new Set(aprovadas ?? chavesDe(bp)),
  })

const chavesDe = (bp) => t.V2_ITEM_PATHS.flatMap((p) => t.itemsAt(bp, p).map((i) => i.key))

const item = (over) => ({ action: 'create', layer: 'essential', rationale: 'x', dependsOn: [], ...over })

// --- Database e dataset ----------------------------------------------------------------------

test('ACEITAÇÃO: Database e dataset nascem pelo serviço canônico, na ordem certa', async () => {
  const bp = base()
  bp.resources.databases = [item({ key: 'base-cotacoes', name: 'Cotações', owner: { ownerType: 'account' }, adapterKind: 'data_history' })]
  bp.resources.datasets = [
    item({ key: 'candles', dependsOn: ['base-cotacoes'], databaseKey: 'base-cotacoes', datasetKey: 'candles', name: 'Candles', schema: { type: 'object', properties: { rsi: { type: 'number' } } }, mutability: 'append_only' }),
  ]

  const passos = await aplicar(bp)
  assert.deepEqual(passos.map((p) => [p.kind, p.status]), [['database', 'created'], ['dataset', 'created']])

  const store = await db.collection('data_stores').findOne({ ownerId: DONO })
  assert.equal(store.name, 'Cotações')
  const dataset = await db.collection('dataset_definitions').findOne({ ownerId: DONO })
  assert.equal(dataset.key, 'candles')
  assert.equal(dataset.dataStoreId.toString(), store._id.toString())
})

// --- a fonte nasce rascunho ---------------------------------------------------------------------

test('a FONTE nasce rascunho — ativar é um passo separado, depois do teste', async () => {
  const bp = base()
  bp.operations.sources = [
    item({
      key: 'fonte-cotacoes',
      name: 'Cotações CXSE3',
      kind: 'api_polling',
      config: { url: 'https://api.exemplo.test/cotacoes', method: 'GET' },
      mapping: { version: 1, fields: [{ to: 'rsi', from: 'rsi', required: true }] },
      cadence: { mode: 'interval', intervalMs: 60_000 },
    }),
  ]

  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'created')
  assert.match(passos[0].message, /rascunho/)

  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.equal(fonte.status, 'draft', 'criar já ativo entregaria uma operação que ninguém provou')
  assert.equal(fonte.name, 'Cotações CXSE3')
})

test('ligar o AO VIVO é uma atualização da fonte, e o alias nasce sem agentes', async () => {
  const bp = base()
  bp.operations.sources = [
    item({
      key: 'fonte-cotacoes',
      name: 'Cotações',
      kind: 'api_polling',
      config: { url: 'https://api.exemplo.test/c', method: 'GET' },
      mapping: { version: 1, fields: [{ to: 'preco', from: 'p', required: true }] },
      cadence: { mode: 'interval', intervalMs: 60_000 },
    }),
  ]
  bp.operations.liveDestinations = [
    item({ key: 'agora-cotacoes', dependsOn: ['fonte-cotacoes'], sourceKey: 'fonte-cotacoes', alias: 'cotacao', staleAfterSeconds: 60, agentKeys: [] }),
  ]

  const passos = await aplicar(bp)
  assert.deepEqual(passos.map((p) => p.status), ['created', 'created'])
  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.equal(fonte.destination.live, true)
  assert.match(passos[1].message, /sem agentes/)
})

// --- ordem e dependências ------------------------------------------------------------------------

test('a ORDEM vem do plano: o dataset não é criado antes do Database', async () => {
  const bp = base()
  // Declarados de trás para frente de propósito: quem manda é `dependsOn`.
  bp.resources.datasets = [
    item({ key: 'candles', dependsOn: ['base'], databaseKey: 'base', datasetKey: 'candles', name: 'Candles', schema: { type: 'object', properties: { rsi: {} } }, mutability: 'append_only' }),
  ]
  bp.resources.databases = [item({ key: 'base', name: 'Cotações', owner: { ownerType: 'account' }, adapterKind: 'data_history' })]

  const passos = await aplicar(bp)
  assert.deepEqual(passos.map((p) => p.kind), ['database', 'dataset'])
  assert.ok(passos.every((p) => p.status === 'created'))
})

test('um passo que falha PARA a cadeia dele — um monitor mudo é pior que um ausente', async () => {
  const bp = base()
  bp.resources.datasets = [
    item({ key: 'candles', dependsOn: ['base-que-nao-existe'], databaseKey: 'base-que-nao-existe', datasetKey: 'candles', name: 'C', schema: { type: 'object', properties: { rsi: {} } }, mutability: 'append_only' }),
  ]
  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'failed')
  assert.match(passos[0].message, /não foi criado/)
  assert.equal(await db.collection('dataset_definitions').countDocuments({ ownerId: DONO }), 0)
})

// --- aprovação por item ---------------------------------------------------------------------------

test('o que NÃO foi aprovado não é criado — aprovação é por item', async () => {
  const bp = base()
  bp.resources.databases = [
    item({ key: 'aprovado', name: 'Aprovado', owner: { ownerType: 'account' }, adapterKind: 'data_history' }),
    item({ key: 'recusado', name: 'Recusado', owner: { ownerType: 'account' }, adapterKind: 'data_history' }),
  ]

  const passos = await aplicar(bp, ['aprovado'])
  const porKey = Object.fromEntries(passos.map((p) => [p.key, p.status]))
  assert.equal(porKey.aprovado, 'created')
  assert.equal(porKey.recusado, 'skipped')
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: DONO }), 1)
})

test('reaplicar NÃO duplica: o que já está no mapa é reusado', async () => {
  const bp = base()
  bp.resources.databases = [item({ key: 'base', name: 'Cotações', owner: { ownerType: 'account' }, adapterKind: 'data_history' })]

  const mapa = mapaInicial()
  const primeiro = await applyV2Resources({ ownerId: DONO, blueprint: bp, resourceMap: mapa, approvedKeys: new Set(['base']) })
  assert.equal(primeiro[0].status, 'created')

  // O mesmo mapa, de novo: é o que a retomada faz.
  const segundo = await applyV2Resources({ ownerId: DONO, blueprint: bp, resourceMap: mapa, approvedKeys: new Set(['base']) })
  assert.equal(segundo[0].status, 'reused')
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: DONO }), 1)
})

test('`reuse` aponta para o recurso que já existe, sem criar nada', async () => {
  const store = new ObjectId()
  await db.collection('data_stores').insertOne({
    _id: store, ownerId: DONO, name: 'Já existia', adapterKind: 'data_history',
    owner: { ownerType: 'building', ownerId: predio.toString() }, status: 'active', createdAt: new Date(), updatedAt: new Date(),
  })
  const bp = base()
  bp.resources.databases = [item({ key: 'base', action: 'reuse', resourceId: store.toString(), name: 'Já existia', owner: { ownerType: 'account' }, adapterKind: 'data_history' })]

  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'reused')
  assert.equal(passos[0].resourceId, store.toString())
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: DONO }), 1)
})

// --- Flow e monitor ----------------------------------------------------------------------------------

test('o FLOW nasce no andar certo e como rascunho', async () => {
  const bp = base()
  bp.operations.flows = [
    item({
      key: 'flow-avisar',
      floorKey: 'operacao',
      name: 'Avisar o time',
      trigger: { type: 'manual' },
      steps: [{ id: 'r', type: 'transform.template', name: 'Resumo', enabled: true, config: { template: 'viu: {{input}}' } }],
    }),
  ]

  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'created')
  assert.match(passos[0].message, /rascunho/)

  const flow = await db.collection('automations').findOne({ ownerId: DONO })
  assert.equal(flow.floorId.toString(), andar.toString())
  assert.notEqual(flow.status, 'active', 'um Flow que nasce ativo começa a agir sem revisão')
})

test('o MONITOR de um conjunto que ainda não existe fica PENDENTE, e não mudo', async () => {
  const bp = base()
  bp.operations.sources = [
    item({
      key: 'fonte',
      name: 'Cotações',
      kind: 'api_polling',
      config: { url: 'https://api.exemplo.test/c', method: 'GET' },
      mapping: { version: 1, fields: [{ to: 'rsi', from: 'rsi', required: true }] },
      cadence: { mode: 'interval', intervalMs: 60_000 },
    }),
  ]
  bp.operations.histories = [item({ key: 'historico', dependsOn: ['fonte'], sourceKey: 'fonte' })]
  bp.operations.monitors = [
    item({
      key: 'rsi-baixo',
      dependsOn: ['historico'],
      name: 'RSI abaixo de 30',
      observes: { kind: 'dataset', datasetKey: 'historico' },
      condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
      triggerMode: 'enter',
      debounceMs: 0,
      cooldownMs: 0,
      onStale: 'degrade',
    }),
  ]

  const passos = await aplicar(bp)
  const monitor = passos.find((p) => p.kind === 'monitor')
  // O `datasetKey` de uma fonte é o id do recorder, que só existe depois da ativação.
  assert.match(monitor.message, /pendente até a fonte ser ativada/)
  assert.equal(await db.collection('monitors').countDocuments({ ownerId: DONO }), 0, 'um monitor sem o que observar nunca dispara')
})

test('o monitor de um DATASET real é criado, e nasce rascunho', async () => {
  const bp = base()
  bp.resources.databases = [item({ key: 'base', name: 'Cotações', owner: { ownerType: 'account' }, adapterKind: 'data_history' })]
  bp.resources.datasets = [
    item({ key: 'candles', dependsOn: ['base'], databaseKey: 'base', datasetKey: 'candles', name: 'Candles', schema: { type: 'object', properties: { rsi: {} } }, mutability: 'append_only' }),
  ]
  bp.operations.monitors = [
    item({
      key: 'rsi-baixo',
      dependsOn: ['candles'],
      name: 'RSI abaixo de 30',
      observes: { kind: 'dataset', datasetKey: 'candles' },
      condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
      triggerMode: 'enter',
      debounceMs: 0,
      cooldownMs: 0,
      onStale: 'degrade',
    }),
  ]

  const passos = await aplicar(bp)
  const monitor = passos.find((p) => p.kind === 'monitor')
  assert.equal(monitor.status, 'created', JSON.stringify(passos))
  const m = await db.collection('monitors').findOne({ ownerId: DONO })
  assert.equal(m.status, 'draft', 'publicar é um ato separado, depois da simulação')
  assert.equal(m.source.datasetKey, 'candles')
})

// --- o que ainda NÃO é criado, e é dito -----------------------------------------------------------

// --- a ferramenta: referência liga, código não se infere ---------------------------------------

const { createTool } = await import('../dist/tools.js')

test('uma ferramenta que JÁ EXISTE é ligada nos agentes que a usam', async () => {
  const ferramenta = await createTool(DONO, {
    name: 'cotacao_b3',
    description: 'consulta cotação',
    method: 'GET',
    url: 'https://api.exemplo.test/cotacao',
    inputSchema: { type: 'object', properties: {} },
  })
  const bp = base()
  bp.resources.tools = [item({ key: 'cotacao', name: 'Cotação B3', description: 'consulta', provider: 'existing', agentKeys: ['marina'] })]

  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'created', passos[0].message)

  const depois = await db.collection('agents').findOne({ _id: agente })
  assert.ok((depois.toolIds ?? []).includes(ferramenta._id.toString()), 'o agente foi criado sem alcançar a ferramenta')
})

test('ligar duas vezes não duplica a ferramenta no agente', async () => {
  const ferramenta = await createTool(DONO, { name: 'cotacao_b3', description: 'consulta a cotação atual do papel', method: 'GET', url: 'https://api.exemplo.test/c', inputSchema: { type: 'object', properties: {} } })
  const bp = base()
  bp.resources.tools = [item({ key: 'cotacao', name: 'Cotação B3', description: 'x', provider: 'existing', agentKeys: ['marina'] })]

  await aplicar(bp)
  await applyV2Resources({ ownerId: DONO, blueprint: bp, resourceMap: mapaInicial(), approvedKeys: new Set(chavesDe(bp)) })

  const depois = await db.collection('agents').findOne({ _id: agente })
  assert.equal((depois.toolIds ?? []).filter((t) => t === ferramenta._id.toString()).length, 1)
})

test('uma FUNÇÃO a registrar vira pendência — código não se infere de uma descrição', async () => {
  const bp = base()
  bp.resources.tools = [item({ key: 'calc-rsi', name: 'RSI', description: 'calcula', provider: 'function', agentKeys: ['marina'] })]

  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'skipped')
  assert.match(passos[0].message, /cálculo a registrar/)
})

test('uma ação de App é dita como GRANT, e não ligada por baixo', async () => {
  const bp = base()
  bp.resources.tools = [item({ key: 'agenda', name: 'Agenda', description: 'x', provider: 'app_action', appKey: 'google_calendar', actionKey: 'create_event', agentKeys: ['marina'] })]

  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'skipped')
  // Conceder por aqui pularia a instalação ativa e a aprovação, que o bloco de Apps confere.
  assert.match(passos[0].message, /conceda pelo bloco de Apps/)
})

test('AMEAÇA: a ferramenta de OUTRA conta não é encontrada', async () => {
  await createTool('vizinho', { name: 'do_vizinho', description: 'consulta a cotação atual do papel', method: 'GET', url: 'https://api.exemplo.test/v', inputSchema: { type: 'object', properties: {} } })
  const bp = base()
  bp.resources.tools = [item({ key: 'alheia', name: 'Do vizinho', description: 'x', provider: 'existing', agentKeys: ['marina'] })]

  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'skipped')
  assert.match(passos[0].message, /não achei uma ferramenta/)
})

// --- posse -----------------------------------------------------------------------------------------

test('AMEAÇA: um `reuse` apontando para recurso de outra conta não vira criação silenciosa', async () => {
  const alheio = new ObjectId()
  await db.collection('data_stores').insertOne({
    _id: alheio, ownerId: 'vizinho', name: 'Do vizinho', adapterKind: 'data_history',
    owner: { ownerType: 'account', ownerId: 'vizinho' }, status: 'active', createdAt: new Date(), updatedAt: new Date(),
  })
  const bp = base()
  bp.resources.databases = [item({ key: 'base', action: 'reuse', resourceId: alheio.toString(), name: 'x', owner: { ownerType: 'account' }, adapterKind: 'data_history' })]
  bp.resources.datasets = [
    item({ key: 'ds', dependsOn: ['base'], databaseKey: 'base', datasetKey: 'ds', name: 'D', schema: { type: 'object', properties: { x: {} } }, mutability: 'append_only' }),
  ]

  const passos = await aplicar(bp)
  // O `reuse` é registrado; a posse é conferida pelo DOMÍNIO na primeira escrita que
  // depende dele — e `createDataset` recusa um store que não é desta conta.
  const dataset = passos.find((p) => p.kind === 'dataset')
  assert.equal(dataset.status, 'failed')
  assert.equal(await db.collection('dataset_definitions').countDocuments({}), 0)
})

// --- a pendência declarada, que não é uma falha ---------------------------------------------------

test('uma fonte SEM origem é pendência declarada, e não derruba a aplicação', async () => {
  const bp = base()
  // É assim que o compilador a emite quando o Brief não diz de onde o dado vem: a fonte
  // aparece no plano com o motivo, porque a origem é o que ele não pode inventar.
  bp.operations.sources = [item({ key: 'fonte', name: 'Cotação', kind: 'api_polling', config: {}, mapping: { version: 1, fields: [] }, cadence: { mode: 'interval', intervalMs: 60_000 } })]

  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'skipped')
  assert.match(passos[0].message, /de onde este dado vem/)
  assert.equal(await db.collection('monitoring_sources').countDocuments({ ownerId: DONO }), 0)
})

test('uma fonte com origem e SEM campos também é pendência, com o motivo certo', async () => {
  const bp = base()
  bp.operations.sources = [
    item({ key: 'fonte', name: 'Cotação', kind: 'api_polling', config: { url: 'https://api.exemplo.test/c', method: 'GET' }, mapping: { version: 1, fields: [] }, cadence: { mode: 'interval', intervalMs: 60_000 } }),
  ]
  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'skipped')
  assert.match(passos[0].message, /quais campos ler/)
})

test('o que DEPENDE de uma pendência também fica pendente — nunca falha', async () => {
  const bp = base()
  bp.operations.sources = [item({ key: 'fonte', name: 'Cotação', kind: 'api_polling', config: {}, mapping: { version: 1, fields: [] }, cadence: { mode: 'interval', intervalMs: 60_000 } })]
  bp.operations.liveDestinations = [item({ key: 'agora', dependsOn: ['fonte'], sourceKey: 'fonte', alias: 'cot', staleAfterSeconds: 60, agentKeys: [] })]
  bp.operations.histories = [item({ key: 'historico', dependsOn: ['fonte'], sourceKey: 'fonte' })]

  const passos = await aplicar(bp)
  // Um destino ao vivo em cima de uma fonte pendente não tem defeito nenhum: ele espera o
  // mesmo dado. Derrubar aqui viraria "falta dizer de onde vem" em "a aplicação quebrou".
  for (const p of passos) assert.equal(p.status, 'skipped', `${p.key}: ${p.message}`)
  assert.ok(passos.slice(1).every((p) => /pendente/.test(p.message)), JSON.stringify(passos))
})

// --- o canal: o nativo é criado, o de App é pendência ------------------------------------------

test('o canal do SITE é criado e aponta para quem recebe', async () => {
  const bp = base()
  bp.operations.channels = [item({ key: 'entrada', name: 'Chat do site', appKey: 'web_chat', entryAgentKey: 'marina', direction: 'both' })]

  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'created', passos[0].message)

  const canal = await db.collection('widgets').findOne({ ownerId: DONO })
  assert.ok(canal, 'sem vínculo, a mensagem não chega a lugar nenhum')
  assert.equal(canal.agentId.toString(), agente.toString())
})

test('um canal de APP fica pendente, dizendo o que conectar', async () => {
  const bp = base()
  bp.operations.channels = [item({ key: 'zap', name: 'WhatsApp', appKey: 'whatsapp', entryAgentKey: 'marina', direction: 'inbound' })]

  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'skipped')
  assert.match(passos[0].message, /conecte whatsapp/)
  assert.equal(await db.collection('widgets').countDocuments({ ownerId: DONO }), 0)
})

test('um canal SEM quem receba fica pendente — uma porta que não leva a lugar nenhum', async () => {
  const bp = base()
  bp.operations.channels = [item({ key: 'orfao', name: 'Chat', appKey: 'web_chat', entryAgentKey: 'ninguem', direction: 'both' })]

  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'skipped')
  assert.match(passos[0].message, /não tem quem receba/)
  assert.equal(await db.collection('widgets').countDocuments({ ownerId: DONO }), 0)
})

test('a ENTREGA sem conexão escolhida fica pendente, dizendo o que falta', async () => {
  const bp = base()
  bp.operations.deliveries = [item({ key: 'entrega', fromKey: 'flow-x', destinationHint: 'meu WhatsApp', format: 'text' })]
  const passos = await aplicar(bp)
  assert.equal(passos[0].status, 'skipped')
  // O endereço não entra no plano — ele é lido inteiro pela tela e viaja no histórico do
  // projeto. A conexão é escolhida na hora de aplicar.
  assert.match(passos[0].message, /escolha por onde esta entrega sai/)
})

// --- a entrega: a conexão vem da REQUISIÇÃO, nunca do plano -------------------------------------
//
// O endereço não mora no Blueprint, e não é por acaso: o plano é lido inteiro pela tela e viaja
// no histórico do projeto. O que entra é uma referência a uma conexão que já existe na conta,
// escolhida na hora de aplicar e conferida contra o dono.

const { createConnection } = await import('../dist/connections/service.js')

const planoComFlowEEntrega = () => {
  const bp = base()
  bp.operations.flows = [
    item({
      key: 'avisar',
      floorKey: 'operacao',
      name: 'Avisar',
      trigger: { type: 'manual' },
      steps: [{ id: 'r', type: 'transform.template', name: 'Resumo', enabled: true, config: { template: 'viu: {{input}}' } }],
    }),
  ]
  bp.operations.deliveries = [item({ key: 'entrega', dependsOn: ['avisar'], fromKey: 'avisar', destinationHint: 'meu e-mail', format: 'text' })]
  return bp
}

const comConexao = (bp, mapa) =>
  applyV2Resources({
    ownerId: DONO,
    blueprint: bp,
    resourceMap: mapaInicial(),
    approvedKeys: new Set(chavesDe(bp)),
    deliveryConnections: new Map(mapa),
  })

test('ACEITAÇÃO: a entrega vira um PASSO do Flow, ligado na conexão escolhida', async () => {
  const conexao = await createConnection(DONO, { provider: 'email', name: 'Meu e-mail', config: { host: 'smtp.exemplo.test', port: 587, secure: false, user: 'a@b.test', pass: 'nao-e-um-segredo-real', from: 'a@b.test' } })
  const bp = planoComFlowEEntrega()

  const passos = await comConexao(bp, [['entrega', conexao._id.toString()]])
  const entrega = passos.find((p) => p.kind === 'delivery')
  assert.equal(entrega.status, 'created', entrega.message)
  assert.match(entrega.message, /Meu e-mail/)

  // O passo é o que entrega de verdade — e é ele que aparece na Activity quando sai.
  const flow = await db.collection('automations').findOne({ ownerId: DONO })
  const passo = flow.draftDefinition.steps.find((p) => p.type === 'delivery.send')
  assert.ok(passo, 'sem o passo, o Flow parece configurado e não entrega nada')
  assert.equal(passo.config.connectionId, conexao._id.toString())
  assert.equal(passo.dependsOn[0], 'r', 'a entrega sai do resultado da etapa anterior')
})

test('sem conexão escolhida, a entrega é pendência — e diz o que fazer', async () => {
  const passos = await comConexao(planoComFlowEEntrega(), [])
  const entrega = passos.find((p) => p.kind === 'delivery')
  assert.equal(entrega.status, 'skipped')
  assert.match(entrega.message, /escolha por onde esta entrega sai/)

  const flow = await db.collection('automations').findOne({ ownerId: DONO })
  assert.equal(flow.draftDefinition.steps.some((p) => p.type === 'delivery.send'), false)
})

test('AMEAÇA: a conexão de OUTRA conta não liga a entrega', async () => {
  const alheia = await createConnection('vizinho', { provider: 'email', name: 'Do vizinho', config: { host: 'smtp.exemplo.test', port: 587, secure: false, user: 'v@b.test', pass: 'nao-e-um-segredo-real', from: 'v@b.test' } })
  const passos = await comConexao(planoComFlowEEntrega(), [['entrega', alheia._id.toString()]])
  const entrega = passos.find((p) => p.kind === 'delivery')
  assert.equal(entrega.status, 'skipped')
  assert.match(entrega.message, /não existe nesta conta/)

  const flow = await db.collection('automations').findOne({ ownerId: DONO })
  assert.equal(flow.draftDefinition.steps.some((p) => p.type === 'delivery.send'), false, 'a entrega sairia pela conexão de outra pessoa')
})

test('aplicar duas vezes não duplica o passo de entrega', async () => {
  const conexao = await createConnection(DONO, { provider: 'email', name: 'Meu e-mail', config: { host: 'smtp.exemplo.test', port: 587, secure: false, user: 'a@b.test', pass: 'nao-e-um-segredo-real', from: 'a@b.test' } })
  const bp = planoComFlowEEntrega()
  const mapa = mapaInicial()
  const entrada = { ownerId: DONO, blueprint: bp, resourceMap: mapa, approvedKeys: new Set(chavesDe(bp)), deliveryConnections: new Map([['entrega', conexao._id.toString()]]) }

  await applyV2Resources(entrada)
  await applyV2Resources(entrada)

  const flow = await db.collection('automations').findOne({ ownerId: DONO })
  assert.equal(flow.draftDefinition.steps.filter((p) => p.type === 'delivery.send').length, 1)
})
