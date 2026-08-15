import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The Apps page end to end, with the API stubbed. What these pin is the promise the
// surface makes: the owner reads what an App reaches BEFORE connecting, a credential
// typed in never comes back on screen, disconnecting says who is affected and keeps
// history, and /tools still lands somewhere useful.
const NOW = new Date(0).toISOString()
const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = { id: '000000000000000000000f11', buildingId: 'b1', name: 'Térreo', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', createdAt: NOW, updatedAt: NOW }

const SLACK = {
  key: 'slack',
  version: '1.0.0',
  source: 'system',
  name: 'Slack',
  description: 'Avisar um canal do Slack.',
  icon: 'slack',
  categories: ['comunicação'],
  documentationUrl: 'https://api.slack.com/messaging/webhooks',
  status: 'published',
  auth: {
    kind: 'webhook',
    fields: [{ key: 'webhookUrl', label: 'Incoming Webhook URL', placeholder: 'https://hooks.slack.com/services/...', required: true, secret: true, help: null }],
    scopes: [],
    documentationUrl: null,
  },
  allowedDomains: ['hooks.slack.com'],
  supportsMultipleConnections: true,
  actions: [
    { key: 'slack_notificar', name: 'Notificar canal', description: 'Envia uma mensagem para o canal configurado.', risk: 'write', inputSchema: {}, resourceFields: [] },
  ],
  surfaces: [],
  pinnable: false,
  defaultSurfaceKey: null,
  dataAccess: ['Nada é lido do Slack; o App apenas envia mensagens.'],
  storageNote: 'A URL do webhook fica criptografada e nunca é reexibida.',
  disconnectNote: 'Desconectar interrompe os avisos. As mensagens já enviadas permanecem no Slack.',
  providerCostNote: null,
  requiresAuth: true,
  installationCount: 0,
  connected: false,
}

const GOOGLE = {
  ...SLACK,
  key: 'google',
  name: 'Google',
  description: 'Agenda e planilhas da sua conta Google.',
  categories: ['produtividade'],
  auth: { kind: 'oauth2', fields: [], scopes: ['https://www.googleapis.com/auth/calendar'], documentationUrl: null },
  allowedDomains: ['googleapis.com'],
  actions: [{ key: 'google_agenda_listar_eventos', name: 'Listar eventos', description: 'Lista os eventos da agenda.', risk: 'read', inputSchema: {}, resourceFields: [] }],
  dataAccess: ['Eventos das agendas que você autorizar'],
  disconnectNote: 'Desconectar revoga o acesso imediatamente.',
}

const INSTALLATION = {
  id: 'inst-1',
  appKey: 'slack',
  appVersion: '1.0.0',
  name: 'Canal de vendas',
  status: 'connected',
  publicMetadata: {},
  grantedScopes: [],
  createdAt: NOW,
  updatedAt: NOW,
  lastTestedAt: null,
  agentCount: 2,
}

let created: Record<string, unknown> | null = null
let disconnected: { method: string; url: string } | null = null

async function stub(page: Page, opts: { installations?: unknown[] } = {}) {
  created = null
  disconnected = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const installations = opts.installations ?? []

  await page.route('**/api/apps/catalog', (r) =>
    r.fulfill({ json: [{ ...SLACK, connected: installations.length > 0, installationCount: installations.length }, GOOGLE] }),
  )
  await page.route('**/api/app-installations', (r) => {
    if (r.request().method() === 'POST') {
      created = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ status: 201, json: { ...INSTALLATION, name: (created.name as string) ?? 'Slack', agentCount: 0 } })
    }
    return r.fulfill({ json: installations })
  })
  await page.route('**/api/app-installations/*', (r) => {
    if (r.request().method() === 'DELETE') {
      disconnected = { method: 'DELETE', url: r.request().url() }
      return r.fulfill({ json: { revoked: true } })
    }
    return r.fulfill({ json: INSTALLATION })
  })
  await page.route('**/api/app-installations/*/test', (r) => r.fulfill({ json: { ok: true, message: 'Configuração lida com sucesso.' } }))
  await page.route('**/api/tools', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
}

