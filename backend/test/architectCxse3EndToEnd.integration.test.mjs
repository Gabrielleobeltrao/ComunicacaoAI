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
const FRASE = 'Observe CXSE3 e me avise pelo WhatsApp quando o RSI ficar abaixo de 30'
let server
let port
let origem
let portaDaOrigem
/** O fechamento que a origem devolve na próxima leitura. */
let proximoFechamento = 100
/** O canal de WhatsApp do outro lado — e o que ele recebeu. */
let canal
let portaDoCanal
let recebidasNoCanal = []
/** Quando ligado, a instância do outro lado recusa o envio. */
let canalRecusa = false

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
  // O índice único de `dedupeKey` é o que faz a dedupe do histórico existir. Sem ele o teste
  // mediria outra coisa: o mesmo fechamento gravaria duas vezes e a repetição pareceria real.
  await (await import('../dist/dataHistory/store.js')).ensureDataHistoryIndexes()
  await (await import('../dist/monitors/state.js')).ensureMonitorIndexes()

  /**
   * A origem de verdade — e ela entrega FECHAMENTO, nunca `rsi`.
   *
   * Uma API que devolvesse o indicador pronto transferiria a conta para fora e faria este teste
   * medir o provedor: a cadeia passaria com o cálculo desligado. O RSI aqui é sempre calculado
   * por `calculate_rsi`, a partir dos números que a fonte trouxe.
   */
  origem = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ fechamento: proximoFechamento, symbol: 'CXSE3' }))
  })
  await new Promise((r) => origem.listen(0, r))
  portaDaOrigem = origem.address().port

  /**
   * O outro lado do WhatsApp — a instância que o adaptador Evolution chama.
   *
   * Um dublê aqui não é mock da integração: o caminho inteiro roda de verdade (a conexão, a
   * decifra do config do canal, o `safeFetch` com SSRF conferido, o corpo montado pelo
   * adaptador). O que este servidor faz é receber e guardar — que é o que a instância faria.
   */
  canal = createServer((req, res) => {
    let corpo = ''
    req.on('data', (p) => (corpo += p))
    req.on('end', () => {
      try {
        recebidasNoCanal.push(JSON.parse(corpo))
      } catch {
        recebidasNoCanal.push({ cru: corpo })
      }
      if (canalRecusa) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end('{"error":"instancia fora do ar"}')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  await new Promise((r) => canal.listen(0, r))
  portaDoCanal = canal.address().port

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
  canal?.close()
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
    'data_recorders',
    'data_history_records',
    'automation_versions',
    'automation_runs',
    'step_runs',
    'deliveries',
    'connections',
    'widgets',
  ])
    await db.collection(c).deleteMany({})
  resetGuards()
  recebidasNoCanal = []
  canalRecusa = false
  proximoFechamento = 100
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
  /**
   * E o CANAL, que é a parte que some mais fácil.
   *
   * "Me avise pelo WhatsApp" virando `channels: ['web']` produz uma proposta correta sobre tudo
   * menos sobre a única coisa que a pessoa pediu por escrito — e ela descobriria pelo canal
   * errado, ou não descobriria.
   */
  assert.match(briefTexto, /whats\s?app/i, 'o Brief trocou o canal pedido')

  // E o plano tem que carregar a CADEIA — não só a intenção.
  const planoTexto = JSON.stringify(projeto.blueprintV2)
  assert.match(planoTexto, /calculate_rsi/, 'o plano não cita a função que faz a conta: o RSI viraria palpite do modelo')

  // A ENTREGA é declarada, ligada ao Flow, e pelo canal pedido.
  const entrega = projeto.blueprintV2.operations.deliveries[0]
  assert.ok(entrega, 'sem entrega declarada, "me avise" termina na Activity')
  assert.equal(entrega.fromKey, projeto.blueprintV2.operations.flows[0].key, 'a entrega precisa sair do Flow que monta o aviso')
  assert.match(`${entrega.channelKey} ${entrega.destinationHint}`, /whats\s?app/i, 'a entrega perdeu o canal pedido')
  // E a dica é o CANAL, nunca um endereço.
  assert.equal(/\d{8,}/.test(entrega.destinationHint), false, 'endereço concreto dentro do plano')

  // UMA fonte semântica: a vigilância e a necessidade de dado são o mesmo pedido.
  assert.equal(
    projeto.blueprintV2.operations.sources.length,
    1,
    `duas fontes do mesmo papel são duas coletas e dois históricos: ${JSON.stringify(projeto.blueprintV2.operations.sources.map((f) => f.key))}`,
  )
  const campos = projeto.blueprintV2.operations.sources[0].mapping.fields.map((c) => c.to)
  assert.deepEqual(campos, ['fechamento'], 'a fonte precisa trazer o fechamento — o RSI é calculado aqui')
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
    // Só o fechamento: é o que a origem publica, e é o que a conta consome.
    mapping: { version: 1, fields: [{ to: 'fechamento', from: 'fechamento', transforms: [{ op: 'number' }], required: true }] },
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


// --- do CANDLE à NOTIFICAÇÃO -------------------------------------------------------------------
//
// Daqui para baixo nada é injetado. O RSI que o monitor compara é calculado por
// `calculate_rsi@1.0.0` a partir dos fechamentos que a fonte trouxe, e a mensagem que sai passa
// pelo canal de WhatsApp conectado. Um teste que entregasse `{ rsi: 22 }` ao monitor provaria o
// monitor e mais nada — o cálculo e a entrega ficariam desligados sem ninguém perceber.

/** A série que sobe: com ela o RSI fica bem acima de 30. */
const SUBIDA = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130]
/** E a que desaba: é ela que cruza a borda para baixo. */
const QUEDA = [110, 95, 80, 68, 58]

/** O canal de WhatsApp conectado — com a credencial no widget, como no produto. */
const conectarWhatsApp = async () => {
  const { encrypt } = await import('../dist/crypto.js')
  const widget = {
    _id: new ObjectId(),
    ownerId: DONO,
    name: 'Meu número',
    kind: 'whatsapp',
    status: 'active',
    whatsapp: {
      provider: 'evolution',
      configEnc: encrypt(JSON.stringify({ baseUrl: `http://127.0.0.1:${portaDoCanal}`, instance: 'teste', apiKey: 'nao-e-segredo-de-verdade' })),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  await db.collection('widgets').insertOne(widget)
  const { createConnection } = await import('../dist/connections/service.js')
  // A conexão guarda a REFERÊNCIA ao número, e nunca o token.
  const conexao = await createConnection(DONO, { provider: 'whatsapp', name: 'WhatsApp do dono', config: { widgetId: widget._id.toString() } })
  return { widget, conexao }
}

/** Leva a cadeia até no ar: origem conectada, canal escolhido e ativação autorizada. */
const ateNoAr = async () => {
  const { id } = await ateAProposta()
  const fonte = await conectarProvedor()
  const previa = await ligarFonte(id, fonte)
  const { conexao } = await conectarWhatsApp()

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
    deliveryConnections: projeto.blueprintV2.operations.deliveries.map((d) => ({
      key: d.key,
      connectionId: conexao._id.toString(),
      destination: '5511999999999',
    })),
  })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return { id, fonte, conexao }
}

/**
 * Um fechamento entra pela fonte de verdade e atravessa a cadeia inteira.
 *
 * `readSourceOnce` é o mesmo caminho do coletor: ele lê a origem, aplica o mapeamento e grava
 * no histórico. Depois disso, a conta e a observação são chamadas explicitamente — o motor as
 * dispara por ouvinte, sem espera, e um teste que dependesse disso estaria medindo o relógio.
 */
const entrarUmFechamento = async (valor) => {
  proximoFechamento = valor
  const { readSourceOnce, getSource } = await import('../dist/monitoring/service.js')
  const { calcularDerivados } = await import('../dist/dataHistory/derived.js')
  const { observarRegistro } = await import('../dist/monitors/dataSource.js')
  const { listarRegistros } = await import('../dist/dataHistory/store.js')

  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  const leitura = await readSourceOnce(fonte)
  assert.equal(leitura.ok, true, `a leitura da fonte falhou: ${JSON.stringify(leitura.error)}`)
  const atual = await getSource(DONO, fonte._id)
  const [bruto] = await listarRegistros(DONO, { recorderId: atual.destination.recorderId, limit: 1, order: 'desc' })
  assert.ok(bruto, 'a leitura da fonte precisa virar registro: sem série não há conta')

  const contas = await calcularDerivados(bruto)
  const calculado = contas.find((c) => c.kind === 'gravado')
  if (!calculado) return { bruto, rsi: null, contas }

  const derivado = await db.collection('data_recorders').findOne({ ownerId: DONO, derivedFrom: { $ne: null } })
  const [linha] = await listarRegistros(DONO, { recorderId: derivado._id, limit: 1, order: 'desc' })
  const disparos = await observarRegistro(linha)
  return { bruto, rsi: linha.value.rsi, linha, disparos, contas }
}

test('ACEITAÇÃO: a fonte é TESTADA antes de entrar no ar', async () => {
  const { id, fonte } = await ateNoAr()
  const operacao = await repo.lastOperation(DONO, new ObjectId(id))
  const prova = (operacao.acceptance ?? []).find((a) => a.kind === 'source')
  assert.ok(prova, 'sem prova de fonte, ativar é apostar')
  assert.equal(prova.status, 'passed', prova.observed)

  const depois = await db.collection('monitoring_sources').findOne({ _id: fonte._id })
  assert.equal(depois.status, 'active')
  assert.ok(depois.telemetry.lastTestOkAt, 'o portão do domínio exige leitura bem-sucedida')
})

test('ACEITAÇÃO: com autorização, a cadeia INTEIRA entra no ar — com a entrega ligada', async () => {
  const { conexao } = await ateNoAr()

  const flow = await db.collection('automations').findOne({ ownerId: DONO })
  assert.equal(flow?.status, 'active', 'o Flow parado é o aviso que nunca sai')
  assert.ok(flow.lastPublishedVersion != null, 'sem versão publicada, o monitor recusa publicar')

  const monitor = await db.collection('monitors').findOne({ ownerId: DONO })
  assert.equal(monitor?.status, 'published', 'um monitor em rascunho é um alarme desligado que parece ligado')
  assert.equal(String(monitor.action.flowId), flow._id.toString(), 'o monitor precisa apontar para o Flow desta aplicação')

  /**
   * O monitor observa a série CALCULADA — não os fechamentos.
   *
   * Observar os fechamentos compararia o PREÇO contra 30, que é outra pergunta e dispararia
   * quando a ação caísse abaixo de trinta reais.
   */
  const derivado = await db.collection('data_recorders').findOne({ ownerId: DONO, derivedFrom: { $ne: null } })
  assert.ok(derivado, 'sem série derivada, alguém teria que calcular o RSI — e esse alguém seria um palpite')
  assert.equal(monitor.source.datasetKey, derivado._id.toString(), 'o monitor precisa observar o RSI calculado')
  assert.equal(derivado.derivedFrom.functionName, 'calculate_rsi')
  assert.equal(derivado.derivedFrom.version, '1.0.0', 'sem versão fixada, atualizar a função muda uma vigilância no ar')

  // E a ENTREGA virou passo de verdade, apontando para a conexão escolhida.
  const versao = await db.collection('automation_versions').findOne({ automationId: flow._id, version: flow.lastPublishedVersion })
  const passos = (versao?.definition ?? flow.draftDefinition).steps
  const entrega = passos.find((p) => p.type === 'delivery.send')
  assert.ok(entrega, `sem passo de entrega o aviso morre na Activity: ${JSON.stringify(passos.map((p) => p.type))}`)
  assert.equal(entrega.config.connectionId, conexao._id.toString())
})

test('AMEAÇA: sem conexão escolhida, a entrega fica PENDENTE — e o Flow não finge que entrega', async () => {
  const { id } = await ateAProposta()
  const fonte = await conectarProvedor()
  const previa = await ligarFonte(id, fonte)
  // Sem `deliveryConnections`: ninguém escolheu por onde o aviso sai.
  const r = await pedir('POST', `/projects/${id}/apply`, { blueprintHash: previa.blueprintHash, idempotencyKey: 'cxse3-sem-conexao', confirm: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))

  const operacao = await repo.lastOperation(DONO, new ObjectId(id))
  const passo = operacao.steps.find((p) => p.kind === 'delivery')
  assert.ok(passo, 'a entrega precisa aparecer como passo, nem que seja para dizer que falta algo')
  assert.equal(passo.status, 'skipped', 'uma entrega sem conexão não pode contar como feita')
  assert.match(passo.message, /conex[ãa]o/i, 'a pendência precisa dizer o que fazer')

  const flow = await db.collection('automations').findOne({ ownerId: DONO })
  const temEntrega = (flow?.draftDefinition.steps ?? []).some((p) => p.type === 'delivery.send')
  assert.equal(temEntrega, false, 'um passo de entrega sem conexão apontaria para o nada')
})

// --- a conta, de verdade -------------------------------------------------------------------

test('ACEITAÇÃO: a fonte entrega FECHAMENTOS, e o RSI é calculado aqui', async () => {
  await ateNoAr()

  for (const f of SUBIDA) await entrarUmFechamento(f)

  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  const bruto = await db.collection('data_history_records').find({ ownerId: DONO, recorderId: fonte.destination.recorderId }).toArray()
  assert.ok(bruto.length >= 15, `esperava a série de fechamentos, veio ${bruto.length}`)
  for (const r of bruto) {
    assert.ok(typeof r.value.fechamento === 'number', 'a fonte precisa trazer fechamento')
    assert.equal(r.value.rsi, undefined, 'a origem não pode entregar o indicador pronto: o teste mediria o provedor')
  }

  const derivado = await db.collection('data_recorders').findOne({ ownerId: DONO, derivedFrom: { $ne: null } })
  const calculados = await db.collection('data_history_records').find({ ownerId: DONO, recorderId: derivado._id }).toArray()
  assert.ok(calculados.length > 0, 'o RSI calculado precisa ficar PERSISTIDO — não só existir em memória')

  /**
   * O número é conferido contra a própria função, sobre a série que ficou guardada.
   *
   * Escrever o valor esperado à mão aqui provaria que alguém digitou o mesmo número duas
   * vezes, e não que a função rodou.
   */
  const { calculateRsi } = await import('../dist/executors/indicatorFunctions.js')
  const serie = bruto.sort((a, b) => a.occurredAt - b.occurredAt).map((r) => r.value.fechamento)
  const ultimo = calculados.sort((a, b) => a.occurredAt - b.occurredAt).at(-1)
  assert.equal(ultimo.value.rsi, calculateRsi(serie.slice(-15), 14).rsi, 'o RSI gravado não é o que a função calcula')
  assert.equal(ultimo.value.calculatedBy, 'calculate_rsi@1.0.0', 'sem proveniência, a série é um número solto')
  assert.ok(ultimo.occurredAt instanceof Date, 'sem instante, não dá para ordenar a série')
})

test('ACEITAÇÃO: a queda dos fechamentos cruza 30 e produz UMA execução e UMA entrega', async () => {
  await ateNoAr()
  for (const f of SUBIDA) await entrarUmFechamento(f)

  // Antes da queda: o RSI está acima de 30 e nada disparou.
  const alto = await entrarUmFechamento(132)
  assert.ok(alto.rsi > 30, `a série que sobe precisa ter RSI alto, veio ${alto.rsi}`)
  assert.equal(await db.collection('automation_runs').countDocuments({ ownerId: DONO }), 0, 'nada aconteceu: nada deve ter disparado')

  // A queda: em algum ponto dela o RSI cruza a borda, e ela dispara UMA vez.
  let disparou = 0
  let ultimoRsi = alto.rsi
  for (const f of QUEDA) {
    const passo = await entrarUmFechamento(f)
    ultimoRsi = passo.rsi
    disparou += (passo.disparos ?? []).filter((d) => d.triggered).length
  }
  assert.ok(ultimoRsi < 30, `a queda precisa levar o RSI abaixo de 30, veio ${ultimoRsi}`)
  assert.equal(disparou, 1, `a borda acontece uma vez: ${disparou} disparos`)

  const execucoes = await db.collection('automation_runs').find({ ownerId: DONO }).toArray()
  assert.equal(execucoes.length, 1, `esperava exatamente uma execução, veio ${execucoes.length}`)

  // A execução roda, e a entrega sai por ela.
  const { processRun } = await import('../dist/automations/runProcessor.js')
  await processRun(execucoes[0]._id.toString())

  const entregas = await db.collection('deliveries').find({ ownerId: DONO }).toArray()
  assert.equal(entregas.length, 1, `esperava uma entrega, veio ${entregas.length}`)
  assert.equal(entregas[0].status, 'sent', `a entrega não saiu: ${JSON.stringify(entregas[0].error)}`)
  assert.equal(entregas[0].provider, 'whatsapp')

  // E a mensagem chegou mesmo ao canal, com o texto do aviso.
  assert.equal(recebidasNoCanal.length, 1, `o canal recebeu ${recebidasNoCanal.length} mensagens`)
  assert.equal(recebidasNoCanal[0].number, '5511999999999')
  assert.match(String(recebidasNoCanal[0].text), /RSI/i, 'a mensagem precisa dizer do que se trata')
})

test('AMEAÇA: o MESMO fechamento de novo não recalcula, não redispara e não reentrega', async () => {
  await ateNoAr()
  for (const f of SUBIDA) await entrarUmFechamento(f)
  for (const f of QUEDA) await entrarUmFechamento(f)

  const derivado = await db.collection('data_recorders').findOne({ ownerId: DONO, derivedFrom: { $ne: null } })
  const antesCalculados = await db.collection('data_history_records').countDocuments({ ownerId: DONO, recorderId: derivado._id })
  const antesExecucoes = await db.collection('automation_runs').countDocuments({ ownerId: DONO })
  assert.ok(antesCalculados > 0 && antesExecucoes === 1, `estado inicial errado: ${antesCalculados} contas, ${antesExecucoes} execuções`)

  const execucoes = await db.collection('automation_runs').find({ ownerId: DONO }).toArray()
  const { processRun } = await import('../dist/automations/runProcessor.js')
  await processRun(execucoes[0]._id.toString())

  // A MESMA leitura, reprocessada inteira: a identidade do registro é a mesma.
  const { calcularDerivados } = await import('../dist/dataHistory/derived.js')
  const { observarRegistro } = await import('../dist/monitors/dataSource.js')
  const { listarRegistros } = await import('../dist/dataHistory/store.js')
  const fonte = await db.collection('monitoring_sources').findOne({ ownerId: DONO })
  const [bruto] = await listarRegistros(DONO, { recorderId: fonte.destination.recorderId, limit: 1, order: 'desc' })
  await calcularDerivados(bruto)
  const [linha] = await listarRegistros(DONO, { recorderId: derivado._id, limit: 1, order: 'desc' })
  await observarRegistro(linha)

  assert.equal(
    await db.collection('data_history_records').countDocuments({ ownerId: DONO, recorderId: derivado._id }),
    antesCalculados,
    'recalcular o mesmo fechamento gravou um segundo RSI',
  )
  assert.equal(await db.collection('automation_runs').countDocuments({ ownerId: DONO }), 1, 'o evento repetido criou uma segunda execução')
  assert.equal(await db.collection('deliveries').countDocuments({ ownerId: DONO }), 1, 'o evento repetido mandou uma segunda mensagem')
  assert.equal(recebidasNoCanal.length, 1, 'o canal recebeu a mesma mensagem duas vezes')
})

// --- a Activity ------------------------------------------------------------------------------

test('ACEITAÇÃO: a Activity mostra o CÁLCULO, o disparo, a execução e o envio', async () => {
  await ateNoAr()
  for (const f of SUBIDA) await entrarUmFechamento(f)
  for (const f of QUEDA) await entrarUmFechamento(f)
  const execucoes = await db.collection('automation_runs').find({ ownerId: DONO }).toArray()
  const { processRun } = await import('../dist/automations/runProcessor.js')
  for (const e of execucoes) await processRun(e._id.toString())

  const { listActivity } = await import('../dist/activity/timeline.js')
  const linha = await listActivity({ ownerId: DONO, limit: 50 })
  assert.ok(linha.items.length > 0, 'uma cadeia que não aparece na linha do tempo é invisível')

  // O CÁLCULO: uma raiz por leitura calculada, para uma função que para de calcular ser visível.
  const contas = linha.items.filter((i) => i.executionKey.startsWith('manual:indicador:'))
  assert.ok(contas.length > 0, `nenhum cálculo na Activity: ${JSON.stringify(linha.items.map((i) => i.executionKey))}`)
  assert.ok(contas.every((c) => c.status === 'succeeded'), 'um cálculo que falhou não pode aparecer como sucesso')

  // O DISPARO e a EXECUÇÃO: a origem no monitor, e o Flow que rodou.
  const daVigilancia = linha.items.find((i) => i.origin?.kind === 'monitor')
  assert.ok(daVigilancia, `nenhuma execução com origem no monitor: ${JSON.stringify(linha.items.map((i) => i.origin))}`)
  const monitor = await db.collection('monitors').findOne({ ownerId: DONO })
  assert.equal(daVigilancia.origin.id, monitor._id.toString())
  assert.ok(daVigilancia.flow, 'sem o Flow, a linha não diz o que rodou')

  // O ENVIO: contado pelo passo que o executa, não por um contador próprio.
  assert.equal(daVigilancia.deliveries, 1, `esperava uma entrega na linha, veio ${daVigilancia.deliveries}`)
  assert.ok(
    daVigilancia.steps.some((p) => p.stepType === 'delivery.send' && p.status === 'succeeded'),
    `o passo de entrega precisa aparecer: ${JSON.stringify(daVigilancia.steps)}`,
  )
})

test('AMEAÇA: nem o plano, nem o inventário, nem a Activity carregam credencial ou endereço', async () => {
  const { id } = await ateNoAr()
  for (const f of SUBIDA) await entrarUmFechamento(f)

  const projeto = await repo.getProject(DONO, new ObjectId(id))
  const plano = JSON.stringify(projeto.blueprintV2)
  assert.equal(/5511999999999/.test(plano), false, 'o número de destino entrou no plano — ele é lido pela tela e viaja no histórico')
  assert.equal(/nao-e-segredo-de-verdade|apikey/i.test(plano), false, 'credencial dentro do Blueprint')

  const { listActivity } = await import('../dist/activity/timeline.js')
  const linha = JSON.stringify(await listActivity({ ownerId: DONO, limit: 50 }))
  assert.equal(/5511999999999/.test(linha), false, 'o destino apareceu inteiro na Activity')

  // A entrega guarda o destino MASCARADO — é o que permite auditar sem expor.
  const [entrega] = await db.collection('deliveries').find({ ownerId: DONO }).toArray()
  if (entrega) assert.notEqual(entrega.destinationMasked, '5511999999999', 'o destino precisa sair mascarado')
})

test('AMEAÇA: o canal que RECUSA não vira entrega enviada — e o motivo fica gravado', async () => {
  await ateNoAr()
  for (const f of SUBIDA) await entrarUmFechamento(f)
  canalRecusa = true
  for (const f of QUEDA) await entrarUmFechamento(f)

  const [execucao] = await db.collection('automation_runs').find({ ownerId: DONO }).toArray()
  assert.ok(execucao, 'a transição precisa ter disparado para haver o que entregar')
  const { processRun } = await import('../dist/automations/runProcessor.js')
  await processRun(execucao._id.toString())

  const [entrega] = await db.collection('deliveries').find({ ownerId: DONO }).toArray()
  assert.ok(entrega, 'a tentativa precisa ficar registrada mesmo quando falha')
  assert.equal(entrega.status, 'failed', 'uma entrega que o canal recusou não pode constar como enviada')
  assert.ok(entrega.error?.message, 'sem motivo, a falha não é investigável')
  // E a mensagem crua do outro lado não entra: ela é conteúdo de terceiro.
  assert.equal(/instancia fora do ar/.test(JSON.stringify(entrega)), false, 'a resposta do provedor foi ecoada')

  const { listActivity } = await import('../dist/activity/timeline.js')
  const linha = await listActivity({ ownerId: DONO, limit: 20 })
  const daVigilancia = linha.items.find((i) => i.origin?.kind === 'monitor')
  assert.ok(daVigilancia, 'a execução precisa aparecer na Activity mesmo tendo falhado')
  assert.equal(daVigilancia.deliveries, 0, 'uma entrega falha não pode ser contada como saída')
})

test('ACEITAÇÃO: enquanto o RSI não cruza, NENHUM token é gasto', async () => {
  /**
   * A vigilância que custa dinheiro parada é a que ninguém deixa ligada.
   *
   * Vinte e uma leituras entram, o RSI é calculado em todas, e a condição não acontece: o
   * caminho inteiro — coleta, conta, observação — é determinístico e não passa por modelo
   * nenhum. Um agente no meio disso cobraria por candle, e a conta chegaria no fim do mês.
   */
  await ateNoAr()
  await db.collection('token_usage').deleteMany({ ownerId: DONO })

  // A série que SOBE: a condição "abaixo de 30" nunca fica verdadeira.
  for (const f of SUBIDA) await entrarUmFechamento(f)

  const gasto = await db.collection('token_usage').find({ ownerId: DONO }).toArray()
  const total = gasto.reduce((s, d) => s + (d.inputTokens ?? 0) + (d.outputTokens ?? 0), 0)
  assert.equal(total, 0, `a vigilância parada gastou ${total} tokens: ${JSON.stringify(gasto)}`)

  // E nada disparou, que é o outro lado da mesma afirmação.
  assert.equal(await db.collection('automation_runs').countDocuments({ ownerId: DONO }), 0)

  // A prova de que o teste está medindo alguma coisa: as contas ACONTECERAM.
  const derivado = await db.collection('data_recorders').findOne({ ownerId: DONO, derivedFrom: { $ne: null } })
  const calculados = await db.collection('data_history_records').countDocuments({ ownerId: DONO, recorderId: derivado._id })
  assert.ok(calculados > 0, 'nenhum RSI foi calculado — o zero de tokens seria trivial')
})
