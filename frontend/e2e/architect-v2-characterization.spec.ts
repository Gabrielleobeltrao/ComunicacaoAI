import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// LACUNA 12 CORRIGIDA — o Arquiteto passou a ser um chat global.
//
// Estes casos eram de caracterização: eles travavam a ausência do chat. Agora afirmam a
// presença dele, e é nesta linha que a correção fica visível no histórico.
const NOW = new Date(0).toISOString()

let enviado: unknown = null

async function stub(page: Page, opts: { turno?: unknown } = {}) {
  enviado = null
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
  await page.route('**/api/floors**', (r) =>
    r.fulfill({ json: [{ id: '000000000000000000000f11', name: 'Atendimento', status: 'active', buildingId: 'b1', workMode: 'organization', createdAt: NOW, updatedAt: NOW }] }),
  )
  await page.route('**/api/architect/assistant/turn', (r) => {
    enviado = r.request().postDataJSON()
    return r.fulfill({
      json:
        opts.turno ?? {
          intent: { mode: 'answer', query: 'x', freshness: 'static' },
          phase: 'done',
          text: 'entendi',
          question: null,
          projectId: null,
          context: { pathname: '/', rejected: [] },
        },
    })
  })
}

test('CORRIGIDA: o botão do Arquiteto existe em toda rota autenticada', async ({ page }) => {
  await stub(page)
  for (const rota of ['/dashboard', '/apps', '/agents']) {
    await page.goto(rota)
    await expect(page.getByTestId('architect-launcher'), `sumiu em ${rota}`).toBeVisible()
  }
})

test('CORRIGIDA: abrir, escrever e NAVEGAR — o rascunho sobrevive', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('adicione reservas pelo WhatsApp')

  // A navegação DE APP é o teste: `page.goto` recarregaria tudo, e nenhum chat sobrevive a
  // um reload sem persistência. O que o plano pede é sobreviver à troca de rota.
  await page.getByRole('link', { name: 'Apps' }).first().click()
  await expect(page).toHaveURL(/\/apps/)
  await expect(page.getByTestId('architect-panel')).toBeVisible()
  await expect(page.getByTestId('architect-input')).toHaveValue('adicione reservas pelo WhatsApp')
})

test('minimizar guarda a conversa; fechar e reabrir também', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('um rascunho')

  await page.getByTestId('architect-minimize').click()
  await expect(page.getByTestId('architect-input')).toHaveCount(0)
  await page.getByTestId('architect-minimize').click()
  await expect(page.getByTestId('architect-input')).toHaveValue('um rascunho')

  await page.getByTestId('architect-close').click()
  await expect(page.getByTestId('architect-panel')).toHaveCount(0)
  await page.getByTestId('architect-launcher').click()
  await expect(page.getByTestId('architect-input')).toHaveValue('um rascunho')
})

test('o botão some enquanto o painel está aberto — dois alvos para a mesma coisa confundem', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await expect(page.getByTestId('architect-launcher')).toHaveCount(0)
  await page.getByTestId('architect-minimize').click()
  // Minimizado, o painel vira uma barra: o botão volta a fazer sentido.
  await expect(page.getByTestId('architect-launcher')).toBeVisible()
})

test('uma PERGUNTA não cria projeto, e a resposta diz por que não deu', async ({ page }) => {
  await stub(page, {
    turno: {
      intent: { mode: 'answer', query: 'valor do dólar', freshness: 'current' },
      phase: 'failed',
      text: 'não tenho uma fonte conectada para "valor do dólar" agora. Conecte um App ou uma fonte de dados que traga esse número, e eu respondo com a origem e o horário.',
      question: null,
      projectId: null,
      context: { pathname: '/dashboard', rejected: [] },
    },
  })
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('Qual o valor do dólar hoje?')
  await page.getByTestId('architect-enviar').click()

  await expect(page.getByTestId('architect-msg-arquiteto')).toContainText('Conecte um App ou uma fonte')
  await expect(page.getByTestId('architect-abrir-projeto')).toHaveCount(0)
})

