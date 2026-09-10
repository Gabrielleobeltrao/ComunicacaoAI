import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import * as L from './limits.js'
import { maskSecrets } from './secrets.js'
import type { OperationBrief } from './brief.js'
import type { CriticFinding } from './critic.js'
import type { SimulationRun } from './simulate.js'
import type {
  ApplyStatus,
  ApplyStepResult,
  AssistantApplyState,
  AssistantAssumption,
  AssistantChecklistItem,
  AssistantLocale,
  AssistantReadiness,
  AssistantStatus,
  BlueprintLayer,
  OfficeBlueprintV1,
} from './types.js'
import type { OfficeBlueprintV2 } from './typesV2.js'
import type { AcceptanceResult } from './acceptance.js'

// A persistência do Assistente. Três coleções, todas com `ownerId` no filtro de TODA
// consulta — não há função aqui que aceite um id sem o dono junto, o que torna
// impossível ler o projeto de outra conta por engano.

export interface AssistantProject {
  _id: ObjectId
  ownerId: string
  title: string
  objective: string
  locale: AssistantLocale
  status: AssistantStatus
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
  /** As OPÇÕES, quando a pergunta é de escolha fechada. Opcional: perguntas gravadas
   *  antes desta versão não têm o campo, e continuam válidas — o cliente cai no campo
   *  aberto, que é como elas sempre funcionaram. */
  pendingQuestion: { key: string; text: string; choices?: { value: string; label: string }[] } | null
  assumptions: AssistantAssumption[]
  /** A constituição vigente quando a proposta foi montada. Ausente nos projetos antigos. */
  assistantConstitutionVersion?: number
  /**
   * O ENTENDIMENTO do negócio — o artefato que vem antes do desenho.
   *
   * Ausente nos projetos criados antes desta versão: eles continuam funcionando pelo
   * caminho antigo (conversa → blueprint), e é isso que os mantém abertos.
   */
  brief?: OperationBrief
  /**
   * A versão anterior do Brief, para desfazer a última mudança.
   *
   * Uma só, pelo mesmo motivo do `previousBlueprint`: o que se perde numa correção se
   * perde entre a versão que a pessoa leu e a que está na tela.
   */
  previousBrief?: OperationBrief | null
  blueprintVersion: 1 | 2
  /**
   * O plano V2 — recursos e operações, além da organização.
   *
   * Ausente nos projetos que já existem, e é o que os mantém funcionando: sem ele a
   * aplicação roda só a saga do V1, exatamente como rodava antes.
   */
  blueprintV2?: OfficeBlueprintV2 | null
  /**
   * O PLANO INTEIRO — as três camadas juntas, cada item marcado com a sua.
   *
   * O que a pessoa aprova e o que a aplicação escreve é o RECORTE da camada escolhida;
   * guardar o plano inteiro é o que permite trocar de camada sem refazer a conversa, e
   * o que faz "Recomendado" ser o mesmo plano de "Essencial" com mais coisa — não outra
   * proposta.
   */
  blueprint: OfficeBlueprintV1 | null
  /**
   * A camada escolhida. Ausente nos projetos anteriores às camadas: eles não têm item
   * marcado, então o recorte é o plano inteiro e nada muda para eles.
   */
  layer?: BlueprintLayer
  /**
   * Este plano veio do COMPILADOR, e não do modelo.
   *
   * Só um plano compilado pode ser recompilado quando o Brief muda: recompilar o
   * desenho que o modelo fez trocaria as chaves de tudo — e, num projeto aplicado,
   * chave nova é recurso novo ao lado do que já existe.
   */
  compiled?: boolean
  /**
   * A proposta ANTERIOR, para o dono ver o que a revisão mexeu.
   *
   * Uma só, e não um histórico: o que se perde numa revisão se perde entre a versão
   * que a pessoa leu e a que está na tela. Ausente nos projetos que já existiam — e
   * ausente é "não há o que comparar", nunca "nada mudou".
   */
  previousBlueprint?: OfficeBlueprintV1 | null
  /**
   * O mesmo, do lado V2 — e sem ele metade da comparação é cega.
   *
   * Base, conjunto, fonte e janela vivem só aqui. Enquanto só o V1 era guardado, uma
   * revisão que trocava o tamanho da janela ou acrescentava um campo ao conjunto não tinha
   * com o que ser comparada, e a tela de mudanças ficava vazia. Ausente nos projetos que
   * já existiam, com o mesmo sentido de sempre: não há o que comparar.
   */
  previousBlueprintV2?: OfficeBlueprintV2 | null
  /**
   * O último ensaio da operação — cenários e resultados, versionados.
   *
   * Guardado no projeto para poder ser COMPARADO entre revisões: "o que quebrou desde a
   * versão que eu aprovei?" só tem resposta se o ensaio anterior ficou registrado.
   */
  simulation?: SimulationRun | null
  blueprintHash: string | null
  /**
   * A leitura auxiliar do modelo sobre ESTA revisão.
   *
   * Guardada com o hash de quando foi feita: se a proposta mudou, a leitura fala de
   * outro desenho e é descartada na hora de mostrar. Guardar sem o hash faria a tela
   * apontar problema em agente que já não existe.
   */
  llmCritique?: { hash: string; findings: CriticFinding[]; status: 'ok' | 'failed'; createdAt: Date } | null
  checklist: AssistantChecklistItem[]
  readiness: AssistantReadiness
  applyState: AssistantApplyState | null
  createdAt: Date
  updatedAt: Date
  appliedAt: Date | null
}

