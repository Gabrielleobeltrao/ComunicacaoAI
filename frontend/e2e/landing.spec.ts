import { expect, test } from '@playwright/test'
import { statSync } from 'node:fs'

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

test('ACEITAÇÃO: a landing mostra TELAS do produto, e elas carregam', async ({ page }) => {
  /**
   * Ícone e caixa de exemplo não provam nada: quem chega querendo saber como a coisa se
   * parece continua sem saber. As imagens saem do produto por `npm run capturas`.
   */
  await page.goto('/')
  const capturas = page.getByTestId('home-capturas')
  await expect(capturas).toBeVisible()
  const imagens = capturas.locator('img')
  await expect(imagens).toHaveCount(3)

  for (let i = 0; i < 3; i++) {
    const img = imagens.nth(i)
    // Alt de verdade: uma captura sem descrição é uma parte da página que não existe para
    // quem usa leitor de tela.
    const alt = await img.getAttribute('alt')
    expect((alt ?? '').length, `captura ${i} sem alt`).toBeGreaterThan(30)
    // Abaixo da dobra, carregada com preguiça: baixá-las no primeiro quadro atrasaria o
    // que a pessoa veio ver.
    expect(await img.getAttribute('loading')).toBe('lazy')
    // E ela CHEGOU: um `src` errado deixa a página com um retângulo vazio, e nada avisa.
    await img.scrollIntoViewIfNeeded()
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth), { timeout: 8000 }).toBeGreaterThan(100)
  }
})

test('AMEAÇA: uma captura em branco não passa por captura', async () => {
  /**
   * O jeito silencioso de isto quebrar é a captura sair de uma tela que não carregou: o
   * arquivo existe, a página mostra um retângulo quase vazio, e nenhum teste reclama. Uma
   * imagem em branco comprime para pouquíssimos bytes — é por aí que dá para pegá-la sem
   * comparar pixel.
   */
  for (const arquivo of ['escritorio', 'conhecimento', 'atividade']) {
    const tamanho = statSync(new URL(`../public/capturas/${arquivo}.png`, import.meta.url)).size
    expect(tamanho, `${arquivo}.png tem ${tamanho} bytes — parece uma tela vazia`).toBeGreaterThan(12_000)
  }
})

test('os três mecanismos aparecem, e a landing manda para onde eles são explicados', async ({ page }) => {
  await page.goto('/')
  const mecanismos = page.getByTestId('home-mecanismos')
  await expect(mecanismos).toContainText('Conhecimento')
  await expect(mecanismos).toContainText('Memória')
  await expect(mecanismos).toContainText('Database')

  await page.getByRole('link', { name: 'Conceitos' }).click()
  await expect(page).toHaveURL(/\/docs\/conceitos/)
  await expect(page.getByTestId('docs-conteudo')).toContainText('o que a empresa')
})
