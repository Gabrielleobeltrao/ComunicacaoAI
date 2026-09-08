import { test } from '@playwright/test'
import type { Page } from '@playwright/test'

// AS CAPTURAS da landing — tiradas do PRODUTO, e não desenhadas.
//
// A landing mostrava ícones e caixas de exemplo. Ícone não prova nada: quem chega
// querendo saber como a coisa se parece continua sem saber, e a diferença entre "parece
// sério" e "parece mais um" é justamente essa. Aqui as imagens saem da interface de
// verdade, com dados de mentira — o mesmo caminho que os testes já usam.
//
// Rodam SÓ com `CAPTURAS=1` (via `npm run capturas`): elas escrevem arquivos, e um teste
// que escreve no repositório a cada bateria transformaria toda execução num diff.
//
// Regenerar é `npm run capturas`. Nenhuma imagem é editada à mão: no dia em que a tela
// mudar, a captura antiga vira uma promessa que o produto não cumpre mais — e a única
// defesa contra isso é a captura ser barata de refazer.
const LIGADO = process.env.CAPTURAS === '1'
test.skip(!LIGADO, 'defina CAPTURAS=1 para regravar as imagens da landing')

// Uma data FIXA e plausível, e não `new Date(0)`: a captura anterior estampava
// "31/12/1969, 19:00:00" na landing. Fixa porque a imagem entra no repositório —
// uma data de hoje faria toda regravação virar um diff.
const AGORA = '2026-03-12T14:30:00.000Z'
const ANDAR = '000000000000000000000f11'
const A1 = '000000000000000000000a11'
const A2 = '000000000000000000000a22'
const A3 = '000000000000000000000a33'
const DOC1 = '000000000000000000000d11'
const DOC2 = '000000000000000000000d22'
const DOC3 = '000000000000000000000d33'
const DOC4 = '000000000000000000000d44'
const DOC5 = '000000000000000000000d55'
const DOC6 = '000000000000000000000d66'

const FLOOR = {
  id: ANDAR,
  buildingId: 'b1',
  name: 'Atendimento',
  mission: 'Responder rápido e certo',
  description: '',
  timezone: 'America/Sao_Paulo',
  defaultLanguage: 'pt',
  color: null,
  icon: null,
  order: 0,
  status: 'active',
  workMode: 'organization',
  coordinatorAgentId: null,
  instruction: '',
  createdAt: AGORA,
  updatedAt: AGORA,
}

const AGENTES = [
  { _id: A1, name: 'Marina', objective: 'Atender dúvidas de entrega', preset: 'operator', floorId: ANDAR, sectorId: 's1', tools: [], builtinTools: [], capabilities: [], activationModes: ['manual'] },
  { _id: A2, name: 'Rafael', objective: 'Cuidar de trocas', preset: 'operator', floorId: ANDAR, sectorId: 's1', tools: [], builtinTools: [], capabilities: [], activationModes: ['manual'] },
  { _id: A3, name: 'Nina', objective: 'Vigiar o mercado', preset: 'researcher', floorId: ANDAR, sectorId: 's2', tools: [], builtinTools: [], capabilities: [], activationModes: ['manual'] },
]

const SETORES = [
  { _id: 's1', name: 'Atendimento', color: '#4466aa', floorId: ANDAR, mode: 'orchestrated', members: [{ agentId: A1, order: 0 }, { agentId: A2, order: 1 }] },
  { _id: 's2', name: 'Mercado', color: '#17B98A', floorId: ANDAR, mode: 'orchestrated', members: [{ agentId: A3, order: 0 }] },
]

