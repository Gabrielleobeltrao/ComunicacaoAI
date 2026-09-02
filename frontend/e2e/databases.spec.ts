import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// DATABASES na tela: criar, declarar um conjunto, consultar.
//
// O que estes casos protegem: a origem do dado é dita em voz alta (mercado não é memória
// nem conhecimento), "quantos vieram" nunca é apresentado como "quantos existem", e uma
// tabela larga rola dentro do próprio bloco em vez de empurrar a página.
const NOW = new Date(0).toISOString()
const DB_ID = '000000000000000000000db1'

const LISTA = {
  items: [
    { id: DB_ID, name: 'Operações', description: 'ordens do dia', adapterKind: 'data_history', status: 'active', retention: { mode: 'forever' }, owner: { ownerType: 'building', ownerId: 'b1' }, datasets: 1, updatedAt: NOW },
    { id: '000000000000000000000db2', name: 'Mercado', description: '', adapterKind: 'market_data', status: 'paused', retention: { mode: 'forever' }, owner: { ownerType: 'building', ownerId: 'b1' }, datasets: 1, updatedAt: NOW },
  ],
}

const DETALHE = {
  id: DB_ID,
  name: 'Operações',
  description: 'ordens do dia',
  adapterKind: 'data_history',
  status: 'active',
  retention: { mode: 'forever' },
  owner: { ownerType: 'building', ownerId: 'b1' },
  adapterConfig: { recorderId: 'r1' },
  updatedAt: NOW,
  datasets: [
    { key: 'ordens', name: 'ordens', mutability: 'append_only', fields: ['ticker', 'preco'], schema: { type: 'object', properties: { ticker: { type: 'string' }, preco: { type: 'number' } } } },
  ],
}

const CONSULTA = {
  rows: [
    { ticker: 'PETR4', preco: 30.5, occurredAt: NOW },
    { ticker: 'VALE3', preco: 60.1, occurredAt: NOW },
  ],
  total: 137,
  returned: 2,
  truncated: true,
  freshness: NOW,
}

let criado: Record<string, unknown> | null = null
let grantSalvo: Record<string, unknown> | null = null

const GRANTS = {
  items: [
    { id: 'g1', subjectType: 'sector', subjectId: 's1', capabilities: ['discover', 'query'], effect: 'allow', datasetKeys: [], updatedAt: NOW },
  ],
}

const IMPACTO = {
  dataStoreId: DB_ID,
  name: 'Operações',
  datasets: [{ key: 'ordens', mutability: 'append_only' }],
  grants: 1,
  accessibleBy: [{ agentId: 'a1', name: 'Marina', origin: 'sector' }],
  recommendation: 'prefer_archive',
}

async function stub(page: Page, opts: { listStatus?: number; empty?: boolean } = {}) {
  criado = null
  grantSalvo = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW } }))
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route(`**/api/databases/${DB_ID}/datasets/ordens/query`, (r) => r.fulfill({ json: CONSULTA }))
  await page.route(`**/api/databases/${DB_ID}/datasets`, (r) => {
    criado = r.request().postDataJSON() as Record<string, unknown>
    return r.fulfill({ status: 201, json: { key: String(criado.key) } })
  })
  await page.route('**/api/agents', (r) => r.fulfill({ json: [{ _id: 'a1', name: 'Marina' }] }))
  await page.route('**/api/sectors', (r) => r.fulfill({ json: [{ _id: 's1', name: 'Análise' }] }))
  await page.route(`**/api/databases/${DB_ID}/impact`, (r) => r.fulfill({ json: IMPACTO }))
  await page.route(`**/api/databases/${DB_ID}/grants/**`, (r) => r.fulfill({ status: 204, body: '' }))
  await page.route(`**/api/databases/${DB_ID}/grants`, (r) => {
    if (r.request().method() === 'PUT') {
      grantSalvo = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ json: { id: 'g2', ...grantSalvo } })
    }
    return r.fulfill({ json: GRANTS })
  })
  await page.route(`**/api/databases/${DB_ID}`, (r) => r.fulfill({ json: DETALHE }))
  await page.route('**/api/databases', (r) => {
    if (r.request().method() === 'POST') {
      criado = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ status: 201, json: { id: 'novo', name: String(criado.name) } })
    }
    if (opts.listStatus && opts.listStatus >= 400) return r.fulfill({ status: opts.listStatus, json: { message: 'não foi possível carregar' } })
    return r.fulfill({ json: opts.empty ? { items: [] } : LISTA })
  })
}

