import { ObjectId } from 'mongodb'
import { db } from './db.js'
import { getFloor } from './floors.js'
import { getBuilding } from './building.js'
import { createDocumentFor, findBySourceRef, ownerFilter as ownerFilterOf } from './knowledge.js'
import type { KnowledgeOwner } from './knowledge.js'

// A MUDANÇA DE CASA do conhecimento de andar e prédio.
//
// Enquanto a base aceitava só `agent` e `sector`, o que o Arquiteto gravava para um
// andar ou para o prédio caía na memória determinística — um registro com chave, ao
// lado de fatos de execução. Ele existia, mas não era encontrado por busca semântica e
// não aparecia em base nenhuma. Agora que os quatro escopos têm dono, esses itens
// precisam ir para a base canônica.
//
// Três garantias, e as três existem porque a alternativa já deu errado em algum lugar:
//
// 1. IDEMPOTENTE. A chave `sourceRef` é derivada do id do registro de memória, e o banco
//    tem índice único sobre `(ownerType, ownerId, sourceRef)`. Rodar duas vezes — ou
//    duas vezes ao mesmo tempo — não produz duas cópias do cardápio.
// 2. RETOMÁVEL. Cada item tem seu resultado gravado. Uma falha no meio (provedor de
//    embedding fora do ar, por exemplo) não perde o que já passou, e a execução seguinte
//    continua de onde parou em vez de recomeçar cobrando embedding de novo.
// 3. NÃO DESTRUTIVA. A memória original fica. Copiar e apagar na mesma passada é apostar
//    que a cópia deu certo; aqui a confirmação vem de uma leitura do documento gravado,
//    e a remoção do original é uma decisão de outro bloco, com a cópia já conferida.
//
// E não roda no boot. Um servidor que sobe reescrevendo dados é um servidor que, num
// reinício automático às três da manhã, faz uma migração que ninguém está olhando.

export interface MigrationRecord {
  /** O id do registro de memória migrado. É a chave: um registro, uma linha. */
  _id: ObjectId
  tenantId: string
  scope: 'floor' | 'building'
  status: 'done' | 'failed'
  documentId: ObjectId | null
  error: string | null
  at: Date
}

const memories = db.collection('memories')
const documentsCollection = db.collection('knowledge_documents')
const migrations = db.collection<MigrationRecord>('knowledge_migrations')

export const MIGRATION_SOURCE = 'architect-memory'

/** A marca estável desta cópia. Deriva do id do registro — não do título, que muda. */
export const sourceRefFor = (memoryId: ObjectId): string => `memory:${memoryId.toString()}`

export async function ensureKnowledgeMigrationIndexes(): Promise<void> {
  await migrations.createIndex({ tenantId: 1, status: 1 })
}

export interface MigrationResult {
  scanned: number
  migrated: number
  skipped: number
  failed: number
  errors: { memoryId: string; error: string }[]
}

/** O texto de um payload de memória do Arquiteto: `{ titulo, conteudo }`. */
function textoDe(payload: unknown): { title: string; content: string } | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const content = typeof p.conteudo === 'string' ? p.conteudo : typeof p.content === 'string' ? p.content : ''
  const title = typeof p.titulo === 'string' ? p.titulo : typeof p.title === 'string' ? p.title : ''
  if (!content.trim()) return null
  return { title: title.trim() || 'Conhecimento do Arquiteto', content }
}

/**
 * O dono real deste registro — conferido contra a conta que o gravou.
 *
 * Um `floorId` guardado numa memória é um id gravado pelo servidor, mas a conferência
 * acontece do mesmo jeito: migração é escrita em massa, e é onde um id órfão viraria um
 * documento pendurado em ninguém, invisível e permanente.
 */
async function donoDe(registro: Record<string, unknown>): Promise<KnowledgeOwner | null> {
  const tenantId = String(registro.tenantId)
  if (registro.scope === 'building') {
    const predio = await getBuilding(tenantId)
    if (!predio) return null
    const id = registro.buildingId as ObjectId | null
    if (id && !predio._id.equals(id)) return null
    return { ownerType: 'building', ownerId: predio._id }
  }
  const floorId = registro.floorId as ObjectId | null
  if (!floorId) return null
  const andar = await getFloor(tenantId, floorId)
  return andar ? { ownerType: 'floor', ownerId: andar._id } : null
}

/**
 * Copia para a base canônica o conhecimento de andar/prédio que o Arquiteto gravou.
 *
 * `tenantId` opcional: sem ele, roda para a instalação inteira (é o script de migração);
 * com ele, para uma conta só (é o que o teste exercita e o que uma reexecução dirigida
 * usaria).
 */
