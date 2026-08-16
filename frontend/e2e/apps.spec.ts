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
  activation: 'credentials',
  activationRoute: null,
  installationCount: 0,
  connected: false,
}

const WHATSAPP = {
  ...SLACK,
  key: 'whatsapp',
  name: 'WhatsApp',
  description: 'Atendimento no WhatsApp pelo seu provedor.',
  categories: ['atendimento'],
  auth: { kind: 'api_key', fields: [], scopes: [], documentationUrl: null },
  allowedDomains: [],
  actions: [],
  surfaces: [
    { key: 'channels', label: 'Números', description: 'Conectar provedor e número.', icon: null, scope: 'account', routeSegment: 'channels' },
    { key: 'conversations', label: 'Conversas WhatsApp', description: 'Conversas recebidas.', icon: null, scope: 'account', routeSegment: 'conversations' },
  ],
  pinnable: true,
  defaultSurfaceKey: 'channels',
  // Cannot be created by the generic form: it needs a real number and provider.
  activation: 'managed_channel',
  activationRoute: '/apps/whatsapp/channels',
  requiresAuth: true,
  connected: false,
}

const GOOGLE = {
  ...SLACK,
  key: 'google',
  name: 'Google',
  description: 'Agenda e planilhas da sua conta Google.',
  categories: ['produtividade'],
  auth: { kind: 'oauth2', fields: [], scopes: ['https://www.googleapis.com/auth/calendar'], documentationUrl: null },
  activation: 'oauth',
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
let pinnedSent: string[] | null = null

async function stub(
  page: Page,
  opts: { installations?: unknown[]; navigation?: unknown[]; access?: { ok: boolean; reason?: string; appName?: string; activationRoute?: string } } = {},
) {
  created = null
  disconnected = null
  pinnedSent = null
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
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: opts.navigation ?? [], pinned: [] } }))
  // The surface guard asks this before rendering any App page.
  await page.route('**/api/apps/*/surfaces/*/access', (r) => {
    const access = opts.access ?? { ok: true }
    return access.ok ? r.fulfill({ json: access }) : r.fulfill({ status: 403, json: access })
  })
  await page.route('**/api/me/navigation-preferences/pinned-apps', (r) => {
    pinnedSent = (r.request().postDataJSON() as { pinnedApps: string[] }).pinnedApps
    return r.fulfill({ json: { pinnedApps: pinnedSent.map((appKey, order) => ({ appKey, order })), maxPinnedApps: 6 } })
  })
  await page.route('**/api/apps/*/overview', (r) =>
    r.fulfill({
      json: {
        appKey: 'web_chat',
        channels: [{ id: 'w1', name: 'Site', agentId: null, sectorId: null, ready: true }],
        conversations: 12,
        conversations7d: 4,
        messages7d: 33,
        handoffs: 1,
        avgResponseMs: 42_000,
        lastMessageAt: '2026-01-02T10:00:00.000Z',
      },
    }),
  )
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
  // Desconectar não é a ação do dia a dia: mora atrás da engrenagem, com o resto do
  // que se faz raramente com uma conexão.
  await page.getByTestId('settings-slack').click()
  await expect(page.getByTestId('connection-settings')).toBeVisible()
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

// --- fixar no menu ---------------------------------------------------------------

const WEB_CHAT_INSTALLATION = { ...INSTALLATION, id: 'inst-web', appKey: 'web_chat', name: 'Chat Web', agentCount: 0 }
const WEB_CHAT_APP = {
  ...SLACK,
  key: 'web_chat',
  name: 'Chat Web',
  description: 'Atendimento no seu site.',
  auth: { kind: 'none', fields: [], scopes: [], documentationUrl: null },
  allowedDomains: [],
  actions: [],
  surfaces: [
    { key: 'widgets', label: 'Widgets', description: 'Instalar o widget.', icon: null, scope: 'account', routeSegment: 'widgets' },
    { key: 'conversations', label: 'Conversas Web', description: 'Conversas do site.', icon: null, scope: 'account', routeSegment: 'conversations' },
  ],
  pinnable: true,
  defaultSurfaceKey: 'widgets',
  activation: 'instant',
  activationRoute: null,
  requiresAuth: false,
  connected: true,
}

const NAV_WEB_CHAT = {
  appKey: 'web_chat',
  name: 'Chat Web',
  icon: 'message-circle',
  pinned: true,
  order: 0,
  status: 'ready',
  defaultSurfaceKey: 'widgets',
  surfaces: [
    { key: 'widgets', label: 'Widgets', description: 'Instalar o widget.', icon: null, path: '/apps/web-chat/widgets' },
    { key: 'conversations', label: 'Conversas Web', description: 'Conversas do site.', icon: null, path: '/apps/web-chat/conversations' },
  ],
}

