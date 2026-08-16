import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// "Como este andar trabalha". A floor is an ORGANISATIONAL area: choosing a
// coordinator points at an agent that already exists and grants nothing. What these
// pin: the two modes, the coordinator restricted to this floor's agents, the preview
// of what the coordinator really reaches, and readiness that says what is wrong
// instead of failing silently.
const FLOOR_ID = '000000000000000000000f11'
const A1 = '000000000000000000000a11'
const A2 = '000000000000000000000a22'
const NOW = new Date(0).toISOString()

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const floorDoc = (over: Record<string, unknown> = {}) => ({
  id: FLOOR_ID,
  buildingId: 'b1',
  name: 'Térreo',
  mission: '',
  description: '',
  timezone: 'America/Sao_Paulo',
  defaultLanguage: 'pt',
  color: null,
  icon: null,
  order: 0,
  status: 'active',
  workMode: 'organization',
  coordinatorAgentId: null,
  instruction: '',
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
})

const AGENTS = [
  { _id: A1, name: 'Gerente Ana', objective: '', preset: 'manager', floorId: FLOOR_ID, tools: [], builtinTools: [], capabilities: [], activationModes: ['manual'] },
  { _id: A2, name: 'De outro andar', objective: '', preset: 'custom', floorId: 'outro', tools: [], builtinTools: [], capabilities: [], activationModes: ['manual'] },
]

const READY_OVERVIEW = {
  workMode: 'coordinated',
  instruction: 'Priorize atrasos',
  coordinator: { id: A1, name: 'Gerente Ana', objective: '', delegationPolicy: 'floor' },
  targets: [
    { id: 'ag-1', kind: 'agent', name: 'Atendente', competency: 'atendimento', ready: true },
    { id: 'sc-1', kind: 'sector', name: 'Grupo', competency: '', mode: 'organization', ready: false, blockedReason: 'este setor apenas agrupa agentes e não executa como unidade' },
  ],
  ready: true,
  issues: [],
  preview: { from: 'Gerente Ana', to: ['Atendente'] },
}

let savedPatch: Record<string, unknown> | null = null

async function stub(page: Page, opts: { floor?: Record<string, unknown>; overview?: unknown; patchStatus?: number } = {}) {
  savedPatch = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const floor = opts.floor ?? floorDoc()

  // Playwright matches routes in REVERSE registration order, so the generic list
  // handler goes FIRST and the specific ones after it.
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [floor] }))
  await page.route(`**/api/floors/${FLOOR_ID}`, (r) => {
    if (r.request().method() === 'PATCH') {
      savedPatch = r.request().postDataJSON() as Record<string, unknown>
      if (opts.patchStatus && opts.patchStatus >= 400) return r.fulfill({ status: opts.patchStatus, json: { message: 'escolha o agente que coordena este andar' } })
      return r.fulfill({ json: { ...floor, ...savedPatch } })
    }
    return r.fulfill({ json: floor })
  })
  await page.route('**/api/floors/*/activity', (r) => r.fulfill({ json: { agents: 1, sectors: 0, automationsActive: 0, runsActive: 0, failures24h: 0 } }))
  await page.route('**/api/floors/*/metrics', (r) => r.fulfill({ json: null }))
  await page.route('**/api/floors/*/agent-states**', (r) => r.fulfill({ json: {} }))
  await page.route('**/api/floors/*/executions/analytics**', (r) =>
    r.fulfill({
      json: {
        scope: 'floor',
        period: '30d',
        telemetrySince: null,
        executions: 0,
        succeeded: 0,
        failed: 0,
        canceled: 0,
        running: 0,
        successRate: null,
        avgDurationMs: null,
        p95DurationMs: null,
        avgQueueMs: null,
        activeTimeMs: 0,
        totalTokens: 0,
        avgTokensPerExecution: null,
        participations: 0,
        participatedExecutions: 0,
        partialTelemetry: 0,
      },
    }),
  )
  await page.route('**/api/executions/breakdown**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/floors/*/work-overview', (r) =>
    r.fulfill({ json: opts.overview ?? { workMode: 'organization', instruction: '', coordinator: null, targets: [], ready: true, issues: [], preview: null } }),
  )
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: AGENTS }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: AGENTS }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/apps**', (r) => r.fulfill({ json: [] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
}