export async function migrateArchitectKnowledge(opts: { tenantId?: string; limit?: number } = {}): Promise<MigrationResult> {
  const filtro: Record<string, unknown> = {
    sourceType: 'architect',
    scope: { $in: ['floor', 'building'] },
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
  }
  const registros = await memories.find(filtro).limit(opts.limit ?? 5000).toArray()
  const fora: MigrationResult = { scanned: registros.length, migrated: 0, skipped: 0, failed: 0, errors: [] }

  for (const registro of registros) {
    const memoryId = registro._id as ObjectId
    // Já resolvido numa execução anterior: sai sem tocar em nada. É isto que faz rodar
    // de novo custar uma leitura em vez de uma segunda rodada de embeddings.
    const anterior = await migrations.findOne({ _id: memoryId })
    if (anterior?.status === 'done') {
      fora.skipped += 1
      continue
    }

    try {
      const owner = await donoDe(registro as Record<string, unknown>)
      if (!owner) throw new Error('o dono deste registro não existe mais nesta conta')
      const texto = textoDe(registro.payload)
      if (!texto) throw new Error('o registro não tem conteúdo para copiar')

      const sourceRef = sourceRefFor(memoryId)
      // O documento pode já existir de uma execução que gravou e caiu antes de marcar.
      // Reaproveitá-lo é o que impede a segunda cópia — e o que confirma a primeira.
      const existente = await findBySourceRef(owner, sourceRef)
      const doc =
        existente ??
        (await createDocumentFor(owner, {
          title: texto.title,
          content: texto.content,
          source: MIGRATION_SOURCE,
          sourceRef,
          authorId: String(registro.tenantId),
          lifecycleStatus: 'approved',
        }))

      /**
       * A CONFIRMAÇÃO vem de uma leitura, não do retorno da escrita.
       *
       * "Marcar concluído porque a função não lançou" é o que transforma uma falha
       * silenciosa em dado perdido: a memória original só pode ser considerada copiada
       * quando o documento está lá para ser lido.
       */
      const confirmado = await db.collection('knowledge_documents').findOne({ _id: doc._id }, { projection: { _id: 1 } })
      if (!confirmado) throw new Error('a cópia não foi encontrada depois de gravada')

      await migrations.updateOne(
        { _id: memoryId },
        { $set: { tenantId: String(registro.tenantId), scope: registro.scope as 'floor' | 'building', status: 'done', documentId: doc._id, error: null, at: new Date() } },
        { upsert: true },
      )
      fora.migrated += 1
    } catch (erro) {
      const mensagem = (erro as Error)?.message ?? 'falha desconhecida'
      // A falha fica REGISTRADA, e o item continua pendente: a execução seguinte tenta
      // de novo em vez de fingir que ele não existe.
      await migrations.updateOne(
        { _id: memoryId },
        { $set: { tenantId: String(registro.tenantId), scope: registro.scope as 'floor' | 'building', status: 'failed', documentId: null, error: mensagem.slice(0, 300), at: new Date() } },
        { upsert: true },
      )
      fora.failed += 1
      fora.errors.push({ memoryId: memoryId.toString(), error: mensagem })
    }
  }
  return fora
}

/** O que já foi copiado, para quem quiser conferir antes de decidir apagar o original. */
export const listMigrationRecords = (tenantId: string) => migrations.find({ tenantId }).toArray()


// --- a AUDITORIA da mudança de casa ----------------------------------------------------
//
// A migração copiou; ela não apagou nada, de propósito. Apagar o original na mesma
// passada é apostar que a cópia deu certo, e uma aposta dessas só é descoberta quando
// alguém procura o texto e ele não está em lugar nenhum.
//
// O que existe aqui é a CONFERÊNCIA: para cada memória do Arquiteto, onde ela foi parar,
// se a cópia está lá para ser lida, e se o conteúdo bate. Nada é removido — nem por esta
// função, nem por engano: ela não escreve.

export interface MigrationAuditItem {
  memoryId: string
  scope: 'floor' | 'building'
  /** O dono do registro, quando ele ainda existe nesta conta. */
  ownerId: string | null
  title: string
  documentId: string | null
  /** A cópia foi encontrada E o conteúdo bate — conferido por LEITURA, não pelo registro. */
  copyConfirmed: boolean
  /** Por que este item ainda não pode ser considerado copiado. */
  problem: string | null
  /**
   * Seguro para uma limpeza futura?
   *
   * Verdadeiro só quando a cópia foi lida e o texto confere. Um "provavelmente" aqui
   * viraria uma exclusão de verdade lá na frente.
   */
  safeToClean: boolean
}

export interface MigrationAudit {
  total: number
  confirmed: number
  unmatched: number
  safeToClean: number
  items: MigrationAuditItem[]
}

/**
 * O que já foi copiado, o que não foi, e o que dá para limpar depois — sem limpar nada.
 *
 * A confirmação vem de ler o DOCUMENTO e comparar o texto com o da memória. O registro
 * da migração diz o que aconteceu na hora; ele não diz se o documento continua lá
 * depois — alguém pode tê-lo apagado, e nesse caso a memória original é a única cópia
 * que resta.
 */
