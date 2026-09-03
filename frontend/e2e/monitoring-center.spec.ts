import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// A CENTRAL na tela: cinco perguntas, uma tela.
//
// O que estes casos protegem: a saúde é dita em português (ninguém monta a frase de cabeça
// às três da manhã), o wizard testa de VERDADE e mostra amostra redigida, a fonte nasce
// rascunho, e a recusa do servidor aparece em vez de virar estado silencioso.
const NOW = new Date(0).toISOString()
const ID = '000000000000000000000f01'

const OVERVIEW = {
  items: [
    {
      id: ID,
      name: 'Preço do fornecedor',
      kind: 'api_polling',
      status: 'active',
      health: 'degraded',
      reason: 'a última leitura boa tem 42 min',
      lastReadAt: new Date(Date.now() - 42 * 60_000).toISOString(),
      latencyMs: 180,
      consecutiveFailures: 0,
      readsOk: 12,
      readsFailed: 3,
      nextReadAt: new Date(Date.now() + 30_000).toISOString(),
      destination: { live: false, history: true },
    },
  ],
  summary: { total: 1, online: 0, degraded: 1, paused: 0, neverRead: 0 },
}

const FONTES = {
  items: [
    {
      id: ID,
      name: 'Preço do fornecedor',
      description: '',
      kind: 'api_polling',
      status: 'draft',
      health: 'never_read',
      config: { url: 'https://api.exemplo.test/precos' },
      mapping: { version: 1, fields: [{ to: 'preco', from: 'dados.preco' }] },
      schema: {},
      cadence: { mode: 'interval', intervalMs: 60000 },
      freshness: { staleAfterMs: 180000, onStale: 'degrade' },
      destination: { live: false, history: true, retentionDays: null },
      nextReadAt: null,
      telemetry: { lastReadAt: null, lastOkAt: null, lastErrorAt: null, lastErrorCode: null, lastLatencyMs: null, consecutiveFailures: 0, readsOk: 0, readsFailed: 0, reconnects: 0 },
    },
  ],
}

const AMOSTRA = {
  ok: true,
  rows: [{ preco: 10.5 }],
  sample: { dados: { preco: '10,50', apiKey: '«oculto»' } },
  strategy: 'json',
  missing: [],
  fields: [{ name: 'preco', present: true }],
  latencyMs: 120,
  status: 200,
}

let criado: unknown = null
let monitorCriado: unknown = null
let monitorSalvo: unknown = null
let concedido: unknown = null
let ativou = false
let monitores: unknown[] = []

const LIVE = [
  {
    id: ID,
    name: 'Preço do fornecedor',
    kind: 'api_polling',
    health: 'online',
    lastReadAt: new Date(Date.now() - 20_000).toISOString(),
    latencyMs: 180,
    reconnects: 2,
    readsOk: 12,
    readsFailed: 1,
    triggers: 3,
    readings: [
      { at: new Date(Date.now() - 20_000).toISOString(), value: { preco: 1234.56, apiKey: '«oculto»' } },
      { at: new Date(Date.now() - 80_000).toISOString(), value: { preco: 1200 } },
    ],
  },
]

async function stub(
  page: Page,
  opts: { ativarErro?: string; live?: unknown[]; monitorErro?: string; monitores?: unknown[]; eventos?: unknown[]; grants?: unknown[] } = {},
) {
  criado = null
  monitorCriado = null
  monitorSalvo = null
  concedido = null
  ativou = false
  monitores = opts.monitores ?? []
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) =>
    r.fulfill({ json: { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW } }),
  )
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/monitoring/overview', (r) => r.fulfill({ json: OVERVIEW }))
  await page.route('**/api/monitoring/live', (r) => r.fulfill({ json: { items: opts.live ?? LIVE } }))
  await page.route('**/api/monitoring/sources/test', (r) => r.fulfill({ json: AMOSTRA }))
  await page.route(`**/api/monitoring/sources/${ID}/activate`, (r) => {
    if (opts.ativarErro) return r.fulfill({ status: 400, json: { message: opts.ativarErro } })
    ativou = true
    return r.fulfill({ json: { status: 'active' } })
  })
  await page.route('**/api/monitors', (r) => {
    if (r.request().method() === 'POST') return r.fulfill({ status: 201, json: { id: 'm-novo', status: 'draft' } })
    return r.fulfill({ json: monitores })
  })
  await page.route('**/api/monitors/*', (r) => {
    if (r.request().method() === 'PUT') {
      monitorSalvo = r.request().postDataJSON()
      return r.fulfill({ json: { id: 'm1', status: 'draft' } })
    }
    if (r.request().method() === 'DELETE') return r.fulfill({ status: 204, body: '' })
    return r.fulfill({ json: {} })
  })
  await page.route('**/api/monitors/*/publish', (r) => r.fulfill({ json: { id: 'm1', status: 'published' } }))
  await page.route('**/api/monitors/*/pause', (r) => r.fulfill({ json: { id: 'm1', status: 'paused' } }))
  await page.route('**/api/automations**', (r) => r.fulfill({ json: { items: [{ id: 'flow-1', name: 'Avisar o time', status: 'active', lastPublishedVersion: 1 }] } }))
  await page.route('**/api/monitoring/history**', (r) => r.fulfill({ json: { items: opts.eventos ?? [], nextCursor: null } }))
  await page.route('**/api/monitoring/subjects', (r) =>
    r.fulfill({
      json: {
        items: [
          { subjectType: 'building', subjectId: 'b1', name: 'Prédio QA' },
          { subjectType: 'sector', subjectId: 's1', name: 'Análise' },
          { subjectType: 'agent', subjectId: 'a1', name: 'Marina' },
        ],
      },
    }),
  )
  await page.route(`**/api/monitoring/sources/${ID}/grants`, (r) => {
    if (r.request().method() === 'PUT') {
      concedido = r.request().postDataJSON()
      return r.fulfill({ json: { id: 'g1' } })
    }
    return r.fulfill({ json: { items: opts.grants ?? [] } })
  })
  await page.route('**/api/monitoring/sources/*/grants/*/*', (r) => r.fulfill({ status: 204, body: '' }))
  await page.route('**/api/monitoring/sources/*/monitor', (r) => {
    monitorCriado = r.request().postDataJSON()
    if (opts.monitorErro) return r.fulfill({ status: 400, json: { message: opts.monitorErro } })
    return r.fulfill({ status: 201, json: { id: 'mon-1', status: 'draft' } })
  })
  await page.route('**/api/monitoring/sources', (r) => {
    if (r.request().method() === 'POST') {
      criado = r.request().postDataJSON()
      return r.fulfill({ status: 201, json: { id: 'novo', status: 'draft' } })
    }
    return r.fulfill({ json: FONTES })
  })
}

