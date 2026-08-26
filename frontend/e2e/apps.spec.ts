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
  connectable: false,
  streamable: false,
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
  connectable: false,
  streamable: false,
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
let streamCriado: Record<string, unknown> | null = null
const STREAM_BASE = {
  id: 'stream-1',
  installationId: 'inst-1',
  appKey: 'alpaca',
  environment: 'paper',
  symbols: [],
  state: 'connected',
  lastConnectedAt: null,
  lastEventAt: null,
  lastError: null,
  eventCount: 0,
}
let disconnected: { method: string; url: string } | null = null
let pinnedSent: string[] | null = null

async function stub(
  page: Page,
  opts: {
    installations?: unknown[]
    navigation?: unknown[]
    access?: { ok: boolean; reason?: string; appName?: string; activationRoute?: string }
    streams?: unknown[]
    policy?: unknown
  } = {},
) {
  created = null
  streamCriado = null
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
  // Streaming é exceção nesta tela: quase toda conexão é REST e devolve lista vazia.
  await page.route('**/api/streams', (r) => {
    if (r.request().method() === 'POST') {
      streamCriado = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ status: 201, json: { ...STREAM_BASE, ...streamCriado, id: 'stream-novo' } })
    }
    return r.fulfill({ json: opts.streams ?? [] })
  })
  await page.route('**/api/streams/*', (r) => r.fulfill({ status: 204, body: '' }))
  await page.route('**/api/trading-policies/active**', (r) => r.fulfill({ json: opts.policy ?? null }))
  await page.route('**/api/trading-policies', (r) => r.fulfill({ status: 201, json: { id: 'p1', installationId: INSTALLATION.id, agentId: null, version: 3, active: true, rules: {}, createdAt: NOW, updatedAt: NOW } }))
  await page.route('**/api/streams/*/pause', (r) => r.fulfill({ json: { ...(opts.streams?.[0] ?? {}), state: 'paused' } }))
  await page.route('**/api/streams/*/reconnect', (r) => r.fulfill({ json: { ...(opts.streams?.[0] ?? {}), state: 'connecting', lastError: null } }))
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
  // "Oficial", não "Sistema": o dono decide se confia pela procedência, não pela
  // implementação. O valor guardado continua sendo `system`.
  await expect(catalog).toContainText('Oficial')
  await expect(catalog).toContainText('1 ação')
  await expect(catalog).toContainText('altera dados')

  // E os grupos existem: a procedência muda o que o App pode fazer, então oficiais,
  // comunidade e privados não podem aparecer numa lista só.
  await expect(page.getByTestId('app-group-system')).toBeVisible()
  await expect(page.getByTestId('app-group-system')).toContainText('integração nativa')
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
  connectable: false,
  streamable: false,
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

// --- tirar a conexão da lista ------------------------------------------------------------
//
// Desconectar revoga o acesso e MANTÉM o registro, o que é correto: o histórico continua
// fazendo sentido. Só que não havia nenhuma ação para remover a conexão depois disso —
// uma vez desconectada, ela ficava na lista para sempre, sem sequer um botão. Quem
// desconectou e viu o item continuar ali conclui, com razão, que não funcionou.

const REVOGADA = { ...INSTALLATION, status: 'revoked' as const }

test('uma conexão desconectada pode ser removida da lista', async ({ page }) => {
  await stub(page, { installations: [REVOGADA] })
  await page.goto('/apps?tab=connected')

  await page.getByTestId('settings-slack').click()
  // Desconectar já não se aplica — ela JÁ está desconectada. Remover, sim.
  await expect(page.getByTestId('disconnect')).toHaveCount(0)
  await page.getByTestId('action-remove').click()

  await expect(page.getByText('A conexão sai da lista.')).toBeVisible()
  await page.getByTestId('confirm-remove').click()

  // `purge=true` é o que apaga de verdade; sem ele, a rota só revogaria de novo.
  await expect.poll(() => disconnected?.url).toBeTruthy()
  expect(disconnected?.url).toContain('purge=true')
})

