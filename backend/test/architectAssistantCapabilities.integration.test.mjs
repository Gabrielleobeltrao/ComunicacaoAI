// O QUE O ASSISTENTE PODE FAZER — e a fronteira que impede o resto.
//
// O modelo diz o que a pessoa quer. Ele não escolhe id, credencial, endereço nem comando: o
// servidor resolve o NOME contra o inventário owner-scoped e chama um handler registrado.
//
// Estes casos protegem três coisas que um prompt não protegeria: a resposta sobre o AGORA vem
// de uma fonte real com origem e horário; a escrita nunca sai da conversa; e a confirmação
// confere hash, prazo e posse no instante do clique.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { mongoClient, db } = await import('../dist/db.js')
const cap = await import('../dist/architect/assistantCapabilities.js')
const op = await import('../dist/architect/assistantOperate.js')
const assistente = await import('../dist/architect/assistant.js')
const svc = await import('../dist/monitoring/service.js')
const { setProviderApiKey } = await import('../dist/userSettings.js')

const DONO = 'dono-capacidades'
const VIZINHO = 'vizinho'

before(async () => {
  await mongoClient.connect()
  await op.ensurePendingOperationIndexes()
})
after(async () => {
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['monitoring_sources', 'live_data', 'architect_pending_operations', 'buildings', 'offices', 'agents', 'user_settings', 'audit_events'])
    await db.collection(c).deleteMany({})
  await setProviderApiKey(DONO, 'anthropic', 'chave-de-teste-que-nao-e-segredo')
})

const respondendo = (json) => async () => ({ text: JSON.stringify(json), usage: { inputTokens: 1, outputTokens: 1 } })

/** Uma fonte ao vivo, com leitura recente — o caminho feliz da consulta de agora. */
const fonteComValor = async (over = {}) => {
  const fonte = await svc.createSource(DONO, {
    name: 'Dólar comercial',
    kind: 'api_polling',
    config: { url: 'https://api.exemplo.test/dolar', method: 'GET' },
    mapping: { version: 1, fields: [{ to: 'preco', from: 'preco', transforms: [{ op: 'number' }], required: true }] },
    cadence: { mode: 'interval', intervalMs: 60_000 },
    destination: { live: true, history: false },
    ...over,
  })
  await db.collection('monitoring_sources').updateOne({ _id: fonte._id }, { $set: { status: 'active' } })
  await db.collection('live_data').insertOne({
    _id: `${DONO}:${svc.liveConnectionOf(fonte._id)}:preco`,
    ownerId: DONO,
    connectionId: svc.liveConnectionOf(fonte._id),
    key: 'preco',
    value: 5.42,
    updates: 3,
    receivedAt: new Date(),
    expiresAt: new Date(Date.now() + 3600_000),
  })
  return fonte
}

// --- responder o AGORA ---------------------------------------------------------------------

test('ACEITAÇÃO: com fonte conectada, a resposta traz VALOR, FONTE e HORÁRIO', async () => {
  await fonteComValor()
  const r = await assistente.runAssistantTurn({
    ownerId: DONO,
    message: 'qual o valor do dólar hoje?',
    ask: respondendo({ mode: 'answer', query: 'dólar', freshness: 'current' }),
  })
  assert.equal(r.phase, 'done', r.text)
  assert.match(r.text, /5\.42/, 'o valor precisa aparecer')
  assert.match(r.text, /Dólar comercial/, 'sem a fonte, ninguém sabe de onde veio')
  assert.match(r.text, /agora mesmo|há \d+ (minuto|hora)/, 'sem o horário, o número não é do agora')
  assert.ok(r.provenance?.at, 'a procedência é estruturada, não só texto')
})

test('sem fonte conectada, a resposta é uma RECUSA acionável — nenhum número inventado', async () => {
  const r = await assistente.runAssistantTurn({
    ownerId: DONO,
    message: 'qual o valor do dólar hoje?',
    ask: respondendo({ mode: 'answer', query: 'dólar', freshness: 'current' }),
  })
  assert.equal(r.phase, 'failed')
  assert.match(r.text, /Conecte um App ou uma fonte/)
  assert.equal(/\d+[.,]\d{2}/.test(r.text), false, 'um número com cara de cotação é pior que nenhum')
})

