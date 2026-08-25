// Manifest validation — the gate every App passes before it can exist.
//
// It is deliberately strict and deliberately DATA-only. A private or community
// manifest arrives from a user, so everything it declares is treated as hostile
// input: no code, no module path, no absolute URL in a route segment, no domain
// outside the declared allow list, no template that could interpolate a credential
// into a URL or a log.
//
// Pure on purpose: no database, no network. Every rule below is a unit test.
import { isValidToolSchema } from '../jsonSchema.js'
import { ACTION_RISKS, APP_AUTH_KINDS, APP_SOURCES, APP_STATUSES } from './types.js'
import type { ActionRisk, AppDefinition, AppSource } from './types.js'

export interface ManifestIssue {
  path: string
  message: string
}

export interface ManifestValidation {
  valid: boolean
  errors: ManifestIssue[]
}

// Keys the product addresses by name: they must be safe in a URL, a tool name and
// a file-less registry lookup.
const KEY_PATTERN = /^[a-z][a-z0-9_]{1,48}$/
const ROUTE_SEGMENT_PATTERN = /^[a-z][a-z0-9-]{1,32}$/
// Semantic-ish: a version has to be comparable and pinnable.
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
// A hostname, never a URL, never a wildcard. The last label must be alphabetic, which
// also refuses an IP literal: an allow list entry has to be a name somebody can read
// and recognise, and internal addresses are refused here as well as at execution time.
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/

const MAX_ACTIONS = 60
const MAX_SURFACES = 12
const MAX_DOMAINS = 20
const MAX_TEMPLATE_CHARS = 8000

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

