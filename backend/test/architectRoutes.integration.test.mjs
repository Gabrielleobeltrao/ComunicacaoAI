// AS ROTAS do Arquiteto, com o Express de verdade e o dublê no lugar do modelo.
//
// O que precisa ser exercitado aqui é a fronteira: nada sai de uma conta para outra,
// nenhuma rota cria recurso antes da confirmação, e uma recusa do provedor vira um
// código estável em vez de um 500.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.LLM_FAKE = '1'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const { architectRouter } = await import('../dist/routes/architectRoutes.js')
const { ensureArchitectIndexes } = await import('../dist/architect/repository.js')
const { ensureTokenUsageIndexes, getMonthlyTokens } = await import('../dist/tokenUsage.js')
const { setProviderApiKey, setMonthlyTokenCap } = await import('../dist/userSettings.js')
const { resetGuards } = await import('../dist/architect/guard.js')
const express = (await import('express')).default

const DONO = 'dono-arquiteto'
const VIZINHO = 'vizinho-arquiteto'
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
  await ensureArchitectIndexes()
  await ensureTokenUsageIndexes()

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
  for (const c of ['architect_projects', 'architect_messages', 'architect_apply_operations', 'token_usage', 'token_usage_charges', 'user_settings', 'agents', 'sectors', 'offices', 'buildings', 'app_installations'])
    await db.collection(c).deleteMany({})
  resetGuards()
  sessao = DONO
  await setProviderApiKey(DONO, 'anthropic', 'chave-de-teste')
  await setProviderApiKey(VIZINHO, 'anthropic', 'chave-de-teste')
})

const criar = async (objetivo = 'Quero automatizar o atendimento do meu restaurante') => {
  const r = await pedir('POST', '/projects', { objective: objetivo })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  return r.body
}

// --- fronteira da conta -------------------------------------------------------------------

test('o projeto de outra conta não existe: 404, e não 403', async () => {
  const meu = await criar()
  sessao = VIZINHO
  for (const [metodo, caminho, corpo] of [
    ['GET', `/projects/${meu.id}`],
    ['PATCH', `/projects/${meu.id}`, { title: 'sequestrado' }],
    ['GET', `/projects/${meu.id}/messages`],
    ['POST', `/projects/${meu.id}/messages`, { content: 'oi' }],
    ['POST', `/projects/${meu.id}/generate`],
    ['POST', `/projects/${meu.id}/validate`],
    ['GET', `/projects/${meu.id}/preview`],
    ['POST', `/projects/${meu.id}/archive`],
  ]) {
    const r = await pedir(metodo, caminho, corpo)
    assert.equal(r.status, 404, `${metodo} ${caminho} devolveu ${r.status}`)
  }
})

test('a listagem só mostra os projetos de quem pediu', async () => {
  await criar('projeto do dono')
  sessao = VIZINHO
  await criar('projeto do vizinho')
  const r = await pedir('GET', '/projects')
  assert.equal(r.body.length, 1)
  assert.equal(r.body[0].objective, 'projeto do vizinho')
})

test('um id malformado é 404, e não uma exceção', async () => {
  assert.equal((await pedir('GET', '/projects/nao-e-um-id')).status, 404)
})

// --- criação -----------------------------------------------------------------------------------

test('criar um projeto não cria recurso nenhum no escritório', async () => {
  await criar()
  assert.equal(await db.collection('offices').countDocuments({}), 0)
  assert.equal(await db.collection('agents').countDocuments({}), 0)
  assert.equal(await db.collection('sectors').countDocuments({}), 0)
})

test('sem objetivo não há projeto', async () => {
  const r = await pedir('POST', '/projects', { objective: '   ' })
  assert.equal(r.status, 400)
})

test('a descrição já entra como a primeira mensagem da conversa', async () => {
  const p = await criar('quero atender melhor')
  const r = await pedir('GET', `/projects/${p.id}/messages`)
  assert.equal(r.body.length, 1)
  assert.equal(r.body[0].role, 'user')
  assert.equal(r.body[0].content, 'quero atender melhor')
})

test('credencial colada na descrição não fica guardada', async () => {
  const p = await criar('conecte com sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789')
  assert.ok(!p.objective.includes('sk-ant-api03'))
  const msgs = await pedir('GET', `/projects/${p.id}/messages`)
  assert.ok(!JSON.stringify(msgs.body).includes('sk-ant-api03'))
})

