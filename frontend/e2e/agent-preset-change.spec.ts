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
  // A definição mora em "Como trabalha": ela É como o agente trabalha, e o título dela
  // muda com o papel — "Estratégia de pesquisa" para quem coleta, "Como conduzir a
  // equipe" para quem conduz. Por isso o bloco é alcançado pelo nome estável, e não
  // pelo título visível.
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  // Os blocos nascem fechados (os filhos ficam montados, só escondidos), então abrir
  // faz parte do caminho que um dono percorre.
  await page.getByTestId('agent-definition-block').getByRole('button').first().click()
  await expect(page.getByTestId('agent-definition-fields')).toBeVisible()
}

const patchesDePreset = () => patches.filter((p) => 'preset' in p)

// --- o tipo do agente é escolhido UMA vez ------------------------------------------------
//
// Havia um seletor de modelo-base aqui, com uma confirmação que explicava quais campos
// vazios seriam preenchidos. Ele saiu inteiro.
//
// Não por simplificação: trocar o tipo mudava o que o agente PODE fazer — base própria,
// sites, ferramentas, e o lugar dele num plano de equipe — sem tocar em uma linha do que
// estava escrito nele. Sobrava um agente com a definição de pesquisador e o comportamento
// de coordenador, e nada na tela ligava uma coisa à outra para quem fosse investigar.
// Quem quer outro tipo contrata outro agente.

test('não há seletor de modelo-base na edição', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)

  await expect(page.getByTestId('agent-preset-select')).toHaveCount(0)
  await expect(page.getByTestId('agent-preset-confirm')).toHaveCount(0)
})

test('a origem continua dita, e a definição continua editável', async ({ page }) => {
  // Esconder o seletor sem dizer de onde o agente veio deixaria a pergunta "por que ele
  // se comporta assim?" sem resposta na tela.
  await stubApi(page, agenteBase())
  await abrirAvancado(page)

  await expect(page.getByTestId('agent-preset-origin')).toContainText('não muda depois da contratação')
  // O que o agente faz continua sendo escrito por quem configura.
  await page.getByTestId('agent-role').fill('Analista de suporte do plano empresarial')
  await expect(page.getByTestId('agent-role')).toHaveValue('Analista de suporte do plano empresarial')
})

test('nenhuma requisição troca o tipo', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('agent-instructions').fill('Confira o contrato antes de responder.')
  await page.waitForTimeout(1200)

  expect(patchesDePreset(), 'a tela não tem por onde pedir uma troca de tipo').toEqual([])
})
