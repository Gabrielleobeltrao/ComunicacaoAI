import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { criarRecorder } from '../dataHistory/recorders.js'
import { ingestFact, limparCacheDeRecorders } from '../dataHistory/engine.js'
import { decryptInstallationConfig, getInstallation } from '../apps/installations.js'
import { collectOnce } from './collect.js'
import type { CollectResult } from './collect.js'
import { backoffDelay, computeHealth, isDue, nextReadAt } from './health.js'
import { validateMapping } from './mapping.js'
import { KIND_CAPABILITIES, MONITORING_SOURCE_KINDS, emptyTelemetry } from './types.js'
import type { MonitoringSource, MonitoringSourceKind, MonitoringStatus } from './types.js'

// A CENTRAL — e o que ela deliberadamente não é.
//
// Ela não é um motor de coleta. Uma fonte puxada vira um RECORDER do histórico, que já
// sabe filtrar, deduplicar, agregar em janela e apagar por retenção; e o registro gravado
// já acorda os monitores de dataset pelo caminho que existe. A Central decide O QUE ler e
// COMO normalizar; quem guarda, quem observa e quem dispara continua sendo quem sempre foi.
//
// O efeito prático é o pipeline inteiro sem uma linha de motor novo:
//
//   fonte → coleta → mapeamento → schema → recorder → dataset → monitor → Flow → Activity

const sources = db.collection<MonitoringSource>('monitoring_sources')

export async function ensureMonitoringIndexes(): Promise<void> {
  await sources.createIndex({ ownerId: 1, name: 1 }, { unique: true })
  await sources.createIndex({ ownerId: 1, status: 1, kind: 1 })
  // A varredura do worker: quem está ativa e puxada, pela leitura mais antiga primeiro.
  await sources.createIndex({ status: 1, 'cadence.mode': 1, 'telemetry.lastReadAt': 1 })
}

export class MonitoringError extends Error {
  constructor(
    message: string,
    readonly code = 'invalid',
  ) {
    super(message)
  }
}

const MAX_POR_CONTA = 200

export interface SourceInput {
  name: string
  description?: string
  kind: MonitoringSourceKind
  scope?: MonitoringSource['scope']
  connectionId?: string | null
  config?: MonitoringSource['config']
  schema?: Record<string, unknown>
  mapping: unknown
  cadence?: Partial<MonitoringSource['cadence']>
  retry?: Partial<MonitoringSource['retry']>
  freshness?: Partial<MonitoringSource['freshness']>
  entityKeyPath?: string | null
  dedupe?: MonitoringSource['dedupe']
  destination?: Partial<MonitoringSource['destination']>
}

/** Tetos de sanidade. Um intervalo de um segundo não é monitoramento, é um ataque ao outro lado. */
const MIN_INTERVAL_MS = 15_000
const MAX_INTERVAL_MS = 24 * 60 * 60_000

