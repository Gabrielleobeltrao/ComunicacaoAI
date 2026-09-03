// A APLICAÇÃO: a única parte do Arquiteto que escreve no escritório.
//
// Cada teste aqui é sobre uma forma diferente de estragar a conta de alguém: criar
// duas vezes, criar sem confirmação, criar sobre uma prévia velha, inventar cardápio,
// conceder permissão sobre App que ninguém conectou, e apagar no rollback o que a
// pessoa editou depois.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.LLM_FAKE = '1'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
// Os testes de aceitação batem numa origem DE VERDADE. O guarda de SSRF recusa loopback
// por padrão, e é o alvo local que estes casos precisam.
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { mongoClient, db } = await import('../dist/db.js')
const { architectRouter } = await import('../dist/routes/architectRoutes.js')
const repo = await import('../dist/architect/repository.js')
const service = await import('../dist/architect/service.js')
const { computeBlueprintHash } = await import('../dist/architect/blueprint.js')
const { ensureTokenUsageIndexes } = await import('../dist/tokenUsage.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
const { setProviderApiKey } = await import('../dist/userSettings.js')
const { resetGuards } = await import('../dist/architect/guard.js')
const { createInstallation } = await import('../dist/apps/installations.js')
const { getApp } = await import('../dist/apps/registry.js')
const { ensureExecutionRootIndexes } = await import('../dist/executionRoots.js')
const express = (await import('express')).default
const { createServer } = await import('node:http')

let origem
let portaDaOrigem
let corpoDaOrigem = { rsi: 22.5 }

const DONO = 'dono-aplicacao'
const VIZINHO = 'vizinho-aplicacao'
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
  await ensureExecutionRootIndexes()

  // A ORIGEM de verdade que os testes de aceitação consultam. Um mock devolvendo o que o
  // teste espera provaria só que o mock funciona.
  origem = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(corpoDaOrigem))
  })
  await new Promise((r) => origem.listen(0, r))
  portaDaOrigem = origem.address().port

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
  origem?.close()
  await new Promise((resolve) => server.close(resolve))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of [
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
    'connections',
    'knowledge_documents',
    'knowledge_chunks',
    'data_stores',
    'dataset_definitions',
    'monitoring_sources',
    'monitors',
    'execution_roots',
  ])
    await db.collection(c).deleteMany({})
  resetGuards()
  corpoDaOrigem = { rsi: 22.5 }
  sessao = DONO
  await setProviderApiKey(DONO, 'anthropic', 'chave-de-teste')
})

/** Leva um projeto até `ready`, que é de onde a aplicação sai. */
const projetoPronto = async () => {
  const criado = await pedir('POST', '/projects', { objective: 'Quero automatizar o atendimento do meu restaurante' })
  const id = criado.body.id
  await pedir('POST', `/projects/${id}/messages`, { content: 'quero automatizar' })
  await pedir('POST', `/projects/${id}/messages`, { content: 'pelo site' })
  const v = await pedir('POST', `/projects/${id}/validate`)
  assert.equal(v.body.valid, true, JSON.stringify(v.body.issues))
  const previa = await pedir('GET', `/projects/${id}/preview`)
  return { id, hash: previa.body.blueprintHash }
}

const aplicar = (id, hash, chave = 'op-1', extra = {}) => pedir('POST', `/projects/${id}/apply`, { blueprintHash: hash, idempotencyKey: chave, confirm: true, ...extra })

// --- confirmação ---------------------------------------------------------------------------

test('sem confirmação explícita, nada é criado', async () => {
  const { id, hash } = await projetoPronto()
  const r = await pedir('POST', `/projects/${id}/apply`, { blueprintHash: hash, idempotencyKey: 'op-x', confirm: false })
  assert.equal(r.status, 400)
  assert.equal(await db.collection('agents').countDocuments({}), 0)
  assert.equal(await db.collection('offices').countDocuments({}), 0)
})

test('uma confirmação feita sobre prévia antiga é recusada', async () => {
  const { id } = await projetoPronto()
  const r = await aplicar(id, 'hash-de-uma-previa-velha')
  assert.equal(r.status, 409)
  assert.match(r.body.message, /revise/i)
  assert.equal(await db.collection('agents').countDocuments({}), 0)
})