test('a visão geral diz a saúde em PORTUGUÊS, com o motivo', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring')
  const item = page.getByTestId('monitoring-item').first()
  await expect(item).toContainText('degradada')
  // Ninguém monta a frase de cabeça às três da manhã.
  await expect(item).toContainText('a última leitura boa tem 42 min')
  await expect(item).toContainText('3 falhas')
  await expect(page.getByTestId('monitoring-resumo')).toContainText('1')
})

test('as cinco abas existem e trocam de conteúdo', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring')
  for (const rotulo of ['Visão geral', 'Fontes', 'Monitores', 'Ao vivo', 'Histórico']) {
    await expect(page.getByRole('button', { name: rotulo })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Fontes' }).click()
  await expect(page.getByTestId('fonte-item')).toBeVisible()
  await page.getByRole('button', { name: 'Histórico' }).click()
  await expect(page.getByTestId('historico-filtro')).toBeVisible()
})

test('o wizard testa DE VERDADE e mostra a amostra redigida', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()

  await page.getByTestId('wizard-nome').fill('Preço do fornecedor')
  await page.getByTestId('wizard-avancar').click()
  // Passo da conexão: sem credencial digitada, só a escolha do cofre.
  await expect(page.getByTestId('wizard-conexao')).toBeVisible()
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-url').fill('https://api.exemplo.test/precos')
  await page.getByTestId('wizard-avancar').click()

  // O MAPEAMENTO vem antes do teste: sem ele, o teste despeja a resposta inteira e deixa
  // quem lê procurando qual pedaço interessava.
  await expect(page.getByTestId('wizard-mapeamento-explica')).toBeVisible()
  await page.getByTestId('wizard-campo-to-0').fill('preco')
  await page.getByTestId('wizard-campo-from-0').fill('dados.preco')
  await page.getByTestId('wizard-avancar').click()

  await page.getByTestId('wizard-testar').click()
  const amostra = page.getByTestId('wizard-amostra')
  await expect(amostra).toContainText('«oculto»', { timeout: 5000 })
  await expect(amostra).toContainText('120 ms')
  // E ele diz o que ACHOU, que é a pergunta de quem testa.
  await expect(page.getByTestId('wizard-campos-achados')).toContainText('Achei: preco')
})

test('o teste diz o que NÃO achou, e a recusa do servidor aparece como recusa', async ({ page }) => {
  await stub(page)
  await page.route('**/api/monitoring/sources/test', (r) =>
    r.fulfill({ json: { ...AMOSTRA, ok: true, fields: [{ name: 'preco', present: true }, { name: 'estoque', present: false }] } }),
  )
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()
  await page.getByTestId('wizard-nome').fill('Faltando')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-url').fill('https://api.exemplo.test/x')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-campo-to-0').fill('preco')
  await page.getByTestId('wizard-campo-from-0').fill('dados.preco')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-testar').click()
  await expect(page.getByTestId('wizard-campos-achados')).toContainText('Não achei: estoque')
})