test('a fonte que existe mas está PARADA não responde — e diz o que fazer', async () => {
  const fonte = await fonteComValor()
  await db.collection('monitoring_sources').updateOne({ _id: fonte._id }, { $set: { status: 'paused' } })
  const r = await assistente.runAssistantTurn({
    ownerId: DONO,
    message: 'qual o valor do dólar?',
    ask: respondendo({ mode: 'answer', query: 'dólar', freshness: 'current' }),
  })
  assert.equal(r.phase, 'failed')
  assert.match(r.text, /parada|rascunho/)
})

test('AMEAÇA: dado VELHO não é apresentado como o de agora', async () => {
  const fonte = await fonteComValor()
  // Uma leitura de duas horas atrás, muito além do frescor declarado pela fonte.
  await db.collection('live_data').updateMany({ connectionId: svc.liveConnectionOf(fonte._id) }, { $set: { receivedAt: new Date(Date.now() - 2 * 3600_000) } })
  const r = await assistente.runAssistantTurn({
    ownerId: DONO,
    message: 'qual o valor do dólar agora?',
    ask: respondendo({ mode: 'answer', query: 'dólar', freshness: 'current' }),
  })
  assert.equal(r.phase, 'failed')
  assert.match(r.text, /min atrás/)
  assert.equal(/5\.42/.test(r.text), false, 'o número velho não pode sair como se fosse de agora')
})

test('AMEAÇA: a fonte de OUTRA conta não é alcançada', async () => {
  const alheia = await svc.createSource(VIZINHO, {
    name: 'Dólar comercial',
    kind: 'api_polling',
    config: { url: 'https://api.exemplo.test/d', method: 'GET' },
    mapping: { version: 1, fields: [{ to: 'preco', from: 'p', required: true }] },
    cadence: { mode: 'interval', intervalMs: 60_000 },
    destination: { live: true, history: false },
  })
  await db.collection('monitoring_sources').updateOne({ _id: alheia._id }, { $set: { status: 'active' } })

  const r = await assistente.runAssistantTurn({
    ownerId: DONO,
    message: 'qual o valor do dólar?',
    ask: respondendo({ mode: 'answer', query: 'dólar', freshness: 'current' }),
  })
  assert.equal(r.phase, 'failed', 'responder pela fonte do vizinho seria vazamento')
})

// --- a escrita: prévia, hash, prazo e confirmação --------------------------------------------

const prepararPausa = async () => {
  const fonte = await fonteComValor()
  const r = await assistente.runAssistantTurn({
    ownerId: DONO,
    message: 'pause a fonte do dólar',
    ask: respondendo({ mode: 'operate', action: 'pausar a fonte', risk: 'write', targetRef: 'Dólar comercial' }),
  })
  return { fonte, turno: r }
}

test('ACEITAÇÃO: a escrita para na prévia, com impacto, hash e prazo — e não altera nada', async () => {
  const { fonte, turno } = await prepararPausa()
  assert.equal(turno.phase, 'awaiting_approval', turno.text)
  assert.ok(turno.pendingOperation?.id)
  assert.ok(turno.pendingOperation?.operationHash)
  assert.ok(turno.pendingOperation?.impact.length)
  assert.ok(new Date(turno.pendingOperation.expiresAt).getTime() > Date.now())

  const depois = await db.collection('monitoring_sources').findOne({ _id: fonte._id })
  assert.equal(depois.status, 'active', 'a prévia escreveu — e ela é uma prévia')
})

