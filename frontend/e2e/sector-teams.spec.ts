import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Sectors as TEAMS: plain-language modes, three-step guided creation, a visible
// flow, readiness that says what is missing, and contextual hiring. The API is
// stubbed, so these never pass vacuously against a half-built page.
const FLOOR_ID = '000000000000000000000f11'
const SECTOR_ID = '000000000000000000000501'
const A1 = '000000000000000000000a01' // manager
const A2 = '000000000000000000000a02' // operator
const NOW = new Date(0).toISOString()

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = { id: FLOOR_ID, buildingId: 'b1', name: 'Térreo', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', createdAt: NOW, updatedAt: NOW }

const agent = (id: string, name: string, preset: string, role?: string) => ({
  _id: id,
  name,
  objective: 'obj',
  // O bloco "Função" da definição: é o que o desenho do fluxo mostra debaixo do nome.
  ...(role ? { role } : {}),
  provider: 'anthropic',
  model: null,
  preset,
  capabilities: [],
  activationModes: ['manual'],
  inputContract: '',
  outputContract: '',
  delegationPolicy: preset === 'manager' ? 'all' : 'none',
  callerPolicy: 'all',
  callableAgentIds: [],
  callableSectorIds: [],
  allowedCallerAgentIds: [],
  tools: [],
  builtinTools: [],
  metricProfile: 'auto',
  floorId: FLOOR_ID,
})
const AGENTS = [
  agent(A1, 'Gerente Ana', 'manager', 'Coordena a mesa e distribui o trabalho'),
  agent(A2, 'Executor Bruno', 'operator', 'Analista de pedidos do salão'),
]

const member = (agentId: string, over: Record<string, unknown> = {}) => ({ agentId, sector: '', routingDescription: '', advanceWhen: '', transitions: [], isDefault: false, ...over })

// A LEGACY sector: the old 'adaptive' mode, no coordinator, no stages recorded.
const LEGACY_SECTOR = {
  _id: SECTOR_ID,
  floorId: FLOOR_ID,
  name: 'Setor Antigo',
  color: '#88a',
  mode: 'adaptive',
  members: [member(A1, { isDefault: true }), member(A2)],
}

const PIPELINE_SECTOR = {
  _id: SECTOR_ID,
  floorId: FLOOR_ID,
  name: 'Cozinha',
  color: '#88a',
  mode: 'pipeline',
  members: [],
  inputContract: 'um pedido',
  outputContract: 'prato pronto',
  stages: [
    { id: 's1', name: 'Anotar pedido', agentId: A2, instruction: '', dependsOn: [], inputMapping: {}, expectedOutput: '', onError: 'stop', retryPolicy: { maxAttempts: 1, backoffMs: 2000 } },
    { id: 's2', name: 'Preparar', agentId: A1, instruction: '', dependsOn: ['s1'], inputMapping: {}, expectedOutput: '', onError: 'stop', retryPolicy: { maxAttempts: 1, backoffMs: 2000 } },
  ],
}

const overviewFor = (sector: Record<string, unknown>, readiness?: Record<string, unknown>) => ({
  sector,
  readiness: readiness ?? { ready: true, issues: [] },
  analytics: null,
  linkedWidgets: [],
})

let savedBody: Record<string, unknown> | null = null

async function stubApi(
  page: Page,
  opts: { sectors?: Record<string, unknown>[]; overview?: Record<string, unknown>; agents?: Record<string, unknown>[] } = {},
) {
  savedBody = null
  const sectors = opts.sectors ?? []
  const agentes = opts.agents ?? AGENTS
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: agentes }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: agentes }))
  await page.route('**/api/agent-presets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors/*/overview', (r) => r.fulfill({ json: opts.overview ?? overviewFor(sectors[0] ?? LEGACY_SECTOR) }))
  await page.route('**/api/sectors/*', async (r) => {
    if (['POST', 'PATCH', 'PUT'].includes(r.request().method())) {
      savedBody = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ json: { ...(sectors[0] ?? LEGACY_SECTOR), ...savedBody } })
    }
    return r.fulfill({ json: sectors[0] ?? LEGACY_SECTOR })
  })
  await page.route('**/api/sectors', async (r) => {
    if (r.request().method() === 'POST') {
      savedBody = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ status: 201, json: { ...LEGACY_SECTOR, ...savedBody, _id: SECTOR_ID } })
    }
    return r.fulfill({ json: sectors })
  })
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  await page.route('**/api/providers**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/apps**', (r) => r.fulfill({ json: [] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) => r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }))
}

