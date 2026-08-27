import type { ObjectId } from 'mongodb'
import {
  agregarRegistros,
  apagarHistoricoDe,
  chavesDoRecorder,
  contarDaConsulta,
  inserirRegistro,
  listarRegistros,
  ultimoRegistro,
} from '../store.js'
import type { HistoryStorageAdapter } from './types.js'
import type { AggregationOp, DataHistoryRecord } from '../types.js'
import type { RangeQuery } from '../store.js'

/**
 * O banco interno — o destino de sempre, agora com nome.
 *
 * Ele é fino de propósito: tudo que faz é delegar ao `store`, que já existia e continua
 * sendo o único lugar que conhece a coleção, os índices e o TTL. Transformar isso num
 * adapter não mudou uma linha de como o dado é gravado; mudou quem decide para onde ele
 * vai, que passou a ser configuração.
 */
export const internalStorage: HistoryStorageAdapter = {
  kind: 'internal',
  label: 'Banco interno',

  gravar: (doc: Omit<DataHistoryRecord, '_id'>, teto?: number) => inserirRegistro(doc, teto),

  listar: (ownerId: string, q: RangeQuery) => listarRegistros(ownerId, q),
  contar: (ownerId: string, q: RangeQuery) => contarDaConsulta(ownerId, q),
  ultimo: (ownerId: string, recorderId: ObjectId, entityKey: string | null, recordKind?: RangeQuery['recordKind']) =>
    ultimoRegistro(ownerId, recorderId, entityKey, recordKind ?? null),
  agregar: (ownerId: string, q: RangeQuery, regras: { from: string; op: AggregationOp; to: string }[]) => agregarRegistros(ownerId, q, regras),
  chaves: (ownerId: string, recorderId: ObjectId, limite?: number) => chavesDoRecorder(ownerId, recorderId, limite),
  apagarTudo: (ownerId: string, recorderId: ObjectId) => apagarHistoricoDe(ownerId, recorderId),
}
