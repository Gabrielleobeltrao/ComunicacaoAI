import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// O App WebSocket Genérico, nas telas.
//
// O que estas jornadas fixam é o que uma pessoa faz: abrir a visão geral, configurar a
// conexão, ver o que chegou (inclusive o que foi recusado, e por quê), criar uma
// assinatura e ler os logs. Mais o menu: fixado, ele vira um grupo com as quatro
// páginas — e desfixar tira só a navegação.
const NOW = new Date(0).toISOString()
const INSTALLATION_ID = 'ws-inst-1'

const CONFIG = {
  endpoint: 'wss://exemplo.com/stream',
  format: 'json',
  auth: { kind: 'none', name: '', prefix: '', messageTemplate: '' },
  headers: [],
  initialMessages: [],
  protocols: [],
  heartbeat: { enabled: false, native: true, message: '', intervalMs: 30000, timeoutMs: 10000 },
  idleTimeoutMs: 90000,
  connectTimeoutMs: 15000,
  paths: { payload: '', messageId: '', channel: '', occurredAt: '' },
  schema: null,
  filters: [],
  dedupe: 'none',
  maxMessagesPerMinute: 120,
  maxMessageBytes: 16000,
  mapping: [],
  liveKeyPath: '',
  liveTtlSeconds: 300,
  publishThrottleMs: 0,
}

const CONNECTION = {
  id: INSTALLATION_ID,
  name: 'Serviço de pedidos',
  status: 'connected',
  config: CONFIG,
  stream: null,
  messages: { total: 3, accepted: 2, lastAt: NOW },
}

const NAV_WEBSOCKET = {
  appKey: 'websocket',
  name: 'WebSocket Genérico',
  icon: 'radio',
  pinned: true,
  order: 0,
  status: 'ready',
  defaultSurfaceKey: 'overview',
  surfaces: [
    { key: 'overview', label: 'Visão geral', description: 'Conexões e estado.', icon: null, path: '/apps/websocket/overview' },
    { key: 'messages', label: 'Mensagens', description: 'O que chegou.', icon: null, path: '/apps/websocket/messages' },
    { key: 'subscriptions', label: 'Assinaturas', description: 'O que ouvir.', icon: null, path: '/apps/websocket/subscriptions' },
    { key: 'live', label: 'Dado ao vivo', description: 'O último valor de cada chave.', icon: null, path: '/apps/websocket/live' },
    { key: 'logs', label: 'Logs', description: 'Conexão e descarte.', icon: null, path: '/apps/websocket/logs' },
  ],
}

let salvo: Record<string, unknown> | null = null
let quadroEnviado: string | null = null
let assinaturaCriada: Record<string, unknown> | null = null
let assinaturaEditada: Record<string, unknown> | null = null

const ASSINATURA = {
  id: 'sub-1',
  installationId: INSTALLATION_ID,
  name: 'Tudo',
  subscribeMessage: '{"action":"subscribe"}',
  unsubscribeMessage: '{"action":"unsubscribe"}',
  filters: [],
  channel: 'pedidos',
  active: true,
  destination: { kind: 'history' },
  managedAutomationId: null,
  messageCount: 7,
  lastMessageAt: NOW,
}