export async function auditArchitectMemoryMigration(tenantId: string): Promise<MigrationAudit> {
  const registros = await memories.find({ tenantId, sourceType: 'architect', scope: { $in: ['floor', 'building'] } }).toArray()
  const items: MigrationAuditItem[] = []

  for (const registro of registros) {
    const memoryId = registro._id as ObjectId
    const texto = textoDe(registro.payload)
    const marca = await migrations.findOne({ _id: memoryId })
    const owner = await donoDe(registro as Record<string, unknown>)

    let documentId: string | null = null
    let copyConfirmed = false
    let problem: string | null = null

    if (!texto) {
      problem = 'o registro não tem conteúdo para copiar'
    } else if (!owner) {
      problem = 'o dono deste registro não existe mais nesta conta'
    } else {
      // Procurada pela marca estável, e não pelo id guardado no registro da migração:
      // é a marca que sobrevive a uma reexecução, e é ela que o banco usa para impedir
      // a segunda cópia.
      const doc = await documentsCollection.findOne({ ...ownerFilterOf(owner), sourceRef: sourceRefFor(memoryId) })
      if (!doc) {
        problem = marca?.status === 'done' ? 'a cópia foi registrada mas não está mais na base' : 'ainda não copiado'
      } else {
        documentId = doc._id.toString()
        copyConfirmed = String(doc.content ?? '').trim() === texto.content.trim()
        if (!copyConfirmed) problem = 'a cópia existe, mas o texto não confere com o original'
      }
    }

    items.push({
      memoryId: memoryId.toString(),
      scope: registro.scope as 'floor' | 'building',
      ownerId: owner ? owner.ownerId.toString() : null,
      title: texto?.title ?? '(sem título)',
      documentId,
      copyConfirmed,
      problem,
      safeToClean: copyConfirmed,
    })
  }

  return {
    total: items.length,
    confirmed: items.filter((i) => i.copyConfirmed).length,
    unmatched: items.filter((i) => !i.copyConfirmed).length,
    safeToClean: items.filter((i) => i.safeToClean).length,
    items,
  }
}


// --- a LIMPEZA, que é um comando à parte ------------------------------------------------
//
// A migração copiou e não apagou nada — de propósito. Esta é a outra metade, e ela existe
// com três travas, porque uma exclusão em massa sobre dados que alguém confiou ao sistema
// não tem desfazer:
//
// 1. DRY-RUN por padrão. Sem `confirm: true` ela diz o que faria e não faz nada.
// 2. Confere a cópia POR LEITURA, item a item, na hora. O registro da migração diz o que
//    aconteceu semanas atrás; ele não diz se o documento continua lá.
// 3. Retomável: cada item é independente, e o que não pôde ser conferido continua de pé.

export interface CleanupResult {
  dryRun: boolean
  eligible: number
  deleted: number
  skipped: { memoryId: string; reason: string }[]
}

export async function cleanupMigratedMemories(tenantId: string, opts: { confirm?: boolean; limit?: number } = {}): Promise<CleanupResult> {
  const auditoria = await auditArchitectMemoryMigration(tenantId)
  const candidatos = auditoria.items.filter((i) => i.safeToClean).slice(0, opts.limit ?? 1000)
  const fora: CleanupResult = { dryRun: !opts.confirm, eligible: candidatos.length, deleted: 0, skipped: [] }

  for (const item of auditoria.items.filter((i) => !i.safeToClean)) {
    fora.skipped.push({ memoryId: item.memoryId, reason: item.problem ?? 'cópia não confirmada' })
  }
  if (!opts.confirm) return fora

  for (const item of candidatos) {
    /**
     * A cópia é conferida DE NOVO, agora.
     *
     * Entre a auditoria e esta linha alguém pode ter apagado o documento — e aí a memória
     * original passou a ser a única cópia que resta. Reconferir custa uma leitura por
     * item; não reconferir custa o dado.
     */
    const doc = item.documentId
      ? await documentsCollection.findOne({ _id: new ObjectId(item.documentId) }, { projection: { content: 1 } })
      : null
    const memoria = await memories.findOne({ _id: new ObjectId(item.memoryId), tenantId })
    const texto = memoria ? textoDe(memoria.payload) : null
    if (!doc || !texto || String(doc.content ?? '').trim() !== texto.content.trim()) {
      fora.skipped.push({ memoryId: item.memoryId, reason: 'a cópia não confere mais no momento da limpeza' })
      continue
    }
    await memories.deleteOne({ _id: new ObjectId(item.memoryId), tenantId })
    await migrations.updateOne({ _id: new ObjectId(item.memoryId) }, { $set: { at: new Date() } })
    fora.deleted += 1
  }
  return fora
}