function normalizar(input: SourceInput): Omit<MonitoringSource, '_id' | 'ownerId' | 'status' | 'telemetry' | 'createdAt' | 'updatedAt'> {
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 120) throw new MonitoringError('dê um nome à fonte')
  if (!MONITORING_SOURCE_KINDS.includes(input.kind)) throw new MonitoringError('tipo de fonte desconhecido')

  const caps = KIND_CAPABILITIES[input.kind]
  const config = input.config ?? {}
  if (caps.needsUrl && !config.url) throw new MonitoringError('esta fonte precisa de um endereço')
  if (config.url) {
    // A forma agora; a POSSE do endereço (público, não privado) é conferida na leitura, por
    // `safeFetch`, que resolve o host de verdade — validar aqui seria uma segunda opinião.
    try {
      const u = new URL(config.url)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('esquema')
    } catch {
      throw new MonitoringError('o endereço não é uma URL válida')
    }
  }

  /**
   * SEGREDO nunca fica na fonte — nem na URL, nem na query, nem no corpo.
   *
   * Uma chave na query viaja no log do servidor do outro lado, no referer e no histórico
   * do navegador de quem colar o endereço. A peneira recusa na criação, e não na leitura:
   * gravado, o segredo já vazou para o documento que a tela lê inteiro.
   */
  assertSemSegredo(config)

  const mapping = validateMapping(input.mapping)

  const modo = input.cadence?.mode ?? (caps.pull ? 'interval' : 'stream')
  if (caps.pull && modo === 'stream') throw new MonitoringError('esta fonte é lida por consulta: escolha um intervalo')
  if (!caps.pull && modo !== 'stream') throw new MonitoringError('esta fonte chega sozinha: ela não tem intervalo')

  const intervalMs = modo === 'interval' ? Number(input.cadence?.intervalMs ?? 60_000) : null
  if (intervalMs !== null && (!Number.isFinite(intervalMs) || intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS)) {
    throw new MonitoringError(`o intervalo fica entre ${MIN_INTERVAL_MS / 1000}s e 24h`)
  }

  const destino = { live: Boolean(input.destination?.live), history: input.destination?.history !== false }
  if (!destino.live && !destino.history) throw new MonitoringError('escolha ao menos um destino: ao vivo ou histórico')

  return {
    scope: input.scope ?? { ownerType: 'account', ownerId: '' },
    name,
    description: String(input.description ?? '').slice(0, 500),
    kind: input.kind,
    connectionId: input.connectionId && ObjectId.isValid(input.connectionId) ? new ObjectId(input.connectionId) : null,
    config,
    schema: input.schema ?? schemaDoMapeamento(mapping),
    mapping,
    cadence: { mode: modo, intervalMs, cron: input.cadence?.cron ?? null, timezone: input.cadence?.timezone ?? null },
    retry: {
      timeoutMs: Math.min(60_000, Math.max(1_000, Number(input.retry?.timeoutMs ?? 10_000))),
      maxAttempts: Math.min(10, Math.max(1, Number(input.retry?.maxAttempts ?? 3))),
      backoffMs: Math.min(300_000, Math.max(1_000, Number(input.retry?.backoffMs ?? 5_000))),
      jitterRatio: Math.min(1, Math.max(0, Number(input.retry?.jitterRatio ?? 0.3))),
      rateLimitPerMinute: input.retry?.rateLimitPerMinute ?? null,
    },
    freshness: {
      // O padrão é generoso com fonte lenta e implacável com fonte parada: três intervalos.
      staleAfterMs: Number(input.freshness?.staleAfterMs ?? (intervalMs ? intervalMs * 3 : 15 * 60_000)),
      onStale: input.freshness?.onStale === 'ignore' ? 'ignore' : 'degrade',
    },
    entityKeyPath: input.entityKeyPath ? String(input.entityKeyPath) : null,
    dedupe: input.dedupe ?? { mode: 'content_hash' },
    destination: { ...destino, recorderId: null, realtimeSourceId: null, retentionDays: input.destination?.retentionDays ?? null },
  }
}

/**
 * Nome que denuncia credencial. `token` entra sozinho de propósito: um parâmetro chamado
 * `token`, `authToken` ou `t0ken` é credencial em qualquer API que já vi, e o custo de um
 * falso positivo é a pessoa renomear o parâmetro — bem menor que o de vazar a chave.
 */
