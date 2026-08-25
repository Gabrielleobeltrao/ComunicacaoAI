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
const express = (await import('express')).default

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
  ])
    await db.collection(c).deleteMany({})
  resetGuards()
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
  const gerente = agentes2.find((a) => a.name.includes('Gerente'))
  assert.equal(gerente.appGrants.length, 1)
  assert.equal(gerente.appGrants[0].appKey, 'web_chat')
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

test('conectar o App depois resolve a pendência sozinho, sem ninguém marcar nada', async () => {
  const { id, hash } = await projetoPronto()
  const aplicado = await aplicar(id, hash)
  const itemApp = aplicado.body.checklist.find((i) => i.category === 'app')
  assert.notEqual(itemApp.status, 'done')

  await createInstallation(DONO, getApp('web_chat'), { name: 'Chat do site' })
  const r = await pedir('POST', `/projects/${id}/recheck`)
  assert.equal(r.body.checklist.find((i) => i.id === itemApp.id).status, 'done')
})
