// HTTP 200 não quer dizer que a leitura deu certo.
//
// Uma resposta bem-sucedida pode conter um aviso de cookies, uma tela de login, um
// desafio anti-robô, uma casca vazia que só existe para o JavaScript preencher, ou um
// menu com rodapé e nada mais. Guardar qualquer uma dessas coisas como conhecimento é
// pior que não guardar nada: o agente passa a responder com aviso de cookie.
//
// Este módulo decide se o que veio SERVE, e — quando não serve — diz exatamente por quê.
// "Não foi possível ler" não é diagnóstico: quem configurou o endereço precisa saber se
// o problema é login, robô, JavaScript ou página vazia, porque a ação é diferente em cada
// caso.
//
// Puro: texto entra, veredito sai. Sem rede, sem navegador, sem modelo.

/** O que impediu a leitura. Cada código corresponde a uma ação diferente de quem lê. */
export type ReadErrorCode =
  | 'HTTP_BLOCKED'
  /** O site pediu para diminuir o ritmo. Diferente de bloqueio: é temporário, e tem hora para passar. */
  | 'RATE_LIMITED'
  /** O site não respondeu a tempo. Diferente de recusa: ninguém disse não. */
  | 'TIMEOUT'
  | 'JS_REQUIRED'
  | 'CAPTCHA'
  | 'LOGIN_REQUIRED'
  | 'CONSENT_REQUIRED'
  | 'CONTENT_EMPTY'
  | 'BROWSER_TIMEOUT'
  | 'EXTRACTION_FAILED'

/** Para que serve a página — escolhe a estratégia de extração, não restringe nada. */
export type PageKind = 'article' | 'dynamic_page' | 'structured_data' | 'listing' | 'unknown'

export interface QualityVerdict {
  ok: boolean
  /** Ausente quando `ok`. */
  code?: ReadErrorCode
  /** Uma frase para a tela e para o log. Nunca o corpo da resposta de terceiro. */
  reason: string
  /** Vale a pena tentar de novo com um navegador? */
  retryWithBrowser: boolean
  /** Caracteres de texto ÚTIL (fora menu, rodapé e script). */
  usefulChars: number
}

/** O mínimo para uma página ser conhecimento, e não navegação. */
export const MIN_USEFUL_CHARS = 200

// Sinais de que a página está pedindo alguma coisa antes de mostrar o conteúdo. Todos
// determinísticos e genéricos — nenhum nome de site aqui.
const SINAIS = {
  captcha: /\b(captcha|recaptcha|hcaptcha|are you a human|verifique que você (é|e) humano|cf-challenge|checking your browser|just a moment)\b/i,
  login: /\b(faça login|faca login|entre na sua conta|sign in to continue|log in to continue|please log ?in|acesso restrito|assine para (ler|continuar)|subscribers? only)\b/i,
  consent: /\b(aceitar (todos os )?cookies|gerenciar cookies|consent(imento)?|we use cookies|utilizamos cookies|política de privacidade e cookies)\b/i,
  bloqueio: /\b(access denied|acesso negado|403 forbidden|you (have been|were) blocked|blocked by|request blocked)\b/i,
  ritmo: /\b(rate limit(ed)?|too many requests|slow down|limite de requisi(ç|c)(õ|o)es)\b/i,
  jsOnly: /\b(enable javascript|javascript (is )?(required|disabled)|habilite o javascript|ative o javascript|you need to enable javascript|<noscript>)\b/i,
}

