import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The agent's App permissions editor.
//
// The bug this closes: it sent the whole list on every checkbox and every keystroke,
// so a slow response could land after a newer one and silently restore permissions
// the owner had just removed. Editing is now a draft with one explicit save.
const SETTINGS = { maxItems: 8, charBudget: 2400, maxSources: 5, toolName: '', toolDescription: '' }
const AGENT_ID = '000000000000000000000a11'
const FLOOR_ID = '000000000000000000000f11'
const INSTALLATION = 'inst-1'
const NOW = new Date(0).toISOString()

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = { id: FLOOR_ID, buildingId: 'b1', name: 'Térreo', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', workMode: 'organization', coordinatorAgentId: null, instruction: '', createdAt: NOW, updatedAt: NOW }

const AGENT = {
  _id: AGENT_ID,
  name: 'Ana',
  objective: 'Atender',
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
  appGrants: [],
  preset: 'custom',
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
  floorId: FLOOR_ID,
}

const GOOGLE = {
  key: 'google',
  version: '1.0.0',
  source: 'system',
  name: 'Google',
  description: 'Agenda e planilhas.',
  icon: 'google',
  categories: ['produtividade'],
  documentationUrl: null,
  status: 'published',
  auth: { kind: 'oauth2', fields: [], scopes: [], documentationUrl: null },
  allowedDomains: ['googleapis.com'],
  supportsMultipleConnections: false,
  actions: [
    { key: 'google_agenda_listar_eventos', name: 'Listar eventos', description: 'Lista eventos.', risk: 'read', inputSchema: {}, resourceFields: [{ key: 'calendarId', label: 'ID da agenda', required: false }] },
    { key: 'google_agenda_criar_evento', name: 'Criar evento', description: 'Cria um evento.', risk: 'write', inputSchema: {}, resourceFields: [{ key: 'calendarId', label: 'ID da agenda', required: false }] },
  ],
  surfaces: [],
  pinnable: false,
  defaultSurfaceKey: null,
  dataAccess: [],
  storageNote: null,
  disconnectNote: null,
  providerCostNote: null,
  requiresAuth: true,
  activation: 'oauth',
  activationRoute: null,
}

const INSTALLATION_ROW = {
  id: INSTALLATION,
  appKey: 'google',
  appVersion: '1.0.0',
  name: 'Google (loja)',
  status: 'connected',
  publicMetadata: {},
  grantedScopes: [],
  createdAt: NOW,
  updatedAt: NOW,
  lastTestedAt: null,
  agentCount: 0,
}

let patches: Record<string, unknown>[] = []
let stored: Record<string, unknown>[] = []

async function stub(
  page: Page,
  opts: { installations?: unknown[]; grants?: unknown[]; patch?: (body: Record<string, unknown>) => { status: number; json: unknown } | Promise<{ status: number; json: unknown }> } = {},
) {
  patches = []
  stored = (opts.grants as Record<string, unknown>[]) ?? []
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))

  await page.route('**/api/agents/*/app-grants', async (r) => {
    if (r.request().method() === 'PATCH') {
      const body = r.request().postDataJSON() as { grants: Record<string, unknown>[] }
      patches.push(body)
      if (opts.patch) {
        const result = await opts.patch(body)
        return r.fulfill({ status: result.status, json: result.json })
      }
      stored = body.grants.map((g) => ({ ...g, appKey: 'google' }))
      return r.fulfill({ json: stored })
    }
    return r.fulfill({ json: stored })
  })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [GOOGLE] }))
  await page.route('**/api/app-installations', (r) => r.fulfill({ json: opts.installations ?? [INSTALLATION_ROW] }))
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
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
  await page.route('**/api/agents/*/routines**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/event-triggers**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agent-stats**', (r) => r.fulfill({ json: { period: '30d', telemetrySince: null, stats: {}, channel: {} } }))
  await page.route('**/api/agent-states**', (r) => r.fulfill({ json: {} }))
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: [AGENT] }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: [AGENT] }))
  await page.route('**/api/tools', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
}

const open = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await expect(page.getByTestId('agent-app-grants')).toBeVisible()
}

test('marcar uma ação não dispara requisição: é rascunho até salvar', async ({ page }) => {
  await stub(page)
  await open(page)
  await page.getByTestId('action-google_agenda_listar_eventos').check()
  await expect(page.getByTestId('grants-dirty')).toBeVisible()
  // Nada foi enviado ainda.
  expect(patches).toEqual([])
})

test('digitar num campo NÃO manda uma requisição por caractere', async ({ page }) => {
  await stub(page)
  await open(page)
  await page.getByTestId('action-google_agenda_listar_eventos').check()
  await page.getByTestId('resource-calendarId').fill('agenda@grupo.calendar.google.com')
  expect(patches).toEqual([])

  await page.getByTestId('save-grants').click()
  await expect(page.getByTestId('grants-saved')).toBeVisible()
  // Uma única requisição para tudo.
  expect(patches.length).toBe(1)
  expect((patches[0].grants as Record<string, unknown>[])[0].resourceConfig).toEqual({ calendarId: 'agenda@grupo.calendar.google.com' })
})

