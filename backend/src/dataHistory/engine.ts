import { ObjectId } from 'mongodb'
import { createHash } from 'node:crypto'
import { readPath } from '../automations/conditions.js'
import { onEvent } from '../events/bus.js'
import { EVENT_TYPES } from '../events/types.js'
import type { PlatformEvent } from '../events/types.js'
import { recordersCollection as recorders, cabeNoLimite, inserirRegistro, sanearValor } from './store.js'
import { dobrarNaJanela, fecharJanela, janelasPendentes, janelasVencidas, marcarPersistida, valorDaJanela } from './windows.js'
import { MAX_RECORDS_PER_RECORDER } from './types.js'
import type { DataRecorderDefinition, Fact, RecorderFilter } from './types.js'

/**
 * O motor. Ele recebe FATOS e não sabe o que eles significam.
 *
 * Um fato é `{ dono, fonte, chave, quando, valor }`. Quem o produziu — um evento do
 * barramento, o Live Data, uma tool, um agente, uma rotina, um webhook — não muda nada
 * daqui para baixo. É essa indiferença que faz o mesmo mecanismo servir para cotação,
 * estoque, pedido e sensor sem uma linha de código por caso.
 */

const SCHEMA_VERSION = 1

/**
 * As regras ativas de uma fonte, em memória por alguns segundos.
 *
 * Sem isto, uma fonte que manda três fatos por segundo faria três consultas por segundo
 * só para descobrir que nada mudou. O prazo é curto de propósito: ligar ou desligar um
 * histórico passa a valer em segundos, não no próximo deploy.
 */
const CACHE_MS = Number(process.env.DATA_HISTORY_CACHE_MS ?? 5_000)
const cache = new Map<string, { em: number; lista: DataRecorderDefinition[] }>()

export const limparCacheDeRecorders = (): void => cache.clear()

async function recordersDe(ownerId: string, sourceKey: string, agora: number): Promise<DataRecorderDefinition[]> {
  const chave = `${ownerId}|${sourceKey}`
  const guardado = cache.get(chave)
  if (guardado && agora - guardado.em < CACHE_MS) return guardado.lista
  const [kind, ...resto] = sourceKey.split(':')
  const lista = await recorders.find({ ownerId, enabled: true, 'source.kind': kind, 'source.ref': resto.join(':') }).toArray()
  cache.set(chave, { em: agora, lista })
  return lista
}

/** O filtro, no mesmo formato de condição que o resto do produto usa. Falha fechada. */
export function passaNosFiltros(valor: Record<string, unknown>, filtros: readonly RecorderFilter[]): boolean {
  for (const f of filtros) {
    const lido = readPath(valor, f.path)
    const esperado = f.value
    switch (f.operator) {
      case 'exists':
        if (lido === undefined || lido === null) return false
        break
      case 'equals':
        if (String(lido) !== String(esperado)) return false
        break
      case 'not_equals':
        if (String(lido) === String(esperado)) return false
        break
      case 'contains':
        if (!String(lido ?? '').includes(String(esperado ?? ''))) return false
        break
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const a = Number(lido)
        const b = Number(esperado)
        if (!Number.isFinite(a) || !Number.isFinite(b)) return false
        if (f.operator === 'gt' && !(a > b)) return false
        if (f.operator === 'gte' && !(a >= b)) return false
        if (f.operator === 'lt' && !(a < b)) return false
        if (f.operator === 'lte' && !(a <= b)) return false
        break
      }
      default:
        // Operador que não existe é dúvida, e dúvida não grava.
        return false
    }
  }
  return true
}

/** Só os campos escolhidos. Vazio = o valor inteiro, já saneado. */
export function recortar(valor: Record<string, unknown>, campos: readonly string[] | null): Record<string, unknown> {
  if (!campos || !campos.length) return valor
  const fora: Record<string, unknown> = {}
  for (const c of campos) {
    const lido = readPath(valor, c)
    if (lido !== undefined) fora[c.replace(/[.[\]]/g, '_')] = lido
  }
  return fora
}

/** O instante do FATO. Sem caminho configurado, o de quem entregou. */
export function instanteDoFato(valor: Record<string, unknown>, caminho: string | null, padrao: Date): Date {
  if (!caminho) return padrao
  const lido = readPath(valor, caminho)
  if (lido === undefined || lido === null) return padrao
  const d = lido instanceof Date ? lido : new Date(typeof lido === 'number' ? lido : String(lido))
  return Number.isNaN(d.getTime()) ? padrao : d
}

const chaveDaEntidade = (valor: Record<string, unknown>, caminho: string | null): string | null => {
  if (!caminho) return null
  const lido = readPath(valor, caminho)
  return lido === undefined || lido === null ? null : String(lido).slice(0, 200)
}

