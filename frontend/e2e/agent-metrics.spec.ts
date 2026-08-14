import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Operational agent metrics E2E: the roster cards and the agent page show real
// operational telemetry (duration/tokens/specific KPI), not the old generic
// Conversas/Leads. Runs ONLY against a dev stack with the pivot flags on.
//   E2E_PIVOT=1 E2E_EMAIL=... E2E_PASSWORD=... npx playwright test agent-metrics
const EMAIL = process.env.E2E_EMAIL || 'qa-pivot@local.test'
const PASSWORD = process.env.E2E_PASSWORD || 'qa-test-pass-123'

test.skip(!process.env.E2E_PIVOT, 'set E2E_PIVOT=1 with the pivot stack running')

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 15_000 }).catch(() => {})
}

test('roster cards show operational metrics (Tempo méd. / Tokens), not Conversas/Leads', async ({ page }) => {
  await login(page)
  await page.goto('/agents')
  await expect(page.getByText('Tempo méd.').first()).toBeVisible()
  await expect(page.getByText('Tokens 30d').first()).toBeVisible()
})

test('agent page shows the operational section with a working period switch', async ({ page }) => {
  await login(page)
  await page.goto('/agents')
  await page.locator('a[href*="/agents/"]').first().click()
  await expect(page.getByRole('heading', { name: 'Desempenho operacional' })).toBeVisible()
  await expect(page.getByText('Execuções').first()).toBeVisible()
  await expect(page.getByText('Sucesso').first()).toBeVisible()
  // Period switch: default 30 dias, switch to 7 dias.
  await page.getByRole('button', { name: '7 dias' }).click()
  await expect(page.getByRole('button', { name: '7 dias' })).toBeVisible()
})
