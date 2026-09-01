import { createHash } from 'node:crypto'
import { db } from './db.js'
import { getMonthlyTokenCap } from './userSettings.js'
import { getMonthlyTokens } from './tokenUsage.js'

// Freio de abuso e de custo — no banco, e não na memória do processo.
//
// O limite antigo do widget era por `conversationId`, e o `conversationId` era
// inventado pelo cliente: bastava gerar um novo a cada mensagem para o teto sumir. Um
// contador em memória tem o mesmo problema de outra forma — com duas instâncias o teto
// vira o dobro, e um restart zera tudo.
//
// Aqui o contador é um documento só, atualizado com uma operação atômica do Mongo. Duas
// instâncias contam no mesmo lugar, e a janela expira sozinha por TTL.

const buckets = db.collection<{ _id: string; count: number; expiresAt: Date }>('rate_limits')
const slots = db.collection<{ _id: string; key: string; expiresAt: Date }>('concurrency_slots')

export async function ensureAbuseGuardIndexes(): Promise<void> {
  await buckets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await slots.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await slots.createIndex({ key: 1 })
}

export interface RateVerdict {
  allowed: boolean
  /** Quanto esperar. É o que vira `Retry-After` — e é a ÚNICA coisa que a resposta diz. */
  retryAfterSeconds: number
}

/**
 * Consome uma unidade da janela e diz se cabia.
 *
 * Uma escrita só, com pipeline de agregação: incrementa quando a janela está viva e
 * reinicia quando expirou. Ler e depois escrever perderia a corrida — e perder a
 * corrida num limite de abuso é não ter limite.
 */
export async function consumeRate(bucket: string, limit: number, windowMs: number, agora: Date = new Date()): Promise<RateVerdict> {
  const fim = new Date(agora.getTime() + windowMs)
  const doc = await buckets.findOneAndUpdate(
    { _id: bucket },
    [
      {
        $set: {
          count: { $cond: [{ $gt: ['$expiresAt', agora] }, { $add: [{ $ifNull: ['$count', 0] }, 1] }, 1] },
          expiresAt: { $cond: [{ $gt: ['$expiresAt', agora] }, '$expiresAt', fim] },
        },
      },
    ],
    { upsert: true, returnDocument: 'after' },
  )
  const usados = doc?.count ?? 1
  const restanteMs = Math.max(0, (doc?.expiresAt ?? fim).getTime() - agora.getTime())
  return { allowed: usados <= limit, retryAfterSeconds: Math.max(1, Math.ceil(restanteMs / 1000)) }
}

/**
 * Uma vaga de execução simultânea, com prazo.
 *
 * Insere primeiro e conta depois: duas chamadas em corrida contam as duas e as duas
 * recuam. Erra para o lado de recusar, que é o lado seguro — o contrário deixaria
 * passar mais trabalho caro do que o teto permite.
 *
 * O prazo existe porque um processo pode morrer no meio: sem TTL, a vaga ficaria
 * ocupada para sempre e o dono ficaria trancado fora da própria conta.
 */
export async function withConcurrencySlot<T>(key: string, limit: number, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const id = `${key}:${crypto.randomUUID()}`
  const agora = new Date()
  await slots.insertOne({ _id: id, key, expiresAt: new Date(agora.getTime() + ttlMs) })
  try {
    const ativos = await slots.countDocuments({ key, expiresAt: { $gt: agora } })
    if (ativos > limit) return null
    return await fn()
  } finally {
    await slots.deleteOne({ _id: id }).catch(() => undefined)
  }
}

/**
 * O IP, sem ser o IP.
 *
 * Contar por endereço exige guardar endereço, e endereço é dado pessoal. O hash com um
 * segredo do servidor conta igual e não dá para voltar — nem por quem lê o banco.
 */
export function anonymizeIp(ip: string | undefined): string {
  const bruto = String(ip ?? '').trim() || 'desconhecido'
  const segredo = process.env.BETTER_AUTH_SECRET ?? process.env.ENCRYPTION_KEY ?? 'sal-de-desenvolvimento'
  return createHash('sha256').update(`${segredo}:${bruto}`).digest('hex').slice(0, 24)
}

/** O IP de quem chamou, respeitando o proxy que a configuração declara confiar. */
export const clientIpOf = (req: { ip?: string; socket?: { remoteAddress?: string } }): string =>
  req.ip || req.socket?.remoteAddress || 'desconhecido'

/**
 * O teto de gasto do dono — e ele FECHA quando não dá para conferir.
 *
 * O teto antigo era opcional e, se a leitura do consumo falhasse, a exceção subia e o
 * caminho continuava. Aqui o padrão é o contrário: sem resposta do banco, não se gasta.
 * Um teto que abre quando o banco tosse não é um teto.
 */
