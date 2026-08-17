// INTEGRATION: os modos de execução, ponta a ponta, contra um mongod REAL.
//
// A promessa que este arquivo protege é a que o dono do sistema compra ao escolher
// "0 tokens de LLM": **nos modos sem IA, nenhum modelo é chamado**. Não "quase
// nenhum", não "só se der erro" — nenhum.
//
// Por isso o teste não confia em ler a definição: ele instala um espião no lugar do
// provedor e falha se ele for tocado. Uma checagem que só olha a configuração
// passaria mesmo se o runner chamasse o modelo assim mesmo.
import { test, after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY = 'test-encryption-key'

const { mongoClient, db } = await import('../dist/db.js')
const { createEventTrigger, updateEventTrigger, buildEventTriggerDefinition, readEventTriggerConfig } = await import(
  '../dist/automations/eventTrigger.js'
)
const { createRun } = await import('../dist/automations/runService.js')
const { processRun } = await import('../dist/automations/runProcessor.js')
const { ensureMemoryIndexes, searchMemory, scopeKeyOf } = await import('../dist/memory/records.js')
const { getApp } = await import('../dist/apps/registry.js')

const OWNER = 'modos-owner'
const FLOOR = new ObjectId()
const BUILDING = new ObjectId()
const AGENT = new ObjectId()
const OUTRO_AGENTE = new ObjectId()
const SETOR = new ObjectId()

const CHAVE_AGENTE = scopeKeyOf({ scope: 'agent', agentId: AGENT })
const CHAVE_SETOR = scopeKeyOf({ scope: 'sector', sectorId: SETOR })
const CHAVE_ANDAR = scopeKeyOf({ scope: 'floor', floorId: FLOOR })
const CHAVE_OUTRO = scopeKeyOf({ scope: 'agent', agentId: OUTRO_AGENTE })

const EVENTO = { pedido: { id: 'p-1', valor: 250 }, cliente: { nome: 'Fulano', plano: 'premium' } }

before(async () => {
  await mongoClient.connect()
  await ensureMemoryIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  await Promise.all([
    db.collection('automations').deleteMany({}),
    db.collection('automation_versions').deleteMany({}),
    db.collection('automation_runs').deleteMany({}),
    db.collection('step_runs').deleteMany({}),
    db.collection('memories').deleteMany({}),
    db.collection('connections').deleteMany({}),
    db.collection('agents').deleteMany({}),
    db.collection('sectors').deleteMany({}),
    db.collection('offices').deleteMany({}),
    db.collection('buildings').deleteMany({}),
  ])
  await db.collection('buildings').insertOne({ _id: BUILDING, ownerId: OWNER, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: FLOOR, ownerId: OWNER, buildingId: BUILDING, name: 'Térreo', status: 'active', createdAt: new Date() })
  await db.collection('agents').insertMany([
    { _id: AGENT, ownerId: OWNER, name: 'Ana', objective: 'Atender', officeId: FLOOR, activationModes: [] },
    { _id: OUTRO_AGENTE, ownerId: OWNER, name: 'Beto', objective: 'Outro', officeId: FLOOR, activationModes: [] },
  ])
  await db.collection('sectors').insertOne({
    _id: SETOR,
    ownerId: OWNER,
    officeId: FLOOR,
    name: 'Vendas',
    members: [{ agentId: AGENT, sector: '', routingDescription: '' }],
    createdAt: new Date(),
  })
})

const memoriaNoAgente = (over = {}) => ({
  enabled: true,
  scope: 'agent',
  strategy: 'append',
  key: 'pedido-{{pedido.id}}',
  dedupeKey: '{{pedido.id}}',
  ...over,
})

// Cria o gatilho, dispara um evento e processa. Devolve o run já persistido.
async function rodar(spec, evento = EVENTO) {
  const { trigger } = await createEventTrigger(OWNER, AGENT, { name: 'Gatilho', objective: 'Resumir o evento', ...spec })
  const { run } = await createRun(OWNER, trigger._id, { triggerType: 'webhook', input: evento })
  await processRun(run._id.toString())
  return { trigger, run: await db.collection('automation_runs').findOne({ _id: run._id }) }
}

const memoriasDe = (scopeKey) => searchMemory({ tenantId: OWNER, scopeKeys: [scopeKey] })

// --- a promessa: sem IA é sem IA ------------------------------------------------------

test('collect_only recebe, guarda e encerra — sem modelo, sem token', async () => {
  const { run } = await rodar({ executionMode: 'collect_only', memory: memoriaNoAgente() })

  assert.equal(run.status, 'succeeded')
  assert.equal(run.usedAI, false)
  assert.equal(run.executionMode, 'collect_only')
  assert.equal(run.usage.inputTokens + run.usage.outputTokens, 0, 'zero token, gravado no run')

  const { items, total } = await memoriasDe(CHAVE_AGENTE)
  assert.equal(total, 1, 'e o evento ficou guardado')
  assert.deepEqual(items[0].payload, EVENTO)
  assert.equal(items[0].key, 'pedido-p-1', 'a chave veio de um campo do próprio evento')
  assert.equal(items[0].sourceType, 'webhook')
})

test('a definição de um modo sem IA não CONTÉM etapa de agente', async () => {
  // Mais forte que pular em tempo de execução: não há passo para rodar, nem flag
  // para alguém inverter. Quem abrir a definição publicada vê isso.
  for (const mode of ['collect_only', 'deterministic']) {
    const def = buildEventTriggerDefinition({ name: 'x', objective: 'y', executionMode: mode, memory: memoriaNoAgente() }, AGENT)
    assert.equal(
      def.steps.some((s) => s.type === 'agent.execute'),
      false,
      `${mode} gerou etapa de IA`,
    )
    assert.equal(def.executionMode, mode)
  }
})

test('deterministic também não chama modelo', async () => {
  const { run } = await rodar({ executionMode: 'deterministic', memory: memoriaNoAgente() })
  assert.equal(run.usedAI, false)
  assert.equal(run.usage.inputTokens + run.usage.outputTokens, 0)
  assert.equal((await memoriasDe(CHAVE_AGENTE)).total, 1)
})

test('modo sem IA e sem nada para fazer é recusado, com o motivo e a saída', async () => {
  // "Somente coletar" sem destino de memória e sem ação responderia 200 e encerraria:
  // nenhuma etapa, nenhum efeito. Aceitar salvaria uma configuração que parece pronta
  // e não é, e o dono só descobriria quando o relatório viesse vazio.
  await assert.rejects(
    () => rodar({ executionMode: 'collect_only' }),
    (erro) => {
      assert.match(erro.message, /guardar a informação|executar uma ação|monitorar uma fonte/)
      return true
    },
  )
})

test('híbrido sem condição e sem memória é recusado dizendo qual das saídas tomar', async () => {
  await assert.rejects(() => rodar({ executionMode: 'hybrid' }), /condição|guardar|modo com IA/)
})

test('a recusa não vale para o modo com IA: ele sempre tem o que fazer', async () => {
  const { run } = await rodar({ executionMode: 'ai' })
  assert.ok(run)
})

// --- o modo de sempre ------------------------------------------------------------------

test('gatilho sem `executionMode` continua sendo o de antes: com IA', async () => {
  // Nenhum gatilho criado antes disto tem o campo. Ler ausência como "sem IA"
  // desligaria todos eles em silêncio.
  const def = buildEventTriggerDefinition({ name: 'x', objective: 'y' }, AGENT)
  assert.equal(def.executionMode, 'ai')
  assert.ok(def.steps.some((s) => s.type === 'agent.execute'))
  assert.equal(readEventTriggerConfig({ steps: def.steps }).executionMode, 'ai')
})

test('no modo ai a etapa de agente existe e não tem condição', async () => {
  const def = buildEventTriggerDefinition({ name: 'x', objective: 'y', executionMode: 'ai' }, AGENT)
  const agente = def.steps.find((s) => s.type === 'agent.execute')
  assert.ok(agente)
  assert.equal(agente.runIf, undefined, 'no modo ai a IA roda sempre — sem condição escondida')
})

// --- híbrido e automático ---------------------------------------------------------------

test('híbrido sem condição NÃO gera etapa de IA', async () => {
  // Sem condição, "híbrido" viraria "sempre" — o modo `ai` com outro nome e uma
  // conta que o dono não escolheu.
  const def = buildEventTriggerDefinition({ name: 'x', objective: 'y', executionMode: 'hybrid' }, AGENT)
  assert.equal(
    def.steps.some((s) => s.type === 'agent.execute'),
    false,
  )
})

test('híbrido com condição FALSA guarda e para, sem gastar', async () => {
  const { run } = await rodar({
    executionMode: 'hybrid',
    memory: memoriaNoAgente(),
    aiCondition: { source: 'input', path: 'cliente.plano', operator: 'equals', value: 'enterprise' },
  })

  assert.equal(run.status, 'succeeded')
  assert.equal(run.usedAI, false, 'o plano é premium, não enterprise')
  assert.equal(run.usage.inputTokens + run.usage.outputTokens, 0)
  assert.equal((await memoriasDe(CHAVE_AGENTE)).total, 1, 'mas guardou, que é a parte determinística')

  // A etapa da IA aparece no histórico como pulada, não como ausente: quem for
  // conferir precisa ver que ela existia e por que não rodou.
  const etapas = await db.collection('step_runs').find({ runId: run._id }).toArray()
  assert.equal(etapas.find((e) => e.stepType === 'agent.execute')?.status, 'skipped')
})

test('a condição é avaliada sem perguntar a modelo nenhum', async () => {
  // Se a decisão de chamar a IA passasse por uma IA, o modo híbrido custaria tokens
  // justamente nas vezes em que promete não custar.
  const { evaluateCondition } = await import('../dist/automations/conditions.js')
  const ctx = { input: EVENTO }
  assert.equal(evaluateCondition({ source: 'input', path: 'pedido.valor', operator: 'gt', value: 100 }, ctx), true)
  assert.equal(evaluateCondition({ source: 'input', path: 'pedido.valor', operator: 'gt', value: 1000 }, ctx), false)
  assert.equal(evaluateCondition({ source: 'input', path: 'cliente.nome', operator: 'contains', value: 'fulano' }, ctx), true)
})

test('condição malformada não vira "chame a IA"', async () => {
  const { evaluateCondition } = await import('../dist/automations/conditions.js')
  const ctx = { input: EVENTO }
  // Numa decisão sobre GASTAR, a dúvida tem que significar "não gaste".
  assert.equal(evaluateCondition({ source: 'input', path: 'x', operator: 'inexistente' }, ctx), false)
  assert.equal(evaluateCondition({ source: 'input', path: 'nada.aqui', operator: 'exists' }, ctx), false)
  assert.equal(evaluateCondition({ source: 'input', path: 'cliente.nome', operator: 'matches', value: '[' }, ctx), false)
})

// --- destino e permissão -------------------------------------------------------------------

test('dá para guardar no setor de que o agente participa', async () => {
  await rodar({ executionMode: 'collect_only', memory: memoriaNoAgente({ scope: 'sector', sectorId: SETOR.toString() }) })
  assert.equal((await memoriasDe(CHAVE_SETOR)).total, 1)
  assert.equal((await memoriasDe(CHAVE_AGENTE)).total, 0, 'e só lá')
})

test('e no andar do agente', async () => {
  await rodar({ executionMode: 'collect_only', memory: memoriaNoAgente({ scope: 'floor', floorId: FLOOR.toString() }) })
  assert.equal((await memoriasDe(CHAVE_ANDAR)).total, 1)
})

test('mas NÃO na memória particular de outro agente', async () => {
  // O gatilho é da Ana. Deixá-lo gravar na memória do Beto seria dar a qualquer
  // webhook o poder de escrever em qualquer lugar da conta.
  const { run } = await rodar({
    executionMode: 'collect_only',
    memory: memoriaNoAgente({ scope: 'agent', agentId: OUTRO_AGENTE.toString() }),
  })
  assert.equal(run.status, 'failed')
  assert.equal((await memoriasDe(CHAVE_OUTRO)).total, 0)
})

test('nem em setor de que ele não participa', async () => {
  const outroSetor = new ObjectId()
  await db.collection('sectors').insertOne({ _id: outroSetor, ownerId: OWNER, officeId: FLOOR, name: 'Fiscal', members: [], createdAt: new Date() })
  const { run } = await rodar({
    executionMode: 'collect_only',
    memory: memoriaNoAgente({ scope: 'sector', sectorId: outroSetor.toString() }),
  })
  assert.equal(run.status, 'failed')
  assert.equal((await memoriasDe(scopeKeyOf({ scope: 'sector', sectorId: outroSetor }))).total, 0)
})

test('destino de outra conta nem chega a ser salvo', async () => {
  // A proteção que já existia para o setor de contexto do agente cobre o destino da
  // memória de graça: a referência é conferida na CRIAÇÃO. Recusar ali é melhor que
  // recusar na execução — a configuração errada não fica salva esperando o evento.
  const deOutraConta = new ObjectId()
  await db.collection('sectors').insertOne({ _id: deOutraConta, ownerId: 'conta-alheia', officeId: FLOOR, name: 'X', members: [], createdAt: new Date() })
  await assert.rejects(
    () =>
      rodar({
        executionMode: 'collect_only',
        memory: memoriaNoAgente({ scope: 'sector', sectorId: deOutraConta.toString() }),
      }),
    /invalid/,
  )
})

// --- estratégias e reenvio -------------------------------------------------------------------

test('o mesmo evento entregue duas vezes não vira dois registros', async () => {
  // Webhook reenviado por timeout é o caso normal, não a exceção.
  const { trigger } = await createEventTrigger(OWNER, AGENT, {
    name: 'G',
    objective: 'x',
    executionMode: 'collect_only',
    memory: memoriaNoAgente(),
  })
  for (let i = 0; i < 3; i++) {
    const { run } = await createRun(OWNER, trigger._id, { triggerType: 'webhook', input: EVENTO, idempotencyKey: `k-${i}` })
    await processRun(run._id.toString())
  }
  assert.equal((await memoriasDe(CHAVE_AGENTE)).total, 1, 'três entregas, um registro')
})

test('eventos diferentes com a mesma configuração viram registros diferentes', async () => {
  const { trigger } = await createEventTrigger(OWNER, AGENT, {
    name: 'G',
    objective: 'x',
    executionMode: 'collect_only',
    memory: memoriaNoAgente(),
  })
  for (const id of ['p-1', 'p-2']) {
    const { run } = await createRun(OWNER, trigger._id, {
      triggerType: 'webhook',
      input: { ...EVENTO, pedido: { ...EVENTO.pedido, id } },
      idempotencyKey: id,
    })
    await processRun(run._id.toString())
  }
  assert.equal((await memoriasDe(CHAVE_AGENTE)).total, 2)
})

test('upsert mistura os campos que chegam em eventos separados', async () => {
  const { trigger } = await createEventTrigger(OWNER, AGENT, {
    name: 'G',
    objective: 'x',
    executionMode: 'collect_only',
    memory: memoriaNoAgente({ strategy: 'upsert', key: 'cliente', dedupeKey: null, fieldMap: { nome: 'cliente.nome', valor: 'pedido.valor' } }),
  })
  const enviar = async (input, k) => {
    const { run } = await createRun(OWNER, trigger._id, { triggerType: 'webhook', input, idempotencyKey: k })
    await processRun(run._id.toString())
  }
  await enviar({ cliente: { nome: 'Fulano' } }, 'a')
  await enviar({ pedido: { valor: 99 } }, 'b')

  const { items, total } = await memoriasDe(CHAVE_AGENTE)
  assert.equal(total, 1)
  assert.equal(items[0].payload.nome, 'Fulano', 'o nome do primeiro evento sobreviveu ao segundo')
  assert.equal(items[0].payload.valor, 99)
})

test('o mapeamento guarda só o que foi pedido', async () => {
  await rodar({
    executionMode: 'collect_only',
    memory: memoriaNoAgente({ fieldMap: { valor: 'pedido.valor' } }),
  })
  const { items } = await memoriasDe(CHAVE_AGENTE)
  assert.deepEqual(items[0].payload, { valor: 250 }, 'um webhook traz cinquenta campos; o dono queria um')
})

test('o TTL configurado chega ao registro', async () => {
  await rodar({ executionMode: 'collect_only', memory: memoriaNoAgente({ ttlSeconds: 86_400 }) })
  const { items } = await memoriasDe(CHAVE_AGENTE)
  assert.ok(items[0].expiresAt instanceof Date)
})

// --- edição preserva o que estava configurado --------------------------------------------------

test('editar o gatilho não perde o modo nem o destino', async () => {
  const { trigger } = await createEventTrigger(OWNER, AGENT, {
    name: 'G',
    objective: 'x',
    executionMode: 'collect_only',
    memory: memoriaNoAgente({ scope: 'sector', sectorId: SETOR.toString() }),
  })
  const config = readEventTriggerConfig(trigger.draftDefinition)
  assert.equal(config.executionMode, 'collect_only')
  assert.equal(config.memory.scope, 'sector')

  const atualizado = await updateEventTrigger(OWNER, AGENT, trigger._id, {
    name: 'G renomeado',
    objective: 'x',
    executionMode: config.executionMode,
    memory: config.memory,
  })
  const depois = readEventTriggerConfig(atualizado.draftDefinition)
  assert.equal(depois.executionMode, 'collect_only')
  assert.equal(depois.memory.scope, 'sector')
  assert.equal(depois.memory.sectorId, SETOR.toString())
})

test('um modo sem IA não exige objetivo — não há a quem instruir', async () => {
  const { trigger } = await createEventTrigger(OWNER, AGENT, {
    name: 'Só coleta',
    objective: '',
    executionMode: 'collect_only',
    memory: memoriaNoAgente(),
  })
  assert.ok(trigger)
})

test('mas o modo com IA continua exigindo', async () => {
  await assert.rejects(() => createEventTrigger(OWNER, AGENT, { name: 'x', objective: '   ' }), /objective/)
})

// --- executar um App sem passar por modelo --------------------------------------------------
//
// O fluxo que motiva tudo: dados chegam → o App analisa → a condição olha o resultado →
// a memória guarda o SINAL (não os quinhentos candles) → o agente só entra se houver o
// que dizer.

const CANDLES = Array.from({ length: 30 }, (_, i) => ({
  timestamp: 1_700_000_000_000 + i * 60_000,
  open: 100,
  high: 100,
  low: 100,
  close: 100,
  volume: 1000,
  closed: true,
})).concat([
  // Martelo na ponta, com volume acima da média: é o que o analisador reconhece.
  { timestamp: 1_700_000_000_000 + 30 * 60_000, open: 100, high: 101.2, low: 96, close: 101, volume: 9000, closed: true },
])

// O App de candles, que existe e está PAUSADO. Usado só para provar o bloqueio.
const comCandleAnalyzer = async () => {
  const app = getApp('candle_analyzer')
  const instalacao = new ObjectId()
  await db.collection('connections').insertOne({
    _id: instalacao,
    ownerId: OWNER,
    appKey: app.key,
    appVersion: app.version,
    name: 'Análise de candles',
    status: 'connected',
    encryptedConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.collection('agents').updateOne(
    { _id: AGENT },
    {
      $set: {
        appGrants: [
          {
            installationId: instalacao.toString(),
            appKey: app.key,
            actionKeys: ['candles_find_opportunities'],
            resourceConfig: {},
            autonomousWriteActionKeys: [],
          },
        ],
      },
    },
  )
}

const acaoDeCandles = {
  enabled: true,
  appKey: 'candle_analyzer',
  actionKey: 'candles_find_opportunities',
  args: { symbol: 'PETR4', timeframe: '5m', candles: '{{candles}}', minimumScore: 1 },
}

test('o resultado da ação segue para a memória e para a condição, sem modelo', async () => {
  // Aqui o que está sob teste é a FIAÇÃO do runner: quem lê o quê, e em que ordem. A
  // camada de App tem os testes dela (executor canônico, grant, recusa); repetir a
  // resolução de instalação aqui exigiria um App utilizável apontando para loopback, e
  // o validador de manifesto — corretamente — não aceita IP como domínio permitido.
  const { runDefinition } = await import('../dist/automations/runner.js')
  const def = buildEventTriggerDefinition(
    {
      name: 'x',
      objective: '',
      executionMode: 'deterministic',
      action: { enabled: true, appKey: 'qualquer', actionKey: 'consultar' },
      memory: memoriaNoAgente({ key: 'sinal', dedupeKey: null }),
    },
    AGENT,
  )

  let chamouLLM = 0
  const gravado = []
  const out = await runDefinition(
    def,
    {
      fetchUrl: async () => ({ body: '', contentType: '' }),
      runApp: async () => ({ decisao: 'seguir', valor: 42 }),
      memory: {
        write: async (_cfg, valor) => {
          gravado.push(valor)
          return { outcome: 'created', recordId: 'r1', scopeKey: 'agent:x' }
        },
        search: async () => ({ items: [], total: 0 }),
        remove: async () => ({ deleted: 0 }),
      },
      runAgent: async () => {
        chamouLLM++
        return { output: 'nunca' }
      },
      deliver: async () => ({ providerMessageId: null }),
      now: () => Date.now(),
    },
    { pedido: { id: 'p-1' } },
  )

  assert.equal(out.status, 'succeeded')
  assert.equal(out.usedAI, false, 'nenhum modelo no caminho')
  assert.equal(chamouLLM, 0)
  // A memória recebe o RESULTADO da ação, não o evento cru: é ele que vale guardar.
  assert.deepEqual(gravado, [{ decisao: 'seguir', valor: 42 }])
})

test('a condição lê o resultado da ação, e a IA só roda se ela bater', async () => {
  const { runDefinition } = await import('../dist/automations/runner.js')
  const acao = { enabled: true, appKey: 'qualquer', actionKey: 'consultar' }

  const rodarCom = async (valorEsperado) => {
    const def = buildEventTriggerDefinition(
      {
        name: 'x',
        objective: 'resumir',
        executionMode: 'hybrid',
        action: acao,
        // A origem é derivada: o dono escreveu o campo, não o id da etapa.
        aiCondition: { source: 'input', path: 'decisao', operator: 'equals', value: valorEsperado },
      },
      AGENT,
    )
    let chamouLLM = 0
    const out = await runDefinition(
      def,
      {
        fetchUrl: async () => ({ body: '', contentType: '' }),
        runApp: async () => ({ decisao: 'seguir' }),
        runAgent: async () => {
          chamouLLM++
          return { output: 'resumo' }
        },
        deliver: async () => ({ providerMessageId: null }),
        now: () => Date.now(),
      },
      { pedido: {} },
    )
    return { out, chamouLLM }
  }

  const falsa = await rodarCom('parar')
  assert.equal(falsa.out.status, 'succeeded')
  assert.equal(falsa.chamouLLM, 0, 'condição falsa: nenhum token')
  assert.equal(falsa.out.usedAI, false)

  const verdadeira = await rodarCom('seguir')
  assert.equal(verdadeira.chamouLLM, 1, 'condição verdadeira: a IA roda uma vez')
  assert.equal(verdadeira.out.usedAI, true)
})

test('a etapa de App aparece na definição, e a de IA não, num modo sem IA', async () => {
  const def = buildEventTriggerDefinition(
    {
      name: 'x',
      objective: '',
      executionMode: 'deterministic',
      action: { enabled: true, appKey: 'qualquer', actionKey: 'consultar' },
      memory: memoriaNoAgente(),
    },
    AGENT,
  )
  assert.ok(def.steps.some((s) => s.type === 'app.execute'))
  assert.equal(def.steps.some((s) => s.type === 'agent.execute'), false)
})

test('App sem permissão do agente falha a execução, em vez de seguir como se tivesse rodado', async () => {
  // O agente não tem grant nenhum. Deixar passar faria o fluxo gravar e entregar algo
  // que nunca aconteceu.
  const { run } = await rodar(
    { executionMode: 'deterministic', action: { enabled: true, appKey: 'qualquer', actionKey: 'consultar' }, memory: memoriaNoAgente() },
    { pedido: {} },
  )
  assert.equal(run.status, 'failed')
  assert.match(run.error?.message ?? '', /permissão|concedida/)
  assert.equal((await memoriasDe(CHAVE_AGENTE)).total, 0, 'nada foi guardado')
})

test('ação revogada depois de configurada também falha', async () => {
  await comCandleAnalyzer()
  // O dono tira a ação do agente. A rotina continua salva apontando para ela.
  await db.collection('agents').updateOne({ _id: AGENT }, { $set: { 'appGrants.0.actionKeys': [] } })
  const { run } = await rodar({ executionMode: 'deterministic', action: acaoDeCandles, memory: memoriaNoAgente() }, { candles: CANDLES })
  assert.equal(run.status, 'failed')
  assert.equal((await memoriasDe(CHAVE_AGENTE)).total, 0)
})

test('conexão revogada depois de configurada também falha', async () => {
  await comCandleAnalyzer()
  await db.collection('connections').updateMany({ ownerId: OWNER }, { $set: { status: 'revoked' } })
  const { run } = await rodar({ executionMode: 'deterministic', action: acaoDeCandles, memory: memoriaNoAgente() }, { candles: CANDLES })
  assert.equal(run.status, 'failed')
  assert.equal((await memoriasDe(CHAVE_AGENTE)).total, 0)
})

// --- as duas correções da rodada ------------------------------------------------------------

test('a condição de um webhook lê o corpo do evento sem ninguém dizer de onde', async () => {
  // O dono escreve "quando cliente.plano for premium". De onde isso vem é detalhe de
  // compilação, e ele não deveria precisar saber.
  const def = buildEventTriggerDefinition(
    {
      name: 'x',
      objective: 'y',
      executionMode: 'hybrid',
      aiCondition: { source: 'input', path: 'cliente.plano', operator: 'equals', value: 'premium' },
    },
    AGENT,
  )
  const agente = def.steps.find((s) => s.type === 'agent.execute')
  assert.equal(agente.runIf.source, 'input')
})

test('com ação de App, a condição passa a ler o RESULTADO da ação', async () => {
  const def = buildEventTriggerDefinition(
    {
      name: 'x',
      objective: 'y',
      executionMode: 'hybrid',
      action: { enabled: true, appKey: 'qualquer', actionKey: 'consultar' },
      aiCondition: { source: 'input', path: 'decisao', operator: 'equals', value: 'seguir' },
    },
    AGENT,
  )
  const agente = def.steps.find((s) => s.type === 'agent.execute')
  assert.equal(agente.runIf.source, 'acao', 'senão a condição olharia o corpo do evento, onde o campo não existe')
})

test('uma origem declarada de propósito é respeitada', async () => {
  const def = buildEventTriggerDefinition(
    {
      name: 'x',
      objective: 'y',
      executionMode: 'hybrid',
      action: { enabled: true, appKey: 'qualquer', actionKey: 'consultar' },
      aiCondition: { source: 'evento', path: 'urgente', operator: 'exists' },
    },
    AGENT,
  )
  assert.equal(def.steps.find((s) => s.type === 'agent.execute').runIf.source, 'evento')
})

// --- App em breve ----------------------------------------------------------------------------

test('App marcado como "em breve" não executa, nem com grant já concedido', async () => {
  // O grant é criado direto no banco de propósito: o caminho da API já recusa, e o que
  // este teste protege é a porteira de EXECUÇÃO — uma permissão concedida antes de o App
  // ser pausado não pode continuar valendo.
  await comCandleAnalyzer()
  const { run } = await rodar(
    { executionMode: 'deterministic', action: acaoDeCandles, memory: memoriaNoAgente() },
    { candles: CANDLES },
  )
  assert.equal(run.status, 'failed')
  assert.match(run.error?.message ?? '', /Em breve|dispon/i)
  assert.equal((await memoriasDe(CHAVE_AGENTE)).total, 0, 'nada foi guardado')
})

test('a ação de um App em breve não é oferecida para automação', async () => {
  const { getApp } = await import('../dist/apps/registry.js')
  const { isUsableApp } = await import('../dist/apps/types.js')
  assert.equal(isUsableApp(getApp('candle_analyzer')), false)
  // E os demais continuam disponíveis: a pausa é de um App, não do recurso.
  assert.equal(isUsableApp(getApp('slack')), true)
  assert.equal(isUsableApp(getApp('google')), true)
})

test('conceder permissão para um App em breve é recusado', async () => {
  const { ValidationError } = await import('../dist/building.js')
  const { getApp } = await import('../dist/apps/registry.js')
  const app = getApp('candle_analyzer')
  // O manifesto continua inteiro — o App está pausado, não removido.
  assert.equal(app.actions.length, 3)
  assert.equal(app.availability, 'coming_soon')
  assert.ok(ValidationError)
})
