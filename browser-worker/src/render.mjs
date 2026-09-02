import { checkTarget, BlockedTarget } from './guard.mjs'

// RENDERIZAR de verdade — e cada requisição que a página faz passa pelo mesmo guarda.
//
// É aqui que o descuido clássico mora. Validar a URL que a pessoa digitou e depois deixar
// o navegador buscar tudo o que a página pedir é entregar a decisão para a página: um
// `fetch('http://169.254.169.254/…')` dentro do JavaScript dela sai pela rede do worker, e
// a validação da URL inicial não impediu nada.
//
// Por isso TODA requisição é interceptada e conferida — a principal, os redirects, os
// scripts, as imagens e o que o JavaScript inventar em tempo de execução. O que não passa
// é abortado e reportado; a página continua, porque derrubar tudo esconderia o conteúdo
// legítimo e a informação de que alguém tentou.

/**
 * O motor, quando ele existe.
 *
 * Carregado por import dinâmico de propósito: sem ele o worker continua servindo `fetch` e
 * respondendo `render: false`, em vez de não subir. Um worker que morre porque falta um
 * navegador é um worker que derruba também a coleta que não precisava dele.
 */
export async function loadEngine() {
  try {
    const { chromium } = await import('playwright')
    return chromium
  } catch {
    return null
  }
}

export const RENDER_LIMITES = {
  timeoutMs: 20_000,
  maxSubrequests: 40,
  maxTotalBytes: 8 * 1024 * 1024,
  /** Depois disso, o que a página ainda estiver buscando não interessa mais. */
  quietMs: 1_500,
}

export async function renderPage(rawUrl, opcoes = {}) {
  const limites = { ...RENDER_LIMITES, ...opcoes.limits }
  // `engine: null` explícito é diferente de não passar nada: o primeiro diz "não há
  // motor", e o `??` transformaria isso em "carregue o de verdade" — o que faria o teste
  // do caminho sem motor medir o caminho com motor.
  const chromium = 'engine' in opcoes ? opcoes.engine : await loadEngine()
  if (!chromium) throw new BlockedTarget('não há motor de renderização neste worker')

  // A principal é conferida ANTES de o navegador existir: não vale a pena subir um
  // Chromium para descobrir que o destino é a rede interna.
  const principal = await checkTarget(rawUrl, opcoes.resolver)

  const navegador = await chromium.launch({
    headless: true,
    // O sandbox do próprio Chromium fica LIGADO. Desligá-lo com `--no-sandbox` é o que
    // transforma uma página hostil em código rodando com o usuário do worker.
    args: ['--disable-dev-shm-usage', '--disable-extensions', '--disable-background-networking'],
  })

  const bloqueadas = []
  const permitidas = []
  let bytes = 0

  try {
    const contexto = await navegador.newContext({
      // Download não acontece: um worker que baixa arquivo vira um jeito de fazer a
      // plataforma buscar binário e guardá-lo.
      acceptDownloads: false,
      javaScriptEnabled: true,
      bypassCSP: false,
      // Sem credencial e sem sessão: nada de reusar login de ninguém.
      storageState: undefined,
      userAgent: 'ComunicacaoAI-Monitor/1.0',
    })
    contexto.setDefaultTimeout(limites.timeoutMs)

    const pagina = await contexto.newPage()

    // A interceptação de TUDO — inclusive o que o JavaScript pedir depois. O padrão de
    // rota cobre a navegação, os ativos e cada requisição feita em tempo de execução. Sem
    // isto, é a página que decide para onde o worker faz requisição.
    await pagina.route('**/*', async (rota) => {
      const pedido = rota.request()
      const url = pedido.url()

      if (permitidas.length + bloqueadas.length >= limites.maxSubrequests) {
        bloqueadas.push({ url, reason: 'limite de subrequisições' })
        return rota.abort('blockedbyclient')
      }
      if (bytes >= limites.maxTotalBytes) {
        bloqueadas.push({ url, reason: 'orçamento de bytes esgotado' })
        return rota.abort('blockedbyclient')
      }

      try {
        // O MESMO guarda da busca simples. Um segundo conjunto de regras aqui seria uma
        // segunda opinião sobre o que é seguro alcançar.
        await checkTarget(url, opcoes.resolver)
      } catch (erro) {
        bloqueadas.push({ url, reason: String(erro.message ?? erro).slice(0, 120) })
        return rota.abort('blockedbyclient')
      }

      permitidas.push(url)
      return rota.continue()
    })

    pagina.on('response', (r) => {
      const tamanho = Number(r.headers()['content-length'] ?? 0)
      bytes += Number.isFinite(tamanho) ? tamanho : 0
    })
    // Se um download for iniciado mesmo assim, ele é cancelado — e fica registrado.
    pagina.on('download', (d) => {
      bloqueadas.push({ url: d.url(), reason: 'download não é permitido' })
      void d.cancel().catch(() => undefined)
    })

    const resposta = await pagina.goto(principal.url.toString(), { waitUntil: 'domcontentloaded', timeout: limites.timeoutMs })
    // Um instante de silêncio depois do DOM pronto: é o que separa "carregou" de
    // "terminou de buscar o que precisava". Esperar `networkidle` inteiro prenderia o
    // worker em páginas que fazem polling.
    await pagina.waitForTimeout(limites.quietMs)

    const html = await pagina.content()
    return {
      status: resposta?.status() ?? 0,
      contentType: String(resposta?.headers()['content-type'] ?? 'text/html'),
      body: html,
      finalUrl: pagina.url(),
      rendered: true,
      subrequests: permitidas.slice(0, limites.maxSubrequests).map((url) => ({ url, status: 0, bytes: 0 })),
      blocked: bloqueadas,
      bytes,
    }
  } finally {
    // O navegador SEMPRE fecha. Um Chromium esquecido por execução consome a máquina em
    // minutos, e o processo que o esqueceu não é quem paga a conta.
    await navegador.close().catch(() => undefined)
  }
}