/**
 * A identidade de um registro.
 *
 * Curta e estável: o mesmo fato, gravado pela mesma regra, produz a mesma chave em
 * qualquer worker e depois de qualquer restart. É ela, com o índice único, que faz a
 * reentrega de um evento não virar duas linhas na série.
 */
export const chaveDeDedupe = (partes: (string | number | null)[]): string =>
  createHash('sha256').update(partes.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 40)

const expiraEm = (recorder: DataRecorderDefinition, agora: Date): Date | null =>
  recorder.retentionDays ? new Date(agora.getTime() + recorder.retentionDays * 86_400_000) : null

async function contabilizar(recorder: DataRecorderDefinition, agora: Date): Promise<void> {
  await recorders.updateOne({ _id: recorder._id }, { $inc: { recordCount: 1 }, $set: { lastRecordAt: agora, updatedAt: agora } })
}

export type ResultadoDoFato = 'gravado' | 'repetido' | 'filtrado' | 'sem_mudanca' | 'acumulado' | 'tarde' | 'grande' | 'cota' | 'ignorado'

/**
 * Aplica UMA regra a UM fato.
 *
 * Exportada porque é exatamente isto que a prévia da tela roda — a mesma decisão, com
 * os mesmos filtros, antes de o histórico existir. Uma prévia que usasse outro caminho
 * prometeria um resultado que o motor não daria.
 */
export async function aplicarRecorder(recorder: DataRecorderDefinition, fato: Fact, agora = new Date()): Promise<ResultadoDoFato> {
  const bruto = sanearValor(fato.value) as Record<string, unknown>
  if (!bruto || typeof bruto !== 'object') return 'ignorado'
  if (!passaNosFiltros(bruto, recorder.filters)) return 'filtrado'

  const entityKey = chaveDaEntidade(bruto, recorder.entityKeyPath) ?? fato.entityKey
  const occurredAt = instanteDoFato(bruto, recorder.occurredAtPath, fato.occurredAt)

  if (recorder.mode === 'window_aggregate') {
    const r = await dobrarNaJanela(recorder, entityKey, occurredAt, bruto, agora)
    if (!r) return 'ignorado'
    return r.tardeDemais ? 'tarde' : 'acumulado'
  }

  // Os snapshots não gravam na chegada do fato — quem grava é a varredura. O que o
  // fato faz é deixar o último valor à mão para ela.
  if (recorder.mode === 'snapshot_interval' || recorder.mode === 'schedule_snapshot') {
    await guardarUltimoValor(recorder, entityKey, occurredAt, bruto, agora)
    return 'ignorado'
  }

  const valor = recortar(bruto, recorder.selectedFields)
  if (!cabeNoLimite(valor)) return 'grande'

  if (recorder.mode === 'on_change' && !(await mudouDeVerdade(recorder, entityKey, occurredAt, valor))) return 'sem_mudanca'

  if (recorder.recordCount >= MAX_RECORDS_PER_RECORDER) return 'cota'

  const dedupeKey = chaveDeDedupe([recorder._id.toString(), entityKey, occurredAt.getTime(), fato.factId ?? JSON.stringify(valor)])
  const r = await inserirRegistro({
    ownerId: recorder.ownerId,
    recorderId: recorder._id,
    sourceKey: fato.sourceKey,
    entityKey,
    occurredAt,
    recordedAt: agora,
    windowStart: null,
    windowEnd: null,
    value: valor,
    schemaVersion: SCHEMA_VERSION,
    dedupeKey,
    expiresAt: expiraEm(recorder, agora),
  })
  if (r === 'gravado') await contabilizar(recorder, agora)
  return r === 'gravado' ? 'gravado' : 'repetido'
}

/** A assinatura do que está sendo observado: o campo escolhido, ou o valor inteiro. */
export const assinaturaDoValor = (valor: unknown, caminho: string | null): string => {
  const observado = caminho ? readPath(valor, caminho) : valor
  return createHash('sha256').update(JSON.stringify(observado ?? null)).digest('hex').slice(0, 32)
}

/**
 * Mudou? A pergunta e a resposta na MESMA operação.
 *
 * Ler o último registro e depois decidir gravar tem uma janela no meio, e o caminho
 * quente do Live Data entrega os tiques sem esperar um pelo outro: três chegando juntos
 * liam "ainda não tem nada" ao mesmo tempo e gravavam o mesmo valor duas vezes. Aqui a
 * troca da assinatura é a própria condição do update — só um escritor a muda, e os
 * outros descobrem isso pelo `modifiedCount`. Vale entre processos, não só dentro deste.
 *
 * O `$lte` no instante é o que protege da ordem: um fato ATRASADO não pode desfazer a
 * assinatura de um mais novo que já entrou.
 */
