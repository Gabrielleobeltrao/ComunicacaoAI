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

// ---------------------------------------------- corrective review regressions
test('every pendency in the handover is a button to the exact section', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await page.getByText('Monitor', { exact: true }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Contratar agente' }).last().click()
  const checklist = page.getByTestId('hire-checklist')
  await expect(checklist).toBeVisible()
  // No pendency is text-only.
  const items = await page.getByTestId('hire-pending-item').count()
  expect(items).toBeGreaterThan(0)
  await expect(page.getByTestId('hire-pending-action-source')).toBeVisible()
  await page.getByTestId('hire-pending-action-routine').click()
  await expect(page).toHaveURL(/\/fluxos$/)
})

test('a manager with nobody to call is still pending after hiring', async ({ page }) => {
  // The floor has no other agent and no executable sector: 'all' reaches nobody.
  await stubApi(page)
  await openWizard(page)
  await page.getByText('Gerente / Orquestrador').click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Contratar agente' }).last().click()
  const checklist = page.getByTestId('hire-checklist')
  await expect(checklist).toBeVisible()
  await expect(checklist).toContainText('Escolher os colegas')
  await page.getByTestId('hire-pending-action-collaborators').click()
  // The action opens the editor itself, not just the tab that contains it.
  await expect(page).toHaveURL(/\/fluxos#colaboracao$/)
})

test('a specialist is hired without any production trigger', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await page.getByText('Pesquisador', { exact: true }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Contratar agente' }).last().click()
  await expect.poll(() => created?.activationModes).toEqual([])
  expect(created?.callerPolicy).toBe('all')
})

test('a live routine on an agent that forbids scheduling is flagged and fixable', async ({ page }) => {
  const conflicted = overview({
    triggers: [
      { kind: 'manual', allowed: true, configured: true, inconsistent: false },
      { kind: 'scheduled', allowed: false, configured: true, inconsistent: true },
      { kind: 'channel', allowed: false, configured: false, inconsistent: false },
      { kind: 'event', allowed: false, configured: false, inconsistent: false },
    ],
  })
  await stubApi(page, { overview: conflicted })
  let patched: Record<string, unknown> | null = null
  await page.route(`**/api/agents/${AGENT_ID}`, async (r) => {
    if (r.request().method() === 'PATCH') {
      patched = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ json: AGENT })
    }
    return r.fulfill({ json: AGENT })
  })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  const card = page.getByTestId('trigger-scheduled')
  await expect(card).toContainText('Configurado, mas não permitido')
  await page.getByTestId('trigger-fix-scheduled').click()
  await expect.poll(() => (patched?.activationModes as string[] | undefined)).toContain('scheduled')
  // The legacy agent_only the stub carries is never written back.
  expect(patched?.activationModes).not.toContain('agent_only')
})

test('a channel the agent merely accepts is not reported as configured', async ({ page }) => {
  await stubApi(page, {
    overview: overview({
      triggers: [
        { kind: 'manual', allowed: true, configured: true, inconsistent: false },
        { kind: 'scheduled', allowed: false, configured: false, inconsistent: false },
        { kind: 'channel', allowed: true, configured: false, inconsistent: false },
        { kind: 'event', allowed: false, configured: false, inconsistent: false },
      ],
    }),
  })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await expect(page.getByTestId('trigger-channel')).toContainText('sem canal vinculado')
})