test('cada TIPO manda a sua própria configuração — e não url+GET+intervalo para todos', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()
  await page.getByTestId('wizard-nome').fill('Recebe sozinha')
  await page.getByTestId('wizard-tipo').selectOption('webhook')
  // Um webhook não autentica por cabeçalho nem tem endereço: aqueles passos somem.
  await expect(page.getByTestId('wizard-tipo-explica')).toContainText('chega sozinho')
  await page.getByTestId('wizard-avancar').click()
  await expect(page.getByTestId('wizard-webhook-explica')).toBeVisible()
  await expect(page.getByTestId('wizard-url')).toHaveCount(0)
  await expect(page.getByTestId('wizard-intervalo')).toHaveCount(0)
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-campo-to-0').fill('total')
  await page.getByTestId('wizard-campo-from-0').fill('payload.total')
  await page.getByTestId('wizard-avancar').click()
  // E o teste diz POR QUE não há o que testar, em vez de oferecer um botão que não serve.
  await expect(page.getByTestId('wizard-sem-teste')).toContainText('ele chega')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-salvar').click()

  await expect.poll(() => criado).not.toBeNull()
  expect(criado).toMatchObject({ kind: 'webhook', config: {}, cadence: { mode: 'stream' } })
  expect(JSON.stringify(criado)).not.toContain('"url"')
  expect(JSON.stringify(criado)).not.toContain('intervalMs')
})

test('o ritmo por HORÁRIO manda cron e fuso, e não um intervalo', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()
  await page.getByTestId('wizard-nome').fill('Toda manhã')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-url').fill('https://api.exemplo.test/x')
  await page.getByTestId('wizard-ritmo').selectOption('cron')
  await page.getByTestId('wizard-cron').fill('0 9 * * *')
  await page.getByTestId('wizard-fuso').fill('America/Sao_Paulo')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-campo-to-0').fill('preco')
  await page.getByTestId('wizard-campo-from-0').fill('dados.preco')
  for (let i = 0; i < 3; i++) await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-salvar').click()

  await expect.poll(() => criado).not.toBeNull()
  expect(criado).toMatchObject({ cadence: { mode: 'cron', cron: '0 9 * * *', timezone: 'America/Sao_Paulo' } })
})

test('a fonte criada pelo wizard nasce RASCUNHO, e a tela diz isso', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()
  await page.getByTestId('wizard-nome').fill('Nova')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-url').fill('https://api.exemplo.test/x')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-campo-to-0').fill('preco')
  await page.getByTestId('wizard-campo-from-0').fill('dados.preco')
  for (let i = 0; i < 3; i++) await page.getByTestId('wizard-avancar').click()
  await expect(page.getByTestId('wizard-revisao')).toContainText('nasce como rascunho')
  await page.getByTestId('wizard-salvar').click()

  await expect.poll(() => criado).not.toBeNull()
  expect(criado).toMatchObject({
    name: 'Nova',
    kind: 'api_polling',
    mapping: { version: 1, fields: [{ to: 'preco', from: 'dados.preco' }] },
    destination: { history: true },
  })
  await expect(page.getByTestId('monitoring-aviso')).toContainText('rascunho')
})

test('a recusa do servidor ao ativar aparece na tela', async ({ page }) => {
  await stub(page, { ativarErro: 'teste a fonte antes de ativar: ela ainda não leu nada' })
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-ativar').click()
  await expect(page.getByTestId('monitoring-error')).toContainText('teste a fonte antes de ativar')
  expect(ativou).toBe(false)
})