test('confirmar com o hash vigente EXECUTA, e uma segunda confirmação não repete', async () => {
  const { fonte, turno } = await prepararPausa()
  const r = await op.confirmarOperacao(DONO, { id: turno.pendingOperation.id, operationHash: turno.pendingOperation.operationHash })
  assert.equal(r.ok, true, r.ok ? '' : r.reason)
  assert.equal((await db.collection('monitoring_sources').findOne({ _id: fonte._id })).status, 'paused')

  const denovo = await op.confirmarOperacao(DONO, { id: turno.pendingOperation.id, operationHash: turno.pendingOperation.operationHash })
  assert.equal(denovo.ok, false)
  assert.equal(denovo.code, 'already_done', 'dois cliques confirmam uma vez')
})

test('AMEAÇA: hash VENCIDO é recusado — o retrato mudou', async () => {
  const { fonte, turno } = await prepararPausa()
  // Alguém pausou a fonte por outro caminho entre a prévia e o clique.
  await db.collection('monitoring_sources').updateOne({ _id: fonte._id }, { $set: { status: 'paused' } })

  const r = await op.confirmarOperacao(DONO, { id: turno.pendingOperation.id, operationHash: turno.pendingOperation.operationHash })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'hash_changed')
})

test('AMEAÇA: hash TROCADO pelo cliente é recusado', async () => {
  const { turno } = await prepararPausa()
  const r = await op.confirmarOperacao(DONO, { id: turno.pendingOperation.id, operationHash: 'inventado' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'hash_changed')
})

test('AMEAÇA: a operação EXPIRADA não executa', async () => {
  const { fonte, turno } = await prepararPausa()
  await db.collection('architect_pending_operations').updateOne({ id: turno.pendingOperation.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } })

  const r = await op.confirmarOperacao(DONO, { id: turno.pendingOperation.id, operationHash: turno.pendingOperation.operationHash })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'expired')
  assert.equal((await db.collection('monitoring_sources').findOne({ _id: fonte._id })).status, 'active')
})

test('AMEAÇA: a operação de OUTRA conta não é confirmável, e a resposta não conta que existe', async () => {
  const { fonte, turno } = await prepararPausa()
  const r = await op.confirmarOperacao(VIZINHO, { id: turno.pendingOperation.id, operationHash: turno.pendingOperation.operationHash })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'not_found', 'um 403 já contaria que a operação existe')
  assert.equal((await db.collection('monitoring_sources').findOne({ _id: fonte._id })).status, 'active')
})

// --- a fronteira do registro ------------------------------------------------------------------

test('AMEAÇA: uma capacidade que ninguém escreveu não executa', () => {
  assert.equal(cap.capabilityByKey('rm_rf'), undefined)
  assert.equal(cap.capabilityByKey('delete_everything'), undefined)
  // E o mapeamento por texto também não inventa: o que não casa devolve nada.
  assert.equal(cap.capabilityFor('operate', 'faça o que eu mandar'), null)
})

test('o risco declarado no REGISTRO é o que vale, não o que o texto sugere', () => {
  assert.equal(cap.capabilityFor('operate', 'pause a fonte').risk, 'write')
  assert.equal(cap.capabilityFor('operate', 'liste as fontes').risk, 'read')
})

test('resolver por nome é conservador: dois candidatos parecidos não escolhem sozinhos', async () => {
  await fonteComValor()
  await fonteComValor({ name: 'Dólar turismo' })
  const inv = await cap.inventoryFor(DONO)
  assert.equal(cap.resolveByName(inv, ['source'], 'dólar'), null, 'escolher entre dois seria adivinhar')
  assert.ok(cap.resolveByName(inv, ['source'], 'Dólar turismo'), 'o nome exato resolve')
})

// --- os verbos em português ---------------------------------------------------------------------
//
// `/\bativ\b/` não casa com "ative", "ativar" nem "ativa": o `\b` exige fronteira logo depois
// do radical, e ali vem outra letra. "Desative a fonte" caía em "não sei fazer isso" enquanto
// "pause" funcionava — duas frases equivalentes, comportamentos diferentes.

