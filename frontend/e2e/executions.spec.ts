import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The Central de execuções end to end, with the API stubbed. What these pin is the
// contract of the surface: the four tabs, counters that only show what the backend
// measured, a webhook described as an ARMED TRIGGER (never a pending execution), the
// pause/activate round trip, and the states (loading, empty per tab, error + retry).
const FLOOR_ID = '000000000000000000000f11'
const AGENT_ID = '000000000000000000000a11'
const NOW = new Date(0).toISOString()

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = { id: FLOOR_ID, buildingId: 'b1', name: 'Térreo', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', createdAt: NOW, updatedAt: NOW }

const AGENT_REF = { id: AGENT_ID, name: 'Ana', objective: 'Cuidar do atendimento' }
const PLACE = { floorId: FLOOR_ID, floorName: 'Térreo', sectorId: 's1', sectorName: 'Atendimento' }

const SCHEDULED = {
  id: 'sch-1',
  kind: 'schedule',
  name: 'Resumo diário',
  objective: 'Consolidar o dia para o time',
  status: 'active',
  agent: AGENT_REF,
  place: PLACE,
  cron: '0 9 * * *',
  timezone: 'America/Sao_Paulo',
  scheduleLabel: 'Todo dia às 09:00',
  nextRunAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
  lastRun: { id: 'r0', status: 'succeeded', finishedAt: NOW, errorKind: null },
  recentRuns: 8,
  recentTokens: 9600,
  averageTokens: 1200,
}

const TRIGGER = {
  id: 'trg-1',
  kind: 'webhook',
  name: 'Novo pedido no site',
  objective: 'Analisar o pedido e avisar o time',
  status: 'active',
  agent: AGENT_REF,
  place: PLACE,
  endpoint: 'https://api.exemplo.test/api/hooks/automations/pk-abc',
  requireSignature: true,
  lastActivationAt: null,
  lastResult: null,
  recentRuns: 0,
  recentTokens: 0,
  averageTokens: null,
}

const RUN = {
  id: 'run-1',
  automationId: 'sch-1',
  name: 'Resumo diário',
  status: 'running',
  triggerType: 'schedule',
  agent: AGENT_REF,
  place: PLACE,
  queuedAt: NOW,
  startedAt: NOW,
  finishedAt: null,
  tokens: 350,
  errorKind: null,
}

const SUMMARY = { next24h: 3, activeTriggers: 1, inFlight: 2, tokensWindow: 42_000, runsWindow: 17, windowDays: 30 }

let lastAction: string | null = null
let lastListUrl: string | null = null
let lastSummaryUrl: string | null = null

async function stub(page: Page, opts: { items?: Record<string, unknown[]>; fail?: boolean } = {}) {
  lastAction = null
  lastListUrl = null
  lastSummaryUrl = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const items = opts.items ?? { scheduled: [SCHEDULED], triggers: [TRIGGER], active: [RUN], history: [{ ...RUN, id: 'run-2', status: 'succeeded', finishedAt: NOW }] }

  await page.route('**/api/executions/summary**', (r) => {
    lastSummaryUrl = r.request().url()
    return opts.fail ? r.fulfill({ status: 500, json: {} }) : r.fulfill({ json: SUMMARY })
  })
  await page.route('**/api/executions?**', (r) => {
    lastListUrl = r.request().url()
    if (opts.fail) return r.fulfill({ status: 500, json: {} })
    const tab = new URL(r.request().url()).searchParams.get('tab') ?? 'scheduled'
    const list = items[tab] ?? []
    return r.fulfill({ json: { tab, items: list, total: list.length, limit: 20, skip: 0 } })
  })
  await page.route('**/api/agents/*/event-triggers/*/*', (r) => {
    lastAction = r.request().url().split('/').pop() ?? null
    return r.fulfill({ json: { ...TRIGGER, status: 'paused' } })
  })
  await page.route('**/api/agents/*/routines/*/*', (r) => {
    lastAction = r.request().url().split('/').pop() ?? null
    return r.fulfill({ json: { id: 'sch-1', name: 'Resumo diário', status: 'paused' } })
  })
  await page.route('**/api/executions/analytics**', (r) =>
    r.fulfill({
      json: {
        scope: 'building',
        period: '30d',
        telemetrySince: '2026-01-01T00:00:00.000Z',
        executions: 3,
        succeeded: 2,
        failed: 1,
        canceled: 0,
        running: 0,
        successRate: 0.6667,
        avgDurationMs: 6000,
        p95DurationMs: 9000,
        avgQueueMs: 1200,
        activeTimeMs: 15000,
        totalTokens: 2400,
        avgTokensPerExecution: 800,
        participations: 7,
        partialTelemetry: 2,
      },
    }),
  )
  await page.route('**/api/executions/breakdown**', (r) =>
    r.fulfill({
      json: [
        { id: FLOOR_ID, label: FLOOR_ID, executions: 3, successRate: 0.5, totalTokens: 1800, participations: 5 },
        { id: 'sem-andar', label: 'sem-andar', executions: 1, successRate: 1, totalTokens: 600, participations: 2 },
      ],
    }),
  )
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: [{ _id: AGENT_ID, name: 'Ana', floorId: FLOOR_ID }] }))
  await page.route('**/api/sectors**', (r) =>
    r.fulfill({
      json: [
        { _id: 's1', name: 'Atendimento', floorId: FLOOR_ID, mode: 'orchestrated', members: [{ agentId: AGENT_ID }] },
        { _id: 's2', name: 'Compras', floorId: 'outro-andar', mode: 'orchestrated', members: [] },
      ],
    }),
  )
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) => r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }))
}

