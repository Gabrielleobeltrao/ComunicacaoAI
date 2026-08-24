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

// --- o painel de acompanhamento -------------------------------------------------------------
//
// A resposta de um time é um texto; o que ela não conta é COMO se chegou até ela. O painel
// recebe os eventos da execução real — aqui eles chegam pela rota de recuperação, que é o
// mesmo formato que o socket entrega ao vivo.

const TRILHA = [
  { executionId: 'x', timestamp: '2026-08-19T10:00:00.000Z', type: 'user_prompt', status: 'info', title: 'Pedido recebido', input: 'quanto foi o mês?' },
  {
    executionId: 'x',
    timestamp: '2026-08-19T10:00:01.000Z',
    type: 'planner',
    status: 'success',
    title: 'Plano da rodada 1: 2 tarefa(s)',
    metadata: {
      round: 1,
      selected: [
        { taskId: 't1', name: 'Medições', objective: 'o que mudou na série', dependsOn: [] },
        { taskId: 't2', name: 'Ocorrências', objective: 'eventos do período', dependsOn: [] },
      ],
      notSelected: [{ name: 'Jurídico', affinity: 0 }],
    },
  },
  { executionId: 'x', timestamp: '2026-08-19T10:00:02.000Z', type: 'delegation', status: 'running', title: 'Coordenador → Medições', input: 'o que mudou na série' },
  { executionId: 'x', timestamp: '2026-08-19T10:00:03.000Z', type: 'rag', status: 'success', title: 'Medições: base — 2 trecho(s)', metadata: { passages: 2 } },
  {
    executionId: 'x',
    timestamp: '2026-08-19T10:00:04.000Z',
    type: 'web_search',
    status: 'success',
    title: 'Medições: busca na web — 8 resultado(s), 3 página(s) lida(s), 2 evidência(s)',
    input: 'preço do açúcar hoje',
    metadata: {
      provider: 'brave',
      reason: 'a base não respondeu',
      found: 8,
      selected: [{ url: 'https://a.com', title: 'A', score: 9 }],
      read: [
        { url: 'https://a.com', ok: true, usefulChars: 900, durationMs: 120 },
        { url: 'https://b.com', ok: false, code: 'blocked', usefulChars: 0, durationMs: 80 },
      ],
      evidence: [{ url: 'https://a.com', title: 'A' }],
    },
  },
  { executionId: 'x', timestamp: '2026-08-19T10:00:04.000Z', type: 'tool', status: 'error', title: 'Medições: consultar_fonte', metadata: { error: 'Error' } },
  { executionId: 'x', timestamp: '2026-08-19T10:00:05.000Z', type: 'agent', status: 'success', title: 'Medições concluiu', durationMs: 1200, model: 'claude-sonnet-5', metadata: { usage: { inputTokens: 900, outputTokens: 120 } } },
  { executionId: 'x', timestamp: '2026-08-19T10:00:06.000Z', type: 'synthesis', status: 'success', title: 'Consolidação concluída', durationMs: 800 },
  { executionId: 'x', timestamp: '2026-08-19T10:00:07.000Z', type: 'final', status: 'success', title: 'Resposta final' },
]

