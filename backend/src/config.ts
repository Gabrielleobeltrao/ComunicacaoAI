// Central, typed runtime configuration. In development/test it keeps the same
// localhost defaults the app has always used; in production it fails fast when a
// deploy-critical variable is missing or malformed, and never falls back to a
// silent localhost value. URLs are normalized (no trailing slash) in one place.
import 'dotenv/config'

const NODE_ENV = process.env.NODE_ENV ?? 'development'
export const isProduction = NODE_ENV === 'production'

const stripTrailingSlash = (u: string) => u.replace(/\/+$/, '')

// In production a required var must be present; in dev/test we fall back to the
// documented localhost default so `npm run dev` keeps working with no .env.
function urlVar(name: string, devDefault: string): string {
  const raw = process.env[name]?.trim()
  if (raw) return stripTrailingSlash(raw)
  if (isProduction) throw new Error(`Missing required production environment variable: ${name}`)
  return stripTrailingSlash(devDefault)
}

// CORS allowlist: comma-separated origins (e.g. "https://comunicacaoai.oneplataforma.com").
function originList(name: string, devDefault: string): string[] {
  const raw = process.env[name]?.trim()
  if (!raw) {
    if (isProduction) throw new Error(`Missing required production environment variable: ${name}`)
    return [stripTrailingSlash(devDefault)]
  }
  return raw
    .split(',')
    .map((s) => stripTrailingSlash(s.trim()))
    .filter(Boolean)
}

const port = Number(process.env.PORT ?? 4000)

export const config = {
  nodeEnv: NODE_ENV,
  isProduction,
  port,
  // Every browser origin allowed to call the private (cookie) API + Socket.IO.
  clientOrigins: originList('CLIENT_URL', 'http://localhost:5173'),
  // The backend's own public origin (used to build inbound webhook URLs).
  publicUrl: urlVar('PUBLIC_URL', `http://localhost:${port}`),
  // Better Auth's public base origin (used to derive the Google OAuth callback).
  betterAuthUrl: urlVar('BETTER_AUTH_URL', `http://localhost:${port}`),
  // How long SIGTERM may take before the process forces itself out. It MUST stay
  // below the orchestrator's stop_grace_period (30s in compose and Coolify), so the
  // engine finishes draining its in-flight runs instead of being SIGKILLed
  // mid-execution. Raise both together, never just this one.
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000),
} as const

// Backwards-compatible canonical client origin (first in the allowlist).
export const clientUrl = config.clientOrigins[0]

// As feature flags do backend foram removidas: as seis (`AI_BUILDING_ENABLED`,
// `AI_FLOORS_ENABLED`, `AI_AUTOMATIONS_ENABLED`, `AI_SCHEDULER_ENABLED`,
// `AI_DELIVERIES_ENABLED`, `AI_OFFICE_LIVE_STATUS_ENABLED`) eram lidas aqui e não
// eram consultadas em lugar nenhum — nenhuma rota, nenhum serviço, nenhum teste.
// Uma chave que não abre porta nenhuma é pior que ausente: ela promete um controle
// que não existe, e alguém acaba desligando uma coisa acreditando ter desligado
// outra. Definir qualquer uma delas no ambiente hoje é inofensivo e continua sendo:
// não há compatibilidade a preservar porque não havia comportamento.
// Validate deploy-critical configuration once, at startup. Only enforced in
// production so local development and tests are never blocked.
export function validateConfig(): void {
  if (!isProduction) return
  const required: Record<string, string | undefined> = {
    MONGODB_URI: process.env.MONGODB_URI,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    CLIENT_URL: process.env.CLIENT_URL,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    PUBLIC_URL: process.env.PUBLIC_URL,
  }
  // A test-only escape hatch must never be live in production.
  if (process.env.ALLOW_LOOPBACK_HTTP_TARGETS === '1') {
    throw new Error('ALLOW_LOOPBACK_HTTP_TARGETS is a test-only flag and must not be set in production')
  }

  const missing = Object.entries(required)
    .filter(([, v]) => !v || !v.trim())
    .map(([k]) => k)
  if (missing.length) throw new Error(`Missing required production environment: ${missing.join(', ')}`)

  for (const [name, value] of [
    ['CLIENT_URL', config.clientOrigins[0]],
    ['BETTER_AUTH_URL', config.betterAuthUrl],
    ['PUBLIC_URL', config.publicUrl],
  ] as const) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error(`Invalid URL in ${name}: ${value}`)
    }
    if (url.protocol !== 'https:') throw new Error(`${name} must be https in production: ${value}`)
  }
}