const openWizard = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}/sectors`)
  await page.getByRole('button', { name: 'Nova equipe' }).click()
  await expect(page.getByTestId('sector-wizard')).toBeVisible()
}

// ---------------------------------------------------------------- creation
test('creating a team goes through exactly three steps', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await expect(page.getByText('1. A equipe')).toBeVisible()
  await expect(page.getByText('2. O que ela faz')).toBeVisible()
  await expect(page.getByText('3. Quem trabalha nela')).toBeVisible()
  await expect(page.getByText('4.', { exact: false })).toHaveCount(0)
})

test('the three modes are named in plain language, never as jargon', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await page.getByLabel('Nome da equipe').fill('Salão')
  await page.getByTestId('sector-next').click()
  await expect(page.getByTestId('sector-mode-organization')).toContainText('Só organizar')
  await expect(page.getByTestId('sector-mode-orchestrated')).toContainText('Um gerente coordena')
  await expect(page.getByTestId('sector-mode-pipeline')).toContainText('Executar em etapas')
  const body = (await page.getByTestId('sector-wizard').innerText()).toLowerCase()
  for (const jargon of ['orchestrated', 'pipeline', 'organization', 'adaptive', 'dependson', 'coordinatoragentid']) {
    expect(body, `"${jargon}" leaked into the wizard`).not.toContain(jargon)
  }
})

test('a coordinated team cannot be created without a coordinator, and says so', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await page.getByLabel('Nome da equipe').fill('Salão')
  await page.getByTestId('sector-next').click()
  await page.getByTestId('sector-mode-orchestrated').click()
  await page.getByTestId('sector-next').click()
  await expect(page.getByTestId('sector-readiness')).toContainText('Falta escolher quem coordena')
  await page.getByRole('button', { name: 'Criar equipe' }).click()
  expect(savedBody, 'an incomplete team must never be saved').toBeNull()
})

test('a step-by-step team saves its stages in order', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await page.getByLabel('Nome da equipe').fill('Cozinha')
  await page.getByTestId('sector-next').click()
  await page.getByTestId('sector-mode-pipeline').click()
  await page.getByTestId('sector-next').click()
  await page.getByRole('combobox').last().selectOption(A2)
  await page.getByRole('combobox').last().selectOption(A1)
  await expect(page.getByTestId('stage-row')).toHaveCount(2)
  await expect(page.getByTestId('stage-flow-preview')).toContainText('Entrada →')
  await page.getByRole('button', { name: 'Criar equipe' }).click()
  await expect.poll(() => savedBody?.name).toBe('Cozinha')
  expect((savedBody?.stages as { agentId: string }[]).map((s) => s.agentId)).toEqual([A2, A1])
})

test('reordering a stage changes the saved order', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await page.getByLabel('Nome da equipe').fill('Cozinha')
  await page.getByTestId('sector-next').click()
  await page.getByTestId('sector-mode-pipeline').click()
  await page.getByTestId('sector-next').click()
  await page.getByRole('combobox').last().selectOption(A2)
  await page.getByRole('combobox').last().selectOption(A1)
  await page.getByRole('button', { name: 'Subir' }).nth(1).click()
  await page.getByRole('button', { name: 'Criar equipe' }).click()
  await expect.poll(() => (savedBody?.stages as { agentId: string }[] | undefined)?.map((s) => s.agentId)).toEqual([A1, A2])
})

test('the advanced dependency picker stays collapsed by default', async ({ page }) => {
  await stubApi(page)
  await openWizard(page)
  await page.getByLabel('Nome da equipe').fill('Cozinha')
  await page.getByTestId('sector-next').click()
  await page.getByTestId('sector-mode-pipeline').click()
  await page.getByTestId('sector-next').click()
  await page.getByRole('combobox').last().selectOption(A2)
  await page.getByRole('combobox').last().selectOption(A1)
  await expect(page.getByText('Avançado: de onde vem a informação')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Anotar pedido' })).toHaveCount(0)
})

// ---------------------------------------------------------------- sector page
test('the sector page has exactly five sections', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  const nav = page.getByRole('navigation', { name: 'Seções do setor' })
  await expect(nav.getByRole('link')).toHaveCount(5)
  for (const label of ['Visão geral', 'Equipe e fluxo', 'Conhecimento', 'Execuções', 'Avançado']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible()
  }
})

test('a legacy adaptive sector opens as a coordinated team, never as broken', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  await expect(page.getByTestId('sector-flow')).toBeVisible()
  await expect(page.getByText('Setor não encontrado')).toHaveCount(0)
})

test('an old /configuracao link still lands on the team section', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}/configuracao`)
  await expect(page.getByTestId('sector-step-team')).toBeVisible()
})