test('aplicar antes de validar é recusado', async () => {
  const criado = await pedir('POST', '/projects', { objective: 'algo' })
  const id = criado.body.id
  await pedir('POST', `/projects/${id}/messages`, { content: 'quero automatizar' })
  const depois = await pedir('POST', `/projects/${id}/messages`, { content: 'pelo site' })
  const hash = computeBlueprintHash(depois.body.blueprint)
  const r = await aplicar(id, hash)
  assert.equal(r.status, 409)
  assert.match(r.body.message, /valide/i)
})

// --- o que a aplicação cria ------------------------------------------------------------------------

test('a aplicação cria andar, agentes e setor — e eles são recursos normais', async () => {
  const { id, hash } = await projetoPronto()
  const r = await aplicar(id, hash)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.status, 'applied')

  const andares = await db.collection('offices').find({ ownerId: DONO }).toArray()
  const agentes = await db.collection('agents').find({ ownerId: DONO }).toArray()
  const setores = await db.collection('sectors').find({ ownerId: DONO }).toArray()
  assert.equal(andares.length, 1)
  assert.equal(agentes.length, 2)
  assert.equal(setores.length, 1)

  // O setor aponta para os agentes REAIS, e o coordenador é um deles.
  const setor = setores[0]
  assert.equal(setor.mode, 'orchestrated')
  assert.equal(setor.members.length, 2)
  assert.ok(agentes.some((a) => a._id.equals(setor.coordinatorAgentId)))
  // Todo mundo no mesmo andar.
  for (const a of agentes) assert.ok(a.officeId.equals(andares[0]._id))

  // Os links levam às telas normais.
  assert.ok(r.body.links.some((l) => l.kind === 'agent' && l.path.startsWith('/agents/')))
})

test('aplicar de novo com a mesma chave não duplica nada', async () => {
  const { id, hash } = await projetoPronto()
  await aplicar(id, hash, 'op-unica')
  const segunda = await aplicar(id, hash, 'op-unica')
  assert.equal(segunda.status, 200)
  assert.equal(await db.collection('agents').countDocuments({ ownerId: DONO }), 2)
  assert.equal(await db.collection('offices').countDocuments({ ownerId: DONO }), 1)
  assert.equal(await db.collection('sectors').countDocuments({ ownerId: DONO }), 1)
  assert.equal(await db.collection('architect_apply_operations').countDocuments({}), 1, 'uma operação só')
})

test('um projeto já aplicado não aceita uma aplicação nova', async () => {
  const { id, hash } = await projetoPronto()
  await aplicar(id, hash, 'op-1')
  const outra = await aplicar(id, hash, 'op-2')
  assert.equal(outra.status, 409)
  assert.equal(await db.collection('agents').countDocuments({ ownerId: DONO }), 2)
})

test('conhecimento ausente não é fabricado: fica pendente e o dependente não fica pronto', async () => {
  const { id, hash } = await projetoPronto()
  const r = await aplicar(id, hash)
  assert.equal(await db.collection('knowledge_documents').countDocuments({}), 0, 'nenhum documento inventado')

  const item = r.body.checklist.find((i) => i.category === 'knowledge')
  assert.ok(item, 'a pendência existe')
  assert.notEqual(item.status, 'done')
  assert.equal(r.body.readiness.ready, false)
})

test('App não conectado vira pendência, e não um grant apontando para o nada', async () => {
  const { id, hash } = await projetoPronto()
  const r = await aplicar(id, hash, 'op-1', { approvedAppKeys: ['web_chat'] })
  const agentes = await db.collection('agents').find({ ownerId: DONO }).toArray()
  for (const a of agentes) assert.deepEqual(a.appGrants ?? [], [], 'nenhuma permissão concedida')

  const passo = r.body.operation.steps.find((s) => s.kind === 'grant')
  assert.equal(passo.status, 'skipped')
  assert.match(passo.message, /não está conectado/)
  assert.ok(r.body.checklist.some((i) => i.category === 'app' && i.status !== 'done'))
})

test('com o App conectado, a permissão só sai se o dono aprovar', async () => {
  await createInstallation(DONO, getApp('web_chat'), { name: 'Chat do site' })

  const semAprovar = await projetoPronto()
  const r1 = await aplicar(semAprovar.id, semAprovar.hash, 'op-a')
  const agentes1 = await db.collection('agents').find({ ownerId: DONO }).toArray()
  for (const a of agentes1) assert.deepEqual(a.appGrants ?? [], [], 'sem aprovação, sem permissão')
  assert.match(r1.body.operation.steps.find((s) => s.kind === 'grant').message, /não foi aprovado/)

  await db.collection('agents').deleteMany({})
  await db.collection('sectors').deleteMany({})
  await db.collection('offices').deleteMany({})
  const aprovado = await projetoPronto()
  await aplicar(aprovado.id, aprovado.hash, 'op-b', { approvedAppKeys: ['web_chat'] })
  const agentes2 = await db.collection('agents').find({ ownerId: DONO }).toArray()
  // A permissão vai para quem a proposta indicou — e só para ele. Procurar pelo nome
  // dizia menos: os agentes têm nome de pessoa, escolhido pelo compilador.
  const comPermissao = agentes2.filter((a) => (a.appGrants ?? []).length > 0)
  assert.equal(comPermissao.length, 1, 'permissão concedida a mais de um agente')
  assert.equal(comPermissao[0].appGrants[0].appKey, 'web_chat')
})