test('the counters show what the backend measured, with the sample behind the tokens', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  const counters = page.getByTestId('execution-counters')
  await expect(counters).toContainText('Próximas 24h')
  await expect(counters).toContainText('3')
  await expect(counters).toContainText('Gatilhos ativos')
  await expect(counters).toContainText('Tokens em 30 dias')
  await expect(counters).toContainText('42 mil')
  // A total is a measurement: the number of runs behind it is stated.
  await expect(counters).toContainText('17 execução(ões) no período')
})

test('a scheduled routine shows when it runs next, relative AND absolute', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  const next = page.getByTestId('next-run').first()
  await expect(next).toContainText('em 3 horas')
  await expect(next).toContainText('/')
  const list = page.getByTestId('executions-list')
  await expect(list).toContainText('Todo dia às 09:00')
  await expect(list).toContainText('America/Sao_Paulo')
  await expect(list).toContainText('Ana')
  await expect(list).toContainText('Térreo · Atendimento')
  // Consumption is presented as an average over a named sample, never as a cost.
  await expect(list).toContainText('média de 8')
})

test('a webhook is an armed trigger waiting for an event, and its secret is nowhere', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  await page.getByTestId('tab-triggers').click()
  const list = page.getByTestId('executions-list')
  await expect(list).toContainText('Aguardando evento')
  await expect(list).toContainText('Assinatura obrigatória')
  await expect(list).toContainText('nunca acionado')
  await expect(list).toContainText('Sem histórico')
  const body = await list.innerText()
  expect(body.toLowerCase()).not.toContain('secret')
  expect(body.toLowerCase()).not.toContain('credencial')
})

test('pausing a scheduled routine calls the agent-owned endpoint and refreshes', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  await page.getByTestId('pause-scheduled').first().click()
  await expect.poll(() => lastAction).toBe('pause')
})