async function mudouDeVerdade(
  recorder: DataRecorderDefinition,
  entityKey: string | null,
  occurredAt: Date,
  valor: Record<string, unknown>,
): Promise<boolean> {
  const assinatura = assinaturaDoValor(valor, recorder.changePath)
  const campo = `mudancas.${(entityKey ?? '_').replace(/[.$]/g, '_')}`
  const r = await recorders.updateOne(
    {
      _id: recorder._id,
      $or: [{ [campo]: { $exists: false } }, { [`${campo}.hash`]: { $ne: assinatura }, [`${campo}.at`]: { $lte: occurredAt } }],
    },
    { $set: { [campo]: { hash: assinatura, at: occurredAt } } },
  )
  return r.modifiedCount > 0
}

/**
 * O último valor visto por um recorder de snapshot.
 *
 * Fica na própria definição, e não numa coleção nova: é um objeto pequeno por regra, e
 * o `occurredAt` no filtro impede que um fato atrasado sobrescreva um mais novo.
 */
async function guardarUltimoValor(
  recorder: DataRecorderDefinition,
  entityKey: string | null,
  occurredAt: Date,
  valor: Record<string, unknown>,
  agora: Date,
): Promise<void> {
  const campo = `ultimos.${entityKey ?? '_'}`
  await recorders.updateOne(
    { _id: recorder._id, $or: [{ [`${campo}.at`]: { $exists: false } }, { [`${campo}.at`]: { $lte: occurredAt } }] },
    { $set: { [campo]: { at: occurredAt, valor }, updatedAt: agora } },
  )
}

/** Um fato entrou. Todas as regras daquela fonte, daquele dono, decidem sozinhas. */
export async function ingestFact(fato: Fact, agora = new Date()): Promise<Record<ResultadoDoFato, number>> {
  const contagem = { gravado: 0, repetido: 0, filtrado: 0, sem_mudanca: 0, acumulado: 0, tarde: 0, grande: 0, cota: 0, ignorado: 0 }
  const lista = await recordersDe(fato.ownerId, fato.sourceKey, agora.getTime())
  for (const recorder of lista) {
    try {
      contagem[await aplicarRecorder(recorder, fato, agora)] += 1
    } catch (error) {
      // A falha de uma regra não pode calar as outras — nem sumir. Ela fica visível na
      // própria definição, que é onde quem configurou vai olhar.
      await recorders
        .updateOne({ _id: recorder._id }, { $set: { lastError: { message: String((error as Error).message ?? error).slice(0, 300), at: agora } } })
        .catch(() => undefined)
    }
  }
  return contagem
}

// --- as fontes -------------------------------------------------------------------

/**
 * Todo evento do barramento pode virar histórico, sem um handler por tipo.
 *
 * O motor filtra pelo que está configurado: se ninguém grava aquele tipo, o handler
 * sai em uma consulta cacheada. É o oposto de criar um `EVENT_TYPE` novo por dado de
 * negócio — o barramento continua com os tipos que já tinha.
 */
export function registerDataHistoryHandlers(): void {
  for (const tipo of EVENT_TYPES) {
    onEvent(tipo, `data-history:${tipo}`, async (evento: PlatformEvent) => {
      await ingestFact({
        ownerId: evento.ownerId,
        sourceKey: `event:${evento.type}`,
        entityKey: null,
        occurredAt: evento.occurredAt,
        value: evento.payload,
        // A identidade do EVENTO: reentregar não grava de novo.
        factId: evento.eventId,
      })
    })
  }
}

/** O caminho de quem produz dado fora do barramento: tool, agente, rotina, webhook. */
export const recordFact = (ownerId: string, sourceRef: string, entityKey: string | null, value: Record<string, unknown>, occurredAt = new Date()) =>
  ingestFact({ ownerId, sourceKey: `manual:${sourceRef}`, entityKey, occurredAt, value })

// --- a varredura -----------------------------------------------------------------

/**
 * Fecha o que venceu e grava o que fechou.
 *
 * Roda no mesmo lugar das outras varreduras do worker. É ela — e não a chegada do
 * próximo fato — que fecha a última janela quando a fonte para de mandar dado.
 *
 * A ordem importa: PERSISTIR antes de marcar. Uma queda entre as duas coisas repete a
 * gravação na próxima passada, e a chave de dedupe transforma a repetição em nada.
 */
