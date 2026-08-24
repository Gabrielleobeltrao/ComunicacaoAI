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
  opts: {
    installations?: unknown[]
    grants?: unknown[]
    /** O agente do teste — usado para variar o TIPO, que decide quais blocos aparecem. */
    agent?: Record<string, unknown>
    patch?: (body: Record<string, unknown>) => { status: number; json: unknown } | Promise<{ status: number; json: unknown }>
  } = {},
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
        agent: opts.agent ?? AGENT,
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
  await abrirBloco(page, 'Ferramentas')
  await expect(page.getByTestId('agent-app-grants')).toBeVisible()
}

/**
 * Abre um bloco da aba pelo título.
 *
 * "Como trabalha" passou a organizar suas seções em blocos que abrem e fecham, e eles
 * nascem fechados. Um teste que interage com o conteúdo precisa abrir antes — que é
 * exatamente o que a pessoa faz. Pelo TÍTULO, e não por um seletor genérico, porque
 * assim o teste diz qual seção ele está exercitando.
 */
async function abrirBloco(page: Page, titulo: string) {
  const cabecalho = page.getByRole('button', { name: titulo, exact: true })
  await cabecalho.waitFor()
  if ((await cabecalho.getAttribute('aria-expanded')) === 'false') await cabecalho.click()
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
  await abrirBloco(page, 'Ferramentas')
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
  await abrirBloco(page, 'Web')

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
    sources: [
      {
        id: expect.any(String),
        name: 'Blog da empresa',
        kind: 'http',
        url: 'https://exemplo.test/blog',
        when: 'on_demand',
        initialWindow: '7d',
        // Um endereço novo passa a ser lido ANTES de o agente ser usado — sem isso,
        // cadastrar um site e ele nunca ser lido era o comportamento padrão.
        // O modo de LEITURA da página, novo: automático tenta HTTP e só abre o
        // navegador quando o conteúdo depende de JavaScript.
        readMode: 'auto',
        refreshMode: 'on_demand',
        intervalMinutes: 30,
        maxStalenessMinutes: 30,
        discoveryMode: 'auto',
        crawlArticles: false,
        maxArticlesPerRun: 5,
        sameDomainOnly: true,
      },
    ],
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
  await abrirBloco(page, 'Web')

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
  await abrirBloco(page, 'Web')

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
  await abrirBloco(page, 'Web')

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
  await abrirBloco(page, 'Web')

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

// --- competências: como outro agente encontra este -------------------------------------
//
// O campo existia e nenhuma tela o editava — era gravado uma vez, na contratação, a
// partir do catálogo do modelo-base. É por ele que `list_available_agents` procura.

test('as competências são editáveis, e é o que o coordenador procura', async ({ page }) => {
  let salvo: Record<string, unknown> | null = null
  await stub(page)
  // O PATCH do agente é outra rota que a do stub de permissões — registrada depois,
  // porque no Playwright a última registrada é a que vale.
  await page.route(`**/api/agents/${AGENT_ID}`, (r) => {
    if (r.request().method() !== 'PATCH') return r.fallback()
    salvo = JSON.parse(r.request().postData() ?? '{}')
    return r.fulfill({ json: {} })
  })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')

  const cartao = page.getByTestId('agent-capabilities')
  await expect(cartao).toBeVisible()
  await expect(cartao).toContainText('outro agente encontra este')

  await page.getByTestId('agent-capability-input').fill('mercado financeiro')
  await page.getByTestId('agent-capability-add').click()
  await expect(page.getByTestId('agent-capability-tag')).toContainText('mercado financeiro')

  await page.getByTestId('agent-capabilities-save').click()
  await expect(page.getByTestId('agent-capabilities-result')).toContainText('Salvo')
  expect((salvo as { capabilities: string[] }).capabilities).toEqual(['mercado financeiro'])
})

test('a mesma competência não entra duas vezes, nem escrita de outro jeito', async ({ page }) => {
  await stub(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')

  for (const texto of ['jurídico', 'JURIDICO']) {
    await page.getByTestId('agent-capability-input').fill(texto)
    await page.getByTestId('agent-capability-add').click()
  }
  await expect(page.getByTestId('agent-capability-tag')).toHaveCount(1)
})

test('uma etiqueta pode ser removida antes de salvar', async ({ page }) => {
  await stub(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')

  await page.getByTestId('agent-capability-input').fill('tributário')
  await page.getByTestId('agent-capability-add').click()
  await page.getByRole('button', { name: 'Remover tributário' }).click()

  await expect(page.getByTestId('agent-capabilities-empty')).toBeVisible()
})

test('o que ENTRA e o que ele JÁ TEM são dois blocos, e os dois abrem e fecham', async ({ page }) => {
  // Eram um só, e o mais alto da aba: a lista de documentos empurrava o formulário de
  // adicionar para fora da tela. São duas perguntas diferentes — "de onde ele tira" e
  // "o que ele já tem" —, então são dois blocos.
  await stub(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)

  const fontes = page.getByRole('button', { name: 'Fontes de conhecimento', exact: true })
  await expect(fontes).toHaveAttribute('aria-expanded', 'false')
  await fontes.click()
  await expect(fontes).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('Textos que o agente usa para responder com precisão', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Adicionar documento' })).toBeVisible()

  const gerado = page.getByRole('button', { name: 'Conhecimento gerado', exact: true })
  await expect(gerado).toHaveAttribute('aria-expanded', 'false')
  await gerado.click()
  await expect(gerado).toHaveAttribute('aria-expanded', 'true')
})

test('as seções da aba nascem fechadas, menos as competências', async ({ page }) => {
  await stub(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)

  // Aberta: é por ela que outro agente encontra este, e a aba não pode abrir como uma
  // lista de títulos vazia.
  await expect(page.getByRole('button', { name: 'Competências', exact: true })).toHaveAttribute('aria-expanded', 'true')
  for (const titulo of ['Ferramentas', 'Fontes de conhecimento', 'Conhecimento gerado', 'Web']) {
    await expect(page.getByRole('button', { name: titulo, exact: true })).toHaveAttribute('aria-expanded', 'false')
  }
})

// --- a escolha do modelo diz qual modelo é ------------------------------------------------
//
// "Padrão do sistema" é uma CONSTANTE por provedor — todo agente deixado nele roda o
// mesmo modelo. A tela não dizia qual, e quem lia entendia "o sistema escolhe".

const PROVEDORES = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    models: [{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }],
    defaultModel: 'claude-sonnet-5',
    auxiliaryModel: 'claude-haiku-4-5',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    models: [{ id: 'gpt-5.1', label: 'GPT-5.1' }],
    defaultModel: 'gpt-5.1',
    auxiliaryModel: 'gpt-5-mini',
  },
]

test('o padrão do sistema aparece com o nome do modelo', async ({ page }) => {
  await stub(page)
  await page.route('**/api/providers**', (r) => r.fulfill({ json: PROVEDORES }))
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/avancado`)
  await abrirBloco(page, 'Modelo e custo')

  await expect(page.getByTestId('agent-model')).toContainText('Padrão do sistema — claude-sonnet-5')
  // O modelo de bastidor também é dinheiro: com o modo econômico ligado, ele é quem roda
  // memória, extração e guardrail.
  await expect(page.getByTestId('agent-aux-model')).toContainText('claude-haiku-4-5')
})

test('existe "Automático", e ele explica pelo que decide', async ({ page }) => {
  await stub(page)
  await page.route('**/api/providers**', (r) => r.fulfill({ json: PROVEDORES }))
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/avancado`)
  await abrirBloco(page, 'Modelo e custo')

  await page.getByTestId('agent-model').selectOption('auto')
  const nota = page.getByTestId('agent-model-auto-note')
  await expect(nota).toContainText('claude-sonnet-5')
  await expect(nota).toContainText('claude-haiku-4-5')
  await expect(nota).toContainText('ação real')
})

// --- perguntar em vez de chutar, e responder com um toque ---------------------------------
//
// Quando o agente pergunta, a conversa costuma morrer no momento em que a pessoa precisa
// redigir o recorte. Com as alternativas prontas, responder é um toque.

const PERGUNTA_DO_AGENTE = {
  reply:
    'Você quer a proposta que enviamos ou a que recebemos?\n\n1) A que enviamos\n2) A que recebemos\n\nResponda com o número da opção — ou escreva sua resposta, se nenhuma servir.',
  handoff: false,
  toolCalls: [],
  clarification: {
    question: 'Você quer a proposta que enviamos ou a que recebemos?',
    reason: 'o termo tem dois sentidos nesta conta',
    options: ['A que enviamos', 'A que recebemos'],
  },
  diagnostics: { model: 'claude-sonnet-5', modelChoice: 'default', inputTokens: 10, outputTokens: 5, durationMs: 900 },
}

test('a pergunta chega com as alternativas ESCRITAS, para qualquer canal', async ({ page }) => {
  // Botão não existe em WhatsApp, e-mail nem SMS — e é para lá que estas conversas vão.
  const enviados: Record<string, unknown>[] = []
  await stub(page)
  await page.route('**/api/agents/*/playground', (r) => {
    // A tela também LÊ esta rota ao abrir (a conversa de teste fica guardada). Só o
    // envio conta como envio.
    if (r.request().method() !== 'POST') return r.fulfill({ json: { turns: [] } })
    enviados.push(JSON.parse(r.request().postData() ?? '{}'))
    return r.fulfill({ json: PERGUNTA_DO_AGENTE })
  })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/atividade`)

  await page.getByPlaceholder('Mensagem do visitante...').fill('me manda a proposta')
  await page.getByRole('button', { name: 'Enviar' }).click()

  // As opções estão no TEXTO da resposta — nada de botão. (A numeração vira marcador de
  // lista no renderizador de markdown do Playground; num canal de texto puro ela aparece
  // literal, que é justamente o ponto.)
  await expect(page.getByText('A que enviamos', { exact: true })).toBeVisible()
  await expect(page.getByText('A que recebemos', { exact: true })).toBeVisible()
  await expect(page.getByText(/número da opção/i)).toBeVisible()
  await expect(page.getByTestId('clarification-option')).toHaveCount(0)

  // E o visitante responde digitando o número.
  await page.getByPlaceholder('Mensagem do visitante...').fill('2')
  await page.getByRole('button', { name: 'Enviar' }).click()

  await expect.poll(() => enviados.length).toBe(2)
  const segundo = enviados[1] as { messages: { role: string; content: string; clarification?: boolean; clarificationOptions?: string[] }[] }
  const pergunta = segundo.messages.find((m) => m.clarification)
  // As alternativas voltam com o turno: é o que permite o servidor ler "2" como a segunda.
  expect(pergunta?.clarificationOptions).toEqual(['A que enviamos', 'A que recebemos'])
  expect(segundo.messages.at(-1)).toMatchObject({ role: 'user', content: '2' })
})

test('resposta comum não traz lista de alternativa nenhuma', async ({ page }) => {
  await stub(page)
  await page.route('**/api/agents/*/playground', (r) =>
    r.request().method() === 'POST'
      ? r.fulfill({ json: { reply: 'Aqui está.', handoff: false, toolCalls: [], diagnostics: { model: 'x' } } })
      : r.fulfill({ json: { turns: [] } }),
  )
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/atividade`)

  await page.getByPlaceholder('Mensagem do visitante...').fill('oi')
  await page.getByRole('button', { name: 'Enviar' }).click()

  await expect(page.getByText(/número da opção/i)).toHaveCount(0)
})