// Anything that smells like executable content or an escape from the declared
// surface registry. Checked on route segments and on every template.
const FORBIDDEN_IN_TEMPLATE = [/javascript:/i, /data:text\/html/i, /<script/i, /\bfunction\s*\(/, /=>/, /\brequire\s*\(/, /\bimport\s*\(/]

function validateAction(action: unknown, index: number, app: { key: string; source: AppSource; allowedDomains: string[] }, errors: ManifestIssue[]): void {
  const at = `actions[${index}]`
  if (!isRecord(action)) {
    errors.push({ path: at, message: 'ação deve ser um objeto' })
    return
  }
  if (!isText(action.key) || !KEY_PATTERN.test(action.key)) {
    errors.push({ path: `${at}.key`, message: 'key deve ser minúscula, começar com letra e usar apenas letras, números e _' })
  }
  if (!isText(action.name)) errors.push({ path: `${at}.name`, message: 'name é obrigatório' })
  // The description is what the model reasons over; a vague one makes the action
  // unusable in practice, so it is a validation error rather than a warning.
  if (!isText(action.description) || String(action.description).trim().length < 10) {
    errors.push({ path: `${at}.description`, message: 'description precisa explicar quando usar a ação (mínimo 10 caracteres)' })
  }
  if (!ACTION_RISKS.includes(action.risk as ActionRisk)) {
    errors.push({ path: `${at}.risk`, message: `risk deve ser um de: ${ACTION_RISKS.join(', ')}` })
  }
  if (!isValidToolSchema(action.inputSchema)) {
    errors.push({ path: `${at}.inputSchema`, message: 'inputSchema deve ser um JSON Schema de objeto' })
  }

  const execution = action.execution
  if (!isRecord(execution)) {
    errors.push({ path: `${at}.execution`, message: 'execution é obrigatório' })
    return
  }

  if (execution.kind === 'native') {
    // The ONE privilege a system App has: pointing at code compiled into this
    // repository. A user-supplied manifest may never do it.
    if (app.source !== 'system') {
      errors.push({ path: `${at}.execution`, message: 'somente Apps do sistema podem usar adapter nativo' })
    }
    if (!isText(execution.adapter)) errors.push({ path: `${at}.execution.adapter`, message: 'adapter é obrigatório' })
    return
  }

  if (execution.kind !== 'http') {
    errors.push({ path: `${at}.execution.kind`, message: 'execution.kind deve ser http ou native' })
    return
  }

  const method = String(execution.method ?? '')
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    errors.push({ path: `${at}.execution.method`, message: 'método HTTP inválido' })
  }

  const url = String(execution.url ?? '')
  let parsed: URL | null = null
  try {
    parsed = new URL(url)
  } catch {
    errors.push({ path: `${at}.execution.url`, message: 'url inválida' })
  }
  if (parsed) {
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      errors.push({ path: `${at}.execution.url`, message: 'url deve usar http(s)' })
    }
    // The host has to be one the owner was shown before installing. A manifest
    // cannot reach anywhere it did not declare.
    const host = parsed.hostname.toLowerCase()
    const allowed = app.allowedDomains.some((d) => host === d || host.endsWith(`.${d}`))
    if (!allowed) {
      errors.push({ path: `${at}.execution.url`, message: `host ${host} não está em allowedDomains` })
    }
  }

  for (const [field, value] of [
    ['url', url],
    ['bodyTemplate', execution.bodyTemplate],
  ] as const) {
    if (value === null || value === undefined) continue
    const text = String(value)
    if (text.length > MAX_TEMPLATE_CHARS) {
      errors.push({ path: `${at}.execution.${field}`, message: 'template excede o tamanho máximo' })
      continue
    }
    if (FORBIDDEN_IN_TEMPLATE.some((re) => re.test(text))) {
      errors.push({ path: `${at}.execution.${field}`, message: 'template contém conteúdo executável' })
    }
    // A credential belongs in a header injected by the executor, never in a URL
    // that ends up in a log, a redirect or an error message.
    if (field === 'url' && /\{\{\s*(secret|token|api_?key|password|credential)\w*\s*\}\}/i.test(text)) {
      errors.push({ path: `${at}.execution.url`, message: 'credencial não pode ser interpolada na url' })
    }
  }

  const headers = execution.headers
  if (headers !== undefined) {
    if (!Array.isArray(headers)) {
      errors.push({ path: `${at}.execution.headers`, message: 'headers deve ser uma lista' })
    } else {
      for (const [i, header] of headers.entries()) {
        if (!isRecord(header) || !isText(header.key)) {
          errors.push({ path: `${at}.execution.headers[${i}]`, message: 'header inválido' })
        }
      }
    }
  }
}

export function validateAppManifest(input: unknown): ManifestValidation {
  const errors: ManifestIssue[] = []
  if (!isRecord(input)) return { valid: false, errors: [{ path: '', message: 'manifesto deve ser um objeto' }] }

  const app = input as Partial<AppDefinition>

  if (!isText(app.key) || !KEY_PATTERN.test(app.key)) {
    errors.push({ path: 'key', message: 'key deve ser minúscula, começar com letra e usar apenas letras, números e _' })
  }
  if (!isText(app.version) || !VERSION_PATTERN.test(app.version)) {
    errors.push({ path: 'version', message: 'version deve seguir MAJOR.MINOR.PATCH' })
  }
  if (!APP_SOURCES.includes(app.source as AppSource)) {
    errors.push({ path: 'source', message: `source deve ser um de: ${APP_SOURCES.join(', ')}` })
  }
  if (!isText(app.name)) errors.push({ path: 'name', message: 'name é obrigatório' })
  if (!isText(app.description)) errors.push({ path: 'description', message: 'description é obrigatório' })
  if (!APP_STATUSES.includes(app.status as AppDefinition['status'])) {
    errors.push({ path: 'status', message: `status deve ser um de: ${APP_STATUSES.join(', ')}` })
  }
  if (!Array.isArray(app.categories)) errors.push({ path: 'categories', message: 'categories deve ser uma lista' })

  // --- auth -------------------------------------------------------------------
  const auth = app.auth
  if (!isRecord(auth)) {
    errors.push({ path: 'auth', message: 'auth é obrigatório' })
  } else {
    if (!APP_AUTH_KINDS.includes(auth.kind as AppDefinition['auth']['kind'])) {
      errors.push({ path: 'auth.kind', message: `auth.kind deve ser um de: ${APP_AUTH_KINDS.join(', ')}` })
    }
    if (auth.kind === 'oauth2' && app.source !== 'system') {
      // OAuth needs a registered client and a callback compiled into the product.
      errors.push({ path: 'auth.kind', message: 'somente Apps do sistema podem usar oauth2 nesta versão' })
    }
    const fields = auth.fields
    if (fields !== undefined && !Array.isArray(fields)) {
      errors.push({ path: 'auth.fields', message: 'auth.fields deve ser uma lista' })
    } else if (Array.isArray(fields)) {
      for (const [i, field] of fields.entries()) {
        if (!isRecord(field) || !isText(field.key) || !isText(field.label)) {
          errors.push({ path: `auth.fields[${i}]`, message: 'campo de autenticação inválido' })
        }
      }
    }
  }

  // --- domains ----------------------------------------------------------------
  const domains = Array.isArray(app.allowedDomains) ? app.allowedDomains : []
  if (!Array.isArray(app.allowedDomains)) {
    errors.push({ path: 'allowedDomains', message: 'allowedDomains deve ser uma lista' })
  } else if (domains.length > MAX_DOMAINS) {
    errors.push({ path: 'allowedDomains', message: `no máximo ${MAX_DOMAINS} domínios` })
  } else {
    for (const [i, domain] of domains.entries()) {
      const value = String(domain ?? '').toLowerCase()
      if (!DOMAIN_PATTERN.test(value)) {
        errors.push({ path: `allowedDomains[${i}]`, message: 'domínio deve ser um hostname, sem protocolo, porta, caminho ou curinga' })
      }
    }
  }

  /**
   * --- conexão -------------------------------------------------------------------
   *
   * Presente = este App pode ser emprestado como conexão a uma ferramenta do dono. O
   * endereço base passa pela MESMA lista de domínios das ações: sem isso, um manifesto
   * declararia base num host que ele não tem permissão de alcançar, e a ferramenta
   * conectada herdaria essa permissão que ninguém revisou.
   */
  if (app.connection !== undefined && app.connection !== null) {
    if (!isRecord(app.connection)) {
      errors.push({ path: 'connection', message: 'connection deve ser um objeto' })
    } else {
      const perfil = app.connection
      const bases: [string, unknown][] = [['connection.baseUrl', perfil.baseUrl]]
      if (isRecord(perfil.baseUrlByEnvironment)) {
        for (const [env, url] of Object.entries(perfil.baseUrlByEnvironment)) {
          if (!['default', 'paper', 'live'].includes(env)) {
            errors.push({ path: `connection.baseUrlByEnvironment.${env}`, message: 'ambiente desconhecido' })
          }
          bases.push([`connection.baseUrlByEnvironment.${env}`, url])
        }
      } else if (perfil.baseUrlByEnvironment !== undefined && perfil.baseUrlByEnvironment !== null) {
        errors.push({ path: 'connection.baseUrlByEnvironment', message: 'deve ser um objeto por ambiente' })
      }
      for (const [caminho, valor] of bases) {
        const bruto = String(valor ?? '')
        if (!bruto) {
          errors.push({ path: caminho, message: 'informe o endereço base' })
          continue
        }
        // `{{auth.x}}` é resolvido só na execução; para conferir o host, ele vira um
        // marcador que não muda o domínio.
        let host = ''
        try {
          host = new URL(bruto.replace(/\{\{[^}]*\}\}/g, 'x')).hostname.toLowerCase()
        } catch {
          errors.push({ path: caminho, message: 'endereço base inválido' })
          continue
        }
        const domains = Array.isArray(app.allowedDomains) ? app.allowedDomains.map((d) => String(d).toLowerCase()) : []
        if (!domains.some((d) => host === d || host.endsWith(`.${d}`))) {
          errors.push({ path: caminho, message: `host ${host} não está em allowedDomains` })
        }
      }
      if (perfil.headers !== undefined && perfil.headers !== null && !Array.isArray(perfil.headers)) {
        errors.push({ path: 'connection.headers', message: 'headers deve ser uma lista' })
      }
    }
  }

  // --- actions ----------------------------------------------------------------
  const actions = Array.isArray(app.actions) ? app.actions : []
  if (!Array.isArray(app.actions)) {
    errors.push({ path: 'actions', message: 'actions deve ser uma lista' })
  } else if (actions.length > MAX_ACTIONS) {
    errors.push({ path: 'actions', message: `no máximo ${MAX_ACTIONS} ações` })
  } else {
    const seen = new Set<string>()
    actions.forEach((action, index) => {
      validateAction(action, index, { key: String(app.key ?? ''), source: app.source as AppSource, allowedDomains: domains.map((d) => String(d).toLowerCase()) }, errors)
      const key = isRecord(action) ? String(action.key ?? '') : ''
      if (key) {
        if (seen.has(key)) errors.push({ path: `actions[${index}].key`, message: 'key de ação duplicada' })
        seen.add(key)
      }
    })
  }

  // --- surfaces ---------------------------------------------------------------
  const surfaces = Array.isArray(app.surfaces) ? app.surfaces : []
  // `null` means absent: a driver that stores an explicit `undefined` writes null,
  // and a manifest that came back from the database must validate exactly like the
  // one that went in.
  if (app.surfaces !== undefined && app.surfaces !== null && !Array.isArray(app.surfaces)) {
    errors.push({ path: 'surfaces', message: 'surfaces deve ser uma lista' })
  } else if (surfaces.length > MAX_SURFACES) {
    errors.push({ path: 'surfaces', message: `no máximo ${MAX_SURFACES} páginas` })
  } else {
    const seenSurface = new Set<string>()
    surfaces.forEach((surface, index) => {
      const at = `surfaces[${index}]`
      if (!isRecord(surface)) {
        errors.push({ path: at, message: 'surface deve ser um objeto' })
        return
      }
      if (!isText(surface.key) || !KEY_PATTERN.test(surface.key)) {
        errors.push({ path: `${at}.key`, message: 'key inválida' })
      } else {
        if (seenSurface.has(surface.key)) errors.push({ path: `${at}.key`, message: 'key de página duplicada' })
        seenSurface.add(surface.key)
      }
      if (!isText(surface.label)) errors.push({ path: `${at}.label`, message: 'label é obrigatório' })
      // A route segment is an identifier resolved by a compiled registry. Anything
      // that looks like a path, a URL or a traversal is refused outright.
      const segment = String(surface.routeSegment ?? '')
      if (!ROUTE_SEGMENT_PATTERN.test(segment)) {
        errors.push({ path: `${at}.routeSegment`, message: 'routeSegment deve ser um identificador simples (a-z, 0-9, -)' })
      }
      if (surface.kind !== 'native' && surface.kind !== 'declarative') {
        errors.push({ path: `${at}.kind`, message: 'kind deve ser native ou declarative' })
      }
      // Only a system App may claim a native surface: those resolve to components
      // compiled into the frontend.
      if (surface.kind === 'native' && app.source !== 'system') {
        errors.push({ path: `${at}.kind`, message: 'somente Apps do sistema podem declarar página nativa' })
      }
      // Until a safe declarative renderer exists, a user manifest may not add pages
      // at all: its actions still work for agents.
      if (surface.kind === 'declarative' && app.source !== 'system') {
        errors.push({ path: `${at}.kind`, message: 'páginas declarativas ainda não são suportadas para Apps privados/comunitários' })
      }
      if (!['account', 'building', 'floor'].includes(String(surface.scope))) {
        errors.push({ path: `${at}.scope`, message: 'scope deve ser account, building ou floor' })
      }
    })
  }

  // --- sidebar ----------------------------------------------------------------
  if (app.sidebar !== undefined && app.sidebar !== null) {
    if (!isRecord(app.sidebar)) {
      errors.push({ path: 'sidebar', message: 'sidebar deve ser um objeto' })
    } else {
      if (typeof app.sidebar.pinnable !== 'boolean') {
        errors.push({ path: 'sidebar.pinnable', message: 'pinnable deve ser booleano' })
      }
      const def = String(app.sidebar.defaultSurfaceKey ?? '')
      if (!surfaces.some((s) => isRecord(s) && s.key === def)) {
        errors.push({ path: 'sidebar.defaultSurfaceKey', message: 'defaultSurfaceKey precisa existir em surfaces' })
      }
      // Pinning is about pages: an App with none has nothing to pin.
      if (app.sidebar.pinnable === true && surfaces.length === 0) {
        errors.push({ path: 'sidebar.pinnable', message: 'um App sem páginas não pode ser fixado' })
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

export const describeManifestIssues = (errors: ManifestIssue[]): string =>
  errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('; ')

// An importable manifest never carries a credential. Import strips anything that
// is not part of the declared shape, so a crafted file cannot smuggle a field in.
export function sanitizeImportedManifest(input: unknown): { manifest: AppDefinition | null; errors: ManifestIssue[] } {
  if (!isRecord(input)) return { manifest: null, errors: [{ path: '', message: 'manifesto deve ser um objeto' }] }

  const source = input.source === 'community' ? 'community' : 'private'
  const candidate = {
    key: String(input.key ?? ''),
    version: String(input.version ?? ''),
    // An imported manifest is never a system App, whatever it claims.
    source,
    name: String(input.name ?? ''),
    description: String(input.description ?? ''),
    icon: isText(input.icon) ? String(input.icon) : undefined,
    categories: Array.isArray(input.categories) ? input.categories.map((c) => String(c)).slice(0, 8) : [],
    documentationUrl: isText(input.documentationUrl) ? String(input.documentationUrl) : undefined,
    auth: isRecord(input.auth)
      ? {
          kind: input.auth.kind,
          // Field DEFINITIONS travel; values never do.
          fields: Array.isArray(input.auth.fields)
            ? input.auth.fields.filter(isRecord).map((f) => ({
                key: String(f.key ?? ''),
                label: String(f.label ?? ''),
                placeholder: isText(f.placeholder) ? String(f.placeholder) : undefined,
                required: f.required !== false,
                secret: f.secret !== false,
                help: isText(f.help) ? String(f.help) : undefined,
              }))
            : [],
          scopes: Array.isArray(input.auth.scopes) ? input.auth.scopes.map((s) => String(s)) : undefined,
        }
      : { kind: 'none', fields: [] },
    allowedDomains: Array.isArray(input.allowedDomains) ? input.allowedDomains.map((d) => String(d).toLowerCase()) : [],
    supportsMultipleConnections: input.supportsMultipleConnections === true,
    actions: Array.isArray(input.actions)
      ? input.actions.filter(isRecord).map((a) => ({
          key: String(a.key ?? ''),
          name: String(a.name ?? ''),
          description: String(a.description ?? ''),
          risk: a.risk,
          inputSchema: isRecord(a.inputSchema) ? a.inputSchema : {},
          execution: isRecord(a.execution)
            ? {
                kind: 'http',
                method: a.execution.method,
                url: String(a.execution.url ?? ''),
                headers: Array.isArray(a.execution.headers)
                  ? a.execution.headers.filter(isRecord).map((h) => ({ key: String(h.key ?? ''), value: String(h.value ?? '') }))
                  : undefined,
                bodyTemplate: isText(a.execution.bodyTemplate) ? String(a.execution.bodyTemplate) : null,
              }
            : { kind: 'http', method: 'GET', url: '' },
          resourceFields: Array.isArray(a.resourceFields)
            ? a.resourceFields.filter(isRecord).map((f) => ({
                key: String(f.key ?? ''),
                label: String(f.label ?? ''),
                placeholder: isText(f.placeholder) ? String(f.placeholder) : undefined,
                required: f.required === true,
                help: isText(f.help) ? String(f.help) : undefined,
              }))
            : undefined,
          timeoutMs: typeof a.timeoutMs === 'number' ? a.timeoutMs : undefined,
          maxResponseChars: typeof a.maxResponseChars === 'number' ? a.maxResponseChars : undefined,
          maxCallsPerRun: typeof a.maxCallsPerRun === 'number' ? a.maxCallsPerRun : undefined,
        }))
      : [],
    // O perfil de conexão atravessa a importação: sem ele, um App importado deixaria de
    // poder ser emprestado a uma ferramenta, e a validação acima já conferiu o host.
    connection: isRecord(input.connection)
      ? {
          baseUrl: String(input.connection.baseUrl ?? ''),
          baseUrlByEnvironment: isRecord(input.connection.baseUrlByEnvironment)
            ? Object.fromEntries(Object.entries(input.connection.baseUrlByEnvironment).map(([k, v]) => [k, String(v ?? '')]))
            : undefined,
          headers: Array.isArray(input.connection.headers)
            ? input.connection.headers
                .filter(isRecord)
                .map((h) => ({ key: String(h.key ?? ''), value: String(h.value ?? '') }))
                .filter((h) => h.key)
            : undefined,
        }
      : undefined,
    // A page cannot come in through an import until a safe renderer exists.
    surfaces: undefined,
    sidebar: undefined,
    // Nothing published by importing: it starts as a draft in the importer's account.
    status: 'draft',
  } as unknown as AppDefinition

  const validation = validateAppManifest(candidate)
  return { manifest: validation.valid ? candidate : null, errors: validation.errors }
}

// What may leave the API for an export. Strips everything account-specific and, by
// construction, everything secret: an export is a manifest, never a connection.
export function exportableManifest(app: AppDefinition): Omit<AppDefinition, 'status'> & { status: 'draft' } {
  return {
    key: app.key,
    version: app.version,
    source: app.source === 'system' ? 'system' : 'private',
    name: app.name,
    description: app.description,
    icon: app.icon,
    categories: [...(app.categories ?? [])],
    documentationUrl: app.documentationUrl,
    auth: {
      kind: app.auth.kind,
      // Definitions only — no value ever existed in the manifest to begin with.
      fields: (app.auth.fields ?? []).map((f) => ({ ...f })),
      scopes: app.auth.scopes ? [...app.auth.scopes] : undefined,
      documentationUrl: app.auth.documentationUrl,
    },
    allowedDomains: [...(app.allowedDomains ?? [])],
    supportsMultipleConnections: app.supportsMultipleConnections,
    actions: (app.actions ?? []).map((a) => ({ ...a })),
    surfaces: undefined,
    sidebar: undefined,
    dataAccess: app.dataAccess ? [...app.dataAccess] : undefined,
    storageNote: app.storageNote,
    disconnectNote: app.disconnectNote,
    providerCostNote: app.providerCostNote,
    status: 'draft',
  }
}
