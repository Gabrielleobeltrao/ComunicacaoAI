import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { onRecordWritten } from '../dataHistory/store.js'
import type { DataHistoryRecord } from '../dataHistory/types.js'
import { observeAndDispatch } from './dispatch.js'
import type { DispatchResult } from './dispatch.js'
import { monitorsCollection } from './state.js'
import type { MonitorDefinition } from './state.js'

// O MONITOR DE DATABASE, ligado ao que realmente acontece.
//
// Um monitor de dataset que ninguém alimenta é um monitor decorativo: ele existe na tela,
// tem condição válida e nunca observa nada. O que faltava era a ponte — e ela não podia
// ser uma varredura periódica, que chegaria atrasada e leria o mesmo registro várias vezes.
//
// A ponte é o próprio momento da GRAVAÇÃO. O histórico avisa quem escuta quando um
// registro passa a existir, e cada monitor daquele dataset observa aquele registro uma
// vez. A identidade do evento é a chave do registro, então:
//
//   - a mesma entrega gravada duas vezes não vira duas observações (a segunda nem grava);
//   - reprocessar depois de um restart encontra a execução que já existe, pela mesma chave;
//   - o disparo pendente é retomado pelo `resumePendingDispatches` de sempre.

/**
 * Qual dataset este registro alimenta.
 *
 * A migração 9.2 usa o id do recorder como chave do dataset — é assim que o adapter o
 * encontra. Aqui a leitura é a mesma, na direção contrária.
 */
const datasetKeyDe = (record: DataHistoryRecord) => record.recorderId.toString()

/**
 * Os monitores publicados que observam este dataset.
 *
 * O `dataStoreId` também é conferido: dois Data Stores podem apontar para o mesmo
 * recorder, e um monitor do primeiro não é um monitor do segundo.
 */
async function monitoresDe(record: DataHistoryRecord): Promise<MonitorDefinition[]> {
  const datasetKey = datasetKeyDe(record)
  const candidatos = await monitorsCollection
    .find({ ownerId: record.ownerId, status: 'published', 'source.kind': 'database', 'source.datasetKey': datasetKey })
    .toArray()
  if (candidatos.length === 0) return []

  // Só os cujo Data Store realmente contém este dataset.
  const storeIds = [...new Set(candidatos.map((m) => (m.source as { dataStoreId: ObjectId }).dataStoreId.toString()))]
  const datasets = await db
    .collection('dataset_definitions')
    .find({ ownerId: record.ownerId, key: datasetKey, dataStoreId: { $in: storeIds.map((id) => new ObjectId(id)) } }, { projection: { dataStoreId: 1 } })
    .toArray()
  const validos = new Set(datasets.map((d) => d.dataStoreId.toString()))
  return candidatos.filter((m) => validos.has((m.source as { dataStoreId: ObjectId }).dataStoreId.toString()))
}

/**
 * O que o monitor VÊ de um registro.
 *
 * O valor gravado, mais o instante do fato. A condição do monitor foi validada contra o
 * schema do dataset, que descreve exatamente este objeto — e nada além dele entra: um
 * `ownerId` ou um `recorderId` no valor observado deixaria a condição alcançar metadado
 * que ela não deveria conhecer.
 */
export const valorObservado = (record: DataHistoryRecord): Record<string, unknown> => ({
  ...record.value,
  occurredAt: record.occurredAt,
})

export async function observarRegistro(record: DataHistoryRecord): Promise<DispatchResult[]> {
  const monitores = await monitoresDe(record)
  const saidas: DispatchResult[] = []
  for (const monitor of monitores) {
    saidas.push(
      await observeAndDispatch({
        ownerId: record.ownerId,
        monitor,
        value: valorObservado(record),
        // A identidade do REGISTRO. É ela que faz "exatamente uma execução por evento".
        eventId: record.dedupeKey,
        now: record.recordedAt,
      }),
    )
  }
  return saidas
}

/** Liga a ponte. Chamado uma vez, no arranque do motor — como o resto dos handlers. */
export function registerDatabaseMonitors(onError: (where: string, e: unknown) => void = () => undefined): void {
  onRecordWritten(async (record) => {
    try {
      await observarRegistro(record)
    } catch (erro) {
      onError(`monitor do registro ${record.dedupeKey}`, erro)
    }
  })
}
