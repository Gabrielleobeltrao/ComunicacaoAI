import 'dotenv/config'
import { createTool, deleteTool, getTool, listTools, toPublicTool, ToolValidationError, UNSAFE_METHODS, updateTool } from './tools.js'
import { executeToolCall } from './toolExecution.js'
import { MASKED_HEADER_VALUE, pullToolFromAgents, toPublicAgent } from './agents.js'
import { readiness, startEmbeddedEngine, stopEmbeddedEngine } from './automations/engine.js'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import cors from 'cors'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import { ObjectId } from 'mongodb'
import type { WithId } from 'mongodb'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { Server } from 'socket.io'
import {
  CONVERSATION_PERSISTENCE_TYPES,
  createAgent,
  DEFAULT_HISTORY_LIMIT,
  deleteAgent,
  getAgentById,
  GUARDRAIL_MODES,
  LANGUAGES,
  listAgents,
  MAX_DAILY_MESSAGE_LIMIT,
  MAX_TOOL_PARAMS,
  MAX_TOOLS,
  MEMORY_TYPES,
  parseAgentModelFields,
  RESPONSE_DETAILS,
  RESPONSE_TONES,
  updateAgent,
} from './agents.js'
import { AGENT_PRESET_SPECS } from './agentPresets.js'
import type {
  Agent,
  AgentBuiltinTool,
  AgentTool,
  AgentToolHeader,
  AgentToolParam,
  ConversationPersistence,
  GuardrailMode,
  Language,
  MemoryType,
  ResponseDetail,
  ResponseTone,
} from './agents.js'
import { auth } from './auth.js'
import {
  getActiveAgentId,
  getHumanHandoff,
  getLinkedVisitorProfileId,
  getConversationMemory,
  getStructuredMemory,
  getStructuredOutputData,
  linkVisitorProfile,
  setActiveAgentId,
  setConversationMemory,
  setHumanHandoff,
  setStructuredMemory,
  setStructuredOutputData,
} from './conversationMemory.js'
import { createSector, deleteSector, enforceSingleMembership, getSectorById, listSectors, normalizeSectorMode, sectorIsExecutable, sectorReadiness, SECTOR_MODES, updateSector } from './sectors.js'
import { accessConfigOf, validateAccessConfig } from './sectorAccess.js'
import type { SectorStage, SectorTeamFields } from './sectors.js'
import type { Sector, SectorMember, SectorMode, SectorTransition } from './sectors.js'
import { assignAgentToSector } from './sectorMembership.js'
import { ensureDefaultOffice } from './offices.js'
import { getFloor, listFloors } from './floors.js'
import { runMigrations } from './migrate.js'
import { ensureConversationTurnsVectorIndex, recordTurn, searchRelevantTurns } from './conversationTurns.js'
import { mongoClient } from './db.js'
import { extractTextFromFile } from './fileExtraction.js'
import {
  createDocument,
  retrieveContext,
  deleteAllForAgent,
  deleteAllForSector,
  backfillKnowledgeOwners,
  ensureKnowledgeIndexes,
  deleteDocument,
  ensureVectorIndex,
  getDocument,
  listDocuments,
  searchKnowledge,
  updateDocument,
} from './knowledge.js'
import {
  auxiliaryModel,
  checkGuardrail,
  extractIdentity,
  extractStructuredOutput,
  generateAgentReply,
  listModelsForProvider,
  planStageTransition,
  planSectorResponse,
  PROVIDER_IDS,
  PROVIDER_INFO,
  updateConversationMemory,
  updateStructuredMemory,
} from './llm.js'
import type { ChatTurn, Provider } from './llm.js'
import type { RouterOption, StageTransitionOption } from './systemPrompt.js'
import { aggregateSectorDecisions, listSectorDecisionsForConversation, logSectorDecision } from './sectorDecisions.js'
import {
  buildClarificationInstruction,
  buildIdentityCaptureInstruction,
  buildLanguageInstruction,
  buildPipelineStageObjective,
  buildProactivityInstruction,
  buildResponseStyleInstruction,
  buildSectorObjective,
  formatStructuredMemory,
  GUARDRAIL_REFUSAL_MESSAGE,
  GUARDRAIL_SCOPE_INSTRUCTION,
  HANDOFF_INSTRUCTION,
  HANDOFF_MARKER,
} from './systemPrompt.js'
import {
  clearProviderApiKey,
  getMonthlyTokenCap,
  getProviderApiKey,
  getProviderKeyStatus,
  setMonthlyTokenCap,
  setProviderApiKey,
} from './userSettings.js'
import { ensureTokenUsageIndexes, getMonthlyTokens, getUsageSummary, recordReplyUsage, settlePendingCharges } from './tokenUsage.js'
import { backfillAgentEventAttempts, ensureAgentEventIndexes, recordAgentEventSafe, telemetrySince } from './agentEvents.js'
import { agentReadiness, callerPolicyFromLegacy, sanitizeCollaborationRefs, triggerStates } from './agentReadiness.js'
import { collaboratorContext, collaboratorCountFor } from './collaboration.js'
import type { CollaboratorContext } from './collaboration.js'
import type { AgentWiring } from './agentReadiness.js'
import { listRoutines } from './automations/routine.js'
import { liveWebhookCountByAgent } from './automations/webhookTriggers.js'
import { listActivePublished } from './automations/repository.js'
import { sentDeliveriesByAgent } from './connections/repository.js'
import { sectorKnowledgeRouter } from './routes/sectorKnowledgeRoutes.js'
import { sectorExecutionRouter } from './routes/sectorExecutionRoutes.js'
import type { KnowledgeOwner } from './knowledge.js'
import { availableMetricKeys, composeAgentStats, getAgentEventMetricsBatch, periodSince, PERIODS, resolveMetricKey } from './agentMetrics.js'
import type { Period } from './agentMetrics.js'
import { listToolCalls, logToolCalls } from './toolCallLog.js'
import { deleteIntegration } from './integrations.js'
import { buildGoogleAuthUrl, connectGoogle, getGoogleStatus, googleConfigured } from './googleCalendar.js'
import { builtinAppsCatalog, getBuiltinApp, resolveAgentTools } from './builtinTools.js'
import { rootContext } from './delegation.js'
import { productionDelegationDeps, resolveToolsWithDelegation } from './delegationWiring.js'
import { ensureDelegationIndexes, succeededDelegationsByCaller } from './delegationLog.js'
import {
  computeIdentityKey,
  findVisitorProfile,
  getVisitorProfile,
  setVisitorProfileMemory,
  setVisitorProfileStructuredMemory,
  setVisitorProfileStructuredOutputData,
  upsertVisitorProfile,
} from './visitorProfiles.js'
import type { Widget, WidgetMessage, WidgetPosition } from './widgets.js'
import {
  addMessage,
  addOwnerReply,
  countVisitorMessagesSince,
  createWhatsAppChannel,
  createWidget,
  deleteWhatsAppChannel,
  deleteWidget,
  getAgentStats,
  getAgentStatsBatch,
  getConversationMessages,
  getOwnerStats,
  getWidgetById,
  getWidgetByPublicKey,
  inboundAlreadySeen,
  listConversationsForOwner,
  listMessages,
  listWhatsAppChannels,
  listWidgets,
  setWidgetAvatar,
  updateWhatsAppChannel,
  updateWidget,
} from './widgets.js'
import type { InboundMediaRef } from './whatsapp.js'
import {
  authenticateWhatsAppInbound,
  fetchWhatsAppMedia,
  getWhatsAppAdapter,
  sendWhatsAppText,
  verifyWhatsAppChallenge,
  whatsAppUsesChallenge,
  whatsappProvidersCatalog,
} from './whatsapp.js'
import { encrypt } from './crypto.js'
import { clientUrl, config, validateConfig } from './config.js'
import { buildingRouter } from './routes/buildingRoutes.js'
import { floorRouter } from './routes/floorRoutes.js'
import { automationRouter } from './routes/automationRoutes.js'
import { runRouter } from './routes/runRoutes.js'
import { executionRouter } from './routes/executionRoutes.js'
import { ensureExecutionIndexes } from './automations/executionCenter.js'
import { logRouter } from './routes/logRoutes.js'
import { auditEntity, auditRequests } from './routes/auditMiddleware.js'
import { ensureAuditIndexes } from './audit.js'
import { agentRoutineRouter } from './routes/agentRoutineRoutes.js'
import { connectionRouter } from './routes/connectionRoutes.js'
import { appCatalogRouter, navigationPreferencesRouter } from './routes/appRoutes.js'
import { privateAppRouter } from './routes/privateAppRoutes.js'
import { appInstallationRouter } from './routes/appInstallationRoutes.js'
import { appGrantRouter } from './routes/appGrantRoutes.js'
import { ensureGoogleInstallation, revokeGoogleInstallation } from './apps/migration.js'
import { webhookRouter } from './routes/webhookRoutes.js'

const app = express()
// Behind the Coolify reverse proxy in production: trust exactly the first proxy
// hop so req.protocol/req.secure and client IPs reflect the X-Forwarded-* headers
// the proxy sets, without blindly trusting an arbitrary forwarded chain.
if (config.isProduction) app.set('trust proxy', 1)
const port = config.port
// The backend's own public base URL, used to build inbound webhook URLs the
// owner pastes into their WhatsApp provider. Set PUBLIC_URL in production.
const publicUrl = config.publicUrl
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })
const uploadAvatar = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })
const AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

app.use(
  cors((req, callback) => {
    // Public widget endpoints are fetched by widget-loader.js from arbitrary
    // customer domains, so they need to allow any origin. They don't use
    // cookies (no requireAuth), so credentials stay off for that reflection.
    const isPublicWidgetRoute = req.path.startsWith('/api/public/')
    // Private routes: exact allowlist match (config.clientOrigins) with cookies.
    callback(null, isPublicWidgetRoute ? { origin: true, credentials: false } : { origin: config.clientOrigins, credentials: true })
  }),
)

app.all('/api/auth/*splat', toNodeHandler(auth))

// Keep the raw body around so the WhatsApp webhook can verify Meta's signature.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      ;(req as express.Request & { rawBody?: Buffer }).rawBody = buf
    },
  }),
)
// Twilio posts its webhooks as application/x-www-form-urlencoded.
app.use(express.urlencoded({ extended: false }))

// Every change to the account is recorded ONCE, here: the middleware sees the
// request line and the response status, never the body. It also stamps the request
// id that correlates whatever a single request produced.
app.use(auditRequests)

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: config.clientOrigins, credentials: true },
})

io.on('connection', (socket) => {
  socket.on('join-conversation', ({ conversationId }: { conversationId?: string }) => {
    if (typeof conversationId === 'string') {
      socket.join(`conversation:${conversationId}`)
    }
  })

  socket.on('leave-conversation', ({ conversationId }: { conversationId?: string }) => {
    if (typeof conversationId === 'string') {
      socket.leave(`conversation:${conversationId}`)
    }
  })

  socket.on('join-owner', async () => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(socket.handshake.headers) })
    if (session) {
      socket.join(`owner:${session.user.id}`)
    }
  })
})

function broadcastMessage(message: WidgetMessage, ownerId: string) {
  io.to(`conversation:${message.conversationId}`).emit('message', message)
  io.to(`owner:${ownerId}`).emit('conversations-updated')
}

// Liveness: the process is up. Used by the container HEALTHCHECK / orchestrator.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Readiness: this instance can do its whole job — MongoDB answers a ping AND the
// automation engine is running here (when it is meant to be). A backend that serves
// HTTP with a dead engine accepts routines it will never execute, so it must not
// report ready. With EMBEDDED_WORKER=false the engine lives in its own process and
// readiness only covers the database. 503 otherwise; never leaks any data.
app.get('/api/ready', async (_req, res) => {
  const mongoOk = await mongoClient
    .db()
    .command({ ping: 1 })
    .then(
      () => true,
      () => false,
    )
  const { code, body } = readiness(mongoOk)
  res.status(code).json(body)
})

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  res.locals.userId = session.user.id
  next()
}

// Floor-scoping helpers (UX reorg). Validate a client-sent floorId for ownership;
// never trust it blindly. Legacy callers omit it → undefined (all) / default office.
async function scopedFloorId(ownerId: string, raw: unknown): Promise<ObjectId | undefined> {
  if (typeof raw === 'string' && ObjectId.isValid(raw)) {
    const floor = await getFloor(ownerId, new ObjectId(raw))
    if (floor) return floor._id
  }
  return undefined
}
async function resolveFloorOffice(ownerId: string, raw: unknown): Promise<ObjectId> {
  const scoped = await scopedFloorId(ownerId, raw)
  return scoped ?? (await ensureDefaultOffice(ownerId))._id
}

// AI operational-building pivot — Building + Floors domain (additive; the
// legacy /api/offices flow keeps working). Ownership enforced via requireAuth.
app.use('/api/building', requireAuth, buildingRouter)
app.use('/api/floors', requireAuth, floorRouter)
app.use('/api/automations', requireAuth, automationRouter)
app.use('/api/runs', requireAuth, runRouter)
// Central de execuções: one owner-scoped read model over scheduled work, armed
// triggers, work in flight and history. Read-only — it starts nothing.
app.use('/api/executions', requireAuth, executionRouter)
// Logs e auditoria: read-only timelines (executions + changes). No write route
// exists here on purpose — an audit trail that can be edited is not one.
app.use('/api/logs', requireAuth, logRouter)
// Agent routines + history (agent-owned scheduled automations). Sub-paths that this
// router doesn't handle fall through to the inline /api/agents/:agentId routes below.
app.use('/api/agents/:agentId', requireAuth, agentRoutineRouter)
// Shared sector knowledge (same store as agent knowledge). Non-matching sub-paths
// fall through to the inline /api/sectors/:sectorId routes below.
app.use('/api/sectors/:sectorId', requireAuth, sectorKnowledgeRouter)
app.use('/api/sectors/:sectorId', requireAuth, sectorExecutionRouter)
app.use('/api/connections', requireAuth, connectionRouter)
// Apps: the catalog, the owner's installations and each agent's grants.
app.use('/api/apps', requireAuth, appCatalogRouter)
app.use('/api/me', requireAuth, navigationPreferencesRouter)
app.use('/api/private-apps', requireAuth, privateAppRouter)
app.use('/api/app-installations', requireAuth, appInstallationRouter)
app.use('/api/agents/:agentId', requireAuth, appGrantRouter)
// PUBLIC (no requireAuth): authenticated by public key + HMAC signature.
app.use('/api/hooks', webhookRouter)

app.get('/api/providers', requireAuth, async (_req, res) => {
  const results = await Promise.all(
    PROVIDER_INFO.map(async (provider) => {
      const apiKey = await getProviderApiKey(res.locals.userId, provider.id)
      const models = await listModelsForProvider(provider.id, apiKey)
      return { id: provider.id, label: provider.label, models }
    }),
  )
  res.json(results)
})

app.get('/api/settings', requireAuth, async (_req, res) => {
  const [status, monthlyTokenCap] = await Promise.all([
    getProviderKeyStatus(res.locals.userId),
    getMonthlyTokenCap(res.locals.userId),
  ])
  res.json({ ...status, monthlyTokenCap })
})

const MAX_MONTHLY_TOKEN_CAP = 1_000_000_000

app.put('/api/settings/monthly-token-cap', requireAuth, async (req, res) => {
  const { cap } = req.body ?? {}
  if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 0 || cap > MAX_MONTHLY_TOKEN_CAP) {
    res.status(400).json({ error: `cap must be an integer between 0 and ${MAX_MONTHLY_TOKEN_CAP}` })
    return
  }
  await setMonthlyTokenCap(res.locals.userId, cap)
  res.json({ monthlyTokenCap: cap })
})

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDER_IDS as string[]).includes(value)
}

const MAX_HISTORY_LIMIT = 30

function isValidHistoryLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_HISTORY_LIMIT
}

function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && (MEMORY_TYPES as string[]).includes(value)
}

const MAX_IDENTITY_FIELDS = 5

function isValidIdentityFields(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_IDENTITY_FIELDS &&
    value.every((field) => typeof field === 'string' && field.trim().length > 0)
  )
}

function isConversationPersistence(value: unknown): value is ConversationPersistence {
  return typeof value === 'string' && (CONVERSATION_PERSISTENCE_TYPES as string[]).includes(value)
}

function isGuardrailMode(value: unknown): value is GuardrailMode {
  return typeof value === 'string' && (GUARDRAIL_MODES as string[]).includes(value)
}

const MAX_STRUCTURED_OUTPUT_FIELDS = 10

function isValidStructuredOutputFields(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_STRUCTURED_OUTPUT_FIELDS &&
    value.every((field) => typeof field === 'string' && field.trim().length > 0)
  )
}

function isValidWebhookUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// Validate + normalize the agent's custom HTTP tools from the request body.
// Returns { tools: undefined } when the field wasn't sent (leave as-is).
function parseTools(raw: unknown, existing: AgentTool[] = []): { tools?: AgentTool[]; error?: string } {
  if (raw === undefined) return { tools: undefined }
  if (!Array.isArray(raw)) return { error: 'tools must be a list' }
  if (raw.length > MAX_TOOLS) return { error: `An agent can have at most ${MAX_TOOLS} tools` }

  const tools: AgentTool[] = []
  const names = new Set<string>()
  for (const t of raw) {
    if (typeof t !== 'object' || t === null) return { error: 'Invalid tool' }
    const o = t as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      return { error: `Tool name "${name}" must be 1-64 chars (letters, numbers, _ or -)` }
    }
    if (names.has(name)) return { error: `Duplicate tool name "${name}"` }
    names.add(name)
    const method = o.method === 'GET' || o.method === 'POST' ? o.method : null
    if (!method) return { error: `Tool "${name}": method must be GET or POST` }
    if (!isValidWebhookUrl(o.url)) return { error: `Tool "${name}": url must be a valid http(s) URL` }

    const headers: AgentToolHeader[] = []
    if (o.headers !== undefined) {
      if (!Array.isArray(o.headers)) return { error: `Tool "${name}": headers must be a list` }
      for (const h of o.headers) {
        const ho = (typeof h === 'object' && h !== null ? h : {}) as Record<string, unknown>
        if (typeof ho.key !== 'string' || typeof ho.value !== 'string') {
          return { error: `Tool "${name}": header key/value must be text` }
        }
        if (ho.key.trim()) {
          // The API never returns a legacy header value, so the browser can only
          // send back the mask: that means "leave it as it is", never "erase it".
          const key = ho.key.trim()
          const stored = existing.find((t) => t.name === name)?.headers?.find((h) => h.key === key)?.value
          headers.push({ key, value: ho.value === MASKED_HEADER_VALUE && stored !== undefined ? stored : ho.value })
        }
      }
    }

    const parameters: AgentToolParam[] = []
    if (o.parameters !== undefined) {
      if (!Array.isArray(o.parameters)) return { error: `Tool "${name}": parameters must be a list` }
      if (o.parameters.length > MAX_TOOL_PARAMS) {
        return { error: `Tool "${name}": at most ${MAX_TOOL_PARAMS} parameters` }
      }
      const paramNames = new Set<string>()
      for (const p of o.parameters) {
        const po = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>
        const pName = typeof po.name === 'string' ? po.name.trim() : ''
        if (!/^[a-zA-Z0-9_]{1,64}$/.test(pName)) {
          return { error: `Tool "${name}": parameter name "${pName}" is invalid` }
        }
        if (paramNames.has(pName)) return { error: `Tool "${name}": duplicate parameter "${pName}"` }
        paramNames.add(pName)
        const pType = po.type === 'string' || po.type === 'number' || po.type === 'boolean' ? po.type : null
        if (!pType) return { error: `Tool "${name}": parameter "${pName}" type must be string/number/boolean` }
        parameters.push({
          name: pName,
          type: pType,
          description: typeof po.description === 'string' ? po.description : '',
          required: po.required === true,
        })
      }
    }

    tools.push({ name, description: typeof o.description === 'string' ? o.description : '', method, url: o.url, headers, parameters })
  }
  return { tools }
}

