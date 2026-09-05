import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// COMUNIDADE — que não é um lugar, é uma PROCEDÊNCIA.
//
// Ela tinha página própria, e uma página própria dizia a coisa errada: que instalar algo
// de outra pessoa é uma atividade diferente de usar um App ou uma ferramenta. Não é. É a
// mesma prateleira, com etiquetas diferentes. Então o que era o Marketplace agora aparece
// dentro de Apps e de Ferramentas, na mesma busca e nos mesmos filtros.
//
// O que estes casos protegem: o SELO é só de quem é da plataforma (nunca "oficial" por
// omissão — o da comunidade não ganha selo nenhum), a busca e o filtro alcançam os dois,
// e o popup de cada item é onde mora tudo o que o dono precisa decidir — permissão que
// aumenta, versão fixada, motivo de suspensão.
const NOW = new Date(0).toISOString()
const APP = '000000000000000000000a01'
const TPL = '000000000000000000000t01'
const FERRAMENTA = '000000000000000000000f01'

const CATALOGO = [
  { id: APP, kind: 'app', slug: 'crm', name: 'CRM Simples', summary: 'contatos e negociações', categories: ['vendas'], latestVersion: '1.0.0', author: 'community', installs: 12, updatedAt: NOW },
  { id: TPL, kind: 'template', slug: 'atendimento', name: 'Atendimento enxuto', summary: 'time pronto', categories: [], latestVersion: '2.0.0', author: 'platform', installs: 3, updatedAt: NOW },
  { id: FERRAMENTA, kind: 'tool', slug: 'cep', name: 'Consulta CEP', summary: 'endereço pelo CEP', categories: [], latestVersion: '1.2.0', author: 'community', installs: 40, updatedAt: NOW },
]

const OFICIAL = {
  key: 'slack',
  version: '1.0.0',
  source: 'system',
  name: 'Slack',
  description: 'Avisar um canal do Slack.',
  icon: 'slack',
  categories: ['comunicação'],
  documentationUrl: null,
  status: 'published',
  auth: { kind: 'webhook', fields: [], scopes: [], documentationUrl: null },
  allowedDomains: ['hooks.slack.com'],
  supportsMultipleConnections: true,
  actions: [{ key: 'slack_notificar', name: 'Notificar canal', description: '', risk: 'write', inputSchema: {}, resourceFields: [] }],
  surfaces: [],
  pinnable: false,
  defaultSurfaceKey: null,
  dataAccess: [],
  storageNote: '',
  disconnectNote: '',
  providerCostNote: null,
  requiresAuth: true,
  activation: 'credentials',
  connectable: false,
  streamable: false,
  activationRoute: null,
  installationCount: 0,
  connected: false,
}

const INSTALADOS = [{ packageId: APP, version: '1.0.0', status: 'active', installedAt: NOW }]

const PREVIA_AMPLIA = {
  from: '1.0.0',
  to: '1.1.0',
  changelog: 'passou a criar contatos',
  compatible: true,
  permissions: {
    added: [{ kind: 'app', key: 'google_calendar', capabilities: ['write'], reason: 'agendar' }],
    removed: [],
    changed: [{ key: 'api.crm.test', kind: 'network', before: ['read'], after: ['read', 'write'] }],
    needsApproval: true,
  },
}

let aprovado: unknown = null
let instalouTemplate = false
let instalouPacote: string | null = null

