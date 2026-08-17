// O que a rotina de monitoramento JÁ VIU.
//
// Sem isto, uma rotina que verifica um feed a cada 15 minutos reprocessaria os
// mesmos itens para sempre — gastando tokens e reentregando a mesma coisa. O
// checkpoint é o que faz a diferença entre "verificar" e "verificar o que mudou".
//
// Duas regras que valem para tudo aqui:
//
//   1. o checkpoint só avança DEPOIS que a execução terminou bem. Se a LLM falhar,
//      se a entrega falhar, se o processo cair no meio — o próximo ciclo reprocessa
//      o mesmo conteúdo. É melhor entregar duas vezes que perder uma;
//   2. ele mora no banco, por automação e por etapa. Reinício, redeploy e troca de
//      instância não reapresentam o que já passou.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { contentHashOf } from './sourceChange.js'

export interface SourceCheckpoint {
  _id: ObjectId
  ownerId: string
  automationId: ObjectId
  stepId: string
  // RSS: as chaves dos itens já entregues. HTTP: vazio.
  seenKeys: string[]
  // HTTP: o hash do conteúdo útil da última entrega. RSS: null.
  contentHash: string | null
  // Quando a fonte foi consultada pela última vez — mude ou não.
  lastCheckedAt: Date | null
  // Quando ela mudou pela última vez, que é outra coisa: uma rotina saudável pode
  // passar dias sendo verificada sem nada novo.
  lastChangedAt: Date | null
  updatedAt: Date
}

const checkpoints = db.collection<SourceCheckpoint>('source_checkpoints')

// Quantas chaves guardar por fonte. Um feed devolve dezenas de itens por vez; a
// janela precisa cobrir várias voltas para um item que reaparece no meio da lista
// não ser tratado como novo, e precisa ter fim para o documento não crescer sem
// limite.
export const MAX_SEEN_KEYS = 500

export async function ensureSourceCheckpointIndexes(): Promise<void> {
  await checkpoints.createIndex({ ownerId: 1, automationId: 1, stepId: 1 }, { unique: true })
}

// Reexportado por conveniência de quem já usa o checkpoint; a definição vive no
// módulo da decisão.
export { contentHashOf }

export async function getCheckpoint(ownerId: string, automationId: ObjectId, stepId: string): Promise<SourceCheckpoint | null> {
  return checkpoints.findOne({ ownerId, automationId, stepId })
}

// Marca que a fonte foi consultada. Acontece TODA volta, inclusive quando nada
// mudou — é isso que faz a lista de rotinas conseguir dizer "verificado há 3 min,
// sem novidade" em vez de parecer parada.
export async function markChecked(ownerId: string, automationId: ObjectId, stepId: string, quando: Date): Promise<void> {
  await checkpoints.updateOne(
    { ownerId, automationId, stepId },
    {
      $set: { lastCheckedAt: quando, updatedAt: quando },
      $setOnInsert: { ownerId, automationId, stepId, seenKeys: [], contentHash: null, lastChangedAt: null },
    },
    { upsert: true },
  )
}

/**
 * Avança o checkpoint. Chamado SÓ depois do processamento bem-sucedido.
 *
 * As chaves novas entram no fim e a lista é cortada pelo começo: o que sai é o
 * mais antigo, que é justamente o que tem menos chance de reaparecer no feed.
 */
export async function advanceCheckpoint(
  ownerId: string,
  automationId: ObjectId,
  stepId: string,
  avanco: { novasChaves?: string[]; contentHash?: string | null },
  quando: Date,
): Promise<void> {
  await checkpoints.updateOne(
    { ownerId, automationId, stepId },
    {
      $set: {
        ...(avanco.contentHash !== undefined ? { contentHash: avanco.contentHash } : {}),
        lastChangedAt: quando,
        lastCheckedAt: quando,
        updatedAt: quando,
      },
      // Uma operação só, sem ler antes de escrever: se uma verificação agendada e um
      // "verificar agora" caírem juntos, nenhuma das duas perde as chaves da outra.
      // `$each: []` cobre a fonte HTTP, que não empurra chave nenhuma mas ainda
      // precisa nascer com o campo.
      $push: { seenKeys: { $each: avanco.novasChaves ?? [], $slice: -MAX_SEEN_KEYS } },
    },
    { upsert: true },
  )
}