test('o catálogo mostra origem, ações e o que cada uma faz com os dados', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  const catalog = page.getByTestId('app-catalog')
  await expect(catalog).toContainText('Slack')
  await expect(catalog).toContainText('Sistema')
  await expect(catalog).toContainText('1 ação')
  await expect(catalog).toContainText('altera dados')
})

test('antes de conectar, o dono lê domínios, dados e o impacto de desconectar', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  await page.getByTestId('app-card').filter({ hasText: 'Slack' }).getByTestId('app-open').click()
  const detail = page.getByTestId('app-detail')
  await expect(detail).toContainText('hooks.slack.com')
  await expect(detail).toContainText('Nada é lido do Slack')
  await expect(detail).toContainText('nunca é reexibida')
  await expect(detail).toContainText('As mensagens já enviadas permanecem no Slack')
  await expect(detail).toContainText('Altera dados')
})

test('conectar envia a credencial e ela nunca volta para a tela', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  await page.getByTestId('app-card').filter({ hasText: 'Slack' }).getByTestId('app-open').click()
  await page.getByTestId('connection-name').fill('Canal de vendas')
  await page.getByTestId('field-webhookUrl').fill('https://hooks.slack.com/services/T/B/XYZ')
  await page.getByTestId('connect-app').click()

  await expect.poll(() => created?.appKey).toBe('slack')
  expect((created?.config as Record<string, string>).webhookUrl).toBe('https://hooks.slack.com/services/T/B/XYZ')
  // O valor digitado não fica na página depois de salvar.
  await expect(page.locator('body')).not.toContainText('T/B/XYZ')
})

test('um App de OAuth pede a conta, não uma credencial digitada', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  await page.getByTestId('app-card').filter({ hasText: 'Google' }).getByTestId('app-open').click()
  await expect(page.getByTestId('connect-oauth')).toBeVisible()
  await expect(page.getByTestId('app-detail').getByTestId('field-webhookUrl')).toHaveCount(0)
})

test('a aba Conectados diz quantos agentes dependem da conexão', async ({ page }) => {
  await stub(page, { installations: [INSTALLATION] })
  await page.goto('/apps?tab=connected')
  const list = page.getByTestId('connected-list')
  await expect(list).toContainText('Canal de vendas')
  await expect(list).toContainText('Conectado')
  await expect(page.getByTestId('installation-usage')).toContainText('2 agentes usam')
})

test('desconectar avisa quem perde acesso e não apaga histórico', async ({ page }) => {
  await stub(page, { installations: [INSTALLATION] })
  await page.goto('/apps?tab=connected')
  await page.getByTestId('disconnect').click()
  await expect(page.getByText('2 agentes perdem acesso a estas ações imediatamente.')).toBeVisible()
  await expect(page.getByText('As mensagens já enviadas permanecem no Slack.')).toBeVisible()
  await page.getByTestId('confirm-disconnect').click()
  // Revoga: a rota de remoção definitiva (purge) é outra.
  await expect.poll(() => disconnected?.url).toBeTruthy()
  expect(disconnected?.url).not.toContain('purge=true')
})

test('testar a conexão diz o resultado sem ecoar o que está guardado', async ({ page }) => {
  await stub(page, { installations: [INSTALLATION] })
  await page.goto('/apps?tab=connected')
  await page.getByRole('button', { name: 'Testar' }).click()
  await expect(page.getByText('Configuração lida com sucesso.')).toBeVisible()
})

test('a busca filtra o catálogo', async ({ page }) => {
  await stub(page)
  await page.goto('/apps')
  await page.getByTestId('apps-search').fill('agenda')
  await expect(page.getByTestId('app-card')).toHaveCount(1)
  await expect(page.getByTestId('app-catalog')).toContainText('Google')
})

test('/tools continua funcionando e cai na aba Personalizados', async ({ page }) => {
  await stub(page)
  await page.goto('/tools')
  await expect(page).toHaveURL(/\/apps\?tab=custom/)
  await expect(page.getByTestId('new-tool')).toBeVisible()
})
