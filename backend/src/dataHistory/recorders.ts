import { ObjectId } from 'mongodb'
import { ValidationError } from '../building.js'
import { normalizeMappingPath, normalizeMappingTarget } from '../integrations/websocket/mapping.js'
import { recordersCollection as recorders, apagarHistoricoDe, contarRegistros } from './store.js'
import { normalizarAgenda } from './schedule.js'
import { adapterDe, normalizarDestino } from './storage/index.js'
import { apagarJanelasDe } from './windows.js'
import { retencaoDe } from './types.js'
import { conferirFonte } from './sources.js'
import {
  AGGREGATIONS,
  PERSIST_POLICIES,
  DEFAULT_RETENTION_DAYS,
  MAX_INTERVAL_MS,
  MAX_RECORDERS_PER_OWNER,
  MAX_RETENTION_DAYS,
  MIN_INTERVAL_MS,
  RECORDER_MODES,
  SOURCE_KINDS,
} from './types.js'
import type { AggregationRule, DataRecorderDefinition, DerivedIndicator, PersistPolicy, RecorderFilter, RecorderMode, Retention, SourceKind } from './types.js'

/**
 * A DEFINIÇÃO de um histórico: o que gravar, de onde, quando e por quanto tempo.
 *
 * Ela nunca guarda segredo. A credencial de uma conexão continua na instalação do App,
 * cifrada; aqui fica só a referência — qual conexão, qual evento. Uma definição é
 * configuração, e configuração aparece em tela, em log e em prévia.
 */

