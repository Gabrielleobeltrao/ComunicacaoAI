import { API_URL } from './api'

// Client for the Apps API. A stored credential is never part of this contract: the
// backend returns field DEFINITIONS and public metadata, never a value, so there is
// nothing here that could put a secret on screen.

export type AppSource = 'system' | 'private' | 'community'
export type ActionRisk = 'read' | 'write' | 'high_risk'
export type InstallationStatus = 'connected' | 'error' | 'revoked' | 'needs_reauth'

export interface AppAuthField {
  key: string
  label: string
  placeholder: string | null
  required: boolean
  secret: boolean
  help: string | null
}

export interface AppActionSummary {
  key: string
  name: string
  description: string
  risk: ActionRisk
  inputSchema: Record<string, unknown>
  resourceFields: { key: string; label: string; placeholder?: string; required: boolean; help?: string }[]
}

export interface AppSurfaceSummary {
  key: string
  label: string
  description: string
  icon: string | null
  scope: 'account' | 'building' | 'floor'
  routeSegment: string
}

export type AppActivation = 'instant' | 'credentials' | 'oauth' | 'managed_channel'

// O App já pode ser usado? Coisa diferente do ciclo de publicação: um App pode estar
// no catálogo, com nome e descrição, e ainda não estar pronto para ligar em nada.
// Ausente = disponível.
export type AppAvailability = 'available' | 'coming_soon'

export interface AppCatalogEntry {
  key: string
  version: string
  availability?: AppAvailability
  source: AppSource
  name: string
  description: string
  icon: string | null
  categories: string[]
  documentationUrl: string | null
  status: string
  auth: { kind: string; fields: AppAuthField[]; scopes: string[]; documentationUrl: string | null }
  allowedDomains: string[]
  supportsMultipleConnections: boolean
  actions: AppActionSummary[]
  surfaces: AppSurfaceSummary[]
  pinnable: boolean
  defaultSurfaceKey: string | null
  dataAccess: string[]
  storageNote: string | null
  disconnectNote: string | null
  providerCostNote: string | null
  requiresAuth: boolean
  // HOW this App becomes active. `managed_channel` cannot be created by the generic
  // form: its CTA sends the owner to the real flow.
  activation: AppActivation
  activationRoute: string | null
  installationCount?: number
  connected?: boolean
}

export interface AppInstallation {
  id: string
  appKey: string
  appVersion: string
  name: string
  status: InstallationStatus
  publicMetadata: Record<string, string>
  grantedScopes: string[]
  createdAt: string
  updatedAt: string
  lastTestedAt: string | null
  agentCount?: number
  /**
   * O AMBIENTE da conexão. Sempre resolvido pelo servidor — uma conexão criada antes
   * deste campo chega como `default`, e nada muda para ela.
   */
  environment?: 'default' | 'paper' | 'live'
}

export interface AppGrant {
  installationId: string
  appKey: string
  actionKeys: string[]
  resourceConfig: Record<string, string>
  autonomousWriteActionKeys: string[]
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (!res.ok) {
    // The message is the backend's; it is written for the owner and carries no value.
    const body = await res.json().catch(() => null)
    throw new Error(body?.message ?? body?.error ?? 'Não foi possível concluir.')
  }
  return res.status === 204 ? (null as T) : ((await res.json()) as T)
}

export const listAppCatalog = () => request<AppCatalogEntry[]>('/api/apps/catalog')
export const getAppDetail = (appKey: string) =>
  request<AppCatalogEntry & { installations: AppInstallation[]; connected: boolean }>(`/api/apps/catalog/${appKey}`)

export const listInstallations = (appKey?: string) =>
  request<AppInstallation[]>(`/api/app-installations${appKey ? `?appKey=${encodeURIComponent(appKey)}` : ''}`)

export const createInstallation = (input: { appKey: string; name?: string; config?: Record<string, string> }) =>
  request<AppInstallation>('/api/app-installations', { method: 'POST', body: JSON.stringify(input) })

export const patchInstallation = (id: string, input: { name?: string; config?: Record<string, string> }) =>
  request<AppInstallation>(`/api/app-installations/${id}`, { method: 'PATCH', body: JSON.stringify(input) })

export const testInstallation = (id: string) =>
  fetch(`${API_URL}/api/app-installations/${id}/test`, { method: 'POST', credentials: 'include' }).then(
    async (res) => (await res.json()) as { ok: boolean; message: string },
  )

export const reconnectInstallation = (id: string) =>
  request<{ kind: 'oauth' | 'credential'; connectPath?: string; fields?: AppAuthField[] }>(`/api/app-installations/${id}/reconnect`, {
    method: 'POST',
  })