test('testing stays available and is never sold as production execution', async ({ page }) => {
  await stubApi(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/atividade`)
  await expect(page.getByTestId('playground-note')).toContainText('mesmo sem gatilho')
})

// ------------------------------------------------- collaboration editor (Fluxos)
const POOL = {
  buildingId: 'b1',
  agents: [
    { _id: '000000000000000000000a22', name: 'Colega do Térreo', preset: 'operator', floorName: 'Térreo', acceptsCall: true },
    // A colleague on ANOTHER FLOOR of the same building is a real collaborator.
    { _id: '000000000000000000000a33', name: 'Colega de Cima', preset: 'analyst', floorName: 'Primeiro andar', acceptsCall: true },
    { _id: '000000000000000000000a44', name: 'Recusa Chamadas', preset: 'operator', floorName: 'Térreo', acceptsCall: false },
  ],
  sectors: [{ _id: '000000000000000000000501', name: 'Equipe de Vendas', mode: 'orchestrated', floorName: 'Primeiro andar' }],
}

async function stubCollaboration(page: Page, opts: { overview?: Record<string, unknown> } = {}) {
  await stubApi(page, opts)
  await page.route('**/api/agents/*/collaborators', (r) => r.fulfill({ json: POOL }))
}

test('the collaboration editor lives in Fluxos and speaks plain language', async ({ page }) => {
  await stubCollaboration(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  const editor = page.getByTestId('collaboration-editor')
  await expect(editor).toBeVisible()
  await expect(editor).toContainText('Quem este agente pode acionar')
  await expect(editor).toContainText('Quem pode acionar este agente')
  const body = (await editor.innerText()).toLowerCase()
  for (const jargon of ['delegationpolicy', 'callerpolicy', 'callableagentids', 'allowedcalleragentids', 'callablesectorids']) {
    expect(body, `"${jargon}" leaked into the editor`).not.toContain(jargon)
  }
})

test('picking specific colleagues persists every collaboration field', async ({ page }) => {
  await stubCollaboration(page)
  let patched: Record<string, unknown> | null = null
  await page.route(`**/api/agents/${AGENT_ID}`, async (r) => {
    if (r.request().method() === 'PATCH') {
      patched = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ json: { ...AGENT, ...patched } })
    }
    return r.fulfill({ json: AGENT })
  })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await page.getByTestId('can-call-options').getByRole('button', { name: 'Só quem eu escolher' }).click()
  // The colleague upstairs is offered — collaboration spans the building.
  await page.getByTestId('pick-agents').getByText('Colega de Cima').click()
  await page.getByTestId('pick-sectors').getByText('Equipe de Vendas').click()
  await page.getByTestId('called-by-options').getByRole('button', { name: 'Ninguém' }).click()
  await page.getByTestId('collaboration-save').click()

  await expect(page.getByTestId('collaboration-result')).toContainText('salva')
  expect(patched?.delegationPolicy).toBe('selected')
  expect(patched?.callableAgentIds).toEqual(['000000000000000000000a33'])
  expect(patched?.callableSectorIds).toEqual(['000000000000000000000501'])
  expect(patched?.callerPolicy).toBe('none')
  expect(patched?.allowedCallerAgentIds).toEqual([])
})

test('a colleague that refuses calls is shown as such instead of being hidden', async ({ page }) => {
  await stubCollaboration(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await page.getByTestId('can-call-options').getByRole('button', { name: 'Só quem eu escolher' }).click()
  await expect(page.getByTestId('pick-agents')).toContainText('não aceita chamadas hoje')
})

test('only executable teams are offered as collaborators', async ({ page }) => {
  await stubCollaboration(page)
  await page.route('**/api/agents/*/collaborators', (r) => r.fulfill({ json: { ...POOL, sectors: [] } }))
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await page.getByTestId('can-call-options').getByRole('button', { name: 'Só quem eu escolher' }).click()
  await expect(page.getByText('Nenhuma equipe que execute trabalho neste prédio.')).toBeVisible()
})

test('a save failure is reported, never swallowed', async ({ page }) => {
  await stubCollaboration(page)
  await page.route(`**/api/agents/${AGENT_ID}`, (r) =>
    r.request().method() === 'PATCH' ? r.fulfill({ status: 400, json: { error: 'Referência inválida' } }) : r.fulfill({ json: AGENT }),
  )
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await page.getByTestId('collaboration-save').click()
  await expect(page.getByTestId('collaboration-result')).toContainText('Referência inválida')
})

test('the readiness action opens the collaboration editor itself', async ({ page }) => {
  await stubCollaboration(page, {
    overview: overview({
      readiness: { ready: false, issues: [{ code: 'no_collaborators', message: 'Um gerente precisa de colegas para acionar.', action: 'Adicionar colaboradores', section: 'fluxos#colaboracao' }] },
    }),
  })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}`)
  await page.getByTestId('agent-readiness').getByRole('button', { name: 'Adicionar colaboradores' }).click()
  await expect(page).toHaveURL(/\/fluxos#colaboracao$/)
  await expect(page.getByTestId('collaboration-editor')).toBeVisible()
})

test('the hire checklist lands on the collaboration editor', async ({ page }) => {
  await stubCollaboration(page)
  await openWizard(page)
  await page.getByText('Gerente / Orquestrador').click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Contratar agente' }).last().click()
  await page.getByTestId('hire-pending-action-collaborators').click()
  await expect(page).toHaveURL(/\/fluxos#colaboracao$/)
  await expect(page.getByTestId('collaboration-editor')).toBeVisible()
})

test('the collaboration editor works on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stubCollaboration(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await expect(page.getByTestId('collaboration-editor')).toBeVisible()
  await page.getByTestId('can-call-options').getByRole('button', { name: 'Só quem eu escolher' }).click()
  await expect(page.getByTestId('pick-agents')).toBeVisible()
  await page.getByTestId('collaboration-save').click()
  await expect(page.getByTestId('collaboration-result')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('a colleague that refuses calls is listed but never counted', async ({ page }) => {
  await stubCollaboration(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  // 'all': two colleagues accept, one refuses, plus one team → 3.
  await page.getByTestId('can-call-options').getByRole('button', { name: 'Qualquer colega do prédio' }).click()
  await expect(page.getByTestId('collaboration-reach')).toContainText('alcança 3')

  // Picking ONLY the colleague that refuses is a reach of zero.
  await page.getByTestId('can-call-options').getByRole('button', { name: 'Só quem eu escolher' }).click()
  await page.getByTestId('pick-agents').getByText('Recusa Chamadas').click()
  await expect(page.getByTestId('collaboration-reach')).toContainText('não alcança ninguém')

  // Adding one that accepts moves it to one.
  await page.getByTestId('pick-agents').getByText('Colega de Cima').click()
  await expect(page.getByTestId('collaboration-reach')).toContainText('alcança 1')
})

test('choosing "ninguém" reaches nobody however many colleagues exist', async ({ page }) => {
  await stubCollaboration(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await page.getByTestId('can-call-options').getByRole('button', { name: 'Ninguém' }).click()
  await expect(page.getByTestId('collaboration-reach')).toContainText('não alcança ninguém')
})
