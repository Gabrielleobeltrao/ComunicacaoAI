import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Trocar o modelo-base de um agente que já existe.
//
// A tela dizia "trocar de modelo preenche apenas os campos vazios" e não havia como
// trocar: o seletor não existia e o `applyPresetSuggestions` que o servidor aceita nunca
// era enviado por ninguém. Uma promessa sem porta.
//
// O que estas provas garantem: a troca aparece, a confirmação diz ANTES quais campos
// vazios serão preenchidos, cancelar não muda nada, e um texto escrito à mão nunca entra
// na lista. A API é dublada, então nada aqui pode passar por acaso.
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
  role: `${label}: papel do molde.`,
  instructions: `Como um ${label.toLowerCase()} trabalha.`,
  constraints: `O que um ${label.toLowerCase()} nunca faz.`,
  capabilities: [],
  activationModes: ['manual'],
  inputContract: '',
  outputContract: '',
  delegationPolicy: 'none',
  callerPolicy: 'all',
  ...over,
})

const PRESETS = [
  preset('researcher', 'Pesquisador'),
  preset('analyst', 'Analista'),
  preset('communicator', 'Comunicador'),
  // 'Personalizado' começa em branco: não tem o que sugerir.
  preset('custom', 'Personalizado', { objective: '', role: '', instructions: '', constraints: '' }),
]

const agenteBase = (over: Record<string, unknown> = {}) => ({
  _id: AGENT_ID,
  name: 'Agente Teste',
  objective: '',
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
  role: '',
  instructions: '',
  constraints: '',
  definitionEditedAt: null,
  capabilities: [],
  activationModes: ['manual'],
  inputContract: '',
  outputContract: '',
  delegationPolicy: 'none',
  callerPolicy: 'all',
  callableAgentIds: [],
  callableSectorIds: [],
  allowedCallerAgentIds: [],
  metricProfile: 'auto',
  floorId: null,
  ...over,
})

let patches: Record<string, unknown>[] = []

