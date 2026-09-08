import { expect, test } from '@playwright/test'

// AS PÁGINAS PÚBLICAS NO CELULAR.
//
// Os casos que já existiam mediam "nada estoura para os lados em 320 px". Isso é o piso,
// não a régua: uma página pode caber na largura e ainda ser ruim de usar com o polegar —
// e as duas coisas que a estragam não aparecem numa medida de estouro.
//
// TOQUE EMULADO, e não só viewport estreito. O sistema de design cresce os alvos com
// `.ds-hit`, que só vale sob `pointer: coarse`; medir numa janela estreita de desktop
// mostra alvos pequenos que no telefone são grandes, e alvos grandes que no telefone são
// pequenos. A primeira medição que fiz mentiu nas duas direções por causa disso.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

/** O mínimo tocável do sistema de design (`--hit-min`). */
const MINIMO = 44

/**
 * Os alvos que precisam do tamanho inteiro.
 *
 * Link dentro de um parágrafo fica de fora de propósito: forçar 44 px num link no meio de
 * uma frase arrebentaria a entrelinha do texto, e a recomendação de acessibilidade abre
 * essa exceção justamente para ele. O que se exige aqui é dos controles ISOLADOS.
 */
const alvosIsolados = `a, button, input, select, summary`

async function foraDoMinimo(page: import('@playwright/test').Page) {
  return page.evaluate(
    ([seletor, minimo]) =>
      [...document.querySelectorAll(seletor as string)]
        .map((e) => ({ r: e.getBoundingClientRect(), e }))
        .filter(({ r, e }) => r.width > 0 && r.height > 0 && r.height < (minimo as number) && !e.closest('p'))
        .map(({ r, e }) => `${e.tagName}[${e.getAttribute('data-testid') ?? (e.textContent ?? '').trim().slice(0, 20)}] = ${Math.round(r.height)}px`),
    [alvosIsolados, MINIMO] as const,
  )
}

for (const rota of ['/', '/docs', '/docs/api']) {
  test(`ACEITAÇÃO: em ${rota} todo controle isolado tem alvo de toque`, async ({ page }) => {
    await page.goto(rota)
    await page.waitForLoadState('networkidle')
    const pequenos = await foraDoMinimo(page)
    expect(pequenos, `abaixo de ${MINIMO}px: ${pequenos.join(', ')}`).toEqual([])
  })
}

test('ACEITAÇÃO: no celular o texto da documentação começa na PRIMEIRA tela', async ({ page }) => {
  /**
   * O menu lateral empilhado acima do artigo empurrava o título para 609 px numa tela de
   * 844: abrir uma página e ver a busca mais seis links antes da primeira linha. Medido
   * antes e depois — 609 → 290.
   */
  await page.goto('/docs/api')
  const conteudo = page.getByTestId('docs-conteudo')
  await expect(conteudo).toBeVisible()
  const topo = await conteudo.evaluate((e) => e.getBoundingClientRect().top + window.scrollY)
  expect(topo, `o texto começa em ${Math.round(topo)}px`).toBeLessThan(400)

  // E o índice continua alcançável — dobrado, e não removido.
  const dobra = page.getByTestId('docs-indice-dobra')
  await expect(dobra).toBeVisible()
  expect(await dobra.evaluate((e) => (e as HTMLDetailsElement).open), 'no celular a dobra abre fechada').toBe(false)
  await page.getByText('Nesta documentação').click()
  await expect(page.getByTestId('docs-link-conceitos')).toBeVisible()
})

test('AMEAÇA: nenhuma página pública rola para o lado', async ({ page }) => {
  // O piso de sempre, agora com toque: uma imagem ou um bloco de código sem contenção
  // aparece aqui antes de aparecer para quem abriu no ônibus.
  for (const rota of ['/', '/docs', '/docs/api', '/login', '/register']) {
    await page.goto(rota)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${rota} rola ${overflow}px para o lado`).toBeLessThanOrEqual(1)
  }
})

test('no DESKTOP nada disso muda: o índice continua aberto e ao lado', async ({ page }) => {
  // A dobra é uma acomodação do celular, e não uma mudança de produto. Quem tem coluna
  // lateral não pode passar a precisar de um toque a mais.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/docs/api')
  await expect(page.getByTestId('docs-conteudo')).toBeVisible()
  expect(await page.getByTestId('docs-indice-dobra').evaluate((e) => (e as HTMLDetailsElement).open)).toBe(true)
  const lado = await page.evaluate(() => {
    const menu = document.querySelector('[data-testid="docs-indice"]')!.getBoundingClientRect()
    const texto = document.querySelector('[data-testid="docs-conteudo"]')!.getBoundingClientRect()
    return menu.right <= texto.left + 1
  })
  expect(lado).toBe(true)
})
