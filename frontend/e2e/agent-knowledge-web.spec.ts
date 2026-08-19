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


// --- o que o crawler trouxe, na aba Conhecimento ---------------------------------------------
//
// Conhecimento é conhecimento, tenha vindo de um arquivo ou de um site. O que muda é a
// procedência — e é ela que precisa aparecer, junto com o que dá para fazer a respeito.

const AGORA = new Date().toISOString()
const PAGINA_CONHECIMENTO = {
  items: [
    {
      _id: 'd1',
      title: 'Relatório trimestral da unidade 7',
      createdAt: AGORA,
      updatedAt: AGORA,
      source: 'web',
      indexStatus: 'indexed',
      chunkCount: 12,
      web: {
        sourceType: 'web',
        sourceId: 'f1',
        url: 'https://exemplo.test/relatorio?utm_source=news',
        canonicalUrl: 'https://exemplo.test/relatorio',
        domain: 'exemplo.test',
        title: 'Relatório trimestral da unidade 7',
        author: 'Redação',
        publishedAt: '2026-08-18T09:00:00.000Z',
        fetchedAt: AGORA,
        contentHash: 'abc',
      },
    },
    { _id: 'd2', title: 'Manual do produto', createdAt: AGORA, updatedAt: AGORA, source: 'manual', indexStatus: 'indexed', chunkCount: 3 },
  ],
  total: 2,
  summary: { manual: 1, web: 1, total: 2, lastWebFetchAt: AGORA },
}

async function abrirConhecimento(page: Page, pedidos: string[] = []) {
  await stub(page)
  await page.route('**/api/agents/*/documents**', (r) => {
    const url = r.request().url()
    pedidos.push(url)
    if (r.request().method() !== 'GET') return r.fulfill({ json: {} })
    if (/\/documents\/d1/.test(url)) {
      return r.fulfill({ json: { ...PAGINA_CONHECIMENTO.items[0], content: 'O relatório trimestral apontou crescimento de 12%.' } })
    }
    const kind = new URL(url).searchParams.get('kind')
    const sourceId = new URL(url).searchParams.get('sourceId')
    const itens = PAGINA_CONHECIMENTO.items.filter(
      (d) => (!kind || (kind === 'web' ? Boolean(d.web) : !d.web)) && (!sourceId || d.web?.sourceId === sourceId),
    )
    return r.fulfill({ json: { ...PAGINA_CONHECIMENTO, items: itens, total: itens.length } })
  })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Base de conhecimento')
}

test('o que veio de um site aparece na base, com selo e procedência', async ({ page }) => {
  await abrirConhecimento(page)

  await expect(page.getByTestId('knowledge-summary')).toContainText('Manual: 1')
  await expect(page.getByTestId('knowledge-summary')).toContainText('Web: 1')
  const web = page.getByTestId('knowledge-web-item')
  await expect(web).toContainText('Relatório trimestral da unidade 7')
  await expect(web.getByTestId('knowledge-web-badge')).toBeVisible()
  await expect(web).toContainText('exemplo.test')
  await expect(web).toContainText('12 trecho(s)')
  await expect(web).toContainText('indexado')
  // O documento escrito à mão não ganha selo de web.
  await expect(page.getByTestId('knowledge-manual-item')).toContainText('Manual do produto')
})

test('os filtros separam manual de web', async ({ page }) => {
  await abrirConhecimento(page)
  await page.getByTestId('knowledge-filter-web').click()
  await expect(page.getByTestId('knowledge-web-item')).toHaveCount(1)
  await expect(page.getByTestId('knowledge-manual-item')).toHaveCount(0)

  await page.getByTestId('knowledge-filter-manual').click()
  await expect(page.getByTestId('knowledge-manual-item')).toHaveCount(1)
  await expect(page.getByTestId('knowledge-web-item')).toHaveCount(0)
})

test('abrir um documento web mostra conteúdo, endereço e metadados', async ({ page }) => {
  await abrirConhecimento(page)
  await page.getByTestId('knowledge-web-item').getByText('Ver/Editar').click()

  const detalhe = page.getByTestId('knowledge-doc-detail')
  await expect(detalhe.getByTestId('knowledge-doc-content')).toContainText('crescimento de 12%')
  // O endereço original, clicável — e o canônico, sem o rastreio.
  const link = detalhe.getByTestId('knowledge-doc-url')
  await expect(link).toHaveAttribute('href', 'https://exemplo.test/relatorio')
  await expect(detalhe).toContainText('exemplo.test · f1')
  await expect(detalhe).toContainText('Redação')
  await expect(detalhe).toContainText('12 trecho(s)')
  // Vetor não é assunto de tela.
  await expect(detalhe).not.toContainText('embedding')
})

test('a listagem NÃO baixa o conteúdo dos documentos', async ({ page }) => {
  const pedidos: string[] = []
  await abrirConhecimento(page, pedidos)
  await expect(page.getByTestId('knowledge-web-item')).toBeVisible()
  // Nenhuma requisição a um documento específico antes de alguém abrir um.
  expect(pedidos.filter((u) => /\/documents\/[a-z0-9]+/i.test(u))).toEqual([])
})

test('excluir e ignorar avisa o servidor para não trazer o endereço de volta', async ({ page }) => {
  const apagados: string[] = []
  await stub(page)
  await page.route('**/api/agents/*/documents**', (r) => {
    if (r.request().method() === 'DELETE') {
      apagados.push(r.request().url())
      return r.fulfill({ status: 204, body: '' })
    }
    return r.fulfill({ json: PAGINA_CONHECIMENTO })
  })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await abrirBloco(page, 'Base de conhecimento')

  await page.getByTestId('knowledge-delete-ignore').click()
  await expect.poll(() => apagados.length).toBeGreaterThan(0)
  expect(apagados[0]).toContain('ignore=1')
})