async function stubApi(page: Page, agente: Record<string, unknown>) {
  patches = []
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  await page.route('**/api/agent-presets', (r) => r.fulfill({ json: PRESETS }))
  await page.route('**/api/agents/*/overview', (r) =>
    r.fulfill({
      json: {
        agent: agente,
        stats: { conversations: 0, conversationsThisWeek: 0, messagesThisWeek: 0, attendedConversations: 0, handoffs: 0, qualifiedLeads: 0 },
        channelLinked: false,
        wiring: { routineCount: 0, channelCount: 0, webhookCount: 0, collaboratorCount: 0, toolCount: 0, knowledgeCount: 0, deliveryConfigured: false },
        readiness: { ready: true, issues: [] },
        triggers: [{ kind: 'manual', allowed: true, configured: true }],
        availableMetrics: ['executions'],
        resolvedMetric: 'executions',
        linkedWidgets: [],
        linkedSectors: [],
        knowledgeCount: 0,
      },
    }),
  )
  // O PATCH do agente: guarda o corpo (é ele que a prova examina) e responde como o
  // servidor responderia — aplicando a sugestão só quando ela foi pedida.
  await page.route(`**/api/agents/${AGENT_ID}`, (r) => {
    if (r.request().method() !== 'PATCH') return r.fulfill({ json: agente })
    const corpo = JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>
    patches.push(corpo)
    const spec = PRESETS.find((p) => p.preset === corpo.preset)
    const sugerido =
      spec && corpo.applyPresetSuggestions === true && !agente.definitionEditedAt
        ? {
            objective: (agente.objective as string) || spec.objective,
            role: (agente.role as string) || spec.role,
            instructions: (agente.instructions as string) || spec.instructions,
            constraints: (agente.constraints as string) || spec.constraints,
          }
        : {}
    return r.fulfill({ json: { ...agente, ...corpo, ...sugerido } })
  })
  await page.route('**/api/agents/*/documents', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agent-stats**', (r) => r.fulfill({ json: { period: '30d', telemetrySince: null, stats: {}, channel: {} } }))
  await page.route('**/api/agents/*/routines', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/event-triggers', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/connections', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  await page.route('**/api/providers**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/apps**', (r) => r.fulfill({ json: [] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) => r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }))
}

const abrirAvancado = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/avancado`)
  // Os blocos avançados nascem fechados (os filhos ficam montados, só escondidos), então
  // abrir "Definição do agente" faz parte do caminho que um dono percorre.
  await page.getByRole('button', { name: 'Definição do agente' }).click()
  await expect(page.getByTestId('agent-definition-fields')).toBeVisible()
}

const patchesDePreset = () => patches.filter((p) => 'preset' in p)

test('existe um seletor de modelo-base no formulário avançado', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)

  const seletor = page.getByTestId('agent-preset-select')
  await expect(seletor).toBeVisible()
  await expect(seletor).toHaveValue('researcher')
})

test('a confirmação diz, ANTES, quais campos vazios serão preenchidos', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)

  await page.getByTestId('agent-preset-select').selectOption('analyst')

  const confirmacao = page.getByTestId('agent-preset-confirm')
  await expect(confirmacao).toBeVisible()
  await expect(confirmacao).toContainText('Analista')
  await expect(page.getByTestId('agent-preset-fields')).toContainText(['Objetivo', 'Função', 'Instruções', 'Limites'].join(''))
  // Nada foi enviado só por ter mexido no seletor.
  expect(patchesDePreset()).toHaveLength(0)
})

test('cancelar não troca nada e não chama a API', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)

  await page.getByTestId('agent-preset-select').selectOption('analyst')
  await page.getByTestId('agent-preset-cancel').click()

  await expect(page.getByTestId('agent-preset-confirm')).toHaveCount(0)
  await expect(page.getByTestId('agent-preset-select')).toHaveValue('researcher')
  expect(patchesDePreset()).toHaveLength(0)
})

test('confirmar preenche os vazios — e é o servidor que decide, com applyPresetSuggestions', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)

  await page.getByTestId('agent-preset-select').selectOption('analyst')
  await page.getByTestId('agent-preset-apply').click()

  await expect(page.getByTestId('agent-role')).toHaveValue(/Analista/)
  await expect(page.getByTestId('agent-instructions')).toHaveValue(/analista/)

  const pedido = patchesDePreset()
  expect(pedido).toHaveLength(1)
  expect(pedido[0].preset).toBe('analyst')
  expect(pedido[0].applyPresetSuggestions).toBe(true)
})

test('"só trocar" muda o molde e deixa os campos como estavam', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)

  await page.getByTestId('agent-preset-select').selectOption('communicator')
  await page.getByTestId('agent-preset-only').click()

  const pedido = patchesDePreset()
  expect(pedido).toHaveLength(1)
  expect(pedido[0].preset).toBe('communicator')
  expect(pedido[0].applyPresetSuggestions).toBe(false)
  await expect(page.getByTestId('agent-role')).toHaveValue('')
})

test('definição escrita à mão: a tela avisa que nada será preenchido', async ({ page }) => {
  await stubApi(
    page,
    agenteBase({ role: 'Atendente do plano empresarial.', definitionEditedAt: NOW, objective: 'Resolver chamados.' }),
  )
  await abrirAvancado(page)

  await page.getByTestId('agent-preset-select').selectOption('analyst')

  const confirmacao = page.getByTestId('agent-preset-confirm')
  await expect(confirmacao).toContainText('nada será preenchido')
  // Nem o botão de preencher é oferecido: não há promessa a fazer.
  await expect(page.getByTestId('agent-preset-apply')).toHaveCount(0)

  await page.getByTestId('agent-preset-only').click()
  await expect(page.getByTestId('agent-role')).toHaveValue('Atendente do plano empresarial.')
  expect(patchesDePreset()[0].applyPresetSuggestions).toBe(false)
})

test('campo com texto não entra na lista do que será preenchido', async ({ page }) => {
  await stubApi(page, agenteBase({ role: 'Já escrito aqui.' }))
  await abrirAvancado(page)

  await page.getByTestId('agent-preset-select').selectOption('analyst')

  const lista = page.getByTestId('agent-preset-fields')
  await expect(lista).not.toContainText('Função')
  await expect(lista).toContainText('Instruções')
})
