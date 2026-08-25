import { ObjectId } from 'mongodb'
import { ValidationError } from '../building.js'
import { resolveConnection } from '../apps/connectionProfile.js'
import { decryptInstallationConfig, getInstallation } from '../apps/installations.js'
import {
  countStreams,
  findStream,
  listResumableStreams,
  listStreams,
  listStreamsForInstallation,
  setStreamPaused,
  upsertStream,
} from './repository.js'
import { StreamManager, setStreamManager, streamManager } from './manager.js'
import type { StreamAdapter, StreamRecord } from './types.js'
import { MAX_STREAMS_PER_OWNER, MAX_SYMBOLS_PER_STREAM } from './types.js'

/**
 * A camada que a API e o worker enxergam. O gerenciador cuida de socket; aqui é onde
 * dono, permissão e limite são conferidos — antes de qualquer conexão sair.
 */

// Os adapters registrados neste processo. A Fase 5 pendura o da Alpaca aqui; nada mais
// no sistema precisa saber que ele existe.
const adapters = new Map<string, StreamAdapter>()

export function registerStreamAdapter(adapter: StreamAdapter): void {
  adapters.set(adapter.appKey, adapter)
}
export const streamAdapters = (): Map<string, StreamAdapter> => adapters
export const clearStreamAdapters = (): void => adapters.clear()

/**
 * A credencial para abrir o stream — só depois de a conexão passar em todas as
 * conferências que a ferramenta conectada já faz (dono, status, ambiente).
 *
 * `requireConnectable: false` porque um App de streaming não precisa declarar perfil
 * de conexão REST: quem empresta base e cabeçalho para ferramenta é outra coisa.
 */
export async function streamCredentials(ownerId: string, installationId: string): Promise<Record<string, string> | null> {
  const conexao = await resolveConnection(ownerId, installationId, { requireConnectable: false })
  if (!conexao.ok) return null
  const id = ObjectId.isValid(installationId) ? new ObjectId(installationId) : null
  const instalacao = id ? await getInstallation(ownerId, id) : null
  return instalacao ? decryptInstallationConfig(instalacao) : null
}

/** Símbolos saneados: maiúsculo, sem repetição, sem vazio, dentro do teto. */
export function normalizeSymbols(bruto: unknown): string[] {
  const lista = Array.isArray(bruto) ? bruto : []
  const limpos = [...new Set(lista.map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean))]
  if (limpos.length > MAX_SYMBOLS_PER_STREAM) {
    throw new ValidationError(`no máximo ${MAX_SYMBOLS_PER_STREAM} símbolos por stream`)
  }
  return limpos
}

/**
 * Garantir que um stream exista e esteja de pé. Idempotente: pedir de novo com os
 * mesmos símbolos não abre uma segunda conexão.
 */
export async function ensureStream(ownerId: string, installationId: string, symbols: unknown): Promise<StreamRecord> {
  const conexao = await resolveConnection(ownerId, installationId, { requireConnectable: false })
  if (!conexao.ok) throw new ValidationError(conexao.message)

  const limpos = normalizeSymbols(symbols)
  const existentes = await listStreamsForInstallation(ownerId, installationId)
  // O teto conta o que ainda NÃO existe: renovar um stream que já está lá nunca é
  // barrado por limite, senão mexer nos símbolos viraria um erro sem sentido.
  if (!existentes.some((s) => s.environment === conexao.environment) && (await countStreams(ownerId)) >= MAX_STREAMS_PER_OWNER) {
    throw new ValidationError(`limite de ${MAX_STREAMS_PER_OWNER} streams por conta atingido`)
  }

  const record = await upsertStream({
    ownerId,
    installationId,
    appKey: conexao.appKey,
    environment: conexao.environment,
    symbols: limpos,
  })
  await streamManager()?.start(record)
  return record
}

export async function pauseStream(ownerId: string, id: ObjectId): Promise<StreamRecord | null> {
  const record = await setStreamPaused(ownerId, id, true)
  if (record) await streamManager()?.stop(id.toString())
  return record
}

export async function resumeStream(ownerId: string, id: ObjectId): Promise<StreamRecord | null> {
  const record = await setStreamPaused(ownerId, id, false)
  if (record) await streamManager()?.start(record)
  return record
}

/** Reconectar: descer e subir. Explícito, porque "tentar de novo agora" é um pedido comum. */
export async function reconnectStream(ownerId: string, id: ObjectId): Promise<StreamRecord | null> {
  const record = await findStream(ownerId, id)
  if (!record) return null
  const gerente = streamManager()
  await gerente?.stop(id.toString())
  if (!record.paused) await gerente?.start({ ...record, state: 'disconnected' })
  return record
}

/**
 * Testar a conexão SEM abrir stream: só confere se a credencial ainda resolve.
 *
 * Não devolve nada do provider — um teste que ecoa a resposta é um teste que vaza.
 */
export async function testStreamConnection(ownerId: string, installationId: string): Promise<{ ok: boolean; message: string }> {
  const conexao = await resolveConnection(ownerId, installationId, { requireConnectable: false })
  if (!conexao.ok) return { ok: false, message: conexao.message }
  const credencial = await streamCredentials(ownerId, installationId)
  if (!credencial || Object.keys(credencial).length === 0) {
    return { ok: false, message: 'A conexão não tem credencial guardada.' }
  }
  const adapter = adapters.get(conexao.appKey)
  if (!adapter) return { ok: false, message: `O App "${conexao.appName}" não oferece streaming neste sistema.` }
  return { ok: true, message: `Conexão "${conexao.installationName}" pronta (${conexao.environment}).` }
}

export const listOwnerStreams = listStreams

/**
 * Subir de novo o que estava de pé antes do restart.
 *
 * É a diferença entre um worker que reinicia e um worker que reinicia e some com os
 * streams de todo mundo até alguém perceber.
 */
export async function restoreStreams(onError: (where: string, e: unknown) => void = () => undefined): Promise<number> {
  const gerente = streamManager()
  if (!gerente) return 0
  const pendentes = await listResumableStreams()
  let subiram = 0
  for (const record of pendentes) {
    try {
      await gerente.start(record)
      subiram += 1
    } catch (error) {
      onError(`stream ${record._id.toString()} restauração`, error)
    }
  }
  return subiram
}

/** Criar o gerenciador deste processo. Chamado uma vez, quando o motor sobe. */
export function createStreamManager(onError?: (where: string, e: unknown) => void): StreamManager {
  const m = new StreamManager({ adapters, credentialsOf: streamCredentials, onError })
  setStreamManager(m)
  return m
}

export async function shutdownStreams(): Promise<void> {
  await streamManager()?.stopAll()
  setStreamManager(null)
}
