import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Hiring UX: three steps, only the fields each ROLE needs, no technical jargon, a
// handover checklist when something is still missing, and the agent page reorganised
// into five sections with a readiness card.
//
// The API is stubbed, so these run without a live stack and can never pass vacuously.
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
  preset('researcher', 'Pesquisador', { requiresTool: true }),
  preset('analyst', 'Analista'),
  preset('operator', 'Executor / Operador', { requiresTool: true }),
  preset('communicator', 'Comunicador'),
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

let created: Record<string, unknown> | null = null

async function stubApi(page: Page, opts: { overview?: Record<string, unknown> } = {}) {
  created = null
  await page.route('**/api/agent-presets', (r) => r.fulfill({ json: PRESETS }))
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents', async (r) => {
    if (r.request().method() === 'POST') {
      created = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ status: 201, json: { ...AGENT, ...created, _id: AGENT_ID } })
    }
    return r.fulfill({ json: [] })
  })
  await page.route('**/api/agents/*/overview', (r) => r.fulfill({ json: opts.overview ?? overview() }))
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

const openWizard = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}/agents`)
  await page.getByRole('button', { name: 'Contratar agente' }).first().click()
  await expect(page.getByTestId('hire-wizard')).toBeVisible()
}

test('the wizard has exactly three steps', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await expect(page.getByText('1. Função')).toBeVisible()
  await expect(page.getByText('2. Trabalho')).toBeVisible()
  await expect(page.getByText('3. Revisar')).toBeVisible()
  await expect(page.getByText('4.', { exact: false })).toHaveCount(0)
})

test('a manager is asked about colleagues, never about a research topic', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await page.getByText('Gerente / Orquestrador').click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByTestId('work-step')).toBeVisible()
  await expect(page.getByText('Quem ele pode acionar')).toBeVisible()
  await expect(page.getByText('Tema que ele pesquisa')).toHaveCount(0)
})

test('a researcher is asked for a topic and format, not for colleagues', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await page.getByText('Pesquisador', { exact: true }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByText('Tema que ele pesquisa')).toBeVisible()
  await expect(page.getByText('Formato da resposta')).toBeVisible()
  await expect(page.getByText('Quem ele pode acionar')).toHaveCount(0)
})

test('a communicator gets a tone field; an analyst does not', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await page.getByText('Comunicador', { exact: true }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByText('Tom da escrita')).toBeVisible()
  await page.getByRole('button', { name: 'Voltar' }).click()
  await page.getByText('Analista', { exact: true }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByText('Tom da escrita')).toHaveCount(0)
  await expect(page.getByText('Dados que ele recebe')).toBeVisible()
})

test('no technical jargon is shown anywhere in the wizard', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  for (const role of ['Gerente / Orquestrador', 'Pesquisador', 'Operador']) {
    const option = page.getByText(role, { exact: false }).first()
    if (await option.count()) await option.click()
    await page.getByRole('button', { name: 'Próximo' }).click()
    const body = (await page.getByTestId('hire-wizard').innerText()).toLowerCase()
    for (const jargon of ['callerpolicy', 'delegationpolicy', 'inputcontract', 'outputcontract', 'activationmode', 'agent_only']) {
      expect(body, `"${jargon}" leaked into the wizard`).not.toContain(jargon)
    }
    await page.getByRole('button', { name: 'Voltar' }).click()
  }
})

test('hiring a monitor hands over a checklist instead of pretending it is done', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await page.getByText('Monitor', { exact: true }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Contratar agente' }).last().click()
  const checklist = page.getByTestId('hire-checklist')
  await expect(checklist).toBeVisible()
  await expect(checklist).toContainText('Conectar a fonte')
  await expect(checklist).toContainText('Criar a rotina')
  // The safe role defaults were applied without asking the user.
  expect(created?.preset).toBe('monitor')
  expect(created?.delegationPolicy).toBe('none')
  expect(created?.callerPolicy).toBe('all')
  expect(created?.activationModes).toEqual(['scheduled'])
})

test('hiring an analyst closes straight away (nothing pending)', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await page.getByText('Analista', { exact: true }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Contratar agente' }).last().click()
  await expect(page).toHaveURL(new RegExp(`/agents/${AGENT_ID}`))
})

test('the wizard fits a phone screen without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stubApi(page)
  await openWizard(page)
  await page.getByText('Pesquisador', { exact: true }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByTestId('work-step')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

// ------------------------------------------------------------- agent page
test('the agent page has five sections and opens on Visão geral', async ({ page }) => {
  await stubApi(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}`)
  for (const label of ['Visão geral', 'Como trabalha', 'Fluxos', 'Atividade', 'Avançado']) {
    await expect(page.getByRole('button', { name: label })).toBeVisible()
  }
  await expect(page.getByTestId('agent-summary')).toBeVisible()
})

test('readiness shows the pending item with its action', async ({ page }) => {
  await stubApi(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}`)
  const card = page.getByTestId('agent-readiness')
  await expect(card).toBeVisible()
  await expect(card).toContainText('não tem nenhuma fonte')
  await card.getByRole('button', { name: 'Adicionar ferramenta' }).click()
  await expect(page).toHaveURL(/como-trabalha$/)
})

test('a ready agent shows no pending list', async ({ page }) => {
  await stubApi(page, { overview: overview({ readiness: { ready: true, issues: [] } }) })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}`)
  await expect(page.getByText('Pronto para trabalhar')).toBeVisible()
  await expect(page.getByTestId('agent-readiness')).toHaveCount(0)
})

test('Fluxos separates allowed from configured', async ({ page }) => {
  await stubApi(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  const panel = page.getByTestId('agent-triggers')
  await expect(panel).toBeVisible()
  // manual: configured. scheduled: allowed but no routine yet.
  await expect(panel.getByText('Configurado').first()).toBeVisible()
  await expect(panel.getByText('Permitido').first()).toBeVisible()
})

test('a legacy link to an old tab still lands somewhere sensible', async ({ page }) => {
  await stubApi(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/historico`)
  // 'historico' folded into Atividade — the page renders instead of 404ing.
  await expect(page.getByRole('button', { name: 'Atividade' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Desempenho operacional' })).toBeVisible()
})

test('a legacy agent_only agent opens normally', async ({ page }) => {
  await stubApi(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}`)
  await expect(page.getByTestId('agent-summary')).toBeVisible()
  // agent_only is never surfaced as a trigger.
  await page.getByRole('button', { name: 'Fluxos' }).click()
  const panel = page.getByTestId('agent-triggers')
  await expect(panel).toBeVisible()
  expect((await panel.innerText()).toLowerCase()).not.toContain('agent_only')
})
