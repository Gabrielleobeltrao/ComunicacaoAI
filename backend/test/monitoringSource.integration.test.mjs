// A CENTRAL — orquestração, e o pipeline inteiro sem motor novo.
//
//   fonte → coleta → mapeamento → schema → recorder → dataset → monitor → Flow
//
// Estes casos cobrem as juntas: a fonte que testa de verdade, o destino materializado no
// subsistema canônico, a telemetria que é gravada inclusive quando falha, e as recusas que
// impedem uma fonte de nascer batendo num servidor de terceiro.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { ObjectId } from 'mongodb'
import { startMongo, stopMongo } from './helpers/mongoServer.mjs'

process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = await startMongo()
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'
// O guarda de SSRF recusa loopback por padrão — e é isso que este teste quer exercitar
// nos casos de ameaça. Para os casos felizes, o alvo local é liberado explicitamente.
process.env.ALLOW_LOOPBACK_HTTP_TARGETS = '1'

const { mongoClient, db } = await import('../dist/db.js')
const svc = await import('../dist/monitoring/service.js')
const { collectOnce, extractJsonLd, extractBySelector } = await import('../dist/monitoring/collect.js')
const { ensureDataHistoryIndexes } = await import('../dist/dataHistory/store.js')

const DONO = 'dono-central'
let servidor
let porta
let corpoAtual
let tipoAtual
let pedidos

