import type { NextFunction, Request, Response } from 'express'
import { config } from '../config.js'
import { recordAudit } from '../audit.js'
import { LIMITES, anonymizeIp, clientIpOf, consumeRate } from '../abuseGuards.js'

// As duas defesas que moram na borda: quem pode PEDIR uma mudança, e o que o navegador
// pode fazer com a resposta.

/**
 * Rotas que não podem exigir origem — e por que cada uma.
 *
 * A lista é curta de propósito: tudo o que não estiver aqui precisa vir de uma origem
 * conhecida. Uma isenção larga (`/api/`) devolveria o buraco inteiro.
 */
const SEM_ORIGEM = [
  // O Better Auth tem a própria conferência de origem confiável.
  '/api/auth/',
  // Webhooks de provedor: chamados servidor-a-servidor, sem navegador e sem cookie. Eles
  // são autenticados por ASSINATURA, que é uma prova mais forte que a origem.
  '/api/whatsapp/',
  '/api/hooks/',
  // O widget público roda no site do cliente, em domínio que não conhecemos, e não usa
  // cookie nenhum: a autorização dele é o token de visitante.
  '/api/public/',
]

const MUTACOES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** A origem de quem pediu — do `Origin`, ou do `Referer` quando o navegador só manda ele. */
export function origemDoPedido(req: Pick<Request, 'headers'>): string | null {
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin && origin !== 'null') return origin.replace(/\/+$/, '')
  const referer = req.headers.referer
  if (typeof referer === 'string' && referer) {
    try {
      return new URL(referer).origin
    } catch {
      return null
    }
  }
  return null
}

/**
 * CSRF por origem.
 *
 * O cookie de sessão é `SameSite=None` — ele precisa ser, porque a tela e a API são
 * origens diferentes em produção. Isso significa que o navegador ENVIA o cookie numa
 * requisição disparada por qualquer site: sem esta conferência, uma página maliciosa
 * aberta na mesma aba consegue apagar um agente em nome de quem está logado.
 *
 * A regra é a mais simples que funciona: mutação com cookie precisa declarar uma origem
 * conhecida. Requisição sem origem nenhuma também é recusada — `fetch` de navegador
 * sempre manda `Origin` numa mutação cross-site, então "sem origem" aqui é ou um
 * cliente que não é navegador (e esse deveria usar as rotas de webhook) ou uma tentativa
 * de contornar a conferência.
 */
export function requireKnownOrigin(req: Request, res: Response, next: NextFunction): void {
  if (!MUTACOES.has(req.method)) return next()
  if (SEM_ORIGEM.some((p) => req.path.startsWith(p))) return next()

  /**
   * Só quem chega com o COOKIE precisa provar a origem.
   *
   * CSRF é ataque de credencial ambiente: o navegador anexa o cookie sozinho numa
   * requisição que outro site disparou. Sem cookie não há nada para cavalgar — a
   * requisição é anônima e morre no `requireAuth` logo adiante. Amarrar a regra ao
   * cookie é o que a torna exata: pega todo pedido de navegador em nome de alguém, e
   * não recusa um cliente legítimo que se autentica de outro jeito.
   */
  const cookies = String(req.headers.cookie ?? '')
  if (!cookies.includes('comunicacaoai')) return next()

  const origem = origemDoPedido(req)
  if (origem && config.clientOrigins.includes(origem)) return next()

  // A recusa não diz quais origens são aceitas: isso é mapa para quem está tentando.
  res.status(403).json({ error: 'Origem não permitida para esta operação.', code: 'origin_not_allowed' })
}

/**
 * Os cabeçalhos que o navegador obedece.
 *
 * `frame-ancestors 'none'` para tudo, MENOS o widget: ele existe para ser embutido no
 * site do cliente, e é a única superfície onde isso é intencional. O resto da aplicação
 * dentro de um iframe é clickjacking esperando acontecer.
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  const ehWidget = req.path.startsWith('/widget') || req.path.startsWith('/api/public/')

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "frame-ancestors " + (ehWidget ? '*' : "'none'"),
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; '),
  )
  if (!ehWidget) res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // Sem `Referer` para fora: a URL de uma rota nossa pode conter identificadores.
  res.setHeader('Referrer-Policy', 'no-referrer')
  // A API não usa nenhuma dessas capacidades; declarar isso fecha a porta por padrão.
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()')
  // Só sob HTTPS: mandar HSTS em http local trancaria o desenvolvimento no navegador.
  if (config.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
}


/**
 * A porta de entrada da conta: ritmo e registro.
 *
 * Duas coisas que faltavam. Ritmo, porque sem ele a rota de login é um oráculo de
 * senha em velocidade de máquina. Registro, porque uma sequência de recusas é a única
 * pista que existe de que alguém está tentando — e ela não aparecia em lugar nenhum.
 *
 * O que NÃO é registrado: e-mail, senha, corpo e cabeçalho. O evento diz que houve uma
 * tentativa recusada e de qual IP anonimizado, e nada mais.
 */
export function guardAuthAttempts(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'POST' || !/^\/api\/auth\/sign-in/.test(req.path)) return next()

  const ip = anonymizeIp(clientIpOf(req))
  void consumeRate(`login:${ip}`, LIMITES.tentativasDeLoginPorIp.limite, LIMITES.tentativasDeLoginPorIp.janelaMs).then((cota) => {
    if (!cota.allowed) {
      // A recusa é igual à de credencial errada em tudo, menos no status: dizer
      // "você está sendo limitado" já é contar que a conta existe.
      res.set('Retry-After', String(cota.retryAfterSeconds)).status(429).json({ error: 'Muitas tentativas. Tente novamente em instantes.' })
      return
    }
    res.on('finish', () => {
      if (res.statusCode < 400) return
      void recordAudit({
        ownerId: 'anonymous',
        actorType: 'system',
        action: 'login_failed',
        entityType: 'session',
        result: 'failure',
        requestId: String(res.getHeader('x-request-id') ?? ''),
        metadata: { ip, status: res.statusCode },
      })
    })
    next()
  })
}
