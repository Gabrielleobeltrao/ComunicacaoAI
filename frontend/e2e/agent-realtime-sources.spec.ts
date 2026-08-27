import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * As fontes em tempo real, na tela do agente.
 *
 * O que estas provas fixam: dá para ligar um dado ao vivo a um agente escolhendo a
 * conexão pelo NOME e a chave numa lista — ninguém copia id de banco —, a tela mostra o
 * status e a idade do dado, e ela diz em voz alta que **nada disso guarda histórico**.
 */
const NOW = new Date(0).toISOString()
const AGENTE = '68b0000000000000000000e1'

const FONTE = {
  id: 'src-1',
  name: 'BTC atual',
  sourceKind: 'live_data',
  sourceRef: '68b0000000000000000000a1',
  sourceLabel: 'WebSocket Genérico — Binance',
  key: 'BTCUSDT',
  alias: 'btc_price',
  allowedFields: null,
  staleAfterSeconds: 30,
  agentIds: [AGENTE],
  enabled: true,
  createdAt: NOW,
  updatedAt: NOW,
}

let criado: Record<string, unknown> | null = null
let concedido: { id: string; granted: boolean } | null = null

async function stub(page: Page, opts: { doAgente?: unknown[]; todas?: unknown[] } = {}) {
  criado = null
  concedido = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/building', (r) => r.fulfill({ json: { id: 'b1', name: 'Prédio QA', createdAt: NOW, updatedAt: NOW } }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))

  // A página do agente inteira: sem estes, o painel nem chega a montar.
  const AGENT = {
    _id: AGENTE,
    name: 'Analista de mercado',
    objective: 'acompanha preços',
    provider: 'openai',
    model: 'gpt-4o-mini',
    tools: [],
    builtinTools: [],
    appGrants: [],
    capabilities: [],
    activationModes: ['manual'],
    delegationPolicy: 'none',
    callerPolicy: 'all',
    callableAgentIds: [],
    callableSectorIds: [],
    allowedCallerAgentIds: [],
    metricProfile: 'auto',
    language: 'pt',
    floorId: 'f1',
  }
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: [AGENT] }))
  await page.route('**/api/agents/*/overview', (r) =>
    r.fulfill({
      json: {
        agent: AGENT,
        stats: { conversations: 0, conversationsThisWeek: 0, messagesThisWeek: 0, attendedConversations: 0, handoffs: 0, qualifiedLeads: 0 },
        channelLinked: false,
        availableMetrics: ['executions'],
        resolvedMetric: 'executions',
        linkedWidgets: [],
        linkedSectors: [],
        knowledgeCount: 0,
      },
    }),
  )
  await page.route('**/api/agents/*/documents', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/routines**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/event-triggers**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/app-grants', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/app-installations', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/tools', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agent-stats**', (r) => r.fulfill({ json: { period: '30d', telemetrySince: null, stats: {}, channel: {} } }))
  await page.route('**/api/agent-states**', (r) => r.fulfill({ json: {} }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route(`**/api/agents/${AGENTE}`, (r) => r.fulfill({ json: AGENT }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: [AGENT] }))

  await page.route('**/api/realtime-sources/catalog', (r) =>
    r.fulfill({
      json: {
        live_data: [
          {
            ref: '68b0000000000000000000a1',
            label: 'WebSocket Genérico — Binance',
            keys: [
              { key: 'BTCUSDT', receivedAt: NOW, updates: 1240 },
              { key: 'ETHUSDT', receivedAt: NOW, updates: 880 },
            ],
          },
        ],
      },
    }),
  )
  await page.route(`**/api/realtime-sources/agent/${AGENTE}`, (r) => r.fulfill({ json: opts.doAgente ?? [] }))
  await page.route('**/api/realtime-sources/*/agents/*', (r) => {
    const url = r.request().url()
    concedido = { id: url.split('/').slice(-3)[0], granted: (r.request().postDataJSON() as { granted?: boolean })?.granted !== false }
    return r.fulfill({ json: FONTE })
  })
  await page.route('**/api/realtime-sources/', (r) => {
    if (r.request().method() === 'POST') {
      criado = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ status: 201, json: { ...FONTE, ...criado } })
    }
    return r.fulfill({ json: opts.todas ?? [] })
  })
  await page.route('**/api/realtime-sources', (r) => r.fulfill({ json: opts.todas ?? [] }))
}

const comLeitura = (extra: Record<string, unknown> = {}) => [
  {
    ...FONTE,
    reading: { found: true, alias: 'btc_price', key: 'BTCUSDT', value: { price: 64_000 }, receivedAt: NOW, ageMs: 900, stale: false, updates: 1240, ...extra },
  },
]

