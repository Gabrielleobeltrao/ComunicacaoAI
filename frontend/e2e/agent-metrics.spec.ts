import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Operational agent metrics E2E. The roster cards and the agent page must show real
// operational telemetry (duration/tokens/specific KPI), not the old generic
// Conversas/Leads.
//
// These specs stub /api/agent-stats, so they need NO live stack and are NEVER skipped
// silently — the point of the previous version failing was that it looked green while
// selecting an <a href> the card does not render. Auth is stubbed too.
const AGENT_ID = '000000000000000000000a11'
const FLOOR_ID = '000000000000000000000f11'
const NOW = new Date(0).toISOString()
const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = {
  id: FLOOR_ID,
  buildingId: 'b1',
  name: 'Térreo',
  mission: '',
  description: '',
  timezone: 'America/Sao_Paulo',
  defaultLanguage: 'pt',
  color: null,
  icon: null,
  order: 0,
  status: 'active',
  createdAt: NOW,
  updatedAt: NOW,
}

const AGENT = {
  _id: AGENT_ID,
  name: 'Agente Teste',
  objective: 'Objetivo de teste',
  provider: 'anthropic',
  model: null,
  memoryType: 'none',
  historyLimit: 10,
  identityEnabled: false,
  identityFields: [],
  conversationPersistence: 'same_browser',
  guardrailMode: 'none',
  structuredOutputEnabled: false,
  structuredOutputFields: [],
  structuredOutputWebhookUrl: null,
  responseTone: 'neutral',
  responseDetail: 'balanced',
  responseEmojis: false,
  responseFormatting: false,
  handoffEnabled: false,
  firstMessage: null,
  proactivityEnabled: false,
  proactivityGuidance: '',
  language: 'pt',
  dailyMessageLimit: 0,
  cheapAuxModel: true,
  promptCaching: true,
  tools: [],
  builtinTools: [],
  preset: 'researcher',
  capabilities: [],
  activationModes: ['manual'],
  inputContract: '',
  outputContract: '',
  delegationPolicy: 'none',
  callerPolicy: 'all',
  callableAgentIds: [],
  callableSectorIds: [],
  allowedCallerAgentIds: [],
  metricProfile: 'auto',
  floorId: null,
}

const statsPayload = (over: Record<string, unknown> = {}) => ({
  period: '30d',
  telemetrySince: '2026-08-01T00:00:00.000Z',
  stats: {
    [AGENT_ID]: {
      executions: 4,
      avgDurationMs: 2500,
      activeTimeMs: 10_000,
      totalTokens: 1500,
      avgTokensPerExecution: 375,
      successRate: 0.75,
      specific: { key: 'executions', label: 'Pesquisas concluídas', shortLabel: 'Execuções', value: 3 },
      ...(over.stat as object),
    },
  },
  channel: { [AGENT_ID]: { linked: false, conversations: 0, attendedConversations: 0, qualifiedLeads: 0 } },
})

// Stub the API surface the agents roster needs. `statsHandler` lets a test delay or
// fail /api/agent-stats to cover loading and error states.
async function stubApi(page: Page, opts: { stats?: () => Promise<unknown> | unknown; statsStatus?: number } = {}) {
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: [AGENT] }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: [AGENT] }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  // Nav V2 resolves the roster under an active floor — without one, /agents
  // redirects to the dashboard.
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  await page.route('**/api/agent-states**', (r) => r.fulfill({ json: {} }))
  await page.route('**/api/floor-metrics**', (r) => r.fulfill({ json: null }))
  await page.route('**/api/agent-stats**', async (r) => {
    if (opts.statsStatus && opts.statsStatus >= 400) return r.fulfill({ status: opts.statsStatus, json: { error: 'boom' } })
    const body = opts.stats ? await opts.stats() : statsPayload()
    return r.fulfill({ json: body })
  })
  // better-auth session shape — without this ProtectedRoute bounces to /login.
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
}

