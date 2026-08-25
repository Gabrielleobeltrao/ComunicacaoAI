import type { ObjectId } from 'mongodb'
import type { WsFilter } from '../../apps/official/websocket/config.js'

/**
 * O que o dono faz com o que chega.
 *
 * `history` é o padrão e é o mais barato: guarda e para. Os outros custam — memória
 * ocupa espaço, rotina e agente custam tempo, e agente custa token. Por isso a escolha
 * é explícita, e por isso `history` é o que vem marcado.
 */
export type WsDestinationKind = 'history' | 'memory' | 'routine' | 'agent' | 'sector'

export interface WsDestination {
  kind: WsDestinationKind
  /** Para `memory`: onde guardar. Os outros escopos exigem o id correspondente. */
  memoryScope?: 'agent' | 'sector' | 'floor' | 'building'
  agentId?: string | null
  sectorId?: string | null
  floorId?: string | null
  buildingId?: string | null
  /** Para `routine`: qual automação disparar. */
  automationId?: string | null
}

/**
 * Uma ASSINATURA: o que pedir ao serviço, e o que fazer com a resposta.
 *
 * Fica separada da conexão porque a vida das duas é diferente: a conexão é o endereço e
 * a credencial, e muda pouco; a assinatura é o que se está ouvindo agora, e muda toda
 * hora. Juntá-las obrigaria a reconectar para trocar de canal.
 */
export interface WsSubscription {
  _id: ObjectId
  ownerId: string
  installationId: string
  name: string
  /** JSON mandado ao entrar. Vazio = a conexão já entrega tudo sem pedir. */
  subscribeMessage: string
  unsubscribeMessage: string
  /** Só o que casar com estes filtros pertence a esta assinatura. Vazio = tudo. */
  filters: WsFilter[]
  /** Canal esperado, quando o serviço identifica canal. Vazio = qualquer um. */
  channel: string
  active: boolean
  destination: WsDestination
  /** Contadores para a tela, sem precisar varrer as mensagens. */
  messageCount: number
  lastMessageAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** Por que uma mensagem NÃO virou evento. É o que a tela de Mensagens mostra como status. */
export type WsMessageStatus = 'accepted' | 'filtered' | 'invalid' | 'duplicate' | 'rate_limited' | 'too_large'

export interface WsMessage {
  _id: ObjectId
  ownerId: string
  installationId: string
  subscriptionId: string | null
  channel: string
  status: WsMessageStatus
  /**
   * Um PEDAÇO do conteúdo, cortado.
   *
   * Mensagem inteira não fica: ela vem de fora, pode ser grande e pode conter o que
   * ninguém revisou. O que se guarda é o suficiente para reconhecer o que chegou.
   */
  preview: string
  messageId: string | null
  /** O evento publicado, quando houve. É o fio entre esta tela e o barramento. */
  eventId: string | null
  occurredAt: Date
  receivedAt: Date
  expiresAt: Date
}

export type WsLogKind = 'connected' | 'disconnected' | 'reconnecting' | 'error' | 'dropped' | 'invalid' | 'triggered' | 'subscribed'

export interface WsLog {
  _id: ObjectId
  ownerId: string
  installationId: string
  kind: WsLogKind
  /**
   * Uma frase escrita por nós, sobre a CONFIGURAÇÃO e o estado.
   *
   * Nunca o cabeçalho, nunca a query, nunca a mensagem de autenticação, nunca o corpo
   * do que chegou. O log é lido por quem administra e às vezes por quem dá suporte — é
   * o lugar mais fácil de vazar o que o resto do sistema protege.
   */
  message: string
  subscriptionId: string | null
  createdAt: Date
  expiresAt: Date
}
