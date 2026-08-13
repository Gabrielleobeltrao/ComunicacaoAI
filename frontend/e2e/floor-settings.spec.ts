import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Floor settings E2E (settings dialog + delete guard). Runs ONLY against a dev
// stack with a QA account holding >= 1 non-empty floor, and is skipped otherwise
// so the default suite stays green. It creates and deletes a throwaway floor and
// never mutates existing floors.
//   E2E_SECTORS=1 E2E_EMAIL=... E2E_PASSWORD=... npx playwright test floor-settings
const EMAIL = process.env.E2E_EMAIL || 'qa-nav@local.test'
const PASSWORD = process.env.E2E_PASSWORD || 'qa-test-pass-123'

test.skip(!process.env.E2E_SECTORS, 'set E2E_SECTORS=1 against a dev stack')

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(floors|dashboard)/, { timeout: 15_000 }).catch(() => {})
}

async function api<T>(page: Page, path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ([p, i]) => {
      const r = await fetch(p as string, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...(i as RequestInit) })
      const body = await r.json().catch(() => ({}))
      return { status: r.status, body }
    },
    [path, init] as const,
  )
}

test('a non-empty floor cannot be deleted (409 FLOOR_NOT_EMPTY)', async ({ page }) => {
  await login(page)
  const { body: floors } = await api<Array<{ id: string }>>(page, '/api/floors')
  // The QA account's first floor holds agents/sectors.
  const res = await api<{ code?: string }>(page, `/api/floors/${floors[0].id}`, { method: 'DELETE' })
  expect(res.status).toBe(409)
  expect(res.body.code).toBe('FLOOR_NOT_EMPTY')
})

test('an empty floor can be created and deleted', async ({ page }) => {
  await login(page)
  const { body: created } = await api<{ id: string }>(page, '/api/floors', { method: 'POST', body: JSON.stringify({ name: 'ZZ E2E Empty Floor' }) })
  const del = await api(page, `/api/floors/${created.id}`, { method: 'DELETE' })
  expect(del.status).toBe(204)
})

test('the floor settings dialog opens from the header and can be closed', async ({ page }) => {
  await login(page)
  const { body: floors } = await api<Array<{ id: string }>>(page, '/api/floors')
  await page.goto(`/floors/${floors[0].id}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Configurações do andar', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /Configurações do andar/i })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Zona de perigo')).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Excluir andar/i })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})