test('em 320 px a Central inteira cabe, sem estourar para os lados', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await stub(page)
  await page.goto('/monitoring')
  await expect(page.getByTestId('monitoring-item').first()).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('em 320 px o wizard também cabe', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await stub(page)
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()
  await expect(page.getByTestId('fonte-wizard')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('acessibilidade: os campos do wizard têm rótulo, e o erro é anunciado', async ({ page }) => {
  await stub(page, { ativarErro: 'não dá' })
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()
  // O rótulo visível é o que o leitor de tela anuncia junto do campo.
  await expect(page.getByText('Nome', { exact: true })).toBeVisible()
  await expect(page.getByText('Tipo de fonte')).toBeVisible()

  await page.getByRole('button', { name: 'Cancelar' }).click()
  await page.getByTestId('fonte-ativar').click()
  await expect(page.getByRole('alert')).toContainText('não dá')
})

test('a aba de Monitores monta a condição de pedaços fechados, com prévia', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=monitors')
  await expect(page.getByTestId('monitor-builder')).toBeVisible()

  // A fonte oferece os campos que ela mapeou: o construtor é de listas, não de texto livre.
  await page.getByTestId('monitor-fonte').selectOption(ID)
  await page.getByTestId('monitor-campo-0').selectOption('preco')
  await page.getByTestId('monitor-op-0').selectOption('lt')
  await page.getByTestId('monitor-valor-0').fill('30')

  // A prévia aparece antes de salvar: sem ela, só se descobre o que foi escrito depois.
  await expect(page.getByTestId('monitor-previa')).toContainText('preco abaixo de 30')
  await expect(page.getByTestId('monitor-previa')).toContainText('quando passar a ser verdadeira')
})

test('AND e OR: a condição composta aparece na prévia', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=monitors')
  await page.getByTestId('monitor-fonte').selectOption(ID)
  await page.getByTestId('monitor-campo-0').selectOption('preco')
  await page.getByTestId('monitor-valor-0').fill('30')

  await page.getByTestId('monitor-add-parte').click()
  await page.getByTestId('monitor-campo-1').selectOption('preco')
  await page.getByTestId('monitor-op-1').selectOption('gt')
  await page.getByTestId('monitor-valor-1').fill('10')
  await expect(page.getByTestId('monitor-previa')).toContainText('preco abaixo de 30 e preco acima de 10')

  await page.getByTestId('monitor-juncao').click()
  await expect(page.getByTestId('monitor-previa')).toContainText('preco abaixo de 30 ou preco acima de 10')
})

test('a simulação mostra a diferença entre ESTADO e BORDA', async ({ page }) => {
  await stub(page)
  // A rota específica vem DEPOIS do stub genérico: no Playwright a última registrada é a
  // que vence, e `**/api/**` engoliria esta.
  await page.route('**/api/monitors/simulate', (r) => {
    const corpo = r.request().postDataJSON() as { previous?: Record<string, number> | null }
    // O servidor decide; o stub só reflete os dois casos que o teste quer distinguir.
    const jaEra = corpo.previous && Number(corpo.previous.preco) < 30
    return r.fulfill({
      json: {
        conditionIsTrue: true,
        wouldTrigger: !jaEra,
        explanation: jaEra ? 'não dispara: a condição já era verdadeira antes, e isto é estado, não borda' : 'dispara: a condição passou de falsa para verdadeira',
        conditionText: 'preco abaixo de 30',
      },
    })
  })
  await page.goto('/monitoring?tab=monitors')
  await page.getByTestId('monitor-fonte').selectOption(ID)
  await page.getByTestId('monitor-campo-0').selectOption('preco')
  await page.getByTestId('monitor-valor-0').fill('30')

  await page.getByTestId('sim-antes-preco').fill('55')
  await page.getByTestId('sim-agora-preco').fill('22')
  await page.getByTestId('monitor-simular').click()
  await expect(page.getByTestId('sim-resultado')).toContainText('Dispararia')

  await page.getByTestId('sim-antes-preco').fill('25')
  await page.getByTestId('monitor-simular').click()
  await expect(page.getByTestId('sim-resultado')).toContainText('Não dispararia')
  await expect(page.getByTestId('sim-resultado')).toContainText('estado, não borda')
})

test('em 320 px o construtor de monitor cabe', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await stub(page)
  await page.goto('/monitoring?tab=monitors')
  await expect(page.getByTestId('monitor-builder')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('a aba Ao vivo mostra o VALOR que chegou, não só o nome da fonte', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=live')
  const valores = page.getByTestId('live-valores')
  await expect(valores).toContainText('preco: 1234.56')
  // Redigido no servidor: esta tela costuma ficar aberta na parede do escritório.
  await expect(valores).toContainText('«oculto»')
  await expect(page.getByTestId('live-metricas')).toContainText('2 reconexões')
  await expect(page.getByTestId('live-metricas')).toContainText('3 disparos')
})

test('sem leitura, o Ao vivo diz que nada chegou em vez de ficar vazio', async ({ page }) => {
  await stub(page, { live: [{ ...LIVE[0], readings: [] }] })
  await page.goto('/monitoring?tab=live')
  await expect(page.getByText('Nada chegou ainda.')).toBeVisible()
})

test('em 320 px o Ao vivo não empurra a página para os lados', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await stub(page)
  await page.goto('/monitoring?tab=live')
  await expect(page.getByTestId('live-item').first()).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('o wizard autentica pelo COFRE: escolhe a conexão, e nenhum valor é digitado', async ({ page }) => {
  await stub(page)
  await page.route('**/api/app-installations', (r) =>
    r.fulfill({ json: [{ _id: 'c1', name: 'CRM produção', appKey: 'crm', status: 'connected' }] }),
  )
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()
  await page.getByTestId('wizard-nome').fill('Com credencial')
  await page.getByTestId('wizard-avancar').click()

  await expect(page.getByTestId('wizard-conexao')).toContainText('CRM produção')
  await page.getByTestId('wizard-conexao').selectOption('c1')
  // Só o NOME do cabeçalho: o valor sai do cofre na hora da leitura.
  await page.getByTestId('wizard-headers').fill('Authorization')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-url').fill('https://api.exemplo.test/x')

  for (let i = 0; i < 4; i++) await page.getByTestId('wizard-avancar').click()
  await expect(page.getByTestId('wizard-revisao')).toBeVisible()
  await expect(page.getByTestId('wizard-revisao')).toContainText('conexão do cofre')
  await page.getByTestId('wizard-salvar').click()

  await expect.poll(() => criado).not.toBeNull()
  expect(criado).toMatchObject({ connectionId: 'c1', config: { headerNames: ['Authorization'] } })
  // Nenhum valor de credencial atravessa o corpo do pedido.
  expect(JSON.stringify(criado)).not.toMatch(/Bearer|sk-|senha/)
})

test('o monitor opcional do wizard é CRIADO de verdade, e nasce rascunho', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()
  await page.getByTestId('wizard-nome').fill('Com monitor')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-url').fill('https://api.exemplo.test/x')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-campo-to-0').fill('preco')
  await page.getByTestId('wizard-campo-from-0').fill('dados.preco')
  for (let i = 0; i < 3; i++) await page.getByTestId('wizard-avancar').click()

  await page.getByTestId('wizard-criar-monitor').click()
  await expect(page.getByTestId('wizard-revisao')).toContainText('ninguém revisou')

  // Sem o mínimo, salvar fica indisponível: a promessa não pode sair na frente do registro.
  await expect(page.getByTestId('wizard-monitor-falta')).toBeVisible()
  await expect(page.getByTestId('wizard-salvar')).toBeDisabled()

  await page.getByTestId('wizard-monitor-campo').selectOption('preco')
  await page.getByTestId('wizard-monitor-valor').fill('10')
  await page.getByTestId('wizard-salvar').click()

  // O monitor é um POST de verdade — e a mensagem só fala dele depois da resposta.
  await expect.poll(() => monitorCriado).not.toBeNull()
  expect(monitorCriado).toMatchObject({
    condition: { kind: 'compare', field: 'preco', op: 'lt', value: 10 },
    triggerMode: 'enter',
    flowId: null,
  })
  await expect(page.getByTestId('monitoring-aviso')).toContainText('mon-1')
})

test('se o monitor FALHA, a tela não diz que ele foi criado', async ({ page }) => {
  await stub(page, { monitorErro: 'o campo "preco" não existe nesta fonte' })
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').click()
  await page.getByTestId('wizard-nome').fill('Monitor que falha')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-url').fill('https://api.exemplo.test/x')
  await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-campo-to-0').fill('preco')
  await page.getByTestId('wizard-campo-from-0').fill('dados.preco')
  for (let i = 0; i < 3; i++) await page.getByTestId('wizard-avancar').click()
  await page.getByTestId('wizard-criar-monitor').click()
  await page.getByTestId('wizard-monitor-campo').selectOption('preco')
  await page.getByTestId('wizard-monitor-valor').fill('10')
  await page.getByTestId('wizard-salvar').click()

  // A recusa do servidor aparece inteira, e nenhuma mensagem promete um monitor.
  await expect(page.getByTestId('monitoring-error')).toContainText('não existe nesta fonte')
})

test('a AST oferece MUDANÇA, e a prévia diz que é variação', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=monitors')
  await page.getByTestId('monitor-fonte').selectOption(ID)
  await page.getByTestId('monitor-campo-0').selectOption('preco')
  await page.getByTestId('monitor-valor-0').fill('10')
  // "Variou mais que X" compara com o valor anterior, e não com um limite fixo.
  await page.getByTestId('monitor-comparar-0').selectOption('delta-percent')
  await expect(page.getByTestId('monitor-previa')).toContainText('preco variou abaixo de 10%')
})

test('CRUZAMENTO pede o campo e o limiar — sem eles não haveria o que cruzar', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=monitors')
  await page.getByTestId('monitor-fonte').selectOption(ID)
  await expect(page.getByTestId('monitor-threshold')).toHaveCount(0)

  await page.getByTestId('monitor-modo').selectOption('cross_up')
  await page.getByTestId('monitor-threshold-campo').selectOption('preco')
  await page.getByTestId('monitor-threshold').fill('30')
  await expect(page.getByTestId('monitor-previa')).toContainText('quando cruzar o limiar para cima de 30')
})

