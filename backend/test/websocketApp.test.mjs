// O App de WebSocket, nas partes que são PURAS.
//
// Configuração, guarda de endereço e pipeline da mensagem não tocam banco nem rede — e
// é justamente onde moram as decisões que, erradas, viram um vazamento ou um dado
// plausível e falso. Por isso elas são puras, e por isso cada regra tem prova própria.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/ws-unit-test'
process.env.ENCRYPTION_KEY ||= 'chave-de-teste-que-nao-e-segredo'

const { normalizeConnectionConfig, normalizePath, fillToken, readAt, WS_LIMITS } = await import('../dist/apps/official/websocket/config.js')
const { assertPublicWebSocketUrl, checkWebSocketUrl, WebSocketTargetError, setWebSocketResolver } = await import('../dist/net/safeWebSocket.js')
const { motivoDoErroDeSocket } = await import('../dist/streams/manager.js')
const { lookupDoEnderecoFixado } = await import('../dist/streams/socket.js')
const { parseMessage, matchesFilters, dedupeKeyOf, subscriptionFor, previewOf } = await import('../dist/integrations/websocket/pipeline.js')

const base = (over = {}) => normalizeConnectionConfig({ endpoint: 'wss://exemplo.com/stream', ...over })

// --- configuração: dado, nunca código ---------------------------------------------------

test('um caminho é um caminho — não uma expressão', () => {
  // O App inteiro depende disto: se o campo aceitasse expressão, ele seria um App que
  // executa o que foi digitado por quem nem sempre é quem parece.
  assert.equal(normalizePath('data.evento.tipo', 'x'), 'data.evento.tipo')
  assert.equal(normalizePath('items[0].id', 'x'), 'items[0].id')
  assert.equal(normalizePath('', 'x'), '')
  for (const perigoso of ['a.b()', 'require("fs")', 'a["b"]', 'a-b', 'a b', '${x}', 'a|b']) {
    assert.throws(() => normalizePath(perigoso, 'Campo'), /caminho simples/, perigoso)
  }
})

test('caminho que mexe no protótipo é recusado', () => {
  // É por `__proto__` que uma LEITURA vira escrita no protótipo de todo objeto.
  for (const p of ['__proto__', 'a.__proto__.b', 'constructor.prototype', 'a.prototype']) {
    assert.throws(() => normalizePath(p, 'Campo'), /não permitido|caminho simples/, p)
  }
})

test('o endereço é obrigatório, e o resto tem padrão', () => {
  assert.throws(() => normalizeConnectionConfig({}), /endereço/)
  const c = base()
  assert.equal(c.format, 'json')
  assert.equal(c.auth.kind, 'none')
  assert.equal(c.dedupe, 'none')
  assert.deepEqual(c.filters, [])
})

test('mensagem de inscrição precisa ser JSON válido', () => {
  // Um JSON quebrado só falharia na hora de conectar, longe de quem o escreveu.
  assert.throws(() => base({ auth: { kind: 'message', messageTemplate: 'não é json' } }), /JSON/)
  const c = base({ auth: { kind: 'message', messageTemplate: '{"action":"auth","t":"{{token}}"}' } })
  assert.match(c.auth.messageTemplate, /token/)
})

test('autenticação por cabeçalho ou query exige o nome do campo', () => {
  assert.throws(() => base({ auth: { kind: 'header' } }), /nome do cabeçalho/)
  assert.throws(() => base({ auth: { kind: 'query' } }), /nome do cabeçalho|parâmetro/)
  assert.equal(base({ auth: { kind: 'header', name: 'Authorization', prefix: 'Bearer ' } }).auth.name, 'Authorization')
})

test('os limites têm teto, e o teto não é configurável para cima', () => {
  const c = base({ maxMessagesPerMinute: 999_999, maxMessageBytes: 999_999_999, idleTimeoutMs: 1 })
  assert.equal(c.maxMessagesPerMinute, WS_LIMITS.maxMessagesPerMinute)
  assert.equal(c.maxMessageBytes, WS_LIMITS.maxMessageBytes)
  assert.equal(c.idleTimeoutMs, WS_LIMITS.minIntervalMs)
})

