// O navegador — quando existe um nesta instalação.
//
// Ele NÃO é dependência do backend. Um Chromium dentro do contêiner do servidor custa
// centenas de megabytes, bibliotecas de sistema e uma superfície nova: um processo que
// executa JavaScript de terceiros ao lado da API. Isso é decisão de quem opera, não efeito
// colateral de uma funcionalidade — então aqui ele é carregado por importação preguiçosa e
// só quando ligado explicitamente.
//
// Sem `WEB_BROWSER_RENDERER=1` (ou sem o pacote instalado), quem pede uma página que exige
// JavaScript recebe `JS_REQUIRED` com a explicação — que é honesto — em vez de um texto
// vazio guardado como se fosse conhecimento.
//
// O que este módulo faz de verdade: abre a página, espera o CONTEÚDO aparecer (e não só a
// rede sossegar, que é o erro clássico em página que atualiza sozinha), devolve o HTML
// renderizado e fecha tudo o que abriu.
import { assertPublicUrl } from './net/safeHttp.js'
import type { BrowserRenderer, ReaderPage } from './adaptiveWebReader.js'
import { MIN_USEFUL_CHARS } from './contentQuality.js'

/** Quantas páginas ao mesmo tempo. Um navegador é caro; a fila é curta de propósito. */
const CONCORRENCIA = 2
/** Um navegador só, reaproveitado. Abrir um por página seria o dobro do custo. */
let navegador: unknown = null
let emUso = 0
const fila: (() => void)[] = []

const esperarVaga = async (): Promise<void> => {
  if (emUso < CONCORRENCIA) {
    emUso += 1
    return
  }
  await new Promise<void>((r) => fila.push(r))
  emUso += 1
}
const liberarVaga = (): void => {
  emUso -= 1
  fila.shift()?.()
}

export const browserRendererEnabled = (): boolean => process.env.WEB_BROWSER_RENDERER === '1'

async function abrirNavegador(): Promise<{ newContext: (o: unknown) => Promise<unknown> } | null> {
  if (navegador) return navegador as { newContext: (o: unknown) => Promise<unknown> }
  try {
    // Importação preguiçosa e por nome montado: sem isto, um `import` estático faria o
    // build exigir um pacote que a maioria das instalações não tem.
    const mod = (await import(/* @vite-ignore */ 'playwright')) as {
      chromium: { launch: (o: unknown) => Promise<unknown> }
    }
    navegador = await mod.chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    return navegador as { newContext: (o: unknown) => Promise<unknown> }
  } catch (erro) {
    console.warn('[browser] renderizador pedido, mas o navegador não está disponível:', (erro as Error).message)
    return null
  }
}

/**
 * Lê uma página com JavaScript executado.
 *
 * A espera é pelo CONTEÚDO: `networkidle` sozinho engana em página que atualiza sozinha —
 * a rede nunca sossega, e o teto de tempo estoura com a página pronta há muito.
 */
export const renderWithBrowser: BrowserRenderer = async (url, opts) => {
  // A MESMA proteção do resto do sistema: endereço privado é recusado aqui também, antes
  // de o navegador sair do lugar.
  const validada = await assertPublicUrl(url)
  const chrome = await abrirNavegador()
  if (!chrome) throw new Error('navegador indisponível')

  await esperarVaga()
  let contexto: { newPage: () => Promise<unknown>; close: () => Promise<void> } | null = null
  try {
    contexto = (await chrome.newContext({
      javaScriptEnabled: true,
      // Sem credencial de ninguém: cada leitura começa do zero, e nada de login é herdado.
      storageState: undefined,
      userAgent: 'Mozilla/5.0 (compatible; ComunicacaoAI/1.0; +leitura de conteúdo público)',
    })) as { newPage: () => Promise<unknown>; close: () => Promise<void> }

    const pagina = (await contexto.newPage()) as {
      route: (p: string, h: (r: { request: () => { resourceType: () => string }; abort: () => Promise<void>; continue: () => Promise<void> }) => void) => Promise<void>
      goto: (u: string, o: unknown) => Promise<{ status: () => number } | null>
      waitForFunction: (f: string, a: unknown, o: unknown) => Promise<unknown>
      content: () => Promise<string>
      url: () => string
    }

    // Vídeo, áudio e fonte não viram conhecimento — e são o que mais pesa. Imagem e script
    // continuam passando: sem eles, a página não termina de se montar.
    await pagina.route('**/*', (rota) => {
      const tipo = rota.request().resourceType()
      void (tipo === 'media' || tipo === 'font' ? rota.abort() : rota.continue())
    })

    const resposta = await pagina.goto(validada.toString(), { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs })
    // A espera que importa: texto suficiente no corpo. Com teto, e sem derrubar a leitura
    // se ele estourar — o que estiver pronto já vale.
    await pagina
      .waitForFunction(
        `document.body && document.body.innerText.replace(/\\\\s+/g, ' ').trim().length >= ${MIN_USEFUL_CHARS}`,
        null,
        { timeout: Math.max(1000, Math.floor(opts.timeoutMs / 2)) },
      )
      .catch(() => undefined)

    const html = await pagina.content()
    const saida: ReaderPage = {
      html,
      contentType: 'text/html',
      finalUrl: pagina.url() || validada.toString(),
      status: resposta?.status() ?? 200,
    }
    return saida
  } finally {
    // Fechar o CONTEXTO fecha as páginas dele. O navegador fica de pé, para a próxima.
    await contexto?.close().catch(() => undefined)
    liberarVaga()
  }
}

/** O renderizador desta instalação — ou nada, e aí a leitura diz `JS_REQUIRED`. */
export const rendererAtivo = (): BrowserRenderer | null => (browserRendererEnabled() ? renderWithBrowser : null)

/** Encerra o navegador (usado no desligamento e nos testes). */
export async function closeBrowser(): Promise<void> {
  const atual = navegador as { close?: () => Promise<void> } | null
  navegador = null
  await atual?.close?.().catch(() => undefined)
}
