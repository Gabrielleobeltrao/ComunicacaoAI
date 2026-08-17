// E2E: escolher COMO o gatilho processa, e ver o custo antes de salvar.
//
// A escolha mais cara do formulário está aqui. O que não pode regredir: o custo
// aparece escrito na opção, o resumo do fluxo diz em português o que vai acontecer,
// e os campos que não fazem sentido no modo escolhido saem de cena em vez de ficarem
// cinza — um campo desabilitado convida a perguntar o que ele faz.
import { test, expect, type Page } from '@playwright/test'

const NOW = new Date().toISOString()
const AGENT_ID = '000000000000000000000a11'
const FLOOR_ID = '000000000000000000000f11'
const SECTOR_ID = '000000000000000000000c11'

const AGENT = {
  _id: AGENT_ID,
  name: 'Nina',
  objective: 'Receber eventos',
  preset: 'operator',
  floorId: FLOOR_ID,
  tools: [],
  builtinTools: [],
  appGrants: [],
  status: 'active',
  activationModes: ['event'],
  delegationPolicy: 'none',
  callerPolicy: 'all',
  callableAgentIds: [],
  callableSectorIds: [],
  allowedCallerAgentIds: [],
  createdAt: NOW,
  updatedAt: NOW,
}

const GATILHO_ANTIGO = {
  id: 'trg-1',
  name: 'Pedido novo',
  objective: 'Resumir o pedido',
  status: 'active',
  endpoint: 'https://api.test/hooks/abc',
  requireSignature: true,
  hasSecret: true,
  // Um gatilho criado ANTES disto tudo: o servidor devolve o padrão.
  executionMode: 'ai',
  memory: { enabled: false, scope: 'agent', strategy: 'append', key: 'evento' },
  aiCondition: null,
  createdAt: NOW,
  updatedAt: NOW,
}

const ESCOPOS = [
  { scope: 'agent', scopeKey: `agent:${AGENT_ID}`, label: 'Nina', count: 3, lastAt: NOW },
  { scope: 'sector', scopeKey: `sector:${SECTOR_ID}`, label: 'Vendas', count: 12, lastAt: NOW },
  { scope: 'floor', scopeKey: `floor:${FLOOR_ID}`, label: 'Térreo', count: 0, lastAt: null },
]

let enviado: Record<string, unknown> | null = null

async function stub(page: Page, opts: { gatilhos?: unknown[]; memorias?: unknown[] } = {}) {
  enviado = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))

  // O Playwright casa na ordem INVERSA do registro: genéricas primeiro.
  await page.route('**/api/memories**', (r) => r.fulfill({ json: { items: opts.memorias ?? [], total: (opts.memorias ?? []).length } }))
  await page.route('**/api/memories/scopes**', (r) => r.fulfill({ json: ESCOPOS }))
  await page.route('**/api/agents/*/event-triggers**', (r) => {
    if (r.request().method() === 'POST') {
      enviado = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ status: 201, json: { ...GATILHO_ANTIGO, ...enviado, secret: 's3cr3t' } })
    }
    if (r.request().method() === 'PATCH') {
      enviado = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ json: { ...GATILHO_ANTIGO, ...enviado } })
    }
    return r.fulfill({ json: opts.gatilhos ?? [] })
  })

  await page.route('**/api/connections', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agent-presets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/routines**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/history**', (r) => r.fulfill({ json: { total: 0, items: [], delegations: [] } }))
  await page.route('**/api/agents/*/documents**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/activations**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/overview', (r) =>
    r.fulfill({
      json: {
        agent: AGENT,
        stats: { conversations: 0, attendedConversations: 0, messagesThisWeek: 0, qualifiedLeads: 0 },
        readiness: { ready: true, issues: [] },
        availableMetrics: ['executions'],
        resolvedMetric: 'executions',
        linkedWidgets: [],
        linkedSectors: [],
        knowledgeCount: 0,
        channelLinked: false,
      },
    }),
  )
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: [AGENT] }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: [AGENT] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/apps**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: { id: 'b1', name: 'Prédio', floors: [] } }))
  await page.route('**/api/floors**', (r) =>
    r.fulfill({ json: [{ id: FLOOR_ID, name: 'Térreo', status: 'active', color: null, order: 0 }] }),
  )
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
}

