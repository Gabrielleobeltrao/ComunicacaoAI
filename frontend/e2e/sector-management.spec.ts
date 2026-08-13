import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Accessible sector management E2E (plan §17.3). Runs ONLY against a dev stack
// (frontend :5173 + backend :4000) with a QA account holding >= 2 floors, and is
// skipped otherwise so the default suite stays green without that infra. Every
// test seeds its own throwaway sector via the API and deletes it, so it never
// touches real data.
//   E2E_SECTORS=1 E2E_EMAIL=... E2E_PASSWORD=... npx playwright test sector-management
const EMAIL = process.env.E2E_EMAIL || 'qa-nav@local.test'
const PASSWORD = process.env.E2E_PASSWORD || 'qa-test-pass-123'

test.skip(!process.env.E2E_SECTORS, 'set E2E_SECTORS=1 against a dev stack with two seeded floors')

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  await page.fill('input[type="password"], input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(floors|dashboard)/, { timeout: 15_000 }).catch(() => {})
}

// Same-origin API through the logged-in page (cookies included).
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

async function twoFloors(page: Page) {
  const { body: floors } = await api<Array<{ id: string; name: string }>>(page, '/api/floors')
  const a = floors[0]
  const b = floors.find((f) => f.id !== a.id)
  expect(b, 'needs at least two floors').toBeTruthy()
  return { a, b: b! }
}

async function seedSector(page: Page, floorId: string, name = 'ZZ E2E Sector') {
  const { body } = await api<{ _id: string }>(page, '/api/sectors', { method: 'POST', body: JSON.stringify({ name, floorId, mode: 'adaptive', members: [] }) })
  return body._id
}
async function removeSector(page: Page, id: string) {
  await api(page, `/api/sectors/${id}`, { method: 'DELETE' })
}

test('the move wizard moves a sector to another floor and lands on it', async ({ page }) => {
  await login(page)
  const { a, b } = await twoFloors(page)
  const id = await seedSector(page, a.id)
  try {
    await page.goto(`/floors/${a.id}/sectors/${id}/configuracao`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Mover de andar/i }).first().click()
    await expect(page.getByText('Passo 1 de 3')).toBeVisible()

    await page.getByLabel('Andar de destino').selectOption(b.id)
    await page.getByRole('button', { name: /Avançar/i }).click()
    await expect(page.getByText('Passo 2 de 3')).toBeVisible()
    // The preflight names both floors.
    await expect(page.getByText(new RegExp(`de\\s+${a.name}\\s+para\\s+${b.name}`))).toBeVisible()

    // Staff from the target floor via the keyboard (a11y: the checkbox is a real input).
    const firstBox = page.locator('input[type="checkbox"]').first()
    if (await firstBox.count()) {
      await firstBox.focus()
      await page.keyboard.press('Space')
    }
    await page.getByRole('button', { name: /Avançar/i }).click()
    await expect(page.getByText('Passo 3 de 3')).toBeVisible()

    await page.getByRole('button', { name: /Mover setor/i }).click()
    // Lands on the sector on its NEW floor.
    await expect(page).toHaveURL(new RegExp(`/floors/${b.id}/sectors/${id}`), { timeout: 10_000 })
  } finally {
    await removeSector(page, id)
  }
})

test('the backend rejects a cross-floor member on move (409 CROSS_FLOOR_ASSIGNMENT)', async ({ page }) => {
  await login(page)
  const { a, b } = await twoFloors(page)
  const id = await seedSector(page, a.id)
  try {
    const { body: agentsA } = await api<Array<{ _id: string }>>(page, `/api/agents?floorId=${a.id}`)
    test.skip(agentsA.length === 0, 'needs an agent on the source floor')
    // Try to move to floor B but staff it with a floor-A agent — must be refused.
    const res = await api<{ code?: string }>(page, `/api/sectors/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ targetFloorId: b.id, members: [{ agentId: agentsA[0]._id, routingDescription: '', isDefault: true }] }),
    })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('CROSS_FLOOR_ASSIGNMENT')
  } finally {
    await removeSector(page, id)
  }
})

test('manage-agents opens from the hero and offers this-floor candidates', async ({ page }) => {
  await login(page)
  const { a } = await twoFloors(page)
  const id = await seedSector(page, a.id)
  try {
    await page.goto(`/floors/${a.id}/sectors/${id}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Gerenciar agentes/i }).first().click()
    const dialog = page.getByRole('dialog', { name: /Gerenciar agentes/i })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/No setor/i)).toBeVisible()
    await expect(dialog.getByText(/Adicionar deste andar/i)).toBeVisible()
  } finally {
    await removeSector(page, id)
  }
})

test('no horizontal overflow at 320px on the sector page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await login(page)
  const { a } = await twoFloors(page)
  const id = await seedSector(page, a.id)
  try {
    await page.goto(`/floors/${a.id}/sectors/${id}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow).toBe(false)
  } finally {
    await removeSector(page, id)
  }
})
