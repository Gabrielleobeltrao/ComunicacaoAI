import { betterAuth } from 'better-auth'
import { mongodbAdapter } from 'better-auth/adapters/mongodb'
import { db, mongoClient } from './db.js'
import { config } from './config.js'

/**
 * Verificacao de e-mail: pronta, e desligada por padrao.
 *
 * Liga-la de repente trancaria fora toda conta ja criada - e o envio depende de um SMTP
 * que nem toda instalacao tem. Por isso a decisao e do operador, numa variavel, e nao
 * uma mudanca de codigo: `REQUIRE_EMAIL_VERIFICATION=1` passa a exigir o e-mail
 * confirmado no login.
 */
const exigirEmailVerificado = process.env.REQUIRE_EMAIL_VERIFICATION === '1'

export const auth = betterAuth({
  // Explicit public origin of the auth service (derived from BETTER_AUTH_URL).
  baseURL: config.betterAuthUrl,
  database: mongodbAdapter(db, { client: mongoClient }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: exigirEmailVerificado,
  },
  /**
   * A sessao tem prazo - e ela encurta quando fica parada.
   *
   * Sem `expiresIn`, um cookie roubado vale para sempre. `updateAge` renova a sessao de
   * quem esta usando, entao quem trabalha todo dia nao e deslogado; quem sumiu por uma
   * semana precisa entrar de novo.
   *
   * A revogacao ja existe no Better Auth (`/api/auth/list-sessions` e
   * `/api/auth/revoke-session`): com prazo e revogacao, "sair de todos os dispositivos"
   * deixa de ser uma promessa que ninguem pode cumprir.
   */
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  /**
   * MFA fica PREPARADO, nao ligado.
   *
   * O plugin `twoFactor` do Better Auth acrescenta colecoes e um passo no login; liga-lo
   * junto com este endurecimento misturaria mudanca de esquema com correcao de
   * seguranca, e as duas precisariam voltar juntas se algo desse errado. O caminho fica
   * escrito para ser um passo proprio: instalar o plugin, declara-lo aqui e expor a tela
   * de inscricao - sem tocar em mais nada deste arquivo.
   */
  // Every browser origin allowed to start an auth flow / hold a session.
  trustedOrigins: config.clientOrigins,
  advanced: {
    cookiePrefix: 'comunicacaoai',
    // In production the frontend and backend are separate HTTPS origins, so the
    // session cookie must be SameSite=None; Secure to be sent cross-site. In
    // development (http://localhost) the Better Auth defaults are kept, since
    // SameSite=None requires Secure and would break login over plain http.
    ...(config.isProduction ? { defaultCookieAttributes: { sameSite: 'none' as const, secure: true } } : {}),
  },
})
