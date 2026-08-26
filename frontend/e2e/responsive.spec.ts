import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * As telas PÚBLICAS em cada largura.
 *
 * Só as públicas moram aqui, e por um motivo: este arquivo roda com o frontend
 * sozinho. A versão anterior também varria `/dashboard`, `/agents` e companhia
 * fazendo um login que, sem backend de pé, nunca acontecia — as oito varreduras
 * passavam medindo a tela de LOGIN, e a única asserção que dependia de estar
 * logado (o menu do celular) era a única vermelha. Um guarda que passa sem olhar
 * é pior do que nenhum: ele responde "está tudo certo".
 *
 * As telas de dentro são medidas onde há sessão de verdade, com dado de verdade e
 * nome comprido de verdade: `mvp-smoke.spec.ts`, que o `npm run smoke` roda contra
 * a pilha inteira — vinte e uma telas nas mesmas quatro larguras, mais o alvo de
 * toque e a gaveta do celular.
 */
const VIEWPORTS = [
  { w: 320, h: 568 },
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1440, h: 900 },
]
const PUBLIC_ROUTES = ['/', '/login', '/register']

async function semRolagemLateral(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'networkidle' })
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(sw, `a página rola de lado em ${route}`).toBeLessThanOrEqual(cw + 1)
}

test.describe('as telas públicas cabem na largura', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.w}x${vp.h}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h })
      for (const r of PUBLIC_ROUTES) {
        await semRolagemLateral(page, r)

        // E o conteúdo é ALCANÇÁVEL: um bloco que começa antes do zero fica cortado
        // à esquerda, onde não há rolagem que chegue.
        const cortado = await page.evaluate(() => {
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect()
            if (r.width > 0 && r.height > 0 && r.left < -2) return `${el.tagName}.${String((el as HTMLElement).className).slice(0, 40)}`
          }
          return null
        })
        expect(cortado, `elemento cortado à esquerda em ${r}`).toBeNull()
      }
    })
  }
})

test('o formulário de entrada é usável no celular pequeno', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/login', { waitUntil: 'networkidle' })
  // Campo e botão precisam caber na tela E ter alvo de toque decente. Um formulário
  // de login que não dá para preencher no celular fecha a porta do produto inteiro.
  for (const alvo of [page.locator('input[type="email"]'), page.locator('input[type="password"]'), page.getByRole('button', { name: /Entrar/i })]) {
    const box = await alvo.first().boundingBox()
    expect(box, 'o controle está na tela').not.toBeNull()
    if (box) {
      expect(box.width, 'cabe na largura').toBeLessThanOrEqual(320)
      expect(box.height, 'alvo de toque').toBeGreaterThanOrEqual(36)
    }
  }
})
