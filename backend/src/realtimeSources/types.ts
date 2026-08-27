import type { ObjectId } from 'mongodb'

/**
 * Uma FONTE DE DADOS EM TEMPO REAL, do ponto de vista de um agente.
 *
 * Ela não é um WebSocket, e é importante que não seja: um agente não abre conexão com
 * ninguém. O stream já existe, já está de pé e já alimenta o Dado ao vivo — esta camada
 * só dá um NOME a um pedaço daquilo e diz quais agentes podem consultá-lo. Dez agentes
 * lendo o mesmo par de moedas são dez leituras de uma linha do banco, não dez sockets.
 *
 * E ela não guarda nada. Histórico é outra decisão, configurada em outro lugar
 * (`dataHistory`): criar uma fonte aqui não cria regra de gravação nenhuma, de
 * propósito. "Quero consultar agora" e "quero guardar para depois" são perguntas
 * diferentes, e forçar a segunda para responder a primeira encheria o banco de quem só
 * queria saber o preço de agora.
 */

/** De onde a fonte lê. Hoje só o Dado ao vivo — mas o conceito não é dele. */
export const REALTIME_SOURCE_KINDS = ['live_data'] as const
export type RealtimeSourceKind = (typeof REALTIME_SOURCE_KINDS)[number]

export interface RealtimeDataSource {
  _id: ObjectId
  ownerId: string
  /** O nome que a pessoa lê na tela: "BTC atual". */
  name: string
  sourceKind: RealtimeSourceKind
  /** `live_data` → o id da conexão. Conferido com o dono no filtro, nunca confiado. */
  sourceRef: string
  /** A chave dentro da fonte: `BTCUSDT`, `sensor-3`, `SKU-1`. */
  key: string
  /**
   * O nome que o AGENTE usa: `btc_price`.
   *
   * É por ele que a tool pergunta, e não por um id de banco. Um agente pedindo
   * `{"source":"5f2a…"}` seria um agente que precisa saber o que é uma ObjectId.
   */
  alias: string
  /**
   * Quais campos o agente enxerga. Vazio = o valor inteiro.
   *
   * Serve para dois casos reais: cortar o que é ruído — um payload de provedor tem
   * dezenas de campos que ninguém usa — e não entregar ao modelo o que ele não precisa
   * ver.
   */
  allowedFields: string[] | null
  /**
   * A partir de quantos segundos o valor é VELHO.
   *
   * Não é o TTL do Dado ao vivo, que decide quando o valor deixa de existir; é quando
   * ele deixa de ser confiável como "agora". Um preço de doze segundos atrás ainda está
   * lá, e responder que ele é o preço atual seria mentir por omissão.
   */
  staleAfterSeconds: number
  /** Quais agentes podem consultar. Vazio = nenhum: acesso é concessão, não padrão. */
  agentIds: ObjectId[]
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface RealtimeSourcePublic {
  id: string
  name: string
  sourceKind: RealtimeSourceKind
  sourceRef: string
  /** O nome amigável da conexão, resolvido para a tela. Nunca a credencial dela. */
  sourceLabel: string | null
  key: string
  alias: string
  allowedFields: string[] | null
  staleAfterSeconds: number
  agentIds: string[]
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export const sourcePublic = (s: RealtimeDataSource, sourceLabel: string | null = null): RealtimeSourcePublic => ({
  id: s._id.toString(),
  name: s.name,
  sourceKind: s.sourceKind,
  sourceRef: s.sourceRef,
  sourceLabel,
  key: s.key,
  alias: s.alias,
  allowedFields: s.allowedFields,
  staleAfterSeconds: s.staleAfterSeconds,
  agentIds: s.agentIds.map((a) => a.toString()),
  enabled: s.enabled,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
})

/**
 * O que uma leitura devolve.
 *
 * `stale` é campo de primeira classe, e não uma nota de rodapé: quem consulta precisa
 * poder decidir com ele. Um valor velho volta COM o valor — esconder o número seria
 * tirar de quem chamou a chance de decidir se aquilo ainda serve.
 */
export interface RealtimeReading {
  found: boolean
  alias: string
  key: string
  value: Record<string, unknown> | null
  receivedAt: string | null
  ageMs: number | null
  stale: boolean
  /** Quantas atualizações aquela chave já recebeu. Serve para saber se a fonte vive. */
  updates: number | null
}

/** Um teto por dono: uma fonte por chave de um feed inteiro seria milhares. */
export const MAX_SOURCES_PER_OWNER = Number(process.env.REALTIME_MAX_SOURCES ?? 50)
export const DEFAULT_STALE_SECONDS = Number(process.env.REALTIME_DEFAULT_STALE_SECONDS ?? 30)
export const MAX_STALE_SECONDS = Number(process.env.REALTIME_MAX_STALE_SECONDS ?? 86_400)