test('each tab has its own empty state, in the user language', async ({ page }) => {
  await stub(page, { items: { scheduled: [], triggers: [], active: [], history: [] } })
  await page.goto('/executions')
  await expect(page.getByTestId('executions-empty')).toContainText('Nenhuma rotina agendada')
  await page.getByTestId('tab-triggers').click()
  await expect(page.getByTestId('executions-empty')).toContainText('Nenhum gatilho por evento')
  await page.getByTestId('tab-active').click()
  await expect(page.getByTestId('executions-empty')).toContainText('Nada em andamento')
  await page.getByTestId('tab-history').click()
  await expect(page.getByTestId('executions-empty')).toContainText('Sem histórico')
})

test('a failure offers to try again, and succeeds on the retry', async ({ page }) => {
  await stub(page, { fail: true })
  await page.goto('/executions')
  await expect(page.getByTestId('executions-error')).toBeVisible()

  // The API recovers; the retry button must actually re-fetch.
  await stub(page)
  await page.getByTestId('executions-error').getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(page.getByTestId('executions-list')).toBeVisible()
})

test('the in-flight tab lists work that is happening now', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  await page.getByTestId('tab-active').click()
  const list = page.getByTestId('executions-list')
  await expect(list).toContainText('Executando')
  await expect(list).toContainText('350 tokens')
})

test('Execuções is in the sidebar under CONTROLE and opens from it', async ({ page }) => {
  await stub(page)
  // From another top-level page, so the rail is not mid-redirect.
  await page.route('**/api/tools', (r) => r.fulfill({ json: [] }))
  await page.goto('/tools')
  await page.hover('aside')
  await expect(page.getByText('CONTROLE')).toBeVisible()
  await page.getByRole('link', { name: 'Execuções' }).click()
  await expect(page).toHaveURL(/\/executions$/)
})

test('on a phone the drawer carries it, filters hide behind a toggle and nothing overflows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stub(page)
  await page.goto('/executions')
  await expect(page.getByTestId('executions-list')).toBeVisible()

  // Filters are behind the sheet toggle until asked for.
  await expect(page.getByTestId('filter-sheet')).toHaveCount(0)
  await page.getByTestId('toggle-filters').click()
  await expect(page.getByTestId('filter-sheet').getByTestId('execution-filters')).toBeVisible()
  await page.keyboard.press('Escape')

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  // Same destination, same config: the drawer lists it too.
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  await expect(page.getByRole('link', { name: 'Execuções' })).toBeVisible()
})

test('the filters are sent together, and the counters are asked the same question', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  await page.getByLabel('Filtrar por andar').selectOption(FLOOR_ID)
  await page.getByLabel('Filtrar por setor').selectOption('s1')
  await page.getByLabel('Filtrar por agente').selectOption(AGENT_ID)

  await expect.poll(() => lastListUrl).toContain(`agentId=${AGENT_ID}`)
  expect(lastListUrl).toContain(`floorId=${FLOOR_ID}`)
  expect(lastListUrl).toContain('sectorId=s1')
  // The header describes the same set as the rows.
  await expect.poll(() => lastSummaryUrl).toContain(`agentId=${AGENT_ID}`)
  expect(lastSummaryUrl).toContain('sectorId=s1')
})

test('changing the floor clears a sector that belongs to another one', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  await page.getByLabel('Filtrar por setor').selectOption('s2')
  await expect(page.getByLabel('Filtrar por setor')).toHaveValue('s2')

  await page.getByLabel('Filtrar por andar').selectOption(FLOOR_ID)
  // s2 lives on another floor: it cannot survive the change.
  await expect(page.getByLabel('Filtrar por setor')).toHaveValue('')
  await expect.poll(() => lastListUrl).not.toContain('sectorId=s2')
})

test('choosing a sector offers only its agents', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  const agentPicker = page.getByLabel('Filtrar por agente')
  await expect(agentPicker.getByRole('option')).toHaveCount(2) // "todos" + Ana

  await page.getByLabel('Filtrar por setor').selectOption('s2') // a sector with no members
  await expect(agentPicker.getByRole('option')).toHaveCount(1) // only "todos"
})