// Validate the built-in integrations enabled on an agent against the catalog.
//
// DEPRECATED shape (see AgentBuiltinTool). Two things must survive a save here: a
// masked secret must not overwrite the stored one, and `migratedAt` must not be
// dropped — losing it would send the runtime back to reading a credential that has
// already moved into an encrypted installation.
function parseBuiltinTools(raw: unknown, existing: AgentBuiltinTool[] = []): { builtinTools?: AgentBuiltinTool[]; error?: string } {
  if (raw === undefined) return { builtinTools: undefined }
  if (!Array.isArray(raw)) return { error: 'builtinTools must be a list' }

  const result: AgentBuiltinTool[] = []
  const seen = new Set<string>()
  for (const b of raw) {
    const o = (typeof b === 'object' && b !== null ? b : {}) as Record<string, unknown>
    const key = typeof o.key === 'string' ? o.key : ''
    const app = getBuiltinApp(key)
    if (!app) return { error: `Integração desconhecida "${key}"` }
    if (seen.has(key)) return { error: `Integração "${key}" duplicada` }
    seen.add(key)

    const stored = existing.find((e) => e.key === key)
    const rawConfig = (typeof o.config === 'object' && o.config !== null ? o.config : {}) as Record<string, unknown>
    const config: Record<string, string> = {}
    for (const field of app.configFields) {
      const incoming = typeof rawConfig[field.key] === 'string' ? (rawConfig[field.key] as string) : ''
      // The API masks secrets on the way out; the same mask coming back means
      // "keep what is stored", exactly like a legacy tool header.
      const value = incoming === MASKED_HEADER_VALUE ? (stored?.config?.[field.key] ?? '') : incoming
      if (field.required && !value.trim() && !stored?.migratedAt) return { error: `${app.label}: "${field.label}" é obrigatório.` }
      config[field.key] = value
    }
    result.push({ key, config, ...(stored?.migratedAt ? { migratedAt: stored.migratedAt } : {}) })
  }
  return { builtinTools: result }
}

function isResponseTone(value: unknown): value is ResponseTone {
  return typeof value === 'string' && (RESPONSE_TONES as string[]).includes(value)
}

function isResponseDetail(value: unknown): value is ResponseDetail {
  return typeof value === 'string' && (RESPONSE_DETAILS as string[]).includes(value)
}

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as string[]).includes(value)
}

function isValidDailyMessageLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_DAILY_MESSAGE_LIMIT
}

app.put('/api/settings/:provider/key', requireAuth, async (req, res) => {
  const { provider } = req.params
  if (!isProvider(provider)) {
    res.status(400).json({ error: 'Unknown provider' })
    return
  }
  const { apiKey } = req.body ?? {}
  if (!apiKey || typeof apiKey !== 'string') {
    res.status(400).json({ error: 'apiKey is required' })
    return
  }
  await setProviderApiKey(res.locals.userId, provider, apiKey)
  res.status(204).end()
})

app.delete('/api/settings/:provider/key', requireAuth, async (req, res) => {
  const { provider } = req.params
  if (!isProvider(provider)) {
    res.status(400).json({ error: 'Unknown provider' })
    return
  }
  await clearProviderApiKey(res.locals.userId, provider)
  res.status(204).end()
})

// ---- Integrations (Google) ----

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

app.get('/api/integrations', requireAuth, async (_req, res) => {
  const google = await getGoogleStatus(res.locals.userId)
  res.json({
    google: { ...google, available: googleConfigured() },
    apps: builtinAppsCatalog(),
  })
})

// Kick off Google's OAuth consent. A signed-ish state (userId + nonce) is stored
// in a cookie and checked on the callback to prevent login-CSRF.
app.get('/api/integrations/google/connect', requireAuth, (req, res) => {
  if (!googleConfigured()) {
    res.status(400).json({ error: 'Integração com o Google não está configurada no servidor.' })
    return
  }
  const state = `${res.locals.userId}.${randomBytes(16).toString('hex')}`
  res.cookie('g_oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000 })
  res.redirect(buildGoogleAuthUrl(state))
})

app.get('/api/integrations/google/callback', requireAuth, async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  const state = typeof req.query.state === 'string' ? req.query.state : ''
  const cookieState = readCookie(req.headers.cookie, 'g_oauth_state')
  res.clearCookie('g_oauth_state')

  if (!code || !state || state !== cookieState || !state.startsWith(`${res.locals.userId}.`)) {
    res.redirect(`${clientUrl}/dashboard?integration=google_error`)
    return
  }
  try {
    await connectGoogle(res.locals.userId, code)
    // Mirror the connected account as an installation so Apps can show, grant and
    // revoke it. The tokens themselves stay in the integration store.
    await ensureGoogleInstallation(res.locals.userId)
    res.redirect(`${clientUrl}/dashboard?integration=google_connected`)
  } catch (error) {
    console.error('Google connect failed:', error)
    res.redirect(`${clientUrl}/dashboard?integration=google_error`)
  }
})

app.delete('/api/integrations/google', requireAuth, async (_req, res) => {
  await deleteIntegration(res.locals.userId, 'google')
  // Every grant pointing at Google stops working immediately; the installation stays
  // as history, revoked.
  await revokeGoogleInstallation(res.locals.userId)
  res.status(204).end()
})

function isWidgetPosition(value: unknown): value is WidgetPosition {
  return value === 'left' || value === 'right'
}

async function resolveOwnedAgentId(ownerId: string, agentId: unknown) {
  if (!agentId) return { agentObjectId: null, error: null }
  if (typeof agentId !== 'string' || !ObjectId.isValid(agentId)) {
    return { agentObjectId: null, error: 'Invalid agent id' }
  }
  const agent = await getAgentById(ownerId, new ObjectId(agentId))
  if (!agent) {
    return { agentObjectId: null, error: 'Agent not found' }
  }
  return { agentObjectId: agent._id, error: null }
}

async function resolveOwnedSectorId(ownerId: string, sectorId: unknown) {
  if (!sectorId) return { sectorObjectId: null, error: null }
  if (typeof sectorId !== 'string' || !ObjectId.isValid(sectorId)) {
    return { sectorObjectId: null, error: 'Invalid sector id' }
  }
  const sector = await getSectorById(ownerId, new ObjectId(sectorId))
  if (!sector) {
    return { sectorObjectId: null, error: 'Sector not found' }
  }
  return { sectorObjectId: sector._id, error: null }
}

app.post('/api/widgets', requireAuth, async (req, res) => {
  const { name, primaryColor, welcomeTitle, welcomeMessage, position, agentId, sectorId } = req.body ?? {}
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (position !== undefined && !isWidgetPosition(position)) {
    res.status(400).json({ error: 'Invalid position' })
    return
  }

  const { sectorObjectId, error: sectorError } = await resolveOwnedSectorId(res.locals.userId, sectorId)
  if (sectorError) {
    res.status(400).json({ error: sectorError })
    return
  }
  const { agentObjectId, error } = await resolveOwnedAgentId(res.locals.userId, agentId)
  if (error) {
    res.status(400).json({ error })
    return
  }

  const widget = await createWidget(res.locals.userId, name, {
    primaryColor: typeof primaryColor === 'string' ? primaryColor : undefined,
    welcomeTitle: typeof welcomeTitle === 'string' ? welcomeTitle : undefined,
    welcomeMessage: typeof welcomeMessage === 'string' ? welcomeMessage : undefined,
    position,
    // A widget is answered by a sector OR a single agent, never both.
    sectorId: sectorObjectId,
    agentId: sectorObjectId ? null : agentObjectId,
  })
  auditEntity(res, { id: widget._id.toString(), label: widget.name })
  res.status(201).json(widget)
})

app.get('/api/widgets', requireAuth, async (_req, res) => {
  const widgets = await listWidgets(res.locals.userId)
  res.json(widgets)
})

app.patch('/api/widgets/:widgetId', requireAuth, async (req, res) => {
  const widgetId = String(req.params.widgetId)
  if (!ObjectId.isValid(widgetId)) {
    res.status(400).json({ error: 'Invalid widget id' })
    return
  }
  const { name, primaryColor, welcomeTitle, welcomeMessage, position, agentId, sectorId } = req.body ?? {}
  const updates: {
    name?: string
    primaryColor?: string | null
    welcomeTitle?: string | null
    welcomeMessage?: string | null
    position?: WidgetPosition
    agentId?: ObjectId | null
    sectorId?: ObjectId | null
  } = {}
  if (typeof name === 'string' && name.trim()) updates.name = name
  if (typeof primaryColor === 'string' || primaryColor === null) updates.primaryColor = primaryColor || null
  if (typeof welcomeTitle === 'string' || welcomeTitle === null) updates.welcomeTitle = welcomeTitle || null
  if (typeof welcomeMessage === 'string' || welcomeMessage === null) {
    updates.welcomeMessage = welcomeMessage || null
  }
  if (position !== undefined) {
    if (!isWidgetPosition(position)) {
      res.status(400).json({ error: 'Invalid position' })
      return
    }
    updates.position = position
  }
  // The widget target: a sector wins over a single agent when both are sent.
  if (sectorId !== undefined) {
    const { sectorObjectId, error } = await resolveOwnedSectorId(res.locals.userId, sectorId)
    if (error) {
      res.status(400).json({ error })
      return
    }
    updates.sectorId = sectorObjectId
    if (sectorObjectId) updates.agentId = null
  }
  if (agentId !== undefined && !updates.sectorId) {
    const { agentObjectId, error } = await resolveOwnedAgentId(res.locals.userId, agentId)
    if (error) {
      res.status(400).json({ error })
      return
    }
    updates.agentId = agentObjectId
    if (agentObjectId) updates.sectorId = null
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'Nothing to update' })
    return
  }

  const widget = await updateWidget(res.locals.userId, new ObjectId(widgetId), updates)
  if (!widget) {
    res.status(404).json({ error: 'Widget not found' })
    return
  }
  res.json(widget)
})

app.delete('/api/widgets/:widgetId', requireAuth, async (req, res) => {
  const widgetId = String(req.params.widgetId)
  if (!ObjectId.isValid(widgetId)) {
    res.status(400).json({ error: 'Invalid widget id' })
    return
  }
  // Cascades: also removes the widget's messages, conversation memory, semantic
  // turns and orchestration decisions (see deleteWidget).
  const deleted = await deleteWidget(res.locals.userId, new ObjectId(widgetId))
  if (!deleted) {
    res.status(404).json({ error: 'Widget not found' })
    return
  }
  res.status(204).end()
})

app.post(
  '/api/widgets/:widgetId/avatar',
  requireAuth,
  uploadAvatar.single('file'),
  async (req, res) => {
    const widgetId = String(req.params.widgetId)
    if (!ObjectId.isValid(widgetId)) {
      res.status(400).json({ error: 'Invalid widget id' })
      return
    }
    if (!req.file || !AVATAR_MIME_TYPES.has(req.file.mimetype)) {
      res.status(400).json({ error: 'A valid image file (jpeg, png, gif or webp) is required' })
      return
    }

    const avatarUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
    const widget = await setWidgetAvatar(res.locals.userId, new ObjectId(widgetId), avatarUrl)
    if (!widget) {
      res.status(404).json({ error: 'Widget not found' })
      return
    }
    res.json(widget)
  },
)

app.delete('/api/widgets/:widgetId/avatar', requireAuth, async (req, res) => {
  const widgetId = String(req.params.widgetId)
  if (!ObjectId.isValid(widgetId)) {
    res.status(400).json({ error: 'Invalid widget id' })
    return
  }
  const widget = await setWidgetAvatar(res.locals.userId, new ObjectId(widgetId), null)
  if (!widget) {
    res.status(404).json({ error: 'Widget not found' })
    return
  }
  res.json(widget)
})

// ---- Sectors (agent orchestration) ----

const DEFAULT_SECTOR_COLOR = '#2E5BFF'
const MAX_SECTOR_MEMBERS = 10
const MAX_STAGE_TRANSITIONS = 5

function serializeSector(sector: WithId<Sector>) {
  return {
    _id: sector._id.toString(),
    floorId: sector.officeId?.toString() ?? null,
    name: sector.name,
    color: sector.color ?? DEFAULT_SECTOR_COLOR,
    mode: normalizeSectorMode(sector.mode),
    coordinatorAgentId: sector.coordinatorAgentId?.toString() ?? null,
    instruction: sector.instruction ?? '',
    inputContract: sector.inputContract ?? '',
    outputContract: sector.outputContract ?? '',
    // Who may call INTO this sector's people. Absent on old documents = open, which
    // is exactly how they behaved.
    ...accessConfigOf(sector),
    exposedAgentIds: accessConfigOf(sector).exposedAgentIds.map((id) => id.toString()),
    stages: (sector.stages ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      agentId: s.agentId.toString(),
      instruction: s.instruction,
      dependsOn: s.dependsOn ?? [],
      inputMapping: s.inputMapping ?? {},
      expectedOutput: s.expectedOutput ?? '',
      retryPolicy: s.retryPolicy ?? { maxAttempts: 1, backoffMs: 2000 },
      onError: s.onError ?? 'stop',
    })),
    members: sector.members.map((m) => ({
      agentId: m.agentId.toString(),
      sector: m.sector ?? '',
      routingDescription: m.routingDescription,
      advanceWhen: m.advanceWhen ?? '',
      transitions: (m.transitions ?? []).map((t) => ({
        condition: t.condition,
        targetAgentId: t.targetAgentId.toString(),
      })),
      isDefault: m.isDefault,
    })),
  }
}

async function resolveSectorMembers(
  ownerId: string,
  raw: unknown,
  expectedFloorId: ObjectId,
): Promise<{ members?: SectorMember[]; error?: string; code?: string }> {
  if (!Array.isArray(raw)) return { error: 'members must be a list' }
  if (raw.length > MAX_SECTOR_MEMBERS) return { error: `A sector can have at most ${MAX_SECTOR_MEMBERS} agents`, code: 'SECTOR_MEMBER_LIMIT' }
  const members: SectorMember[] = []
  const rawTransitions: unknown[] = []
  const seen = new Set<string>()
  for (const m of raw) {
    if (typeof m !== 'object' || m === null) return { error: 'Invalid member' }
    const agentId = (m as { agentId?: unknown }).agentId
    if (typeof agentId !== 'string' || !ObjectId.isValid(agentId)) return { error: 'Invalid agent id in members' }
    if (seen.has(agentId)) return { error: 'The same agent appears twice in the sector' }
    const agent = await getAgentById(ownerId, new ObjectId(agentId))
    if (!agent) return { error: 'Agent not found', code: 'AGENT_NOT_FOUND' }
    // A sector and its members must live on the same floor — the backend is the
    // authority, never the (filtered) UI list (§3.7).
    if (!agent.officeId || !agent.officeId.equals(expectedFloorId)) {
      return { error: 'Agent belongs to a different floor', code: 'CROSS_FLOOR_ASSIGNMENT' }
    }
    seen.add(agentId)
    const desc = (m as { routingDescription?: unknown }).routingDescription
    const advanceWhen = (m as { advanceWhen?: unknown }).advanceWhen
    const sector = (m as { sector?: unknown }).sector
    members.push({
      agentId: agent._id,
      sector: typeof sector === 'string' ? sector.trim().slice(0, 60) : '',
      routingDescription: typeof desc === 'string' ? desc : '',
      advanceWhen: typeof advanceWhen === 'string' ? advanceWhen : '',
      transitions: [],
      isDefault: (m as { isDefault?: unknown }).isDefault === true,
    })
    rawTransitions.push((m as { transitions?: unknown }).transitions)
  }

  // Second pass: transitions can point to any stage (skip/branch/back), so
  // validate their targets only after every member agentId is known.
  for (let i = 0; i < members.length; i++) {
    const rt = rawTransitions[i]
    if (rt === undefined || rt === null) continue
    if (!Array.isArray(rt)) return { error: 'transitions must be a list' }
    if (rt.length > MAX_STAGE_TRANSITIONS) {
      return { error: `A stage can have at most ${MAX_STAGE_TRANSITIONS} transitions` }
    }
    const transitions: SectorTransition[] = []
    for (const t of rt) {
      if (typeof t !== 'object' || t === null) return { error: 'Invalid transition' }
      const condition = (t as { condition?: unknown }).condition
      const targetAgentId = (t as { targetAgentId?: unknown }).targetAgentId
      if (typeof targetAgentId !== 'string' || !ObjectId.isValid(targetAgentId)) {
        return { error: 'Invalid transition target' }
      }
      if (!seen.has(targetAgentId)) return { error: 'Transition target is not a member of the sector' }
      if (targetAgentId === members[i].agentId.toString()) {
        return { error: 'A transition cannot target its own stage' }
      }
      transitions.push({
        condition: typeof condition === 'string' ? condition : '',
        targetAgentId: new ObjectId(targetAgentId),
      })
    }
    members[i].transitions = transitions
  }
  return { members }
}

function parseSectorMode(value: unknown): SectorMode | null {
  if (value === undefined) return 'orchestrated'
  if (value === 'adaptive') return 'orchestrated' // legacy alias
  return (SECTOR_MODES as string[]).includes(value as string) ? (value as SectorMode) : null
}

// A callable-sector list may only hold EXECUTABLE sectors (orchestrated/pipeline).
// Enforced server-side so an organization sector never becomes a delegation target,
// even if a client sends it.
const MAX_SECTOR_STAGES = 12

