import { createHash, randomUUID } from 'node:crypto'
import { db } from '../db.js'
import { capabilityFor, inventoryFor, resolveByName } from './assistantCapabilities.js'
import type { ArchitectIntent } from './intent.js'

// A ESCRITA PEDIDA NA CONVERSA — e por que ela nunca acontece na conversa.
//
// "Pause a fonte de cotações" é uma frase. Executá-la direto do texto do modelo colocaria a
// decisão de mudar o escritório dentro de uma saída de linguagem — e uma frase parecida
// ("apague a fonte") mudaria a consequência sem mudar o caminho.
//
// Aqui a escrita vira uma OPERAÇÃO PENDENTE: prévia do que vai acontecer, impacto, um hash do
// que foi mostrado, e um prazo. Confirmar é outra requisição, para outro endpoint, com o hash
// em mãos. Quatro coisas separam isso de um botão bonito:
//
//   O HASH É DO QUE FOI MOSTRADO. Se o escritório mudar entre a prévia e o clique, a
//   confirmação é recusada e a pessoa revê. Confirmar sobre um retrato velho é o mesmo erro
//   que o purge de andar existe para evitar.
//
//   O PRAZO EXPIRA. Uma operação pendente de ontem não pode ser confirmada hoje: o "sim" foi
//   dado sobre um escritório que já não existe.
//
//   A IDEMPOTÊNCIA É POR OPERAÇÃO. Dois cliques confirmam uma vez.
//
//   ALTO RISCO PEDE O NOME. Apagar exige digitar o nome do recurso, como no purge de andar.

export const PENDING_OPERATION_TTL_MS = 10 * 60_000

export interface PendingOperation {
  id: string
  ownerId: string
  capabilityKey: string
  /** O que vai acontecer, em português — é o que a pessoa lê antes de confirmar. */
  summary: string
  impact: string[]
  /** O recurso resolvido AGORA. O modelo não escolheu este id: o inventário escolheu. */
  target: { kind: string; id: string; label: string } | null
  risk: 'write' | 'high_risk'
  /** O carimbo do que foi mostrado. Muda o escritório, muda o hash. */
  operationHash: string
  /** Alto risco exige digitar isto. Ausente quando não é alto risco. */
  confirmationName?: string
  expiresAt: Date
  createdAt: Date
  confirmedAt?: Date | null
}

const pendentes = db.collection<PendingOperation>('architect_pending_operations')

export async function ensurePendingOperationIndexes(): Promise<void> {
  await pendentes.createIndex({ ownerId: 1, createdAt: -1 })
  // O TTL limpa sozinho: uma operação vencida não é dado, é lixo com risco.
  await pendentes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

/** O hash cobre o alvo, a capacidade e o estado do recurso no instante da prévia. */
const hashDaOperacao = (parts: (string | null | undefined)[]): string =>
  createHash('sha256').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 32)

export type PrepareOutcome =
  | { ok: true; text: string; pending: { id: string; operationHash: string; summary: string; impact: string[]; expiresAt: string; requiresName?: string } }
  | { ok: false; reason: string }

/**
 * Monta a prévia de uma escrita pedida na conversa.
 *
 * Nada é escrito aqui — nem no recurso, nem em lugar nenhum além do registro da própria
 * operação pendente.
 */
export async function prepararOperacao(ownerId: string, intent: Extract<ArchitectIntent, { mode: 'operate' }>): Promise<PrepareOutcome> {
  const capacidade = capabilityFor('operate', intent.action)
  if (!capacidade) {
    return { ok: false, reason: 'não sei fazer isso ainda — sei listar, pausar e ativar fontes' }
  }
  if (capacidade.risk === 'read') {
    return { ok: false, reason: 'essa ação não muda nada: peça de novo e eu respondo direto' }
  }

  const inventory = await inventoryFor(ownerId)
  const achado = resolveByName(inventory, capacidade.kinds, intent.targetRef ?? intent.action)
  if (!achado) {
    return { ok: false, reason: `não achei qual recurso você quer para "${intent.action}" — me diga o nome exato` }
  }

  /**
   * O risco EFETIVO é o maior entre o que a capacidade declara e o que a intenção trouxe.
   *
   * O registro sabe que pausar é escrita; a intenção pode ter vindo como `high_risk` porque a
   * pessoa pediu algo irreversível. Escolher o menor dos dois seria deixar o modelo rebaixar
   * o risco de uma ação escrevendo uma palavra diferente.
   */
  const risco: 'write' | 'high_risk' = intent.risk === 'high_risk' || capacidade.risk === 'high_risk' ? 'high_risk' : 'write'

  const doc: PendingOperation = {
    id: randomUUID(),
    ownerId,
    capabilityKey: capacidade.key,
    summary: `${capacidade.title}: "${achado.item.label}"`,
    impact: [
      `${achado.kind === 'source' ? 'A fonte' : 'O recurso'} "${achado.item.label}" ${capacidade.key === 'pause_source' ? 'para de coletar até você reativar' : 'passa a operar'}.`,
      'Nada mais é alterado nesta operação.',
    ],
    target: { kind: achado.kind, id: achado.item.id, label: achado.item.label },
    risk: risco,
    operationHash: hashDaOperacao([capacidade.key, achado.kind, achado.item.id, achado.item.status, risco]),
    ...(risco === 'high_risk' ? { confirmationName: achado.item.label } : {}),
    expiresAt: new Date(Date.now() + PENDING_OPERATION_TTL_MS),
    createdAt: new Date(),
    confirmedAt: null,
  }
  await pendentes.insertOne(doc)

  return {
    ok: true,
    text: `${doc.summary}. ${doc.impact.join(' ')} Confirme para eu fazer — nada acontece até você confirmar.`,
    pending: {
      id: doc.id,
      operationHash: doc.operationHash,
      summary: doc.summary,
      impact: doc.impact,
      expiresAt: doc.expiresAt.toISOString(),
      ...(doc.confirmationName ? { requiresName: doc.confirmationName } : {}),
    },
  }
}