before(async () => {
  await mongoClient.connect()
  await svc.ensureMonitoringIndexes()
  await ensureDataHistoryIndexes()
  servidor = createServer((req, res) => {
    pedidos.push({ url: req.url, headers: req.headers })
    if (req.url?.startsWith('/erro')) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end('{"detail":"quebrou"}')
      return
    }
    res.writeHead(200, { 'content-type': tipoAtual })
    res.end(corpoAtual)
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  porta = servidor.address().port
})

after(async () => {
  await new Promise((r) => servidor.close(r))
  await mongoClient.close().catch(() => undefined)
  await stopMongo()
})

beforeEach(async () => {
  for (const c of ['monitoring_sources', 'data_recorders', 'data_history_records', 'connections', 'buildings', 'live_data', 'realtime_sources'])
    await db.collection(c).deleteMany({})
  corpoAtual = JSON.stringify({ dados: { preco: '1.234,56', nome: '  ACME  ' } })
  tipoAtual = 'application/json'
  pedidos = []
})

const entrada = (over = {}) => ({
  name: 'Preço do fornecedor',
  kind: 'api_polling',
  config: { url: `http://127.0.0.1:${porta}/precos`, method: 'GET' },
  mapping: {
    version: 1,
    fields: [
      { to: 'preco', from: 'dados.preco', transforms: [{ op: 'number' }], required: true },
      { to: 'nome', from: 'dados.nome', transforms: [{ op: 'trim' }] },
    ],
  },
  cadence: { mode: 'interval', intervalMs: 60_000 },
  destination: { history: true },
  ...over,
})

// --- criar ------------------------------------------------------------------------------

test('toda fonte nasce RASCUNHO — antes disso ninguém bate num servidor de terceiro', async () => {
  const f = await svc.createSource(DONO, entrada())
  assert.equal(f.status, 'draft')
  assert.equal(f.telemetry.lastOkAt, null)
  // O schema é derivado do mapeamento: quem mapeou já disse a forma.
  assert.deepEqual(Object.keys(f.schema.properties).sort(), ['nome', 'preco'])
  assert.deepEqual(f.schema.required, ['preco'])
})

test('intervalo absurdo é recusado — um segundo não é monitoramento', async () => {
  await assert.rejects(() => svc.createSource(DONO, entrada({ cadence: { mode: 'interval', intervalMs: 1000 } })), /entre 15s e 24h/)
})

test('fonte que EMPURRA não aceita intervalo, e a que puxa exige um', async () => {
  await assert.rejects(
    () => svc.createSource(DONO, entrada({ kind: 'webhook', config: {}, cadence: { mode: 'interval', intervalMs: 60_000 } })),
    /chega sozinha/,
  )
  await assert.rejects(() => svc.createSource(DONO, entrada({ cadence: { mode: 'stream' } })), /escolha um intervalo/)
})

test('sem destino não há fonte: ler e jogar fora não é monitorar', async () => {
  await assert.rejects(() => svc.createSource(DONO, entrada({ destination: { live: false, history: false } })), /ao menos um destino/)
})

test('nome repetido é recusado pelo índice, e a mensagem é a que a pessoa lê', async () => {
  await svc.createSource(DONO, entrada())
  await assert.rejects(() => svc.createSource(DONO, entrada()), /já existe uma fonte/)
})

test('a fonte de outra conta não é encontrada, editada nem apagada', async () => {
  const f = await svc.createSource(DONO, entrada())
  assert.equal(await svc.getSource('vizinho', f._id), null)
  assert.equal(await svc.updateSource('vizinho', f._id, entrada()), null)
  assert.equal(await svc.deleteSource('vizinho', f._id), false)
})

// --- testar de verdade --------------------------------------------------------------------

test('ACEITAÇÃO: testar faz a leitura real e devolve amostra REDIGIDA e campos', async () => {
  corpoAtual = JSON.stringify({ dados: { preco: '1.234,56', nome: '  ACME  ', apiKey: 'nao-pode-aparecer' } })
  const r = await svc.testSource(DONO, entrada())

  assert.equal(r.ok, true)
  assert.equal(r.strategy, 'json')
  assert.deepEqual(r.rows, [{ preco: 1234.56, nome: 'ACME' }])
  assert.deepEqual(r.fields, [{ name: 'preco', present: true }, { name: 'nome', present: true }])
  assert.ok(r.latencyMs >= 0)
  // A amostra existe para conferir o mapeamento, não para expor o corpo numa tela que
  // alguém fotografa e cola num chamado.
  assert.equal(r.sample.dados.apiKey, '«oculto»')
  assert.equal(pedidos.length, 1, 'testar é uma leitura de verdade')
})

test('campo obrigatório ausente é REPORTADO, e não inventado', async () => {
  corpoAtual = JSON.stringify({ dados: { nome: 'ACME' } })
  const r = await svc.testSource(DONO, entrada())
  assert.deepEqual(r.missing, ['preco'])
  assert.equal(r.fields.find((f) => f.name === 'preco').present, false)
})

test('página de erro NÃO é lida como conteúdo', async () => {
  // Sem isso, uma instabilidade do servidor viraria "o site mudou".
  const r = await svc.testSource(DONO, entrada({ config: { url: `http://127.0.0.1:${porta}/erro` } }))
  assert.equal(r.ok, false)
  assert.ok(['http', 'timeout'].includes(r.error.kind))
})

// --- ameaça: SSRF -------------------------------------------------------------------------

test('AMEAÇA: endereço de rede privada é bloqueado na leitura', async () => {
  const antes = process.env.ALLOW_LOOPBACK_HTTP_TARGETS
  delete process.env.ALLOW_LOOPBACK_HTTP_TARGETS
  try {
    const r = await svc.testSource(DONO, entrada({ config: { url: 'http://127.0.0.1:1/x' } }))
    assert.equal(r.ok, false)
    assert.equal(r.error.kind, 'blocked', `veio ${r.error.kind}: ${r.error.message}`)
  } finally {
    process.env.ALLOW_LOOPBACK_HTTP_TARGETS = antes
  }
})

test('AMEAÇA: o metadata da nuvem é bloqueado', async () => {
  const antes = process.env.ALLOW_LOOPBACK_HTTP_TARGETS
  delete process.env.ALLOW_LOOPBACK_HTTP_TARGETS
  try {
    const r = await svc.testSource(DONO, entrada({ config: { url: 'http://169.254.169.254/latest/meta-data/' } }))
    assert.equal(r.ok, false)
    assert.equal(r.error.kind, 'blocked')
  } finally {
    process.env.ALLOW_LOOPBACK_HTTP_TARGETS = antes
  }
})

test('AMEAÇA: o REDIRECT também é revalidado — não só a URL digitada', async () => {
  // Quem revalida é `safeFetch`; o que este caso prova é que a Central passa por ele, e
  // não por um cliente HTTP próprio que aceitaria o segundo salto.
  let redirecionador
  const alvo = createServer((_req, res) => {
    res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
    res.end()
  })
  await new Promise((r) => alvo.listen(0, '127.0.0.1', r))
  try {
    redirecionador = `http://127.0.0.1:${alvo.address().port}/vai`
    const r = await svc.testSource(DONO, entrada({ config: { url: redirecionador } }))
    assert.equal(r.ok, false)
    assert.ok(['blocked', 'http'].includes(r.error.kind), `veio ${r.error.kind}`)
    assert.ok(!JSON.stringify(r).includes('meta-data'), 'nem o conteúdo nem o endereço do salto vazam')
  } finally {
    await new Promise((r) => alvo.close(r))
  }
})

// --- as estratégias de página -----------------------------------------------------------------

test('JSON-LD é lido antes do desenho da página', () => {
  // Ele é dado que o próprio site publicou; o seletor depende do layout, que muda quando o
  // designer mexe nele.
  const html = '<html><script type="application/ld+json">{"@type":"Product","offers":{"price":"9.90"}}</script></html>'
  assert.deepEqual(extractJsonLd(html), [{ '@type': 'Product', offers: { price: '9.90' } }])
})

test('um bloco de JSON-LD quebrado não invalida os outros', () => {
  const html = '<script type="application/ld+json">{quebrado}</script><script type="application/ld+json">{"a":1}</script>'
  assert.deepEqual(extractJsonLd(html), [{ a: 1 }])
})

test('o seletor lê o TEXTO, sem as etiquetas', () => {
  const html = '<div class="preco"><span>R$</span> 10,50</div>'
  assert.equal(extractBySelector(html, '.preco'), 'R$ 10,50')
  assert.equal(extractBySelector(html, '#nao-existe'), null)
})

test('a ordem das estratégias: JSON, depois JSON-LD, depois seletor', async () => {
  tipoAtual = 'text/html'
  corpoAtual = '<html><script type="application/ld+json">{"preco":"7,50","nome":"X"}</script><div class="p">ignorado</div></html>'
  // `selector` é de página, não de API: a união discriminada recusa o campo no tipo errado.
  const r = await svc.testSource(DONO, entrada({
    kind: 'http_page',
    config: { url: `http://127.0.0.1:${porta}/pagina`, selector: '.p' },
    mapping: { version: 1, fields: [{ to: 'preco', from: 'preco', transforms: [{ op: 'number' }] }] },
  }))
  assert.equal(r.strategy, 'jsonld', 'o JSON-LD ganha do seletor')
  assert.deepEqual(r.rows, [{ preco: 7.5 }])
})

test('página sem JSON e sem seletor recusa, em vez de adivinhar', async () => {
  tipoAtual = 'text/html'
  corpoAtual = '<html><body>só texto</body></html>'
  const r = await svc.testSource(DONO, entrada({ config: { url: `http://127.0.0.1:${porta}/p` } }))
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_supported')
})

// --- ativar e materializar o destino -----------------------------------------------------------

test('ativar EXIGE ter lido: o painel não nasce vermelho por configuração não testada', async () => {
  const f = await svc.createSource(DONO, entrada())
  await assert.rejects(() => svc.setSourceStatus(DONO, f._id, 'active'), /teste a fonte antes de ativar/)
})

test('ACEITAÇÃO: ativar materializa o RECORDER — e a coleta grava no histórico', async () => {
  const f = await svc.createSource(DONO, entrada())
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  const ativa = await svc.setSourceStatus(DONO, f._id, 'active')

  assert.equal(ativa.status, 'active')
  const recorder = await db.collection('data_recorders').findOne({ ownerId: DONO })
  assert.ok(recorder, 'o destino vive no subsistema canônico, não numa cópia')
  assert.equal(recorder.source.ref, `monitoring:${f._id.toString()}`)

  const r = await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  assert.equal(r.ok, true)
  assert.equal(r.recorded, 1)
  const registro = await db.collection('data_history_records').findOne({ ownerId: DONO })
  assert.equal(registro.value.preco, 1234.56)
})

test('a mesma leitura duas vezes grava UMA — o hash do conteúdo é a identidade', async () => {
  const f = await svc.createSource(DONO, entrada())
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')

  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  const segunda = await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  assert.equal(segunda.recorded, 0, 'o mesmo valor de novo não é uma segunda linha')
  assert.equal(await db.collection('data_history_records').countDocuments({ ownerId: DONO }), 1)
})

// --- telemetria ----------------------------------------------------------------------------------

test('a telemetria é gravada INCLUSIVE quando falha', async () => {
  // Um caminho de erro que sai sem escrever nada é uma fonte que quebra em silêncio e
  // continua verde na tela.
  const f = await svc.createSource(DONO, entrada({ config: { url: `http://127.0.0.1:${porta}/erro` } }))
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))

  const depois = await svc.getSource(DONO, f._id)
  assert.equal(depois.telemetry.consecutiveFailures, 1)
  assert.equal(depois.telemetry.readsFailed, 1)
  assert.ok(depois.telemetry.lastErrorCode)
  assert.equal(depois.telemetry.lastOkAt, null)
})