const abrirFormulario = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await expect(page.getByTestId('new-event-trigger')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('new-event-trigger').click()
  await expect(page.getByTestId('execution-mode-fields')).toBeVisible()
}

// --- o padrão não mudou ------------------------------------------------------------

test('o modo começa em "com IA", que é o comportamento de sempre', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await expect(page.getByTestId('execution-mode')).toHaveValue('ai')
  await expect(page.getByTestId('trigger-objective')).toBeVisible()
})

test('o custo de cada modo vem escrito na própria opção', async ({ page }) => {
  // Sem isto, a diferença entre 0 e "por evento" fica na documentação — e ninguém
  // lê documentação no meio de um formulário.
  await stub(page)
  await abrirFormulario(page)
  const modo = page.getByTestId('execution-mode')
  await expect(modo.locator('option[value="collect_only"]')).toContainText('0 tokens')
  await expect(modo.locator('option[value="deterministic"]')).toContainText('0 tokens')
  await expect(modo.locator('option[value="ai"]')).toContainText('consome tokens')
})

test('o resumo do fluxo diz em português o que vai acontecer', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await expect(page.getByTestId('flow-summary')).toContainText('processar com IA')

  await page.getByTestId('execution-mode').selectOption('collect_only')
  await expect(page.getByTestId('flow-summary')).toContainText('encerrar sem IA')
})

// --- campos incompatíveis somem ------------------------------------------------------

test('sem IA no fluxo, o campo de objetivo sai de cena', async ({ page }) => {
  // Não há a quem instruir. Deixá-lo ali pediria um texto que ninguém vai ler.
  await stub(page)
  await abrirFormulario(page)
  await expect(page.getByTestId('trigger-objective')).toBeVisible()
  await page.getByTestId('execution-mode').selectOption('collect_only')
  await expect(page.getByTestId('trigger-objective')).toHaveCount(0)
})

test('a condição só aparece nos modos que a usam', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await expect(page.getByTestId('ai-condition-config')).toHaveCount(0)

  await page.getByTestId('execution-mode').selectOption('hybrid')
  await expect(page.getByTestId('ai-condition-config')).toBeVisible()
  // E o aviso que evita a leitura errada de "híbrido".
  await expect(page.getByTestId('ai-condition-note')).toContainText(/não é chamada/i)

  await page.getByTestId('execution-mode').selectOption('ai')
  await expect(page.getByTestId('ai-condition-config')).toHaveCount(0)
})

test('os campos da memória só aparecem quando ela está ligada', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await expect(page.getByTestId('memory-config')).toHaveCount(0)

  await page.getByTestId('memory-enabled').selectOption('sim')
  await expect(page.getByTestId('memory-config')).toBeVisible()
  await expect(page.getByTestId('memory-scope')).toBeVisible()
  await expect(page.getByTestId('memory-strategy')).toBeVisible()
})

test('o avançado fica guardado até ser pedido', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('memory-enabled').selectOption('sim')
  await expect(page.getByTestId('memory-advanced')).toHaveCount(0)

  await page.getByTestId('memory-advanced-toggle').click()
  await expect(page.getByTestId('memory-ttl')).toBeVisible()
  await expect(page.getByTestId('memory-fieldmap')).toBeVisible()
})

// --- o que é enviado ------------------------------------------------------------------

test('salvar manda o modo, o destino e a estratégia', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('execution-mode').selectOption('collect_only')
  await page.getByTestId('memory-enabled').selectOption('sim')
  await page.getByTestId('memory-strategy').selectOption('upsert')
  await page.getByTestId('memory-key').fill('pedido-{{pedido.id}}')
  await page.getByTestId('trigger-name').fill('Coletor')
  await page.getByTestId('save-event-trigger').click()

  await expect.poll(() => enviado).not.toBeNull()
  expect(enviado?.executionMode).toBe('collect_only')
  expect(enviado?.memory).toMatchObject({ enabled: true, scope: 'agent', strategy: 'upsert', key: 'pedido-{{pedido.id}}' })
})

