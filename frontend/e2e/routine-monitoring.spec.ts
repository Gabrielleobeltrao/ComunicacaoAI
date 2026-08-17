// E2E: monitorar um site ou um feed a partir da rotina do agente.
//
// O que precisa ficar claro na tela e não pode regredir: a rotina antiga continua
// abrindo do jeito que sempre abriu; escolher uma fonte revela os campos dela;
// "Testar fonte" consulta sem executar nada; e a lista diz se a última verificação
// encontrou alguma coisa — porque uma rotina que verifica de 15 em 15 minutos e
// nunca acha nada parece parada, e o dono precisa distinguir calmaria de defeito.
import { test, expect, type Page } from '@playwright/test'

const NOW = new Date().toISOString()
const AGENT_ID = '000000000000000000000a11'
const FLOOR_ID = '000000000000000000000f11'

const AGENT = {
  _id: AGENT_ID,
  name: 'Nina',
  objective: 'Vigiar o mercado',
  preset: 'operator',
  floorId: FLOOR_ID,
  tools: [],
  builtinTools: [],
  appGrants: [],
  status: 'active',
  activationModes: ['scheduled'],
  delegationPolicy: 'none',
  callerPolicy: 'all',
  callableAgentIds: [],
  callableSectorIds: [],
  allowedCallerAgentIds: [],
  createdAt: NOW,
  updatedAt: NOW,
}

const ROTINA_FIXA = {
  id: 'rot-fixa',
  name: 'Resumo diário',
  objective: 'Consolidar as notícias do dia',
  status: 'active',
  timezone: 'America/Sao_Paulo',
  cron: '0 9 * * *',
  recurrence: { kind: 'daily', time: '09:00' },
  scheduleLabel: 'Todo dia às 09:00',
  input: 'foco em política nacional',
  outputFormat: 'markdown',
  delivery: null,
  lastPublishedVersion: 1,
  nextRunAt: null,
  source: { kind: 'fixed' },
  createdAt: NOW,
  updatedAt: NOW,
}

const ROTINA_RSS = {
  ...ROTINA_FIXA,
  id: 'rot-rss',
  name: 'Vigia do blog',
  cron: '*/15 * * * *',
  recurrence: { kind: 'minutes', every: 15 },
  scheduleLabel: 'A cada 15 minutos',
  input: '',
  source: { kind: 'rss', url: 'https://exemplo.test/feed.xml', initialWindow: '3d', focus: 'lançamentos' },
  nextRunAt: new Date(Date.now() + 600_000).toISOString(),
  monitoring: {
    lastCheckedAt: new Date(Date.now() - 180_000).toISOString(),
    lastChangedAt: new Date(Date.now() - 86_400_000).toISOString(),
    lastResult: 'no_change',
    lastRunAt: new Date(Date.now() - 180_000).toISOString(),
    lastError: null,
  },
}

let enviado: Record<string, unknown> | null = null
let testouFonte: Record<string, unknown> | null = null
let verificouAgora: string | null = null

