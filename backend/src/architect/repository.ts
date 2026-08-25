import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import * as L from './limits.js'
import { maskSecrets } from './secrets.js'
import type {
  ApplyStatus,
  ApplyStepResult,
  ArchitectApplyState,
  ArchitectAssumption,
  ArchitectChecklistItem,
  ArchitectLocale,
  ArchitectReadiness,
  ArchitectStatus,
  OfficeBlueprintV1,
} from './types.js'

// A persistência do Arquiteto. Três coleções, todas com `ownerId` no filtro de TODA
// consulta — não há função aqui que aceite um id sem o dono junto, o que torna
// impossível ler o projeto de outra conta por engano.

export interface ArchitectProject {
  _id: ObjectId
  ownerId: string
  title: string
  objective: string
  locale: ArchitectLocale
  status: ArchitectStatus
  provider: 'anthropic' | 'openai'
  model: string | null
  answers: Record<string, unknown>
  /**
   * A pergunta que está no ar agora.
   *
   * Sem ela, a próxima mensagem da pessoa é só texto solto: o modelo teria que
   * redescobrir a cada rodada o que já foi perguntado, e a mesma pergunta voltaria.
   * Guardando a chave, a resposta vira resposta — registrada, e não perguntada de novo.
   */
  pendingQuestion: { key: string; text: string } | null
  assumptions: ArchitectAssumption[]
  blueprintVersion: 1
  blueprint: OfficeBlueprintV1 | null
  blueprintHash: string | null
  checklist: ArchitectChecklistItem[]
  readiness: ArchitectReadiness
  applyState: ArchitectApplyState | null
  createdAt: Date
  updatedAt: Date
  appliedAt: Date | null
}

export interface ArchitectMessage {
  _id: ObjectId
  ownerId: string
  projectId: ObjectId
  role: 'user' | 'assistant' | 'system_notice'
  content: string
  createdAt: Date
}

export interface ArchitectApplyOperation {
  _id: ObjectId
  ownerId: string
  projectId: ObjectId
  blueprintHash: string
  idempotencyKey: string
  status: ApplyStatus
  /** `kind:key` → id do recurso real. É o que faz repetir a aplicação não duplicar. */
  resourceMap: Record<string, string>
  steps: ApplyStepResult[]
  error: string | null
  startedAt: Date
  completedAt: Date | null
}

const projects = db.collection<ArchitectProject>('architect_projects')
const messages = db.collection<ArchitectMessage>('architect_messages')
const operations = db.collection<ArchitectApplyOperation>('architect_apply_operations')

export async function ensureArchitectIndexes(): Promise<void> {
  await projects.createIndex({ ownerId: 1, updatedAt: -1 })
  await projects.createIndex({ ownerId: 1, status: 1, updatedAt: -1 })
  await messages.createIndex({ ownerId: 1, projectId: 1, createdAt: 1 })
  await operations.createIndex({ ownerId: 1, projectId: 1, startedAt: -1 })
  // A chave de idempotência é o que garante que dois cliques em "aplicar" sejam uma
  // aplicação só. Único por dono+projeto+chave, e é o índice que decide — não um
  // `findOne` antes do insert, que perde a corrida.
  await operations.createIndex({ ownerId: 1, projectId: 1, idempotencyKey: 1 }, { unique: true })
}

export const emptyReadiness = (): ArchitectReadiness => ({
  requiredDone: 0,
  requiredTotal: 0,
  optionalDone: 0,
  optionalTotal: 0,
  ready: false,
  blockers: [],
})

export async function countProjects(ownerId: string): Promise<number> {
  return projects.countDocuments({ ownerId, status: { $ne: 'archived' } })
}

export async function createProject(
  ownerId: string,
  input: { title: string; objective: string; locale?: ArchitectLocale; provider?: 'anthropic' | 'openai'; model?: string | null },
): Promise<ArchitectProject> {
  const now = new Date()
  const doc: ArchitectProject = {
    _id: new ObjectId(),
    ownerId,
    title: input.title.slice(0, L.MAX_TITLE_CHARS),
    objective: maskSecrets(input.objective).slice(0, L.MAX_LONG_TEXT_CHARS),
    locale: input.locale ?? 'pt',
    status: 'discovery',
    provider: input.provider ?? 'anthropic',
    model: input.model ?? null,
    answers: {},
    pendingQuestion: null,
    assumptions: [],
    blueprintVersion: 1,
    blueprint: null,
    blueprintHash: null,
    checklist: [],
    readiness: emptyReadiness(),
    applyState: null,
    createdAt: now,
    updatedAt: now,
    appliedAt: null,
  }
  await projects.insertOne(doc)
  return doc
}

export const getProject = (ownerId: string, id: ObjectId): Promise<ArchitectProject | null> => projects.findOne({ _id: id, ownerId })

export function listProjects(ownerId: string, q: { includeArchived?: boolean; limit: number; skip: number }): Promise<ArchitectProject[]> {
  const filtro: Record<string, unknown> = { ownerId }
  if (!q.includeArchived) filtro.status = { $ne: 'archived' }
  return projects.find(filtro).sort({ updatedAt: -1 }).skip(q.skip).limit(q.limit).toArray()
}