// Parse the orchestrated/pipeline team fields (coordinator + stages) from a request
// body, validating every referenced agent lives on the sector's floor. Absent keys
// are simply not set (partial-safe). No IDs/contracts are exposed to the model — the
// UI works in names; ids are resolved here.
async function resolveSectorTeamFields(
  ownerId: string,
  body: Record<string, unknown>,
  floorId: ObjectId,
): Promise<{ fields?: SectorTeamFields; error?: string; code?: string }> {
  const fields: SectorTeamFields = {}

  if (body.coordinatorAgentId !== undefined) {
    const raw = body.coordinatorAgentId
    if (raw === null || raw === '') {
      fields.coordinatorAgentId = null
    } else if (typeof raw !== 'string' || !ObjectId.isValid(raw)) {
      return { error: 'Invalid coordinator id' }
    } else {
      const coord = await getAgentById(ownerId, new ObjectId(raw))
      if (!coord) return { error: 'Coordinator not found', code: 'AGENT_NOT_FOUND' }
      if (!coord.officeId?.equals(floorId)) return { error: 'Coordinator belongs to a different floor', code: 'CROSS_FLOOR_ASSIGNMENT' }
      fields.coordinatorAgentId = coord._id
    }
  }
  for (const key of ['instruction', 'inputContract', 'outputContract'] as const) {
    const v = body[key]
    if (v === undefined) continue
    if (typeof v !== 'string') return { error: `${key} must be a string` }
    fields[key] = v.slice(0, 4000)
  }

  if (body.stages !== undefined) {
    const raw = body.stages
    if (!Array.isArray(raw)) return { error: 'stages must be a list' }
    if (raw.length > MAX_SECTOR_STAGES) return { error: `A pipeline can have at most ${MAX_SECTOR_STAGES} stages` }
    const stages: SectorStage[] = []
    const ids = new Set<string>()
    for (let i = 0; i < raw.length; i++) {
      const s = raw[i]
      if (typeof s !== 'object' || s === null) return { error: 'Invalid stage' }
      const st = s as Record<string, unknown>
      const agentId = st.agentId
      if (typeof agentId !== 'string' || !ObjectId.isValid(agentId)) return { error: 'Invalid stage agent' }
      const agent = await getAgentById(ownerId, new ObjectId(agentId))
      if (!agent) return { error: 'Stage agent not found', code: 'AGENT_NOT_FOUND' }
      if (!agent.officeId?.equals(floorId)) return { error: 'Stage agent belongs to a different floor', code: 'CROSS_FLOOR_ASSIGNMENT' }
      const id = typeof st.id === 'string' && st.id.trim() ? st.id.trim() : `s${i + 1}`
      if (ids.has(id)) return { error: 'Duplicate stage id' }
      ids.add(id)
      const dependsOn = Array.isArray(st.dependsOn) ? (st.dependsOn as unknown[]).filter((d): d is string => typeof d === 'string') : []
      stages.push({
        id,
        name: typeof st.name === 'string' && st.name.trim() ? st.name.slice(0, 200) : `Etapa ${i + 1}`,
        agentId: agent._id,
        instruction: typeof st.instruction === 'string' ? st.instruction.slice(0, 4000) : '',
        dependsOn,
        inputMapping: typeof st.inputMapping === 'object' && st.inputMapping !== null ? (st.inputMapping as Record<string, string>) : {},
        expectedOutput: typeof st.expectedOutput === 'string' ? st.expectedOutput.slice(0, 2000) : '',
        retryPolicy: { maxAttempts: 1, backoffMs: 2000 },
        onError: st.onError === 'continue' ? 'continue' : 'stop',
      })
    }
    // Every dependency must reference an EARLIER stage id (no forward/cyclic refs).
    for (let i = 0; i < stages.length; i++) {
      const earlier = new Set(stages.slice(0, i).map((s) => s.id))
      for (const dep of stages[i].dependsOn) if (!earlier.has(dep)) return { error: `Stage "${stages[i].name}" depends on an unknown/later stage` }
    }
    fields.stages = stages
  }
  return { fields }
}

app.post('/api/sectors', requireAuth, async (req, res) => {
  const { name, mode, members, color } = req.body ?? {}
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const parsedMode = parseSectorMode(mode)
  if (parsedMode === null) {
    res.status(400).json({ error: 'Unknown sector mode' })
    return
  }
  // Resolve/validate the floor FIRST, then validate members against it (§9.4).
  const officeId = await resolveFloorOffice(res.locals.userId, req.body?.floorId)
  const { members: parsed, error, code } = await resolveSectorMembers(res.locals.userId, members ?? [], officeId)
  if (error) {
    res.status(code === 'CROSS_FLOOR_ASSIGNMENT' || code === 'SECTOR_MEMBER_LIMIT' ? 409 : 400).json({ error, code })
    return
  }
  const { fields: team, error: teamError, code: teamCode } = await resolveSectorTeamFields(res.locals.userId, req.body ?? {}, officeId)
  if (teamError) {
    res.status(teamCode === 'CROSS_FLOOR_ASSIGNMENT' ? 409 : 400).json({ error: teamError, code: teamCode })
    return
  }
  const sectorColor = typeof color === 'string' && color.trim() ? color.trim() : DEFAULT_SECTOR_COLOR
  const sector = await createSector(res.locals.userId, officeId, name, sectorColor, parsedMode, parsed ?? [], team)
  await enforceSingleMembership(res.locals.userId, sector._id, (parsed ?? []).map((m) => m.agentId))
  auditEntity(res, { id: sector._id.toString(), label: sector.name, floorId: sector.officeId?.toString() })
  res.status(201).json(serializeSector(sector as WithId<Sector>))
})

app.get('/api/sectors', requireAuth, async (req, res) => {
  const floorId = await scopedFloorId(res.locals.userId, req.query.floorId)
  const sectors = await listSectors(res.locals.userId, floorId)
  res.json(sectors.map(serializeSector))
})

app.patch('/api/sectors/:sectorId', requireAuth, async (req, res) => {
  const sectorId = String(req.params.sectorId)
  if (!ObjectId.isValid(sectorId)) {
    res.status(400).json({ error: 'Invalid sector id' })
    return
  }
  const { name, mode, members, color } = req.body ?? {}
  // Fetch the sector FIRST so members validate against ITS floor, never the URL/body (§9.4).
  const existing = await getSectorById(res.locals.userId, new ObjectId(sectorId))
  if (!existing) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }
  const updates: {
    name?: string
    color?: string
    mode?: SectorMode
    members?: SectorMember[]
    coordinatorAgentId?: ObjectId | null
    instruction?: string
    inputContract?: string
    outputContract?: string
    stages?: SectorStage[]
    entryPolicy?: string
    exposedAgentIds?: ObjectId[]
  } = {}
  if (typeof name === 'string' && name.trim()) updates.name = name
  if (typeof color === 'string' && color.trim()) updates.color = color.trim()
  if (mode !== undefined) {
    const parsedMode = parseSectorMode(mode)
    if (parsedMode === null) {
      res.status(400).json({ error: 'Unknown sector mode' })
      return
    }
    updates.mode = parsedMode
  }
  if (members !== undefined) {
    const { members: parsed, error, code } = await resolveSectorMembers(res.locals.userId, members, existing.officeId)
    if (error) {
      res.status(code === 'CROSS_FLOOR_ASSIGNMENT' || code === 'SECTOR_MEMBER_LIMIT' ? 409 : 400).json({ error, code })
      return
    }
    updates.members = parsed
  }
  const { fields: team, error: teamError, code: teamCode } = await resolveSectorTeamFields(res.locals.userId, req.body ?? {}, existing.officeId)
  if (teamError) {
    res.status(teamCode === 'CROSS_FLOOR_ASSIGNMENT' ? 409 : 400).json({ error: teamError, code: teamCode })
    return
  }
  Object.assign(updates, team)
  // Who may call INTO this sector's people. Validated against the sector AS IT WILL
  // BE (mode and membership included), atomically with the rest of the patch.
  const body = (req.body ?? {}) as { entryPolicy?: unknown; exposedAgentIds?: unknown }
  if (body.entryPolicy !== undefined || body.exposedAgentIds !== undefined) {
    try {
      const next = { ...existing, ...updates, coordinatorAgentId: updates.coordinatorAgentId ?? existing.coordinatorAgentId ?? undefined }
      const resolved = validateAccessConfig(next, body, accessConfigOf(existing))
      updates.entryPolicy = resolved.entryPolicy
      updates.exposedAgentIds = resolved.exposedAgentIds
    } catch (error) {
      res.status(400).json({ error: (error as Error).message })
      return
    }
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'Nothing to update' })
    return
  }
  const sector = await updateSector(res.locals.userId, new ObjectId(sectorId), updates)
  if (!sector) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }
  if (updates.members) {
    await enforceSingleMembership(res.locals.userId, sector._id, updates.members.map((m) => m.agentId))
  }
  res.json(serializeSector(sector))
})

app.delete('/api/sectors/:sectorId', requireAuth, async (req, res) => {
  const sectorId = String(req.params.sectorId)
  if (!ObjectId.isValid(sectorId)) {
    res.status(400).json({ error: 'Invalid sector id' })
    return
  }
  const ownerId = res.locals.userId

  // OWNERSHIP FIRST: resolve the sector inside this account before touching any
  // data. Another tenant's id must never reach the knowledge cleanup below.
  const owned = await getSectorById(ownerId, new ObjectId(sectorId))
  if (!owned) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }

  // A sector in use by a widget can't be silently removed — that widget would be
  // left with no attendant. Block and tell the owner what to unlink first.
  const widgets = await listWidgets(ownerId)
  const usedByWidgets = widgets.filter((w) => w.sectorId?.toString() === sectorId).map((w) => w.name)
  if (usedByWidgets.length > 0) {
    res.status(409).json({
      error: `Este setor está em uso por ${usedByWidgets.map((n) => `widget "${n}"`).join(', ')}. Desvincule antes de excluir.`,
      widgets: usedByWidgets,
    })
    return
  }

  // Delete the sector first (owner-scoped); only once THAT succeeded do we drop the
  // knowledge that belonged to it. Member agents keep their OWN bases untouched.
  const deleted = await deleteSector(ownerId, owned._id)
  if (!deleted.deletedCount) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }
  await deleteAllForSector(owned._id)
  res.status(204).end()
})

// Explicit agent→sector association (plan §9.2). `{ sectorId: null }` removes the
// agent from its sector. The service keeps one sector per agent and same-floor.
app.put('/api/agents/:agentId/sector', requireAuth, async (req, res) => {
  const raw = (req.body ?? {}).sectorId
  if (raw !== null && typeof raw !== 'string') {
    res.status(400).json({ error: 'sectorId must be a string or null' })
    return
  }
  const outcome = await assignAgentToSector(res.locals.userId, String(req.params.agentId), (raw as string | null) ?? null)
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error, code: outcome.code })
    return
  }
  res.json({ agentId: String(req.params.agentId), ...outcome.result })
})

// Replace a sector's members with a clear intent (plan §9.3). Validates members
// against the sector's OWN floor; if the change leaves the sector operationally
// incomplete AND a channel points at it, requires explicit confirmation.
app.put('/api/sectors/:sectorId/members', requireAuth, async (req, res) => {
  const sectorId = String(req.params.sectorId)
  if (!ObjectId.isValid(sectorId)) {
    res.status(400).json({ error: 'Invalid sector id' })
    return
  }
  const ownerId = res.locals.userId
  const existing = await getSectorById(ownerId, new ObjectId(sectorId))
  if (!existing) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }
  const body = req.body ?? {}
  const { members: parsed, error, code } = await resolveSectorMembers(ownerId, body.members ?? [], existing.officeId)
  if (error) {
    res.status(code === 'CROSS_FLOOR_ASSIGNMENT' || code === 'SECTOR_MEMBER_LIMIT' ? 409 : 400).json({ error, code })
    return
  }
  if (!sectorReadiness({ mode: normalizeSectorMode(existing.mode), members: parsed ?? [], coordinatorAgentId: existing.coordinatorAgentId, stages: existing.stages }).ready && body.confirmChannelImpact !== true) {
    const widgets = await listWidgets(ownerId)
    const channels = widgets.filter((w) => w.sectorId?.toString() === sectorId).map((w) => ({ id: w._id.toString(), name: w.name, type: 'web' as const }))
    if (channels.length > 0) {
      res.status(409).json({ error: 'Esta alteração deixa o setor sem equipe pronta e há canal vinculado a ele.', code: 'CHANNEL_IMPACT_CONFIRMATION_REQUIRED', channels })
      return
    }
  }
  const sector = await updateSector(ownerId, new ObjectId(sectorId), { members: parsed })
  if (!sector) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }
  await enforceSingleMembership(ownerId, sector._id, (parsed ?? []).map((m) => m.agentId))
  res.json(serializeSector(sector))
})

// Preflight for moving a sector to another floor (plan §10.2): a read-only report
// of what changes. The sector keeps its _id, channels and analytics; only its
// floor changes and its current (source-floor) members are dropped — they stay on
// the source floor, since a sector and its members must share a floor. The caller
// then re-picks members from the target floor.
app.get('/api/sectors/:sectorId/move-impact', requireAuth, async (req, res) => {
  const sectorId = String(req.params.sectorId)
  if (!ObjectId.isValid(sectorId)) {
    res.status(400).json({ error: 'Invalid sector id', code: 'INVALID_ID' })
    return
  }
  const ownerId = res.locals.userId
  const sector = await getSectorById(ownerId, new ObjectId(sectorId))
  if (!sector) {
    res.status(404).json({ error: 'Sector not found', code: 'SECTOR_NOT_FOUND' })
    return
  }
  const targetFloorRaw = String(req.query.targetFloorId ?? '')
  if (!ObjectId.isValid(targetFloorRaw)) {
    res.status(400).json({ error: 'Invalid target floor id', code: 'INVALID_ID' })
    return
  }
  const targetFloor = await getFloor(ownerId, new ObjectId(targetFloorRaw))
  if (!targetFloor) {
    res.status(404).json({ error: 'Target floor not found', code: 'FLOOR_NOT_FOUND' })
    return
  }
  if (sector.officeId.equals(targetFloor._id)) {
    res.status(400).json({ error: 'O setor já está neste andar.', code: 'SAME_FLOOR' })
    return
  }

  const [sourceFloor, sourceAgents, targetAgents, targetSectors, widgets] = await Promise.all([
    getFloor(ownerId, sector.officeId),
    listAgents(ownerId, sector.officeId),
    listAgents(ownerId, targetFloor._id),
    listSectors(ownerId, targetFloor._id),
    listWidgets(ownerId),
  ])
  const sourceName = new Map(sourceAgents.map((a) => [a._id.toString(), a.name]))
  // For each target-floor agent, the sector (if any) it currently belongs to.
  const sectorOfTargetAgent = new Map<string, string>()
  for (const s of targetSectors) for (const m of s.members) sectorOfTargetAgent.set(m.agentId.toString(), s.name)

  res.json({
    sector: { id: sector._id.toString(), name: sector.name },
    sourceFloor: { id: sector.officeId.toString(), name: sourceFloor?.name ?? 'Andar' },
    targetFloor: { id: targetFloor._id.toString(), name: targetFloor.name },
    currentMembers: sector.members.map((m) => ({ id: m.agentId.toString(), name: sourceName.get(m.agentId.toString()) ?? 'Agente' })),
    linkedChannels: widgets.filter((w) => w.sectorId?.toString() === sectorId).map((w) => ({ id: w._id.toString(), name: w.name, type: 'web' as const })),
    targetAgents: targetAgents.map((a) => ({ id: a._id.toString(), name: a.name, currentSector: sectorOfTargetAgent.get(a._id.toString()) ?? null })),
    analyticsPreserved: true, // analytics key by sectorId — unaffected by the floor change.
    agentsWillStayOnSourceFloor: true, // moving a sector never relocates its agents.
  })
})

// Commit a sector move to another floor (plan §10.3). The backend is the
// authority: it re-validates the target floor and validates the chosen members
// against it (never trusting the URL/body floor), drops the source-floor members,
// and updates officeId + members in one atomic document write.
app.post('/api/sectors/:sectorId/move', requireAuth, async (req, res) => {
  const sectorId = String(req.params.sectorId)
  if (!ObjectId.isValid(sectorId)) {
    res.status(400).json({ error: 'Invalid sector id', code: 'INVALID_ID' })
    return
  }
  const ownerId = res.locals.userId
  const sector = await getSectorById(ownerId, new ObjectId(sectorId))
  if (!sector) {
    res.status(404).json({ error: 'Sector not found', code: 'SECTOR_NOT_FOUND' })
    return
  }
  const body = req.body ?? {}
  if (!ObjectId.isValid(String(body.targetFloorId ?? ''))) {
    res.status(400).json({ error: 'Invalid target floor id', code: 'INVALID_ID' })
    return
  }
  const targetFloor = await getFloor(ownerId, new ObjectId(String(body.targetFloorId)))
  if (!targetFloor) {
    res.status(404).json({ error: 'Target floor not found', code: 'FLOOR_NOT_FOUND' })
    return
  }
  if (sector.officeId.equals(targetFloor._id)) {
    res.status(400).json({ error: 'O setor já está neste andar.', code: 'SAME_FLOOR' })
    return
  }
  // Members must belong to the TARGET floor (same-floor invariant). Empty is allowed
  // (the sector arrives unconfigured); the owner staffs it after the move.
  const { members: parsed, error, code } = await resolveSectorMembers(ownerId, body.members ?? [], targetFloor._id)
  if (error) {
    res.status(code === 'CROSS_FLOOR_ASSIGNMENT' || code === 'SECTOR_MEMBER_LIMIT' ? 409 : 400).json({ error, code })
    return
  }
  // Moving with an incomplete team while a channel points here needs confirmation.
  if (!sectorReadiness({ mode: normalizeSectorMode(sector.mode), members: parsed ?? [], coordinatorAgentId: sector.coordinatorAgentId, stages: sector.stages }).ready && body.confirmChannelImpact !== true) {
    const widgets = await listWidgets(ownerId)
    const channels = widgets.filter((w) => w.sectorId?.toString() === sectorId).map((w) => ({ id: w._id.toString(), name: w.name, type: 'web' as const }))
    if (channels.length > 0) {
      res.status(409).json({ error: 'A mudança de andar deixa o setor sem equipe pronta e há canal vinculado a ele.', code: 'CHANNEL_IMPACT_CONFIRMATION_REQUIRED', channels })
      return
    }
  }
  const moved = await updateSector(ownerId, sector._id, { officeId: targetFloor._id, members: parsed })
  if (!moved) {
    res.status(404).json({ error: 'Sector not found', code: 'SECTOR_NOT_FOUND' })
    return
  }
  await enforceSingleMembership(ownerId, moved._id, (parsed ?? []).map((m) => m.agentId))
  res.json(serializeSector(moved))
})

// Per-sector dashboard: the sector config, its orchestration analytics and the
// widgets it answers.
app.get('/api/sectors/:sectorId/overview', requireAuth, async (req, res) => {
  const sectorId = String(req.params.sectorId)
  if (!ObjectId.isValid(sectorId)) {
    res.status(400).json({ error: 'Invalid sector id' })
    return
  }
  const ownerId = res.locals.userId
  const sector = await getSectorById(ownerId, new ObjectId(sectorId))
  if (!sector) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }

  const [agg, widgets] = await Promise.all([aggregateSectorDecisions(ownerId), listWidgets(ownerId)])
  const totals = agg.totals.find((t) => t._id.toString() === sectorId) ?? { decisions: 0, clarify: 0, moved: 0 }
  const specialists = agg.specialists
    .filter((s) => s._id.sectorId.toString() === sectorId)
    .map((s) => ({ name: s._id.name, count: s.count }))
    .sort((a, b) => b.count - a.count)
  const left = new Map(
    agg.fromStages.filter((f) => f._id.sectorId.toString() === sectorId).map((f) => [f._id.name, f.count]),
  )
  const analytics =
    totals.decisions > 0
      ? {
          sectorId,
          sectorName: sector.name,
          mode: normalizeSectorMode(sector.mode),
          decisions: totals.decisions,
          clarifyRate: totals.decisions > 0 ? totals.clarify / totals.decisions : 0,
          moves: totals.moved,
          specialists: specialists.slice(0, 6),
          stages: specialists.map((s) => ({ name: s.name, handled: s.count, left: left.get(s.name) ?? 0 })),
        }
      : null

  // Readiness for the team, including agents that are wired in but still need
  // their OWN setup (a warning, never a block).
  const mode = normalizeSectorMode(sector.mode)
  const involvedIds = new Set<string>([
    ...sector.members.map((m) => m.agentId.toString()),
    ...(sector.coordinatorAgentId ? [sector.coordinatorAgentId.toString()] : []),
    ...(sector.stages ?? []).map((st) => st.agentId?.toString()).filter((x): x is string => Boolean(x)),
  ])
  const allAgents = await listAgents(ownerId)
  const known = new Map(allAgents.map((a) => [a._id.toString(), a]))
  const involved = [...involvedIds].map((id) => known.get(id)).filter((a): a is NonNullable<typeof a> => Boolean(a))
  const collabCtx = await collaboratorContext(ownerId)
  const liveWebhooks = liveWebhookCountByAgent(await listActivePublished(ownerId).catch(() => []))
  const pendingAgentNames = (
    await Promise.all(
      involved.map(async (a) => {
        const channels = widgets.filter((w) => w.agentId?.toString() === a._id.toString()).length
        return agentReadiness(a, await wiringForAgent(ownerId, a, channels, collabCtx, liveWebhooks)).ready ? null : a.name
      }),
    )
  ).filter((n): n is string => n !== null)
  const readiness = sectorReadiness({
    mode,
    members: sector.members,
    coordinatorAgentId: sector.coordinatorAgentId,
    stages: sector.stages,
    pendingAgentNames,
    knownAgentIds: allAgents.map((a) => a._id.toString()),
  })

  res.json({
    sector: serializeSector(sector),
    readiness,
    analytics,
    linkedWidgets: widgets
      .filter((w) => w.sectorId?.toString() === sectorId)
      .map((w) => ({ _id: w._id, name: w.name })),
  })
})