async function stub(
  page: Page,
  opts: {
    connections?: unknown[]
    messages?: unknown[]
    subscriptions?: unknown[]
    logs?: unknown[]
    teste?: { ok: boolean; message: string }
    navigation?: unknown[]
    access?: { ok: boolean; reason?: string }
    live?: unknown[]
  } = {},
) {
  salvo = null
  quadroEnviado = null
  assinaturaCriada = null
  assinaturaEditada = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))

  await page.route('**/api/websocket/connections', (r) => r.fulfill({ json: opts.connections ?? [CONNECTION] }))
  await page.route('**/api/websocket/connections/*', (r) => {
    if (r.request().method() === 'PATCH') {
      salvo = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ json: { id: INSTALLATION_ID, name: CONNECTION.name, config: CONFIG } })
    }
    return r.fulfill({ json: {} })
  })
  await page.route('**/api/websocket/connections/*/start', (r) =>
    r.fulfill({ status: 201, json: { id: 'stream-1', state: 'connected', lastConnectedAt: NOW, lastEventAt: null, lastError: null, eventCount: 0 } }),
  )
  await page.route('**/api/websocket/check-url', (r) => r.fulfill({ json: { ok: true, message: 'Endereço aceito (exemplo.com).' } }))
  await page.route('**/api/websocket/messages**', (r) => r.fulfill({ json: { total: (opts.messages ?? []).length, items: opts.messages ?? [] } }))
  await page.route('**/api/websocket/subscriptions', (r) => {
    if (r.request().method() === 'POST') {
      assinaturaCriada = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ status: 201, json: { ...assinaturaCriada, id: 'sub-novo', messageCount: 0, lastMessageAt: null, filters: [], active: true } })
    }
    return r.fulfill({ json: opts.subscriptions ?? [] })
  })
  await page.route('**/api/websocket/subscriptions/*/test', (r) => r.fulfill({ json: opts.teste ?? { ok: true, message: 'Chegou uma mensagem compatível com esta assinatura.' } }))
  await page.route('**/api/websocket/subscriptions/*', (r) => {
    if (r.request().method() === 'PATCH') {
      assinaturaEditada = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ json: { ...ASSINATURA, ...assinaturaEditada } })
    }
    return r.fulfill({ status: 204, body: '' })
  })
  // As entidades que um destino pode apontar — só as desta conta chegam aqui.
  await page.route('**/api/websocket/targets', (r) =>
    r.fulfill({
      json: {
        agents: [{ id: 'ag-1', name: 'Ana' }],
        sectors: [{ id: 'st-1', name: 'Suporte' }],
        floors: [{ id: 'an-1', name: 'Térreo' }],
        routines: [{ id: 'rt-1', name: 'Registrar pedido' }],
      },
    }),
  )
  await page.route('**/api/websocket/logs**', (r) => r.fulfill({ json: opts.logs ?? [] }))
  await page.route('**/api/websocket/live**', (r) => r.fulfill({ json: { count: (opts.live ?? []).length, items: opts.live ?? [] } }))
  await page.route('**/api/websocket/connections/*/send', (r) => {
    quadroEnviado = (r.request().postDataJSON() as { frame: string }).frame
    return r.fulfill({ json: { sent: true, message: 'Mensagem enviada.' } })
  })

  // O guarda da página: um App inativo nunca renderiza a tela operacional dele.
  await page.route('**/api/apps/*/surfaces/*/access', (r) => {
    const access = opts.access ?? { ok: true }
    return access.ok ? r.fulfill({ json: access }) : r.fulfill({ status: 403, json: access })
  })
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: opts.navigation ?? [], pinned: [] } }))
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW } }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) => r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }))
}

// --- visão geral ------------------------------------------------------------------------

test('a visão geral mostra a conexão, o estado e o que chegou', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/overview')
  const cartao = page.getByTestId('ws-connection-card')
  await expect(cartao).toContainText('Serviço de pedidos')
  await expect(page.getByTestId('ws-endpoint')).toContainText('wss://exemplo.com/stream')
  await expect(page.getByTestId('ws-counts')).toContainText('3 mensagem')
  // Sem stream, o que existe é o convite para ligar.
  await expect(page.getByTestId('ws-start')).toBeVisible()
  await expect(page.getByTestId('ws-pause')).toHaveCount(0)
})

test('sem conexão nenhuma, a tela explica o que fazer', async ({ page }) => {
  await stub(page, { connections: [] })
  await page.goto('/apps/websocket/overview')
  await expect(page.getByText('Nenhuma conexão configurada')).toBeVisible()
})

test('a configuração esconde o técnico atrás de Avançado', async ({ page }) => {
  // Doze campos de uma vez é um formulário que ninguém preenche.
  await stub(page)
  await page.goto('/apps/websocket/overview')
  await page.getByTestId('ws-configure').click()
  await expect(page.getByTestId('ws-endpoint-input')).toHaveValue('wss://exemplo.com/stream')
  await expect(page.getByTestId('ws-advanced')).toHaveCount(0)

  await page.getByTestId('ws-advanced-toggle').click()
  await expect(page.getByTestId('ws-path-payload')).toBeVisible()
  await expect(page.getByTestId('ws-dedupe')).toBeVisible()
  await expect(page.getByTestId('ws-rate')).toBeVisible()
})

