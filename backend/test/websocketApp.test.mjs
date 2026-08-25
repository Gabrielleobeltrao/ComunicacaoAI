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
const { assertPublicWebSocketUrl, checkWebSocketUrl, WebSocketTargetError } = await import('../dist/net/safeWebSocket.js')
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
