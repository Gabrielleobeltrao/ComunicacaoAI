import { expect, test } from '@playwright/test'

// A LANDING — e as perguntas que ela precisa responder antes de pedir um cadastro.
//
// Ela dizia o que o produto É e pulava para os valores. Quem chega sem conhecer a
// categoria não sabe o que vai FAZER depois de criar a conta, e a dúvida "quanto trabalho
// isso dá?" é a que decide a maioria das visitas. Os casos abaixo prendem a ordem em que
// as respostas aparecem, e o caminho para quem prefere ler antes de se cadastrar.

test('ACEITAÇÃO: a landing responde o que é, como funciona e o que muda — nessa ordem', async ({ page }) => {
  await page.goto('/')

  const passos = page.getByTestId('home-passos')
  const diferencas = page.getByTestId('home-diferencas')
  await expect(passos).toBeVisible()
  await expect(diferencas).toBeVisible()

  // Três passos, e o segundo é o que responde "e se ele montar errado?".
  await expect(passos.locator('> *')).toHaveCount(3)
  await expect(passos).toContainText('Nada acontece sem a sua confirmação')

  // "Como funciona" antes de "o que muda": a comparação só significa alguma coisa depois
  // de a pessoa saber o que ela vai fazer.
  const ordem = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="home-passos"]')!
    const b = document.querySelector('[data-testid="home-diferencas"]')!
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  expect(ordem).toBe(true)
})

test('quem prefere LER antes de se cadastrar tem caminho', async ({ page }) => {
  await page.goto('/')
  // Um avaliador técnico decide lendo, e não pelo herói. Sem esta porta, ele sai.
  await page.getByTestId('home-cta-docs').click()
  await expect(page).toHaveURL(/\/docs/)
  await expect(page.getByTestId('docs-inicio')).toBeVisible()
})

test('AMEAÇA: a landing não promete o que a documentação não sustenta', async ({ page }) => {
  /**
   * Cada diferença anunciada tem uma página que a explica. Uma landing que afirma o que a
   * documentação não sustenta é a que produz o cancelamento no segundo mês — e é o tipo
   * de dívida que ninguém percebe até o cliente cobrar.
   */
  await page.goto('/')
  const texto = (await page.getByTestId('home-diferencas').textContent()) ?? ''
  expect(texto).toContain('não gasta token')

  await page.goto('/docs/decisoes')
  await expect(page.getByTestId('docs-conteudo')).toContainText('não gasta token')
})

test('em 320 px a landing não estoura para os lados', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('home-passos')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('AMEAÇA: a landing e a documentação não baixam o app inteiro', async ({ page }) => {
  /**
   * O que se mede é o PESO, e não o nome dos pedaços: um `import` estático não cria pedaço
   * nenhum — ele costura a página dentro do pacote de entrada, e o nome some junto. Este é
   * o mesmo teto que a tela de login já respeita, estendido às outras duas portas públicas.
   *
   * Uma landing que puxa a Central de Monitoramento junto é uma landing que demora a
   * aparecer para quem chegou por um link no celular.
   */
  for (const rota of ['/', '/docs']) {
    let bytes = 0
    page.removeAllListeners('response')
    page.on('response', async (r) => {
      if (r.request().resourceType() !== 'script') return
      bytes += Number(r.headers()['content-length'] ?? (await r.body().catch(() => Buffer.alloc(0))).length)
    })
    await page.goto(rota)
    await page.waitForLoadState('networkidle')
    expect(bytes / 1024, `${rota} baixou ${(bytes / 1024).toFixed(0)} KB de script`).toBeLessThan(900)
  }
})