// --- o site como conhecimento vivo -------------------------------------------------------
//
// A configuração fica onde o endereço é cadastrado: o dono escolhe se aquele site vira
// documento na base, com que frequência e o que ler dele. Nada nasce ligado — uma fonte
// cadastrada para outra coisa não passa a consumir banda sozinha.

const FONTE_WEB = {
  settings: { maxItems: 8, charBudget: 2400, maxSources: 5, toolName: '', toolDescription: '' },
  sources: [
    {
      routineId: null,
      origem: 'agente',
      id: 'f1',
      name: 'Boletim',
      kind: 'http',
      url: 'https://exemplo.test/boletim',
      when: 'on_demand',
      initialWindow: '7d',
      refreshMode: 'manual',
      discoveryMode: 'auto',
      crawlArticles: false,
      maxArticlesPerRun: 5,
      sameDomainOnly: true,
      status: 'ok',
      lastSuccessfulFetchAt: '2026-08-19T10:00:00.000Z',
      nextScheduledAt: null,
      lastError: null,
      host: 'exemplo.test',
    },
  ],
}

test('o site pode virar base do agente, e o modo escolhe o custo', async ({ page }) => {
  await stub(page)
  await page.route('**/api/agents/*/sources', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: FONTE_WEB }) : r.fulfill({ json: { ok: true } }),
  )
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')

  const bloco = page.getByTestId('agent-source-web').first()
  await expect(bloco).toBeVisible()
  await bloco.click()

  // Manual não pergunta frequência nenhuma: nada acontece sozinho.
  await expect(page.getByTestId('agent-source-interval')).toHaveCount(0)

  // No relógio: aparece de quanto em quanto tempo.
  await page.getByTestId('agent-source-refresh-mode').selectOption('scheduled')
  await expect(page.getByTestId('agent-source-interval')).toBeVisible()
  await expect(page.getByTestId('agent-source-staleness')).toHaveCount(0)

  // Antes de usar: aparece a partir de quando o que está guardado é velho.
  await page.getByTestId('agent-source-refresh-mode').selectOption('on_demand')
  await page.getByTestId('agent-source-advanced').click()
  await expect(page.getByTestId('agent-source-staleness')).toBeVisible()
  await expect(page.getByTestId('agent-source-interval')).toHaveCount(0)

  // As duas coisas ao mesmo tempo. (O <details> já ficou aberto acima — clicar de novo
  // fecharia, e o teste passaria a provar o contrário do que diz.)
  await page.getByTestId('agent-source-refresh-mode').selectOption('hybrid')
  await expect(page.getByTestId('agent-source-interval')).toBeVisible()
  await expect(page.getByTestId('agent-source-staleness')).toBeVisible()

  // E o recibo da última leitura, sem o qual "automático" é promessa sem prova.
  await expect(page.getByTestId('agent-source-status')).toContainText('Última leitura')
})