test('uma conexão ativa também pode ser removida, com o aviso certo', async ({ page }) => {
  await stub(page, { installations: [INSTALLATION] })
  await page.goto('/apps?tab=connected')

  await page.getByTestId('settings-slack').click()
  await page.getByTestId('action-remove').click()
  // O aviso muda: aqui alguém perde acesso agora.
  await expect(page.getByText('perdem acesso na hora', { exact: false })).toBeVisible()
  await page.getByTestId('confirm-remove').click()
  await expect.poll(() => disconnected?.url).toBeTruthy()
  expect(disconnected?.url).toContain('purge=true')
})

// --- stream de mercado na conexão --------------------------------------------------

const STREAM = {
  id: 'stream-1',
  installationId: INSTALLATION.id,
  appKey: 'slack',
  environment: 'paper',
  symbols: ['PETR4', 'VALE3'],
  state: 'connected',
  lastConnectedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  lastEventAt: new Date(Date.now() - 60_000).toISOString(),
  lastError: null,
  eventCount: 42,
}

test('uma conexão com stream mostra estado, último dado e as ações', async ({ page }) => {
  await stub(page, { installations: [{ ...INSTALLATION, appKey: 'alpaca' }], streams: [STREAM] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [{ ...CORRETORA_STREAM, connected: true, installationCount: 1 }] }))
  await page.goto('/apps?tab=connected')
  const painel = page.getByTestId('stream-panel')
  await expect(painel.getByTestId('stream-state')).toHaveText('Recebendo')
  // "Último dado" é a linha que denuncia um stream conectado e mudo.
  await expect(painel).toContainText('último dado')

  await painel.getByTestId('stream-details-toggle').click()
  // Os ativos viraram um campo editável: trocar é a operação mais comum depois de ligar.
  await expect(painel.getByTestId('stream-edit-symbols')).toHaveValue('PETR4, VALE3')
  await expect(painel.getByTestId('stream-details')).toContainText('simulação')

  await painel.getByTestId('stream-pause').click()
  await expect(painel.getByTestId('stream-state')).toHaveText('Pausado')
  // Pausado foi decisão de alguém: reconectar sozinho anularia a decisão.
  await expect(painel.getByTestId('stream-reconnect')).toBeDisabled()
})

test('a falha do stream aparece na conexão, e reconectar a limpa', async ({ page }) => {
  const comErro = { ...STREAM, state: 'error', lastError: { message: 'conexão encerrada pelo outro lado', at: new Date().toISOString() } }
  await stub(page, { installations: [{ ...INSTALLATION, appKey: 'alpaca' }], streams: [comErro] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [{ ...CORRETORA_STREAM, connected: true, installationCount: 1 }] }))
  await page.goto('/apps?tab=connected')
  await expect(page.getByTestId('stream-error')).toContainText('encerrada pelo outro lado')
  await page.getByTestId('stream-reconnect').click()
  await expect(page.getByTestId('stream-error')).toHaveCount(0)
})

test('uma conexão sem stream não ganha painel nenhum', async ({ page }) => {
  await stub(page, { installations: [INSTALLATION] })
  await page.goto('/apps?tab=connected')
  await expect(page.getByTestId('installation-card').first()).toBeVisible()
  await expect(page.getByTestId('stream-panel')).toHaveCount(0)
})

// --- segurança da conexão ---------------------------------------------------------------

const CORRETORA_CATALOGO = {
  ...SLACK,
  key: 'alpaca',
  name: 'Alpaca (simulação)',
  actions: [
    { key: 'alpaca_conta', name: 'Consultar conta', description: 'Saldo.', risk: 'read', inputSchema: {}, resourceFields: [] },
    { key: 'alpaca_criar_ordem', name: 'Enviar ordem', description: 'Envia ordem.', risk: 'high_risk', inputSchema: {}, resourceFields: [] },
  ],
}