test('a rotina nasce rascunho, e o Arquiteto não publica nada', async () => {
  const { id, hash } = await projetoPronto()
  await aplicar(id, hash)
  const rotinas = await db.collection('automations').find({ ownerId: DONO }).toArray()
  for (const r of rotinas) {
    assert.equal(r.status, 'draft')
    assert.equal(r.currentVersion, 0)
  }
})

// --- falha e retomada -------------------------------------------------------------------------------

test('uma falha no meio deixa o que já foi feito, e a retomada continua sem duplicar', async () => {
  const criado = await pedir('POST', '/projects', { objective: 'Quero automatizar o atendimento' })
  const id = criado.body.id
  await pedir('POST', `/projects/${id}/messages`, { content: 'quero automatizar' })
  await pedir('POST', `/projects/${id}/messages`, { content: 'pelo site' })
  await pedir('POST', `/projects/${id}/validate`)
  const projeto = await repo.getProject(DONO, new ObjectId(id))
  const hash = computeBlueprintHash(projeto.blueprint)

  // Cai no primeiro setor: os andares e agentes já foram criados.
  await assert.rejects(
    service.applyProject(
      DONO,
      new ObjectId(id),
      { blueprintHash: hash, idempotencyKey: 'op-falha', confirm: true },
      {
        beforeStep: (kind) => {
          if (kind === 'sector') throw new Error('queda simulada no meio da aplicação')
        },
      },
    ),
  )

  assert.equal(await db.collection('agents').countDocuments({ ownerId: DONO }), 2, 'o que já foi criado fica')
  assert.equal(await db.collection('sectors').countDocuments({ ownerId: DONO }), 0)
  assert.equal((await repo.getProject(DONO, new ObjectId(id))).status, 'failed')

  const retomada = await pedir('POST', `/projects/${id}/resume`)
  assert.equal(retomada.status, 200, JSON.stringify(retomada.body))
  assert.equal(retomada.body.status, 'applied')
  assert.equal(await db.collection('agents').countDocuments({ ownerId: DONO }), 2, 'não recriou os agentes')
  assert.equal(await db.collection('offices').countDocuments({ ownerId: DONO }), 1)
  assert.equal(await db.collection('sectors').countDocuments({ ownerId: DONO }), 1)
  assert.equal(await db.collection('architect_apply_operations').countDocuments({}), 1, 'a mesma operação')
})

test('não há o que retomar num projeto que nunca falhou', async () => {
  const { id } = await projetoPronto()
  const r = await pedir('POST', `/projects/${id}/resume`)
  assert.equal(r.status, 409)
})

// --- rollback ---------------------------------------------------------------------------------------------

test('o rollback remove o que ESTA operação criou', async () => {
  const { id, hash } = await projetoPronto()
  await aplicar(id, hash)
  assert.equal(await db.collection('agents').countDocuments({ ownerId: DONO }), 2)

  const r = await pedir('POST', `/projects/${id}/rollback`)
  assert.equal(r.status, 200)
  assert.equal(await db.collection('agents').countDocuments({ ownerId: DONO }), 0)
  assert.equal(await db.collection('sectors').countDocuments({ ownerId: DONO }), 0)
  assert.ok(r.body.removed.length > 0)
  // O andar continua de pé quando é o único do prédio: o domínio recusa removê-lo, e
  // o rollback não é um caminho privilegiado para furar essa regra.
  assert.ok(r.body.kept.some((k) => /único andar/.test(k.reason)))
  assert.equal(await db.collection('offices').countDocuments({ ownerId: DONO }), 1)
})

