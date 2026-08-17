// MEMÓRIA DETERMINÍSTICA — guardar informação sem passar por LLM.
//
// O problema que isto resolve: hoje, para um webhook "salvar o pedido que chegou",
// a única saída é mandar o corpo para um agente e torcer para ele gravar. Isso custa
// tokens a cada evento, demora, e o resultado varia. Um pedido que chega mil vezes
// por dia não precisa de inteligência nenhuma para ser guardado — precisa de um
// INSERT.
//
// Nada aqui chama modelo. É banco de dados, com as três garantias que um recebedor
// de eventos precisa ter: não duplicar quando o remetente reenvia, não crescer sem
// limite, e não deixar uma conta ver a informação de outra.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import {
  MAX_KEY_LENGTH,
  MAX_METADATA_BYTES,
  MAX_PAGE_SIZE,
  MAX_PAYLOAD_BYTES,
  MAX_SEARCH_TEXT,
  MemoryError,
} from './model.js'
import type { MemoryScope, MemoryStrategy } from './model.js'

// O vocabulário vive em `model.ts`, que não conhece banco — quem valida uma definição
// precisa dele e roda sem Mongo. Reexportado aqui por conveniência de quem já importa
// deste módulo.
export {
  isMemoryScope,
  isMemoryStrategy,
  MAX_KEY_LENGTH,
  MAX_METADATA_BYTES,
  MAX_PAGE_SIZE,
  MAX_PAYLOAD_BYTES,
  MEMORY_SCOPES,
  MEMORY_STRATEGIES,
  MemoryError,
} from './model.js'
export type { MemoryScope, MemoryStrategy } from './model.js'

export interface MemoryTarget {
  scope: MemoryScope
  agentId?: ObjectId | null
  sectorId?: ObjectId | null
  floorId?: ObjectId | null
  buildingId?: ObjectId | null
}

export interface MemoryRecord {
  _id: ObjectId
  // A conta. Todo filtro começa por aqui — memória de uma conta nunca aparece em
  // consulta de outra, nem por engano de índice.
  tenantId: string
  scope: MemoryScope
  agentId: ObjectId | null
  sectorId: ObjectId | null
  floorId: ObjectId | null
  buildingId: ObjectId | null
  /**
   * O alvo em uma string: `agent:<id>`, `sector:<id>`, `floor:<id>`, `building:<id>`.
   *
   * Existe para os índices. Um índice único sobre quatro campos opcionais depende do
   * comportamento do Mongo com nulos e vira uma armadilha; sobre uma string só, a
   * unicidade é óbvia e a consulta é uma igualdade.
   */
  scopeKey: string
  key: string
  payload: unknown
  // De onde veio: 'webhook', 'rss', 'http', 'agent', 'manual'.
  sourceType: string
  sourceId: string | null
  metadata: Record<string, unknown>
  // A marca que impede o mesmo evento de virar dois registros. Nula quando quem
  // gravou não soube dizer o que torna aquele evento único.
  dedupeKey: string | null
  /**
   * Chave e conteúdo achatados em texto, para a busca.
   *
   * Denormalizado de propósito. Procurar dentro do payload em tempo de consulta
   * exigiria converter objeto em string no servidor — que o Mongo não faz — ou
   * varrer a coleção. Um campo pronto é uma expressão regular sobre string, que é
   * barata e indexável.
   */
  searchText: string
  /**
   * Este registro é o ÚNICO da sua chave.
   *
   * Verdadeiro em `upsert` e `replace`, ausente em `append` — que existe justamente
   * para ter vários registros com a mesma chave. O campo existe para o índice único
   * parcial: sem ele, "um registro por chave" seria uma esperança, e dois eventos
   * simultâneos criariam dois registros porque o upsert do Mongo só é atômico contra
   * duplicata quando há índice único sobre o filtro.
   */
  singleton?: boolean
  createdAt: Date
  updatedAt: Date
  // Quando este registro deixa de valer. Nulo = para sempre.
  expiresAt: Date | null
}

const memories = db.collection<MemoryRecord>('memories')


