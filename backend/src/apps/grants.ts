// Turning a grant into something the model can call.
//
// The rule the whole file exists to enforce: an agent reaches an App ONLY through a
// grant, the grant names the installation and the exact actions, the installation is
// resolved with `{ ownerId, _id }`, and the credential is injected here — never in an
// argument the model can see, and never read from the agent document.
//
// When anything is missing (installation revoked, action not granted, write not
// authorised) the model gets a STRUCTURED refusal rather than a missing tool, so it
// tells the user instead of inventing an outcome.
import { ObjectId } from 'mongodb'
import { db } from '../db.js'
import type { Agent } from '../agents.js'
import type { ResolvedTool } from '../agentTools.js'
import { missingCapability } from '../agentTools.js'
import { executeToolCall } from '../toolExecution.js'
import type { ExecutableTool } from '../toolExecution.js'
import { googleCalendarTools, googleSheetsTools } from '../googleTools.js'
import { hubspotTools, mercadoPagoTools, nuvemshopTools, rdStationTools, slackTools, stripeTools } from '../providerApps.js'
import { getApp } from './registry.js'
import type { AppDefinition, AppActionDefinition, AppInstallation, AgentAppGrant } from './types.js'
import { decryptInstallationConfig, getInstallation, isInstallationUsable } from './installations.js'

// The compiled adapters a SYSTEM App may point at. A manifest cannot add an entry
// here: this map is the allow list, and `execution.adapter` only selects from it.
type NativeFactory = (ownerId: string, config: Record<string, string>) => ResolvedTool[]
const NATIVE_FACTORIES: Record<string, NativeFactory[]> = {
  google: [googleCalendarTools, googleSheetsTools],
  slack: [slackTools],
  mercadopago: [mercadoPagoTools],
  rdstation: [rdStationTools],
  hubspot: [hubspotTools],
  stripe: [stripeTools],
  nuvemshop: [nuvemshopTools],
}

// Safe telemetry (plan §13): what ran, whether it worked and how long it took.
// Never an argument, never a response body, never a credential.
export interface AppActionEvent {
  _id: ObjectId
  ownerId: string
  agentId: ObjectId | null
  appKey: string
  actionKey: string
  installationId: ObjectId
  ok: boolean
  status: 'executed' | 'refused'
  durationMs: number
  createdAt: Date
}
const appActionEvents = db.collection<AppActionEvent>('app_action_events')

export async function ensureAppActionIndexes(): Promise<void> {
  await appActionEvents.createIndex({ ownerId: 1, createdAt: -1 })
  await appActionEvents.createIndex({ ownerId: 1, appKey: 1, createdAt: -1 })
}

async function recordActionEvent(event: Omit<AppActionEvent, '_id' | 'createdAt'>): Promise<void> {
  try {
    await appActionEvents.insertOne({ ...event, _id: new ObjectId(), createdAt: new Date() })
  } catch {
    // Telemetry must never break the action the owner asked for.
  }
}

// An installed version is pinned. A manifest whose MAJOR moved changed the meaning
// of its actions or its permissions, so it needs the owner to review, not a silent
// upgrade (plan §10).
export const isVersionCompatible = (installed: string, current: string): boolean =>
  String(installed).split('.')[0] === String(current).split('.')[0]

// A tool that exists only to refuse, and to say why. The model sees the action, so
// it can report the limitation instead of pretending the App is not there.
function refusalTool(action: { key: string; description: string }, reason: string, detail?: string): ResolvedTool {
  return {
    name: action.key,
    description: action.description,
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
    run: async () => missingCapability(action.key, reason, detail),
  }
}