test('a credencial só aparece quando o serviço autentica, e nunca vem preenchida', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/overview')
  await page.getByTestId('ws-configure').click()
  await expect(page.getByTestId('ws-token')).toHaveCount(0)

  await page.getByTestId('ws-auth-kind').selectOption('header')
  await expect(page.getByTestId('ws-auth-name')).toBeVisible()
  // Em branco: ela é guardada cifrada e nunca volta para a tela.
  await expect(page.getByTestId('ws-token')).toHaveValue('')
})

test('o endereço pode ser conferido antes de salvar', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/overview')
  await page.getByTestId('ws-configure').click()
  await page.getByTestId('ws-check-url').click()
  await expect(page.getByTestId('ws-url-result')).toContainText('aceito')
})

test('salvar manda a configuração — e o segredo só quando ele foi digitado', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/overview')
  await page.getByTestId('ws-configure').click()
  await page.getByTestId('ws-endpoint-input').fill('wss://outro.com/ws')
  await page.getByTestId('ws-save-connection').click()
  await expect.poll(() => salvo).toMatchObject({ config: { endpoint: 'wss://outro.com/ws' } })
  // Nada digitado, nada mandado: o guardado continua guardado.
  expect(salvo?.token).toBeUndefined()
})

// --- mensagens ----------------------------------------------------------------------------

const MENSAGENS = [
  { id: 'm1', installationId: INSTALLATION_ID, subscriptionId: 'sub-1', subscriptionIds: ['sub-1'], channel: 'pedidos', status: 'accepted', reason: null, preview: '{"total":42}', eventId: 'e1', occurredAt: NOW, receivedAt: NOW },
  { id: 'm2', installationId: INSTALLATION_ID, subscriptionId: null, subscriptionIds: [], channel: '', status: 'filtered', reason: 'não passou pelos filtros da conexão', preview: '{"tipo":"outro"}', eventId: null, occurredAt: NOW, receivedAt: NOW },
  { id: 'm3', installationId: INSTALLATION_ID, subscriptionId: null, subscriptionIds: [], channel: '', status: 'invalid', reason: 'a mensagem não é um JSON válido', preview: 'não é json', eventId: null, occurredAt: NOW, receivedAt: NOW },
  { id: 'm4', installationId: INSTALLATION_ID, subscriptionId: null, subscriptionIds: [], channel: '', status: 'ignored', reason: 'nenhuma assinatura ativa reivindicou esta mensagem', preview: '{"v":1}', eventId: null, occurredAt: NOW, receivedAt: NOW },
  { id: 'm5', installationId: INSTALLATION_ID, subscriptionId: null, subscriptionIds: [], channel: '', status: 'duplicate', reason: 'já recebida antes (deduplicação)', preview: '{"id":"x"}', eventId: null, occurredAt: NOW, receivedAt: NOW },
  { id: 'm6', installationId: INSTALLATION_ID, subscriptionId: null, subscriptionIds: [], channel: '', status: 'rate_limited', reason: 'acima de 120 mensagens por minuto', preview: '{"n":9}', eventId: null, occurredAt: NOW, receivedAt: NOW },
  { id: 'm7', installationId: INSTALLATION_ID, subscriptionId: 'sub-1', subscriptionIds: ['sub-1'], channel: '', status: 'failed', reason: 'nem todas as assinaturas receberam o evento', preview: '{"v":2}', eventId: null, occurredAt: NOW, receivedAt: NOW },
]

test('as mensagens mostram o que passou E o que foi recusado, com o motivo', async ({ page }) => {
  // Uma tela vazia porque o filtro está errado é indistinguível de uma tela vazia
  // porque o serviço não mandou nada. Aqui a diferença aparece.
  await stub(page, { messages: MENSAGENS })
  await page.goto('/apps/websocket/messages')
  const itens = page.getByTestId('ws-message')
  await expect(itens).toHaveCount(7)
  await expect(itens.first()).toContainText('Recebida')
  await expect(itens.nth(1)).toContainText('Filtrada')
  await expect(itens.nth(2)).toContainText('Inválida')
})