test('a seção existe na aba “Como trabalha”, e diz que não guarda histórico', async ({ page }) => {
  await stub(page, { doAgente: comLeitura() })
  await page.goto(`/agents/${AGENTE}/como-trabalha`)

  const painel = page.getByTestId('agent-realtime')
  await expect(painel).toBeVisible()
  await expect(painel).toContainText('Fontes de dados em tempo real')
  // A frase que evita a confusão inteira.
  await expect(painel).toContainText('nada é guardado')
  await expect(page.getByTestId('realtime-history-note')).toContainText('Histórico: não configurado')
})

test('a fonte aparece com conexão, chave, status e idade', async ({ page }) => {
  await stub(page, { doAgente: comLeitura() })
  await page.goto(`/agents/${AGENTE}/como-trabalha`)

  const item = page.getByTestId('realtime-item')
  await expect(item).toContainText('BTC atual')
  await expect(item).toContainText('recebendo')
  await expect(item).toContainText('WebSocket Genérico — Binance')
  await expect(item).toContainText('BTCUSDT')
  // Menos de dois segundos é "agora": "há 1s" seria preciso demais para um número que
  // já mudou enquanto a tela desenhava.
  await expect(item).toContainText('Atualizado agora')
  // O apelido que o agente usa fica à vista: é ele que vai no prompt ou no código.
  await expect(item).toContainText('btc_price')
})

test('a idade aparece em segundos quando passa de dois', async ({ page }) => {
  await stub(page, { doAgente: comLeitura({ ageMs: 7_000 }) })
  await page.goto(`/agents/${AGENTE}/como-trabalha`)
  await expect(page.getByTestId('realtime-item')).toContainText('há 7s')
})

test('dado velho aparece como velho, e não como recebendo', async ({ page }) => {
  await stub(page, { doAgente: comLeitura({ stale: true, ageMs: 42_000 }) })
  await page.goto(`/agents/${AGENTE}/como-trabalha`)
  await expect(page.getByTestId('realtime-item')).toContainText('dado velho')
  await expect(page.getByTestId('realtime-item')).toContainText('há 42s')
})

test('adicionar uma fonte: conexão e chave vêm de lista, e o apelido é sugerido', async ({ page }) => {
  await stub(page, { doAgente: [] })
  await page.goto(`/agents/${AGENTE}/como-trabalha`)
  await page.getByTestId('add-realtime-source').click()

  // Pelo NOME, nunca pelo id.
  const conexao = page.getByTestId('realtime-connection')
  await expect(conexao).toContainText('WebSocket Genérico — Binance')

  // As chaves que a conexão já recebeu de verdade.
  const chave = page.getByTestId('realtime-key')
  await expect(chave).toContainText('BTCUSDT (1240 atualizações)')
  await chave.selectOption('BTCUSDT')
  // O apelido vem sugerido a partir da chave — mas dá para trocar.
  await expect(page.getByTestId('realtime-alias')).toHaveValue('btcusdt')
  await page.getByTestId('realtime-alias').fill('btc_price')
  await page.getByTestId('realtime-fields').fill('symbol, price')

  await page.getByTestId('save-realtime-source').click()
  await expect.poll(() => criado?.alias).toBe('btc_price')
  expect(criado?.key).toBe('BTCUSDT')
  expect(criado?.sourceRef).toBe('68b0000000000000000000a1')
  expect(criado?.allowedFields).toEqual(['symbol', 'price'])
  expect(criado?.agentIds).toEqual([AGENTE])
})

test('uma fonte que já existe pode ser reusada — sem abrir outra conexão', async ({ page }) => {
  await stub(page, { doAgente: [], todas: [{ ...FONTE, agentIds: ['outro-agente'] }] })
  await page.goto(`/agents/${AGENTE}/como-trabalha`)
  await page.getByTestId('add-realtime-source').click()

  await expect(page.getByTestId('realtime-existing')).toContainText('BTC atual')
  await page.getByTestId('use-existing-btc_price').click()
  // Conceder, e não criar: o mesmo stream serve os dois agentes.
  await expect.poll(() => concedido?.granted).toBe(true)
  expect(criado).toBeNull()
})

test('sem fonte nenhuma, a tela explica e não obriga a criar histórico', async ({ page }) => {
  await stub(page, { doAgente: [] })
  await page.goto(`/agents/${AGENTE}/como-trabalha`)
  await expect(page.getByTestId('agent-realtime')).toContainText('Nenhuma fonte em tempo real')
  await expect(page.getByTestId('agent-realtime')).toContainText('Não é preciso guardar histórico')
})

test('em 320px a seção não estoura a largura', async ({ page }) => {
  await stub(page, { doAgente: comLeitura() })
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto(`/agents/${AGENTE}/como-trabalha`)
  await expect(page.getByTestId('agent-realtime')).toBeVisible()
  const folga = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(folga, `estourou ${folga}px`).toBeLessThanOrEqual(1)
})
