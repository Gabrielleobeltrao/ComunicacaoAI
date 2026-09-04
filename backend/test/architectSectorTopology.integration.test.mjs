// LACUNA 8 CORRIGIDA — atualizar um setor mexe na TOPOLOGIA, e não só no nome.
//
// Antes, `update` trocava nome, cor, instrução e contratos. Uma revisão que acrescentava um
// agente à equipe era aprovada, aplicada e não acontecia: quem olhava a proposta via o
// agente novo; quem abria o setor não via.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { applyBlueprint } = await import('../dist/architect/apply.js')
const { computeBlueprintHash } = await import('../dist/architect/blueprint.js')
const { createProject, patchProject } = await import('../dist/architect/repository.js')
const { createSector, getSectorById } = await import('../dist/sectors.js')

const DONO = 'dono-topologia'
let predio
let andar
let outroAndar
let marina
let rafael
let tereza

before(async () => {
  await mongoClient.connect()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['buildings', 'offices', 'agents', 'sectors', 'architect_projects', 'architect_operations'])
    await db.collection(c).deleteMany({})

  predio = new ObjectId()
  andar = new ObjectId()
  outroAndar = new ObjectId()
  await db.collection('buildings').insertOne({ _id: predio, ownerId: DONO, name: 'Prédio', createdAt: new Date(), updatedAt: new Date() })
  for (const [id, nome] of [[andar, 'Atendimento'], [outroAndar, 'Financeiro']]) {
    await db.collection('offices').insertOne({ _id: id, ownerId: DONO, buildingId: predio, name: nome, status: 'active', workMode: 'organization', createdAt: new Date(), updatedAt: new Date() })
  }
  ;[marina, rafael, tereza] = [new ObjectId(), new ObjectId(), new ObjectId()]
  for (const [id, nome] of [[marina, 'Marina'], [rafael, 'Rafael'], [tereza, 'Tereza']]) {
    await db.collection('agents').insertOne({ _id: id, ownerId: DONO, officeId: andar, name: nome, role: `Faz ${nome}`, provider: 'anthropic', createdAt: new Date() })
  }
})

/** O blueprint mínimo que a aplicação aceita, com um setor em `update`. */
const planoDeAtualizacao = (setorId, over = {}) => ({
  version: 1,
  title: 'Revisão',
  objective: 'Ajustar o setor',
  floors: [{ key: 'atendimento', action: 'reuse', resourceId: andar.toString(), name: 'Atendimento', workMode: 'organization' }],
  agents: [
    { key: 'marina', action: 'reuse', resourceId: marina.toString(), floorKey: 'atendimento', name: 'Marina' },
    { key: 'rafael', action: 'reuse', resourceId: rafael.toString(), floorKey: 'atendimento', name: 'Rafael' },
    { key: 'tereza', action: 'reuse', resourceId: tereza.toString(), floorKey: 'atendimento', name: 'Tereza' },
  ],
  sectors: [
    {
      key: 'recepcao',
      action: 'update',
      resourceId: setorId.toString(),
      floorKey: 'atendimento',
      name: 'Recepção',
      mode: 'orchestrated',
      memberAgentKeys: ['marina', 'rafael'],
      coordinatorAgentKey: 'marina',
      ...over,
    },
  ],
  routines: [],
  appRequirements: [],
  knowledgeRequirements: [],
  assumptions: [],
  warnings: [],
  checklist: [],
})

/**
 * Aplica um plano pelo caminho REAL: projeto no banco, hash conferido, aprovações
 * explícitas. Um atalho aqui mediria uma aplicação que não existe em produção.
 */
const aplicar = async (bp) => {
  const projeto = await createProject(DONO, { title: bp.title, objective: bp.objective })
  const comBlueprint = await patchProject(DONO, projeto._id, { blueprint: bp, blueprintHash: computeBlueprintHash(bp), status: 'ready' })
  return applyBlueprint(DONO, comBlueprint, {
    blueprintHash: computeBlueprintHash(bp),
    idempotencyKey: `teste-${Math.random().toString(36).slice(2)}`,
    // Tudo aprovado: o que este arquivo testa é a topologia, não a aprovação.
    approvedUpdateKeys: bp.sectors.map((s) => s.key).concat(bp.agents.map((a) => a.key), bp.floors.map((f) => f.key)),
  })
}