test('uma leitura boa zera as falhas seguidas', async () => {
  const f = await svc.createSource(DONO, entrada({ config: { url: `http://127.0.0.1:${porta}/erro` } }))
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.updateSource(DONO, f._id, entrada())
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))

  const depois = await svc.getSource(DONO, f._id)
  assert.equal(depois.telemetry.consecutiveFailures, 0)
  assert.equal(depois.telemetry.readsOk, 1)
})

test('campo obrigatório faltando não vira leitura boa — meia linha é pior que nenhuma', async () => {
  const f = await svc.createSource(DONO, entrada())
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')
  corpoAtual = JSON.stringify({ dados: { nome: 'ACME' } })

  const r = await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'schema')
  assert.equal(r.recorded, 0)
})

// --- duplicar, pausar, excluir ---------------------------------------------------------------------

test('duplicar NÃO herda telemetria nem ativação — a cópia nunca leu nada', async () => {
  const f = await svc.createSource(DONO, entrada())
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  const copia = await svc.duplicateSource(DONO, f._id)

  assert.match(copia.name, /\(cópia\)$/)
  assert.equal(copia.status, 'draft')
  assert.equal(copia.telemetry.lastOkAt, null)
  assert.equal(copia.destination.recorderId, null)
})

test('excluir a fonte NÃO leva o histórico junto', async () => {
  const f = await svc.createSource(DONO, entrada())
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))

  assert.equal(await svc.deleteSource(DONO, f._id), true)
  assert.equal(await db.collection('data_history_records').countDocuments({ ownerId: DONO }), 1, 'o que ela gravou é fato acontecido')
})

// --- a varredura e a visão geral ----------------------------------------------------------------------

test('só fonte ATIVA e puxada entra na varredura', async () => {
  const f = await svc.createSource(DONO, entrada())
  assert.equal((await svc.dueSources()).length, 0, 'rascunho não é varrido')

  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')
  // Acabou de ler: ainda não venceu.
  assert.equal((await svc.dueSources()).length, 0)

  await db.collection('monitoring_sources').updateOne({ _id: f._id }, { $set: { 'telemetry.lastReadAt': new Date(Date.now() - 300_000) } })
  assert.equal((await svc.dueSources()).length, 1)

  await svc.setSourceStatus(DONO, f._id, 'paused')
  assert.equal((await svc.dueSources()).length, 0)
})

test('a visão geral resume o que a pessoa precisa para decidir olhar', async () => {
  const f = await svc.createSource(DONO, entrada())
  const antes = await svc.overview(DONO)
  assert.equal(antes.summary.total, 1)
  assert.equal(antes.summary.neverRead, 0, 'rascunho é "pausado", e não "nunca leu"')
  assert.equal(antes.items[0].health, 'paused')

  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')
  const depois = await svc.overview(DONO)
  assert.equal(depois.summary.online, 1)
  assert.ok(depois.items[0].nextReadAt instanceof Date)
  assert.ok(depois.items[0].latencyMs >= 0)
})

test('a visão geral de uma conta não enxerga a outra', async () => {
  await svc.createSource(DONO, entrada())
  assert.equal((await svc.overview('vizinho')).summary.total, 0)
})

// --- o tipo que não é puxado ------------------------------------------------------------------------

test('coletar uma fonte que EMPURRA é recusado, e não fingido', async () => {
  const r = await collectOnce({ kind: 'webhook', config: {}, mapping: { version: 1, fields: [] }, retry: { timeoutMs: 1000 } })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'not_supported')
})

// --- AMEAÇA: segredo nunca fica na fonte ------------------------------------------------

test('AMEAÇA: credencial na QUERY é recusada na criação', async () => {
  // Uma chave na query viaja no log do outro lado, no referer e no histórico de quem colar
  // o endereço. Recusar na leitura seria tarde: gravada, ela já vazou para o documento.
  await assert.rejects(
    () => svc.createSource(DONO, entrada({ config: { url: `http://127.0.0.1:${porta}/x?api_key=abc123` } })),
    /parece uma credencial/,
  )
  await assert.rejects(
    () => svc.createSource(DONO, entrada({ config: { url: `http://127.0.0.1:${porta}/x`, query: [{ key: 'token', value: 'abc' }] } })),
    /parece uma credencial/,
  )
})