test('cada situação diz POR QUE a mensagem não virou evento', async ({ page }) => {
  // Sem o motivo, "Filtrada" e "Sem assinatura" são adivinhação — e as duas se corrigem
  // em lugares diferentes: uma na conexão, outra criando uma assinatura.
  await stub(page, { messages: MENSAGENS })
  await page.goto('/apps/websocket/messages')
  const itens = page.getByTestId('ws-message')
  for (const [i, esperado] of [
    [1, 'não passou pelos filtros'],
    [2, 'não é um JSON válido'],
    [3, 'nenhuma assinatura ativa'],
    [4, 'deduplicação'],
    [5, 'acima de 120 mensagens'],
    [6, 'nem todas as assinaturas'],
  ] as const) {
    await expect(itens.nth(i).getByTestId('ws-message-reason')).toContainText(esperado)
  }
  await expect(itens.nth(3)).toContainText('Sem assinatura')
  await expect(itens.nth(6)).toContainText('Falhou na entrega')
})

test('as mensagens filtram por conexão, situação e canal', async ({ page }) => {
  await stub(page, { messages: MENSAGENS })
  await page.goto('/apps/websocket/messages')
  await expect(page.getByTestId('ws-filter-connection')).toBeVisible()
  await page.getByTestId('ws-filter-status').selectOption('invalid')
  await page.getByTestId('ws-filter-channel').fill('pedidos')
  await expect(page.getByTestId('ws-messages')).toBeVisible()
})

// --- assinaturas ----------------------------------------------------------------------------

test('criar uma assinatura escolhendo o que fazer com o que chegar', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/subscriptions')
  await page.getByTestId('ws-new-sub').click()
  await page.getByTestId('ws-sub-name').fill('Pedidos novos')
  await page.getByTestId('ws-sub-channel').fill('pedidos')
  // "Só guardar" é o padrão: é o mais barato, e os outros custam.
  await expect(page.getByTestId('ws-sub-destination')).toHaveValue('history')
  await page.getByTestId('ws-sub-save').click()
  await expect.poll(() => assinaturaCriada).toMatchObject({ name: 'Pedidos novos', channel: 'pedidos', destination: { kind: 'history' } })
})

test('escolher memória avisa que não gasta token', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/subscriptions')
  await page.getByTestId('ws-new-sub').click()
  await page.getByTestId('ws-sub-destination').selectOption('memory')
  await expect(page.getByText('nenhum token é gasto', { exact: false })).toBeVisible()
})

test('uma assinatura pode ser pausada e retomada', async ({ page }) => {
  await stub(page, { subscriptions: [ASSINATURA] })
  await page.goto('/apps/websocket/subscriptions')
  await expect(page.getByTestId('ws-sub-state')).toHaveText('Ativa')
  await expect(page.getByTestId('ws-subscription')).toContainText('7 mensagem')
  await expect(page.getByTestId('ws-sub-toggle')).toBeVisible()
})

// --- logs -------------------------------------------------------------------------------------

test('os logs contam o que aconteceu, sem citar conteúdo', async ({ page }) => {
  await stub(page, {
    logs: [
      { id: 'l1', installationId: INSTALLATION_ID, kind: 'connected', message: 'conexão aberta', subscriptionId: null, createdAt: NOW },
      { id: 'l2', installationId: INSTALLATION_ID, kind: 'dropped', message: 'limite de 120 mensagens por minuto atingido', subscriptionId: null, createdAt: NOW },
    ],
  })
  await page.goto('/apps/websocket/logs')
  const linhas = page.getByTestId('ws-log')
  await expect(linhas).toHaveCount(2)
  await expect(linhas.first()).toContainText('Conectou')
  await expect(linhas.nth(1)).toContainText('limite de 120')
})

// --- navegação ----------------------------------------------------------------------------------

test('fixado, o App vira um grupo com as quatro páginas', async ({ page }) => {
  await stub(page, { navigation: [NAV_WEBSOCKET] })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/apps/websocket/overview')
  const pai = page.getByTestId('pinned-app-websocket')
  await expect(pai).toBeVisible()
  await pai.hover()
  await page.getByTestId('toggle-websocket').click()
  for (const chave of ['overview', 'messages', 'subscriptions', 'logs']) {
    await expect(page.getByTestId(`surface-websocket-${chave}`)).toBeVisible()
  }
  await page.getByTestId('surface-websocket-logs').click()
  await expect(page).toHaveURL(/\/apps\/websocket\/logs/)
})

