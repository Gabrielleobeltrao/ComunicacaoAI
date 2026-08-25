import { db } from '../../db.js'
import { WS_LIMITS } from '../../apps/official/websocket/config.js'

/**
 * O LIVE DATA STORE: o último valor de cada chave, e nada mais.
 *
 * Existe porque um WebSocket de mercado manda três cotações por segundo e ninguém
 * quer — nem pode pagar — um agente por cotação. O que um cálculo precisa é do valor
 * de AGORA; o que um histórico precisa é de outra coisa, e essa outra coisa não é
 * "todos os tiques para sempre".
 *
 * Três decisões carregam o módulo:
 *
 * MONGO, E NÃO MEMÓRIA. O socket vive no worker e o agente pode rodar na API — em
 * instalações com `EMBEDDED_WORKER=false` são processos diferentes. Um cache em memória
 * responderia num e ficaria vazio no outro, e o sintoma seria "o agente não vê o preço",
 * intermitente e impossível de reproduzir.
 *
 * UPSERT POR CHAVE, E NÃO INSERT POR TIQUE. `AAPL` é um documento, atualizado; não uma
 * linha por cotação. A coleção fica do tamanho do número de chaves, não do tempo.
 *
 * COALESCÊNCIA NA MEMÓRIA DO PRODUTOR. Mesmo com upsert, três escritas por segundo por
 * chave é ritmo de banco que ninguém pediu. O valor mais recente fica num buffer e é
 * gravado no máximo a cada `WS_LIVE_FLUSH_MS`; leitura sempre vê o buffer primeiro, no
 * processo que produz. É por isso que quem produz nunca lê desatualizado.
 */

export interface LiveDataRecord {
  /** `ownerId:connectionId:key` — a identidade, e o que torna o upsert idempotente. */
  _id: string
  ownerId: string
  connectionId: string
  key: string
  value: unknown
  /** Quantas atualizações desde que a chave apareceu. Diz se o dado está andando. */
  updates: number
  receivedAt: Date
  expiresAt: Date
}

const live = db.collection<LiveDataRecord>('live_data')

/** Quanto tempo o valor mais recente pode ficar só no buffer antes de ir ao banco. */
const FLUSH_MS = Number(process.env.WS_LIVE_FLUSH_MS ?? 1_000)

