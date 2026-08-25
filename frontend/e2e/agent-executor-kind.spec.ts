import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// COMO este agente executa — e o que a tela deixa de perguntar quando a resposta muda.
//
// Antes, todo agente era uma chamada a um modelo e o formulário perguntava a mesma coisa a
// todos: provedor, temperatura, estilo de resposta. Para um agente que só chama uma função
// determinística, nada disso significa nada — e um campo sem significado não fica
// inofensivo na tela: ele é preenchido, e depois alguém passa uma tarde entendendo por que
// a temperatura não mudou o resultado de uma soma.
//
// O que estas provas garantem: a escolha existe, ela ESCONDE o que não se aplica, a função
// vem de uma lista fechada (nunca de um campo onde se cola código), um App que ninguém
// conectou não vira opção, e uma configuração incoerente não é salva. A API é dublada, então
// nada aqui passa por acaso.
const FLOOR_ID = '000000000000000000000f11'
const AGENT_ID = '000000000000000000000a11'
const NOW = new Date(0).toISOString()

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = { id: FLOOR_ID, buildingId: 'b1', name: 'Térreo', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', createdAt: NOW, updatedAt: NOW }

const CATALOGO = {
  functions: [
    {
      functionName: 'math.summary',
      version: '1.0.0',
      description: 'Resumo estatístico de uma lista de números',
      capabilities: ['calculo'],
      inputSchema: { type: 'object', properties: { values: { type: 'array' } }, required: ['values'] },
      outputSchema: { type: 'object', properties: { sum: { type: 'number' } }, required: ['sum'] },
      configSchema: { type: 'object', properties: { decimals: { type: 'integer', minimum: 0, maximum: 6, description: 'Casas decimais da média' } } },
      timeoutMs: 5000,
    },
    {
      functionName: 'br.cpf',
      version: '1.0.0',
      description: 'Valida um CPF pelo dígito verificador',
      capabilities: ['documento'],
      inputSchema: { type: 'object', properties: { cpf: { type: 'string' } }, required: ['cpf'] },
      outputSchema: { type: 'object', properties: { valido: { type: 'boolean' } }, required: ['valido'] },
      timeoutMs: 5000,
    },
  ],
  actions: [
    { appKey: 'agenda', appName: 'Agenda', actionKey: 'criar_evento', name: 'Criar evento', description: 'Cria um evento', risk: 'write', inputSchema: { type: 'object', properties: { titulo: { type: 'string' } }, required: ['titulo'] }, outputSchema: null },
    { appKey: 'agenda', appName: 'Agenda', actionKey: 'buscar_evento', name: 'Buscar evento', description: 'Busca um evento', risk: 'read', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, outputSchema: { type: 'object', properties: { titulo: { type: 'string' }, quando: { type: 'string' } }, required: ['titulo'] } },
    { appKey: 'naoconectado', appName: 'App Sem Conexão', actionKey: 'algo', name: 'Fazer algo', description: '', risk: 'read', inputSchema: null },
  ],
}

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
  // Um agente ANTIGO: o contrato vem resolvido do servidor, com o padrão que descreve o
  // comportamento que ele sempre teve.
  contract: { executorKind: 'llm', responseMode: 'text', executorConfig: { kind: 'llm' }, inputJsonSchema: null, outputJsonSchema: null },
  ...over,
})

let patches: Record<string, unknown>[] = []

