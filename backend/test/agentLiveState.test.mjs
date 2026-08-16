// The rules of the live map, without a database.
//
// Two of them are load-bearing: what a caption may contain (allowlist, never a
// scrub), and which state wins when one agent is in several executions at once. A
// third is negative and just as important: no execution, no bubble.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/live-state-test'
process.env.ENCRYPTION_KEY ||= 'test-encryption-key'

const { AGENT_BUBBLE_STATES, TERMINAL_STATES, safeDetail, selectVisualStates, ttlFor, legacyWorkingMap, liveStatesEtag, LIVE_STATE_DTO_VERSION } =
  await import('../dist/agentLiveState.js')
const { toolDetail, instrumentTools, NOOP_TRACKER } = await import('../dist/agentLiveTracker.js')

const NOW = new Date('2026-01-01T12:00:00.000Z')
const row = (over = {}) => ({
  agentId: { toString: () => over.agent ?? 'a1' },
  floorId: { toString: () => 'f1' },
  rootExecutionId: over.root ?? 'run-1',
  state: over.state ?? 'thinking',
  detail: over.detail ?? null,
  sequence: 1,
  startedAt: NOW,
  updatedAt: over.updatedAt ?? NOW,
  expiresAt: over.expiresAt ?? new Date(NOW.getTime() + 60_000),
})

// --- o que pode virar legenda ---------------------------------------------------

test('safeDetail é allowlist: o que não é previsto simplesmente não entra', () => {
  const kept = safeDetail({
    appKey: 'google',
    actionLabel: 'Criar evento',
    targetType: 'agent',
    url: 'https://api.exemplo.com/pedidos?token=abc',
    objective: 'Ligar para o cliente 5511999998888',
    error: 'ECONNREFUSED em 10.0.0.5',
  })
  assert.deepEqual(kept, { appKey: 'google', actionLabel: 'Criar evento', targetType: 'agent' })
})

test('um rótulo que parece payload é descartado, não cortado', () => {
  assert.equal(safeDetail({ actionLabel: 'x'.repeat(41) }), undefined)
  assert.equal(safeDetail({ actionLabel: 'veja https://loja.com/pedido/9' }), undefined)
  assert.equal(safeDetail({ actionLabel: 'linha 1\nlinha 2' }), undefined)
})

test('appKey inválido e targetType desconhecido não passam', () => {
  assert.equal(safeDetail({ appKey: '../admin' }), undefined)
  assert.equal(safeDetail({ targetType: 'humano' }), undefined)
  assert.equal(safeDetail('texto'), undefined)
  assert.equal(safeDetail(null), undefined)
})

test('o rótulo de uma ferramenta vem do catálogo, nunca do nome que o dono escreveu', () => {
  assert.deepEqual(toolDetail('google_agenda_criar_evento'), { appKey: 'google', actionLabel: 'Criar evento' })
  // Custom Tool: o nome é do dono e pode dizer qualquer coisa — vira rótulo genérico.
  assert.deepEqual(toolDetail('minha_api_secreta_v2'), { actionLabel: 'Usando ferramenta' })
})

// --- prioridade entre execuções concorrentes ------------------------------------

test('sem execução não existe estado — nem para agenda ou gatilho armado', () => {
  assert.deepEqual(selectVisualStates([], NOW), [])
})

test('uma linha vencida já não conta, mesmo antes do TTL do Mongo passar', () => {
  const expired = [row({ expiresAt: new Date(NOW.getTime() - 1) })]
  assert.deepEqual(selectVisualStates(expired, NOW), [])
})

test('com duas execuções ao mesmo tempo, a prioridade decide — e não alterna', () => {
  const states = selectVisualStates([row({ root: 'r1', state: 'thinking' }), row({ root: 'r2', state: 'waiting_input' })], NOW)
  assert.equal(states.length, 1)
  assert.equal(states[0].state, 'waiting_input')
  // O mapa sabe que existe mais de uma, sem misturar as fases.
  assert.equal(states[0].concurrent, 2)
})

test('a ordem de prioridade do plano é respeitada', () => {
  const pairs = [
    ['failed', 'waiting_input'],
    ['waiting_input', 'retrying'],
    ['retrying', 'delivering'],
    ['delivering', 'delegating_agent'],
    ['delegating_agent', 'using_tool'],
    ['using_tool', 'thinking'],
    ['thinking', 'queued'],
    ['queued', 'completed'],
  ]
  for (const [stronger, weaker] of pairs) {
    const [chosen] = selectVisualStates([row({ root: 'r1', state: weaker }), row({ root: 'r2', state: stronger })], NOW)
    assert.equal(chosen.state, stronger, `${stronger} deveria vencer ${weaker}`)
  }
})