test('várias alterações rápidas viram um único salvamento, com o estado final', async ({ page }) => {
  await stub(page)
  await open(page)
  await page.getByTestId('action-google_agenda_listar_eventos').check()
  await page.getByTestId('action-google_agenda_criar_evento').check()
  await page.getByTestId('autonomous-google_agenda_criar_evento').check()
  await page.getByTestId('action-google_agenda_listar_eventos').uncheck()
  await page.getByTestId('save-grants').click()
  await expect(page.getByTestId('grants-saved')).toBeVisible()

  expect(patches.length).toBe(1)
  const grant = (patches[0].grants as Record<string, unknown>[])[0]
  expect(grant.actionKeys).toEqual(['google_agenda_criar_evento'])
  expect(grant.autonomousWriteActionKeys).toEqual(['google_agenda_criar_evento'])
})

test('desmarcar a ação remove junto a autorização autônoma dela', async ({ page }) => {
  await stub(page)
  await open(page)
  await page.getByTestId('action-google_agenda_criar_evento').check()
  await page.getByTestId('autonomous-google_agenda_criar_evento').check()
  await page.getByTestId('action-google_agenda_criar_evento').uncheck()
  await page.getByTestId('action-google_agenda_criar_evento').check()
  // Voltou desmarcada: a autorização não sobreviveu escondida ao ciclo.
  await expect(page.getByTestId('autonomous-google_agenda_criar_evento')).not.toBeChecked()
})

test('o botão fica desabilitado sem alterações e durante o envio', async ({ page }) => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((r) => (release = r))
  await stub(page, {
    patch: async (body) => {
      await gate
      return { status: 200, json: body.grants }
    },
  })
  await open(page)
  await expect(page.getByTestId('save-grants')).toBeDisabled()

  await page.getByTestId('action-google_agenda_listar_eventos').check()
  await expect(page.getByTestId('save-grants')).toBeEnabled()

  await page.getByTestId('save-grants').click()
  await expect(page.getByTestId('save-grants')).toBeDisabled()
  // Clicar de novo enquanto salva não cria uma segunda requisição.
  await page.getByTestId('save-grants').click({ force: true })
  release?.()
  await expect(page.getByTestId('grants-saved')).toBeVisible()
  expect(patches.length).toBe(1)
})

test('recusa do servidor mostra o motivo e restaura o que está guardado', async ({ page }) => {
  await stub(page, {
    grants: [{ installationId: INSTALLATION, appKey: 'google', actionKeys: ['google_agenda_listar_eventos'], resourceConfig: {}, autonomousWriteActionKeys: [] }],
    patch: () => ({ status: 400, json: { message: 'ação desconhecida: google_agenda_criar_evento' } }),
  })
  await open(page)
  await expect(page.getByTestId('action-google_agenda_listar_eventos')).toBeChecked()

  await page.getByTestId('action-google_agenda_criar_evento').check()
  await page.getByTestId('save-grants').click()

  await expect(page.getByTestId('grants-error')).toContainText('ação desconhecida')
  // A tela volta para o que o servidor confirma — ninguém sai achando que concedeu.
  await expect(page.getByTestId('action-google_agenda_criar_evento')).not.toBeChecked()
  await expect(page.getByTestId('action-google_agenda_listar_eventos')).toBeChecked()
})

test('falha de rede não deixa a tela dizendo que salvou', async ({ page }) => {
  await stub(page)
  await open(page)
  await page.getByTestId('action-google_agenda_listar_eventos').check()
  await page.route('**/api/agents/*/app-grants', (r) => (r.request().method() === 'PATCH' ? r.abort() : r.fulfill({ json: stored })))
  await page.getByTestId('save-grants').click()
  await expect(page.getByTestId('grants-error')).toBeVisible()
  await expect(page.getByTestId('grants-saved')).toHaveCount(0)
})

test('descartar volta ao estado confirmado', async ({ page }) => {
  await stub(page, {
    grants: [{ installationId: INSTALLATION, appKey: 'google', actionKeys: ['google_agenda_listar_eventos'], resourceConfig: {}, autonomousWriteActionKeys: [] }],
  })
  await open(page)
  await page.getByTestId('action-google_agenda_criar_evento').check()
  await page.getByTestId('discard-grants').click()
  await expect(page.getByTestId('action-google_agenda_criar_evento')).not.toBeChecked()
  await expect(page.getByTestId('save-grants')).toBeDisabled()
  expect(patches).toEqual([])
})

test('só conexão conectada pode receber permissão', async ({ page }) => {
  await stub(page, { installations: [{ ...INSTALLATION_ROW, status: 'needs_reauth' }] })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await expect(page.getByTestId('no-installations')).toBeVisible()
})

// --- consultar um site quando o agente é chamado ------------------------------------------
//
// A rotina responde "verifique de hora em hora". Faltava o outro caso, que é o mais comum:
// "quando alguém perguntar, olhe aqui". Sem horário, sem checkpoint e sem custo enquanto
// ninguém pergunta.