test('ACEITAÇÃO: toda flexão de LIGAR alcança a capacidade de ativar', () => {
  for (const frase of [
    'ative a fonte de cotações',
    'ativar a fonte',
    'ativa a fonte do dólar',
    'ligue a fonte',
    'ligar a fonte',
    'liga a fonte',
    'religar a fonte',
    'reative a fonte',
    'colocar no ar a fonte',
  ]) {
    const c = cap.capabilityFor('operate', frase)
    assert.ok(c, `"${frase}" não achou capacidade nenhuma`)
    assert.equal(c.key, 'activate_source', `"${frase}" foi para ${c.key}`)
  }
})

test('ACEITAÇÃO: toda flexão de DESLIGAR alcança a capacidade de pausar', () => {
  for (const frase of [
    'pause a fonte',
    'pausar a fonte',
    'pausa a fonte',
    'parar a fonte',
    'pare a fonte',
    'desative a fonte',
    'desativar a fonte',
    'desativa a fonte',
    'desliga a fonte',
    'desligar a fonte',
    'suspenda a fonte',
  ]) {
    const c = cap.capabilityFor('operate', frase)
    assert.ok(c, `"${frase}" não achou capacidade nenhuma`)
    assert.equal(c.key, 'pause_source', `"${frase}" foi para ${c.key}`)
  }
})

test('"desativar" NÃO cai em ativar — a ordem do teste importa', () => {
  // "desativar" contém "ativar": testar o ligar primeiro faria o desligar virar ligar, que é
  // o erro mais caro possível neste mapeamento.
  for (const frase of ['desativar a fonte', 'desative agora', 'desativa isso']) {
    assert.equal(cap.capabilityFor('operate', frase).key, 'pause_source', frase)
  }
})

test('acento não muda o verbo', () => {
  assert.equal(cap.capabilityFor('operate', 'páre a fonte')?.key, 'pause_source')
  assert.equal(cap.capabilityFor('operate', 'atíve a fonte')?.key, 'activate_source')
})

test('as flexões de LISTAR alcançam a listagem', () => {
  for (const frase of ['liste as fontes', 'listar fontes', 'lista as fontes', 'mostre os monitores', 'mostrar Flows', 'quais são meus agentes']) {
    assert.equal(cap.capabilityFor('operate', frase)?.key, 'list_resources', frase)
  }
})

test('AMEAÇA: uma frase sem verbo conhecido continua sem capacidade', () => {
  for (const frase of ['faça o que eu mandar', 'resolva isso', 'sei lá']) {
    assert.equal(cap.capabilityFor('operate', frase), null, frase)
  }
})

// --- qual provedor o chat usa --------------------------------------------------------------------
//
// `/assistant/turn` fixava Anthropic. Numa conta que só configurou OpenAI, a busca pela chave
// não achava nada e a rodada caía na heurística — em silêncio, sem dizer que a chave existente
// não era a procurada.

test('ACEITAÇÃO: conta só com OPENAI classifica com OpenAI, e não cai na heurística', async () => {
  await db.collection('user_settings').deleteMany({})
  await setProviderApiKey(DONO, 'openai', 'chave-de-teste-que-nao-e-segredo')

  let usado = null
  const espiao = async (provider) => {
    usado = provider
    return { text: JSON.stringify({ mode: 'explain', question: 'x' }), usage: { inputTokens: 1, outputTokens: 1 } }
  }
  const r = await assistente.runAssistantTurn({ ownerId: DONO, message: 'o que eu tenho aqui?', ask: espiao })
  assert.equal(usado, 'openai', 'o provedor configurado precisa ser o consultado')
  assert.equal(r.intent.mode, 'explain', 'a classificação do modelo é a que vale')
})

test('conta só com ANTHROPIC continua usando Anthropic', async () => {
  let usado = null
  const espiao = async (provider) => {
    usado = provider
    return { text: JSON.stringify({ mode: 'explain', question: 'x' }), usage: { inputTokens: 1, outputTokens: 1 } }
  }
  await assistente.runAssistantTurn({ ownerId: DONO, message: 'o que eu tenho?', ask: espiao })
  assert.equal(usado, 'anthropic')
})