// Stateless sector test chat: runs the supervisor (plan → merge specialists →
// one unified reply, or a clarification) over the supplied history. Nothing is
// persisted; also reports which specialists were consulted so the owner can see
// the orchestration decision.
app.post('/api/sectors/:sectorId/playground', requireAuth, async (req, res) => {
  const sectorIdStr = String(req.params.sectorId)
  if (!ObjectId.isValid(sectorIdStr)) {
    res.status(400).json({ error: 'Invalid sector id' })
    return
  }
  const sector = await getSectorById(res.locals.userId, new ObjectId(sectorIdStr))
  if (!sector) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }

  const { messages, stageIndex: rawStageIndex } = req.body ?? {}
  const isValidHistory =
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= MAX_PLAYGROUND_MESSAGES &&
    messages.every(
      (m: unknown) =>
        typeof m === 'object' &&
        m !== null &&
        ((m as ChatTurn).role === 'user' || (m as ChatTurn).role === 'assistant') &&
        typeof (m as ChatTurn).content === 'string' &&
        (m as ChatTurn).content.trim().length > 0,
    )
  if (!isValidHistory) {
    res.status(400).json({ error: `messages must be 1-${MAX_PLAYGROUND_MESSAGES} {role, content} turns` })
    return
  }
  const history = messages as ChatTurn[]
  const lastUser = [...history].reverse().find((m) => m.role === 'user')
  if (!lastUser) {
    res.status(400).json({ error: 'At least one user message is required' })
    return
  }

  const resolved = (
    await Promise.all(
      sector.members.map(async (m) => ({ member: m, agent: await getAgentById(res.locals.userId, m.agentId) })),
    )
  ).filter((x): x is { member: SectorMember; agent: WithId<Agent> } => x.agent !== null)
  if (resolved.length === 0) {
    res.status(400).json({ error: 'Sector has no valid agents' })
    return
  }

  const defaultIndex = Math.max(
    0,
    resolved.findIndex((x) => x.member.isDefault),
  )
  const configAgent = resolved[defaultIndex].agent
  const apiKey = await getProviderApiKey(res.locals.userId, configAgent.provider)
  const sectorObjectiveFor = (chosen: { member: SectorMember; agent: WithId<Agent> }[]) =>
    buildSectorObjective(
      sector.name,
      chosen.map((x) => ({ name: x.agent.name, objective: x.agent.objective })),
    )

  const mode: SectorMode = normalizeSectorMode(sector.mode)
  let replyObjective: string
  let knowledgeAgentIds: ObjectId[]
  let specialistNames: string[]
  let clarificationTopics: string[] | null = null
  let clarify = false
  // Pipeline-only response fields (the client tracks the stage between sends).
  let pipelineStageName: string | null = null
  let pipelineStageIndex: number | null = null
  let pipelineAdvanced = false
  let pipelineFromStage: string | null = null

  if (mode === 'pipeline' && resolved.length > 1) {
    // The client sends the stage the conversation is on; default to the first.
    let stageIndex =
      typeof rawStageIndex === 'number' && Number.isInteger(rawStageIndex)
        ? Math.min(Math.max(rawStageIndex, 0), resolved.length - 1)
        : 0
    const options = buildStageTransitionOptions(resolved, stageIndex)
    if (options.length > 0) {
      try {
        const target = await planStageTransition(
          resolved[stageIndex].agent.name,
          resolved[stageIndex].member.routingDescription,
          options,
          history.slice(0, -1),
          lastUser.content,
          configAgent.provider,
          auxModelFor(configAgent),
          apiKey,
        )
        if (target >= 0 && target !== stageIndex) {
          pipelineFromStage = resolved[stageIndex].agent.name
          pipelineAdvanced = true
          stageIndex = target
        }
      } catch (error) {
        console.error('Sector playground stage transition planning failed, staying on current stage:', error)
      }
    }
    const stage = resolved[stageIndex]
    replyObjective = buildPipelineStageObjective(sector.name, {
      name: stage.agent.name,
      objective: stage.agent.objective,
      stageGoal: stage.member.routingDescription,
    })
    knowledgeAgentIds = [stage.agent._id]
    specialistNames = [stage.agent.name]
    pipelineStageName = stage.agent.name
    pipelineStageIndex = stageIndex
  } else {
    let plan = { specialists: [defaultIndex], clarify: false }
    if (resolved.length > 1) {
      const options: RouterOption[] = resolved.map((x, i) => ({
        index: i,
        name: x.agent.name,
        description: memberRoutingLine(x.member, x.agent),
      }))
      try {
        plan = await planSectorResponse(
          options,
          [],
          defaultIndex,
          history.slice(0, -1),
          lastUser.content,
          configAgent.provider,
          auxModelFor(configAgent),
          apiKey,
        )
      } catch (error) {
        console.error('Sector playground planning failed, using default specialist:', error)
      }
    }
    clarify = plan.clarify
    if (plan.clarify) {
      replyObjective = sectorObjectiveFor(resolved)
      knowledgeAgentIds = []
      specialistNames = []
      clarificationTopics = resolved.map((x) => x.member.routingDescription.trim() || x.agent.name)
    } else {
      const chosen = plan.specialists.map((i) => resolved[i]).filter(Boolean)
      if (chosen.length === 0) chosen.push(resolved[defaultIndex])
      replyObjective = sectorObjectiveFor(chosen)
      knowledgeAgentIds = chosen.map((x) => x.agent._id)
      specialistNames = chosen.map((x) => x.agent.name)
    }
  }

  // Sector context: the consulted specialists' own bases PLUS the sector's shared
  // base, merged by relevance, deduped and capped by top-K/character budget. A
  // vector-search failure never breaks the turn — it just answers without grounding.
  // Canonical retrieval: the consulted specialists' bases + THIS sector's shared
  // base, merged/deduped/capped. Never throws — an outage just means no grounding.
  const { context: knowledge } = await retrieveContext(knowledgeAgentIds, lastUser.content, { verifiedSectorId: sector._id })

  const behaviorInstruction = [
    configAgent.guardrailMode === 'prompt' ? GUARDRAIL_SCOPE_INSTRUCTION : '',
    configAgent.handoffEnabled ? HANDOFF_INSTRUCTION : '',
    configAgent.proactivityEnabled ? buildProactivityInstruction(configAgent.proactivityGuidance ?? '') : '',
    clarificationTopics ? buildClarificationInstruction(clarificationTopics) : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const { text, usage, toolCalls } = await generateAgentReply(
    replyObjective,
    knowledge,
    '',
    history,
    configAgent.provider,
    configAgent.model,
    apiKey,
    '',
    behaviorInstruction,
    [
      buildLanguageInstruction(configAgent.language ?? 'pt'),
      buildResponseStyleInstruction(
        configAgent.responseTone ?? 'neutral',
        configAgent.responseDetail ?? 'balanced',
        configAgent.responseEmojis ?? false,
        configAgent.responseFormatting ?? false,
      ),
    ].join('\n\n'),
    configAgent.promptCaching ?? true,
    await resolveAgentTools(configAgent, res.locals.userId),
  )
  recordReplyUsage(res.locals.userId, usage).catch((error) =>
    console.error('Failed to record token usage:', error),
  )

  let reply = text
  if (configAgent.handoffEnabled && reply.trimStart().startsWith(HANDOFF_MARKER)) {
    reply = reply.trimStart().slice(HANDOFF_MARKER.length).trim()
  }
  res.json({
    reply,
    mode,
    specialists: specialistNames,
    clarify,
    stage: pipelineStageName,
    stageIndex: pipelineStageIndex,
    advanced: pipelineAdvanced,
    fromStage: pipelineFromStage,
    toolCalls,
  })
})

// --- Custom Tools -------------------------------------------------------------
// Reusable HTTP integrations. Everything is owner-scoped, and a stored credential
// is never returned: toPublicTool strips it in one place so no route can leak it.
app.get('/api/tools', requireAuth, async (_req, res) => {
  const ownerId = res.locals.userId
  const [tools, agents] = await Promise.all([listTools(ownerId), listAgents(ownerId)])
  // "Where is this used" comes from the agents themselves, so it can never drift.
  const usedBy = new Map<string, { _id: string; name: string }[]>()
  for (const agent of agents) {
    for (const id of agent.toolIds ?? []) {
      if (!usedBy.has(id)) usedBy.set(id, [])
      usedBy.get(id)?.push({ _id: agent._id.toString(), name: agent.name })
    }
  }
  res.json(tools.map((t) => ({ ...toPublicTool(t), usedBy: usedBy.get(t._id.toString()) ?? [] })))
})

const toolError = (res: Response, error: unknown): boolean => {
  if (error instanceof ToolValidationError) {
    res.status(400).json({ error: error.message, field: error.field })
    return true
  }
  return false
}

app.post('/api/tools', requireAuth, async (req, res) => {
  try {
    const tool = await createTool(res.locals.userId, req.body ?? {})
    auditEntity(res, { id: tool._id.toString(), label: tool.name })
    res.status(201).json(toPublicTool(tool))
  } catch (error) {
    if (!toolError(res, error)) throw error
  }
})

app.patch('/api/tools/:toolId', requireAuth, async (req, res) => {
  const toolId = String(req.params.toolId)
  if (!ObjectId.isValid(toolId)) {
    res.status(400).json({ error: 'Invalid tool id' })
    return
  }
  try {
    const tool = await updateTool(res.locals.userId, new ObjectId(toolId), req.body ?? {})
    if (!tool) {
      res.status(404).json({ error: 'Tool not found' })
      return
    }
    res.json(toPublicTool(tool))
  } catch (error) {
    if (!toolError(res, error)) throw error
  }
})

app.delete('/api/tools/:toolId', requireAuth, async (req, res) => {
  const toolId = String(req.params.toolId)
  if (!ObjectId.isValid(toolId)) {
    res.status(400).json({ error: 'Invalid tool id' })
    return
  }
  const ownerId = res.locals.userId
  const removed = await deleteTool(ownerId, new ObjectId(toolId))
  if (!removed) {
    res.status(404).json({ error: 'Tool not found' })
    return
  }
  // Leave no dangling reference behind: an agent must never carry an id that no
  // longer resolves.
  await pullToolFromAgents(ownerId, toolId)
  res.status(204).end()
})

// Run the tool once, by hand, with the operator's own arguments. Same executor
// the agents use — so what is proven here is what will happen in production —
// and the same masking, so credentials stay invisible even to the owner.
app.post('/api/tools/:toolId/test', requireAuth, async (req, res) => {
  const toolId = String(req.params.toolId)
  if (!ObjectId.isValid(toolId)) {
    res.status(400).json({ error: 'Invalid tool id' })
    return
  }
  const tool = await getTool(res.locals.userId, new ObjectId(toolId))
  if (!tool) {
    res.status(404).json({ error: 'Tool not found' })
    return
  }
  // The owner may test any method by hand — but one that can change something on
  // the far side only with an explicit confirmation, so a stray click never fires a
  // real POST/DELETE at a live system.
  if (UNSAFE_METHODS.includes(tool.method) && req.body?.confirm !== true) {
    res.status(400).json({ error: `Este teste executa um ${tool.method} real no sistema de destino. Confirme para continuar.`, field: 'confirm' })
    return
  }
  const outcome = await executeToolCall(tool, req.body?.arguments ?? {})
  res.json({ ok: outcome.ok, result: outcome.result, detail: outcome.detail })
})

// Preset catalog for the hiring wizard (starting configs — the user edits after).
app.get('/api/agent-presets', requireAuth, (_req, res) => {
  res.json(AGENT_PRESET_SPECS)
})

app.post('/api/agents', requireAuth, async (req, res) => {
  const {
    name,
    objective,
    provider,
    model,
    memoryType,
    historyLimit,
    identityEnabled,
    identityFields,
    conversationPersistence,
    guardrailMode,
    structuredOutputEnabled,
    structuredOutputFields,
    structuredOutputWebhookUrl,
    responseTone,
    responseDetail,
    responseEmojis,
    responseFormatting,
    handoffEnabled,
    firstMessage,
    proactivityEnabled,
    proactivityGuidance,
    language,
    dailyMessageLimit,
    cheapAuxModel,
    promptCaching,
    tools,
    builtinTools,
  } = req.body ?? {}
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (language !== undefined && !isLanguage(language)) {
    res.status(400).json({ error: 'Unknown language' })
    return
  }
  if (dailyMessageLimit !== undefined && !isValidDailyMessageLimit(dailyMessageLimit)) {
    res.status(400).json({ error: `dailyMessageLimit must be an integer between 0 and ${MAX_DAILY_MESSAGE_LIMIT}` })
    return
  }
  if (provider !== undefined && !isProvider(provider)) {
    res.status(400).json({ error: 'Unknown provider' })
    return
  }
  if (historyLimit !== undefined && !isValidHistoryLimit(historyLimit)) {
    res.status(400).json({ error: `historyLimit must be an integer between 1 and ${MAX_HISTORY_LIMIT}` })
    return
  }
  if (memoryType !== undefined && !isMemoryType(memoryType)) {
    res.status(400).json({ error: 'Unknown memoryType' })
    return
  }
  if (identityFields !== undefined && !isValidIdentityFields(identityFields)) {
    res.status(400).json({ error: `identityFields must be a list of up to ${MAX_IDENTITY_FIELDS} non-empty strings` })
    return
  }
  if (conversationPersistence !== undefined && !isConversationPersistence(conversationPersistence)) {
    res.status(400).json({ error: 'Unknown conversationPersistence' })
    return
  }
  if (guardrailMode !== undefined && !isGuardrailMode(guardrailMode)) {
    res.status(400).json({ error: 'Unknown guardrailMode' })
    return
  }
  if (structuredOutputFields !== undefined && !isValidStructuredOutputFields(structuredOutputFields)) {
    res.status(400).json({
      error: `structuredOutputFields must be a list of up to ${MAX_STRUCTURED_OUTPUT_FIELDS} non-empty strings`,
    })
    return
  }
  if (
    structuredOutputWebhookUrl !== undefined &&
    structuredOutputWebhookUrl !== null &&
    !isValidWebhookUrl(structuredOutputWebhookUrl)
  ) {
    res.status(400).json({ error: 'structuredOutputWebhookUrl must be a valid http(s) URL' })
    return
  }
  if (responseTone !== undefined && !isResponseTone(responseTone)) {
    res.status(400).json({ error: 'Unknown responseTone' })
    return
  }
  if (responseDetail !== undefined && !isResponseDetail(responseDetail)) {
    res.status(400).json({ error: 'Unknown responseDetail' })
    return
  }
  const { tools: parsedTools, error: toolsError } = parseTools(tools)
  if (toolsError) {
    res.status(400).json({ error: toolsError })
    return
  }
  const { builtinTools: parsedBuiltins, error: builtinError } = parseBuiltinTools(builtinTools)
  if (builtinError) {
    res.status(400).json({ error: builtinError })
    return
  }
  const { fields: modelFields, error: modelError } = parseAgentModelFields(req.body ?? {})
  if (modelError) {
    res.status(400).json({ error: modelError })
    return
  }
  const officeId = await resolveFloorOffice(res.locals.userId, req.body?.floorId)
  // Same validation as the update path: a new agent can only be wired to colleagues
  // and teams that really exist in ITS building.
  if (modelFields.callableAgentIds || modelFields.callableSectorIds || modelFields.allowedCallerAgentIds) {
    const ctx = await collaboratorContext(res.locals.userId)
    Object.assign(
      modelFields,
      sanitizeCollaborationRefs({ id: '', buildingId: ctx.buildingOf(officeId.toString()) }, modelFields, ctx.agents, ctx.sectors),
    )
  }

  const agent = await createAgent(res.locals.userId, officeId, name, {
    objective: typeof objective === 'string' ? objective : undefined,
    provider,
    model: typeof model === 'string' || model === null ? model || null : undefined,
    memoryType,
    historyLimit,
    identityEnabled: typeof identityEnabled === 'boolean' ? identityEnabled : undefined,
    identityFields,
    conversationPersistence,
    guardrailMode,
    structuredOutputEnabled: typeof structuredOutputEnabled === 'boolean' ? structuredOutputEnabled : undefined,
    structuredOutputFields,
    structuredOutputWebhookUrl:
      typeof structuredOutputWebhookUrl === 'string' || structuredOutputWebhookUrl === null
        ? structuredOutputWebhookUrl || null
        : undefined,
    responseTone,
    responseDetail,
    responseEmojis: typeof responseEmojis === 'boolean' ? responseEmojis : undefined,
    responseFormatting: typeof responseFormatting === 'boolean' ? responseFormatting : undefined,
    handoffEnabled: typeof handoffEnabled === 'boolean' ? handoffEnabled : undefined,
    firstMessage:
      typeof firstMessage === 'string' || firstMessage === null ? firstMessage || null : undefined,
    proactivityEnabled: typeof proactivityEnabled === 'boolean' ? proactivityEnabled : undefined,
    proactivityGuidance: typeof proactivityGuidance === 'string' ? proactivityGuidance : undefined,
    language,
    dailyMessageLimit: typeof dailyMessageLimit === 'number' ? dailyMessageLimit : undefined,
    cheapAuxModel: typeof cheapAuxModel === 'boolean' ? cheapAuxModel : undefined,
    promptCaching: typeof promptCaching === 'boolean' ? promptCaching : undefined,
    tools: parsedTools,
    builtinTools: parsedBuiltins,
    ...modelFields,
  })
  // Name the new agent in the audit trail (id + name only — never the body).
  auditEntity(res, { id: agent._id.toString(), label: agent.name, floorId: agent.officeId?.toString() })
  res.status(201).json(toPublicAgent(agent))
})

app.get('/api/agents', requireAuth, async (req, res) => {
  const floorId = await scopedFloorId(res.locals.userId, req.query.floorId)
  const agents = await listAgents(res.locals.userId, floorId)
  res.json(agents.map((a) => toPublicAgent({ ...a, floorId: a.officeId?.toString() ?? null })))
})