test('a lista diz a ORIGEM de cada database, e o estado', async ({ page }) => {
  await stub(page)
  await page.goto('/databases')
  await expect(page.getByTestId('databases-list')).toBeVisible()
  // Mercado não é memória nem conhecimento — e a tela diz de onde vem.
  await expect(page.getByTestId('database-000000000000000000000db2')).toContainText('Dados de mercado')
  await expect(page.getByTestId('database-000000000000000000000db2')).toContainText('pausado')
  await expect(page.getByTestId(`database-${DB_ID}`)).toContainText('Histórico interno')
})

test('abrir um database mostra os conjuntos e a consulta', async ({ page }) => {
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId(`database-${DB_ID}`).click()
  await expect(page.getByTestId('database-detail')).toBeVisible()
  await expect(page.getByTestId('dataset-ordens')).toContainText('só acrescenta')

  // "Quantos vieram" nunca é apresentado como "quantos existem".
  await expect(page.getByTestId('dataset-query-counts')).toContainText('2 de 137')
  await expect(page.getByTestId('dataset-query-table')).toContainText('PETR4')
})

test('criar um conjunto monta o schema a partir de campo:tipo', async ({ page }) => {
  await stub(page)
  await page.goto(`/databases?id=${DB_ID}`)
  await page.getByTestId('dataset-new').click()
  await page.getByTestId('dataset-new-key').fill('clientes')
  await page.getByTestId('dataset-new-fields').fill('nome:string\nidade:number')
  await page.getByTestId('dataset-new-save').click()
  await expect.poll(() => (criado as { schema?: { properties?: Record<string, { type: string }> } } | null)?.schema?.properties?.idade?.type).toBe('number')
})

test('criar um database manda o adapter escolhido', async ({ page }) => {
  await stub(page)
  await page.goto('/databases')
  await page.getByTestId('databases-new').click()
  await page.getByTestId('database-new-name').fill('Estoque')
  await page.getByTestId('database-new-adapter').selectOption('market_data')
  await page.getByTestId('database-new-save').click()
  await expect.poll(() => (criado as { adapterKind?: string } | null)?.adapterKind).toBe('market_data')
})

test('erro NÃO vira lista vazia', async ({ page }) => {
  await stub(page, { listStatus: 500 })
  await page.goto('/databases')
  await expect(page.getByTestId('databases-error')).toBeVisible()
  await expect(page.getByTestId('databases-empty')).toHaveCount(0)
})

test('vazio explica o que um database é', async ({ page }) => {
  await stub(page, { empty: true })
  await page.goto('/databases')
  await expect(page.getByTestId('databases-empty')).toContainText('sem misturá-los com conhecimento')
})

test('em 320 px a tabela rola dentro do bloco, e a página não', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await stub(page)
  await page.goto(`/databases?id=${DB_ID}`)
  await expect(page.getByTestId('dataset-query-table')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

// --- grants ------------------------------------------------------------------------------

test('conceder a um SETOR avisa que vale para quem entrar depois', async ({ page }) => {
  await stub(page)
  await page.goto(`/databases?id=${DB_ID}`)
  await page.getByTestId('grant-new').click()
  await page.getByTestId('grant-subject').selectOption('sector:s1')
  // O impacto ANTES de salvar: um setor é gente, e a decisão é tomada sobre pessoas.
  await expect(page.getByTestId('grant-impact')).toContainText('inclusive os que entrarem depois')
  await page.getByTestId('grant-save').click()
  await expect.poll(() => (grantSalvo as { subjectType?: string } | null)?.subjectType).toBe('sector')
})

test('negar é uma escolha explícita, e a tela diz que ela vence', async ({ page }) => {
  await stub(page)
  await page.goto(`/databases?id=${DB_ID}`)
  await page.getByTestId('grant-new').click()
  await page.getByTestId('grant-subject').selectOption('agent:a1')
  await page.getByTestId('grant-deny').check()
  await expect(page.getByTestId('grant-form')).toContainText('vence qualquer permissão herdada')
  await page.getByTestId('grant-save').click()
  await expect.poll(() => (grantSalvo as { effect?: string } | null)?.effect).toBe('deny')
})

test('a tela mostra quem consegue consultar HOJE, com a origem', async ({ page }) => {
  await stub(page)
  await page.goto(`/databases?id=${DB_ID}`)
  const efetivo = page.getByTestId('grants-effective')
  await expect(efetivo).toContainText('Marina')
  await expect(efetivo).toContainText('pelo setor')
})

test('sem grant nenhum, a tela diz o que isso significa', async ({ page }) => {
  await stub(page)
  await page.route(`**/api/databases/${DB_ID}/grants`, (r) => r.fulfill({ json: { items: [] } }))
  await page.goto(`/databases?id=${DB_ID}`)
  await expect(page.getByTestId('grants-empty')).toContainText('nenhum agente consulta')
})