test('sem provedor nenhum, a heurística responde — e a rodada termina', async () => {
  await db.collection('user_settings').deleteMany({})
  let chamou = false
  const espiao = async () => {
    chamou = true
    return { text: '{}', usage: { inputTokens: 1, outputTokens: 1 } }
  }
  const r = await assistente.runAssistantTurn({ ownerId: DONO, message: 'liste minhas fontes', ask: espiao })
  assert.equal(chamou, false, 'sem chave, não se chama o provedor')
  assert.ok(['done', 'failed'].includes(r.phase))
  assert.ok(r.text.trim(), 'uma rodada sem texto deixa o campo bloqueado')
})

test('ACEITAÇÃO: pergunta ESTÁTICA com OpenAI configurada responde de verdade', async () => {
  await db.collection('user_settings').deleteMany({})
  await setProviderApiKey(DONO, 'openai', 'chave-de-teste-que-nao-e-segredo')

  const provedores = []
  const espiao = async (provider, prompt) => {
    provedores.push(provider)
    // A segunda chamada é a da resposta em si; a primeira, a da classificação.
    const ehIntencao = prompt.includes('classifica a INTENÇÃO')
    return {
      text: ehIntencao ? JSON.stringify({ mode: 'answer', query: 'o que é RSI', freshness: 'static' }) : 'O RSI mede a força relativa de um preço entre 0 e 100.',
      usage: { inputTokens: 1, outputTokens: 1 },
    }
  }
  const r = await assistente.runAssistantTurn({ ownerId: DONO, message: 'o que é RSI?', ask: espiao })
  assert.deepEqual(provedores, ['openai', 'openai'], 'as duas chamadas usam o provedor da conta')
  assert.equal(r.phase, 'done')
  assert.match(r.text, /força relativa/, 'a resposta estática precisa chegar ao usuário')
})

// --- o que sobra depois da execução: estado, resultado e recuperação ---------------------------

test('CARACTERIZAÇÃO: a operação guarda o RESULTADO da execução, e não só a confirmação', async () => {
  const { turno } = await prepararPausa()
  await op.confirmarOperacao(DONO, { id: turno.pendingOperation.id, operationHash: turno.pendingOperation.operationHash })

  const doc = await db.collection('architect_pending_operations').findOne({ id: turno.pendingOperation.id })
  assert.equal(doc.outcome, 'succeeded', 'sem o desfecho gravado, "confirmada" não distingue o que deu certo do que estourou')
  assert.ok(doc.outcomeAt instanceof Date, 'sem quando, a auditoria não consegue ordenar a tentativa')
})

test('AMEAÇA: o handler que ESTOURA não vira sucesso — e a operação diz que falhou', async () => {
  const { fonte, turno } = await prepararPausa()

  /**
   * O handler quebra DEPOIS de a operação ser tomada — a janela em que o registro mentiria.
   *
   * Antes disto, `confirmedAt` era gravado e a exceção subia: a operação ficava "confirmada"
   * para sempre, a segunda tentativa lia "já foi confirmada", e ninguém conseguia distinguir
   * uma pausa que aconteceu de uma que explodiu no meio.
   */
  const capMod = await import('../dist/architect/assistantCapabilities.js')
  const alvo = await db.collection('architect_pending_operations').findOne({ id: turno.pendingOperation.id })
  const original = capMod.capabilityByKey(alvo.capabilityKey)
  const run = original?.run
  assert.ok(run, `a capacidade "${alvo.capabilityKey}" precisa existir para este teste dizer alguma coisa`)
  original.run = async () => {
    throw new Error('o provedor caiu no meio')
  }
  try {
    await assert.rejects(
      () => op.confirmarOperacao(DONO, { id: alvo.id, operationHash: alvo.operationHash }),
      /provedor caiu/,
      'a exceção precisa subir para a rota poder auditá-la',
    )
  } finally {
    original.run = run
  }

  const doc = await db.collection('architect_pending_operations').findOne({ id: alvo.id })
  assert.equal(doc.outcome, 'failed', 'uma falha registrada como sucesso é a pior linha de auditoria possível')
  assert.match(String(doc.outcomeReason ?? ''), /caiu|falh/i, 'sem motivo, a falha não é investigável')
  // Nada foi escrito: a fonte continua como estava.
  assert.equal((await db.collection('monitoring_sources').findOne({ _id: fonte._id })).status, 'active')

  // E a segunda tentativa NÃO mente dizendo que já foi feita.
  const denovo = await op.confirmarOperacao(DONO, { id: alvo.id, operationHash: alvo.operationHash })
  assert.equal(denovo.ok, false)
  assert.match(denovo.reason, /não deu certo|falhou|peça de novo/i, `a pessoa precisa saber que pode pedir de novo: "${denovo.reason}"`)
})

