import { ValidationError } from '../../../building.js'
import { readPath } from '../../../automations/conditions.js'

/**
 * A CONFIGURAÇÃO de uma conexão WebSocket genérica, saneada.
 *
 * Tudo aqui é DADO: endereço, nome de campo, caminho, valor. Não existe expressão, não
 * existe template executável e não existe código. É a regra que torna esta tela segura:
 * um App genérico que aceitasse "uma expressão para extrair o campo" seria um App que
 * executa o que o usuário digitou — e o usuário nem sempre é quem parece ser.
 *
 * O que o servidor faz com esses dados é sempre a mesma coisa: ler um caminho de
 * objeto, comparar por igualdade ou por "contém", e substituir `{{campo}}` por um valor
 * já conhecido. Nada mais.
 */

export type WsFormat = 'json' | 'text'
export type WsAuthKind = 'none' | 'header' | 'query' | 'message'
export type WsDedupeStrategy = 'none' | 'message_id' | 'payload_hash'

export interface WsFilter {
  /** Caminho de objeto, ex.: `data.type`. Só leitura — ver `readPath`. */
  path: string
  operator: 'equals' | 'contains'
  value: string
}

export interface WsConnectionConfig {
  endpoint: string
  format: WsFormat
  auth: {
    kind: WsAuthKind
    /** Nome do cabeçalho ou do parâmetro. O VALOR é o segredo e mora cifrado à parte. */
    name: string
    /** Prefixo do valor, ex.: `Bearer `. Não é segredo. */
    prefix: string
    /** A primeira mensagem, com `{{token}}` substituído pelo segredo na hora de enviar. */
    messageTemplate: string
  }
  protocols: string[]
  heartbeat: { enabled: boolean; message: string; intervalMs: number }
  idleTimeoutMs: number
  /** Onde estão as coisas dentro da mensagem. Vazio = a mensagem inteira. */
  paths: { payload: string; messageId: string; channel: string; occurredAt: string }
  /** Schema opcional para RECUSAR o que não bate, em vez de guardar lixo. */
  schema: Record<string, unknown> | null
  filters: WsFilter[]
  dedupe: WsDedupeStrategy
  maxMessagesPerMinute: number
  maxMessageBytes: number
}

/** Tetos que não são configuráveis para baixo por acidente nem para cima por engano. */
export const WS_LIMITS = {
  maxMessageBytes: Number(process.env.WS_MAX_MESSAGE_BYTES ?? 64_000),
  maxMessagesPerMinute: Number(process.env.WS_MAX_MESSAGES_PER_MINUTE ?? 600),
  minIntervalMs: 5_000,
  maxIntervalMs: 300_000,
  maxFilters: 10,
  maxProtocols: 5,
}

const texto = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max)

/**
 * Um caminho de objeto, e nada além disso.
 *
 * Só letras, números, `_`, `.` e índice numérico. `__proto__`, `constructor` e
 * `prototype` são recusados — é por eles que uma leitura vira escrita no protótipo.
 */
export function normalizePath(bruto: unknown, campo: string): string {
  const p = texto(bruto, 200)
  if (!p) return ''
  if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+|\[\d+\])*$/.test(p)) {
    throw new ValidationError(`${campo}: use um caminho simples, como "data.evento" — sem expressão nem código.`)
  }
  if (/(^|\.)(__proto__|constructor|prototype)(\.|$)/.test(p)) {
    throw new ValidationError(`${campo}: caminho não permitido.`)
  }
  return p
}

const numeroEntre = (v: unknown, padrao: number, min: number, max: number): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return padrao
  return Math.min(Math.max(Math.round(n), min), max)
}

/** JSON, ou nada. Uma mensagem de inscrição malformada falharia só na hora de conectar. */
function mensagem(bruto: unknown, campo: string): string {
  const t = texto(bruto, 4_000)
  if (!t) return ''
  try {
    JSON.parse(t)
  } catch {
    throw new ValidationError(`${campo}: precisa ser um JSON válido.`)
  }
  return t
}