test('the mobile filters are a real sheet: overlay, Escape, Aplicar and Limpar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stub(page)
  await page.goto('/executions')
  await expect(page.getByTestId('filter-sheet')).toHaveCount(0)

  await page.getByTestId('toggle-filters').click()
  const sheet = page.getByTestId('filter-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet).toHaveAttribute('aria-modal', 'true')
  // The page behind it must not scroll while it is open.
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')

  // Escape closes it and restores the scroll.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('filter-sheet')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')

  // Choosing inside the sheet does nothing until "Aplicar".
  await page.getByTestId('toggle-filters').click()
  await sheet.getByLabel('Filtrar por andar').selectOption(FLOOR_ID)
  expect(lastListUrl).not.toContain('floorId=')
  await page.getByTestId('apply-filters').click()
  await expect(page.getByTestId('filter-sheet')).toHaveCount(0)
  await expect.poll(() => lastListUrl).toContain(`floorId=${FLOOR_ID}`)

  // The button announces how many are on, and "Limpar" empties them.
  await expect(page.getByTestId('toggle-filters')).toContainText('(1)')
  await page.getByTestId('toggle-filters').click()
  await page.getByTestId('clear-filters').click()
  await page.getByTestId('apply-filters').click()
  await expect.poll(() => lastListUrl).not.toContain('floorId=')
  await expect(page.getByTestId('toggle-filters')).not.toContainText('(')
})

test('the backdrop closes the sheet without applying', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stub(page)
  await page.goto('/executions')
  await page.getByTestId('toggle-filters').click()
  await page.getByTestId('filter-sheet').getByLabel('Filtrar por andar').selectOption(FLOOR_ID)
  await page.getByTestId('filter-sheet-backdrop').click()
  await expect(page.getByTestId('filter-sheet')).toHaveCount(0)
  expect(lastListUrl).not.toContain('floorId=')
})

test('desktop keeps the filters visible, with no sheet at all', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  await expect(page.getByTestId('execution-filters')).toBeVisible()
  await expect(page.getByTestId('filter-sheet')).toHaveCount(0)
})

test('the Central links to the full log', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  await page.getByTestId('open-logs').click()
  await expect(page).toHaveURL(/\/settings\/logs$/)
})

// --- análise ------------------------------------------------------------------------

test('a aba Análise conta cada pedido uma vez e separa tempo ativo de duração', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  await page.getByTestId('tab-analysis').click()

  const metrics = page.getByTestId('analytics-metrics')
  await expect(metrics).toContainText('Execuções')
  await expect(metrics).toContainText('3')
  await expect(metrics).toContainText('Duração média')
  await expect(metrics).toContainText('6.0s')
  // Tempo somado dos agentes é outra métrica, com rótulo próprio.
  await expect(metrics).toContainText('Tempo ativo somado')
  await expect(metrics).toContainText('15.0s')
  await expect(metrics).toContainText('P95')
})

test('a análise declara telemetria parcial em vez de fingir histórico', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  await page.getByTestId('tab-analysis').click()
  await expect(page.getByTestId('analytics-telemetry')).toContainText('Telemetria disponível desde')
  await expect(page.getByTestId('analytics-telemetry')).toContainText('2 registro(s) antigo(s) sem correlação')
})

test('o detalhamento separa execuções de participações e diz que somar não vale', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  await page.getByTestId('tab-analysis').click()
  const table = page.getByTestId('analytics-breakdown')
  await expect(table).toContainText('Térreo')
  await expect(table).toContainText('Participações')
  await expect(table).toContainText('Somar participações não dá o total de execuções')
})

test('a análise aponta onde o trabalho aperta', async ({ page }) => {
  await stub(page)
  await page.goto('/executions')
  await page.getByTestId('tab-analysis').click()
  await expect(page.getByTestId('analytics-bottlenecks')).toContainText('concentra')
  await expect(page.getByTestId('analytics-bottlenecks')).toContainText('menor taxa de sucesso')
})