test('não fixado, o App não aparece no menu — e as páginas continuam abrindo', async ({ page }) => {
  // Desfixar tira a navegação, e nada mais: conexão, assinatura e histórico ficam.
  await stub(page, { navigation: [] })
  await page.goto('/apps/websocket/overview')
  await expect(page.getByTestId('pinned-app-websocket')).toHaveCount(0)
  await expect(page.getByTestId('ws-connection-card')).toBeVisible()
})

test('com o App inativo, a página não renderiza — venha de onde vier a URL', async ({ page }) => {
  await stub(page, { access: { ok: false, reason: 'inactive' } })
  await page.goto('/apps/websocket/messages')
  await expect(page.getByTestId('ws-messages')).toHaveCount(0)
})

// --- celular -------------------------------------------------------------------------------------

test('no celular as quatro páginas continuam alcançáveis', async ({ page }) => {
  // No celular o sidebar não está à vista: sem as abas, só dá para trocar de página
  // voltando ao menu.
  await stub(page, { navigation: [NAV_WEBSOCKET] })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/apps/websocket/overview')
  await expect(page.getByTestId('ws-tabs')).toBeVisible()
  await page.getByTestId('ws-tab-subscriptions').click()
  await expect(page).toHaveURL(/\/apps\/websocket\/subscriptions/)
})

test('em 320px nada estoura a largura da tela', async ({ page }) => {
  await stub(page, { messages: MENSAGENS })
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/apps/websocket/messages')
  await expect(page.getByTestId('ws-messages')).toBeVisible()
  const estoura = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(estoura).toBe(false)
})

// --- destinos que exigem escolher ---------------------------------------------------------

test('escolher memória pede o escopo e a entidade — só as desta conta', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/subscriptions')
  await page.getByTestId('ws-new-sub').click()
  await page.getByTestId('ws-sub-destination').selectOption('memory')
  await expect(page.getByTestId('ws-sub-scope')).toBeVisible()
  // Escopo do agente: o seletor traz o agente da conta.
  await expect(page.getByTestId('ws-sub-target').locator('option')).toHaveText(['Escolha…', 'Ana'])

  await page.getByTestId('ws-sub-scope').selectOption('sector')
  await expect(page.getByTestId('ws-sub-target').locator('option')).toHaveText(['Escolha…', 'Suporte'])
  await page.getByTestId('ws-sub-scope').selectOption('floor')
  await expect(page.getByTestId('ws-sub-target').locator('option')).toHaveText(['Escolha…', 'Térreo'])
  // Prédio não pede escolha: a conta tem um.
  await page.getByTestId('ws-sub-scope').selectOption('building')
  await expect(page.getByTestId('ws-sub-target')).toHaveCount(0)
})

test('rotina, agente e setor têm cada um a sua lista', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/subscriptions')
  await page.getByTestId('ws-new-sub').click()
  for (const [destino, esperado] of [
    ['routine', 'Registrar pedido'],
    ['agent', 'Ana'],
    ['sector', 'Suporte'],
  ] as const) {
    await page.getByTestId('ws-sub-destination').selectOption(destino)
    await expect(page.getByTestId('ws-sub-target').locator('option')).toHaveText(['Escolha…', esperado])
  }
})

test('cada destino diz o que custa antes de ser escolhido', async ({ page }) => {
  // Ler é mais barato do que descobrir na fatura.
  await stub(page)
  await page.goto('/apps/websocket/subscriptions')
  await page.getByTestId('ws-new-sub').click()
  await expect(page.getByTestId('ws-sub-note')).toContainText('nenhuma execução')
  await page.getByTestId('ws-sub-destination').selectOption('agent')
  await expect(page.getByTestId('ws-sub-note')).toContainText('consome tokens')
})

test('a assinatura é criada com o destino inteiro', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/subscriptions')
  await page.getByTestId('ws-new-sub').click()
  await page.getByTestId('ws-sub-name').fill('Pedidos novos')
  await page.getByTestId('ws-sub-subscribe').fill('{"action":"subscribe"}')
  await page.getByTestId('ws-sub-destination').selectOption('agent')
  await page.getByTestId('ws-sub-target').selectOption('ag-1')
  await page.getByTestId('ws-sub-save').click()
  await expect.poll(() => assinaturaCriada).toMatchObject({
    name: 'Pedidos novos',
    subscribeMessage: '{"action":"subscribe"}',
    destination: { kind: 'agent', agentId: 'ag-1' },
  })
})