// Disconnect REVOKES by default: history is kept and nothing the owner produced is
// deleted. `purge` is the separate, explicit removal.
export const disconnectInstallation = (id: string, purge = false) =>
  request<{ revoked?: boolean; deleted?: boolean }>(`/api/app-installations/${id}${purge ? '?purge=true' : ''}`, { method: 'DELETE' })

export const listAgentGrants = (agentId: string) => request<AppGrant[]>(`/api/agents/${agentId}/app-grants`)
export const saveAgentGrants = (agentId: string, grants: Omit<AppGrant, 'appKey'>[]) =>
  request<AppGrant[]>(`/api/agents/${agentId}/app-grants`, { method: 'PATCH', body: JSON.stringify({ grants }) })

export const RISK_LABEL: Record<ActionRisk, string> = {
  read: 'Lê dados',
  write: 'Altera dados',
  high_risk: 'Alto risco',
}

export const STATUS_LABEL: Record<InstallationStatus, string> = {
  connected: 'Conectado',
  error: 'Com erro',
  revoked: 'Desconectado',
  needs_reauth: 'Reconectar',
}

// A connection is only usable while it is connected. Used by the UI to decide what
// to offer — the backend enforces the same rule regardless.
export const isUsable = (i: AppInstallation): boolean => i.status === 'connected'

// Can the generic "type these fields" form create this App's connection?
export const acceptsGenericConnect = (app: Pick<AppCatalogEntry, 'activation'>): boolean =>
  app.activation === 'instant' || app.activation === 'credentials'

// Only a CONNECTED installation is usable — `error`, `needs_reauth` and `revoked`
// are not. The backend enforces the same rule.
export const connectedCount = (installations: AppInstallation[]): number => installations.filter(isUsable).length

// --- Apps privados ------------------------------------------------------------------
// A private App is a MANIFEST: declarative HTTP actions the owner wrote. It is edited
// as JSON because that is literally what it is — there is no code to compile and no
// page to render, which is also why exporting one and handing it over is safe: a
// manifest never held a credential.

export interface PrivateAppImpact {
  installations: number
  connectedInstallations: number
  agents: number
  archived: boolean
}

const priv = (key: string, suffix = '') => `/api/apps/private/${encodeURIComponent(key)}${suffix}`

export const listPrivateApps = () => request<AppCatalogEntry[]>('/api/apps/private')

export const createPrivateApp = (manifest: unknown) =>
  request<AppCatalogEntry>('/api/apps/private', { method: 'POST', body: JSON.stringify(manifest) })

// Importing creates a DRAFT in this account and grants nothing: the importer still
// has to connect their own credential and authorise an agent.
export const importPrivateApp = (manifest: unknown) =>
  request<AppCatalogEntry>('/api/apps/private/import', { method: 'POST', body: JSON.stringify({ manifest }) })

export const updatePrivateApp = (key: string, manifest: unknown) =>
  request<AppCatalogEntry>(priv(key), { method: 'PATCH', body: JSON.stringify(manifest) })

export const exportPrivateApp = (key: string) => request<Record<string, unknown>>(priv(key, '/export'))

export const privateAppImpact = (key: string) => request<PrivateAppImpact>(priv(key, '/impact'))

export const archivePrivateApp = (key: string, archived: boolean) =>
  request<AppCatalogEntry>(priv(key, '/archive'), { method: 'POST', body: JSON.stringify({ archived }) })

export const deletePrivateApp = (key: string) => request<{ deleted: boolean }>(priv(key), { method: 'DELETE' })

// --- o catálogo de executores ---------------------------------------------------------
//
// O que este servidor sabe executar sem passar por um modelo. Só leitura, e só o que pode
// aparecer numa tela: nome, versão, descrição e contratos. Nunca o corpo da função, nunca
// credencial — o agente guarda a REFERÊNCIA, e o código vive no servidor.

export interface CatalogFunction {
  functionName: string
  version: string
  description: string
  capabilities: string[]
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  /** Os parâmetros configuráveis, quando a função aceita algum. */
  configSchema?: Record<string, unknown> | null
  timeoutMs: number
  metadata?: Record<string, string>
}

export interface CatalogAction {
  appKey: string
  appName: string
  actionKey: string
  name: string
  description: string
  risk: string
  inputSchema?: Record<string, unknown> | null
  /** O que a ação devolve. Ausente = a saída não serve de contrato estruturado. */
  outputSchema?: Record<string, unknown> | null
}

export const listExecutorCatalog = () =>
  request<{ functions: CatalogFunction[]; actions: CatalogAction[] }>('/api/executors/catalog')
