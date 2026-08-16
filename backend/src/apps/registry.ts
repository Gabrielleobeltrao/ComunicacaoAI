// The system App catalog, expressed as manifests.
//
// Every integration the product already shipped is described here in the same
// contract a private App uses. The DIFFERENCE is only what a system App is allowed
// to declare: `execution.kind === 'native'`, pointing at a versioned adapter
// compiled into this repository (`src/googleTools.ts`, `src/providerApps.ts`,
// `src/connections/adapters.ts`). The adapters are unchanged — what changes is where
// their credential comes from.
//
// Action keys are the tool names the model already knows. Renaming them would break
// every prompt, routine and test written against them, so they stay.
import type { AppActivation, AppDefinition, AppActionDefinition } from './types.js'

const str = (description: string) => ({ type: 'string', description })
const num = (description: string) => ({ type: 'number', description })
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object' as const,
  properties,
  required,
  additionalProperties: false,
})

const native = (key: string): AppActionDefinition['execution'] => ({ kind: 'native', adapter: key })

// --- Google -------------------------------------------------------------------
// One App, one OAuth connection, Calendar and Sheets actions chosen individually
// (plan §6). The legacy catalog split this into `google_calendar` and
// `google_sheets`; both keys still resolve, see LEGACY_APP_KEYS below.
const google: AppDefinition = {
  key: 'google',
  version: '1.0.0',
  source: 'system',
  name: 'Google',
  description: 'Agenda e planilhas da sua conta Google.',
  icon: 'google',
  categories: ['produtividade', 'agenda'],
  documentationUrl: 'https://support.google.com/calendar/answer/37083',
  auth: {
    kind: 'oauth2',
    fields: [],
    scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/spreadsheets'],
    documentationUrl: 'https://developers.google.com/identity/protocols/oauth2',
  },
  allowedDomains: ['googleapis.com', 'accounts.google.com'],
  supportsMultipleConnections: false,
  actions: [
    {
      key: 'google_agenda_verificar_disponibilidade',
      name: 'Verificar disponibilidade',
      description: 'Verifica horários livres e ocupados na agenda em um intervalo.',
      risk: 'read',
      inputSchema: schema({ inicio: str('início em ISO 8601'), fim: str('fim em ISO 8601') }, ['inicio', 'fim']),
      execution: native('google_agenda_verificar_disponibilidade'),
      resourceFields: [{ key: 'calendarId', label: 'ID da agenda', placeholder: 'padrão: agenda principal', required: false }],
    },
    {
      key: 'google_agenda_listar_eventos',
      name: 'Listar eventos',
      description: 'Lista os eventos da agenda entre início e fim.',
      risk: 'read',
      inputSchema: schema({ inicio: str('início em ISO 8601'), fim: str('fim em ISO 8601') }, ['inicio', 'fim']),
      execution: native('google_agenda_listar_eventos'),
      resourceFields: [{ key: 'calendarId', label: 'ID da agenda', placeholder: 'padrão: agenda principal', required: false }],
    },
    {
      key: 'google_agenda_criar_evento',
      name: 'Criar evento',
      description: 'Cria um evento na agenda.',
      risk: 'write',
      inputSchema: schema(
        { titulo: str('título'), inicio: str('início em ISO 8601'), fim: str('fim em ISO 8601'), descricao: str('descrição') },
        ['titulo', 'inicio', 'fim'],
      ),
      execution: native('google_agenda_criar_evento'),
      resourceFields: [{ key: 'calendarId', label: 'ID da agenda', placeholder: 'padrão: agenda principal', required: false }],
    },
    {
      key: 'google_sheets_registrar',
      name: 'Registrar linha na planilha',
      description: 'Registra uma linha na planilha do Google com as colunas configuradas.',
      risk: 'write',
      inputSchema: schema({}, []),
      execution: native('google_sheets_registrar'),
      resourceFields: [
        { key: 'spreadsheetId', label: 'ID da planilha', placeholder: 'o trecho longo da URL da planilha', required: true },
        { key: 'sheetName', label: 'Aba', placeholder: 'opcional', required: false },
        { key: 'columns', label: 'Colunas', placeholder: 'Nome, Telefone, Interesse', required: true },
      ],
    },
  ],
  status: 'published',
  dataAccess: ['Eventos das agendas que você autorizar', 'Linhas das planilhas que você indicar'],
  storageNote: 'Guardamos apenas os tokens de acesso criptografados e o e-mail da conta conectada.',
  disconnectNote: 'Desconectar revoga o acesso imediatamente. Eventos e planilhas já criados permanecem no Google.',
}

