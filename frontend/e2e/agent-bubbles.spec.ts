import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The operational bubbles over the characters.
//
// The claims that matter: no execution means NO bubble (an armed trigger must not
// paint the office with noise), the caption says the kind of work and never its
// content, the bubble never eats a click meant for the agent, and pausing the
// simulation does not pause or fake the state.
const FLOOR_ID = '000000000000000000000f11'
const A1 = '000000000000000000000a11'
const A2 = '000000000000000000000a22'
const NOW = new Date(0).toISOString()

const BUILDING = { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW }
const FLOOR = {
  id: FLOOR_ID,
  buildingId: 'b1',
  name: 'Térreo',
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
}
const AGENTS = [
  { _id: A1, name: 'Nina', objective: '', preset: 'researcher', floorId: FLOOR_ID, tools: [], builtinTools: [], capabilities: [], activationModes: ['manual'] },
  { _id: A2, name: 'Caio', objective: '', preset: 'operator', floorId: FLOOR_ID, tools: [], builtinTools: [], capabilities: [], activationModes: ['manual'] },
]

// A full floor: enough characters that the layout necessarily seats some of them
// side by side, which is where bubbles used to cover each other.
const CROWD = Array.from({ length: 6 }, (_, i) => ({
  _id: `000000000000000000000a${(i + 1).toString().padStart(2, '0')}`,
  name: ['Nina', 'Caio', 'Íris', 'Théo', 'Duda', 'Léo'][i],
  objective: '',
  preset: 'operator',
  floorId: FLOOR_ID,
  tools: [],
  builtinTools: [],
  capabilities: [],
  activationModes: ['manual'],
}))

const liveState = (over: Record<string, unknown> = {}) => ({
  agentId: A1,
  floorId: FLOOR_ID,
  rootExecutionId: 'run-1',
  state: 'researching',
  startedAt: NOW,
  updatedAt: NOW,
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  concurrent: 1,
  ...over,
})

let stateRequests: { ifNoneMatch: string | null; url: string }[] = []

