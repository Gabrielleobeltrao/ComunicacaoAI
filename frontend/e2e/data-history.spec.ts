import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Os HISTÓRICOS, nas telas.
 *
 * O que estas provas fixam é a promessa da superfície: dá para criar uma regra sem
 * programar, TESTAR antes de ativar — e o teste roda o motor de verdade, não uma
 * simulação da tela —, e depois consultar o que foi guardado por chave e período. E o
 * exemplo que aparece por padrão não é de mercado: o mecanismo é genérico, e a tela
 * não pode sugerir o contrário.
 */
const NOW = new Date(0).toISOString()
const RECORDER = {
  id: 'rec-1',
  name: 'Preço do BTC a cada 5 minutos',
  enabled: true,
  source: { kind: 'live_data', ref: 'conexao-1' },
  mode: 'window_aggregate',
  entityKeyPath: 'symbol',
  occurredAtPath: null,
  intervalMs: 300_000,
  schedule: null,
  filters: [],
  selectedFields: null,
  aggregations: [
    { from: 'price', op: 'first', to: 'open' },
    { from: 'price', op: 'max', to: 'high' },
    { from: 'price', op: 'min', to: 'low' },
    { from: 'price', op: 'last', to: 'close' },
    { from: 'volume', op: 'sum', to: 'volume' },
  ],
  changePath: null,
  retentionDays: 90,
  recordCount: 42,
  lastRecordAt: NOW,
  lastError: null,
  createdAt: NOW,
  updatedAt: NOW,
}

const ESTOQUE = {
  ...RECORDER,
  id: 'rec-2',
  name: 'Estoque por SKU, uma vez por dia',
  mode: 'schedule_snapshot',
  source: { kind: 'manual', ref: 'erp' },
  aggregations: [],
  intervalMs: null,
  schedule: { hour: 3, minute: 0 },
  recordCount: 7,
}

let criado: Record<string, unknown> | null = null
let previaPedida: Record<string, unknown> | null = null

async function stub(page: Page, opts: { recorders?: unknown[] } = {}) {
  criado = null
  previaPedida = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [] } }))
  await page.route('**/api/building', (r) => r.fulfill({ json: { id: 'b1', name: 'Prédio QA', createdAt: NOW, updatedAt: NOW } }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))

  await page.route('**/api/data-history/recorders', (r) => {
    if (r.request().method() === 'POST') {
      criado = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ status: 201, json: { ...RECORDER, ...criado, id: 'rec-novo' } })
    }
    return r.fulfill({ json: opts.recorders ?? [RECORDER, ESTOQUE] })
  })
  await page.route('**/api/data-history/preview', (r) => {
    previaPedida = r.request().postDataJSON() as Record<string, unknown>
    return r.fulfill({
      json: {
        decisions: [
          { index: 0, resultado: 'acumulado' },
          { index: 1, resultado: 'acumulado' },
        ],
        records: [],
        windows: [{ entityKey: 'BTCUSDT', windowStart: NOW, windowEnd: NOW, count: 2, value: { open: 100, high: 110, low: 100, close: 110, volume: 5 } }],
      },
    })
  })
  await page.route('**/api/data-history/recorders/*/keys', (r) => r.fulfill({ json: ['BTCUSDT', 'ETHUSDT'] }))
  await page.route('**/api/data-history/recorders/*/records**', (r) =>
    r.fulfill({
      json: {
        count: 2,
        items: [
          { id: 'h1', recorderId: 'rec-1', sourceKey: 'live_data:conexao-1', entityKey: 'BTCUSDT', occurredAt: NOW, recordedAt: NOW, windowStart: NOW, windowEnd: NOW, value: { open: 100, close: 110 } },
          { id: 'h2', recorderId: 'rec-1', sourceKey: 'live_data:conexao-1', entityKey: 'BTCUSDT', occurredAt: NOW, recordedAt: NOW, windowStart: NOW, windowEnd: NOW, value: { open: 110, close: 108 } },
        ],
      },
    }),
  )
  await page.route('**/api/data-history/recorders/*/aggregate**', (r) => r.fulfill({ json: { result: { open: 100, close: 108, volume: 25 } } }))
  await page.route('**/api/data-history/recorders/*', (r) => {
    if (r.request().method() === 'PATCH') return r.fulfill({ json: { ...RECORDER, enabled: false } })
    if (r.request().method() === 'DELETE') return r.fulfill({ status: 204, body: '' })
    return r.fulfill({ json: { ...RECORDER, storedRecords: 42 } })
  })
}

