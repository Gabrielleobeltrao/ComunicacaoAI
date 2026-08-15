import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// "Logs e auditoria" end to end, with the API stubbed. What it must prove: the two
// timelines exist and page by cursor, the filters really travel to the API, a run's
// detail explains the execution WITHOUT showing content, and a change reads as a
// sentence with a way back to the thing that changed.
const FLOOR_ID = '000000000000000000000f11'
const AGENT_ID = '000000000000000000000a11'
const NOW = new Date(0).toISOString()

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = { id: FLOOR_ID, buildingId: 'b1', name: 'Térreo', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', createdAt: NOW, updatedAt: NOW }

const RUN = {
  id: 'run-1',
  automationId: 'aut-1',
  name: 'Resumo diário',
  status: 'succeeded',
  triggerType: 'schedule',
  agent: { id: AGENT_ID, name: 'Ana', objective: 'Atender' },
  place: { floorId: FLOOR_ID, floorName: 'Térreo', sectorId: 's1', sectorName: 'Atendimento' },
  queuedAt: new Date(Date.now() - 3600_000).toISOString(),
  startedAt: new Date(Date.now() - 3599_000).toISOString(),
  finishedAt: new Date(Date.now() - 3596_000).toISOString(),
  durationMs: 3000,
  tokens: 200,
  errorKind: null,
  steps: 2,
  deliveries: 1,
  artifacts: 1,
}

const RUN_DETAIL = {
  id: 'run-1',
  automationId: 'aut-1',
  automationVersion: 3,
  status: 'succeeded',
  triggerType: 'schedule',
  queuedAt: RUN.queuedAt,
  startedAt: RUN.startedAt,
  finishedAt: RUN.finishedAt,
  durationMs: 3000,
  requestId: 'schedule:aut-1:1755259200000',
  usage: { inputTokens: 120, outputTokens: 80 },
  error: null,
  steps: [
    { id: 's1', stepId: 'run', stepType: 'agent.execute', attempt: 1, status: 'succeeded', startedAt: RUN.startedAt, finishedAt: RUN.finishedAt, error: null },
    { id: 's2', stepId: 'deliver', stepType: 'delivery.send', attempt: 1, status: 'succeeded', startedAt: RUN.startedAt, finishedAt: RUN.finishedAt, error: null },
  ],
  deliveries: [{ id: 'd1', provider: 'email', destinationMasked: 'jo***@exemplo.com', status: 'sent', attempt: 1, createdAt: RUN.finishedAt, sentAt: RUN.finishedAt, error: null }],
  artifacts: [{ id: 'a1', name: 'resultado', kind: 'markdown', mimeType: 'text/markdown', sizeBytes: 4210, createdAt: RUN.finishedAt }],
}

const AUDIT = {
  id: 'aud-1',
  actorType: 'user',
  actorId: 'u1',
  action: 'pause',
  entityType: 'routine',
  entityId: 'rot-1',
  entityLabel: 'Resumo diário',
  floorId: FLOOR_ID,
  result: 'success',
  occurredAt: new Date(Date.now() - 600_000).toISOString(),
  requestId: 'abcdef12-3456-7890-abcd-ef1234567890',
  metadata: { status: 'paused', method: 'POST', statusCode: 200 },
}

let lastRunsUrl: string | null = null
let lastAuditUrl: string | null = null

async function stub(page: Page, opts: { runs?: unknown[]; audit?: unknown[]; fail?: boolean; more?: boolean } = {}) {
  lastRunsUrl = null
  lastAuditUrl = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))

  await page.route('**/api/logs/runs/*', (r) => r.fulfill({ json: RUN_DETAIL }))
  await page.route('**/api/logs/runs?**', (r) => {
    lastRunsUrl = r.request().url()
    if (opts.fail) return r.fulfill({ status: 500, json: {} })
    const cursor = new URL(r.request().url()).searchParams.get('cursor')
    const items = opts.runs ?? [cursor ? { ...RUN, id: 'run-2', name: 'Segunda página' } : RUN]
    return r.fulfill({ json: { items, nextCursor: opts.more && !cursor ? 'c1' : null } })
  })
  await page.route('**/api/logs/audit?**', (r) => {
    lastAuditUrl = r.request().url()
    if (opts.fail) return r.fulfill({ status: 500, json: {} })
    return r.fulfill({ json: { items: opts.audit ?? [AUDIT], nextCursor: null } })
  })
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: [{ _id: AGENT_ID, name: 'Ana', floorId: FLOOR_ID }] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [{ _id: 's1', name: 'Atendimento', floorId: FLOOR_ID, members: [{ agentId: AGENT_ID }] }] }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) => r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }))
}

test('the executions timeline shows what happened, with no content', async ({ page }) => {
  await stub(page)
  await page.goto('/settings/logs')
  const row = page.getByTestId('run-log-row').first()
  await expect(row).toContainText('Resumo diário')
  await expect(row).toContainText('Concluída')
  await expect(row).toContainText('Agendada')
  await expect(row).toContainText('Ana')
  await expect(row).toContainText('2 etapa(s)')
  await expect(row).toContainText('1 entrega(s)')
  await expect(row).toContainText('200 tokens')
  await expect(row).toContainText('3,0 s')
})