// --- conversa -------------------------------------------------------------------------------------

test('a conversa pergunta primeiro e só depois propõe', async () => {
  const p = await criar()

  const primeira = await pedir('POST', `/projects/${p.id}/messages`, { content: 'quero automatizar o atendimento' })
  assert.equal(primeira.status, 200, JSON.stringify(primeira.body))
  assert.equal(primeira.body.status, 'discovery')
  assert.equal(primeira.body.question.key, 'canais-de-atendimento')
  assert.equal(primeira.body.hasBlueprint, false, 'nada de proposta antes de perguntar')

  const segunda = await pedir('POST', `/projects/${p.id}/messages`, { content: 'pelo site' })
  assert.equal(segunda.status, 200)
  assert.equal(segunda.body.hasBlueprint, true)
  assert.equal(segunda.body.status, 'draft')
  assert.equal(segunda.body.blueprint.agents.length >= 2, true)
  // Nem agora nada foi criado.
  assert.equal(await db.collection('agents').countDocuments({}), 0)
})

test('a credencial colada no meio da conversa é removida e a pessoa é avisada', async () => {
  const p = await criar()
  const r = await pedir('POST', `/projects/${p.id}/messages`, { content: 'minha chave é ghp_abcdefghijklmnopqrstuvwxyz0123' })
  assert.equal(r.body.secretMasked, true)
  const msgs = await pedir('GET', `/projects/${p.id}/messages`)
  assert.ok(!JSON.stringify(msgs.body).includes('ghp_abcdefghij'))
  assert.ok(msgs.body.some((m) => m.role === 'system_notice' && /credencial/i.test(m.content)))
})

test('sem chave de provedor, a resposta diz o que fazer — e não é 500', async () => {
  await db.collection('user_settings').deleteMany({})
  const p = await pedir('POST', '/projects', { objective: 'algo' })
  const r = await pedir('POST', `/projects/${p.body.id}/messages`, { content: 'oi' })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'no_provider_key')
  assert.match(r.body.message, /Configurações/)
})

test('limite mensal atingido devolve 429 com código próprio', async () => {
  const p = await criar()
  await setMonthlyTokenCap(DONO, 1)
  const { recordReplyUsage } = await import('../dist/tokenUsage.js')
  await recordReplyUsage(DONO, { inputTokens: 10, outputTokens: 0 })
  const antes = await getMonthlyTokens(DONO)

  const r = await pedir('POST', `/projects/${p.id}/messages`, { content: 'oi' })
  assert.equal(r.status, 429)
  assert.equal(r.body.code, 'budget_exceeded')
  assert.equal(await getMonthlyTokens(DONO), antes)
})

test('o ritmo por conta segura o laço acidental', async () => {
  const p = await criar()
  let bloqueou = false
  for (let i = 0; i < 14; i++) {
    const r = await pedir('POST', `/projects/${p.id}/messages`, { content: `mensagem ${i}` })
    if (r.status === 400 && /pouco tempo/.test(r.body.message ?? '')) {
      bloqueou = true
      break
    }
  }
  assert.equal(bloqueou, true)
})

// --- validação e prévia -------------------------------------------------------------------------------

test('validar não escreve recurso, e promove o projeto para pronto', async () => {
  const p = await criar()
  await pedir('POST', `/projects/${p.id}/messages`, { content: 'quero automatizar' })
  await pedir('POST', `/projects/${p.id}/messages`, { content: 'pelo site' })

  const r = await pedir('POST', `/projects/${p.id}/validate`)
  assert.equal(r.status, 200)
  assert.equal(r.body.valid, true, JSON.stringify(r.body.issues))
  assert.equal((await pedir('GET', `/projects/${p.id}`)).body.status, 'ready')
  assert.equal(await db.collection('agents').countDocuments({}), 0)
})

test('a prévia diz o que vai ser criado e o que espera a pessoa', async () => {
  // O App proposto existe no catálogo (o validador recusa chave inventada) e ainda não
  // está conectado — que é o caso que a prévia precisa mostrar como pendência.
  const p = await criar()
  await pedir('POST', `/projects/${p.id}/messages`, { content: 'quero automatizar' })
  await pedir('POST', `/projects/${p.id}/messages`, { content: 'pelo site' })

  const r = await pedir('GET', `/projects/${p.id}/preview`)
  assert.equal(r.status, 200)
  assert.ok(r.body.blueprintHash)
  assert.ok(r.body.items.some((i) => i.kind === 'floor' && i.action === 'create'))
  assert.ok(r.body.items.some((i) => i.kind === 'agent' && i.action === 'create'))

  // O App não conectado espera a pessoa; o cardápio ausente também.
  const app = r.body.items.find((i) => i.kind === 'app')
  assert.equal(app.action, 'wait_user')
  const conhecimento = r.body.items.find((i) => i.kind === 'knowledge')
  assert.equal(conhecimento.action, 'wait_user')
  assert.match(conhecimento.detail, /Nada é inventado/)
})