// --- Apps conectados por credencial na conta -----------------------------------

const slack: AppDefinition = {
  key: 'slack',
  version: '1.0.0',
  source: 'system',
  name: 'Slack',
  description: 'Avisar um canal do Slack (ex: lead novo, pedido de atendimento humano).',
  icon: 'slack',
  categories: ['comunicação'],
  documentationUrl: 'https://api.slack.com/messaging/webhooks',
  auth: {
    kind: 'webhook',
    fields: [
      {
        key: 'webhookUrl',
        label: 'Incoming Webhook URL',
        placeholder: 'https://hooks.slack.com/services/...',
        required: true,
        secret: true,
        help: 'Em api.slack.com/apps → Incoming Webhooks → Add New Webhook to Workspace.',
      },
    ],
  },
  allowedDomains: ['hooks.slack.com'],
  supportsMultipleConnections: true,
  actions: [
    {
      key: 'slack_notificar',
      name: 'Notificar canal',
      description: 'Envia uma mensagem para o canal do Slack configurado.',
      risk: 'write',
      inputSchema: schema({ mensagem: str('texto da mensagem') }, ['mensagem']),
      execution: native('slack_notificar'),
    },
  ],
  status: 'published',
  dataAccess: ['Nada é lido do Slack; o App apenas envia mensagens.'],
  storageNote: 'A URL do webhook fica criptografada e nunca é reexibida.',
  disconnectNote: 'Desconectar interrompe os avisos. As mensagens já enviadas permanecem no Slack.',
}

const mercadopago: AppDefinition = {
  key: 'mercadopago',
  version: '1.0.0',
  source: 'system',
  name: 'Mercado Pago',
  description: 'Gerar link de pagamento (checkout) para o cliente pagar.',
  icon: 'mercadopago',
  categories: ['pagamentos'],
  documentationUrl:
    'https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/your-integrations/credentials',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'accessToken', label: 'Access Token', placeholder: 'APP_USR-...', required: true, secret: true }],
  },
  allowedDomains: ['api.mercadopago.com'],
  supportsMultipleConnections: true,
  actions: [
    {
      key: 'mercadopago_criar_link_pagamento',
      name: 'Criar link de pagamento',
      description: 'Cria um link de pagamento e retorna a URL para o cliente pagar.',
      risk: 'write',
      inputSchema: schema({ titulo: str('descrição da cobrança'), preco: num('valor em reais'), quantidade: num('quantidade (padrão 1)') }, [
        'titulo',
        'preco',
      ]),
      execution: native('mercadopago_criar_link_pagamento'),
    },
  ],
  status: 'published',
  dataAccess: ['Cria preferências de checkout na sua conta Mercado Pago.'],
  storageNote: 'O access token fica criptografado e nunca é reexibido.',
  disconnectNote: 'Links de pagamento já criados continuam válidos no Mercado Pago.',
  providerCostNote: 'As taxas da cobrança são do Mercado Pago; esta plataforma não intermedia o pagamento.',
}

const rdstation: AppDefinition = {
  key: 'rdstation',
  version: '1.0.0',
  source: 'system',
  name: 'RD Station CRM',
  description: 'Registrar leads e contatos no RD Station CRM.',
  icon: 'rdstation',
  categories: ['crm'],
  documentationUrl: 'https://developers.rdstation.com/reference/token-de-autenticacao-crm',
  auth: { kind: 'api_key', fields: [{ key: 'token', label: 'Token do RD Station CRM', required: true, secret: true }] },
  allowedDomains: ['crm.rdstation.com'],
  supportsMultipleConnections: true,
  actions: [
    {
      key: 'rdstation_registrar_contato',
      name: 'Registrar contato',
      description: 'Cria um contato/lead no RD Station CRM.',
      risk: 'write',
      inputSchema: schema({ nome: str('nome'), email: str('e-mail'), telefone: str('telefone') }, ['nome']),
      execution: native('rdstation_registrar_contato'),
    },
  ],
  status: 'published',
  dataAccess: ['Cria contatos no seu RD Station CRM.'],
  storageNote: 'O token fica criptografado e nunca é reexibido.',
  disconnectNote: 'Contatos já registrados permanecem no RD Station.',
}