test('a RECUSA do handler também fica gravada — ela não é sucesso nem falha de sistema', async () => {
  const { turno } = await prepararPausa()
  const capMod = await import('../dist/architect/assistantCapabilities.js')
  const alvo = await db.collection('architect_pending_operations').findOne({ id: turno.pendingOperation.id })
  const original = capMod.capabilityByKey(alvo.capabilityKey)
  const run = original.run
  original.run = async () => ({ ok: false, reason: 'a fonte pertence a outro andar' })
  try {
    const r = await op.confirmarOperacao(DONO, { id: turno.pendingOperation.id, operationHash: turno.pendingOperation.operationHash })
    assert.equal(r.ok, false)
    assert.equal(r.code, 'refused')
  } finally {
    original.run = run
  }

  const doc = await db.collection('architect_pending_operations').findOne({ id: turno.pendingOperation.id })
  assert.equal(doc.outcome, 'refused')
  assert.match(String(doc.outcomeReason ?? ''), /outro andar/)
})

test('AUDITORIA: a tentativa que ESTOURA no handler também deixa linha', async () => {
  const { turno } = await prepararPausa()
  const alvo = await db.collection('architect_pending_operations').findOne({ id: turno.pendingOperation.id })

  const express = (await import('express')).default
  const { architectRouter } = await import('../dist/routes/architectRoutes.js')
  const app = express()
  app.use(express.json())
  app.use((_req, res, next) => {
    res.locals.userId = DONO
    next()
  })
  app.use('/api/architect', architectRouter)
  // O manipulador de erro do Express: sem ele a exceção derruba a resposta e o teste mede o silêncio.
  app.use((_erro, _req, res, _next) => res.status(500).json({ message: 'erro' }))
  const servidor = await new Promise((r) => {
    const s = app.listen(0, () => r(s))
  })
  const porta = servidor.address().port

  const capMod = await import('../dist/architect/assistantCapabilities.js')
  const capacidade = capMod.capabilityByKey(alvo.capabilityKey)
  const run = capacidade.run
  capacidade.run = async () => {
    throw new Error('o provedor caiu no meio')
  }
  try {
    await db.collection('audit_events').deleteMany({})
    const r = await fetch(`http://127.0.0.1:${porta}/api/architect/assistant/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: alvo.id, operationHash: alvo.operationHash }),
    })
    assert.equal(r.status, 500)

    const linhas = await db.collection('audit_events').find({ entityType: 'architect_operation' }).toArray()
    assert.equal(linhas.length, 1, 'uma escrita confirmada por alguém não pode sumir da auditoria por ter estourado')
    assert.equal(linhas[0].result, 'failure')
    assert.equal(linhas[0].entityId, alvo.id, 'sem o id, a linha não diz QUAL operação falhou')
    // A mensagem crua não entra: ela conta caminho de arquivo e valor de variável.
    assert.equal(/provedor caiu/.test(JSON.stringify(linhas[0])), false, 'a exceção crua vazou para a auditoria')
  } finally {
    capacidade.run = run
    servidor.close()
  }
})