test('the flow diagram shows entrada, the stages in order, and saída', async ({ page }) => {
  await stubApi(page, { sectors: [PIPELINE_SECTOR], overview: overviewFor(PIPELINE_SECTOR) })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  const flow = page.getByTestId('sector-flow')
  await expect(flow).toContainText('Entrada')
  await expect(flow).toContainText('1. Anotar pedido')
  await expect(flow).toContainText('2. Preparar')
  await expect(flow).toContainText('Saída')
})

// The flow reads TOP DOWN. Growing sideways meant a scrollbar inside the card for
// anything longer than three steps — and, on a phone, the whole page moving.
test('o fluxo do pipeline cresce de cima para baixo, sem rolagem horizontal', async ({ page }) => {
  await stubApi(page, { sectors: [PIPELINE_SECTOR], overview: overviewFor(PIPELINE_SECTOR) })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  const flow = page.getByTestId('sector-flow')

  // Cada bloco começa abaixo do anterior.
  const tops = await flow.locator('a, div[style]').evaluateAll((els) =>
    els.filter((el) => el.textContent?.trim()).map((el) => el.getBoundingClientRect().top),
  )
  const ordered = [...tops].sort((a, b) => a - b)
  expect(tops).toEqual(ordered)

  // As setas apontam para baixo e não são anunciadas por leitor de tela.
  const arrow = flow.getByTestId('flow-arrow').first()
  await expect(arrow).toHaveText('↓')
  await expect(arrow).toHaveAttribute('aria-hidden', 'true')

  // O fluxo não tem rolagem estrutural própria.
  const scrolls = await flow.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(scrolls).toBeLessThanOrEqual(1)
})

test('no orquestrado, os especialistas são um grupo — não uma sequência obrigatória', async ({ page }) => {
  const orchestrated = { ...LEGACY_SECTOR, mode: 'orchestrated', coordinatorAgentId: A1 }
  await stubApi(page, { sectors: [orchestrated], overview: overviewFor(orchestrated) })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  const flow = page.getByTestId('sector-flow')
  await expect(flow).toContainText('coordena')
  await expect(flow.getByTestId('specialists-note')).toContainText('conforme a necessidade')
  // Entrada ↓ coordenador ↓ grupo ↓ Saída: três setas, não uma por especialista.
  await expect(flow.getByTestId('flow-arrow')).toHaveCount(3)
})

test('o grupo organizacional continua sem entrada, saída ou setas', async ({ page }) => {
  const group = { ...LEGACY_SECTOR, mode: 'organization' }
  await stubApi(page, { sectors: [group], overview: overviewFor(group) })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  const flow = page.getByTestId('sector-flow')
  await expect(flow.getByTestId('flow-arrow')).toHaveCount(0)
  await expect(flow).not.toContainText('Saída')
})

test('cada bloco do fluxo continua abrindo o agente', async ({ page }) => {
  await stubApi(page, { sectors: [PIPELINE_SECTOR], overview: overviewFor(PIPELINE_SECTOR) })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  await page.getByTestId('sector-flow').getByRole('link').first().click()
  await expect(page).toHaveURL(new RegExp(`/floors/${FLOOR_ID}/agents/`))
})

test('readiness on the page says what is missing and links to the fix', async ({ page }) => {
  const broken = { ...PIPELINE_SECTOR, stages: [] }
  await stubApi(page, {
    sectors: [broken],
    overview: overviewFor(broken, { ready: false, issues: [{ code: 'no_stages', message: 'O fluxo ainda não tem nenhuma etapa.', action: 'Adicionar etapa', severity: 'blocking' }] }),
  })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  await expect(page.getByTestId('sector-readiness-panel')).toContainText('não tem nenhuma etapa')
  await page.getByRole('button', { name: 'Adicionar etapa' }).click()
  await expect(page).toHaveURL(new RegExp(`/sectors/${SECTOR_ID}/equipe`))
})