export async function ensureLiveDataIndexes(): Promise<void> {
  await live.createIndex({ ownerId: 1, connectionId: 1, key: 1 })
  await live.createIndex({ ownerId: 1, connectionId: 1, receivedAt: -1 })
  // O TTL é do Mongo, não nosso: nada aqui precisa varrer a coleção para expirar, e um
  // processo parado não deixa dado velho respondendo como se fosse de agora.
  await live.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

const idDe = (ownerId: string, connectionId: string, key: string): string => `${ownerId}:${connectionId}:${key}`

interface Pendente {
  registro: LiveDataRecord
  gravando: boolean
  /** Quando a última gravação saiu — o que decide se a próxima espera ou vai agora. */
  ultimaEm: number
}

const buffer = new Map<string, Pendente>()

/**
 * Guarda o valor de uma chave.
 *
 * Devolve `false` quando a conexão já tem chaves demais: uma mensagem com um campo
 * inesperado no lugar do símbolo criaria uma chave nova por tique, e em uma hora a
 * coleção teria mais chaves do que o mercado tem papéis.
 */
export async function putLiveValue(
  ownerId: string,
  connectionId: string,
  key: string,
  value: unknown,
  ttlSeconds: number,
  agora = new Date(),
): Promise<boolean> {
  const chave = String(key ?? '').trim().slice(0, 120)
  if (!chave) return false

  const id = idDe(ownerId, connectionId, chave)
  const existente = buffer.get(id)
  if (!existente && !(await cabeMaisUma(ownerId, connectionId, id))) return false

  const registro: LiveDataRecord = {
    _id: id,
    ownerId,
    connectionId,
    key: chave,
    value,
    updates: (existente?.registro.updates ?? 0) + 1,
    receivedAt: agora,
    expiresAt: new Date(agora.getTime() + Math.max(5, ttlSeconds) * 1000),
  }
  const pendente: Pendente = { registro, gravando: existente?.gravando ?? false, ultimaEm: existente?.ultimaEm ?? 0 }
  buffer.set(id, pendente)

  // Vai agora se faz tempo suficiente; senão, fica no buffer e a próxima chamada leva.
  if (!pendente.gravando && agora.getTime() - pendente.ultimaEm >= FLUSH_MS) await gravar(id)
  return true
}

/** Já existe? Então não é chave nova e o teto não se aplica. */
async function cabeMaisUma(ownerId: string, connectionId: string, id: string): Promise<boolean> {
  if (await live.findOne({ _id: id }, { projection: { _id: 1 } })) return true
  const quantas = await live.countDocuments({ ownerId, connectionId })
  return quantas < WS_LIMITS.maxLiveKeysPerConnection
}

async function gravar(id: string): Promise<void> {
  const pendente = buffer.get(id)
  if (!pendente || pendente.gravando) return
  pendente.gravando = true
  const registro = pendente.registro
  try {
    await live.updateOne({ _id: id }, { $set: registro }, { upsert: true })
    pendente.ultimaEm = Date.now()
  } catch {
    // Perder um tique não é notícia: o próximo chega em instantes e traz o valor novo.
    // Derrubar a conexão por causa de uma escrita seria trocar o dado inteiro por um.
  } finally {
    pendente.gravando = false
    // Só sai do buffer quando o que está nele é o que já foi gravado: se um tique novo
    // chegou durante a escrita, ele fica esperando a próxima janela.
    if (buffer.get(id)?.registro === registro) buffer.delete(id)
  }
}

/** Descarrega o que está pendente. O worker chama no encerramento. */
export async function flushLiveData(): Promise<void> {
  await Promise.allSettled([...buffer.keys()].map((id) => gravar(id)))
}

/** Só para os testes: zera o buffer entre casos. */
export const resetLiveBuffer = (): void => {
  buffer.clear()
}

const vivo = (r: LiveDataRecord | null, agora: Date): LiveDataRecord | null =>
  // O TTL do Mongo remove em ATÉ um minuto, não no instante. Conferir na leitura é o
  // que impede um valor vencido de responder como se fosse de agora.
  r && r.expiresAt.getTime() > agora.getTime() ? r : null

export async function getLiveValue(ownerId: string, connectionId: string, key: string, agora = new Date()): Promise<LiveDataRecord | null> {
  const id = idDe(ownerId, connectionId, key)
  const noBuffer = buffer.get(id)?.registro
  if (noBuffer) return vivo(noBuffer, agora)
  return vivo(await live.findOne({ _id: id, ownerId }), agora)
}

/** As chaves mais recentes desta conexão. É a foto do que está chegando agora. */
export async function latestLiveValues(ownerId: string, connectionId: string, limit = 50, agora = new Date()): Promise<LiveDataRecord[]> {
  const doBanco = await live
    .find({ ownerId, connectionId })
    .sort({ receivedAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .toArray()
  return juntarComBuffer(doBanco, ownerId, connectionId, agora).slice(0, limit)
}

export async function listLiveValues(ownerId: string, connectionId: string, prefixo = '', limit = 100, agora = new Date()): Promise<LiveDataRecord[]> {
  const filtro: Record<string, unknown> = { ownerId, connectionId }
  // O prefixo é ESCAPADO: um filtro digitado nunca vira expressão regular.
  if (prefixo.trim()) filtro.key = { $regex: `^${prefixo.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` }
  const doBanco = await live
    .find(filtro)
    .sort({ key: 1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .toArray()
  const juntos = juntarComBuffer(doBanco, ownerId, connectionId, agora).filter((r) => !prefixo.trim() || r.key.startsWith(prefixo.trim()))
  return juntos.sort((a, b) => a.key.localeCompare(b.key)).slice(0, limit)
}

/** O buffer tem o valor mais novo; o banco tem o resto. O mais novo ganha. */
function juntarComBuffer(doBanco: LiveDataRecord[], ownerId: string, connectionId: string, agora: Date): LiveDataRecord[] {
  const porId = new Map(doBanco.map((r) => [r._id, r]))
  for (const p of buffer.values()) {
    if (p.registro.ownerId !== ownerId || p.registro.connectionId !== connectionId) continue
    porId.set(p.registro._id, p.registro)
  }
  return [...porId.values()].filter((r): r is LiveDataRecord => vivo(r, agora) !== null).sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
}

/** Quantas chaves esta conexão tem — para a tela e para o teto. */
export const countLiveKeys = (ownerId: string, connectionId: string): Promise<number> => live.countDocuments({ ownerId, connectionId })

/** Remover tudo de uma conexão. Chamado quando ela é apagada. */
export async function deleteLiveDataFor(ownerId: string, connectionId: string): Promise<void> {
  for (const [id, p] of buffer) if (p.registro.ownerId === ownerId && p.registro.connectionId === connectionId) buffer.delete(id)
  await live.deleteMany({ ownerId, connectionId })
}

// --- espera declarativa ----------------------------------------------------------------

export type LiveCondition = {
  /** Caminho dentro do valor guardado. Vazio = o valor inteiro. */
  path?: string
  operator: 'exists' | 'equals' | 'not_equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'changed'
  value?: unknown
}

export const LIVE_OPERATORS: LiveCondition['operator'][] = ['exists', 'equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'contains', 'changed']

/**
 * A condição, avaliada por COMPARAÇÃO — nunca por expressão.
 *
 * `waitFor` é a função mais tentadora do módulo para aceitar "um predicado": seria uma
 * linha. E seria uma linha que executa código escrito na configuração de um agente. Os
 * operadores abaixo cobrem o que uma regra de mercado precisa perguntar; o que eles não
 * cobrem, o código do agente pergunta depois de receber o valor.
 */
export function matchesCondition(valor: unknown, cond: LiveCondition, anterior?: unknown): boolean {
  const alvo = cond.path ? lerCaminho(valor, cond.path) : valor
  switch (cond.operator) {
    case 'exists':
      return alvo !== undefined && alvo !== null
    case 'changed':
      return JSON.stringify(alvo) !== JSON.stringify(cond.path ? lerCaminho(anterior, cond.path) : anterior)
    case 'equals':
      return alvo === cond.value
    case 'not_equals':
      return alvo !== cond.value
    case 'contains':
      return String(alvo ?? '').includes(String(cond.value ?? ''))
    default: {
      const a = Number(alvo)
      const b = Number(cond.value)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false
      return cond.operator === 'gt' ? a > b : cond.operator === 'gte' ? a >= b : cond.operator === 'lt' ? a < b : a <= b
    }
  }
}

/** A mesma leitura de caminho do resto do produto — sem `__proto__`, sem expressão. */
function lerCaminho(valor: unknown, caminho: string): unknown {
  let atual: unknown = valor
  for (const parte of caminho.split('.')) {
    if (parte === '__proto__' || parte === 'constructor' || parte === 'prototype') return undefined
    if (atual === null || typeof atual !== 'object') return undefined
    atual = (atual as Record<string, unknown>)[parte]
  }
  return atual
}

/**
 * O teto da espera, abaixo do teto de dez segundos que a plataforma dá a qualquer função
 * registrada: o handler precisa terminar ANTES de o executor desistir, senão a resposta
 * vira "falhou" onde o certo é "não aconteceu no prazo".
 */
export const LIVE_WAIT_MAX_MS = Number(process.env.WS_LIVE_WAIT_MAX_MS ?? 8_000)

/**
 * Espera a chave satisfazer a condição, ou desiste no prazo.
 *
 * Sondagem, e não assinatura: o socket está em outro processo, e um canal de eventos só
 * para isto seria uma segunda infraestrutura de tempo real dentro da que já existe. O
 * intervalo é curto o bastante para uma regra de risco e o teto é obrigatório — uma
 * espera sem prazo é uma execução que não termina.
 */
export async function waitForLiveValue(
  ownerId: string,
  connectionId: string,
  key: string,
  cond: LiveCondition,
  timeoutMs: number,
  deps: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<{ matched: boolean; record: LiveDataRecord | null }> {
  const dormir = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.()))
  const agora = deps.now ?? (() => Date.now())
  const prazo = agora() + Math.min(Math.max(timeoutMs, 100), LIVE_WAIT_MAX_MS)
  const intervalo = 200

  const inicial = await getLiveValue(ownerId, connectionId, key)
  let anterior = inicial?.value
  if (inicial && cond.operator !== 'changed' && matchesCondition(inicial.value, cond)) return { matched: true, record: inicial }

  while (agora() < prazo) {
    await dormir(intervalo)
    const atual = await getLiveValue(ownerId, connectionId, key)
    if (atual && matchesCondition(atual.value, cond, anterior)) return { matched: true, record: atual }
    anterior = atual?.value ?? anterior
  }
  return { matched: false, record: await getLiveValue(ownerId, connectionId, key) }
}
