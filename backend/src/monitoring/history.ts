import { ObjectId } from 'mongodb'
import { db } from '../db.js'

// O HISTÓRICO OPERACIONAL — o que aconteceu, nunca o que passou por dentro.
//
// A aba "Histórico" mostrava contadores acumulados: "12 leituras boas, 3 falhas". Isso
// responde "como está" e não responde nenhuma das perguntas que alguém faz às três da
// manhã — quando parou, quanto demorou, quantas linhas vieram, qual foi o erro, e se
// aquele Flow disparou por causa desta fonte ou de outra coisa.
//
// O que NÃO entra aqui: conteúdo. Nem o corpo lido, nem o valor gravado, nem cabeçalho.
// Um log de operação que guarda payload vira o lugar mais fácil de vazar o que a
// plataforma inteira protege — e ele fica aberto numa tela, num chamado, num print.
//
// O prazo é curto de propósito: trinta dias respondem "o que houve na semana passada",
// que é a pergunta real. Guardar para sempre é pagar por um índice que só cresce para
// responder uma pergunta que ninguém faz.

export type MonitoringEventKind = 'collect' | 'delivery' | 'dispatch'
export type MonitoringEventOutcome = 'ok' | 'unchanged' | 'failed' | 'refused'

export interface MonitoringEvent {
  _id: ObjectId
  ownerId: string
  sourceId: ObjectId
  sourceName: string
  kind: MonitoringEventKind
  outcome: MonitoringEventOutcome
  at: Date
  durationMs: number | null
  /** Quantas linhas vieram e quantas viraram registro. São números diferentes. */
  rows: number | null
  recorded: number | null
  /** O código é para filtrar; a mensagem é para ler. Nenhum dos dois tem conteúdo. */
  errorCode: string | null
  errorMessage: string | null
  /** Quantas páginas a coleta buscou, quando ela pagina. */
  pages: number | null
  /** O monitor que observou e o Flow que ele pediu. Só no evento de disparo. */
  monitorId: ObjectId | null
  monitorName: string | null
  runId: string | null
  expiresAt: Date
}

const eventos = db.collection<MonitoringEvent>('monitoring_events')

/** Trinta dias. Ver o comentário do topo. */
export const RETENCAO_DIAS = Number(process.env.MONITORING_HISTORY_DAYS ?? 30)

export async function ensureMonitoringHistoryIndexes(): Promise<void> {
  await eventos.createIndex({ ownerId: 1, at: -1 })
  await eventos.createIndex({ ownerId: 1, sourceId: 1, at: -1 })
  await eventos.createIndex({ ownerId: 1, outcome: 1, at: -1 })
  // O prazo é do Mongo: um processo parado não deixa log velho ocupando a coleção.
  await eventos.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'eventos_expiram' })
}

/**
 * A mensagem de erro, cortada e sem conteúdo.
 *
 * Um erro de rede traz a URL, e a URL pode ter parâmetro; um erro de parse traz o pedaço
 * do corpo que não entendeu. O corte é curto porque a mensagem existe para dizer O QUE
 * falhou, e não para reconstruir a resposta.
 */
const semSegredo = (m: string | null | undefined): string | null => {
  if (!m) return null
  return String(m)
    .replace(/([?&](?:api[_-]?key|token|secret|password|senha|auth|access[_-]?token)=)[^&\s]*/gi, '$1«oculto»')
    .replace(/\b(bearer|basic)\s+[\w.\-+/=]+/gi, '$1 «oculto»')
    .slice(0, 300)
}

export interface RegistroDeEvento {
  ownerId: string
  sourceId: ObjectId
  sourceName: string
  kind: MonitoringEventKind
  outcome: MonitoringEventOutcome
  at?: Date
  durationMs?: number | null
  rows?: number | null
  recorded?: number | null
  errorCode?: string | null
  errorMessage?: string | null
  pages?: number | null
  monitorId?: ObjectId | null
  monitorName?: string | null
  runId?: string | null
}

/**
 * Grava um evento — e NUNCA derruba quem chamou.
 *
 * Este log é observação. Uma falha de escrita aqui não pode transformar uma coleta boa em
 * coleta falhada: quem lê o painel ficaria investigando a fonte errada.
 */