const PARECE_SEGREDO = /(api[-_]?key|apikey|token|bearer|secret|password|senha|credential|private[-_]?key|authorization|auth)/i
const VALOR_DE_SEGREDO = /(^|[^A-Za-z0-9])(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|ey[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{12,})/

function assertSemSegredo(config: MonitoringSource['config']): void {
  const url = String(config.url ?? '')
  if (url) {
    let alvo: URL | null = null
    try {
      alvo = new URL(url)
    } catch {
      alvo = null
    }
    if (alvo) {
      if (alvo.username || alvo.password) throw new MonitoringError('tire a credencial do endereço: use uma conexão', 'secret_in_config')
      for (const [chave, valor] of alvo.searchParams) {
        if (PARECE_SEGREDO.test(chave) || VALOR_DE_SEGREDO.test(valor)) {
          throw new MonitoringError(`o parâmetro "${chave}" parece uma credencial: use uma conexão`, 'secret_in_config')
        }
      }
    }
  }
  for (const q of config.query ?? []) {
    if (PARECE_SEGREDO.test(String(q.key)) || VALOR_DE_SEGREDO.test(String(q.value))) {
      throw new MonitoringError(`o parâmetro "${q.key}" parece uma credencial: use uma conexão`, 'secret_in_config')
    }
  }
  if (config.body && VALOR_DE_SEGREDO.test(config.body)) {
    throw new MonitoringError('o corpo parece carregar uma credencial: use uma conexão', 'secret_in_config')
  }
}

/** O schema derivado do mapeamento — quem mapeou já disse a forma; pedir de novo é cerimônia. */
const schemaDoMapeamento = (mapping: MonitoringSource['mapping']): Record<string, unknown> => ({
  type: 'object',
  properties: Object.fromEntries(mapping.fields.map((f) => [f.to, {}])),
  required: mapping.fields.filter((f) => f.required).map((f) => f.to),
  additionalProperties: true,
})

/** A chave que liga esta fonte ao histórico. Estável, derivada do id: não há o que sincronizar. */
export const sourceKeyOf = (id: ObjectId | string) => `manual:monitoring:${id.toString()}`

/**
 * De onde o recorder desta fonte ESCUTA.
 *
 * Os tipos que EMPURRAM já têm porta no motor de histórico: `event` para o barramento e
 * `live_data` para uma conexão de WebSocket. Ligar a fonte diretamente nelas é o oposto de
 * inventar um caminho — o dado chega pelo mesmo lugar de sempre, e a Central só diz que
 * agora tem alguém guardando.
 *
 * Os que a Central PUXA usam `manual`, que é a porta que o motor já oferecia justamente
 * para uma integração nova entrar sem código novo dentro dele.
 */
function fonteDoRecorder(fonte: MonitoringSource): { kind: 'event' | 'live_data' | 'manual'; ref: string } {
  if (fonte.kind === 'internal_event' && fonte.config.eventType) return { kind: 'event', ref: fonte.config.eventType }
  if (fonte.kind === 'websocket' && fonte.config.installationId) return { kind: 'live_data', ref: fonte.config.installationId }
  return { kind: 'manual', ref: `monitoring:${fonte._id.toString()}` }
}

export async function createSource(ownerId: string, input: SourceInput): Promise<MonitoringSource> {
  if ((await sources.countDocuments({ ownerId })) >= MAX_POR_CONTA) {
    throw new MonitoringError(`limite de ${MAX_POR_CONTA} fontes por conta`, 'quota')
  }
  const campos = normalizar(input)
  const agora = new Date()
  const doc: MonitoringSource = {
    _id: new ObjectId(),
    ownerId,
    ...campos,
    scope: campos.scope.ownerId ? campos.scope : { ownerType: 'account', ownerId },
    // Toda fonte nasce RASCUNHO: ativar é um ato, e antes dele ninguém sai batendo num
    // servidor de terceiro de minuto em minuto.
    status: 'draft',
    telemetry: emptyTelemetry(),
    createdAt: agora,
    updatedAt: agora,
  }
  try {
    await sources.insertOne(doc)
  } catch (erro) {
    if ((erro as { code?: number }).code === 11000) throw new MonitoringError('já existe uma fonte com esse nome', 'duplicate')
    throw erro
  }
  return doc
}

export const getSource = (ownerId: string, id: ObjectId) => sources.findOne({ _id: id, ownerId })
export const listSources = (ownerId: string) => sources.find({ ownerId }).sort({ name: 1 }).toArray()

export async function updateSource(ownerId: string, id: ObjectId, input: SourceInput): Promise<MonitoringSource | null> {
  const existente = await sources.findOne({ _id: id, ownerId })
  if (!existente) return null
  const campos = normalizar(input)
  const atualizado = await sources.findOneAndUpdate(
    { _id: id, ownerId },
    {
      $set: {
        ...campos,
        // O destino já materializado é preservado: reescrevê-lo com `null` desligaria a
        // fonte do histórico que ela vem alimentando.
        destination: { ...campos.destination, recorderId: existente.destination.recorderId ?? null, realtimeSourceId: existente.destination.realtimeSourceId ?? null },
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' },
  )
  return atualizado ?? null
}

export async function setSourceStatus(ownerId: string, id: ObjectId, status: MonitoringStatus): Promise<MonitoringSource | null> {
  const fonte = await sources.findOne({ _id: id, ownerId })
  if (!fonte) return null
  /**
   * Ativar EXIGE ter lido com sucesso pelo menos uma vez.
   *
   * Uma fonte que nunca respondeu, ativada, vira uma fonte degradada minutos depois — e o
   * painel nasce vermelho por uma configuração que ninguém chegou a testar.
   */
  if (status === 'active' && !fonte.telemetry.lastOkAt && KIND_CAPABILITIES[fonte.kind].pull) {
    throw new MonitoringError('teste a fonte antes de ativar: ela ainda não leu nada', 'never_read')
  }
  /**
   * Uma fonte que EMPURRA precisa dizer de onde o dado chega.
   *
   * Sem `eventType` ou `installationId`, o recorder cairia em `manual` e ficaria esperando
   * uma entrega que ninguém faz — uma fonte ativa, verde, e muda para sempre.
   */
  if (status === 'active' && fonte.kind === 'internal_event' && !fonte.config.eventType) {
    throw new MonitoringError('escolha qual evento esta fonte observa', 'missing_source_ref')
  }
  if (status === 'active' && fonte.kind === 'websocket' && !fonte.config.installationId) {
    throw new MonitoringError('escolha qual conexão de WebSocket esta fonte observa', 'missing_source_ref')
  }
  if (status === 'active') await materializarDestino(fonte)
  return (await sources.findOneAndUpdate({ _id: id, ownerId }, { $set: { status, updatedAt: new Date() } }, { returnDocument: 'after' })) ?? null
}

/**
 * Duplicar existe porque a segunda fonte quase sempre é a primeira com uma URL diferente.
 *
 * O que NÃO é copiado: telemetria, destino materializado e o estado de ativação. A cópia
 * nasce rascunho e sem passado — herdar a telemetria faria a nova fonte parecer saudável
 * sem nunca ter lido nada.
 */
export async function duplicateSource(ownerId: string, id: ObjectId): Promise<MonitoringSource | null> {
  const fonte = await sources.findOne({ _id: id, ownerId })
  if (!fonte) return null
  const agora = new Date()
  const copia: MonitoringSource = {
    ...fonte,
    _id: new ObjectId(),
    name: `${fonte.name} (cópia)`.slice(0, 120),
    status: 'draft',
    telemetry: emptyTelemetry(),
    destination: { ...fonte.destination, recorderId: null, realtimeSourceId: null },
    createdAt: agora,
    updatedAt: agora,
  }
  try {
    await sources.insertOne(copia)
  } catch (erro) {
    if ((erro as { code?: number }).code === 11000) throw new MonitoringError('já existe uma fonte com esse nome', 'duplicate')
    throw erro
  }
  return copia
}

/**
 * Excluir não leva o histórico junto.
 *
 * O que a fonte gravou é fato acontecido, e o recorder continua sendo dono dele. Apagar a
 * regra de coleta é diferente de apagar o passado — e quem quer o segundo faz isso em
 * Históricos, olhando o que vai perder.
 */
export async function deleteSource(ownerId: string, id: ObjectId): Promise<boolean> {
  const r = await sources.deleteOne({ _id: id, ownerId })
  return r.deletedCount === 1
}

/**
 * Os cabeçalhos que a CONEXÃO empresta.
 *
 * A fonte guarda o nome do cabeçalho; o valor sai da instalação cifrada, aqui, no momento
 * da leitura. É por isso que o documento da fonte pode ser lido inteiro na tela sem
 * expor nada.
 */
async function cabecalhosDaConexao(fonte: Pick<MonitoringSource, 'ownerId' | 'connectionId' | 'config'>): Promise<Record<string, string>> {
  if (!fonte.connectionId) return {}
  const instalacao = await getInstallation(fonte.ownerId, fonte.connectionId)
  if (!instalacao) throw new MonitoringError('a conexão desta fonte não existe mais', 'connection_missing')
  const cfg = decryptInstallationConfig(instalacao)
  const saida: Record<string, string> = {}
  for (const nome of fonte.config.headerNames ?? []) {
    // O nome do cabeçalho é a chave no cofre da conexão. Nada de interpolação livre: um
    // template aqui deixaria a fonte montar um cabeçalho com o segredo de outro campo.
    const valor = cfg[nome] ?? cfg[nome.toLowerCase()]
    if (valor) saida[nome] = String(valor)
  }
  return saida
}

export interface TestResult extends CollectResult {
  /** O que a tela mostra sobre o schema: os campos que vieram e os que faltaram. */
  fields: { name: string; present: boolean }[]
}

/**
 * Testar de verdade — a mesma leitura que a fonte fará quando ativa.
 *
 * Um "teste" que valida só a configuração não prova nada: o que quebra é o outro lado.
 * Por isso este caminho é o mesmo da coleta real, com a mesma guarda de SSRF e o mesmo
 * mapeamento — e o resultado que a tela mostra é a amostra REDIGIDA.
 */
export async function testSource(ownerId: string, entrada: MonitoringSource | SourceInput): Promise<TestResult> {
  const fonte =
    '_id' in entrada
      ? entrada
      : ({ ...normalizar(entrada as SourceInput), ownerId, _id: new ObjectId(), status: 'draft', telemetry: emptyTelemetry(), createdAt: new Date(), updatedAt: new Date() } as MonitoringSource)

  const headers = await cabecalhosDaConexao({ ownerId, connectionId: fonte.connectionId ?? null, config: fonte.config })
  const r = await collectOnce(fonte, { headers, ownerId })
  const presentes = new Set(Object.entries(r.rows[0] ?? {}).filter(([, v]) => v !== null && v !== undefined).map(([k]) => k))
  return { ...r, fields: fonte.mapping.fields.map((f) => ({ name: f.to, present: presentes.has(f.to) })) }
}

/**
 * O destino, criado no subsistema canônico — e só quando a fonte é ativada.
 *
 * O recorder é do histórico: ele já sabe filtrar, deduplicar, agregar e apagar por
 * retenção. A Central não repete nada disso; ela só diz qual `sourceKey` alimentar.
 */
async function materializarDestino(fonte: MonitoringSource): Promise<void> {
  if (!fonte.destination.history || fonte.destination.recorderId) return
  const recorder = await criarRecorder(fonte.ownerId, {
    name: fonte.name,
    enabled: true,
    source: fonteDoRecorder(fonte),
    entityKeyPath: fonte.entityKeyPath,
    mode: 'every_event',
    selectedFields: fonte.mapping.fields.map((f) => f.to),
    ...(fonte.destination.retentionDays ? { retentionDays: fonte.destination.retentionDays } : {}),
  })
  await sources.updateOne({ _id: fonte._id }, { $set: { 'destination.recorderId': recorder._id, updatedAt: new Date() } })
  /**
   * O motor de histórico guarda em cache quais recorders atendem cada `sourceKey`.
   *
   * Testar a fonte antes de ativar preenche esse cache com "nenhum" — e a primeira coleta
   * depois da ativação não gravaria nada, por até um cache inteiro. Quem cria o recorder é
   * quem sabe que a resposta mudou, então é aqui que a lembrança é desfeita.
   */
  limparCacheDeRecorders()
}

export interface ReadOutcome {
  ok: boolean
  rows: number
  recorded: number
  /** Leu bem, e o dado é o mesmo de antes. Saúde é uma coisa; novidade é outra. */
  unchanged?: boolean
  latencyMs: number
  error?: { kind: string; message: string }
  nextAttemptMs?: number
}

/**
 * Uma leitura completa: coleta, grava telemetria e entrega ao histórico.
 *
 * A telemetria é gravada SEMPRE — inclusive quando falha. Um caminho de erro que sai sem
 * escrever nada é uma fonte que quebra em silêncio e continua verde na tela.
 */
export async function readSourceOnce(fonte: MonitoringSource, agora: Date = new Date()): Promise<ReadOutcome> {
  let headers: Record<string, string> = {}
  try {
    headers = await cabecalhosDaConexao(fonte)
  } catch (erro) {
    await registrarFalha(fonte, 'connection_missing', agora)
    return { ok: false, rows: 0, recorded: 0, latencyMs: 0, error: { kind: 'connection_missing', message: (erro as Error).message } }
  }

  const r = await collectOnce(fonte, { headers, ownerId: fonte.ownerId })
  if (!r.ok) {
    await registrarFalha(fonte, r.error?.kind ?? 'erro', agora, r.latencyMs)
    return {
      ok: false,
      rows: 0,
      recorded: 0,
      latencyMs: r.latencyMs,
      error: r.error ?? { kind: 'erro', message: 'falhou' },
      nextAttemptMs: backoffDelay(fonte.retry, fonte.telemetry.consecutiveFailures + 1),
    }
  }

  // Campo obrigatório faltando NÃO vira leitura boa: gravar meia linha é pior do que não
  // gravar, porque a série fica com um buraco que parece dado.
  if (r.missing.length) {
    await registrarFalha(fonte, 'schema', agora, r.latencyMs)
    return { ok: false, rows: r.rows.length, recorded: 0, latencyMs: r.latencyMs, error: { kind: 'schema', message: `faltou: ${r.missing.join(', ')}` } }
  }

  /**
   * A DEDUPE por conteúdo acontece AQUI, e não no histórico.
   *
   * O motor de histórico compõe a identidade do fato com o instante em que ele ocorreu — e
   * está certo: o mesmo preço às 10h e às 11h são dois fatos. Mas uma fonte que responde a
   * mesma coisa a cada minuto não produz sessenta fatos por hora, e sim um que continua
   * valendo. Quem sabe disso é a fonte, então é ela que decide não entregar de novo.
   */
  const hashDaLeitura = hashDaLinha({ linhas: r.rows })
  if (fonte.dedupe.mode === 'content_hash' && fonte.telemetry.lastContentHash === hashDaLeitura) {
    await sources.updateOne(
      { _id: fonte._id },
      {
        $set: {
          'telemetry.lastReadAt': agora,
          'telemetry.lastOkAt': agora,
          'telemetry.lastLatencyMs': r.latencyMs,
          'telemetry.consecutiveFailures': 0,
          'telemetry.lastErrorCode': null,
          updatedAt: agora,
        },
        $inc: { 'telemetry.readsOk': 1 },
      },
    )
    // Leitura boa, zero gravado: a fonte está saudável, o dado é que não mudou.
    return { ok: true, rows: r.rows.length, recorded: 0, latencyMs: r.latencyMs, unchanged: true }
  }

  let recorded = 0
  if (fonte.destination.history) {
    for (const linha of r.rows.slice(0, 200)) {
      const resultado = await ingestFact({
        ownerId: fonte.ownerId,
        sourceKey: sourceKeyOf(fonte._id),
        entityKey: fonte.entityKeyPath ? String(linha[fonte.entityKeyPath] ?? '') || null : null,
        occurredAt: agora,
        value: linha,
        // A identidade do fato: com ela, a mesma leitura entregue duas vezes grava uma.
        ...(fonte.dedupe.mode === 'field' && fonte.dedupe.field
          ? { factId: `${fonte._id.toString()}:${String(linha[fonte.dedupe.field] ?? '')}` }
          : fonte.dedupe.mode === 'content_hash'
            ? { factId: `${fonte._id.toString()}:${hashDaLinha(linha)}` }
            : {}),
      })
      recorded += resultado.gravado ?? 0
    }
  }

  await sources.updateOne(
    { _id: fonte._id },
    {
      $set: {
        'telemetry.lastReadAt': agora,
        'telemetry.lastOkAt': agora,
        'telemetry.lastLatencyMs': r.latencyMs,
        'telemetry.consecutiveFailures': 0,
        'telemetry.lastErrorCode': null,
        /**
         * O hash guardado é o do que foi GRAVADO, não o do que foi lido.
         *
         * Guardar o que só foi lido envenena a dedupe: testar a fonte antes de ativar
         * faria a primeira coleta de verdade achar que "não mudou" e não gravar nada.
         */
        ...(recorded > 0 || !fonte.destination.history ? { 'telemetry.lastContentHash': hashDaLeitura } : {}),
        updatedAt: agora,
      },
      $inc: { 'telemetry.readsOk': 1 },
    },
  )
  return { ok: true, rows: r.rows.length, recorded, latencyMs: r.latencyMs }
}

/** O hash do conteúdo — é o que faz "o mesmo valor de novo" não virar uma segunda linha. */
function hashDaLinha(linha: Record<string, unknown>): string {
  const ordenado = JSON.stringify(Object.fromEntries(Object.entries(linha).sort(([a], [b]) => a.localeCompare(b))))
  let h = 0
  for (let i = 0; i < ordenado.length; i++) h = (Math.imul(31, h) + ordenado.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

async function registrarFalha(fonte: MonitoringSource, code: string, agora: Date, latencyMs = 0): Promise<void> {
  await sources.updateOne(
    { _id: fonte._id },
    {
      $set: { 'telemetry.lastReadAt': agora, 'telemetry.lastErrorAt': agora, 'telemetry.lastErrorCode': code, 'telemetry.lastLatencyMs': latencyMs, updatedAt: agora },
      $inc: { 'telemetry.readsFailed': 1, 'telemetry.consecutiveFailures': 1 },
    },
  )
}

/** As fontes que precisam ser lidas agora. É o que o worker pergunta a cada tique. */
export async function dueSources(agora: Date = new Date(), limite = 50): Promise<MonitoringSource[]> {
  const candidatas = await sources.find({ status: 'active', 'cadence.mode': 'interval' }).limit(limite * 4).toArray()
  return candidatas.filter((f) => isDue(f, agora)).slice(0, limite)
}

/** A VISÃO GERAL — uma linha por fonte, com o que a pessoa precisa para decidir olhar. */
export async function overview(ownerId: string, agora: Date = new Date()) {
  const todas = await sources.find({ ownerId }).sort({ name: 1 }).toArray()
  const itens = todas.map((f) => {
    const saude = computeHealth(f, agora)
    return {
      id: f._id.toString(),
      name: f.name,
      kind: f.kind,
      status: f.status,
      health: saude.health,
      reason: saude.reason,
      lastReadAt: f.telemetry.lastReadAt,
      lastOkAt: f.telemetry.lastOkAt,
      latencyMs: f.telemetry.lastLatencyMs,
      consecutiveFailures: f.telemetry.consecutiveFailures,
      readsOk: f.telemetry.readsOk,
      readsFailed: f.telemetry.readsFailed,
      nextReadAt: nextReadAt(f, agora),
      destination: { live: f.destination.live, history: f.destination.history },
    }
  })
  return {
    items: itens,
    // O resumo que o topo da tela mostra. Contado do que acabou de ser derivado, e não de
    // um contador guardado — que divergiria na primeira falha de escrita.
    summary: {
      total: itens.length,
      online: itens.filter((i) => i.health === 'online').length,
      degraded: itens.filter((i) => i.health === 'degraded').length,
      paused: itens.filter((i) => i.health === 'paused').length,
      neverRead: itens.filter((i) => i.health === 'never_read').length,
    },
  }
}

export const sourcesCollection = sources

// --- o AO VIVO -------------------------------------------------------------------------

export interface LiveReading {
  at: Date
  /** O valor já mapeado — e redigido antes de sair daqui. */
  value: Record<string, unknown>
}

export interface LiveSource {
  id: string
  name: string
  kind: MonitoringSourceKind
  health: string
  lastReadAt: Date | null
  latencyMs: number | null
  reconnects: number
  readsOk: number
  readsFailed: number
  /** As últimas leituras que viraram registro. É o que "ao vivo" quer dizer. */
  readings: LiveReading[]
  /** Quantas execuções esta fonte causou — o elo com o Flow. */
  triggers: number
}

/**
 * O que está CHEGANDO — e não só quem está de pé.
 *
 * A primeira versão desta aba listava as fontes ativas e chamava isso de "ao vivo". Mas
 * quem abre "ao vivo" quer ver o VALOR que acabou de entrar, não uma lista de nomes com
 * bolinha verde: a pergunta é "o que está acontecendo agora", e um nome não responde isso.
 *
 * O valor sai REDIGIDO: a mesma peneira da amostra do wizard. Uma tela que fica aberta na
 * parede do escritório não pode mostrar o que veio dentro do payload.
 */
export async function liveView(ownerId: string, limitePorFonte = 5): Promise<{ items: LiveSource[] }> {
  const ativas = await sources.find({ ownerId, status: 'active' }).sort({ name: 1 }).limit(50).toArray()
  if (ativas.length === 0) return { items: [] }

  const { listarRegistros } = await import('../dataHistory/store.js')
  const { redactSample } = await import('./mapping.js')
  const agora = new Date()

  const items = await Promise.all(
    ativas.map(async (f) => {
      const recorderId = f.destination.recorderId
      const registros = recorderId
        ? await listarRegistros(ownerId, { recorderId, limit: limitePorFonte }).catch(() => [])
        : []

      /**
       * Quantas execuções esta fonte causou.
       *
       * Contado das execuções que o monitor pediu, e não de um contador próprio: um
       * contador aqui divergiria do painel de execuções na primeira falha de escrita, e
       * aí a mesma pergunta teria duas respostas.
       */
      const monitorIds = await db
        .collection('monitors')
        .find({ ownerId, 'source.kind': 'database', 'source.datasetKey': recorderId?.toString() ?? '__nenhum__' }, { projection: { _id: 1 } })
        .toArray()
      const triggers = monitorIds.length
        ? await db.collection('automation_runs').countDocuments({
            ownerId,
            requestId: { $in: monitorIds.map((m) => new RegExp(`^monitor:${m._id.toString()}:`)) },
          })
        : 0

      return {
        id: f._id.toString(),
        name: f.name,
        kind: f.kind,
        health: computeHealth(f, agora).health,
        lastReadAt: f.telemetry.lastReadAt,
        latencyMs: f.telemetry.lastLatencyMs,
        reconnects: f.telemetry.reconnects,
        readsOk: f.telemetry.readsOk,
        readsFailed: f.telemetry.readsFailed,
        readings: registros.map((r) => ({ at: r.occurredAt, value: redactSample(r.value) as Record<string, unknown> })),
        triggers,
      }
    }),
  )
  return { items }
}