test('AMEAÇA: credencial no USUÁRIO da URL é recusada', async () => {
  await assert.rejects(
    () => svc.createSource(DONO, entrada({ config: { url: `http://user:senha@127.0.0.1:${porta}/x` } })),
    /tire a credencial do endereço/,
  )
})

test('AMEAÇA: token no CORPO é recusado', async () => {
  await assert.rejects(
    () => svc.createSource(DONO, entrada({ config: { url: `http://127.0.0.1:${porta}/x`, method: 'POST', body: '{"auth":"Bearer abcdefghijklmno"}' } })),
    /credencial/,
  )
})

test('parâmetro comum continua passando: a peneira é por credencial, não por query', async () => {
  const f = await svc.createSource(DONO, entrada({ config: { url: `http://127.0.0.1:${porta}/x?pagina=2`, query: [{ key: 'limite', value: '50' }] } }))
  assert.ok(f._id)
})

test('a fonte gravada não guarda valor de cabeçalho — só o NOME', async () => {
  const f = await svc.createSource(DONO, entrada({ config: { url: `http://127.0.0.1:${porta}/x`, headerNames: ['Authorization'] } }))
  const doc = await db.collection('monitoring_sources').findOne({ _id: f._id })
  const texto = JSON.stringify(doc)
  assert.ok(texto.includes('Authorization'), 'o nome viaja: é ele que diz o que a conexão preenche')
  assert.ok(!/Bearer|sk-|senha/.test(texto), 'o valor sai da conexão cifrada, na hora da leitura')
})

// --- os tipos que EMPURRAM: orquestração pura, sem caminho novo ----------------------------

test('fonte de EVENTO INTERNO liga o recorder no barramento, sem caminho novo', async () => {
  const f = await svc.createSource(DONO, entrada({
    kind: 'internal_event',
    config: { eventType: 'market.candle.closed' },
    cadence: { mode: 'stream' },
    mapping: { version: 1, fields: [{ to: 'rsi', from: 'rsi' }] },
  }))
  const ativa = await svc.setSourceStatus(DONO, f._id, 'active')
  assert.equal(ativa.status, 'active', 'quem empurra não precisa ter lido: ela nunca é chamada')

  const recorder = await db.collection('data_recorders').findOne({ ownerId: DONO })
  // O dado chega pelo mesmo lugar de sempre; a Central só disse que agora tem quem guarde.
  assert.deepEqual(recorder.source, { kind: 'event', ref: 'market.candle.closed' })
})

test('fonte de WEBSOCKET apontando para conexão de outra conta é RECUSADA', async () => {
  // Quem recusa é o guarda canônico do histórico, que confere a posse da conexão. É
  // exatamente por isso que a Central delega em vez de criar o recorder por conta própria:
  // o isolamento entre contas já está resolvido lá, e uma segunda checagem aqui seria uma
  // segunda opinião sobre a mesma coisa.
  const f = await svc.createSource(DONO, entrada({
    kind: 'websocket',
    config: { installationId: new ObjectId().toString() },
    cadence: { mode: 'stream' },
    mapping: { version: 1, fields: [{ to: 'preco', from: 'preco' }] },
  }))
  await assert.rejects(() => svc.setSourceStatus(DONO, f._id, 'active'), /conexão não existe nesta conta/)
  assert.equal(await db.collection('data_recorders').countDocuments({ ownerId: DONO }), 0)
})

test('fonte que empurra SEM dizer de onde nem CHEGA A EXISTIR', async () => {
  // Antes ela nascia e só era barrada na ativação. Com a união discriminada, o tipo diz o
  // que precisa e a recusa vem na criação — que é onde a pessoa ainda está olhando.
  await assert.rejects(
    () => svc.createSource(DONO, entrada({ kind: 'internal_event', config: {}, cadence: { mode: 'stream' }, mapping: { version: 1, fields: [{ to: 'a', from: 'a' }] } })),
    /eventType/,
  )
  await assert.rejects(
    () =>
      svc.createSource(DONO, entrada({
        name: 'WS sem conexão',
        kind: 'websocket',
        config: {},
        cadence: { mode: 'stream' },
        mapping: { version: 1, fields: [{ to: 'a', from: 'a' }] },
      })),
    /conexão do App/,
  )
})

test('ACEITAÇÃO: evento do barramento → recorder da fonte → dataset', async () => {
  const { ingestFact } = await import('../dist/dataHistory/engine.js')
  const { limparCacheDeRecorders } = await import('../dist/dataHistory/engine.js')
  const f = await svc.createSource(DONO, entrada({
    kind: 'internal_event',
    config: { eventType: 'market.candle.closed' },
    cadence: { mode: 'stream' },
    mapping: { version: 1, fields: [{ to: 'rsi', from: 'rsi' }] },
  }))
  await svc.setSourceStatus(DONO, f._id, 'active')
  limparCacheDeRecorders()

  // O fato entra pelo caminho de sempre — e a fonte não precisou de código próprio.
  const r = await ingestFact({ ownerId: DONO, sourceKey: 'event:market.candle.closed', entityKey: null, occurredAt: new Date(), value: { rsi: 12 }, factId: 'e1' })
  assert.equal(r.gravado, 1)
  const registro = await db.collection('data_history_records').findOne({ ownerId: DONO })
  assert.equal(registro.value.rsi, 12)
})

// --- RSS: parser de verdade, não caminho de página ------------------------------------

test('fonte RSS é lida como FEED, e não exige seletor CSS', async () => {
  // Antes, um RSS caía no caminho de página e a Central pedia CSS para um formato que já
  // é estruturado.
  tipoAtual = 'application/rss+xml'
  corpoAtual = '<rss><channel><item><guid>a1</guid><title>Alta do dólar</title><link>https://ex.test/1</link></item></channel></rss>'

  const r = await svc.testSource(DONO, entrada({
    kind: 'rss',
    config: { url: `http://127.0.0.1:${porta}/feed` },
    mapping: { version: 1, itemsPath: 'items', fields: [{ to: 'titulo', from: 'title', required: true }, { to: 'url', from: 'link' }] },
  }))

  assert.equal(r.ok, true)
  assert.equal(r.strategy, 'feed')
  assert.deepEqual(r.rows, [{ titulo: 'Alta do dólar', url: 'https://ex.test/1' }])
})