// --- editar e testar --------------------------------------------------------------------------

test('editar abre a assinatura preenchida e salva a alteração', async ({ page }) => {
  await stub(page, { subscriptions: [ASSINATURA] })
  await page.goto('/apps/websocket/subscriptions')
  await page.getByTestId('ws-sub-edit').click()
  // O MESMO formulário da criação, preenchido: dois formulários divergiam na primeira
  // mudança.
  await expect(page.getByTestId('ws-sub-name')).toHaveValue('Tudo')
  await expect(page.getByTestId('ws-sub-channel')).toHaveValue('pedidos')
  await expect(page.getByTestId('ws-sub-subscribe')).toHaveValue('{"action":"subscribe"}')
  await expect(page.getByTestId('ws-sub-unsubscribe')).toHaveValue('{"action":"unsubscribe"}')

  await page.getByTestId('ws-sub-channel').fill('avisos')
  await page.getByTestId('ws-sub-save').click()
  await expect.poll(() => assinaturaEditada).toMatchObject({ channel: 'avisos' })
})

test('testar a assinatura mostra o resultado sem exibir segredo nem payload', async ({ page }) => {
  await stub(page, { subscriptions: [ASSINATURA] })
  await page.goto('/apps/websocket/subscriptions')
  await page.getByTestId('ws-sub-test').click()
  await expect(page.getByTestId('ws-sub-test-result')).toContainText('mensagem compatível')
})

test('uma assinatura que não recebe nada diz isso, sem inventar sucesso', async ({ page }) => {
  await stub(page, {
    subscriptions: [ASSINATURA],
    teste: { ok: false, message: 'A conexão abriu, mas nenhuma mensagem compatível chegou no prazo.' },
  })
  await page.goto('/apps/websocket/subscriptions')
  await page.getByTestId('ws-sub-test').click()
  await expect(page.getByTestId('ws-sub-test-result')).toContainText('nenhuma mensagem compatível')
})

test('a automação gerenciada aparece na assinatura que a criou', async ({ page }) => {
  // Ela existe por causa desta assinatura, e some com ela — e isso fica à vista.
  await stub(page, { subscriptions: [{ ...ASSINATURA, destination: { kind: 'agent', agentId: 'ag-1' }, managedAutomationId: 'aut-1' }] })
  await page.goto('/apps/websocket/subscriptions')
  await expect(page.getByTestId('ws-sub-managed')).toContainText('arquiva o gatilho')
})

// --- configuração avançada -------------------------------------------------------------------

test('subprotocolos, schema e intervalos ficam na área avançada', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/overview')
  await page.getByTestId('ws-configure').click()
  await page.getByTestId('ws-advanced-toggle').click()
  await expect(page.getByTestId('ws-protocols')).toBeVisible()
  await expect(page.getByTestId('ws-schema')).toBeVisible()
  await expect(page.getByTestId('ws-heartbeat-interval')).toBeVisible()
  await expect(page.getByTestId('ws-idle-timeout')).toBeVisible()
})

test('um JSON Schema quebrado explica o que fazer e trava o salvar', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/overview')
  await page.getByTestId('ws-configure').click()
  await page.getByTestId('ws-advanced-toggle').click()
  await page.getByTestId('ws-schema').fill('{ isto não é json')
  await expect(page.getByTestId('ws-schema-error')).toContainText('objeto JSON')
  await page.getByTestId('ws-save-connection').click()
  // Salvar com o schema quebrado deixaria a conexão recusando tudo em silêncio.
  await expect(page.getByTestId('ws-form-error')).toContainText('Corrija o JSON Schema')
  expect(salvo).toBeNull()

  await page.getByTestId('ws-schema').fill('{"type":"object"}')
  await expect(page.getByTestId('ws-schema-error')).toHaveCount(0)
  await page.getByTestId('ws-save-connection').click()
  await expect.poll(() => salvo).toMatchObject({ config: { schema: { type: 'object' } } })
})

test('os subprotocolos viram lista ao salvar', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/overview')
  await page.getByTestId('ws-configure').click()
  await page.getByTestId('ws-advanced-toggle').click()
  await page.getByTestId('ws-protocols').fill('graphql-ws, wamp')
  await page.getByTestId('ws-save-connection').click()
  await expect.poll(() => salvo).toMatchObject({ config: { protocols: ['graphql-ws', 'wamp'] } })
})