test('uma PROPOSTA oferece abrir o projeto, e o estado é dito em português', async ({ page }) => {
  await stub(page, {
    turno: {
      intent: { mode: 'propose', changeKind: 'expand', objective: 'reservas' },
      phase: 'preparing_proposal',
      text: 'Vou montar isso. Comecei um projeto — nada é aplicado sem a sua aprovação.',
      question: null,
      projectId: '000000000000000000000abc',
      context: { pathname: '/dashboard', rejected: [] },
    },
  })
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('adicione reservas ao meu restaurante')
  await page.getByTestId('architect-enviar').click()

  await expect(page.getByTestId('architect-msg-arquiteto')).toContainText('nada é aplicado sem a sua aprovação')
  await expect(page.getByTestId('architect-abrir-projeto')).toBeVisible()
  await expect(page.getByTestId('architect-phase')).toHaveText('preparando a proposta')
})

test('o contexto da tela vai como REFERÊNCIA — nunca o conteúdo dela', async ({ page }) => {
  await stub(page)
  await page.goto('/floors/000000000000000000000f11')
  await page.getByTestId('architect-launcher').click()
  await page.getByTestId('architect-input').fill('o que é isto?')
  await page.getByTestId('architect-enviar').click()

  await expect.poll(() => enviado).not.toBeNull()
  expect(enviado).toMatchObject({ uiContext: { pathname: '/floors/000000000000000000000f11', floorId: '000000000000000000000f11' } })
  // Nada do CONTEÚDO da tela viaja: só os ids que a URL já carrega.
  expect(Object.keys((enviado as { uiContext: object }).uiContext).sort()).toEqual(['floorId', 'pathname'])
})

test('teclado: Enter envia, Shift+Enter quebra linha, Esc fecha', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()

  const campo = page.getByTestId('architect-input')
  await campo.fill('primeira linha')
  await campo.press('Shift+Enter')
  await campo.type('segunda linha')
  await expect(campo).toHaveValue('primeira linha\nsegunda linha')

  await campo.press('Enter')
  await expect(page.getByTestId('architect-msg-pessoa')).toContainText('primeira linha')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('architect-panel')).toHaveCount(0)
})

test('em 320 px o painel ocupa a tela e não empurra a página', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/dashboard')
  await page.getByTestId('architect-launcher').click()
  await expect(page.getByTestId('architect-panel')).toBeVisible()
  const largura = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(largura).toBeLessThanOrEqual(321)
})

test('o alvo de toque do botão alcança o mínimo', async ({ page }) => {
  await stub(page)
  await page.goto('/dashboard')
  const caixa = await page.getByTestId('architect-launcher').boundingBox()
  expect(caixa!.height).toBeGreaterThanOrEqual(44)
})

test('na página de um PROJETO o chat global se retira — uma conversa por tela', async ({ page }) => {
  await stub(page)
  await page.route('**/api/architect/projects/*', (r) =>
    r.fulfill({
      json: {
        id: '000000000000000000000abc',
        title: 'Reservas',
        objective: 'x',
        status: 'discovery',
        locale: 'pt',
        answers: {},
        assumptions: [],
        blueprint: null,
        checklist: [],
        readiness: { requiredDone: 0, requiredTotal: 0, optionalDone: 0, optionalTotal: 0, ready: false, blockers: [] },
        createdAt: NOW,
        updatedAt: NOW,
      },
    }),
  )
  await page.goto('/architect/000000000000000000000abc')

  // Ali existe a conversa DO PROJETO: duas caixas na mesma tela é a pessoa escrevendo na
  // errada e não entendendo por que a outra não respondeu.
  await expect(page.getByTestId('architect-launcher')).toHaveCount(0)
  await expect(page.getByTestId('architect-panel')).toHaveCount(0)
})