const hubspot: AppDefinition = {
  key: 'hubspot',
  version: '1.0.0',
  source: 'system',
  name: 'HubSpot',
  description: 'Registrar leads e contatos no HubSpot CRM.',
  icon: 'hubspot',
  categories: ['crm'],
  documentationUrl: 'https://developers.hubspot.com/docs/api/private-apps',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'token', label: 'Private App Token', placeholder: 'pat-na1-...', required: true, secret: true }],
  },
  allowedDomains: ['api.hubapi.com'],
  supportsMultipleConnections: true,
  actions: [
    {
      key: 'hubspot_registrar_contato',
      name: 'Registrar contato',
      description: 'Cria ou atualiza um contato/lead no HubSpot CRM.',
      risk: 'write',
      inputSchema: schema({ email: str('e-mail (identifica o contato)'), nome: str('nome'), telefone: str('telefone') }, ['email']),
      execution: native('hubspot_registrar_contato'),
    },
  ],
  status: 'published',
  dataAccess: ['Cria e atualiza contatos no seu HubSpot.'],
  storageNote: 'O token fica criptografado e nunca é reexibido.',
  disconnectNote: 'Contatos já registrados permanecem no HubSpot.',
}

const stripe: AppDefinition = {
  key: 'stripe',
  version: '1.0.0',
  source: 'system',
  name: 'Stripe',
  description: 'Gerar link de pagamento (Stripe Checkout) para o cliente pagar.',
  icon: 'stripe',
  categories: ['pagamentos'],
  documentationUrl: 'https://dashboard.stripe.com/apikeys',
  auth: {
    kind: 'api_key',
    fields: [{ key: 'secretKey', label: 'Secret Key', placeholder: 'sk_live_... ou sk_test_...', required: true, secret: true }],
  },
  allowedDomains: ['api.stripe.com'],
  supportsMultipleConnections: true,
  actions: [
    {
      key: 'stripe_criar_link_pagamento',
      name: 'Criar link de pagamento',
      description: 'Cria uma sessão de Checkout do Stripe e retorna a URL de pagamento.',
      risk: 'write',
      inputSchema: schema({ titulo: str('descrição da cobrança'), preco: num('valor em reais'), quantidade: num('quantidade (padrão 1)') }, [
        'titulo',
        'preco',
      ]),
      execution: native('stripe_criar_link_pagamento'),
      resourceFields: [{ key: 'successUrl', label: 'URL de sucesso', placeholder: 'https://seusite.com/obrigado', required: false }],
    },
  ],
  status: 'published',
  dataAccess: ['Cria sessões de checkout na sua conta Stripe.'],
  storageNote: 'A secret key fica criptografada e nunca é reexibida.',
  disconnectNote: 'Sessões de checkout já criadas continuam válidas no Stripe.',
  providerCostNote: 'As taxas da cobrança são do Stripe; esta plataforma não intermedia o pagamento.',
}