export async function patchProject(ownerId: string, id: ObjectId, patch: Partial<Omit<ArchitectProject, '_id' | 'ownerId' | 'createdAt'>>): Promise<ArchitectProject | null> {
  const r = await projects.findOneAndUpdate(
    { _id: id, ownerId },
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  return r ?? null
}

/**
 * A troca de estado ATÔMICA — o lock do projeto.
 *
 * Só muda se o estado atual for um dos esperados. É o que impede dois "aplicar"
 * simultâneos: o segundo não encontra o documento em `ready` e sai sem escrever nada.
 * Um `findOne` seguido de `updateOne` perderia essa corrida.
 */
export async function transitionProject(
  ownerId: string,
  id: ObjectId,
  de: ArchitectStatus[],
  para: ArchitectStatus,
  extra: Partial<ArchitectProject> = {},
): Promise<ArchitectProject | null> {
  const r = await projects.findOneAndUpdate(
    { _id: id, ownerId, status: { $in: de } },
    { $set: { status: para, ...extra, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  return r ?? null
}

// --- mensagens --------------------------------------------------------------------------

export const countMessages = (ownerId: string, projectId: ObjectId): Promise<number> => messages.countDocuments({ ownerId, projectId })

export async function appendMessage(ownerId: string, projectId: ObjectId, role: ArchitectMessage['role'], content: string): Promise<ArchitectMessage> {
  const doc: ArchitectMessage = {
    _id: new ObjectId(),
    ownerId,
    projectId,
    role,
    // Mascarado na ENTRADA. Depois de gravado já é tarde.
    content: maskSecrets(content).slice(0, L.MAX_MESSAGE_CHARS),
    createdAt: new Date(),
  }
  await messages.insertOne(doc)
  return doc
}

export function listMessages(ownerId: string, projectId: ObjectId, q: { limit: number; skip: number }): Promise<ArchitectMessage[]> {
  return messages.find({ ownerId, projectId }).sort({ createdAt: 1 }).skip(q.skip).limit(q.limit).toArray()
}

/** As últimas N, em ordem cronológica — o contexto que vai para o modelo. */
export async function recentMessages(ownerId: string, projectId: ObjectId, limit: number): Promise<ArchitectMessage[]> {
  const ultimas = await messages.find({ ownerId, projectId }).sort({ createdAt: -1 }).limit(limit).toArray()
  return ultimas.reverse()
}

// --- operações de aplicação ----------------------------------------------------------------

export class DuplicateApplyError extends Error {}

/**
 * Abre a operação, ou devolve a que já existe para a mesma chave.
 *
 * O índice único é quem decide. Duas chamadas com a mesma `idempotencyKey` produzem
 * uma operação só, e a segunda recebe a primeira de volta — que é exatamente o que
 * "aplicar duas vezes não duplica" significa.
 */
export async function openOperation(
  ownerId: string,
  projectId: ObjectId,
  blueprintHash: string,
  idempotencyKey: string,
): Promise<{ operation: ArchitectApplyOperation; created: boolean }> {
  const doc: ArchitectApplyOperation = {
    _id: new ObjectId(),
    ownerId,
    projectId,
    blueprintHash,
    idempotencyKey,
    status: 'running',
    resourceMap: {},
    steps: [],
    error: null,
    startedAt: new Date(),
    completedAt: null,
  }
  try {
    await operations.insertOne(doc)
    return { operation: doc, created: true }
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error
    const existente = await operations.findOne({ ownerId, projectId, idempotencyKey })
    if (!existente) throw error
    return { operation: existente, created: false }
  }
}

export const getOperation = (ownerId: string, id: ObjectId): Promise<ArchitectApplyOperation | null> => operations.findOne({ _id: id, ownerId })

export const lastOperation = (ownerId: string, projectId: ObjectId): Promise<ArchitectApplyOperation | null> =>
  operations.find({ ownerId, projectId }).sort({ startedAt: -1 }).limit(1).next()

/**
 * Grava o resultado de UM passo e o recurso que ele produziu, juntos.
 *
 * Numa escrita só: um passo registrado sem o id do recurso faria a retomada criar de
 * novo o que já existe.
 */
export async function recordStep(ownerId: string, operationId: ObjectId, step: ApplyStepResult): Promise<void> {
  const set: Record<string, unknown> = {}
  if (step.resourceId) set[`resourceMap.${step.kind}:${step.key}`] = step.resourceId
  await operations.updateOne({ _id: operationId, ownerId }, { $push: { steps: step }, ...(Object.keys(set).length ? { $set: set } : {}) })
}

export async function finishOperation(ownerId: string, operationId: ObjectId, status: ApplyStatus, error: string | null): Promise<void> {
  await operations.updateOne({ _id: operationId, ownerId }, { $set: { status, error, completedAt: new Date() } })
}

/** Só para a limpeza dos testes e para arquivar: remove nada por conta própria. */
export async function deleteProjectData(ownerId: string, projectId: ObjectId): Promise<void> {
  await messages.deleteMany({ ownerId, projectId })
  await operations.deleteMany({ ownerId, projectId })
  await projects.deleteOne({ _id: projectId, ownerId })
}
