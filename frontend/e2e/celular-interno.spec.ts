import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// AS TELAS DE DENTRO no celular — monitoramento, monitores, databases, atividade, apps
// e o andar.
//
// As públicas já tinham guarda (`celular-publico.spec.ts`); estas não tinham nenhuma que
// ROLASSE. Havia `mobile-parity.spec.ts`, mas ele exige uma conta e dois andares semeados
// num backend de verdade e por isso pula em toda bateria — uma trava que nunca fecha não
// é uma trava. Aqui o backend é dublê, então os casos correm sempre.
//
// TOQUE EMULADO, e não só viewport estreito: `.ds-hit` só vale sob `pointer: coarse`.
// Medir numa janela estreita de desktop mostra alvos pequenos que no telefone são grandes,
// e vice-versa.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

const MINIMO = 44

const AGORA = '2026-03-12T14:30:00.000Z'
const ANDAR = '000000000000000000000f11'
const SRC = '000000000000000000000f01'

async function stub(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'demo@local.test', name: 'Demo', emailVerified: true, createdAt: AGORA, updatedAt: AGORA }
  await page.route('**/api/auth/**', (r) => r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }))
  await page.route('**/api/**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: { id: 'b1', name: 'Meu escritório', description: '', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: AGORA, updatedAt: AGORA } }))
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [{ id: ANDAR, buildingId: 'b1', name: 'Atendimento', mission: '', description: '', timezone: 'America/Sao_Paulo', defaultLanguage: 'pt', color: null, icon: null, order: 0, status: 'active', workMode: 'organization', coordinatorAgentId: null, instruction: '', createdAt: AGORA, updatedAt: AGORA }] }))
  await page.route('**/api/monitoring/overview', (r) => r.fulfill({ json: { items: [{ id: SRC, name: 'Preço do fornecedor', kind: 'api_polling', status: 'active', health: 'degraded', reason: 'a última leitura boa tem 42 min', lastReadAt: AGORA, latencyMs: 180, consecutiveFailures: 0, readsOk: 12, readsFailed: 3, nextReadAt: AGORA, destination: { live: false, history: true } }, { id: 'f02', name: 'Estoque do armazém central', kind: 'websocket', status: 'active', health: 'online', reason: 'lendo normalmente', lastReadAt: AGORA, latencyMs: 42, consecutiveFailures: 0, readsOk: 900, readsFailed: 0, nextReadAt: AGORA, destination: { live: true, history: true } }], summary: { total: 2, online: 1, degraded: 1, paused: 0, neverRead: 0 } } }))
  await page.route('**/api/monitoring/live', (r) => r.fulfill({ json: { items: [] } }))
  await page.route('**/api/monitoring/history**', (r) => r.fulfill({ json: { items: [], nextCursor: null } }))
  await page.route('**/api/monitors', (r) => r.fulfill({ json: [{ id: 'm1', name: 'Preço abaixo de 30', status: 'published', source: { kind: 'internal_event', eventType: 'market.candle.closed' }, condition: { kind: 'compare', field: 'preco', op: 'lt', value: 30 }, conditionText: 'preço abaixo de 30', triggerMode: 'enter', threshold: null, thresholdField: null, debounceMs: 0, cooldownMs: 0, flowId: 'f1', state: null }] }))
  await page.route('**/api/activity**', (r) => r.fulfill({ json: { items: [{ executionKey: 'run:aaa', status: 'succeeded', source: 'schedule', environment: 'production', createdAt: AGORA, startedAt: AGORA, finishedAt: AGORA, durationMs: 1500, origin: { kind: 'monitor', id: 'm1', name: 'RSI abaixo de 30', eventId: 'e2' }, flow: { id: 'f1', name: 'Avisar no Slack', version: 3, triggerType: 'internal_event' }, steps: [{ stepId: 's1', stepType: 'agent.execute', status: 'succeeded', durationMs: 900 }], deliveries: 1, usage: { inputTokens: 1840, outputTokens: 320 }, errorKind: null }], nextCursor: null } }))
  await page.route('**/api/databases', (r) => r.fulfill({ json: { items: [{ id: 'db1', name: 'Preços do fornecedor', description: 'Histórico de preços por SKU', ownerType: 'floor', ownerId: ANDAR, datasetCount: 2, rowCount: 137, updatedAt: AGORA, createdAt: AGORA }] } }))
  await page.route('**/api/databases/*/datasets', (r) => r.fulfill({ json: { items: [{ key: 'precos', rowCount: 137, fields: [{ name: 'sku' }, { name: 'preco' }] }] } }))
  await page.route('**/api/monitors/meta', (r) => r.fulfill({ json: { eventTypes: ['market.candle.closed'], triggerModes: ['level', 'enter', 'exit'], operators: ['gt', 'lt', 'eq'] } }))
  await page.route('**/api/automations**', (r) => r.fulfill({ json: { items: [] } }))
  const app = (key: string, name: string, description: string, categories: string[]) => ({
    key, version: '1.0.0', source: 'system', name, description, icon: key, categories,
    documentationUrl: null, status: 'published',
    auth: { kind: 'webhook', fields: [], scopes: [], documentationUrl: null },
    allowedDomains: [], supportsMultipleConnections: true,
    actions: [{ key: `${key}_acao`, name: 'Enviar', description: 'Envia.', risk: 'write', inputSchema: {}, resourceFields: [] }],
    surfaces: [], pinnable: false, defaultSurfaceKey: null,
    dataAccess: ['Nada é lido.'], storageNote: 'Fica criptografado.', disconnectNote: 'Para os avisos.',
    providerCostNote: null, requiresAuth: true, activation: 'credentials', connected: false, installationCount: 0,
  })
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [app('slack', 'Slack', 'Avisar um canal do Slack.', ['comunicação']), app('hubspot', 'HubSpot', 'Ler e escrever no CRM.', ['crm']), app('stripe', 'Stripe', 'Cobranças e assinaturas.', ['pagamento'])] }))
  await page.route('**/api/app-installations', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/streams', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/tools', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/packages**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/trading-policies/active**', (r) => r.fulfill({ json: null }))
}