test('ACEITAÇÃO: atualizar o setor acrescenta o membro novo à equipe', async () => {
  const setor = await createSector(DONO, andar, 'Recepção', '#6366f1', 'orchestrated', [{ agentId: marina, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: true }], {
    coordinatorAgentId: marina,
  })

  await aplicar(planoDeAtualizacao(setor._id))

  const depois = await getSectorById(DONO, setor._id)
  const ids = depois.members.map((m) => m.agentId.toString()).sort()
  assert.deepEqual(ids, [marina.toString(), rafael.toString()].sort(), 'o agente novo precisa estar na equipe')
})

test('trocar o coordenador troca o coordenador de verdade', async () => {
  const setor = await createSector(DONO, andar, 'Recepção', '#6366f1', 'orchestrated', [
    { agentId: marina, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: true },
    { agentId: rafael, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: false },
  ], { coordinatorAgentId: marina })

  await aplicar(planoDeAtualizacao(setor._id, { coordinatorAgentKey: 'rafael' }))

  const depois = await getSectorById(DONO, setor._id)
  assert.equal(depois.coordinatorAgentId.toString(), rafael.toString())
})

test('remover alguém da equipe REMOVE de verdade — a lista é a que o plano diz', async () => {
  // Sai a Tereza; ficam o coordenador e um especialista. Deixar o coordenador sozinho é
  // recusado pelo validador, e com razão: um setor orquestrado sem quem coordenar não
  // orquestra nada.
  const setor = await createSector(DONO, andar, 'Recepção', '#6366f1', 'orchestrated', [
    { agentId: marina, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: true },
    { agentId: rafael, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: false },
    { agentId: tereza, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: false },
  ], { coordinatorAgentId: marina })

  await aplicar(planoDeAtualizacao(setor._id, { memberAgentKeys: ['marina', 'rafael'], coordinatorAgentKey: 'marina' }))

  const depois = await getSectorById(DONO, setor._id)
  assert.deepEqual(depois.members.map((m) => m.agentId.toString()).sort(), [marina.toString(), rafael.toString()].sort())
  assert.equal(depois.members.some((m) => m.agentId.toString() === tereza.toString()), false, 'a Tereza saiu de verdade')
})

test('MOVER de andar BLOQUEIA com impacto quando a equipe ficaria para trás', async () => {
  // Todo membro de um setor trabalha no andar dele, e mover agente entre andares não
  // existe na API canônica. Mover o setor sozinho produziria um setor inválido — então a
  // aplicação para e diz exatamente quem precisaria mudar antes.
  const setor = await createSector(DONO, andar, 'Recepção', '#6366f1', 'organization', [
    { agentId: marina, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: true },
  ], {})

  const bp = planoDeAtualizacao(setor._id, { mode: 'organization', memberAgentKeys: ['marina'], coordinatorAgentKey: null, floorKey: 'financeiro' })
  bp.floors.push({ key: 'financeiro', action: 'reuse', resourceId: outroAndar.toString(), name: 'Financeiro', workMode: 'organization' })
  bp.agents = bp.agents.map((a) => (a.key === 'marina' ? { ...a, floorKey: 'financeiro' } : a))

  // Um passo que falha para a saga inteira: a operação é marcada como falha e a mensagem
  // sobe. É o comportamento da aplicação, e é ele que a retomada usa depois.
  await assert.rejects(() => aplicar(bp), /Marina/, 'a mensagem precisa dizer quem teria de ir junto')

  // E o setor continua onde estava: bloquear é diferente de deixar pela metade.
  const depois = await getSectorById(DONO, setor._id)
  assert.equal(depois.officeId.toString(), andar.toString())
})