const open = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}`)
  await expect(page.getByTestId('floor-work-section')).toBeVisible()
}

test('o andar oferece exatamente dois modos, e livre é o padrão', async ({ page }) => {
  await stub(page)
  await open(page)
  await expect(page.getByTestId('work-mode-organization')).toBeVisible()
  await expect(page.getByTestId('work-mode-coordinated')).toBeVisible()
  await expect(page.getByTestId('floor-work-section').getByRole('radio')).toHaveCount(2)
  await expect(page.getByTestId('work-mode-organization').getByRole('radio')).toBeChecked()
})

test('coordenar só oferece agentes deste andar', async ({ page }) => {
  await stub(page)
  await open(page)
  await page.getByTestId('work-mode-coordinated').click()
  const select = page.getByTestId('coordinator-select')
  await expect(select.locator('option')).toHaveCount(2) // placeholder + Gerente Ana
  await expect(select).toContainText('Gerente Ana')
  await expect(select).not.toContainText('De outro andar')
})

test('salvar manda apontar o agente e a instrução, e nada além disso', async ({ page }) => {
  await stub(page)
  await open(page)
  await page.getByTestId('work-mode-coordinated').click()
  await page.getByTestId('coordinator-select').selectOption(A1)
  await page.getByTestId('floor-instruction').fill('Priorize atrasos')
  await page.getByTestId('save-work-mode').click()

  await expect.poll(() => savedPatch?.workMode).toBe('coordinated')
  expect(savedPatch?.coordinatorAgentId).toBe(A1)
  expect(savedPatch?.instruction).toBe('Priorize atrasos')
  // O andar não recebe ferramentas, apps nem lista de permissão.
  for (const forbidden of ['tools', 'builtinTools', 'appGrants', 'callableAgentIds']) {
    expect(savedPatch?.[forbidden]).toBeUndefined()
  }
})

test('coordenar sem escolher agente é recusado pelo servidor e explicado', async ({ page }) => {
  await stub(page, { patchStatus: 400 })
  await open(page)
  await page.getByTestId('work-mode-coordinated').click()
  await page.getByTestId('save-work-mode').click()
  await expect(page.getByTestId('work-error')).toContainText('coordena')
})

test('o preview mostra quem recebe e quem é alcançado, de cima para baixo', async ({ page }) => {
  await stub(page, { floor: floorDoc({ workMode: 'coordinated', coordinatorAgentId: A1, instruction: 'Priorize atrasos' }), overview: READY_OVERVIEW })
  await open(page)
  await expect(page.getByTestId('coordinator-block')).toContainText('Gerente Ana')
  const targets = page.getByTestId('work-targets')
  await expect(targets).toContainText('Atendente')
  // O que não executa aparece marcado como indisponível, não escondido.
  await expect(targets).toContainText('indisponível')
  await expect(page.getByTestId('work-ready')).toContainText('recebe os pedidos deste andar')
})

test('coordenador removido deixa o andar não pronto, sem substituto automático', async ({ page }) => {
  await stub(page, {
    floor: floorDoc({ workMode: 'coordinated', coordinatorAgentId: A1 }),
    overview: {
      ...READY_OVERVIEW,
      coordinator: null,
      targets: [],
      ready: false,
      preview: null,
      issues: [{ code: 'no_coordinator', message: 'O andar está coordenado, mas o agente coordenador não existe mais.', severity: 'blocking' }],
    },
  })
  await open(page)
  await expect(page.getByTestId('work-issues')).toContainText('não existe mais')
  await expect(page.getByTestId('coordinator-block')).toHaveCount(0)
})

test('o andar mostra a MESMA análise do prédio, escopada nele', async ({ page }) => {
  await stub(page)
  await open(page)
  const analytics = page.getByTestId('execution-analytics')
  await expect(analytics).toContainText('Execuções deste andar')
  // Sem telemetria, a página diz isso em vez de mostrar zeros.
  await expect(page.getByTestId('analytics-telemetry')).toContainText('Ainda não há telemetria correlacionada')
  await expect(page.getByTestId('breakdown-empty')).toBeVisible()
})

test('o andar separa o que originou do que apenas participou', async ({ page }) => {
  await stub(page)
  await page.route('**/api/floors/*/executions/analytics**', (r) =>
    r.fulfill({
      json: {
        scope: 'floor', period: '30d', telemetrySince: '2026-01-01T00:00:00.000Z',
        executions: 2, succeeded: 2, failed: 0, canceled: 0, running: 0, successRate: 1,
        avgDurationMs: 5000, p95DurationMs: 9000, avgQueueMs: 500, activeTimeMs: 12000,
        totalTokens: 900, avgTokensPerExecution: 300, participations: 4, participatedExecutions: 3, partialTelemetry: 0,
      },
    }),
  )
  await open(page)
  const metrics = page.getByTestId('analytics-metrics')
  await expect(metrics).toContainText('Originadas aqui')
  await expect(metrics).toContainText('Participou de')
  await expect(metrics).toContainText('3')
})
