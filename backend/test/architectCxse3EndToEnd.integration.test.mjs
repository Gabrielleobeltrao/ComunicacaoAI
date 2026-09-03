// CXSE3, DA FRASE AO RECURSO — pela rota real do chat.
//
// O plano descreve um caminho: mensagem → intenção → projeto → Brief → proposta → aprovação →
// Source + History/Live + Monitor + Flow → teste → ativação autorizada. Os testes anteriores
// provavam pedaços dele começando com um Brief montado à mão — e um Brief montado à mão pula
// justamente a parte que quebra na vida real: a passagem do que a pessoa escreveu para o que
// o sistema entendeu.
//
// Aqui a única entrada é `POST /api/architect/assistant/turn` com a frase que alguém digitaria.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.LLM_FAKE = '1'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { mongoClient, db } = await import('../dist/db.js')
const { architectRouter } = await import('../dist/routes/architectRoutes.js')
const repo = await import('../dist/architect/repository.js')
const { ensureTokenUsageIndexes } = await import('../dist/tokenUsage.js')
const { ensureRunIndexes } = await import('../dist/automations/runRepository.js')
const { ensureExecutionRootIndexes } = await import('../dist/executionRoots.js')
const { setProviderApiKey } = await import('../dist/userSettings.js')
const { resetGuards } = await import('../dist/architect/guard.js')
const express = (await import('express')).default

const DONO = 'dono-cxse3'
const FRASE = 'Observe CXSE3 e me avise quando o RSI ficar abaixo de 30'
let server
let port
let origem
let portaDaOrigem

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

  // A origem de verdade que o teste de aceitação da fonte vai consultar.
  origem = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ rsi: 22.5, preco: 31.4 }))
  })
  await new Promise((r) => origem.listen(0, r))
  portaDaOrigem = origem.address().port

  const app = express()
  app.use(express.json())
  app.use((_req, res, next) => {
    res.locals.userId = DONO
    next()
  })
  app.use('/api/architect', architectRouter)
  await new Promise((r) => {
    server = app.listen(0, () => {
      port = server.address().port
      r()
    })
  })
})

after(async () => {
  origem?.close()
  await new Promise((r) => server.close(r))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of [
    'architect_projects',
    'architect_messages',
    'architect_apply_operations',
    'offices',
    'buildings',
    'agents',
    'sectors',
    'automations',
    'data_stores',
    'dataset_definitions',
    'monitoring_sources',
    'monitors',
    'execution_roots',
    'user_settings',
  ])
    await db.collection(c).deleteMany({})
  resetGuards()
  await setProviderApiKey(DONO, 'anthropic', 'chave-de-teste-que-nao-e-segredo')
})

/** A frase entra pelo chat. É a única porta que este arquivo usa. */
const doChat = (message) => pedir('POST', '/assistant/turn', { message })

// --- da frase ao projeto -----------------------------------------------------------------------

test('ACEITAÇÃO: a frase do chat vira intenção de PROPOR e abre um projeto', async () => {
  const r = await doChat(FRASE)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.intent.mode, 'propose', 'vigiar um dado é construir, não responder')
  assert.ok(r.body.projectId, 'sem projeto, não há onde a proposta morar')
  // A rodada TERMINA: o campo do chat não pode ficar bloqueado.
  assert.equal(r.body.phase, 'done')
  assert.ok(r.body.text.trim())
})

test('a FRASE ORIGINAL fica no projeto — ninguém precisa digitar de novo', async () => {
  const r = await doChat(FRASE)
  const mensagens = await db
    .collection('architect_messages')
    .find({ ownerId: DONO, projectId: new ObjectId(r.body.projectId) })
    .toArray()
  assert.ok(
    mensagens.some((m) => m.role === 'user' && m.content.includes('CXSE3')),
    'abrir um projeto vazio faz a pessoa repetir o pedido — e a segunda versão nunca é igual',
  )
})

// --- do projeto ao plano -----------------------------------------------------------------------

