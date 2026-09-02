import { db } from '../db.js'
import type { ResourceKind } from './types.js'

// O REGISTRO de mudanças de acesso — e o que ele não guarda.
//
// Auditoria de acesso é sobre QUEM decidiu O QUÊ, não sobre o conteúdo do recurso. Aqui
// entram ids, capacidades e o motivo; nunca credencial, conteúdo, payload ou o valor de
// um segredo. A retenção é finita pelo mesmo motivo do manifesto: registro sem prazo vira
// um arquivo que ninguém lê e todo mundo paga.

export interface ResourceAccessEvent {
  ownerId: string
  action: 'grant' | 'revoke' | 'deny_observed' | 'shadow_mismatch'
  kind: ResourceKind
  resourceId: string
  subjectType: string
  subjectId: string
  capabilities: string[]
  reason: string
  actorId: string | null
  at: Date
}

const events = db.collection<ResourceAccessEvent>('resource_access_events')

export async function ensureResourceAuditIndexes(): Promise<void> {
  await events.createIndex({ ownerId: 1, at: -1 })
  await events.createIndex({ ownerId: 1, kind: 1, resourceId: 1 })
  await events.createIndex({ at: 1 }, { expireAfterSeconds: 180 * 24 * 3600, name: 'acesso_retencao' })
}

/** Nunca lança: perder um registro de auditoria não pode derrubar a operação auditada. */
export async function recordAccessEvent(e: Omit<ResourceAccessEvent, 'at'>): Promise<void> {
  try {
    await events.insertOne({ ...e, reason: e.reason.slice(0, 300), at: new Date() })
  } catch (erro) {
    console.error('[resources] não foi possível registrar o evento de acesso:', (erro as Error).message)
  }
}

export const listAccessEvents = (ownerId: string, limit = 100) =>
  events.find({ ownerId }, { projection: { _id: 0 } }).sort({ at: -1 }).limit(Math.min(limit, 500)).toArray()