async function stubApi(page: Page, agenteInicial: Record<string, unknown>, opts: { conectados?: string[] } = {}) {
  patches = []
  /**
   * O agente COMO ELE ESTÁ, e não como ele foi criado.
   *
   * A página recarrega do `overview` depois de cada gravação. Um dublê que devolve sempre
   * o documento original faria a tela mostrar o estado anterior — e a prova mediria o
   * dublê, não a regra.
   */
  let agente = agenteInicial
  // O mesmo `agentContractOf` do servidor, no que a prova precisa: o contrato resolvido.
  const contratoDe = (a: Record<string, unknown>) => ({
    executorKind: (a.executorKind as string) ?? 'llm',
    responseMode: (a.responseMode as string) ?? 'text',
    executorConfig: a.executorConfig ?? { kind: 'llm' },
    inputJsonSchema: a.inputJsonSchema ?? null,
    outputJsonSchema: a.outputJsonSchema ?? null,
  })
  const conectados = opts.conectados ?? ['agenda']
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  await page.route('**/api/executors/catalog', (r) => r.fulfill({ json: CATALOGO }))
  await page.route('**/api/app-installations**', (r) =>
    r.fulfill({
      json: conectados.map((appKey, i) => ({
        id: `i${i}`,
        appKey,
        appVersion: '1',
        name: appKey,
        status: 'connected',
        publicMetadata: {},
        grantedScopes: [],
        createdAt: NOW,
        updatedAt: NOW,
        lastTestedAt: null,
      })),
    }),
  )
  await page.route('**/api/agent-presets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/agents/*/overview', (r) =>
    r.fulfill({
      json: {
        agent: { ...agente, contract: contratoDe(agente) },
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
  await page.route(`**/api/agents/${AGENT_ID}`, (r) => {
    if (r.request().method() !== 'PATCH') return r.fulfill({ json: agente })
    const corpo = JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>
    patches.push(corpo)
    // O servidor DERIVA o contrato de uma função a partir do registro e devolve o agente
    // com ele. Sem isto o dublê responderia diferente do que a API responde, e a prova
    // passaria a medir o dublê.
    const cfg = corpo.executorConfig as { kind?: string; functionName?: string } | undefined
    const fn = cfg?.kind === 'function' ? CATALOGO.functions.find((f) => f.functionName === cfg.functionName) : null
    const derivado = fn ? { inputJsonSchema: fn.inputSchema, outputJsonSchema: fn.outputSchema } : {}
    agente = { ...agente, ...corpo, ...derivado }
    return r.fulfill({
      json: {
        ...agente,
        contract: contratoDe(agente),
      },
    })
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

/**
 * "Como este agente executa" mora em COMO TRABALHA.
 *
 * É a resposta da pergunta que a aba faz. Antes ela estava em "Avançado", ao lado da
 * métrica do card e da exclusão do agente — para algo que decide se há chamada a provedor,
 * era o lugar errado.
 */
const abrirAvancado = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/como-trabalha`)
  await expect(page.getByTestId('executor-section')).toBeVisible()
}

/** O CONTRATO é detalhe técnico e continua recolhido em Avançado. */
const abrirContrato = async (page: Page) => {
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/avancado`)
  await page.getByTestId('agent-contract-block').getByRole('button', { name: 'Contratos de entrada e saída' }).click()
  await expect(page.getByTestId('output-contract-block')).toBeVisible()
}

test('a escolha existe, e um agente antigo já chega como "IA / LLM"', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await expect(page.getByTestId('executor-kind-llm-input')).toBeChecked()
  // O que sempre existiu continua existindo — em Avançado, que é onde ele sempre esteve.
  await page.goto(`/floors/${FLOOR_ID}/agents/${AGENT_ID}/avancado`)
  await expect(page.getByText('Modelo e custo')).toBeVisible()
})

test('escolher "Função do sistema" esconde provedor, modelo e estilo de resposta', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-function').click()
  // Um campo sem significado não é inofensivo: ele é preenchido e depois cobrado.
  await expect(page.getByText('Modelo e custo')).toHaveCount(0)
  await expect(page.getByText('Modelo e execução')).toHaveCount(0)
  await expect(page.getByTestId('function-picker')).toBeVisible()
})

test('a função vem de uma LISTA — não há onde colar código', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-function').click()
  const picker = page.getByTestId('function-picker')
  // O único campo de texto do seletor é a BUSCA. O que executa é código do servidor; o
  // agente guarda o nome, e um campo livre aqui seria a porta que o resto fecha.
  await expect(picker.locator('textarea')).toHaveCount(0)
  await expect(picker.getByTestId('function-search')).toBeVisible()

  await picker.getByTestId('function-search').fill('dígito')
  await expect(picker.getByTestId('function-option-br.cpf')).toBeVisible()
  await expect(picker.getByTestId('function-option-math.summary')).toHaveCount(0)
})

test('a função escolhida mostra versão, capacidades e contratos', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-function').click()
  await page.getByTestId('function-option-math.summary').click()
  const detalhe = page.getByTestId('function-detail')
  await expect(detalhe).toContainText('1.0.0')
  await expect(detalhe).toContainText('calculo')
  await expect(detalhe).toContainText('values*')
})

test('só App CONECTADO vira opção — e sem nenhum, a tela mostra o caminho', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-tool').click()
  const app = page.getByTestId('tool-app')
  await expect(app.locator('option')).toHaveCount(2) // "Escolha um App" + Agenda
  await expect(app).not.toContainText('App Sem Conexão')

  await app.selectOption('agenda')
  await page.getByTestId('tool-action').selectOption('criar_evento')
  const detalhe = page.getByTestId('tool-detail')
  await expect(detalhe).toContainText('Criar evento')
  await expect(detalhe).toContainText('titulo*')
  // A credencial vive na conexão, cifrada — e nunca passa por esta tela.
  await expect(detalhe).toContainText('não aparece aqui')
})

