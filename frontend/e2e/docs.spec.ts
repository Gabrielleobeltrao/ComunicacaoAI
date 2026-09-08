import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

// A DOCUMENTAÇÃO na tela.
//
// O que estes casos protegem: toda página do índice abre (um menu que promete o que não
// existe é pior que menu nenhum), a busca alcança o CORPO do texto — que é onde está o
// termo que a pessoa viu num erro —, e um endereço errado é dito, e não desenhado como
// página em branco.
const indice = JSON.parse(readFileSync(new URL('../src/docs/indice.json', import.meta.url), 'utf8')) as {
  secoes: { titulo: string; paginas: { slug: string; titulo: string; resumo: string }[] }[]
}
const paginas = indice.secoes.flatMap((s) => s.paginas)

test('ACEITAÇÃO: toda página do índice abre e mostra o seu conteúdo', async ({ page }) => {
  await page.goto('/docs')
  await expect(page.getByTestId('docs-inicio')).toBeVisible()

  for (const p of paginas) {
    await page.goto(`/docs/${p.slug}`)
    const conteudo = page.getByTestId('docs-conteudo')
    await expect(conteudo, `${p.slug} não renderizou`).toBeVisible()
    // O título da página vem do markdown, e não do índice: se os dois divergirem, quem
    // abriu pelo menu chega numa página que fala de outra coisa.
    await expect(conteudo.locator('h1')).toHaveCount(1)
    await expect(page.getByTestId(`docs-link-${p.slug}`)).toHaveAttribute('aria-current', 'page')
  }
})

test('a busca alcança o CORPO do texto, e não só os títulos', async ({ page }) => {
  await page.goto('/docs')
  /**
   * Quem procura documentação procura pelo termo que viu num erro ou num campo, e esse
   * termo quase nunca é um título. Buscar só em títulos devolve vazio para exatamente a
   * consulta que trouxe a pessoa até aqui.
   */
  await page.getByTestId('docs-busca').fill('truncated')
  await expect(page.getByTestId('docs-resultado-api')).toBeVisible()
  // E o resultado mostra o termo NO contexto: sem contexto, é preciso abrir a página para
  // descobrir se era aquilo mesmo.
  await expect(page.getByTestId('docs-resultados')).toContainText('truncated')

  await page.getByTestId('docs-busca').fill('zzzznadaaqui')
  await expect(page.getByTestId('docs-sem-resultado')).toBeVisible()
})

test('AMEAÇA: um endereço que não existe é DITO, e não desenhado como página vazia', async ({ page }) => {
  await page.goto('/docs/pagina-que-nao-existe')
  await expect(page.getByTestId('docs-nao-encontrada')).toBeVisible()
  await expect(page.getByTestId('docs-conteudo')).toHaveCount(0)
})

test('os títulos viram âncora — dá para mandar o link de um trecho', async ({ page }) => {
  await page.goto('/docs/api')
  // Esperar o conteúdo: a documentação carrega sob demanda, e ler o DOM antes de o pedaço
  // chegar mede uma página que ainda não existe.
  await expect(page.getByTestId('docs-conteudo')).toBeVisible()
  // Sem âncora não existe link para um trecho, e documentação sem isso se cita por
  // captura de tela.
  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-testid="docs-conteudo"] h2')].map((h) => h.id))
  expect(ids.length).toBeGreaterThan(1)
  expect(ids.every((id) => id && /^[a-z0-9-]+$/.test(id)), `âncoras estranhas: ${ids.join(', ')}`).toBe(true)
})

test('a documentação leva de volta ao produto, e o produto à documentação', async ({ page }) => {
  await page.goto('/docs/conceitos')
  await expect(page.getByTestId('publico-criar-conta')).toBeVisible()
  await page.goto('/')
  await page.getByTestId('publico-nav-docs').click()
  await expect(page).toHaveURL(/\/docs/)
})

test('no desktop o menu fica AO LADO do texto, e não empilhado sobre ele', async ({ page }) => {
  // O defeito que isto pega é o clássico do CSS embutido: um `gridTemplateColumns` em
  // linha vence a classe responsiva, e a coluna do menu nunca acontece — a página fica
  // com um índice comprido empurrando o conteúdo para baixo da dobra, em toda largura.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/docs/api')
  await expect(page.getByTestId('docs-conteudo')).toBeVisible()
  const lado = await page.evaluate(() => {
    const menu = document.querySelector('[data-testid="docs-indice"]')!.getBoundingClientRect()
    const texto = document.querySelector('[data-testid="docs-conteudo"]')!.getBoundingClientRect()
    return menu.right <= texto.left + 1
  })
  expect(lado).toBe(true)
})

test('em 320 px a documentação não estoura para os lados', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/docs/api')
  await expect(page.getByTestId('docs-conteudo')).toBeVisible()
  // A referência tem blocos de código com linhas longas: eles rolam DENTRO do próprio
  // bloco, e não empurram a página.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