const GRAFO = {
  viewKey: `floor:${ANDAR}#2`,
  documentTotal: 6,
  documentLimit: 200,
  truncated: false,
  nodes: [
    { id: 'building:b1', kind: 'building', label: 'Prédio', position: null },
    { id: `floor:${ANDAR}`, kind: 'floor', label: 'Atendimento', ownerType: 'floor', ownerId: ANDAR, position: null },
    { id: 'sector:s1', kind: 'sector', label: 'Atendimento', color: '#4466aa', ownerType: 'sector', ownerId: 's1', position: null },
    { id: `agent:${A1}`, kind: 'agent', label: 'Marina', ownerType: 'agent', ownerId: A1, position: null },
    { id: `agent:${A2}`, kind: 'agent', label: 'Rafael', ownerType: 'agent', ownerId: A2, position: null },
    { id: 'sector:s2', kind: 'sector', label: 'Mercado', color: '#17B98A', ownerType: 'sector', ownerId: 's2', position: null },
    { id: `agent:${A3}`, kind: 'agent', label: 'Nina', ownerType: 'agent', ownerId: A3, position: null },
    { id: `document:${DOC1}`, kind: 'document', label: 'Política de troca', ownerType: 'agent', ownerId: A1, indexStatus: 'indexed', source: 'manual', position: null },
    { id: `document:${DOC2}`, kind: 'document', label: 'Prazo de entrega', ownerType: 'floor', ownerId: ANDAR, indexStatus: 'indexed', source: 'manual', position: null },
    { id: `document:${DOC3}`, kind: 'document', label: 'Tabela de frete', ownerType: 'floor', ownerId: ANDAR, indexStatus: 'indexed', source: 'manual', position: null },
    { id: `document:${DOC4}`, kind: 'document', label: 'Roteiro de atendimento', ownerType: 'agent', ownerId: A2, indexStatus: 'indexed', source: 'manual', position: null },
    { id: `document:${DOC5}`, kind: 'document', label: 'Concorrentes', ownerType: 'agent', ownerId: A3, indexStatus: 'indexed', source: 'manual', position: null },
    { id: `document:${DOC6}`, kind: 'document', label: 'Catálogo', ownerType: 'sector', ownerId: 's2', indexStatus: 'indexed', source: 'manual', position: null },
  ],
  edges: [
    { id: 'e1', source: 'building:b1', target: `floor:${ANDAR}`, kind: 'contains' },
    { id: 'e2', source: `floor:${ANDAR}`, target: 'sector:s1', kind: 'contains' },
    { id: 'e3', source: 'sector:s1', target: `agent:${A1}`, kind: 'contains' },
    { id: 'e4', source: 'sector:s1', target: `agent:${A2}`, kind: 'contains' },
    { id: 'e5', source: `agent:${A1}`, target: `document:${DOC1}`, kind: 'contains' },
    { id: 'e6', source: `floor:${ANDAR}`, target: `document:${DOC2}`, kind: 'contains' },
    { id: 'e7', source: `agent:${A2}`, target: `document:${DOC2}`, kind: 'can_access' },
    { id: 'e8', source: `floor:${ANDAR}`, target: 'sector:s2', kind: 'contains' },
    { id: 'e9', source: 'sector:s2', target: `agent:${A3}`, kind: 'contains' },
    { id: 'e10', source: `floor:${ANDAR}`, target: `document:${DOC3}`, kind: 'contains' },
    { id: 'e11', source: `agent:${A2}`, target: `document:${DOC4}`, kind: 'contains' },
    { id: 'e12', source: `agent:${A3}`, target: `document:${DOC5}`, kind: 'contains' },
    { id: 'e13', source: 'sector:s2', target: `document:${DOC6}`, kind: 'contains' },
    { id: 'e15', source: `agent:${A3}`, target: `document:${DOC3}`, kind: 'can_access' },
  ],
}

/**
 * QUATRO execuções, e não uma.
 *
 * Com uma linha só, dois terços da imagem eram retângulo branco — e o texto ao lado
 * promete "uma linha por execução". A captura precisa mostrar o que a frase diz:
 * origens diferentes, uma que falhou, durações e consumos que não são todos iguais.
 */
const fim = (ms: number) => new Date(Date.parse(AGORA) + ms).toISOString()

const EXECUCOES = [
  {
    executionKey: 'run:aaa',
    status: 'succeeded',
    source: 'schedule',
    environment: 'production',
    createdAt: AGORA,
    startedAt: AGORA,
    finishedAt: fim(1500),
    durationMs: 1500,
    origin: { kind: 'monitor', id: 'm1', name: 'RSI abaixo de 30', eventId: 'e2' },
    flow: { id: 'f1', name: 'Avisar no Slack', version: 3, triggerType: 'internal_event' },
    steps: [
      { stepId: 's1', stepType: 'agent.execute', status: 'succeeded', durationMs: 900 },
      { stepId: 's2', stepType: 'delivery.send', status: 'succeeded', durationMs: 200 },
    ],
    deliveries: 1,
    usage: { inputTokens: 1840, outputTokens: 320 },
    errorKind: null,
  },
  {
    executionKey: 'run:bbb',
    status: 'succeeded',
    source: 'message',
    environment: 'production',
    createdAt: fim(-320000),
    startedAt: fim(-320000),
    finishedAt: fim(-317600),
    durationMs: 2400,
    origin: { kind: 'message', id: 'c1', name: 'Conversa com Marina', eventId: 'e3' },
    flow: { id: 'f2', name: 'Responder dúvida de entrega', version: 1, triggerType: 'message' },
    steps: [
      { stepId: 's1', stepType: 'knowledge.search', status: 'succeeded', durationMs: 340 },
      { stepId: 's2', stepType: 'agent.execute', status: 'succeeded', durationMs: 1900 },
    ],
    deliveries: 1,
    usage: { inputTokens: 2960, outputTokens: 540 },
    errorKind: null,
  },
  {
    executionKey: 'run:ccc',
    status: 'failed',
    source: 'schedule',
    environment: 'production',
    createdAt: fim(-905000),
    startedAt: fim(-905000),
    finishedAt: fim(-904200),
    durationMs: 800,
    origin: { kind: 'routine', id: 'r1', name: 'Resumo diário do setor', eventId: 'e4' },
    flow: { id: 'f3', name: 'Enviar resumo', version: 2, triggerType: 'schedule' },
    // Uma que falhou, de propósito: uma tela de auditoria em que tudo deu certo não é
    // uma tela de auditoria — é um cartaz.
    steps: [{ stepId: 's1', stepType: 'delivery.send', status: 'failed', durationMs: 800 }],
    deliveries: 0,
    usage: { inputTokens: 610, outputTokens: 0 },
    errorKind: 'delivery_rejected',
  },
  {
    executionKey: 'run:ddd',
    status: 'succeeded',
    source: 'manual',
    environment: 'production',
    createdAt: fim(-3600000),
    startedAt: fim(-3600000),
    finishedAt: fim(-3595800),
    durationMs: 4200,
    origin: { kind: 'manual', id: 'u1', name: 'Disparo manual', eventId: 'e5' },
    flow: { id: 'f4', name: 'Reindexar conhecimento do andar', version: 1, triggerType: 'manual' },
    steps: [
      { stepId: 's1', stepType: 'knowledge.index', status: 'succeeded', durationMs: 3800 },
      { stepId: 's2', stepType: 'agent.execute', status: 'succeeded', durationMs: 400 },
    ],
    deliveries: 0,
    usage: { inputTokens: 5120, outputTokens: 180 },
    errorKind: null,
  },
]

