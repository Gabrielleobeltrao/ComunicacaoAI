// A RODADA CORRETIVA, conferida contra o Mongo de verdade.
//
// Cada teste aqui existe porque a implementação anterior deixava passar exatamente
// isso: conhecimento de andar virando documento de um agente inventado, `update` que
// não atualizava nada, checkbox que era só enfeite, retomada que criava o segundo
// recurso, e desfazer que deixava chunk órfão.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.LLM_FAKE = '1'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { architectRouter } = await import('../dist/routes/architectRoutes.js')
const repo = await import('../dist/architect/repository.js')
const service = await import('../dist/architect/service.js')
const { computeBlueprintHash } = await import('../dist/architect/blueprint.js')
const { validateOfficeBlueprint } = await import('../dist/architect/validate.js')
const { loadOwnershipContext } = await import('../dist/architect/context.js')
const { semResourceId } = await import('../dist/architect/turn.js')
const { ensureTokenUsageIndexes } = await import('../dist/tokenUsage.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
const { ensureMemoryIndexes } = await import('../dist/memory/records.js')
const { setProviderApiKey, setMonthlyTokenCap } = await import('../dist/userSettings.js')
const { resetGuards } = await import('../dist/architect/guard.js')
const { createFloor } = await import('../dist/floors.js')
const { createAgent } = await import('../dist/agents.js')
const { createSector } = await import('../dist/sectors.js')
const { ensureDefaultBuilding } = await import('../dist/building.js')
const express = (await import('express')).default

const DONO = 'dono-correcoes'
const VIZINHO = 'vizinho-correcoes'
let server
let port
let sessao = DONO

const pedir = async (metodo, caminho, corpo) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/architect${caminho}`, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  const texto = await res.text()
  return { status: res.status, body: texto ? JSON.parse(texto) : null }
}

before(async () => {
  await mongoClient.connect()
  await repo.ensureArchitectIndexes()
  await ensureTokenUsageIndexes()
  await ensureRunIndexes()
  await ensureMemoryIndexes()

  const app = express()
  app.use(express.json())
  app.use((_req, res, next) => {
    res.locals.userId = sessao
    next()
  })
  app.use('/api/architect', architectRouter)
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      port = server.address().port
      resolve()
    })
  })
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

const COLECOES = [
  'architect_projects',
  'architect_messages',
  'architect_apply_operations',
  'token_usage',
  'token_usage_charges',
  'user_settings',
  'agents',
  'sectors',
  'offices',
  'buildings',
  'automations',
  'automation_versions',
  'automation_runs',
  'connections',
  'knowledge_documents',
  'knowledge_chunks',
  'memories',
]

beforeEach(async () => {
  for (const c of COLECOES) await db.collection(c).deleteMany({})
  resetGuards()
  sessao = DONO
  await setProviderApiKey(DONO, 'anthropic', 'chave-de-teste')
  await setMonthlyTokenCap(DONO, 0)
})

/** Um projeto com um blueprint escrito à mão — o dublê só sabe montar um. */
async function projetoCom(blueprint) {
  const p = await repo.createProject(DONO, { title: 'Teste', objective: 'teste' })
  await repo.patchProject(DONO, p._id, { blueprint, blueprintHash: computeBlueprintHash(blueprint), status: 'ready' })
  const { deriveChecklist, applyChecklistState, computeReadiness } = await import('../dist/architect/checklist.js')
  const checklist = applyChecklistState(deriveChecklist(blueprint), new Set())
  await repo.patchProject(DONO, p._id, { checklist, readiness: computeReadiness(checklist, []) })
  return (await repo.getProject(DONO, p._id))
}

const BASE = (extra = {}) => ({
  version: 1,
  title: 'Atendimento',
  objective: 'atender',
  floors: [{ key: 'andar', action: 'create', name: 'Atendimento', workMode: 'organization' }],
  agents: [
    { key: 'gerente', action: 'create', floorKey: 'andar', name: 'Gerente' },
    { key: 'duvidas', action: 'create', floorKey: 'andar', name: 'Dúvidas' },
  ],
  sectors: [{ key: 'setor', action: 'create', floorKey: 'andar', name: 'Atendimento', mode: 'orchestrated', memberAgentKeys: ['gerente', 'duvidas'], coordinatorAgentKey: 'gerente' }],
  routines: [],
  appRequirements: [],
  knowledgeRequirements: [],
  assumptions: [],
  warnings: [],
  checklist: [],
  ...extra,
})

const aplicar = (projeto, extra = {}, hooks = {}) =>
  service.applyProject(DONO, projeto._id, { blueprintHash: computeBlueprintHash(projeto.blueprint), idempotencyKey: 'op-1', confirm: true, ...extra }, hooks)

// ============================================================================
// 1. Conhecimento: cada escopo no mecanismo canônico DELE
// ============================================================================

const comConhecimento = (scope, targetKey, content) =>
  BASE({
    knowledgeRequirements: [
      { key: 'cardapio', scope, ...(targetKey ? { targetKey } : {}), title: 'Cardápio', description: 'o cardápio', required: true, expectedSource: 'upload', state: 'supplied', content },
    ],
  })

test('conhecimento de AGENTE vira documento na base do agente', async () => {
  const p = await projetoCom(comConhecimento('agent', 'duvidas', 'Pizza R$ 40'))
  const r = await aplicar(p)
  const doc = await db.collection('knowledge_documents').findOne({})
  assert.ok(doc, 'o documento existe')
  assert.equal(doc.ownerType, 'agent')
  const duvidas = await db.collection('agents').findOne({ ownerId: DONO, name: 'Dúvidas' })
  assert.ok(doc.ownerId.equals(duvidas._id), 'e pertence ao agente de verdade')
  assert.equal(await db.collection('memories').countDocuments({}), 0)
  assert.equal(r.operation.steps.find((s) => s.kind === 'knowledge').status, 'created')
})

test('conhecimento de SETOR vira documento na base do setor', async () => {
  const p = await projetoCom(comConhecimento('sector', 'setor', 'Política de troca'))
  await aplicar(p)
  const doc = await db.collection('knowledge_documents').findOne({})
  assert.equal(doc.ownerType, 'sector')
  const setor = await db.collection('sectors').findOne({ ownerId: DONO })
  assert.ok(doc.ownerId.equals(setor._id))
})

test('conhecimento de ANDAR vira documento do ANDAR — e NÃO de um agente inventado', async () => {
  // Antes isto ia para a memória determinística, por falta de dono: a base só aceitava
  // agente e setor. Ele existia, mas não era encontrado por busca semântica e não
  // aparecia em base nenhuma — agora o andar é dono de verdade.
  const p = await projetoCom(comConhecimento('floor', 'andar', 'Horário: 11h às 23h'))
  await aplicar(p)

  const doc = await db.collection('knowledge_documents').findOne({})
  assert.ok(doc, 'o documento existe')
  assert.equal(doc.ownerType, 'floor')
  const andar = await db.collection('offices').findOne({ ownerId: DONO })
  assert.ok(doc.ownerId.equals(andar._id), 'no andar real, com o id real')
  assert.match(doc.content, /11h às 23h/)
  assert.equal(await db.collection('memories').countDocuments({}), 0, 'a memória não é mais o lugar disto')
})

test('conhecimento do PRÉDIO vira documento do prédio', async () => {
  const p = await projetoCom(comConhecimento('building', null, 'Somos uma pizzaria'))
  await aplicar(p)
  const predio = await ensureDefaultBuilding(DONO)
  const doc = await db.collection('knowledge_documents').findOne({})
  assert.equal(doc.ownerType, 'building')
  assert.ok(doc.ownerId.equals(predio._id))
  assert.equal(await db.collection('memories').countDocuments({}), 0)
})

test('conhecimento do prédio não aponta para alvo nenhum: quem resolve é o servidor', () => {
  const bp = comConhecimento('building', 'andar', 'texto')
  const r = validateOfficeBlueprint(bp)
  assert.equal(r.valid, false)
  assert.ok(r.issues.some((i) => i.code === 'unexpected_target'))
})

test('sem conteúdo, nenhum escopo grava nada — e a pendência fica', async () => {
  for (const [scope, targetKey] of [
    ['agent', 'duvidas'],
    ['sector', 'setor'],
    ['floor', 'andar'],
    ['building', null],
  ]) {
    for (const c of COLECOES) await db.collection(c).deleteMany({})
    await setProviderApiKey(DONO, 'anthropic', 'k')
    const bp = comConhecimento(scope, targetKey, undefined)
    bp.knowledgeRequirements[0].state = 'missing'
    const p = await projetoCom(bp)
    const r = await aplicar(p)
    assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0, scope)
    assert.equal(await db.collection('memories').countDocuments({}), 0, scope)
    assert.equal(r.operation.steps.find((s) => s.kind === 'knowledge').status, 'skipped', scope)
    assert.notEqual(r.project.checklist.find((i) => i.category === 'knowledge').status, 'done', scope)
  }
})

// ============================================================================
// 2. create / reuse / update
// ============================================================================

test('a lista de alvos traz só o que é desta conta', async () => {
  const meuAndar = await createFloor(DONO, { name: 'Meu andar' })
  await createAgent(DONO, meuAndar._id, 'Meu agente')
  const outroAndar = await createFloor(VIZINHO, { name: 'Andar alheio' })
  await createAgent(VIZINHO, outroAndar._id, 'Agente alheio')

  const r = await pedir('GET', '/targets')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.floors.map((f) => f.name), ['Meu andar'])
  assert.deepEqual(r.body.agents.map((a) => a.name), ['Meu agente'])
})

test('um resourceId inventado pela LLM é arrancado antes de qualquer gravação', () => {
  const limpo = semResourceId({
    agents: [{ key: 'a', name: 'A', resourceId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }],
    floors: [{ key: 'f', resourceId: 'bbbbbbbbbbbbbbbbbbbbbbbb', nested: { resourceId: 'cccccccccccccccccccccccc' } }],
  })
  assert.equal(JSON.stringify(limpo).includes('resourceId'), false)
  assert.equal(limpo.agents[0].name, 'A', 'o resto passa intacto')
})

test('ligar um item a um recurso de outra conta é recusado', async () => {
  const alheio = await createFloor(VIZINHO, { name: 'Andar alheio' })
  const p = await projetoCom(BASE())
  const r = await pedir('PATCH', `/projects/${p._id}/links`, { links: [{ kind: 'floor', key: 'andar', action: 'reuse', resourceId: alheio._id.toString() }] })
  assert.equal(r.status, 400)
  assert.match(r.body.message, /não existe nesta conta/)
})

test('ligar um item a um recurso do dono preenche o resourceId e muda a ação', async () => {
  const meu = await createFloor(DONO, { name: 'Meu andar' })
  const p = await projetoCom(BASE())
  const r = await pedir('PATCH', `/projects/${p._id}/links`, { links: [{ kind: 'floor', key: 'andar', action: 'reuse', resourceId: meu._id.toString() }] })
  assert.equal(r.status, 200)
  const item = r.body.blueprint.floors.find((f) => f.key === 'andar')
  assert.equal(item.action, 'reuse')
  assert.equal(item.resourceId, meu._id.toString())
  assert.equal(r.body.status, 'draft', 'uma ligação nova precisa ser validada de novo')
})

test('REUSE não altera o recurso', async () => {
  const meu = await createFloor(DONO, { name: 'Nome original', mission: 'missão original' })
  const bp = BASE()
  bp.floors = [{ key: 'andar', action: 'reuse', resourceId: meu._id.toString(), name: 'Nome DIFERENTE na proposta', mission: 'outra missão', workMode: 'organization' }]
  const p = await projetoCom(bp)
  const r = await aplicar(p)

  const depois = await db.collection('offices').findOne({ _id: meu._id })
  assert.equal(depois.name, 'Nome original', 'o nome não mudou')
  assert.equal(depois.mission, 'missão original')
  assert.equal(r.operation.steps.find((s) => s.kind === 'floor').status, 'reused')
})

test('UPDATE aprovado altera — pelo serviço canônico', async () => {
  const meu = await createFloor(DONO, { name: 'Nome antigo', mission: 'missão antiga' })
  const bp = BASE()
  bp.floors = [{ key: 'andar', action: 'update', resourceId: meu._id.toString(), name: 'Nome novo', mission: 'missão nova', workMode: 'organization' }]
  const p = await projetoCom(bp)
  const r = await aplicar(p, { approvedUpdateKeys: ['andar'] })

  const depois = await db.collection('offices').findOne({ _id: meu._id })
  assert.equal(depois.name, 'Nome novo')
  assert.equal(depois.mission, 'missão nova')
  assert.equal(r.operation.steps.find((s) => s.kind === 'floor').status, 'updated')
})

test('UPDATE não aprovado é RECUSADO: o recurso fica como estava', async () => {
  const meu = await createFloor(DONO, { name: 'Nome antigo' })
  const bp = BASE()
  bp.floors = [{ key: 'andar', action: 'update', resourceId: meu._id.toString(), name: 'Nome novo', workMode: 'organization' }]
  const p = await projetoCom(bp)
  const r = await aplicar(p, { approvedUpdateKeys: [] })

  const depois = await db.collection('offices').findOne({ _id: meu._id })
  assert.equal(depois.name, 'Nome antigo', 'sem aprovação, nada muda')
  const passo = r.operation.steps.find((s) => s.kind === 'floor')
  assert.equal(passo.status, 'skipped')
  assert.match(passo.message, /não aprovada/)
})

test('UPDATE de agente aprovado altera só o que a proposta declara', async () => {
  const andar = await createFloor(DONO, { name: 'Andar' })
  const agente = await createAgent(DONO, andar._id, 'Nome antigo', { objective: 'objetivo antigo', instructions: 'instrução antiga' })
  const bp = BASE()
  bp.floors = [{ key: 'andar', action: 'reuse', resourceId: andar._id.toString(), name: 'Andar', workMode: 'organization' }]
  bp.agents = [{ key: 'gerente', action: 'update', resourceId: agente._id.toString(), floorKey: 'andar', name: 'Nome novo', objective: 'objetivo novo' }]
  bp.sectors = []
  const p = await projetoCom(bp)
  await aplicar(p, { approvedUpdateKeys: ['gerente'] })

  const depois = await db.collection('agents').findOne({ _id: agente._id })
  assert.equal(depois.name, 'Nome novo')
  assert.equal(depois.objective, 'objetivo novo')
  assert.equal(depois.instructions, 'instrução antiga', 'o que a proposta não declarou não foi tocado')
})

test('a mudança no prédio não é ignorada: sem aprovação ela é registrada como pulada', async () => {
  await ensureDefaultBuilding(DONO)
  const bp = BASE({ buildingPatch: { name: 'Pizzaria do Zé' } })
  const p = await projetoCom(bp)
  const r = await aplicar(p, { approvedUpdateKeys: [] })

  const predio = await db.collection('buildings').findOne({ ownerId: DONO })
  assert.notEqual(predio.name, 'Pizzaria do Zé')
  const passo = r.operation.steps.find((s) => s.key === 'building')
  assert.equal(passo.status, 'skipped')
  assert.match(passo.message, /não foi aprovada/)
})

test('a mudança no prédio aprovada acontece', async () => {
  await ensureDefaultBuilding(DONO)
  const p = await projetoCom(BASE({ buildingPatch: { name: 'Pizzaria do Zé' } }))
  await aplicar(p, { approvedUpdateKeys: ['building'] })
  const predio = await db.collection('buildings').findOne({ ownerId: DONO })
  assert.equal(predio.name, 'Pizzaria do Zé')
})

test('um campo que o prédio não tem é recusado na validação, não ignorado', () => {
  const r = validateOfficeBlueprint(BASE({ buildingPatch: { name: 'ok', cor: 'azul' } }))
  assert.equal(r.valid, false)
  assert.ok(r.issues.some((i) => i.code === 'unsupported_field'))
})

test('rotina reutilizada precisa apontar para uma rotina desta conta', async () => {
  const bp = BASE()
  bp.routines = [{ key: 'r', action: 'reuse', resourceId: 'aaaaaaaaaaaaaaaaaaaaaaaa', floorKey: 'andar', ownerAgentKey: 'gerente', name: 'Rotina', triggerType: 'manual' }]
  const ctx = await loadOwnershipContext(DONO)
  const r = validateOfficeBlueprint(bp, ctx)
  assert.equal(r.valid, false)
  assert.ok(r.issues.some((i) => i.code === 'not_owned'))
})

// ============================================================================
// 3. A saga: marcador, recuperação e retomada
// ============================================================================

test('o que a aplicação cria leva a marca de origem', async () => {
  const p = await projetoCom(BASE())
  const r = await aplicar(p)
  const operationId = r.operation.id

  for (const [colecao, key] of [['offices', 'andar'], ['agents', 'gerente'], ['sectors', 'setor']]) {
    const doc = await db.collection(colecao).findOne({ ownerId: DONO, 'architect.blueprintKey': key })
    assert.ok(doc, `${colecao} sem marca`)
    assert.equal(doc.architect.operationId, operationId)
    assert.equal(doc.architect.projectId, p._id.toString())
  }
})

test('queda ENTRE criar e registrar o passo: a retomada recupera pela marca, sem duplicar', async () => {
  const p = await projetoCom(BASE())

  // A queda acontece DEPOIS de o agente existir e ANTES de o passo dele ser gravado.
  // É a janela exata em que a retomada criava o segundo.
  let derrubado = false
  await assert.rejects(
    service.applyProject(
      DONO,
      p._id,
      { blueprintHash: computeBlueprintHash(p.blueprint), idempotencyKey: 'op-janela', confirm: true },
      {
        afterCreate: async (kind, key) => {
          if (kind === 'agent' && key === 'gerente' && !derrubado) {
            derrubado = true
            throw new Error('queda simulada entre criar e registrar')
          }
        },
      },
    ),
  )

  assert.equal(await db.collection('agents').countDocuments({ ownerId: DONO }), 1, 'o agente ficou criado')
  const operacao = await repo.lastOperation(DONO, p._id)
  assert.equal(operacao.resourceMap['agent:gerente'], undefined, 'e o passo dele NÃO foi registrado')

  const retomada = await service.resumeProject(DONO, p._id)
  assert.equal(retomada.project.status, 'applied')
  assert.equal(await db.collection('agents').countDocuments({ ownerId: DONO, name: 'Gerente' }), 1, 'não criou o segundo')
  const passo = retomada.operation.steps.find((s) => s.kind === 'agent' && s.key === 'gerente')
  assert.match(passo.message, /recuperado/)
})

test('duas retomadas simultâneas não rodam juntas', async () => {
  const p = await projetoCom(BASE())
  await assert.rejects(
    service.applyProject(DONO, p._id, { blueprintHash: computeBlueprintHash(p.blueprint), idempotencyKey: 'op-conc', confirm: true }, {
      beforeStep: (kind) => {
        if (kind === 'sector') throw new Error('queda simulada')
      },
    }),
  )

  const resultados = await Promise.allSettled([service.resumeProject(DONO, p._id), service.resumeProject(DONO, p._id)])
  const ok = resultados.filter((r) => r.status === 'fulfilled')
  const recusadas = resultados.filter((r) => r.status === 'rejected')
  assert.equal(ok.length, 1, 'uma passa')
  assert.equal(recusadas.length, 1, 'a outra é recusada')
  assert.equal(await db.collection('sectors').countDocuments({ ownerId: DONO }), 1, 'um setor só')
  assert.equal(await db.collection('agents').countDocuments({ ownerId: DONO }), 2)
})

test('na falha, o applyState guarda o operationId REAL', async () => {
  const p = await projetoCom(BASE())
  await assert.rejects(
    service.applyProject(DONO, p._id, { blueprintHash: computeBlueprintHash(p.blueprint), idempotencyKey: 'op-falha', confirm: true }, {
      beforeStep: (kind) => {
        if (kind === 'sector') throw new Error('queda simulada')
      },
    }),
  )
  const projeto = await repo.getProject(DONO, p._id)
  const operacao = await repo.lastOperation(DONO, p._id)
  assert.equal(projeto.status, 'failed')
  assert.equal(projeto.applyState.operationId, operacao._id.toString())
  assert.ok(projeto.applyState.error)
})

// ============================================================================
// 4. Rollback canônico
// ============================================================================

test('o desfazer leva os chunks do conhecimento junto', async () => {
  const p = await projetoCom(comConhecimento('agent', 'duvidas', 'Pizza R$ 40. Refrigerante R$ 8.'))
  await aplicar(p)
  const doc = await db.collection('knowledge_documents').findOne({})
  assert.ok(doc)

  // Os trechos são inseridos aqui, e não pela indexação: ela chama um provedor de
  // embedding, e um teste que depende de rede afirma sobre a rede, não sobre o
  // desfazer. O que precisa ser exercitado é o caminho de remoção.
  await db.collection('knowledge_chunks').insertOne({ _id: new ObjectId(), documentId: doc._id, ownerType: 'agent', ownerId: doc.ownerId, content: 'Pizza R$ 40', createdAt: new Date() })
  assert.equal(await db.collection('knowledge_chunks').countDocuments({}), 1)

  await service.rollbackProject(DONO, p._id)
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0)
  assert.equal(await db.collection('knowledge_chunks').countDocuments({}), 0, 'nenhum pedaço órfão')
})

test('o desfazer leva a base do agente junto com ele', async () => {
  const p = await projetoCom(comConhecimento('agent', 'duvidas', 'Pizza R$ 40'))
  await aplicar(p)
  const doc = await db.collection('knowledge_documents').findOne({})
  await db.collection('knowledge_chunks').insertOne({ _id: new ObjectId(), documentId: doc._id, ownerType: 'agent', ownerId: doc.ownerId, content: 'Pizza R$ 40', createdAt: new Date() })
  await service.rollbackProject(DONO, p._id)
  assert.equal(await db.collection('agents').countDocuments({ ownerId: DONO }), 0)
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0)
  assert.equal(await db.collection('knowledge_chunks').countDocuments({}), 0)
})

test('o desfazer leva o documento do andar — e os pedaços dele', async () => {
  const p = await projetoCom(comConhecimento('floor', 'andar', 'Horário: 11h às 23h'))
  await aplicar(p)
  const doc = await db.collection('knowledge_documents').findOne({})
  await db.collection('knowledge_chunks').insertOne({ _id: new ObjectId(), documentId: doc._id, ownerType: 'floor', ownerId: doc.ownerId, content: 'Horário', createdAt: new Date() })
  await service.rollbackProject(DONO, p._id)
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0)
  assert.equal(await db.collection('knowledge_chunks').countDocuments({}), 0, 'nenhum pedaço órfão')
})

test('o desfazer da rotina leva versões e execuções junto', async () => {
  const bp = BASE()
  // Uma etapa de verdade: o validador que a plataforma já usa recusa rotina sem nenhuma.
  bp.routines = [
    {
      key: 'rot',
      action: 'create',
      floorKey: 'andar',
      ownerAgentKey: 'gerente',
      name: 'Rotina',
      triggerType: 'manual',
      steps: [
        {
          id: 's1',
          name: 'Anotar',
          type: 'memory.write',
          enabled: true,
          dependsOn: [],
          inputMapping: {},
          // Referência por KEY, que é o contrato do blueprint: o id real entra na aplicação.
          config: { scope: 'building', key: 'nota', strategy: 'append', ownerAgentKey: 'gerente' },
          timeoutMs: 5000,
          retryPolicy: { maxAttempts: 1, backoffMs: 0 },
          continueOnError: false,
        },
      ],
    },
  ]
  const p = await projetoCom(bp)
  const r = await aplicar(p)
  const rotinaId = new ObjectId(r.operation.resourceMap['routine:rot'])
  // Um resto de execução, do tipo que ficaria órfão.
  await db.collection('automation_runs').insertOne({ _id: new ObjectId(), ownerId: DONO, automationId: rotinaId, status: 'succeeded' })
  await db.collection('automation_versions').insertOne({ _id: new ObjectId(), ownerId: DONO, automationId: rotinaId, version: 1 })

  // E a etapa foi gravada com o ID real do agente, não com a key.
  const rotina = await db.collection('automations').findOne({ _id: rotinaId })
  const gerente = await db.collection('agents').findOne({ ownerId: DONO, name: 'Gerente' })
  assert.equal(rotina.draftDefinition.steps[0].config.ownerAgentId, gerente._id.toString())
  assert.equal(rotina.draftDefinition.steps[0].config.ownerAgentKey, undefined)
  assert.ok(rotina.draftDefinition.steps[0].config.buildingId, 'o prédio veio do servidor')

  await service.rollbackProject(DONO, p._id)
  assert.equal(await db.collection('automations').countDocuments({ ownerId: DONO }), 0)
  assert.equal(await db.collection('automation_runs').countDocuments({ automationId: rotinaId }), 0)
  assert.equal(await db.collection('automation_versions').countDocuments({ automationId: rotinaId }), 0)
})

test('o desfazer NÃO remove o que foi apenas reutilizado', async () => {
  const meu = await createFloor(DONO, { name: 'Andar que já existia' })
  const bp = BASE()
  bp.floors = [{ key: 'andar', action: 'reuse', resourceId: meu._id.toString(), name: 'Andar', workMode: 'organization' }]
  const p = await projetoCom(bp)
  await aplicar(p)
  await service.rollbackProject(DONO, p._id)
  assert.ok(await db.collection('offices').findOne({ _id: meu._id }), 'o andar reutilizado continua de pé')
  assert.equal(await db.collection('agents').countDocuments({ ownerId: DONO }), 0, 'o que foi criado saiu')
})

test('o desfazer não toca no que foi criado por OUTRA aplicação', async () => {
  const p1 = await projetoCom(BASE())
  const r1 = await service.applyProject(DONO, p1._id, { blueprintHash: computeBlueprintHash(p1.blueprint), idempotencyKey: 'op-a', confirm: true })
  const agentesDaPrimeira = await db.collection('agents').find({ ownerId: DONO }).toArray()

  // Uma segunda operação registra um passo apontando para o agente da primeira.
  const p2 = await projetoCom(BASE())
  const { operation } = await repo.openOperation(DONO, p2._id, 'hash', 'op-b')
  await repo.recordStep(DONO, operation._id, { kind: 'agent', key: 'gerente', status: 'created', resourceId: agentesDaPrimeira[0]._id.toString(), at: new Date() })

  const r = await service.rollbackProject(DONO, p2._id)
  assert.ok(await db.collection('agents').findOne({ _id: agentesDaPrimeira[0]._id }), 'o agente da outra operação ficou')
  assert.ok(r.kept.some((k) => /outra aplicação/.test(k.reason)))
  assert.equal(r1.operation.status, 'completed')
})

// ============================================================================
// 5. Custo e auditoria
// ============================================================================

test('o teto é conferido antes do REPARO também', async () => {
  const { runArchitectTurn } = await import('../dist/architect/turn.js')
  const { recordReplyUsage } = await import('../dist/tokenUsage.js')
  await setMonthlyTokenCap(DONO, 40)

  // Prompt sem a marca do Arquiteto: a primeira resposta é ilegível e o reparo entra.
  const r = await runArchitectTurn({ ownerId: DONO, provider: 'anthropic', model: null, prompt: 'x'.repeat(400), chargeKey: 'teto' })
  assert.equal(r.ok, false)
  // A primeira chamada estourou o teto; o reparo é recusado por limite, não tentado.
  const cobrancas = await db.collection('token_usage_charges').find({ _id: /^teto/ }).toArray()
  assert.deepEqual(cobrancas.map((c) => c._id), ['teto'], 'o reparo não chegou a gastar')
  assert.equal(r.failure.code, 'budget_exceeded')
  assert.ok((await import('../dist/tokenUsage.js')).getMonthlyTokens && recordReplyUsage)
})

test('gerar e revisar ficam no log; a conversa não', async () => {
  const { auditTargetFor } = await import('../dist/routes/auditMiddleware.js')
  const ID = '000000000000000000000a11'
  assert.deepEqual(auditTargetFor('POST', `/api/architect/projects/${ID}/generate`), { entityType: 'architect_project', entityId: ID, action: 'update' })
  assert.deepEqual(auditTargetFor('POST', `/api/architect/projects/${ID}/validate`), { entityType: 'architect_project', entityId: ID, action: 'test' })
  assert.deepEqual(auditTargetFor('POST', `/api/architect/projects/${ID}/apply`), { entityType: 'architect_project', entityId: ID, action: 'publish' })
  assert.deepEqual(auditTargetFor('POST', `/api/architect/projects/${ID}/resume`), { entityType: 'architect_project', entityId: ID, action: 'publish' })
  assert.deepEqual(auditTargetFor('POST', `/api/architect/projects/${ID}/rollback`), { entityType: 'architect_project', entityId: ID, action: 'delete' })
  assert.equal(auditTargetFor('POST', `/api/architect/projects/${ID}/messages`), null)
})
