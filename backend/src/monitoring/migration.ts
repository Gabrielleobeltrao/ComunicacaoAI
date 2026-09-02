import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { emptyTelemetry } from './types.js'
import type { MonitoringSource } from './types.js'

// A MIGRAÇÃO — projeção, e não mudança.
//
// O que já monitora continua monitorando: os recorders do histórico e as fontes ao vivo
// seguem exatamente onde estão, com os mesmos ids e o mesmo comportamento. O que esta
// migração faz é dar a eles uma LINHA na Central, para a pergunta "o que este escritório
// está vigiando?" ter uma resposta só.
//
// Nada é movido, nada é reescrito e nada passa a ser executado de um jeito novo. A fonte
// criada nasce PAUSADA e apontando para o recorder que já existia — quem coleta continua
// sendo quem coletava.

const sources = db.collection<MonitoringSource>('monitoring_sources')
const recorders = db.collection<{ _id: ObjectId; ownerId: string; name: string; enabled: boolean; source: { kind: string; ref: string }; selectedFields: string[] | null; entityKeyPath: string | null }>('data_recorders')

export interface MigrationResult {
  ownerId: string
  scanned: number
  created: number
  skipped: number
  planned: { recorderId: string; name: string; kind: string }[]
}

/** A marca de origem. É por ela que o rollback sabe o que ele criou — e o que não criou. */
export const MIGRATION_TAG = 'migracao:data_recorder'

/**
 * De qual tipo de fonte um recorder existente é a projeção.
 *
 * O recorder já diz de onde ele escuta; a Central só traduz para o vocabulário dela. Um
 * recorder `manual` que não veio da Central não tem tipo equivalente — ele é alimentado por
 * quem chama `recordFact`, e inventar um tipo para ele seria descrever errado.
 */
function tipoDe(source: { kind: string; ref: string }): MonitoringSource['kind'] | null {
  if (source.kind === 'event') return 'internal_event'
  if (source.kind === 'live_data') return 'websocket'
  return null
}

export async function migrateRecordersToSources(ownerId: string, opcoes: { dryRun?: boolean } = {}): Promise<MigrationResult> {
  const lista = await recorders.find({ ownerId }).toArray()
  const resultado: MigrationResult = { ownerId, scanned: lista.length, created: 0, skipped: 0, planned: [] }

  for (const recorder of lista) {
    const kind = tipoDe(recorder.source)
    if (!kind) {
      // `manual` de fora da Central: alimentado por quem chama, sem tipo equivalente.
      resultado.skipped += 1
      continue
    }

    // Idempotência pelo recorder: rodar duas vezes não cria a segunda linha.
    const existente = await sources.findOne({ ownerId, 'destination.recorderId': recorder._id })
    if (existente) {
      resultado.skipped += 1
      continue
    }
    resultado.planned.push({ recorderId: recorder._id.toString(), name: recorder.name, kind })
    if (opcoes.dryRun) continue

    const agora = new Date()
    const campos = (recorder.selectedFields ?? []).filter(Boolean)
    const doc: MonitoringSource = {
      _id: new ObjectId(),
      ownerId,
      scope: { ownerType: 'account', ownerId },
      name: recorder.name,
      description: MIGRATION_TAG,
      kind,
      // PAUSADA: a linha existe para ser vista, e ativar seria mudar o comportamento de
      // algo que já funciona — que é exatamente o que esta migração não faz.
      status: 'paused',
      connectionId: null,
      config: kind === 'internal_event' ? { eventType: recorder.source.ref } : { installationId: recorder.source.ref, protocol: 'websocket', subscriptions: [], heartbeatMs: 30_000 },
      schema: campos.length
        ? { type: 'object', properties: Object.fromEntries(campos.map((c) => [c, {}])), additionalProperties: true }
        : { type: 'object', additionalProperties: true },
      mapping: {
        version: 1,
        // Sem campos declarados, o recorder guarda o valor inteiro — e o mapeamento diz
        // isso com um campo só, em vez de inventar uma forma.
        fields: campos.length ? campos.map((c) => ({ to: c, from: c })) : [{ to: 'valor', from: '' }],
      },
      cadence: { mode: 'stream', intervalMs: null, cron: null, timezone: null },
      retry: { timeoutMs: 10_000, maxAttempts: 3, backoffMs: 5_000, jitterRatio: 0.3, rateLimitPerMinute: null },
      freshness: { staleAfterMs: 15 * 60_000, onStale: 'degrade' },
      entityKeyPath: recorder.entityKeyPath ?? null,
      dedupe: { mode: 'none' },
      // O recorder que já existia. A fonte APONTA para ele; não cria outro.
      destination: { live: false, history: true, recorderId: recorder._id, realtimeSourceId: null, retentionDays: null },
      telemetry: emptyTelemetry(),
      createdAt: agora,
      updatedAt: agora,
    }
    try {
      await sources.insertOne(doc)
      resultado.created += 1
    } catch (erro) {
      // Nome repetido com uma fonte que a pessoa criou à mão: a projeção cede, porque a
      // dela é a de verdade.
      if ((erro as { code?: number }).code === 11000) resultado.skipped += 1
      else throw erro
    }
  }
  return resultado
}

/**
 * O reverso — e ele apaga SÓ o que a migração criou.
 *
 * A marca de origem é o que separa: uma fonte que a pessoa editou depois deixou de ser a
 * projeção, e some da lista do rollback. Recorder nenhum é tocado; eles nunca foram da
 * Central.
 */
export async function rollbackRecorderMigration(ownerId: string): Promise<{ removed: number; kept: number }> {
  const projecoes = await sources.find({ ownerId, description: MIGRATION_TAG }).toArray()
  const remover = projecoes.filter((f) => f.status === 'paused' && f.telemetry.readsOk === 0)
  const manter = projecoes.length - remover.length

  if (remover.length) await sources.deleteMany({ _id: { $in: remover.map((f) => f._id) } })
  return { removed: remover.length, kept: manter }
}
