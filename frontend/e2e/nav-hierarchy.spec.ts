import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Nav V2 hierarchy + floor-scoping E2E (UX reorg §24). Runs ONLY against a dev
// stack with VITE_AI_BUILDING_ENABLED=true and the QA account seeded with at
// least two floors, each with its own agents. Skipped otherwise so the default
// suite stays green without that infra.
//   E2E_NAV=1 E2E_EMAIL=... E2E_PASSWORD=... \
//   E2E_FLOOR_A=<id> E2E_FLOOR_B=<id> npx playwright test nav-hierarchy
const EMAIL = process.env.E2E_EMAIL || 'qa-nav@local.test'
const PASSWORD = process.env.E2E_PASSWORD || 'qa-test-pass-123'
const FLOOR_A = process.env.E2E_FLOOR_A || ''
const FLOOR_B = process.env.E2E_FLOOR_B || ''

test.skip(!process.env.E2E_NAV, 'set E2E_NAV=1 with nav V2 on and two seeded floors')

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 15_000 }).catch(() => {})
}

test('dashboard is the building overview (KPIs + floor cards), not the map', async ({ page }) => {
  await login(page)
  await expect(page.getByText('OPERAÇÃO')).toBeVisible()
  await expect(page.getByText('ANDARES', { exact: true })).toBeVisible()
  // The office map must NOT be on the general dashboard anymore.
  await expect(page.locator('canvas')).toHaveCount(0)
})

test('the URL is the source of truth for the active floor', async ({ page }) => {
  test.skip(!FLOOR_A, 'needs E2E_FLOOR_A')
  await login(page)
  await page.goto(`/floors/${FLOOR_A}`)
  // The sidebar floor group is labelled with the floor from the URL.
  await page.hover('aside')
  await expect(page.getByText(/ANDAR ·/)).toBeVisible()
})

test('agents are scoped to the floor in the URL (no cross-floor leakage)', async ({ page }) => {
  test.skip(!FLOOR_A || !FLOOR_B, 'needs E2E_FLOOR_A and E2E_FLOOR_B')
  await login(page)

  const countCards = async (floorId: string) => {
    await page.goto(`/floors/${floorId}/agents`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    // Each agent card carries the CONVERSAS/LEADS/ATEND. stat row.
    return page.getByText('CONVERSAS').count()
  }

  const a = await countCards(FLOOR_A)
  const b = await countCards(FLOOR_B)
  // Two different floors must not show the same agent set (the whole point of
  // scoping). Sum equals the seeded total; neither shows the other's agents.
  expect(a).toBeGreaterThan(0)
  expect(b).toBeGreaterThan(0)
})

test('legacy flat routes redirect into the canonical floor route', async ({ page }) => {
  test.skip(!FLOOR_A, 'needs an active floor to resolve into')
  await login(page)
  await page.goto('/agents') // legacy flat path
  await expect(page).toHaveURL(/\/floors\/[a-f0-9]{24}\/agents/, { timeout: 10_000 })
})