export const scopeKeyOf = (target: MemoryTarget): string => {
  const id =
    target.scope === 'agent'
      ? target.agentId
      : target.scope === 'sector'
        ? target.sectorId
        : target.scope === 'floor'
          ? target.floorId
          : target.buildingId
  if (!id) throw new MemoryError(`escopo ${target.scope} exige o id correspondente`)
  return `${target.scope}:${id.toString()}`
}

// O texto que a busca varre. Minúsculas para a comparação não depender de acento de
// caixa; cortado porque ele espelha o conteúdo, não o substitui.
export const searchTextOf = (key: string, payload: unknown): string => {
  let corpo = ''
  try {
    corpo = JSON.stringify(payload ?? null) ?? ''
  } catch {
    corpo = ''
  }
  return `${key} ${corpo}`.slice(0, MAX_SEARCH_TEXT).toLowerCase()
}

/**
 * Deixa o payload seguro para guardar.
 *
 * Chave começando com `$` ou contendo ponto é sintaxe de operador e de caminho no
 * Mongo. Guardar isso cru é como concatenar SQL: o conteúdo do payload passa a
 * poder falar com o banco. Aqui os caracteres são trocados, não removidos — o dado
 * continua legível para quem for ler depois.
 */
export function sanitizePayload(valor: unknown, profundidade = 0, vistos = new WeakSet<object>()): unknown {
  if (profundidade > 20) throw new MemoryError('o conteúdo é fundo demais')
  if (valor === null || typeof valor !== 'object') return valor
  if (valor instanceof Date) return valor
  // Um ciclo é recusado, não achatado. Achatar guardaria um registro que parece
  // completo e não é — e "recusado" é a resposta que o remetente pode corrigir.
  if (vistos.has(valor as object)) throw new MemoryError('o conteúdo tem referência circular')
  vistos.add(valor as object)
  if (Array.isArray(valor)) return valor.map((v) => sanitizePayload(v, profundidade + 1, vistos))
  const limpo: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    const chave = k.replace(/^\$/, '_$').replace(/\./g, '_')
    limpo[chave] = sanitizePayload(v, profundidade + 1, vistos)
  }
  return limpo
}

const tamanhoEmBytes = (valor: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(valor ?? null), 'utf8')
  } catch {
    // Ciclo, BigInt, função: não é JSON, então não entra.
    throw new MemoryError('o conteúdo precisa ser JSON válido')
  }
}

export function assertWithinLimits(key: string, payload: unknown, metadata: Record<string, unknown>): void {
  if (!key.trim()) throw new MemoryError('a chave é obrigatória')
  if (key.length > MAX_KEY_LENGTH) throw new MemoryError(`a chave passa de ${MAX_KEY_LENGTH} caracteres`)
  const bytes = tamanhoEmBytes(payload)
  if (bytes > MAX_PAYLOAD_BYTES) throw new MemoryError(`o conteúdo tem ${bytes} bytes e o limite é ${MAX_PAYLOAD_BYTES}`)
  if (tamanhoEmBytes(metadata) > MAX_METADATA_BYTES) throw new MemoryError('os metadados passam do limite')
}