test('fixar um App é atalho: manda só a preferência de navegação', async ({ page }) => {
  await stub(page, { installations: [WEB_CHAT_INSTALLATION] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WEB_CHAT_APP] }))
  await page.goto('/apps?tab=connected')
  await page.getByTestId('pin-web_chat').click()
  await expect.poll(() => pinnedSent).toEqual(['web_chat'])
  // Nada de conexão foi tocado.
  expect(created).toBeNull()
})

test('o App fixado aparece no menu na hora, sem recarregar a página', async ({ page }) => {
  await stub(page, { installations: [WEB_CHAT_INSTALLATION] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WEB_CHAT_APP] }))
  // Antes de fixar, o menu não tem nada; depois de salvar, o servidor passa a
  // devolvê-lo. A questão é se o sidebar percebe.
  let navApps: unknown[] = []
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: navApps, pinned: [] } }))
  await page.route('**/api/me/navigation-preferences/pinned-apps', (r) => {
    pinnedSent = (r.request().postDataJSON() as { pinnedApps: string[] }).pinnedApps
    navApps = pinnedSent.includes('web_chat') ? [NAV_WEB_CHAT] : []
    return r.fulfill({ json: { pinnedApps: pinnedSent.map((appKey, order) => ({ appKey, order })), maxPinnedApps: 6 } })
  })

  await page.goto('/apps?tab=connected')
  await expect(page.getByTestId('pinned-app-web_chat')).toHaveCount(0)
  await page.getByTestId('pin-web_chat').click()
  // O sidebar e a página de Apps liam cada um o seu estado; só o F5 reconciliava.
  await expect(page.getByTestId('pinned-app-web_chat')).toBeVisible()
})

test('o App fixado vira grupo no menu com as suas páginas', async ({ page }) => {
  await stub(page, { installations: [WEB_CHAT_INSTALLATION], navigation: [NAV_WEB_CHAT] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WEB_CHAT_APP] }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/apps')
  const rail = page.getByTestId('pinned-apps')
  await expect(rail).toBeVisible()
  const parent = page.getByTestId('pinned-app-web_chat')
  await expect(parent).toBeVisible()
  // O rail é só de ícones até o hover; o chevron abre as subpáginas do App.
  await parent.hover()
  await page.getByTestId('toggle-web_chat').click()
  await page.getByTestId('surface-web_chat-conversations').click()
  await expect(page).toHaveURL(/\/apps\/web-chat\/conversations/)
})

test('/widgets e /chats continuam funcionando e preservam o filtro', async ({ page }) => {
  await stub(page)
  await page.goto('/widgets')
  await expect(page).toHaveURL(/\/apps\/web-chat\/widgets/)

  await page.goto('/chats?search=pedido')
  await expect(page).toHaveURL(/\/apps\/web-chat\/conversations\?search=pedido/)

  await page.goto('/widgets?channel=whatsapp')
  await expect(page).toHaveURL(/\/apps\/whatsapp\/channels/)
})

// --- ativação por canal real ------------------------------------------------------

test('WhatsApp não oferece formulário: o CTA leva ao fluxo do número', async ({ page }) => {
  await stub(page)
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WHATSAPP] }))
  await page.goto('/apps')

  // O card já diz o que vai acontecer.
  await expect(page.getByTestId('app-card')).toContainText('Conectar número')
  await page.getByTestId('app-open').click()

  const detail = page.getByTestId('app-detail')
  // Nenhum campo de credencial: criar por aqui produziria uma conexão vazia.
  await expect(detail.getByTestId('connect-app')).toHaveCount(0)
  await expect(detail).toContainText('ativo quando houver ao menos um número conectado')

  await page.getByTestId('connect-managed-channel').click()
  await expect(page).toHaveURL(/\/apps\/whatsapp\/channels/)
  // E nada foi criado no caminho.
  expect(created).toBeNull()
})

test('um canal não é descrito como entrega de rotina', async ({ page }) => {
  await stub(page)
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WHATSAPP] }))
  await page.goto('/apps')
  await expect(page.getByTestId('app-card')).toContainText('Canal de atendimento')
  await expect(page.getByTestId('app-card')).not.toContainText('entregas das rotinas')
})

// --- guard das superfícies ---------------------------------------------------------

test('URL direta não abre página de App inativo: leva a /apps e explica', async ({ page }) => {
  await stub(page, { access: { ok: false, reason: 'inactive', appName: 'WhatsApp' } })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WHATSAPP] }))
  await page.goto('/apps/whatsapp/channels')
  await expect(page).toHaveURL(/\/apps\?inactive=whatsapp/)
  await expect(page.getByTestId('inactive-notice')).toContainText('ainda não está ativo')
})