export interface AssistantMessage {
  _id: ObjectId
  ownerId: string
  projectId: ObjectId
  role: 'user' | 'assistant' | 'system_notice'
  content: string
  /**
   * Este aviso é uma FALHA do provedor — e não, por exemplo, o aviso de credencial
   * removida. A distinção existe porque só a falha é resolvida por uma rodada que dá
   * certo depois; o aviso de credencial continua valendo para sempre.
   */
  failure?: boolean
  /**
   * PROVISÓRIA — vale só até a resposta de verdade chegar.
   *
   * O aviso de "abri a conversa, já volto" existe para a pessoa não ficar com um pedido sem
   * resposta caso a montagem falhe. Quando a montagem dá certo — segundos depois — ele vira
   * ruído entre o pedido e a resposta. Então ele SAI, em vez de acumular.
   */
  provisional?: boolean
  /** Quando uma rodada seguinte funcionou. A mensagem fica; o alarme, não. */
  resolvedAt?: Date | null
  createdAt: Date
}

export interface AssistantApplyOperation {
  _id: ObjectId
  ownerId: string
  projectId: ObjectId
  blueprintHash: string
  idempotencyKey: string
  status: ApplyStatus
  /** `kind:key` → id do recurso real. É o que faz repetir a aplicação não duplicar. */
  resourceMap: Record<string, string>
  steps: ApplyStepResult[]
  /**
   * O que os testes de aceitação observaram nesta operação.
   *
   * Fica na operação, e não no projeto, porque é a prova DESTA aplicação: uma nova aplicação
   * tem que provar de novo. Ausente nas operações anteriores aos testes.
   */
  acceptance?: AcceptanceResult[]
  error: string | null
  /** Até quando esta operação está tomada por um processo. Ver `claimOperation`. */
  leaseUntil?: Date | null
  startedAt: Date
  completedAt: Date | null
}

const projects = db.collection<AssistantProject>('assistant_projects')
const messages = db.collection<AssistantMessage>('assistant_messages')
const operations = db.collection<AssistantApplyOperation>('assistant_apply_operations')

/**
 * O NOME MUDOU; OS DADOS NÃO PODEM MUDAR DE DONO.
 *
 * "Arquiteto" virou "Assistente" no produto, nas rotas, no código e nos nomes das coleções.
 * Quem já usava tem projetos, conversas e operações gravados em `architect_*` — e o código
 * novo lê `assistant_*`. Sem esta migração, subir a mudança é a conta abrir vazia.
 *
 * IDEMPOTENTE de propósito: roda em todo boot. Num banco já migrado, ou num que nunca teve
 * o nome antigo, ela não faz nada. E se os DOIS nomes existirem — o estado de um deploy
 * pela metade — ela não renomeia por cima: o que já foi gravado no nome novo é mais recente
 * que o retrato antigo, e sobrescrever perderia justamente o trabalho de agora.
 */
