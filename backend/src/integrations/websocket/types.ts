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
  /**
   * A automação que ESTA assinatura criou para executar agente ou setor.
   *
   * A relação fica explícita no documento de propósito: ela muda quando o destino muda
   * e é arquivada quando a assinatura some. Sem este campo, sobraria uma automação
   * órfã que alguém encontra meses depois sem saber de onde veio.
   */
  managedAutomationId?: string | null
  /** Contadores para a tela, sem precisar varrer as mensagens. */
  messageCount: number
  lastMessageAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/**
 * O que aconteceu com a mensagem. É o que a tela de Mensagens mostra como situação.
 *
 * `filtered` e `ignored` parecem a mesma coisa e não são: `filtered` é o filtro da
 * CONEXÃO recusando (configuração de quem conectou), e `ignored` é a mensagem ter
 * passado e nenhuma assinatura tê-la reivindicado. A primeira se corrige mexendo na
 * conexão; a segunda, criando ou ajustando uma assinatura.
 */
export type WsMessageStatus = 'accepted' | 'filtered' | 'ignored' | 'invalid' | 'duplicate' | 'rate_limited' | 'too_large' | 'failed'

export interface WsMessage {
  _id: ObjectId
  ownerId: string
  installationId: string
  /** A primeira assinatura que a reivindicou. Mantido para o histórico já gravado. */
  subscriptionId: string | null
  /**
   * TODAS as assinaturas que a reivindicaram.
   *
   * Uma mensagem pode servir a mais de uma — canais que se sobrepõem, filtros que se
   * cruzam — e cada uma tem o seu destino. Guardar só a primeira fazia as outras
   * sumirem do histórico como se nunca tivessem recebido nada.
   */
  subscriptionIds?: string[]
  channel: string
  status: WsMessageStatus
  /** Por que ela não virou evento, quando não virou. Uma frase nossa, nunca o conteúdo. */
  reason?: string
  /**
   * Um PEDAÇO do conteúdo, cortado.
   *
   * Mensagem inteira não fica: ela vem de fora, pode ser grande e pode conter o que
   * ninguém revisou. O que se guarda é o suficiente para reconhecer o que chegou.
   */
  preview: string
  messageId: string | null
  /** Os eventos publicados — um por assinatura. É o fio entre esta tela e o barramento. */
  eventId: string | null
  eventIds?: string[]
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