test('feed sem itens é recusado, e não vira leitura vazia boa', async () => {
  tipoAtual = 'application/rss+xml'
  corpoAtual = '<rss><channel></channel></rss>'
  const r = await svc.testSource(DONO, entrada({ kind: 'rss', config: { url: `http://127.0.0.1:${porta}/feed` } }))
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'empty')
})

// --- App/action e dataset como fonte ---------------------------------------------------

test('fonte de App sem instalação recusa pelo caminho de permissão de sempre', async () => {
  const r = await svc.testSource(DONO, entrada({
    kind: 'app_action',
    config: { appKey: 'crm', actionKey: 'listar', installationId: new ObjectId().toString() },
    mapping: { version: 1, fields: [{ to: 'a', from: 'a' }] },
  }))
  assert.equal(r.ok, false)
  assert.ok(['blocked', 'http'].includes(r.error.kind))
})

test('fonte de App sem dizer App e ação é recusada na CRIAÇÃO', async () => {
  await assert.rejects(
    () => svc.createSource(DONO, entrada({ kind: 'app_action', config: {}, mapping: { version: 1, fields: [{ to: 'a', from: 'a' }] } })),
    /appKey/,
  )
})

test('fonte de DATASET lê o que já está guardado', async () => {
  const { ensureDatabaseIndexes } = await import('../dist/databases/store.js')
  await ensureDatabaseIndexes()
  const dataStoreId = new ObjectId()
  const recorderId = new ObjectId()
  await db.collection('data_stores').insertOne({
    _id: dataStoreId,
    ownerId: DONO,
    buildingId: null,
    name: 'Hist',
    description: '',
    owner: { ownerType: 'account', ownerId: DONO },
    adapterKind: 'data_history',
    adapterConfig: {},
    status: 'active',
    retention: { mode: 'forever' },
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.collection('dataset_definitions').insertOne({
    ownerId: DONO,
    dataStoreId,
    key: recorderId.toString(),
    name: 'Série',
    schema: { type: 'object', properties: { preco: { type: 'number' } } },
    mutability: 'append_only',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.collection('data_history_records').insertOne({
    ownerId: DONO,
    recorderId,
    value: { preco: 33 },
    occurredAt: new Date(),
    recordedAt: new Date(),
    dedupeKey: 'd1',
  })

  const r = await svc.testSource(DONO, entrada({
    kind: 'dataset',
    config: { dataStoreId: dataStoreId.toString(), datasetKey: recorderId.toString() },
    cadence: { mode: 'interval', intervalMs: 60_000 },
    mapping: { version: 1, itemsPath: 'rows', fields: [{ to: 'preco', from: 'preco' }] },
  }))
  assert.equal(r.ok, true)
  assert.deepEqual(r.rows, [{ preco: 33 }])
})

test('fonte de dataset sem dizer o conjunto é recusada na CRIAÇÃO', async () => {
  await assert.rejects(
    () =>
      svc.createSource(DONO, entrada({
        kind: 'dataset',
        config: {},
        cadence: { mode: 'interval', intervalMs: 60_000 },
        mapping: { version: 1, fields: [{ to: 'a', from: 'a' }] },
      })),
    /dataStoreId/,
  )
})

// --- o AO VIVO: o que chegou, não quem está de pé ------------------------------------

test('o ao vivo devolve as ÚLTIMAS LEITURAS, e não só a lista de fontes', async () => {
  // A primeira versão desta aba listava nomes com bolinha verde e chamava isso de "ao
  // vivo". Quem abre quer ver o VALOR que acabou de entrar.
  const f = await svc.createSource(DONO, entrada())
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))

  const { items } = await svc.liveView(DONO)
  assert.equal(items.length, 1)
  assert.equal(items[0].readings.length, 1)
  assert.equal(items[0].readings[0].value.preco, 1234.56)
  assert.ok(items[0].readings[0].at instanceof Date)
  assert.equal(items[0].health, 'online')
})

test('o valor do ao vivo sai REDIGIDO', async () => {
  // Uma tela que fica aberta na parede do escritório não pode mostrar o que veio dentro
  // do payload.
  corpoAtual = JSON.stringify({ dados: { preco: '10,50', nome: 'ACME', apiKey: 'nao-pode-aparecer' } })
  const f = await svc.createSource(DONO, entrada({
    mapping: {
      version: 1,
      fields: [
        { to: 'preco', from: 'dados.preco', transforms: [{ op: 'number' }], required: true },
        { to: 'apiKey', from: 'dados.apiKey' },
      ],
    },
  }))
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))

  const { items } = await svc.liveView(DONO)
  assert.equal(items[0].readings[0].value.apiKey, '«oculto»')
  assert.equal(items[0].readings[0].value.preco, 10.5)
})

test('fonte pausada não aparece no ao vivo', async () => {
  const f = await svc.createSource(DONO, entrada())
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')
  await svc.setSourceStatus(DONO, f._id, 'paused')
  assert.equal((await svc.liveView(DONO)).items.length, 0)
})

test('o ao vivo de uma conta não enxerga a outra', async () => {
  const f = await svc.createSource(DONO, entrada())
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')
  assert.equal((await svc.liveView('vizinho')).items.length, 0)
})

// --- testar destrava ativar, sem virar leitura ------------------------------------------
//
// Testar prova a configuração; ler é o trabalho. Antes, o portão de ativação só aceitava
// `lastOkAt` — escrito pela coleta real — então quem testava com sucesso era empurrado a
// "coletar agora" só para destravar o botão, gravando histórico que não pediu.