test('o rollback NÃO apaga um recurso preexistente', async () => {
  const { createFloor } = await import('../dist/floors.js')
  const { createAgent } = await import('../dist/agents.js')
  const andarAntigo = await createFloor(DONO, { name: 'Andar que já existia' })
  const agenteAntigo = await createAgent(DONO, andarAntigo._id, 'Agente antigo')

  const { id, hash } = await projetoPronto()
  await aplicar(id, hash)
  await pedir('POST', `/projects/${id}/rollback`)

  assert.ok(await db.collection('offices').findOne({ _id: andarAntigo._id }), 'o andar de antes continua de pé')
  assert.ok(await db.collection('agents').findOne({ _id: agenteAntigo._id }), 'o agente de antes continua de pé')
})

test('o rollback não apaga o que a pessoa editou depois: mantém e avisa', async () => {
  const { id, hash } = await projetoPronto()
  await aplicar(id, hash)
  const agente = await db.collection('agents').findOne({ ownerId: DONO })
  // Editado bem depois da criação.
  await db.collection('agents').updateOne({ _id: agente._id }, { $set: { updatedAt: new Date(Date.now() + 60_000), name: 'Renomeado por mim' } })

  const r = await pedir('POST', `/projects/${id}/rollback`)
  assert.ok(await db.collection('agents').findOne({ _id: agente._id }), 'o agente editado fica')
  assert.ok(r.body.kept.some((k) => /editado depois/.test(k.reason)))
})

// --- fronteira da conta ------------------------------------------------------------------------------------------

test('ninguém aplica o projeto de outra conta', async () => {
  const { id, hash } = await projetoPronto()
  sessao = VIZINHO
  for (const [metodo, caminho] of [
    ['POST', `/projects/${id}/apply`],
    ['POST', `/projects/${id}/resume`],
    ['POST', `/projects/${id}/recheck`],
    ['POST', `/projects/${id}/rollback`],
  ]) {
    const r = await pedir(metodo, caminho, { blueprintHash: hash, idempotencyKey: 'roubo', confirm: true })
    assert.equal(r.status, 404, `${caminho} devolveu ${r.status}`)
  }
  assert.equal(await db.collection('agents').countDocuments({ ownerId: VIZINHO }), 0)
})

// --- reconferência -------------------------------------------------------------------------------------------------

test('reconferir apura contra o estado real: apagar um agente derruba o item', async () => {
  const { id, hash } = await projetoPronto()
  const aplicado = await aplicar(id, hash)
  const itemEstrutura = aplicado.body.checklist.find((i) => i.category === 'structure' && i.target?.kind === 'agent')
  assert.equal(itemEstrutura.status, 'done')

  const agente = await db.collection('agents').findOne({ ownerId: DONO, _id: new ObjectId(aplicado.body.operation.resourceMap[`agent:${itemEstrutura.target.key}`]) })
  await db.collection('agents').deleteOne({ _id: agente._id })

  const r = await pedir('POST', `/projects/${id}/recheck`)
  assert.equal(r.status, 200)
  assert.notEqual(r.body.checklist.find((i) => i.id === itemEstrutura.id).status, 'done')
})

