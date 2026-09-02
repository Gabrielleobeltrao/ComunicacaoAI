import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import { getAutomation } from '../automations/service.js'
import { EVENT_TYPES, isEventType } from '../events/types.js'
import { ConditionError, TRIGGER_MODES, describeCondition, parseCondition } from './condition.js'
import type { TriggerMode } from './condition.js'
import { monitorsCollection, monitorStatesCollection } from './state.js'
import type { MonitorDefinition } from './state.js'

// CRIAR E PUBLICAR um monitor — e as duas coisas são separadas de propósito.
//
// Salvar nunca publica. Um monitor é uma coisa que age sozinha; se editar o rascunho
// mudasse na mesma hora o que dispara de madrugada, uma edição pela metade viraria
// comportamento em produção antes de alguém terminar de pensar. O rascunho é livre; o
// publicado é o que alguém revisou.

export class MonitorError extends Error {
  constructor(
    message: string,
    readonly code = 'invalid',
  ) {
    super(message)
  }
}

export interface MonitorInput {
  name: string
  source: MonitorDefinition['source']
  condition: unknown
  triggerMode: TriggerMode
  threshold?: number | null
  thresholdField?: string | null
  debounceMs?: number
  cooldownMs?: number
  flowId?: string | null
}

/** Tetos de sanidade: uma janela de dias não é debounce, é um monitor desligado por engano. */
const MAX_JANELA_MS = 24 * 60 * 60_000

/**
 * Os campos que a condição pode ler — vindos da FONTE, nunca do que alguém digitou.
 *
 * Num dataset, o schema declarado é a resposta. Num evento da plataforma não existe
 * schema declarado em lugar nenhum deste repositório, e inventar uma lista aqui seria
 * uma segunda verdade que envelheceria sozinha: o que se confere então é a FORMA do
 * nome — identificador simples, sem `$` e sem ponto —, que é o que impede uma condição
 * de alcançar outra coisa além do payload.
 */
const NOME_DE_CAMPO = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/

async function camposDaFonte(ownerId: string, source: MonitorDefinition['source'], condicao: unknown): Promise<string[]> {
  if (source.kind === 'database') {
    const dataset = await db
      .collection('dataset_definitions')
      .findOne({ ownerId, dataStoreId: source.dataStoreId, key: source.datasetKey }, { projection: { schema: 1 } })
    if (!dataset) throw new MonitorError('o dataset desta fonte não existe nesta conta', 'not_found')
    const props = (dataset.schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
    return Object.keys(props)
  }
  // Evento: a conferência é de forma, e ela acontece aqui, antes de o parser ver o nome.
  const usados = camposUsados(condicao)
  for (const campo of usados) {
    if (!NOME_DE_CAMPO.test(campo)) throw new MonitorError(`o campo "${campo}" não é um nome de campo válido`)
  }
  return usados
}

/** Os nomes que a condição cita — lidos da árvore crua, antes de ela ser aceita. */
function camposUsados(bruto: unknown, saida: string[] = []): string[] {
  if (!bruto || typeof bruto !== 'object') return saida
  const n = bruto as Record<string, unknown>
  if (typeof n.field === 'string') saida.push(n.field)
  if (Array.isArray(n.children)) for (const f of n.children) camposUsados(f, saida)
  if (n.child) camposUsados(n.child, saida)
  return saida
}

async function normalizar(ownerId: string, input: MonitorInput): Promise<Omit<MonitorDefinition, '_id' | 'ownerId' | 'status' | 'createdAt' | 'updatedAt'>> {
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 160) throw new MonitorError('dê um nome ao monitor')

  const source = normalizarFonte(input.source)
  const campos = await camposDaFonte(ownerId, source, input.condition)

  let condition
  try {
    condition = parseCondition(input.condition, campos)
  } catch (erro) {
    if (erro instanceof ConditionError) throw new MonitorError(erro.message, 'invalid_condition')
    throw erro
  }

  if (!TRIGGER_MODES.includes(input.triggerMode)) throw new MonitorError('modo de disparo desconhecido')

  const thresholdField = input.thresholdField ? String(input.thresholdField) : null
  if (thresholdField && !campos.includes(thresholdField) && source.kind === 'database') {
    throw new MonitorError(`o campo "${thresholdField}" não existe nesta fonte`)
  }
  // Cruzamento é comparação com um limiar: sem ele, o modo não tem o que comparar e
  // nunca dispararia — melhor recusar agora do que entregar um monitor mudo.
  const cruzamento = input.triggerMode === 'cross_up' || input.triggerMode === 'cross_down'
  const threshold = input.threshold === null || input.threshold === undefined ? null : Number(input.threshold)
  if (cruzamento && (threshold === null || !Number.isFinite(threshold) || !thresholdField)) {
    throw new MonitorError('um cruzamento precisa do campo e do limiar comparados')
  }

  const janela = (v: unknown, nome: string): number => {
    const n = Number(v ?? 0)
    if (!Number.isFinite(n) || n < 0) throw new MonitorError(`${nome} precisa ser um número de milissegundos`)
    if (n > MAX_JANELA_MS) throw new MonitorError(`${nome} passa de 24 horas`)
    return Math.floor(n)
  }

  // O Flow é conferido AGORA: um id que não é desta conta não vira ação gravada.
  let action: MonitorDefinition['action'] = null
  if (input.flowId) {
    if (!ObjectId.isValid(input.flowId)) throw new MonitorError('o Flow informado não existe', 'not_found')
    const flow = await getAutomation(ownerId, new ObjectId(input.flowId))
    if (!flow) throw new MonitorError('o Flow informado não existe', 'not_found')
    action = { flowId: flow._id }
  }

  return {
    name,
    source,
    condition,
    triggerMode: input.triggerMode,
    threshold: Number.isFinite(threshold as number) ? (threshold as number) : null,
    thresholdField,
    debounceMs: janela(input.debounceMs, 'o debounce'),
    cooldownMs: janela(input.cooldownMs, 'o cooldown'),
    action,
  }
}