// Per-agent roster stats for the Agentes cards (conversas/leads/atendimento).
// Per-agent OPERATIONAL stats over a period (default 30d). One aggregation over
// agent_execution_events for the core metrics, plus grouped delegation + widget
// rollups for the specific KPIs — no N+1. Channel (conversations/leads) is returned
// separately for the "Canais e atendimento" section and channel KPIs.
app.get('/api/agent-stats', requireAuth, async (req, res) => {
  const ownerId = res.locals.userId
  const period: Period = (PERIODS as string[]).includes(String(req.query.period)) ? (req.query.period as Period) : '30d'
  const since = periodSince(period)
  const floorId = await scopedFloorId(ownerId, req.query.floorId)

  // Optional agentId: the agent page asks for ONE agent instead of the whole roster.
  const onlyAgentId = typeof req.query.agentId === 'string' && ObjectId.isValid(req.query.agentId) ? new ObjectId(req.query.agentId) : null

  const [allAgents, eventMetrics, delegationsByCaller, deliveriesByAgent, widgetStats, since0] = await Promise.all([
    listAgents(ownerId, floorId),
    getAgentEventMetricsBatch(ownerId, { floorId, since }),
    succeededDelegationsByCaller(ownerId, since ?? undefined),
    sentDeliveriesByAgent(ownerId, since ?? undefined),
    // Conversations/leads scoped to the SAME period — never a lifetime total mixed
    // with a 7d/30d figure.
    getAgentStatsBatch(ownerId, { since, agentId: onlyAgentId }),
    telemetrySince(ownerId),
  ])
  // Ownership is enforced by listAgents (owner-scoped); an id outside it yields none.
  const agents = onlyAgentId ? allAgents.filter((a) => a._id.equals(onlyAgentId)) : allAgents

  const stats: Record<string, unknown> = {}
  const channel: Record<string, { linked: boolean; conversations: number; attendedConversations: number; qualifiedLeads: number }> = {}
  for (const agent of agents) {
    const id = agent._id.toString()
    const w = widgetStats[id]
    // A conversation metric requires a REAL channel. Accepting activationModes here
    // showed "0 conversas" on agents that were merely allowed to answer a channel.
    const channelLinked = !!w
    const ev = eventMetrics.get(id)
    const specificValue = (key: string): number | null => {
      switch (key) {
        case 'executions':
          return ev && ev.executions > 0 ? ev.succeeded : null
        case 'tool_actions':
          return ev && ev.executions > 0 ? ev.toolActions : null
        case 'delegations': {
          // ROOT delegations this agent initiated and completed. A sector run counts
          // once (its per-stage child records are excluded), so children are never
          // summed into the parent.
          const c = delegationsByCaller.get(id)
          if (c === undefined) return ev && ev.executions > 0 ? 0 : null
          return c
        }
        case 'deliveries':
          // Real sends only (delivery marked 'sent').
          return deliveriesByAgent.get(id) ?? null
        case 'conversations':
          return w ? w.conversations : null
        case 'leads':
          return w ? w.qualifiedLeads : null
        default:
          return null
      }
    }
    stats[id] = composeAgentStats(agent, ev, channelLinked, (k) => specificValue(k), { hasDeliveries: deliveriesByAgent.has(id) })
    channel[id] = {
      linked: channelLinked,
      conversations: w?.conversations ?? 0,
      attendedConversations: w?.attendedConversations ?? 0,
      qualifiedLeads: w?.qualifiedLeads ?? 0,
    }
  }

  res.json({ period, telemetrySince: since0 ? since0.toISOString() : null, stats, channel })
})

app.patch('/api/agents/:agentId', requireAuth, async (req, res) => {
  const agentId = String(req.params.agentId)
  if (!ObjectId.isValid(agentId)) {
    res.status(400).json({ error: 'Invalid agent id' })
    return
  }
  const {
    name,
    objective,
    provider,
    model,
    memoryType,
    historyLimit,
    identityEnabled,
    identityFields,
    conversationPersistence,
    guardrailMode,
    structuredOutputEnabled,
    structuredOutputFields,
    structuredOutputWebhookUrl,
    responseTone,
    responseDetail,
    responseEmojis,
    responseFormatting,
    handoffEnabled,
    firstMessage,
    proactivityEnabled,
    proactivityGuidance,
    language,
    dailyMessageLimit,
    cheapAuxModel,
    promptCaching,
    tools,
    builtinTools,
  } = req.body ?? {}
  const updates: {
    name?: string
    objective?: string
    provider?: Provider
    model?: string | null
    memoryType?: MemoryType
    historyLimit?: number
    identityEnabled?: boolean
    identityFields?: string[]
    conversationPersistence?: ConversationPersistence
    guardrailMode?: GuardrailMode
    structuredOutputEnabled?: boolean
    structuredOutputFields?: string[]
    structuredOutputWebhookUrl?: string | null
    responseTone?: ResponseTone
    responseDetail?: ResponseDetail
    responseEmojis?: boolean
    responseFormatting?: boolean
    handoffEnabled?: boolean
    firstMessage?: string | null
    proactivityEnabled?: boolean
    proactivityGuidance?: string
    language?: Language
    dailyMessageLimit?: number
    cheapAuxModel?: boolean
    promptCaching?: boolean
    tools?: AgentTool[]
    builtinTools?: AgentBuiltinTool[]
  } = {}
  if (typeof name === 'string' && name.trim()) updates.name = name
  if (typeof objective === 'string') updates.objective = objective
  if (provider !== undefined) {
    if (!isProvider(provider)) {
      res.status(400).json({ error: 'Unknown provider' })
      return
    }
    updates.provider = provider
  }
  if (typeof model === 'string' || model === null) updates.model = model || null
  if (memoryType !== undefined) {
    if (!isMemoryType(memoryType)) {
      res.status(400).json({ error: 'Unknown memoryType' })
      return
    }
    updates.memoryType = memoryType
  }
  if (historyLimit !== undefined) {
    if (!isValidHistoryLimit(historyLimit)) {
      res.status(400).json({ error: `historyLimit must be an integer between 1 and ${MAX_HISTORY_LIMIT}` })
      return
    }
    updates.historyLimit = historyLimit
  }
  if (typeof identityEnabled === 'boolean') updates.identityEnabled = identityEnabled
  if (identityFields !== undefined) {
    if (!isValidIdentityFields(identityFields)) {
      res
        .status(400)
        .json({ error: `identityFields must be a list of up to ${MAX_IDENTITY_FIELDS} non-empty strings` })
      return
    }
    updates.identityFields = identityFields
  }
  if (conversationPersistence !== undefined) {
    if (!isConversationPersistence(conversationPersistence)) {
      res.status(400).json({ error: 'Unknown conversationPersistence' })
      return
    }
    updates.conversationPersistence = conversationPersistence
  }
  if (guardrailMode !== undefined) {
    if (!isGuardrailMode(guardrailMode)) {
      res.status(400).json({ error: 'Unknown guardrailMode' })
      return
    }
    updates.guardrailMode = guardrailMode
  }
  if (typeof structuredOutputEnabled === 'boolean') updates.structuredOutputEnabled = structuredOutputEnabled
  if (structuredOutputFields !== undefined) {
    if (!isValidStructuredOutputFields(structuredOutputFields)) {
      res.status(400).json({
        error: `structuredOutputFields must be a list of up to ${MAX_STRUCTURED_OUTPUT_FIELDS} non-empty strings`,
      })
      return
    }
    updates.structuredOutputFields = structuredOutputFields
  }
  if (structuredOutputWebhookUrl !== undefined) {
    if (structuredOutputWebhookUrl !== null && !isValidWebhookUrl(structuredOutputWebhookUrl)) {
      res.status(400).json({ error: 'structuredOutputWebhookUrl must be a valid http(s) URL' })
      return
    }
    updates.structuredOutputWebhookUrl = structuredOutputWebhookUrl || null
  }
  if (responseTone !== undefined) {
    if (!isResponseTone(responseTone)) {
      res.status(400).json({ error: 'Unknown responseTone' })
      return
    }
    updates.responseTone = responseTone
  }
  if (responseDetail !== undefined) {
    if (!isResponseDetail(responseDetail)) {
      res.status(400).json({ error: 'Unknown responseDetail' })
      return
    }
    updates.responseDetail = responseDetail
  }
  if (typeof responseEmojis === 'boolean') updates.responseEmojis = responseEmojis
  if (typeof responseFormatting === 'boolean') updates.responseFormatting = responseFormatting
  if (typeof handoffEnabled === 'boolean') updates.handoffEnabled = handoffEnabled
  if (typeof firstMessage === 'string' || firstMessage === null) updates.firstMessage = firstMessage || null
  if (typeof proactivityEnabled === 'boolean') updates.proactivityEnabled = proactivityEnabled
  if (typeof proactivityGuidance === 'string') updates.proactivityGuidance = proactivityGuidance
  if (language !== undefined) {
    if (!isLanguage(language)) {
      res.status(400).json({ error: 'Unknown language' })
      return
    }
    updates.language = language
  }
  if (dailyMessageLimit !== undefined) {
    if (!isValidDailyMessageLimit(dailyMessageLimit)) {
      res.status(400).json({ error: `dailyMessageLimit must be an integer between 0 and ${MAX_DAILY_MESSAGE_LIMIT}` })
      return
    }
    updates.dailyMessageLimit = dailyMessageLimit
  }
  if (typeof cheapAuxModel === 'boolean') updates.cheapAuxModel = cheapAuxModel
  if (typeof promptCaching === 'boolean') updates.promptCaching = promptCaching
  if (tools !== undefined) {
    // The current tools are needed to restore a header value the browser could only
    // have received masked.
    const current = await getAgentById(res.locals.userId, new ObjectId(agentId))
    const { tools: parsedTools, error } = parseTools(tools, current?.tools ?? [])
    if (error) {
      res.status(400).json({ error })
      return
    }
    updates.tools = parsedTools
  }
  if (builtinTools !== undefined) {
    const current = await getAgentById(res.locals.userId, new ObjectId(agentId))
    const { builtinTools: parsedBuiltins, error } = parseBuiltinTools(builtinTools, current?.builtinTools ?? [])
    if (error) {
      res.status(400).json({ error })
      return
    }
    updates.builtinTools = parsedBuiltins
  }
  const { fields: modelFields, error: modelError } = parseAgentModelFields(req.body ?? {})
  if (modelError) {
    res.status(400).json({ error: modelError })
    return
  }
  // Collaboration references are validated against reality: same owner, same
  // building, agent/sector actually exists, sector actually executes. Anything else
  // is dropped rather than stored — a foreign id must never end up in the document.
  if (modelFields.callableAgentIds || modelFields.callableSectorIds || modelFields.allowedCallerAgentIds) {
    const existing = await getAgentById(res.locals.userId, new ObjectId(agentId))
    if (!existing) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }
    const ctx = await collaboratorContext(res.locals.userId)
    Object.assign(
      modelFields,
      sanitizeCollaborationRefs(
        { id: agentId, buildingId: ctx.buildingOf(existing.officeId?.toString() ?? '') },
        modelFields,
        ctx.agents,
        ctx.sectors,
      ),
    )
  }
  Object.assign(updates, modelFields)
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'Nothing to update' })
    return
  }

  const agent = await updateAgent(res.locals.userId, new ObjectId(agentId), updates)
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  res.json(toPublicAgent(agent))
})

app.delete('/api/agents/:agentId', requireAuth, async (req, res) => {
  const agentId = String(req.params.agentId)
  if (!ObjectId.isValid(agentId)) {
    res.status(400).json({ error: 'Invalid agent id' })
    return
  }
  const ownerId = res.locals.userId
  const agentObjectId = new ObjectId(agentId)

  const agent = await getAgentById(ownerId, agentObjectId)
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }

  // An agent in use can't be silently removed — deleting it would break the
  // widgets/sectors pointing at it. Block and tell the owner what to unlink first.
  const [widgets, sectors] = await Promise.all([listWidgets(ownerId), listSectors(ownerId)])
  const usedByWidgets = widgets.filter((w) => w.agentId?.toString() === agentId).map((w) => w.name)
  const usedBySectors = sectors
    .filter((t) => t.members.some((m) => m.agentId.toString() === agentId))
    .map((t) => t.name)
  if (usedByWidgets.length > 0 || usedBySectors.length > 0) {
    const refs = [
      ...usedByWidgets.map((n) => `widget "${n}"`),
      ...usedBySectors.map((n) => `setor "${n}"`),
    ]
    res.status(409).json({
      error: `Este agente está em uso por ${refs.join(', ')}. Desvincule antes de excluir.`,
      widgets: usedByWidgets,
      sectors: usedBySectors,
    })
    return
  }

  await deleteAllForAgent(agentObjectId)
  await deleteAgent(ownerId, agentObjectId)
  res.status(204).end()
})

// Per-agent dashboard: the agent config, its usage metrics (scoped to the
// widgets it directly answers), where it's used (widgets/sectors) and how many
// knowledge documents it has.
// Real wiring around an agent: what EXISTS, not what is merely allowed. Shared by
// the agent overview and the sector overview (which flags members that still need
// their own setup), so both report the same pendencies.
async function wiringForAgent(ownerId: string, agent: Agent, linkedChannelCount: number, ctx: CollaboratorContext, liveWebhooks?: Map<string, number>): Promise<AgentWiring> {
  const [routines, documents] = await Promise.all([
    listRoutines(ownerId, agent._id).catch(() => []),
    listDocuments(agent._id).catch(() => []),
  ])
  // A trigger counts as CONFIGURED only when something active really fires it:
  // a schedule routine that is running (a webhook is not a schedule), and — for
  // events — a PUBLISHED, ACTIVE webhook that really references this agent, whether
  // through its own routine or through an agent.execute step of any automation.
  const active = routines.filter((r) => r.status === 'active')
  const isWebhook = (r: (typeof routines)[number]) => (r.trigger?.type ?? r.draftDefinition?.trigger?.type) === 'webhook'
  const webhooks = liveWebhooks ?? liveWebhookCountByAgent(await listActivePublished(ownerId).catch(() => []))
  return {
    routineCount: active.filter((r) => !isWebhook(r)).length,
    channelCount: linkedChannelCount,
    webhookCount: webhooks.get(agent._id.toString()) ?? 0,
    // Real reachable colleagues — a policy of 'all' over an empty building is zero.
    collaboratorCount: collaboratorCountFor(agent, ctx),
    toolCount: (agent.tools?.length ?? 0) + (agent.builtinTools?.length ?? 0),
    knowledgeCount: documents.length,
    deliveryConfigured: routines.some((r) => (r.draftDefinition?.deliveries?.length ?? 0) > 0),
  }
}

// Who this agent may be wired to work with — everyone in the SAME BUILDING (any
// floor), owner-scoped, itself excluded, and only sectors that can really execute.
// The roster page still lists one floor; collaboration is a building-wide decision,
// so the editor asks the backend instead of guessing from the floor it happens to
// have loaded.
app.get('/api/agents/:agentId/collaborators', requireAuth, async (req, res) => {
  const agentId = String(req.params.agentId)
  if (!ObjectId.isValid(agentId)) {
    res.status(400).json({ error: 'Invalid agent id' })
    return
  }
  const ownerId = res.locals.userId
  const agent = await getAgentById(ownerId, new ObjectId(agentId))
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const ctx = await collaboratorContext(ownerId)
  const buildingId = ctx.buildingOf(agent.officeId?.toString() ?? '')
  const floors = await listFloors(ownerId, { includeArchived: true }).catch(() => [])
  const floorName = new Map(floors.map((f) => [f._id.toString(), f.name]))
  const all = await listAgents(ownerId)
  const sectors = await listSectors(ownerId)

  res.json({
    buildingId,
    agents: all
      .filter((a) => !a._id.equals(agent._id))
      .filter((a) => ctx.buildingOf(a.officeId?.toString() ?? '') === buildingId)
      .map((a) => ({
        _id: a._id.toString(),
        name: a.name,
        preset: a.preset ?? 'custom',
        floorId: a.officeId?.toString() ?? null,
        floorName: floorName.get(a.officeId?.toString() ?? '') ?? null,
        // Whether this colleague currently accepts a call FROM this agent, so the
        // editor can say so instead of letting the user pick someone unreachable.
        acceptsCall: (() => {
          const incoming = callerPolicyFromLegacy(a)
          if (incoming === 'none') return false
          if (incoming === 'selected') return (a.allowedCallerAgentIds ?? []).includes(agentId)
          return true
        })(),
      })),
    sectors: sectors
      .filter((t) => ctx.buildingOf(t.officeId?.toString() ?? '') === buildingId)
      .filter((t) => sectorIsExecutable(normalizeSectorMode(t.mode)))
      .map((t) => ({ _id: t._id.toString(), name: t.name, mode: normalizeSectorMode(t.mode), floorName: floorName.get(t.officeId?.toString() ?? '') ?? null })),
  })
})

