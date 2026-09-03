import { ObjectId } from 'mongodb'
import { decrypt, encrypt } from '../crypto.js'
import { ensureDefaultBuilding, ValidationError } from '../building.js'
import * as repo from './repository.js'
import type { Connection, ConnectionProvider, EmailConfig, TelegramConfig, WhatsAppConfig } from './types.js'

const PROVIDERS: ConnectionProvider[] = ['email', 'telegram', 'whatsapp']
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

function validateConfig(provider: ConnectionProvider, config: unknown): void {
  if (typeof config !== 'object' || config === null) throw new ValidationError('config is required')
  const c = config as Record<string, unknown>
  if (provider === 'email') {
    if (!isNonEmpty(c.host)) throw new ValidationError('email host required')
    if (!Number.isFinite(Number(c.port))) throw new ValidationError('email port required')
    if (!isNonEmpty(c.user)) throw new ValidationError('email user required')
    if (!isNonEmpty(c.pass)) throw new ValidationError('email pass required')
    if (!isNonEmpty(c.from)) throw new ValidationError('email from required')
  } else if (provider === 'whatsapp') {
    /**
     * Só a referência ao canal — nunca o token.
     *
     * O número do WhatsApp é conectado no App, e é lá que a credencial fica cifrada e é
     * revalidada. Uma conexão de entrega que guardasse o token de novo dobraria a superfície
     * de vazamento e ficaria velha na primeira rotação.
     */
    if (!isNonEmpty(c.widgetId) || !ObjectId.isValid(String(c.widgetId))) throw new ValidationError('whatsapp: escolha um número já conectado.')
    for (const proibido of ['token', 'accessToken', 'apiKey', 'secret', 'password']) {
      if (c[proibido] !== undefined) throw new ValidationError('whatsapp: a credencial fica no canal, não na conexão.')
    }
  } else {
    if (!isNonEmpty(c.botToken)) throw new ValidationError('telegram botToken required')
  }
}

function normalizeName(name: unknown): string {
  const s = String(name ?? '').trim()
  if (!s || s.length > 120) throw new ValidationError('invalid connection name')
  return s
}

export interface CreateConnectionInput {
  provider: ConnectionProvider
  name: string
  config: unknown
  publicMetadata?: Record<string, string>
}

export async function createConnection(ownerId: string, input: CreateConnectionInput): Promise<Connection> {
  if (!PROVIDERS.includes(input.provider)) throw new ValidationError('invalid provider')
  validateConfig(input.provider, input.config)
  const building = await ensureDefaultBuilding(ownerId)
  const now = new Date()
  const doc: Connection = {
    _id: new ObjectId(),
    ownerId,
    buildingId: building._id,
    provider: input.provider,
    name: normalizeName(input.name),
    status: 'connected',
    encryptedConfig: encrypt(JSON.stringify(input.config)),
    publicMetadata: input.publicMetadata ?? {},
    scopes: [],
    createdAt: now,
    updatedAt: now,
  }
  await repo.insertConnection(doc)
  return doc
}

export function getConnection(ownerId: string, id: ObjectId): Promise<Connection | null> {
  return repo.findConnection(ownerId, id)
}
export function listConnections(ownerId: string): Promise<Connection[]> {
  return repo.listConnections(ownerId)
}

export async function patchConnection(ownerId: string, id: ObjectId, patch: { name?: string; config?: unknown; publicMetadata?: Record<string, string> }): Promise<Connection | null> {
  const existing = await repo.findConnection(ownerId, id)
  if (!existing) return null
  const set: Partial<Connection> = {}
  if (patch.name !== undefined) set.name = normalizeName(patch.name)
  if (patch.publicMetadata !== undefined) set.publicMetadata = patch.publicMetadata
  if (patch.config !== undefined) {
    validateConfig(existing.provider, patch.config)
    set.encryptedConfig = encrypt(JSON.stringify(patch.config))
  }
  return repo.updateConnection(ownerId, id, set)
}

export function deleteConnection(ownerId: string, id: ObjectId): Promise<boolean> {
  return repo.deleteConnection(ownerId, id)
}

// Internal only — never exposed by the API. Used by the worker to send.
export function decryptConfig(c: Connection): EmailConfig | TelegramConfig | WhatsAppConfig {
  return JSON.parse(decrypt(c.encryptedConfig))
}

export const CONNECTION_CATALOG = [
  { provider: 'email', label: 'E-mail (SMTP)', fields: ['host', 'port', 'secure', 'user', 'pass', 'from'] },
  { provider: 'telegram', label: 'Telegram', fields: ['botToken'] },
  // Sem campo de credencial: o que se escolhe aqui é um número já conectado no App.
  { provider: 'whatsapp', label: 'WhatsApp', fields: ['widgetId'] },
] as const
