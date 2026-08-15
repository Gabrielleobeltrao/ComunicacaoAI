import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Editing what an agent already does, in its Fluxos tab: a routine's schedule and
// wording, and a trigger's name and purpose. The rule both share is that editing
// changes the WORDS and the SCHEDULE — never the state (active/paused) and never,
// for a trigger, the endpoint or its credential.
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



const ROUTINE = {
  id: 'rot-1',
  name: 'Resumo diário',
  objective: 'Consolidar as notícias do dia',
  // PAUSED on purpose: editing must not resurrect it.
  status: 'paused',
  timezone: 'America/Sao_Paulo',
  cron: '0 9 * * *',
  recurrence: { kind: 'daily', time: '09:00' },
  scheduleLabel: 'Todo dia às 09:00',
  input: 'foco em política nacional',
  outputFormat: 'markdown',
  delivery: { provider: 'email', connectionId: 'conn-1' },
  lastPublishedVersion: 2,
  nextRunAt: null,
  createdAt: NOW,
  updatedAt: NOW,
}

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

let patched: { url: string; body: Record<string, unknown> } | null = null

async function stubApi(page: Page, opts: { connections?: 'ok' | 'fail' | 'slow' | 'missing' } = {}) {
  patched = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  await page.route('**/api/agent-presets', (r) => r.fulfill({ json: PRESETS }))
  await page.route('**/api/connections', async (r) => {
    if (opts.connections === 'fail') return r.fulfill({ status: 500, json: {} })
    if (opts.connections === 'slow') await new Promise((resolve) => setTimeout(resolve, 1500))
    return r.fulfill({ json: opts.connections === 'missing' ? [] : [{ id: 'conn-1', provider: 'email', name: 'E-mail da equipe', status: 'active' }] })
  })
  await page.route('**/api/agents/*/routines/*', (r) => {
    if (r.request().method() === 'PATCH') {
      patched = { url: r.request().url(), body: JSON.parse(r.request().postData() ?? '{}') }
      return r.fulfill({ json: { ...ROUTINE, ...patched.body } })
    }
    return r.fulfill({ json: ROUTINE })
  })
  await page.route('**/api/agents/*/routines', (r) => r.fulfill({ json: [ROUTINE] }))
  await page.route('**/api/agents/*/event-triggers/*', (r) => {
    if (r.request().method() === 'PATCH') {
      patched = { url: r.request().url(), body: JSON.parse(r.request().postData() ?? '{}') }
      // The API answers with the trigger unchanged except for the words: the same
      // endpoint, the same signature requirement, the same status.
      return r.fulfill({ json: { ...TRIGGER, name: String(patched.body.name ?? TRIGGER.name), objective: String(patched.body.objective ?? TRIGGER.objective) } })
    }
    return r.fulfill({ json: TRIGGER })
  })
  await page.route('**/api/agents/*/event-triggers', (r) => r.fulfill({ json: [TRIGGER] }))
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/overview', (r) => r.fulfill({ json: overview() }))
  await page.route('**/api/agents/*/documents', (r) => r.fulfill({ json: [] }))
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
  await expect(page.getByTestId('routine-row')).toBeVisible()
}

test('a routine opens for editing already filled in with what it is', async ({ page }) => {
  await stubApi(page)
  await openFluxos(page)
  await page.getByTestId('edit-routine').click()

  const form = page.getByTestId('routine-form')
  await expect(form).toBeVisible()
  await expect(form.getByTestId('routine-objective')).toHaveValue('Consolidar as notícias do dia')
  await expect(form.getByTestId('routine-name')).toHaveValue('Resumo diário')
  await expect(form.getByTestId('routine-time')).toHaveValue('09:00')
  await expect(form.getByTestId('routine-timezone')).toHaveValue('America/Sao_Paulo')
  await expect(form.getByTestId('routine-input')).toHaveValue('foco em política nacional')
  // The destination list comes from the connections that really exist.
  await expect(form.getByLabel('Destino do resultado')).toBeVisible()
  await expect(form).toContainText('E-mail da equipe')
})

test('saving an edit PATCHes the routine and never sends a status', async ({ page }) => {
  await stubApi(page)
  await openFluxos(page)
  await page.getByTestId('edit-routine').click()
  await page.getByTestId('routine-time').fill('18:30')
  await page.getByTestId('routine-objective').fill('Consolidar as notícias da tarde')
  await page.getByTestId('save-routine').click()

  await expect.poll(() => patched?.body).toMatchObject({
    objective: 'Consolidar as notícias da tarde',
    recurrence: { kind: 'daily', time: '18:30' },
    timezone: 'America/Sao_Paulo',
  })
  expect(patched?.url).toContain('/routines/rot-1')
  // Status is the backend's business: an edit must not carry one at all.
  expect(patched?.body).not.toHaveProperty('status')
  // And the row comes back — still paused.
  await expect(page.getByTestId('routine-row')).toContainText('Pausada')
})