app.get('/api/agents/:agentId/overview', requireAuth, async (req, res) => {
  const agentId = String(req.params.agentId)
  if (!ObjectId.isValid(agentId)) {
    res.status(400).json({ error: 'Invalid agent id' })
    return
  }
  const ownerId = res.locals.userId
  const agentObjectId = new ObjectId(agentId)

  const agent = await getAgentById(ownerId, agentObjectId)
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }

  const [stats, widgets, sectors, documents] = await Promise.all([
    getAgentStats(ownerId, agentObjectId),
    listWidgets(ownerId),
    listSectors(ownerId),
    listDocuments(agentObjectId),
  ])

  const linkedWidgets = widgets.filter((w) => w.agentId?.toString() === agentId)
  // Same rule as the roster: only a linked widget/channel counts.
  const channelLinked = linkedWidgets.length > 0
  const wiring = await wiringForAgent(ownerId, agent, linkedWidgets.length, await collaboratorContext(ownerId))
  const readiness = agentReadiness(agent, wiring)
  const triggers = triggerStates(agent, wiring)
  // "Entregas" is only offered when this agent really sent something.
  const agentHasDeliveries = (await sentDeliveriesByAgent(ownerId)).has(agentId)
  res.json({
    agent: toPublicAgent({ ...agent, floorId: agent.officeId?.toString() ?? null }),
    stats,
    // KPI availability for the "Métrica do card" picker (data-source aware) and the
    // currently-resolved card metric.
    channelLinked,
    // The conceptual model the UI renders: what fires this agent (allowed vs
    // configured) and whether it can actually do its job.
    wiring,
    readiness,
    triggers,
    availableMetrics: availableMetricKeys(agent, channelLinked, { hasDeliveries: agentHasDeliveries }),
    resolvedMetric: resolveMetricKey(agent, channelLinked, { hasDeliveries: agentHasDeliveries }),
    linkedWidgets: linkedWidgets.map((w) => ({ _id: w._id, name: w.name })),
    // Where this agent is used as part of a team — coordinator, member or a named
    // pipeline stage. A member row is not the whole story: a coordinator or a stage
    // agent is often NOT in `members`, and the agent page used to show nothing.
    linkedSectors: sectors
      .map((t) => {
        const roles: { role: 'coordinator' | 'member' | 'stage'; stageId?: string; stageName?: string }[] = []
        if (t.coordinatorAgentId?.toString() === agentId) roles.push({ role: 'coordinator' })
        if (t.members.some((m) => m.agentId.toString() === agentId)) roles.push({ role: 'member' })
        for (const st of t.stages ?? []) {
          if (st.agentId?.toString() === agentId) roles.push({ role: 'stage', stageId: st.id, stageName: st.name })
        }
        return roles.length > 0 ? { _id: t._id, name: t.name, mode: normalizeSectorMode(t.mode), roles } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    knowledgeCount: documents.length,
  })
})

const MAX_PLAYGROUND_MESSAGES = 40

// Stateless test chat: the panel sends the whole local history and gets one
// reply back. Nothing is persisted — no widget, no memory, no extraction —
// so owners can iterate on the objective/style/guardrails safely.
app.post('/api/agents/:agentId/playground', requireAuth, async (req, res) => {
  const agentId = String(req.params.agentId)
  if (!ObjectId.isValid(agentId)) {
    res.status(400).json({ error: 'Invalid agent id' })
    return
  }
  const agent = await getAgentById(res.locals.userId, new ObjectId(agentId))
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }

  const { messages } = req.body ?? {}
  const isValidHistory =
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= MAX_PLAYGROUND_MESSAGES &&
    messages.every(
      (m: unknown) =>
        typeof m === 'object' &&
        m !== null &&
        ((m as ChatTurn).role === 'user' || (m as ChatTurn).role === 'assistant') &&
        typeof (m as ChatTurn).content === 'string' &&
        (m as ChatTurn).content.trim().length > 0,
    )
  if (!isValidHistory) {
    res.status(400).json({ error: `messages must be 1-${MAX_PLAYGROUND_MESSAGES} {role, content} turns` })
    return
  }
  const history = messages as ChatTurn[]
  const lastUser = [...history].reverse().find((m) => m.role === 'user')
  if (!lastUser) {
    res.status(400).json({ error: 'At least one user message is required' })
    return
  }

  const apiKey = await getProviderApiKey(res.locals.userId, agent.provider)
  const guardrailMode = agent.guardrailMode ?? 'none'

  if (guardrailMode === 'verification') {
    let inScope = true
    try {
      inScope = await checkGuardrail(
        agent.objective,
        history.slice(0, -1),
        lastUser.content,
        agent.provider,
        auxModelFor(agent),
        apiKey,
      )
    } catch (error) {
      console.error('Playground guardrail check failed, allowing the message through:', error)
    }
    if (!inScope) {
      res.json({ reply: GUARDRAIL_REFUSAL_MESSAGE, refusedByGuardrail: true, handoff: false })
      return
    }
  }

  let knowledge: string[] = []
  try {
    const results = await searchKnowledge(agent._id, lastUser.content)
    knowledge = results.map((result) => result.content)
  } catch (error) {
    console.error('Playground knowledge search failed, replying without grounding:', error)
  }

  const identityFields = agent.identityEnabled ? (agent.identityFields ?? []) : []
  const behaviorInstruction = [
    guardrailMode === 'prompt' ? GUARDRAIL_SCOPE_INSTRUCTION : '',
    agent.handoffEnabled ? HANDOFF_INSTRUCTION : '',
    agent.proactivityEnabled ? buildProactivityInstruction(agent.proactivityGuidance ?? '') : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  // Delegation authorizes by the agent's REAL building (its floor's building), so a
  // manager here can reach specialists on other floors of the same building.
  const playgroundFloor = await getFloor(res.locals.userId, agent.officeId)
  const playgroundBuildingId = playgroundFloor?.buildingId.toString() ?? agent.officeId.toString()
  const manualStartedAt = new Date()
  // Telemetry helper for this manual test: one event per test, whatever the outcome.
  const manualEventKey = `manual:${new ObjectId().toString()}`
  const recordManual = (status: 'succeeded' | 'failed' | 'timeout', u?: { inputTokens: number; outputTokens: number }, okToolCalls = 0) =>
    recordAgentEventSafe({
      eventKey: manualEventKey,
      ownerId: res.locals.userId,
      agentId: agent._id,
      buildingId: playgroundFloor?.buildingId ?? null,
      floorId: agent.officeId,
      source: 'manual',
      preset: agent.preset,
      status,
      startedAt: manualStartedAt,
      finishedAt: new Date(),
      inputTokens: u?.inputTokens ?? 0,
      outputTokens: u?.outputTokens ?? 0,
      toolCalls: okToolCalls,
    })

  let generated: string
  let usage: { inputTokens: number; outputTokens: number }
  let toolCalls: Awaited<ReturnType<typeof generateAgentReply>>['toolCalls']
  try {
    const result = await generateAgentReply(
    agent.objective,
    knowledge,
    '',
    history,
    agent.provider,
    agent.model,
    apiKey,
    identityFields.length > 0 ? buildIdentityCaptureInstruction(identityFields) : '',
    behaviorInstruction,
    [
      buildLanguageInstruction(agent.language ?? 'pt'),
      buildResponseStyleInstruction(
        agent.responseTone ?? 'neutral',
        agent.responseDetail ?? 'balanced',
        agent.responseEmojis ?? false,
        agent.responseFormatting ?? false,
      ),
    ].join('\n\n'),
    agent.promptCaching ?? true,
    await resolveToolsWithDelegation(
      agent,
      res.locals.userId,
      rootContext({ ownerId: res.locals.userId, buildingId: playgroundBuildingId, correlationId: agent._id.toString(), agent }),
      productionDelegationDeps(),
    ),
    )
    generated = result.text
    usage = result.usage
    toolCalls = result.toolCalls
  } catch (error) {
    // The functional response is unchanged (the error still propagates); only the
    // telemetry is added.
    recordManual(/timeout|timed out|exceeded/i.test((error as Error).message ?? '') ? 'timeout' : 'failed')
    throw error
  }
  recordReplyUsage(res.locals.userId, usage).catch((error) =>
    console.error('Failed to record token usage:', error),
  )
  // Only tool calls that actually COMPLETED count as tool actions.
  recordManual('succeeded', usage, toolCalls.filter((c) => c.ok).length)
  let reply = generated

  let handoff = false
  if (agent.handoffEnabled && reply.trimStart().startsWith(HANDOFF_MARKER)) {
    handoff = true
    reply = reply.trimStart().slice(HANDOFF_MARKER.length).trim()
  }
  res.json({ reply, refusedByGuardrail: false, handoff, toolCalls })
})

app.post('/api/agents/:agentId/documents', requireAuth, async (req, res) => {
  const agentId = String(req.params.agentId)
  if (!ObjectId.isValid(agentId)) {
    res.status(400).json({ error: 'Invalid agent id' })
    return
  }
  const agent = await getAgentById(res.locals.userId, new ObjectId(agentId))
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const { title, content } = req.body ?? {}
  if (!title || !content) {
    res.status(400).json({ error: 'title and content are required' })
    return
  }

  try {
    const document = await createDocument(agent._id, title, content)
    res.status(201).json({ ...document, content: undefined })
  } catch (error) {
    console.error('Failed to create knowledge document:', error)
    res.status(502).json({ error: 'Failed to process document. Check the embedding service configuration.' })
  }
})

app.post(
  '/api/agents/:agentId/documents/upload',
  requireAuth,
  upload.single('file'),
  async (req, res) => {
    const agentId = String(req.params.agentId)
    if (!ObjectId.isValid(agentId)) {
      res.status(400).json({ error: 'Invalid agent id' })
      return
    }
    const agent = await getAgentById(res.locals.userId, new ObjectId(agentId))
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }
    const { title } = req.body ?? {}
    if (!title || !req.file) {
      res.status(400).json({ error: 'title and file are required' })
      return
    }

    try {
      const apiKey = await getProviderApiKey(res.locals.userId, agent.provider)
      const content = await extractTextFromFile(req.file.buffer, req.file.mimetype, agent.provider, apiKey)
      if (!content.trim()) {
        res.status(400).json({ error: 'Could not extract any text from this file' })
        return
      }
      const document = await createDocument(agent._id, title, content)
      res.status(201).json({ ...document, content: undefined })
    } catch (error) {
      console.error('Failed to process uploaded document:', error)
      res.status(502).json({ error: 'Failed to process the uploaded file.' })
    }
  },
)

app.get('/api/agents/:agentId/documents', requireAuth, async (req, res) => {
  const agentId = String(req.params.agentId)
  if (!ObjectId.isValid(agentId)) {
    res.status(400).json({ error: 'Invalid agent id' })
    return
  }
  const agent = await getAgentById(res.locals.userId, new ObjectId(agentId))
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const documents = await listDocuments(agent._id)
  res.json(documents)
})

app.get('/api/agents/:agentId/documents/:documentId', requireAuth, async (req, res) => {
  const agentId = String(req.params.agentId)
  const documentId = String(req.params.documentId)
  if (!ObjectId.isValid(agentId) || !ObjectId.isValid(documentId)) {
    res.status(400).json({ error: 'Invalid id' })
    return
  }
  const agent = await getAgentById(res.locals.userId, new ObjectId(agentId))
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const document = await getDocument(agent._id, new ObjectId(documentId))
  if (!document) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  res.json(document)
})

app.patch('/api/agents/:agentId/documents/:documentId', requireAuth, async (req, res) => {
  const agentId = String(req.params.agentId)
  const documentId = String(req.params.documentId)
  if (!ObjectId.isValid(agentId) || !ObjectId.isValid(documentId)) {
    res.status(400).json({ error: 'Invalid id' })
    return
  }
  const agent = await getAgentById(res.locals.userId, new ObjectId(agentId))
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const { title, content } = req.body ?? {}
  const updates: { title?: string; content?: string } = {}
  if (typeof title === 'string' && title.trim()) updates.title = title
  if (typeof content === 'string' && content.trim()) updates.content = content
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'Nothing to update' })
    return
  }

  try {
    const document = await updateDocument(agent._id, new ObjectId(documentId), updates)
    if (!document) {
      res.status(404).json({ error: 'Document not found' })
      return
    }
    res.json({ ...document, content: undefined })
  } catch (error) {
    console.error('Failed to update knowledge document:', error)
    res.status(502).json({ error: 'Failed to process document. Check the embedding service configuration.' })
  }
})

app.delete('/api/agents/:agentId/documents/:documentId', requireAuth, async (req, res) => {
  const agentId = String(req.params.agentId)
  const documentId = String(req.params.documentId)
  if (!ObjectId.isValid(agentId) || !ObjectId.isValid(documentId)) {
    res.status(400).json({ error: 'Invalid id' })
    return
  }
  const agent = await getAgentById(res.locals.userId, new ObjectId(agentId))
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  const deleted = await deleteDocument(agent._id, new ObjectId(documentId))
  if (!deleted) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  res.status(204).end()
})

app.get('/api/conversations', requireAuth, async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined
  const channelParam = req.query.channel
  const channel = channelParam === 'web' || channelParam === 'whatsapp' ? channelParam : undefined
  const widgetId = typeof req.query.widgetId === 'string' && ObjectId.isValid(req.query.widgetId) ? new ObjectId(req.query.widgetId) : undefined
  const conversations = await listConversationsForOwner(res.locals.userId, { search, channel, widgetId })
  res.json(conversations)
})

app.get('/api/stats', requireAuth, async (_req, res) => {
  const [stats, agents, widgets, usage, monthlyTokenCap] = await Promise.all([
    getOwnerStats(res.locals.userId),
    listAgents(res.locals.userId),
    listWidgets(res.locals.userId),
    getUsageSummary(res.locals.userId),
    getMonthlyTokenCap(res.locals.userId),
  ])
  res.json({
    ...stats,
    agents: agents.length,
    widgets: widgets.length,
    tokensThisWeek: usage.tokensThisWeek,
    tokensThisMonth: usage.tokensThisMonth,
    monthlyTokenCap,
  })
})

// Per-sector analytics from the orchestration decision log: how often each
// specialist/stage handled a turn, how often the supervisor asked to clarify,
// and how many pipeline moves happened — so owners can tune their sectors.
app.get('/api/sector-analytics', requireAuth, async (_req, res) => {
  const [sectors, agg] = await Promise.all([
    listSectors(res.locals.userId),
    aggregateSectorDecisions(res.locals.userId),
  ])

  const totalsBySector = new Map(agg.totals.map((t) => [t._id.toString(), t]))
  const specialistsBySector = new Map<string, { name: string; count: number }[]>()
  for (const s of agg.specialists) {
    const key = s._id.sectorId.toString()
    const list = specialistsBySector.get(key) ?? []
    list.push({ name: s._id.name, count: s.count })
    specialistsBySector.set(key, list)
  }
  const leftBySector = new Map<string, Map<string, number>>()
  for (const f of agg.fromStages) {
    const key = f._id.sectorId.toString()
    const map = leftBySector.get(key) ?? new Map<string, number>()
    map.set(f._id.name, f.count)
    leftBySector.set(key, map)
  }

  const analytics = sectors
    .map((sector) => {
      const id = sector._id.toString()
      const totals = totalsBySector.get(id) ?? { decisions: 0, clarify: 0, moved: 0 }
      const left = leftBySector.get(id) ?? new Map<string, number>()
      const specialists = (specialistsBySector.get(id) ?? []).sort((a, b) => b.count - a.count)
      return {
        sectorId: id,
        sectorName: sector.name,
        mode: normalizeSectorMode(sector.mode),
        decisions: totals.decisions,
        clarifyRate: totals.decisions > 0 ? totals.clarify / totals.decisions : 0,
        moves: totals.moved,
        specialists: specialists.slice(0, 6),
        stages: specialists.map((s) => ({ name: s.name, handled: s.count, left: left.get(s.name) ?? 0 })),
      }
    })
    .filter((t) => t.decisions > 0)
    .sort((a, b) => b.decisions - a.decisions)

  res.json(analytics)
})

app.get(
  '/api/widgets/:widgetId/conversations/:conversationId/messages',
  requireAuth,
  async (req, res) => {
    const widgetId = String(req.params.widgetId)
    const conversationId = String(req.params.conversationId)
    if (!ObjectId.isValid(widgetId)) {
      res.status(400).json({ error: 'Invalid widget id' })
      return
    }
    const messages = await getConversationMessages(
      res.locals.userId,
      new ObjectId(widgetId),
      conversationId,
    )
    if (messages === null) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    res.json(messages)
  },
)

app.get(
  '/api/widgets/:widgetId/conversations/:conversationId/structured-data',
  requireAuth,
  async (req, res) => {
    const widgetIdStr = String(req.params.widgetId)
    const conversationId = String(req.params.conversationId)
    if (!ObjectId.isValid(widgetIdStr)) {
      res.status(400).json({ error: 'Invalid widget id' })
      return
    }
    const widgetId = new ObjectId(widgetIdStr)
    const widget = await getWidgetById(widgetId)
    if (!widget || widget.ownerId !== res.locals.userId) {
      res.status(404).json({ error: 'Widget not found' })
      return
    }

    // Once the visitor is identified, the extracted data lives on their
    // cross-conversation profile rather than on this conversation's doc.
    const visitorProfileId = await getLinkedVisitorProfileId(widgetId, conversationId)
    const visitorProfile = visitorProfileId ? await getVisitorProfile(visitorProfileId) : null
    const data = visitorProfile
      ? (visitorProfile.structuredOutputData ?? {})
      : await getStructuredOutputData(widgetId, conversationId)
    const humanHandoff = await getHumanHandoff(widgetId, conversationId)
    res.json({ data, humanHandoff })
  },
)

// Orchestration observability: the supervisor/pipeline decisions logged for this
// conversation (which specialists were consulted, or which stage handled it).
app.get(
  '/api/widgets/:widgetId/conversations/:conversationId/decisions',
  requireAuth,
  async (req, res) => {
    const widgetIdStr = String(req.params.widgetId)
    const conversationId = String(req.params.conversationId)
    if (!ObjectId.isValid(widgetIdStr)) {
      res.status(400).json({ error: 'Invalid widget id' })
      return
    }
    const widgetId = new ObjectId(widgetIdStr)
    const widget = await getWidgetById(widgetId)
    if (!widget || widget.ownerId !== res.locals.userId) {
      res.status(404).json({ error: 'Widget not found' })
      return
    }
    const decisions = await listSectorDecisionsForConversation(res.locals.userId, widgetId, conversationId)
    res.json(
      decisions.map((d) => ({
        specialists: d.specialists,
        clarify: d.clarify,
        mode: d.mode ?? 'adaptive',
        advanced: d.advanced ?? false,
        fromStage: d.fromStage ?? null,
        createdAt: d.createdAt,
      })),
    )
  },
)

app.get(
  '/api/widgets/:widgetId/conversations/:conversationId/tool-calls',
  requireAuth,
  async (req, res) => {
    const widgetIdStr = String(req.params.widgetId)
    const conversationId = String(req.params.conversationId)
    if (!ObjectId.isValid(widgetIdStr)) {
      res.status(400).json({ error: 'Invalid widget id' })
      return
    }
    const widgetId = new ObjectId(widgetIdStr)
    const widget = await getWidgetById(widgetId)
    if (!widget || widget.ownerId !== res.locals.userId) {
      res.status(404).json({ error: 'Widget not found' })
      return
    }
    const calls = await listToolCalls(widgetId, conversationId)
    res.json(
      calls.map((c) => ({
        name: c.name,
        arguments: c.arguments,
        ok: c.ok,
        result: c.result,
        createdAt: c.createdAt,
      })),
    )
  },
)

app.post(
  '/api/widgets/:widgetId/conversations/:conversationId/handoff',
  requireAuth,
  async (req, res) => {
    const widgetIdStr = String(req.params.widgetId)
    const conversationId = String(req.params.conversationId)
    if (!ObjectId.isValid(widgetIdStr)) {
      res.status(400).json({ error: 'Invalid widget id' })
      return
    }
    const widgetId = new ObjectId(widgetIdStr)
    const widget = await getWidgetById(widgetId)
    if (!widget || widget.ownerId !== res.locals.userId) {
      res.status(404).json({ error: 'Widget not found' })
      return
    }
    const { active } = req.body ?? {}
    if (typeof active !== 'boolean') {
      res.status(400).json({ error: 'active must be a boolean' })
      return
    }
    await setHumanHandoff(widgetId, conversationId, active)
    res.json({ humanHandoff: active })
  },
)

app.post(
  '/api/widgets/:widgetId/conversations/:conversationId/messages',
  requireAuth,
  async (req, res) => {
    const widgetId = String(req.params.widgetId)
    const conversationId = String(req.params.conversationId)
    if (!ObjectId.isValid(widgetId)) {
      res.status(400).json({ error: 'Invalid widget id' })
      return
    }
    const { content } = req.body ?? {}
    if (!content) {
      res.status(400).json({ error: 'content is required' })
      return
    }
    const message = await addOwnerReply(
      res.locals.userId,
      new ObjectId(widgetId),
      conversationId,
      content,
    )
    if (!message) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    broadcastMessage(message, res.locals.userId)
    // Deliver the human agent's reply to the customer over WhatsApp too.
    const widget = await getWidgetById(new ObjectId(widgetId))
    if (widget?.channel === 'whatsapp') {
      sendWhatsAppText(widget, conversationId, String(content)).catch((error) =>
        console.error('WhatsApp owner-reply delivery failed:', error),
      )
    }
    res.status(201).json(message)
  },
)

// The agent that supplies widget-level settings (first message, conversation
// persistence, daily limit): the single linked agent, or a sector's default member.
async function getWidgetConfigAgent(widget: WithId<Widget>) {
  if (widget.agentId) return getAgentById(widget.ownerId, widget.agentId)
  if (widget.sectorId) {
    const sector = await getSectorById(widget.ownerId, widget.sectorId)
    const member = sector?.members.find((m) => m.isDefault) ?? sector?.members[0]
    if (member) return getAgentById(widget.ownerId, member.agentId)
  }
  return null
}