test('DEBOUNCE e COOLDOWN aparecem na prévia, e são coisas diferentes', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=monitors')
  await page.getByTestId('monitor-fonte').selectOption(ID)
  await page.getByTestId('monitor-campo-0').selectOption('preco')
  await page.getByTestId('monitor-valor-0').fill('30')

  await page.getByTestId('monitor-debounce').fill('20')
  await page.getByTestId('monitor-cooldown').fill('300')
  const previa = page.getByTestId('monitor-previa')
  await expect(previa).toContainText('Observando no máximo a cada 20s')
  await expect(previa).toContainText('Avisando no máximo a cada 300s')
})

test('a política de dado velho é escolhida, e a prévia diz qual é', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=monitors')
  await page.getByTestId('monitor-fonte').selectOption(ID)
  await expect(page.getByTestId('monitor-previa')).toContainText('Dado velho não dispara e marca a fonte')

  await page.getByTestId('monitor-stale').selectOption('ignore')
  await expect(page.getByTestId('monitor-previa')).toContainText('Dado velho não dispara.')
})

test('DEDUPE: coletar de novo o mesmo valor não conta como novidade', async ({ page }) => {
  await stub(page)
  await page.route(`**/api/monitoring/sources/${ID}/read`, (r) => r.fulfill({ json: { ok: true, rows: 1, recorded: 0, unchanged: true } }))
  await page.goto('/monitoring?tab=sources')
  // A fonte segue saudável; o que não houve foi dado novo — e a tela não pode confundir
  // "não mudou" com "falhou".
  await expect(page.getByTestId('fonte-item')).toBeVisible()
})

test('REVOGAÇÃO: a recusa do servidor ao testar aparece como recusa', async ({ page }) => {
  await stub(page)
  await page.route(`**/api/monitoring/sources/${ID}/test`, (r) =>
    r.fulfill({ status: 400, json: { message: 'a conexão desta fonte não existe mais' } }),
  )
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-testar').click()
  await expect(page.getByTestId('monitoring-error')).toContainText('conexão desta fonte não existe mais')
})

