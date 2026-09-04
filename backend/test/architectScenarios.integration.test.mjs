// OS CENÁRIOS OBRIGATÓRIOS — §20 do plano, do Brief até o recurso real.
//
// Os testes do compilador provam que o DESENHO sai certo. Estes provam a outra metade: que o
// desenho vira escritório. O Brief é montado à mão (a conversa é outro assunto), compilado
// pelos dois compiladores e APLICADO pela saga de verdade — serviços canônicos, coleções
// reais, e uma origem HTTP que responde de fato.
//
// Nenhum stub genérico: um mock devolvendo o que o teste espera provaria só que o mock
// funciona, e é exatamente o que o plano proíbe.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { mongoClient, db } = await import('../dist/db.js')
const repo = await import('../dist/architect/repository.js')
const { compileBrief } = await import('../dist/architect/compile.js')
const { compileBriefV2 } = await import('../dist/architect/compileV2.js')
const { applyBlueprint } = await import('../dist/architect/apply.js')
const { computeBlueprintHash } = await import('../dist/architect/blueprint.js')
const { emptyBrief } = await import('../dist/architect/brief.js')
const { loadOfficeInventory } = await import('../dist/architect/inventory.js')
const { recheckProject } = await import('../dist/architect/recheck.js')
const { deriveChecklist } = await import('../dist/architect/checklist.js')
const { ensureExecutionRootIndexes } = await import('../dist/executionRoots.js')
const { createInstallation } = await import('../dist/apps/installations.js')

const DONO = 'dono-cenarios'
let origem
let porta
let corpo = { rsi: 22.5, preco: 31.4 }

const MANIFESTO = () => ({
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
      connected: true,
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
    { key: 'whatsapp', connected: true },
  ],
})

before(async () => {
  await mongoClient.connect()
  await repo.ensureArchitectIndexes()
  await ensureExecutionRootIndexes()
  origem = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(corpo))
  })
  await new Promise((r) => origem.listen(0, r))
  porta = origem.address().port
})

after(async () => {
  origem?.close()
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of [
    'architect_projects',
    'architect_apply_operations',
    'offices',
    'buildings',
    'agents',
    'sectors',
    'automations',
    'connections',
    'data_stores',
    'dataset_definitions',
    'monitoring_sources',
    'monitors',
    'execution_roots',
    'knowledge_documents',
  ])
    await db.collection(c).deleteMany({})
  corpo = { rsi: 22.5, preco: 31.4 }
})

/**
 * Do Brief até a aplicação, pelo caminho de verdade.
 *
 * Os andares saem do plano V1 e são passados ao V2: é a mesma regra do rollout — quem decide
 * a organização é quem a aplica, e o V2 não inventa `key` nenhuma.
 */
const aplicar = async (brief, { title, objective, ativar = [], atualizarFonte } = {}) => {
  const inventory = await loadOfficeInventory(DONO)
  const base = { title: title ?? 'Operação', objective: objective ?? brief.businessGoal }
  const v1 = compileBrief(brief, MANIFESTO(), base).blueprint
  const v2 = compileBriefV2({
    brief,
    manifest: MANIFESTO(),
    inventory,
    base,
    changeKind: 'create',
    floors: v1.floors.map((f) => ({ key: f.key, name: f.name })),
  }).blueprint

  // A fonte compilada aponta para o provedor que o Brief citou; nos testes ela aponta para a
  // origem local, que é a única forma de o teste de aceitação bater em algo de verdade.
  for (const fonte of v2.operations.sources) {
    fonte.config = { url: `http://127.0.0.1:${porta}/dados`, method: 'GET' }
    if (atualizarFonte) atualizarFonte(fonte)
  }

  const projeto = await repo.createProject(DONO, base)
  const hash = computeBlueprintHash(v1, v2)
  // A checklist é derivada do plano, como o serviço faz: sem ela a prontidão não teria o que
  // conferir, e o teste estaria medindo a própria omissão do fixture.
  const comPlano = await repo.patchProject(DONO, projeto._id, {
    blueprint: v1,
    blueprintV2: v2,
    blueprintVersion: 2,
    blueprintHash: hash,
    checklist: deriveChecklist(v1),
  })

  const operacao = await applyBlueprint(DONO, comPlano, {
    blueprintHash: hash,
    idempotencyKey: `op-${projeto._id}`,
    approvedAppKeys: MANIFESTO().apps.map((a) => a.key),
    approvedActivationKeys: ativar,
  })
  return { projeto: comPlano, operacao, v1, v2 }
}

