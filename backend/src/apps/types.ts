// The App manifest — the contract every integration is described by, whether it
// ships with the product, was written by an owner for their own account, or (in a
// future round) comes from the community.
//
// A manifest is DATA, never code. That is the whole security model of this layer:
// a system App may point at a versioned TypeScript adapter compiled into this
// repository, but a private or community App can only declare HTTP actions, which
// run through the same canonical executor every other tool uses. Nothing here can
// introduce a second execution path.
import type { ObjectId } from 'mongodb'

export type AppSource = 'system' | 'private' | 'community'
export const APP_SOURCES: AppSource[] = ['system', 'private', 'community']

export type AppAuthKind = 'none' | 'oauth2' | 'api_key' | 'bearer' | 'basic' | 'webhook'
export const APP_AUTH_KINDS: AppAuthKind[] = ['none', 'oauth2', 'api_key', 'bearer', 'basic', 'webhook']

// What an action does to the far side. It drives what the UI warns about and what
// an agent may do on its own: a write never gets autonomous authorisation by
// installing an App.
export type ActionRisk = 'read' | 'write' | 'high_risk'
export const ACTION_RISKS: ActionRisk[] = ['read', 'write', 'high_risk']

export type AppStatus = 'draft' | 'review' | 'published' | 'suspended'
export const APP_STATUSES: AppStatus[] = ['draft', 'review', 'published', 'suspended']

// A field the OWNER fills in once, on the account. Secret fields are encrypted at
// rest and never returned by the API.
export interface AppAuthField {
  key: string
  label: string
  placeholder?: string
  required: boolean
  secret: boolean
  help?: string
}

export interface AppAuthDefinition {
  kind: AppAuthKind
  fields: AppAuthField[]
  // OAuth only: scopes requested, shown to the owner before connecting.
  scopes?: string[]
  documentationUrl?: string
}

// A per-AGENT, NON-SECRET setting: which calendar, which spreadsheet, which tab.
// Credentials never appear here — they live on the installation.
export interface AppResourceField {
  key: string
  label: string
  placeholder?: string
  required: boolean
  help?: string
}

export type AppActionExecution =
  // A system App resolved by a versioned adapter compiled into this repository.
  | { kind: 'native'; adapter: string }
  // Anything declarative: an HTTP request built from the manifest and run through
  // executeToolCall, with the same SSRF/domain/timeout/limit rules as a Custom Tool.
  | {
      kind: 'http'
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
      url: string
      headers?: { key: string; value: string }[]
      bodyTemplate?: string | null
    }

export interface AppActionDefinition {
  // Stable within the App. The name offered to the model is namespaced from
  // (appKey, key) so two Apps can both have `send`.
  key: string
  name: string
  // What teaches the model WHEN to reach for it. The most important field.
  description: string
  risk: ActionRisk
  inputSchema: Record<string, unknown>
  execution: AppActionExecution
  resourceFields?: AppResourceField[]
  scopes?: string[]
  timeoutMs?: number
  maxResponseChars?: number
  maxCallsPerRun?: number
}

export type AppSurfaceKind = 'native' | 'declarative'
export type AppSurfaceScope = 'account' | 'building' | 'floor'

// A page the App adds to the product. `routeSegment` is a validated identifier,
// never a free URL: native surfaces resolve through a compiled registry in the
// frontend, and no manifest can point at a module, import or script.
export interface AppSurfaceDefinition {
  key: string
  label: string
  description: string
  icon?: string
  kind: AppSurfaceKind
  scope: AppSurfaceScope
  routeSegment: string
  requiredActionKeys?: string[]
}

export interface AppDefinition {
  key: string
  version: string
  source: AppSource
  name: string
  description: string
  icon?: string
  categories: string[]
  documentationUrl?: string
  auth: AppAuthDefinition
  // Every host an action of this App may reach. Enforced by the executor, and
  // shown to the owner BEFORE connecting.
  allowedDomains: string[]
  supportsMultipleConnections: boolean
  actions: AppActionDefinition[]
  surfaces?: AppSurfaceDefinition[]
  sidebar?: {
    pinnable: boolean
    defaultSurfaceKey: string
  }
  status: AppStatus
  // What the owner is told before connecting: what is read, what is stored, and
  // what happens on disconnect.
  dataAccess?: string[]
  storageNote?: string
  disconnectNote?: string
  providerCostNote?: string
}

// --- installation -------------------------------------------------------------
// The owner's account/credential for an App. It evolves the existing `connections`
// collection instead of opening a second source of truth: a document written before
// this model keeps working, and `provider` stays readable while routines still
// reference delivery connections by it.

export type InstallationStatus = 'connected' | 'error' | 'revoked' | 'needs_reauth'
export const INSTALLATION_STATUSES: InstallationStatus[] = ['connected', 'error', 'revoked', 'needs_reauth']

export interface AppInstallation {
  _id: ObjectId
  ownerId: string
  buildingId: ObjectId | null
  appKey: string
  appVersion: string
  name: string
  status: InstallationStatus
  encryptedConfig: string
  publicMetadata: Record<string, string>
  grantedScopes: string[]
  createdAt: Date
  updatedAt: Date
  lastTestedAt?: Date | null
  // Legacy compatibility: the delivery flow still resolves connections by provider.
  provider?: string
  scopes?: string[]
}

// What the API returns. There is no field here that could carry a credential.
export interface AppInstallationPublic {
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
}

// --- agent grant ---------------------------------------------------------------
// The permission itself: which installation, which actions, and which of those
// actions may run without asking. Not listed means not reachable.

export interface AgentAppGrant {
  installationId: string
  actionKeys: string[]
  // Non-secret per-agent resource selection (calendarId, spreadsheetId, …).
  resourceConfig: Record<string, string>
  // A write action only runs on the agent's own initiative when it is listed here.
  autonomousWriteActionKeys: string[]
}

// The tool name the model sees. Namespaced and predictable, so two Apps never
// collide and a name stays stable across versions.
export const actionToolName = (appKey: string, actionKey: string): string =>
  `${appKey}__${actionKey}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