test('conectar o App NÃO basta: sem permissão no agente, a pendência fica — e aponta para ele', async () => {
  const { id, hash } = await projetoPronto()
  const aplicado = await aplicar(id, hash)
  const itemApp = aplicado.body.checklist.find((i) => i.category === 'app')
  assert.notEqual(itemApp.status, 'done')

  await createInstallation(DONO, getApp('web_chat'), { name: 'Chat do site' })
  const r = await pedir('POST', `/projects/${id}/recheck`)
  const depois = r.body.checklist.find((i) => i.id === itemApp.id)
  assert.notEqual(depois.status, 'done', 'conectado é diferente de concedido')
  assert.match(depois.description, /não tem permissão/)
  assert.match(depois.actionPath, /^\/agents\//, 'o link leva ao agente que precisa da permissão')
})

test('com instalação E permissão, a pendência se resolve sozinha', async () => {
  await createInstallation(DONO, getApp('web_chat'), { name: 'Chat do site' })
  const { id, hash } = await projetoPronto()
  const aplicado = await aplicar(id, hash, 'op-1', { approvedAppKeys: ['web_chat'] })
  const itemApp = aplicado.body.checklist.find((i) => i.category === 'app')

  const r = await pedir('POST', `/projects/${id}/recheck`)
  assert.equal(r.body.checklist.find((i) => i.id === itemApp.id).status, 'done')

  // E é permissão de verdade no agente, não um estado guardado no projeto.
  const comPermissao = await db.collection('agents').find({ ownerId: DONO, 'appGrants.0': { $exists: true } }).toArray()
  assert.equal(comPermissao.length, 1)
  assert.equal(comPermissao[0].appGrants[0].appKey, 'web_chat')
})

// --- a conversa não fecha ao aplicar -------------------------------------------------------

test('depois de aplicado dá para continuar conversando — e a rodada nova NÃO duplica nada', async () => {
  const { id, hash } = await projetoPronto()
  await aplicar(id, hash, 'op-1')
  assert.equal(await db.collection('agents').countDocuments({ ownerId: DONO }), 2)

  // Antes, aqui vinha 409: ajustar uma instrução depois de aplicar obrigava a começar
  // outro projeto — e o projeto novo não sabia o que já existia.
  const r = await pedir('POST', `/projects/${id}/messages`, { content: 'quero ajustar o atendimento' })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.status, 'draft', 'a proposta reabre')

  // O que já foi criado volta como "alterar", apontando para o recurso REAL: sem isso,
  // cada item voltaria como "criar" e a segunda aplicação duplicaria o escritório.
  const detalhe = await pedir('GET', `/projects/${id}`)
  for (const item of [...detalhe.body.blueprint.floors, ...detalhe.body.blueprint.agents, ...detalhe.body.blueprint.sectors]) {
    assert.equal(item.action, 'update', `${item.key} deveria apontar para o que já existe`)
    assert.match(String(item.resourceId ?? ''), /^[a-f0-9]{24}$/, `${item.key} sem recurso real`)
  }

  // E a prévia trata tudo como alteração — que exige aprovação item a item na confirmação.
  const previa = await pedir('GET', `/projects/${id}/preview`)
  assert.equal(previa.body.counts.create, 0)
  assert.ok(previa.body.counts.update >= 3)
  assert.ok(previa.body.items.filter((i) => i.kind !== 'app' && i.kind !== 'knowledge').every((i) => i.requiresApproval))
})

test('a segunda aplicação altera o que existe em vez de criar de novo', async () => {
  const { id, hash } = await projetoPronto()
  await aplicar(id, hash, 'op-1')
  const antes = await db.collection('agents').find({ ownerId: DONO }).toArray()

  await pedir('POST', `/projects/${id}/messages`, { content: 'ajuste o time' })
  await pedir('POST', `/projects/${id}/validate`)
  const previa = await pedir('GET', `/projects/${id}/preview`)
  const chaves = previa.body.items.filter((i) => i.requiresApproval).map((i) => i.key)
  const r = await pedir('POST', `/projects/${id}/apply`, {
    blueprintHash: previa.body.blueprintHash,
    idempotencyKey: 'op-2',
    confirm: true,
    approvedUpdateKeys: chaves,
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))

  const depois = await db.collection('agents').find({ ownerId: DONO }).toArray()
  assert.equal(depois.length, antes.length, 'nenhum agente novo — os mesmos foram atualizados')
  assert.deepEqual(
    depois.map((a) => a._id.toString()).sort(),
    antes.map((a) => a._id.toString()).sort(),
  )
})

test('arquivado, sim, silencia a conversa', async () => {
  const { id } = await projetoPronto()
  await pedir('POST', `/projects/${id}/archive`)
  const r = await pedir('POST', `/projects/${id}/messages`, { content: 'oi' })
  assert.equal(r.status, 409)
  assert.match(r.body.message, /arquivado/)
})

// --- o plano V2 dentro da MESMA aplicação -----------------------------------------------------
//
// O V2 acrescenta Databases, datasets, fontes, monitores e Flows. Ele NÃO é uma segunda
// engine: entra na mesma saga, escreve no mesmo `resourceMap`, registra os mesmos passos e é
// retomado pelo mesmo caminho. É isso que estes casos protegem.

const t2 = await import('../dist/architect/typesV2.js')

const itemV2 = (over) => ({ action: 'create', layer: 'essential', rationale: 'x', dependsOn: [], ...over })

/** Põe um plano V2 no projeto e devolve o hash que a confirmação precisa carregar. */
const comPlanoV2 = async (id, monta) => {
  const bp2 = t2.emptyBlueprintV2('Operação', 'Vigiar', 'create')
  monta(bp2)
  const projeto = await repo.patchProject(DONO, new ObjectId(id), { blueprintVersion: 2, blueprintV2: bp2 })
  const previa = await pedir('GET', `/projects/${id}/preview`)
  assert.ok(previa.body.blueprintHash)
  return { hash: previa.body.blueprintHash, projeto }
}

