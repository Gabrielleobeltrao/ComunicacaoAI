import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// "Gatilhos por webhook" inside the agent's Fluxos tab. The whole point of this
// surface is that the user creates an endpoint for THIS agent without ever meeting
// the word "automação" — and that the credential is shown once and never again.
//
// The API is stubbed, so this runs without a live stack and can never pass vacuously.
const FLOOR_ID = '000000000000000000000f11'
const AGENT_ID = '000000000000000000000a11'
const NOW = new Date(0).toISOString()

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = { id: FLOOR_ID, buildingId: 'b1', name: 'Térreo', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', createdAt: NOW, updatedAt: NOW }

const preset = (p: string, label: string, over: Record<string, unknown> = {}) => ({
  preset: p,
  label,
  description: `${label} faz algo`,
  objective: `Você é um ${label.toLowerCase()}.`,
  capabilities: [],
  activationModes: ['manual'],
  inputContract: '',
  outputContract: '',
  delegationPolicy: 'none',
  callerPolicy: 'all',
  ...over,
})

const PRESETS = [
  preset('manager', 'Gerente / Orquestrador', { delegationPolicy: 'all', activationModes: ['manual', 'scheduled'] }),
  preset('secretary', 'Secretário', { delegationPolicy: 'all' }),
  // Specialists ship with NO operational trigger: a manager or a sector calls them.
  preset('researcher', 'Pesquisador', { requiresTool: true, activationModes: [] }),
  preset('analyst', 'Analista', { activationModes: [] }),
  preset('operator', 'Executor / Operador', { requiresTool: true }),
  preset('communicator', 'Comunicador', { activationModes: [] }),
  preset('monitor', 'Monitor', { requiresTool: true, activationModes: ['scheduled'] }),
  preset('custom', 'Personalizado'),
]

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
  // A LEGACY agent: still carries agent_only, which must not break the page.
  activationModes: ['agent_only', 'manual'],
  inputContract: 'Um tema para pesquisar',
  outputContract: 'Lista com fontes',
  delegationPolicy: 'none',
  callerPolicy: 'all',
  callableAgentIds: [],
  callableSectorIds: [],
  allowedCallerAgentIds: [],
  metricProfile: 'auto',
  floorId: null,
}

const overview = (over: Record<string, unknown> = {}) => ({
  agent: AGENT,
  stats: { conversations: 0, conversationsThisWeek: 0, messagesThisWeek: 0, attendedConversations: 0, handoffs: 0, qualifiedLeads: 0 },
  channelLinked: false,
  wiring: { routineCount: 0, channelCount: 0, webhookCount: 0, collaboratorCount: 0, toolCount: 0, knowledgeCount: 0, deliveryConfigured: false },
  readiness: { ready: false, issues: [{ code: 'no_research_source', message: 'Este pesquisador não tem nenhuma fonte para consultar.', action: 'Adicionar ferramenta', section: 'como-trabalha' }] },
  triggers: [
    { kind: 'manual', allowed: true, configured: true },
    { kind: 'scheduled', allowed: true, configured: false },
    { kind: 'channel', allowed: false, configured: false },
    { kind: 'event', allowed: false, configured: false },
  ],
  availableMetrics: ['executions'],
  resolvedMetric: 'executions',
  linkedWidgets: [],
  linkedSectors: [],
  knowledgeCount: 0,
  ...over,
})


const TRIGGER = {
  id: 'trg-1',
  name: 'Novo pedido no site',
  objective: 'Analisar o pedido e avisar o time',
  status: 'active',
  endpoint: 'https://api.exemplo.test/api/hooks/automations/pk-abc',
  requireSignature: true,
  hasSecret: true,
  createdAt: NOW,
  updatedAt: NOW,
}
const SECRET = 'a'.repeat(64)

let posted: { url: string; body: Record<string, unknown> | null } | null = null

