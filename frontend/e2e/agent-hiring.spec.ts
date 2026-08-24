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
  await page.route('**/api/executors/catalog', (r) =>
    r.fulfill({
      json: {
        functions: [
          {
            functionName: 'math.summary',
            version: '1.0.0',
            description: 'Soma, média, mínimo e máximo de uma lista de números.',
            capabilities: ['cálculo'],
            inputSchema: { type: 'object', properties: { values: { type: 'array' } }, required: ['values'] },
            outputSchema: { type: 'object', properties: { sum: { type: 'number' } }, required: ['sum'] },
            configSchema: null,
            timeoutMs: 2000,
          },
        ],
        actions: [],
      },
    }),
  )
  await page.route('**/api/app-installations**', (r) => r.fulfill({ json: [] }))
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

// Escolher o papel: os cinco principais estão à vista; Secretário, Monitor e
// Personalizado ficam atrás de "Outros perfis", e o teste abre a seção como uma pessoa
// abriria — em vez de a tela deixar tudo aberto só para o teste ser mais curto.
const escolherPapel = async (page: Page, preset: string) => {
  const cartao = page.getByTestId(`role-${preset}`)
  if (!(await cartao.isVisible().catch(() => false))) {
    await page.getByTestId('role-picker-others-toggle').click()
  }
  await cartao.click()
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

// --- a escolha do papel, por verbo -----------------------------------------------------
//
// Oito cargos lado a lado obrigavam a ler os oito para descobrir que a diferença entre
// dois deles é quem chama quem. "Analista" e "Pesquisador" soam parecidos, e nada no nome
// diz que um busca e o outro conclui.

test('a primeira escolha é o que ele FAZ, com cinco opções à vista', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  const escolhas = page.getByTestId('role-picker')
  for (const verbo of ['Coordena', 'Busca', 'Analisa', 'Age', 'Escreve']) {
    await expect(escolhas.getByText(verbo, { exact: false }).first()).toBeVisible()
  }
  // O cargo continua junto: quem já conhece o sistema procura por ele.
  await expect(escolhas.getByText('Pesquisador', { exact: false }).first()).toBeVisible()
  // Casos específicos ficam recolhidos — mas não escondidos.
  await expect(page.getByTestId('role-monitor')).toHaveCount(0)
  await page.getByTestId('role-picker-others-toggle').click()
  await expect(page.getByTestId('role-monitor')).toBeVisible()
  await expect(page.getByTestId('role-secretary')).toBeVisible()
  await expect(page.getByTestId('role-custom')).toBeVisible()
})

test('escolher pelo verbo leva às perguntas daquele papel', async ({ page }) => {
  // O agrupamento é de apresentação: o que muda atrás dele continua o mesmo.
  await stubApi(page)
  await openWizard(page)
  await escolherPapel(page, 'operator')
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByText('Ação que ele executa')).toBeVisible()
})

test('a manager is asked about colleagues, never about a research topic', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await escolherPapel(page, 'manager')
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByTestId('work-step')).toBeVisible()
  await expect(page.getByText('Quem ele pode acionar')).toBeVisible()
  await expect(page.getByText('Tema que ele pesquisa')).toHaveCount(0)
})

test('a researcher is asked for a topic and format, not for colleagues', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await escolherPapel(page, 'researcher')
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByText('Tema que ele pesquisa')).toBeVisible()
  await expect(page.getByText('Formato da resposta')).toBeVisible()
  await expect(page.getByText('Quem ele pode acionar')).toHaveCount(0)
})

test('a communicator gets a tone field; an analyst does not', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await escolherPapel(page, 'communicator')
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByText('Tom da escrita')).toBeVisible()
  await page.getByRole('button', { name: 'Voltar' }).click()
  await escolherPapel(page, 'analyst')
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
  await escolherPapel(page, 'monitor')
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
  await escolherPapel(page, 'analyst')
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Contratar agente' }).last().click()
  await expect(page).toHaveURL(new RegExp(`/agents/${AGENT_ID}`))
})