async function stub(page: Page, opts: { rotinas?: unknown[]; preview?: unknown; previewLento?: boolean; previewFalha?: boolean } = {}) {
  enviado = null
  testouFonte = null
  verificouAgora = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))

  // O Playwright casa na ordem INVERSA do registro: a última registrada ganha. Por
  // isso a genérica vem primeiro e as específicas depois — invertido, `routines/*`
  // engoliria `routines/test-source`.
  await page.route('**/api/agents/*/routines', (r) => {
    if (r.request().method() === 'POST') {
      enviado = JSON.parse(r.request().postData() ?? '{}')
      return r.fulfill({ status: 201, json: { ...ROTINA_FIXA, ...enviado } })
    }
    return r.fulfill({ json: opts.rotinas ?? [ROTINA_FIXA] })
  })
  await page.route('**/api/agents/*/routines/*', (r) => r.fulfill({ json: ROTINA_FIXA }))
  await page.route('**/api/agents/*/routines/*/check-now', (r) => {
    verificouAgora = r.request().url()
    return r.fulfill({ json: { runId: 'run-1', status: 'queued' } })
  })
  await page.route('**/api/agents/*/routines/test-source', async (r) => {
    testouFonte = JSON.parse(r.request().postData() ?? '{}')
    if (opts.previewLento) await new Promise((resolve) => setTimeout(resolve, 1200))
    if (opts.previewFalha) return r.fulfill({ status: 500, json: {} })
    return r.fulfill({
      json: opts.preview ?? {
        ok: true,
        kind: 'rss',
        message: 'Feed lido: 12 item(ns), 4 dentro da janela escolhida.',
        itemCount: 4,
        items: [{ title: 'Primeiro item do feed', url: 'https://exemplo.test/1', publishedAt: NOW }],
      },
    })
  })

  await page.route('**/api/connections', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agent-presets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/event-triggers**', (r) => r.fulfill({ json: [] }))
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
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [{ id: FLOOR_ID, name: 'Térreo', status: 'active', color: null, order: 0 }] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
}