const ANDAR_ROTA = `/floors/${ANDAR}`
const ROTAS = ['/monitoring', '/monitors', '/databases', '/activity', '/apps', ANDAR_ROTA]

/** Os controles isolados — link dentro de parágrafo fica de fora, como nas públicas. */
async function foraDoMinimo(page: Page) {
  return page.evaluate(
    (minimo) =>
      [...document.querySelectorAll('a, button, input, select, summary')]
        .map((e) => ({ r: e.getBoundingClientRect(), e }))
        .filter(({ r, e }) => r.width > 0 && r.height > 0 && r.height < minimo && !e.closest('p'))
        .map(({ r, e }) => `${e.tagName}[${e.getAttribute('data-testid') ?? (e.textContent ?? '').trim().slice(0, 16)}]=${Math.round(r.height)}`),
    MINIMO,
  )
}

/**
 * O que passa da borda SEM ter como chegar lá.
 *
 * Este é o defeito que a medida de estouro da página não pega: a fileira de abas tinha
 * cinco itens em 390 px, o quinto terminava em 409, e como `display: flex` sem `overflow`
 * não rola — só transborda — a aba "Histórico" era invisível E inalcançável, com a página
 * inteira jurando que estava tudo bem.
 *
 * A PERGUNTA É "DÁ PARA CHEGAR NELE?", e não "que CSS os pais têm". A primeira versão
 * disto isentava quem tivesse um ancestral com `overflow-x: auto` — e isentou tudo, porque
 * um contêiner com `overflow-y: auto` e `overflow-x: visible` COMPUTA `overflow-x: auto`.
 * A régua passou a dizer que estava tudo certo mesmo com a rolagem das abas removida.
 * Agora ela pede que o elemento apareça: `scrollIntoView` e mede de novo. Quem rola,
 * aparece; quem está cortado, continua fora.
 */
async function cortadoNaBorda(page: Page) {
  return page.evaluate(() => {
    const V = window.innerWidth
    const suspeitos = [...document.querySelectorAll('main *')].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.right > V + 1
    })
    const presos: string[] = []
    const rolaveis = [document.scrollingElement, document.querySelector('main')].filter(Boolean) as Element[]
    for (const e of suspeitos) {
      e.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const r = e.getBoundingClientRect()
      // Meio pixel de tolerância, e não um inteiro: o filtro de categoria do Apps
      // terminava em 391 numa tela de 390 e escapava por um pixel de folga generosa.
      if (r.right > V + 0.5) presos.push(`${e.tagName}[${e.getAttribute('data-testid') ?? (e.className || '').toString().slice(0, 20)}] termina em ${Math.round(r.right)}`)
      // E QUEM rolou importa: sem `overflow-x` na fileira de abas, mostrar "Histórico"
      // arrasta a PÁGINA para o lado — o controle aparece encostado na borda e todo o
      // resto da tela anda junto. Isso não é rolagem de um bloco, é a tela escorregando.
      for (const c of rolaveis) {
        if (c.scrollLeft > 0.5) {
          presos.push(`mostrar ${e.tagName}[${(e.textContent ?? '').trim().slice(0, 14)}] arrasta ${c.tagName} ${Math.round(c.scrollLeft)}px para o lado`)
          c.scrollLeft = 0
        }
      }
      if (presos.length >= 6) break
    }
    return presos
  })
}