test('destino que precisa de escolha bloqueia o salvamento com um motivo', async ({ page }) => {
  // Guardar "no setor" sem dizer qual setor gravaria em lugar nenhum.
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('execution-mode').selectOption('collect_only')
  await page.getByTestId('memory-enabled').selectOption('sim')
  await page.getByTestId('memory-scope').selectOption('sector')
  await page.getByTestId('save-event-trigger').click()

  await expect(page.getByTestId('execution-mode-fields')).toBeVisible()
  expect(enviado).toBeNull()
})

test('os destinos oferecidos vêm do servidor, não da tela', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('memory-enabled').selectOption('sim')
  await page.getByTestId('memory-scope').selectOption('sector')
  await expect(page.getByTestId('memory-target').locator('option')).toContainText(['Escolha…', 'Vendas'])
})

// --- reabrir preserva -------------------------------------------------------------------

test('editar um gatilho antigo o abre como sempre foi', async ({ page }) => {
  await stub(page, { gatilhos: [GATILHO_ANTIGO] })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await page.getByTestId('edit-trigger').first().click()
  await expect(page.getByTestId('edit-execution-mode')).toHaveValue('ai')
  await expect(page.getByTestId('edit-memory-enabled')).toHaveValue('nao')
  await expect(page.getByTestId('edit-trigger-objective')).toHaveValue('Resumir o pedido')
})

test('editar um gatilho de coleta o abre com o destino que ele tem', async ({ page }) => {
  const coletor = {
    ...GATILHO_ANTIGO,
    id: 'trg-2',
    executionMode: 'collect_only',
    memory: { enabled: true, scope: 'sector', sectorId: SECTOR_ID, strategy: 'upsert', key: 'pedido', dedupeKey: '{{id}}', ttlSeconds: null },
  }
  await stub(page, { gatilhos: [coletor] })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await page.getByTestId('edit-trigger').first().click()
  await expect(page.getByTestId('edit-execution-mode')).toHaveValue('collect_only')
  await expect(page.getByTestId('edit-memory-scope')).toHaveValue('sector')
  await expect(page.getByTestId('edit-memory-strategy')).toHaveValue('upsert')
})

// --- a tela da memória --------------------------------------------------------------------

test('a memória vazia explica o que fazer, em vez de só dizer que está vazia', async ({ page }) => {
  await stub(page)
  await page.goto('/memories')
  await expect(page.getByTestId('memories-page')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/Nada guardado ainda/i)).toBeVisible()
  await expect(page.getByText(/destino da memória na criação do gatilho/i)).toBeVisible()
})

test('a lista mostra chave, escopo, origem e conteúdo', async ({ page }) => {
  await stub(page, {
    memorias: [
      {
        id: 'm1',
        scope: 'sector',
        scopeKey: `sector:${SECTOR_ID}`,
        scopeLabel: 'Vendas',
        key: 'pedido-p-1',
        payload: { cliente: 'Fulano', total: 250 },
        sourceType: 'webhook',
        sourceId: 'run-1',
        metadata: {},
        dedupeKey: 'p-1',
        createdAt: NOW,
        updatedAt: NOW,
        expiresAt: null,
      },
    ],
  })
  await page.goto('/memories')
  const card = page.getByTestId('memory-card').first()
  await expect(card).toContainText('pedido-p-1')
  await expect(card).toContainText('Vendas')
  await expect(card).toContainText('webhook')
  await expect(card).toContainText('Fulano')
})

test('a tela diz que consultar não custa nada', async ({ page }) => {
  await stub(page)
  await page.goto('/memories')
  await expect(page.getByTestId('memories-page')).toContainText(/não consome tokens/i)
})

test('a memória cabe num celular, sem rolagem lateral', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stub(page)
  await page.goto('/memories')
  await expect(page.getByTestId('memories-page')).toBeVisible({ timeout: 20_000 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('o formulário do gatilho cabe num celular', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('memory-enabled').selectOption('sim')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