test('"atualizar agora" lê e conta o que mudou', async ({ page }) => {
  await stub(page)
  await page.route('**/api/agents/*/sources', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: FONTE_WEB }) : r.fulfill({ json: { ok: true } }),
  )
  await page.route('**/api/agents/*/sources/refresh', (r) =>
    r.fulfill({ json: { sources: [{ name: 'Boletim', refreshed: true, created: 2, updated: 1, unchanged: 3, error: null }] } }),
  )
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')

  await page.getByTestId('agent-sources-refresh').click()
  await expect(page.getByTestId('agent-sources-refresh-result')).toContainText('2 nova(s)')
  await expect(page.getByTestId('agent-sources-refresh-result')).toContainText('3 sem mudança')
})

// --- salvar as ferramentas com um clique -------------------------------------------------
//
// A gravação automática continua sendo a rede que evita perder edição ao trocar de aba. O
// que ela não dava era recibo: a tela dizia "as alterações são salvas automaticamente",
// que é uma frase pedindo confiança, e não uma confirmação de que algo aconteceu.

test('a seção de ferramentas tem Salvar, e nenhuma promessa de salvamento automático', async ({ page }) => {
  const gravacoes: string[] = []
  await stub(page)
  await page.route('**/api/agents/*', async (r) => {
    if (r.request().method() === 'PATCH') {
      gravacoes.push(r.request().postData() ?? '')
      return r.fulfill({ json: { ...AGENT, tools: [] } })
    }
    return r.fallback()
  })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Ferramentas')

  const salvar = page.getByTestId('tools-save')
  await expect(salvar).toBeVisible()
  // A frase que pedia confiança não existe mais em lugar nenhum da aba.
  await expect(page.getByText('As alterações são salvas automaticamente')).toHaveCount(0)

  await salvar.click()
  await expect.poll(() => gravacoes.length).toBeGreaterThan(0)
  // E o recibo aparece.
  await expect(page.getByTestId('tools-save-state')).toContainText(/Salvo|Salvando/)
})