async function stub(page: Page, opts: { previa?: unknown; meus?: unknown[]; instalados?: unknown[]; catalogo?: unknown[]; comunidadeFechada?: boolean } = {}) {
  aprovado = null
  instalouTemplate = false
  instalouPacote = null
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
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [OFICIAL] }))
  await page.route('**/api/app-installations', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/tools', (r) => r.fulfill({ json: [] }))
  // A comunidade pode estar fechada por configuração: a rota responde 404, e as telas
  // continuam de pé com o que é da própria conta.
  await page.route('**/api/extensions/catalog**', (r) => {
    if (opts.comunidadeFechada) return r.fulfill({ status: 404, json: { error: 'not found' } })
    // O catálogo de verdade filtra por tipo. Um stub que devolve tudo para qualquer
    // pedido esconderia exatamente o defeito de listar a mesma coisa duas vezes.
    const kind = new URL(r.request().url()).searchParams.get('kind')
    const itens = (opts.catalogo ?? CATALOGO) as { kind: string }[]
    return r.fulfill({ json: { items: kind ? itens.filter((i) => i.kind === kind) : itens } })
  })
  await page.route('**/api/extensions/packages', (r) => r.fulfill({ json: { items: opts.meus ?? [] } }))
  await page.route(`**/api/extensions/installed/${TPL}/template`, (r) => {
    instalouTemplate = true
    return r.fulfill({ status: 201, json: { packageId: TPL, version: '2.0.0', projectId: 'p1', blueprintHash: 'h' } })
  })
  await page.route(`**/api/extensions/installed/${APP}/update`, (r) => {
    if (r.request().method() === 'POST') {
      aprovado = r.request().postDataJSON()
      return r.fulfill({ json: { version: '1.1.0' } })
    }
    return r.fulfill({ json: opts.previa ?? null })
  })
  await page.route('**/api/extensions/installed/*', (r) => {
    if (r.request().method() === 'POST') {
      instalouPacote = r.request().url().split('/').pop() ?? null
      return r.fulfill({ status: 201, json: { packageId: instalouPacote, version: '1.0.0' } })
    }
    return r.fulfill({ json: null })
  })
  await page.route('**/api/extensions/installed', (r) => r.fulfill({ json: { items: opts.instalados ?? [] } }))
}

// --- tudo na mesma prateleira -------------------------------------------------------------

test('ACEITAÇÃO: Comunidade não é uma página — o que é dela aparece dentro de Apps', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  const catalogo = page.getByTestId('app-catalog')

  // O oficial e o da comunidade dividem a MESMA lista.
  await expect(catalogo).toContainText('Slack')
  await expect(catalogo).toContainText('CRM Simples')

  // E o selo é só de quem é da plataforma. O da comunidade não ganha nada — por ora.
  await expect(page.getByTestId('app-card').filter({ hasText: 'Slack' }).getByTestId('selo-plataforma')).toBeVisible()
  await expect(page.getByTestId('app-card').filter({ hasText: 'CRM Simples' }).getByTestId('selo-plataforma')).toHaveCount(0)
})

test('AMEAÇA: o menu não leva mais a uma Comunidade separada, e o endereço antigo não morre', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  await expect(page.getByRole('navigation').getByText('Comunidade', { exact: true })).toHaveCount(0)

  // Quem tinha o favorito continua chegando em algum lugar útil.
  await page.goto('/community')
  await expect(page).toHaveURL(/\/apps/)
  await expect(page.getByTestId('app-catalog')).toBeVisible()
})

test('a busca alcança o da comunidade, não só o oficial', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  await page.getByTestId('apps-search').fill('contatos')
  await expect(page.getByTestId('app-card')).toHaveCount(1)
  await expect(page.getByTestId('app-catalog')).toContainText('CRM Simples')
})

test('o filtro de procedência separa quando alguém QUER separar', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  await page.getByTestId('origem-comunidade').click()
  await expect(page.getByTestId('app-catalog')).not.toContainText('Slack')
  await expect(page.getByTestId('app-catalog')).toContainText('CRM Simples')

  await page.getByTestId('origem-plataforma').click()
  await expect(page.getByTestId('app-catalog')).toContainText('Slack')
  await expect(page.getByTestId('app-catalog')).not.toContainText('CRM Simples')
})

test('uma ferramenta da comunidade aparece entre as ferramentas, não em outro lugar', async ({ page }) => {
  await stub(page)
  await page.goto('/apps?tab=custom')
  await expect(page.getByTestId('tool-card').filter({ hasText: 'Consulta CEP' })).toBeVisible()
  // App e template não vazam para a prateleira de ferramentas.
  await expect(page.getByTestId('tool-card').filter({ hasText: 'CRM Simples' })).toHaveCount(0)
})

test('com a comunidade fechada, a tela continua de pé com o que é da conta', async ({ page }) => {
  await stub(page, { comunidadeFechada: true })
  await page.goto('/apps')
  await expect(page.getByTestId('app-catalog')).toContainText('Slack')
  await expect(page.getByTestId('app-catalog')).not.toContainText('CRM Simples')
})

// --- o popup: onde o dono decide ------------------------------------------------------------

test('o popup diz a procedência, a versão e quantos instalaram — antes de instalar', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  await page.getByTestId('app-card').filter({ hasText: 'CRM Simples' }).getByTestId('app-open').click()
  const detalhe = page.getByTestId('extension-detail')
  await expect(detalhe).toContainText('da comunidade')
  await expect(detalhe).toContainText('1.0.0')
  await expect(detalhe).toContainText('12 instalações')
})

