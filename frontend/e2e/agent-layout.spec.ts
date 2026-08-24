import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The agent page layout and the guarded deletion.
//
// Two claims: the workspace uses the full content width at every breakpoint (it used
// to be trapped in a ~300px-sibling column, cutting forms and flows), and deleting an
// agent cannot happen by clicking — the owner types the agent's name, cancel is the
// safe default, and a failure keeps them on the page.
const AGENT_ID = '000000000000000000000a11'
const FLOOR_ID = '000000000000000000000f11'
const NOW = new Date(0).toISOString()
const AGENT_NAME = 'Ana Pesquisadora'

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = { id: FLOOR_ID, buildingId: 'b1', name: 'Térreo', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', createdAt: NOW, updatedAt: NOW }

const AGENT = {
  _id: AGENT_ID,
  name: AGENT_NAME,
  objective: 'Pesquisar concorrentes',
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
  floorId: FLOOR_ID,
}

let deleteCalls = 0

async function stub(page: Page, opts: { deleteStatus?: number } = {}) {
  deleteCalls = 0
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: [AGENT] }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: [AGENT] }))
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
  await page.route('**/api/agents/*/app-grants', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/app-installations', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/tools', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agent-stats**', (r) => r.fulfill({ json: { period: '30d', telemetrySince: null, stats: {}, channel: {} } }))
  await page.route('**/api/agent-states**', (r) => r.fulfill({ json: {} }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  // The DELETE must be the LAST route registered for this path so it wins.
  await page.route(`**/api/agents/${AGENT_ID}`, (r) => {
    if (r.request().method() !== 'DELETE') return r.fulfill({ json: AGENT })
    deleteCalls++
    if (opts.deleteStatus && opts.deleteStatus >= 400) return r.fulfill({ status: opts.deleteStatus, json: { error: 'Não foi possível excluir o agente.' } })
    return r.fulfill({ status: 204, body: '' })
  })
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
}

const openAdvanced = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/avancado`)
  await expect(page.getByTestId('danger-zone')).toBeVisible()
}

// --- layout ----------------------------------------------------------------------

for (const [label, width, height] of [
  ['mobile', 390, 844],
  ['tablet', 768, 1024],
  ['desktop', 1440, 900],
] as const) {
  test(`o workspace ocupa a largura útil no ${label} e não vaza para os lados`, async ({ page }) => {
    await stub(page)
    await page.setViewportSize({ width, height })
    await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}`)

    const workspace = page.getByTestId('agent-workspace')
    await expect(workspace).toBeVisible()

    // Sem rolagem horizontal da página: nada de 100vw nem margem negativa.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)

    // O workspace é tão largo quanto a coluna de conteúdo que o contém.
    const [box, parentWidth] = await Promise.all([
      workspace.boundingBox(),
      workspace.evaluate((el) => (el.parentElement as HTMLElement).getBoundingClientRect().width),
    ])
    expect(box!.width).toBeGreaterThan(parentWidth - 2)
  })
}

test('trocar de aba não muda a largura do painel', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}`)
  const workspace = page.getByTestId('agent-workspace')
  const before = (await workspace.boundingBox())!.width
  await page.getByRole('button', { name: 'Fluxos' }).click()
  await expect(page).toHaveURL(/fluxos/)
  const after = (await workspace.boundingBox())!.width
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1)
})

// --- zona de perigo ----------------------------------------------------------------

test('a exclusão não fica na Visão geral: ela vive em Avançado, no fim', async ({ page }) => {
  await stub(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/visao-geral`)
  await expect(page.getByRole('heading', { name: 'Desempenho operacional' })).toBeVisible()
  await expect(page.getByTestId('danger-zone')).toHaveCount(0)

  await openAdvanced(page)
  await expect(page.getByTestId('danger-zone')).toHaveCount(1)
})

test('excluir exige digitar o nome exato do agente', async ({ page }) => {
  await stub(page)
  await openAdvanced(page)
  await page.getByTestId('danger-open').click()

  const confirm = page.getByTestId('danger-confirm')
  await expect(confirm).toBeDisabled()
  // O diálogo diz o que acontece e nomeia o agente.
  await expect(page.getByText('A base de conhecimento dele é removida.')).toBeVisible()

  await page.getByTestId('danger-confirm-name').fill('Ana')
  await expect(confirm).toBeDisabled()
  await page.getByTestId('danger-confirm-name').fill(AGENT_NAME)
  await expect(confirm).toBeEnabled()
})

test('cancelar é a opção segura e fecha sem efeito', async ({ page }) => {
  await stub(page)
  await openAdvanced(page)
  await page.getByTestId('danger-open').click()
  // O foco vai para cancelar, nunca para o botão destrutivo.
  await expect(page.getByTestId('danger-cancel')).toBeFocused()
  await page.getByTestId('danger-cancel').click()
  await expect(page.getByTestId('danger-confirm')).toHaveCount(0)
  expect(deleteCalls).toBe(0)
})