export async function ensureMemoryIndexes(): Promise<void> {
  // A consulta de todo dia: o que esta conta guardou neste alvo, do mais novo para o
  // mais velho.
  await memories.createIndex({ tenantId: 1, scopeKey: 1, createdAt: -1 })
  // Achar o registro de uma chave, que é o que `upsert` e `replace` fazem.
  await memories.createIndex({ tenantId: 1, scopeKey: 1, key: 1 })
  // A busca textual varre este campo dentro de um alvo já filtrado.
  await memories.createIndex({ tenantId: 1, scopeKey: 1, searchText: 1 })
  // A trava contra duplicata: dois eventos com a mesma marca não viram dois
  // registros. Parcial porque `dedupeKey` nulo é o caso de quem não soube dizer o
  // que torna o evento único — e aí nada deve ser barrado.
  await memories.createIndex(
    { tenantId: 1, scopeKey: 1, dedupeKey: 1 },
    { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
  )
  // A trava que torna `upsert`/`replace` de fato atômicos: com ela, dois eventos
  // simultâneos na mesma chave não viram dois registros — o segundo recebe erro de
  // chave duplicada e cai no caminho de atualização. Parcial porque `append` PRECISA
  // de vários registros na mesma chave.
  await memories.createIndex(
    { tenantId: 1, scopeKey: 1, key: 1, singleton: 1 },
    { unique: true, partialFilterExpression: { singleton: true } },
  )
  // Faxina automática do que tem prazo. `expireAfterSeconds: 0` diz ao Mongo para
  // apagar quando `expiresAt` chegar.
  await memories.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

export interface WriteMemoryInput {
  tenantId: string
  target: MemoryTarget
  key: string
  payload: unknown
  strategy?: MemoryStrategy
  sourceType?: string
  sourceId?: string | null
  metadata?: Record<string, unknown>
  /**
   * O que torna este EVENTO único, na visão de quem configurou.
   *
   * Guardado com a origem na frente (`webhook:p-1`): o pedido `p-1` que veio de um
   * webhook e o item `p-1` que veio de um feed são coisas diferentes, e sem o prefixo
   * o segundo seria recusado como repetição do primeiro.
   */
  dedupeKey?: string | null
  /**
   * A identidade da TENTATIVA, para o retry de uma mesma execução não duplicar.
   *
   * Coisa diferente do `dedupeKey`: aquele fala do evento e vale entre execuções;
   * este fala de uma execução específica e existe porque a etapa tem
   * `maxAttempts: 3`. Sem ele, uma falha de rede depois do INSERT — o registro
   * entrou, a confirmação não voltou — viraria dois registros na segunda tentativa.
   *
   * Só vale para `append`: em `upsert`/`replace` a chave já é a identidade, e a
   * segunda tentativa naturalmente atualiza o mesmo registro.
   */
  attemptKey?: string | null
  ttlSeconds?: number | null
}

export interface WriteMemoryResult {
  // 'created' = registro novo; 'updated' = um já existente mudou; 'duplicate' = a
  // marca de deduplicação já existia e nada foi feito.
  outcome: 'created' | 'updated' | 'duplicate'
  recordId: string
  scopeKey: string
}

const ehChaveDuplicada = (erro: unknown): boolean => (erro as { code?: number })?.code === 11000

/**
 * Grava. Sem LLM, sem rede, sem surpresa.
 *
 * A deduplicação é o índice único, não uma consulta antes de escrever: entre "existe?"
 * e "então insiro" cabe outra tentativa do mesmo evento, e é exatamente isso que
 * acontece quando um remetente reenvia por timeout. Erro de chave duplicada vira
 * `duplicate`, que é sucesso — o evento JÁ está guardado.
 */
export async function writeMemory(input: WriteMemoryInput): Promise<WriteMemoryResult> {
  const strategy = input.strategy ?? 'append'
  const key = input.key.trim()
  const metadata = (sanitizePayload(input.metadata ?? {}) as Record<string, unknown>) ?? {}
  const payload = sanitizePayload(input.payload)
  assertWithinLimits(key, payload, metadata)

  const scopeKey = scopeKeyOf(input.target)
  const agora = new Date()
  const expiresAt = input.ttlSeconds && input.ttlSeconds > 0 ? new Date(agora.getTime() + input.ttlSeconds * 1000) : null
  const sourceType = input.sourceType ?? 'manual'

  // A marca do evento, com a origem na frente. Sem prefixo, um `p-1` de webhook e um
  // `p-1` de feed colidiriam.
  const doEvento = input.dedupeKey?.trim() ? `${sourceType}:${input.dedupeKey.trim()}` : null
  // Em `append`, sem marca de evento, entra a marca da TENTATIVA: é ela que faz o
  // retry da mesma execução não virar um segundo registro.
  const dedupeKey = doEvento ?? (strategy === 'append' ? (input.attemptKey?.trim() || null) : null)

  const alvo = {
    tenantId: input.tenantId,
    scope: input.target.scope,
    agentId: input.target.agentId ?? null,
    sectorId: input.target.sectorId ?? null,
    floorId: input.target.floorId ?? null,
    buildingId: input.target.buildingId ?? null,
    scopeKey,
  }

  const novoDoc = (): MemoryRecord => ({
    _id: new ObjectId(),
    ...alvo,
    key,
    payload,
    sourceType,
    sourceId: input.sourceId ?? null,
    metadata,
    dedupeKey,
    searchText: searchTextOf(key, payload),
    createdAt: agora,
    updatedAt: agora,
    expiresAt,
  })

  if (strategy === 'append') {
    const doc = novoDoc()
    try {
      await memories.insertOne(doc)
      return { outcome: 'created', recordId: doc._id.toString(), scopeKey }
    } catch (erro) {
      if (!ehChaveDuplicada(erro)) throw erro
      const existente = await memories.findOne({ tenantId: input.tenantId, scopeKey, dedupeKey })
      return { outcome: 'duplicate', recordId: existente?._id.toString() ?? '', scopeKey }
    }
  }

  /**
   * `upsert` e `replace` numa operação só.
   *
   * Ler e depois escrever perderia atualização sob concorrência: dois eventos do
   * mesmo cliente chegando juntos leriam o mesmo registro, cada um mesclaria em cima
   * do que leu, e o último gravaria por cima — o campo que o outro trouxe some.
   *
   * `replace` troca o payload inteiro. `upsert` mistura via caminhos pontuados
   * (`payload.telefone`), que é o que o Mongo sabe fazer atomicamente: cada campo é
   * escrito no seu lugar sem tocar nos demais. As chaves já passaram pela
   * sanitização, então nenhuma delas carrega ponto ou `$`.
   */
  const filtro = doEvento ? { tenantId: input.tenantId, scopeKey, dedupeKey: doEvento } : { tenantId: input.tenantId, scopeKey, key }

  const misturavel =
    strategy === 'upsert' && payload !== null && typeof payload === 'object' && !Array.isArray(payload) && !(payload instanceof Date)

  const set: Record<string, unknown> = {
    key,
    metadata: strategy === 'upsert' ? undefined : metadata,
    sourceType,
    sourceId: input.sourceId ?? null,
    updatedAt: agora,
    expiresAt,
  }
  if (set.metadata === undefined) delete set.metadata
  if (misturavel) {
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) set[`payload.${k}`] = v
    for (const [k, v] of Object.entries(metadata)) set[`metadata.${k}`] = v
  } else {
    set.payload = payload
  }

  const aoInserir: Record<string, unknown> = {
    ...alvo,
    dedupeKey: doEvento,
    // Entra no índice único: é isto que impede dois registros na mesma chave.
    singleton: true,
    createdAt: agora,
    ...(misturavel ? { metadata: {} } : {}),
  }
  // Campos que aparecem em `$set` não podem aparecer em `$setOnInsert`.
  for (const campo of Object.keys(set)) delete aoInserir[campo]
  if (misturavel) delete aoInserir.metadata

  let doc: MemoryRecord | null = null
  let criou = false
  try {
    const antes = await memories.findOneAndUpdate(filtro, { $set: set, $setOnInsert: aoInserir }, { upsert: true, returnDocument: 'before' })
    criou = !antes
    doc = await memories.findOne(filtro)
  } catch (erro) {
    if (!ehChaveDuplicada(erro)) throw erro
    // A outra escrita simultânea criou o registro primeiro. Agora ele existe, e a
    // mistura desta acontece por cima — sem perder o que a primeira trouxe, porque os
    // campos são escritos um a um.
    await memories.updateOne(filtro, { $set: set })
    doc = await memories.findOne(filtro)
  }

  if (!doc) throw new MemoryError('não foi possível gravar a memória')

  // O texto de busca espelha o conteúdo, e só dá para calculá-lo depois de saber o
  // resultado da mistura. Fica um instante desatualizado entre as duas escritas —
  // aceitável, porque ele é índice de busca, não a verdade do registro.
  await memories.updateOne({ _id: doc._id }, { $set: { searchText: searchTextOf(doc.key, doc.payload) } })

  return { outcome: criou ? 'created' : 'updated', recordId: doc._id.toString(), scopeKey }
}

export interface SearchMemoryInput {
  tenantId: string
  // Vazio = todos os alvos que o chamador pode ver; quem monta a lista é a camada
  // de permissão, nunca o chamador.
  scopeKeys: string[]
  key?: string | null
  // Busca textual simples sobre chave e conteúdo. Sem IA, sem embedding, sem custo.
  query?: string | null
  sourceType?: string | null
  since?: Date | null
  until?: Date | null
  limit?: number
  skip?: number
}

export interface SearchMemoryResult {
  items: MemoryRecord[]
  total: number
}

// Escapa o que o usuário digitou antes de virar expressão regular: sem isto, um
// `(` na busca derruba a consulta e um `.*` vira varredura completa.
const escaparRegex = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Busca textual e estruturada. Determinística, sem modelo nenhum no caminho.
 *
 * O texto é procurado na chave e no conteúdo serializado — o suficiente para "achar
 * o pedido do fulano" sem embedding, sem índice vetorial e sem custo por consulta.
 */
export async function searchMemory(input: SearchMemoryInput): Promise<SearchMemoryResult> {
  if (input.scopeKeys.length === 0) return { items: [], total: 0 }
  const limit = Math.min(Math.max(1, input.limit ?? 20), MAX_PAGE_SIZE)
  const skip = Math.max(0, input.skip ?? 0)

  const filtro: Record<string, unknown> = { tenantId: input.tenantId, scopeKey: { $in: input.scopeKeys } }
  if (input.key?.trim()) filtro.key = input.key.trim()
  if (input.sourceType?.trim()) filtro.sourceType = input.sourceType.trim()
  if (input.since || input.until) {
    filtro.createdAt = {
      ...(input.since ? { $gte: input.since } : {}),
      ...(input.until ? { $lte: input.until } : {}),
    }
  }
  if (input.query?.trim()) {
    // Uma expressão regular sobre o texto já achatado na gravação. Não promete
    // relevância — promete encontrar, sem IA e sem custo por consulta.
    filtro.searchText = { $regex: escaparRegex(input.query.trim().toLowerCase()) }
  }

  const [items, total] = await Promise.all([
    memories.find(filtro).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    memories.countDocuments(filtro),
  ])
  return { items, total }
}

export async function getMemoryById(tenantId: string, id: ObjectId): Promise<MemoryRecord | null> {
  return memories.findOne({ _id: id, tenantId })
}

// Apaga um registro. O `tenantId` no filtro é o que impede apagar o de outra conta
// com um id adivinhado.
export async function deleteMemory(tenantId: string, id: ObjectId, scopeKeys: string[]): Promise<boolean> {
  const r = await memories.deleteOne({ _id: id, tenantId, scopeKey: { $in: scopeKeys } })
  return r.deletedCount === 1
}

// Limpa um alvo inteiro. Devolve quantos saíram, para a interface poder dizer.
export async function clearMemories(tenantId: string, scopeKey: string, key?: string | null): Promise<number> {
  const filtro: Record<string, unknown> = { tenantId, scopeKey }
  if (key?.trim()) filtro.key = key.trim()
  const r = await memories.deleteMany(filtro)
  return r.deletedCount ?? 0
}

// Quantos registros e qual o mais recente, por alvo. É o que a tela precisa para
// mostrar os escopos sem baixar tudo.
export async function summarizeMemories(tenantId: string, scopeKeys: string[]): Promise<Record<string, { count: number; lastAt: Date | null }>> {
  if (scopeKeys.length === 0) return {}
  const linhas = await memories
    .aggregate<{ _id: string; count: number; lastAt: Date }>([
      { $match: { tenantId, scopeKey: { $in: scopeKeys } } },
      { $group: { _id: '$scopeKey', count: { $sum: 1 }, lastAt: { $max: '$createdAt' } } },
    ])
    .toArray()
  const fora: Record<string, { count: number; lastAt: Date | null }> = {}
  for (const l of linhas) fora[l._id] = { count: l.count, lastAt: l.lastAt ?? null }
  return fora
}
