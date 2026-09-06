import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// RECURSOS: a tela que era um ESPELHO, e o endereço dela que continua chegando.
//
// Ela listava documentos, Apps, databases e ferramentas sem deixar fazer nada com eles —
// cada um já tem a sua tela, e é lá que se age. A pergunta que justificaria uma tela
// própria (quem alcança isto, quem usou de verdade, o que quebra se eu tirar) nunca foi
// desenhada, e uma lista que duplica quatro telas é um item de menu que promete mais do
// que entrega.
//
// O que estes casos protegem: o favorito antigo não morre, e chega no lugar CERTO — o
// tipo que a pessoa estava olhando decide o destino.
const NOW = new Date(0).toISOString()
const FLOOR_ID = '000000000000000000000f11'
const AGENT_ID = '000000000000000000000a11'

const MATRIZ = {
  items: [
    { kind: 'knowledge', resourceId: 'k1', name: 'Política de troca', allowed: true, capabilities: ['discover', 'retrieve'], origin: 'direct', reason: 'é a base própria dele', pending: null },
    { kind: 'tool', resourceId: 't1', name: 'consulta_cep', allowed: false, capabilities: ['discover'], origin: 'direct', reason: 'a ferramenta está desligada', pending: { code: 'tool_desligada', message: 'Ligue a ferramenta em Ferramentas para o agente poder usá-la.' } },
  ],
}

async function stub(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW } }))
  await page.route('**/api/floors**', (r) =>
    r.fulfill({
      json: [{ id: FLOOR_ID, buildingId: 'b1', name: 'Térreo', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', createdAt: NOW, updatedAt: NOW }],
    }),
  )
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [] }))
  await page.route(`**/api/agents/${AGENT_ID}/resource-access`, (r) => r.fulfill({ json: MATRIZ }))
}

test('ACEITAÇÃO: /resources não é mais uma tela — e o favorito antigo chega em algum lugar', async ({ page }) => {
  await stub(page)
  await page.goto('/resources')
  await expect(page).toHaveURL(/\/apps/)
  // A prateleira de Apps é o mais próximo de "o que este escritório tem".
  await expect(page.getByTestId('apps-filtros')).toBeVisible()
})

test('o TIPO que a pessoa estava olhando decide para onde ela vai', async ({ page }) => {
  await stub(page)

  await page.goto('/resources?kind=database')
  await expect(page).toHaveURL(/\/databases/)

  await page.goto('/resources?kind=tool')
  await expect(page).toHaveURL(/\/apps\?tab=custom/)

  // Conhecimento vive no ANDAR: o destino é o mapa do andar ativo.
  await page.goto('/resources?kind=knowledge')
  await expect(page).toHaveURL(new RegExp(`/floors/${FLOOR_ID}\\?view=knowledge`))
})

test('AMEAÇA: o menu não promete mais uma tela de Recursos', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  const nav = page.locator('nav').first()
  // O GRUPO fica — Apps, Databases e Históricos continuam nele. O que sai é o item que
  // levava ao espelho.
  await expect(nav).toContainText('RECURSOS')
  await expect(nav.getByRole('link', { name: 'Recursos', exact: true })).toHaveCount(0)
})

test('a navegação separa ESCRITÓRIO, RECURSOS e OPERAÇÕES — e não promete uma Comunidade', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  const nav = page.locator('nav').first()
  await expect(nav).toContainText('RECURSOS')
  await expect(nav).toContainText('OPERAÇÕES')
  // COMUNIDADE saiu do menu porque deixou de ser um lugar: o que vem de terceiro aparece
  // dentro de Apps e de Ferramentas. A regra é a mesma de sempre — nada de item que
  // promete o que não existe.
  await expect(nav).not.toContainText('COMUNIDADE')
  await expect(nav.getByRole('link', { name: 'Comunidade' })).toHaveCount(0)
})
