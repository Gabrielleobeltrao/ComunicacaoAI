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

// --- posse do stream, entre instâncias -------------------------------------------------
//
// O gerenciador impede um segundo socket DENTRO do processo. Entre processos ele não
// impede nada: duas instâncias que subissem juntas restaurariam os mesmos streams e
// abririam dois sockets no mesmo serviço — dobrando mensagem, dobrando evento e, num
// provedor que limita conexões por conta, derrubando as duas.
//
// A posse é um arrendamento no próprio documento do stream: quem consegue gravá-lo é
// dono até ele vencer. Não é eleição, não é serviço à parte, e não muda nada num deploy
// de uma instância só — ela pega o arrendamento de todos e renova.

/** Quanto tempo a posse vale sem renovação. Curto o bastante para uma queda não travar. */
export const STREAM_LEASE_MS = Number(process.env.STREAM_LEASE_MS ?? 60_000)

/**
 * Toma a posse — ou renova a que já é minha.
 *
 * `findOneAndUpdate` com o filtro decidindo: sem dono, dono sou eu, ou o prazo venceu.
 * É atômico no servidor do banco, então duas instâncias pedindo ao mesmo tempo produzem
 * um dono e uma recusa — nunca dois donos.
 */
export async function claimStream(id: ObjectId, instanceId: string, now = new Date()): Promise<boolean> {
  const r = await streams.findOneAndUpdate(
    {
      _id: id,
      $or: [{ leaseOwner: { $exists: false } }, { leaseOwner: null }, { leaseOwner: instanceId }, { leaseUntil: { $lt: now } }],
    },
    { $set: { leaseOwner: instanceId, leaseUntil: new Date(now.getTime() + STREAM_LEASE_MS) } },
    { returnDocument: 'after' },
  )
  return Boolean(r)
}

/** Renova só o que ainda é meu. Perder a posse no meio é sinal para soltar o socket. */
export async function renewStreamLease(id: ObjectId, instanceId: string, now = new Date()): Promise<boolean> {
  const r = await streams.updateOne(
    { _id: id, leaseOwner: instanceId },
    { $set: { leaseUntil: new Date(now.getTime() + STREAM_LEASE_MS) } },
  )
  return r.matchedCount > 0
}

/**
 * Solta a posse. Chamado ao parar e no encerramento.
 *
 * Sem isto, um deploy deixaria os streams travados pelo tempo do arrendamento — a
 * instância nova subiria e ficaria um minuto sem poder abrir nada.
 *
 * COM PRAZO CURTO, e é o detalhe que importa: devolver a posse é uma gentileza — ela
 * vence sozinha —, e o encerramento não pode depender dela. Com o banco fora do ar (o
 * caso em que o processo MAIS precisa morrer), a chamada fica pendurada até o tempo de
 * seleção de servidor do driver, e o orquestrador mata o processo à força.
 */
const PRAZO_DA_DEVOLUCAO_MS = Number(process.env.STREAM_LEASE_RELEASE_TIMEOUT_MS ?? 2_000)

async function comPrazo(promessa: Promise<unknown>): Promise<void> {
  let relogio: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      promessa,
      new Promise<void>((resolve) => {
        relogio = setTimeout(resolve, PRAZO_DA_DEVOLUCAO_MS)
        relogio.unref?.()
      }),
    ])
  } catch {
    // A posse vence sozinha: falhar em devolvê-la nunca é motivo para atrapalhar o
    // encerramento nem para virar erro na tela.
  } finally {
    if (relogio) clearTimeout(relogio)
  }
}

export async function releaseStreamLease(id: ObjectId, instanceId: string): Promise<void> {
  await comPrazo(streams.updateOne({ _id: id, leaseOwner: instanceId }, { $set: { leaseOwner: null, leaseUntil: null } }))
}

export const releaseAllLeases = async (instanceId: string): Promise<void> => {
  await comPrazo(streams.updateMany({ leaseOwner: instanceId }, { $set: { leaseOwner: null, leaseUntil: null } }))
}

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
  await streams.updateOne({ _id: id }, { $set: { state, updatedAt: now, ...(state === 'connected' ? { lastConnectedAt: now } : {}) } })
  /**
   * Conectar limpa a falha ANTERIOR — só ela.
   *
   * A gravação do "conectado" é disparada sem espera, e um erro que chega logo depois
   * do handshake (uma autenticação recusada, por exemplo) grava enquanto ela ainda
   * está no ar. Limpando às cegas, a mensagem que explica a queda sumiria e o stream
   * ficaria "conectado, sem erro" — e mudo.
   */
  if (state === 'connected') {
    await streams.updateOne({ _id: id, 'lastError.at': { $lt: now } }, { $set: { lastError: null } })
  }
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
