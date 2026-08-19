// QUANDO um site vinculado a um agente é lido de novo.
//
// A decisão é pura de propósito: uma leitura a mais é latência na frente de quem
// perguntou; uma a menos é o agente respondendo com a página de ontem. Com relógio fixo
// dá para provar cada caso, em vez de esperar meia hora para ver o que acontece.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/comunicacaoai_test'

const {
  DEFAULT_INTERVAL_MINUTES,
  MAX_ARTICLES_PER_RUN,
  MIN_INTERVAL_MINUTES,
  nextScheduledAfter,
  normalizeWebSource,
  resolveDiscovery,
  shouldRefresh,
} = await import('../dist/webSourcePolicy.js')

const AGORA = new Date('2026-08-19T12:00:00Z').getTime()
const minutosAtras = (n) => new Date(AGORA - n * 60_000)

// --- o padrão de quem nunca configurou nada -------------------------------------------

test('uma fonte antiga, sem configuração, não lê nada sozinha', () => {
  const c = normalizeWebSource(undefined)
  assert.equal(c.refreshMode, 'manual')
  // Ligar leitura automática em endereço que alguém cadastrou para outra coisa seria
  // decidir pelo dono — e gastando a banda dele.
  assert.equal(shouldRefresh(undefined, {}, 'scheduled', AGORA).refresh, false)
  assert.equal(shouldRefresh(undefined, {}, 'on_demand', AGORA).refresh, false)
  // Mas o clique é sempre atendido.
  assert.equal(shouldRefresh(undefined, {}, 'manual', AGORA).refresh, true)
})

test('os limites são do sistema, não do formulário', () => {
  assert.equal(normalizeWebSource({ intervalMinutes: 1 }).intervalMinutes, MIN_INTERVAL_MINUTES)
  assert.equal(normalizeWebSource({ intervalMinutes: 999_999 }).intervalMinutes, 7 * 24 * 60)
  assert.equal(normalizeWebSource({ maxArticlesPerRun: 5000 }).maxArticlesPerRun, MAX_ARTICLES_PER_RUN)
  assert.equal(normalizeWebSource({ maxDepth: 9 }).maxDepth, 2)
  assert.equal(normalizeWebSource({}).intervalMinutes, DEFAULT_INTERVAL_MINUTES)
  // Um modo inventado não vira leitura automática por acidente.
  assert.equal(normalizeWebSource({ refreshMode: 'sempre' }).refreshMode, 'manual')
})

// --- por horário ------------------------------------------------------------------------

test('scheduled: lê quando dá a hora, e não antes', () => {
  const cfg = { refreshMode: 'scheduled', intervalMinutes: 30 }
  assert.equal(shouldRefresh(cfg, { nextScheduledAt: new Date(AGORA + 60_000) }, 'scheduled', AGORA).refresh, false)
  assert.equal(shouldRefresh(cfg, { nextScheduledAt: new Date(AGORA - 1) }, 'scheduled', AGORA).refresh, true)
  // Nunca lida: a primeira vez é agora.
  const primeira = shouldRefresh(cfg, {}, 'scheduled', AGORA)
  assert.equal(primeira.refresh, true)
  assert.match(primeira.reason, /primeira leitura/)
})

test('scheduled NÃO lê porque alguém chamou o agente', () => {
  // É o ponto do modo: previsível, no relógio, sem surpresa na frente do visitante.
  const d = shouldRefresh({ refreshMode: 'scheduled', intervalMinutes: 30 }, { lastSuccessfulFetchAt: minutosAtras(120) }, 'on_demand', AGORA)
  assert.equal(d.refresh, false)
  assert.match(d.reason, /horário/)
})

// --- sob demanda -------------------------------------------------------------------------

test('on_demand: lê antes de executar, mas só se o que está guardado envelheceu', () => {
  const cfg = { refreshMode: 'on_demand', maxStalenessMinutes: 30 }
  // O caso que economiza a maior parte das leituras.
  const recente = shouldRefresh(cfg, { lastSuccessfulFetchAt: new Date(AGORA - 30_000) }, 'on_demand', AGORA)
  assert.equal(recente.refresh, false)
  assert.match(recente.reason, /lida há 1 min|lida há 0 min/)
  assert.equal(shouldRefresh(cfg, { lastSuccessfulFetchAt: minutosAtras(31) }, 'on_demand', AGORA).refresh, true)
  assert.equal(shouldRefresh(cfg, {}, 'on_demand', AGORA).refresh, true, 'nunca lida, lê')
})

