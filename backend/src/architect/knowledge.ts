import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { deleteDocumentFor } from '../knowledge.js'
import type { KnowledgeOwnerType } from '../knowledge.js'
import { saveDocument } from '../knowledgeService.js'
import { resolveKnowledgeOwner } from '../knowledgeScope.js'
import { scopeKeyOf } from '../memory/records.js'
import { ensureDefaultBuilding } from '../building.js'
import type { BlueprintKnowledgeRequirement } from './types.js'

// Onde o conhecimento de cada escopo REALMENTE mora — agora, um lugar só.
//
// Antes eram dois mecanismos, e a divisão não era uma escolha de produto: a base de
// conhecimento só aceitava `agent` e `sector`, então andar e prédio caíam na memória
// determinística por falta de alternativa. O efeito era visível: o cardápio salvo no
// andar não era encontrado por busca semântica, não aparecia na base de nenhum agente e
// não contava para a cota — ele existia num registro com chave, ao lado de fatos de
// execução, que é outra coisa.
//
// Com `KnowledgeOwnerType` cobrindo os quatro escopos, os quatro vão para a base
// canônica: mesmo chunking, mesmo embedding, mesmo índice. A memória continua sendo o
// que ela sempre foi — fato acumulado por execução —, e o que o Arquiteto grava é
// conhecimento curado, aprovado item a item por uma pessoa.

export type KnowledgeScope = BlueprintKnowledgeRequirement['scope']

/**
 * Todo escopo usa a base de conhecimento.
 *
 * Mantida como função (e não apagada) porque ela é o ponto onde a pergunta é feita: se
 * um dia um escopo voltar a ter outro mecanismo, é aqui que isso é dito, e não em cinco
 * condicionais espalhadas.
 */
export const usesKnowledgeBase = (_scope: KnowledgeScope): boolean => true

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
 *
 * A cota da conta é conferida por `saveDocument` — o mesmo caminho das telas. Um
 * escritório aplicado não pode ser a porta por onde o conhecimento entra sem medida.
 */
export async function writeArchitectKnowledge(
  ownerId: string,
  req: BlueprintKnowledgeRequirement,
  conteudo: string,
  alvos: KnowledgeTargetIds,
): Promise<{ id: string; mechanism: 'knowledge' | 'memory' }> {
  const owner = await donoDoEscopo(ownerId, req, alvos)
  const doc = await saveDocument(
    ownerId,
    owner,
    {
      title: req.title,
      content: conteudo,
      source: 'architect',
      /**
       * A marca estável desta proposta.
       *
       * Reaplicar a mesma proposta não pode somar uma segunda cópia do cardápio — e o
       * índice único de `(ownerType, ownerId, sourceRef)` é quem garante isso no banco,
       * inclusive contra duas aplicações simultâneas.
       */
      sourceRef: `architect:${req.key}`,
      authorId: ownerId,
      // Conhecimento aprovado item a item por uma pessoa antes de ser aplicado.
      lifecycleStatus: 'approved',
      maxContent: null,
    },
  )
  return { id: doc._id.toString(), mechanism: 'knowledge' }
}

const NOME_DO_ESCOPO: Record<KnowledgeScope, string> = { agent: 'agente', sector: 'setor', floor: 'andar', building: 'prédio' }

async function donoDoEscopo(ownerId: string, req: BlueprintKnowledgeRequirement, alvos: KnowledgeTargetIds): Promise<{ ownerType: KnowledgeOwnerType; ownerId: ObjectId }> {
  if (req.scope === 'building') {
    // O prédio é UM por conta e não vem do blueprint: quem o resolve é o servidor.
    const predio = await ensureDefaultBuilding(ownerId)
    return { ownerType: 'building', ownerId: predio._id }
  }
  const id = alvos.resolve(req.scope, req.targetKey ?? '')
  if (!id || !ObjectId.isValid(id)) {
    throw new KnowledgeTargetMissing(`o ${NOME_DO_ESCOPO[req.scope]} de "${req.title}" não foi criado`)
  }
  return { ownerType: req.scope, ownerId: new ObjectId(id) }
}

/**
 * Existe de verdade? É o que a reconferência pergunta.
 *
 * O documento não guarda o id da CONTA — ele guarda o do dono. Por isso a conferência
 * passa pelo dono: existir não basta, precisa ser desta conta. O id vem do registro da
 * própria operação, então na prática ele já é daqui; conferir mesmo assim é o que
 * mantém a regra valendo se um dia esse registro passar a vir de outro lugar.
 */
export async function architectKnowledgeExists(ownerId: string, _scope: KnowledgeScope, id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false
  const doc = await db.collection('knowledge_documents').findOne({ _id: new ObjectId(id) }, { projection: { ownerType: 1, ownerId: 1, agentId: 1 } })
  if (!doc) return false
  const dono = await resolveKnowledgeOwner(ownerId, {
    scopeType: (doc.ownerType ?? 'agent') as KnowledgeOwnerType,
    scopeId: (doc.ownerId ?? doc.agentId)?.toString() ?? null,
  })
  return Boolean(dono)
}

/**
 * Remove pelo caminho canônico.
 *
 * Documento sai por `deleteDocumentFor`, que apaga os CHUNKS junto — um `deleteOne` na
 * coleção de documentos deixaria os pedaços indexados para trás, e eles continuariam
 * aparecendo na busca de um documento que não existe mais.
 */
export async function deleteArchitectKnowledge(_ownerId: string, _scope: KnowledgeScope, id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false
  const oid = new ObjectId(id)
  const doc = await db.collection('knowledge_documents').findOne({ _id: oid }, { projection: { ownerType: 1, ownerId: 1, agentId: 1 } })
  if (!doc) return false
  return deleteDocumentFor({ ownerType: (doc.ownerType ?? 'agent') as KnowledgeOwnerType, ownerId: (doc.ownerId ?? doc.agentId) as ObjectId }, oid)
}

export { scopeKeyOf }