test('cards keep the three operational positions and use the compact KPI label', async ({ page }) => {
  await stubApi(page)
  await page.goto(`/floors/${FLOOR_ID}/agents`)
  const card = page.getByTestId('agent-card').first()
  await expect(card).toBeVisible()
  const metrics = card.getByTestId('agent-card-metric')
  await expect(metrics).toHaveCount(3)
  await expect(metrics.nth(0)).toContainText('Tempo méd.')
  await expect(metrics.nth(1)).toContainText('Tokens 30d')
  // Compact label on the card; the full label rides in the tooltip.
  await expect(metrics.nth(2)).toContainText('Execuções')
  await expect(metrics.nth(2)).toHaveAttribute('title', 'Pesquisas concluídas')
  await expect(metrics.nth(0)).toContainText('2.5s')
  await expect(metrics.nth(1)).toContainText('1.5k')
})

test('an agent with no telemetry shows "—", not a fake zero', async ({ page }) => {
  await stubApi(page, { stats: () => ({ period: '30d', telemetrySince: null, stats: {}, channel: {} }) })
  await page.goto(`/floors/${FLOOR_ID}/agents`)
  const metrics = page.getByTestId('agent-card').first().getByTestId('agent-card-metric')
  await expect(metrics.nth(0)).toContainText('—')
  await expect(metrics.nth(2)).toContainText('—')
})

test('a stats failure degrades to "—" instead of breaking the roster', async ({ page }) => {
  await stubApi(page, { statsStatus: 500 })
  await page.goto(`/floors/${FLOOR_ID}/agents`)
  const card = page.getByTestId('agent-card').first()
  await expect(card).toBeVisible() // the roster still renders
  await expect(card.getByTestId('agent-card-metric').nth(1)).toContainText('—')
})

test('metrics render placeholders while loading, without layout jumps', async ({ page }) => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((r) => (release = r))
  await stubApi(page, {
    stats: async () => {
      await gate
      return statsPayload()
    },
  })
  await page.goto(`/floors/${FLOOR_ID}/agents`)
  const metrics = page.getByTestId('agent-card').first().getByTestId('agent-card-metric')
  await expect(metrics).toHaveCount(3) // all three positions exist during loading
  await expect(metrics.nth(1)).toContainText('—')
  release?.()
  await expect(metrics.nth(1)).toContainText('1.5k') // resolves in place
})

test('clicking a card navigates to the agent page', async ({ page }) => {
  await stubApi(page)
  await page.route('**/api/agents/*/overview', (r) =>
    r.fulfill({
      json: {
        agent: AGENT,
        stats: { conversations: 0, conversationsThisWeek: 0, messagesThisWeek: 0, attendedConversations: 0, handoffs: 0, qualifiedLeads: 0 },
        channelLinked: false,
        availableMetrics: ['executions'],
        resolvedMetric: 'executions',
        linkedWidgets: [],
        linkedSectors: [],
        knowledgeCount: 0,
      },
    }),
  )
  await page.route('**/api/agents/*/documents', (r) => r.fulfill({ json: [] }))
  await page.goto(`/floors/${FLOOR_ID}/agents`)
  await page.getByTestId('agent-card').first().click()
  await expect(page).toHaveURL(new RegExp(`/agents/${AGENT_ID}$`))
  await expect(page.getByRole('heading', { name: 'Desempenho operacional' })).toBeVisible()
})

test('the agent page period switch refetches with the chosen period', async ({ page }) => {
  const requested: string[] = []
  await stubApi(page)
  await page.route('**/api/agent-stats**', (r) => {
    requested.push(new URL(r.request().url()).searchParams.get('period') ?? '')
    return r.fulfill({ json: statsPayload() })
  })
  await page.route('**/api/agents/*/overview', (r) =>
    r.fulfill({
      json: {
        agent: AGENT,
        stats: { conversations: 0, conversationsThisWeek: 0, messagesThisWeek: 0, attendedConversations: 0, handoffs: 0, qualifiedLeads: 0 },
        channelLinked: false,
        availableMetrics: ['executions'],
        resolvedMetric: 'executions',
        linkedWidgets: [],
        linkedSectors: [],
        knowledgeCount: 0,
      },
    }),
  )
  await page.route('**/api/agents/*/documents', (r) => r.fulfill({ json: [] }))
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}`)
  await expect(page.getByRole('heading', { name: 'Desempenho operacional' })).toBeVisible()
  await page.getByRole('button', { name: '7 dias' }).click()
  await expect.poll(() => requested).toContain('7d')
})