const nuvemshop: AppDefinition = {
  key: 'nuvemshop',
  version: '1.0.0',
  source: 'system',
  name: 'Nuvemshop',
  description: 'Consultar status de pedidos na sua loja Nuvemshop.',
  icon: 'nuvemshop',
  categories: ['e-commerce'],
  documentationUrl: 'https://tiendanube.github.io/api-documentation/authentication',
  auth: {
    kind: 'bearer',
    fields: [
      { key: 'storeId', label: 'ID da loja', placeholder: 'ex: 1234567', required: true, secret: false },
      { key: 'accessToken', label: 'Access Token', required: true, secret: true },
    ],
  },
  allowedDomains: ['api.nuvemshop.com.br'],
  supportsMultipleConnections: true,
  actions: [
    {
      key: 'nuvemshop_status_pedido',
      name: 'Status do pedido',
      description: 'Consulta o status de um pedido pelo número.',
      risk: 'read',
      inputSchema: schema({ numero_pedido: str('número do pedido') }, ['numero_pedido']),
      execution: native('nuvemshop_status_pedido'),
    },
  ],
  status: 'published',
  dataAccess: ['Lê pedidos da sua loja Nuvemshop.'],
  storageNote: 'O access token fica criptografado e nunca é reexibido.',
  disconnectNote: 'Nada é alterado na loja ao desconectar.',
}

// --- Canais de entrega já existentes -------------------------------------------
// E-mail e Telegram aparecem no catálogo, mas continuam sendo resolvidos pelo fluxo
// de entregas das rotinas: as ações não são ferramentas de modelo (plan §6).

const email: AppDefinition = {
  key: 'email',
  version: '1.0.0',
  source: 'system',
  name: 'E-mail (SMTP)',
  description: 'Enviar e-mails pelas rotinas usando seu próprio servidor SMTP.',
  icon: 'email',
  categories: ['comunicação'],
  auth: {
    kind: 'basic',
    fields: [
      { key: 'host', label: 'Servidor SMTP', placeholder: 'smtp.seuprovedor.com', required: true, secret: false },
      { key: 'port', label: 'Porta', placeholder: '587', required: true, secret: false },
      { key: 'secure', label: 'Conexão segura (SSL)', required: false, secret: false },
      { key: 'user', label: 'Usuário', required: true, secret: false },
      { key: 'pass', label: 'Senha', required: true, secret: true },
      { key: 'from', label: 'Remetente', placeholder: 'nome@seudominio.com', required: true, secret: false },
    ],
  },
  allowedDomains: [],
  supportsMultipleConnections: true,
  actions: [],
  status: 'published',
  dataAccess: ['Envia e-mails pela sua conta SMTP.'],
  storageNote: 'A senha fica criptografada e nunca é reexibida.',
  disconnectNote: 'Rotinas que entregam por este e-mail param de enviar. O histórico de entregas é preservado.',
}

const telegram: AppDefinition = {
  key: 'telegram',
  version: '1.0.0',
  source: 'system',
  name: 'Telegram',
  description: 'Enviar mensagens pelas rotinas usando um bot do Telegram.',
  icon: 'telegram',
  categories: ['comunicação'],
  documentationUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
  auth: { kind: 'api_key', fields: [{ key: 'botToken', label: 'Token do bot', required: true, secret: true }] },
  allowedDomains: ['api.telegram.org'],
  supportsMultipleConnections: true,
  actions: [],
  status: 'published',
  dataAccess: ['Envia mensagens pelo seu bot.'],
  storageNote: 'O token do bot fica criptografado e nunca é reexibido.',
  disconnectNote: 'Rotinas que entregam por este bot param de enviar. O histórico de entregas é preservado.',
}

// --- canais de atendimento como Apps nativos ------------------------------------
// Chat Web and WhatsApp were never "integrations" in the catalog, yet they are
// exactly that: something the owner activates, that unlocks pages and that agents
// answer through. They become Apps WITHOUT recreating anything — the surfaces below
// resolve to the widget/conversation pages that already exist, and activating one
// stores an installation, never a second chat system.

