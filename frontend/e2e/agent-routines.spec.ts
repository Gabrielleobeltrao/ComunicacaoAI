import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Agent-as-primary-unit E2E: "Automação" is retired as a surface — scheduled work
// lives inside an agent as a Rotina. Runs ONLY against a dev stack with the pivot
// flags ON (VITE_AI_BUILDING_ENABLED / VITE_AI_AUTOMATIONS_ENABLED=true) and
// Mongo + Redis + worker up (compose.dev.yml). Skipped otherwise, so the normal
// suite stays green without that infra.
//   E2E_PIVOT=1 E2E_EMAIL=... E2E_PASSWORD=... npx playwright test agent-routines
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

test('Automação is not a nav surface and /automations redirects to agents', async ({ page }) => {
  await login(page)
  // No Automações / Execuções entries anywhere in the nav.
  await expect(page.getByRole('link', { name: /Automaç|Execuç/i })).toHaveCount(0)
  // Legacy routes keep working — they land on agents, never a standalone page.
  await page.goto('/automations')
  await expect(page).toHaveURL(/\/agents$|\/floors\/.+\/agents$/)
  await page.goto('/runs')
  await expect(page).toHaveURL(/\/agents$|\/floors\/.+\/agents$/)
})

test('hire an agent, then create a routine inside it', async ({ page }) => {
  await login(page)
  await page.goto('/agents')

  // Hire via the 8-step wizard: pick a preset, keep the generated name, finish.
  await page.getByRole('button', { name: 'Contratar agente' }).first().click()
  await page.getByText('Pesquisador').click()
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Próximo' }).click()
  await page.getByRole('button', { name: 'Contratar agente' }).last().click()

  // Open the newly hired agent and go to its Rotinas area.
  await page.locator('a[href*="/agents/"]').first().click()
  await page.getByRole('button', { name: 'Rotinas' }).click()
  await page.getByRole('button', { name: 'Nova rotina' }).click()
  await page.getByPlaceholder(/consolidar as notícias/i).fill('Resumir as notícias de ontem')
  await page.getByRole('button', { name: 'Criar rotina' }).click()

  // The routine now shows with a friendly schedule label.
  await expect(page.getByText(/Todo dia às/i).first()).toBeVisible({ timeout: 10_000 })
})
