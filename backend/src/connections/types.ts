import type { ObjectId } from 'mongodb'

// Connections centralize encrypted external credentials (plan §8.11). The API
// never returns encryptedConfig or decrypted secrets — only publicMetadata.
/**
 * Por onde um resultado SAI.
 *
 * `whatsapp` é diferente dos outros dois num ponto que importa: ele não guarda credencial.
 * O número já está conectado como canal do App, com o token validado pelo fluxo de canais e
 * guardado lá — esta conexão é uma REFERÊNCIA a ele. Copiar o token para cá criaria um segundo
 * lugar para ele vazar e um segundo lugar para ele ficar desatualizado.
 */
export type ConnectionProvider = 'email' | 'telegram' | 'whatsapp'
export type ConnectionStatus = 'connected' | 'error' | 'revoked'

/** WhatsApp: o canal já conectado que envia. Sem token: ele mora no widget do canal. */
export interface WhatsAppConfig {
  widgetId: string
}

export interface Connection {
  _id: ObjectId
  ownerId: string
  buildingId: ObjectId
  provider: ConnectionProvider
  name: string
  status: ConnectionStatus
  encryptedConfig: string
  publicMetadata: Record<string, string>
  scopes: string[]
  createdAt: Date
  updatedAt: Date
}

// Decrypted config shapes (never persisted in the clear, never returned by the API).
export interface EmailConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
}
export interface TelegramConfig {
  botToken: string
}

// A delivery is recorded before sending and is idempotent (plan §8.12/§10.4).
export type DeliveryStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'canceled'
export interface Delivery {
  _id: ObjectId
  ownerId: string
  runId: ObjectId
  provider: ConnectionProvider
  connectionId: ObjectId
  destinationMasked: string
  status: DeliveryStatus
  attempt: number
  providerMessageId: string | null
  idempotencyKey: string
  error: { kind: string; message: string } | null
  createdAt: Date
  sentAt: Date | null
}
