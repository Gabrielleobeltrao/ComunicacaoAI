// E2E: the Apps the owner writes themselves — "Meus Apps".
//
// A private App is a MANIFEST, so the screen edits JSON. What is pinned here: an
// invalid manifest is refused with the reason on screen and nothing is created; the
// export carries no credential; and deleting is refused while a connection or a grant
// still points at the App — archiving is offered instead of a broken account.
import { test, expect, type Page } from '@playwright/test'

const MANIFEST = {
  key: 'minha_loja',
  version: '1.0.0',
  name: 'Minha Loja',
  description: 'Consulta pedidos.',
  categories: ['vendas'],
  auth: { kind: 'api_key', fields: [{ key: 'apiKey', label: 'Chave de API', required: true, secret: true }] },
  allowedDomains: ['api.minhaloja.com'],
  supportsMultipleConnections: false,
  actions: [{ key: 'buscar_pedido', name: 'Buscar pedido', description: 'Busca um pedido.', risk: 'read', inputSchema: {}, resourceFields: [] }],
  surfaces: [],
  pinnable: false,
  defaultSurfaceKey: null,
  dataAccess: [],
  storageNote: null,
  disconnectNote: null,
  providerCostNote: null,
  source: 'private',
  status: 'published',
  icon: null,
  documentationUrl: null,
}

let posted: Record<string, unknown> | null = null
let archived: { key: string; archived: boolean } | null = null
let deleted: string | null = null

async function stub(page: Page, opts: { apps?: unknown[]; impact?: Record<string, number | boolean>; createError?: string } = {}) {
  posted = null
  archived = null
  deleted = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))

  // Routes match in reverse registration order: the generic list route goes FIRST so
  // the specific ones below still win.
  await page.route('**/api/apps/private', (r) => {
    if (r.request().method() === 'POST') {
      posted = r.request().postDataJSON() as Record<string, unknown>
      return opts.createError
        ? r.fulfill({ status: 400, json: { message: opts.createError } })
        : r.fulfill({ status: 201, json: MANIFEST })
    }
    return r.fulfill({ json: opts.apps ?? [] })
  })
  await page.route('**/api/apps/private/*/export', (r) => r.fulfill({ json: { ...MANIFEST, status: 'draft' } }))
  await page.route('**/api/apps/private/*/impact', (r) =>
    r.fulfill({ json: opts.impact ?? { installations: 0, connectedInstallations: 0, agents: 0, archived: false } }),
  )
  await page.route('**/api/apps/private/*/archive', (r) => {
    const key = r.request().url().split('/private/')[1].split('/')[0]
    archived = { key, archived: (r.request().postDataJSON() as { archived: boolean }).archived }
    return r.fulfill({ json: { ...MANIFEST, status: archived.archived ? 'suspended' : 'published' } })
  })
  await page.route('**/api/apps/private/*', (r) => {
    if (r.request().method() === 'DELETE') {
      deleted = r.request().url()
      return r.fulfill({ json: { deleted: true } })
    }
    return r.fulfill({ json: MANIFEST })
  })

  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/app-installations**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/tools**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  const now = new Date().toISOString()
  await page.route('**/api/building', (r) => r.fulfill({ json: { id: 'b1', name: 'Prédio', floors: [] } }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: now, updatedAt: now }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
}

const open = async (page: Page) => {
  await page.goto('/apps?tab=mine')
  await expect(page.getByTestId('private-apps')).toBeVisible()
}

test('sem nenhum App próprio, a tela explica o que é um App seu', async ({ page }) => {
  await stub(page)
  await open(page)
  await expect(page.getByText('Nenhum App seu ainda')).toBeVisible()
  await expect(page.getByText(/manifesto/i)).toBeVisible()
})

test('criar um App envia o manifesto e ele passa a aparecer na lista', async ({ page }) => {
  await stub(page)
  await open(page)
  await page.getByTestId('create-private-app').click()
  // O editor já vem com um exemplo válido — não é uma caixa em branco.
  await expect(page.getByTestId('manifest-json')).toContainText('"key"')

  await page.route('**/api/apps/private', (r) =>
    r.request().method() === 'POST'
      ? ((posted = r.request().postDataJSON() as Record<string, unknown>), r.fulfill({ status: 201, json: MANIFEST }))
      : r.fulfill({ json: [MANIFEST] }),
  )
  await page.getByTestId('save-manifest').click()
  await expect(page.getByTestId('private-app-card')).toContainText('Minha Loja')
  expect(posted).toBeTruthy()
})