const webChat: AppDefinition = {
  key: 'web_chat',
  version: '1.0.0',
  source: 'system',
  name: 'Chat Web',
  description: 'Atendimento no seu site: widget incorporável, roteamento para agente ou setor e histórico das conversas.',
  icon: 'message-circle',
  categories: ['atendimento'],
  // Nothing to connect: activating is idempotent and asks for no secret.
  auth: { kind: 'none', fields: [] },
  // Nothing to connect: activating is the whole flow, and it is idempotent.
  activation: 'instant',
  allowedDomains: [],
  supportsMultipleConnections: false,
  actions: [],
  // Only pages that really exist are declared. A "Visão geral" page is planned but
  // not built, and declaring it would put a dead link in the sidebar.
  surfaces: [
    { key: 'widgets', label: 'Widgets', description: 'Criar, personalizar e instalar o widget no seu site.', kind: 'native', scope: 'account', routeSegment: 'widgets' },
    { key: 'conversations', label: 'Conversas Web', description: 'Conversas recebidas pelo chat do site.', kind: 'native', scope: 'account', routeSegment: 'conversations' },
  ],
  sidebar: { pinnable: true, defaultSurfaceKey: 'widgets' },
  status: 'published',
  dataAccess: ['Mensagens trocadas no chat do seu site'],
  storageNote: 'As conversas e mensagens ficam nesta conta, associadas ao widget que as recebeu.',
  disconnectNote: 'Desativar interrompe novas conversas. Widgets, conversas e mensagens são preservados.',
}

const whatsapp: AppDefinition = {
  key: 'whatsapp',
  version: '1.0.0',
  source: 'system',
  name: 'WhatsApp',
  description: 'Atendimento no WhatsApp pelo seu provedor: números conectados, roteamento e histórico das conversas.',
  icon: 'whatsapp',
  categories: ['atendimento'],
  // The provider credential is validated by the WhatsApp channel flow, which keeps
  // its own encrypted config and webhook validation.
  auth: { kind: 'api_key', fields: [], documentationUrl: 'https://developers.facebook.com/docs/whatsapp' },
  // The number and the provider credential live on the CHANNEL, in its own encrypted
  // config. A generic form with no declared fields would happily create a "connected"
  // installation with neither — so it is not allowed to.
  activation: 'managed_channel',
  activationRoute: '/apps/whatsapp/channels',
  allowedDomains: [],
  supportsMultipleConnections: true,
  actions: [],
  surfaces: [
    { key: 'channels', label: 'Números', description: 'Conectar provedor, escolher agente ou setor e testar.', kind: 'native', scope: 'account', routeSegment: 'channels' },
    { key: 'conversations', label: 'Conversas WhatsApp', description: 'Conversas recebidas pelos números conectados.', kind: 'native', scope: 'account', routeSegment: 'conversations' },
  ],
  sidebar: { pinnable: true, defaultSurfaceKey: 'channels' },
  status: 'published',
  dataAccess: ['Mensagens trocadas nos números que você conectar'],
  storageNote: 'As credenciais do provedor ficam criptografadas; conversas e mensagens ficam nesta conta.',
  disconnectNote: 'Desconectar um número interrompe novas mensagens. Conversas e histórico são preservados.',
  providerCostNote: 'As tarifas de mensagem são cobradas pelo seu provedor de WhatsApp, não por esta plataforma.',
}

export const SYSTEM_APPS: AppDefinition[] = [
  google,
  slack,
  mercadopago,
  rdstation,
  hubspot,
  stripe,
  nuvemshop,
  email,
  telegram,
  webChat,
  whatsapp,
]

// The legacy catalog keys an agent document may still carry. They resolve to the
// same App, so an agent configured before this change keeps working.
export const LEGACY_APP_KEYS: Record<string, string> = {
  google_calendar: 'google',
  google_sheets: 'google',
}

export const resolveAppKey = (key: string): string => LEGACY_APP_KEYS[key] ?? key

export function getApp(key: string): AppDefinition | undefined {
  const resolved = resolveAppKey(key)
  return SYSTEM_APPS.find((app) => app.key === resolved)
}

export function getAppAction(appKey: string, actionKey: string): AppActionDefinition | undefined {
  return getApp(appKey)?.actions.find((a) => a.key === actionKey)
}

// Which actions a legacy `builtinTools` entry stood for. Enabling `google_calendar`
// used to mean "all three calendar actions", so migrating it must grant exactly
// those and nothing more.
export const LEGACY_ACTION_KEYS: Record<string, string[]> = {
  google_calendar: ['google_agenda_verificar_disponibilidade', 'google_agenda_listar_eventos', 'google_agenda_criar_evento'],
  google_sheets: ['google_sheets_registrar'],
  slack: ['slack_notificar'],
  mercadopago: ['mercadopago_criar_link_pagamento'],
  rdstation: ['rdstation_registrar_contato'],
  hubspot: ['hubspot_registrar_contato'],
  stripe: ['stripe_criar_link_pagamento'],
  nuvemshop: ['nuvemshop_status_pedido'],
}

