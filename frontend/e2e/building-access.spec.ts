import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The two boundaries an owner configures: which floors may talk to which (building
// pop-up from the sidebar selector), and who may call into a sector's people.
//
// Both only ever REMOVE ways in. The screens say so, and both show the impact BEFORE
// the choice is saved.
const FLOOR_A = '000000000000000000000f11'
const FLOOR_B = '000000000000000000000f22'
const SECTOR_ID = '000000000000000000000c11'
const A1 = '000000000000000000000a11'
const A2 = '000000000000000000000a22'
const NOW = new Date(0).toISOString()

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const floorDoc = (id: string, name: string) => ({
  id,
  buildingId: 'b1',
  name,
  mission: '',
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
  createdAt: NOW,
  updatedAt: NOW,
})
const FLOORS = [floorDoc(FLOOR_A, 'Térreo'), floorDoc(FLOOR_B, 'Primeiro')]

const AGENTS = [
  { _id: A1, name: 'Anotador', objective: '', preset: 'operator', floorId: FLOOR_A, tools: [], builtinTools: [], capabilities: [], activationModes: ['manual'] },
  { _id: A2, name: 'Cozinheiro', objective: '', preset: 'operator', floorId: FLOOR_A, tools: [], builtinTools: [], capabilities: [], activationModes: ['manual'] },
]

const SECTOR = {
  _id: SECTOR_ID,
  floorId: FLOOR_A,
  name: 'Cozinha',
  color: '#88a',
  mode: 'pipeline',
  entryPolicy: 'open_members',
  exposedAgentIds: [],
  members: [{ agentId: A1 }, { agentId: A2 }],
  stages: [{ id: 'e1', name: 'Anotar', agentId: A1, instruction: '', dependsOn: [], retryPolicy: { maxAttempts: 1 }, onError: 'stop' }],
}

let savedCommunication: Record<string, unknown> | null = null
let savedSector: Record<string, unknown> | null = null

async function stub(page: Page, opts: { communication?: unknown } = {}) {
  savedCommunication = null
  savedSector = null
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))

  await page.route('**/api/building/floor-communication/impact**', (r) =>
    r.fulfill({ json: { mode: 'isolated', blocked: [{ callerId: A1, callerName: 'Anotador', targetName: 'Cozinheiro' }] } }),
  )
  await page.route('**/api/building/floor-communication', (r) => {
    if (r.request().method() === 'PATCH') {
      savedCommunication = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ json: savedCommunication })
    }
    return r.fulfill({ json: opts.communication ?? { mode: 'all', links: [] } })
  })
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))

  await page.route('**/api/sectors/*/access-impact**', (r) =>
    r.fulfill({
      json: {
        entryPolicy: 'sector_only',
        protectedAgents: [
          { id: A1, name: 'Anotador', exposed: false },
          { id: A2, name: 'Cozinheiro', exposed: false },
        ],
        affectedCallers: [{ id: 'x1', name: 'Vendas', targets: ['Anotador'] }],
      },
    }),
  )
  await page.route('**/api/sectors/*/overview', (r) =>
    r.fulfill({ json: { sector: SECTOR, agents: AGENTS, readiness: { ready: true, issues: [] }, knowledgeCount: 0, memberIssues: [] } }),
  )
  await page.route('**/api/sectors/*/documents**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors/*/executions**', (r) => r.fulfill({ json: { items: [], nextCursor: null } }))
  await page.route('**/api/sectors/*', (r) => {
    if (r.request().method() === 'PATCH') {
      savedSector = r.request().postDataJSON() as Record<string, unknown>
      return r.fulfill({ json: { ...SECTOR, ...savedSector } })
    }
    return r.fulfill({ json: SECTOR })
  })
  await page.route('**/api/sectors', (r) => r.fulfill({ json: [SECTOR] }))
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: AGENTS }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: AGENTS }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: FLOORS }))
  await page.route('**/api/apps**', (r) => r.fulfill({ json: [] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
}

// --- comunicação entre andares ------------------------------------------------------

const openBuildingSettings = async (page: Page) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/apps')
  // The desktop rail is icons-only until hovered; the switcher lives inside it.
  const switcher = page.getByRole('button', { name: 'Prédio e andares' }).first()
  await switcher.hover()
  await switcher.click()
  await page.getByTestId('open-building-settings').first().click()
  await expect(page.getByTestId('building-settings')).toBeVisible()
}

test('as configurações do prédio abrem em pop-up a partir do seletor', async ({ page }) => {
  await stub(page)
  await openBuildingSettings(page)
  await expect(page.getByTestId('building-settings')).toContainText('Comunicação entre andares')
  // A frase que impede o erro conceitual mais comum.
  await expect(page.getByTestId('building-settings')).toContainText('não dá acesso a um agente ou setor')
})

test('escolher isolado salva o modo e mostra o que deixaria de funcionar', async ({ page }) => {
  await stub(page)
  await openBuildingSettings(page)
  await page.getByTestId('communication-isolated').click()
  await expect.poll(() => savedCommunication?.mode).toBe('isolated')
  await expect(page.getByTestId('communication-impact')).toContainText('Anotador → Cozinheiro')
})

test('conexões escolhidas permitem criar um link com direção', async ({ page }) => {
  await stub(page, { communication: { mode: 'selected', links: [] } })
  await openBuildingSettings(page)
  await expect(page.getByTestId('floor-links')).toContainText('Nenhuma conexão ainda')
  await page.getByTestId('link-from').selectOption(FLOOR_A)
  await page.getByTestId('link-to').selectOption(FLOOR_B)
  await page.getByTestId('link-direction').selectOption('both')
  await page.getByTestId('add-link').click()
  await expect.poll(() => (savedCommunication?.links as unknown[])?.length).toBe(1)
  expect((savedCommunication?.links as { direction: string }[])[0].direction).toBe('both')
})

// --- núcleo do setor -----------------------------------------------------------------

test('o setor oferece as três políticas de entrada em Avançado', async ({ page }) => {
  await stub(page)
  await page.goto(`/floors/${FLOOR_A}/sectors/${SECTOR_ID}/avancado`)
  const access = page.getByTestId('sector-access')
  await expect(access).toBeVisible()
  await expect(access).toContainText('Sempre pelo setor')
  await expect(access).toContainText('Setor + agentes selecionados')
  await expect(access).toContainText('Setor + qualquer agente')
  await expect(access).toContainText('só remove caminhos')
})

test('fechar o núcleo mostra quem perde a chamada direta ANTES de salvar', async ({ page }) => {
  await stub(page)
  await page.goto(`/floors/${FLOOR_A}/sectors/${SECTOR_ID}/avancado`)
  await page.getByTestId('entry-sector_only').click()
  await expect(page.getByTestId('access-impact')).toContainText('Vendas → Anotador')
  await expect(page.getByTestId('access-impact')).toContainText('continuam podendo chamar o setor inteiro')
  // Nada foi salvo ainda.
  expect(savedSector).toBeNull()

  await page.getByTestId('save-entry-policy').click()
  await expect.poll(() => savedSector?.entryPolicy).toBe('sector_only')
})

test('selecionar agentes expostos manda a lista junto', async ({ page }) => {
  await stub(page)
  await page.goto(`/floors/${FLOOR_A}/sectors/${SECTOR_ID}/avancado`)
  await page.getByTestId('entry-selected_members').click()
  await page.getByTestId('exposed-agents').getByRole('checkbox').first().check()
  await page.getByTestId('save-entry-policy').click()
  await expect.poll(() => savedSector?.entryPolicy).toBe('selected_members')
  expect((savedSector?.exposedAgentIds as string[]).length).toBe(1)
})
