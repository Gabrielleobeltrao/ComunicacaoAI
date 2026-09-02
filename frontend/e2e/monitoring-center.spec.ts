import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// A CENTRAL na tela: cinco perguntas, uma tela.
//
// O que estes casos protegem: a saúde é dita em português (ninguém monta a frase de cabeça
// às três da manhã), o wizard testa de VERDADE e mostra amostra redigida, a fonte nasce
// rascunho, e a recusa do servidor aparece em vez de virar estado silencioso.
const NOW = new Date(0).toISOString()
const ID = '000000000000000000000f01'

const OVERVIEW = {
  items: [
    {
      id: ID,
      name: 'Preço do fornecedor',
      kind: 'api_polling',
      status: 'active',
      health: 'degraded',
      reason: 'a última leitura boa tem 42 min',
      lastReadAt: new Date(Date.now() - 42 * 60_000).toISOString(),
      latencyMs: 180,
      consecutiveFailures: 0,
      readsOk: 12,
      readsFailed: 3,
      nextReadAt: new Date(Date.now() + 30_000).toISOString(),
      destination: { live: false, history: true },
    },
  ],
  summary: { total: 1, online: 0, degraded: 1, paused: 0, neverRead: 0 },
}

const FONTES = {
  items: [
    {
      id: ID,
      name: 'Preço do fornecedor',
      description: '',
      kind: 'api_polling',
      status: 'draft',
      health: 'never_read',
      config: { url: 'https://api.exemplo.test/precos' },
      mapping: { version: 1, fields: [{ to: 'preco', from: 'dados.preco' }] },
      schema: {},
      cadence: { mode: 'interval', intervalMs: 60000 },
      freshness: { staleAfterMs: 180000, onStale: 'degrade' },
      destination: { live: false, history: true, retentionDays: null },
      nextReadAt: null,
      telemetry: { lastReadAt: null, lastOkAt: null, lastErrorAt: null, lastErrorCode: null, lastLatencyMs: null, consecutiveFailures: 0, readsOk: 0, readsFailed: 0, reconnects: 0 },
    },
  ],
}

const AMOSTRA = {
  ok: true,
  rows: [{ preco: 10.5 }],
  sample: { dados: { preco: '10,50', apiKey: '«oculto»' } },
  strategy: 'json',
  missing: [],
  fields: [{ name: 'preco', present: true }],
  latencyMs: 120,
  status: 200,
}

let criado: unknown = null
let ativou = false

async function stub(page: Page, opts: { ativarErro?: string } = {}) {
  criado = null
  ativou = false
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
  await page.route('**/api/monitoring/overview', (r) => r.fulfill({ json: OVERVIEW }))
  await page.route('**/api/monitoring/sources/test', (r) => r.fulfill({ json: AMOSTRA }))
  await page.route(`**/api/monitoring/sources/${ID}/activate`, (r) => {
    if (opts.ativarErro) return r.fulfill({ status: 400, json: { message: opts.ativarErro } })
    ativou = true
    return r.fulfill({ json: { status: 'active' } })
  })
  await page.route('**/api/monitoring/sources', (r) => {
    if (r.request().method() === 'POST') {
      criado = r.request().postDataJSON()
      return r.fulfill({ status: 201, json: { id: 'novo', status: 'draft' } })
    }
    return r.fulfill({ json: FONTES })
  })
}

test('a visão geral diz a saúde em PORTUGUÊS, com o motivo', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring')
  const item = page.getByTestId('monitoring-item').first()
  await expect(item).toContainText('degradada')
  // Ninguém monta a frase de cabeça às três da manhã.
  await expect(item).toContainText('a última leitura boa tem 42 min')
  await expect(item).toContainText('3 falhas')
  await expect(page.getByTestId('monitoring-resumo')).toContainText('1')
})

test('as cinco abas existem e trocam de conteúdo', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring')
  for (const rotulo of ['Visão geral', 'Fontes', 'Monitores', 'Ao vivo', 'Histórico']) {
    await expect(page.getByRole('button', { name: rotulo })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Fontes' }).click()
  await expect(page.getByTestId('fonte-item')).toBeVisible()
  await page.getByRole('button', { name: 'Histórico' }).click()
  await expect(page.getByTestId('historico-filtro')).toBeVisible()
})

test('o wizard testa DE VERDADE e mostra a amostra redigida', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()

  await page.getByTestId('wizard-nome').fill('Preço do fornecedor')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-url').fill('https://api.exemplo.test/precos')
  await page.getByTestId('wizard-avancar').click()

  await page.getByTestId('wizard-testar').click()
  const amostra = page.getByTestId('wizard-amostra')
  await expect(amostra).toContainText('«oculto»', { timeout: 5000 })
  await expect(amostra).toContainText('120 ms')
})

test('a fonte criada pelo wizard nasce RASCUNHO, e a tela diz isso', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()
  await page.getByTestId('wizard-nome').fill('Nova')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-url').fill('https://api.exemplo.test/x')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-campo-to-0').fill('preco')
  await page.getByTestId('wizard-campo-from-0').fill('dados.preco')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-avancar').click()
  await expect(page.getByTestId('wizard-revisao')).toContainText('nasce como rascunho')
  await page.getByTestId('wizard-salvar').click()

  await expect.poll(() => criado).not.toBeNull()
  expect(criado).toMatchObject({
    name: 'Nova',
    kind: 'api_polling',
    mapping: { version: 1, fields: [{ to: 'preco', from: 'dados.preco' }] },
    destination: { history: true },
  })
  await expect(page.getByTestId('monitoring-aviso')).toContainText('rascunho')
})

test('a recusa do servidor ao ativar aparece na tela', async ({ page }) => {
  await stub(page, { ativarErro: 'teste a fonte antes de ativar: ela ainda não leu nada' })
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-ativar').click()
  await expect(page.getByTestId('monitoring-error')).toContainText('teste a fonte antes de ativar')
  expect(ativou).toBe(false)
})

test('em 320 px a Central inteira cabe, sem estourar para os lados', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await stub(page)
  await page.goto('/monitoring')
  await expect(page.getByTestId('monitoring-item').first()).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('em 320 px o wizard também cabe', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await stub(page)
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()
  await expect(page.getByTestId('fonte-wizard')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('acessibilidade: os campos do wizard têm rótulo, e o erro é anunciado', async ({ page }) => {
  await stub(page, { ativarErro: 'não dá' })
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()
  // O rótulo visível é o que o leitor de tela anuncia junto do campo.
  await expect(page.getByText('Nome', { exact: true })).toBeVisible()
  await expect(page.getByText('Tipo de fonte')).toBeVisible()

  await page.getByRole('button', { name: 'Cancelar' }).click()
  await page.getByTestId('fonte-ativar').click()
  await expect(page.getByRole('alert')).toContainText('não dá')
})