test('MOVER de andar acontece quando a equipe JÁ está lá', async () => {
  const outroAgente = new ObjectId()
  await db.collection('agents').insertOne({ _id: outroAgente, ownerId: DONO, officeId: outroAndar, name: 'Helena', role: 'Cobra', provider: 'anthropic', createdAt: new Date() })

  const setor = await createSector(DONO, andar, 'Recepção', '#6366f1', 'organization', [
    { agentId: marina, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: true },
  ], {})

  const bp = planoDeAtualizacao(setor._id, { mode: 'organization', memberAgentKeys: ['helena'], coordinatorAgentKey: null, floorKey: 'financeiro' })
  bp.floors.push({ key: 'financeiro', action: 'reuse', resourceId: outroAndar.toString(), name: 'Financeiro', workMode: 'organization' })
  bp.agents = [{ key: 'helena', action: 'reuse', resourceId: outroAgente.toString(), floorKey: 'financeiro', name: 'Helena' }]
  await aplicar(bp)

  const depois = await getSectorById(DONO, setor._id)
  assert.equal(depois.officeId.toString(), outroAndar.toString())
  assert.deepEqual(depois.members.map((m) => m.agentId.toString()), [outroAgente.toString()])
})

test('um pipeline atualizado recebe as etapas com a MESMA forma de quando é criado', async () => {
  const setor = await createSector(DONO, andar, 'Linha', '#6366f1', 'pipeline', [], {
    stages: [
      { id: 'e1', name: 'Etapa 1', agentId: marina, instruction: 'faz', dependsOn: [], inputMapping: {}, expectedOutput: '', retryPolicy: { maxAttempts: 1, backoffMs: 0 }, onError: 'stop' },
    ],
  })

  const bp = planoDeAtualizacao(setor._id, {
    mode: 'pipeline',
    memberAgentKeys: [],
    coordinatorAgentKey: null,
    stages: [
      { key: 'e1', agentKey: 'marina', instruction: 'primeiro', outputContract: 'o rascunho' },
      { key: 'e2', agentKey: 'rafael', instruction: 'depois', dependsOn: ['e1'], outputContract: 'o texto final' },
    ],
  })
  await aplicar(bp)

  const depois = await getSectorById(DONO, setor._id)
  assert.equal(depois.stages.length, 2, 'a etapa nova precisa existir')
  const segunda = depois.stages[1]
  assert.equal(segunda.agentId.toString(), rafael.toString())
  assert.deepEqual(segunda.dependsOn, ['e1'])
  assert.equal(segunda.expectedOutput, 'o texto final')
  // A política de erro é a mesma da criação: um pipeline atualizado não pode ter
  // comportamento diferente de um recém-criado.
  assert.deepEqual(segunda.retryPolicy, { maxAttempts: 1, backoffMs: 0 })
  assert.equal(segunda.onError, 'stop')
})

test('uma key de agente que não existe é recusada ANTES de aplicar — não vira equipe menor', async () => {
  const setor = await createSector(DONO, andar, 'Recepção', '#6366f1', 'orchestrated', [
    { agentId: marina, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: true },
    { agentId: rafael, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: false },
  ], { coordinatorAgentId: marina })

  const bp = planoDeAtualizacao(setor._id, { memberAgentKeys: ['marina', 'rafael', 'fantasma'], coordinatorAgentKey: 'marina' })
  // A recusa acontece na validação, que é mais cedo e melhor: nada chega a ser escrito.
  await assert.rejects(() => aplicar(bp), /não está válida/)

  const depois = await getSectorById(DONO, setor._id)
  assert.deepEqual(depois.members.map((m) => m.agentId.toString()).sort(), [marina.toString(), rafael.toString()].sort())
})

test('AMEAÇA: o setor de outra conta não é alcançado — a posse é conferida na validação', async () => {
  const setor = await createSector('vizinho', andar, 'Alheio', '#6366f1', 'organization', [], {})
  const bp = planoDeAtualizacao(setor._id, { mode: 'organization', memberAgentKeys: ['marina'], coordinatorAgentKey: null })

  // A posse é lida do banco imediatamente antes de aplicar: um id que não é desta conta
  // não está no contexto de posse, e a proposta inteira é recusada.
  await assert.rejects(() => aplicar(bp), /não está válida/)

  // E o setor do vizinho continua exatamente como estava.
  const alheio = await getSectorById('vizinho', setor._id)
  assert.equal(alheio.name, 'Alheio')
  assert.deepEqual(alheio.members, [])
})

