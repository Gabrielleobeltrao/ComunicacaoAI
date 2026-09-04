import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// RECURSOS: o catálogo comum e a matriz de acesso do agente.
//
// O que estes casos protegem: a lista distingue os quatro estados (carregando, erro,
// vazio, lista) — um erro desenhado como vazio faz a pessoa concluir que não tem recurso
// nenhum e sair para criar o que já existe; e a matriz mostra o NEGADO com o motivo, que
// é a pergunta que alguém traz até ela.
const NOW = new Date(0).toISOString()
const AGENT_ID = '000000000000000000000a11'

const RECURSOS = {
  kinds: ['knowledge', 'app', 'tool'],
  byKind: { knowledge: 2, app: 1, tool: 1 },
  items: [
    { kind: 'knowledge', id: 'k1', name: 'Política de troca', owner: { ownerType: 'agent', ownerId: AGENT_ID }, status: 'indexed', updatedAt: NOW },
    { kind: 'knowledge', id: 'k2', name: 'Aviso do andar', owner: { ownerType: 'floor', ownerId: 'f1' }, status: 'error', flags: ['index_error'], updatedAt: NOW },
    { kind: 'app', id: 'web_chat', name: 'Chat Web', description: 'Atendimento pelo site', owner: { ownerType: 'platform', ownerId: 'platform' }, status: 'not_connected', flags: ['not_connected'] },
    { kind: 'tool', id: 't1', name: 'consulta_cep', description: 'consulta um CEP', owner: { ownerType: 'account', ownerId: 'conta' }, status: 'enabled' },
  ],
}

const MATRIZ = {
  items: [
    { kind: 'knowledge', resourceId: 'k1', name: 'Política de troca', allowed: true, capabilities: ['discover', 'retrieve'], origin: 'direct', reason: 'é a base própria dele', pending: null },
    { kind: 'knowledge', resourceId: 'k2', name: 'Aviso do andar', allowed: false, capabilities: [], origin: 'none', reason: 'a política de conhecimento deste agente não inclui esta base', pending: null },
    { kind: 'tool', resourceId: 't1', name: 'consulta_cep', allowed: false, capabilities: ['discover'], origin: 'direct', reason: 'a ferramenta está desligada', pending: { code: 'tool_desligada', message: 'Ligue a ferramenta em Ferramentas para o agente poder usá-la.' } },
  ],
}

async function stub(page: Page, opts: { resourcesStatus?: number; empty?: boolean } = {}) {
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW } }))
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/resources?**', (r) => {
    if (opts.resourcesStatus && opts.resourcesStatus >= 400) return r.fulfill({ status: opts.resourcesStatus, json: { message: 'o catálogo não pôde ser carregado' } })
    if (opts.empty) return r.fulfill({ json: { ...RECURSOS, items: [], byKind: {} } })
    const url = new URL(r.request().url())
    const kind = url.searchParams.get('kind')
    const q = url.searchParams.get('q')
    let items = RECURSOS.items
    if (kind) items = items.filter((i) => i.kind === kind)
    if (q) items = items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()))
    return r.fulfill({ json: { ...RECURSOS, items } })
  })
  await page.route(`**/api/agents/${AGENT_ID}/resource-access`, (r) => r.fulfill({ json: MATRIZ }))
}

test('o catálogo lista os recursos com dono e estado', async ({ page }) => {
  await stub(page)
  await page.goto('/resources')
  await expect(page.getByTestId('resources-list')).toBeVisible()
  await expect(page.getByTestId('resource-knowledge-k1')).toContainText('Política de troca')
  // Dono e estado são coisas diferentes, e a tela diz as duas.
  await expect(page.getByTestId('resource-app-web_chat')).toContainText('Plataforma')
  await expect(page.getByTestId('resource-app-web_chat')).toContainText('sem conexão')
  await expect(page.getByTestId('resource-knowledge-k2')).toContainText('erro ao indexar')
})

test('o filtro por tipo e a busca funcionam, e o tipo fica na URL', async ({ page }) => {
  await stub(page)
  await page.goto('/resources')
  await page.getByTestId('resources-tab-tool').click()
  await expect(page).toHaveURL(/kind=tool/)
  await expect(page.getByTestId('resource-tool-t1')).toBeVisible()
  await expect(page.getByTestId('resource-knowledge-k1')).toHaveCount(0)

  await page.getByTestId('resources-tab-all').click()
  await page.getByTestId('resources-search').fill('Política')
  await expect(page.getByTestId('resource-knowledge-k1')).toBeVisible()
  await expect(page.getByTestId('resource-tool-t1')).toHaveCount(0)
})

test('erro NÃO vira lista vazia', async ({ page }) => {
  await stub(page, { resourcesStatus: 500 })
  await page.goto('/resources')
  await expect(page.getByTestId('resources-error')).toBeVisible()
  await expect(page.getByTestId('resources-empty')).toHaveCount(0)
  await expect(page.getByTestId('resources-error')).toContainText('Tentar de novo')
})

test('vazio é dito como vazio', async ({ page }) => {
  await stub(page, { empty: true })
  await page.goto('/resources')
  await expect(page.getByTestId('resources-empty')).toBeVisible()
  await expect(page.getByTestId('resources-error')).toHaveCount(0)
})

test('em 320 px o catálogo não estoura para os lados', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await stub(page)
  await page.goto('/resources')
  await expect(page.getByTestId('resources-list')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('a navegação separa ESCRITÓRIO, RECURSOS, OPERAÇÕES e COMUNIDADE', async ({ page }) => {
  await stub(page)
  await page.goto('/resources')
  const nav = page.locator('nav').first()
  await expect(nav).toContainText('RECURSOS')
  await expect(nav).toContainText('OPERAÇÕES')
  // COMUNIDADE entrou quando a tela passou a existir — e o link leva a ela. A regra é a
  // mesma de antes: nada de item que promete o que não existe.
  await expect(nav).toContainText('COMUNIDADE')
  await expect(nav.getByRole('link', { name: 'Comunidade' })).toHaveAttribute('href', '/community')
})