const abrirFluxos = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/fluxos`)
  await expect(page.getByTestId('new-routine')).toBeVisible({ timeout: 20_000 })
}

const abrirFormulario = async (page: Page) => {
  await abrirFluxos(page)
  await page.getByTestId('new-routine').click()
  await expect(page.getByTestId('routine-form')).toBeVisible()
}

// --- a rotina antiga não muda ----------------------------------------------------------

test('a fonte começa em "entrada fixa", que é o comportamento de sempre', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await expect(page.getByTestId('routine-source-kind')).toHaveValue('fixed')
  // Sem fonte, os campos de monitoramento não aparecem — e a entrada fixa, sim.
  await expect(page.getByTestId('routine-source-config')).toHaveCount(0)
  await expect(page.getByTestId('routine-input')).toBeVisible()
})

test('editar uma rotina antiga a abre sem fonte e sem perder o que ela tinha', async ({ page }) => {
  await stub(page)
  await abrirFluxos(page)
  await page.getByTestId('edit-routine').first().click()
  await expect(page.getByTestId('routine-form')).toBeVisible()
  await expect(page.getByTestId('routine-source-kind')).toHaveValue('fixed')
  await expect(page.getByTestId('routine-input')).toHaveValue('foco em política nacional')
})

test('rotina sem fonte não oferece "Verificar agora" — não há o que verificar', async ({ page }) => {
  await stub(page)
  await abrirFluxos(page)
  await expect(page.getByTestId('check-now')).toHaveCount(0)
  await expect(page.getByTestId('routine-monitoring')).toHaveCount(0)
})

// --- configurar um monitoramento --------------------------------------------------------

test('escolher um feed revela endereço, janela e foco', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('routine-source-kind').selectOption('rss')
  await expect(page.getByTestId('routine-source-config')).toBeVisible()
  await expect(page.getByTestId('routine-source-url')).toBeVisible()
  await expect(page.getByTestId('routine-initial-window')).toBeVisible()
  await expect(page.getByTestId('routine-source-focus')).toBeVisible()
  // A entrada fixa some: com uma fonte, o agente processa o que chegou dela, e um
  // texto fixo aqui não seria usado.
  await expect(page.getByTestId('routine-input')).toHaveCount(0)
})

test('página/API não pede janela inicial — ela só faz sentido para feed', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('routine-source-kind').selectOption('http')
  await expect(page.getByTestId('routine-source-url')).toBeVisible()
  await expect(page.getByTestId('routine-initial-window')).toHaveCount(0)
})

test('o custo é dito onde a dúvida aparece', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('routine-source-kind').selectOption('rss')
  await expect(page.getByTestId('source-cost-note')).toContainText(/não usa tokens/i)
  await expect(page.getByTestId('source-cost-note')).toContainText(/processa uma mudança/i)
})

test('as frequências curtas existem, e "a cada 15 minutos" não pede horário', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  // Elas só existem para quem monitora — numa rotina de entrada fixa seriam 288
  // chamadas por dia com a mesma entrada.
  await page.getByTestId('routine-source-kind').selectOption('rss')
  await page.getByTestId('routine-frequency').selectOption('minutes')
  await expect(page.getByTestId('routine-every-minutes')).toBeVisible()
  // "A cada 15 minutos" não tem hora do dia: o campo de horário sai de cena.
  await expect(page.getByTestId('routine-time')).toHaveCount(0)

  await page.getByTestId('routine-frequency').selectOption('hourly')
  await expect(page.getByTestId('routine-time')).toHaveCount(0)

  await page.getByTestId('routine-frequency').selectOption('daily')
  await expect(page.getByTestId('routine-time')).toBeVisible()
})

test('salvar manda a fonte e a frequência escolhidas', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('routine-objective').fill('avisar sobre lançamentos')
  await page.getByTestId('routine-source-kind').selectOption('rss')
  await page.getByTestId('routine-source-url').fill('https://exemplo.test/feed.xml')
  await page.getByTestId('routine-initial-window').selectOption('7d')
  await page.getByTestId('routine-source-focus').fill('só produtos novos')
  await page.getByTestId('routine-frequency').selectOption('minutes')
  await page.getByTestId('routine-every-minutes').selectOption('30')
  await page.getByTestId('save-routine').click()

  await expect.poll(() => enviado).toBeTruthy()
  expect(enviado!.source).toEqual({ kind: 'rss', url: 'https://exemplo.test/feed.xml', initialWindow: '7d', focus: 'só produtos novos' })
  expect(enviado!.recurrence).toEqual({ kind: 'minutes', every: 30 })
})

test('endereço vazio ou sem http é recusado ANTES de chegar ao servidor', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('routine-objective').fill('vigiar')
  await page.getByTestId('routine-source-kind').selectOption('http')
  await page.getByTestId('save-routine').click()
  await expect(page.getByTestId('routine-error')).toContainText(/endereço/i)
  expect(enviado).toBeNull()

  await page.getByTestId('routine-source-url').fill('exemplo.test/sem-protocolo')
  await page.getByTestId('save-routine').click()
  await expect(page.getByTestId('routine-error')).toContainText(/http/i)
  expect(enviado).toBeNull()
})

// --- testar a fonte ---------------------------------------------------------------------

test('testar a fonte mostra o que ela devolve, sem executar a rotina', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('routine-source-kind').selectOption('rss')
  await page.getByTestId('routine-source-url').fill('https://exemplo.test/feed.xml')
  await page.getByTestId('test-source').click()

  await expect(page.getByTestId('source-preview')).toBeVisible()
  await expect(page.getByTestId('source-preview')).toContainText('12 item(ns)')
  await expect(page.getByTestId('source-preview-items')).toContainText('Primeiro item do feed')
  // Testar NÃO cria execução: o endpoint de verificação não foi chamado.
  expect(verificouAgora).toBeNull()
  expect(testouFonte).toMatchObject({ kind: 'rss', url: 'https://exemplo.test/feed.xml' })
})

test('enquanto consulta, o botão diz que está consultando', async ({ page }) => {
  await stub(page, { previewLento: true })
  await abrirFormulario(page)
  await page.getByTestId('routine-source-kind').selectOption('rss')
  await page.getByTestId('routine-source-url').fill('https://exemplo.test/feed.xml')
  await page.getByTestId('test-source').click()
  await expect(page.getByTestId('test-source')).toContainText('Consultando…')
  await expect(page.getByTestId('source-preview')).toBeVisible({ timeout: 15_000 })
})

test('fonte que não responde é dita na tela, não engolida', async ({ page }) => {
  await stub(page, { previewFalha: true })
  await abrirFormulario(page)
  await page.getByTestId('routine-source-kind').selectOption('rss')
  await page.getByTestId('routine-source-url').fill('https://exemplo.test/quebrado')
  await page.getByTestId('test-source').click()
  await expect(page.getByTestId('source-preview')).toContainText(/não foi possível/i)
})

test('feed recusado pelo servidor mostra o motivo que o servidor deu', async ({ page }) => {
  await stub(page, { preview: { ok: false, kind: 'rss', message: 'Endereço privado não é permitido.' } })
  await abrirFormulario(page)
  await page.getByTestId('routine-source-kind').selectOption('rss')
  await page.getByTestId('routine-source-url').fill('http://192.168.0.1/feed')
  await page.getByTestId('test-source').click()
  await expect(page.getByTestId('source-preview')).toContainText('Endereço privado não é permitido.')
})

test('feed vazio na janela é dito, com a saída sugerida', async ({ page }) => {
  await stub(page, { preview: { ok: true, kind: 'rss', message: 'Feed lido: 8 item(ns), 0 dentro da janela escolhida.', itemCount: 0, items: [] } })
  await abrirFormulario(page)
  await page.getByTestId('routine-source-kind').selectOption('rss')
  await page.getByTestId('routine-source-url').fill('https://exemplo.test/antigo')
  await page.getByTestId('test-source').click()
  await expect(page.getByTestId('source-preview-empty')).toContainText(/janela maior/i)
})

// --- a lista ----------------------------------------------------------------------------

test('a lista mostra o tipo da fonte, a última verificação e a última novidade', async ({ page }) => {
  await stub(page, { rotinas: [ROTINA_RSS] })
  await abrirFluxos(page)
  await expect(page.getByTestId('routine-source-tag')).toContainText('Feed RSS')
  const linha = page.getByTestId('routine-monitoring')
  await expect(linha).toContainText(/Verificado há 3 min/)
  // "Sem novidade" é um SUCESSO, e a tela diz isso com essas palavras — não é erro
  // e não pode parecer erro.
  await expect(linha).toContainText('sem novidade')
  await expect(linha).toContainText(/última novidade há 1 dia/)
  await expect(linha).toContainText(/próxima/)
})

test('"Verificar agora" enfileira a execução de verdade', async ({ page }) => {
  await stub(page, { rotinas: [ROTINA_RSS] })
  await abrirFluxos(page)
  await page.getByTestId('check-now').click()
  await expect.poll(() => verificouAgora).toContain('/routines/rot-rss/check-now')
  // O botão continua dizendo o que faz; a confirmação é uma linha à parte.
  await expect(page.getByTestId('check-now-queued')).toContainText(/enfileirada/i)
})

test('uma falha na verificação aparece com o motivo', async ({ page }) => {
  await stub(page, {
    rotinas: [{ ...ROTINA_RSS, monitoring: { ...ROTINA_RSS.monitoring, lastResult: 'failed', lastError: { kind: 'fetch', message: 'A fonte não respondeu.' } } }],
  })
  await abrirFluxos(page)
  await expect(page.getByTestId('routine-monitoring')).toContainText('falhou ao verificar')
  await expect(page.getByTestId('routine-monitoring-error')).toContainText('A fonte não respondeu.')
})

test('rotina nunca verificada diz isso em vez de mostrar vazio', async ({ page }) => {
  await stub(page, {
    rotinas: [{ ...ROTINA_RSS, monitoring: { lastCheckedAt: null, lastChangedAt: null, lastResult: null, lastRunAt: null, lastError: null } }],
  })
  await abrirFluxos(page)
  await expect(page.getByTestId('routine-monitoring')).toContainText('Ainda não verificado')
  await expect(page.getByTestId('routine-monitoring')).toContainText('nenhuma novidade ainda')
})

// --- no celular -------------------------------------------------------------------------

test('o formulário de fonte funciona no celular, sem rolagem lateral', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('routine-source-kind').selectOption('rss')
  await expect(page.getByTestId('routine-source-url')).toBeVisible()
  await page.getByTestId('routine-source-url').fill('https://exemplo.test/feed.xml')
  await expect(page.getByTestId('test-source')).toBeVisible()

  const excesso = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(excesso, 'a página não pode rolar de lado no celular').toBeLessThanOrEqual(1)
})

test('a lista de monitoramento cabe em 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await stub(page, { rotinas: [ROTINA_RSS] })
  await abrirFluxos(page)
  await expect(page.getByTestId('routine-monitoring')).toBeVisible()
  const excesso = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(excesso).toBeLessThanOrEqual(1)
})

// --- proteção de custo -----------------------------------------------------------------

test('entrada fixa não oferece verificar de 5 em 5 minutos', async ({ page }) => {
  // 288 execuções por dia com exatamente a mesma entrada é conta alta em troca de
  // nada. Quem monitora pode: a consulta é de graça, e a LLM só roda se mudar.
  await stub(page)
  await abrirFormulario(page)
  const frequencia = page.getByTestId('routine-frequency')
  await expect(frequencia.locator('option[value="minutes"]')).toHaveCount(0)
  await expect(frequencia.locator('option[value="hourly"]')).toHaveCount(0)
  await expect(frequencia.locator('option[value="daily"]')).toHaveCount(1)
})

test('escolher uma fonte libera os intervalos curtos', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('routine-source-kind').selectOption('rss')
  const frequencia = page.getByTestId('routine-frequency')
  await expect(frequencia.locator('option[value="minutes"]')).toHaveCount(1)
  await expect(frequencia.locator('option[value="hourly"]')).toHaveCount(1)

  await frequencia.selectOption('minutes')
  await expect(page.getByTestId('routine-every-minutes')).toBeVisible()
})

test('voltar para entrada fixa com intervalo curto cai para diária, sem beco sem saída', async ({ page }) => {
  // O beco: a frequência some da lista mas continua selecionada, o formulário fica
  // com um valor inválido e o dono só descobre no erro de salvamento.
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('routine-source-kind').selectOption('rss')
  await page.getByTestId('routine-frequency').selectOption('minutes')

  await page.getByTestId('routine-source-kind').selectOption('fixed')
  await expect(page.getByTestId('routine-frequency')).toHaveValue('daily')
  await expect(page.getByTestId('routine-every-minutes')).toHaveCount(0)
  await expect(page.getByTestId('routine-time')).toBeVisible()
})

test('a rotina salva com a frequência que ficou na tela', async ({ page }) => {
  await stub(page)
  await abrirFormulario(page)
  await page.getByTestId('routine-source-kind').selectOption('rss')
  await page.getByTestId('routine-source-url').fill('https://exemplo.test/feed.xml')
  await page.getByTestId('routine-objective').fill('Vigiar lançamentos')
  await page.getByTestId('routine-frequency').selectOption('minutes')
  await page.getByTestId('routine-every-minutes').selectOption('5')
  await page.getByTestId('save-routine').click()

  await expect.poll(() => enviado).not.toBeNull()
  expect(enviado?.recurrence).toEqual({ kind: 'minutes', every: 5 })
  expect(enviado?.source).toMatchObject({ kind: 'rss', url: 'https://exemplo.test/feed.xml' })
})

// --- concorrência na lista -------------------------------------------------------------

test('"já estava sendo verificada" é dito como tal, não como erro nem como calmaria', async ({ page }) => {
  await stub(page, {
    rotinas: [{ ...ROTINA_RSS, monitoring: { ...ROTINA_RSS.monitoring, lastResult: 'skipped_concurrent', lastError: null } }],
  })
  await abrirFluxos(page)
  const linha = page.getByTestId('routine-monitoring')
  await expect(linha).toContainText('já estava sendo verificada')
  // Não é falha: nada de mensagem de erro na linha.
  await expect(page.getByTestId('routine-monitoring-error')).toHaveCount(0)
})