test('conexão quebrada abre tela segura de reconexão, não a página operacional', async ({ page }) => {
  await stub(page, { access: { ok: false, reason: 'needs_reauth', appName: 'WhatsApp', activationRoute: '/apps/whatsapp/channels' } })
  await page.goto('/apps/whatsapp/conversations')
  await expect(page.getByTestId('surface-needs-reauth')).toContainText('precisa ser reconectado')
  // A página operacional não aparece.
  await expect(page.getByTestId('conversations-panel')).toHaveCount(0)
  await expect(page.getByTestId('surface-reconnect')).toBeVisible()
})

test('App desconhecido simplesmente não é uma página', async ({ page }) => {
  await stub(page, { access: { ok: false, reason: 'unknown' } })
  await page.goto('/apps/web-chat/widgets')
  await expect(page).toHaveURL(/\/apps$/)
})

test('com App ativo, a página abre normalmente', async ({ page }) => {
  await stub(page, { access: { ok: true } })
  await page.goto('/apps/web-chat/widgets')
  await expect(page.getByRole('heading', { name: 'Chat Web · Widgets' })).toBeVisible()
})

test('falha de rede no guard não abre a página por engano', async ({ page }) => {
  await stub(page)
  await page.route('**/api/apps/*/surfaces/*/access', (r) => r.abort())
  await page.goto('/apps/whatsapp/channels')
  await expect(page.getByTestId('surface-needs-reauth')).toBeVisible()
})

// --- visão geral dos canais ---------------------------------------------------------

test('a Visão geral do canal mostra números medidos e atalhos', async ({ page }) => {
  await stub(page, { access: { ok: true } })
  await page.goto('/apps/web-chat/overview')
  const metrics = page.getByTestId('overview-metrics')
  await expect(metrics).toContainText('Conversas')
  await expect(metrics).toContainText('12')
  await expect(metrics).toContainText('Resposta média')
  await expect(metrics).toContainText('42.0s')
  await expect(page.getByTestId('overview-channels')).toContainText('Site')
  await expect(page.getByTestId('overview-manage')).toBeVisible()
})

test('a Visão geral também passa pelo guard', async ({ page }) => {
  await stub(page, { access: { ok: false, reason: 'inactive', appName: 'WhatsApp' } })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WHATSAPP] }))
  await page.goto('/apps/whatsapp/overview')
  await expect(page).toHaveURL(/\/apps\?inactive=whatsapp/)
})

// --- pin --------------------------------------------------------------------------

test('erro ao fixar aparece na tela, em vez de sumir', async ({ page }) => {
  await stub(page, { installations: [WEB_CHAT_INSTALLATION] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WEB_CHAT_APP] }))
  await page.route('**/api/me/navigation-preferences/pinned-apps', (r) =>
    r.fulfill({ status: 400, json: { message: 'Chat Web precisa estar conectado para ser fixado' } }),
  )
  await page.goto('/apps?tab=connected')
  await page.getByTestId('pin-web_chat').click()
  await expect(page.getByTestId('connected-list')).toContainText('precisa estar conectado para ser fixado')
})

test('conexão quebrada não oferece fixar', async ({ page }) => {
  await stub(page, { installations: [{ ...WEB_CHAT_INSTALLATION, status: 'needs_reauth' }] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WEB_CHAT_APP] }))
  await page.goto('/apps?tab=connected')
  await expect(page.getByTestId('connected-list')).toBeVisible()
  await expect(page.getByTestId('pin-web_chat')).toHaveCount(0)
})

test('o modal oferece fixar depois de ativado', async ({ page }) => {
  await stub(page, { installations: [WEB_CHAT_INSTALLATION] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WEB_CHAT_APP] }))
  await page.goto('/apps')
  await page.getByTestId('app-open').click()
  await expect(page.getByTestId('pin-from-detail')).toBeVisible()
  await page.getByTestId('pin-from-detail').click()
  await expect.poll(() => pinnedSent).toEqual(['web_chat'])
})

// --- drawer mobile ------------------------------------------------------------------

