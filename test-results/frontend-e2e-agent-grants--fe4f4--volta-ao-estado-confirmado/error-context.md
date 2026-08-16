# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend/e2e/agent-grants.spec.ts >> descartar volta ao estado confirmado
- Location: frontend/e2e/agent-grants.spec.ts:269:1

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/floors/000000000000000000000f11/agents/000000000000000000000a11/como-trabalha", waiting until "load"

```

# Test source

```ts
  64  |   source: 'system',
  65  |   name: 'Google',
  66  |   description: 'Agenda e planilhas.',
  67  |   icon: 'google',
  68  |   categories: ['produtividade'],
  69  |   documentationUrl: null,
  70  |   status: 'published',
  71  |   auth: { kind: 'oauth2', fields: [], scopes: [], documentationUrl: null },
  72  |   allowedDomains: ['googleapis.com'],
  73  |   supportsMultipleConnections: false,
  74  |   actions: [
  75  |     { key: 'google_agenda_listar_eventos', name: 'Listar eventos', description: 'Lista eventos.', risk: 'read', inputSchema: {}, resourceFields: [{ key: 'calendarId', label: 'ID da agenda', required: false }] },
  76  |     { key: 'google_agenda_criar_evento', name: 'Criar evento', description: 'Cria um evento.', risk: 'write', inputSchema: {}, resourceFields: [{ key: 'calendarId', label: 'ID da agenda', required: false }] },
  77  |   ],
  78  |   surfaces: [],
  79  |   pinnable: false,
  80  |   defaultSurfaceKey: null,
  81  |   dataAccess: [],
  82  |   storageNote: null,
  83  |   disconnectNote: null,
  84  |   providerCostNote: null,
  85  |   requiresAuth: true,
  86  |   activation: 'oauth',
  87  |   activationRoute: null,
  88  | }
  89  | 
  90  | const INSTALLATION_ROW = {
  91  |   id: INSTALLATION,
  92  |   appKey: 'google',
  93  |   appVersion: '1.0.0',
  94  |   name: 'Google (loja)',
  95  |   status: 'connected',
  96  |   publicMetadata: {},
  97  |   grantedScopes: [],
  98  |   createdAt: NOW,
  99  |   updatedAt: NOW,
  100 |   lastTestedAt: null,
  101 |   agentCount: 0,
  102 | }
  103 | 
  104 | let patches: Record<string, unknown>[] = []
  105 | let stored: Record<string, unknown>[] = []
  106 | 
  107 | async function stub(
  108 |   page: Page,
  109 |   opts: { installations?: unknown[]; grants?: unknown[]; patch?: (body: Record<string, unknown>) => { status: number; json: unknown } | Promise<{ status: number; json: unknown }> } = {},
  110 | ) {
  111 |   patches = []
  112 |   stored = (opts.grants as Record<string, unknown>[]) ?? []
  113 |   await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  114 | 
  115 |   await page.route('**/api/agents/*/app-grants', async (r) => {
  116 |     if (r.request().method() === 'PATCH') {
  117 |       const body = r.request().postDataJSON() as { grants: Record<string, unknown>[] }
  118 |       patches.push(body)
  119 |       if (opts.patch) {
  120 |         const result = await opts.patch(body)
  121 |         return r.fulfill({ status: result.status, json: result.json })
  122 |       }
  123 |       stored = body.grants.map((g) => ({ ...g, appKey: 'google' }))
  124 |       return r.fulfill({ json: stored })
  125 |     }
  126 |     return r.fulfill({ json: stored })
  127 |   })
  128 |   await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [GOOGLE] }))
  129 |   await page.route('**/api/app-installations', (r) => r.fulfill({ json: opts.installations ?? [INSTALLATION_ROW] }))
  130 |   await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  131 |   await page.route('**/api/agents/*/overview', (r) =>
  132 |     r.fulfill({
  133 |       json: {
  134 |         agent: AGENT,
  135 |         stats: { conversations: 0, conversationsThisWeek: 0, messagesThisWeek: 0, attendedConversations: 0, handoffs: 0, qualifiedLeads: 0 },
  136 |         channelLinked: false,
  137 |         availableMetrics: ['executions'],
  138 |         resolvedMetric: 'executions',
  139 |         linkedWidgets: [],
  140 |         linkedSectors: [],
  141 |         knowledgeCount: 0,
  142 |       },
  143 |     }),
  144 |   )
  145 |   await page.route('**/api/agents/*/documents', (r) => r.fulfill({ json: [] }))
  146 |   await page.route('**/api/agents/*/routines**', (r) => r.fulfill({ json: [] }))
  147 |   await page.route('**/api/agents/*/event-triggers**', (r) => r.fulfill({ json: [] }))
  148 |   await page.route('**/api/agent-stats**', (r) => r.fulfill({ json: { period: '30d', telemetrySince: null, stats: {}, channel: {} } }))
  149 |   await page.route('**/api/agent-states**', (r) => r.fulfill({ json: {} }))
  150 |   await page.route('**/api/agents?**', (r) => r.fulfill({ json: [AGENT] }))
  151 |   await page.route('**/api/agents', (r) => r.fulfill({ json: [AGENT] }))
  152 |   await page.route('**/api/tools', (r) => r.fulfill({ json: [] }))
  153 |   await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  154 |   await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  155 |   await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  156 |   await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  157 |   const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  158 |   await page.route('**/api/auth/**', (r) =>
  159 |     r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  160 |   )
  161 | }
  162 | 
  163 | const open = async (page: Page) => {
> 164 |   await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  165 |   await expect(page.getByTestId('agent-app-grants')).toBeVisible()
  166 | }
  167 | 
  168 | test('marcar uma ação não dispara requisição: é rascunho até salvar', async ({ page }) => {
  169 |   await stub(page)
  170 |   await open(page)
  171 |   await page.getByTestId('action-google_agenda_listar_eventos').check()
  172 |   await expect(page.getByTestId('grants-dirty')).toBeVisible()
  173 |   // Nada foi enviado ainda.
  174 |   expect(patches).toEqual([])
  175 | })
  176 | 
  177 | test('digitar num campo NÃO manda uma requisição por caractere', async ({ page }) => {
  178 |   await stub(page)
  179 |   await open(page)
  180 |   await page.getByTestId('action-google_agenda_listar_eventos').check()
  181 |   await page.getByTestId('resource-calendarId').fill('agenda@grupo.calendar.google.com')
  182 |   expect(patches).toEqual([])
  183 | 
  184 |   await page.getByTestId('save-grants').click()
  185 |   await expect(page.getByTestId('grants-saved')).toBeVisible()
  186 |   // Uma única requisição para tudo.
  187 |   expect(patches.length).toBe(1)
  188 |   expect((patches[0].grants as Record<string, unknown>[])[0].resourceConfig).toEqual({ calendarId: 'agenda@grupo.calendar.google.com' })
  189 | })
  190 | 
  191 | test('várias alterações rápidas viram um único salvamento, com o estado final', async ({ page }) => {
  192 |   await stub(page)
  193 |   await open(page)
  194 |   await page.getByTestId('action-google_agenda_listar_eventos').check()
  195 |   await page.getByTestId('action-google_agenda_criar_evento').check()
  196 |   await page.getByTestId('autonomous-google_agenda_criar_evento').check()
  197 |   await page.getByTestId('action-google_agenda_listar_eventos').uncheck()
  198 |   await page.getByTestId('save-grants').click()
  199 |   await expect(page.getByTestId('grants-saved')).toBeVisible()
  200 | 
  201 |   expect(patches.length).toBe(1)
  202 |   const grant = (patches[0].grants as Record<string, unknown>[])[0]
  203 |   expect(grant.actionKeys).toEqual(['google_agenda_criar_evento'])
  204 |   expect(grant.autonomousWriteActionKeys).toEqual(['google_agenda_criar_evento'])
  205 | })
  206 | 
  207 | test('desmarcar a ação remove junto a autorização autônoma dela', async ({ page }) => {
  208 |   await stub(page)
  209 |   await open(page)
  210 |   await page.getByTestId('action-google_agenda_criar_evento').check()
  211 |   await page.getByTestId('autonomous-google_agenda_criar_evento').check()
  212 |   await page.getByTestId('action-google_agenda_criar_evento').uncheck()
  213 |   await page.getByTestId('action-google_agenda_criar_evento').check()
  214 |   // Voltou desmarcada: a autorização não sobreviveu escondida ao ciclo.
  215 |   await expect(page.getByTestId('autonomous-google_agenda_criar_evento')).not.toBeChecked()
  216 | })
  217 | 
  218 | test('o botão fica desabilitado sem alterações e durante o envio', async ({ page }) => {
  219 |   let release: (() => void) | undefined
  220 |   const gate = new Promise<void>((r) => (release = r))
  221 |   await stub(page, {
  222 |     patch: async (body) => {
  223 |       await gate
  224 |       return { status: 200, json: body.grants }
  225 |     },
  226 |   })
  227 |   await open(page)
  228 |   await expect(page.getByTestId('save-grants')).toBeDisabled()
  229 | 
  230 |   await page.getByTestId('action-google_agenda_listar_eventos').check()
  231 |   await expect(page.getByTestId('save-grants')).toBeEnabled()
  232 | 
  233 |   await page.getByTestId('save-grants').click()
  234 |   await expect(page.getByTestId('save-grants')).toBeDisabled()
  235 |   // Clicar de novo enquanto salva não cria uma segunda requisição.
  236 |   await page.getByTestId('save-grants').click({ force: true })
  237 |   release?.()
  238 |   await expect(page.getByTestId('grants-saved')).toBeVisible()
  239 |   expect(patches.length).toBe(1)
  240 | })
  241 | 
  242 | test('recusa do servidor mostra o motivo e restaura o que está guardado', async ({ page }) => {
  243 |   await stub(page, {
  244 |     grants: [{ installationId: INSTALLATION, appKey: 'google', actionKeys: ['google_agenda_listar_eventos'], resourceConfig: {}, autonomousWriteActionKeys: [] }],
  245 |     patch: () => ({ status: 400, json: { message: 'ação desconhecida: google_agenda_criar_evento' } }),
  246 |   })
  247 |   await open(page)
  248 |   await expect(page.getByTestId('action-google_agenda_listar_eventos')).toBeChecked()
  249 | 
  250 |   await page.getByTestId('action-google_agenda_criar_evento').check()
  251 |   await page.getByTestId('save-grants').click()
  252 | 
  253 |   await expect(page.getByTestId('grants-error')).toContainText('ação desconhecida')
  254 |   // A tela volta para o que o servidor confirma — ninguém sai achando que concedeu.
  255 |   await expect(page.getByTestId('action-google_agenda_criar_evento')).not.toBeChecked()
  256 |   await expect(page.getByTestId('action-google_agenda_listar_eventos')).toBeChecked()
  257 | })
  258 | 
  259 | test('falha de rede não deixa a tela dizendo que salvou', async ({ page }) => {
  260 |   await stub(page)
  261 |   await open(page)
  262 |   await page.getByTestId('action-google_agenda_listar_eventos').check()
  263 |   await page.route('**/api/agents/*/app-grants', (r) => (r.request().method() === 'PATCH' ? r.abort() : r.fulfill({ json: stored })))
  264 |   await page.getByTestId('save-grants').click()
```