async function stub(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'demo@local.test', name: 'Demo', emailVerified: true, createdAt: AGORA, updatedAt: AGORA }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) =>
    r.fulfill({ json: { id: 'b1', name: 'Meu escritório', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: AGORA, updatedAt: AGORA } }),
  )
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  await page.route(`**/api/floors/${ANDAR}`, (r) => r.fulfill({ json: FLOOR }))
  await page.route('**/api/floors/*/activity', (r) => r.fulfill({ json: { agentCount: 3, sectorCount: 2, automationsActive: 2, runsActive: 1, failures24h: 0 } }))
  await page.route('**/api/agents**', (r) => r.fulfill({ json: AGENTES }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: SETORES }))
  await page.route('**/api/knowledge/graph**', (r) => r.fulfill({ json: GRAFO }))
  await page.route('**/api/activity**', (r) => r.fulfill({ json: { items: EXECUCOES, nextCursor: null } }))
  await page.route('**/api/resources**', (r) => r.fulfill({ json: { kinds: [], byKind: {}, items: [] } }))
}

/** Escondido nas capturas: o balão do Arquiteto cobre o canto de toda tela. */
async function semBalao(page: Page) {
  await page.addStyleTag({ content: '[data-testid="architect-launcher"], [data-testid="architect-assistant"] { display: none !important }' })
}

test('escritório', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await stub(page)
  await page.goto(`/floors/${ANDAR}`)
  await page.waitForLoadState('networkidle')
  await semBalao(page)
  await page.screenshot({ path: 'public/capturas/escritorio.png', clip: { x: 0, y: 0, width: 1280, height: 820 } })
})

// Recorte pequeno pede densidade DOBRADA: cortada no conteúdo, esta imagem sai com
// cerca de 400 px de largura e apareceria borrada na coluna de 560 px do desktop.
test.describe('mapa', () => {
  test.use({ deviceScaleFactor: 2 })
  test('conhecimento', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 })
    await stub(page)
    await page.goto(`/floors/${ANDAR}?view=knowledge`)
    await page.getByTestId('knowledge-svg').waitFor()
    await semBalao(page)
    // A câmera é fixa e a nuvem nasce pequena no meio da moldura: sem isto a captura é
    // um retângulo branco com um punhado de bolinhas no canto esquerdo.
    const caixa = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="knowledge-svg"]')!
      const desenhados = [...svg.querySelectorAll('circle, image, text')]
      const r = desenhados.map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0)
      const folga = 28
      const x = Math.min(...r.map((b) => b.left)) - folga
      const y = Math.min(...r.map((b) => b.top)) - folga
      return { x, y, width: Math.max(...r.map((b) => b.right)) + folga - x, height: Math.max(...r.map((b) => b.bottom)) + folga - y }
    })
    await page.screenshot({ path: 'public/capturas/conhecimento.png', clip: caixa })
  })
})

test('atividade', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 })
  await stub(page)
  await page.goto('/activity')
  await page.waitForLoadState('networkidle')
  await semBalao(page)
  await page.screenshot({ path: 'public/capturas/atividade.png', clip: { x: 0, y: 0, width: 1280, height: 700 } })
})