test('an agent that still needs setup is flagged on the sector, not silently ignored', async ({ page }) => {
  await stubApi(page, {
    sectors: [LEGACY_SECTOR],
    overview: overviewFor(LEGACY_SECTOR, { ready: true, issues: [{ code: 'agent_pending', message: 'Executor Bruno ainda precisa de configuração para trabalhar.', action: 'Abrir agente', severity: 'warning' }] }),
  })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  await expect(page.getByTestId('member-pending')).toHaveCount(1)
})

test('picking a non-manager coordinator warns but never blocks', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}/equipe`)
  await page.getByTestId('coordinator-picker').selectOption(A2)
  await expect(page.getByTestId('coordinator-warning')).toBeVisible()
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect.poll(() => savedBody?.coordinatorAgentId).toBe(A2)
})

test('a stage offers hiring an agent for it', async ({ page }) => {
  await stubApi(page, { sectors: [PIPELINE_SECTOR], overview: overviewFor(PIPELINE_SECTOR) })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}/equipe`)
  await expect(page.getByTestId('hire-for-stage').first()).toBeVisible()
  await page.getByTestId('hire-for-stage').first().click()
  await expect(page.getByTestId('hire-wizard')).toBeVisible()
})

test('an organization sector shows its group without an execution flow', async ({ page }) => {
  const group = { ...LEGACY_SECTOR, mode: 'organization' }
  await stubApi(page, { sectors: [group], overview: overviewFor(group) })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  const flow = page.getByTestId('sector-flow')
  await expect(flow).toContainText('Gerente Ana')
  await expect(flow).not.toContainText('Entrada')
})

test('the sector page works on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stubApi(page, { sectors: [PIPELINE_SECTOR], overview: overviewFor(PIPELINE_SECTOR) })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  await expect(page.getByTestId('sector-flow')).toBeVisible()
  // Nothing may push the page sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('o topo do setor não repete o que o cabeçalho já diz', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  await expect(page.getByTestId('sector-workspace')).toBeVisible()

  // Nome e "andar · modo · N agentes" ficam no cabeçalho da página. O bloco do mapa
  // não os repete — a mesma frase duas vezes na mesma tela é ruído.
  const heroi = page.getByTestId('sector-hero')
  await expect(heroi.getByRole('heading')).toHaveCount(0)
  // A ação principal vive na linha do nome, não dentro do mapa.
  await expect(heroi.getByRole('button', { name: 'Gerenciar agentes' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Gerenciar agentes' })).toBeVisible()
})

test('o Desempenho fica ao lado do mapa, fora do bloco de abas', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  await expect(page.getByTestId('sector-workspace')).toBeVisible()
  const [desempenho, abas] = await Promise.all([
    page.getByTestId('sector-performance').boundingBox(),
    page.getByTestId('sector-workspace').boundingBox(),
  ])
  // Acima do bloco de abas, não dentro dele.
  expect(desempenho!.y).toBeLessThan(abas!.y)
})

test('o mapa acompanha a altura do Desempenho, sem bege sobrando', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  await expect(page.getByTestId('sector-workspace')).toBeVisible()
  const [mapa, desempenho] = await Promise.all([
    page.getByTestId('sector-hero').boundingBox(),
    page.getByTestId('sector-performance').boundingBox(),
  ])
  expect(Math.abs(mapa!.height - desempenho!.height)).toBeLessThan(4)
})

test('a prontidão do setor é lida no cabeçalho, não embaixo do mapa', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  await expect(page.getByTestId('sector-workspace')).toBeVisible()
  // O selo saiu de dentro do mapa e subiu para a linha do nome.
  await expect(page.getByTestId('sector-hero').getByTestId('sector-readiness')).toHaveCount(0)
  const [prontidao, mapa] = await Promise.all([
    // O cabeçalho renderiza os mesmos selos no desktop e no mobile; o primeiro é o
    // que está visível na largura deste teste.
    page.getByTestId('sector-readiness').first().boundingBox(),
    page.getByTestId('sector-hero').boundingBox(),
  ])
  expect(prontidao!.y).toBeLessThan(mapa!.y)
})

