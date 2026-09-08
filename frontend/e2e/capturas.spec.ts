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

const AGORA = new Date(0).toISOString()
const ANDAR = '000000000000000000000f11'
const A1 = '000000000000000000000a11'
const A2 = '000000000000000000000a22'
const A3 = '000000000000000000000a33'
const DOC1 = '000000000000000000000d11'
const DOC2 = '000000000000000000000d22'

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
  documentTotal: 2,
  documentLimit: 200,
  truncated: false,
  nodes: [
    { id: 'building:b1', kind: 'building', label: 'Prédio', position: null },
    { id: `floor:${ANDAR}`, kind: 'floor', label: 'Atendimento', ownerType: 'floor', ownerId: ANDAR, position: null },
    { id: 'sector:s1', kind: 'sector', label: 'Atendimento', color: '#4466aa', ownerType: 'sector', ownerId: 's1', position: null },
    { id: `agent:${A1}`, kind: 'agent', label: 'Marina', ownerType: 'agent', ownerId: A1, position: null },
    { id: `agent:${A2}`, kind: 'agent', label: 'Rafael', ownerType: 'agent', ownerId: A2, position: null },
    { id: `document:${DOC1}`, kind: 'document', label: 'Política de troca', ownerType: 'agent', ownerId: A1, indexStatus: 'indexed', source: 'manual', position: null },
    { id: `document:${DOC2}`, kind: 'document', label: 'Prazo de entrega', ownerType: 'floor', ownerId: ANDAR, indexStatus: 'indexed', source: 'manual', position: null },
  ],
  edges: [
    { id: 'e1', source: 'building:b1', target: `floor:${ANDAR}`, kind: 'contains' },
    { id: 'e2', source: `floor:${ANDAR}`, target: 'sector:s1', kind: 'contains' },
    { id: 'e3', source: 'sector:s1', target: `agent:${A1}`, kind: 'contains' },
    { id: 'e4', source: 'sector:s1', target: `agent:${A2}`, kind: 'contains' },
    { id: 'e5', source: `agent:${A1}`, target: `document:${DOC1}`, kind: 'contains' },
    { id: 'e6', source: `floor:${ANDAR}`, target: `document:${DOC2}`, kind: 'contains' },
    { id: 'e7', source: `agent:${A2}`, target: `document:${DOC2}`, kind: 'can_access' },
  ],
}

const EXECUCAO = {
  executionKey: 'run:aaa',
  status: 'succeeded',
  source: 'schedule',
  environment: 'production',
  createdAt: AGORA,
  startedAt: AGORA,
  finishedAt: new Date(1500).toISOString(),
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
}

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
  await page.route('**/api/activity**', (r) => r.fulfill({ json: { items: [EXECUCAO], nextCursor: null } }))
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

test('conhecimento', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await stub(page)
  await page.goto(`/floors/${ANDAR}?view=knowledge`)
  await page.getByTestId('knowledge-svg').waitFor()
  await semBalao(page)
  await page.getByTestId('knowledge-svg').screenshot({ path: 'public/capturas/conhecimento.png' })
})

test('atividade', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 })
  await stub(page)
  await page.goto('/activity')
  await page.waitForLoadState('networkidle')
  await semBalao(page)
  await page.screenshot({ path: 'public/capturas/atividade.png', clip: { x: 0, y: 0, width: 1280, height: 700 } })
})