export interface BudgetReaders {
  cap: (ownerId: string) => Promise<number>
  used: (ownerId: string) => Promise<number>
}

/**
 * Injetável pelo mesmo motivo do resolvedor de DNS: a garantia que importa aqui é o que
 * acontece quando a LEITURA FALHA, e provar isso sem poder falhar de propósito exigiria
 * derrubar o banco no meio da suíte.
 */
export async function ownerWithinBudget(ownerId: string, leitores: BudgetReaders = { cap: getMonthlyTokenCap, used: getMonthlyTokens }): Promise<boolean> {
  try {
    const doDono = await leitores.cap(ownerId)
    const teto = doDono > 0 ? doDono : Number(process.env.OWNER_MONTHLY_TOKEN_CAP ?? 0)
    if (!(teto > 0)) return true
    return (await leitores.used(ownerId)) < teto
  } catch {
    return false
  }
}

/** Os tetos, num lugar só, para a tela e o servidor não discordarem. */
export const LIMITES = {
  /** Mensagens de visitante, por IP anonimizado. */
  widgetMensagensPorIp: { limite: 30, janelaMs: 60_000 },
  /** Mensagens de visitante que um widget inteiro recebe por minuto. */
  widgetMensagensPorWidget: { limite: 120, janelaMs: 60_000 },
  /** Conversas NOVAS por IP — é o teto que o `conversationId` inventado burlava. */
  widgetConversasPorIp: { limite: 10, janelaMs: 60 * 60_000 },
  /** Entregas de webhook por canal. */
  webhookPorCanal: { limite: 240, janelaMs: 60_000 },
  /** Testes de conexão, por dono: cada um abre uma conexão de saída. */
  testeDeConexaoPorDono: { limite: 20, janelaMs: 60_000 },
  /** Tentativas de entrar na conta, por IP. Sem isto a rota é um oráculo de senha. */
  tentativasDeLoginPorIp: { limite: 12, janelaMs: 5 * 60_000 },
  /** Respostas do modelo em voo, por dono. */
  respostasSimultaneasPorDono: { limite: 8, ttlMs: 5 * 60_000 },
} as const

/**
 * A cota de ARMAZENAMENTO do dono.
 *
 * Documento de conhecimento é texto extraído e guardado — e sem teto, um upload atrás do
 * outro enche o banco de todo mundo. A conta é o tamanho do que já está lá, não o número
 * de arquivos: cem notas curtas não são o problema; um PDF de trezentas páginas por dia é.
 *
 * O padrão é generoso de propósito (500 MB): isto existe para impedir abuso, não para
 * atrapalhar quem usa. `OWNER_STORAGE_QUOTA_BYTES=0` desliga.
 */
const COTA_PADRAO = 500 * 1024 * 1024

export interface StorageVerdict {
  allowed: boolean
  usedBytes: number
  quotaBytes: number
}

export async function checkOwnerStorage(ownerId: string, adicionandoBytes = 0): Promise<StorageVerdict> {
  const quotaBytes = Number(process.env.OWNER_STORAGE_QUOTA_BYTES ?? COTA_PADRAO)
  if (!(quotaBytes > 0)) return { allowed: true, usedBytes: 0, quotaBytes: 0 }

  /**
   * O documento não guarda o id da CONTA: ele guarda o do agente, setor, andar ou
   * prédio que o possui. Somar por `ownerId` da conta daria zero sempre — uma cota que
   * nunca dispara é pior que nenhuma, porque parece que existe.
   *
   * Os QUATRO donos entram. Deixar um de fora não daria um número um pouco menor: daria
   * um escopo por onde encher o disco sem que a cota percebesse.
   */
  const donos: unknown[] = []
  for (const colecao of ['agents', 'sectors', 'offices', 'buildings']) {
    const ids = await db.collection(colecao).find({ ownerId }, { projection: { _id: 1 } }).toArray()
    donos.push(...ids.map((d) => d._id))
  }
  if (donos.length === 0) return { allowed: true, usedBytes: 0, quotaBytes }

  // A soma acontece no banco: trazer os documentos para somar no processo seria carregar
  // exatamente o que a cota existe para limitar.
  const [linha] = await db
    .collection('knowledge_documents')
    .aggregate<{ total: number }>([
      { $match: { ownerId: { $in: donos } } },
      { $group: { _id: null, total: { $sum: { $strLenBytes: { $ifNull: ['$content', ''] } } } } },
    ])
    .toArray()
  const usedBytes = linha?.total ?? 0
  return { allowed: usedBytes + adicionandoBytes <= quotaBytes, usedBytes, quotaBytes }
}