test('a failed save keeps the form open and says so', async ({ page }) => {
  await stubApi(page)
  await page.route('**/api/agents/*/routines/*', (r) => (r.request().method() === 'PATCH' ? r.fulfill({ status: 500, json: {} }) : r.fulfill({ json: ROUTINE })))
  await openFluxos(page)
  await page.getByTestId('edit-routine').click()
  await page.getByTestId('save-routine').click()
  await expect(page.getByTestId('routine-error')).toBeVisible()
  await expect(page.getByTestId('routine-form')).toBeVisible()
})

test('pause, activate and archive are still there', async ({ page }) => {
  await stubApi(page)
  await openFluxos(page)
  const row = page.getByTestId('routine-row')
  await expect(row.getByRole('button', { name: 'Ativar' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Arquivar' })).toBeVisible()
})

test('a trigger edits only its name and purpose', async ({ page }) => {
  await stubApi(page)
  await openFluxos(page)
  await page.getByTestId('edit-trigger').click()

  const form = page.getByTestId('edit-trigger-form')
  await expect(form.getByTestId('edit-trigger-name')).toHaveValue('Novo pedido no site')
  await expect(form.getByTestId('edit-trigger-objective')).toHaveValue('Analisar o pedido e avisar o time')
  // The wiring is not even editable here.
  await expect(form).toContainText('não mudam ao salvar')
  expect(await form.innerText()).not.toContain('api/hooks')

  await form.getByTestId('edit-trigger-objective').fill('Analisar o pedido e responder ao cliente')
  await form.getByTestId('save-edit-trigger').click()

  await expect.poll(() => patched?.body).toMatchObject({ objective: 'Analisar o pedido e responder ao cliente' })
  expect(patched?.url).toContain('/event-triggers/trg-1')
  expect(patched?.body).not.toHaveProperty('status')
  expect(patched?.body).not.toHaveProperty('requireSignature')
  expect(patched?.body).not.toHaveProperty('secret')

  // Back on the card: the endpoint, the signature and the state are untouched.
  const card = page.getByTestId('event-trigger-card')
  await expect(card.getByTestId('trigger-endpoint')).toContainText('/api/hooks/automations/pk-abc')
  await expect(card).toContainText('Assinatura obrigatória')
  await expect(card).toContainText('Aguardando evento')
  // Editing never reveals a credential.
  await expect(page.getByTestId('trigger-secret')).toHaveCount(0)
})

test('rotating stays a separate, confirmed action', async ({ page }) => {
  await stubApi(page)
  await openFluxos(page)
  await page.getByTestId('edit-trigger').click()
  // No credential button inside the edit form: rotating is not part of renaming.
  await expect(page.getByTestId('edit-trigger-form').getByTestId('rotate-secret')).toHaveCount(0)
})

// --- the destination must survive an edit that is not about it ----------------------

test('a save while the destinations are still loading cannot drop one', async ({ page }) => {
  await stubApi(page, { connections: 'slow' })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await page.getByTestId('edit-routine').click()

  // While the list is unknown the form says so and refuses to save.
  await expect(page.getByTestId('save-routine')).toBeDisabled()
  await expect(page.getByTestId('routine-form')).toContainText('Carregando os destinos')

  await expect(page.getByTestId('save-routine')).toBeEnabled({ timeout: 5000 })
  await page.getByTestId('routine-objective').fill('Só mudando o texto')
  await page.getByTestId('save-routine').click()

  await expect.poll(() => patched?.body).toMatchObject({ objective: 'Só mudando o texto' })
  // The destination was not part of this edit, so it is not part of the payload.
  expect(patched?.body.delivery).toMatchObject({ connectionId: 'conn-1' })
})

test('when the destinations fail to load, the edit keeps the current one', async ({ page }) => {
  await stubApi(page, { connections: 'fail' })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await page.getByTestId('edit-routine').click()

  await expect(page.getByTestId('routine-form')).toContainText('Não foi possível carregar os destinos')
  await expect(page.getByTestId('routine-delivery')).toHaveValue('__keep__')

  await page.getByTestId('routine-objective').fill('Editando mesmo assim')
  await page.getByTestId('save-routine').click()
  await expect.poll(() => patched?.body).toMatchObject({ objective: 'Editando mesmo assim' })
  // Absent means "keep it": the backend leaves the destination untouched.
  expect(patched?.body).not.toHaveProperty('delivery')
})

test('a destination that is no longer in the list is kept, not silently dropped', async ({ page }) => {
  await stubApi(page, { connections: 'missing' })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await page.getByTestId('edit-routine').click()

  await expect(page.getByTestId('routine-delivery')).toHaveValue('__keep__')
  await page.getByTestId('save-routine').click()
  await expect.poll(() => patched?.body).toBeTruthy()
  expect(patched?.body).not.toHaveProperty('delivery')
})

test('choosing "Nenhum" is the one thing that removes the destination', async ({ page }) => {
  await stubApi(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await page.getByTestId('edit-routine').click()
  await expect(page.getByTestId('routine-delivery')).toHaveValue('conn-1')

  await page.getByTestId('routine-delivery').selectOption('')
  await page.getByTestId('save-routine').click()
  await expect.poll(() => patched?.body).toBeTruthy()
  expect(patched?.body.delivery).toBeNull()
})