// --- "Atualizar agora" que realmente atualiza ------------------------------------------------
//
// Relatado: cadastro o site, clico em atualizar, e não aparece conhecimento nenhum. O
// botão lia o que estava GRAVADO — e quem acabou de digitar um endereço não tem como
// saber disso. Via "Nada a atualizar agora" e concluía que a função não funciona.

test('atualizar agora salva o endereço antes de ler', async ({ page }) => {
  const ordem: string[] = []
  await stub(page)
  await page.route('**/api/agents/*/sources', (r) => {
    if (r.request().method() === 'PUT') {
      ordem.push('salvar')
      return r.fulfill({ json: { ok: true } })
    }
    return r.fulfill({ json: { settings: SETTINGS, sources: [] } })
  })
  await page.route('**/api/agents/*/sources/refresh', (r) => {
    ordem.push('atualizar')
    return r.fulfill({ json: { sources: [{ name: 'Boletim', refreshed: true, discovered: 1, created: 1, updated: 0, unchanged: 0, error: null }] } })
  })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')

  await page.getByTestId('agent-source-add').click()
  await page.getByTestId('agent-source-name').fill('Boletim')
  await page.getByTestId('agent-source-url').fill('https://exemplo.test/boletim')
  // Sem clicar em Salvar: é exatamente o caso que falhava em silêncio.
  await page.getByTestId('agent-sources-refresh').click()

  await expect.poll(() => ordem).toEqual(['salvar', 'atualizar'])
  await expect(page.getByTestId('agent-sources-refresh-result')).toContainText('1 nova(s)')
})

test('quando nada é lido, a tela diz POR QUE', async ({ page }) => {
  await stub(page)
  await page.route('**/api/agents/*/sources', (r) =>
    r.request().method() === 'PUT' ? r.fulfill({ json: { ok: true } }) : r.fulfill({ json: { settings: SETTINGS, sources: [] } }),
  )
  await page.route('**/api/agents/*/sources/refresh', (r) =>
    r.fulfill({ json: { sources: [{ name: 'Boletim', refreshed: false, reason: 'lida há 2 min', created: 0, updated: 0, unchanged: 0, error: null }] } }),
  )
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')
  await page.getByTestId('agent-source-add').click()
  await page.getByTestId('agent-source-url').fill('https://exemplo.test/boletim')
  await page.getByTestId('agent-sources-refresh').click()

  // "Nada a atualizar" sem motivo parece defeito. Com motivo, é informação.
  await expect(page.getByTestId('agent-sources-refresh-result')).toContainText('lida há 2 min')
})