test('o template só substitui o token — e nada mais', () => {
  // Um template com condicional ou chamada seria código escrito por quem configura e
  // executado pelo servidor.
  assert.equal(fillToken('{"t":"{{token}}"}', 'abc'), '{"t":"abc"}')
  assert.equal(fillToken('{"t":"{{outra}}"}', 'abc'), '{"t":"{{outra}}"}')
})

// --- a guarda de endereço ------------------------------------------------------------------

test('só ws:// e wss:// — e em produção, só wss', async () => {
  for (const ruim of ['http://exemplo.com', 'https://exemplo.com', 'file:///etc/passwd', 'javascript:alert(1)', 'não é url']) {
    await assert.rejects(() => assertPublicWebSocketUrl(ruim), WebSocketTargetError, ruim)
  }
  const antes = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    // Em produção o tráfego sai da rede com a credencial dentro: texto claro não cabe
    // num campo de formulário.
    await assert.rejects(() => assertPublicWebSocketUrl('ws://exemplo.com'), /wss/)
  } finally {
    process.env.NODE_ENV = antes
  }
})

test('rede interna, metadata e nomes de dentro são recusados', async () => {
  for (const interno of [
    'wss://localhost/x',
    'wss://algo.local/x',
    'wss://algo.internal/x',
    'wss://metadata.google.internal/x',
    'wss://169.254.169.254/latest',
    'wss://10.0.0.5/x',
    'wss://192.168.1.10/x',
    'wss://172.16.0.1/x',
    'wss://127.0.0.1/x',
  ]) {
    await assert.rejects(() => assertPublicWebSocketUrl(interno), WebSocketTargetError, interno)
  }
})

test('IPv6 interno é recusado, e IPv6 público passa', async () => {
  for (const interno of ['wss://[::1]/x', 'wss://[fe80::1]/x', 'wss://[fd00::1]/x', 'wss://[fc00::1]/x']) {
    await assert.rejects(() => assertPublicWebSocketUrl(interno), WebSocketTargetError, interno)
  }
  // Um IPv6 público de verdade (documentação, 2001:db8 é reservado mas não é interno
  // pelas regras daqui — uso um endereço global comum).
  const r = await assertPublicWebSocketUrl('wss://[2606:4700:4700::1111]/x')
  assert.equal(r.family, 6, 'a família vem do endereço, não de um campo que pode mentir')
  assert.equal(r.address, '2606:4700:4700::1111')
})

test('hostname público com porta explícita: o DNS recebe o NOME, sem a porta', async () => {
  // O caso que quebrou na mão: wss://data-stream.binance.vision:443/ws/btcusdt@trade
  let pedido = null
  setWebSocketResolver(async (host) => {
    pedido = host
    return [{ address: '203.0.113.10', family: 4 }]
  })
  try {
    const r = await assertPublicWebSocketUrl('wss://data-stream.binance.vision:443/ws/btcusdt@trade')
    assert.equal(pedido, 'data-stream.binance.vision', `o DNS recebeu "${pedido}"`)
    assert.equal(r.hostname, 'data-stream.binance.vision')
    assert.equal(r.address, '203.0.113.10')
    assert.equal(r.family, 4)
    // 443 é a porta PADRÃO de wss: o parser a normaliza para fora, e é isso que garante
    // que ela não vá parar no nome entregue ao DNS.
    assert.equal(r.url.port, '')
    assert.equal(r.url.host, 'data-stream.binance.vision')
    assert.equal(r.url.pathname, '/ws/btcusdt@trade')
    assert.equal(r.url.protocol, 'wss:')
  } finally {
    setWebSocketResolver(null)
  }
})

test('porta não padrão continua fora do nome resolvido', async () => {
  let pedido = null
  setWebSocketResolver(async (host) => {
    pedido = host
    return [{ address: '203.0.113.10', family: 4 }]
  })
  try {
    const r = await assertPublicWebSocketUrl('wss://feed.exemplo.test:9443/stream')
    assert.equal(pedido, 'feed.exemplo.test', `o DNS recebeu "${pedido}"`)
    assert.equal(r.url.port, '9443', 'a porta continua na URL usada para conectar')
  } finally {
    setWebSocketResolver(null)
  }
})

test('um nome público que resolve para IPv6 público é aceito', async () => {
  setWebSocketResolver(async () => [{ address: '2606:4700:4700::1111', family: 6 }])
  try {
    const r = await assertPublicWebSocketUrl('wss://exemplo-publico.test/ws')
    assert.equal(r.family, 6)
    assert.deepEqual(r.addresses, ['2606:4700:4700::1111'])
  } finally {
    setWebSocketResolver(null)
  }
})