test('JSON quebrado é dito na hora, sem mandar nada para o servidor', async ({ page }) => {
  await stub(page)
  await open(page)
  await page.getByTestId('create-private-app').click()
  await page.getByTestId('manifest-json').fill('{ isso não é json')
  await page.getByTestId('save-manifest').click()
  await expect(page.getByTestId('manifest-error')).toContainText(/JSON está inválido/)
  expect(posted).toBeNull()
})

test('manifesto recusado pelo servidor mostra o motivo e não cria nada', async ({ page }) => {
  await stub(page, { createError: 'ação "buscar_pedido": domínio não declarado em allowedDomains' })
  await open(page)
  await page.getByTestId('create-private-app').click()
  await page.getByTestId('save-manifest').click()
  await expect(page.getByTestId('manifest-error')).toContainText(/allowedDomains/)
  // O editor continua aberto com o texto do dono: nada foi perdido.
  await expect(page.getByTestId('manifest-json')).toBeVisible()
})

test('exportar mostra o manifesto e diz que ele não leva credencial', async ({ page }) => {
  await stub(page, { apps: [MANIFEST] })
  await open(page)
  await page.getByTestId('export-minha_loja').click()
  const json = await page.getByTestId('export-json').inputValue()
  expect(json).toContain('"key": "minha_loja"')
  // O manifesto DECLARA o campo de credencial (o nome, o rótulo, que é segredo) —
  // é isso que quem importa precisa saber preencher. O que ele nunca leva é um
  // VALOR: nenhum config, nenhum encryptedConfig, nenhuma conexão junto.
  expect(json).toContain('"key": "apiKey"')
  expect(json).toContain('"secret": true')
  expect(json).not.toContain('encryptedConfig')
  expect(json).not.toContain('"config"')
  expect(json).not.toContain('installation')
  // E volta como rascunho: importar não é conectar.
  expect(json).toContain('"status": "draft"')
  await expect(page.getByText(/não contém credencial nenhuma/)).toBeVisible()
})

test('excluir é recusado enquanto houver conexão ou permissão, e oferece arquivar', async ({ page }) => {
  await stub(page, { apps: [MANIFEST], impact: { installations: 2, connectedInstallations: 1, agents: 3, archived: false } })
  await open(page)
  await page.getByTestId('delete-minha_loja').click()
  await expect(page.getByTestId('delete-blocked')).toContainText('2 conexão(ões)')
  await expect(page.getByTestId('delete-blocked')).toContainText('3 agente(s)')
  // Não existe botão de excluir aqui: o caminho oferecido é o que não quebra nada.
  await expect(page.getByTestId('confirm-delete')).toHaveCount(0)

  await page.getByTestId('archive-instead').click()
  await expect.poll(() => archived).toEqual({ key: 'minha_loja', archived: true })
  expect(deleted).toBeNull()
})

test('sem nada apontando para ele, a exclusão é confirmada e executada', async ({ page }) => {
  await stub(page, { apps: [MANIFEST] })
  await open(page)
  await page.getByTestId('delete-minha_loja').click()
  await expect(page.getByText(/Nenhuma conexão nem permissão/)).toBeVisible()
  await page.getByTestId('confirm-delete').click()
  await expect.poll(() => deleted).toContain('minha_loja')
})

test('um App arquivado se anuncia como fora do catálogo, sem sumir', async ({ page }) => {
  await stub(page, { apps: [{ ...MANIFEST, status: 'suspended' }] })
  await open(page)
  await expect(page.getByTestId('private-app-card')).toContainText('arquivado')
  await expect(page.getByText(/conexões e permissões existentes continuam funcionando/i)).toBeVisible()
  await page.getByTestId('archive-minha_loja').click()
  await expect.poll(() => archived).toEqual({ key: 'minha_loja', archived: false })
})

test('editar carrega o manifesto atual em vez de uma caixa vazia', async ({ page }) => {
  await stub(page, { apps: [MANIFEST] })
  await open(page)
  await page.getByTestId('edit-minha_loja').click()
  await expect(page.getByTestId('manifest-json')).toHaveValue(/"name": "Minha Loja"/)
})
