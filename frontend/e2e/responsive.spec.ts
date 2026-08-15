import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Responsive E2E: horizontal-overflow guard across viewports, the mobile
// navigation flow, and the office-map touch controls. Requires the app running
// locally with a QA account (see playwright.config.ts).
const EMAIL = process.env.E2E_EMAIL || 'qa-responsive@local.test'
const PASSWORD = process.env.E2E_PASSWORD || 'qa-test-pass-123'

const PHONE = { width: 390, height: 844 }
const VIEWPORTS = [
  { w: 320, h: 568 },
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1440, h: 900 },
]
const PUBLIC_ROUTES = ['/', '/login', '/register']
const PROTECTED_ROUTES = ['/dashboard', '/agents', '/setores', '/widgets', '/chats', '/settings']

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard', { timeout: 15_000 }).catch(() => {})
  await page.waitForLoadState('networkidle')
}

async function noHorizontalOverflow(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(sw, `horizontal overflow on ${route}`).toBeLessThanOrEqual(cw + 1)
}

test.describe('no accidental horizontal overflow', () => {
  for (const vp of VIEWPORTS) {
    test(`public routes @ ${vp.w}x${vp.h}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h })
      for (const r of PUBLIC_ROUTES) await noHorizontalOverflow(page, r)
    })
    test(`protected routes @ ${vp.w}x${vp.h}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h })
      await login(page)
      for (const r of PROTECTED_ROUTES) await noHorizontalOverflow(page, r)
    })
  }
})

test('mobile navigation opens, navigates and closes', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await login(page)
  await page.goto('/dashboard', { waitUntil: 'networkidle' })
  // On a phone the navigation lives in the drawer behind the topbar hamburger
  // (there is no separate bottom bar — the drawer IS the mobile navigation).
  const opener = page.locator('button[aria-label="Abrir menu"]')
  await expect(opener).toBeVisible()
  await opener.click()
  const drawer = page.locator('#mobile-drawer')
  await expect(drawer).toBeVisible()
  // Navigate to Agentes from the drawer; it should close and the route change.
  await drawer.getByRole('link', { name: 'Agentes' }).click()
  await page.waitForURL('**/agents')
  await expect(drawer).toHaveCount(0)
  // Re-opening it marks the active route.
  await opener.click()
  await expect(page.locator('#mobile-drawer').getByRole('link', { name: 'Agentes' })).toHaveAttribute('aria-current', 'page')
})

test('office map controls meet the touch-target minimum on touch devices', async ({ browser }) => {
  // A real touch (coarse-pointer) context so the 44px hit-target rule applies.
  const ctx = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await login(page)
  await page.goto('/dashboard', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const fit = page.getByRole('button', { name: 'Ajustar à tela' })
  if (await fit.count()) {
    const box = await fit.first().boundingBox()
    expect(box, 'fit control has a box').not.toBeNull()
    if (box) {
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.width).toBeGreaterThanOrEqual(44)
    }
  }
  await ctx.close()
})