test('a falha de leitura aparece na tela, e não em silêncio', async ({ page }) => {
  await stub(page)
  await page.route('**/api/agents/*/sources', (r) =>
    r.request().method() === 'PUT' ? r.fulfill({ json: { ok: true } }) : r.fulfill({ json: { settings: SETTINGS, sources: [] } }),
  )
  await page.route('**/api/agents/*/sources/refresh', (r) =>
    r.fulfill({ json: { sources: [{ name: 'Boletim', refreshed: true, created: 0, updated: 0, unchanged: 0, error: 'HTTP 403' }] } }),
  )
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')
  await page.getByTestId('agent-source-add').click()
  await page.getByTestId('agent-source-url').fill('https://exemplo.test/boletim')
  await page.getByTestId('agent-sources-refresh').click()

  await expect(page.getByTestId('agent-sources-refresh-result')).toContainText('não deu para ler (HTTP 403)')
})

test('o modo padrão avisa que não lê nada sozinho', async ({ page }) => {
  await stub(page)
  await page.route('**/api/agents/*/sources', (r) =>
    r.fulfill({
      json: {
        settings: SETTINGS,
        sources: [
          {
            routineId: null,
            origem: 'agente',
            id: 'f1',
            name: 'Boletim',
            kind: 'http',
            url: 'https://exemplo.test/boletim',
            when: 'on_demand',
            refreshMode: 'manual',
            discoveryMode: 'auto',
            host: 'exemplo.test',
          },
        ],
      },
    }),
  )
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')
  await page.getByTestId('agent-source-web').first().click()

  await expect(page.getByTestId('agent-source-manual-hint')).toContainText('nada é lido sozinho')
})

test('um endereço novo já nasce sendo lido antes de o agente ser usado', async ({ page }) => {
  await stub(page)
  await page.route('**/api/agents/*/sources', (r) =>
    r.request().method() === 'PUT' ? r.fulfill({ json: { ok: true } }) : r.fulfill({ json: { settings: SETTINGS, sources: [] } }),
  )
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')
  await page.getByTestId('agent-source-add').click()

  // O modo aparece no resumo, sem precisar abrir o bloco: era invisível antes.
  await expect(page.getByTestId('agent-source-web')).toContainText('antes de usar o agente')
  await page.getByTestId('agent-source-web').first().click()
  await expect(page.getByTestId('agent-source-refresh-mode')).toHaveValue('on_demand')
  // E o aviso de "nada é lido sozinho" não aparece, porque agora é lido.
  await expect(page.getByTestId('agent-source-manual-hint')).toHaveCount(0)
})

// --- a tela mostra o que cada TIPO usa -------------------------------------------------------
//
// Uma capacidade que não pertence ao papel simplesmente NÃO é desenhada. Havia um cartão
// no lugar, explicando a ausência — ele ocupava o mesmo espaço do bloco de verdade, com a
// diferença de não servir para nada. Quem quer a exceção liga em Avançado.

test('o analista não recebe base nem sites: no lugar, o que ele espera receber', async ({ page }) => {
  await stub(page, { agent: { ...AGENT, preset: 'analyst' } })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)

  // Nem o bloco, nem um cartão explicando por que o bloco não está lá.
  await expect(page.getByTestId('knowledge-not-for-type')).toHaveCount(0)
  await expect(page.getByTestId('agent-sources')).toHaveCount(0)
  await expect(page.getByText('O que ele aciona')).toHaveCount(0)

  // O que ele tem no lugar: o que precisa RECEBER para concluir, e em que forma entrega.
  await abrirBloco(page, 'O que ele espera receber')
  await expect(page.getByTestId('agent-input-contract')).toBeVisible()
  await abrirBloco(page, 'Formato da análise')
  await expect(page.getByTestId('agent-output-contract')).toBeVisible()
})