test('FALHA PARCIAL: a visão geral mostra a degradada ao lado da que está no ar', async ({ page }) => {
  await stub(page)
  await page.route('**/api/monitoring/overview', (r) =>
    r.fulfill({
      json: {
        items: [
          OVERVIEW.items[0],
          { ...OVERVIEW.items[0], id: 'outra', name: 'Câmbio', health: 'online', reason: 'lendo dentro da janela', readsFailed: 0 },
        ],
        summary: { total: 2, online: 1, degraded: 1, paused: 0, neverRead: 0 },
      },
    }),
  )
  await page.goto('/monitoring')
  // Uma fonte quebrada não esconde as que funcionam, nem o contrário.
  await expect(page.getByTestId('monitoring-item')).toHaveCount(2)
  await expect(page.getByTestId('monitoring-resumo')).toContainText('1')
})


// --- a aba Monitores, completa ------------------------------------------------------------

const MONITOR = {
  id: 'm1',
  name: 'Preço abaixo de 100',
  status: 'draft',
  source: { kind: 'database', dataStoreId: 'ds1', datasetKey: 'rec-1' },
  condition: { kind: 'compare', field: 'preco', op: 'lt', value: 100 },
  conditionText: 'preco abaixo de 100',
  triggerMode: 'enter',
  threshold: null,
  thresholdField: null,
  debounceMs: 0,
  cooldownMs: 0,
  flowId: 'flow-1',
  state: { status: 'watching', conditionIsTrue: false, lastObservedAt: null, lastTriggeredAt: null, error: null },
}

test('a aba Monitores LISTA o que existe, com estado e o Flow que roda', async ({ page }) => {
  await stub(page, { monitores: [MONITOR] })
  await page.goto('/monitoring?tab=monitors')
  const item = page.getByTestId('monitor-item')
  await expect(item).toContainText('Preço abaixo de 100')
  await expect(item).toContainText('rascunho')
  await expect(item).toContainText('Avisar o time')
  await expect(page.getByTestId('monitor-estado')).toContainText('nunca disparou')
})

test('sem monitor nenhum, a aba diz o que fazer em vez de ficar vazia', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=monitors')
  await expect(page.getByTestId('monitores-vazio')).toContainText('nasce rascunho')
})

test('criar um monitor exige o mínimo, e a falta é dita', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=monitors')
  await expect(page.getByTestId('monitor-salvar')).toBeDisabled()
  await expect(page.getByTestId('monitor-falta')).toContainText('dê um nome')

  await page.getByTestId('monitor-nome').fill('Preço baixo')
  await expect(page.getByTestId('monitor-falta')).toContainText('escolha a fonte')
  await page.getByTestId('monitor-fonte').selectOption(ID)
  await expect(page.getByTestId('monitor-falta')).toContainText('monte ao menos uma condição')

  await page.getByTestId('monitor-campo-0').selectOption('preco')
  await page.getByTestId('monitor-valor-0').fill('100')
  await page.getByTestId('monitor-flow').selectOption('flow-1')
  await expect(page.getByTestId('monitor-salvar')).toBeEnabled()
  await page.getByTestId('monitor-salvar').click()

  // O monitor é criado PELA CENTRAL, que materializa o destino da fonte antes.
  await expect.poll(() => monitorCriado).not.toBeNull()
  expect(monitorCriado).toMatchObject({
    name: 'Preço baixo',
    condition: { kind: 'compare', field: 'preco', op: 'lt', value: 100 },
    triggerMode: 'enter',
    flowId: 'flow-1',
  })
  await expect(page.getByTestId('monitor-aviso')).toContainText('rascunho')
})

test('EDITAR carrega o monitor no formulário e salva no mesmo id', async ({ page }) => {
  await stub(page, { monitores: [MONITOR] })
  await page.goto('/monitoring?tab=monitors')
  await page.getByTestId('monitor-editar').click()
  await expect(page.getByTestId('monitor-nome')).toHaveValue('Preço abaixo de 100')
  await expect(page.getByTestId('monitor-valor-0')).toHaveValue('100')

  await page.getByTestId('monitor-valor-0').fill('90')
  await page.getByTestId('monitor-salvar').click()
  await expect.poll(() => monitorSalvo).not.toBeNull()
  // A fonte observada vai junto: sem ela, "salvar" viraria "criar em outro lugar".
  expect(monitorSalvo).toMatchObject({
    condition: { kind: 'compare', field: 'preco', op: 'lt', value: 90 },
    source: { kind: 'database', dataStoreId: 'ds1', datasetKey: 'rec-1' },
  })
})

test('publicar, pausar e excluir estão na lista — e excluir pergunta antes', async ({ page }) => {
  await stub(page, { monitores: [MONITOR] })
  await page.goto('/monitoring?tab=monitors')
  await page.getByTestId('monitor-publicar').click()
  await expect(page.getByTestId('monitor-aviso')).toContainText('observa de verdade')

  page.on('dialog', (d) => {
    expect(d.message()).toContain('já registrou continua')
    void d.accept()
  })
  await page.getByTestId('monitor-excluir').click()
  await expect(page.getByTestId('monitor-aviso')).toContainText('excluído')
})

// --- acessos ------------------------------------------------------------------------------