test('um nome que resolve para QUALQUER endereço interno é recusado — mesmo com um público junto', async () => {
  for (const interno of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '::1', 'fd00::5']) {
    setWebSocketResolver(async () => [{ address: '203.0.113.10', family: 4 }, { address: interno, family: interno.includes(':') ? 6 : 4 }])
    await assert.rejects(() => assertPublicWebSocketUrl('wss://exemplo-publico.test/ws'), /interna/, interno)
  }
  setWebSocketResolver(null)
})

test('DNS que devolve lixo NUNCA chega ao validador de IP — e o erro diz o que houve', async () => {
  // Foi assim que "Invalid IP address: undefined" apareceu para o usuário: uma string
  // vazia, um objeto sem `address` ou uma lista vazia não podem virar exceção crua.
  for (const lixo of [[], null, undefined, [{ family: 4 }], [{ address: '', family: 4 }], [{ address: undefined, family: 4 }]]) {
    setWebSocketResolver(async () => lixo)
    const r = await checkWebSocketUrl('wss://exemplo-publico.test/ws')
    assert.equal(r.ok, false, JSON.stringify(lixo))
    assert.equal(r.message, 'Não foi possível resolver o hostname do serviço.', JSON.stringify(lixo))
  }
  // Um endereço que não é IP nenhum também não passa — e não vira "aceito".
  setWebSocketResolver(async () => [{ address: '203.0.113.10', family: 4 }, { address: 'não-é-ip', family: 4 }])
  const misto = await checkWebSocketUrl('wss://exemplo-publico.test/ws')
  assert.equal(misto.ok, false)
  assert.match(misto.message, /conferir/)
  setWebSocketResolver(null)
})

test('DNS que falha vira a frase de DNS, e não "endereço inválido"', async () => {
  setWebSocketResolver(async () => {
    const e = new Error('getaddrinfo ENOTFOUND nao-existe.invalid')
    e.code = 'ENOTFOUND'
    throw e
  })
  try {
    const r = await checkWebSocketUrl('wss://nao-existe.invalid/ws')
    assert.equal(r.ok, false)
    assert.equal(r.message, 'Não foi possível resolver o hostname do serviço.')
  } finally {
    setWebSocketResolver(null)
  }
})

// --- o contrato do lookup que o Node exige -----------------------------------------------------

test('o endereço fixado responde no formato que o Node pede — com `all` e sem', () => {
  /**
   * O defeito que motivou tudo isto: o `net.connect` do Node pede `all: true` e espera
   * um ARRAY de `{address, family}`. Respondendo no terno antigo, o Node fazia
   * `addresses[0].address` em cima de uma string — `'2'.address` é `undefined` — e a
   * conexão morria com `ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined`.
   */
  const fn = lookupDoEnderecoFixado({ address: '203.0.113.10', family: 4 })

  let comAll
  fn('exemplo-publico.test', { all: true }, (erro, resposta) => {
    assert.equal(erro, null)
    comAll = resposta
  })
  assert.ok(Array.isArray(comAll), 'com `all: true` a resposta precisa ser um array')
  assert.deepEqual(comAll, [{ address: '203.0.113.10', family: 4 }])
  // E é exatamente o que o Node lê: `addresses[0].address`.
  assert.equal(comAll[0].address, '203.0.113.10')

  let semAll
  fn('exemplo-publico.test', {}, (erro, endereco, familia) => {
    assert.equal(erro, null)
    semAll = { endereco, familia }
  })
  assert.deepEqual(semAll, { endereco: '203.0.113.10', familia: 4 })

  // IPv6 pelo mesmo caminho.
  let v6
  fn('exemplo-publico.test', { all: true }, (_e, r) => (v6 = r), undefined)
  assert.equal(v6[0].family, 4)
  const seis = lookupDoEnderecoFixado({ address: '2606:4700:4700::1111', family: 6 })
  seis('x', { all: true }, (_e, r) => assert.deepEqual(r, [{ address: '2606:4700:4700::1111', family: 6 }]))
})

// --- de quem é a falha -------------------------------------------------------------------------