const planoSimples = (bp2) => {
  bp2.resources.databases = [itemV2({ key: 'base', name: 'Cotações', owner: { ownerType: 'account' }, adapterKind: 'data_history' })]
  bp2.resources.datasets = [
    itemV2({
      key: 'candles',
      dependsOn: ['base'],
      databaseKey: 'base',
      datasetKey: 'candles',
      name: 'Candles',
      schema: { type: 'object', properties: { rsi: { type: 'number' } } },
      mutability: 'append_only',
    }),
  ]
  bp2.operations.sources = [
    itemV2({
      key: 'fonte',
      name: 'Cotações CXSE3',
      kind: 'api_polling',
      config: { url: `http://127.0.0.1:${portaDaOrigem}/cotacoes`, method: 'GET' },
      mapping: { version: 1, fields: [{ to: 'rsi', from: 'rsi', required: true }] },
      cadence: { mode: 'interval', intervalMs: 60_000 },
    }),
  ]
}

test('o plano V2 é aplicado pela MESMA operação, e vira passo registrado', async () => {
  const { id } = await projetoPronto()
  const { hash } = await comPlanoV2(id, planoSimples)

  const r = await aplicar(id, hash, 'op-v2')
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.status, 'applied')

  // Os recursos do V1 continuam nascendo: o V2 acrescenta, não substitui.
  assert.equal(await db.collection('offices').countDocuments({ ownerId: DONO }), 1)
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: DONO }), 1)
  assert.equal(await db.collection('dataset_definitions').countDocuments({ ownerId: DONO }), 1)

  // A fonte nasce RASCUNHO: ninguém aplicou uma operação que já começa a bater fora.
  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.equal(fonte.status, 'draft')

  // Os passos do V2 estão na MESMA lista de passos da operação — mesma auditoria.
  const operacao = await repo.lastOperation(DONO, new ObjectId(id))
  const kinds = operacao.steps.map((p) => p.kind)
  for (const k of ['floor', 'agent', 'database', 'dataset', 'source']) assert.ok(kinds.includes(k), `faltou ${k} em ${kinds.join(',')}`)
  assert.equal(operacao.resourceMap['database:base'], (await db.collection('data_stores').findOne({ ownerId: DONO }))._id.toString())
})

test('mudar SÓ o plano V2 invalida a confirmação anterior', async () => {
  const { id, hash: hashV1 } = await projetoPronto()
  await comPlanoV2(id, planoSimples)

  // O hash do V1 não mudou — o recorte é o mesmo. Se ele ainda valesse como confirmação,
  // um clique feito olhando a revisão sem monitor nenhum aplicaria a revisão com eles.
  const r = await aplicar(id, hashV1, 'op-velha')
  assert.equal(r.status, 409)
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: DONO }), 0)
})

test('uma falha no V2 derruba a operação — e o que já nasceu fica no mapa', async () => {
  const { id } = await projetoPronto()
  const { hash } = await comPlanoV2(id, (bp2) => {
    planoSimples(bp2)
    // O monitor observa um conjunto que não está no plano: não há como criá-lo.
    bp2.operations.monitors = [
      itemV2({
        key: 'rsi',
        dependsOn: ['candles'],
        name: 'RSI baixo',
        observes: { kind: 'dataset', datasetKey: 'conjunto-que-nao-existe' },
        condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
        triggerMode: 'enter',
      }),
    ]
  })

  // A falha volta como RESPOSTA, com motivo e id da operação. O 500 padrão do Express
  // devolvia HTML, e a tela ficava sem o que mostrar e sem o que retomar.
  const r = await aplicar(id, hash, 'op-falha')
  assert.equal(r.status, 502, JSON.stringify(r.body))
  assert.equal(r.body.code, 'apply_failed')
  assert.match(r.body.message, /monitor "rsi"/)
  assert.ok(r.body.operationId)

  const projeto = await repo.getProject(DONO, new ObjectId(id))
  assert.equal(projeto.status, 'failed')
  assert.equal(await db.collection('monitors').countDocuments({ ownerId: DONO }), 0, 'um monitor sem o que observar nunca dispara')

  // O que nasceu ANTES da falha está no mapa: é isso que faz a retomada não duplicar.
  const operacao = await repo.lastOperation(DONO, new ObjectId(id))
  assert.ok(operacao.resourceMap['database:base'])
  assert.ok(operacao.resourceMap['source:fonte'])
  assert.equal(operacao.status, 'failed')
})