test('empate na prioridade é decidido pelo mais recente', () => {
  const older = row({ root: 'r1', state: 'thinking', updatedAt: new Date(NOW.getTime() - 5_000) })
  const newer = row({ root: 'r2', state: 'thinking', updatedAt: NOW })
  assert.equal(selectVisualStates([older, newer], NOW)[0].rootExecutionId, 'r2')
})

test('agentes diferentes não disputam entre si', () => {
  const states = selectVisualStates([row({ agent: 'a1', state: 'thinking' }), row({ agent: 'a2', state: 'failed' })], NOW)
  assert.equal(states.length, 2)
  assert.deepEqual(states.map((s) => s.concurrent), [1, 1])
})

// --- TTL ------------------------------------------------------------------------

test('estado terminal aparece por poucos segundos; estado ativo dura o suficiente para ser renovado', () => {
  assert.equal(ttlFor('completed'), 3_000)
  assert.equal(ttlFor('canceled'), 3_000)
  assert.equal(ttlFor('failed'), 6_000)
  assert.ok(ttlFor('thinking') >= 60_000)
  // Esperar uma pessoa leva mais que esperar uma API.
  assert.ok(ttlFor('waiting_input') > ttlFor('waiting_external'))
})

test('todo estado do enum tem TTL definido', () => {
  for (const state of AGENT_BUBBLE_STATES) assert.ok(ttlFor(state) > 0, `${state} sem TTL`)
  assert.deepEqual(TERMINAL_STATES, ['completed', 'failed', 'canceled'])
})

// --- DTO ------------------------------------------------------------------------

test('o DTO é versionado e não tem onde carregar conteúdo', () => {
  const [state] = selectVisualStates([row({ detail: { appKey: 'google', actionLabel: 'Criar evento' } })], NOW)
  assert.equal(LIVE_STATE_DTO_VERSION, 1)
  assert.deepEqual(Object.keys(state).sort(), [
    'agentId',
    'concurrent',
    'expiresAt',
    'floorId',
    'rootExecutionId',
    'safeDetail',
    'startedAt',
    'state',
    'updatedAt',
  ])
})

test('o mapa antigo continua sendo derivado da mesma projeção', () => {
  const response = { version: 1, generatedAt: NOW.toISOString(), states: selectVisualStates([row({ agent: 'a1' }), row({ agent: 'a2', state: 'completed' })], NOW) }
  // Terminal não é "trabalhando".
  assert.deepEqual(legacyWorkingMap(response), { a1: 'working' })
})

test('o ETag muda quando o estado muda e não quando nada mudou', () => {
  const build = (state) => ({ version: 1, generatedAt: NOW.toISOString(), states: selectVisualStates([row({ state })], NOW) })
  assert.equal(liveStatesEtag(build('thinking')), liveStatesEtag(build('thinking')))
  assert.notEqual(liveStatesEtag(build('thinking')), liveStatesEtag(build('delivering')))
})

// --- instrumentação de ferramentas ----------------------------------------------

test('a ferramenta instrumentada reporta início e volta a pensar, sem mudar o contrato', async () => {
  const seen = []
  const tracker = { report: (state, detail) => seen.push([state, detail]), finish: async () => undefined }
  const [tool] = instrumentTools(
    [{ name: 'google_agenda_criar_evento', description: 'Cria um evento', inputSchema: { type: 'object' }, run: async () => ({ ok: true, result: 'ok' }) }],
    tracker,
  )
  assert.equal(tool.name, 'google_agenda_criar_evento')
  assert.deepEqual(await tool.run({}), { ok: true, result: 'ok' })
  assert.deepEqual(seen, [
    ['using_tool', { appKey: 'google', actionLabel: 'Criar evento' }],
    ['thinking', undefined],
  ])
})

test('uma ferramenta que falha ainda devolve o agente para thinking', async () => {
  const seen = []
  const tracker = { report: (state) => seen.push(state), finish: async () => undefined }
  const [tool] = instrumentTools(
    [{ name: 'x', description: 'y', inputSchema: {}, run: async () => { throw new Error('boom') } }],
    tracker,
  )
  await assert.rejects(() => tool.run({}))
  assert.deepEqual(seen, ['using_tool', 'thinking'])
})

test('sem tracker, a lista de ferramentas é a mesma — nada é embrulhado à toa', () => {
  const tools = [{ name: 'x', description: 'y', inputSchema: {}, run: async () => ({ ok: true, result: '' }) }]
  assert.equal(instrumentTools(tools, NOOP_TRACKER), tools)
})
