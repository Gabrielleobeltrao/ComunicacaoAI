import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// O chat de teste, dentro da aba Atividade, em três larguras.
//
// A resposta de um agente não é texto domesticado: vem com URL longa, identificador sem
// espaço, bloco de código. Qualquer um deles empurrava a bolha para fora da área e a
// PÁGINA ganhava uma barra de rolagem lateral — a conversa saía do lugar onde deveria
// caber. Por isso a asserção é por ELEMENTO: `scrollWidth` da página não pega o caso em
// que o corte acontece dentro de um container que rola.
const FLOOR_ID = '000000000000000000000f11'
const AGENT_ID = '000000000000000000000a11'
const NOW = new Date(0).toISOString()

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = { id: FLOOR_ID, buildingId: 'b1', name: 'Térreo', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', createdAt: NOW, updatedAt: NOW }

const preset = (p: string, label: string, over: Record<string, unknown> = {}) => ({
  preset: p,
  label,
  description: `${label} faz algo`,
  objective: `Você é um ${label.toLowerCase()}.`,
  capabilities: [],
  activationModes: ['manual'],
  inputContract: '',
  outputContract: '',
  delegationPolicy: 'none',
  callerPolicy: 'all',
  ...over,
})

const PRESETS = [
  preset('manager', 'Gerente / Orquestrador', { delegationPolicy: 'all', activationModes: ['manual', 'scheduled'] }),
  preset('secretary', 'Secretário', { delegationPolicy: 'all' }),
  // Specialists ship with NO operational trigger: a manager or a sector calls them.
  preset('researcher', 'Pesquisador', { requiresTool: true, activationModes: [] }),
  preset('analyst', 'Analista', { activationModes: [] }),
  preset('operator', 'Executor / Operador', { requiresTool: true }),
  preset('communicator', 'Comunicador', { activationModes: [] }),
  preset('monitor', 'Monitor', { requiresTool: true, activationModes: ['scheduled'] }),
  preset('custom', 'Personalizado'),
]

const AGENT = {
  _id: AGENT_ID,
  name: 'Agente Teste',
  objective: 'Objetivo de teste',
  provider: 'anthropic',
  model: null,
  memoryType: 'none',
  historyLimit: 10,
  identityEnabled: false,
  identityFields: [],
  conversationPersistence: 'same_browser',
  guardrailMode: 'none',
  structuredOutputEnabled: false,
  structuredOutputFields: [],
  structuredOutputWebhookUrl: null,
  responseTone: 'neutral',
  responseDetail: 'balanced',
  responseEmojis: false,
  responseFormatting: false,
  handoffEnabled: false,
  firstMessage: null,
  proactivityEnabled: false,
  proactivityGuidance: '',
  language: 'pt',
  dailyMessageLimit: 0,
  cheapAuxModel: true,
  promptCaching: true,
  tools: [],
  builtinTools: [],
  preset: 'researcher',
  capabilities: [],
  // A LEGACY agent: still carries agent_only, which must not break the page.
  activationModes: ['agent_only', 'manual'],
  inputContract: 'Um tema para pesquisar',
  outputContract: 'Lista com fontes',
  delegationPolicy: 'none',
  callerPolicy: 'all',
  callableAgentIds: [],
  callableSectorIds: [],
  allowedCallerAgentIds: [],
  metricProfile: 'auto',
  floorId: null,
}

const overview = (over: Record<string, unknown> = {}) => ({
  agent: AGENT,
  stats: { conversations: 0, conversationsThisWeek: 0, messagesThisWeek: 0, attendedConversations: 0, handoffs: 0, qualifiedLeads: 0 },
  channelLinked: false,
  wiring: { routineCount: 0, channelCount: 0, webhookCount: 0, collaboratorCount: 0, toolCount: 0, knowledgeCount: 0, deliveryConfigured: false },
  readiness: { ready: false, issues: [{ code: 'no_research_source', message: 'Este pesquisador não tem nenhuma fonte para consultar.', action: 'Adicionar ferramenta', section: 'como-trabalha' }] },
  triggers: [
    { kind: 'manual', allowed: true, configured: true },
    { kind: 'scheduled', allowed: true, configured: false },
    { kind: 'channel', allowed: false, configured: false },
    { kind: 'event', allowed: false, configured: false },
  ],
  availableMetrics: ['executions'],
  resolvedMetric: 'executions',
  linkedWidgets: [],
  linkedSectors: [],
  knowledgeCount: 0,
  ...over,
})


// O que um agente responde de verdade: link comprido, identificador sem espaço e um
// bloco de código. Nenhum deles tem onde quebrar.
const URL_LONGA =
  'https://www.dadosdemercado.com.br/acoes/BBSE3/proventos?periodo=2024-01-01_2026-08-18&tipo=dividendos&ordem=data_pagamento_desc'
const RESPOSTA = [
  'Encontrei o provento no endereço que você cadastrou:',
  '',
  URL_LONGA,
  '',
  'Identificador da apuração: APURACAO-BBSE3-20260818-0001-CONSOLIDADO-DEFINITIVO',
  '',
  '```json',
  '{"ticker":"BBSE3","valorPorAcao":36.42,"dataPagamento":"2026-08-25","fonte":"https://www.dadosdemercado.com.br/acoes/BBSE3/proventos"}',
  '```',
].join('\n')

async function stubApi(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  await page.route('**/api/agent-presets', (r) => r.fulfill({ json: PRESETS }))
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/overview', (r) => r.fulfill({ json: overview() }))
  await page.route('**/api/agents/*/documents', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/routines', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/sources', (r) => r.fulfill({ json: { settings: {}, sources: [] } }))
  await page.route('**/api/agents/*/history**', (r) => r.fulfill({ json: { total: 0, items: [], delegations: [] } }))
  await page.route('**/api/agent-stats**', (r) => r.fulfill({ json: { period: '30d', telemetrySince: null, stats: {}, channel: {} } }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  await page.route('**/api/providers**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/apps**', (r) => r.fulfill({ json: [] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/agents/*/playground', (r) =>
    r.request().method() !== 'POST'
    ? r.fulfill({ json: { turns: [] } })
    : r.fulfill({
      json: {
        reply: RESPOSTA,
        handoff: false,
        toolCalls: [
          {
            name: 'consultar_fonte',
            arguments: { fonte: 'Dados de Mercado', url: URL_LONGA },
            ok: true,
            result: `200 OK — ${URL_LONGA} — 8 itens novos desde a última verificação`,
          },
        ],
        diagnostics: { model: 'claude-sonnet-5', modelChoice: 'auto', modelReason: 'consulta a site', inputTokens: 1200, outputTokens: 340, durationMs: 2400 },
      },
    }),
  )
}

const LARGURAS = [
  { nome: 'telefone', w: 390 },
  { nome: 'tablet', w: 768 },
  { nome: 'desktop', w: 1440 },
]

async function conversar(page: Page) {
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/atividade`)
  const campo = page.getByPlaceholder('Mensagem do visitante...')
  await expect(campo).toBeVisible()
  await campo.fill('qual foi o último provento de BBSE3?')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect(page.getByTestId('playground-run-info')).toBeVisible()
}

for (const { nome, w } of LARGURAS) {
  test(`a conversa de teste não passa da borda no ${nome}`, async ({ page }) => {
    await stubApi(page)
    await page.setViewportSize({ width: w, height: 1000 })
    await conversar(page)

    const fora = await page.evaluate((largura) => {
      // Passar da borda é falha, EXCETO dentro de algo que rola de lado de propósito:
      // a faixa de abas (a alternativa era quebrar em duas linhas) e o bloco de código
      // (quebrar código no meio mentiria sobre o que está escrito).
      const dentroDeRolavel = (el: Element) => {
        for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
          const cs = getComputedStyle(n)
          if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return true
        }
        return false
      }
      const culpados: string[] = []
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (dentroDeRolavel(el)) continue
        const b = el.getBoundingClientRect()
        if (b.width === 0) continue
        if (b.right > largura + 1) {
          const e = el as HTMLElement
          const caminho: string[] = []
          for (let n: HTMLElement | null = e; n && caminho.length < 4; n = n.parentElement) {
            caminho.unshift(`${n.tagName}${n.dataset?.testid ? `[${n.dataset.testid}]` : ''}`)
          }
          culpados.push(`${caminho.join('>')} "${(e.textContent ?? '').slice(0, 30)}" w=${Math.round(b.width)}`)
        }
      }
      return culpados.slice(0, 6)
    }, w)
    expect(fora, `elementos além da borda em ${w}px`).toEqual([])

    const rolagem = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }))
    expect(rolagem.sw, 'a página ganhou barra de rolagem lateral').toBeLessThanOrEqual(rolagem.cw + 1)
  })
}

test('nem a área da conversa rola de lado: o texto quebra dentro da bolha', async ({ page }) => {
  await stubApi(page)
  await page.setViewportSize({ width: 390, height: 1000 })
  await conversar(page)

  const rolando = await page.evaluate(() => {
    const dentro = document.querySelector('[data-testid="playground-messages"]') as HTMLElement | null
    if (!dentro) return ['sem área de mensagens']
    const ruins: string[] = []
    // A área da conversa não rola de lado: a rolagem dela é só vertical.
    if (dentro.scrollWidth > dentro.clientWidth + 1) ruins.push(`área ${dentro.scrollWidth}>${dentro.clientWidth}`)
    // E nada dentro dela é desenhado além da sua borda — o que rola sozinho (o bloco de
    // código) está contido no próprio quadro.
    const borda = dentro.getBoundingClientRect().right
    for (const el of Array.from(dentro.querySelectorAll('*'))) {
      // O conteúdo de um quadro que rola (o bloco de código) é maior que o quadro por
      // definição — quem o segura é o quadro, e ele está dentro da área.
      let rolavel = false
      for (let n: Element | null = el.parentElement; n && n !== dentro; n = n.parentElement) {
        const cs = getComputedStyle(n)
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') rolavel = true
      }
      if (rolavel) continue
      const b = el.getBoundingClientRect()
      if (b.width > 0 && b.right > borda + 1) ruins.push(`${el.tagName} passa ${Math.round(b.right - borda)}px da borda`)
    }
    return ruins.slice(0, 6)
  })
  expect(rolando).toEqual([])
})

// --- a conversa que continua onde parou --------------------------------------------------
//
// Trocar de aba apagava tudo, e voltar ao ponto onde se estava era repetir as mesmas
// perguntas — o que custa tokens de verdade. O que é guardado é a TELA: o agente continua
// sem lembrar de teste nenhum ao atender um visitante.

const GUARDADA = {
  turns: [
    { role: 'user', content: 'qual foi o último provento de BBSE3?', at: NOW },
    {
      role: 'assistant',
      content: 'R$ 36,42 por ação, pagos em 25/08/2026.',
      diagnostics: { model: 'claude-haiku-4-5', modelChoice: 'auto', modelReason: 'pergunta direta', inputTokens: 900, outputTokens: 120, durationMs: 800 },
      at: NOW,
    },
  ],
}

test('ao abrir, a conversa anterior está lá — com o que ela custou', async ({ page }) => {
  await stubApi(page)
  await page.route('**/api/agents/*/playground', (r) =>
    r.request().method() === 'POST' ? r.fulfill({ json: { reply: 'ok', toolCalls: [] } }) : r.fulfill({ json: GUARDADA }),
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/atividade`)

  await expect(page.getByText('qual foi o último provento de BBSE3?')).toBeVisible()
  await expect(page.getByText('R$ 36,42 por ação, pagos em 25/08/2026.')).toBeVisible()
  // O custo volta junto: sem ele a conversa recarregada mentiria por omissão sobre o preço.
  await expect(page.getByTestId('playground-run-info')).toContainText('claude-haiku-4-5')
})

test('limpar é explícito, e é a única forma de apagar', async ({ page }) => {
  await stubApi(page)
  let apagou = false
  await page.route('**/api/agents/*/playground', (r) => {
    if (r.request().method() === 'DELETE') {
      apagou = true
      return r.fulfill({ status: 204, body: '' })
    }
    return r.request().method() === 'POST' ? r.fulfill({ json: { reply: 'ok', toolCalls: [] } }) : r.fulfill({ json: GUARDADA })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/atividade`)

  await expect(page.getByText('R$ 36,42 por ação, pagos em 25/08/2026.')).toBeVisible()
  await page.getByTestId('playground-clear').click()
  await expect.poll(() => apagou).toBe(true)
  await expect(page.getByText('R$ 36,42 por ação, pagos em 25/08/2026.')).toHaveCount(0)
  // Sem conversa não há o que limpar: o botão some.
  await expect(page.getByTestId('playground-clear')).toHaveCount(0)
})
