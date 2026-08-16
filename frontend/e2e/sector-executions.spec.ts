import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The sector's Execuções tab. What it must prove: a flow counts ONCE however many
// agents it touched, active time is labelled apart from the flow's duration, the
// timeline shows the real order without ever revealing what was said, and the
// playground is last and marked as a test.
const SECTOR_ID = '000000000000000000000c11'
const FLOOR_ID = '000000000000000000000f11'
const A1 = '000000000000000000000a11'
const A2 = '000000000000000000000a22'
const NOW = new Date(0).toISOString()

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = { id: FLOOR_ID, buildingId: 'b1', name: 'Térreo', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', createdAt: NOW, updatedAt: NOW }
const AGENTS = [
  { _id: A1, name: 'Anotador', objective: '', preset: 'operator', floorId: FLOOR_ID, tools: [], builtinTools: [], capabilities: [], activationModes: ['manual'] },
  { _id: A2, name: 'Cozinheiro', objective: '', preset: 'operator', floorId: FLOOR_ID, tools: [], builtinTools: [], capabilities: [], activationModes: ['manual'] },
]
const SECTOR = {
  _id: SECTOR_ID,
  floorId: FLOOR_ID,
  name: 'Cozinha',
  color: '#88a',
  mode: 'pipeline',
  // O segundo membro NÃO tem `transitions`: é um documento gravado antes do campo
  // existir, e a página tem que continuar de pé com ele.
  members: [{ agentId: A1, transitions: [] }, { agentId: A2 }],
  stages: [
    { id: 'e1', name: 'Anotar pedido', agentId: A1, instruction: '', dependsOn: [], retryPolicy: { maxAttempts: 1 }, onError: 'stop' },
    { id: 'e2', name: 'Preparar', agentId: A2, instruction: '', dependsOn: ['e1'], retryPolicy: { maxAttempts: 1 }, onError: 'stop' },
  ],
}

const SUMMARY = {
  period: '30d',
  telemetrySince: '2026-01-01T00:00:00.000Z',
  executions: 2,
  running: 0,
  succeeded: 1,
  failed: 1,
  canceled: 0,
  successRate: 0.5,
  totalTokens: 1500,
  avgTokensPerExecution: 750,
  avgDurationMs: 6000,
  activeTimeMs: 10_000,
  avgParticipants: 2,
  byParticipant: [
    { agentId: A1, role: 'pipeline_stage', stageId: 'e1', stageName: 'Anotar pedido', participations: 2, succeeded: 2, tokens: 800, activeTimeMs: 6000, avgDurationMs: 3000 },
    { agentId: A2, role: 'pipeline_stage', stageId: 'e2', stageName: 'Preparar', participations: 2, succeeded: 1, tokens: 700, activeTimeMs: 4000, avgDurationMs: 2000 },
  ],
}

const ROWS = [
  { id: 'x1', status: 'succeeded', source: 'delegation', environment: 'production', startedAt: '2026-01-02T10:00:00.000Z', finishedAt: '2026-01-02T10:00:06.000Z', durationMs: 6000, errorKind: null, tokens: 900, participants: 2 },
  { id: 'x2', status: 'failed', source: 'routine', environment: 'production', startedAt: '2026-01-01T10:00:00.000Z', finishedAt: '2026-01-01T10:00:04.000Z', durationMs: 4000, errorKind: 'stage_failed', tokens: 600, participants: 2 },
]

const TIMELINE = {
  execution: { ...ROWS[1], sectorName: 'Cozinha', sectorMode: 'pipeline' },
  steps: [
    { agentId: A1, role: 'pipeline_stage', stageId: 'e1', stageName: 'Anotar pedido', stageOrder: 1, status: 'succeeded', startedAt: '2026-01-01T10:00:00.000Z', finishedAt: '2026-01-01T10:00:02.000Z', durationMs: 2000, attempts: 1, tokens: 300, toolCalls: 1, errorKind: null },
    { agentId: A2, role: 'pipeline_stage', stageId: 'e2', stageName: 'Preparar', stageOrder: 2, status: 'failed', startedAt: '2026-01-01T10:00:02.000Z', finishedAt: '2026-01-01T10:00:04.000Z', durationMs: 2000, attempts: 2, tokens: 300, toolCalls: 0, errorKind: 'provider' },
  ],
}

let summaryUrls: string[] = []
let listUrls: string[] = []

async function stub(page: Page, opts: { summary?: unknown; rows?: unknown[]; fail?: boolean } = {}) {
  summaryUrls = []
  listUrls = []
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  await page.route('**/api/sectors/*/executions/summary**', (r) => {
    summaryUrls.push(r.request().url())
    return opts.fail ? r.fulfill({ status: 500, json: {} }) : r.fulfill({ json: opts.summary ?? SUMMARY })
  })
  // Registered AFTER the summary route so the more specific one still wins.
  await page.route('**/api/sectors/*/executions/x*', (r) => r.fulfill({ json: TIMELINE }))
  await page.route('**/api/sectors/*/executions?**', (r) => {
    listUrls.push(r.request().url())
    return opts.fail ? r.fulfill({ status: 500, json: {} }) : r.fulfill({ json: { items: opts.rows ?? ROWS, nextCursor: null } })
  })
  await page.route('**/api/sectors/*/overview', (r) =>
    r.fulfill({
      json: {
        sector: SECTOR,
        agents: AGENTS,
        readiness: { ready: true, issues: [] },
        knowledgeCount: 0,
        memberIssues: [],
      },
    }),
  )
  await page.route('**/api/sectors/*/documents**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors/*', (r) => r.fulfill({ json: SECTOR }))
  await page.route('**/api/sectors', (r) => r.fulfill({ json: [SECTOR] }))
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: AGENTS }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: AGENTS }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  await page.route('**/api/apps**', (r) => r.fulfill({ json: [] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
}

const open = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}/execucoes`)
  await expect(page.getByTestId('sector-executions')).toBeVisible()
}

// Os KPIs moram na Visão geral: é lá que se pergunta "isto está funcionando?".
const openOverview = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}/sectors/${SECTOR_ID}`)
  await expect(page.getByTestId('sector-performance')).toBeVisible()
}