/** Leva o projeto aberto pelo chat até ter proposta validada. */
const ateAProposta = async () => {
  const chat = await doChat(FRASE)
  const id = chat.body.projectId
  // A conversa do projeto continua de onde o chat parou — o Brief sai daqui, não de fixture.
  await pedir('POST', `/projects/${id}/messages`, { content: 'a cada fechamento de candle' })
  await pedir('POST', `/projects/${id}/messages`, { content: 'me avise pelo WhatsApp' })
  const v = await pedir('POST', `/projects/${id}/validate`)
  return { id, valido: v.body.valid, issues: v.body.issues }
}

test('ACEITAÇÃO: o projeto aberto pelo chat monta um BRIEF a partir da conversa', async () => {
  const { id } = await ateAProposta()
  const projeto = await repo.getProject(DONO, new ObjectId(id))
  assert.ok(projeto.brief, 'sem entendimento, o desenho é um palpite sobre uma frase')
  assert.ok(projeto.brief.jobs.length > 0, 'o Brief precisa ter ao menos um trabalho mapeado')
  assert.ok(projeto.blueprint, 'sem plano, não há o que aprovar')

  /**
   * O ENTENDIMENTO tem que carregar as três coisas que a pessoa disse: o papel, o indicador e
   * o número. Um Brief que perde o "30" produz um alarme com um limiar inventado.
   */
  const briefTexto = JSON.stringify(projeto.brief)
  assert.match(briefTexto, /CXSE3/i, 'o Brief perdeu o papel que a pessoa citou')
  assert.match(briefTexto, /RSI/i, 'o Brief perdeu o indicador')
  assert.match(briefTexto, /\b30\b/, 'o Brief perdeu o limiar: 30')

  // E o plano tem que carregar a CADEIA — não só a intenção.
  const planoTexto = JSON.stringify(projeto.blueprintV2)
  assert.match(planoTexto, /calculate_rsi/, 'o plano não cita a função que faz a conta: o RSI viraria palpite do modelo')
  assert.equal(projeto.blueprintV2.operations.monitors[0]?.condition?.value, 30, 'o monitor precisa comparar contra 30, o número da frase')
})

test('ACEITAÇÃO: a proposta é válida e a prévia mostra o que vai ser criado', async () => {
  const { id, valido, issues } = await ateAProposta()
  assert.equal(valido, true, JSON.stringify(issues))

  const previa = await pedir('GET', `/projects/${id}/preview`)
  assert.equal(previa.status, 200)
  assert.ok(previa.body.items.length > 0)
  /**
   * A pessoa vê a CADEIA antes de clicar.
   *
   * Vigiar um dado não exige agente: "observe e me avise" notifica sem intermediário. O que
   * ele exige é a cadeia — de onde o dado vem, onde ele fica, o que observa e o que acontece.
   */
  const tipos = new Set(previa.body.items.map((i) => i.kind))
  assert.ok(tipos.has('floor'), 'a operação precisa de um lugar')
  for (const esperado of ['source', 'monitor', 'flow']) {
    assert.ok(tipos.has(esperado), `"${esperado}" não aparece na prévia: ${[...tipos].join(', ')}`)
  }
})

// --- a pendência que só uma pessoa resolve --------------------------------------------------------

test('ACEITAÇÃO: sem origem do dado, a fonte é PENDÊNCIA acionável — nunca um endereço inventado', async () => {
  const { id } = await ateAProposta()
  const previa = await pedir('GET', `/projects/${id}/preview`)
  await pedir('POST', `/projects/${id}/apply`, { blueprintHash: previa.body.blueprintHash, idempotencyKey: 'cxse3-pend', confirm: true })

  const operacao = await repo.lastOperation(DONO, new ObjectId(id))
  const passoDaFonte = operacao.steps.find((p) => p.kind === 'source')
  assert.equal(passoDaFonte.status, 'skipped', 'o Brief diz "cotação CXSE3" — uma descrição, não um endereço')
  assert.match(passoDaFonte.message, /de onde este dado vem/)
  assert.equal(await db.collection('monitoring_sources').countDocuments({ ownerId: DONO }), 0)

  // E o que dependia dela cascateia, dizendo de quem espera: é o que torna retomável.
  const passoDoMonitor = operacao.steps.find((p) => p.kind === 'monitor')
  assert.equal(passoDoMonitor.status, 'skipped')
  assert.ok(passoDoMonitor.message?.trim())
})

// --- do plano ao recurso, com a origem conectada ---------------------------------------------------