// --- WhatsApp channels ----------------------------------------------------

function channelWebhookUrl(provider: string, channelId: ObjectId) {
  return `${publicUrl}/api/whatsapp/${provider}/webhook/${channelId.toHexString()}`
}

function sanitizeChannel(channel: WithId<Widget>) {
  const provider = channel.whatsapp?.provider ?? null
  return {
    _id: channel._id,
    name: channel.name,
    provider,
    number: channel.whatsapp?.number ?? null,
    agentId: channel.agentId,
    sectorId: channel.sectorId,
    createdAt: channel.createdAt,
    webhookUrl: provider ? channelWebhookUrl(provider, channel._id) : null,
  }
}

// Build a validated, provider-specific config from raw input, or send a 400.
function readChannelConfig(
  adapter: ReturnType<typeof getWhatsAppAdapter>,
  raw: unknown,
  res: express.Response,
  { requireAll }: { requireAll: boolean },
): Record<string, string> | null {
  const cfg = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const clean: Record<string, string> = {}
  for (const field of adapter?.fields ?? []) {
    const value = cfg[field.key]
    const missing = value == null || String(value).trim() === ''
    if (requireAll && field.required && missing) {
      res.status(400).json({ error: `Campo obrigatório: ${field.label}` })
      return null
    }
    if (!missing) clean[field.key] = String(value)
  }
  return clean
}

app.get('/api/whatsapp/providers', requireAuth, (_req, res) => {
  res.json(whatsappProvidersCatalog())
})

app.get('/api/whatsapp/channels', requireAuth, async (_req, res) => {
  const channels = await listWhatsAppChannels(res.locals.userId)
  res.json(channels.map(sanitizeChannel))
})

app.post('/api/whatsapp/channels', requireAuth, async (req, res) => {
  const { name, provider, config, agentId, sectorId, number } = req.body ?? {}
  const adapter = typeof provider === 'string' ? getWhatsAppAdapter(provider) : undefined
  if (!adapter || !adapter.available) {
    res.status(400).json({ error: 'Provedor de WhatsApp inválido ou indisponível.' })
    return
  }
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (agentId && !ObjectId.isValid(agentId)) {
    res.status(400).json({ error: 'Invalid agentId' })
    return
  }
  if (sectorId && !ObjectId.isValid(sectorId)) {
    res.status(400).json({ error: 'Invalid sectorId' })
    return
  }
  const cleanConfig = readChannelConfig(adapter, config, res, { requireAll: true })
  if (!cleanConfig) return

  const channel = await createWhatsAppChannel(
    res.locals.userId,
    name,
    {
      provider,
      configEnc: encrypt(JSON.stringify(cleanConfig)),
      number: typeof number === 'string' ? number : null,
    },
    {
      agentId: agentId ? new ObjectId(String(agentId)) : null,
      sectorId: sectorId ? new ObjectId(String(sectorId)) : null,
    },
  )
  res.status(201).json(sanitizeChannel(channel))
})

app.patch('/api/whatsapp/channels/:channelId', requireAuth, async (req, res) => {
  const channelId = String(req.params.channelId)
  if (!ObjectId.isValid(channelId)) {
    res.status(400).json({ error: 'Invalid channel id' })
    return
  }
  const { name, agentId, sectorId, number, config } = req.body ?? {}
  const updates: Parameters<typeof updateWhatsAppChannel>[2] = {}
  if (typeof name === 'string') updates.name = name
  if (agentId !== undefined) updates.agentId = agentId ? new ObjectId(String(agentId)) : null
  if (sectorId !== undefined) updates.sectorId = sectorId ? new ObjectId(String(sectorId)) : null

  // Re-encrypt config only when a new one is supplied; otherwise keep the stored one.
  if (config && typeof config === 'object') {
    const existing = await getWidgetById(new ObjectId(channelId))
    const provider = existing?.whatsapp?.provider
    const adapter = provider ? getWhatsAppAdapter(provider) : undefined
    if (existing && provider && adapter) {
      const cleanConfig = readChannelConfig(adapter, config, res, { requireAll: false })
      if (!cleanConfig) return
      updates.whatsapp = {
        provider,
        configEnc: encrypt(JSON.stringify(cleanConfig)),
        number: typeof number === 'string' ? number : (existing.whatsapp?.number ?? null),
      }
    }
  }

  const updated = await updateWhatsAppChannel(res.locals.userId, new ObjectId(channelId), updates)
  if (!updated) {
    res.status(404).json({ error: 'Channel not found' })
    return
  }
  res.json(sanitizeChannel(updated))
})

app.delete('/api/whatsapp/channels/:channelId', requireAuth, async (req, res) => {
  const channelId = String(req.params.channelId)
  if (!ObjectId.isValid(channelId)) {
    res.status(400).json({ error: 'Invalid channel id' })
    return
  }
  const ok = await deleteWhatsAppChannel(res.locals.userId, new ObjectId(channelId))
  if (!ok) {
    res.status(404).json({ error: 'Channel not found' })
    return
  }
  res.status(204).end()
})

// Inbound webhook (public — the provider calls this server-to-server).
// GET answers a provider's verification challenge (Meta); others just ack.
app.get('/api/whatsapp/:provider/webhook/:channelId', async (req, res) => {
  const channelId = String(req.params.channelId)
  const channel = ObjectId.isValid(channelId) ? await getWidgetById(new ObjectId(channelId)) : null
  if (channel?.channel === 'whatsapp' && whatsAppUsesChallenge(channel)) {
    const query = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, String(v)]))
    const challenge = verifyWhatsAppChallenge(channel, query)
    if (challenge !== null) {
      res.status(200).send(challenge)
    } else {
      res.status(403).send('forbidden')
    }
    return
  }
  // Providers without a verification handshake (Evolution/Twilio): just ack.
  res.status(200).json({ ok: true })
})

// Turn an inbound WhatsApp media message into text the agent can act on:
// download it, then extract (image → vision, PDF/text → contents). Audio/video
// aren't readable yet, so the agent is told to ask for a written message.
const MEDIA_LABEL: Record<InboundMediaRef['kind'], string> = {
  image: 'uma imagem',
  audio: 'um áudio',
  video: 'um vídeo',
  document: 'um documento',
  sticker: 'uma figurinha',
}
async function inboundMediaToText(channel: WithId<Widget>, ref: InboundMediaRef): Promise<string> {
  const label = MEDIA_LABEL[ref.kind]
  if (ref.kind === 'audio' || ref.kind === 'video') {
    const noun = ref.kind === 'audio' ? 'áudios' : 'vídeos'
    return `[O cliente enviou ${label}. Você não consegue processar ${noun} — peça gentilmente para ele digitar a mensagem.]`
  }
  const media = await fetchWhatsAppMedia(channel, ref)
  if (!media) return `[O cliente enviou ${label}, mas não consegui acessá-la.]`
  const configAgent = await getWidgetConfigAgent(channel)
  const provider = configAgent?.provider ?? null
  const apiKey = provider ? await getProviderApiKey(channel.ownerId, provider) : null
  try {
    const extracted = (await extractTextFromFile(media.bytes, media.mimeType, provider, apiKey)).trim()
    if (ref.kind === 'image' || ref.kind === 'sticker') {
      return `[O cliente enviou ${label}. Conteúdo dela: ${extracted}]`
    }
    return `[O cliente enviou ${label}${ref.filename ? ` ("${ref.filename}")` : ''}. Conteúdo:\n${extracted}]`
  } catch {
    return `[O cliente enviou ${label}, mas não consegui ler o conteúdo (formato não suportado).]`
  }
}

app.post('/api/whatsapp/:provider/webhook/:channelId', async (req, res) => {
  // Ack immediately so the provider doesn't retry, then process in the background.
  res.status(200).json({ ok: true })

  const provider = String(req.params.provider)
  const channelId = String(req.params.channelId)
  if (!ObjectId.isValid(channelId)) return
  const adapter = getWhatsAppAdapter(provider)
  if (!adapter) return
  const channel = await getWidgetById(new ObjectId(channelId))
  if (!channel || channel.channel !== 'whatsapp' || channel.whatsapp?.provider !== provider) return

  // Drop forged deliveries when the provider supports authentication (Meta).
  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody
  const signature = req.headers['x-hub-signature-256']
  if (!authenticateWhatsAppInbound(channel, rawBody, typeof signature === 'string' ? signature : undefined)) {
    console.warn('WhatsApp inbound failed authentication for channel', channelId)
    return
  }

  let inbound
  try {
    inbound = adapter.parseInbound(req.body)
  } catch (error) {
    console.error('WhatsApp inbound parse failed:', error)
    return
  }

  for (const msg of inbound) {
    if (!msg.from) continue
    if (msg.externalId && (await inboundAlreadySeen(channel._id, msg.externalId))) continue
    // Media messages arrive with an empty/short text; turn the media into text.
    let text = msg.text
    if (msg.media) {
      const mediaText = await inboundMediaToText(channel, msg.media)
      text = [msg.text, mediaText].filter(Boolean).join('\n')
    }
    if (!text) continue
    const visitorMessage = await addMessage(channel._id, msg.from, 'visitor', text, null, msg.externalId || null)
    broadcastMessage(visitorMessage, channel.ownerId)
    respondWithAgentIfLinked(channel, msg.from, text).catch((error) =>
      console.error('WhatsApp auto-reply failed:', error),
    )
  }
})

app.get('/api/public/widgets/:publicKey', async (req, res) => {
  const widget = await getWidgetByPublicKey(req.params.publicKey)
  if (!widget) {
    res.status(404).json({ error: 'Widget not found' })
    return
  }
  const agent = await getWidgetConfigAgent(widget)
  res.json({
    name: widget.name,
    primaryColor: widget.primaryColor,
    welcomeTitle: widget.welcomeTitle,
    welcomeMessage: widget.welcomeMessage,
    position: widget.position,
    avatarUrl: widget.avatarUrl,
    conversationPersistence: agent?.conversationPersistence ?? 'same_browser',
    firstMessage: agent?.firstMessage ?? null,
  })
})

app.get('/api/public/widgets/:publicKey/messages', async (req, res) => {
  const widget = await getWidgetByPublicKey(req.params.publicKey)
  if (!widget) {
    res.status(404).json({ error: 'Widget not found' })
    return
  }
  const conversationId = String(req.query.conversationId ?? '')
  if (!conversationId) {
    res.status(400).json({ error: 'conversationId is required' })
    return
  }
  const messages = await listMessages(widget._id, conversationId)
  res.json(messages)
})

app.post('/api/public/widgets/:publicKey/messages', async (req, res) => {
  const widget = await getWidgetByPublicKey(req.params.publicKey)
  if (!widget) {
    res.status(404).json({ error: 'Widget not found' })
    return
  }
  const { conversationId, content } = req.body ?? {}
  if (!conversationId || !content) {
    res.status(400).json({ error: 'conversationId and content are required' })
    return
  }

  // Anti-abuse: cap visitor messages per conversation over a rolling 24h so a
  // spammed public widget can't run up the owner's LLM bill. 0 = unlimited.
  const limitAgent = await getWidgetConfigAgent(widget)
  const dailyLimit = limitAgent?.dailyMessageLimit ?? 0
  if (dailyLimit > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const sentToday = await countVisitorMessagesSince(widget._id, conversationId, since)
    if (sentToday >= dailyLimit) {
      res.status(429).json({ error: 'Daily message limit reached', limitReached: true })
      return
    }
  }

  const visitorMessage = await addMessage(widget._id, conversationId, 'visitor', content)
  broadcastMessage(visitorMessage, widget.ownerId)
  res.status(201).json([visitorMessage])

  // Fire-and-forget: the visitor's request doesn't wait on embeddings + Claude.
  // The reply (if any) arrives over the socket once it's ready.
  respondWithAgentIfLinked(widget, conversationId, content).catch((error) => {
    console.error('Agent auto-reply failed:', error)
  })
})

// Which model to use for background/utility calls: the cheap one when the
// agent's economy toggle is on (default), otherwise the agent's own model.
function auxModelFor(agent: WithId<Agent>): string | null {
  return agent.cheapAuxModel === false ? agent.model : auxiliaryModel(agent.provider)
}

// The line the adaptive planner reads for each specialist: its sector (if set)
// plus its routing hint, so routing can lean on the department.
function memberRoutingLine(member: SectorMember, agent: WithId<Agent>): string {
  const base = member.routingDescription.trim() || agent.objective.trim() || agent.name
  const sector = member.sector?.trim()
  return sector ? `[Setor: ${sector}] ${base}` : base
}

// The moves available out of a pipeline stage: its explicit transitions
// (skip/branch/back) plus the implicit linear advance to the next stage. Targets
// are indices into `resolved`; self-targets, out-of-range, and duplicates drop.
function buildStageTransitionOptions(
  resolved: { member: SectorMember; agent: WithId<Agent> }[],
  stageIndex: number,
): StageTransitionOption[] {
  const current = resolved[stageIndex]
  const options: StageTransitionOption[] = []
  const usedTargets = new Set<number>()
  for (const transition of current.member.transitions ?? []) {
    const target = resolved.findIndex((x) => x.agent._id.equals(transition.targetAgentId))
    if (target < 0 || target === stageIndex || usedTargets.has(target)) continue
    usedTargets.add(target)
    options.push({ target, targetName: resolved[target].agent.name, condition: transition.condition })
  }
  const next = stageIndex + 1
  if (next < resolved.length && current.member.advanceWhen.trim() && !usedTargets.has(next)) {
    options.push({ target: next, targetName: resolved[next].agent.name, condition: current.member.advanceWhen })
  }
  return options
}

interface SectorTurn {
  // The default member supplies the sector voice + memory/identity/guardrail config.
  configAgent: WithId<Agent>
  // A unified objective merging the consulted specialists' expertise.
  replyObjective: string
  // Whose knowledge bases to search (the consulted specialists). Empty on clarify.
  knowledgeAgentIds: ObjectId[]
  // Consulted specialist names, for owner-side attribution in Chats.
  replyAgentName: string
  // Non-null when the supervisor decided the message is too ambiguous to answer.
  clarificationTopics: string[] | null
}

// Adaptive supervisor: on each turn a cheap planner decides which specialists
// (one or several) have the info to answer — or that the message is ambiguous.
// The visitor always gets ONE unified reply in a single voice; the specialists
// are internal. Sticky: the planner is told the current specialists so it keeps
// them while the topic holds.
async function resolveSectorTurn(
  widget: WithId<Widget>,
  sectorId: ObjectId,
  conversationId: string,
  visitorContent: string,
): Promise<SectorTurn | null> {
  const ownerId = widget.ownerId
  const widgetId = widget._id
  const sector = await getSectorById(ownerId, sectorId)
  if (!sector || sector.members.length === 0) return null

  const resolved = (
    await Promise.all(
      sector.members.map(async (m) => ({ member: m, agent: await getAgentById(ownerId, m.agentId) })),
    )
  ).filter((x): x is { member: SectorMember; agent: WithId<Agent> } => x.agent !== null)
  if (resolved.length === 0) return null

  const defaultIndex = Math.max(
    0,
    resolved.findIndex((x) => x.member.isDefault),
  )
  const configAgent = resolved[defaultIndex].agent
  const sectorObjectiveFor = (chosen: { member: SectorMember; agent: WithId<Agent> }[]) =>
    buildSectorObjective(
      sector.name,
      chosen.map((x) => ({ name: x.agent.name, objective: x.agent.objective })),
    )

  // Single-member sector: no planning needed.
  if (resolved.length === 1) {
    await setActiveAgentId(widgetId, conversationId, resolved[0].agent._id)
    await logSectorDecision({
      ownerId,
      sectorId,
      widgetId,
      conversationId,
      specialists: [resolved[0].agent.name],
      clarify: false,
    })
    return {
      configAgent,
      replyObjective: sectorObjectiveFor(resolved),
      knowledgeAgentIds: [resolved[0].agent._id],
      replyAgentName: resolved[0].agent.name,
      clarificationTopics: null,
    }
  }

  // Pipeline mode: ordered stages. The active stage answers; a planner may first
  // move the flow to another stage — the next one (advance), a later one (skip),
  // an alternative (branch), or an earlier one (back) — when a transition's
  // condition is met. At most one move per turn, and the visitor never perceives
  // the switch: each stage speaks as one continuous assistant.
  if ((normalizeSectorMode(sector.mode)) === 'pipeline') {
    const activeAgentId = await getActiveAgentId(widgetId, conversationId)
    let stageIndex = activeAgentId ? resolved.findIndex((x) => x.agent._id.equals(activeAgentId)) : 0
    if (stageIndex < 0) stageIndex = 0

    const recent = await listMessages(widgetId, conversationId)
    const advanceHistory: ChatTurn[] = recent.slice(-8).map((m) => ({
      role: m.role === 'visitor' ? 'user' : 'assistant',
      content: m.content,
    }))
    const apiKey = await getProviderApiKey(ownerId, configAgent.provider)

    let fromStage: string | null = null
    const options = buildStageTransitionOptions(resolved, stageIndex)
    if (options.length > 0) {
      let target = -1
      try {
        target = await planStageTransition(
          resolved[stageIndex].agent.name,
          resolved[stageIndex].member.routingDescription,
          options,
          advanceHistory,
          visitorContent,
          configAgent.provider,
          auxModelFor(configAgent),
          apiKey,
        )
      } catch (error) {
        console.error('Stage transition planning failed, staying on current stage:', error)
      }
      if (target >= 0 && target !== stageIndex) {
        fromStage = resolved[stageIndex].agent.name
        stageIndex = target
      }
    }

    const stage = resolved[stageIndex]
    await setActiveAgentId(widgetId, conversationId, stage.agent._id)
    await logSectorDecision({
      ownerId,
      sectorId,
      widgetId,
      conversationId,
      specialists: [stage.agent.name],
      clarify: false,
      mode: 'pipeline',
      advanced: fromStage !== null,
      fromStage,
    })
    return {
      configAgent,
      replyObjective: buildPipelineStageObjective(sector.name, {
        name: stage.agent.name,
        objective: stage.agent.objective,
        stageGoal: stage.member.routingDescription,
      }),
      knowledgeAgentIds: [stage.agent._id],
      replyAgentName: stage.agent.name,
      clarificationTopics: null,
    }
  }

  const options: RouterOption[] = resolved.map((x, i) => ({
    index: i,
    name: x.agent.name,
    description: memberRoutingLine(x.member, x.agent),
  }))

  const activeAgentId = await getActiveAgentId(widgetId, conversationId)
  const currentIndices = activeAgentId
    ? resolved.flatMap((x, i) => (x.agent._id.equals(activeAgentId) ? [i] : []))
    : []

  const recent = await listMessages(widgetId, conversationId)
  const planHistory: ChatTurn[] = recent.slice(-6).map((m) => ({
    role: m.role === 'visitor' ? 'user' : 'assistant',
    content: m.content,
  }))

  const apiKey = await getProviderApiKey(ownerId, configAgent.provider)
  let plan = { specialists: [defaultIndex], clarify: false }
  try {
    plan = await planSectorResponse(
      options,
      currentIndices,
      defaultIndex,
      planHistory,
      visitorContent,
      configAgent.provider,
      auxModelFor(configAgent),
      apiKey,
    )
  } catch (error) {
    console.error('Sector planning failed, using default specialist:', error)
  }

  if (plan.clarify) {
    await logSectorDecision({ ownerId, sectorId, widgetId, conversationId, specialists: [], clarify: true })
    return {
      configAgent,
      replyObjective: sectorObjectiveFor(resolved),
      knowledgeAgentIds: [],
      replyAgentName: sector.name,
      clarificationTopics: resolved.map((x) => x.member.routingDescription.trim() || x.agent.name),
    }
  }

  const chosen = plan.specialists.map((i) => resolved[i]).filter(Boolean)
  if (chosen.length === 0) chosen.push(resolved[defaultIndex])
  const names = chosen.map((x) => x.agent.name)
  await logSectorDecision({ ownerId, sectorId, widgetId, conversationId, specialists: names, clarify: false })
  await setActiveAgentId(widgetId, conversationId, chosen[0].agent._id)

  return {
    configAgent,
    replyObjective: sectorObjectiveFor(chosen),
    knowledgeAgentIds: chosen.map((x) => x.agent._id),
    replyAgentName: names.join(' + '),
    clarificationTopics: null,
  }
}

