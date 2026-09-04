import { API_URL } from './api'

// O cliente de Extensions e do Marketplace.
//
// Instalar e atualizar são chamadas diferentes de propósito: uma versão nova que pede
// mais permissão não entra por uma atualização de rotina — a tela mostra o diff, e só
// depois disso a atualização é aplicada.

export type ExtensionKind = 'app' | 'tool' | 'template'
export type ExtensionStatus =
  | 'draft'
  | 'testing'
  | 'submitted'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'published'
  | 'suspended'
  | 'deprecated'

export const KIND_LABEL: Record<ExtensionKind, string> = {
  app: 'App',
  tool: 'Ferramenta',
  template: 'Template',
}

export const STATUS_LABEL: Record<ExtensionStatus, string> = {
  draft: 'rascunho',
  testing: 'em teste',
  submitted: 'enviado para revisão',
  in_review: 'em revisão',
  changes_requested: 'mudanças pedidas',
  approved: 'aprovado',
  published: 'publicado',
  suspended: 'suspenso',
  deprecated: 'descontinuado',
}

export interface PermissionRequest {
  kind: 'app' | 'network' | 'database' | 'knowledge'
  key: string
  capabilities: string[]
  reason: string
}

export interface CatalogItem {
  id: string
  kind: ExtensionKind
  slug: string
  name: string
  summary: string
  categories: string[]
  latestVersion: string | null
  author: 'platform' | 'community'
  installs: number
  updatedAt: string
}

export interface MyPackage {
  _id: string
  kind: ExtensionKind
  slug: string
  name: string
  summary: string
  visibility: 'private' | 'organization' | 'community'
  status: ExtensionStatus
  latestVersion: string | null
  suspendedReason?: string | null
  updatedAt: string
}

export interface Installed {
  packageId: string
  version: string
  status: 'active' | 'paused' | 'blocked'
  installedAt: string
}

export interface UpdatePreview {
  from: string
  to: string
  changelog: string
  compatible: boolean
  permissions: {
    added: PermissionRequest[]
    removed: PermissionRequest[]
    changed: { key: string; kind: string; before: string[]; after: string[] }[]
    needsApproval: boolean
  }
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
    ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
  }).then((r) => json<T>(r))

export const searchCatalog = (termo = '', kind?: ExtensionKind) => {
  const q = new URLSearchParams()
  if (termo) q.set('term', termo)
  if (kind) q.set('kind', kind)
  return req<{ items: CatalogItem[] }>(`/api/extensions/catalog?${q.toString()}`).then((r) => r.items)
}

export const myPackages = () => req<{ items: MyPackage[] }>('/api/extensions/packages').then((r) => r.items)
export const installed = () => req<{ items: Installed[] }>('/api/extensions/installed').then((r) => r.items)
export const installPackage = (packageId: string) => req<{ version: string }>(`/api/extensions/installed/${packageId}`, { method: 'POST' })
export const installTemplate = (packageId: string) =>
  req<{ projectId: string; version: string }>(`/api/extensions/installed/${packageId}/template`, { method: 'POST' })
export const previewUpdate = (packageId: string) => req<UpdatePreview | null>(`/api/extensions/installed/${packageId}/update`)
export const applyUpdate = (packageId: string, approvePermissions: boolean) =>
  req<{ version: string }>(`/api/extensions/installed/${packageId}/update`, { method: 'POST', body: { approvePermissions } })
export const uninstall = (packageId: string) => req<{ status: string }>(`/api/extensions/installed/${packageId}`, { method: 'DELETE' })
export const submitForReview = (packageId: string) =>
  req<{ status: ExtensionStatus }>(`/api/extensions/packages/${packageId}/status`, { method: 'POST', body: { status: 'submitted' } })

/**
 * A frase que resume o que uma permissão pede.
 *
 * "api.exemplo.com: ler e escrever" diz mais do que a estrutura crua — e é a diferença
 * entre alguém revisar de verdade e clicar em aceitar.
 */
export const descreverPermissao = (p: PermissionRequest): string => {
  const alvo = p.kind === 'network' ? `o endereço ${p.key}` : p.kind === 'app' ? `o App ${p.key}` : `${p.kind} ${p.key}`
  return `${alvo}: ${p.capabilities.join(', ') || 'sem capacidade declarada'}`
}