test('testar com sucesso destrava a ativação de uma fonte pull que nunca coletou', async () => {
  const f = await svc.createSource(DONO, entrada())
  const r = await svc.testSource(DONO, await svc.getSource(DONO, f._id))
  assert.equal(r.ok, true)

  const depois = await svc.getSource(DONO, f._id)
  assert.ok(depois.telemetry.lastTestOkAt, 'o teste bem-sucedido deixa marca')
  assert.equal(depois.telemetry.lastOkAt, null, 'e o teste NÃO se disfarça de leitura')

  const ativa = await svc.setSourceStatus(DONO, f._id, 'active')
  assert.equal(ativa.status, 'active')
})

test('testar não grava histórico nem contamina a dedupe da primeira coleta', async () => {
  const f = await svc.createSource(DONO, entrada())
  await svc.testSource(DONO, await svc.getSource(DONO, f._id))

  const testada = await svc.getSource(DONO, f._id)
  assert.equal(testada.telemetry.lastContentHash ?? null, null, 'o hash do teste envenenaria a dedupe')
  assert.equal(testada.telemetry.readsOk, 0)
  assert.equal(testada.telemetry.lastReadAt, null)
  assert.equal(await db.collection('data_history_records').countDocuments({ ownerId: DONO }), 0)

  // E a primeira coleta de verdade grava — não acha que "não mudou".
  await svc.setSourceStatus(DONO, f._id, 'active')
  const leitura = await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  assert.equal(leitura.unchanged ?? false, false)
  assert.ok(leitura.recorded > 0, 'a primeira coleta real grava')
})

test('teste que falha marca o erro e continua barrando a ativação', async () => {
  const f = await svc.createSource(DONO, entrada({ config: { url: `http://127.0.0.1:${porta}/erro`, method: 'GET' } }))
  const r = await svc.testSource(DONO, await svc.getSource(DONO, f._id))
  assert.equal(r.ok, false)

  const depois = await svc.getSource(DONO, f._id)
  assert.ok(depois.telemetry.lastTestAt, 'a tentativa fica registrada')
  assert.equal(depois.telemetry.lastTestOkAt ?? null, null)
  assert.ok(depois.telemetry.lastTestError)

  await assert.rejects(() => svc.setSourceStatus(DONO, f._id, 'active'), /ainda não leu nada/)
})

// --- cadência: união validada, e o cron que entra na varredura --------------------------

test('cron inválido é recusado na criação — e não vira fonte ativa e muda', async () => {
  await assert.rejects(
    () => svc.createSource(DONO, entrada({ cadence: { mode: 'cron', cron: 'todo dia de manhã', timezone: 'UTC' } })),
    /não entendi esse horário/,
  )
  await assert.rejects(() => svc.createSource(DONO, entrada({ cadence: { mode: 'cron' } })), /escreva o horário em cron/)
})

test('cron válido é guardado com o fuso, e a fonte vencida aparece na varredura', async () => {
  const f = await svc.createSource(DONO, entrada({ cadence: { mode: 'cron', cron: '*/5 * * * *', timezone: 'America/Sao_Paulo' } }))
  assert.equal(f.cadence.mode, 'cron')
  assert.equal(f.cadence.cron, '*/5 * * * *')
  assert.equal(f.cadence.timezone, 'America/Sao_Paulo')
  assert.equal(f.cadence.intervalMs, null)

  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')

  // Uma hora depois da última leitura, um cron de 5 em 5 minutos está vencido há muito.
  const daquiUmaHora = new Date(Date.now() + 3_600_000)
  const vencidas = await svc.dueSources(daquiUmaHora, 50)
  assert.ok(
    vencidas.some((x) => x._id.equals(f._id)),
    'a fonte de horário precisa entrar na varredura — antes ela ficava fora para sempre',
  )
})

test('fonte que empurra continua sem cadência de consulta', async () => {
  await assert.rejects(
    () => svc.createSource(DONO, entrada({ kind: 'webhook', config: {}, cadence: { mode: 'cron', cron: '*/5 * * * *' } })),
    /chega sozinha/,
  )
})

// --- aluguel e backoff: dois processos, uma leitura ---------------------------------------

test('duas varreduras concorrentes NÃO levam a mesma fonte', async () => {
  const f = await svc.createSource(DONO, entrada())
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')

  const daquiUmMinuto = new Date(Date.now() + 120_000)
  const [a, b] = await Promise.all([svc.claimDueSources('worker-a', daquiUmMinuto), svc.claimDueSources('worker-b', daquiUmMinuto)])
  const levaram = [...a, ...b].filter((x) => x._id.equals(f._id))
  assert.equal(levaram.length, 1, 'só um processo pode ler a mesma fonte no mesmo instante')

  // Devolvido, ela volta a ser alugável — e por quem devolveu, não por qualquer um.
  const dono = a.some((x) => x._id.equals(f._id)) ? 'worker-a' : 'worker-b'
  await svc.releaseSource(f._id, 'quem-nao-alugou')
  assert.equal((await svc.claimDueSources('worker-c', daquiUmMinuto)).some((x) => x._id.equals(f._id)), false)
  await svc.releaseSource(f._id, dono)
  assert.equal((await svc.claimDueSources('worker-c', daquiUmMinuto)).some((x) => x._id.equals(f._id)), true)
})

test('o aluguel VENCE sozinho: um processo que morreu não trava a fonte para sempre', async () => {
  const f = await svc.createSource(DONO, entrada())
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')

  const daquiUmMinuto = new Date(Date.now() + 120_000)
  assert.equal((await svc.claimDueSources('worker-morto', daquiUmMinuto)).length, 1)
  // Nada é devolvido — o processo morreu. Passado o aluguel, outro pode pegar.
  const depoisDoAluguel = new Date(daquiUmMinuto.getTime() + svc.LEASE_MS + 1000)
  assert.equal((await svc.claimDueSources('worker-vivo', depoisDoAluguel)).some((x) => x._id.equals(f._id)), true)
})

