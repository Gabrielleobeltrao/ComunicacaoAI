import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// ATIVIDADE na tela: a cadeia inteira em uma linha, e nada de conteúdo.
//
// O que estes casos protegem: a correlação aparece como frase (monitor → flow → etapas →
// entrega), o painel não inventa duração de execução inacabada, e os filtros vão para a
// consulta em vez de peneirar no cliente — o que faria a paginação mentir.
const NOW = new Date(0).toISOString()

const ITEM = {
  executionKey: 'run:aaa',
  status: 'succeeded',
  source: 'schedule',
  environment: 'production',
  createdAt: NOW,
  startedAt: NOW,
  finishedAt: new Date(1500).toISOString(),
  durationMs: 1500,
  origin: { kind: 'monitor', id: 'm1', name: 'RSI sobrevendido', eventId: 'e2' },
  flow: { id: 'f1', name: 'Avisar no Slack', version: 3, triggerType: 'internal_event' },
  steps: [
    { stepId: 's1', stepType: 'agent.execute', status: 'succeeded', durationMs: 900 },
    { stepId: 's2', stepType: 'delivery.send', status: 'succeeded', durationMs: 200 },
  ],
  deliveries: 1,
  usage: { inputTokens: 10, outputTokens: 5 },
  errorKind: null,
}

const RODANDO = {
  ...ITEM,
  executionKey: 'run:bbb',
  status: 'running',
  finishedAt: null,
  durationMs: null,
  origin: null,
  flow: null,
  steps: [],
  deliveries: 0,
  usage: { inputTokens: 0, outputTokens: 0 },
}

let pedidos: string[] = []

async function stub(page: Page, itens: unknown[] = [ITEM, RODANDO]) {
  pedidos = []
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) =>
    r.fulfill({ json: { id: 'b1', name: 'Prédio QA', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW } }),
  )
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/activity**', (r) => {
    pedidos.push(r.request().url())
    const url = new URL(r.request().url())
    const status = url.searchParams.get('status')
    const filtrados = status ? (itens as { status: string }[]).filter((i) => i.status === status) : itens
    return r.fulfill({ json: { items: filtrados, nextBefore: null } })
  })
}

test('a linha mostra a cadeia: monitor → flow → etapas → entrega', async ({ page }) => {
  await stub(page)
  await page.goto('/activity')
  const primeira = page.getByTestId('activity-cadeia').first()
  await expect(primeira).toContainText('monitor RSI sobrevendido')
  await expect(primeira).toContainText('Avisar no Slack v3')
  await expect(primeira).toContainText('2 etapas')
  await expect(primeira).toContainText('1 entrega')
})

test('execução inacabada não ganha uma duração inventada', async ({ page }) => {
  await stub(page)
  await page.goto('/activity')
  const segunda = page.getByTestId('activity-item').nth(1)
  await expect(segunda).toContainText('rodando')
  await expect(segunda).toContainText('—')
})

test('o filtro vai para a CONSULTA, não para uma peneira no cliente', async ({ page }) => {
  await stub(page)
  await page.goto('/activity')
  await expect(page.getByTestId('activity-item')).toHaveCount(2)

  await page.getByTestId('activity-status').selectOption('failed')
  await expect.poll(() => pedidos.some((u) => u.includes('status=failed'))).toBe(true)
  await expect(page.getByTestId('activity-item')).toHaveCount(0)
})

test('sem nada no período, a tela diz isso em vez de ficar vazia', async ({ page }) => {
  await stub(page, [])
  await page.goto('/activity')
  await expect(page.getByText('Nada aconteceu ainda com esses filtros')).toBeVisible()
})