/** Um esqueleto de aplicação: muita marcação, quase nenhum texto — o conteúdo vem por JS. */
function pareceCascaDeApp(html: string, textoUtil: string): boolean {
  if (textoUtil.length >= MIN_USEFUL_CHARS) return false
  // Raiz de framework vazia é o padrão mais comum de página que só existe depois do JS.
  if (/<(div|main)[^>]+id\s*=\s*["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/\1>/i.test(html)) return true
  const scripts = (html.match(/<script\b/gi) ?? []).length
  return scripts >= 3 && textoUtil.length < 120
}

/**
 * O que veio serve como conhecimento?
 *
 * `textoUtil` é o texto já limpo (sem menu, rodapé e script). `html` é o bruto, porque
 * alguns sinais só existem lá — a casca vazia de um app, por exemplo.
 */
export function checkContentQuality(
  html: string,
  textoUtil: string,
  opts: { status?: number; minChars?: number } = {},
): QualityVerdict {
  const minimo = opts.minChars ?? MIN_USEFUL_CHARS
  const util = textoUtil.trim()
  const status = opts.status ?? 200

  if (status === 401 || status === 403) {
    return { ok: false, code: 'HTTP_BLOCKED', reason: `o site respondeu ${status}`, retryWithBrowser: false, usefulChars: util.length }
  }
  // 429 e 503 são "volte depois", não "não pode". A diferença importa: bloqueio é
  // configuração para revisar, ritmo é espera para respeitar — e insistir contra um
  // pedido de calma é como um limite temporário vira um bloqueio permanente.
  if (status === 429 || status === 503) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      reason: status === 429 ? 'o site pediu para diminuir o ritmo (429)' : 'o site está indisponível no momento (503)',
      retryWithBrowser: false,
      usefulChars: util.length,
    }
  }

  // A ordem importa: um desafio anti-robô costuma vir junto de aviso de cookie, e o que
  // decide a ação é o mais restritivo.
  if (SINAIS.captcha.test(html)) {
    return { ok: false, code: 'CAPTCHA', reason: 'a página pede verificação anti-robô', retryWithBrowser: false, usefulChars: util.length }
  }
  if (SINAIS.login.test(html) && util.length < minimo * 3) {
    return { ok: false, code: 'LOGIN_REQUIRED', reason: 'a página pede login ou assinatura', retryWithBrowser: false, usefulChars: util.length }
  }
  if (SINAIS.ritmo.test(html) && util.length < minimo * 3) {
    return { ok: false, code: 'RATE_LIMITED', reason: 'o site pediu para diminuir o ritmo', retryWithBrowser: false, usefulChars: util.length }
  }
  if (SINAIS.bloqueio.test(html) && util.length < minimo * 3) {
    return { ok: false, code: 'HTTP_BLOCKED', reason: 'o site recusou a leitura', retryWithBrowser: false, usefulChars: util.length }
  }
  if (SINAIS.jsOnly.test(html) || pareceCascaDeApp(html, util)) {
    // ESTE é o caso que um navegador resolve: o conteúdo existe, só não veio no HTML.
    return { ok: false, code: 'JS_REQUIRED', reason: 'o conteúdo desta página é montado por JavaScript', retryWithBrowser: true, usefulChars: util.length }
  }
  if (SINAIS.consent.test(html) && util.length < minimo) {
    return { ok: false, code: 'CONSENT_REQUIRED', reason: 'a página mostra o aviso de cookies antes do conteúdo', retryWithBrowser: true, usefulChars: util.length }
  }
  if (util.length < minimo) {
    return {
      ok: false,
      code: 'CONTENT_EMPTY',
      reason: `só ${util.length} caracteres de texto útil`,
      // Vale tentar o navegador: pode ser conteúdo que chega depois.
      retryWithBrowser: true,
      usefulChars: util.length,
    }
  }
  return { ok: true, reason: `${util.length} caracteres de texto útil`, retryWithBrowser: false, usefulChars: util.length }
}

/**
 * Para que serve esta página.
 *
 * Serve para escolher a estratégia de extração — e para o painel dizer o que leu. Não
 * restringe nada: uma página classificada errado continua sendo lida.
 */
export function classifyPage(html: string, textoUtil: string, dados: { tables?: number; jsonLd?: number } = {}): PageKind {
  const links = (html.match(/<a\b/gi) ?? []).length
  if ((dados.jsonLd ?? 0) > 0 && textoUtil.length < 800) return 'structured_data'
  if ((dados.tables ?? 0) > 0 && textoUtil.length < 4000) return 'structured_data'
  if (/<article\b/i.test(html) && textoUtil.length >= MIN_USEFUL_CHARS) return 'article'
  if (links >= 20 && textoUtil.length / Math.max(links, 1) < 40) return 'listing'
  if (pareceCascaDeApp(html, textoUtil)) return 'dynamic_page'
  return textoUtil.length >= MIN_USEFUL_CHARS ? 'article' : 'unknown'
}