/**
 * Rótulo que não cabe na própria caixa.
 *
 * O outro jeito de a fileira de abas quebrar: em vez de transbordar, os botões ENCOLHEM
 * e cada um corta o próprio texto — "Histórico" vira "Histó". A caixa fica dentro da tela,
 * a página não rola, e a régua anterior dizia que estava tudo certo enquanto metade dos
 * rótulos estava ilegível. `text-overflow: ellipsis` fica de fora: cortar com reticências
 * é uma decisão, e não um acidente.
 */
async function rotuloCortado(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('button, a, th, label > span')]
      .filter((e) => {
        if (e.scrollWidth <= e.clientWidth + 1 || e.clientWidth === 0) return false
        const cs = getComputedStyle(e)
        return cs.textOverflow !== 'ellipsis'
      })
      .slice(0, 8)
      .map((e) => `${e.tagName}[${(e.textContent ?? '').trim().slice(0, 18)}] ${e.scrollWidth}>${e.clientWidth}`),
  )
}

for (const rota of ROTAS) {
  test(`ACEITAÇÃO: em ${rota} todo controle isolado tem alvo de toque`, async ({ page }) => {
    await stub(page)
    await page.goto(rota)
    await page.waitForLoadState('networkidle')
    const pequenos = await foraDoMinimo(page)
    expect(pequenos, `abaixo de ${MINIMO}px: ${pequenos.join(', ')}`).toEqual([])
  })

  test(`ACEITAÇÃO: em ${rota} nada é cortado na borda sem ter como chegar lá`, async ({ page }) => {
    await stub(page)
    await page.goto(rota)
    await page.waitForLoadState('networkidle')
    const cortados = await cortadoNaBorda(page)
    expect(cortados, `passa dos 390px sem rolagem: ${cortados.join(' | ')}`).toEqual([])
    const ilegiveis = await rotuloCortado(page)
    expect(ilegiveis, `rótulo cortado na própria caixa: ${ilegiveis.join(' | ')}`).toEqual([])
    // E o piso de sempre: a página em si não rola para o lado.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${rota} rola ${overflow}px para o lado`).toBeLessThanOrEqual(1)
  })
}

test('AMEAÇA: nenhuma tela renderiza a caixa de erro com o dublê no ar', async ({ page }) => {
  // Metade da primeira medição que fiz aqui mediu a TELA DE ERRO e não a página: o dublê
  // devolvia `{items: []}` onde o código espera um array, a tela quebrava, e eu media a
  // altura do botão "Recarregar" achando que media a de Apps. A régua precisa provar que
  // está medindo a coisa certa.
  for (const rota of ROTAS) {
    await stub(page)
    await page.goto(rota)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Algo quebrou ao renderizar a tela'), `${rota} quebrou`).toHaveCount(0)
  }
})

test('no DESKTOP as abas continuam numa linha só, sem rolagem', async ({ page }) => {
  // `overflow-x: auto` na fileira de abas é acomodação de tela estreita. Onde cabe, não
  // pode aparecer rolagem nenhuma — nem o corte que ela implica.
  await page.setViewportSize({ width: 1280, height: 900 })
  await stub(page)
  await page.goto('/monitoring')
  await page.waitForLoadState('networkidle')
  const abas = page.locator('[role="tablist"], [data-testid="monitoring-abas"]').first()
  const sobra = await page
    .locator('button', { hasText: 'Histórico' })
    .first()
    .evaluate((e) => {
      const fila = e.parentElement!
      return fila.scrollWidth - fila.clientWidth
    })
  expect(sobra, 'as abas rolam mesmo numa tela larga').toBeLessThanOrEqual(1)
  await expect(abas.or(page.locator('button', { hasText: 'Histórico' }).first())).toBeVisible()
})