export function normalizeConnectionConfig(bruto: unknown): WsConnectionConfig {
  const c = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Record<string, unknown>
  const auth = (typeof c.auth === 'object' && c.auth !== null ? c.auth : {}) as Record<string, unknown>
  const paths = (typeof c.paths === 'object' && c.paths !== null ? c.paths : {}) as Record<string, unknown>
  const heartbeat = (typeof c.heartbeat === 'object' && c.heartbeat !== null ? c.heartbeat : {}) as Record<string, unknown>

  const endpoint = texto(c.endpoint, 2_000)
  if (!endpoint) throw new ValidationError('Informe o endereço wss:// do serviço.')

  const kind = (['none', 'header', 'query', 'message'] as const).find((k) => k === auth.kind) ?? 'none'
  if ((kind === 'header' || kind === 'query') && !texto(auth.name)) {
    throw new ValidationError('Informe o nome do cabeçalho ou do parâmetro de autenticação.')
  }
  const messageTemplate = kind === 'message' ? mensagem(auth.messageTemplate, 'Mensagem de autenticação') : ''
  if (kind === 'message' && !messageTemplate) throw new ValidationError('Informe a mensagem de autenticação.')

  const filtrosBrutos = Array.isArray(c.filters) ? c.filters : []
  if (filtrosBrutos.length > WS_LIMITS.maxFilters) throw new ValidationError(`No máximo ${WS_LIMITS.maxFilters} filtros.`)
  const filters: WsFilter[] = filtrosBrutos.map((f, i) => {
    const raw = (typeof f === 'object' && f !== null ? f : {}) as Record<string, unknown>
    const operator = raw.operator === 'contains' ? 'contains' : 'equals'
    const path = normalizePath(raw.path, `Filtro ${i + 1}`)
    if (!path) throw new ValidationError(`Filtro ${i + 1}: informe o campo.`)
    return { path, operator, value: texto(raw.value, 500) }
  })

  const schema = typeof c.schema === 'object' && c.schema !== null && !Array.isArray(c.schema) ? (c.schema as Record<string, unknown>) : null

  return {
    endpoint,
    format: c.format === 'text' ? 'text' : 'json',
    // O prefixo NÃO é aparado: `Bearer ` precisa do espaço no fim, e é o caso mais
    // comum de todos. Aparar transformava o cabeçalho em `Bearerabc`, que o serviço
    // recusa por um motivo que a tela não teria como explicar.
    auth: { kind, name: texto(auth.name, 100), prefix: String(auth.prefix ?? '').slice(0, 50), messageTemplate },
    protocols: (Array.isArray(c.protocols) ? c.protocols : []).map((p) => texto(p, 60)).filter(Boolean).slice(0, WS_LIMITS.maxProtocols),
    heartbeat: {
      enabled: heartbeat.enabled === true,
      message: heartbeat.enabled === true ? mensagem(heartbeat.message, 'Mensagem de heartbeat') : '',
      intervalMs: numeroEntre(heartbeat.intervalMs, 30_000, WS_LIMITS.minIntervalMs, WS_LIMITS.maxIntervalMs),
    },
    idleTimeoutMs: numeroEntre(c.idleTimeoutMs, 90_000, WS_LIMITS.minIntervalMs, WS_LIMITS.maxIntervalMs),
    paths: {
      payload: normalizePath(paths.payload, 'Caminho do conteúdo'),
      messageId: normalizePath(paths.messageId, 'Caminho do identificador'),
      channel: normalizePath(paths.channel, 'Caminho do canal'),
      occurredAt: normalizePath(paths.occurredAt, 'Caminho da data'),
    },
    schema,
    filters,
    dedupe: (['none', 'message_id', 'payload_hash'] as const).find((d) => d === c.dedupe) ?? 'none',
    maxMessagesPerMinute: numeroEntre(c.maxMessagesPerMinute, 120, 1, WS_LIMITS.maxMessagesPerMinute),
    maxMessageBytes: numeroEntre(c.maxMessageBytes, 16_000, 200, WS_LIMITS.maxMessageBytes),
  }
}

/**
 * O que a TELA pode ver da configuração.
 *
 * Tudo menos o valor da credencial — que nunca esteve aqui: ele mora cifrado, num campo
 * separado, e não passa por esta estrutura em nenhum momento.
 */
export const connectionConfigPublic = (c: WsConnectionConfig) => ({ ...c, auth: { ...c.auth } })

/** Lê um caminho, ou devolve a mensagem inteira quando o caminho é vazio. */
export const readAt = (valor: unknown, caminho: string): unknown => (caminho ? readPath(valor, caminho) : valor)

/**
 * Substitui `{{token}}` pelo segredo — e só isso.
 *
 * Um template com mais poder que isto (condicional, chamada, expressão) seria código
 * escrito por quem configura e executado pelo servidor. Aqui há uma substituição, de um
 * nome conhecido, por um valor conhecido.
 */
export const fillToken = (template: string, token: string): string => template.split('{{token}}').join(token)