test('a run opens a detail that explains it without revealing it', async ({ page }) => {
  await stub(page)
  await page.goto('/settings/logs')
  await page.getByTestId('open-run-detail').first().click()

  const detail = page.getByTestId('run-detail')
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('agent.execute')
  await expect(detail).toContainText('delivery.send')
  await expect(detail).toContainText('jo***@exemplo.com')
  await expect(detail).toContainText('4210 bytes')
  await expect(detail).toContainText('versão 3')
  // Metadata of the artifact, never its content.
  await expect(detail).toContainText('o conteúdo do arquivo não faz parte da auditoria')
})

test('the changes timeline reads as a sentence and links back', async ({ page }) => {
  await stub(page)
  await page.goto('/settings/logs')
  await page.getByTestId('log-tab-audit').click()
  const row = page.getByTestId('audit-log-row').first()
  // Named, not just typed: "a rotina Resumo diário", never "rotina".
  await expect(row).toContainText('Você pausou a rotina Resumo diário')
  await expect(row).toContainText('status: paused')
  await expect(row).toContainText('requisição abcdef12')
  await expect(row.getByTestId('audit-link')).toBeVisible()
})

test('the filters travel to the API, per tab', async ({ page }) => {
  await stub(page)
  await page.goto('/settings/logs')
  await page.getByTestId('log-from').fill('2026-08-01')
  await page.getByTestId('log-origin').selectOption('webhook')
  await expect.poll(() => lastRunsUrl).toContain('triggerType=webhook')
  expect(lastRunsUrl).toContain('from=')

  await page.getByTestId('log-tab-audit').click()
  await page.getByTestId('log-action').selectOption('delete')
  await page.getByTestId('log-entity').selectOption('agent')
  await expect.poll(() => lastAuditUrl).toContain('entityType=agent')
  expect(lastAuditUrl).toContain('action=delete')
})

test('clearing the filters asks again without them', async ({ page }) => {
  await stub(page)
  await page.goto('/settings/logs')
  await page.getByTestId('log-origin').selectOption('manual')
  await expect.poll(() => lastRunsUrl).toContain('triggerType=manual')
  await page.getByTestId('clear-log-filters').click()
  await expect.poll(() => lastRunsUrl).not.toContain('triggerType')
})

test('the cursor loads the next page instead of repeating the first', async ({ page }) => {
  await stub(page, { more: true })
  await page.goto('/settings/logs')
  await expect(page.getByTestId('run-log-row')).toHaveCount(1)
  await page.getByTestId('load-more-logs').click()
  await expect(page.getByTestId('run-log-row')).toHaveCount(2)
  await expect(page.getByTestId('logs-list')).toContainText('Segunda página')
  expect(lastRunsUrl).toContain('cursor=c1')
})

test('empty and error states are honest and recoverable', async ({ page }) => {
  await stub(page, { runs: [], audit: [] })
  await page.goto('/settings/logs')
  await expect(page.getByTestId('logs-empty')).toContainText('Nenhuma execução no período')
  await page.getByTestId('log-tab-audit').click()
  await expect(page.getByTestId('logs-empty')).toContainText('Nenhuma alteração no período')

  await stub(page, { fail: true })
  await page.reload()
  await expect(page.getByTestId('logs-error')).toBeVisible()
  await stub(page)
  await page.getByTestId('logs-error').getByRole('button', { name: 'Tentar de novo' }).click()
  await expect(page.getByTestId('logs-list')).toBeVisible()
})

test('Configurações leads to the logs, and the logs back to the Central', async ({ page }) => {
  await stub(page)
  await page.route('**/api/dashboard**', (r) => r.fulfill({ json: {} }))
  await page.goto('/settings')
  await page.getByTestId('settings-logs-link').click()
  await expect(page).toHaveURL(/\/settings\/logs$/)
  await page.getByRole('link', { name: 'Central de execuções' }).click()
  await expect(page).toHaveURL(/\/executions$/)
})

test('the log works on a phone without overflowing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stub(page)
  await page.goto('/settings/logs')
  await expect(page.getByTestId('run-log-row').first()).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('the execution detail shows the correlation of the run', async ({ page }) => {
  await stub(page)
  await page.goto('/settings/logs')
  await page.getByTestId('open-run-detail').first().click()
  await expect(page.getByTestId('run-detail-request')).toContainText('schedule:aut-1')
})

test('executions can be filtered by sector, combined with the rest', async ({ page }) => {
  await stub(page)
  await page.goto('/settings/logs')
  await page.getByTestId('log-sector').selectOption('s1')
  await expect.poll(() => lastRunsUrl).toContain('sectorId=s1')

  await page.getByTestId('log-origin').selectOption('schedule')
  await expect.poll(() => lastRunsUrl).toContain('triggerType=schedule')
  expect(lastRunsUrl).toContain('sectorId=s1')
})

test('changes can be filtered by who did it and searched by entity', async ({ page }) => {
  await stub(page)
  await page.goto('/settings/logs')
  await page.getByTestId('log-tab-audit').click()

  await page.getByTestId('log-actor').selectOption('user')
  await expect.poll(() => lastAuditUrl).toContain('actorType=user')

  await page.getByTestId('log-search').fill('Pesquisador')
  await expect.poll(() => lastAuditUrl).toContain('q=Pesquisador')
  // Combined, not replaced.
  expect(lastAuditUrl).toContain('actorType=user')
})

test('clearing the filters drops the new ones too', async ({ page }) => {
  await stub(page)
  await page.goto('/settings/logs')
  await page.getByTestId('log-sector').selectOption('s1')
  await expect.poll(() => lastRunsUrl).toContain('sectorId=s1')
  await page.getByTestId('clear-log-filters').click()
  await expect.poll(() => lastRunsUrl).not.toContain('sectorId')
})
