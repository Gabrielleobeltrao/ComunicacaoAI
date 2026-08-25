import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import type { StreamRecord, StreamState } from './types.js'

// A INTENÇÃO dos streams, guardada. A conexão viva é do processo; isto é o que
// sobrevive a ele — e é só por existir que um restart restaura em vez de esquecer.
const streams = db.collection<StreamRecord>('market_streams')

export async function ensureStreamIndexes(): Promise<void> {
  // Um stream por (dono, conexão, ambiente): pedir duas vezes o mesmo é pedir uma vez.
  await streams.createIndex({ ownerId: 1, installationId: 1, environment: 1 }, { unique: true })
  await streams.createIndex({ paused: 1, updatedAt: -1 })
}

export const findStream = (ownerId: string, id: ObjectId): Promise<StreamRecord | null> => streams.findOne({ _id: id, ownerId })
export const listStreams = (ownerId: string): Promise<StreamRecord[]> => streams.find({ ownerId }).sort({ updatedAt: -1 }).toArray()
export const listStreamsForInstallation = (ownerId: string, installationId: string): Promise<StreamRecord[]> =>
  streams.find({ ownerId, installationId }).toArray()
/** O que o worker precisa subir quando acorda: tudo que não está pausado. */
export const listResumableStreams = (): Promise<StreamRecord[]> => streams.find({ paused: { $ne: true } }).toArray()
export const countStreams = (ownerId: string): Promise<number> => streams.countDocuments({ ownerId })

/**
 * Criar ou reaproveitar. Chamar duas vezes com os mesmos símbolos não cria um segundo
 * stream nem reinicia o primeiro — é isso que "idempotente" significa aqui.
 */
export async function upsertStream(input: {
  ownerId: string
  installationId: string
  appKey: string
  environment: string
  symbols: string[]
  now?: Date
}): Promise<StreamRecord> {
  const now = input.now ?? new Date()
  const r = await streams.findOneAndUpdate(
    { ownerId: input.ownerId, installationId: input.installationId, environment: input.environment },
    {
      $set: { appKey: input.appKey, symbols: input.symbols, updatedAt: now },
      $setOnInsert: {
        paused: false,
        state: 'disconnected' as StreamState,
        lastConnectedAt: null,
        lastEventAt: null,
        lastError: null,
        eventCount: 0,
        createdAt: now,
      },
    },
    { upsert: true, returnDocument: 'after' },
  )
  // O upsert com `returnDocument: 'after'` sempre devolve documento; o non-null é o
  // contrato do driver, não um palpite.
  return r as StreamRecord
}

export async function setStreamState(id: ObjectId, state: StreamState, now = new Date()): Promise<void> {
  await streams.updateOne(
    { _id: id },
    { $set: { state, updatedAt: now, ...(state === 'connected' ? { lastConnectedAt: now, lastError: null } : {}) } },
  )
}

/** A falha guardada é uma frase curta. O quadro cru pode conter credencial e não entra. */
export async function setStreamError(id: ObjectId, message: string, now = new Date()): Promise<void> {
  await streams.updateOne({ _id: id }, { $set: { state: 'error' as StreamState, lastError: { message: message.slice(0, 300), at: now }, updatedAt: now } })
}

export async function markStreamEvent(id: ObjectId, quantos: number, now = new Date()): Promise<void> {
  if (quantos <= 0) return
  await streams.updateOne({ _id: id }, { $set: { lastEventAt: now, updatedAt: now }, $inc: { eventCount: quantos } })
}

export async function setStreamPaused(ownerId: string, id: ObjectId, paused: boolean, now = new Date()): Promise<StreamRecord | null> {
  const r = await streams.findOneAndUpdate(
    { _id: id, ownerId },
    { $set: { paused, state: (paused ? 'paused' : 'disconnected') as StreamState, updatedAt: now } },
    { returnDocument: 'after' },
  )
  return r ?? null
}

export async function deleteStream(ownerId: string, id: ObjectId): Promise<boolean> {
  const r = await streams.deleteOne({ _id: id, ownerId })
  return r.deletedCount === 1
}

export const streamsCollection = streams