// --- filtros por assinatura -------------------------------------------------------------

test('uma assinatura pode ter os seus próprios filtros', async ({ page }) => {
  // Os da conexão decidem o que entra; estes decidem o que é DESTA assinatura. O backend
  // já os suportava: só a tela não deixava preencher.
  await stub(page)
  await page.goto('/apps/websocket/subscriptions')
  await page.getByTestId('ws-new-sub').click()
  await page.getByTestId('ws-sub-name').fill('Só urgentes')
  await page.getByTestId('ws-sub-add-filter').click()
  await page.getByTestId('ws-sub-filter-path-0').fill('data.prioridade')
  await page.getByTestId('ws-sub-filter-op-0').selectOption('equals')
  await page.getByTestId('ws-sub-filter-value-0').fill('alta')
  await page.getByTestId('ws-sub-save').click()
  await expect.poll(() => assinaturaCriada).toMatchObject({
    name: 'Só urgentes',
    filters: [{ path: 'data.prioridade', operator: 'equals', value: 'alta' }],
  })
})

test('editar traz os filtros da assinatura preenchidos', async ({ page }) => {
  const comFiltro = { ...ASSINATURA, filters: [{ path: 'tipo', operator: 'contains', value: 'pedido' }] }
  await stub(page, { subscriptions: [comFiltro] })
  await page.goto('/apps/websocket/subscriptions')
  await page.getByTestId('ws-sub-edit').click()
  await expect(page.getByTestId('ws-sub-filter-path-0')).toHaveValue('tipo')
  await expect(page.getByTestId('ws-sub-filter-op-0')).toHaveValue('contains')
  await expect(page.getByTestId('ws-sub-filter-value-0')).toHaveValue('pedido')

  await page.getByTestId('ws-sub-filter-value-0').fill('aviso')
  await page.getByTestId('ws-sub-save').click()
  await expect.poll(() => assinaturaEditada).toMatchObject({ filters: [{ path: 'tipo', operator: 'contains', value: 'aviso' }] })
})

test('o App fixado aparece no menu TAMBÉM com a navegação antiga', async ({ page }) => {
  /**
   * O rail do desktop tem dois modos, e os Apps fixados só apareciam num deles.
   *
   * Eles são do dono, e não do andar — não dependem do contexto de prédio para existir.
   * Faltando no modo antigo, "Fixar no menu" salvava a preferência no servidor e não
   * mostrava nada: sem erro, sem aviso, sem item. Era invisível para quem não usasse
   * exatamente a configuração de quem escreveu o teste.
   *
   * Esta jornada roda contra o app COMPILADO no CI, que é onde as flags de build ficam
   * desligadas — e é por isso que ela pega o que a máquina de desenvolvimento esconde.
   */
  await stub(page, { navigation: [NAV_WEBSOCKET] })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/apps/websocket/overview')
  await expect(page.getByTestId('pinned-apps')).toBeVisible()
  await expect(page.getByTestId('pinned-app-websocket')).toBeVisible()
})


// --- tempo real: o que o App ganhou -----------------------------------------------------

test('a configuração aceita cabeçalho extra e mensagens ao conectar', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/overview')
  await page.getByTestId('ws-configure').click()
  await page.getByTestId('ws-advanced-toggle').click()

  await page.getByTestId('ws-header-add').click()
  await page.getByTestId('ws-header-name-0').fill('Origin')
  await page.getByTestId('ws-header-value-0').fill('https://meu-site.com')

  await page.getByTestId('ws-initial-add').click()
  await page.getByTestId('ws-initial-message-0').fill('{"action":"subscribe","params":{"symbols":"AAPL"}}')

  await page.getByTestId('ws-save-connection').click()
  await expect.poll(() => (salvo?.config as Record<string, unknown>)?.headers).toEqual([{ name: 'Origin', value: 'https://meu-site.com' }])
  expect((salvo?.config as Record<string, unknown>)?.initialMessages).toEqual(['{"action":"subscribe","params":{"symbols":"AAPL"}}'])
})