test('no mobile, o App fixado é UM item-pai expansível — não uma lista achatada', async ({ page }) => {
  await stub(page, { installations: [WEB_CHAT_INSTALLATION], navigation: [NAV_WEB_CHAT] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WEB_CHAT_APP] }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/apps')

  await page.getByRole('button', { name: /menu/i }).first().click()
  const group = page.getByTestId('mobile-pinned-apps')
  await expect(group).toBeVisible()

  // Um item-pai, não uma entrada por página.
  await expect(page.getByTestId('mobile-app-web_chat')).toHaveCount(1)
  await expect(group).toContainText('Chat Web')
  // As subpáginas começam recolhidas.
  await expect(page.getByTestId('mobile-surface-web_chat-conversations')).toHaveCount(0)

  await page.getByTestId('mobile-toggle-web_chat').click()
  await expect(page.getByTestId('mobile-surface-web_chat-conversations')).toBeVisible()
  await expect(page.getByTestId('mobile-surface-web_chat-widgets')).toBeVisible()
})

test('o chevron do App tem alvo de toque adequado', async ({ page }) => {
  await stub(page, { installations: [WEB_CHAT_INSTALLATION], navigation: [NAV_WEB_CHAT] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WEB_CHAT_APP] }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/apps')
  await page.getByRole('button', { name: /menu/i }).first().click()

  const box = (await page.getByTestId('mobile-toggle-web_chat').boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(40)
  expect(box.height).toBeGreaterThanOrEqual(40)
})

test('cada App tem um logo, e o mesmo símbolo aparece no menu', async ({ page }) => {
  await stub(page, { installations: [WEB_CHAT_INSTALLATION], navigation: [NAV_WEB_CHAT] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WEB_CHAT_APP] }))
  await page.goto('/apps')

  // No catálogo: um símbolo próprio do App, não um quadrado vazio.
  const logo = page.locator('[data-app-logo="web_chat"]').first()
  await expect(logo).toBeVisible()
  await expect(logo.locator('svg')).toHaveCount(1)

  // No menu lateral: o mesmo App, desenhado pelo mesmo componente. Antes o menu
  // mandava o nome da marca para um conjunto de ícones que só tem glifos de traço,
  // e o resultado era um espaço em branco.
  const noMenu = page.getByTestId('pinned-app-web_chat').locator('svg, [data-icon]').first()
  await expect(noMenu).toBeVisible()
})

test('App sem marca própria cai no glifo do manifesto, nunca num vazio', async ({ page }) => {
  const semMarca = { ...WEB_CHAT_APP, key: 'app_sem_marca', name: 'App Sem Marca', icon: 'blocks' }
  await stub(page)
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [semMarca] }))
  await page.goto('/apps')
  await expect(page.getByTestId('app-card')).toContainText('App Sem Marca')
  // Sem quadrado de marca, mas com um símbolo desenhado.
  await expect(page.locator('[data-app-logo="app_sem_marca"]')).toHaveCount(0)
  await expect(page.getByTestId('app-card').locator('[data-icon="blocks"]')).toBeVisible()
})

test('o cartão da conexão tem uma ação em cada ponta, e o resto na engrenagem', async ({ page }) => {
  await stub(page, { installations: [WEB_CHAT_INSTALLATION] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [WEB_CHAT_APP] }))
  await page.goto('/apps?tab=connected')
  const card = page.getByTestId('installation-card').first()

  // Testar à esquerda, fixar à direita, na MESMA linha.
  const [testar, fixar] = await Promise.all([
    card.getByRole('button', { name: /Testar conexão/ }).boundingBox(),
    card.getByTestId('pin-web_chat').boundingBox(),
  ])
  expect(Math.abs(testar!.y - fixar!.y)).toBeLessThan(4)
  expect(fixar!.x).toBeGreaterThan(testar!.x)

  // Renomear, reconectar e desconectar saíram da fileira — eram cinco botões de
  // mesmo peso numa linha que quebrava.
  await expect(card.getByRole('button', { name: 'Renomear' })).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Reconectar' })).toHaveCount(0)

  await page.getByTestId('settings-web_chat').click()
  const popup = page.getByTestId('connection-settings')
  await expect(popup).toBeVisible()
  for (const acao of ['action-rename', 'action-reconnect', 'disconnect']) {
    await expect(popup.getByTestId(acao)).toBeVisible()
  }
  // Cada ação diz o que faz, em vez de ser só um rótulo.
  await expect(popup.getByTestId('action-reconnect')).toContainText(/permissões dos agentes/i)
})

test('renomear abre a partir da engrenagem', async ({ page }) => {
  await stub(page, { installations: [INSTALLATION] })
  await page.goto('/apps?tab=connected')
  await page.getByTestId('settings-slack').click()
  await page.getByTestId('action-rename').click()
  // O popup de configurações fecha e o de renomear assume: nunca os dois abertos.
  await expect(page.getByTestId('connection-settings')).toHaveCount(0)
  await expect(page.getByRole('textbox').first()).toBeVisible()
})