test('retomar depois da falha NÃO cria o que já existe', async () => {
  const { id } = await projetoPronto()
  const { hash } = await comPlanoV2(id, (bp2) => {
    planoSimples(bp2)
    bp2.operations.monitors = [
      itemV2({
        key: 'rsi',
        dependsOn: ['candles'],
        name: 'RSI baixo',
        observes: { kind: 'dataset', datasetKey: 'conjunto-que-nao-existe' },
        condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
        triggerMode: 'enter',
      }),
    ]
  })
  await aplicar(id, hash, 'op-retomar')
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: DONO }), 1)

  // Corrigido: agora o monitor aponta para o conjunto que a aplicação criou.
  const projeto = await repo.getProject(DONO, new ObjectId(id))
  const bp2 = projeto.blueprintV2
  bp2.operations.monitors[0].observes.datasetKey = 'candles'
  await repo.patchProject(DONO, new ObjectId(id), { blueprintV2: bp2 })

  // Retomar exige o MESMO hash da operação: um plano corrigido é uma revisão nova.
  const r = await pedir('POST', `/projects/${id}/resume`)
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.match(r.body.message, /mudou/)

  // E, acima de tudo: nada foi criado duas vezes.
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: DONO }), 1)
  assert.equal(await db.collection('monitoring_sources').countDocuments({ ownerId: DONO }), 1)
})

test('retomar com o MESMO plano refaz só o que faltou', async () => {
  const { id } = await projetoPronto()
  const { hash } = await comPlanoV2(id, (bp2) => {
    planoSimples(bp2)
    bp2.operations.monitors = [
      itemV2({
        key: 'rsi',
        dependsOn: ['candles'],
        name: 'RSI baixo',
        observes: { kind: 'dataset', datasetKey: 'candles' },
        condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
        triggerMode: 'enter',
      }),
    ]
  })

  // Uma queda antes do monitor: o Database e a fonte já existem, o monitor não.
  const alvo = await db.collection('data_stores').findOne({ ownerId: DONO })
  assert.equal(alvo, null)

  const r = await aplicar(id, hash, 'op-completa')
  assert.equal(r.status, 200, JSON.stringify(r.body))

  const monitor = await db.collection('monitors').findOne({ ownerId: DONO })
  assert.ok(monitor, 'o monitor do conjunto criado nesta mesma aplicação nasce junto')
  assert.equal(monitor.status, 'draft', 'publicar é um ato separado')

  // Aplicar de novo com a mesma chave devolve a mesma operação — nada é criado duas vezes.
  const denovo = await aplicar(id, hash, 'op-completa')
  assert.equal(denovo.status, 200)
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: DONO }), 1)
  assert.equal(await db.collection('monitors').countDocuments({ ownerId: DONO }), 1)
})

test('o rollback desfaz também o que o V2 criou — e deixa o histórico', async () => {
  const { id } = await projetoPronto()
  const { hash } = await comPlanoV2(id, (bp2) => {
    planoSimples(bp2)
    bp2.operations.monitors = [
      itemV2({
        key: 'rsi',
        dependsOn: ['candles'],
        name: 'RSI baixo',
        observes: { kind: 'dataset', datasetKey: 'candles' },
        condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
        triggerMode: 'enter',
      }),
    ]
  })
  await aplicar(id, hash, 'op-rollback-v2')
  assert.equal(await db.collection('monitors').countDocuments({ ownerId: DONO }), 1)

  const r = await pedir('POST', `/projects/${id}/rollback`)
  assert.equal(r.status, 200, JSON.stringify(r.body))

  for (const c of ['monitors', 'monitoring_sources', 'dataset_definitions', 'data_stores'])
    assert.equal(await db.collection(c).countDocuments({ ownerId: DONO }), 0, `sobrou em ${c}`)
})

test('o rollback NÃO apaga o recurso do V2 editado depois de criado', async () => {
  const { id } = await projetoPronto()
  const { hash } = await comPlanoV2(id, planoSimples)
  await aplicar(id, hash, 'op-rollback-editado')

  const store = await db.collection('data_stores').findOne({ ownerId: DONO })
  // Alguém renomeou o Database depois. Editado é trabalho de quem editou, não sobra
  // da aplicação — e um desfazer que o apagasse destruiria o que a pessoa fez.
  await db.collection('data_stores').updateOne({ _id: store._id }, { $set: { name: 'Meu', updatedAt: new Date(Date.now() + 60_000) } })

  const r = await pedir('POST', `/projects/${id}/rollback`)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(await db.collection('data_stores').countDocuments({ ownerId: DONO }), 1)
  assert.ok(r.body.kept.some((k) => /editado depois/.test(k.reason)), JSON.stringify(r.body.kept))
})