const OPERADORES: RecorderFilter['operator'][] = ['exists', 'equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'contains']
const MAX_FILTROS = 10
const MAX_AGREGACOES = 12
const MAX_CAMPOS = 30

const texto = (v: unknown, campo: string, max = 120): string => {
  const s = String(v ?? '').trim()
  if (!s) throw new ValidationError(`${campo}: informe um valor.`)
  if (s.length > max) throw new ValidationError(`${campo}: texto longo demais.`)
  return s
}

const caminhoOpcional = (v: unknown, campo: string): string | null => (v === null || v === undefined || v === '' ? null : normalizeMappingPath(v, campo))

function normalizarFiltros(bruto: unknown): RecorderFilter[] {
  const lista = Array.isArray(bruto) ? bruto : []
  if (lista.length > MAX_FILTROS) throw new ValidationError(`no máximo ${MAX_FILTROS} filtros.`)
  return lista.map((f, i) => {
    const item = (f ?? {}) as Record<string, unknown>
    const operator = String(item.operator ?? 'exists') as RecorderFilter['operator']
    if (!OPERADORES.includes(operator)) throw new ValidationError(`filtro ${i + 1}: operador desconhecido.`)
    return { path: normalizeMappingPath(item.path, `filtro ${i + 1}`), operator, value: item.value }
  })
}

function normalizarAgregacoes(bruto: unknown): AggregationRule[] {
  const lista = Array.isArray(bruto) ? bruto : []
  if (lista.length > MAX_AGREGACOES) throw new ValidationError(`no máximo ${MAX_AGREGACOES} agregações.`)
  const vistos = new Set<string>()
  return lista.map((a, i) => {
    const item = (a ?? {}) as Record<string, unknown>
    const op = String(item.op ?? '') as AggregationRule['op']
    if (!AGGREGATIONS.includes(op)) throw new ValidationError(`agregação ${i + 1}: operação desconhecida.`)
    // `count` conta ocorrências: ele não lê campo nenhum, e exigir um seria mentir
    // sobre o que ele faz.
    const from = op === 'count' ? String(item.from ?? '') : normalizeMappingPath(item.from, `agregação ${i + 1}`)
    const to = normalizeMappingTarget(item.to, `agregação ${i + 1}`)
    if (vistos.has(to)) throw new ValidationError(`agregação ${i + 1}: "${to}" está repetido.`)
    vistos.add(to)
    return { from, op, to }
  })
}

/**
 * A retenção pedida — aceitando o formato novo, o antigo, ou nenhum.
 *
 * Os três casos existem de verdade: a tela nova manda `retention`, um cliente antigo
 * manda `retentionDays`, e quem não manda nada recebe o padrão. Recusar o formato
 * antigo quebraria integrações que funcionam hoje.
 */
export function normalizarRetencao(bruto: { retention?: unknown; retentionDays?: unknown }): Retention {
  const r = (bruto.retention ?? null) as { mode?: unknown; days?: unknown } | null
  if (r && typeof r === 'object' && r.mode !== undefined) {
    if (r.mode === 'forever') return { mode: 'forever' }
    if (r.mode === 'ttl') {
      const dias = Number(r.days)
      if (!Number.isFinite(dias) || dias < 1 || dias > MAX_RETENTION_DAYS) throw new ValidationError(`retenção: entre 1 e ${MAX_RETENTION_DAYS} dias.`)
      return { mode: 'ttl', days: Math.round(dias) }
    }
    throw new ValidationError('retenção: escolha "para sempre" ou um número de dias.')
  }
  if (bruto.retentionDays === null) return { mode: 'forever' }
  const dias = bruto.retentionDays === undefined ? DEFAULT_RETENTION_DAYS : Number(bruto.retentionDays)
  if (!Number.isFinite(dias) || dias < 1 || dias > MAX_RETENTION_DAYS) throw new ValidationError(`retenção: entre 1 e ${MAX_RETENTION_DAYS} dias.`)
  return { mode: 'ttl', days: Math.round(dias) }
}

export interface RecorderInput {
  name?: unknown
  enabled?: unknown
  source?: unknown
  entityKeyPath?: unknown
  occurredAtPath?: unknown
  mode?: unknown
  intervalMs?: unknown
  schedule?: unknown
  filters?: unknown
  persistPolicy?: unknown
  selectedFields?: unknown
  aggregations?: unknown
  changePath?: unknown
  retentionDays?: unknown
  retention?: unknown
  storage?: unknown
  buildingId?: unknown
  derivedFrom?: unknown
}

/**
 * A definição normalizada — ou a recusa com o motivo.
 *
 * Pura de propósito: ela não toca no banco, então a PRÉVIA da tela roda exatamente a
 * mesma validação que a gravação. Uma configuração que passa aqui é uma configuração
 * que o motor aceita, e não uma que "parece certa" na tela e é recusada depois.
 */
export function normalizarRecorder(bruto: RecorderInput): Omit<DataRecorderDefinition, '_id' | 'ownerId' | 'createdAt' | 'updatedAt' | 'recordCount' | 'lastRecordAt' | 'lastError'> {
  const name = texto(bruto.name, 'nome')
  const fonte = (bruto.source ?? {}) as Record<string, unknown>
  const kind = String(fonte.kind ?? '') as SourceKind
  if (!SOURCE_KINDS.includes(kind)) throw new ValidationError('fonte: escolha de onde o dado vem.')
  const ref = texto(fonte.ref, 'fonte', 200)

  const mode = String(bruto.mode ?? '') as RecorderMode
  if (!RECORDER_MODES.includes(mode)) throw new ValidationError('modo: escolha quando gravar.')

  const derivedFrom = normalizarDerivacao(bruto.derivedFrom)
  const aggregations = normalizarAgregacoes(bruto.aggregations)
  const filters = normalizarFiltros(bruto.filters)

  /**
   * A política decide o que a janela GRAVA — e o padrão é só o resumo.
   *
   * Guardar cada tique é legítimo, mas precisa ser escolha: um feed de três por segundo
   * produz 259 mil linhas por dia em bruto contra 288 em janelas de cinco minutos.
   */
  const persistPolicy = PERSIST_POLICIES.includes(String(bruto.persistPolicy ?? '') as PersistPolicy)
    ? (String(bruto.persistPolicy) as PersistPolicy)
    : 'aggregate_only'

  // `raw_only` não tem resumo a produzir; as outras duas precisam de pelo menos uma
  // regra, senão a janela fecharia num objeto vazio.
  if (mode === 'window_aggregate' && persistPolicy !== 'raw_only' && aggregations.length === 0) {
    throw new ValidationError('agregação por janela precisa de pelo menos uma regra — por exemplo, "price" com "último".')
  }

  /**
   * `condition` sem filtro é `every_event` com outro nome — e um nome que engana.
   *
   * Quem escolhe "só quando a condição bater" está dizendo que NEM TUDO deve ser
   * gravado. Aceitar a configuração sem condição nenhuma gravaria tudo, calado, e a
   * pessoa descobriria pelo tamanho do histórico.
   */
  if (mode === 'condition' && filters.length === 0) {
    throw new ValidationError('“só quando a condição bater” precisa de pelo menos um filtro. Sem nenhum, tudo seria gravado.')
  }

  let intervalMs: number | null = null
  if (mode === 'snapshot_interval' || mode === 'window_aggregate') {
    const n = Number(bruto.intervalMs ?? 0)
    if (!Number.isFinite(n) || n < MIN_INTERVAL_MS || n > MAX_INTERVAL_MS) {
      throw new ValidationError(`intervalo: entre ${Math.round(MIN_INTERVAL_MS / 1000)}s e ${Math.round(MAX_INTERVAL_MS / 3600_000)}h.`)
    }
    intervalMs = Math.round(n)
  }

  const schedule = mode === 'schedule_snapshot' ? normalizarAgenda(bruto.schedule) : null

  const campos = Array.isArray(bruto.selectedFields) ? bruto.selectedFields : null
  if (campos && campos.length > MAX_CAMPOS) throw new ValidationError(`no máximo ${MAX_CAMPOS} campos.`)
  const selectedFields = campos && campos.length ? campos.map((c, i) => normalizeMappingPath(c, `campo ${i + 1}`)) : null

  const retention = normalizarRetencao(bruto)
  const storage = normalizarDestino(bruto.storage)

  return {
    name,
    enabled: bruto.enabled === undefined ? true : Boolean(bruto.enabled),
    source: { kind, ref },
    entityKeyPath: caminhoOpcional(bruto.entityKeyPath, 'chave da entidade'),
    occurredAtPath: caminhoOpcional(bruto.occurredAtPath, 'instante do fato'),
    mode,
    intervalMs,
    schedule,
    persistPolicy,
    filters,
    selectedFields,
    aggregations,
    changePath: caminhoOpcional(bruto.changePath, 'campo observado'),
    retention,
    // O campo antigo continua sendo escrito: um cliente ou consulta que ainda o leia
    // não pode passar a ver `null` de repente e concluir que nada expira.
    retentionDays: retention.mode === 'ttl' ? retention.days : null,
    storage,
    buildingId: bruto.buildingId ? String(bruto.buildingId) : null,
    ...(derivedFrom ? { derivedFrom } : {}),
  }
}

/**
 * A DERIVAÇÃO, validada como o resto: ou ela faz sentido inteira, ou não entra.
 *
 * Uma derivação pela metade — sem função, sem campo, sem quantos pontos ler — produziria um
 * recorder que parece calculado e nunca calcula nada. E `lookback` tem teto porque ele vira o
 * `limit` de uma consulta à série a cada gravação.
 */
function normalizarDerivacao(bruto: unknown): DerivedIndicator | null {
  if (bruto === undefined || bruto === null) return null
  const d = bruto as Record<string, unknown>
  const origem = String(d.recorderId ?? '')
  if (!ObjectId.isValid(origem)) throw new ValidationError('derivação: escolha a série de origem.')
  const functionName = texto(d.functionName, 'derivação: função', 120)
  const version = texto(d.version, 'derivação: versão', 40)
  const inputField = texto(d.inputField, 'derivação: campo de entrada', 120)
  const inputArg = texto(d.inputArg, 'derivação: argumento da série', 120)
  const lookback = Math.trunc(Number(d.lookback ?? 0))
  if (!Number.isFinite(lookback) || lookback < 2 || lookback > 5000) {
    throw new ValidationError('derivação: quantos pontos ler precisa ser um inteiro de 2 a 5000.')
  }
  const params = d.params && typeof d.params === 'object' && !Array.isArray(d.params) ? (d.params as Record<string, unknown>) : {}
  return { recorderId: new ObjectId(origem), functionName, version, inputField, inputArg, lookback, params }
}

// --- repositório -----------------------------------------------------------------
// Tudo com o dono no filtro. Um id que chega do cliente nunca é usado sem ele.

export async function criarRecorder(ownerId: string, bruto: RecorderInput, agora = new Date()): Promise<DataRecorderDefinition> {
  const quantos = await recorders.countDocuments({ ownerId })
  if (quantos >= MAX_RECORDERS_PER_OWNER) throw new ValidationError(`limite de ${MAX_RECORDERS_PER_OWNER} históricos por conta.`)
  const def = normalizarRecorder(bruto)
  // A validação acima é pura e não toca no banco; a posse da fonte só dá para conferir
  // consultando. As duas juntas são a resposta completa: a configuração faz sentido E
  // aponta para algo desta conta.
  await conferirFonte(ownerId, def.source)
  const doc: DataRecorderDefinition = {
    _id: new ObjectId(),
    ownerId,
    ...def,
    recordCount: 0,
    lastRecordAt: null,
    lastError: null,
    createdAt: agora,
    updatedAt: agora,
  }
  await recorders.insertOne(doc)
  return doc
}

export const listarRecorders = (ownerId: string): Promise<DataRecorderDefinition[]> => recorders.find({ ownerId }).sort({ createdAt: -1 }).toArray()

export const obterRecorder = (ownerId: string, id: ObjectId): Promise<DataRecorderDefinition | null> => recorders.findOne({ _id: id, ownerId })

export async function atualizarRecorder(ownerId: string, id: ObjectId, bruto: RecorderInput, agora = new Date()): Promise<DataRecorderDefinition | null> {
  const atual = await obterRecorder(ownerId, id)
  if (!atual) return null
  // A definição inteira é revalidada, e não só o que veio: um patch parcial que passa
  // sozinho pode ser inválido junto com o que já estava lá.
  const def = normalizarRecorder({
    name: bruto.name ?? atual.name,
    enabled: bruto.enabled ?? atual.enabled,
    source: bruto.source ?? atual.source,
    entityKeyPath: bruto.entityKeyPath === undefined ? atual.entityKeyPath : bruto.entityKeyPath,
    occurredAtPath: bruto.occurredAtPath === undefined ? atual.occurredAtPath : bruto.occurredAtPath,
    mode: bruto.mode ?? atual.mode,
    persistPolicy: bruto.persistPolicy ?? atual.persistPolicy,
    intervalMs: bruto.intervalMs === undefined ? atual.intervalMs : bruto.intervalMs,
    schedule: bruto.schedule === undefined ? atual.schedule : bruto.schedule,
    filters: bruto.filters ?? atual.filters,
    selectedFields: bruto.selectedFields === undefined ? atual.selectedFields : bruto.selectedFields,
    aggregations: bruto.aggregations ?? atual.aggregations,
    changePath: bruto.changePath === undefined ? atual.changePath : bruto.changePath,
    // Trocar entre "para sempre" e "N dias" nos dois sentidos: o que não vier no patch
    // continua como está, e o que vier ganha.
    retention: bruto.retention === undefined ? retencaoDe(atual) : bruto.retention,
    retentionDays: bruto.retentionDays === undefined ? undefined : bruto.retentionDays,
    storage: bruto.storage === undefined ? (atual.storage ?? undefined) : bruto.storage,
    buildingId: bruto.buildingId === undefined ? atual.buildingId : bruto.buildingId,
  })
  await conferirFonte(ownerId, def.source)
  const r = await recorders.findOneAndUpdate({ _id: id, ownerId }, { $set: { ...def, updatedAt: agora } }, { returnDocument: 'after' })
  return (r as DataRecorderDefinition) ?? null
}

/** Apagar leva o histórico junto — é o que a pessoa espera de "apagar o histórico". */
export async function apagarRecorder(ownerId: string, id: ObjectId): Promise<boolean> {
  const atual = await obterRecorder(ownerId, id)
  if (!atual) return false
  const r = await recorders.deleteOne({ _id: id, ownerId })
  if (!r.deletedCount) return false
  // Pelo adapter: o histórico de um destino externo teria que ser apagado lá, e não
  // aqui. As janelas abertas são nossas em qualquer caso — elas são estado do motor.
  await adapterDe(atual).apagarTudo(ownerId, id)
  await apagarJanelasDe(id)
  return true
}

export const usoDoRecorder = (ownerId: string, id: ObjectId): Promise<number> => contarRegistros(ownerId, id)
