import type { ObjectId } from 'mongodb'
import type { ArchitectStamp } from '../architectStamp.js'
import type { Retention } from '../dataHistory/types.js'

// DATABASE — o sistema de registros do escritório.
//
// É o terceiro mecanismo, e a distinção entre os três é a coisa mais importante deste
// arquivo:
//
//   Knowledge  → texto curado, buscado por semelhança. Responde "o que a empresa diz".
//   Memory     → fato acumulado por execução, com chave. Responde "o que eu lembro".
//   Database   → registro estruturado, consultado por filtro. Responde "o que aconteceu".
//
// Transformar preço em documento RAG é o erro que este módulo existe para não cometer:
// uma série de cotações não tem semântica de texto, e buscá-la por semelhança devolve
// "parecido" quando a pergunta pedia "exato".
//
// Um Data Store NÃO é um banco novo. É um recurso lógico que aponta para um armazenamento
// que já existe — os recorders do histórico, o engine de mercado, uma conexão de App — e
// dá a eles nome, dono, schema, capacidades e cota.

export type DataStoreAdapterKind = 'data_history' | 'market_data' | 'external_app'
export const ADAPTER_KINDS: readonly DataStoreAdapterKind[] = ['data_history', 'market_data', 'external_app']

export type DataStoreStatus = 'active' | 'paused' | 'archived'

/**
 * O que pode ser feito com um dataset — e por que `append_only` importa.
 *
 * Uma série temporal que aceita `update` deixa de ser história: alguém corrige um valor de
 * ontem e o gráfico muda sem que nada registre a mudança. Por isso a mutabilidade é do
 * DATASET e é conferida antes de qualquer escrita, inclusive com grant malformado.
 */
export type DatasetMutability = 'append_only' | 'mutable' | 'read_only'

export interface DataStore {
  /**
   * De onde ele veio, quando veio do Arquiteto.
   *
   * Fecha a janela entre criar e registrar o passo: com a marca, a retomada PROCURA antes de
   * criar e encontra o que ficou de pé. Opcional — quem cria pela tela não tem origem.
   */
  architect?: ArchitectStamp
  _id: ObjectId
  ownerId: string
  buildingId: ObjectId | null
  name: string
  description: string
  /** Quem administra. `account`/`building` hoje; andar e setor quando a UI oferecer. */
  owner: { ownerType: 'account' | 'building' | 'floor' | 'sector'; ownerId: string }
  adapterKind: DataStoreAdapterKind
  /** REFERÊNCIAS, nunca segredo: id de recorder, chave de App, símbolo de mercado. */
  adapterConfig: Record<string, unknown>
  status: DataStoreStatus
  retention: Retention
  version: number
  createdAt: Date
  updatedAt: Date
}

export interface DataSetDefinition {
  _id: ObjectId
  ownerId: string
  dataStoreId: ObjectId
  key: string
  name: string
  /** JSON Schema do registro. Valida insert e update — inclusive os vindos de agente. */
  schema: Record<string, unknown>
  primaryKey?: string[]
  mutability: DatasetMutability
  timeField?: string
  createdAt: Date
  updatedAt: Date
}

/** As capacidades de Database. As duas últimas nunca são de agente. */
export const DATABASE_CAPABILITIES = ['discover', 'query', 'insert', 'update', 'delete', 'manage_schema', 'manage_access'] as const
export type DatabaseCapability = (typeof DATABASE_CAPABILITIES)[number]

/**
 * O GRANT de database para um sujeito.
 *
 * Genérico de propósito: diferente de Knowledge (que tem política própria) e de App (que
 * tem instalação e ação), aqui não existia nada — e inventar uma segunda política
 * especializada só para databases seria repetir o problema que a camada comum resolve.
 *
 * `deny` existe e VENCE: uma exceção precisa poder ser dita, e uma exceção que perde para
 * uma herança é uma exceção decorativa.
 */
export interface DataStoreGrant {
  _id: ObjectId
  ownerId: string
  dataStoreId: ObjectId
  /** Vale para o sujeito e — quando é setor/andar — para quem estiver nele na hora. */
  subjectType: 'building' | 'floor' | 'sector' | 'agent'
  subjectId: ObjectId
  capabilities: DatabaseCapability[]
  effect: 'allow' | 'deny'
  /** Restringe a datasets específicos. Vazio = todos os do store. */
  datasetKeys: string[]
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export interface QueryLogEntry {
  ownerId: string
  dataStoreId: ObjectId
  datasetKey: string
  agentId: ObjectId | null
  capability: DatabaseCapability
  durationMs: number
  rows: number
  ok: boolean
  errorCode?: string | null
  at: Date
}