test('a aba Como trabalha deixa cadastrar um site para o agente consultar', async ({ page }) => {
  let salvo: Record<string, unknown> | null = null
  await stub(page)
  await page.route('**/api/agents/*/sources', async (r) => {
    if (r.request().method() === 'PUT') {
      salvo = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ json: { sources: [], settings: SETTINGS } })
    }
    return r.fulfill({ json: { sources: [], settings: SETTINGS } })
  })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)

  const cartao = page.getByTestId('agent-sources')
  await expect(cartao).toBeVisible()
  await expect(cartao).toContainText('quando for acionado')
  await expect(page.getByTestId('agent-sources-empty')).toBeVisible()

  await page.getByTestId('agent-source-add').click()
  await page.getByTestId('agent-source-name').fill('Blog da empresa')
  await page.getByTestId('agent-source-url').fill('https://exemplo.test/blog')
  await page.getByTestId('agent-sources-save').click()

  await expect(page.getByTestId('agent-sources-saved')).toBeVisible()
  expect(salvo).toEqual({
    sources: [{ name: 'Blog da empresa', kind: 'http', url: 'https://exemplo.test/blog', when: 'on_demand', initialWindow: '7d' }],
    settings: SETTINGS,
  })
})

test('um endereço inválido é recusado com o motivo na tela', async ({ page }) => {
  await stub(page)
  await page.route('**/api/agents/*/sources', (r) =>
    r.request().method() === 'PUT'
      ? r.fulfill({ status: 400, json: { error: 'O endereço precisa começar com http:// ou https://', code: 'INVALID_URL' } })
      : r.fulfill({ json: { sources: [], settings: SETTINGS } }),
  )
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)

  await page.getByTestId('agent-source-add').click()
  await page.getByTestId('agent-source-url').fill('exemplo.test/blog')
  await page.getByTestId('agent-sources-save').click()

  await expect(page.getByTestId('agent-sources-error')).toContainText('http://')
})

test('as fontes que vêm de rotinas aparecem separadas, como leitura', async ({ page }) => {
  await stub(page)
  await page.route('**/api/agents/*/sources', (r) =>
    r.fulfill({
      json: { settings: SETTINGS, sources: [{ routineId: 'r1', origem: 'rotina', name: 'Notícias', kind: 'rss', host: 'exemplo.test' }] },
    }),
  )
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)

  const doRotina = page.getByTestId('agent-sources-routines')
  await expect(doRotina).toContainText('Notícias')
  await expect(doRotina).toContainText('não consome o alerta da rotina')
})

test('cada endereço escolhe QUANDO ser consultado, e a tela diz o custo de cada escolha', async ({ page }) => {
  let salvo: Record<string, unknown> | null = null
  await stub(page)
  await page.route('**/api/agents/*/sources', async (r) => {
    if (r.request().method() === 'PUT') {
      salvo = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ json: { sources: [], settings: SETTINGS } })
    }
    return r.fulfill({ json: { sources: [], settings: SETTINGS } })
  })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)

  await page.getByTestId('agent-source-add').click()
  await page.getByTestId('agent-source-url').fill('https://exemplo.test/feed.xml')
  await page.getByTestId('agent-source-kind').selectOption('rss')

  // O custo de cada modo está escrito ao lado do modo.
  const quando = page.getByTestId('agent-source-when')
  await expect(quando).toContainText('0 token se ninguém perguntar')
  await expect(quando).toContainText('paga o texto em todo turno')
  await quando.selectOption('on_change')

  // Feed ganha a janela; página não teria.
  await page.getByTestId('agent-source-window').selectOption('24h')
  await page.getByTestId('agent-sources-save').click()

  await expect(page.getByTestId('agent-sources-saved')).toBeVisible()
  const enviados = (salvo as { sources: Record<string, unknown>[] }).sources
  expect(enviados[0].when).toBe('on_change')
  expect(enviados[0].initialWindow).toBe('24h')
})

test('os limites e o nome da ferramenta são editáveis, e vão junto no salvamento', async ({ page }) => {
  let salvo: Record<string, unknown> | null = null
  await stub(page)
  await page.route('**/api/agents/*/sources', async (r) => {
    if (r.request().method() === 'PUT') {
      salvo = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ json: { sources: [], settings: SETTINGS } })
    }
    return r.fulfill({ json: { sources: [], settings: SETTINGS } })
  })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)

  await page.getByTestId('agent-sources-settings').click()
  await page.getByTestId('agent-sources-max-items').fill('3')
  await page.getByTestId('agent-sources-tool-name').fill('olhar_site')
  await page.getByTestId('agent-sources-tool-description').fill('Use quando perguntarem de preço.')
  await page.getByTestId('agent-sources-save').click()

  await expect(page.getByTestId('agent-sources-saved')).toBeVisible()
  const cfg = (salvo as { settings: Record<string, unknown> }).settings
  expect(cfg.maxItems).toBe(3)
  expect(cfg.toolName).toBe('olhar_site')
  expect(cfg.toolDescription).toBe('Use quando perguntarem de preço.')
})