export type ConfirmOutcome =
  | { ok: true; text: string }
  | { ok: false; code: 'not_found' | 'expired' | 'hash_changed' | 'name_mismatch' | 'already_done' | 'refused'; reason: string }

/**
 * Confirma e executa — com o hash vigente, o prazo e a posse conferidos AGORA.
 *
 * O texto do modelo não chega até aqui: o que chega é o id de uma operação que o servidor
 * montou e o hash que ele mesmo carimbou.
 */
export async function confirmarOperacao(
  ownerId: string,
  input: { id: string; operationHash: string; confirmationName?: string },
): Promise<ConfirmOutcome> {
  const doc = await pendentes.findOne({ id: String(input.id ?? ''), ownerId })
  // Mesma resposta para "não existe" e "é de outra conta": distinguir contaria que existe.
  if (!doc) return { ok: false, code: 'not_found', reason: 'essa operação não existe mais' }
  if (doc.confirmedAt) return { ok: false, code: 'already_done', reason: 'essa operação já foi confirmada' }
  if (doc.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: 'expired', reason: 'essa confirmação venceu — peça de novo para eu montar a prévia atual' }
  }

  const capacidade = capabilityFor('operate', doc.capabilityKey) ?? null
  const { capabilityByKey } = await import('./assistantCapabilities.js')
  const handler = capabilityByKey(doc.capabilityKey) ?? capacidade
  if (!handler) return { ok: false, code: 'refused', reason: 'essa capacidade não existe mais' }

  /**
   * O RETRATO é conferido de novo: o hash é recalculado do estado de agora.
   *
   * Se a fonte mudou de status entre a prévia e o clique, o "sim" foi dado sobre outra coisa.
   */
  const inventory = await inventoryFor(ownerId)
  const atual = doc.target ? (inventory.sections[doc.target.kind]?.items ?? []).find((i) => i.id === doc.target!.id) : null
  if (!atual) return { ok: false, code: 'hash_changed', reason: 'o recurso mudou desde a prévia — peça de novo' }
  const hashAgora = hashDaOperacao([doc.capabilityKey, doc.target?.kind, doc.target?.id, atual.status, doc.risk])
  if (hashAgora !== doc.operationHash || String(input.operationHash ?? '') !== doc.operationHash) {
    return { ok: false, code: 'hash_changed', reason: 'o escritório mudou desde a prévia — revise e peça de novo' }
  }

  if (doc.confirmationName && String(input.confirmationName ?? '').trim() !== doc.confirmationName.trim()) {
    return { ok: false, code: 'name_mismatch', reason: `digite o nome "${doc.confirmationName}" para confirmar` }
  }

  /**
   * A MARCA vem antes da execução.
   *
   * Dois cliques na mesma operação confirmam uma vez: o `findOneAndUpdate` condicionado a
   * `confirmedAt: null` é o que torna a confirmação idempotente.
   */
  const tomada = await pendentes.findOneAndUpdate(
    { id: doc.id, ownerId, confirmedAt: null },
    { $set: { confirmedAt: new Date() } },
    { returnDocument: 'after' },
  )
  if (!tomada) return { ok: false, code: 'already_done', reason: 'essa operação já foi confirmada' }

  const r = await handler.run({ ownerId, inventory, query: doc.summary, ...(doc.target ? { targetRef: doc.target.label } : {}) })
  return r.ok ? { ok: true, text: r.text } : { ok: false, code: 'refused', reason: r.reason }
}

/** Só para o teste e para a limpeza: o registro não remove nada por conta própria. */
export const pendingOperationsCollection = pendentes