test('falhar ADIA a próxima tentativa — e o adiamento é respeitado pela varredura', async () => {
  const f = await svc.createSource(DONO, entrada({
    config: { url: `http://127.0.0.1:${porta}/erro`, method: 'GET' },
    retry: { backoffMs: 300_000, maxAttempts: 3, jitterRatio: 0 },
  }))
  await db.collection('monitoring_sources').updateOne({ _id: f._id }, { $set: { status: 'active', 'telemetry.lastReadAt': new Date(Date.now() - 300_000) } })

  const r = await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  assert.equal(r.ok, false)
  assert.ok(r.nextAttemptMs > 0)

  const guardada = await svc.getSource(DONO, f._id)
  assert.ok(guardada.nextAttemptAt instanceof Date, 'o atraso é gravado, não só devolvido')

  // Vencida pelo intervalo, mas ainda dentro do backoff: não entra na varredura.
  const logoDepois = new Date(Date.now() + 61_000)
  assert.ok(guardada.nextAttemptAt > logoDepois, 'o backoff precisa passar do intervalo, senão não adia nada')
  assert.equal((await svc.dueSources(logoDepois)).some((x) => x._id.equals(f._id)), false)

  // Passado o backoff, ela volta.
  const depoisDoBackoff = new Date(guardada.nextAttemptAt.getTime() + 1000)
  assert.equal((await svc.dueSources(depoisDoBackoff)).some((x) => x._id.equals(f._id)), true)
})

test('uma leitura boa apaga o adiamento', async () => {
  const f = await svc.createSource(DONO, entrada())
  await db.collection('monitoring_sources').updateOne({ _id: f._id }, { $set: { status: 'active', nextAttemptAt: new Date(Date.now() + 600_000) } })
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  assert.equal((await svc.getSource(DONO, f._id)).nextAttemptAt, null)
})

test('o limite de taxa declarado é cumprido por quem prometeu', async () => {
  const f = await svc.createSource(DONO, entrada({ retry: { rateLimitPerMinute: 2 } }))
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  await db.collection('monitoring_sources').updateOne({ _id: f._id }, { $set: { status: 'active' } })

  // Duas por minuto são 30 s de distância mínima — mesmo com intervalo de 60 s vencido.
  const lida = await svc.getSource(DONO, f._id)
  assert.equal(svc.dentroDoLimiteDeTaxa(lida, new Date(lida.telemetry.lastReadAt.getTime() + 20_000)), false)
  assert.equal(svc.dentroDoLimiteDeTaxa(lida, new Date(lida.telemetry.lastReadAt.getTime() + 31_000)), true)
})

// --- paginação: buscar o resto, com teto em tudo ------------------------------------------
//
// Sem ela, uma API paginada entregava a primeira página e a série ficava pela metade, sem
// erro nenhum: o número existia, estava certo, e era de vinte por cento dos dados.

const paginado = (over = {}) => ({
  ...entrada(),
  name: `Paginada ${Math.random().toString(36).slice(2, 8)}`,
  mapping: { version: 1, itemsPath: 'itens', fields: [{ to: 'id', from: 'id', required: true }] },
  ...over,
})

test('paginação por NÚMERO busca as páginas seguintes e junta as linhas', async () => {
  const paginas = { 1: ['a', 'b'], 2: ['c', 'd'], 3: [] }
  const vistas = []
  const servidor = createServer((req, res) => {
    const n = Number(new URL(req.url, 'http://x').searchParams.get('page') ?? 1)
    vistas.push(n)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ itens: (paginas[n] ?? []).map((id) => ({ id })) }))
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  const p = servidor.address().port
  try {
    const f = await svc.createSource(
      DONO,
      paginado({ config: { url: `http://127.0.0.1:${p}/lista`, method: 'GET', pagination: { kind: 'page', pageParam: 'page', maxPages: 5 } } }),
    )
    const r = await svc.testSource(DONO, await svc.getSource(DONO, f._id))
    assert.equal(r.ok, true)
    assert.deepEqual(r.rows.map((x) => x.id), ['a', 'b', 'c', 'd'])
    assert.equal(r.pages.fetched, 3)
    assert.equal(r.pages.stoppedBecause, 'sem-proxima', 'página vazia é o fim')
    assert.deepEqual(vistas, [1, 2, 3])
  } finally {
    servidor.close()
  }
})

test('paginação por CURSOR segue o caminho declarado e para quando ele acaba', async () => {
  const porCursor = { '': { itens: [{ id: 'a' }], meta: { next: 'c1' } }, c1: { itens: [{ id: 'b' }], meta: { next: null } } }
  const servidor = createServer((req, res) => {
    const c = new URL(req.url, 'http://x').searchParams.get('cursor') ?? ''
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(porCursor[c] ?? { itens: [] }))
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  const p = servidor.address().port
  try {
    const f = await svc.createSource(
      DONO,
      paginado({ config: { url: `http://127.0.0.1:${p}/lista`, method: 'GET', pagination: { kind: 'cursor', cursorPath: 'meta.next', maxPages: 10 } } }),
    )
    const r = await svc.testSource(DONO, await svc.getSource(DONO, f._id))
    assert.deepEqual(r.rows.map((x) => x.id), ['a', 'b'])
    assert.equal(r.pages.fetched, 2)
    assert.equal(r.pages.cursor, null, 'sem retomada, nada é guardado para a próxima coleta')
  } finally {
    servidor.close()
  }
})

test('o TETO de páginas corta, e a razão da parada é dita', async () => {
  // Uma API que devolve cursor não-nulo por engano viraria laço infinito contra o servidor
  // de outra pessoa. "Buscou 3 de no máximo 3" é notícia diferente de "buscou 3 e acabou".
  const servidor = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ itens: [{ id: Math.random().toString(36).slice(2) }], meta: { next: Math.random().toString(36).slice(2) } }))
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  const p = servidor.address().port
  try {
    const f = await svc.createSource(
      DONO,
      paginado({ config: { url: `http://127.0.0.1:${p}/infinita`, method: 'GET', pagination: { kind: 'cursor', cursorPath: 'meta.next', maxPages: 3 } } }),
    )
    const r = await svc.testSource(DONO, await svc.getSource(DONO, f._id))
    assert.equal(r.pages.fetched, 3)
    assert.equal(r.pages.stoppedBecause, 'max-paginas')
  } finally {
    servidor.close()
  }
})