/**
 * O passo humano: a pessoa conecta o provedor de candles.
 *
 * O plano não inventa endereço. Quem sabe de onde vêm os candles é quem tem a conta no
 * provedor — e é por isso que a fonte é declarada e a origem fica pendente. Aqui ela é
 * conectada pelo serviço canônico, exatamente como a Central faria.
 */
const conectarProvedor = async () => {
  const svc = await import('../dist/monitoring/service.js')
  return svc.createSource(DONO, {
    name: 'Candles CXSE3',
    kind: 'api_polling',
    config: { url: `http://127.0.0.1:${portaDaOrigem}/candles`, method: 'GET' },
    mapping: { version: 1, fields: [{ to: 'rsi', from: 'rsi', transforms: [{ op: 'number' }], required: true }] },
    cadence: { mode: 'interval', intervalMs: 60_000 },
    destination: { history: true, live: true },
  })
}

/** Liga o item da proposta à fonte que a pessoa conectou, e devolve a prévia atual. */
const ligarFonte = async (id, fonte) => {
  const projeto = await repo.getProject(DONO, new ObjectId(id))
  const item = projeto.blueprintV2.operations.sources[0]
  assert.ok(item, 'a proposta precisa declarar a fonte para poder ligá-la')
  const r = await pedir('PATCH', `/projects/${id}/links`, {
    links: [{ kind: 'source', key: item.key, action: 'reuse', resourceId: fonte._id.toString() }],
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  await pedir('POST', `/projects/${id}/validate`)
  return (await pedir('GET', `/projects/${id}/preview`)).body
}

test('ACEITAÇÃO: com a origem conectada, aplicar cria a cadeia — e NADA entra no ar sozinho', async () => {
  const { id } = await ateAProposta()
  const fonte = await conectarProvedor()
  const previa = await ligarFonte(id, fonte)

  const r = await pedir('POST', `/projects/${id}/apply`, { blueprintHash: previa.blueprintHash, idempotencyKey: 'cxse3-1', confirm: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))

  assert.ok((await db.collection('offices').countDocuments({ ownerId: DONO })) >= 1, 'a operação precisa de um lugar')
  // A cadeia real: de onde o dado vem, e o que acontece quando a condição bate. Agente não
  // entra — "observe e me avise" notifica sem intermediário.
  assert.equal(await db.collection('monitoring_sources').countDocuments({ ownerId: DONO }), 1, 'a fonte conectada é REUSADA, não duplicada')
  assert.ok((await db.collection('automations').countDocuments({ ownerId: DONO })) >= 1, 'sem Flow o aviso não sai')

  // Nada foi ligado: sem `approvedActivationKeys`, tudo nasce parado.
  for (const fonte of await db.collection('monitoring_sources').find({ ownerId: DONO }).toArray()) {
    assert.notEqual(fonte.status, 'active', `a fonte "${fonte.name}" entrou no ar sem ninguém autorizar`)
  }
  const monitores = await db.collection('monitors').find({ ownerId: DONO }).toArray()
  for (const m of monitores) assert.notEqual(m.status, 'published', 'o monitor foi publicado sem autorização')
})

test('nenhum passo da aplicação falha — a cadeia inteira resolve', async () => {
  const { id } = await ateAProposta()
  const previa = await pedir('GET', `/projects/${id}/preview`)
  await pedir('POST', `/projects/${id}/apply`, { blueprintHash: previa.body.blueprintHash, idempotencyKey: 'cxse3-2', confirm: true })

  const operacao = await repo.lastOperation(DONO, new ObjectId(id))
  const falhas = (operacao?.steps ?? []).filter((p) => p.status === 'failed')
  assert.deepEqual(falhas, [], JSON.stringify(falhas))
})

test('os recursos criados levam a MARCA da operação — a retomada os reconhece', async () => {
  const { id } = await ateAProposta()
  const previa = await pedir('GET', `/projects/${id}/preview`)
  await pedir('POST', `/projects/${id}/apply`, { blueprintHash: previa.body.blueprintHash, idempotencyKey: 'cxse3-3', confirm: true })

  const operacao = await repo.lastOperation(DONO, new ObjectId(id))
  /**
   * Um `for` sobre coleção vazia passa sem provar nada — por isso cada laço declara antes
   * quantos documentos ele exige ver.
   */
  for (const [colecao, minimo] of [['data_stores', 1], ['automations', 1], ['monitors', 0], ['monitoring_sources', 0]]) {
    const docs = await db.collection(colecao).find({ ownerId: DONO }).toArray()
    assert.ok(docs.length >= minimo, `esperava ao menos ${minimo} em ${colecao}, veio ${docs.length}`)
    for (const doc of docs) {
      assert.equal(doc.architect?.operationId, operacao._id.toString(), `sem marca, uma queda na janela duplicaria este ${colecao}`)
      assert.ok(doc.architect?.blueprintKey, `a marca sem a chave do plano não reconhece O QUE é este ${colecao}`)
    }
  }
})

// --- o que a proposta NÃO inventa ----------------------------------------------------------------

test('sem provedor de candles conectado, o RSI vira PENDÊNCIA — nunca um endereço inventado', async () => {
  const { id } = await ateAProposta()
  const projeto = await repo.getProject(DONO, new ObjectId(id))

  const texto = JSON.stringify(projeto.blueprintV2 ?? projeto.blueprint)
  // Nenhuma URL de provedor de mercado sai de um plano compilado: o compilador não sabe de
  // onde vêm os candles, e inventar um endereço é pior que declarar a pendência.
  assert.equal(/b3\.com|yahoo|alphavantage|finance\./i.test(texto), false, 'o plano trouxe um endereço que ninguém configurou')

  // A fonte é DECLARADA e a origem fica pendente — com motivo, ou não é retomável.
  const fontes = projeto.blueprintV2?.operations.sources ?? []
  assert.ok(fontes.length > 0, 'sem fonte declarada não há o que conectar')
  const pendencias = projeto.blueprintV2?.warnings ?? []
  assert.ok(
    pendencias.some((p) => p.path === 'source_config' && String(p.message ?? '').trim()),
    `a origem não resolvida precisa virar pendência com motivo: ${JSON.stringify(pendencias)}`,
  )
})

test('a função calculate_rsi está disponível para o plano usar', async () => {
  const { findFunction } = await import('../dist/executors/functionRegistry.js')
  await import('../dist/executors/functionExecutor.js')
  const fn = findFunction('calculate_rsi')
  assert.ok(fn, 'sem a função registrada, o RSI seria um palpite do modelo')
  assert.equal(fn.version, '1.0.0')
})

// --- a ativação autorizada e a transição de verdade -------------------------------------------

/** Leva a cadeia até aplicada, com a origem conectada e a ativação autorizada. */
const ateNoAr = async () => {
  const { id } = await ateAProposta()
  const fonte = await conectarProvedor()
  const previa = await ligarFonte(id, fonte)

  const projeto = await repo.getProject(DONO, new ObjectId(id))
  const chaves = [
    ...projeto.blueprintV2.operations.sources.map((s) => s.key),
    ...projeto.blueprintV2.operations.flows.map((f) => f.key),
    ...projeto.blueprintV2.operations.monitors.map((m) => m.key),
  ]
  const r = await pedir('POST', `/projects/${id}/apply`, {
    blueprintHash: previa.blueprintHash,
    idempotencyKey: `cxse3-ar-${Math.random().toString(36).slice(2)}`,
    confirm: true,
    approvedActivationKeys: chaves,
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return { id, fonte }
}

test('ACEITAÇÃO: a fonte é TESTADA antes de entrar no ar', async () => {
  const { id, fonte } = await ateNoAr()
  const operacao = await repo.lastOperation(DONO, new ObjectId(id))
  const prova = (operacao.acceptance ?? []).find((a) => a.kind === 'source')
  assert.ok(prova, `nenhum teste de fonte foi declarado: ${JSON.stringify(operacao.acceptance)}`)
  assert.equal(prova.status, 'passed', prova.observed)

  const depois = await db.collection('monitoring_sources').findOne({ _id: fonte._id })
  assert.equal(depois.status, 'active')
  assert.ok(depois.telemetry.lastTestOkAt, 'o portão do domínio exige leitura bem-sucedida')
})

test('ACEITAÇÃO: com autorização, a cadeia INTEIRA entra no ar', async () => {
  const { id } = await ateNoAr()

  const flow = await db.collection('automations').findOne({ ownerId: DONO })
  assert.equal(flow?.status, 'active', 'o Flow parado é o aviso que nunca sai')
  assert.ok(flow.lastPublishedVersion != null, 'sem versão publicada, o monitor recusa publicar')

  const monitor = await db.collection('monitors').findOne({ ownerId: DONO })
  assert.ok(monitor, `o monitor não foi criado: ${JSON.stringify((await repo.lastOperation(DONO, new ObjectId(id))).steps)}`)
  assert.equal(monitor.status, 'published', 'um monitor em rascunho é um alarme desligado que parece ligado')
  assert.equal(String(monitor.action.flowId), flow._id.toString(), 'o monitor precisa apontar para o Flow desta aplicação')
})

test('ACEITAÇÃO: a transição verdadeira dispara UMA execução — e o evento repetido não dispara outra', async () => {
  await ateNoAr()
  const monitor = await db.collection('monitors').findOne({ ownerId: DONO })
  assert.ok(monitor?.action?.flowId, 'sem Flow ligado, nada dispararia')

  const { observeAndDispatch } = await import('../dist/monitors/dispatch.js')
  const base = { ownerId: DONO, monitor }

  // ACIMA de 30: a condição é falsa, e nada acontece.
  const acima = await observeAndDispatch({ ...base, eventId: 'e1', value: { rsi: 42 } })
  assert.equal(acima.triggered, false, 'RSI 42 não é "abaixo de 30"')

  // ABAIXO de 30: a borda acontece, e dispara UMA vez.
  const monitorAgora = await db.collection('monitors').findOne({ _id: monitor._id })
  const abaixo = await observeAndDispatch({ ...base, monitor: monitorAgora, eventId: 'e2', value: { rsi: 22 } })
  assert.equal(abaixo.triggered, true, `a transição precisa disparar: ${abaixo.reason}`)
  assert.ok(abaixo.runId, 'disparar sem execução é um alarme que não faz nada')

  const depoisDoDisparo = await db.collection('monitors').findOne({ _id: monitor._id })

  // O MESMO evento de novo: a chave é a mesma, e reenfileirar não cria uma segunda execução.
  const repetido = await observeAndDispatch({ ...base, monitor: depoisDoDisparo, eventId: 'e2', value: { rsi: 22 } })
  assert.equal(repetido.created, false, 'o evento duplicado criou uma segunda execução')

  // E continuar abaixo também não redispara: a borda já foi consumida.
  const aindaAbaixo = await observeAndDispatch({ ...base, monitor: depoisDoDisparo, eventId: 'e3', value: { rsi: 21 } })
  assert.equal(aindaAbaixo.triggered, false, 'ficar abaixo não é cruzar para baixo — isso é o alarme tocando sem parar')

  const execucoes = await db.collection('automation_runs').countDocuments({ ownerId: DONO })
  assert.equal(execucoes, 1, `esperava exatamente uma execução, veio ${execucoes}`)
})

test('ACEITAÇÃO: a execução aparece na Activity, com a origem no monitor', async () => {
  await ateNoAr()
  const monitor = await db.collection('monitors').findOne({ ownerId: DONO })
  const { observeAndDispatch } = await import('../dist/monitors/dispatch.js')
  await observeAndDispatch({ ownerId: DONO, monitor, eventId: 'a1', value: { rsi: 42 } })
  const atual = await db.collection('monitors').findOne({ _id: monitor._id })
  const r = await observeAndDispatch({ ownerId: DONO, monitor: atual, eventId: 'a2', value: { rsi: 19 } })
  assert.equal(r.triggered, true, r.reason)

  const { listActivity } = await import('../dist/activity/timeline.js')
  const linha = await listActivity({ ownerId: DONO, limit: 10 })
  assert.ok(linha.items.length > 0, 'uma execução que não aparece na linha do tempo é invisível')
  const daVigilancia = linha.items.find((i) => i.origin?.kind === 'monitor')
  assert.ok(daVigilancia, `nenhuma execução com origem no monitor: ${JSON.stringify(linha.items.map((i) => i.origin))}`)
  assert.equal(daVigilancia.origin.id, monitor._id.toString())
})
