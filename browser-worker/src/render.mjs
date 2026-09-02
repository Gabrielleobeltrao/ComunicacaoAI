import { checkTarget, BlockedTarget } from './guard.mjs'
import { fetchOnce, TIPOS_DE_RENDER } from './fetchPage.mjs'

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
//
// CONFERIR NÃO BASTA, e é aqui que estava o buraco. A versão anterior validava a URL e
// depois chamava `continue()`: o Chromium ia à rede sozinho e resolvia o nome DE NOVO. Um
// nome que responde um endereço público na conferência e um privado meio segundo depois —
// DNS rebinding, o ataque com nome — passava inteiro, porque quem conectou nunca viu o
// endereço que foi aprovado.
//
// Agora nenhuma requisição do navegador chega à rede. Cada uma é BUSCADA aqui, pelo mesmo
// caminho da busca simples, que abre o socket no endereço conferido e manda o `Host`
// original; a resposta é devolvida ao navegador já pronta. E como cinto extra, o Chromium
// sobe com o resolvedor apontando para lugar nenhum: se alguma requisição escapar da
// interceptação, ela não resolve nada em vez de resolver o que a página quiser.

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
  /** O retrato tem teto próprio: ele viaja na resposta e depois para dentro de um modelo. */
  maxScreenshotBytes: 2 * 1024 * 1024,
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
    args: [
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-background-networking',
      // O cinto: o que não passar pela interceptação não resolve nome nenhum.
      '--host-resolver-rules=MAP * ~NOTFOUND',
    ],
  })

  const bloqueadas = []
  const permitidas = []
  let bytes = 0
  /**
   * As vagas JÁ TOMADAS — contadas antes de a busca começar, não depois.
   *
   * O manipulador de rota espera a rede, e o navegador dispara as requisições de uma
   * página em paralelo: contando só o que já terminou, trinta pedidos concorrentes passam
   * todos pela mesma conferência de teto e o limite não limita nada.
   */
  let atendidas = 0

  try {
    const contexto = await navegador.newContext({
      // Download não acontece: um worker que baixa arquivo vira um jeito de fazer a
      // plataforma buscar binário e guardá-lo.
      acceptDownloads: false,
      javaScriptEnabled: true,
      // Service worker é uma rota de rede que a interceptação de página não cobre.
      serviceWorkers: 'block',
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

      if (atendidas >= limites.maxSubrequests) {
        bloqueadas.push({ url, reason: 'limite de subrequisições' })
        return rota.abort('blockedbyclient')
      }
      atendidas += 1
      if (bytes >= limites.maxTotalBytes) {
        bloqueadas.push({ url, reason: 'orçamento de bytes esgotado' })
        return rota.abort('blockedbyclient')
      }

      // Só leitura. Um POST partindo de dentro de uma página de terceiro não é coleta:
      // é a plataforma emprestando a própria rede para o que aquela página quiser fazer.
      if (pedido.method() !== 'GET') {
        bloqueadas.push({ url, reason: `método ${pedido.method()} não é permitido aqui` })
        return rota.abort('blockedbyclient')
      }

      try {
        /**
         * A requisição é FEITA AQUI, no endereço conferido — e não devolvida ao navegador.
         *
         * `continue()` mandaria o Chromium resolver o nome de novo e conectar por conta
         * própria: a conferência viraria opinião, e o rebinding passaria por baixo dela.
         * `fetchOnce` abre o socket no endereço que passou, revalida cada redirect e manda
         * o `Host` original — a mesma garantia da busca simples, agora também na página.
         */
        const r = await fetchOnce(url, {
          resolver: opcoes.resolver,
          limits: { ...limites, accept: TIPOS_DE_RENDER, binary: true, maxBytes: Math.max(1024, limites.maxTotalBytes - bytes) },
        })
        bytes += r.bytes
        permitidas.push(url)
        return rota.fulfill({
          status: r.status,
          headers: { 'content-type': r.contentType || 'application/octet-stream' },
          body: r.buffer ?? Buffer.from(r.body ?? '', 'utf8'),
        })
      } catch (erro) {
        bloqueadas.push({ url, reason: String(erro.message ?? erro).slice(0, 120) })
        return rota.abort('blockedbyclient')
      }
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

    /**
     * O RETRATO — só quando pedido, e cortado no elemento quando há seletor.
     *
     * A imagem é o último recurso, e ela custa: bytes na resposta, tokens no modelo que
     * vai lê-la e um caminho onde o dado deixa de ser lido e passa a ser adivinhado. Tirar
     * sempre seria pagar isso em toda coleta.
     *
     * Quando existe seletor, o corte é nele: mandar a página inteira para um modelo de
     * visão é dar a ele mais chance de ler o número errado, além de custar mais.
     */
    let screenshot = null
    if (opcoes.screenshot) {
      const alvo = opcoes.selector ? await pagina.$(opcoes.selector).catch(() => null) : null
      const buffer = await (alvo ?? pagina).screenshot({ type: 'png', ...(alvo ? {} : { fullPage: false }) }).catch(() => null)
      if (buffer && buffer.length <= (limites.maxScreenshotBytes ?? 2 * 1024 * 1024)) {
        screenshot = { base64: buffer.toString('base64'), bytes: buffer.length, croppedTo: opcoes.selector && alvo ? opcoes.selector : null }
      }
    }

    return {
      ...(screenshot ? { screenshot } : {}),
      status: resposta?.status() ?? 0,
      contentType: String(resposta?.headers()['content-type'] ?? 'text/html'),
      body: html,
      // O endereço final vem da CADEIA conferida, não do que o navegador acha: quem
      // seguiu os redirects (e revalidou cada um) foi a busca daqui.
      finalUrl: principal.url.toString(),
      rendered: true,
      subrequests: permitidas.map((url) => ({ url, status: 0, bytes: 0 })),
      blocked: bloqueadas,
      bytes,
    }
  } finally {
    // O navegador SEMPRE fecha. Um Chromium esquecido por execução consome a máquina em
    // minutos, e o processo que o esqueceu não é quem paga a conta.
    await navegador.close().catch(() => undefined)
  }
}