async function abrirComTrilha(page: Page) {
  await stubApi(page)
  await page.route('**/api/executions/*/trace', (r) => r.fulfill({ json: { events: TRILHA } }))
  await page.route('**/api/agents/*/playground', (r) =>
    r.request().method() === 'POST'
      ? r.fulfill({ json: { reply: 'pronto', toolCalls: [], diagnostics: { model: 'x' } } })
      : r.fulfill({ json: { turns: [] } }),
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/atividade`)
  await page.getByPlaceholder('Mensagem do visitante...').fill('quanto foi o mês?')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect(page.getByTestId('execution-trace')).toBeVisible()
}

test('o painel mostra o caminho da execução ao lado do chat', async ({ page }) => {
  await abrirComTrilha(page)
  const painel = page.getByTestId('execution-trace')
  await expect(painel.getByText('Plano da rodada 1: 2 tarefa(s)')).toBeVisible()
  await expect(painel.getByText('Coordenador → Medições')).toBeVisible()
  await expect(painel.getByText('Medições: base — 2 trecho(s)')).toBeVisible()
  await expect(painel.getByText('Consolidação concluída')).toBeVisible()
  await expect(painel.getByText('Resposta final')).toBeVisible()
  // O total sai da própria trilha, e os tokens só aparecem porque o provedor os relatou.
  await expect(painel).toContainText('1020 tokens')
  await expect(painel).toContainText('7.0 s')
})

test('cada evento abre e conta o que fez', async ({ page }) => {
  await abrirComTrilha(page)
  const painel = page.getByTestId('execution-trace')
  await painel.getByText('Plano da rodada 1: 2 tarefa(s)').click()
  const detalhe = painel.getByTestId('trace-event-detail').first()
  // As duas perguntas que o painel existe para responder: quem foi escolhido, e quem não.
  await expect(detalhe).toContainText('Medições')
  await expect(detalhe).toContainText('o que mudou na série')
  await expect(detalhe).toContainText('Jurídico')
})

test('os filtros isolam o que se procura, inclusive os erros', async ({ page }) => {
  await abrirComTrilha(page)
  const painel = page.getByTestId('execution-trace')
  await painel.getByTestId('trace-filter-errors').click()
  await expect(painel.getByTestId('trace-event')).toHaveCount(1)
  await expect(painel.getByText('Medições: consultar_fonte')).toBeVisible()

  await painel.getByTestId('trace-filter-rag').click()
  await expect(painel.getByTestId('trace-event')).toHaveCount(1)
  await expect(painel.getByText('Medições: base — 2 trecho(s)')).toBeVisible()

  await painel.getByTestId('trace-filter-all').click()
  await expect(painel.getByTestId('trace-event')).toHaveCount(TRILHA.length)
})

test('limpar esvazia o painel sem tocar na conversa', async ({ page }) => {
  await abrirComTrilha(page)
  const painel = page.getByTestId('execution-trace')
  await painel.getByTestId('trace-clear').click()
  await expect(painel.getByTestId('trace-event')).toHaveCount(0)
  // A conversa continua onde estava: são duas coisas, e limpar uma não apaga a outra.
  await expect(page.getByTestId('playground-messages')).toContainText('quanto foi o mês?')
})


// --- a busca na web, com lugar próprio -------------------------------------------------------
//
// Ela saía como "Base" — mesmo ícone, mesmo rótulo, mesmo filtro da leitura do que já
// estava guardado. Consultar a base é local e de graça; ir para a internet gasta uma
// requisição da franquia e traz a página de um terceiro.

test('a busca na web aparece separada da leitura da base', async ({ page }) => {
  await abrirComTrilha(page)

  const busca = page.getByTestId('trace-event').filter({ hasText: 'busca na web' })
  await expect(busca).toBeVisible()
  await expect(busca).toHaveAttribute('data-type', 'web_search')

  // O filtro próprio: quem abre o painel querendo saber "ele foi para a internet?" não
  // precisa mais ler evento por evento dentro de "Base".
  await page.getByTestId('trace-filter-web').click()
  await expect(page.getByTestId('trace-event')).toHaveCount(1)
  await expect(page.getByTestId('trace-event')).toContainText('busca na web')
})

test('a busca abre mostrando o funil e as páginas que não abriram', async ({ page }) => {
  await abrirComTrilha(page)
  const busca = page.getByTestId('trace-event').filter({ hasText: 'busca na web' })
  await busca.getByTestId('trace-event-toggle').click()

  // O funil é a história da busca: dezenas encontradas, poucas escolhidas, menos abertas,
  // e de algumas sai texto. Quando a resposta vem fraca, a pergunta é em qual degrau ela
  // afinou.
  const detalhe = busca.getByTestId('trace-web-search')
  await expect(detalhe).toContainText('encontrados')
  await expect(detalhe).toContainText('com evidência')

  // Um site que bloqueia leitura é a causa mais comum de "buscou e não trouxe nada", e
  // sem a lista ele ficava invisível.
  await expect(busca.getByTestId('trace-web-pages')).toContainText('b.com')
  await expect(detalhe).toContainText('via brave')
})
