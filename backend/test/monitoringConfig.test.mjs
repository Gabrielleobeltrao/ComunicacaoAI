// A CONFIGURAÇÃO por tipo — união discriminada, e não um saco de campos opcionais.
//
// O modelo antigo aceitava `url` numa fonte de webhook e `selector` numa de dataset, e nada
// reclamava: o campo errado ficava guardado, aparecia na tela e confundia quem fosse editar
// depois. Estes casos protegem a recusa — porque campo ignorado é campo que alguém
// preencheu achando que ia funcionar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig, ConfigError } from '../dist/monitoring/config.js'

test('campo que não pertence ao tipo é RECUSADO, não ignorado', () => {
  assert.throws(() => validateConfig('dataset', { dataStoreId: 'a', datasetKey: 'b', selector: '.x' }), /não faz parte/)
  assert.throws(() => validateConfig('webhook', { url: 'https://x.test' }), /não faz parte/)
  assert.throws(() => validateConfig('api_polling', { url: 'https://x.test', selector: '.p' }), /não faz parte/)
})

test('cada tipo exige o que ele precisa', () => {
  assert.throws(() => validateConfig('api_polling', {}), /url/)
  assert.throws(() => validateConfig('internal_event', {}), /eventType/)
  assert.throws(() => validateConfig('app_action', { appKey: 'x' }), /actionKey/)
  assert.throws(() => validateConfig('dataset', { dataStoreId: 'x' }), /datasetKey/)
})

test('endereço inválido é recusado pela forma', () => {
  assert.throws(() => validateConfig('rss', { url: 'nao-e-url' }), /URL válida/)
  assert.throws(() => validateConfig('rss', { url: 'file:///etc/passwd' }), /URL válida/)
})

// --- SSE: o protocolo é DITO ---------------------------------------------------------

test('o protocolo de stream é explícito, e não adivinhado pela URL', () => {
  // Adivinhar por `wss://` versus `https://` erraria num SSE servido por uma API que
  // também fala WebSocket — e o erro só apareceria em produção.
  const sse = validateConfig('websocket', { protocol: 'sse', url: 'https://api.test/stream' })
  assert.equal(sse.protocol, 'sse')
  assert.equal(sse.url, 'https://api.test/stream')
  assert.equal(sse.installationId, null)

  const ws = validateConfig('websocket', { protocol: 'websocket', installationId: 'abc' })
  assert.equal(ws.protocol, 'websocket')
  assert.equal(ws.installationId, 'abc')
  assert.equal(ws.url, null, 'WebSocket usa a instalação do App, não uma URL solta')
})

test('SSE sem endereço e WebSocket sem conexão são recusados', () => {
  assert.throws(() => validateConfig('websocket', { protocol: 'sse' }), /endereço do fluxo/)
  assert.throws(() => validateConfig('websocket', { protocol: 'websocket' }), /conexão do App/)
})

test('o heartbeat tem piso e teto: silêncio além dele é conexão morta', () => {
  assert.equal(validateConfig('websocket', { protocol: 'websocket', installationId: 'a', heartbeatMs: 1 }).heartbeatMs, 5_000)
  assert.equal(validateConfig('websocket', { protocol: 'websocket', installationId: 'a', heartbeatMs: 99_999_999 }).heartbeatMs, 300_000)
})

// --- paginação -----------------------------------------------------------------------------

test('a paginação é fechada: cursor, página ou nenhuma', () => {
  assert.deepEqual(validateConfig('api_polling', { url: 'https://x.test' }).pagination, { kind: 'none' })

  const cursor = validateConfig('api_polling', { url: 'https://x.test', pagination: { kind: 'cursor', cursorPath: 'meta.next', maxPages: 50 } })
  assert.equal(cursor.pagination.kind, 'cursor')
  assert.equal(cursor.pagination.maxPages, 20, 'o teto existe: paginação sem limite é um laço')

  const inventada = validateConfig('api_polling', { url: 'https://x.test', pagination: { kind: 'inventada' } })
  assert.deepEqual(inventada.pagination, { kind: 'none' })
})

// --- os cabeçalhos --------------------------------------------------------------------------

test('só NOMES de cabeçalho entram, e com forma válida', () => {
  const c = validateConfig('api_polling', { url: 'https://x.test', headerNames: ['Authorization', 'X-Api', 'nome com espaço', 123] })
  assert.deepEqual(c.headerNames, ['Authorization', 'X-Api'])
})

test('o corpo só existe em POST', () => {
  assert.equal(validateConfig('api_polling', { url: 'https://x.test', method: 'GET', body: '{"a":1}' }).body, null)
  assert.equal(validateConfig('api_polling', { url: 'https://x.test', method: 'POST', body: '{"a":1}' }).body, '{"a":1}')
})

// --- a estratégia do browser ------------------------------------------------------------------

test('a estratégia padrão vai do mais barato ao mais caro, e a VISÃO fica de fora', () => {
  // Visão é palpite, e palpite precisa ser escolhido de propósito.
  assert.deepEqual(validateConfig('browser', { url: 'https://x.test' }).strategy, ['json', 'jsonld', 'dom', 'browser'])
  assert.deepEqual(validateConfig('browser', { url: 'https://x.test', strategy: ['dom', 'vision', 'inventada'] }).strategy, ['dom', 'vision'])
})

test('tipo desconhecido é recusado', () => {
  assert.throws(() => validateConfig('telepatia', {}), ConfigError)
})

// --- A REFERÊNCIA PELA QUAL O MOTOR ENTREGA O FATO -------------------------------------------
//
// Quem LISTA o que vive de uma fonte precisa da mesma conta que o materializador faz. Repetir
// só o caso comum (`monitoring:<id>`) deixava as séries de `internal_event` e `websocket`
// invisíveis: a lista sairia vazia como se não houvesse nenhuma — e o dono acabou de dizer
// que o assunto nunca se repete entre contas.
const { fonteDoRecorder } = await import('../dist/monitoring/types.js')

test('cada tipo de fonte tem a SUA referência, e não a do exemplo', () => {
  const id = { toString: () => '000000000000000000000f01' }

  // O caso comum: qualquer fonte lida por consulta.
  for (const kind of ['api_polling', 'rss', 'http_page', 'browser', 'dataset', 'webhook']) {
    assert.deepEqual(fonteDoRecorder({ _id: id, kind, config: {} }), { kind: 'manual', ref: 'monitoring:000000000000000000000f01' }, kind)
  }

  // Evento interno: a referência é o TIPO do evento, e não a fonte.
  assert.deepEqual(fonteDoRecorder({ _id: id, kind: 'internal_event', config: { eventType: 'pedido.criado' } }), {
    kind: 'event',
    ref: 'pedido.criado',
  })

  // WebSocket de App: a referência é a INSTALAÇÃO que entrega o fato.
  assert.deepEqual(fonteDoRecorder({ _id: id, kind: 'websocket', config: { installationId: 'inst-9' } }), {
    kind: 'live_data',
    ref: 'inst-9',
  })

  // SSE não tem instalação: ele é entregue por este processo, como um evento próprio.
  assert.deepEqual(fonteDoRecorder({ _id: id, kind: 'websocket', config: { protocol: 'sse', url: 'https://x/y' } }), {
    kind: 'manual',
    ref: 'monitoring:000000000000000000000f01',
  })
})