test('the wizard fits a phone screen without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stubApi(page)
  await openWizard(page)
  await escolherPapel(page, 'researcher')
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
  await escolherPapel(page, 'monitor')
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
  await escolherPapel(page, 'manager')
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
  await escolherPapel(page, 'researcher')
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
  await escolherPapel(page, 'manager')
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

// --- executable output contract (advanced, optional) ---------------------------------
// Everything here is opt-in: an agent that never opens this block keeps behaving
// exactly as before, which is why the default is "quem pedir decide".

// On the Avançado page each technical group is collapsed until asked for — the same
// convention every other advanced block follows.
const openOutputContract = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/avancado`)
  // O bloco passou a ter as DUAS metades do contrato: o que ele aceita receber e o que
  // promete devolver. Só a saída era editável antes, e um contrato pela metade não dá
  // para conferir — a entrada errada chegava ao agente sem ninguém olhar.
  await page.getByRole('button', { name: 'Contratos de entrada e saída' }).click()
}

test('the output contract lives in Avançado and defaults to nothing', async ({ page }) => {
  await stubApi(page)
  await openOutputContract(page)
  const block = page.getByTestId('output-contract-block')
  await expect(block).toBeVisible()
  await expect(page.getByTestId('default-output-format')).toHaveValue('')
  // The schema field only exists once JSON is the chosen shape.
  await expect(page.getByTestId('output-json-schema')).toHaveCount(0)
  // A entrada, sim: é ela que decide se o agente recebe campos ou prosa, e ela existe
  // independentemente do formato da resposta.
  await expect(page.getByTestId('input-json-schema')).toBeVisible()
  await expect(page.getByTestId('require-grounding')).not.toBeChecked()
})

test('choosing JSON reveals the schema field and validates what is typed', async ({ page }) => {
  await stubApi(page)
  await openOutputContract(page)
  await page.getByTestId('default-output-format').selectOption('json')

  const schema = page.getByTestId('output-json-schema')
  await expect(schema).toBeVisible()
  await schema.fill('{ isso não é json }')
  await expect(page.getByTestId('output-json-schema-errors')).toBeVisible()

  await schema.fill('{"type":"object","properties":{"titulo":{"type":"string"}}}')
  await expect(page.getByTestId('output-json-schema-errors')).toHaveCount(0)
  // O contrato de volta em português: é lendo isto que se percebe o schema que está certo
  // na sintaxe e descreve o contrato errado.
  await expect(page.getByTestId('output-json-schema-summary')).toContainText('titulo')
  await expect(page.getByTestId('output-json-schema-summary')).toContainText('opcional')
})

test('the simple sections stay simple — no schema in sight', async ({ page }) => {
  await stubApi(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/visao-geral`)
  await expect(page.getByTestId('output-contract-block')).toHaveCount(0)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await expect(page.getByTestId('output-contract-block')).toHaveCount(0)
})

// --- busca na web já na contratação -----------------------------------------------------------
//
// O bloco inteiro dependia de um agente criado, por um motivo acidental: os SITES
// precisam de um id para serem gravados. A busca não precisa — é configuração, e vai
// junto no primeiro salvamento.

test('o pesquisador pode ligar a busca na web ao ser contratado', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await escolherPapel(page, 'researcher')
  await page.getByRole('button', { name: 'Próximo' }).click()

  await page.getByTestId('hire-advanced-toggle').click()
  await page.getByTestId('hire-web-search-enabled').check()
  await page.getByTestId('hire-web-search-policy').selectOption('always')
  await page.getByTestId('hire-web-search-remember').fill('1')

  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Contratar agente' }).last().click()

  expect(created?.webSearch).toMatchObject({ enabled: true, policy: 'always', rememberDays: 1 })
})

test('sem ligar, nada de busca vai no payload — o padrão é não procurar', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await escolherPapel(page, 'researcher')
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Contratar agente' }).last().click()

  expect(created?.webSearch).toBeUndefined()
})

test('quem não coleta não vê a opção — nem no avançado', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await escolherPapel(page, 'analyst')
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByTestId('hire-advanced-toggle').click()
  await expect(page.getByTestId('hire-web-search')).toHaveCount(0)
})


// --- contratar um agente que NÃO é de IA --------------------------------------------------
//
// Isto não existia. A escolha do executor vivia só na edição, sob "Avançado": para ter um
// agente de função era preciso criar um de IA, salvar, entrar nele e trocar o tipo — três
// passos para a decisão mais consequente do formulário, e invisível para quem não sabia
// que ela existia.

test('dá para contratar um agente de FUNÇÃO — e a escolha está entre as perguntas principais', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await escolherPapel(page, 'custom')
  await page.getByRole('button', { name: 'Próximo' }).click()
  await expect(page.getByTestId('work-step')).toBeVisible()

  // À vista, sem abrir "Configuração avançada".
  const executor = page.getByTestId('hire-executor')
  await expect(executor).toBeVisible()
  await executor.getByTestId('executor-kind-function').click()
  await executor.getByTestId('function-option-math.summary').click()

  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByTestId('hire-wizard').getByRole('button', { name: 'Contratar agente' }).click()

  await expect.poll(() => created).not.toBeNull()
  expect(created!.executorKind).toBe('function')
  expect(created!.responseMode).toBe('structured')
  expect(created!.executorConfig).toEqual({ kind: 'function', functionName: 'math.summary', version: '1.0.0' })
  // Os schemas NÃO vão daqui: o servidor os deriva do registro, que é quem executa.
  expect(created!.inputJsonSchema).toBeUndefined()
})

test('escolher função sem escolher QUAL não deixa avançar', async ({ page }) => {
  // A API recusa; barrar aqui é a diferença entre uma frase no formulário e um erro
  // depois de clicar em contratar.
  await stubApi(page)
  await openWizard(page)
  await escolherPapel(page, 'custom')
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByTestId('hire-executor').getByTestId('executor-kind-function').click()
  await expect(page.getByRole('button', { name: 'Próximo' })).toBeDisabled()
})

test('um agente de IA continua sendo contratado exatamente como antes', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await escolherPapel(page, 'researcher')
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByTestId('hire-wizard').getByRole('button', { name: 'Contratar agente' }).click()

  await expect.poll(() => created).not.toBeNull()
  // Nenhum campo novo: quem não escolheu nada não ganha configuração que não pediu.
  expect(created!.executorKind).toBeUndefined()
  expect(created!.executorConfig).toBeUndefined()
  expect(created!.preset).toBe('researcher')
})