test('o mapeamento aparece, e com ele a chave do dado ao vivo', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/overview')
  await page.getByTestId('ws-configure').click()
  await page.getByTestId('ws-advanced-toggle').click()

  // Sem mapeamento, os campos do dado ao vivo não fazem sentido e não aparecem.
  await expect(page.getByTestId('ws-live-key')).toHaveCount(0)

  await page.getByTestId('ws-mapping-add').click()
  await page.getByTestId('ws-mapping-from-0').fill('$.data.ticker')
  await page.getByTestId('ws-mapping-to-0').fill('symbol')
  await expect(page.getByTestId('ws-live-key')).toBeVisible()

  await page.getByTestId('ws-live-key').fill('symbol')
  await page.getByTestId('ws-throttle').fill('1000')
  await page.getByTestId('ws-save-connection').click()

  await expect.poll(() => (salvo?.config as Record<string, unknown>)?.mapping).toEqual([{ from: '$.data.ticker', to: 'symbol' }])
  expect((salvo?.config as Record<string, unknown>)?.liveKeyPath).toBe('symbol')
  expect((salvo?.config as Record<string, unknown>)?.publishThrottleMs).toBe(1000)
})

test('o ping do protocolo é o padrão, e a mensagem só aparece quando ele é desligado', async ({ page }) => {
  await stub(page)
  await page.goto('/apps/websocket/overview')
  await page.getByTestId('ws-configure').click()
  await page.getByTestId('ws-advanced-toggle').click()
  await page.getByTestId('ws-heartbeat-enabled').check()

  await expect(page.getByTestId('ws-heartbeat-native')).toBeChecked()
  await expect(page.getByTestId('ws-heartbeat-message')).toHaveCount(0)
  await expect(page.getByTestId('ws-heartbeat-timeout')).toBeVisible()

  await page.getByTestId('ws-heartbeat-native').uncheck()
  await expect(page.getByTestId('ws-heartbeat-message')).toBeVisible()
})

test('o dado ao vivo mostra o último valor de cada chave', async ({ page }) => {
  await stub(page, {
    live: [
      { key: 'AAPL', value: { symbol: 'AAPL', price: 227.11 }, updates: 42, receivedAt: NOW, ageMs: 1200 },
      { key: 'TSLA', value: { symbol: 'TSLA', price: 410.5 }, updates: 7, receivedAt: NOW, ageMs: 3000 },
    ],
  })
  await page.goto('/apps/websocket/live')
  await expect(page.getByTestId('ws-live-row-AAPL')).toContainText('227.11')
  await expect(page.getByTestId('ws-live-row-AAPL')).toContainText('42')
  await expect(page.getByTestId('ws-live-row-TSLA')).toContainText('410.5')
})

test('sem dado ao vivo, a tela explica o que falta configurar', async ({ page }) => {
  await stub(page, { live: [] })
  await page.goto('/apps/websocket/live')
  await expect(page.getByText(/mapeamento com a chave/i)).toBeVisible()
})

test('dá para mandar um quadro avulso pela conexão aberta', async ({ page }) => {
  await stub(page, { live: [] })
  await page.goto('/apps/websocket/live')
  await page.getByTestId('ws-send-frame').fill('{"action":"subscribe","params":{"symbols":"AAPL"}}')
  await page.getByTestId('ws-send').click()
  await expect.poll(() => quadroEnviado).toBe('{"action":"subscribe","params":{"symbols":"AAPL"}}')
  await expect(page.getByTestId('ws-send-result')).toContainText('Mensagem enviada')
})

test('o Dado ao vivo é mais uma página do App, e o menu leva a ela', async ({ page }) => {
  await stub(page, { navigation: [NAV_WEBSOCKET], live: [] })
  await page.goto('/apps/websocket/overview')
  await expect(page.getByTestId('ws-tab-live')).toBeVisible()
  await page.getByTestId('ws-tab-live').click()
  await expect(page.getByTestId('ws-live')).toBeVisible()
})

test('em 320 px o dado ao vivo não estoura para os lados', async ({ page }) => {
  await stub(page, {
    live: [{ key: 'AAPL', value: { symbol: 'AAPL', price: 227.11, extra: 'um texto razoavelmente longo para forçar a largura' }, updates: 3, receivedAt: NOW, ageMs: 900 }],
  })
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/apps/websocket/live')
  await expect(page.getByTestId('ws-live')).toBeVisible()
  const folga = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(folga, `estourou ${folga}px`).toBeLessThanOrEqual(0)
})