test('a conexão que opera ganha uma seção Segurança, com o resumo do que já vale', async ({ page }) => {
  await stub(page, {
    installations: [{ ...INSTALLATION, appKey: 'alpaca', environment: 'paper' }],
    policy: { id: 'p1', installationId: INSTALLATION.id, agentId: null, version: 2, active: true, rules: { maxOrderValue: 1000, maxOrdersPerDay: 5 }, createdAt: NOW, updatedAt: NOW },
  })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [{ ...CORRETORA_CATALOGO, connected: true, installationCount: 1 }] }))
  await page.goto('/apps?tab=connected')

  // Fechado, ele já conta o que vale: um limite que só aparece depois de abrir não
  // protege ninguém de esquecer que ele existe.
  await expect(page.getByTestId('policy-summary')).toContainText('1.000,00')
  await expect(page.getByTestId('policy-summary')).toContainText('5 operações por dia')

  await page.getByTestId('policy-toggle').click()
  await expect(page.getByTestId('policy-max-value')).toHaveValue('1000')
  // O raro fica recolhido: doze limites na cara é um formulário que ninguém preenche.
  await expect(page.getByTestId('policy-advanced')).toHaveCount(0)
  await page.getByTestId('policy-advanced-toggle').click()
  await expect(page.getByTestId('policy-max-loss')).toBeVisible()
  await expect(page.getByTestId('policy-allowlist')).toBeVisible()
})

test('uma conexão que só lê não tem seção Segurança', async ({ page }) => {
  // Um App cujas ações são todas de leitura não tem política de operação nenhuma.
  await stub(page, { installations: [INSTALLATION] })
  await page.goto('/apps?tab=connected')
  await expect(page.getByTestId('installation-card').first()).toBeVisible()
  await expect(page.getByTestId('policy-panel')).toHaveCount(0)
})

// --- tempo real: do convite ao stream de pé -------------------------------------------

const CORRETORA_STREAM = { ...CORRETORA_CATALOGO, streamable: true }

test('uma conexão que recebe tempo real convida a ligar, e pergunta os ativos', async ({ page }) => {
  // Sem este convite, `ensureStream` existia no servidor e nenhuma tela chamava: o
  // recurso estava pronto e inalcançável.
  await stub(page, { installations: [{ ...INSTALLATION, appKey: 'alpaca', environment: 'paper' }] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [{ ...CORRETORA_STREAM, connected: true, installationCount: 1 }] }))
  await page.goto('/apps?tab=connected')

  await expect(page.getByTestId('stream-panel')).toHaveCount(0)
  await page.getByTestId('stream-cta').click()
  // Ligar sem dizer os ativos não faz sentido: um stream sem símbolo não recebe nada.
  await page.getByTestId('stream-start').click()
  await expect(page.getByTestId('stream-setup-error')).toBeVisible()

  await page.getByTestId('stream-symbols').fill('aapl, msft')
  await page.getByTestId('stream-start').click()
  await expect.poll(() => streamCriado).toMatchObject({ installationId: INSTALLATION.id, symbols: ['AAPL', 'MSFT'] })
  await expect(page.getByTestId('stream-panel')).toBeVisible()
})

test('com stream de pé dá para trocar os ativos, pausar, reconectar e desligar', async ({ page }) => {
  const stream = { ...STREAM_BASE, installationId: INSTALLATION.id, symbols: ['AAPL'], eventCount: 12 }
  await stub(page, { installations: [{ ...INSTALLATION, appKey: 'alpaca', environment: 'paper' }], streams: [stream] })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [{ ...CORRETORA_STREAM, connected: true, installationCount: 1 }] }))
  await page.goto('/apps?tab=connected')

  await expect(page.getByTestId('stream-cta')).toHaveCount(0)
  await page.getByTestId('stream-details-toggle').click()
  await page.getByTestId('stream-edit-symbols').fill('AAPL, VALE3')
  await page.getByTestId('stream-update').click()
  await expect.poll(() => streamCriado).toMatchObject({ symbols: ['AAPL', 'VALE3'] })

  await page.getByTestId('stream-pause').click()
  await expect(page.getByTestId('stream-state')).toHaveText('Pausado')

  // Os detalhes continuam abertos: o botão de desligar mora neles.
  await page.getByTestId('stream-delete').click()
  // Desligar tira o painel e devolve o convite: é o estado de quem não tem tempo real.
  await expect(page.getByTestId('stream-panel')).toHaveCount(0)
  await expect(page.getByTestId('stream-cta')).toBeVisible()
})