async function stub(page: Page, opts: { states?: unknown[]; agents?: unknown[]; etag?: string } = {}) {
  stateRequests = []
  const roster = opts.agents ?? AGENTS
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [FLOOR] }))
  await page.route(`**/api/floors/${FLOOR_ID}`, (r) => r.fulfill({ json: FLOOR }))
  await page.route('**/api/floors/*/activity', (r) => r.fulfill({ json: { agents: 2, sectors: 0, automationsActive: 0, runsActive: 0, failures24h: 0 } }))
  await page.route('**/api/floors/*/metrics', (r) => r.fulfill({ json: null }))
  await page.route('**/api/floors/*/work-overview', (r) =>
    r.fulfill({ json: { workMode: 'organization', instruction: '', coordinator: null, targets: [], ready: true, issues: [], preview: null } }),
  )
  await page.route('**/api/floors/*/executions/analytics**', (r) =>
    r.fulfill({
      json: { scope: 'floor', period: '30d', telemetrySince: null, executions: 0, succeeded: 0, failed: 0, canceled: 0, running: 0, successRate: null, avgDurationMs: null, p95DurationMs: null, avgQueueMs: null, activeTimeMs: 0, totalTokens: 0, avgTokensPerExecution: null, participations: 0, participatedExecutions: 0, partialTelemetry: 0 },
    }),
  )
  await page.route('**/api/executions/breakdown**', (r) => r.fulfill({ json: [] }))
  // The versioned live-state DTO. `legacy=1` is what the old map asked for; the
  // bubble layer reads this one.
  await page.route('**/api/floors/*/agent-states**', (r) => {
    stateRequests.push({ ifNoneMatch: r.request().headers()['if-none-match'] ?? null, url: r.request().url() })
    // Polled every two seconds: the second tick onwards must be able to answer 304.
    if (opts.etag && r.request().headers()['if-none-match'] === opts.etag) {
      return r.fulfill({ status: 304, headers: { ETag: opts.etag } })
    }
    return r.fulfill({
      json: { version: 1, generatedAt: new Date().toISOString(), states: opts.states ?? [] },
      headers: opts.etag ? { ETag: opts.etag } : {},
    })
  })
  await page.route('**/api/agents?**', (r) => r.fulfill({ json: roster }))
  await page.route('**/api/agents', (r) => r.fulfill({ json: roster }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/widgets', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: BUILDING }))
  await page.route('**/api/apps**', (r) => r.fulfill({ json: [] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
}

const bubbles = (page: Page) => page.getByTestId('agent-activity-bubble')

// --- polling ------------------------------------------------------------------------

test('o segundo poll manda If-None-Match, e um 304 mantém o balão na tela', async ({ page }) => {
  await stub(page, { states: [liveState({ state: 'thinking' })], etag: 'W/"abc"' })
  await page.goto(`/floors/${FLOOR_ID}`)
  await expect(bubbles(page)).toHaveCount(1)

  // Espera o segundo tick (o poll é de 2s).
  // O primeiro poll não tem nada para validar; do segundo em diante, valida.
  expect(stateRequests[0].ifNoneMatch).toBeNull()
  await expect.poll(() => stateRequests.filter((r) => r.ifNoneMatch === 'W/"abc"').length, { timeout: 10000 }).toBeGreaterThan(0)
  // Respondido 304, sem corpo: o balão continua exatamente onde estava.
  await expect(bubbles(page)).toHaveCount(1)
})

test('sair do andar cancela o polling em vez de continuar pedindo', async ({ page }) => {
  await stub(page, { states: [liveState({ state: 'thinking' })] })
  await page.goto(`/floors/${FLOOR_ID}`)
  await expect(bubbles(page)).toHaveCount(1)
  await page.goto('/apps')
  const afterLeaving = stateRequests.length
  await page.waitForTimeout(4500)
  // Nenhum poll novo depois de sair: no máximo o que já estava no ar.
  expect(stateRequests.length).toBeLessThanOrEqual(afterLeaving + 1)
})

// --- a simulação física é outra coisa -----------------------------------------------

test('pausar a simulação não apaga o que os agentes estão fazendo', async ({ page }) => {
  await stub(page, { states: [liveState({ state: 'using_tool' })] })
  await page.goto(`/floors/${FLOOR_ID}`)
  await expect(bubbles(page)).toHaveCount(1)

  await page.getByRole('button', { name: /Pausar a simulação/i }).click()
  // Pausa congela o movimento; a telemetria não é movimento.
  await expect(bubbles(page)).toHaveCount(1)
  await expect(bubbles(page).first()).toHaveAttribute('aria-label', /ferramenta|Usando/i)

  await page.getByRole('button', { name: /Retomar a simulação/i }).click()
  await expect(bubbles(page)).toHaveCount(1)
})

test('a pose do personagem e o balão são independentes', async ({ page }) => {
  // Com a simulação parada (reduced motion) o sprite não troca de quadro, então a
  // POSE é estável e dá para compará-la. Com a caminhada ligada, contar sprites mede
  // o instante do quadro, não a pose — a primeira versão deste teste fazia isso e
  // passava ou falhava conforme a carga da máquina.
  await page.emulateMedia({ reducedMotion: 'reduce' })

  const poses = async () => {
    const srcs = await page
      .locator('img[src*="/illustrations/characters/"]')
      .evaluateAll((els) => els.map((el) => (el as HTMLImageElement).getAttribute('src') ?? ''))
    // Telefone ou não, sentado ou não. O número do quadro da animação é ruído.
    return srcs.map((src) => `${src.includes('-ligacao')}|${src.includes('sentado')}`).sort()
  }

  await stub(page, { states: [] })
  await page.goto(`/floors/${FLOOR_ID}`)
  await expect(page.getByTestId('execution-analytics')).toBeVisible()
  await expect(bubbles(page)).toHaveCount(0)
  const semBalao = await poses()
  expect(semBalao.length).toBeGreaterThan(0)
  // O teste só vale se alguém estiver FORA da pose de telefone no ponto de partida:
  // é justamente esse personagem que mudaria de pose se `modeFor` passasse a ler o
  // opState. Sem isso a comparação abaixo seria verdadeira por vacuidade.
  expect(semBalao.some((pose) => pose.startsWith('false'))).toBe(true)

  await stub(page, { states: [liveState({ state: 'thinking' })] })
  await page.goto(`/floors/${FLOOR_ID}`)
  await expect(bubbles(page)).toHaveCount(1)
  // O balão apareceu e as poses desenhadas são exatamente as mesmas: a telemetria
  // não manda no personagem.
  expect(await poses()).toEqual(semBalao)
})

test('sem execução, nenhum balão — nem para agenda ou gatilho armado', async ({ page }) => {
  await stub(page, { states: [] })
  await page.goto(`/floors/${FLOOR_ID}`)
  await expect(page.getByTestId('execution-analytics')).toBeVisible()
  await expect(bubbles(page)).toHaveCount(0)
})

test('uma execução real desenha o balão do estado reportado', async ({ page }) => {
  await stub(page, { states: [liveState({ state: 'researching' })] })
  await page.goto(`/floors/${FLOOR_ID}`)
  const bubble = bubbles(page).first()
  await expect(bubble).toBeVisible()
  await expect(bubble).toHaveAttribute('data-agent-bubble', 'researching')
  await expect(bubble).toHaveAttribute('aria-label', 'Nina: pesquisando')
})

test('o balão diz o tipo de trabalho e nunca o conteúdo', async ({ page }) => {
  await stub(page, {
    states: [liveState({ state: 'using_tool', safeDetail: { appKey: 'google', actionLabel: 'Criar evento' } })],
  })
  await page.goto(`/floors/${FLOOR_ID}`)
  const bubble = bubbles(page).first()
  await expect(bubble).toHaveAttribute('aria-label', 'Nina: usando ferramenta: Criar evento')
  // Nada de domínio, endpoint, argumento ou objetivo chega à tela.
  const text = await bubble.evaluate((el) => el.textContent ?? '')
  expect(text).not.toMatch(/https?:|\/\/|@|token/i)
})

test('delegação não revela o objetivo', async ({ page }) => {
  await stub(page, { states: [liveState({ state: 'delegating_sector', safeDetail: { targetType: 'sector' } })] })
  await page.goto(`/floors/${FLOOR_ID}`)
  await expect(bubbles(page).first()).toHaveAttribute('aria-label', 'Nina: chamando setor')
})

test('estado que espera uma pessoa não pisca nem parece ocupado', async ({ page }) => {
  await stub(page, { states: [liveState({ state: 'waiting_input' })] })
  await page.goto(`/floors/${FLOOR_ID}`)
  const bubble = bubbles(page).first()
  await expect(bubble).toHaveAttribute('data-agent-bubble', 'waiting_input')
  // Sem os três pontos animados: eles só existem em estados em andamento.
  const animated = await bubble.evaluate((el) =>
    [...el.querySelectorAll('span')].some((s) => getComputedStyle(s).animationName.includes('ds-bubble-dot')),
  )
  expect(animated).toBe(false)
})

test('estado em andamento tem os três pontos animados', async ({ page }) => {
  await stub(page, { states: [liveState({ state: 'thinking' })] })
  await page.goto(`/floors/${FLOOR_ID}`)
  const animated = await bubbles(page)
    .first()
    .evaluate((el) => [...el.querySelectorAll('span')].some((s) => getComputedStyle(s).animationName.includes('ds-bubble-dot')))
  expect(animated).toBe(true)
})

test('o balão não captura clique: clicar continua abrindo o agente', async ({ page }) => {
  await stub(page, { states: [liveState({ state: 'responding' })] })
  await page.goto(`/floors/${FLOOR_ID}`)
  const bubble = bubbles(page).first()
  await expect(bubble).toBeVisible()
  expect(await bubble.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')
})

test('cada agente com execução recebe o seu, e só o seu', async ({ page }) => {
  await stub(page, {
    states: [liveState({ agentId: A1, state: 'thinking' }), liveState({ agentId: A2, state: 'delivering', rootExecutionId: 'run-2' })],
  })
  await page.goto(`/floors/${FLOOR_ID}`)
  await expect(bubbles(page)).toHaveCount(2)
  await expect(page.locator('[data-agent-bubble="delivering"]')).toHaveCount(1)
})

test('reduced motion tira o movimento sem esconder o significado', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await stub(page, { states: [liveState({ state: 'thinking' })] })
  await page.goto(`/floors/${FLOOR_ID}`)
  const bubble = bubbles(page).first()
  // O ícone e a cápsula continuam lá.
  await expect(bubble).toBeVisible()
  await expect(bubble).toHaveAttribute('aria-label', 'Nina: pensando')
  const moving = await bubble.evaluate((el) =>
    [el, ...el.querySelectorAll('span')].some((s) => {
      const name = getComputedStyle(s as Element).animationName
      return name !== 'none' && name !== ''
    }),
  )
  expect(moving).toBe(false)
})

test('um estado desconhecido não desenha balão nenhum', async ({ page }) => {
  await stub(page, { states: [liveState({ state: 'monitorando' })] })
  await page.goto(`/floors/${FLOOR_ID}`)
  await expect(page.getByTestId('execution-analytics')).toBeVisible()
  await expect(bubbles(page)).toHaveCount(0)
})

test('o asset do balão é servido pelo próprio build, nunca por CDN', async ({ page }) => {
  const remoteGlyph: string[] = []
  page.on('request', (r) => {
    const url = r.url()
    // `send.svg` é o glifo de "entregando": ele não pode vir de fora.
    if (/^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(url) && /send\.svg$/.test(url)) remoteGlyph.push(url)
  })
  await stub(page, { states: [liveState({ state: 'delivering' })] })
  await page.goto(`/floors/${FLOOR_ID}`)
  const bubble = bubbles(page).first()
  await expect(bubble).toBeVisible()

  // O glifo é apontado por um caminho local do próprio build...
  const mask = await bubble.evaluate((el) => {
    const glyph = el.querySelector('span[aria-hidden="true"]') as HTMLElement | null
    return glyph ? getComputedStyle(glyph).maskImage || getComputedStyle(glyph).webkitMaskImage : ''
  })
  expect(mask).toContain('/illustrations/agent-activity/send.svg')
  expect(mask).not.toMatch(/unpkg|jsdelivr|cdn\./i)

  // ...e o arquivo existe de fato, servido pela mesma origem.
  const status = await page.evaluate(async () => (await fetch('/illustrations/agent-activity/send.svg')).status)
  expect(status).toBe(200)
  expect(remoteGlyph).toEqual([])
})

// --- geometria ---------------------------------------------------------------------

test('o rastro do balão de pensamento não encosta na cabeça', async ({ page }) => {
  await stub(page, { states: [liveState({ state: 'thinking' })] })
  await page.goto(`/floors/${FLOOR_ID}`)
  const bubble = bubbles(page).first()
  await expect(bubble).toBeVisible()
  // Dois pontinhos, não três: o terceiro caía sobre o personagem.
  const trail = await bubble.evaluate((el) => {
    const tail = [...el.children].find((c) => (c as HTMLElement).style.height === '14px')
    return tail ? tail.childElementCount : -1
  })
  expect(trail).toBe(2)
})

// Guarda de regressão ampla. Com o layout de hoje os seis agentes caem em linhas
// diferentes, então ela sozinha NÃO exercita o pior caso — quem sustenta a correção é
// o teste das faixas, logo abaixo, que falha se o degrau for removido.
test('balões de personagens lado a lado não se cobrem', async ({ page }) => {
  await stub(page, {
    agents: CROWD,
    states: CROWD.map((a, i) =>
      liveState({ agentId: a._id, state: ['thinking', 'using_tool', 'researching', 'delivering', 'responding', 'validating_output'][i], rootExecutionId: `run-${i}` }),
    ),
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/floors/${FLOOR_ID}`)
  await expect(bubbles(page).first()).toBeVisible()

  const boxes = await bubbles(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom }
    }),
  )
  expect(boxes.length).toBeGreaterThan(1)

  // Nenhum par pode se sobrepor: se dois se cruzam na horizontal, têm de estar em
  // faixas verticais diferentes.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const overlaps = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
      expect(overlaps, `balões ${i} e ${j} se cobrem`).toBe(false)
    }
  }
})

test('a cápsula tem a altura que o cálculo das faixas assume', async ({ page }) => {
  await stub(page, { states: [liveState({ state: 'thinking' })] })
  await page.goto(`/floors/${FLOOR_ID}`)
  const bubble = bubbles(page).first()
  await expect(bubble).toBeVisible()

  // BUBBLE_CAPSULE_HEIGHT / BUBBLE_TAIL_HEIGHT são medidas, não chutes. O que não pode
  // acontecer é a constante SUBESTIMAR a cápsula: aí o degrau entre faixas deixa de
  // bastar e os balões voltam a se cobrir. (A altura real é fracionária, ~21,5px, então
  // comparar inteiro exato seria frágil.)
  const box = (await bubble.boundingBox())!
  expect(box.height).toBeLessThanOrEqual(22)
  expect(box.height).toBeGreaterThan(22 - 4)

  const tail = await bubble.evaluate((el) => {
    const t = [...el.children].find((c) => (c as HTMLElement).style.height === '14px') as HTMLElement | undefined
    return t ? Number.parseInt(t.style.height, 10) : -1
  })
  expect(tail).toBe(14)
})

test('as duas faixas ficam separadas por mais que a altura de um balão', async ({ page }) => {
  await stub(page, {
    agents: CROWD,
    states: CROWD.map((a, i) => liveState({ agentId: a._id, state: 'thinking', rootExecutionId: `run-${i}` })),
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/floors/${FLOOR_ID}`)
  await expect(bubbles(page).first()).toBeVisible()

  // Cada balão é posicionado pelo wrapper: o marginBottom revela a faixa.
  const offsets = await bubbles(page).evaluateAll((els) =>
    [...new Set(els.map((el) => Number.parseInt(getComputedStyle(el.parentElement as HTMLElement).marginBottom, 10)))].sort((a, b) => a - b),
  )
  expect(offsets.length, 'as duas faixas precisam estar em uso no mapa').toBe(2)
  expect(offsets[1] - offsets[0]).toBeGreaterThanOrEqual(22 + 14)
})