const interpolate = (template: string, auth: Record<string, string>, resource: Record<string, string>): string =>
  template
    .replace(/\{\{\s*auth\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => auth[key] ?? '')
    .replace(/\{\{\s*resource\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => resource[key] ?? '')

// A declarative action becomes an ExecutableTool and runs through the SAME executor
// as a Custom Tool: SSRF guard, domain allow list, timeout, response cap, masking.
function declarativeTool(
  app: AppDefinition,
  action: AppActionDefinition,
  auth: Record<string, string>,
  resource: Record<string, string>,
  autonomousWrite: boolean,
): ResolvedTool {
  const execution = action.execution as Extract<AppActionDefinition['execution'], { kind: 'http' }>
  const executable: ExecutableTool = {
    name: action.key,
    description: action.description,
    method: execution.method,
    url: interpolate(execution.url, auth, resource),
    headers: (execution.headers ?? []).map((h) => ({ key: h.key, value: interpolate(h.value, auth, resource) })),
    inputSchema: action.inputSchema,
    bodyTemplate: execution.bodyTemplate ? interpolate(execution.bodyTemplate, auth, resource) : null,
    auth: { kind: 'none' },
    timeoutMs: action.timeoutMs ?? 8_000,
    maxResponseChars: action.maxResponseChars ?? 4_000,
    allowedDomains: app.allowedDomains,
    maxCallsPerRun: action.maxCallsPerRun ?? 5,
    // The owner authorises a write per ACTION, on the grant — the manifest never
    // grants itself permission to act.
    allowAutonomousExecution: autonomousWrite,
    enabled: true,
  } as ExecutableTool
  let callsSoFar = 0
  return {
    name: action.key,
    description: action.description,
    inputSchema: action.inputSchema,
    run: async (args) => {
      // Every header of an App action may carry a credential, whatever it is called.
      const outcome = await executeToolCall(executable, args, { callsSoFar, autonomous: true, allHeadersAreSecret: true })
      callsSoFar++
      return { ok: outcome.ok, result: outcome.result }
    },
  }
}

// Resolve ONE grant into the tools it authorises.
export async function resolveGrant(
  ownerId: string,
  grant: AgentAppGrant,
  options: { agentId?: ObjectId | null } = {},
): Promise<ResolvedTool[]> {
  const app = getApp(grant.appKey)
  if (!app) return []

  const granted = app.actions.filter((a) => (grant.actionKeys ?? []).includes(a.key))
  if (granted.length === 0) return []

  const id = ObjectId.isValid(grant.installationId) ? new ObjectId(grant.installationId) : null
  // Owner scoping is in the query: an id from another account resolves to nothing.
  const installation = id ? await getInstallation(ownerId, id) : null

  if (!installation) {
    return granted.map((a) => refusalTool(a, 'conexao_ausente', `Conecte o App ${app.name} em Apps e autorize este agente.`))
  }
  if (!isInstallationUsable(installation)) {
    const reason = installation.status === 'needs_reauth' ? 'conexao_expirada' : 'conexao_revogada'
    return granted.map((a) => refusalTool(a, reason, `A conexão "${installation.name}" precisa ser reconectada em Apps.`))
  }
  if (!isVersionCompatible(installation.appVersion, app.version)) {
    return granted.map((a) =>
      refusalTool(a, 'versao_incompativel', `A conexão "${installation.name}" precisa ser revisada em Apps antes de voltar a ser usada.`),
    )
  }

  const auth = decryptInstallationConfig(installation)
  const resource = grant.resourceConfig ?? {}
  const autonomous = new Set(grant.autonomousWriteActionKeys ?? [])

  const tools: ResolvedTool[] = []
  for (const action of granted) {
    const allowedToAct = action.risk === 'read' || autonomous.has(action.key)
    const built = buildAction(app, action, ownerId, auth, resource, allowedToAct)
    if (!built) continue
    tools.push(instrument(built, { ownerId, agentId: options.agentId ?? null, appKey: app.key, actionKey: action.key, installationId: installation._id }))
  }
  return tools
}

function buildAction(
  app: AppDefinition,
  action: AppActionDefinition,
  ownerId: string,
  auth: Record<string, string>,
  resource: Record<string, string>,
  allowedToAct: boolean,
): ResolvedTool | null {
  if (action.execution.kind === 'http') {
    return declarativeTool(app, action, auth, resource, allowedToAct)
  }
  // Native: the credential and the non-secret selection are merged HERE and handed
  // to the compiled adapter. The model never sees either.
  const adapter = action.execution.adapter
  const factories = NATIVE_FACTORIES[app.key] ?? []
  const config = { ...auth, ...resource }
  for (const factory of factories) {
    const tool = factory(ownerId, config).find((t) => t.name === adapter)
    if (!tool) continue
    if (!allowedToAct) {
      return refusalTool(
        action,
        'autorizacao_necessaria',
        `Esta ação altera dados. Autorize "${action.name}" para uso autônomo nas permissões do agente.`,
      )
    }
    return tool
  }
  // The adapter refused to build (missing resource selection, e.g. no spreadsheet).
  return refusalTool(action, 'configuracao_incompleta', `Complete a configuração de ${app.name} nas permissões deste agente.`)
}

// Wrap a tool so every call leaves a safe trace.
function instrument(
  tool: ResolvedTool,
  meta: { ownerId: string; agentId: ObjectId | null; appKey: string; actionKey: string; installationId: ObjectId },
): ResolvedTool {
  return {
    ...tool,
    run: async (args) => {
      const started = Date.now()
      const outcome = await tool.run(args)
      await recordActionEvent({
        ownerId: meta.ownerId,
        agentId: meta.agentId,
        appKey: meta.appKey,
        actionKey: meta.actionKey,
        installationId: meta.installationId,
        ok: outcome.ok,
        // A refusal is not a failed call to somebody's API — it never left here.
        status: outcome.result.includes('"capability_unavailable"') ? 'refused' : 'executed',
        durationMs: Date.now() - started,
        createdAt: new Date(),
      } as Omit<AppActionEvent, '_id' | 'createdAt'>)
      return outcome
    },
  }
}

export async function resolveAppGrantTools(agent: Agent, ownerId: string): Promise<ResolvedTool[]> {
  const grants = agent.appGrants ?? []
  if (grants.length === 0) return []
  const resolved = await Promise.all(grants.map((grant) => resolveGrant(ownerId, grant, { agentId: agent._id })))
  return resolved.flat()
}
