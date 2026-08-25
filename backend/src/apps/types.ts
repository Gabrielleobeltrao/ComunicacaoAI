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

// HOW an App becomes active. This is not the same question as `auth.kind`: an App can
// need no credential and still not be activatable by a generic form.
//
//   instant         · no credential, idempotent. Activating is the whole flow.
//   credentials     · the owner types the declared fields into the generic form.
//   oauth           · the provider's consent flow owns it.
//   managed_channel · the App is active only while a real channel of its own exists.
//                     The generic form CANNOT create it — WhatsApp needs a number and
//                     a provider, and a row saying "connected" with neither is a lie
//                     the map, the metrics and the agents would all repeat.
export type AppActivation = 'instant' | 'credentials' | 'oauth' | 'managed_channel'
export const APP_ACTIVATIONS: AppActivation[] = ['instant', 'credentials', 'oauth', 'managed_channel']

export type AppStatus = 'draft' | 'review' | 'published' | 'suspended'
export const APP_STATUSES: AppStatus[] = ['draft', 'review', 'published', 'suspended']

/**
 * O App já pode ser USADO?
 *
 * Coisa diferente de `status`, que é o ciclo de publicação (rascunho, revisão,
 * publicado, suspenso). Um App pode estar publicado — aparecer no catálogo, com nome e
 * descrição — e ainda não estar pronto para ligar em nada.
 *
 * É para isso que serve `coming_soon`: anunciar sem entregar. O App fica visível com
 * selo "Em breve", e conectar, conceder e executar são todos recusados — no backend,
 * não só na tela. Esconder o App seria a alternativa fácil, e ela desperdiça a única
 * coisa que um "em breve" tem de útil: dizer ao dono o que está vindo.
 *
 * Ausente = `available`. É isso que faz todo manifesto escrito antes deste campo
 * continuar exatamente como era.
 */
export type AppAvailability = 'available' | 'coming_soon'
export const APP_AVAILABILITIES: AppAvailability[] = ['available', 'coming_soon']
export const availabilityOf = (app: { availability?: AppAvailability } | null | undefined): AppAvailability =>
  app?.availability === 'coming_soon' ? 'coming_soon' : 'available'
export const isUsableApp = (app: { availability?: AppAvailability } | null | undefined): boolean =>
  availabilityOf(app) === 'available'

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
  /**
   * O que a ação DEVOLVE, quando ela sabe dizer.
   *
   * Opcional de propósito: a maioria das ações de App devolve o corpo de um terceiro, cuja
   * forma o manifesto não controla. Sem isto declarado, a saída não pode servir de contrato
   * estruturado — e é melhor dizer isso do que inventar um schema que a primeira resposta
   * diferente desmente.
   */
  outputSchema?: Record<string, unknown>
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
  // Absent = derived from `auth.kind` (oauth2 → oauth, no field → instant, else
  // credentials), so a manifest written before this existed keeps behaving the same.
  activation?: AppActivation
  /**
   * O ambiente que uma conexão nova assume quando ninguém escolhe.
   *
   * Existe por causa de um App cujo ambiente padrão NÃO é o comum: uma corretora que só
   * opera em simulação precisa nascer marcada como simulação, senão a conexão fica com
   * cara de produção na tela e o selo — que é a única defesa contra confundir as duas —
   * nunca aparece.
   */
  defaultEnvironment?: AppEnvironment
  // `managed_channel` only: where the real flow lives, so the CTA can send the owner
  // to it instead of opening a form that cannot produce a valid connection.
  activationRoute?: string
  actions: AppActionDefinition[]
  /**
   * Presente = este App pode ser usado como CONEXÃO por uma ferramenta do dono.
   *
   * Ausente = ele só executa as próprias ações, como sempre. Nenhum App existente muda
   * de comportamento por causa deste campo.
   */
  connection?: AppConnectionProfile
  surfaces?: AppSurfaceDefinition[]
  sidebar?: {
    pinnable: boolean
    defaultSurfaceKey: string
  }
  status: AppStatus
  // Ausente = 'available'. Ver `AppAvailability`.
  availability?: AppAvailability
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

/**
 * O AMBIENTE de uma conexão.
 *
 * `default` é o que toda instalação existente é, e é o que ela continua sendo sem nada
 * gravado. `paper` e `live` existem porque um provedor de mercado tem dois mundos com
 * credenciais e consequências diferentes — e misturá-los é enviar ordem de verdade
 * achando que era simulada.
 *
 * Duas conexões do MESMO App em ambientes diferentes nunca compartilham credencial: cada
 * uma é uma instalação, com o próprio `encryptedConfig`.
 */
export type AppEnvironment = 'default' | 'paper' | 'live'
export const APP_ENVIRONMENTS: readonly AppEnvironment[] = ['default', 'paper', 'live']

/**
 * O PERFIL DE CONEXÃO de um App: o endereço base e os cabeçalhos comuns.
 *
 * Ele existe para uma ferramenta do dono poder guardar só o caminho — `/v2/account` — e
 * receber base e autenticação na hora de executar. Sem isso, cada ferramenta repetiria a
 * URL inteira e a credencial, e trocar a chave significaria editar todas.
 *
 * Os valores aceitam `{{campo}}` da configuração cifrada e dos metadados públicos, pelo
 * mesmo interpolador que as ações declarativas já usam.
 */
export interface AppConnectionProfile {
  /** O endereço base padrão. */
  baseUrl: string
  /** Sobrescreve por ambiente. Ausente = o mesmo `baseUrl` para todos. */
  baseUrlByEnvironment?: Partial<Record<AppEnvironment, string>>
  /** Cabeçalhos comuns a toda chamada — é aqui que a credencial entra. */
  headers?: { key: string; value: string }[]
}

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
  /**
   * Ausente = `default`, que é o que toda instalação criada antes disto é. Nada muda
   * para ela, e é isso que permite acrescentar o campo sem migrar documento nenhum.
   */
  environment?: AppEnvironment
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
  /** Sempre resolvido: uma conexão antiga chega como `default`. */
  environment: AppEnvironment
}

// --- agent grant ---------------------------------------------------------------
// The permission itself: which installation, which actions, and which of those
// actions may run without asking. Not listed means not reachable.

export interface AgentAppGrant {
  installationId: string
  // Kept on the grant so a REVOKED or deleted installation still produces an honest
  // refusal naming the App, instead of the action silently disappearing.
  appKey: string
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

/**
 * Um adapter compilado: a função que transforma credencial + seleção em ferramentas.
 *
 * O tipo mora aqui, e não em `grants.ts`, porque cada módulo de App oficial exporta o
 * seu — e um módulo de App não deve precisar importar o resolvedor de grants para
 * declarar o que ele oferece.
 */
export type NativeFactory = (
  ownerId: string,
  config: Record<string, string>,
  /**
   * O contexto da CONEXÃO, para o adapter que precisa dele.
   *
   * Opcional porque quase nenhum precisa: um App de pagamento tem um endereço só. Quem
   * precisa é quem tem simulação e produção — e aí o ambiente não pode vir por um campo
   * de configuração que alguém digita, ele vem da conexão.
   */
  ctx?: { environment: string; installationId: string; agentId?: string | null },
) => import('../agentTools.js').ResolvedTool[]