test('só a recusa no handshake é culpa do provedor', () => {
  assert.match(motivoDoErroDeSocket({ message: 'Unexpected server response: 401' }), /provedor recusou.*401/)
  assert.match(motivoDoErroDeSocket({ message: 'Unexpected server response: 403' }), /provedor recusou.*403/)

  // Estes são NOSSOS ou do caminho até lá — e não podem acusar quem está do outro lado.
  const nossos = [
    [{ code: 'ERR_INVALID_IP_ADDRESS', message: 'Invalid IP address: undefined' }, /resolver o hostname/],
    [{ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND x.invalid' }, /resolver o hostname/],
    [{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }, /Nada atendeu/],
    [{ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }, /não respondeu a tempo/],
    [{ message: 'unable to verify the first certificate', code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }, /certificado/],
    [{ code: 'ERR_STREAM_DESTROYED', message: 'ERR_STREAM_DESTROYED' }, /Falha ao abrir a conexão/],
  ]
  for (const [ev, esperado] of nossos) {
    const msg = motivoDoErroDeSocket(ev)
    assert.match(msg, esperado, JSON.stringify(ev))
    assert.ok(!/provedor/.test(msg), `não pode culpar o provedor: ${msg}`)
  }
})

test('o domínio é resolvido A CADA conferência — é o que fecha o rebinding', async () => {
  // Um nome que apontava para um endereço público quando foi salvo pode apontar para a
  // rede interna agora. Só resolvendo de novo isso é pego.
  const r = await checkWebSocketUrl('wss://exemplo-que-nao-existe-mesmo.invalid/x')
  assert.equal(r.ok, false)
  assert.match(r.message, /resolver|interna/)
})

// --- o pipeline --------------------------------------------------------------------------------

test('mensagem maior que o teto é recusada antes de ser interpretada', () => {
  // Não se interpreta um megabyte para descobrir que ele é grande demais.
  const c = base({ maxMessageBytes: 200 })
  const r = parseMessage(JSON.stringify({ a: 'x'.repeat(500) }), c)
  assert.equal(r.status, 'too_large')
  assert.match(r.reason, /acima do limite/)
})

test('o teto é em BYTES, e não em caracteres', () => {
  // Um emoji conta quatro bytes; um teto em caracteres não protege memória nenhuma.
  // 200 é o piso do campo — abaixo disso ele não é configurável.
  const c = base({ maxMessageBytes: 200 })
  assert.equal(c.maxMessageBytes, 200)
  assert.equal(parseMessage(JSON.stringify('a'.repeat(190)), c).status, 'accepted')
  // 60 emojis: 60 caracteres, 240 bytes.
  assert.equal(parseMessage(JSON.stringify('🎉'.repeat(60)), c).status, 'too_large')
})

test('formato JSON declarado e texto que não é JSON: recusa, não palpite', () => {
  const r = parseMessage('isto não é json', base())
  assert.equal(r.status, 'invalid')
  assert.match(r.reason, /JSON/)
})

test('formato texto aceita texto', () => {
  const r = parseMessage('uma linha de log', base({ format: 'text' }))
  assert.equal(r.status, 'accepted')
  assert.equal(r.payload, 'uma linha de log')
})

test('os caminhos recortam conteúdo, identificador, canal e data', () => {
  const c = base({ paths: { payload: 'data', messageId: 'id', channel: 'canal', occurredAt: 'ts' } })
  const r = parseMessage(JSON.stringify({ id: 'm-1', canal: 'pedidos', ts: '2026-07-01T10:00:00Z', data: { total: 10 } }), c)
  assert.equal(r.status, 'accepted')
  assert.deepEqual(r.payload, { total: 10 })
  assert.equal(r.messageId, 'm-1')
  assert.equal(r.channel, 'pedidos')
  assert.equal(r.occurredAt.toISOString(), '2026-07-01T10:00:00.000Z')
})

test('caminho vazio entrega a mensagem inteira', () => {
  const r = parseMessage(JSON.stringify({ a: 1 }), base())
  assert.deepEqual(r.payload, { a: 1 })
  assert.deepEqual(readAt({ a: 1 }, ''), { a: 1 })
  assert.equal(readAt({ a: { b: 2 } }, 'a.b'), 2)
})

test('schema inválido recusa e diz ONDE, não o quê', () => {
  // O caminho do campo, e não o valor: o valor é conteúdo de fora.
  const c = base({ schema: { type: 'object', properties: { total: { type: 'number' } }, required: ['total'] } })
  const r = parseMessage(JSON.stringify({ outro: 1 }), c)
  assert.equal(r.status, 'invalid')
  assert.match(r.reason, /schema/)
  // O nome do campo que VEIO na mensagem é texto de fora tanto quanto o valor dele —
  // e o log e a tela leem esta frase.
  assert.ok(!r.reason.includes('outro'), r.reason)
  assert.equal(parseMessage(JSON.stringify({ total: 10 }), c).status, 'accepted')
})

test('o filtro compara por igualdade e por conteúdo', () => {
  assert.equal(matchesFilters({ t: 'novo' }, [{ path: 't', operator: 'equals', value: 'novo' }]), true)
  assert.equal(matchesFilters({ t: 'novo' }, [{ path: 't', operator: 'equals', value: 'velho' }]), false)
  assert.equal(matchesFilters({ t: 'pedido-novo' }, [{ path: 't', operator: 'contains', value: 'novo' }]), true)
  // Campo ausente não passa: um filtro que não encontra o campo não pode aprovar.
  assert.equal(matchesFilters({}, [{ path: 't', operator: 'equals', value: 'novo' }]), false)
  // Todos precisam casar.
  assert.equal(
    matchesFilters({ a: '1', b: '2' }, [
      { path: 'a', operator: 'equals', value: '1' },
      { path: 'b', operator: 'equals', value: 'x' },
    ]),
    false,
  )
})

test('mensagem que não passa no filtro é FILTRADA, e não inválida', () => {
  // A diferença importa na tela: filtrada é configuração; inválida é o serviço mandando
  // algo diferente do combinado.
  const c = base({ filters: [{ path: 'tipo', operator: 'equals', value: 'pedido' }] })
  assert.equal(parseMessage(JSON.stringify({ tipo: 'outro' }), c).status, 'filtered')
  assert.equal(parseMessage(JSON.stringify({ tipo: 'pedido' }), c).status, 'accepted')
})

test('a chave de deduplicação segue a estratégia escolhida', () => {
  assert.equal(dedupeKeyOf(base({ dedupe: 'none' }), 'm-1', { a: 1 }), null)
  assert.equal(dedupeKeyOf(base({ dedupe: 'message_id' }), 'm-1', { a: 1 }), 'm-1')
  const porConteudo = dedupeKeyOf(base({ dedupe: 'payload_hash' }), null, { a: 1 })
  assert.equal(porConteudo, dedupeKeyOf(base({ dedupe: 'payload_hash' }), null, { a: 1 }))
  assert.notEqual(porConteudo, dedupeKeyOf(base({ dedupe: 'payload_hash' }), null, { a: 2 }))
})

test('o preview é um trecho, e nunca a mensagem inteira', () => {
  // O conteúdo vem de fora e ninguém o revisou; guardar tudo é guardar o que não se sabe.
  const grande = previewOf('x'.repeat(1000))
  assert.ok(grande.length < 400)
  assert.ok(grande.endsWith('…'))
})

// --- a assinatura que reivindica a mensagem ------------------------------------------------

const assinatura = (over = {}) => ({ _id: { toString: () => 's1' }, active: true, channel: '', filters: [], ...over })

test('só assinatura ATIVA reivindica a mensagem', () => {
  assert.equal(subscriptionFor({ t: 'a' }, '', [assinatura({ active: false })]), null)
  assert.ok(subscriptionFor({ t: 'a' }, '', [assinatura()]))
})

test('o canal e os filtros da assinatura decidem qual delas é', () => {
  const pedidos = assinatura({ channel: 'pedidos' })
  const avisos = assinatura({ channel: 'avisos' })
  assert.equal(subscriptionFor({}, 'pedidos', [avisos, pedidos]).channel, 'pedidos')
  assert.equal(subscriptionFor({}, 'outro', [avisos, pedidos]), null)

  const so_novos = assinatura({ filters: [{ path: 'tipo', operator: 'equals', value: 'novo' }] })
  assert.ok(subscriptionFor({ tipo: 'novo' }, '', [so_novos]))
  assert.equal(subscriptionFor({ tipo: 'velho' }, '', [so_novos]), null)
})
