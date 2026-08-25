import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { createDocumentFor, deleteDocumentFor } from '../knowledge.js'
import { writeMemory, deleteMemory, scopeKeyOf } from '../memory/records.js'
import { ensureDefaultBuilding } from '../building.js'
import type { BlueprintKnowledgeRequirement } from './types.js'

// Onde o conhecimento de cada escopo REALMENTE mora.
//
// O produto tem dois mecanismos, e eles não são intercambiáveis:
//
//   agent, sector    → base de conhecimento (documento + chunks, busca semântica)
//   floor, building  → memória determinística (registro com chave, sem embedding)
//
// A base de conhecimento aceita `agent` e `sector` e nada mais — é o que
// `KnowledgeOwnerType` declara. Mandar um andar para lá exigiria inventar um dono, e
// inventar um dono é exatamente o defeito que este módulo existe para não ter: um
// documento gravado sob um ObjectId que não é de ninguém fica invisível na tela do
// andar, invisível na do agente, e ocupando espaço para sempre.

export type KnowledgeScope = BlueprintKnowledgeRequirement['scope']

/** O escopo usa a base de conhecimento (indexada) ou a memória determinística? */
export const usesKnowledgeBase = (scope: KnowledgeScope): boolean => scope === 'agent' || scope === 'sector'

export interface KnowledgeTargetIds {
  /** `kind:key` → id real, vindo do resourceMap da operação. */
  resolve: (kind: string, key: string) => string | undefined
}

export class KnowledgeTargetMissing extends Error {}

/**
 * Grava o conteúdo no lugar canônico do escopo e devolve o id do que foi criado.
 *
 * Um alvo que não está no mapa é ERRO, nunca um id novo: a etapa falha, a operação
 * fica retomável e nada é gravado sob um dono inventado.
 */
export async function writeArchitectKnowledge(
  ownerId: string,
  req: BlueprintKnowledgeRequirement,
  conteudo: string,
  alvos: KnowledgeTargetIds,
): Promise<{ id: string; mechanism: 'knowledge' | 'memory' }> {
  if (req.scope === 'agent' || req.scope === 'sector') {
    const id = alvos.resolve(req.scope, req.targetKey ?? '')
    if (!id || !ObjectId.isValid(id)) {
      throw new KnowledgeTargetMissing(`o ${req.scope === 'agent' ? 'agente' : 'setor'} de "${req.title}" não foi criado`)
    }
    const doc = await createDocumentFor({ ownerType: req.scope, ownerId: new ObjectId(id) }, { title: req.title, content: conteudo, source: 'architect' })
    return { id: doc._id.toString(), mechanism: 'knowledge' }
  }

  // Andar e prédio: memória determinística, no mesmo alvo que a tela de Memória mostra.
  const target = await memoryTargetFor(ownerId, req, alvos)
  const r = await writeMemory({
    tenantId: ownerId,
    target,
    key: `arquiteto:${req.key}`,
    payload: { titulo: req.title, conteudo },
    // `upsert`: reaplicar a mesma proposta atualiza o mesmo registro em vez de somar
    // uma segunda cópia do cardápio.
    strategy: 'upsert',
    sourceType: 'architect',
    metadata: { title: req.title },
  })
  return { id: r.recordId, mechanism: 'memory' }
}

async function memoryTargetFor(ownerId: string, req: BlueprintKnowledgeRequirement, alvos: KnowledgeTargetIds) {
  if (req.scope === 'building') {
    // O prédio é UM por conta e não vem do blueprint: quem o resolve é o servidor.
    const predio = await ensureDefaultBuilding(ownerId)
    return { scope: 'building' as const, buildingId: predio._id }
  }
  const floorId = alvos.resolve('floor', req.targetKey ?? '')
  if (!floorId || !ObjectId.isValid(floorId)) throw new KnowledgeTargetMissing(`o andar de "${req.title}" não foi criado`)
  return { scope: 'floor' as const, floorId: new ObjectId(floorId) }
}

/** Existe de verdade? É o que a reconferência pergunta, e cada escopo responde no seu lugar. */
export async function architectKnowledgeExists(ownerId: string, scope: KnowledgeScope, id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false
  if (usesKnowledgeBase(scope)) {
    return Boolean(await db.collection('knowledge_documents').findOne({ _id: new ObjectId(id), ownerId: { $exists: true } }, { projection: { _id: 1 } }))
  }
  return Boolean(await db.collection('memories').findOne({ _id: new ObjectId(id), tenantId: ownerId }, { projection: { _id: 1 } }))
}

/**
 * Remove pelo caminho canônico de cada mecanismo.
 *
 * Documento sai por `deleteDocumentFor`, que apaga os CHUNKS junto — um `deleteOne` na
 * coleção de documentos deixaria os pedaços indexados para trás, e eles continuariam
 * aparecendo na busca de um documento que não existe mais.
 */
export async function deleteArchitectKnowledge(ownerId: string, scope: KnowledgeScope, id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false
  const oid = new ObjectId(id)
  if (usesKnowledgeBase(scope)) {
    const doc = await db.collection('knowledge_documents').findOne({ _id: oid }, { projection: { ownerType: 1, ownerId: 1 } })
    if (!doc) return false
    return deleteDocumentFor({ ownerType: doc.ownerType as 'agent' | 'sector', ownerId: doc.ownerId as ObjectId }, oid)
  }
  const registro = await db.collection('memories').findOne({ _id: oid, tenantId: ownerId }, { projection: { scopeKey: 1 } })
  if (!registro) return false
  return deleteMemory(ownerId, oid, [String(registro.scopeKey)])
}

export { scopeKeyOf }