test('instalar um template avisa que nada foi criado até a proposta ser aprovada', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  await page.getByTestId('app-card').filter({ hasText: 'Atendimento enxuto' }).getByTestId('app-open').click()
  await page.getByTestId('catalog-instalar').click()
  await expect.poll(() => instalouTemplate).toBe(true)
  await expect(page.getByTestId('extension-aviso')).toContainText('nada foi criado até você revisar')
})

test('instalar um App da comunidade chama a instalação daquele pacote', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  await page.getByTestId('app-card').filter({ hasText: 'CRM Simples' }).getByTestId('app-open').click()
  await page.getByTestId('catalog-instalar').click()
  await expect.poll(() => instalouPacote).toBe(APP)
})

test('uma atualização que AMPLIA permissão mostra o que muda antes de qualquer clique', async ({ page }) => {
  await stub(page, { previa: PREVIA_AMPLIA, instalados: INSTALADOS })
  await page.goto('/apps')
  await page.getByTestId('app-card').filter({ hasText: 'CRM Simples' }).getByTestId('app-open').click()
  const diff = page.getByTestId('update-diff')
  await expect(diff).toContainText('1.0.0 → 1.1.0')
  await expect(diff).toContainText('o App google_calendar: write')
  await expect(diff).toContainText('de [read] para [read, write]')

  // Só existe o botão que declara a revisão — não há caminho de atualizar sem ver.
  await expect(page.getByTestId('update-aplicar')).toHaveCount(0)
  await page.getByTestId('update-aprovar').click()
  await expect.poll(() => aprovado).toEqual({ approvePermissions: true })
})

test('atualização que não amplia permissão não pede aprovação', async ({ page }) => {
  await stub(page, { previa: { ...PREVIA_AMPLIA, permissions: { added: [], removed: [], changed: [], needsApproval: false } }, instalados: INSTALADOS })
  await page.goto('/apps')
  await page.getByTestId('app-card').filter({ hasText: 'CRM Simples' }).getByTestId('app-open').click()
  await expect(page.getByTestId('update-aprovar')).toHaveCount(0)
  await page.getByTestId('update-aplicar').click()
  await expect.poll(() => aprovado).toEqual({ approvePermissions: false })
})

test('a versão instalada aparece como FIXADA, no cartão e no popup', async ({ page }) => {
  await stub(page, { instalados: INSTALADOS })
  await page.goto('/apps')
  const cartao = page.getByTestId('app-card').filter({ hasText: 'CRM Simples' })
  await expect(cartao).toContainText('Instalado')
  await cartao.getByTestId('app-open').click()
  await expect(page.getByTestId('extension-detail')).toContainText('1.0.0 (fixada)')
})

test('o motivo de uma suspensão fica visível para o DONO, no popup do item dele', async ({ page }) => {
  await stub(page, {
    meus: [
      { _id: APP, kind: 'app', slug: 'crm', name: 'CRM Simples', summary: '', visibility: 'community', status: 'suspended', latestVersion: '1.0.0', suspendedReason: 'domínio trocado sem aviso', updatedAt: NOW },
    ],
  })
  await page.goto('/apps')
  await page.getByTestId('app-card').filter({ hasText: 'CRM Simples' }).getByTestId('app-open').click()
  await expect(page.getByTestId('extension-detail')).toContainText('domínio trocado sem aviso')
})

test('o que é MEU e ainda é rascunho aparece para mim — e o popup é onde eu o envio', async ({ page }) => {
  await stub(page, {
    catalogo: [],
    meus: [
      { _id: 'p9', kind: 'app', slug: 'interno', name: 'Painel interno', summary: 'só meu', visibility: 'private', status: 'draft', latestVersion: '0.1.0', updatedAt: NOW },
    ],
  })
  await page.goto('/apps')
  const cartao = page.getByTestId('app-card').filter({ hasText: 'Painel interno' })
  await expect(cartao).toContainText('rascunho')
  await cartao.getByTestId('app-open').click()
  await expect(page.getByTestId('package-enviar')).toBeVisible()
})

test('em 320 px a prateleira e o diff de permissões cabem', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await stub(page, { previa: PREVIA_AMPLIA, instalados: INSTALADOS })
  await page.goto('/apps')
  await page.getByTestId('app-card').filter({ hasText: 'CRM Simples' }).getByTestId('app-open').click()
  await expect(page.getByTestId('update-diff')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