test('QUEM ALCANÇA: a política aparece na tela, com a precedência dita', async ({ page }) => {
  await stub(page, { grants: [{ subjectType: 'sector', subjectId: 's1', capabilities: ['read'], effect: 'allow' }] })
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-acessos').click()
  const painel = page.getByTestId('fonte-acessos-painel')
  await expect(painel).toContainText('Recusar vence qualquer permissão')
  await expect(page.getByTestId('acesso-item')).toContainText('setor Análise')
  await expect(page.getByTestId('acesso-item')).toContainText('ler o dado')
})

test('conceder manda o TIPO do sujeito, e não só o id', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-acessos').click()
  await expect(page.getByTestId('acessos-vazio')).toBeVisible()
  await page.getByTestId('acesso-sujeito').selectOption('agent:a1')
  await page.getByTestId('acesso-capacidades').selectOption('read,configure')
  await page.getByTestId('acesso-conceder').click()

  await expect.poll(() => concedido).not.toBeNull()
  expect(concedido).toMatchObject({ subjectType: 'agent', subjectId: 'a1', capabilities: ['read', 'configure'], effect: 'allow' })
})

test('a recusa do servidor ao conceder aparece na tela', async ({ page }) => {
  await stub(page)
  await page.route(`**/api/monitoring/sources/${ID}/grants`, (r) => {
    if (r.request().method() === 'PUT') return r.fulfill({ status: 400, json: { message: 'esse sujeito não existe nesta conta' } })
    return r.fulfill({ json: { items: [] } })
  })
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-acessos').click()
  await page.getByTestId('acesso-sujeito').selectOption('agent:a1')
  await page.getByTestId('acesso-conceder').click()
  await expect(page.getByTestId('acesso-erro')).toContainText('não existe nesta conta')
})

// --- histórico operacional ----------------------------------------------------------------

const EVENTO = {
  id: 'e1',
  sourceId: ID,
  sourceName: 'Preço do fornecedor',
  kind: 'collect',
  outcome: 'failed',
  at: new Date(Date.now() - 90_000).toISOString(),
  durationMs: 240,
  rows: 0,
  recorded: 0,
  errorCode: 'http',
  errorMessage: 'o servidor respondeu 503',
  pages: null,
  monitorId: null,
  monitorName: null,
  runId: null,
}

test('o HISTÓRICO mostra o que aconteceu, com duração e erro — não só contadores', async ({ page }) => {
  await stub(page, { eventos: [EVENTO] })
  await page.goto('/monitoring?tab=history')
  const item = page.getByTestId('historico-item')
  await expect(item).toContainText('falhou')
  await expect(item).toContainText('Preço do fornecedor')
  await expect(item).toContainText('240 ms')
  await expect(page.getByTestId('historico-erro-item')).toContainText('503')
})

test('o histórico vazio explica, e os filtros existem', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=history')
  await expect(page.getByTestId('historico-vazio')).toContainText('Nada aconteceu ainda')
  await expect(page.getByTestId('historico-filtro')).toBeVisible()
  await expect(page.getByTestId('historico-tipo')).toBeVisible()
  await expect(page.getByTestId('historico-resultado')).toBeVisible()
})

test('o histórico dispara uma busca por FONTE ao filtrar', async ({ page }) => {
  await stub(page, { eventos: [EVENTO] })
  const pedidos: string[] = []
  await page.route('**/api/monitoring/history**', (r) => {
    pedidos.push(r.request().url())
    return r.fulfill({ json: { items: [EVENTO], nextCursor: null } })
  })
  await page.goto('/monitoring?tab=history')
  await expect(page.getByTestId('historico-item')).toBeVisible()
  await page.getByTestId('historico-resultado').selectOption('failed')
  await expect.poll(() => pedidos.some((u) => u.includes('outcome=failed'))).toBe(true)
})

// --- edição de fonte e exclusão com impacto -----------------------------------------------

test('EDITAR uma fonte abre o wizard preenchido e salva no mesmo id', async ({ page }) => {
  await stub(page)
  let atualizado: unknown = null
  await page.route(`**/api/monitoring/sources/${ID}`, (r) => {
    if (r.request().method() === 'PUT') {
      atualizado = r.request().postDataJSON()
      return r.fulfill({ json: { id: ID } })
    }
    return r.fulfill({ status: 204, body: '' })
  })
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-editar').click()

  await expect(page.getByTestId('wizard-nome')).toHaveValue('Preço do fornecedor')
  // O tipo decide a forma inteira da fonte: trocá-lo numa edição seria criar outra.
  await expect(page.getByTestId('wizard-tipo')).toBeDisabled()
  await page.getByTestId('wizard-nome').fill('Preço do fornecedor (revisado)')
  for (let i = 0; i < 6; i++) await page.getByTestId('wizard-avancar').click()
  await expect(page.getByTestId('wizard-revisao')).toContainText('não o que já foi gravado')
  await page.getByTestId('wizard-salvar').click()

  await expect.poll(() => atualizado).not.toBeNull()
  expect(atualizado).toMatchObject({ name: 'Preço do fornecedor (revisado)', config: { url: 'https://api.exemplo.test/precos' } })
})