test('on_demand não é acordada pelo relógio', () => {
  assert.equal(shouldRefresh({ refreshMode: 'on_demand' }, {}, 'scheduled', AGORA).refresh, false)
})

// --- híbrida ------------------------------------------------------------------------------

test('hybrid responde aos dois: ao relógio e a quem vai usar o agente', () => {
  const cfg = { refreshMode: 'hybrid', intervalMinutes: 30, maxStalenessMinutes: 45 }
  assert.equal(shouldRefresh(cfg, { nextScheduledAt: new Date(AGORA - 1) }, 'scheduled', AGORA).refresh, true)
  // Dentro da validade: nem o relógio nem a chamada disparam leitura.
  assert.equal(shouldRefresh(cfg, { lastSuccessfulFetchAt: minutosAtras(10), nextScheduledAt: new Date(AGORA + 600_000) }, 'scheduled', AGORA).refresh, false)
  assert.equal(shouldRefresh(cfg, { lastSuccessfulFetchAt: minutosAtras(10) }, 'on_demand', AGORA).refresh, false)
  // Velha demais para servir: lê antes de executar.
  assert.equal(shouldRefresh(cfg, { lastSuccessfulFetchAt: minutosAtras(50) }, 'on_demand', AGORA).refresh, true)
})

test('desligada não lê por motivo nenhum — nem no clique', () => {
  const cfg = { refreshMode: 'hybrid', enabled: false }
  for (const motivo of ['scheduled', 'on_demand', 'manual']) {
    assert.equal(shouldRefresh(cfg, {}, motivo, AGORA).refresh, false, motivo)
  }
})

test('uma leitura que falhou não conta como leitura recente', () => {
  // `lastFetchedAt` é "tentei"; `lastSuccessfulFetchAt` é "consegui". Tratar as duas como
  // iguais deixaria o agente com a página velha depois de um site fora do ar.
  const cfg = { refreshMode: 'on_demand', maxStalenessMinutes: 30 }
  const so_tentou = shouldRefresh(cfg, { lastFetchedAt: new Date(AGORA - 60_000), lastSuccessfulFetchAt: minutosAtras(120) }, 'on_demand', AGORA)
  assert.equal(so_tentou.refresh, true, 'o que vale é a última leitura BEM-SUCEDIDA')
})

test('a próxima leitura por horário só existe para quem lê por horário', () => {
  assert.ok(nextScheduledAfter({ refreshMode: 'scheduled', intervalMinutes: 15 }, AGORA) instanceof Date)
  assert.equal(nextScheduledAfter({ refreshMode: 'scheduled', intervalMinutes: 15 }, AGORA).getTime(), AGORA + 15 * 60_000)
  assert.equal(nextScheduledAfter({ refreshMode: 'on_demand' }, AGORA), null)
  assert.equal(nextScheduledAfter({ refreshMode: 'manual' }, AGORA), null)
})

// --- o que ler ----------------------------------------------------------------------------

test('"automático" decide por regra, e sem hardcode de site nenhum', () => {
  assert.equal(resolveDiscovery({ discoveryMode: 'auto' }, 'rss', 'https://x.test/feed'), 'rss')
  assert.equal(resolveDiscovery({ discoveryMode: 'auto' }, 'http', 'https://x.test/sitemap.xml'), 'sitemap')
  assert.equal(resolveDiscovery({ discoveryMode: 'auto' }, 'http', 'https://x.test/pagina'), 'single_page')
  // Varrer links é escolha explícita: ela multiplica requisições no site do outro.
  assert.equal(resolveDiscovery({ discoveryMode: 'auto', crawlArticles: true }, 'http', 'https://x.test/blog'), 'listing')
  // Escolha explícita manda sobre a regra.
  assert.equal(resolveDiscovery({ discoveryMode: 'single_page', crawlArticles: true }, 'http', 'https://x.test/blog'), 'single_page')
})