// Is this key of a legacy `builtinTools` entry a credential? Used to mask it on the
// way out of the API while old documents still carry one.
export const isSecretLegacyConfigKey = (appKey: string, configKey: string): boolean =>
  (getApp(appKey)?.auth.fields ?? []).some((f) => f.key === configKey && f.secret)

// Which config keys of a legacy entry were CREDENTIALS (they move to the encrypted
// installation) and which were non-secret resource selection (they stay on the
// agent as `resourceConfig`).
export function splitLegacyConfig(legacyKey: string, config: Record<string, string>): {
  credential: Record<string, string>
  resource: Record<string, string>
} {
  const app = getApp(legacyKey)
  const secretKeys = new Set((app?.auth.fields ?? []).map((f) => f.key))
  const credential: Record<string, string> = {}
  const resource: Record<string, string> = {}
  for (const [key, value] of Object.entries(config ?? {})) {
    if (secretKeys.has(key)) credential[key] = value
    else resource[key] = value
  }
  return { credential, resource }
}

// The catalog DTO. Everything an owner must see BEFORE connecting (plan §6), and
// nothing that could carry a credential or point at internal code.
export function appCatalogPublic(app: AppDefinition) {
  return {
    key: app.key,
    version: app.version,
    source: app.source,
    name: app.name,
    description: app.description,
    icon: app.icon ?? null,
    categories: app.categories,
    documentationUrl: app.documentationUrl ?? null,
    status: app.status,
    auth: {
      kind: app.auth.kind,
      // Field definitions, never values.
      fields: (app.auth.fields ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        placeholder: f.placeholder ?? null,
        required: f.required,
        secret: f.secret,
        help: f.help ?? null,
      })),
      scopes: app.auth.scopes ?? [],
      documentationUrl: app.auth.documentationUrl ?? null,
    },
    allowedDomains: app.allowedDomains,
    supportsMultipleConnections: app.supportsMultipleConnections,
    actions: app.actions.map((a) => ({
      key: a.key,
      name: a.name,
      description: a.description,
      risk: a.risk,
      inputSchema: a.inputSchema,
      resourceFields: a.resourceFields ?? [],
    })),
    // `routeSegment`/`kind` describe navigation, never a module path.
    surfaces: (app.surfaces ?? []).map((s) => ({
      key: s.key,
      label: s.label,
      description: s.description,
      icon: s.icon ?? null,
      scope: s.scope,
      routeSegment: s.routeSegment,
    })),
    pinnable: app.sidebar?.pinnable ?? false,
    defaultSurfaceKey: app.sidebar?.defaultSurfaceKey ?? null,
    dataAccess: app.dataAccess ?? [],
    storageNote: app.storageNote ?? null,
    disconnectNote: app.disconnectNote ?? null,
    providerCostNote: app.providerCostNote ?? null,
    // An App with a write/high-risk action can only run it autonomously when the
    // owner authorises that action explicitly.
    supportsAutonomous: app.actions.some((a) => a.risk === 'read'),
    requiresAuth: app.auth.kind !== 'none',
    // How the App becomes active, and where its real flow lives when the generic
    // form cannot produce a valid connection.
    activation: activationOf(app),
    activationRoute: app.activationRoute ?? null,
  }
}

// The activation strategy, with a compatible default for a manifest written before
// the field existed.
export function activationOf(app: AppDefinition): AppActivation {
  if (app.activation) return app.activation
  if (app.auth.kind === 'oauth2') return 'oauth'
  return (app.auth.fields ?? []).length === 0 ? 'instant' : 'credentials'
}

// Can the generic "connect with these fields" form create this App's installation?
export const acceptsGenericConnect = (app: AppDefinition): boolean =>
  activationOf(app) === 'instant' || activationOf(app) === 'credentials'
