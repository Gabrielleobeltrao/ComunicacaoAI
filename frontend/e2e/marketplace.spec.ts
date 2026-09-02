import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// COMUNIDADE na tela: procedência, permissão e motivo — sempre ditos em voz alta.
//
// O que estes casos protegem: nada é apresentado como "oficial" por omissão, uma
// atualização que amplia permissão mostra o que muda ANTES de qualquer clique, e a
// instalação de template avisa que nada foi criado até alguém aprovar a proposta.
const NOW = new Date(0).toISOString()
const APP = '000000000000000000000a01'
const TPL = '000000000000000000000t01'

const CATALOGO = [
  { id: APP, kind: 'app', slug: 'crm', name: 'CRM Simples', summary: 'contatos', categories: [], latestVersion: '1.0.0', author: 'community', installs: 12, updatedAt: NOW },
  { id: TPL, kind: 'template', slug: 'atendimento', name: 'Atendimento enxuto', summary: 'time pronto', categories: [], latestVersion: '2.0.0', author: 'platform', installs: 3, updatedAt: NOW },
]

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

async function stub(page: Page, opts: { previa?: unknown; meus?: unknown[] } = {}) {
  aprovado = null
  instalouTemplate = false
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
  await page.route('**/api/extensions/catalog**', (r) => r.fulfill({ json: { items: CATALOGO } }))
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
  await page.route('**/api/extensions/installed', (r) => r.fulfill({ json: { items: INSTALADOS } }))
}

test('o catálogo diz de QUEM é cada item — nunca oficial por omissão', async ({ page }) => {
  await stub(page)
  await page.goto('/community')
  const itens = page.getByTestId('catalog-item')
  await expect(itens.first()).toContainText('da comunidade')
  await expect(itens.nth(1)).toContainText('da plataforma')
  await expect(itens.first()).toContainText('12 instalações')
})

test('instalar um template avisa que nada foi criado até a proposta ser aprovada', async ({ page }) => {
  await stub(page)
  await page.goto('/community')
  await page.getByTestId('catalog-item').nth(1).getByTestId('catalog-instalar').click()
  await expect.poll(() => instalouTemplate).toBe(true)
  await expect(page.getByTestId('marketplace-aviso')).toContainText('nada foi criado até você revisar')
})

test('uma atualização que AMPLIA permissão mostra o que muda antes de qualquer clique', async ({ page }) => {
  await stub(page, { previa: PREVIA_AMPLIA })
  await page.goto('/community?tab=installed')
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
  await stub(page, { previa: { ...PREVIA_AMPLIA, permissions: { added: [], removed: [], changed: [], needsApproval: false } } })
  await page.goto('/community?tab=installed')
  await expect(page.getByTestId('update-aprovar')).toHaveCount(0)
  await page.getByTestId('update-aplicar').click()
  await expect.poll(() => aprovado).toEqual({ approvePermissions: false })
})

test('a versão instalada aparece como FIXADA', async ({ page }) => {
  await stub(page)
  await page.goto('/community?tab=installed')
  await expect(page.getByTestId('installed-item')).toContainText('v1.0.0 (fixada)')
})

test('o motivo de uma suspensão fica visível em Minhas criações', async ({ page }) => {
  await stub(page, {
    meus: [
      { _id: 'p1', kind: 'app', slug: 'crm', name: 'CRM Simples', summary: '', visibility: 'community', status: 'suspended', latestVersion: '1.0.0', suspendedReason: 'domínio trocado sem aviso', updatedAt: NOW },
    ],
  })
  await page.goto('/community?tab=mine')
  await expect(page.getByTestId('my-package')).toContainText('domínio trocado sem aviso')
})