test('o Desempenho acompanha o setor em qualquer aba', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  for (const aba of ['', 'equipe', 'avancado']) {
    await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}/${aba}`)
    await expect(page.getByTestId('sector-performance')).toBeVisible()
  }
})

test('o fluxo fica à esquerda e os agentes à direita, lado a lado', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  const trabalho = page.getByTestId('sector-work')
  await expect(trabalho).toBeVisible()

  const [fluxo, agentes] = await trabalho.evaluate((el) =>
    [...el.children].map((c) => {
      const r = c.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y) }
    }),
  )
  // Mesma linha, e o fluxo antes dos agentes.
  expect(Math.abs(fluxo.y - agentes.y)).toBeLessThan(4)
  expect(fluxo.x).toBeLessThan(agentes.x)
})

test('no celular as duas colunas viram uma pilha', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  const trabalho = page.getByTestId('sector-work')
  await expect(trabalho).toBeVisible()
  const [fluxo, agentes] = await trabalho.evaluate((el) => [...el.children].map((c) => Math.round(c.getBoundingClientRect().y)))
  expect(agentes).toBeGreaterThan(fluxo)
})

// --- setor em etapas: os agentes precisam APARECER ---------------------------------------
//
// O sintoma relatado: um setor "executar em etapas" mostrava o fluxo desenhado à esquerda
// e nada à direita, com "0 agentes" no cabeçalho. A causa: o editor grava `members: []` e
// toda a tela lia `members` — os agentes existiam o tempo todo, dentro das etapas.

test('um setor em etapas mostra os agentes de cada etapa, e não uma coluna vazia', async ({ page }) => {
  await stubApi(page, { sectors: [PIPELINE_SECTOR], overview: overviewFor(PIPELINE_SECTOR) })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)

  const trabalho = page.getByTestId('sector-work')
  await expect(trabalho).toContainText('Executor Bruno')
  await expect(trabalho).toContainText('Gerente Ana')
  // E o nome da etapa, que é o que explica por que cada um está ali.
  await expect(trabalho).toContainText('Anotar pedido')
  await expect(trabalho).toContainText('Preparar')
})

test('a contagem de agentes conta quem está nas etapas', async ({ page }) => {
  await stubApi(page, { sectors: [PIPELINE_SECTOR], overview: overviewFor(PIPELINE_SECTOR) })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  // Dizia "0 agentes" num setor com duas etapas configuradas. (O cabeçalho é
  // responsivo e desenha o selo duas vezes; basta um estar lá.)
  await expect(page.getByText('2 agentes').first()).toBeVisible()
})

test('a etapa diz de quem ela recebe, pelo nome da etapa anterior', async ({ page }) => {
  await stubApi(page, { sectors: [PIPELINE_SECTOR], overview: overviewFor(PIPELINE_SECTOR) })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  await expect(page.getByTestId('sector-work')).toContainText('Recebe de: Anotar pedido')
})

// --- o teste do setor precisa mostrar o que aconteceu ---------------------------------------
//
// Antes ele mostrava um texto de resposta e mais nada: nem quem executou, nem quanto
// custou, nem quanto demorou. Numa equipe, uma pergunta são várias chamadas — e o dono
// pagava por todas sem ver nenhuma.

const RESPOSTA_DO_TIME = {
  reply: 'Em 10/08/2026, BBSE3 fechou a R$ 36,42.',
  mode: 'orchestrated',
  executionId: 'exec-1',
  participants: [
    { name: 'Gerente Ana', role: 'coordinator', grounding: 'empty', toolCalls: 1, inputTokens: 120, outputTokens: 30, durationMs: 1400, provider: 'anthropic', model: 'claude-sonnet-5' },
    { name: 'Executor Bruno', role: 'specialist', grounding: 'ok', toolCalls: 0, inputTokens: 400, outputTokens: 90, durationMs: 2600, provider: 'openai', model: 'gpt-5' },
  ],
  grounding: 'ok',
  sources: [{ documentId: 'doc-1', title: 'Série histórica BBSE3' }],
  usage: { inputTokens: 520, outputTokens: 120 },
  durationMs: 4000,
}

test('o teste do setor mostra quem executou, com modelo, tokens e tempo', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  await page.route('**/api/sectors/*/playground', (r) => r.fulfill({ json: RESPOSTA_DO_TIME }))
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}/execucoes`)

  await page.getByPlaceholder('Mensagem do visitante...').fill('quanto valia BBSE3?')
  await page.getByRole('button', { name: 'Enviar' }).click()

  const registro = page.getByTestId('sector-run-trace')
  await expect(registro).toBeVisible()
  await expect(registro).toContainText('2 agentes executaram')
  await expect(registro).toContainText('640 tokens')

  // Cada agente, com o que ele custou — e com o modelo DELE.
  const linhas = page.getByTestId('sector-run-rows')
  await expect(linhas).toContainText('Gerente Ana')
  await expect(linhas).toContainText('claude-sonnet-5')
  await expect(linhas).toContainText('Executor Bruno')
  await expect(linhas).toContainText('gpt-5')
  await expect(linhas).toContainText('490')
  await expect(linhas).toContainText('2.6 s')
})

