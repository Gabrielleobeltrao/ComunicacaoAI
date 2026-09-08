import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

// AS PÁGINAS PÚBLICAS — e a única coisa que importa nelas antes do conteúdo: existir no
// HTML CRU.
//
// Prévia de link não executa JavaScript. WhatsApp, LinkedIn, Slack e Discord leem o texto
// que o servidor mandou, e o texto que este app mandava era uma `<div>` vazia com um
// `<title>` só para o site inteiro. A landing existia e, colada em qualquer lugar,
// aparecia como URL pelada.
//
// A corrente tem três elos, e cada caso aqui segura um: o BUILD escreve um HTML por rota,
// o NGINX serve esse arquivo (conferido na bateria de unidade, sobre o `nginx.conf`), e o
// APP troca o título ao navegar sem recarregar. Falta um elo, a prévia continua feia.
const lista = JSON.parse(readFileSync(new URL('../src/lib/paginasPublicas.json', import.meta.url), 'utf8')) as {
  site: { nome: string; url: string }
  paginas: { rota: string; titulo: string; descricao: string; prioridade: string }[]
}

const indiceDocs = JSON.parse(readFileSync(new URL('../src/docs/indice.json', import.meta.url), 'utf8')) as {
  secoes: { paginas: { slug: string; titulo: string; resumo: string }[] }[]
}

/**
 * A lista EFETIVA: as páginas fixas mais a documentação.
 *
 * Composta aqui de propósito, e não lida de um arquivo que o build tenha escrito: o teste
 * afirma o contrato — toda página do índice tem o seu HTML — em vez de repetir a conta que
 * o script fez e concordar consigo mesmo.
 */
const docs = indiceDocs.secoes.flatMap((s) => s.paginas.map((p) => ({ rota: `/docs/${p.slug}`, titulo: p.titulo, descricao: p.resumo })))
const efetivas = [...lista.paginas.map((p) => ({ rota: p.rota, titulo: p.titulo, descricao: p.descricao })), { rota: '/docs', titulo: 'Documentação', descricao: '' }, ...docs]

const construido = (rota: string) =>
  readFileSync(new URL(`../dist${rota === '/' ? '' : rota}/index.html`, import.meta.url), 'utf8')

test('ACEITAÇÃO: o build escreve um HTML por rota, com os metadados dela no texto cru', async () => {
  /**
   * Lido do ARQUIVO, e não da resposta do servidor de pré-visualização: o `vite preview`
   * reescreve toda rota para o SPA, enquanto o nginx de produção resolve `$uri/` e serve o
   * arquivo do diretório. Medir contra o servidor errado provaria o contrário do que
   * acontece em produção.
   */
  for (const pagina of efetivas) {
    const html = construido(pagina.rota)
    expect(html, `${pagina.rota} sem o próprio título`).toContain(pagina.titulo)
    if (pagina.descricao) expect(html, `${pagina.rota} sem description`).toContain(`content="${pagina.descricao}"`)
    // Open Graph e Twitter são leitores diferentes do MESMO fato: escrever só um deles é
    // escolher em qual rede o link fica feio.
    expect(html, `${pagina.rota} sem og:title`).toContain('property="og:title"')
    expect(html, `${pagina.rota} sem twitter:card`).toContain('name="twitter:card"')
    expect(html, `${pagina.rota} sem canonical`).toContain('rel="canonical"')
  }
})

test('AMEAÇA: duas rotas públicas não compartilham o mesmo título', async () => {
  /**
   * O defeito que isto pega é o silencioso: o build copia o modelo e esquece de trocar os
   * metadados, e todas as páginas ficam com o título do site. Nada quebra, nada avisa — e
   * o buscador passa a ver três páginas idênticas.
   */
  const titulos = new Set<string>()
  for (const pagina of efetivas) {
    const titulo = /<title>(.*?)<\/title>/s.exec(construido(pagina.rota))?.[1] ?? ''
    expect(titulo, `${pagina.rota} sem título`).not.toBe('')
    expect(titulos.has(titulo), `título repetido em ${pagina.rota}: "${titulo}"`).toBe(false)
    titulos.add(titulo)
  }
})

test('a raiz chega SERVIDA com os metadados, sem executar nada', async ({ request, baseURL }) => {
  // A landing é a que mais importa e é a única que qualquer servidor entrega direto: ela
  // É o `index.html`. Aqui a conferência é sobre a resposta HTTP de verdade.
  const res = await request.get(new URL('/', baseURL).toString())
  expect(res.status()).toBe(200)
  const html = await res.text()
  const raiz = lista.paginas.find((p) => p.rota === '/')!
  expect(html).toContain(`<title>${raiz.titulo}</title>`)
  expect(html).toContain(`content="${raiz.descricao}"`)
  // `lang` errado faz o leitor de tela pronunciar português com fonética inglesa, e o
  // buscador oferecer a página para quem não a lê.
  expect(html).toContain('<html lang="pt-BR">')
})

test('o sitemap lista exatamente as páginas públicas, e o robots aponta para ele', async ({ request, baseURL }) => {
  const sitemap = await (await request.get(new URL('/sitemap.xml', baseURL).toString())).text()
  const listadas = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].replace(lista.site.url, '') || '/')
  // Nem a mais, nem a menos: uma rota a mais convida o buscador a indexar o que exige
  // sessão; uma a menos é uma página que ninguém acha.
  expect(listadas.sort()).toEqual(efetivas.map((p) => p.rota).sort())

  const robots = await (await request.get(new URL('/robots.txt', baseURL).toString())).text()
  expect(robots).toContain(`Sitemap: ${lista.site.url}/sitemap.xml`)
  expect(robots).toContain('Disallow: /floors')
})

test('navegar DENTRO do app troca o título — ele não fica congelado no da primeira rota', async ({ page }) => {
  await page.goto('/')
  const naLanding = await page.title()
  await page.getByRole('button', { name: /criar conta/i }).first().click()
  await expect(page).toHaveURL(/\/register/)
  await expect.poll(() => page.title()).not.toBe(naLanding)
  expect(await page.title()).toContain('Criar conta')
})