test('o cursor de RETOMADA é guardado, e a coleta seguinte começa dele', async () => {
  const pedidos = []
  const servidor = createServer((req, res) => {
    const c = new URL(req.url, 'http://x').searchParams.get('cursor') ?? ''
    pedidos.push(c)
    res.writeHead(200, { 'content-type': 'application/json' })
    // Uma página só por coleta, com um cursor que sempre avança: é o feed que só cresce.
    res.end(JSON.stringify({ itens: [{ id: `i-${pedidos.length}` }], meta: { next: `c${pedidos.length}` } }))
  })
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
  const p = servidor.address().port
  try {
    const f = await svc.createSource(
      DONO,
      paginado({
        config: { url: `http://127.0.0.1:${p}/feed`, method: 'GET', pagination: { kind: 'cursor', cursorPath: 'meta.next', maxPages: 1, resume: true } },
      }),
    )
    await svc.readSourceOnce(await svc.getSource(DONO, f._id))
    const guardado = (await svc.getSource(DONO, f._id)).cursor
    assert.ok(guardado, 'com retomada, o cursor precisa sobreviver à coleta')

    await svc.readSourceOnce(await svc.getSource(DONO, f._id))
    assert.equal(pedidos[1], guardado, 'a coleta seguinte começa de onde a anterior parou')
  } finally {
    servidor.close()
  }
})

test('sem paginação declarada, nada muda: uma requisição e nenhum relatório de páginas', async () => {
  const f = await svc.createSource(DONO, entrada())
  const r = await svc.testSource(DONO, await svc.getSource(DONO, f._id))
  assert.equal(r.ok, true)
  assert.equal(r.pages, undefined)
})

// --- o AO VIVO como destino de verdade ----------------------------------------------------
//
// `realtimeSourceId` nascia null, era preservado em toda atualização e nunca recebia nada.
// Uma fonte com `live: true, history: false` não tinha recorder — e o Ao vivo, que lia do
// histórico, mostrava zero leituras para sempre.

test('ACEITAÇÃO: live=true, history=false grava o valor de agora e ele aparece no Ao vivo', async () => {
  const f = await svc.createSource(DONO, entrada({ name: 'Só ao vivo', destination: { live: true, history: false } }))
  await svc.testSource(DONO, await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')

  const materializada = await svc.getSource(DONO, f._id)
  assert.ok(materializada.destination.realtimeSourceId, 'ativar uma fonte ao vivo cria o par em tempo real')
  assert.equal(materializada.destination.recorderId, null, 'sem histórico, não há recorder')

  const leitura = await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  assert.equal(leitura.ok, true)
  assert.equal(leitura.recorded, 0, 'sem histórico, nada é gravado como fato')

  const { flushLiveData } = await import('../dist/integrations/websocket/liveData.js')
  await flushLiveData()

  const { items } = await svc.liveView(DONO)
  const item = items.find((i) => i.name === 'Só ao vivo')
  assert.ok(item, 'a fonte precisa aparecer no Ao vivo')
  assert.equal(item.readings.length, 1, 'com um valor guardado, a aba mostra um valor')
  assert.equal(item.readings[0].value.preco, 1234.56)
})

test('o valor ao vivo é lido pelo mesmo caminho que um agente usaria', async () => {
  const f = await svc.createSource(DONO, entrada({ name: 'Ao vivo canônico', destination: { live: true, history: false } }))
  await svc.testSource(DONO, await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')
  await svc.readSourceOnce(await svc.getSource(DONO, f._id))

  const { flushLiveData, getLiveValue } = await import('../dist/integrations/websocket/liveData.js')
  await flushLiveData()

  // Um armazenamento próprio aqui seria um segundo lugar guardando "o valor de agora".
  const valor = await getLiveValue(DONO, svc.liveConnectionOf(f._id), 'valor')
  assert.ok(valor, 'o valor precisa estar no live_data, que é onde esta plataforma guarda o agora')
  assert.equal(valor.value.preco, 1234.56)
})

test('a fonte em tempo real nasce sem agente nenhum: acesso é concessão', async () => {
  const f = await svc.createSource(DONO, entrada({ name: 'Sem agentes', destination: { live: true, history: false } }))
  await svc.testSource(DONO, await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')

  const rtId = (await svc.getSource(DONO, f._id)).destination.realtimeSourceId
  const rt = await db.collection('realtime_sources').findOne({ _id: rtId })
  assert.deepEqual(rt.agentIds, [])
})

test('uma fonte com os DOIS destinos alimenta os dois', async () => {
  const f = await svc.createSource(DONO, entrada({ name: 'Os dois', destination: { live: true, history: true } }))
  await svc.testSource(DONO, await svc.getSource(DONO, f._id))
  await svc.setSourceStatus(DONO, f._id, 'active')

  const m = await svc.getSource(DONO, f._id)
  assert.ok(m.destination.recorderId)
  assert.ok(m.destination.realtimeSourceId)

  const leitura = await svc.readSourceOnce(await svc.getSource(DONO, f._id))
  assert.ok(leitura.recorded > 0)

  const { flushLiveData, getLiveValue } = await import('../dist/integrations/websocket/liveData.js')
  await flushLiveData()
  assert.ok(await getLiveValue(DONO, svc.liveConnectionOf(f._id), 'valor'))
})