export async function registrarEvento(e: RegistroDeEvento): Promise<void> {
  const at = e.at ?? new Date()
  try {
    await eventos.insertOne({
      _id: new ObjectId(),
      ownerId: e.ownerId,
      sourceId: e.sourceId,
      sourceName: e.sourceName.slice(0, 160),
      kind: e.kind,
      outcome: e.outcome,
      at,
      durationMs: e.durationMs ?? null,
      rows: e.rows ?? null,
      recorded: e.recorded ?? null,
      errorCode: e.errorCode ? String(e.errorCode).slice(0, 60) : null,
      errorMessage: semSegredo(e.errorMessage),
      pages: e.pages ?? null,
      monitorId: e.monitorId ?? null,
      monitorName: e.monitorName?.slice(0, 160) ?? null,
      runId: e.runId ?? null,
      expiresAt: new Date(at.getTime() + RETENCAO_DIAS * 86_400_000),
    })
  } catch {
    // Ver acima: observar não pode quebrar o observado.
  }
}

export interface FiltroDeEventos {
  sourceId?: ObjectId | null
  kind?: MonitoringEventKind | null
  outcome?: MonitoringEventOutcome | null
  since?: Date | null
  until?: Date | null
  limit?: number
  /** O `_id` do último item da página anterior. Paginar por instante repetiria empates. */
  cursor?: string | null
}

export interface PaginaDeEventos {
  items: (Omit<MonitoringEvent, '_id' | 'sourceId' | 'monitorId' | 'expiresAt'> & { id: string; sourceId: string; monitorId: string | null })[]
  nextCursor: string | null
}

/**
 * A página de eventos — do mais recente para trás.
 *
 * O cursor é o `_id`, e não o instante: dois eventos do mesmo milissegundo (uma coleta que
 * dispara dois monitores) empatariam, e paginar por instante ou repetiria o empate ou
 * pularia um dos dois.
 */
export async function listarEventos(ownerId: string, filtro: FiltroDeEventos = {}): Promise<PaginaDeEventos> {
  const limite = Math.min(200, Math.max(1, filtro.limit ?? 50))
  const consulta: Record<string, unknown> = { ownerId }
  if (filtro.sourceId) consulta.sourceId = filtro.sourceId
  if (filtro.kind) consulta.kind = filtro.kind
  if (filtro.outcome) consulta.outcome = filtro.outcome
  if (filtro.since || filtro.until) {
    consulta.at = { ...(filtro.since ? { $gte: filtro.since } : {}), ...(filtro.until ? { $lte: filtro.until } : {}) }
  }
  if (filtro.cursor && ObjectId.isValid(filtro.cursor)) consulta._id = { $lt: new ObjectId(filtro.cursor) }

  const lista = await eventos
    .find(consulta)
    .sort({ _id: -1 })
    .limit(limite + 1)
    .toArray()

  const pagina = lista.slice(0, limite)
  return {
    items: pagina.map((e) => ({
      id: e._id.toString(),
      ownerId: e.ownerId,
      sourceId: e.sourceId.toString(),
      sourceName: e.sourceName,
      kind: e.kind,
      outcome: e.outcome,
      at: e.at,
      durationMs: e.durationMs,
      rows: e.rows,
      recorded: e.recorded,
      errorCode: e.errorCode,
      errorMessage: e.errorMessage,
      pages: e.pages,
      monitorId: e.monitorId ? e.monitorId.toString() : null,
      monitorName: e.monitorName,
      runId: e.runId,
    })),
    nextCursor: lista.length > limite ? pagina[pagina.length - 1]._id.toString() : null,
  }
}

/**
 * A ponte do DISPARO: qual monitor observou o que esta fonte gravou, e qual Flow ele pediu.
 *
 * Ela existe porque a pergunta "este Flow disparou por causa desta fonte?" não tinha
 * resposta em lugar nenhum: o painel de execuções sabe do Flow, o monitor sabe da
 * condição, e ninguém guardava o fio entre os dois.
 *
 * O caminho é o canônico, e passivo: o motor de monitores avisa o que JÁ aconteceu. Um
 * segundo observador aqui dobraria as execuções, que é o defeito que este log existe para
 * ajudar a investigar.
 */
export function registerMonitoringHistoryBridge(): void {
  void (async () => {
    const { onMonitorDispatched } = await import('../monitors/dataSource.js')
    onMonitorDispatched(async (record, resultados) => {
      const disparados = resultados.filter((r) => r.result.triggered && r.result.runId)
      if (disparados.length === 0) return
      // De qual fonte da Central veio este registro? O recorder é a ponte.
      const fonte = await db
        .collection('monitoring_sources')
        .findOne({ ownerId: record.ownerId, 'destination.recorderId': record.recorderId }, { projection: { name: 1 } })
      if (!fonte) return
      for (const d of disparados) {
        await registrarEvento({
          ownerId: record.ownerId,
          sourceId: fonte._id,
          sourceName: String(fonte.name),
          kind: 'dispatch',
          outcome: 'ok',
          at: record.recordedAt,
          monitorId: d.monitor._id,
          monitorName: d.monitor.name,
          runId: d.result.runId,
        })
      }
    })
  })()
}
