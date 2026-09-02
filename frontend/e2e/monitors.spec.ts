import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// MONITORES na tela: salvar guarda rascunho, publicar é outro botão.
//
// O que estes casos protegem: a condição é montada de listas fechadas (nada de campo
// livre para o que dispara ação sozinho), a distinção entre rascunho e plantão aparece na
// tela, e a recusa do backend é MOSTRADA em vez de virar um estado silencioso.
const NOW = new Date(0).toISOString()
const ID = '000000000000000000000m01'

const META = {
  eventTypes: ['market.candle.closed', 'market.signal.detected'],
  triggerModes: ['level', 'enter', 'exit', 'cross_up', 'cross_down', 'change'],
  operators: ['gt', 'gte', 'lt', 'lte', 'eq', 'ne'],
}

const LISTA = [
  {
    id: ID,
    name: 'RSI sobrevendido',
    status: 'draft',
    source: { kind: 'internal_event', eventType: 'market.candle.closed' },
    condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
    conditionText: 'rsi abaixo de 30',
    triggerMode: 'enter',
    threshold: null,
    thresholdField: null,
    debounceMs: 0,
    cooldownMs: 0,
    flowId: 'f1',
    state: null,
  },
]

let salvo: Record<string, unknown> | null = null
let publicou = false

async function stub(page: Page, opts: { lista?: unknown; publishError?: string } = {}) {
  salvo = null
  publicou = false
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
  await page.route('**/api/automations**', (r) =>
    r.fulfill({ json: { items: [{ id: 'f1', name: 'Avisar no Slack', status: 'active', lastPublishedVersion: 1 }, { id: 'f2', name: 'Rascunho', status: 'draft', lastPublishedVersion: null }], total: 2, limit: 100, skip: 0 } }),
  )
  await page.route('**/api/monitors/meta', (r) => r.fulfill({ json: META }))
  await page.route(`**/api/monitors/${ID}/publish`, (r) => {
    if (opts.publishError) return r.fulfill({ status: 400, json: { message: opts.publishError } })
    publicou = true
    return r.fulfill({ json: { id: ID, status: 'published' } })
  })
  await page.route('**/api/monitors', (r) => {
    if (r.request().method() === 'POST') {
      salvo = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ status: 201, json: { id: 'novo', status: 'draft' } })
    }
    return r.fulfill({ json: opts.lista ?? LISTA })
  })
}

test('a condição é montada de listas fechadas, e salvar guarda RASCUNHO', async ({ page }) => {
  await stub(page, { lista: [] })
  await page.goto('/monitors')
  await page.getByTestId('monitor-novo').click()

  await page.getByTestId('monitor-nome').fill('RSI sobrevendido')
  await page.getByTestId('monitor-evento').selectOption('market.candle.closed')
  await page.getByTestId('monitor-campo').fill('rsi')
  await page.getByTestId('monitor-operador').selectOption('lt')
  await page.getByTestId('monitor-valor').fill('30')
  await page.getByTestId('monitor-modo').selectOption('enter')
  await page.getByTestId('monitor-flow').selectOption('f1')

  // A tela diz, antes de salvar, que salvar não põe de plantão.
  await expect(page.getByTestId('monitor-form')).toContainText('só entra de plantão quando você publica')
  await page.getByTestId('monitor-salvar').click()

  await expect.poll(() => salvo).not.toBeNull()
  expect(salvo).toMatchObject({
    name: 'RSI sobrevendido',
    source: { kind: 'internal_event', eventType: 'market.candle.closed' },
    condition: { kind: 'compare', field: 'rsi', op: 'lt', value: 30 },
    triggerMode: 'enter',
    flowId: 'f1',
  })
})

test('o Flow sem versão publicada aparece marcado, em vez de sumir da lista', async ({ page }) => {
  await stub(page, { lista: [] })
  await page.goto('/monitors')
  await page.getByTestId('monitor-novo').click()
  await expect(page.getByTestId('monitor-flow')).toContainText('Rascunho (sem versão publicada)')
})

test('a lista mostra a condição em português e o estado do plantão', async ({ page }) => {
  await stub(page)
  await page.goto('/monitors')
  const item = page.getByTestId('monitor-item').first()
  await expect(item).toContainText('rsi abaixo de 30')
  await expect(item).toContainText('rascunho')
  await expect(item).toContainText('Ainda não disparou')
})

test('pôr de plantão chama o publish, e a recusa do servidor aparece na tela', async ({ page }) => {
  await stub(page, { publishError: 'publique o Flow antes de publicar o monitor' })
  await page.goto('/monitors')
  await page.getByTestId('monitor-publicar').click()
  await expect(page.getByTestId('monitors-error')).toContainText('publique o Flow')
  expect(publicou).toBe(false)
})

test('publicar com tudo pronto passa pelo endpoint de publicação', async ({ page }) => {
  await stub(page)
  await page.goto('/monitors')
  await page.getByTestId('monitor-publicar').click()
  await expect.poll(() => publicou).toBe(true)
})
