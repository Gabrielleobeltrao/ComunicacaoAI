// A FACHADA do catálogo oficial.
//
// Os manifestos moraram aqui até virarem módulos em `official/<app>/`. Este arquivo
// continua sendo a porta de entrada — `getApp`, `SYSTEM_APPS`, as chaves legadas e as
// funções de migração — porque metade do sistema importa daqui, e mover imports não
// era o objetivo da divisão.
//
// O que mudou: a lista de Apps e o mapa de adapters passaram a ser DERIVADOS dos
// módulos, em vez de escritos à mão em dois arquivos diferentes. Ver official/index.ts.
//
// Action keys são os nomes de ferramenta que o modelo já conhece. Renomeá-las quebraria
// todo prompt, rotina e teste escrito contra elas, então elas ficam.
import { OFFICIAL_APPS } from './official/index.js'
import type { AppActivation, AppDefinition, AppActionDefinition } from './types.js'
import { hasStreamAdapter } from '../streams/adapters.js'

// A lista de sempre, agora montada a partir dos módulos.
export const SYSTEM_APPS: AppDefinition[] = OFFICIAL_APPS

// The legacy catalog keys an agent document may still carry. They resolve to the
// same App, so an agent configured before this change keeps working.
export const LEGACY_APP_KEYS: Record<string, string> = {
  google_calendar: 'google',
  google_sheets: 'google',
}

export const resolveAppKey = (key: string): string => LEGACY_APP_KEYS[key] ?? key

export function getApp(key: string): AppDefinition | undefined {
  const resolved = resolveAppKey(key)
  return SYSTEM_APPS.find((app) => app.key === resolved)
}

export function getAppAction(appKey: string, actionKey: string): AppActionDefinition | undefined {
  return getApp(appKey)?.actions.find((a) => a.key === actionKey)
}

// Which actions a legacy `builtinTools` entry stood for. Enabling `google_calendar`
// used to mean "all three calendar actions", so migrating it must grant exactly
// those and nothing more.
export const LEGACY_ACTION_KEYS: Record<string, string[]> = {
  google_calendar: ['google_agenda_verificar_disponibilidade', 'google_agenda_listar_eventos', 'google_agenda_criar_evento'],
  google_sheets: ['google_sheets_registrar'],
  slack: ['slack_notificar'],
  mercadopago: ['mercadopago_criar_link_pagamento'],
  rdstation: ['rdstation_registrar_contato'],
  hubspot: ['hubspot_registrar_contato'],
  stripe: ['stripe_criar_link_pagamento'],
  nuvemshop: ['nuvemshop_status_pedido'],
}

// Is this key of a legacy `builtinTools` entry a credential? Used to mask it on the
// way out of the API while old documents still carry one.
export const isSecretLegacyConfigKey = (appKey: string, configKey: string): boolean =>
  (getApp(appKey)?.auth.fields ?? []).some((f) => f.key === configKey && f.secret)

// Which config keys of a legacy entry were CREDENTIALS (they move to the encrypted
// installation) and which were non-secret resource selection (they stay on the
// agent as `resourceConfig`).
export function splitLegacyConfig(legacyKey: string, config: Record<string, string>): {
  credential: Record<string, string>
  resource: Record<string, string>
} {
  const app = getApp(legacyKey)
  const secretKeys = new Set((app?.auth.fields ?? []).map((f) => f.key))
  const credential: Record<string, string> = {}
  const resource: Record<string, string> = {}
  for (const [key, value] of Object.entries(config ?? {})) {
    if (secretKeys.has(key)) credential[key] = value
    else resource[key] = value
  }
  return { credential, resource }
}

// The catalog DTO. Everything an owner must see BEFORE connecting (plan §6), and
// nothing that could carry a credential or point at internal code.
export function appCatalogPublic(app: AppDefinition) {
  return {
    key: app.key,
    version: app.version,
    source: app.source,
    name: app.name,
    description: app.description,
    icon: app.icon ?? null,
    categories: app.categories,
    documentationUrl: app.documentationUrl ?? null,
    status: app.status,
    auth: {
      kind: app.auth.kind,
      // Field definitions, never values.
      fields: (app.auth.fields ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        placeholder: f.placeholder ?? null,
        required: f.required,
        secret: f.secret,
        help: f.help ?? null,
      })),
      scopes: app.auth.scopes ?? [],
      documentationUrl: app.auth.documentationUrl ?? null,
    },
    allowedDomains: app.allowedDomains,
    supportsMultipleConnections: app.supportsMultipleConnections,
    actions: app.actions.map((a) => ({
      key: a.key,
      name: a.name,
      description: a.description,
      risk: a.risk,
      inputSchema: a.inputSchema,
      resourceFields: a.resourceFields ?? [],
    })),
    // `routeSegment`/`kind` describe navigation, never a module path.
    surfaces: (app.surfaces ?? []).map((s) => ({
      key: s.key,
      label: s.label,
      description: s.description,
      icon: s.icon ?? null,
      scope: s.scope,
      routeSegment: s.routeSegment,
    })),
    pinnable: app.sidebar?.pinnable ?? false,
    defaultSurfaceKey: app.sidebar?.defaultSurfaceKey ?? null,
    dataAccess: app.dataAccess ?? [],
    storageNote: app.storageNote ?? null,
    disconnectNote: app.disconnectNote ?? null,
    providerCostNote: app.providerCostNote ?? null,
    // An App with a write/high-risk action can only run it autonomously when the
    // owner authorises that action explicitly.
    supportsAutonomous: app.actions.some((a) => a.risk === 'read'),
    requiresAuth: app.auth.kind !== 'none',
    // How the App becomes active, and where its real flow lives when the generic
    // form cannot produce a valid connection.
    activation: activationOf(app),
    activationRoute: app.activationRoute ?? null,
  }
}

// The activation strategy, with a compatible default for a manifest written before
// the field existed.
export function activationOf(app: AppDefinition): AppActivation {
  if (app.activation) return app.activation
  if (app.auth.kind === 'oauth2') return 'oauth'
  return (app.auth.fields ?? []).length === 0 ? 'instant' : 'credentials'
}

// Can the generic "connect with these fields" form create this App's installation?
export const acceptsGenericConnect = (app: AppDefinition): boolean =>
  activationOf(app) === 'instant' || activationOf(app) === 'credentials'