async function respondWithAgentIfLinked(widget: WithId<Widget>, conversationId: string, visitorContent: string) {
  const widgetId = widget._id
  const ownerId = widget.ownerId

  // A human took over (or the agent requested handoff earlier) — stay silent
  // until the owner hands the conversation back to the agent.
  if (await getHumanHandoff(widgetId, conversationId)) return

  // Optional monthly token budget: once the owner is over their cap, stop all
  // auto-replies (checked before any LLM call, so spend truly halts at zero).
  const monthlyCap = await getMonthlyTokenCap(ownerId)
  if (monthlyCap > 0 && (await getMonthlyTokens(ownerId)) >= monthlyCap) {
    console.warn(`Monthly token cap reached for owner ${ownerId}; skipping auto-reply.`)
    return
  }

  // Resolve who answers. Single agent: itself. Sector: the adaptive supervisor
  // picks the specialists (or asks to clarify) and merges them into one voice.
  let agent: WithId<Agent>
  let replyObjective: string
  let knowledgeAgentIds: ObjectId[]
  let replyAgentName: string | null
  let clarificationTopics: string[] | null
  if (widget.sectorId) {
    const turn = await resolveSectorTurn(widget, widget.sectorId, conversationId, visitorContent)
    if (!turn) return
    agent = turn.configAgent
    replyObjective = turn.replyObjective
    knowledgeAgentIds = turn.knowledgeAgentIds
    replyAgentName = turn.replyAgentName
    clarificationTopics = turn.clarificationTopics
  } else {
    const single = widget.agentId ? await getAgentById(ownerId, widget.agentId) : null
    if (!single) return
    agent = single
    replyObjective = single.objective
    knowledgeAgentIds = [single._id]
    replyAgentName = null
    clarificationTopics = null
  }

  const memoryType = agent.memoryType ?? 'none'
  const identityFields = agent.identityEnabled ? (agent.identityFields ?? []) : []
  const guardrailMode = agent.guardrailMode ?? 'none'

  // Keep the raw window short — a compact per-conversation memory (below)
  // carries older context forward instead of resending the whole history.
  const recentMessages = await listMessages(widgetId, conversationId)
  const historyLimit = agent.historyLimit ?? DEFAULT_HISTORY_LIMIT
  const history: ChatTurn[] = recentMessages.slice(-historyLimit).map((message) => ({
    role: message.role === 'visitor' ? 'user' : 'assistant',
    content: message.content,
  }))

  const apiKey = await getProviderApiKey(ownerId, agent.provider)

  if (guardrailMode === 'verification') {
    // A failed check fails open (treats the message as in-scope) rather than
    // silently refusing every visitor if the classification call errors out.
    let inScope = true
    try {
      inScope = await checkGuardrail(
        replyObjective,
        history,
        visitorContent,
        agent.provider,
        auxModelFor(agent),
        apiKey,
      )
    } catch (error) {
      console.error('Guardrail check failed, allowing the message through:', error)
    }
    if (!inScope) {
      const refusal = await addMessage(widgetId, conversationId, 'agent', GUARDRAIL_REFUSAL_MESSAGE, replyAgentName)
      broadcastMessage(refusal, ownerId)
      return
    }
  }

  // Ground the reply in the knowledge base(s) of the responding agent — or of
  // every consulted specialist, for a sector. Skipped when only clarifying.
  // Only a SECTOR-answered channel reads the sector's shared base; a widget wired
  // straight to one agent stays on that agent's own knowledge.
  const { context: knowledge } = await retrieveContext(knowledgeAgentIds, visitorContent, { verifiedSectorId: widget.sectorId ?? null })

  // If a previous turn in this conversation already resolved who the
  // visitor is, their memory lives on the profile (shared across every
  // conversation/device they use), not on this one conversation.
  const visitorProfileId = await getLinkedVisitorProfileId(widgetId, conversationId)
  const visitorProfile = visitorProfileId ? await getVisitorProfile(visitorProfileId) : null

  let memoryText = ''
  if (memoryType === 'facts') {
    memoryText = visitorProfile ? visitorProfile.memory : await getConversationMemory(widgetId, conversationId)
  } else if (memoryType === 'structured') {
    const structured = visitorProfile
      ? visitorProfile.structuredMemory
      : await getStructuredMemory(widgetId, conversationId)
    memoryText = formatStructuredMemory(structured)
  } else if (memoryType === 'semantic') {
    try {
      const relevant = await searchRelevantTurns(agent._id, conversationId, visitorContent)
      memoryText = relevant
        .map((turn) => `${turn.role === 'visitor' ? 'Visitante' : 'Agente'}: ${turn.content}`)
        .join('\n')
    } catch (error) {
      console.error('Semantic memory search failed, replying without it:', error)
    }
  }

  const identityInstruction =
    identityFields.length > 0 && !visitorProfile ? buildIdentityCaptureInstruction(identityFields) : ''
  // Handoff and proactivity ride in the same behavior-instruction slot as the
  // scope guardrail — they're all conduct rules layered onto the objective.
  // For a sector, a clarification instruction may override "answer" with "ask".
  const behaviorInstruction = [
    guardrailMode === 'prompt' ? GUARDRAIL_SCOPE_INSTRUCTION : '',
    agent.handoffEnabled ? HANDOFF_INSTRUCTION : '',
    agent.proactivityEnabled ? buildProactivityInstruction(agent.proactivityGuidance ?? '') : '',
    clarificationTopics ? buildClarificationInstruction(clarificationTopics) : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const responseStyleInstruction = [
    buildLanguageInstruction(agent.language ?? 'pt'),
    buildResponseStyleInstruction(
      agent.responseTone ?? 'neutral',
      agent.responseDetail ?? 'balanced',
      agent.responseEmojis ?? false,
      agent.responseFormatting ?? false,
    ),
  ].join('\n\n')

  const channelStartedAt = new Date()
  // The sector path runs ONE inference with configAgent's provider/model/tools —
  // that agent is the real executor; the consulted specialists are recorded as
  // 'consulted' (sector decision log), never as executors.
  const channelEventBase = {
    ownerId,
    agentId: agent._id,
    floorId: agent.officeId,
    source: 'channel' as const,
    preset: agent.preset,
    startedAt: channelStartedAt,
  }
  const recordChannel = async (eventKey: string, status: 'succeeded' | 'failed' | 'timeout', u?: { inputTokens: number; outputTokens: number }, okToolCalls = 0, extra: Record<string, string | number | boolean> = {}) => {
    const floor = await getFloor(ownerId, agent.officeId).catch(() => null)
    recordAgentEventSafe({
      ...channelEventBase,
      eventKey,
      buildingId: floor?.buildingId ?? null,
      status,
      finishedAt: new Date(),
      inputTokens: u?.inputTokens ?? 0,
      outputTokens: u?.outputTokens ?? 0,
      toolCalls: okToolCalls,
      metadata: { channel: widget.channel ?? 'web', ...(widget.sectorId ? { sectorId: widget.sectorId.toString(), consulted: replyAgentName ?? '' } : {}), ...extra },
    })
  }

  let generatedReply: string
  let usage: { inputTokens: number; outputTokens: number }
  let toolCalls: Awaited<ReturnType<typeof generateAgentReply>>['toolCalls']
  try {
    const channelResult = await generateAgentReply(
    replyObjective,
    knowledge,
    memoryText,
    history,
    agent.provider,
    agent.model,
    apiKey,
    identityInstruction,
    behaviorInstruction,
    responseStyleInstruction,
    agent.promptCaching ?? true,
    await resolveAgentTools(agent, ownerId),
    )
    generatedReply = channelResult.text
    usage = channelResult.usage
    toolCalls = channelResult.toolCalls
  } catch (error) {
    // Functional behaviour unchanged (the caller still sees the failure); the
    // outcome is simply no longer invisible in the agent's history.
    void recordChannel(`msg-fail:${widgetId.toString()}:${conversationId}:${channelStartedAt.getTime()}`, /timeout|timed out|exceeded/i.test((error as Error).message ?? '') ? 'timeout' : 'failed')
    throw error
  }
  recordReplyUsage(ownerId, usage).catch((error) => console.error('Failed to record token usage:', error))
  logToolCalls(widgetId, conversationId, toolCalls).catch((error) =>
    console.error('Failed to log tool calls:', error),
  )
  let replyText = generatedReply
  if (!replyText) return

  let handoffRequested = false
  if (agent.handoffEnabled && replyText.trimStart().startsWith(HANDOFF_MARKER)) {
    handoffRequested = true
    replyText =
      replyText.trimStart().slice(HANDOFF_MARKER.length).trim() ||
      'Vou chamar um atendente humano para continuar com você — só um momento!'
  }

  const agentMessage = await addMessage(widgetId, conversationId, 'agent', replyText, replyAgentName)
  broadcastMessage(agentMessage, ownerId)
  // Channel telemetry: the REAL executor of this reply, keyed by the agent message
  // id so a re-broadcast never double-counts. Only completed tool calls count.
  void recordChannel(`msg:${agentMessage._id.toString()}`, 'succeeded', usage, toolCalls.filter((c) => c.ok).length)
  // On a WhatsApp channel the socket only feeds the owner's Chats view; the
  // customer gets the reply through the provider. conversationId is their number.
  if (widget.channel === 'whatsapp') {
    sendWhatsAppText(widget, conversationId, replyText).catch((error) =>
      console.error('WhatsApp reply delivery failed:', error),
    )
  }

  if (handoffRequested) {
    await setHumanHandoff(widgetId, conversationId, true)
    // broadcastMessage above already pinged the owner's conversation list;
    // from here on the early-return at the top keeps the agent silent.
  }

  // Fire-and-forget: none of this background bookkeeping should block the
  // reply the visitor is waiting on.
  refreshMemoryAndIdentity({
    agent,
    memoryType,
    identityFields,
    widgetId,
    conversationId,
    visitorProfileId: visitorProfile?._id ?? null,
    history,
    visitorContent,
    replyText,
    apiKey,
  }).catch((error) => {
    console.error('Failed to update conversation memory/identity:', error)
  })
}

async function refreshMemoryAndIdentity(params: {
  agent: WithId<Agent>
  memoryType: MemoryType
  identityFields: string[]
  widgetId: ObjectId
  conversationId: string
  visitorProfileId: ObjectId | null
  history: ChatTurn[]
  visitorContent: string
  replyText: string
  apiKey: string | null
}) {
  const { agent, memoryType, identityFields, widgetId, conversationId, history, visitorContent, replyText, apiKey } =
    params
  if (!agent) return
  let visitorProfileId = params.visitorProfileId

  // Resolve identity first (if configured and not yet linked) so a
  // freshly-created profile can receive this turn's memory update too.
  if (identityFields.length > 0 && !visitorProfileId) {
    const extracted = await extractIdentity(
      identityFields,
      [...history, { role: 'user', content: visitorContent }],
      agent.provider,
      auxModelFor(agent),
      apiKey,
    )
    if (extracted) {
      const identityKey = computeIdentityKey(identityFields, extracted)
      if (identityKey) {
        const existingProfile = await findVisitorProfile(agent._id, identityKey)
        const profile = await upsertVisitorProfile(agent._id, identityKey, extracted)
        if (profile) {
          visitorProfileId = profile._id
          await linkVisitorProfile(widgetId, conversationId, profile._id)

          // Seed a brand-new profile with whatever this conversation had
          // accumulated so far, so nothing said before identification is lost.
          if (!existingProfile) {
            if (memoryType === 'facts') {
              const existing = await getConversationMemory(widgetId, conversationId)
              if (existing) await setVisitorProfileMemory(profile._id, existing)
            } else if (memoryType === 'structured') {
              const existing = await getStructuredMemory(widgetId, conversationId)
              if (Object.keys(existing).length > 0) {
                await setVisitorProfileStructuredMemory(profile._id, existing)
              }
            }
          }
        }
      }
    }
  }

  if (memoryType === 'facts') {
    const current = visitorProfileId
      ? ((await getVisitorProfile(visitorProfileId))?.memory ?? '')
      : await getConversationMemory(widgetId, conversationId)
    const updated = await updateConversationMemory(
      current,
      visitorContent,
      replyText,
      agent.provider,
      auxModelFor(agent),
      apiKey,
    )
    if (visitorProfileId) await setVisitorProfileMemory(visitorProfileId, updated)
    else await setConversationMemory(widgetId, conversationId, updated)
  } else if (memoryType === 'structured') {
    const current = visitorProfileId
      ? ((await getVisitorProfile(visitorProfileId))?.structuredMemory ?? {})
      : await getStructuredMemory(widgetId, conversationId)
    const updated = await updateStructuredMemory(
      current,
      visitorContent,
      replyText,
      agent.provider,
      auxModelFor(agent),
      apiKey,
    )
    if (visitorProfileId) await setVisitorProfileStructuredMemory(visitorProfileId, updated)
    else await setStructuredMemory(widgetId, conversationId, updated)
  } else if (memoryType === 'semantic') {
    await recordTurn(agent._id, widgetId, conversationId, 'visitor', visitorContent)
    await recordTurn(agent._id, widgetId, conversationId, 'agent', replyText)
  }

  if (agent.structuredOutputEnabled && (agent.structuredOutputFields?.length ?? 0) > 0) {
    const fields = agent.structuredOutputFields
    const current = visitorProfileId
      ? ((await getVisitorProfile(visitorProfileId))?.structuredOutputData ?? {})
      : await getStructuredOutputData(widgetId, conversationId)
    const updated = await extractStructuredOutput(
      fields,
      current,
      visitorContent,
      replyText,
      agent.provider,
      auxModelFor(agent),
      apiKey,
    )

    if (JSON.stringify(updated) !== JSON.stringify(current)) {
      if (visitorProfileId) await setVisitorProfileStructuredOutputData(visitorProfileId, updated)
      else await setStructuredOutputData(widgetId, conversationId, updated)

      if (agent.structuredOutputWebhookUrl) {
        sendStructuredOutputWebhook(agent.structuredOutputWebhookUrl, {
          agentId: agent._id.toString(),
          widgetId: widgetId.toString(),
          conversationId,
          data: updated,
          updatedAt: new Date().toISOString(),
        }).catch((error) => {
          console.error('Structured output webhook delivery failed:', error)
        })
      }
    }
  }
}

async function sendStructuredOutputWebhook(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    console.error(`Structured output webhook returned ${response.status} for ${url}`)
  }
}

async function start() {
  // Fail fast in production if a deploy-critical env var is missing/invalid.
  validateConfig()

  await mongoClient.connect()

  // Sector renames + Escritório hierarchy backfill. Awaited so a collection
  // rename completes before we serve requests against the new names.
  await runMigrations()

  // Don't hold up accepting connections on this — it's a one-time setup
  // step (a no-op after the first successful run) and unrelated routes
  // shouldn't pay its round-trip to Atlas on every dev-server restart.
  ensureVectorIndex().catch((error) => {
    console.error('ensureVectorIndex failed:', error)
  })
  ensureConversationTurnsVectorIndex().catch((error) => {
    console.error('ensureConversationTurnsVectorIndex failed:', error)
  })
  ensureDelegationIndexes().catch((error) => {
    console.error('ensureDelegationIndexes failed:', error)
  })
  ensureAgentEventIndexes().catch((error) => {
    console.error('ensureAgentEventIndexes failed:', error)
  })
  // Legacy events predate per-attempt accounting; stamp seenAttempts/latestAttempt so
  // the atomic guards apply to them too. Idempotent.
  backfillAgentEventAttempts()
    .then((n) => n && console.log(`Backfilled attempt bookkeeping on ${n} agent event(s)`))
    .catch((error) => console.error('backfillAgentEventAttempts failed:', error))
  ensureTokenUsageIndexes().catch((error) => {
    console.error('ensureTokenUsageIndexes failed:', error)
  })
  // Recover any charge whose key landed but whose daily rollup didn't (crash window).
  settlePendingCharges()
    .then((n) => n && console.log(`Settled ${n} pending token charge(s)`))
    .catch((error) => console.error('settlePendingCharges failed:', error))
  ensureKnowledgeIndexes().catch((error) => {
    console.error('ensureKnowledgeIndexes failed:', error)
  })
  // Indexes behind the Central de execuções listings.
  ensureExecutionIndexes().catch((error) => {
    console.error('ensureExecutionIndexes failed:', error)
  })
  ensureAuditIndexes().catch((error) => {
    console.error('ensureAuditIndexes failed:', error)
  })
  // Idempotent, non-destructive: stamps ownerType/ownerId on knowledge written
  // before sectors could own a base. Safe to run on every boot.
  backfillKnowledgeOwners()
    .then((r) => {
      if (r.documents || r.chunks) console.log(`Knowledge owner backfill: ${r.documents} documents, ${r.chunks} chunks`)
    })
    .catch((error) => console.error('backfillKnowledgeOwners failed:', error))

  // The automation engine runs INSIDE the API by default: one deployable service,
  // and no way to deploy a system whose routines silently never fire. Set
  // EMBEDDED_WORKER=false to run `npm run start:worker` as a separate process.
  // A failure here is NEVER swallowed: it is logged and it keeps /api/ready red, so
  // an instance that cannot run routines never takes traffic as if it could.
  await startEmbeddedEngine()

  httpServer.listen(port, () => {
    console.log(`Backend listening on port ${port} (${config.nodeEnv})`)
  })
}

// Graceful shutdown: stop accepting connections, close Socket.IO, then Mongo, so
// SIGTERM from the orchestrator drains cleanly instead of a hard kill.
let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Received ${signal}, shutting down gracefully (up to ${config.shutdownTimeoutMs}ms)...`)
  // Emergency brake, deliberately below the orchestrator's stop_grace_period. If it
  // ever fires, in-flight runs stay RECOVERABLE: they keep their lease, it expires,
  // and another instance reclaims them — accounting is keyed per attempt, so a
  // reclaim never charges twice.
  const forced = setTimeout(() => {
    console.error('Shutdown timed out — forcing exit')
    process.exit(1)
  }, config.shutdownTimeoutMs)
  forced.unref()
  try {
    io.close()
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    // Stop claiming new runs and let the in-flight ones finish (their leases are
    // renewed meanwhile, so nothing steals them) before the database goes.
    await stopEmbeddedEngine()
    await mongoClient.close()
    console.log('Shutdown complete')
    process.exit(0)
  } catch (error) {
    console.error('Error during shutdown:', error)
    process.exit(1)
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

start().catch((error) => {
  console.error('Fatal startup error:', error)
  process.exit(1)
})