test('sem nenhum App conectado, o caminho para conectar aparece', async ({ page }) => {
  await stubApi(page, agenteBase(), { conectados: [] })
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-tool').click()
  await expect(page.getByTestId('tool-none-connected')).toBeVisible()
  await expect(page.getByTestId('tool-none-connected').getByRole('link')).toHaveAttribute('href', '/apps')
})

test('configuração incoerente não é salva', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-function').click()
  await expect(page.getByTestId('executor-problems')).toContainText('Escolha a função')
  // A página do agente grava sozinha. É justamente por isso que a conferência precisa
  // valer aqui: gravar isto criaria um agente que falha na primeira execução, longe do
  // formulário, com uma mensagem que não fala do formulário.
  await page.waitForTimeout(1500)
  expect(patches.filter((p) => 'executorKind' in p)).toHaveLength(0)
})

test('a escolha completa é gravada — tipo, referência e modo de resposta', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-function').click()
  await page.getByTestId('function-option-math.summary').click()
  await page.getByTestId('response-mode-structured').click()

  await expect.poll(() => patches.filter((p) => 'executorKind' in p).length, { timeout: 10_000 }).toBeGreaterThan(0)
  const corpo = patches.filter((p) => 'executorKind' in p).at(-1)!
  expect(corpo.executorKind).toBe('function')
  expect(corpo.responseMode).toBe('structured')
  // REFERÊNCIA, nunca código: o que vai para o banco é o nome e a versão.
  expect(corpo.executorConfig).toEqual({ kind: 'function', functionName: 'math.summary', version: '1.0.0' })
})

test('escolher a função PREENCHE o contrato — e ele fica somente leitura', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-function').click()
  await page.getByTestId('function-option-math.summary').click()
  // A escolha é gravada sozinha, e é o SERVIDOR que deriva o contrato. Navegar antes disso
  // leria o agente anterior — o teste mediria a corrida, não a regra.
  await expect.poll(() => patches.filter((p) => 'executorConfig' in p).length, { timeout: 10_000 }).toBeGreaterThan(0)
  await abrirContrato(page)

  // Quem escolhe uma função não deveria copiar o contrato dela à mão: o servidor já sabe
  // qual é, e vai sobrescrever o que for enviado. Preencher aqui é mostrar antes o que vai
  // valer, em vez de deixar descobrir depois de salvar.
  await expect(page.getByTestId('input-json-schema')).toHaveValue(/values/)
  await expect(page.getByTestId('output-json-schema')).toHaveValue(/sum/)
  // Editável, criaria duas verdades sobre o que a função aceita — a do formulário e a do
  // código que roda. Elas começam iguais e divergem na primeira mudança.
  await expect(page.getByTestId('input-json-schema')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('input-json-schema-readonly')).toContainText('duas verdades')
})

test('uma ação de App sem contrato de saída avisa em vez de prometer', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-tool').click()
  await page.getByTestId('tool-app').selectOption('agenda')
  await page.getByTestId('tool-action').selectOption('criar_evento')
  // O contrato de ENTRADA vem da ação; o de saída, não — e dizer isso é mais barato do
  // que deixar descobrir na primeira execução.
  await expect(page.getByTestId('tool-detail')).toContainText('Recebe: titulo*')
  // A frase mudou de tom junto com o comportamento: antes o modo estruturado era oferecido
  // e avisado; agora ele nem aparece, e o texto diz o que de fato acontece.
  await expect(page.getByTestId('tool-no-output-contract')).toContainText('fica como texto')
})