// --- CENÁRIO E: a prévia e a estrutura aplicada coincidem -------------------------------------
//
// A prévia é o que a pessoa lê antes de clicar. Se ela descreve uma equipe de três e a
// aplicação monta uma de dois, a aprovação foi dada sobre uma coisa que não aconteceu — e
// ninguém descobre, porque quem aprova não volta para conferir.

const { buildPreview } = await import('../dist/architect/preview.js')
const { loadOwnershipContext } = await import('../dist/architect/context.js')

test('CENÁRIO E: o que a prévia descreve é o que a aplicação monta', async () => {
  const setor = await createSector(
    DONO,
    andar,
    'Recepção',
    '#6366f1',
    'orchestrated',
    [{ agentId: marina, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: true }],
    { coordinatorAgentId: marina },
  )
  const plano = planoDeAtualizacao(setor._id)

  const previa = buildPreview(plano, await loadOwnershipContext(DONO))
  const noPlano = previa.items.find((i) => i.kind === 'sector')
  assert.ok(noPlano, `a prévia não descreveu o setor: ${JSON.stringify(previa.items.map((i) => i.kind))}`)
  assert.equal(noPlano.action, 'update')

  await aplicar(plano)

  const depois = await getSectorById(DONO, setor._id)
  const doPlano = plano.sectors.find((s) => s.key === noPlano.key)

  // Os três eixos que a prévia mostra e que o Flow desenha: modo, coordenador e equipe.
  assert.equal(depois.mode, doPlano.mode, 'o modo aplicado tem que ser o que a prévia mostrou')
  const equipeAplicada = depois.members.map((m) => m.agentId.toString()).sort()
  const equipeDoPlano = doPlano.memberAgentKeys.map((k) => plano.agents.find((a) => a.key === k)?.resourceId).sort()
  assert.deepEqual(equipeAplicada, equipeDoPlano, 'a equipe aplicada difere da que foi aprovada')
  assert.equal(
    depois.coordinatorAgentId?.toString(),
    plano.agents.find((a) => a.key === doPlano.coordinatorAgentKey)?.resourceId,
    'o coordenador aplicado difere do que foi aprovado',
  )
})

test('CENÁRIO E: os três modos aparecem DISTINTOS na prévia, em português', async () => {
  const ctx = await loadOwnershipContext(DONO)
  const detalhes = new Map()

  for (const modo of ['organization', 'orchestrated', 'pipeline']) {
    const plano = { ...planoDeAtualizacao(new ObjectId()), title: modo }
    plano.sectors = [{ ...plano.sectors[0], mode: modo, action: 'create' }]
    delete plano.sectors[0].resourceId
    if (modo !== 'orchestrated') delete plano.sectors[0].coordinatorAgentKey
    if (modo === 'pipeline') {
      plano.sectors[0].stages = [
        { key: 'e1', agentKey: 'marina', expectedOutput: 'o resumo' },
        { key: 'e2', agentKey: 'rafael', dependsOn: ['e1'], expectedOutput: 'a resposta' },
      ]
    }
    const item = buildPreview(plano, ctx).items.find((i) => i.kind === 'sector')
    detalhes.set(modo, item.detail)
  }

  // Três frases diferentes: dois modos com o mesmo texto deixam a pessoa aprovar o errado.
  assert.equal(new Set(detalhes.values()).size, 3, JSON.stringify([...detalhes]))
  // E nenhuma delas mostra o valor do enum: "Setor no modo parallel" não é uma frase.
  for (const [modo, texto] of detalhes) {
    assert.equal(texto.includes(modo), false, `o enum "${modo}" vazou para a tela: ${texto}`)
  }
  // O que só agrupa precisa DIZER que não executa: é a diferença que mais engana.
  assert.match(detalhes.get('organization').toLowerCase(), /não executa/)
  assert.match(detalhes.get('pipeline').toLowerCase(), /etapa/)
})