export async function closeDueWindows(agora = new Date(), limite = 200): Promise<{ fechadas: number; gravadas: number }> {
  let fechadas = 0
  for (const janela of await janelasVencidas(agora, limite)) {
    if (await fecharJanela(janela._id, agora)) fechadas += 1
  }

  let gravadas = 0
  for (const janela of await janelasPendentes(limite)) {
    const recorder = await recorders.findOne({ _id: janela.recorderId })
    if (!recorder) {
      await marcarPersistida(janela._id, agora)
      continue
    }
    const valor = valorDaJanela(janela, recorder.aggregations)
    const r = await inserirRegistro({
      ownerId: janela.ownerId,
      recorderId: janela.recorderId,
      sourceKey: `${recorder.source.kind}:${recorder.source.ref}`,
      entityKey: janela.entityKey,
      // O tempo do fato é o FIM da janela: é quando aquele resumo passou a valer.
      occurredAt: janela.windowEnd,
      recordedAt: agora,
      windowStart: janela.windowStart,
      windowEnd: janela.windowEnd,
      value: valor,
      schemaVersion: SCHEMA_VERSION,
      dedupeKey: chaveDeDedupe([janela.recorderId.toString(), janela.entityKey, janela.windowStart.getTime(), 'janela']),
      expiresAt: expiraEm(recorder, agora),
    })
    await marcarPersistida(janela._id, agora)
    if (r === 'gravado') {
      gravadas += 1
      await contabilizar(recorder, agora)
    }
  }
  return { fechadas, gravadas }
}

/**
 * Os snapshots: o último valor conhecido, no ritmo configurado.
 *
 * `snapshot_interval` grava uma vez por intervalo; `schedule_snapshot`, uma vez por dia
 * na hora marcada. Os dois usam a mesma chave de dedupe baseada no INSTANTE ALINHADO —
 * então duas passadas da varredura, dois workers ou um restart no meio gravam uma linha
 * só.
 */
export async function runDueSnapshots(agora = new Date(), limite = 100): Promise<{ gravados: number }> {
  const lista = await recorders
    .find({ enabled: true, mode: { $in: ['snapshot_interval', 'schedule_snapshot'] } })
    .limit(limite)
    .toArray()

  let gravados = 0
  for (const recorder of lista) {
    const alvo = instanteAlinhado(recorder, agora)
    if (alvo === null) continue
    const ultimos = (recorder as unknown as { ultimos?: Record<string, { at: Date; valor: Record<string, unknown> }> }).ultimos ?? {}
    for (const [chave, guardado] of Object.entries(ultimos)) {
      if (!guardado?.valor) continue
      const entityKey = chave === '_' ? null : chave
      const valor = recortar(guardado.valor, recorder.selectedFields)
      if (!cabeNoLimite(valor)) continue
      if (recorder.recordCount >= MAX_RECORDS_PER_RECORDER) break
      const r = await inserirRegistro({
        ownerId: recorder.ownerId,
        recorderId: recorder._id,
        sourceKey: `${recorder.source.kind}:${recorder.source.ref}`,
        entityKey,
        occurredAt: new Date(alvo),
        recordedAt: agora,
        windowStart: null,
        windowEnd: null,
        value: valor,
        schemaVersion: SCHEMA_VERSION,
        dedupeKey: chaveDeDedupe([recorder._id.toString(), entityKey, alvo, 'snapshot']),
        expiresAt: expiraEm(recorder, agora),
      })
      if (r === 'gravado') {
        gravados += 1
        await contabilizar(recorder, agora)
      }
    }
  }
  return { gravados }
}

/**
 * O instante que este snapshot deveria ter gravado, alinhado.
 *
 * Alinhar é o que torna a gravação idempotente sem guardar "quando gravei a última
 * vez": duas passadas dentro do mesmo intervalo produzem a mesma chave, e a segunda
 * não grava nada.
 */
export function instanteAlinhado(recorder: DataRecorderDefinition, agora: Date): number | null {
  if (recorder.mode === 'snapshot_interval' && recorder.intervalMs) {
    return Math.floor(agora.getTime() / recorder.intervalMs) * recorder.intervalMs
  }
  if (recorder.mode === 'schedule_snapshot' && recorder.schedule) {
    const alvo = new Date(agora)
    alvo.setUTCHours(recorder.schedule.hour, recorder.schedule.minute, 0, 0)
    // Antes da hora de hoje: o snapshot de hoje ainda não venceu.
    return alvo.getTime() <= agora.getTime() ? alvo.getTime() : null
  }
  return null
}

export const dataHistoryRecorderId = (id: string): ObjectId | null => (ObjectId.isValid(id) ? new ObjectId(id) : null)