test('o contrato é conferido pelo CAMINHO, e o incoerente não salva', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await abrirContrato(page)
  const editor = page.getByTestId('input-json-schema')
  // Um schema válido em JSON que descreve o contrato errado: exige um campo que não existe.
  await editor.fill('{"type":"object","properties":{"a":{"type":"string"}},"required":["b"]}')
  await expect(page.getByTestId('input-json-schema-errors')).toContainText('required.b')

  await editor.fill('{"type":"object","properties":{"cnpj":{"type":"string"}},"required":["cnpj"]}')
  await expect(page.getByTestId('input-json-schema-summary')).toContainText('obrigatório')
})


// --- o painel minimalista: só o que o tipo escolhido usa ------------------------------------

test('o resumo compacto responde as três perguntas de quem abre a tela', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await expect(page.getByTestId('executor-summary')).toContainText('Executa por: IA')

  await page.getByTestId('executor-kind-function').click()
  // Ainda sem função escolhida: a pendência aparece no resumo, não escondida três blocos
  // abaixo.
  await expect(page.getByTestId('executor-summary-pending')).toContainText('Escolha a função')

  await page.getByTestId('function-option-math.summary').click()
  await expect(page.getByTestId('executor-summary')).toContainText('Executa por: Função')
  await expect(page.getByTestId('executor-summary')).toContainText('Entrada válida')
  await expect(page.getByTestId('executor-summary')).toContainText('Saída: Dados')
  await expect(page.getByTestId('executor-summary-pending')).toHaveCount(0)
})

test('uma função só pode devolver DADOS — as outras opções somem', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-function').click()
  await page.getByTestId('function-option-math.summary').click()

  // Oferecer "Texto" para uma função é deixar escolher uma promessa que o servidor desfaz
  // por baixo — a tela mostraria uma coisa e o agente faria outra.
  await expect(page.getByTestId('response-mode-structured')).toBeVisible()
  await expect(page.getByTestId('response-mode-text')).toHaveCount(0)
  await expect(page.getByTestId('response-mode-structured_and_text')).toHaveCount(0)
  await expect(page.getByTestId('response-mode-forced')).toContainText('encadeie um agente de IA')
})

test('os parâmetros da função viram um formulário pequeno — nunca um editor JSON', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-function').click()
  await page.getByTestId('function-option-math.summary').click()

  const config = page.getByTestId('function-config')
  await expect(config).toContainText('Casas decimais')
  // Livre, o dono digita o que quiser e nada diz quais campos existem — e é onde uma
  // credencial acaba parando.
  await expect(config.locator('textarea')).toHaveCount(0)
  await config.getByTestId('function-config-decimals').fill('2')

  await expect.poll(() => patches.filter((p) => 'executorConfig' in p).length, { timeout: 10_000 }).toBeGreaterThan(0)
  const corpo = patches.filter((p) => 'executorConfig' in p).at(-1)!
  expect((corpo.executorConfig as Record<string, unknown>).config).toEqual({ decimals: 2 })
})

test('a função não mostra provedor, modelo, estilo nem ferramentas', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-function').click()
  for (const bloco of ['Modelo e custo', 'Modelo e execução', 'Estilo de resposta', 'Memória']) {
    await expect(page.getByText(bloco, { exact: false })).toHaveCount(0)
  }
})

test('uma ação COM contrato de saída pode devolver dados — e não mostra o aviso', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-tool').click()
  await page.getByTestId('tool-app').selectOption('agenda')
  await page.getByTestId('tool-action').selectOption('buscar_evento')

  await expect(page.getByTestId('tool-detail')).toContainText('Devolve: titulo*, quando')
  // O aviso com o schema presente ensinaria o contrário do que o sistema faz.
  await expect(page.getByTestId('tool-no-output-contract')).toHaveCount(0)
  await expect(page.getByTestId('response-mode-structured')).toBeVisible()
})

test('uma ação SEM contrato de saída fica em texto, e diz por quê', async ({ page }) => {
  await stubApi(page, agenteBase())
  await abrirAvancado(page)
  await page.getByTestId('executor-kind-tool').click()
  await page.getByTestId('tool-app').selectOption('agenda')
  await page.getByTestId('tool-action').selectOption('criar_evento')

  await expect(page.getByTestId('tool-no-output-contract')).toContainText('fica como texto')
  await expect(page.getByTestId('response-mode-structured')).toHaveCount(0)
  await expect(page.getByTestId('executor-summary')).toContainText('Saída: Texto')
})
