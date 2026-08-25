import { ObjectId } from 'mongodb'
import { db } from '../db.js'

// O REGISTRO do que uma ação de App fez — separado de `grants.ts` porque a política
// precisa contar as ordens do dia, e `grants.ts` importa o catálogo de Apps, que
// importa o adapter da corretora, que chama a política. O ciclo não é teórico: ele
// quebrava o carregamento do módulo.
// Safe telemetry (plan §13): what ran, whether it worked and how long it took.
// Never an argument, never a response body, never a credential.
export interface AppActionEvent {
  _id: ObjectId
  ownerId: string
  agentId: ObjectId | null
  appKey: string
  actionKey: string
  installationId: ObjectId
  ok: boolean
  status: 'executed' | 'refused'
  durationMs: number
  createdAt: Date
  /**
   * O ambiente da conexão. Uma auditoria que não distingue simulação de produção não é
   * auditoria: as duas linhas ficam idênticas e só a conta sabe qual foi qual.
   */
  environment?: string
  /** O id da ordem na corretora, quando a ação produziu uma. É por ele que se reconcilia. */
  orderId?: string | null
  /** As regras conferidas antes de a ação sair, e o veredito. Nunca valores da conta. */
  policy?: { evaluated: string[]; allowed: boolean; violations: string[] } | null
}
const appActionEvents = db.collection<AppActionEvent>('app_action_events')

export async function ensureAppActionIndexes(): Promise<void> {
  await appActionEvents.createIndex({ ownerId: 1, createdAt: -1 })
  await appActionEvents.createIndex({ ownerId: 1, appKey: 1, createdAt: -1 })
  // A contagem de operações do dia, que uma política pode limitar.
  await appActionEvents.createIndex({ ownerId: 1, installationId: 1, actionKey: 1, createdAt: -1 })
}

/**
 * Quantas ações desta lista SAÍRAM hoje nesta conexão.
 *
 * Conta o que foi executado, e não o que foi tentado: uma ordem recusada pela política
 * não gastou nada e não pode contar contra o teto do dia.
 */
export async function countActionsSince(ownerId: string, installationId: ObjectId, actionKeys: string[], since: Date): Promise<number> {
  return appActionEvents.countDocuments({
    ownerId,
    installationId,
    actionKey: { $in: actionKeys },
    status: 'executed',
    ok: true,
    // Só o que a corretora CONFIRMOU, e é o `orderId` que prova isso. Uma chamada que
    // deu certo mas não produziu ordem — uma reconciliação que não achou nada, por
    // exemplo — não gastou uma operação do dia e não pode contar contra o teto.
    orderId: { $exists: true, $nin: [null, ''] },
    createdAt: { $gte: since },
  })
}

/**
 * O que uma ação DEIXA no registro — e o que nunca deixa.
 *
 * Entra: quem, qual ação, qual conexão, qual ambiente, quanto demorou, o veredito da
 * política e o id da ordem. Não entra: argumento, corpo de resposta, saldo, posição e
 * credencial. Um registro de auditoria que guarda o payload vira o lugar mais fácil de
 * vazar o que todo o resto do sistema protege.
 */
export interface ActionOutcomeDetail {
  orderId?: string | null
  policy?: { allowed: boolean; evaluated: string[]; violations: string[] } | null
}

/**
 * A chave da chamada, passada ao adapter DENTRO dos argumentos.
 *
 * O nome começa com `__`: nenhum schema de ação declara um campo assim, então ela nunca
 * é confundida com um argumento de verdade — e o modelo, que só vê o schema, nunca a
 * escreve.
 */
export const ACTION_DETAIL_KEY = '__actionCallId'

/** O canal por onde o adapter conta o que a ação produziu, sem devolver isso ao modelo. */
const detalhes = new Map<string, ActionOutcomeDetail>()

/**
 * ACUMULA, e não substitui.
 *
 * Uma chamada conta duas coisas em momentos diferentes: o veredito da política, antes
 * de sair, e o id da ordem, depois de voltar. Substituindo, o segundo aviso apagava o
 * primeiro — e o registro ficava com metade da história, sempre a mesma metade.
 */
export const reportActionDetail = (chave: string, detalhe: ActionOutcomeDetail): void => {
  detalhes.set(chave, { ...(detalhes.get(chave) ?? {}), ...detalhe })
}

export const takeActionDetail = (chave: string): ActionOutcomeDetail | null => {
  const d = detalhes.get(chave)
  detalhes.delete(chave)
  return d ?? null
}

export async function recordActionEvent(event: Omit<AppActionEvent, '_id' | 'createdAt'>): Promise<void> {
  try {
    await appActionEvents.insertOne({ ...event, _id: new ObjectId(), createdAt: new Date() })
  } catch {
    // Telemetry must never break the action the owner asked for.
  }
}