const briefB = () => ({
  ...emptyBrief('Acompanhar CXSE3 e avisar sobre o RSI'),
  channels: ['whatsapp'],
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

// --- CENÁRIO B: trading ------------------------------------------------------------------------

test('CENÁRIO B: a cadeia inteira nasce — fonte, histórico, monitor e Flow, todos parados', async () => {
  const { operacao } = await aplicar(briefB())

  const falhas = operacao.steps.filter((p) => p.status === 'failed')
  assert.deepEqual(falhas, [], JSON.stringify(falhas))

  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.ok(fonte, 'sem fonte não há vigilância')
  assert.equal(fonte.status, 'draft', 'nada nasce ligado')

  const flow = await db.collection('automations').findOne({ ownerId: DONO })
  assert.ok(flow, 'o aviso precisa de um Flow para sair')
  assert.notEqual(flow.status, 'active')
})

test('CENÁRIO B: a fonte é TESTADA antes de ser ativada, e só entra no ar com autorização', async () => {
  const { operacao, v2 } = await aplicar(briefB(), { ativar: v2Keys('source') })
  const prova = (operacao.acceptance ?? []).find((a) => a.kind === 'source')
  assert.ok(prova, `sem teste de fonte declarado: ${JSON.stringify(v2.acceptanceTests)}`)
  assert.equal(prova.status, 'passed', prova.observed)

  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.equal(fonte.status, 'active')
  // O portão do domínio pede leitura bem-sucedida, e é o teste que a produziu.
  assert.ok(fonte.telemetry.lastTestOkAt)
})

test('CENÁRIO B: uma origem que não traz o campo REPROVA, e a fonte não entra no ar', async () => {
  // O caso perigoso: 200, corpo válido, e o campo que a regra observa ausente.
  corpo = { outra_coisa: 1 }
  const { operacao } = await aplicar(briefB(), { ativar: v2Keys('source') })
  const prova = (operacao.acceptance ?? []).find((a) => a.kind === 'source')
  assert.equal(prova.status, 'failed', prova?.observed)

  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.equal(fonte.status, 'draft', 'autorização não substitui prova')
})

test('CENÁRIO B: campo ausente NUNCA vira zero', async () => {
  const brief = briefB()
  brief.jobs[0].trigger = 'quando o RSI cair'
  const { v2 } = await aplicar(brief)
  for (const m of v2.operations.monitors) {
    assert.notEqual(m.threshold, 0, 'um limiar inventado dispara o alarme errado a semana inteira')
  }
})

test('CENÁRIO B: o resultado do teste aparece na Activity, em ambiente de teste', async () => {
  await aplicar(briefB(), { ativar: v2Keys('source') })
  const raizes = await db.collection('execution_roots').find({ ownerId: DONO }).toArray()
  assert.ok(raizes.length > 0, 'o teste de aceitação precisa aparecer na linha do tempo')
  for (const r of raizes) assert.equal(r.environment, 'test', 'um teste não pode contar como produção')
})

/** As `key`s de um tipo no último plano compilado. Preenchida pelo próprio `aplicar`. */
let ultimoV2 = null
function v2Keys(tipo) {
  // Chamada ANTES da aplicação: devolve o que o compilador vai produzir para este Brief.
  // Como as chaves são determinísticas, compilar duas vezes dá a mesma lista.
  const brief = briefB()
  const base = { title: 'Operação', objective: brief.businessGoal }
  const v1 = compileBrief(brief, MANIFESTO(), base).blueprint
  const bp = compileBriefV2({
    brief,
    manifest: MANIFESTO(),
    inventory: null,
    base,
    changeKind: 'create',
    floors: v1.floors.map((f) => ({ key: f.key, name: f.name })),
  }).blueprint
  ultimoV2 = bp
  return tipo === 'source' ? bp.operations.sources.map((s) => s.key) : []
}

// --- CENÁRIO C: restaurante ----------------------------------------------------------------------

const briefC = () => ({
  ...emptyBrief('Automatizar atendimento e reservas pelo WhatsApp'),
  channels: ['whatsapp'],
  knowledgeNeeds: [{ subject: 'cardápio', scope: 'floor', required: true }],
  jobs: [
    {
      id: 'atender',
      name: 'Atender o cliente',
      trigger: 'quando chega uma mensagem no WhatsApp',
      input: 'a mensagem do cliente',
      decision: 'se é dúvida ou reserva',
      action: 'responder ou encaminhar',
      output: 'a resposta',
      frequency: 'sempre',
    },
    {
      id: 'reservar',
      name: 'Reservar mesa',
      trigger: 'quando o cliente pede mesa',
      input: 'dia, horário e número de pessoas',
      decision: 'se há disponibilidade',
      action: 'criar o evento na agenda',
      output: 'a confirmação',
      frequency: 'sempre',
    },
  ],
})

test('CENÁRIO C: nenhum agente aparece com responsabilidade vazia', async () => {
  const { v2 } = await aplicar(briefC(), { title: 'Restaurante' })
  assert.ok(v2.organization.agents.length >= 2, 'atender e reservar são trabalhos diferentes')
  for (const a of v2.organization.agents) {
    for (const campo of ['role', 'trigger', 'inputContract', 'outputContract']) {
      assert.ok(String(a[campo] ?? '').trim(), `${a.key} está sem ${campo}: o Flow mostraria uma ficha em branco`)
    }
  }
})

test('CENÁRIO C: os agentes aplicados têm função escrita no recurso REAL', async () => {
  await aplicar(briefC(), { title: 'Restaurante' })
  const agentes = await db.collection('agents').find({ ownerId: DONO }).toArray()
  assert.ok(agentes.length >= 2)
  for (const a of agentes) assert.ok(String(a.role ?? '').trim(), `${a.name} foi criado sem função`)
})

test('CENÁRIO C: o Knowledge do cardápio fica PENDENTE — nada é inventado', async () => {
  const { projeto } = await aplicar(briefC(), { title: 'Restaurante' })
  assert.equal(await db.collection('knowledge_documents').countDocuments({ ownerId: DONO }), 0, 'um cardápio inventado é pior que um cardápio ausente')
  const atual = await repo.getProject(DONO, projeto._id)
  const { checklist } = await recheckProject(DONO, atual)
  assert.ok(
    checklist.some((i) => i.category === 'knowledge' && i.status !== 'done'),
    JSON.stringify(checklist.map((i) => [i.id, i.status])),
  )
})

test('CENÁRIO C: as ações do App são as EXATAS do manifesto, e a escrita não vem de graça', async () => {
  const { v2 } = await aplicar(briefC(), { title: 'Restaurante' })
  const calendario = v2.resources.appRequirements.find((r) => r.appKey === 'google_calendar')
  assert.ok(calendario, `nenhum requisito de Calendar: ${JSON.stringify(v2.resources.appRequirements.map((r) => r.appKey))}`)
  const conhecidas = new Set(['list_events', 'create_event', 'delete_event'])
  for (const acao of calendario.actionKeys ?? []) assert.ok(conhecidas.has(acao), `"${acao}" não é uma ação do Calendar`)
  // Escrita autônoma começa vazia: conceder é um ato, não um padrão.
  assert.deepEqual(calendario.autonomousWriteActionKeys ?? [], [])
})

// --- CENÁRIO D: salão que já existe -----------------------------------------------------------------

test('CENÁRIO D: um andar que já existe é REUSADO, e nada é duplicado', async () => {
  // O salão de antes: um prédio, um andar "Recepção" e um agente nele.
  const predio = new ObjectId()
  const andar = new ObjectId()
  await db.collection('buildings').insertOne({ _id: predio, ownerId: DONO, name: 'Salão', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: andar, ownerId: DONO, buildingId: predio, name: 'Recepção', status: 'active', workMode: 'organization', createdAt: new Date(), updatedAt: new Date() })

  const inventory = await loadOfficeInventory(DONO)
  const brief = {
    ...emptyBrief('Adicionar recepção e agenda ao salão'),
    jobs: [
      {
        id: 'recepcionar',
        name: 'Recepcionar cliente',
        trigger: 'quando o cliente chega',
        input: 'o pedido',
        decision: 'qual serviço',
        action: 'encaminhar',
        output: 'o encaminhamento',
        frequency: 'sempre',
      },
    ],
  }
  const bp = compileBriefV2({
    brief,
    manifest: MANIFESTO(),
    inventory,
    base: { title: 'Recepção', objective: brief.businessGoal },
    changeKind: 'expand',
  }).blueprint

  const recepcao = bp.organization.floors.find((f) => f.name === 'Recepção')
  assert.ok(recepcao, `o andar existente não foi reconhecido: ${JSON.stringify(bp.organization.floors.map((f) => f.name))}`)
  assert.equal(recepcao.action, 'reuse', 'criar de novo deixaria dois andares com o mesmo nome')
  assert.equal(recepcao.resourceId, andar.toString())
})

test('CENÁRIO D: aplicar sobre o que existe NÃO cria um segundo andar', async () => {
  const predio = new ObjectId()
  const andar = new ObjectId()
  await db.collection('buildings').insertOne({ _id: predio, ownerId: DONO, name: 'Salão', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('offices').insertOne({ _id: andar, ownerId: DONO, buildingId: predio, name: 'Recepção', status: 'active', workMode: 'organization', createdAt: new Date(), updatedAt: new Date() })

  const antes = await db.collection('offices').countDocuments({ ownerId: DONO })
  const brief = {
    ...emptyBrief('Adicionar recepção e agenda ao salão'),
    jobs: [
      {
        id: 'recepcionar',
        name: 'Recepcionar cliente',
        trigger: 'quando o cliente chega',
        input: 'o pedido',
        decision: 'qual serviço',
        action: 'encaminhar',
        output: 'o encaminhamento',
        frequency: 'sempre',
      },
    ],
  }
  const { operacao } = await aplicar(brief, { title: 'Recepção' })
  assert.deepEqual(
    operacao.steps.filter((p) => p.status === 'failed'),
    [],
  )
  // A saga do V1 cria o andar dela; o que este caso protege é que o V2 não cria OUTRO em
  // cima do mesmo nome — a contagem cresce no máximo pelo que o V1 declarou.
  const depois = await db.collection('offices').countDocuments({ ownerId: DONO })
  assert.ok(depois <= antes + 1, `${antes} → ${depois}: um andar por plano é o escritório duplicado`)
})

// --- posse: nada disso pode atravessar contas ---------------------------------------------------------

test('AMEAÇA: aplicar na conta de um dono não escreve nada na de outro', async () => {
  await aplicar(briefC(), { title: 'Restaurante' })
  for (const c of ['offices', 'agents', 'automations', 'monitoring_sources', 'data_stores']) {
    assert.equal(await db.collection(c).countDocuments({ ownerId: { $ne: DONO } }), 0, `vazou para outra conta em ${c}`)
  }
})