export async function migrarNomesDoAssistente(): Promise<void> {
  const existentes = new Set((await db.listCollections().toArray()).map((c) => c.name))
  const pares: [string, string][] = [
    ['architect_projects', 'assistant_projects'],
    ['architect_messages', 'assistant_messages'],
    ['architect_apply_operations', 'assistant_apply_operations'],
    ['architect_pending_operations', 'assistant_pending_operations'],
  ]
  for (const [antigo, novo] of pares) {
    if (!existentes.has(antigo)) continue
    if (!existentes.has(novo)) {
      await db.renameCollection(antigo, novo).catch(() => undefined)
      continue
    }
    /**
     * AS DUAS EXISTEM — e desistir aqui foi o que sumiu com o histórico de quem já usava.
     *
     * Bastou o primeiro documento cair no nome novo antes de a migração rodar: a partir
     * dali ela via as duas coleções e não fazia nada, para sempre. O dono continuava com os
     * projetos e as conversas dele no banco, e não via nenhum — pior que um erro, porque
     * nada avisa.
     *
     * Então o que sobrou no nome antigo é COPIADO, um a um, sem tocar em quem já está no
     * nome novo (`$setOnInsert` pelo `_id`) e sem apagar a origem. Rodar de novo não muda
     * nada, e o dado antigo continua onde estava caso algo tenha de ser conferido.
     */
    const restantes = db.collection(antigo).find({}).batchSize(200)
    const destino = db.collection(novo)
    for await (const doc of restantes) {
      const { _id, ...resto } = doc
      await destino.updateOne({ _id }, { $setOnInsert: resto }, { upsert: true }).catch(() => undefined)
    }
  }

  /**
   * A MARCA DE ORIGEM dentro dos recursos criados.
   *
   * É por ela que "desfazer" sabe o que a aplicação criou. Deixada para trás, o rollback
   * deixaria de reconhecer o que ele mesmo tinha feito — e o que ele não reconhece, ele não
   * remove. `$rename` move o campo; nenhum documento fica com os dois.
   */
  for (const colecao of ['agents', 'offices', 'sectors', 'automations', 'data_stores', 'dataset_definitions', 'monitoring_sources', 'monitors', 'widgets', 'tools']) {
    if (!existentes.has(colecao)) continue
    await db
      .collection(colecao)
      .updateMany({ architect: { $exists: true } }, { $rename: { architect: 'assistant' } })
      .catch(() => undefined)
  }
}

export async function ensureAssistantIndexes(): Promise<void> {
  // A migração vem ANTES dos índices: criar índice numa coleção que ainda vai ser renomeada
  // deixaria o índice para trás com o nome velho.
  await migrarNomesDoAssistente()
  await projects.createIndex({ ownerId: 1, updatedAt: -1 })
  await projects.createIndex({ ownerId: 1, status: 1, updatedAt: -1 })
  await messages.createIndex({ ownerId: 1, projectId: 1, createdAt: 1 })
  await operations.createIndex({ ownerId: 1, projectId: 1, startedAt: -1 })
  // A chave de idempotência é o que garante que dois cliques em "aplicar" sejam uma
  // aplicação só. Único por dono+projeto+chave, e é o índice que decide — não um
  // `findOne` antes do insert, que perde a corrida.
  await operations.createIndex({ ownerId: 1, projectId: 1, idempotencyKey: 1 }, { unique: true })

  // A marca de origem, nas coleções que o Assistente cria.
  //
  // ÚNICO e PARCIAL: único porque a mesma aplicação não pode produzir dois recursos
  // para a mesma `key` — a janela entre criar e registrar o passo é onde isso
  // aconteceria, e aqui o banco recusa em vez de duplicar. Parcial porque tudo que
  // existia antes, e tudo criado pelas telas normais, não tem marca nenhuma: sem o
  // filtro, o índice trataria todos esses documentos como a mesma chave nula.
  for (const nome of ['offices', 'agents', 'sectors', 'automations']) {
    await db
      .collection(nome)
      .createIndex(
        { ownerId: 1, 'assistant.operationId': 1, 'assistant.blueprintKey': 1 },
        { unique: true, partialFilterExpression: { 'assistant.operationId': { $exists: true } }, name: 'assistant_origin_unique' },
      )
      .catch(() => undefined)
  }
}