test('o coordenador só vê orquestração — nem app, nem ferramenta, nem base', async ({ page }) => {
  await stub(page, { agent: { ...AGENT, preset: 'manager' } })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)

  await expect(page.getByTestId('knowledge-not-for-type')).toHaveCount(0)
  await expect(page.getByTestId('agent-sources')).toHaveCount(0)
  await expect(page.getByText('O que ele aciona')).toHaveCount(0)
  await expect(page.getByText('Ferramentas personalizadas (HTTP)')).toHaveCount(0)

  // Quem conduz configura os tetos da condução: cada tarefa é uma inferência inteira.
  await abrirBloco(page, 'Orquestração')
  await expect(page.getByTestId('orchestration-max-tasks')).toBeVisible()
  await expect(page.getByTestId('orchestration-max-rounds')).toBeVisible()
  await expect(page.getByTestId('orchestration-partial-failure')).toBeVisible()
})

test('o pesquisador mantém base, sites e ferramentas', async ({ page }) => {
  await stub(page, { agent: { ...AGENT, preset: 'researcher' } })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await expect(page.getByText('O que ele aciona')).toBeVisible()
  await abrirBloco(page, 'Web')
  await expect(page.getByTestId('agent-sources')).toBeVisible()
})

test('"quando chamar este agente" existe em todo papel', async ({ page }) => {
  // É a frase que o planejador lê para escolher quem trabalha. Sem ela, a escolha depende
  // de o pedido por acaso repetir palavras do objetivo do agente.
  for (const preset of ['analyst', 'manager', 'researcher', 'operator'] as const) {
    await stub(page, { agent: { ...AGENT, preset } })
    await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
    await expect(page.getByTestId('agent-routing-description')).toHaveCount(1)
  }
})

test('um agente antigo, sem tipo declarado, continua com tudo', async ({ page }) => {
  // Tirar capacidade de quem nunca declarou nada quebraria agentes que já funcionam.
  const semPreset = { ...AGENT }
  delete (semPreset as { preset?: unknown }).preset
  await stub(page, { agent: semPreset })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await expect(page.getByText('O que ele aciona')).toBeVisible()
})


// --- o celular ---------------------------------------------------------------------------------
//
// Um flex sem quebra não estoura a página: ele ENCOLHE os filhos até o min-content para
// caber. O min-content de um botão é a palavra mais longa do rótulo, então "Adicionar
// endereço" virava uma torre de uma letra por linha — dentro da largura da tela, e por
// isso invisível para o teste de rolagem lateral, que só olha o scrollWidth da página.

test('no celular, os botões de fonte continuam botões — e não colunas de letras', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stub(page, { agent: { ...AGENT, preset: 'researcher' } })
  await page.route('**/api/agents/*/sources', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: FONTE_WEB }) : r.fulfill({ json: { ok: true } }),
  )
  // A frase do resultado é o que aperta a linha: ela é longa, e um flex sem quebra
  // encolhe os VIZINHOS para acomodá-la.
  await page.route('**/api/agents/*/sources/refresh', (r) =>
    r.fulfill({
      json: {
        sources: [{ name: 'Preço das ações', refreshed: false, created: 0, updated: 0, unchanged: 0, error: 'nenhuma página pôde ser lida' }],
      },
    }),
  )
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')
  await page.getByTestId('agent-sources-refresh').click()
  await expect(page.getByTestId('agent-sources-refresh-result')).toBeVisible()

  for (const id of ['agent-source-add', 'agent-sources-save', 'agent-sources-refresh']) {
    const caixa = await page.getByTestId(id).boundingBox()
    expect(caixa, `${id} precisa estar na tela`).not.toBeNull()
    // Um botão de uma linha tem a altura de um controle. Espremido, ele cresce para
    // baixo — é a altura que denuncia, e não a largura.
    expect(caixa!.height, `${id} está espremido (${Math.round(caixa!.height)}px de altura)`).toBeLessThan(64)
    // E continua largo o bastante para o rótulo caber deitado.
    expect(caixa!.width, `${id} está estreito demais (${Math.round(caixa!.width)}px)`).toBeGreaterThan(80)
  }
})

// "Não foi possível testar agora" era a resposta para três coisas diferentes: o servidor
// recusou, o servidor não respondeu, e o servidor respondeu algo que não é JSON. Só uma
// delas tem conserto na tela, e a frase não dizia qual.

test('quando o teste de leitura falha, a tela diz O QUE falhou', async ({ page }) => {
  await stub(page, { agent: { ...AGENT, preset: 'researcher' } })
  await page.route('**/api/agents/*/sources', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: FONTE_WEB }) : r.fulfill({ json: { ok: true } }),
  )
  // Um servidor mais antigo que esta tela: a rota não existe lá.
  await page.route('**/api/agents/*/sources/test-read', (r) => r.fulfill({ status: 404, body: 'Cannot POST' }))
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')
  await page.getByTestId('agent-source-web').first().click()

  await page.getByTestId('agent-source-test-read').first().click()
  await expect(page.getByTestId('agent-source-read-result').first()).toContainText('404')
  await expect(page.getByTestId('agent-source-read-result').first()).toContainText('anterior à desta tela')
})

