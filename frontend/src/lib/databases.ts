import { API_URL } from './api'

// O cliente de Databases.

export type AdapterKind = 'data_history' | 'market_data' | 'external_app'
export type Mutability = 'append_only' | 'mutable' | 'read_only'
export type StoreStatus = 'active' | 'paused' | 'archived'

export const ADAPTER_LABEL: Record<AdapterKind, string> = {
  data_history: 'Histórico interno',
  market_data: 'Dados de mercado',
  external_app: 'App conectado',
}

export const MUTABILITY_LABEL: Record<Mutability, string> = {
  append_only: 'só acrescenta',
  mutable: 'editável',
  read_only: 'somente leitura',
}

export const STATUS_LABEL: Record<StoreStatus, string> = {
  active: 'ativo',
  paused: 'pausado',
  archived: 'arquivado',
}

export interface DatabaseSummary {
  id: string
  name: string
  description: string
  adapterKind: AdapterKind
  status: StoreStatus
  retention: { mode: 'forever' } | { mode: 'ttl'; days: number }
  owner: { ownerType: string; ownerId: string }
  datasets: number
  updatedAt: string
}

export interface DatasetSummary {
  key: string
  name: string
  mutability: Mutability
  fields: string[]
  schema: Record<string, unknown>
  /**
   * DE ONDE VEM e COM QUE REGRA, quando o conjunto é alimentado por uma série.
   *
   * Sem isto, o conjunto é uma tabela sem procedência: dá para ver o que foi gravado e não
   * dá para saber quem gravou, de onde, nem de quanto em quanto tempo — que é a pergunta
   * seguinte de quem olha um número. Ausente significa conjunto criado à mão.
   */
  serie?: {
    id: string
    nome: string
    modo: string
    intervalMs: number | null
    contas: string[]
    ativa: boolean
    registros: number
    fonte: string | null
  }
}

export interface DatabaseDetail extends Omit<DatabaseSummary, 'datasets'> {
  adapterConfig: Record<string, unknown>
  datasets: DatasetSummary[]
}

export interface QueryResult {
  rows: Record<string, unknown>[]
  total: number
  returned: number
  truncated: boolean
  freshness: string | null
}

export interface DatabaseGrant {
  id: string
  subjectType: 'building' | 'floor' | 'sector' | 'agent'
  subjectId: string
  capabilities: string[]
  effect: 'allow' | 'deny'
  datasetKeys: string[]
  updatedAt: string
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
    throw new Error(corpo?.message ?? corpo?.error ?? `${res.status}`)
  }
  return (res.status === 204 ? (null as T) : ((await res.json()) as T))
}

const req = <T>(caminho: string, init: { method?: string; body?: unknown } = {}): Promise<T> =>
  fetch(`${API_URL}${caminho}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).then(json<T>)

export const listDatabases = () => req<{ items: DatabaseSummary[] }>('/api/databases')
export const getDatabase = (id: string) => req<DatabaseDetail>(`/api/databases/${id}`)
export const createDatabase = (body: { name: string; description?: string; adapterKind: AdapterKind; adapterConfig?: Record<string, unknown> }) =>
  req<{ id: string; name: string }>('/api/databases', { method: 'POST', body })
export const patchDatabase = (id: string, body: { name?: string; description?: string; status?: StoreStatus }) =>
  req<{ id: string }>(`/api/databases/${id}`, { method: 'PATCH', body })
export const deleteDatabase = (id: string) => req<null>(`/api/databases/${id}`, { method: 'DELETE' })

/**
 * MUDAR e APAGAR um conjunto.
 *
 * O servidor já respondia às duas desde sempre; o cliente parou no criar. Uma rota que
 * existe e ninguém chama é uma capacidade que, para quem usa, não existe.
 */
export const patchDataset = (id: string, key: string, body: { name?: string; mutability?: Mutability }) =>
  req<{ key: string; name: string; mutability: Mutability }>(`/api/databases/${id}/datasets/${key}`, { method: 'PATCH', body })
export const deleteDataset = (id: string, key: string) => req<null>(`/api/databases/${id}/datasets/${key}`, { method: 'DELETE' })

export const createDataset = (id: string, body: { key: string; name: string; schema: Record<string, unknown> }) =>
  req<{ key: string }>(`/api/databases/${id}/datasets`, { method: 'POST', body })

/**
 * CORRIGIR e APAGAR uma linha.
 *
 * A consulta devolve `rowId` em cada linha — é por ele que se aponta qual. Uma série que só
 * acrescenta recusa as duas, e a recusa vem com o motivo escrito.
 */
export const patchRow = (id: string, key: string, rowId: string, row: Record<string, unknown>) =>
  req<{ updated: number }>(`/api/databases/${id}/datasets/${key}/rows/${rowId}`, { method: 'PATCH', body: { row } })
export const deleteRow = (id: string, key: string, rowId: string) =>
  req<null>(`/api/databases/${id}/datasets/${key}/rows/${rowId}`, { method: 'DELETE' })

export const queryDataset = (id: string, key: string, body: Record<string, unknown>) =>
  req<QueryResult>(`/api/databases/${id}/datasets/${key}/query`, { method: 'POST', body })

export const listDatabaseGrants = (id: string) => req<{ items: DatabaseGrant[] }>(`/api/databases/${id}/grants`)
export const putDatabaseGrant = (id: string, body: { subjectType: string; subjectId: string; capabilities: string[]; effect?: string; datasetKeys?: string[] }) =>
  req<DatabaseGrant>(`/api/databases/${id}/grants`, { method: 'PUT', body })
export const deleteDatabaseGrant = (id: string, grantId: string) => req<null>(`/api/databases/${id}/grants/${grantId}`, { method: 'DELETE' })

export const getDatabaseImpact = (id: string) =>
  req<{ dataStoreId: string; name: string; datasets: { key: string; mutability: Mutability }[]; grants: number; accessibleBy: { agentId: string; name: string; origin: string }[]; recommendation: string }>(
    `/api/databases/${id}/impact`,
  )
