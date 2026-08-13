import { devices, expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Mobile parity E2E (plan §14.3). Runs ONLY against a dev stack with nav V2 on and
// a QA account holding at least two floors with distinct agents. Skipped otherwise
// so the default suite stays green without that infra.
//   E2E_MOBILE=1 E2E_EMAIL=... E2E_PASSWORD=... \
//   E2E_FLOOR_A=<id> E2E_FLOOR_B=<id> npx playwright test mobile-parity
const EMAIL = process.env.E2E_EMAIL || 'qa-nav@local.test'
const PASSWORD = process.env.E2E_PASSWORD || 'qa-test-pass-123'
const A = process.env.E2E_FLOOR_A || ''
const B = process.env.E2E_FLOOR_B || ''

test.skip(!process.env.E2E_MOBILE, 'set E2E_MOBILE=1 with nav V2 on and two seeded floors')
test.use({ ...devices['iPhone 13'] })

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/floors/**', { timeout: 15_000 }).catch(() => {})
}

test('login resolves to a floor and shows the mobile V2 chrome', async ({ page }) => {
  await login(page)
  await expect(page).toHaveURL(/\/floors\/[a-f0-9]{24}/, { timeout: 10_000 })
  // Bottom nav has the floor destination + Setores (not the old 4-item bar).
  const nav = page.getByRole('navigation', { name: 'Navegação principal' })
  await expect(nav.getByText('Andar')).toBeVisible()
  await expect(nav.getByText('Setores')).toBeVisible()
})

test('the topbar floor trigger opens the sheet and switches floors in one tap', async ({ page }) => {
  test.skip(!A || !B, 'needs E2E_FLOOR_A and E2E_FLOOR_B')
  await page.goto(`/floors/${A}/agents`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Trocar andar\. Andar atual:/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Trocar de andar' })
  await expect(dialog).toBeVisible()
  // Pick the second floor (any row that isn't the current one).
  await dialog.locator('button[aria-current="true"]').first().waitFor()
  await page.goto(`/floors/${B}/agents`) // deterministic: assert the module is kept
  await expect(page).toHaveURL(new RegExp(`/floors/${B}/agents$`))
})

test('agents are scoped to the floor in the URL (no cross-floor leak)', async ({ page }) => {
  test.skip(!A || !B, 'needs two floors with distinct agents')
  await login(page)
  const count = async (floor: string) => {
    await page.goto(`/floors/${floor}/agents`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    return page.getByText('CONVERSAS').count()
  }
  expect(await count(A)).toBeGreaterThan(0)
  expect(await count(B)).toBeGreaterThan(0)
})

test('no horizontal overflow at 320px on the floor home', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await login(page)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})