export const emptyReadiness = (): AssistantReadiness => ({
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
  input: { title: string; objective: string; locale?: AssistantLocale; provider?: 'anthropic' | 'openai'; model?: string | null },
): Promise<AssistantProject> {
  const now = new Date()
  const doc: AssistantProject = {
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

export const getProject = (ownerId: string, id: ObjectId): Promise<AssistantProject | null> => projects.findOne({ _id: id, ownerId })

export function listProjects(ownerId: string, q: { includeArchived?: boolean; limit: number; skip: number }): Promise<AssistantProject[]> {
  const filtro: Record<string, unknown> = { ownerId }
  if (!q.includeArchived) filtro.status = { $ne: 'archived' }
  return projects.find(filtro).sort({ updatedAt: -1 }).skip(q.skip).limit(q.limit).toArray()
}

export async function patchProject(ownerId: string, id: ObjectId, patch: Partial<Omit<AssistantProject, '_id' | 'ownerId' | 'createdAt'>>): Promise<AssistantProject | null> {
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
  de: AssistantStatus[],
  para: AssistantStatus,
  extra: Partial<AssistantProject> = {},
): Promise<AssistantProject | null> {
  const r = await projects.findOneAndUpdate(
    { _id: id, ownerId, status: { $in: de } },
    { $set: { status: para, ...extra, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )
  return r ?? null
}

// --- mensagens --------------------------------------------------------------------------

export const countMessages = (ownerId: string, projectId: ObjectId): Promise<number> => messages.countDocuments({ ownerId, projectId })

export async function appendMessage(
  ownerId: string,
  projectId: ObjectId,
  role: AssistantMessage['role'],
  content: string,
  opts: { failure?: boolean; provisional?: boolean } = {},
): Promise<AssistantMessage> {
  const doc: AssistantMessage = {
    _id: new ObjectId(),
    ownerId,
    projectId,
    role,
    // Mascarado na ENTRADA. Depois de gravado já é tarde.
    content: maskSecrets(content).slice(0, L.MAX_MESSAGE_CHARS),
    ...(opts.failure ? { failure: true, resolvedAt: null } : {}),
    ...(opts.provisional ? { provisional: true } : {}),
    createdAt: new Date(),
  }
  await messages.insertOne(doc)
  return doc
}

/**
 * Marca como resolvidas as falhas anteriores desta conversa.
 *
 * A falha fica registrada — apagar histórico seria pior. O que não pode continuar é o
 * alarme: depois de a pessoa configurar a chave e a rodada seguinte funcionar, o aviso
 * vermelho de ontem continuava na tela parecendo o de agora.
 */
export async function resolveFailureNotices(ownerId: string, projectId: ObjectId): Promise<void> {
  await messages.updateMany({ ownerId, projectId, role: 'system_notice', failure: true, resolvedAt: null }, { $set: { resolvedAt: new Date() } })
}

/** Apaga o "já volto" desta conversa. Chamado quando a resposta de verdade vai ser gravada. */
export async function clearProvisionalMessages(ownerId: string, projectId: ObjectId): Promise<void> {
  await messages.deleteMany({ ownerId, projectId, provisional: true })
}

export function listMessages(ownerId: string, projectId: ObjectId, q: { limit: number; skip: number }): Promise<AssistantMessage[]> {
  return messages.find({ ownerId, projectId }).sort({ createdAt: 1 }).skip(q.skip).limit(q.limit).toArray()
}

/** As últimas N, em ordem cronológica — o contexto que vai para o modelo. */
export async function recentMessages(ownerId: string, projectId: ObjectId, limit: number): Promise<AssistantMessage[]> {
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
): Promise<{ operation: AssistantApplyOperation; created: boolean }> {
  const doc: AssistantApplyOperation = {
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

export const getOperation = (ownerId: string, id: ObjectId): Promise<AssistantApplyOperation | null> => operations.findOne({ _id: id, ownerId })

/**
 * Toma a operação para si — atomicamente.
 *
 * O estado do PROJETO não basta para segurar duas retomadas: um projeto travado em
 * `applying` (o processo caiu antes de fechar) aceita retomar, e duas abas pedindo ao
 * mesmo tempo passariam as duas por lá. O que decide é este `findOneAndUpdate`: quem
 * pegar o arrendamento continua, o outro recebe `false` e para.
 *
 * O arrendamento EXPIRA. Sem isso, uma queda no meio da retomada deixaria a operação
 * travada para sempre, e o dono sem nenhum caminho de volta.
 */
export async function claimOperation(ownerId: string, id: ObjectId, leaseMs = 5 * 60_000, agora = new Date()): Promise<boolean> {
  const r = await operations.findOneAndUpdate(
    {
      _id: id,
      ownerId,
      status: { $in: ['running', 'failed'] },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lt: agora } }],
    },
    { $set: { leaseUntil: new Date(agora.getTime() + leaseMs), status: 'running' } },
    { returnDocument: 'after' },
  )
  return Boolean(r)
}

/** Devolve o arrendamento ao terminar, para uma retomada seguinte não esperar o prazo. */
export async function releaseOperation(ownerId: string, id: ObjectId): Promise<void> {
  await operations.updateOne({ _id: id, ownerId }, { $set: { leaseUntil: null } })
}

export const lastOperation = (ownerId: string, projectId: ObjectId): Promise<AssistantApplyOperation | null> =>
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

/** Grava o que os testes viram. Substitui: a prova é a da última rodada, não um histórico. */
export async function recordAcceptance(ownerId: string, operationId: ObjectId, acceptance: AcceptanceResult[]): Promise<void> {
  await operations.updateOne({ _id: operationId, ownerId }, { $set: { acceptance } })
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
