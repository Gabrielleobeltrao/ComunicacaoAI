import { createHash, randomBytes } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { resolveDatabaseAccess } from '../databases/access.js'
import { resolveGrant } from '../apps/grants.js'
import { getAgentById } from '../agents.js'

// O CAPABILITY BROKER — o único caminho do código isolado para qualquer coisa desta conta.
//
// A regra que define o desenho: nenhum segredo bruto atravessa a fronteira. O código
// recebe um HANDLE — um identificador curto, de uso contado, preso a uma execução — e
// quando ele quer fazer algo, quem faz é este lado. O token não é a permissão; ele é o
// bilhete que diz "esta execução tem direito de pedir isto". A permissão é reconferida
// pelo resolvedor canônico a CADA chamada, porque entre emitir o bilhete e usá-lo cabe
// uma revogação.

export interface Capability {
  /** Sobre o quê. Mesmo vocabulário do manifesto de permissão de extensão. */
  kind: 'app_action' | 'database_query'
  /** O alvo exato: `google_calendar:criar_evento` ou `<dataStoreId>:<datasetKey>`. */
  target: string
}

export interface CapabilityHandle {
  _id: ObjectId
  /** O HASH do token. O token em si nunca é gravado — vazamento do banco não vira acesso. */
  tokenHash: string
  ownerId: string
  agentId: ObjectId | null
  /** A execução dona deste bilhete. Um handle de outra execução não vale. */
  executionKey: string
  capability: Capability
  usesLeft: number
  expiresAt: Date
  createdAt: Date
}

const handles = db.collection<CapabilityHandle>('sandbox_capability_handles')

export async function ensureBrokerIndexes(): Promise<void> {
  await handles.createIndex({ tokenHash: 1 }, { unique: true })
  await handles.createIndex({ executionKey: 1 })
  // O bilhete expira sozinho: um handle que sobrevive à execução é uma chave esquecida
  // na fechadura.
  await handles.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'handles_expiram' })
}

/** Curto de verdade: o tempo de uma execução, não o de uma sessão. */
export const HANDLE_TTL_MS = Number(process.env.SANDBOX_HANDLE_TTL_MS ?? 30_000)
export const HANDLE_MAX_USES = Number(process.env.SANDBOX_HANDLE_MAX_USES ?? 5)

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')

export interface IssuedHandle {
  /** O que vai para o runner. Fica só nesta resposta — o banco guarda o hash. */
  token: string
  expiresAt: Date
}

export async function issueHandle(input: {
  ownerId: string
  agentId?: ObjectId | null
  executionKey: string
  capability: Capability
  uses?: number
  now?: Date
}): Promise<IssuedHandle> {
  const agora = input.now ?? new Date()
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(agora.getTime() + HANDLE_TTL_MS)
  await handles.insertOne({
    _id: new ObjectId(),
    tokenHash: hashOf(token),
    ownerId: input.ownerId,
    agentId: input.agentId ?? null,
    executionKey: input.executionKey,
    capability: input.capability,
    usesLeft: Math.min(HANDLE_MAX_USES, Math.max(1, input.uses ?? 1)),
    expiresAt,
    createdAt: agora,
  })
  return { token, expiresAt }
}

export type BrokerRefusal = { ok: false; reason: string; detail: string }
export type BrokerGrant = { ok: true; handle: CapabilityHandle }

/**
 * Consome um uso do bilhete — atomicamente, e só se ele ainda valer.
 *
 * `findOneAndUpdate` com `usesLeft > 0` no filtro: duas chamadas simultâneas do mesmo
 * token não conseguem gastar o mesmo uso duas vezes. Uma trava seria pior — ela
 * precisaria ser liberada, e um runner que morre no meio a deixaria presa.
 */
export async function redeem(token: string, executionKey: string, now: Date = new Date()): Promise<BrokerGrant | BrokerRefusal> {
  const handle = await handles.findOneAndUpdate(
    { tokenHash: hashOf(token), executionKey, usesLeft: { $gt: 0 }, expiresAt: { $gt: now } },
    { $inc: { usesLeft: -1 } },
    { returnDocument: 'after' },
  )
  if (!handle) {
    // Uma recusa só: token errado, execução errada, expirado ou gasto respondem igual.
    // Distinguir seria ensinar quem tenta a descobrir qual das quatro coisas mudar.
    return { ok: false, reason: 'handle_invalido', detail: 'este acesso não vale mais' }
  }
  return { ok: true, handle }
}

/**
 * Usar uma capacidade: consome o bilhete E reconfere a permissão no resolvedor canônico.
 *
 * As duas coisas, nesta ordem. O bilhete responde "esta execução pediu isto?"; o
 * resolvedor responde "esta conta ainda permite isto?" — e a segunda pergunta não pode
 * ser respondida pelo bilhete, porque ele foi emitido antes.
 */
export async function useCapability(input: {
  token: string
  executionKey: string
  capability: Capability
  now?: Date
}): Promise<BrokerGrant | BrokerRefusal> {
  const resgatado = await redeem(input.token, input.executionKey, input.now)
  if (!resgatado.ok) return resgatado
  const handle = resgatado.handle

  // O bilhete vale para UM alvo. Pedir outro com o mesmo token é o ataque mais óbvio.
  if (handle.capability.kind !== input.capability.kind || handle.capability.target !== input.capability.target) {
    return { ok: false, reason: 'fora_do_escopo', detail: 'este acesso não vale para o que foi pedido' }
  }

  if (handle.capability.kind === 'app_action') {
    const [appKey, actionKey] = handle.capability.target.split(':')
    const agente = handle.agentId ? await getAgentById(handle.ownerId, handle.agentId) : null
    if (!agente) return { ok: false, reason: 'sem_agente', detail: 'o agente desta execução não existe mais' }
    // O MESMO caminho do resto do sistema: grant do agente, instalação, versão, escrita.
    const grant = (agente.appGrants ?? []).find((g) => g.appKey === appKey)
    if (!grant || !(grant.actionKeys ?? []).includes(actionKey)) {
      return { ok: false, reason: 'sem_permissao', detail: 'esta ação não está autorizada para este agente' }
    }
    const ferramentas = await resolveGrant(handle.ownerId, grant, { agentId: agente._id, executionRef: handle.executionKey })
    if (ferramentas.length === 0) return { ok: false, reason: 'conexao_indisponivel', detail: 'a conexão deste App precisa ser revista' }
    return { ok: true, handle }
  }

  const [dataStoreId, datasetKey] = handle.capability.target.split(':')
  if (!ObjectId.isValid(dataStoreId)) return { ok: false, reason: 'alvo_invalido', detail: 'este acesso não vale para o que foi pedido' }
  const acesso = await resolveDatabaseAccess({
    accountId: handle.ownerId,
    dataStoreId: new ObjectId(dataStoreId),
    ...(handle.agentId ? { agentId: handle.agentId } : {}),
    ...(datasetKey ? { datasetKey } : {}),
  })
  if (!acesso.capabilities.includes('query')) {
    return { ok: false, reason: 'sem_permissao', detail: 'esta execução não alcança este conjunto de dados' }
  }
  return { ok: true, handle }
}

/** O fim da execução leva os bilhetes junto. Sobrar handle é sobrar acesso. */
export async function revokeForExecution(executionKey: string): Promise<number> {
  const r = await handles.deleteMany({ executionKey })
  return r.deletedCount ?? 0
}

export const handlesCollection = handles
