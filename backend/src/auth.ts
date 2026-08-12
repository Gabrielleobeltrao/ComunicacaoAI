import { betterAuth } from 'better-auth'
import { mongodbAdapter } from 'better-auth/adapters/mongodb'
import { db, mongoClient } from './db.js'
import { config } from './config.js'

export const auth = betterAuth({
  // Explicit public origin of the auth service (derived from BETTER_AUTH_URL).
  baseURL: config.betterAuthUrl,
  database: mongodbAdapter(db, { client: mongoClient }),
  emailAndPassword: {
    enabled: true,
  },
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