async function stubApi(page: Page, opts: { triggers?: unknown[] } = {}) {
  posted = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  await page.route('**/api/agent-presets', (r) => r.fulfill({ json: PRESETS }))
  await page.route('**/api/agents/*/event-triggers/*/*', (r) => {
    posted = { url: r.request().url(), body: null }
    return r.fulfill({ json: { ...TRIGGER, status: 'paused' } })
  })
  await page.route('**/api/agents/*/event-triggers/*/rotate', (r) => {
    posted = { url: r.request().url(), body: null }
    return r.fulfill({ json: { ...TRIGGER, secret: 'b'.repeat(64) } })
  })
  await page.route('**/api/agents/*/event-triggers', (r) => {
    if (r.request().method() === 'POST') {
      posted = { url: r.request().url(), body: JSON.parse(r.request().postData() ?? '{}') }
      return r.fulfill({ status: 201, json: { ...TRIGGER, secret: SECRET } })
    }
    return r.fulfill({ json: opts.triggers ?? [TRIGGER] })
  })
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/overview', (r) => r.fulfill({ json: overview() }))
  await page.route('**/api/agents/*/documents', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/routines', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/history**', (r) => r.fulfill({ json: { total: 0, items: [], delegations: [] } }))
  await page.route('**/api/agent-stats**', (r) => r.fulfill({ json: { period: '30d', telemetrySince: null, stats: {}, channel: {} } }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  await page.route('**/api/providers**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/apps**', (r) => r.fulfill({ json: [] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) => r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }))
}

const openFluxos = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await expect(page.getByTestId('agent-event-triggers')).toBeVisible()
}

test('the area speaks about events, never about automations', async ({ page }) => {
  await stubApi(page)
  await openFluxos(page)
  const area = page.getByTestId('agent-event-triggers')
  await expect(area).toContainText('Gatilhos por webhook')
  await expect(area).toContainText('Aguardando evento')
  await expect(area).toContainText('Assinatura obrigatória')
  // The URL path legitimately contains /automations (the receiver's public route),
  // so what must be absent is the WORD in the copy the user reads.
  expect(await area.innerText()).not.toMatch(/automaç/i)
})

test('the endpoint is shown, copyable, and comes with a request example', async ({ page }) => {
  await stubApi(page)
  await openFluxos(page)
  await expect(page.getByTestId('trigger-endpoint')).toContainText('/api/hooks/automations/pk-abc')

  await page.getByTestId('toggle-example').click()
  const example = page.getByTestId('trigger-example')
  // The two headers the receiver really honours must be in the example.
  await expect(example).toContainText('x-signature')
  await expect(example).toContainText('x-event-id')
})

test('creating a trigger asks only what the user knows, and shows the secret ONCE', async ({ page }) => {
  await stubApi(page, { triggers: [] })
  await openFluxos(page)
  await page.getByTestId('new-event-trigger').click()
  await page.getByTestId('trigger-objective').fill('Analisar o pedido recebido')
  await page.getByTestId('trigger-name').fill('Novo pedido no site')
  await page.getByTestId('save-event-trigger').click()

  await expect.poll(() => posted?.body).toMatchObject({ objective: 'Analisar o pedido recebido', name: 'Novo pedido no site' })

  // The one moment the credential exists in the browser.
  const shown = page.getByTestId('trigger-secret')
  await expect(shown).toContainText(SECRET)
  await expect(shown).toContainText('uma única vez')

  // Dismissing it takes it away for good: nothing re-fetches it.
  await shown.getByRole('button', { name: 'Já guardei' }).click()
  await expect(page.getByTestId('trigger-secret')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('agent-event-triggers')).toBeVisible()
  await expect(page.getByTestId('trigger-secret')).toHaveCount(0)
  expect(await page.getByTestId('agent-event-triggers').innerText()).not.toContain(SECRET)
})

test('rotating asks for confirmation and shows the NEW credential once', async ({ page }) => {
  await stubApi(page)
  await openFluxos(page)
  page.on('dialog', (d) => void d.accept())
  await page.getByTestId('rotate-secret').click()
  await expect(page.getByTestId('trigger-secret')).toContainText('b'.repeat(64))
  await expect.poll(() => posted?.url).toContain('/rotate')
})

test('pausing calls the agent-native endpoint', async ({ page }) => {
  await stubApi(page)
  await openFluxos(page)
  await page.getByTestId('pause-trigger').click()
  await expect.poll(() => posted?.url).toContain('/event-triggers/trg-1/pause')
})

test('the area is usable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stubApi(page)
  await openFluxos(page)
  await expect(page.getByTestId('event-trigger-card').first()).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
