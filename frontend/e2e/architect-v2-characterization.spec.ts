import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// LACUNA 12 — "Montar operação" só existe dentro do seletor de andares.
//
// Caracterização antes da correção. O que este arquivo trava é o estado de HOJE: não há
// chat global, não há botão flutuante em rota nenhuma, e o único caminho para o Arquiteto
// está escondido atrás de um menu que a pessoa precisa saber abrir.
const NOW = new Date(0).toISOString()

async function stub(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) =>
    r.fulfill({ json: { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW } }),
  )
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/floors**', (r) =>
    r.fulfill({ json: [{ id: 'f1', name: 'Atendimento', status: 'active', buildingId: 'b1', workMode: 'organization', createdAt: NOW, updatedAt: NOW }] }),
  )
}

test('LACUNA 12: não existe chat global do Arquiteto em nenhuma rota', async ({ page }) => {
  await stub(page)
  for (const rota of ['/', '/monitoring', '/agents']) {
    await page.goto(rota)
    await expect(page.getByTestId('architect-launcher')).toHaveCount(0)
    await expect(page.getByTestId('architect-panel')).toHaveCount(0)
  }
})

test('LACUNA 12: o único acesso ao Arquiteto está dentro do seletor de andares', async ({ page }) => {
  await stub(page)
  await page.goto('/')
  // Fechado, ele não existe na página.
  await expect(page.getByTestId('open-architect')).toHaveCount(0)
})
