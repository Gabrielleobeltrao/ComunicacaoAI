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
  for (const c of ['monitoring_sources', 'data_recorders', 'data_history_records', 'connections', 'buildings'])
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
  const r = await svc.testSource(DONO, entrada({
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

test('fonte que empurra SEM dizer de onde não ativa', async () => {
  // Sem isso ela ficaria ativa, verde, e muda para sempre — esperando uma entrega que
  // ninguém faz.
  const evento = await svc.createSource(DONO, entrada({
    kind: 'internal_event',
    config: {},
    cadence: { mode: 'stream' },
    mapping: { version: 1, fields: [{ to: 'a', from: 'a' }] },
  }))
  await assert.rejects(() => svc.setSourceStatus(DONO, evento._id, 'active'), /qual evento/)

  const ws = await svc.createSource(DONO, entrada({
    name: 'WS sem conexão',
    kind: 'websocket',
    config: {},
    cadence: { mode: 'stream' },
    mapping: { version: 1, fields: [{ to: 'a', from: 'a' }] },
  }))
  await assert.rejects(() => svc.setSourceStatus(DONO, ws._id, 'active'), /qual conexão/)
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

test('fonte de App sem dizer App e ação é recusada', async () => {
  const r = await svc.testSource(DONO, entrada({ kind: 'app_action', config: {}, mapping: { version: 1, fields: [{ to: 'a', from: 'a' }] } }))
  assert.equal(r.error.kind, 'not_supported')
  assert.match(r.error.message, /qual App e qual ação/)
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

test('fonte de dataset sem dizer o conjunto é recusada', async () => {
  const r = await svc.testSource(DONO, entrada({
    kind: 'dataset',
    config: {},
    cadence: { mode: 'interval', intervalMs: 60_000 },
    mapping: { version: 1, fields: [{ to: 'a', from: 'a' }] },
  }))
  assert.match(r.error.message, /qual conjunto/)
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
