// O caminho da execução, do lado de quem observa.
//
// Duas garantias, e a segunda é a que importa mais: o painel recebe o que ACONTECEU, e
// nunca o que não pode sair do servidor — chave, credencial, cabeçalho de autorização.
// A higiene fica aqui, na última linha, porque um dia alguém emite o que não deveria.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const { clearTrace, onTraceEvent, preview, readTrace, sanitize, traceEvent } = await import('../dist/executionTrace.js')

beforeEach(() => {
  clearTrace()
  onTraceEvent(null)
})

test('um evento é guardado, devolvido e entregue ao vivo', () => {
  const entregues = []
  onTraceEvent((e, dono) => entregues.push([e.title, dono]))

  traceEvent({ ownerId: 'dono', executionId: 't1', type: 'planner', title: 'Plano criado', metadata: { round: 1 } })

  assert.deepEqual(entregues, [['Plano criado', 'dono']])
  const guardados = readTrace('t1', 'dono')
  assert.equal(guardados.length, 1)
  assert.equal(guardados[0].type, 'planner')
  // O carimbo de tempo é preenchido por quem guarda, não por quem emite.
  assert.ok(!Number.isNaN(new Date(guardados[0].timestamp).getTime()))
})

test('a trilha é do dono: outra conta não enxerga nada', () => {
  traceEvent({ ownerId: 'dono', executionId: 't1', type: 'agent', title: 'x' })
  assert.equal(readTrace('t1', 'outro').length, 0)
  assert.equal(readTrace('t1', 'dono').length, 1)
})

test('credencial nunca entra na trilha', () => {
  traceEvent({
    ownerId: 'dono',
    executionId: 't1',
    type: 'tool',
    title: 'chamada',
    input: { url: 'https://api.exemplo.test', authorization: 'Bearer abc123def456', apiKey: 'sk-abcdef1234567890', pagina: 2 },
    metadata: { headers: { 'x-api-key': 'segredo' } },
  })
  const bruto = JSON.stringify(readTrace('t1', 'dono'))
  assert.ok(!bruto.includes('abc123def456'))
  assert.ok(!bruto.includes('sk-abcdef1234567890'))
  assert.ok(!bruto.includes('segredo'))
  // E o que é legítimo continua lá: cortar demais cega o painel.
  assert.ok(bruto.includes('api.exemplo.test'))
  assert.ok(bruto.includes('"pagina":2'))
})

test('um segredo escondido no meio de um texto também é removido', () => {
  assert.equal(sanitize('use sk-abcdefghijklmnop para autenticar'), '[removido]')
  assert.equal(sanitize('Authorization: Bearer abcdefghijklmnop'), '[removido]')
})

test('texto muito longo vira preview, e o painel diz quanto foi cortado', () => {
  const gigante = 'a'.repeat(5000)
  const limpo = sanitize(gigante)
  assert.ok(limpo.length < 1400)
  assert.match(limpo, /\+3800 caracteres/)
})

test('o buffer tem teto: uma execução longa não come a memória', () => {
  for (let i = 0; i < 400; i++) traceEvent({ ownerId: 'dono', executionId: 't1', type: 'agent', title: `evento ${i}` })
  const guardados = readTrace('t1', 'dono')
  assert.equal(guardados.length, 300)
  // O que fica é o FIM: numa execução longa, o que acabou de acontecer é o que importa.
  assert.equal(guardados.at(-1).title, 'evento 399')
})

test('um erro na entrega não derruba a execução observada', () => {
  onTraceEvent(() => {
    throw new Error('socket caiu')
  })
  assert.doesNotThrow(() => traceEvent({ ownerId: 'dono', executionId: 't1', type: 'agent', title: 'segue o baile' }))
  assert.equal(readTrace('t1', 'dono').length, 1)
})

test('o preview corta e avisa', () => {
  assert.equal(preview('curto', 100), 'curto')
  assert.equal(preview('a'.repeat(50), 10), `${'a'.repeat(10)}…`)
})
