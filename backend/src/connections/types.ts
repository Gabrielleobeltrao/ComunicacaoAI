import type { ObjectId } from 'mongodb'

// Connections centralize encrypted external credentials (plan §8.11). The API
// never returns encryptedConfig or decrypted secrets — only publicMetadata.
export type ConnectionProvider = 'email' | 'telegram'
export type ConnectionStatus = 'connected' | 'error' | 'revoked'

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