test('a lista mostra o que a conta guarda — e não só coisa de mercado', async ({ page }) => {
  await stub(page)
  await page.goto('/historicos')
  await expect(page.getByTestId('recorder-list')).toContainText('Preço do BTC a cada 5 minutos')
  await expect(page.getByTestId('recorder-list')).toContainText('Estoque por SKU, uma vez por dia')
  // O modo aparece em português de gente, não em nome de mecanismo.
  await expect(page.getByTestId('recorder-list')).toContainText('Resumo por período')
  await expect(page.getByTestId('recorder-list')).toContainText('Uma vez por dia')
})

test('criar um histórico: escolher fonte, quando gravar e o que calcular', async ({ page }) => {
  await stub(page, { recorders: [] })
  await page.goto('/historicos')
  await page.getByTestId('new-recorder').click()

  await page.getByTestId('recorder-name').fill('Pedidos por hora')
  await page.getByTestId('recorder-source-kind').selectOption('manual')
  await page.getByTestId('recorder-source-ref').fill('erp')
  await page.getByTestId('recorder-entity').fill('loja')
  await page.getByTestId('recorder-mode').selectOption('window_aggregate')
  await page.getByTestId('recorder-interval').selectOption('3600000')

  // As agregações são a parte genérica: soma e contagem servem a pedido do mesmo jeito
  // que servem a cotação.
  await page.getByTestId('add-aggregation').click()
  const linha = page.getByTestId('aggregation-row').first()
  await linha.getByLabel('Campo de origem').fill('total')
  await linha.getByLabel('Operação').selectOption('sum')
  await linha.getByLabel('Nome do resultado').fill('faturamento')

  await page.getByTestId('recorder-activate').click()
  await expect.poll(() => criado?.name).toBe('Pedidos por hora')
  expect(criado?.mode).toBe('window_aggregate')
  expect(criado?.intervalMs).toBe(3_600_000)
  expect(criado?.aggregations).toEqual([{ from: 'total', op: 'sum', to: 'faturamento' }])
  expect(criado?.entityKeyPath).toBe('loja')
})

test('testar antes de ativar roda o motor de verdade e mostra o resultado', async ({ page }) => {
  await stub(page, { recorders: [] })
  await page.goto('/historicos/novo')
  await page.getByTestId('recorder-name').fill('BTC 5 minutos')
  await page.getByTestId('recorder-mode').selectOption('window_aggregate')
  await page.getByTestId('add-aggregation').click()
  const linha = page.getByTestId('aggregation-row').first()
  await linha.getByLabel('Campo de origem').fill('price')
  await linha.getByLabel('Operação').selectOption('first')
  await linha.getByLabel('Nome do resultado').fill('open')

  await page.getByTestId('recorder-preview').click()
  await expect(page.getByTestId('recorder-preview-result')).toBeVisible()
  // O que a prévia mostra é o que o SERVIDOR respondeu — a tela não simula por conta.
  await expect(page.getByTestId('preview-windows')).toContainText('"open": 100')
  await expect.poll(() => (previaPedida?.recorder as Record<string, unknown>)?.name).toBe('BTC 5 minutos')
  expect(Array.isArray(previaPedida?.samples)).toBe(true)
  // E nada foi criado: testar não é ativar.
  expect(criado).toBeNull()
})

test('consultar o histórico por chave e período', async ({ page }) => {
  await stub(page)
  await page.goto('/historicos/rec-1')
  await expect(page.getByTestId('records-table')).toBeVisible()
  await expect(page.getByTestId('record-row')).toHaveCount(2)
  // O resumo do período vem do banco, e aparece junto.
  await expect(page.getByTestId('period-summary')).toContainText('open')
  await expect(page.getByTestId('period-summary')).toContainText('108')

  await page.getByTestId('filter-key').selectOption('BTCUSDT')
  await page.getByTestId('filter-apply').click()
  await expect(page.getByTestId('record-row')).toHaveCount(2)

  // A regra fica à vista em linguagem de configuração, não de código.
  await expect(page.getByTestId('recorder-rules')).toContainText('price → primeiro → open')
})

test('em 320px a tela do histórico não estoura a largura', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 320, height: 800 })
  for (const rota of ['/historicos', '/historicos/novo', '/historicos/rec-1']) {
    await page.goto(rota)
    const folga = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(folga, `${rota} estourou ${folga}px`).toBeLessThanOrEqual(1)
  }
})