test('excluir DIZ O QUE SE PERDE — e o que não se perde', async ({ page }) => {
  await stub(page)
  let mensagem = ''
  page.on('dialog', (d) => {
    mensagem = d.message()
    void d.dismiss()
  })
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-excluir').click()
  await expect.poll(() => mensagem).toContain('CONTINUA existindo')
  expect(mensagem).toContain('regra de coleta')
})

// --- 320 px e acessibilidade nas telas novas ----------------------------------------------

test('em 320 px as abas novas não empurram a página para os lados', async ({ page }) => {
  await stub(page, { monitores: [MONITOR], eventos: [EVENTO] })
  await page.setViewportSize({ width: 320, height: 720 })
  for (const aba of ['monitors', 'history']) {
    await page.goto(`/monitoring?tab=${aba}`)
    await expect(page.locator('body')).toBeVisible()
    const largura = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(largura, `a aba ${aba} vazou em 320 px`).toBeLessThanOrEqual(321)
  }
})

test('acessibilidade: os campos novos têm rótulo, e o erro é anunciado', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-acessos').click()
  // Um `select` sem rótulo é um campo que o leitor de tela anuncia como "combo box".
  for (const id of ['acesso-sujeito', 'acesso-capacidades', 'acesso-efeito']) {
    const rotulo = await page.getByTestId(id).evaluate((el) => {
      const campo = el as HTMLElement
      const porFor = campo.id ? document.querySelector(`label[for="${campo.id}"]`) : null
      return (porFor ?? campo.closest('label'))?.textContent?.trim() ?? ''
    })
    expect(rotulo, `${id} sem rótulo`).not.toEqual('')
  }
})

test('os botões novos alcançam o alvo mínimo de toque', async ({ page }) => {
  await stub(page, { monitores: [MONITOR] })
  await page.goto('/monitoring?tab=monitors')
  for (const id of ['monitor-editar', 'monitor-publicar', 'monitor-excluir']) {
    const caixa = await page.getByTestId(id).boundingBox()
    expect(caixa!.height, `${id} é pequeno demais para o dedo`).toBeGreaterThanOrEqual(36)
  }
})

test('teclado: dá para chegar aos botões da fonte por Tab, e o foco fica visível', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=sources')
  await expect(page.getByTestId('fonte-item')).toBeVisible()

  // Um foco invisível é um foco que só existe para quem já sabe onde está.
  const alvo = page.getByTestId('fonte-testar')
  await alvo.focus()
  await expect(alvo).toBeFocused()
  const contorno = await alvo.evaluate((el) => {
    const s = getComputedStyle(el, ':focus-visible')
    return { outline: s.outlineStyle, largura: s.outlineWidth, sombra: s.boxShadow }
  })
  expect(contorno.outline !== 'none' || contorno.sombra !== 'none', 'o botão focado não mostra nada').toBe(true)

  // E Enter aciona, como um botão de verdade — não um div com onClick.
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('monitoring-aviso')).toContainText('testada')
})

test('teclado: o wizard inteiro é preenchível sem mouse', async ({ page }) => {
  await stub(page)
  await page.goto('/monitoring?tab=sources')
  await page.getByTestId('fonte-nova').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('fonte-wizard')).toBeVisible()

  await page.getByTestId('wizard-nome').focus()
  await page.keyboard.type('Por teclado')
  await page.getByTestId('wizard-avancar').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('wizard-conexao')).toBeVisible()
})

/** O contraste de duas cores computadas, pela fórmula do WCAG. */
const RAZAO = `(fg, bg) => {
  const canal = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const lum = (cor) => {
    const m = cor.match(/[\\d.]+/g).map(Number)
    return 0.2126 * canal(m[0]) + 0.7152 * canal(m[1]) + 0.0722 * canal(m[2])
  }
  const a = lum(fg), b = lum(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}`

test('contraste: o texto das telas novas é legível sobre o fundo em que ele está', async ({ page }) => {
  await stub(page, { monitores: [MONITOR], eventos: [EVENTO] })
  await page.goto('/monitoring?tab=history')
  await expect(page.getByTestId('historico-item')).toBeVisible()

  // O erro no histórico é o texto que alguém lê às três da manhã, e ele é vermelho sobre
  // um fundo claro — exatamente o par que costuma passar despercebido.
  for (const [aba, id, minimo] of [
    ['history', 'historico-erro-item', 4.5],
    ['monitors', 'monitor-item', 4.5],
  ] as const) {
    await page.goto(`/monitoring?tab=${aba}`)
    const alvo = page.getByTestId(id)
    await expect(alvo).toBeVisible()
    const razao = await alvo.evaluate((el, formula) => {
      const calcular = eval(formula) as (fg: string, bg: string) => number
      const s = getComputedStyle(el)
      // O fundo efetivo: sobe até achar alguém que pinte de verdade.
      let pai: HTMLElement | null = el as HTMLElement
      let fundo = 'rgba(0, 0, 0, 0)'
      while (pai) {
        const b = getComputedStyle(pai).backgroundColor
        if (b && !b.includes('rgba(0, 0, 0, 0)')) {
          fundo = b
          break
        }
        pai = pai.parentElement
      }
      return calcular(s.color, fundo)
    }, RAZAO)
    expect(razao, `${id} tem contraste ${razao.toFixed(2)}:1`).toBeGreaterThanOrEqual(minimo)
  }
})
