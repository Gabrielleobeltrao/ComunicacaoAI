import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// A Central de Execuções em três larguras.
//
// A página não estourava a tela — `scrollWidth` sempre batia com `clientWidth` — e mesmo
// assim ficava cortada: o container era um `display: grid` sem colunas declaradas, e uma
// coluna `auto` se dimensiona pelo CONTEÚDO. O cartão de contadores pedia 497px dentro de
// um telefone de 390, e o corte acontecia acima, invisível para qualquer teste de
// transbordo. Por isso a asserção aqui é por ELEMENTO, e não pela página.

const NOW = new Date('2026-08-18T12:00:00Z').toISOString()
const AGENT = { id: 'a1', name: 'Pesquisador de Mercado Financeiro' }
const PLACE = { floorId: 'f1', floorName: 'Térreo', sectorId: null, sectorName: null }

const RUN = (i: number) => ({
  id: `r${i}`,
  automationId: 'aut1',
  name: `Resumo diário do mercado — edição ${i}`,
  status: i % 3 === 0 ? 'failed' : 'succeeded',
  triggerType: 'schedule',
  agent: AGENT,
  place: PLACE,
  queuedAt: NOW,
  startedAt: NOW,
  finishedAt: NOW,
  tokens: 12345,
  errorKind: i % 3 === 0 ? 'provider' : null,
})

const SCHEDULED = (i: number) => ({
  id: `s${i}`,
  kind: 'schedule',
  name: `Resumo diário do mercado financeiro — edição ${i}`,
  objective: 'Consolidar as notícias do dia e destacar o que muda a carteira do cliente',
  status: i % 4 === 0 ? 'paused' : 'active',
  agent: AGENT,
  place: PLACE,
  cron: '0 9 * * *',
  timezone: 'America/Sao_Paulo',
  scheduleLabel: 'Todo dia às 09:00',
  nextRunAt: NOW,
  lastRun: { id: `r${i}`, status: i % 3 === 0 ? 'failed' : 'succeeded', finishedAt: NOW, errorKind: i % 3 === 0 ? 'provider' : null },
  recentRuns: 14,
  recentTokens: 98765,
  averageTokens: 7054,
})

const TRIGGER = (i: number) => ({
  id: `t${i}`,
  kind: 'webhook',
  name: `Novo pedido no site — ${i}`,
  objective: 'Analisar o pedido e avisar o time comercial',
  status: 'active',
  agent: AGENT,
  place: PLACE,
  endpoint: 'https://api.comunicacaoai.onplataform.com/api/hooks/automations/pk-abcdef',
  requireSignature: true,
  lastActivationAt: NOW,
  lastResult: { id: `r${i}`, status: 'succeeded', errorKind: null },
  recentRuns: 8,
  recentTokens: 4321,
  averageTokens: 540,
})

async function stub(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  // O curinga vem PRIMEIRO: no Playwright a última rota registrada é a que vale, e um
  // curinga no fim engole todas as específicas.
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/executions**', (r) => {
    const tab = new URL(r.request().url()).searchParams.get('tab') ?? 'scheduled'
    const itens =
      tab === 'history' || tab === 'running'
        ? Array.from({ length: 8 }, (_, i) => RUN(i + 1))
        : tab === 'webhook'
          ? Array.from({ length: 5 }, (_, i) => TRIGGER(i + 1))
          : Array.from({ length: 6 }, (_, i) => SCHEDULED(i + 1))
    return r.fulfill({ json: { items: itens, total: 40 } })
  })
  // Depois da rota geral: a última registrada é a que vale, e `**/api/executions**`
  // também casa com `/api/executions/summary`.
  await page.route('**/api/executions/summary**', (r) =>
    r.fulfill({ json: { next24h: 4, activeTriggers: 2, inFlight: 1, tokensWindow: 98765, runsWindow: 40, windowDays: 7 } }),
  )
  await page.route('**/api/building', (r) => r.fulfill({ json: { id: 'b1', name: 'Prédio', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW } }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [{ id: 'f1', buildingId: 'b1', name: 'Térreo', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', createdAt: NOW, updatedAt: NOW }] }))
  await page.route('**/api/agents**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
}

const LARGURAS = [
  { nome: 'telefone', w: 390 },
  { nome: 'tablet', w: 768 },
  { nome: 'desktop', w: 1440 },
]

// A faixa de abas rola na horizontal de propósito (a alternativa era quebrar em duas
// linhas). Ela é a única coisa que pode passar da borda.
const ROLAVEL = 'execution-tabs'

for (const { nome, w } of LARGURAS) {
  test(`nada da Central de Execuções passa da borda no ${nome}`, async ({ page }) => {
    await stub(page)
    await page.setViewportSize({ width: w, height: 1000 })
    await page.goto('/executions', { waitUntil: 'networkidle' })
    await expect(page.getByTestId('execution-counters')).toBeVisible()

    const fora = await page.evaluate((largura) => {
      const rolavel = document.querySelector('[data-testid="execution-tabs"]')
      const culpados: string[] = []
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (rolavel && (el === rolavel || rolavel.contains(el))) continue
        const b = el.getBoundingClientRect()
        if (b.width === 0) continue
        if (b.right > largura + 1) {
          const e = el as HTMLElement
          culpados.push(`${e.tagName}[${e.dataset?.testid ?? ''}] w=${Math.round(b.width)} right=${Math.round(b.right)}`)
        }
      }
      return culpados.slice(0, 5)
    }, w)

    expect(fora, `elementos além da borda em ${w}px`).toEqual([])
  })
}

test('no telefone os contadores ficam lado a lado, e não quatro empilhados', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 390, height: 1000 })
  await page.goto('/executions', { waitUntil: 'networkidle' })

  const colunas = await page
    .getByTestId('execution-counters')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
  // Quatro números empilhados tomavam a primeira tela inteira antes de a lista aparecer.
  expect(colunas).toBe(2)
})

test('o subtítulo da página cabe inteiro, sem ser picado no meio da palavra', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 390, height: 1000 })
  await page.goto('/executions', { waitUntil: 'networkidle' })

  // No telefone o cabeçalho empilha: os botões descem e a frase ganha a largura toda.
  await expect(page.getByText('Tudo o que os agentes fazem sozinhos', { exact: false })).toBeVisible()
  const cortado = await page
    .getByText('Tudo o que os agentes fazem sozinhos', { exact: false })
    .evaluate((el) => el.scrollHeight > el.clientHeight + 1)
  expect(cortado, 'a frase está cortada por falta de espaço').toBe(false)
})