test('o teste diz de qual documento a resposta veio, e como a busca terminou', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  await page.route('**/api/sectors/*/playground', (r) => r.fulfill({ json: RESPOSTA_DO_TIME }))
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}/execucoes`)

  await page.getByPlaceholder('Mensagem do visitante...').fill('quanto valia BBSE3?')
  await page.getByRole('button', { name: 'Enviar' }).click()

  await expect(page.getByTestId('sector-run-sources')).toContainText('Série histórica BBSE3')
  await expect(page.getByTestId('sector-run-grounding')).toContainText('usou a base')
})

test('busca indisponível não é dita como "não existe"', async ({ page }) => {
  await stubApi(page, { sectors: [LEGACY_SECTOR] })
  await page.route('**/api/sectors/*/playground', (r) =>
    r.fulfill({ json: { ...RESPOSTA_DO_TIME, grounding: 'unavailable', sources: [] } }),
  )
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}/execucoes`)

  await page.getByPlaceholder('Mensagem do visitante...').fill('quanto valia BBSE3?')
  await page.getByRole('button', { name: 'Enviar' }).click()

  await expect(page.getByTestId('sector-run-grounding')).toContainText('não é o mesmo que "não existe"')
})

// --- o fluxo diz o que cada agente É --------------------------------------------------
//
// O desenho mostrava só o nome, e um nome não diz se aquele quadrado é o analista ou o
// redator. O cartão ao lado já dizia; o fluxo, não — e é nele que se olha para entender o
// caminho do trabalho.

test('no fluxo orquestrado, coordenador e especialistas mostram a função de cada um', async ({ page }) => {
  const orquestrado = { ...LEGACY_SECTOR, mode: 'orchestrated', coordinatorAgentId: A1 }
  await stubApi(page, { sectors: [orquestrado], overview: overviewFor(orquestrado) })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)

  const fluxo = page.getByTestId('sector-flow')
  await expect(fluxo).toContainText('Coordena a mesa e distribui o trabalho')
  await expect(fluxo).toContainText('Analista de pedidos do salão')
  // E continua dizendo quem coordena.
  await expect(fluxo).toContainText('coordena')
})

test('no fluxo em etapas, cada etapa mostra o agente E a função dele', async ({ page }) => {
  await stubApi(page, { sectors: [PIPELINE_SECTOR], overview: overviewFor(PIPELINE_SECTOR) })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)

  const fluxo = page.getByTestId('sector-flow')
  await expect(fluxo).toContainText('1. Anotar pedido')
  await expect(fluxo).toContainText('Executor Bruno')
  await expect(fluxo).toContainText('Analista de pedidos do salão')
  await expect(fluxo).toContainText('Coordena a mesa e distribui o trabalho')
})

test('sem função escrita, o fluxo não inventa — mostra o objetivo', async ({ page }) => {
  const semFuncao = [
    { ...AGENTS[0], role: undefined, objective: 'Receber pedidos e distribuir' },
    { ...AGENTS[1], role: undefined, objective: 'Preparar o prato' },
  ]
  const orquestrado = { ...LEGACY_SECTOR, mode: 'orchestrated', coordinatorAgentId: A1 }
  await stubApi(page, { sectors: [orquestrado], overview: overviewFor(orquestrado), agents: semFuncao })
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)

  await expect(page.getByTestId('sector-flow')).toContainText('Receber pedidos e distribuir')
})
