import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * As superfícies de CANAL no celular: visão geral, widgets e conversas.
 *
 * São as telas mais usadas do produto e as únicas que ninguém media em largura de
 * celular — `apps.spec.ts` abre as rotas, mas para conferir o guarda de App, quase
 * sempre com ele RECUSANDO; o que era medido ali seria a página de recusa.
 *
 * Aqui o App está ativo e as telas têm conteúdo — e conteúdo do tipo que estoura:
 * nome comprido, chave pública sem espaço nenhum, mensagem longa e número grande.
 * Uma tela vazia cabe em qualquer largura e não prova nada.
 */
const NOW = new Date(0).toISOString()
const COMPRIDO = 'Atendimento do Site — primeiro contato, dúvidas e pedidos'
const CHAVE = 'wk_live_9f2c4a7e1b8d5063f4a2c9e7b1d8506341a2c9e7'

const CONVERSAS = Array.from({ length: 6 }, (_, i) => ({
  widgetId: `w${i}`,
  widgetName: COMPRIDO,
  conversationId: `conv-9f2c4a7e1b8d5063f4a2c9e7b1d85063-${i}`,
  lastMessage:
    'Boa tarde! Gostaria de saber se vocês entregam no bairro inteiro e qual é o prazo, porque preciso receber ainda hoje se possível — obrigado.',
  lastRole: i % 2 ? 'assistant' : 'user',
  lastAt: NOW,
  messageCount: 128 + i,
  humanHandoff: i === 0,
}))

const WIDGETS = [
  {
    _id: 'w0',
    name: COMPRIDO,
    publicKey: CHAVE,
    primaryColor: '#2563eb',
    welcomeTitle: 'Olá!',
    welcomeMessage: 'Como posso ajudar?',
    position: 'bottom-right',
    avatarUrl: null,
    agentId: 'a1',
    sectorId: null,
  },
]

async function stub(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('comunicacaoai.locale', 'pt'))
  const user = { id: 'u1', email: 'qa@local.test', name: 'QA', emailVerified: true, createdAt: NOW, updatedAt: NOW }
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ json: { session: { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 864e5).toISOString(), token: 't' }, user } }),
  )
  // O App está ATIVO: sem isto o guarda recusa e o que seria medido é a recusa.
  await page.route('**/api/apps/*/surfaces/*/access', (r) => r.fulfill({ json: { ok: true } }))
  await page.route('**/api/apps/*/overview', (r) =>
    r.fulfill({
      json: {
        appKey: 'web_chat',
        channels: [
          { id: 'w0', name: COMPRIDO, agentId: 'a1', sectorId: null, ready: true },
          { id: 'w1', name: `${COMPRIDO} (segundo canal)`, agentId: null, sectorId: 's1', ready: false },
        ],
        conversations: 12_480,
        conversations7d: 1_284,
        messages7d: 96_512,
        handoffs: 143,
        avgResponseMs: 42_000,
        lastMessageAt: NOW,
      },
    }),
  )
  await page.route('**/api/conversations**', (r) => r.fulfill({ json: CONVERSAS }))
  await page.route('**/api/widgets/*/conversations/*/**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/widgets**', (r) => r.fulfill({ json: WIDGETS }))
  await page.route('**/api/agents**', (r) => r.fulfill({ json: [{ _id: 'a1', name: COMPRIDO, objective: '', floorId: 'f1' }] }))
  await page.route('**/api/sectors**', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/floors**', (r) => r.fulfill({ json: [{ id: 'f1', name: 'Térreo', buildingId: 'b1', order: 0, status: 'active', createdAt: NOW, updatedAt: NOW }] }))
  await page.route('**/api/building', (r) => r.fulfill({ json: { id: 'b1', name: 'Prédio QA', defaultTimezone: 'America/Sao_Paulo', defaultLanguage: 'pt', createdAt: NOW, updatedAt: NOW } }))
  await page.route('**/api/apps/navigation', (r) => r.fulfill({ json: { apps: [], pinned: [] } }))
  await page.route('**/api/apps/catalog', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/app-installations', (r) => r.fulfill({ json: [] }))
}

const TELAS = [
  ['visão geral do canal', '/apps/web-chat/overview', 'channel-overview'],
  ['widgets', '/apps/web-chat/widgets', 'widget-snippet'],
] as const

for (const largura of [320, 390]) {
  test(`em ${largura}px as telas de canal não estouram a largura`, async ({ page }) => {
    await stub(page)
    await page.setViewportSize({ width: largura, height: 800 })

    for (const [nome, rota, marca] of TELAS) {
      await page.goto(rota)
      await expect(page.getByTestId(marca).first(), `${nome} não carregou`).toBeVisible({ timeout: 15_000 })
      const folga = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(folga, `${nome} estourou ${folga}px`).toBeLessThanOrEqual(1)

      // E nada cortado à esquerda, onde não existe rolagem que alcance.
      const cortado = await page.evaluate(() => {
        for (const el of document.querySelectorAll('main *')) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0 && r.left < -2) return `${el.tagName}.${String((el as HTMLElement).className).slice(0, 40)}`
        }
        return null
      })
      expect(cortado, `${nome}: cortado à esquerda`).toBeNull()
    }

    // As conversas por último: a lista só existe depois de carregar, e a busca é a
    // prova de que carregou — ela não aparece no estado vazio.
    await page.goto('/apps/web-chat/conversations')
    await expect(page.getByPlaceholder('Buscar nas conversas...'), 'conversas não carregaram').toBeVisible({ timeout: 15_000 })
    const folgaConversas = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(folgaConversas, `conversas estourou ${folgaConversas}px`).toBeLessThanOrEqual(1)
  })
}

test('a chave pública comprida não empurra a tela no celular', async ({ page }) => {
  await stub(page)
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/apps/web-chat/widgets')
  // O trecho de instalação é um texto sem espaço NENHUM. Ele pode rolar dentro da
  // própria caixa; o que não pode é levar a página junto.
  const trecho = page.getByTestId('widget-snippet').first()
  await expect(trecho).toBeVisible({ timeout: 15_000 })
  const box = await trecho.boundingBox()
  expect(box, 'o trecho está na tela').not.toBeNull()
  if (box) expect(box.width, 'o trecho cabe na largura').toBeLessThanOrEqual(320)
})