test('Escape fecha o diálogo sem excluir', async ({ page }) => {
  await stub(page)
  await openAdvanced(page)
  await page.getByTestId('danger-open').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('danger-confirm')).toHaveCount(0)
  expect(deleteCalls).toBe(0)
})

test('confirmando, o agente é excluído e a rota volta para a lista do andar', async ({ page }) => {
  await stub(page)
  await openAdvanced(page)
  await page.getByTestId('danger-open').click()
  await page.getByTestId('danger-confirm-name').fill(AGENT_NAME)
  await page.getByTestId('danger-confirm').click()
  await expect(page).toHaveURL(new RegExp(`/floors/${FLOOR_ID}/agents$`))
  expect(deleteCalls).toBe(1)
})

test('se a API falhar, o usuário fica na página e lê o erro', async ({ page }) => {
  await stub(page, { deleteStatus: 500 })
  await openAdvanced(page)
  await page.getByTestId('danger-open').click()
  await page.getByTestId('danger-confirm-name').fill(AGENT_NAME)
  await page.getByTestId('danger-confirm').click()
  await expect(page.getByTestId('danger-error')).toContainText('Não foi possível excluir o agente.')
  await expect(page).toHaveURL(/avancado/)
})

test('entrar no agente não rouba o foco nem abre a página rolada', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}`)
  await expect(page.getByTestId('agent-workspace')).toBeVisible()

  // O autoFocus no campo de nome — que fica no meio da página — fazia o navegador
  // rolar até ele. Abrir tem que abrir no topo.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(20)
  const focada = await page.evaluate(() => document.activeElement?.tagName ?? '')
  expect(['BODY', 'HTML', '']).toContain(focada)
})

// A regressão real: com 5 colegas a coluna da esquerda ia a 957px contra 402 das
// métricas, e a diferença virava um retângulo vazio. A primeira tentativa de correção
// mediu SEM colegas — onde o problema nem aparece — e por isso passou verde estando
// errada. Este teste sempre semeia colegas.
for (const [rotulo, colegas] of [
  ['sem colegas', 0],
  ['com 5 colegas', 5],
] as const) {
  test(`o resumo do agente não deixa um vão vazio antes do painel (${rotulo})`, async ({ page }) => {
    await stub(page)
    const roster = [
      AGENT,
      ...Array.from({ length: colegas }, (_, i) => ({ ...AGENT, _id: `00000000000000000000ab0${i + 1}`, name: `Colega ${i + 1}` })),
    ]
    await page.route('**/api/agents?**', (r) => r.fulfill({ json: roster }))
    await page.route('**/api/agents', (r) => r.fulfill({ json: roster }))
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}`)
    await expect(page.getByTestId('agent-workspace')).toBeVisible()

    const [esquerda, direita] = await page.evaluate(() => {
      const ws = document.querySelector('[data-testid="agent-workspace"]') as HTMLElement
      const topo = (ws.parentElement as HTMLElement).children[0] as HTMLElement
      return [...topo.children].map((c) => Math.round(c.getBoundingClientRect().height))
    })
    // As duas colunas do topo têm que fechar juntas, com ou sem colegas.
    expect(Math.abs(esquerda - direita)).toBeLessThan(120)
  })
}

test('colegas, setor e onde é usado ficam depois do painel', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}`)
  const [painel, contexto] = await Promise.all([
    page.getByTestId('agent-workspace').boundingBox(),
    page.getByTestId('agent-context').boundingBox(),
  ])
  expect(contexto!.y).toBeGreaterThan(painel!.y)
})

// --- o PAPEL do agente, visível ------------------------------------------------------------
//
// O papel decide o que o agente pode fazer: se busca na base, se entra num plano com
// dependência, o que faz sozinho. Ele aparecia só quando o dono NÃO tinha escrito uma
// descrição — porque a descrição o substituía. Ou seja: sumia exatamente para os agentes
// mais configurados, que são aqueles em que a diferença mais importa.

test('o papel aparece no card, junto com a descrição — não no lugar dela', async ({ page }) => {
  await stub(page)
  await page.goto(`/floors/${FLOOR_ID}/agents`)
  const card = page.getByTestId('agent-card').first()
  await expect(card).toBeVisible()
  await expect(card.getByTestId('agent-card-role')).toBeVisible()
})

test('o papel aparece na página do agente, no cabeçalho e na visão geral', async ({ page }) => {
  await stub(page)
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/visao-geral`)
  await expect(page.getByTestId('agent-header-role')).toBeVisible()
  // E como linha própria: "Papel" e "Função" respondem perguntas diferentes, e ocupavam
  // a mesma linha.
  await expect(page.getByTestId('agent-summary')).toContainText('Papel')
})
