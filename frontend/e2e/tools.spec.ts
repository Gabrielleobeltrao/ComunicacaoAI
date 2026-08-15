import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The Tools area end to end, with the API stubbed. The point of these is the
// contract the UI must honour: a stored credential is never rendered, the
// assignment on the agent is what grants the capability, and the manual test
// shows a masked request.
const FLOOR_ID = '000000000000000000000f11'
const AGENT_ID = '000000000000000000000a11'
const TOOL_ID = '000000000000000000000t01'.replace(/t/g, '1')
const NOW = new Date(0).toISOString()

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = { id: FLOOR_ID, buildingId: 'b1', name: 'Térreo', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', createdAt: NOW, updatedAt: NOW }

const TOOL = {
  _id: TOOL_ID,
  name: 'consultar_pedido',
  description: 'Consulta a situação de um pedido pelo número.',
  method: 'GET',
  url: 'https://api.exemplo.com/pedidos/{{numero}}',
  headers: [],
  inputSchema: { type: 'object', properties: { numero: { type: 'string', description: 'Número do pedido' } }, required: ['numero'], additionalProperties: false },
  bodyTemplate: null,
  // The API only ever says WHETHER a secret exists.
  auth: { kind: 'bearer', hasSecret: true },
  timeoutMs: 8000,
  maxResponseChars: 4000,
  allowedDomains: ['api.exemplo.com'],
  maxCallsPerRun: 5,
  enabled: true,
  usedBy: [{ _id: AGENT_ID, name: 'Agente Teste' }],
}

let saved: Record<string, unknown> | null = null

// `locale: null` skips the pin — only the switcher test wants that, since the pin
// runs on EVERY navigation and would undo the choice being tested.
async function stub(page: Page, opts: { tools?: unknown[]; locale?: string | null } = {}) {
  saved = null
  // Pin the locale: the test browser reports en-US, so without this the UI would
  // render in English and every Portuguese assertion below would be about the
  // browser's language rather than about the app.
  const locale = opts.locale === null ? null : (opts.locale ?? 'pt')
  if (locale) await page.addInitScript((value) => window.localStorage.setItem('comunicacaoai.locale', value), locale)
  await page.route('**/api/tools', async (r) => {
    if (r.request().method() === 'POST') {
      saved = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ status: 201, json: { ...TOOL, ...saved, _id: TOOL_ID } })
    }
    return r.fulfill({ json: opts.tools ?? [TOOL] })
  })
  await page.route('**/api/tools/*/test', (r) =>
    r.fulfill({
      json: {
        ok: true,
        result: '{"situacao":"entregue"}',
        // As the backend returns it: already masked.
        detail: { toolName: 'consultar_pedido', status: 200, durationMs: 42, truncated: false, request: { method: 'GET', url: 'https://api.exemplo.com/pedidos/A-1', headers: { Authorization: '***' } } },
      },
    }),
  )
  await page.route('**/api/tools/*', async (r) => {
    if (r.request().method() === 'PATCH') {
      saved = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ json: { ...TOOL, ...saved } })
    }
    return r.fulfill({ status: 204, body: '' })
  })
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  await page.route('**/api/agent-stats**', (r) => r.fulfill({ json: { period: '30d', telemetrySince: null, stats: {}, channel: {} } }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) => r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }))
}

test('the Tools area lists a tool with where it is used', async ({ page }) => {
  await stub(page)
  await page.goto('/tools')
  const card = page.getByTestId('tool-card').first()
  await expect(card).toContainText('consultar_pedido')
  await expect(card).toContainText('GET')
  // Plural resolved from the count.
  await expect(page.getByTestId('tool-usage').first()).toContainText('1 agente')
})

test('an empty state explains what a tool is for', async ({ page }) => {
  await stub(page, { tools: [] })
  await page.goto('/tools')
  await expect(page.getByTestId('tools-empty')).toBeVisible()
})

test('a stored credential is never rendered — only that one exists', async ({ page }) => {
  await stub(page)
  await page.goto('/tools')
  await page.getByTestId('tool-card').first().getByRole('button', { name: 'Editar' }).click()
  await expect(page.getByTestId('tool-form')).toBeVisible()
  await expect(page.getByText('Guardado com segurança', { exact: false })).toBeVisible()
  // The field is empty: the browser never received the value.
  await expect(page.getByTestId('tool-secret')).toHaveValue('')
  const body = await page.getByTestId('tool-form').innerText()
  expect(body).not.toContain('Bearer ')
})

test('saving without touching the credential does NOT send one', async ({ page }) => {
  await stub(page)
  await page.goto('/tools')
  await page.getByTestId('tool-card').first().getByRole('button', { name: 'Editar' }).click()
  await page.getByTestId('save-tool').click()
  await expect.poll(() => saved).not.toBeNull()
  // An omitted secret means "keep the stored one"; sending '' would erase it.
  expect((saved?.auth as Record<string, unknown>)?.secret).toBeUndefined()
})

test('creating a tool builds a JSON Schema from the fields', async ({ page }) => {
  await stub(page, { tools: [] })
  await page.goto('/tools')
  await page.getByTestId('new-tool').click()
  await page.getByLabel('Nome').first().fill('checar_estoque')
  await page.getByLabel('Quando usar').fill('Consulta a quantidade em estoque de um item.')
  await page.getByLabel('Endereço (URL)').fill('https://api.exemplo.com/estoque')
  await page.getByTestId('add-param').click()
  const param = page.getByTestId('tool-param').first()
  await param.getByPlaceholder('numero').fill('sku')
  await param.getByRole('checkbox').check()
  await page.getByTestId('save-tool').click()

  await expect.poll(() => saved?.name).toBe('checar_estoque')
  const schema = saved?.inputSchema as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }
  expect(Object.keys(schema.properties)).toEqual(['sku'])
  expect(schema.required).toEqual(['sku'])
  expect(schema.additionalProperties).toBe(false)
})

test('the manual test shows a masked request', async ({ page }) => {
  await stub(page)
  await page.goto('/tools')
  await page.getByTestId('tool-card').first().getByRole('button', { name: 'Editar' }).click()
  await page.getByTestId('run-test').click()
  const result = page.getByTestId('tool-test-result')
  await expect(result).toContainText('entregue')
  await expect(result).toContainText('***')
  expect(await result.innerText()).not.toContain('Bearer ')
})

test('the language switcher changes the interface', async ({ page }) => {
  await stub(page, { locale: null })
  await page.goto('/settings')
  await page.getByTestId('locale-switcher').getByRole('button', { name: 'English' }).click()
  await page.goto('/tools')
  await expect(page.getByRole('button', { name: 'New tool' })).toBeVisible()
  // And it survives a reload.
  await page.reload()
  await expect(page.getByRole('button', { name: 'New tool' })).toBeVisible()
})

test('the Tools page works on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stub(page)
  await page.goto('/tools')
  await expect(page.getByTestId('tool-card').first()).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
