import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Automation-pivot E2E (plan §21.4). Runs ONLY against a dev stack with the pivot
// flags ON (VITE_AI_BUILDING_ENABLED / VITE_AI_AUTOMATIONS_ENABLED=true) and
// Mongo + Redis + worker up (compose.dev.yml). Skipped otherwise, so the normal
// suite stays green without that infra.
//   E2E_PIVOT=1 E2E_EMAIL=... E2E_PASSWORD=... npx playwright test automation-pivot
const EMAIL = process.env.E2E_EMAIL || 'qa-pivot@local.test'
const PASSWORD = process.env.E2E_PASSWORD || 'qa-test-pass-123'

test.skip(!process.env.E2E_PIVOT, 'set E2E_PIVOT=1 with the pivot flags on and the worker running')

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 15_000 }).catch(() => {})
}

test('building overview lists a floor for a legacy account', async ({ page }) => {
  await login(page)
  await page.goto('/building')
  await expect(page.getByText('Andar')).toBeVisible()
})

test('create → edit → run an automation, then see the run', async ({ page }) => {
  await login(page)
  await page.goto('/automations')
  await page.fill('input[placeholder="Nome da nova automação"]', 'E2E Resumo')
  await page.getByRole('button', { name: 'Criar' }).click()
  await page.getByText('E2E Resumo').click()

  // Add a transform step with a static template so the run needs no external IO.
  await page.getByRole('button', { name: '+ transform.template' }).click()
  await page.locator('input').last().fill('Olá do E2E')
  await page.getByRole('button', { name: 'Salvar rascunho' }).click()
  await page.getByRole('button', { name: 'Executar agora' }).click()

  await page.waitForURL('**/runs**', { timeout: 15_000 })
  await expect(page.getByText(/queued|running|succeeded|failed/).first()).toBeVisible({ timeout: 15_000 })
})