test('a página que exige navegador diz que o servidor não tem um — não que o site é ruim', async ({ page }) => {
  await stub(page, { agent: { ...AGENT, preset: 'researcher' } })
  await page.route('**/api/agents/*/sources', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: FONTE_WEB }) : r.fulfill({ json: { ok: true } }),
  )
  await page.route('**/api/agents/*/sources/test-read', (r) =>
    r.fulfill({
      json: {
        ok: false,
        code: 'BROWSER_UNAVAILABLE',
        reason: 'esta página só carrega com JavaScript, e este servidor não tem navegador configurado para renderizá-la',
        readMethod: 'browser',
        status: 200,
        strategies: [
          { strategy: 'http', ok: false, code: 'JS_REQUIRED', reason: 'montada por JavaScript', durationMs: 120 },
          { strategy: 'browser', ok: false, code: 'BROWSER_UNAVAILABLE', reason: 'sem navegador', durationMs: 0 },
        ],
      },
    }),
  )
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')
  await page.getByTestId('agent-source-web').first().click()

  await page.getByTestId('agent-source-test-read').first().click()
  const resultado = page.getByTestId('agent-source-read-result').first()
  await expect(resultado).toContainText('não tem navegador configurado')
  // E o caminho tentado, que é o que separa "não tentei" de "tentei e não deu".
  await expect(resultado).toContainText('http ✕ JS_REQUIRED')
})

// --- buscar na internet: só o pesquisador, e desligado por padrão ----------------------------
//
// "Sites específicos" lê os endereços que o dono cadastrou. "Busca em toda a web"
// procura endereços que ninguém cadastrou. Custa mais, erra mais, e por isso é opcional
// — e por isso as duas viraram uma seção só, com a diferença escrita entre elas.

test('o pesquisador tem o interruptor de busca, e ele nasce desligado', async ({ page }) => {
  await stub(page, { agent: { ...AGENT, preset: 'researcher' } })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')

  await expect(page.getByTestId('web-search-enabled')).not.toBeChecked()
  // Desligado, o resto nem aparece: um agente que não busca não precisa de teto de busca.
  await expect(page.getByTestId('web-search-policy')).toHaveCount(0)
  await expect(page.getByTestId('web-search-advanced')).toHaveCount(0)
})

test('ligando, aparecem a política e os avançados — fechados', async ({ page }) => {
  await stub(page, { agent: { ...AGENT, preset: 'researcher' } })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')
  await page.getByTestId('web-search-enabled').check()

  // Um agente que já existe mantém o que tinha: o padrão do servidor continua sendo
  // "quando a base não tiver a resposta", e ligar a busca não muda a política dele.
  await expect(page.getByTestId('web-search-policy')).toHaveValue('fallback_only')
  // A explicação diz o que a opção FAZ. Antes ela falava só do custo, e a pergunta que
  // importa — em que situação ele procura — ficava sem resposta.
  await expect(page.getByTestId('web-search-policy-hint')).toContainText('quando a base não devolve nada')
  await page.getByTestId('web-search-policy').selectOption('automatic')
  await expect(page.getByTestId('web-search-policy-hint')).toContainText('responde de longe')
  const avancado = page.getByTestId('web-search-advanced')
  await expect(avancado).toBeVisible()
  await expect(page.getByTestId('web-search-maxPagesToRead')).not.toBeVisible()
  await avancado.click()
  await expect(page.getByTestId('web-search-maxPagesToRead')).toBeVisible()
})

test('a tela explica que isto NÃO é o mesmo que os sites cadastrados', async ({ page }) => {
  await stub(page, { agent: { ...AGENT, preset: 'researcher' } })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')
  // A distinção fica ENTRE os dois sub-blocos, que é onde a confusão acontecia.
  await expect(page.getByTestId('web-sites-block')).toContainText('Você escolhe quais sites')
  await expect(page.getByTestId('web-search-block')).toContainText('páginas que você não cadastrou')
})

test('analista e coordenador não têm o bloco', async ({ page }) => {
  for (const preset of ['analyst', 'manager'] as const) {
    await stub(page, { agent: { ...AGENT, preset } })
    await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
    await expect(page.getByTestId('web-search-block')).toHaveCount(0)
  }
})

// --- o servidor tem a última palavra sobre a busca ---------------------------------------------
//
// Um interruptor ligado com nenhum buscador configurado é uma promessa vazia: o agente
// não procura nada, e quem ligou conclui que a função está quebrada.

const comStatusDeBusca = async (page: Page, status: Record<string, unknown>) => {
  await page.route('**/api/settings/web-search', (r) => r.fulfill({ json: status }))
  await stub(page, { agent: { ...AGENT, preset: 'researcher' } })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')
}