test('uma conexão sem tempo real não recebe nem o convite', async ({ page }) => {
  // Oferecer "Ativar tempo real" para um App que não tem seria uma promessa vazia.
  await stub(page, { installations: [INSTALLATION] })
  await page.goto('/apps?tab=connected')
  await expect(page.getByTestId('installation-card').first()).toBeVisible()
  await expect(page.getByTestId('stream-cta')).toHaveCount(0)
  await expect(page.getByTestId('stream-panel')).toHaveCount(0)
})

test('a barra lateral cheia rola só no miolo — marca e conta não saem da tela', async ({ page }) => {
  // Dois Apps fixados COM páginas: é o que enche a barra de verdade, e foi assim que a
  // marca saiu pela cima e o cartão da conta pela baixo, os dois cortados.
  await stub(page, { navigation: [{ ...SLACK, surfaces: [] }], installations: [INSTALLATION] })
  await page.route('**/api/apps/navigation', (r) =>
    r.fulfill({
      json: {
        apps: [
          {
            appKey: 'websocket',
            name: 'WebSocket Genérico',
            icon: 'radio',
            pinned: true,
            order: 0,
            status: 'ready',
            defaultSurfaceKey: 'overview',
            surfaces: [
              { key: 'overview', label: 'Visão geral', description: '', icon: null, path: '/apps/websocket/overview' },
              { key: 'messages', label: 'Mensagens', description: '', icon: null, path: '/apps/websocket/messages' },
              { key: 'subscriptions', label: 'Assinaturas', description: '', icon: null, path: '/apps/websocket/subscriptions' },
              { key: 'live', label: 'Dado ao vivo', description: '', icon: null, path: '/apps/websocket/live' },
              { key: 'logs', label: 'Logs', description: '', icon: null, path: '/apps/websocket/logs' },
            ],
          },
          {
            appKey: 'web_chat',
            name: 'Chat Web',
            icon: 'message-circle',
            pinned: true,
            order: 1,
            status: 'ready',
            defaultSurfaceKey: 'overview',
            surfaces: [
              { key: 'overview', label: 'Visão geral', description: '', icon: null, path: '/apps/web-chat/overview' },
              { key: 'widgets', label: 'Widgets', description: '', icon: null, path: '/apps/web-chat/widgets' },
              { key: 'conversations', label: 'Conversas', description: '', icon: null, path: '/apps/web-chat/conversations' },
            ],
          },
        ],
      },
    }),
  )

  // Tela BAIXA: é onde a conta não fecha. Numa tela alta sobra espaço e nada prova nada.
  await page.setViewportSize({ width: 1440, height: 560 })
  await page.goto('/apps')

  const rail = page.locator('[data-rail]')
  await rail.hover()
  const aside = rail.locator('aside')
  await expect(aside).toBeVisible()

  // Abrir as páginas de um App fixado é o que estoura a altura.
  const abrir = page.getByTestId('toggle-websocket')
  if (await abrir.count()) await abrir.first().click()

  const medida = await page.evaluate(() => {
    const aside = document.querySelector('[data-rail] aside') as HTMLElement
    const marca = aside.firstElementChild as HTMLElement
    const conta = aside.querySelector('a[href="/settings"]') as HTMLElement
    const miolo = aside.querySelector('nav') as HTMLElement
    const a = aside.getBoundingClientRect()
    return {
      marcaDentro: marca.getBoundingClientRect().top >= a.top - 1,
      contaDentro: conta.getBoundingClientRect().bottom <= a.bottom + 1,
      // "A conta não fecha" — medido de um jeito que vale nos dois layouts: com o
      // miolo rolável é ele que estoura; sem ele, quem estoura é a barra inteira.
      apertado: miolo.scrollHeight > miolo.clientHeight || aside.scrollHeight > aside.clientHeight + 1,
      asideRola: aside.scrollHeight > aside.clientHeight + 1,
    }
  })

  // Sem isto o teste não prova nada: numa tela onde tudo cabe, qualquer layout passa.
  expect(medida.apertado, 'a lista não chegou a estourar a altura — o teste não provaria nada').toBe(true)
  expect(medida.marcaDentro, 'a marca saiu pela parte de cima da barra').toBe(true)
  expect(medida.contaDentro, 'o cartão da conta saiu pela parte de baixo da barra').toBe(true)
  expect(medida.asideRola, 'a barra inteira rola em vez de rolar só o miolo').toBe(false)
})