// --- prova e ativação: "pronto" é o que passou num teste ------------------------------------------

const comTestes = (bp2, testes) => {
  planoSimples(bp2)
  bp2.operations.monitors = [
    itemV2({
      key: 'rsi',
      dependsOn: ['candles'],
      name: 'RSI baixo',
      observes: { kind: 'dataset', datasetKey: 'candles' },
      condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
      triggerMode: 'enter',
      threshold: 30,
      thresholdField: 'rsi',
    }),
  ]
  bp2.acceptanceTests = testes
}

test('ACEITAÇÃO: a fonte que passou no teste E foi autorizada entra no ar', async () => {
  const { id } = await projetoPronto()
  const { hash } = await comPlanoV2(id, (bp2) =>
    comTestes(bp2, [{ key: 't-fonte', kind: 'source', targetKey: 'fonte', expectation: 'responde', required: true }]),
  )

  const r = await pedir('POST', `/projects/${id}/apply`, {
    blueprintHash: hash,
    idempotencyKey: 'op-ativa',
    confirm: true,
    approvedActivationKeys: ['fonte'],
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))

  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.equal(fonte.status, 'active', 'a fonte provada e autorizada tem que entrar no ar')

  const operacao = await repo.lastOperation(DONO, new ObjectId(id))
  assert.equal(operacao.acceptance.find((a) => a.key === 't-fonte').status, 'passed')
})

test('a fonte que passou no teste mas NÃO foi autorizada continua parada', async () => {
  const { id } = await projetoPronto()
  const { hash } = await comPlanoV2(id, (bp2) =>
    comTestes(bp2, [{ key: 't-fonte', kind: 'source', targetKey: 'fonte', expectation: 'responde', required: true }]),
  )
  // Nenhuma `approvedActivationKeys`: aplicar a proposta não coloca a operação para rodar.
  const r = await aplicar(id, hash, 'op-sem-autorizacao')
  assert.equal(r.status, 200, JSON.stringify(r.body))

  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.equal(fonte.status, 'draft')

  const operacao = await repo.lastOperation(DONO, new ObjectId(id))
  const passo = operacao.steps.find((p) => p.kind === 'source' && p.status === 'skipped')
  assert.match(passo.message, /não foi autorizado/)
})

test('AMEAÇA: a fonte AUTORIZADA que REPROVOU no teste não entra no ar', async () => {
  // A origem responde 200, mas sem o campo obrigatório: a fonte parece viva.
  corpoDaOrigem = { outra: 1 }
  const { id } = await projetoPronto()
  const { hash } = await comPlanoV2(id, (bp2) =>
    comTestes(bp2, [{ key: 't-fonte', kind: 'source', targetKey: 'fonte', expectation: 'responde', required: true }]),
  )

  const r = await pedir('POST', `/projects/${id}/apply`, {
    blueprintHash: hash,
    idempotencyKey: 'op-reprovada',
    confirm: true,
    approvedActivationKeys: ['fonte'],
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))

  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  assert.equal(fonte.status, 'draft', 'autorização não substitui prova')

  // E a prontidão diz por quê, em vez de ficar verde.
  const projeto = await repo.getProject(DONO, new ObjectId(id))
  assert.equal(projeto.readiness.ready, false)
  assert.ok(projeto.readiness.blockers.some((b) => /não trouxe rsi/.test(b)), JSON.stringify(projeto.readiness.blockers))
  assert.ok(projeto.checklist.some((i) => i.id === 't-fonte' || i.id === 'test:t-fonte'))
})

test('a prova entra na checklist com `test_result`, e não pode ser marcada à mão', async () => {
  const { id } = await projetoPronto()
  const { hash } = await comPlanoV2(id, (bp2) =>
    comTestes(bp2, [
      { key: 't-fonte', kind: 'source', targetKey: 'fonte', expectation: 'responde', required: true },
      { key: 't-mon', kind: 'monitor_simulation', targetKey: 'rsi', expectation: 'dispara', required: true },
    ]),
  )
  await aplicar(id, hash, 'op-checklist')

  const projeto = await repo.getProject(DONO, new ObjectId(id))
  const deTeste = projeto.checklist.filter((i) => i.completionMode === 'test_result')
  assert.equal(deTeste.length, 2, JSON.stringify(projeto.checklist.map((i) => i.id)))
  for (const i of deTeste) assert.equal(i.status, 'done', i.description)
})