test('sem buscador configurado, a tela avisa antes de o dono ligar', async ({ page }) => {
  await comStatusDeBusca(page, {
    configured: false, provider: 'brave', used: 0, limit: 900, remaining: 900,
    period: '2026-08', resetAt: '2026-09-01T00:00:00.000Z', paidUsageEnabled: false,
  })
  await expect(page.getByTestId('web-search-status')).toContainText('Nenhum buscador configurado')
})

test('com franquia acabada, a tela diz que o agente segue com a base', async ({ page }) => {
  await comStatusDeBusca(page, {
    configured: true, provider: 'brave', used: 900, limit: 900, remaining: 0,
    period: '2026-08', resetAt: '2026-09-01T00:00:00.000Z', paidUsageEnabled: false,
  })
  const status = page.getByTestId('web-search-status')
  await expect(status).toContainText('franquia mensal acabou')
  await expect(status).toContainText('900 de 900')
  await expect(status).toContainText('continua respondendo com o que já está na base')
})

test('com saldo, mostra provedor, uso e renovação — e o alcance do contador', async ({ page }) => {
  await comStatusDeBusca(page, {
    configured: true, provider: 'brave', used: 120, limit: 900, remaining: 780,
    period: '2026-08', resetAt: '2026-09-01T00:00:00.000Z', paidUsageEnabled: false,
  })
  const status = page.getByTestId('web-search-status')
  await expect(status).toContainText('brave')
  await expect(status).toContainText('120 de 900')
  await expect(status).toContainText('780 restantes')
  // O alcance importa: a mesma chave usada fora daqui não passa por este contador.
  await expect(status).toContainText('Buscas feitas fora dele')
})

test('no celular, a seção Web não estoura nem espreme os controles', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await comStatusDeBusca(page, {
    configured: true, provider: 'brave', used: 10, limit: 900, remaining: 890,
    period: '2026-08', resetAt: '2026-09-01T00:00:00.000Z', paidUsageEnabled: false,
  })
  await page.getByTestId('web-search-enabled').check()
  const caixa = await page.getByTestId('web-search-policy').boundingBox()
  expect(caixa).not.toBeNull()
  expect(caixa!.width, 'o seletor de política precisa caber na largura do telefone').toBeLessThanOrEqual(390)
  expect(caixa!.height, 'espremido, ele cresce para baixo').toBeLessThan(64)
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(sw, 'a página não pode rolar de lado').toBeLessThanOrEqual(cw + 1)
})

// --- o bloco de contagem do pesquisador -------------------------------------------------------
//
// "Evitadas" é o retorno de guardar as páginas: pergunta que a base já respondia e não
// virou requisição ao buscador.

test('com a busca ligada, o pesquisador mostra quanto buscou e quanto evitou', async ({ page }) => {
  await page.route('**/api/agents/*/search-stats', (r) =>
    r.fulfill({
      json: {
        searchesThisMonth: 12, searchesToday: 2, avoidedThisMonth: 8,
        pagesRead: 31, documentsSaved: 24, failures: 1,
        lastSearchAt: '2026-08-21T10:00:00.000Z', lastQuery: 'faturamento do trimestre',
      },
    }),
  )
  await stub(page, { agent: { ...AGENT, preset: 'researcher', webSearch: { enabled: true } } })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')

  const bloco = page.getByTestId('agent-search-stats')
  await expect(bloco).toContainText('12')
  await expect(bloco).toContainText('8')
  await expect(bloco).toContainText('40% das perguntas')
  await expect(bloco).toContainText('31')
  await expect(bloco).toContainText('24')
  await expect(page.getByTestId('search-stat-failures')).toContainText('respondeu com o que já tinha')
  await expect(page.getByTestId('search-stat-last')).toContainText('faturamento do trimestre')
})

test('com a busca desligada, não há bloco de contagem — não há o que contar', async ({ page }) => {
  await stub(page, { agent: { ...AGENT, preset: 'researcher' } })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')
  await expect(page.getByTestId('agent-search-stats')).toHaveCount(0)
})

test('o prazo de validade fica nos avançados, e aceita zero', async ({ page }) => {
  await stub(page, { agent: { ...AGENT, preset: 'researcher', webSearch: { enabled: true } } })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Web')
  await page.getByTestId('web-search-advanced').click()

  const campo = page.getByTestId('web-search-rememberDays')
  await expect(campo).toBeVisible()
  await expect(campo).toHaveAttribute('placeholder', '7')
  // Zero é uma escolha legítima: "não guarde nada".
  await expect(campo).toHaveAttribute('min', '0')
})