test('a prévia do mesmo blueprint é idêntica, inclusive o hash', async () => {
  const p = await criar()
  await pedir('POST', `/projects/${p.id}/messages`, { content: 'quero automatizar' })
  await pedir('POST', `/projects/${p.id}/messages`, { content: 'pelo site' })
  const a = await pedir('GET', `/projects/${p.id}/preview`)
  const b = await pedir('GET', `/projects/${p.id}/preview`)
  assert.deepEqual(a.body, b.body)
})

test('sem proposta ainda, a prévia recusa com o motivo', async () => {
  const p = await criar()
  const r = await pedir('GET', `/projects/${p.id}/preview`)
  assert.equal(r.status, 404)
  assert.equal(r.body.code, 'no_blueprint')
})

// --- checklist -------------------------------------------------------------------------------------------

test('um item conferido pelo sistema não é marcado à mão', async () => {
  const p = await criar()
  await pedir('POST', `/projects/${p.id}/messages`, { content: 'quero automatizar' })
  const depois = await pedir('POST', `/projects/${p.id}/messages`, { content: 'pelo site' })

  const automatico = depois.body.checklist.find((i) => i.completionMode !== 'manual')
  const r = await pedir('PATCH', `/projects/${p.id}/checklist/${encodeURIComponent(automatico.id)}`, { done: true })
  assert.equal(r.status, 400)
  assert.match(r.body.message, /conferido pelo sistema/)

  const manual = depois.body.checklist.find((i) => i.completionMode === 'manual')
  const ok = await pedir('PATCH', `/projects/${p.id}/checklist/${encodeURIComponent(manual.id)}`, { done: true })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.checklist.find((i) => i.id === manual.id).status, 'done')
})

// --- edição e arquivamento ---------------------------------------------------------------------------------------

test('editar uma resposta anterior não apaga as outras', async () => {
  const p = await criar()
  await pedir('POST', `/projects/${p.id}/messages`, { content: 'quero automatizar' })
  await pedir('PATCH', `/projects/${p.id}`, { answers: { horarios: '11h às 23h' } })
  const r = await pedir('PATCH', `/projects/${p.id}`, { answers: { idiomas: 'português' } })
  assert.equal(r.body.answers.horarios, '11h às 23h')
  assert.equal(r.body.answers.idiomas, 'português')
})

test('arquivar não apaga o projeto nem o que ele criou', async () => {
  const p = await criar()
  const r = await pedir('POST', `/projects/${p.id}/archive`)
  assert.equal(r.status, 200)
  assert.equal(r.body.status, 'archived')
  assert.equal(await db.collection('architect_projects').countDocuments({}), 1)

  const listaPadrao = await pedir('GET', '/projects')
  assert.equal(listaPadrao.body.length, 0, 'sai da lista por padrão')
  const comArquivados = await pedir('GET', '/projects?includeArchived=true')
  assert.equal(comArquivados.body.length, 1)
})

test('projeto arquivado não aceita mais conversa', async () => {
  const p = await criar()
  await pedir('POST', `/projects/${p.id}/archive`)
  const r = await pedir('POST', `/projects/${p.id}/messages`, { content: 'oi' })
  assert.equal(r.status, 409)
  assert.equal(r.body.code, 'not_editable')
})

// --- o que a API devolve --------------------------------------------------------------------------------------------

test('a listagem não carrega conversa nem blueprint inteiro', async () => {
  const p = await criar()
  await pedir('POST', `/projects/${p.id}/messages`, { content: 'quero automatizar' })
  await pedir('POST', `/projects/${p.id}/messages`, { content: 'pelo site' })
  const r = await pedir('GET', '/projects')
  assert.equal('blueprint' in r.body[0], false)
  assert.equal('answers' in r.body[0], false)
  assert.equal(r.body[0].hasBlueprint, true)
})