function normalizarFonte(bruto: MonitorDefinition['source']): MonitorDefinition['source'] {
  if (bruto?.kind === 'internal_event') {
    if (!isEventType(bruto.eventType)) throw new MonitorError('tipo de evento desconhecido')
    return { kind: 'internal_event', eventType: bruto.eventType }
  }
  if (bruto?.kind === 'database') {
    const dataStoreId = bruto.dataStoreId instanceof ObjectId ? bruto.dataStoreId : new ObjectId(String(bruto.dataStoreId))
    const datasetKey = String(bruto.datasetKey ?? '').trim()
    if (!datasetKey) throw new MonitorError('escolha o conjunto de dados observado')
    return { kind: 'database', dataStoreId, datasetKey, ...(bruto.field ? { field: String(bruto.field) } : {}) }
  }
  throw new MonitorError('fonte desconhecida')
}

export async function createMonitor(ownerId: string, input: MonitorInput): Promise<MonitorDefinition> {
  const campos = await normalizar(ownerId, input)
  const agora = new Date()
  const doc: MonitorDefinition = { _id: new ObjectId(), ownerId, ...campos, status: 'draft', createdAt: agora, updatedAt: agora }
  await monitorsCollection.insertOne(doc)
  return doc
}

/** Editar mexe no rascunho — e um monitor publicado volta a rascunho quando muda. */
export async function updateMonitor(ownerId: string, id: ObjectId, input: MonitorInput): Promise<MonitorDefinition | null> {
  const existente = await monitorsCollection.findOne({ _id: id, ownerId })
  if (!existente) return null
  const campos = await normalizar(ownerId, input)
  const atualizado = await monitorsCollection.findOneAndUpdate(
    { _id: id, ownerId },
    {
      $set: {
        ...campos,
        // Editar o que está de plantão o tira de plantão: o que age sozinho é o que
        // alguém revisou, e a revisão é de uma versão específica.
        status: 'draft' as const,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' },
  )
  return atualizado ?? null
}

/**
 * Publicar é o ato deliberado — e ele confere o que a edição não conferia.
 *
 * Um monitor sem Flow não publica: ele observaria e não faria nada, que é a definição de
 * rascunho. Dizer isso na publicação é melhor do que deixar publicado algo que não age.
 */
export async function publishMonitor(ownerId: string, id: ObjectId): Promise<MonitorDefinition | null> {
  const monitor = await monitorsCollection.findOne({ _id: id, ownerId })
  if (!monitor) return null
  if (!monitor.action?.flowId) throw new MonitorError('escolha o Flow que este monitor aciona antes de publicar', 'no_action')
  const flow = await getAutomation(ownerId, monitor.action.flowId)
  if (!flow) throw new MonitorError('o Flow deste monitor não existe mais', 'not_found')
  if (flow.lastPublishedVersion == null) throw new MonitorError('publique o Flow antes de publicar o monitor', 'flow_not_published')
  return (
    (await monitorsCollection.findOneAndUpdate(
      { _id: id, ownerId },
      { $set: { status: 'published' as const, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )) ?? null
  )
}

export async function setMonitorStatus(ownerId: string, id: ObjectId, status: MonitorDefinition['status']): Promise<MonitorDefinition | null> {
  if (status === 'published') return publishMonitor(ownerId, id)
  return (
    (await monitorsCollection.findOneAndUpdate({ _id: id, ownerId }, { $set: { status, updatedAt: new Date() } }, { returnDocument: 'after' })) ?? null
  )
}

/** Apagar leva o estado junto: um estado órfão só serviria para confundir a próxima leitura. */
export async function deleteMonitor(ownerId: string, id: ObjectId): Promise<boolean> {
  const r = await monitorsCollection.deleteOne({ _id: id, ownerId })
  if (!r.deletedCount) return false
  await monitorStatesCollection.deleteOne({ ownerId, monitorId: id })
  return true
}

/** O monitor como a tela o lê: com a condição em português e o estado atual junto. */
export async function describeMonitors(ownerId: string) {
  const monitores = await monitorsCollection.find({ ownerId }).sort({ name: 1 }).toArray()
  const estados = await monitorStatesCollection.find({ ownerId }).toArray()
  const porMonitor = new Map(estados.map((e) => [e.monitorId.toString(), e]))
  return monitores.map((m) => {
    const estado = porMonitor.get(m._id.toString())
    return {
      id: m._id.toString(),
      name: m.name,
      status: m.status,
      source: m.source.kind === 'internal_event' ? { kind: m.source.kind, eventType: m.source.eventType } : { kind: m.source.kind, datasetKey: m.source.datasetKey },
      condition: m.condition,
      conditionText: describeCondition(m.condition),
      triggerMode: m.triggerMode,
      threshold: m.threshold,
      thresholdField: m.thresholdField,
      debounceMs: m.debounceMs,
      cooldownMs: m.cooldownMs,
      flowId: m.action?.flowId.toString() ?? null,
      state: estado
        ? {
            status: estado.status,
            conditionIsTrue: estado.conditionIsTrue,
            lastObservedAt: estado.lastObservedAt,
            lastTriggeredAt: estado.lastTriggeredAt,
            error: estado.error,
          }
        : null,
    }
  })
}

export const MONITOR_EVENT_TYPES = EVENT_TYPES
