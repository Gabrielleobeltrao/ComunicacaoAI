import { decrypt, encrypt } from './crypto.js'
import { getIntegration, saveIntegration, updateAccessToken } from './integrations.js'
import { config } from './config.js'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? ''
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ??
  `${config.betterAuthUrl}/api/integrations/google/callback`

// calendar = read/create events + free/busy; spreadsheets = append rows;
// openid+email to know the connected account.
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/spreadsheets',
]

// Whether the server has Google OAuth credentials configured.
export function googleConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET)
}

export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline', // get a refresh token
    include_granted_scopes: 'true',
    prompt: 'consent', // force a refresh token even on reconnect
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
}

async function fetchUserEmail(accessToken: string): Promise<string> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return ''
    const data = (await res.json()) as { email?: string }
    return data.email ?? ''
  } catch {
    return ''
  }
}

// Exchange the OAuth code for tokens and store the connection for this owner.
export async function connectGoogle(ownerId: string, code: string): Promise<void> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`)
  const data = (await res.json()) as TokenResponse

  // Google only returns a refresh_token on the first consent; on reconnect,
  // keep the one we already have.
  let refreshToken = data.refresh_token
  if (!refreshToken) {
    const existing = await getIntegration(ownerId, 'google')
    if (!existing) {
      throw new Error('O Google não retornou um refresh token. Remova o acesso do app na sua conta Google e conecte de novo.')
    }
    refreshToken = decrypt(existing.refreshToken)
  }

  const email = await fetchUserEmail(data.access_token)
  await saveIntegration(ownerId, 'google', {
    accountEmail: email,
    accessToken: encrypt(data.access_token),
    refreshToken: encrypt(refreshToken),
    expiryDate: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  })
}

export async function getGoogleStatus(ownerId: string): Promise<{ connected: boolean; email?: string }> {
  const integration = await getIntegration(ownerId, 'google')
  return integration ? { connected: true, email: integration.accountEmail } : { connected: false }
}

// A currently-valid access token for this owner, refreshing if it's expired.
// Returns null when the owner hasn't connected Google (or the refresh failed).
export async function getGoogleAccessToken(ownerId: string): Promise<string | null> {
  const integration = await getIntegration(ownerId, 'google')
  if (!integration) return null
  if (Date.now() < integration.expiryDate - 60_000) return decrypt(integration.accessToken)

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: decrypt(integration.refreshToken),
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    console.error('Google token refresh failed:', await res.text())
    return null
  }
  const data = (await res.json()) as TokenResponse
  await updateAccessToken(ownerId, 'google', encrypt(data.access_token), Date.now() + data.expires_in * 1000)
  return data.access_token
}
