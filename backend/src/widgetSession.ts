import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

// A SESSÃO do visitante do widget.
//
// Antes, entrar numa conversa era dizer o `conversationId` — e o `conversationId` era
// inventado pelo navegador. Quem descobrisse (ou adivinhasse) o de outra pessoa entrava
// na sala dela e lia tudo o que passasse dali em diante, inclusive de outro widget e de
// outra conta.
//
// Agora o servidor assina uma sessão que amarra TRÊS coisas: qual widget, qual conversa
// e até quando. O que a assinatura protege não é o segredo do id — é o vínculo: um
// token de um widget não abre a sala de outro, e um token velho não abre nada.
//
// O token nunca aparece em log, erro ou resposta que não seja a de quem acabou de
// recebê-lo.

/** Doze horas: uma sessão de atendimento cabe; um token esquecido num histórico, não. */
const VALIDADE_MS = 12 * 60 * 60 * 1000
/** Depois da metade, o uso renova. É a rotação: o token velho vai saindo de circulação. */
const RENOVAR_APOS_MS = VALIDADE_MS / 2

const VERSAO = 'v1'

/**
 * A chave de assinatura.
 *
 * Derivada do segredo da aplicação com um rótulo próprio: assinar sessão de visitante
 * com a MESMA chave que faz outra coisa acopla dois sistemas que deveriam poder ser
 * rodados separadamente. Em produção `validateConfig()` já exige o segredo; fora dela,
 * uma chave por processo mantém o desenvolvimento funcionando sem inventar um segredo
 * fixo que alguém copiaria para um servidor de verdade.
 */
const chaveDeDesenvolvimento = randomUUID()
const chave = (): Buffer => {
  const base = process.env.BETTER_AUTH_SECRET?.trim() || process.env.ENCRYPTION_KEY?.trim() || chaveDeDesenvolvimento
  return createHmac('sha256', base).update('comunicacaoai:widget-visitor-session').digest()
}

const b64url = (b: Buffer): string => b.toString('base64url')

export interface VisitorSession {
  widgetId: string
  conversationId: string
  /** Quando expira, em milissegundos desde a época. */
  exp: number
}

export interface IssuedSession {
  token: string
  conversationId: string
  expiresAt: string
}

/** Um id de conversa que o servidor gerou — não mais um que o cliente inventou. */
export const newConversationId = (): string => randomUUID()

/**
 * Um `conversationId` de cliente antigo, aceito na troca de sessão.
 *
 * A troca existe para não derrubar quem já estava conversando quando isto subiu: o
 * navegador apresenta o id que guardou e recebe um token para ele. Não é uma prova de
 * posse — o id continua sendo o que sempre foi. O que muda, e é o ponto, é que a partir
 * dali o acesso é o token: preso ao widget, com prazo, e recusado em qualquer outra sala.
 */
export const idDeConversaAceitavel = (bruto: unknown): string | null => {
  const v = String(bruto ?? '').trim()
  return v.length >= 8 && v.length <= 100 && /^[A-Za-z0-9._:-]+$/.test(v) ? v : null
}

export function issueVisitorToken(widgetId: string, conversationId: string, agora: Date = new Date()): IssuedSession {
  const exp = agora.getTime() + VALIDADE_MS
  const corpo: VisitorSession = { widgetId, conversationId, exp }
  const carga = b64url(Buffer.from(JSON.stringify(corpo), 'utf8'))
  const assinatura = b64url(createHmac('sha256', chave()).update(`${VERSAO}.${carga}`).digest())
  return { token: `${VERSAO}.${carga}.${assinatura}`, conversationId, expiresAt: new Date(exp).toISOString() }
}

export interface VerifiedSession {
  conversationId: string
  /** Passou da metade da validade: quem usou merece um token novo antes de expirar. */
  renovar: boolean
}

/**
 * O token vale para ESTE widget?
 *
 * O widget entra na conferência de propósito. Sem ele, um token legítimo de um widget
 * abriria a sala de outro — a assinatura estaria certa e o vínculo, errado.
 */
export function verifyVisitorToken(token: unknown, widgetId: string, agora: Date = new Date()): VerifiedSession | null {
  const bruto = String(token ?? '').trim()
  if (!bruto) return null
  const partes = bruto.split('.')
  if (partes.length !== 3 || partes[0] !== VERSAO) return null
  const [versao, carga, assinatura] = partes

  const esperada = b64url(createHmac('sha256', chave()).update(`${versao}.${carga}`).digest())
  const a = Buffer.from(esperada)
  const b = Buffer.from(assinatura)
  if (a.length !== b.length) return null
  try {
    if (!timingSafeEqual(a, b)) return null
  } catch {
    return null
  }

  let corpo: VisitorSession
  try {
    corpo = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')) as VisitorSession
  } catch {
    return null
  }
  if (!corpo || typeof corpo.conversationId !== 'string' || typeof corpo.widgetId !== 'string') return null
  if (corpo.widgetId !== widgetId) return null
  if (!(typeof corpo.exp === 'number' && corpo.exp > agora.getTime())) return null

  return { conversationId: corpo.conversationId, renovar: corpo.exp - agora.getTime() < RENOVAR_APOS_MS }
}

/**
 * O nome da sala — com o widget dentro.
 *
 * Duas contas diferentes podiam ter o mesmo `conversationId` (o cliente escolhia), e a
 * sala era a mesma para as duas. Com o widget no nome isso deixa de ser possível.
 */
export const conversationRoom = (widgetId: string, conversationId: string): string => `conversation:${widgetId}:${conversationId}`

/** O token pode vir no cabeçalho (preferido) ou na query, para o `EventSource` do widget. */
export function tokenFromRequest(req: { headers: Record<string, unknown>; query?: Record<string, unknown> }): string | null {
  const cabecalho = req.headers?.authorization
  if (typeof cabecalho === 'string' && /^bearer /i.test(cabecalho)) return cabecalho.slice(7).trim()
  const daQuery = req.query?.token
  return typeof daQuery === 'string' && daQuery.trim() ? daQuery.trim() : null
}