test('as métricas do setor contam o fluxo uma vez e separam tempo ativo de duração', async ({ page }) => {
  await stub(page)
  await openOverview(page)
  const metrics = page.getByTestId('sector-metrics')
  await expect(metrics).toContainText('Execuções')
  await expect(metrics).toContainText('2')
  await expect(metrics).toContainText('Duração média')
  await expect(metrics).toContainText('6.0s')
  // Tempo somado dos agentes tem rótulo próprio e pode ser maior que o fluxo.
  await expect(metrics).toContainText('Tempo ativo somado')
  await expect(metrics).toContainText('10.0s')
  await expect(metrics).toContainText('50%')
})

test('a origem da telemetria é declarada, sem zeros históricos inventados', async ({ page }) => {
  await stub(page)
  await openOverview(page)
  await expect(page.getByTestId('telemetry-since')).toContainText('Telemetria disponível desde')
})

test('sem telemetria, a página diz isso em vez de mostrar zeros', async ({ page }) => {
  await stub(page, {
    summary: { ...SUMMARY, executions: 0, succeeded: 0, failed: 0, successRate: null, avgDurationMs: null, avgTokensPerExecution: null, avgParticipants: null, byParticipant: [], telemetrySince: null },
    rows: [],
  })
  await openOverview(page)
  await expect(page.getByTestId('telemetry-since')).toContainText('Ainda não há telemetria')
  await expect(page.getByTestId('sector-metrics')).toContainText('—')
  await open(page)
  await expect(page.getByTestId('history-empty')).toBeVisible()
})

test('o detalhamento por agente/etapa mostra participações sem inflar execuções', async ({ page }) => {
  await stub(page)
  await openOverview(page)
  const table = page.getByTestId('by-participant')
  await expect(table).toContainText('Anotador')
  await expect(table).toContainText('Anotar pedido')
  await expect(table).toContainText('Cozinheiro')
  // Duas participações de cada, com duas execuções no total.
  await expect(table.locator('tbody tr')).toHaveCount(2)
})

test('trocar o período do Desempenho refaz a consulta no backend', async ({ page }) => {
  await stub(page)
  await openOverview(page)
  await page.getByTestId('period-7d').click()
  await expect.poll(() => summaryUrls.some((u) => u.includes('period=7d'))).toBe(true)
})

test('o histórico tem o período dele, independente do Desempenho', async ({ page }) => {
  await stub(page)
  await open(page)
  await page.getByTestId('filter-period').selectOption('7d')
  await expect.poll(() => listUrls.some((u) => u.includes('period=7d'))).toBe(true)
})

test('o histórico vem do mais recente para o mais antigo', async ({ page }) => {
  await stub(page)
  await open(page)
  const rows = page.getByTestId('execution-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Concluída')
  await expect(rows.nth(1)).toContainText('Falhou')
})

test('filtrar por status e por agente vai para o servidor', async ({ page }) => {
  await stub(page)
  await open(page)
  await page.getByTestId('filter-status').selectOption('failed')
  await expect.poll(() => listUrls.some((u) => u.includes('status=failed'))).toBe(true)
  await page.getByTestId('filter-agent').selectOption(A2)
  await expect.poll(() => listUrls.some((u) => u.includes(`agentId=${A2}`))).toBe(true)
})

test('abrir uma execução mostra a timeline na ordem real, sem conteúdo', async ({ page }) => {
  await stub(page)
  await open(page)
  await page.getByTestId('execution-row').nth(1).getByRole('button').click()
  const timeline = page.getByTestId('execution-timeline')
  await expect(timeline).toContainText('1. Anotar pedido')
  await expect(timeline).toContainText('2. Preparar')
  await expect(timeline).toContainText('2 tentativas')
  // Onde parou, por categoria — nunca a mensagem do provedor.
  await expect(timeline).toContainText('Parou aqui: provider')
  await expect(timeline).not.toContainText('ECONNREFUSED')
})

test('a timeline liga cada etapa ao agente correspondente', async ({ page }) => {
  await stub(page)
  await open(page)
  await page.getByTestId('execution-row').nth(0).getByRole('button').click()
  await page.getByTestId('execution-timeline').getByRole('link', { name: 'Anotador' }).click()
  await expect(page).toHaveURL(new RegExp(`/floors/${FLOOR_ID}/agents/${A1}`))
})

test('o teste fica no fim e diz que não entra no que é medido', async ({ page }) => {
  await stub(page)
  await open(page)
  await expect(page.getByTestId('playground-note')).toContainText('fica fora do Desempenho e do histórico')
  const [historyBox, noteBox] = await Promise.all([
    page.getByTestId('execution-history').boundingBox(),
    page.getByTestId('playground-note').boundingBox(),
  ])
  expect(noteBox!.y).toBeGreaterThan(historyBox!.y)
})

test('um erro de carga oferece tentar de novo em vez de tela quebrada', async ({ page }) => {
  await stub(page, { fail: true })
  await open(page)
  await expect(page.getByTestId('executions-retry')).toBeVisible()
})
