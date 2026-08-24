import 'dotenv/config'
import { createTool, deleteTool, getTool, listTools, toPublicTool, ToolValidationError, UNSAFE_METHODS, updateTool } from './tools.js'
import { executeToolCall } from './toolExecution.js'
import { MASKED_HEADER_VALUE, pullToolFromAgents, toPublicAgent } from './agents.js'
import { resolveWidgetDestination } from './widgetDestination.js'
import { webChatAccessFor } from './apps/publicChannelAccess.js'
import { listPublicFunctions } from './executors/functionRegistry.js'
import { listAppsForOwner } from './apps/privateApps.js'
import { resolveRuntimeDestination } from './widgetRuntimeDestination.js'
import { listWidgetsBySector } from './widgets.js'
import { readiness, startEmbeddedEngine, stopEmbeddedEngine } from './automations/engine.js'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import cors from 'cors'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import { ObjectId } from 'mongodb'
import { normalizeRunConfig } from './runConfig.js'
import { composeAgentPrompt, resolveAgentRun } from './agentDefinition.js'
import { describeDropped, runInteractive } from './interactiveRun.js'
import { AgentRunError } from './agentRuntime.js'
import { executeSectorTeam, sectorRunContext } from './delegation.js'
import type { DelegationDeps } from './delegation.js'
import { playgroundDelegationDeps } from './delegationWiring.js'
import { finishSectorExecution, startSectorExecution } from './sectorExecutions.js'
import { livePassagesFor } from './automations/liveSources.js'
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
  getHumanHandoff,
  getLinkedVisitorProfileId,
  getConversationMemory,
  getStructuredMemory,
  getStructuredOutputData,
  linkVisitorProfile,
  setConversationMemory,
  setHumanHandoff,
  setStructuredMemory,
  setStructuredOutputData,
} from './conversationMemory.js'
import { createSector, deleteSector, enforceSingleMembership, stageConflicts, getSectorById, listSectors, normalizeSectorMode, sectorIsExecutable, sectorReadiness, SECTOR_MODES, updateSector } from './sectors.js'
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
  listDocumentsPage,
  reindexDocumentFor,
  updateDocument,
} from './knowledge.js'
import {
  auxiliaryModel,
  defaultModel,
  checkGuardrail,
  extractIdentity,
  extractStructuredOutput,
  generateAgentReply,
  listModelsForProvider,
  PROVIDER_IDS,
  PROVIDER_INFO,
  updateConversationMemory,
  updateStructuredMemory,
} from './llm.js'
import type { ChatTurn, Provider } from './llm.js'
import type { RouterOption, StageTransitionOption } from './systemPrompt.js'
import { aggregateSectorDecisions, listSectorDecisionsForConversation } from './sectorDecisions.js'
import {
  buildClarificationInstruction,
  buildIdentityCaptureInstruction,
  buildLanguageInstruction,
  buildProactivityInstruction,
  buildResponseStyleInstruction,
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
import { embeddingBudgetConfig, embeddingUsageReport, ensureEmbeddingUsageIndexes } from './embeddings/budget.js'
import { activeSearchProvider, configuredProviderName } from './webSearch/provider.js'
import { ensureWebSearchIndexes, searchBudgetConfig, searchBudgetStatus } from './webSearch/budget.js'
import { VOYAGE_MODELS, voyageFallbackModel, voyageModel } from './voyage.js'
import { ensureTokenUsageIndexes, getMonthlyTokens, getUsageSummary, recordReplyUsage, settlePendingCharges } from './tokenUsage.js'
import { backfillAgentEventAttempts, ensureAgentEventIndexes, recordAgentEventSafe, telemetrySince } from './agentEvents.js'
import { channelExecutionKey, finishExecutionRoot, manualExecutionKey, openRunningRoot } from './executionRoots.js'
import { agentReadiness, callerPolicyFromLegacy, sanitizeCollaborationRefs, triggerStates } from './agentReadiness.js'
import { collaboratorContext, collaboratorCountFor } from './collaboration.js'
import type { CollaboratorContext } from './collaboration.js'
import type { AgentWiring } from './agentReadiness.js'
import { listRoutines, readSourceFromDefinition } from './automations/routine.js'
import { liveWebhookCountByAgent } from './automations/webhookTriggers.js'
import { listActivePublished } from './automations/repository.js'
import { sentDeliveriesByAgent } from './connections/repository.js'
import { sectorKnowledgeRouter } from './routes/sectorKnowledgeRoutes.js'
import { sectorExecutionRouter } from './routes/sectorExecutionRoutes.js'
import type { GroundingStatus, KnowledgeOwner } from './knowledge.js'
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
import { memoryRouter } from './routes/memoryRoutes.js'
import { connectionRouter } from './routes/connectionRoutes.js'
import { appCatalogRouter, navigationPreferencesRouter } from './routes/appRoutes.js'
import { privateAppRouter } from './routes/privateAppRoutes.js'
import { appInstallationRouter } from './routes/appInstallationRoutes.js'
import { appGrantRouter } from './routes/appGrantRoutes.js'
import { ensureGoogleInstallation, revokeGoogleInstallation } from './apps/migration.js'
import { webhookRouter } from './routes/webhookRoutes.js'
import { AUTO_MODEL, resolveAutoModel } from './autoModel.js'
import { clarificationFrom, countClarifications } from './clarify.js'
import { clarificationGuidance } from './clarifyBudget.js'
import { recallClarifications, rememberClarification } from './clarifyMemory.js'
import { formatOptions, resolveChoice } from './clarifyChoice.js'
import type { ClarificationRequest } from './clarify.js'
import { checkScope } from './scopeGate.js'
import { appendPlaygroundTurns, clearPlaygroundTurns, loadPlaygroundTurns } from './playgroundSession.js'
import type { PlaygroundTurn } from './playgroundSession.js'
import { NOOP_TRACKER, createLiveTracker, instrumentTools } from './agentLiveTracker.js'
import { onTraceEvent, preview as tracePreview, readTrace, traceEvent } from './executionTrace.js'
import type { TraceInput } from './executionTrace.js'
import { ensureFreshWithTimeout, ignoreWebUrl } from './webKnowledge.js'

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
    // `ETag` is NOT a CORS-safelisted response header: without exposing it, a
    // cross-origin frontend reads `null` and can never send `If-None-Match` — the
    // 304 path would exist on the server and never be used by the browser.
    const exposedHeaders = ['ETag']
    callback(
      null,
      isPublicWidgetRoute
        ? { origin: true, credentials: false, exposedHeaders }
        : { origin: config.clientOrigins, credentials: true, exposedHeaders },
    )
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

/**
 * O painel de acompanhamento recebe os eventos pelo socket que já existe — sala do dono,
 * autenticada no `join-owner`. Sem sondagem, sem endpoint novo de tempo real, e sem que
 * a execução conheça o transporte: ela chama `traceEvent`, e a entrega é assunto daqui.
 */
onTraceEvent((evento, ownerId) => {
  io.to(`owner:${ownerId}`).emit('execution-trace', evento)
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
app.use('/api/memories', requireAuth, memoryRouter)
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
      // Qual modelo roda quando ninguém escolhe, e qual roda nas tarefas de bastidor. A
      // tela precisa DIZER isso: "Padrão do sistema" não informa nada a quem paga a conta.
      return {
        id: provider.id,
        label: provider.label,
        models,
        defaultModel: defaultModel(provider.id),
        auxiliaryModel: auxiliaryModel(provider.id),
      }
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

/**
 * O estado da franquia de embedding: quanto foi usado, quanto resta, e a que custo.
 *
 * É de instalação, não de dono: a franquia pertence à conta do provedor, e trocar de
 * usuário logado não troca de fatura. Por isso os números são os mesmos para todos —
 * qualquer sessão autenticada vê o mesmo painel.
 *
 * Nada aqui devolve chave, cabeçalho ou corpo de resposta de terceiro.
 */
app.get('/api/settings/embeddings', requireAuth, async (_req, res) => {
  const cfg = embeddingBudgetConfig()
  const relatorio = await embeddingUsageReport(cfg, voyageModel(), voyageFallbackModel())
  res.json({
    ...relatorio,
    availableModels: [...VOYAGE_MODELS],
    // A chave está configurada? Só isso — nunca o valor, nem um prefixo dele.
    configured: Boolean(process.env.VOYAGE_API_KEY),
  })
})

/**
 * O estado da busca na web: provedor, uso do mês e quanto resta.
 *
 * Devolve OITO campos e nada mais. Nem a chave, nem um pedaço dela, nem o nome da
 * variável — `configured` é tudo o que se diz sobre a credencial: existe ou não existe.
 *
 * Os números são desta INSTALAÇÃO. Se a mesma chave for usada em outro lugar, aquelas
 * chamadas não passam por aqui e este contador não as conhece — a tela diz isso.
 */
/**
 * O que um agente PODE ser configurado para executar.
 *
 * Só leitura, e só o que descreve: nome, versão, descrição, competências e os schemas de
 * entrada e saída. O `handler` é código e não sai daqui; nenhuma credencial passa por
 * aqui, nem o nome de uma.
 *
 * As ações de App vêm do catálogo já resolvido para ESTE dono, com o mesmo escopo que o
 * resto do sistema usa — um App privado de outra conta não aparece.
 */
app.get('/api/executors/catalog', requireAuth, async (_req, res) => {
  const funcoes = listPublicFunctions()
  const apps = await listAppsForOwner(res.locals.userId).catch(() => [])
  res.json({
    functions: funcoes,
    // Referência apenas: chave do App e chave da ação. Quem autoriza continua sendo o
    // grant do agente, não esta lista.
    actions: apps.flatMap((app) =>
      (app.actions ?? []).map((a) => ({
        appKey: app.key,
        appName: app.name,
        actionKey: a.key,
        name: a.name,
        description: a.description,
        risk: a.risk,
        inputSchema: a.inputSchema,
      })),
    ),
  })
})

app.get('/api/settings/web-search', requireAuth, async (_req, res) => {
  const provider = configuredProviderName()
  const cfg = searchBudgetConfig()
  res.json(await searchBudgetStatus(provider, Boolean(activeSearchProvider()), cfg))
})

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

/**
 * Quem vai atender este chat — decidido no servidor, não só na tela.
 *
 * A tela é UMA das formas de chegar aqui. Sem esta verificação, uma requisição direta
 * criava um widget sem destino (que engole mensagem em silêncio), com os dois destinos
 * ao mesmo tempo, ou apontado para um setor que só organiza o mapa e não executa nada.
 */
async function resolverDestinoDoWidget(
  ownerId: string,
  entrada: { agentId?: unknown; sectorId?: unknown },
): Promise<{ ok: true; agentId: ObjectId | null; sectorId: ObjectId | null } | { ok: false; status: number; error: string; code?: string }> {
  const temAgente = typeof entrada.agentId === 'string' && entrada.agentId.length > 0
  const temSetor = typeof entrada.sectorId === 'string' && entrada.sectorId.length > 0

  if (temAgente && temSetor) {
    return { ok: false, status: 400, code: 'destination_conflict', error: 'Escolha um agente OU um setor para atender — não os dois.' }
  }
  if (!temAgente && !temSetor) {
    return { ok: false, status: 400, code: 'destination_required', error: 'Escolha quem vai atender este chat: um agente ou um setor.' }
  }

  if (temAgente) {
    const { agentObjectId, error } = await resolveOwnedAgentId(ownerId, entrada.agentId)
    if (error || !agentObjectId) return { ok: false, status: 400, code: 'invalid_agent', error: error ?? 'Agent not found' }
    const veredito = resolveWidgetDestination({ agentId: agentObjectId, agentPresent: true })
    if (!veredito.ok) return { ok: false, status: 400, code: veredito.code, error: veredito.reason! }
    // Trocar de destino LIMPA o outro lado, e é por isso que os dois campos vêm daqui.
    return { ok: true, agentId: veredito.destination!.agentId, sectorId: null }
  }

  const { sectorObjectId, error: sectorError } = await resolveOwnedSectorId(ownerId, entrada.sectorId)
  if (sectorError || !sectorObjectId) return { ok: false, status: 400, code: 'invalid_sector', error: sectorError ?? 'Sector not found' }
  const sector = await getSectorById(ownerId, sectorObjectId)
  if (!sector) return { ok: false, status: 400, code: 'invalid_sector', error: 'Sector not found' }

  // Os agentes que existem: uma etapa apontando para agente removido não é executável.
  const doDono = await listAgents(ownerId)
  const veredito = resolveWidgetDestination({
    sectorId: sectorObjectId,
    sector: {
      _id: sector._id,
      name: sector.name,
      mode: sector.mode,
      members: sector.members ?? [],
      coordinatorAgentId: sector.coordinatorAgentId ?? null,
      stages: sector.stages ?? [],
      knownAgentIds: doDono.map((a) => a._id.toString()),
      archivedAt: (sector as { archivedAt?: Date | null }).archivedAt ?? null,
    },
  })
  if (!veredito.ok) return { ok: false, status: 400, code: veredito.code, error: veredito.reason! }
  return { ok: true, agentId: null, sectorId: veredito.destination!.sectorId }
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

  // Um destino, obrigatório e único. Sem isto, um widget podia nascer sem ninguém para
  // atender: um chat no site do cliente que recebe perguntas e nunca responde.
  const destino = await resolverDestinoDoWidget(res.locals.userId, { agentId, sectorId })
  if (!destino.ok) {
    res.status(destino.status).json({ error: destino.error, code: destino.code })
    return
  }

  const widget = await createWidget(res.locals.userId, name, {
    primaryColor: typeof primaryColor === 'string' ? primaryColor : undefined,
    welcomeTitle: typeof welcomeTitle === 'string' ? welcomeTitle : undefined,
    welcomeMessage: typeof welcomeMessage === 'string' ? welcomeMessage : undefined,
    position,
    // Atendido por um setor OU por um agente, nunca pelos dois: o resolvedor já zerou
    // o lado que não vale, então trocar de destino não deixa o anterior gravado embaixo.
    sectorId: destino.sectorId,
    agentId: destino.agentId,
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
  /**
   * Trocar de destino é UMA decisão, não dois campos independentes.
   *
   * Antes cada um se resolvia sozinho e "limpar o outro lado" dependia da ordem em que
   * chegaram — com os dois preenchidos, o setor ganhava em silêncio. Agora a escolha é
   * validada inteira: exatamente um destino, e o outro lado sai zerado.
   */
  if (agentId !== undefined || sectorId !== undefined) {
    // A posse é conferida aqui: o widget de outra conta não é lido, e muito menos editado.
    const atual = await getWidgetById(new ObjectId(widgetId))
    if (!atual || atual.ownerId !== res.locals.userId) {
      res.status(404).json({ error: 'Widget not found' })
      return
    }
    const destino = await resolverDestinoDoWidget(res.locals.userId, {
      // O que não veio no corpo permanece: editar a cor não mexe em quem atende.
      agentId: agentId !== undefined ? agentId : (atual.agentId?.toString() ?? null),
      sectorId: sectorId !== undefined ? sectorId : (atual.sectorId?.toString() ?? null),
    })
    if (!destino.ok) {
      res.status(destino.status).json({ error: destino.error, code: destino.code })
      return
    }
    updates.agentId = destino.agentId
    updates.sectorId = destino.sectorId
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

/**
 * Um agente está num lugar só.
 *
 * Recusa antes de gravar quando alguém que entraria neste setor já é ETAPA de outro.
 * Mover um MEMBRO é silencioso e continua sendo (`enforceSingleMembership`) — não há o
 * que perder. Mover uma ETAPA não: ela é trabalho configurado, e apagá-la de outro
 * fluxo para acomodar este seria destruir o que alguém montou sem perguntar.
 */
async function recusarSeJaEhEtapaDeOutro(
  res: Response,
  ownerId: string,
  manter: ObjectId | null,
  agentIds: ObjectId[],
): Promise<boolean> {
  const conflitos = await stageConflicts(ownerId, manter, agentIds)
  if (conflitos.length === 0) return false
  const c = conflitos[0]
  res.status(409).json({
    error: `Este agente já é a etapa "${c.stageName}" do setor "${c.sectorName}". Um agente trabalha em um setor só — remova-o de lá antes.`,
    code: 'AGENT_ALREADY_IN_SECTOR',
    conflicts: conflitos,
  })
  return true
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
  // Um agente que já é etapa de outro setor não entra aqui — nem como membro, nem como
  // etapa. A recusa vem antes de qualquer gravação.
  const entrandoNovo = [...(parsed ?? []).map((x) => x.agentId), ...(team?.stages ?? []).map((e) => e.agentId)]
  if (await recusarSeJaEhEtapaDeOutro(res, res.locals.userId, null, entrandoNovo)) return

  const sector = await createSector(res.locals.userId, officeId, name, sectorColor, parsedMode, parsed ?? [], team)
  await enforceSingleMembership(res.locals.userId, sector._id, sector.members.map((m) => m.agentId))
  auditEntity(res, { id: sector._id.toString(), label: sector.name, floorId: sector.officeId?.toString() })
  res.status(201).json(serializeSector(sector as WithId<Sector>))
})

app.get('/api/sectors', requireAuth, async (req, res) => {
  const floorId = await scopedFloorId(res.locals.userId, req.query.floorId)
  const sectors = await listSectors(res.locals.userId, floorId)
  res.json(sectors.map(serializeSector))
})

/**
 * Esta mudança deixaria um setor USADO POR WIDGET sem conseguir atender?
 *
 * Quem edita o setor não vê a lista de widgets. Tirar o coordenador, esvaziar a equipe
 * ou virar "só organizar" derruba, em silêncio, um chat que está no ar — e a consequência
 * só aparece quando um visitante escreve e ninguém responde.
 *
 * Setor SEM widget não passa por aqui: ele continua editável como sempre, inclusive para
 * estados incompletos no meio de uma configuração.
 */
async function bloqueiaSePrejudicaWidget(
  ownerId: string,
  sectorId: ObjectId,
  proposto: { mode?: unknown; members?: { agentId: ObjectId }[]; coordinatorAgentId?: ObjectId | null; stages?: unknown },
  atual: { mode: string; members?: { agentId: ObjectId }[]; coordinatorAgentId?: ObjectId | null; stages?: unknown; name: string },
): Promise<{ error: string; widgets: { id: string; name: string }[] } | null> {
  const usados = await listWidgetsBySector(ownerId, sectorId)
  if (usados.length === 0) return null

  const doDono = await listAgents(ownerId)
  const veredito = resolveWidgetDestination({
    sectorId,
    sector: {
      _id: sectorId,
      name: atual.name,
      mode: (proposto.mode ?? atual.mode) as never,
      members: proposto.members ?? atual.members ?? [],
      coordinatorAgentId: proposto.coordinatorAgentId !== undefined ? proposto.coordinatorAgentId : (atual.coordinatorAgentId ?? null),
      stages: (proposto.stages ?? atual.stages ?? []) as never,
      knownAgentIds: doDono.map((a) => a._id.toString()),
    },
  })
  if (veredito.ok) return null
  return {
    error: `${veredito.reason} — e ${usados.length} widget(s) dependem dele.`,
    widgets: usados.map((w) => ({ id: w._id.toString(), name: w.name })),
  }
}

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
  // Quem entraria neste setor — por membro ou por etapa — não pode ser etapa de outro.
  const entrando = [
    ...(updates.members ?? []).map((m) => m.agentId),
    ...(updates.stages ?? []).map((e) => e.agentId),
  ]
  if (await recusarSeJaEhEtapaDeOutro(res, res.locals.userId, new ObjectId(sectorId), entrando)) return

  const prejuizo = await bloqueiaSePrejudicaWidget(
    res.locals.userId,
    new ObjectId(sectorId),
    { mode: updates.mode, members: updates.members, coordinatorAgentId: updates.coordinatorAgentId, stages: updates.stages },
    existing,
  )
  if (prejuizo) {
    res.status(409).json({ error: prejuizo.error, code: 'sector_in_use_by_widget', widgets: prejuizo.widgets })
    return
  }

  const sector = await updateSector(res.locals.userId, new ObjectId(sectorId), updates)
  if (!sector) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }
  // A lista GRAVADA, e não a que veio no corpo: num pipeline ela é derivada das etapas,
  // e era por isso que um agente podia ser etapa de vários setores ao mesmo tempo — a
  // exclusividade era checada contra um array vazio.
  await enforceSingleMembership(res.locals.userId, sector._id, sector.members.map((m) => m.agentId))
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
  // Trocar os membros também pode derrubar um chat no ar: uma equipe esvaziada não atende.
  const prejuizoMembros = await bloqueiaSePrejudicaWidget(ownerId, new ObjectId(sectorId), { members: parsed }, existing)
  if (prejuizoMembros) {
    res.status(409).json({ error: prejuizoMembros.error, code: 'sector_in_use_by_widget', widgets: prejuizoMembros.widgets })
    return
  }

  const sector = await updateSector(ownerId, new ObjectId(sectorId), { members: parsed })
  if (!sector) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }
  await enforceSingleMembership(ownerId, sector._id, sector.members.map((m) => m.agentId))
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
// A mesma conversa guardada, do lado do setor: quem testa um time repete a pergunta
// tanto quanto quem testa um agente — e ali cada repetição acorda a equipe inteira.
app.get('/api/sectors/:sectorId/playground', requireAuth, async (req, res) => {
  const sectorId = String(req.params.sectorId)
  if (!ObjectId.isValid(sectorId)) {
    res.status(400).json({ error: 'Invalid sector id' })
    return
  }
  const sector = await getSectorById(res.locals.userId, new ObjectId(sectorId))
  if (!sector) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }
  res.json({ turns: await loadPlaygroundTurns(res.locals.userId, 'sector', sector._id) })
})

app.delete('/api/sectors/:sectorId/playground', requireAuth, async (req, res) => {
  const sectorId = String(req.params.sectorId)
  if (!ObjectId.isValid(sectorId)) {
    res.status(400).json({ error: 'Invalid sector id' })
    return
  }
  const sector = await getSectorById(res.locals.userId, new ObjectId(sectorId))
  if (!sector) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }
  await clearPlaygroundTurns(res.locals.userId, 'sector', sector._id)
  res.status(204).end()
})

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

  const mode: SectorMode = normalizeSectorMode(sector.mode)
  if (mode === 'organization') {
    // Continua não executável: é agrupamento no mapa, não equipe.
    res.status(400).json({ error: 'Este setor apenas agrupa agentes e não executa. Use um setor orquestrado ou pipeline.' })
    return
  }

  /**
   * O time roda DE VERDADE — o mesmo executor da delegação e do canal.
   *
   * O que havia aqui antes era outra coisa com o mesmo nome: um modelo auxiliar
   * escolhia nomes de especialistas, buscava trechos e uma única inferência era feita
   * com o membro marcado como padrão. O coordenador não era chamado, `coordinatorAgentId`
   * e `stages` não eram lidos, e nenhum especialista executava. Um setor cujo pesquisador
   * tinha a série histórica respondia "não tenho esses dados" — e quem respondia era um
   * agente que, de fato, não tinha.
   *
   * Aqui é produção com duas diferenças, as duas deliberadas: a execução é marcada como
   * `test` (fica fora das métricas) e as ferramentas que ESCREVEM são removidas de toda
   * a cadeia. Testar não pode mandar e-mail de verdade.
   */
  // O teste também tem teto: o cliente devolve a marca de cada pergunta, e a contagem
  // sai daí. Sem isso o Playground seria o único lugar onde o agente pode perguntar sem
  // parar — justamente onde o dono vai avaliar se ele sabe conversar.
  const jaPerguntouSetor = countClarifications(history as { role: string; clarification?: boolean }[])
  const deps = playgroundDelegationDeps(jaPerguntouSetor)
  const setorParaExecutar = await deps.loadSector(res.locals.userId, sector._id)
  if (!setorParaExecutar) {
    res.status(404).json({ error: 'Sector not found' })
    return
  }
  if (mode === 'pipeline' ? (setorParaExecutar.stages ?? []).length === 0 : setorParaExecutar.members.length === 0 && !setorParaExecutar.coordinatorAgentId) {
    res.status(400).json({ error: mode === 'pipeline' ? 'Este pipeline não tem etapas configuradas.' : 'Este setor não tem coordenador nem membros.' })
    return
  }

  // O porteiro, ANTES de acordar o time.
  //
  // Aqui era o único caminho sem checagem de escopo — e o mais caro: uma pergunta sobre
  // a previsão do tempo num setor de restaurante acordava o coordenador, que podia
  // delegar, e quatro agentes trabalhavam para dizer "não sei disso". O chat e o canal
  // já barravam isso; o time não. O escopo é o do agente de configuração (coordenador,
  // ou o da primeira etapa num pipeline), o mesmo critério que o canal usa.
  const configId =
    mode === 'pipeline'
      ? setorParaExecutar.stages?.[0]?.agentId
      : (setorParaExecutar.coordinatorAgentId ??
        setorParaExecutar.members.find((m) => m.isDefault)?.agentId ??
        setorParaExecutar.members[0]?.agentId)
  const agenteConfig = configId ? await getAgentById(res.locals.userId, configId) : null
  if (agenteConfig && (agenteConfig.guardrailMode ?? 'none') === 'verification') {
    const chaveEscopo = `sector:${sector._id.toString()}`
    const veredito = await checkScope({
      scopeId: chaveEscopo,
      objective: agenteConfig.objective,
      history: history.slice(0, -1),
      message: lastUser.content,
      verificar: async () =>
        checkGuardrail(
          agenteConfig.objective,
          history.slice(0, -1),
          lastUser.content,
          agenteConfig.provider,
          auxModelFor(agenteConfig),
          await getProviderApiKey(res.locals.userId, agenteConfig.provider),
        ),
    })
    if (!veredito.inScope) {
      // Nenhuma execução é aberta: recusar não é trabalho do setor, e um registro vazio
      // em Execuções só sujaria a tela.
      guardarTurnoDeTeste(res.locals.userId, 'sector', sector._id, lastUser.content, { content: GUARDRAIL_REFUSAL_MESSAGE })
      res.json({ reply: GUARDRAIL_REFUSAL_MESSAGE, mode, refusedByGuardrail: true })
      return
    }
  }

  const buildingIdSetor = (await deps.buildingIdForFloor(res.locals.userId, setorParaExecutar.officeId)) ?? ''
  const correlationId = `playground:${sector._id.toString()}:${Date.now()}`
  const chaveExecucao = correlationId
  const execucaoSetorId = await startSectorExecution({
    executionKey: chaveExecucao,
    ownerId: res.locals.userId,
    sectorId: sector._id,
    sectorName: sector.name,
    sectorMode: mode,
    floorId: setorParaExecutar.officeId ?? null,
    buildingId: buildingIdSetor ? new ObjectId(buildingIdSetor) : null,
    source: 'manual',
    correlationId,
    // Trabalho real, fora dos números de produção.
    environment: 'test',
  })

  // A última pergunta é o pedido; o que veio antes é contexto. O executor trata as duas
  // coisas de forma diferente — instrução e dado — e misturá-las apagaria a distinção.
  const anteriores = history.slice(0, -1)
  const contexto = anteriores.length
    ? anteriores.map((m) => `${m.role === 'user' ? 'Visitante' : 'Agente'}: ${m.content}`).join('\n')
    : undefined

  // A trilha vem do CLIENTE, antes de a execução existir: é o que permite acompanhar sem
  // esperar a resposta. Opaca e curta; sem ela, nada é emitido.
  const traceSetor = typeof (req.body ?? {}).traceId === 'string' ? String(req.body.traceId).slice(0, 100) : null
  if (traceSetor) {
    traceEvent({
      ownerId: res.locals.userId,
      executionId: traceSetor,
      type: 'user_prompt',
      status: 'info',
      title: 'Pedido recebido',
      input: tracePreview(lastUser.content, 600),
      metadata: { sectorId: sector._id.toString(), mode },
    })
  }
  const ctxSetor = sectorRunContext({
    ownerId: res.locals.userId,
    buildingId: buildingIdSetor,
    correlationId,
    rootExecutionId: execucaoSetorId,
    traceId: traceSetor,
  })

  let run: Awaited<ReturnType<typeof executeSectorTeam>>
  try {
    run = await executeSectorTeam(deps, ctxSetor, setorParaExecutar, {
      objective: lastUser.content,
      input: contexto,
      sectorExecutionId: execucaoSetorId,
    })
    await finishSectorExecution(chaveExecucao, { status: 'succeeded' })
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : 'falha ao executar o setor'
    await finishSectorExecution(chaveExecucao, { status: /cancel/i.test(mensagem) ? 'canceled' : 'failed', errorKind: 'stage_failed' })
    // Erro controlado: a causa é uma categoria de configuração/execução, nunca prompt,
    // conteúdo de base ou credencial.
    res.status(502).json({ error: 'Não foi possível concluir a execução do setor.', code: 'sector_run_failed', problem: mensagem.slice(0, 300) })
    return
  }

  // O que o dono precisa ver para acreditar (ou não) na resposta: quem executou, em que
  // ordem, se havia base para consultar e quais documentos entraram. Sem conteúdo
  // interno, sem prompt, sem segredo.
  // A fundamentação do CONJUNTO. 'ok' se alguém achou; 'unavailable' se alguém não
  // conseguiu procurar — porque isso não é o mesmo que "não existe"; só então 'empty'.
  const status = run.participants.map((p) => p.grounding).filter(Boolean) as string[]
  const grounding = status.includes('ok')
    ? 'ok'
    : status.includes('unavailable')
      ? 'unavailable'
      : status.includes('empty')
        ? 'empty'
        : 'no_base'
  // Títulos e ids, sem repetição. Nunca o texto do documento.
  const vistas = new Set<string>()
  const sources = run.participants
    .flatMap((p) => p.sources ?? [])
    .filter((f) => {
      const chave = `${f.documentId ?? ''}:${f.title ?? ''}`
      if (vistas.has(chave)) return false
      vistas.add(chave)
      return true
    })

  // A pergunta do time, com as alternativas escritas no texto — o mesmo formato que vai
  // para qualquer canal.
  const respostaSetor = run.clarification?.options?.length
    ? `${run.output}${formatOptions(run.clarification.options)}`
    : run.output

  const participantesSetor = run.participants.map((p) => ({
    name: p.name,
    role: p.role,
    grounding: p.grounding ?? null,
    toolCalls: p.toolCalls ?? 0,
    inputTokens: p.usage?.inputTokens ?? 0,
    outputTokens: p.usage?.outputTokens ?? 0,
    durationMs: p.durationMs ?? 0,
    provider: p.provider ?? null,
    model: p.model ?? null,
    modelReason: p.modelReason ?? null,
    ...(p.stageName ? { stage: p.stageName, order: p.order } : {}),
  }))
  guardarTurnoDeTeste(res.locals.userId, 'sector', sector._id, lastUser.content, {
    content: respostaSetor,
    // O rastro por agente é METADE do que se testa num time: sem ele a conversa
    // guardada mostraria o texto e esconderia quem trabalhou, e a que preço.
    diagnostics: { participants: participantesSetor, executionId: execucaoSetorId.toString(), grounding, sources },
    ...(run.clarification ? { clarification: true, clarificationOptions: run.clarification.options ?? [] } : {}),
  })
  res.json({
    reply: respostaSetor,
    mode,
    ...(run.clarification
      ? { clarification: { question: run.clarification.question, reason: run.clarification.reason, options: run.clarification.options ?? [] } }
      : {}),
    // A identidade desta execução: dá para abrir o registro completo dela em Execuções.
    executionId: execucaoSetorId.toString(),
    // O custo e o tempo de CADA agente. Sem isto, o teste mostrava um texto e nada
    // sobre o que ele custou — e uma equipe de quatro agentes é quatro chamadas.
    participants: participantesSetor,
    // O total da execução, para não obrigar a somar de cabeça.
    usage: run.participants.reduce(
      (soma, p) => ({
        inputTokens: soma.inputTokens + (p.usage?.inputTokens ?? 0),
        outputTokens: soma.outputTokens + (p.usage?.outputTokens ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0 },
    ),
    durationMs: run.participants.reduce((soma, p) => soma + (p.durationMs ?? 0), 0),
    // Compatibilidade: a tela lia `specialists` para dizer quem foi consultado. Agora
    // são os que EXECUTARAM de verdade.
    specialists: run.participants.map((p) => p.name),
    grounding,
    sources,
    ...(run.warnings.length ? { warnings: run.warnings } : {}),
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

  // Os blocos da definição e a configuração de execução, saneados aqui como no PATCH: a
  // tela é uma das formas de chegar nesta rota, não a única.
  const corpoCriacao = req.body as Record<string, unknown>
  const textoOpcional = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.slice(0, 8000) : undefined)

  const agent = await createAgent(res.locals.userId, officeId, name, {
    objective: typeof objective === 'string' ? objective : undefined,
    role: textoOpcional(corpoCriacao.role),
    instructions: textoOpcional(corpoCriacao.instructions),
    constraints: textoOpcional(corpoCriacao.constraints),
    ...('runConfig' in corpoCriacao ? { runConfig: normalizeRunConfig(corpoCriacao.runConfig) } : {}),
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

  /**
   * Os blocos da definição: função, instruções e limites.
   *
   * Cada um só é tocado quando VEM no corpo — a mesma regra da fonte de uma rotina e do
   * destino de uma entrega. Um formulário que salva antes de carregar não pode apagar o
   * que o dono escreveu.
   *
   * Editar qualquer um deles marca `definitionEditedAt`. É essa marca que impede uma
   * troca de preset de sobrescrever texto humano depois.
   */
  const corpo = req.body as Record<string, unknown>
  // O agente gravado, para comparar. A marca de edição precisa significar "uma pessoa
  // escreveu isto", e não "o formulário salvou": a tela manda os quatro campos em todo
  // autosave, então marcar pela presença marcava tudo no primeiro salvamento — e a
  // sugestão de preset nascia morta, sem nunca ter o que preencher.
  const gravado = await getAgentById(res.locals.userId, new ObjectId(agentId))
  if (!gravado) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  let editouDefinicao = false
  const mudou = (campo: 'role' | 'instructions' | 'constraints' | 'objective', valor: string): boolean =>
    valor !== ((gravado as unknown as Record<string, unknown>)[campo] as string | undefined ?? '')
  for (const campo of ['role', 'instructions', 'constraints'] as const) {
    if (typeof corpo[campo] !== 'string') continue
    const valor = (corpo[campo] as string).slice(0, 8000)
    ;(updates as Record<string, unknown>)[campo] = valor
    if (mudou(campo, valor)) editouDefinicao = true
  }
  if (typeof objective === 'string' && mudou('objective', objective)) editouDefinicao = true
  if (editouDefinicao) (updates as Record<string, unknown>).definitionEditedAt = new Date()

  /**
   * Não há mais "trocar de preset": o tipo é escolhido na contratação e fica.
   *
   * O que existia aqui preenchia os campos vazios da definição ao trocar de molde. Sem
   * troca, não há o que preencher — o assistente de contratação já grava a definição
   * inicial no momento da criação, que é o único momento em que um molde tem sentido.
   */

  // Como o modelo é chamado. Saneado e limitado no servidor: a tela é uma das formas de
  // chegar aqui, não a única.
  if ('runConfig' in corpo) {
    ;(updates as Record<string, unknown>).runConfig = normalizeRunConfig(corpo.runConfig)
  }
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
  const { fields: modelFields, error: modelError } = parseAgentModelFields(req.body ?? {}, gravado)
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
    // As duas procedências, como em `fontesDoAgente`: os endereços do próprio agente
    // (consultados sob demanda) e os das rotinas (com horário e checkpoint).
    sourceCount:
      (agent.watchedSources?.length ?? 0) +
      routines.filter((r) => readSourceFromDefinition(r.draftDefinition).kind !== 'fixed').length,
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
/**
 * Grava o par pergunta/resposta da conversa de teste.
 *
 * É a TELA que se guarda, não a memória do agente: ele continua sem lembrar de teste
 * nenhum ao atender um visitante. O que muda é que trocar de aba deixou de apagar a
 * conversa — e repetir cinco perguntas para voltar ao ponto custava tokens de verdade.
 *
 * Nunca derruba a resposta: falhar ao gravar o histórico do Playground não é motivo para
 * o dono não receber o que acabou de pedir.
 */
function guardarTurnoDeTeste(
  ownerId: string,
  escopo: 'agent' | 'sector',
  escopoId: ObjectId,
  pergunta: string,
  resposta: Omit<PlaygroundTurn, 'role' | 'at'>,
): void {
  const agora = new Date()
  void appendPlaygroundTurns(ownerId, escopo, escopoId, [
    { role: 'user', content: pergunta, at: agora },
    { role: 'assistant', at: agora, ...resposta },
  ]).catch((erro) => console.error('não foi possível guardar a conversa de teste:', erro))
}

/**
 * A conversa de teste guardada deste agente.
 *
 * Sem isto o Playground recomeçava vazio a cada visita, e a única forma de recuperar o
 * ponto onde se estava era perguntar tudo de novo — pagando de novo.
 */
app.get('/api/agents/:agentId/playground', requireAuth, async (req, res) => {
  const agentId = String(req.params.agentId)
  if (!ObjectId.isValid(agentId)) {
    res.status(400).json({ error: 'Invalid agent id' })
    return
  }
  // A checagem de dono vem antes da leitura: a conversa é do dono do agente, e um id
  // válido de outra pessoa não pode virar uma consulta.
  const agent = await getAgentById(res.locals.userId, new ObjectId(agentId))
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  res.json({ turns: await loadPlaygroundTurns(res.locals.userId, 'agent', agent._id) })
})

/** Recomeçar do zero. É a única forma de apagar, e é explícita. */
app.delete('/api/agents/:agentId/playground', requireAuth, async (req, res) => {
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
  await clearPlaygroundTurns(res.locals.userId, 'agent', agent._id)
  res.status(204).end()
})

/**
 * O que já aconteceu nesta execução.
 *
 * O socket entrega ao vivo; isto existe para quem chegou depois — recarregou a página,
 * abriu o painel no meio. Escopo de dono: uma trilha de outra conta não existe aqui.
 */
app.get('/api/executions/:traceId/trace', requireAuth, (req, res) => {
  const traceId = String(req.params.traceId).slice(0, 100)
  res.json({ events: readTrace(traceId, res.locals.userId) })
})

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
    // O veredito fica lembrado: "e o tempo?" chega o dia inteiro e a resposta é sempre a
    // mesma. Pagar a checagem de novo a cada repetição é gastar para reconfirmar.
    const veredito = await checkScope({
      scopeId: agent._id.toString(),
      objective: agent.objective,
      history: history.slice(0, -1),
      message: lastUser.content,
      verificar: () =>
        checkGuardrail(agent.objective, history.slice(0, -1), lastUser.content, agent.provider, auxModelFor(agent), apiKey),
    })
    if (!veredito.inScope) {
      guardarTurnoDeTeste(res.locals.userId, 'agent', agent._id, lastUser.content, { content: GUARDRAIL_REFUSAL_MESSAGE })
      res.json({ reply: GUARDRAIL_REFUSAL_MESSAGE, refusedByGuardrail: true, handoff: false })
      return
    }
  }

  /**
   * O site ANTES da busca — o passo que faltava para um agente sozinho.
   *
   * No time, o executor compartilhado já fazia isso antes de perguntar à base. No chat de
   * UM agente, ninguém fazia: quem cadastrava um site via a pergunta ser respondida sem
   * ele, porque a base nunca tinha sido alimentada. A política da fonte decide se vale a
   * leitura, e o teto de espera impede que um site lento segure a resposta.
   */
  const fontesDoChat = await ensureFreshWithTimeout(res.locals.userId, agent._id, 'on_demand').catch(() => [])
  const lidasNoChat = fontesDoChat.filter((f) => f.refreshed)

  /**
   * A MESMA busca que o resto do sistema usa. Este era o buraco.
   *
   * Aqui chamava-se `searchKnowledge`, que é só a metade VETORIAL. A outra metade — a
   * comparação de texto — existe exatamente para o caso em que a vetorial não tem o que
   * comparar: um documento cujos trechos nunca foram gerados. E é esse o caso comum,
   * porque a indexação depende de um provedor externo que pode falhar.
   *
   * O efeito era o pior possível de diagnosticar: a página lida, o texto guardado e
   * visível na tela de Conhecimento, e o chat de teste respondendo "não tenho esse dado"
   * — enquanto a mesma pergunta, feita através de um setor, encontrava. Duas buscas
   * diferentes para a mesma base davam duas respostas diferentes.
   */
  const buscarBase = async (): Promise<{ context: string[]; status: GroundingStatus }> =>
    retrieveContext([agent._id], lastUser.content).catch((error) => {
      console.error('Playground knowledge search failed, replying without grounding:', error)
      return { context: [] as string[], status: 'unavailable' as GroundingStatus }
    })
  let leitura = await buscarBase()
  let knowledge: string[] = [...leitura.context]
  /**
   * Base vazia e um site cadastrado: lê UMA vez, e procura de novo.
   *
   * O modo diz com que frequência reler — não se a primeira leitura pode acontecer. Sem
   * isto, um agente recém-configurado responde "não encontrei nada" sobre um site que
   * ninguém nunca abriu.
   */
  if (leitura.status !== 'ok') {
    const iniciadas = await ensureFreshWithTimeout(res.locals.userId, agent._id, 'bootstrap').catch(() => [])
    if (iniciadas.some((f) => f.created > 0 || f.updated > 0 || (f.reindexed ?? 0) > 0)) {
      lidasNoChat.push(...iniciadas.filter((f) => f.refreshed))
      leitura = await buscarBase()
      knowledge = [...leitura.context]
    }
  }
  // Os endereços que o dono marcou para entrar sozinhos quando o agente é chamado.
  // Nunca lançam: site fora do ar não derruba o atendimento.
  for (const viva of await livePassagesFor(res.locals.userId, agent)) {
    knowledge.push(`[${viva.title}]\n${viva.content}`)
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
  // A manual test is a real execution too — it just is not PRODUCTION. It gets a
  // root marked `test`, so it is correlated and auditable while staying out of the
  // metrics by default.
  const manualRootKey = manualExecutionKey(manualEventKey)
  const manualRootId = await openRunningRoot({
    executionKey: manualRootKey,
    ownerId: res.locals.userId,
    buildingId: playgroundFloor?.buildingId ?? null,
    originFloorId: agent.officeId,
    source: 'manual',
    sourceRefId: agent._id,
    environment: 'test',
    createdAt: manualStartedAt,
  }).catch(() => null)

  /**
   * O balão deste agente enquanto ele responde.
   *
   * Conversar É trabalhar, e o mapa não sabia disso: rotina e delegação acendiam o
   * balão, atender alguém não acendia nada — quem abrisse o escritório enquanto um
   * agente conversava via um andar parado. O plano (§8.6) sempre pediu "geração de
   * resposta para canal → responding"; faltava a instrumentação.
   *
   * Vale também no teste: quem testa ESTÁ fazendo o agente trabalhar. O estado é
   * efêmero (TTL na projeção) e não entra em métrica nenhuma.
   */
  // A trilha do teste de UM agente: sem planejador e sem síntese, mas com pedido, base,
  // ferramentas e resposta — que é o caminho que ele percorre de verdade.
  const traceChat = typeof (req.body ?? {}).traceId === 'string' ? String(req.body.traceId).slice(0, 100) : null
  const trilhaChat = (entrada: Omit<TraceInput, 'ownerId' | 'executionId'>) => {
    if (!traceChat) return
    traceEvent({ ...entrada, ownerId: res.locals.userId, executionId: traceChat })
  }
  trilhaChat({
    type: 'user_prompt',
    status: 'info',
    title: 'Pedido recebido',
    input: tracePreview(lastUser.content, 600),
    metadata: { agentId: agent._id.toString(), agent: agent.name },
  })
  if (lidasNoChat.length > 0) {
    trilhaChat({
      type: 'rag',
      status: lidasNoChat.some((f) => f.error) ? 'error' : 'success',
      agentId: agent._id.toString(),
      title: `Fontes web — ${lidasNoChat.reduce((n, f) => n + f.created, 0)} nova(s), ${lidasNoChat.reduce((n, f) => n + f.updated, 0)} atualizada(s)`,
      metadata: {
        sources: lidasNoChat.map((f) => ({
          name: f.name,
          via: f.via ?? null,
          reason: f.reason,
          discovered: f.discovered,
          new: f.created,
          updated: f.updated,
          unchanged: f.unchanged,
          error: f.error ?? null,
        })),
      },
    })
  }
  // "Não achei" e "não consegui procurar" são coisas diferentes, e o painel dizia a
  // primeira nos dois casos — o que fazia uma busca quebrada parecer uma base vazia.
  trilhaChat({
    type: 'rag',
    status: knowledge.length > 0 ? 'success' : leitura.status === 'unavailable' ? 'error' : 'info',
    agentId: agent._id.toString(),
    title:
      knowledge.length > 0
        ? `Base do agente — ${knowledge.length} trecho(s)`
        : leitura.status === 'unavailable'
          ? 'Base do agente — não foi possível consultar'
          : leitura.status === 'no_base'
            ? 'Base do agente — sem base'
            : 'Base do agente — nada encontrado',
    metadata: { passages: knowledge.length, grounding: leitura.status },
  })

  const balao = createLiveTracker({
    ownerId: res.locals.userId,
    agentId: agent._id,
    floorId: agent.officeId ?? null,
    rootExecutionId: (manualRootId ?? agent._id).toString(),
  })
  balao.report('thinking')

  const recordManual = (status: 'succeeded' | 'failed' | 'timeout', u?: { inputTokens: number; outputTokens: number }, okToolCalls = 0, errorKind?: string) => {
    // `modeloDoChat` é resolvido abaixo; este fecho só roda depois da chamada.
    recordAgentEventSafe({
      eventKey: manualEventKey,
      ownerId: res.locals.userId,
      agentId: agent._id,
      buildingId: playgroundFloor?.buildingId ?? null,
      floorId: agent.officeId,
      rootExecutionId: manualRootId,
      source: 'manual',
      preset: agent.preset,
      status,
      startedAt: manualStartedAt,
      finishedAt: new Date(),
      inputTokens: u?.inputTokens ?? 0,
      outputTokens: u?.outputTokens ?? 0,
      // Sem o modelo no registro, "economia" não é verificável: trocar de modelo não muda
      // um token, muda o preço de cada um.
      model: modeloDoChat,
      toolCalls: okToolCalls,
      // `descartadosChat` é resolvido logo abaixo; este fecho só roda depois da chamada ao
      // modelo. Só campo e motivo — nunca prompt, resposta ou credencial.
      metadata: {
        ...(descartadosChat ? { runConfigDropped: descartadosChat } : {}),
        ...(errorKind ? { errorKind } : {}),
        // Perguntou em vez de responder. Sem contar isto não dá para saber se o recurso
        // está economizando ou irritando — que é a única pergunta que importa sobre ele.
        ...(pedidoDeEsclarecimento ? { clarificationRequested: true } : {}),
      },
    })
    void finishExecutionRoot(manualRootKey, {
      status: status === 'succeeded' ? 'succeeded' : 'failed',
      errorKind: status === 'succeeded' ? null : (errorKind ?? status),
    }).catch(() => undefined)
  }

  // As ferramentas ANTES do resolvedor. Resolvê-las depois, como estava, entregava uma
  // lista de riscos vazia — e com ela `toolChoice: 'required'` era descartado ("não há
  // ferramenta para tornar obrigatória") e o paralelismo nunca era oferecido, mesmo com
  // todas as ferramentas sendo de leitura. A lista resolvida aqui é a MESMA usada na
  // chamada abaixo: duas resoluções poderiam divergir.
  // Quantas vezes já se perguntou nesta conversa. O cliente devolve a marca que a
  // resposta anterior trouxe; ela só orienta o modelo e limita a ferramenta, então um
  // valor mentiroso aqui não abre nada — só faz o agente responder mais cedo.
  const jaPerguntouChat = countClarifications(history as { role: string; clarification?: boolean }[])
  // Se o turno ANTERIOR foi uma pergunta de esclarecimento, esta mensagem é a resposta
  // dela — e guardá-la é o que evita perguntar a mesma coisa amanhã. Determinístico: sem
  // modelo, sem token, e sem dar a agente nenhum o direito de escrever memória.
  const turnos = history as { role: string; content: string; clarification?: boolean }[]
  const anterior = turnos[turnos.length - 2] as
    | { role: string; content: string; clarification?: boolean; clarificationOptions?: string[] }
    | undefined
  if (anterior?.role === 'assistant' && anterior.clarification && lastUser.content.trim()) {
    // "2" ou "b" viram a opção que elas representam, aqui, sem modelo. Mandar o número
    // cru adiante gastaria uma inferência para adivinhar o que já está escrito — e erra
    // justamente quando a conversa é longa e a lista ficou para trás.
    const escolhida = resolveChoice(lastUser.content, anterior.clarificationOptions ?? [])
    if (escolhida) lastUser.content = escolhida
    void rememberClarification({ ownerId: res.locals.userId, agentId: agent._id }, anterior.content, lastUser.content).catch(
      (erro) => console.error('não foi possível guardar o esclarecimento:', erro),
    )
  }
  const lembrados = await recallClarifications({ ownerId: res.locals.userId, agentId: agent._id }).catch(() => null)
  const chatTools = await resolveToolsWithDelegation(
    agent,
    res.locals.userId,
    // The manual test's own root, so its delegations are correlated to it and stay
    // marked as `test` rather than leaking into production numbers.
    rootContext({ ownerId: res.locals.userId, buildingId: playgroundBuildingId, correlationId: agent._id.toString(), agent, rootExecutionId: manualRootId }),
    productionDelegationDeps(),
    jaPerguntouChat,
  )
  const ferramentasDoChat = instrumentTools(chatTools, balao)
  const execucaoChat = resolveAgentRun(agent, { context: 'chat', toolRisks: chatTools.map((t) => t.risk ?? 'write') })
  // Quando nada foi escolhido, `model` é null e quem responde é a constante do adapter —
  // a tela precisa do nome dela para não dizer "—" no lugar do modelo que rodou.
  const provedorPadrao = defaultModel(agent.provider)
  // O modelo que vai rodar de fato, já resolvido — é ele que entra no registro.
  const modeloDoChat = execucaoChat.model ?? provedorPadrao
  const descartadosChat = describeDropped(execucaoChat.runConfig)
  if (descartadosChat) console.info(`[runConfig] chat: ${descartadosChat}`)

  let generated: string
  // Zerados e MUTÁVEIS de propósito: o que o provedor cobrou precisa sobreviver ao caminho
  // de falha. A versão anterior lançava antes de copiar o uso, e uma resposta que custou a
  // chamada original mais o reparo era registrada como zero token.
  let usage = { inputTokens: 0, outputTokens: 0 }
  let toolCalls: Awaited<ReturnType<typeof generateAgentReply>>['toolCalls'] = []
  let problemaContrato: string | null = null
  let pedidoDeEsclarecimento: ReturnType<typeof clarificationFrom> = null

  // A cobrança acontece UMA vez, dê certo ou não. A trava existe porque agora há dois
  // caminhos até aqui — o de sucesso e o de falha — e cobrar nos dois seria cobrar duas.
  let cobrado = false
  const cobrar = () => {
    if (cobrado || (usage.inputTokens === 0 && usage.outputTokens === 0)) return
    cobrado = true
    recordReplyUsage(res.locals.userId, usage).catch((error) =>
      console.error('Failed to record token usage:', error),
    )
  }

  balao.report('responding')
  try {
    const interativoChat = await runInteractive({
      reply: ({ objective, knowledge: k, memory: m, history: h, tools, signal, onToolStart }) =>
        generateAgentReply(
          objective,
          k,
          m,
          h,
          agent.provider,
          // O modelo RESOLVIDO: com "Automático" o campo guardado é um marcador.
          execucaoChat.model,
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
          execucaoChat.enableCaching,
          tools,
          { runConfig: execucaoChat.runConfig, signal, onToolStart },
        ),
      objective: composeAgentPrompt({
        definition: execucaoChat.definition,
        hasUntrustedContext: knowledge.length > 0,
        // Já perguntou antes? Então a orientação muda: da segunda vez em diante, decidir
        // e declarar a suposição vale mais que perguntar de novo.
        channelBlocks: [clarificationGuidance(jaPerguntouChat), lembrados].filter((b): b is string => Boolean(b)),
      }),
      knowledge,
      history,
      tools: ferramentasDoChat,
      runConfig: execucaoChat.runConfig,
      output: execucaoChat.definition.output,
    })
    // O uso PRIMEIRO, o julgamento depois: os tokens da resposta e do reparo já foram
    // gastos, e o provedor vai faturá-los independentemente de o JSON servir.
    usage = interativoChat.usage
    toolCalls = interativoChat.toolCalls
    // Contrato não cumprido: NÃO se entrega ao cliente um texto que o próprio sistema
    // sabe estar errado. O erro controlado deixa o caminho de falha decidir.
    if (!interativoChat.outputValid) {
      problemaContrato = interativoChat.outputProblem ?? 'JSON inválido'
      throw new AgentRunError('output_invalid', `a resposta não cumpriu o contrato de saída: ${problemaContrato}`)
    }
    generated = interativoChat.text
    // O agente perguntou em vez de responder: a marca acompanha o turno para a próxima
    // rodada saber que já houve uma pergunta.
    pedidoDeEsclarecimento = clarificationFrom(interativoChat.toolCalls)
    // As alternativas entram no TEXTO da resposta, e não como botão: elas precisam
    // aparecer igual no WhatsApp, no e-mail e em qualquer canal que só transporta texto.
    // Escrevê-las aqui, e não pedir ao modelo, é o que garante que apareçam sempre.
    if (pedidoDeEsclarecimento?.options?.length) {
      generated = `${generated}${formatOptions(pedidoDeEsclarecimento.options)}`
    }
  } catch (error) {
    const kind = error instanceof AgentRunError && error.kind === 'output_invalid'
      ? 'output_invalid'
      : /timeout|timed out|exceeded/i.test((error as Error).message ?? '') ? 'timeout' : 'failed'
    // Cobrança, métrica e auditoria também na falha — senão o contrato quebrado sairia de
    // graça nos números e a fatura do provedor não bateria com nada.
    cobrar()
    await balao.finish('failed')
    recordManual(kind === 'timeout' ? 'timeout' : 'failed', usage, toolCalls.filter((c) => c.ok).length, kind)
    if (kind === 'output_invalid') {
      // Erro controlado, e não um 500 genérico: 502 é a mesma resposta que este arquivo já
      // dá quando um serviço de fora devolve algo inutilizável. Quem chama aqui é o dono
      // testando o próprio agente, então o motivo da recusa de schema ajuda — mas o texto
      // do modelo e o prompt não saem daqui.
      res.status(502).json({ error: 'A resposta do modelo não cumpriu o formato JSON configurado e não foi entregue.', code: 'output_invalid', problem: problemaContrato })
      return
    }
    throw error
  }
  cobrar()
  await balao.finish('completed')
  // Only tool calls that actually COMPLETED count as tool actions.
  recordManual('succeeded', usage, toolCalls.filter((c) => c.ok).length)
  let reply = generated

  let handoff = false
  if (agent.handoffEnabled && reply.trimStart().startsWith(HANDOFF_MARKER)) {
    handoff = true
    reply = reply.trimStart().slice(HANDOFF_MARKER.length).trim()
  }
  const diagnosticoChat = {
    model: execucaoChat.model ?? provedorPadrao,
    modelChoice: (execucaoChat.modelReason ? 'auto' : agent.model ? 'manual' : 'default') as 'auto' | 'manual' | 'default',
    modelReason: execucaoChat.modelReason,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    durationMs: Math.max(0, Date.now() - manualStartedAt.getTime()),
    outputValid: true,
    ...(descartadosChat ? { runConfigDropped: descartadosChat } : {}),
  }
  trilhaChat({
    type: 'agent',
    status: 'success',
    agentId: agent._id.toString(),
    provider: agent.provider,
    model: diagnosticoChat.model,
    title: `${agent.name} respondeu`,
    output: tracePreview(reply, 600),
    durationMs: diagnosticoChat.durationMs,
    metadata: {
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      modelChoice: diagnosticoChat.modelChoice,
      modelReason: diagnosticoChat.modelReason,
      toolCalls: toolCalls.filter((c) => c.ok).length,
    },
  })
  trilhaChat({ type: 'final', status: 'success', title: 'Resposta final', output: tracePreview(reply, 800) })
  guardarTurnoDeTeste(res.locals.userId, 'agent', agent._id, lastUser.content, {
    content: reply,
    handoff,
    toolCalls,
    diagnostics: diagnosticoChat,
    ...(pedidoDeEsclarecimento
      ? { clarification: true, clarificationOptions: pedidoDeEsclarecimento.options ?? [] }
      : {}),
  })
  res.json({
    reply,
    refusedByGuardrail: false,
    handoff,
    toolCalls,
    /**
     * O que ACONTECEU nesta execução — e não só o que saiu dela.
     *
     * O modelo entra aqui porque "Automático" escolhe por regra, e uma regra em que se
     * confia sem conferir é um palpite com passos extras: quem testa precisa ver qual
     * modelo rodou e por quê. Os tokens e o tempo pela mesma razão — o teste custa, e o
     * custo estava invisível.
     *
     * Só números e categorias. Nunca prompt, nunca conteúdo de base, nunca credencial.
     */
    diagnostics: diagnosticoChat,
  })
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
  // Uma forma só: itens (sem conteúdo), total e o resumo. O conteúdo de um documento vem
  // pela rota dele — uma base alimentada por site tem centenas de artigos, e mandar todos
  // inteiros seria megabytes para desenhar uma lista.
  const pagina = await listDocumentsPage(
    { ownerType: 'agent', ownerId: agent._id },
    {
      kind: req.query.kind === 'web' || req.query.kind === 'manual' ? req.query.kind : 'all',
      sourceId: typeof req.query.sourceId === 'string' ? req.query.sourceId : null,
      status:
        req.query.status === 'indexed' || req.query.status === 'pending' || req.query.status === 'error'
          ? req.query.status
          : null,
      search: typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : null,
      limit: Number(req.query.limit) || 50,
      skip: Number(req.query.skip) || 0,
    },
  )
  res.json(pagina)
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

/**
 * "Tentar novamente" para um documento do AGENTE.
 *
 * Existia só para setor. No agente, um documento que falhou ao indexar não tinha como
 * ser reprocessado: a indexação só acontece na escrita, e o texto não muda — então ele
 * ficava com zero trechos, visível na tela e invisível para a busca, sem nada que o dono
 * pudesse fazer a respeito.
 */
app.post('/api/agents/:agentId/documents/:documentId/reindex', requireAuth, async (req, res) => {
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
  const doc = await reindexDocumentFor({ ownerType: 'agent', ownerId: agent._id }, new ObjectId(documentId))
  if (!doc) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  // Sem o conteúdo: a listagem não o carrega, e esta resposta atualiza a mesma linha.
  const { content: _conteudo, ...semConteudo } = doc as Record<string, unknown>
  res.json(semConteudo)
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
  /**
   * Excluir, e — se pedido — deixar de trazer de volta.
   *
   * Um documento web apagado volta no próximo scan, porque o endereço continua sendo da
   * fonte. Isso é correto e é surpresa: quem apagou não espera vê-lo de novo em meia
   * hora. `?ignore=1` grava o endereço canônico na lista de ignorados DA FONTE — e a
   * fonte continua existindo, com todo o resto que ela produziu.
   */
  const documento = await getDocument(agent._id, new ObjectId(documentId))
  const deleted = await deleteDocument(agent._id, new ObjectId(documentId))
  if (!deleted) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  const ignorar = req.query.ignore === '1' || req.query.ignore === 'true'
  if (ignorar && documento?.web?.canonicalUrl && documento.web.sourceId) {
    await ignoreWebUrl(res.locals.userId, agent._id, documento.web.sourceId, documento.web.canonicalUrl)
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
  // App desativado = o widget nem monta. Sem isto, "revogado" era um rótulo na tela do
  // dono enquanto o chat seguia atendendo no site do cliente.
  const acesso = await webChatAccessFor(widget.ownerId)
  if (!acesso.ok) {
    res.status(acesso.status!).json({ error: acesso.error, code: acesso.code })
    return
  }
  // O destino é revalidado AGORA: o agente pode ter sido excluído e o setor arquivado
  // depois de o widget ser criado. Sem isto o chat monta, aceita a pergunta e responde
  // com silêncio — o pior resultado possível num site de cliente.
  const destino = await resolveRuntimeDestination(widget)
  if (!destino.ok) {
    res.status(destino.status!).json({ error: destino.error, code: destino.code })
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
  // O histórico AUTENTICADO continua intacto — o dono vê tudo na aba de conversas. O que
  // para é a porta pública.
  const acesso = await webChatAccessFor(widget.ownerId)
  if (!acesso.ok) {
    res.status(acesso.status!).json({ error: acesso.error, code: acesso.code })
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
  /**
   * A recusa vem ANTES de qualquer gravação e de qualquer inferência.
   *
   * Uma recusa que custa uma chamada ao modelo não é uma recusa: o App está desativado e
   * a conta continuaria pagando por mensagem que ninguém vai ler.
   */
  const acesso = await webChatAccessFor(widget.ownerId)
  if (!acesso.ok) {
    res.status(acesso.status!).json({ error: acesso.error, code: acesso.code })
    return
  }
  // Idem, e aqui vale o dobro: antes de GRAVAR a mensagem e antes de disparar qualquer
  // execução. Recusar depois de gravar deixaria a conversa com uma pergunta que nunca
  // teve para onde ir.
  const destinoAtual = await resolveRuntimeDestination(widget)
  if (!destinoAtual.ok) {
    res.status(destinoAtual.status!).json({ error: destinoAtual.error, code: destinoAtual.code })
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
  // Com o modo econômico DESLIGADO as tarefas de bastidor usam o modelo do agente — e
  // "Automático" precisa virar um id de verdade aqui também, senão o marcador seguiria
  // para o provedor como se fosse nome de modelo.
  if (agent.cheapAuxModel === false) {
    return agent.model === AUTO_MODEL
      ? resolveAutoModel(agent, { main: null, aux: auxiliaryModel(agent.provider) }).model
      : agent.model
  }
  return auxiliaryModel(agent.provider)
}

// O roteador conversacional saiu daqui.
//
// Ele escolhia NOMES de especialistas com um modelo auxiliar, guardava o "agente ativo"
// da conversa e fazia uma inferência com o membro marcado como padrão — enquanto
// `delegate_to_sector` executava o time de verdade, com coordenador, grant e etapas.
// Dois comportamentos com o mesmo nome, e o do canal e do Playground era o que não
// executava ninguém. Agora os três chamam `executeSectorTeam`.
//
// O que foi embora junto, porque só existia para ele: `memberRoutingLine`,
// `buildStageTransitionOptions`, `resolveSectorTurn`, `SectorTurn`, o estado de agente
// ativo por conversa e os planejadores `planSectorResponse`/`planStageTransition`. Quem
// decide qual especialista responde agora é o coordenador do setor, com as ferramentas
// de delegação — e a decisão dele fica registrada como execução, não como palpite.

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
  // O setor rodado pelo executor único; ausente quando o canal aponta para um agente só.
  let setorDoCanal: Awaited<ReturnType<DelegationDeps['loadSector']>> = null
  const depsCanal = productionDelegationDeps()
  if (widget.sectorId) {
    // O MESMO executor da delegação e do Playground. O que havia aqui era uma segunda
    // implementação — planner escolhendo nomes, membro padrão respondendo sozinho — que
    // podia (e ia) divergir da execução real do time.
    const setor = await depsCanal.loadSector(ownerId, widget.sectorId)
    if (!setor || setor.mode === 'organization') return
    const coordenadorId = setor.coordinatorAgentId ?? setor.members.find((m) => m.isDefault)?.agentId ?? setor.members[0]?.agentId
    // Num pipeline o "agente de configuração" é o da primeira etapa: é dele o idioma, o
    // estilo e o guardrail com que o canal fala com o visitante.
    const configId = setor.mode === 'pipeline' ? setor.stages?.[0]?.agentId : coordenadorId
    const config = configId ? await getAgentById(ownerId, configId) : null
    if (!config) return
    setorDoCanal = setor
    agent = config
    replyObjective = config.objective
    knowledgeAgentIds = [config._id]
    replyAgentName = null
    clarificationTopics = null
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

  // Num canal não existe cliente para devolver a marca: ela sai do que está gravado.
  // É isto que faz o teto e a leitura de "2" valerem no WhatsApp, e não só no Playground.
  const jaPerguntouCanal = recentMessages.filter((m) => m.role === 'agent' && m.clarification).length
  const ultimaDoAgente = [...recentMessages].reverse().find((m) => m.role === 'agent')
  if (ultimaDoAgente?.clarification && recentMessages.at(-1)?.role === 'visitor') {
    const escolhida = resolveChoice(visitorContent, ultimaDoAgente.clarificationOptions ?? [])
    // "2" vira a opção aqui, sem modelo. E o par pergunta→resposta é guardado, para a
    // mesma dúvida não voltar amanhã.
    if (escolhida) visitorContent = escolhida
    void rememberClarification(
      { ownerId, agentId: agent._id, sectorId: widget.sectorId ?? null },
      ultimaDoAgente.content,
      visitorContent,
    ).catch((erro) => console.error('não foi possível guardar o esclarecimento:', erro))
  }
  const lembradosCanal = await recallClarifications({
    ownerId,
    agentId: agent._id,
    sectorId: widget.sectorId ?? null,
  }).catch(() => null)

  const historyLimit = agent.historyLimit ?? DEFAULT_HISTORY_LIMIT
  const history: ChatTurn[] = recentMessages.slice(-historyLimit).map((message) => ({
    role: message.role === 'visitor' ? 'user' : 'assistant',
    content: message.content,
  }))

  const apiKey = await getProviderApiKey(ownerId, agent.provider)

  if (guardrailMode === 'verification') {
    // Falha da checagem deixa passar (trata como dentro do escopo) em vez de recusar
    // todo mundo em silêncio quando a classificação der erro. E o veredito fica
    // lembrado: num canal movimentado a mesma pergunta fora de assunto chega o dia
    // inteiro, e repagar a checagem é gastar para reconfirmar.
    const veredito = await checkScope({
      scopeId: agent._id.toString(),
      objective: replyObjective,
      history,
      message: visitorContent,
      verificar: () => checkGuardrail(replyObjective, history, visitorContent, agent.provider, auxModelFor(agent), apiKey),
    })
    if (!veredito.inScope) {
      const refusal = await addMessage(widgetId, conversationId, 'agent', GUARDRAIL_REFUSAL_MESSAGE, replyAgentName)
      broadcastMessage(refusal, ownerId)
      return
    }
  }

  // O site antes da base, como no chat de teste: num canal ninguém está olhando, e
  // responder com a base de ontem é o pior dos dois mundos. Quando quem responde é um
  // SETOR, cada agente do time cuida da própria fonte dentro do executor.
  if (!setorDoCanal) await ensureFreshWithTimeout(ownerId, agent._id, 'on_demand').catch(() => [])

  // Ground the reply in the knowledge base(s) of the responding agent — or of
  // every consulted specialist, for a sector. Skipped when only clarifying.
  // Only a SECTOR-answered channel reads the sector's shared base; a widget wired
  // straight to one agent stays on that agent's own knowledge.
  const { context: knowledgeBase } = await retrieveContext(knowledgeAgentIds, visitorContent, { verifiedSectorId: widget.sectorId ?? null })
  const knowledge = [
    ...knowledgeBase,
    // Idem no canal: quem escolheu "sempre" ou "quando mudar" espera o conteúdo aqui.
    ...(await livePassagesFor(ownerId, agent)).map((viva) => `[${viva.title}]\n${viva.content}`),
  ]

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
  // A channel turn is a real execution: it gets a root like any other, so the
  // building's and the floor's numbers stop ignoring everything that arrives through
  // a channel. The key is derived from the message, so a redelivered webhook reuses
  // the same root instead of counting twice.
  const channelFloor = await getFloor(ownerId, agent.officeId).catch(() => null)
  const channelRootKey = channelExecutionKey(widget._id.toString(), conversationId, channelStartedAt.getTime().toString())
  const channelRootId = await openRunningRoot({
    executionKey: channelRootKey,
    ownerId,
    buildingId: channelFloor?.buildingId ?? null,
    originFloorId: agent.officeId,
    source: 'channel',
    sourceRefId: widget._id,
    createdAt: channelStartedAt,
  }).catch(() => null)

  const recordChannel = async (eventKey: string, status: 'succeeded' | 'failed' | 'timeout', u?: { inputTokens: number; outputTokens: number }, okToolCalls = 0, extra: Record<string, string | number | boolean> = {}) => {
    recordAgentEventSafe({
      ...channelEventBase,
      eventKey,
      buildingId: channelFloor?.buildingId ?? null,
      rootExecutionId: channelRootId,
      status,
      finishedAt: new Date(),
      inputTokens: u?.inputTokens ?? 0,
      outputTokens: u?.outputTokens ?? 0,
      model: modeloDoCanal,
      toolCalls: okToolCalls,
      // `descartadosCanal` é resolvido logo abaixo; este fecho só roda depois da chamada
      // ao modelo. Só campo e motivo — nunca prompt, resposta ou credencial.
      metadata: { channel: widget.channel ?? 'web', ...(widget.sectorId ? { sectorId: widget.sectorId.toString(), consulted: replyAgentName ?? '' } : {}), ...(descartadosCanal ? { runConfigDropped: descartadosCanal } : {}), ...extra },
    })
    // The turn ended, one way or another.
    await finishExecutionRoot(channelRootKey, {
      status: status === 'succeeded' ? 'succeeded' : 'failed',
      errorKind: status === 'succeeded' ? null : (typeof extra.errorKind === 'string' ? extra.errorKind : status),
    }).catch(() => undefined)
  }

  /**
   * O balão do agente que está atendendo AGORA.
   *
   * É aqui que mais importa: no canal ninguém está olhando a tela do teste — o mapa é
   * a única janela para o que está acontecendo. Antes, um agente conversando com um
   * visitante deixava o andar inteiro parecendo ocioso.
   */
  // Quando quem responde é um SETOR, cada agente do time reporta o próprio balão de
  // dentro do executor. Acender também um aqui duplicaria a linha do coordenador na
  // projeção — dois registros para um agente só, dizendo a mesma coisa.
  const balaoCanal = setorDoCanal
    ? NOOP_TRACKER
    : createLiveTracker({
        ownerId,
        agentId: agent._id,
        floorId: agent.officeId ?? null,
        rootExecutionId: (channelRootId ?? widget._id).toString(),
      })
  balaoCanal.report('thinking')

  const canalTools = instrumentTools(await resolveAgentTools(agent, ownerId, jaPerguntouCanal), balaoCanal)
  const execucaoCanal = resolveAgentRun(agent, { context: 'chat', toolRisks: canalTools.map((t) => t.risk ?? 'write') })
  const modeloDoCanal = execucaoCanal.model ?? defaultModel(agent.provider)
  const descartadosCanal = describeDropped(execucaoCanal.runConfig)
  if (descartadosCanal) console.info(`[runConfig] canal: ${descartadosCanal}`)

  balaoCanal.report('responding')
  let generatedReply: string
  let pedidoDoCanal: ClarificationRequest | null = null
  // Zerados e mutáveis: o que foi cobrado precisa sobreviver ao caminho de falha. Lançar
  // antes de copiar o uso, como estava, registrava zero token numa chamada que custou a
  // resposta original mais o reparo.
  let usage = { inputTokens: 0, outputTokens: 0 }
  let toolCalls: Awaited<ReturnType<typeof generateAgentReply>>['toolCalls'] = []

  let cobrado = false
  const cobrarCanal = () => {
    if (cobrado || (usage.inputTokens === 0 && usage.outputTokens === 0)) return
    cobrado = true
    recordReplyUsage(ownerId, usage).catch((error) => console.error('Failed to record token usage:', error))
  }

  try {
    if (setorDoCanal) {
      // O time executa: coordenador com acesso aos membros, ou as etapas em ordem. A
      // conversa entra como contexto; a última mensagem do visitante é o pedido.
      const buildingIdCanal = (await depsCanal.buildingIdForFloor(ownerId, setorDoCanal.officeId)) ?? ''
      const correlacao = `canal:${widgetId.toString()}:${conversationId}:${channelStartedAt.getTime()}`
      const execucaoSetorId = await startSectorExecution({
        executionKey: correlacao,
        ownerId,
        sectorId: setorDoCanal._id,
        sectorName: setorDoCanal.name,
        sectorMode: setorDoCanal.mode,
        floorId: setorDoCanal.officeId ?? null,
        buildingId: buildingIdCanal ? new ObjectId(buildingIdCanal) : null,
        source: 'channel',
        correlationId: correlacao,
      })
      const ctxCanal = sectorRunContext({ ownerId, buildingId: buildingIdCanal, correlationId: correlacao, rootExecutionId: execucaoSetorId })
      const anterioresCanal = history.slice(0, -1)
      try {
        const runSetor = await executeSectorTeam(depsCanal, ctxCanal, setorDoCanal, {
          objective: visitorContent,
          input: anterioresCanal.length
            ? anterioresCanal.map((m) => `${m.role === 'user' ? 'Visitante' : 'Agente'}: ${m.content}`).join('\n')
            : memoryText || undefined,
          sectorExecutionId: execucaoSetorId,
        })
        await finishSectorExecution(correlacao, { status: 'succeeded' })
        generatedReply = runSetor.output
        // O coordenador (ou a etapa final) pediu para restringir: a mesma marca e as
        // mesmas alternativas do caminho de agente único. Sem isto, o esclarecimento
        // funcionava entre agentes e sumia justamente quando quem perguntava era quem
        // fala com o visitante.
        pedidoDoCanal = runSetor.clarification ?? null
        if (pedidoDoCanal?.options?.length) {
          generatedReply = `${generatedReply}${formatOptions(pedidoDoCanal.options)}`
        }
        // Quem realmente falou, para o registro da conversa dizer a verdade.
        replyAgentName = runSetor.participants.map((p) => p.name).join(' + ') || null
      } catch (erro) {
        await finishSectorExecution(correlacao, { status: 'failed', errorKind: 'stage_failed' })
        throw erro
      }
    } else {
    const interativoCanal = await runInteractive({
      reply: ({ objective, knowledge: k, memory: m, history: h, tools, signal, onToolStart }) =>
        generateAgentReply(
          objective,
          k,
          m,
          h,
          agent.provider,
          execucaoCanal.model,
          apiKey,
          identityInstruction,
          behaviorInstruction,
          responseStyleInstruction,
          execucaoCanal.enableCaching,
          tools,
          { runConfig: execucaoCanal.runConfig, signal, onToolStart },
        ),
      objective: composeAgentPrompt({
        definition: execucaoCanal.definition,
        taskInstruction: replyObjective === agent.objective ? '' : replyObjective,
        hasUntrustedContext: knowledge.length > 0,
        // O mesmo teto do chat, e o que já foi esclarecido com esta pessoa.
        channelBlocks: [clarificationGuidance(jaPerguntouCanal), lembradosCanal].filter((b): b is string => Boolean(b)),
      }),
      knowledge,
      memory: memoryText,
      history,
      tools: canalTools,
      runConfig: execucaoCanal.runConfig,
      output: execucaoCanal.definition.output,
    })
    // O uso PRIMEIRO, o julgamento depois: esses tokens já saíram, e o provedor vai
    // faturá-los tenha o JSON servido ou não.
    usage = interativoCanal.usage
    toolCalls = interativoCanal.toolCalls
    if (!interativoCanal.outputValid) {
      throw new AgentRunError('output_invalid', `a resposta não cumpriu o contrato de saída: ${interativoCanal.outputProblem ?? 'JSON inválido'}`)
    }
    generatedReply = interativoCanal.text
    pedidoDoCanal = clarificationFrom(interativoCanal.toolCalls)
    if (pedidoDoCanal?.options?.length) {
      // Escritas no texto: num canal não há botão, e a lista precisa viajar na mensagem.
      generatedReply = `${generatedReply}${formatOptions(pedidoDoCanal.options)}`
    }
    }
  } catch (error) {
    const kind = error instanceof AgentRunError && error.kind === 'output_invalid'
      ? 'output_invalid'
      : /timeout|timed out|exceeded/i.test((error as Error).message ?? '') ? 'timeout' : 'failed'
    // Cobrança, métrica e auditoria acontecem também aqui. As ferramentas que rodaram
    // rodaram de verdade — ficar de fora do registro por causa de um JSON malformado
    // esconderia ação real do dono da conversa.
    cobrarCanal()
    logToolCalls(widgetId, conversationId, toolCalls).catch((erro) => console.error('Failed to log tool calls:', erro))
    // A chave do evento é derivada da mensagem: um webhook reentregue reaproveita a mesma
    // em vez de contar duas vezes.
    void recordChannel(
      `msg-fail:${widgetId.toString()}:${conversationId}:${channelStartedAt.getTime()}`,
      kind === 'timeout' ? 'timeout' : 'failed',
      usage,
      toolCalls.filter((c) => c.ok).length,
      { errorKind: kind },
    )
    // Nada é enviado ao visitante: a resposta que não cumpre o contrato não vira mensagem,
    // não é transmitida pelo socket e não entra no histórico da conversa.
    await balaoCanal.finish('failed')
    throw error
  }
  await balaoCanal.finish('completed')
  cobrarCanal()
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

  const agentMessage = await addMessage(
    widgetId,
    conversationId,
    'agent',
    replyText,
    replyAgentName,
    null,
    // A marca fica com a mensagem: é dela que a próxima volta lê "já perguntei" e "2
    // significa a segunda opção".
    pedidoDoCanal?.options?.length ? { options: pedidoDoCanal.options } : pedidoDoCanal ? { options: [] } : null,
  )
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
          // `error.message` from fetch embeds the URL; the host is the diagnosis.
          console.error(`Structured output webhook delivery failed (${safeHost(agent.structuredOutputWebhookUrl ?? '')})`)
          void error
        })
      }
    }
  }
}

// Host only. A private URL in a log is a credential in a log.
const safeHost = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return 'destino inválido'
  }
}

async function sendStructuredOutputWebhook(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    // The owner's webhook URL frequently carries a token in the path or query, so
    // the log gets the host and the status — enough to diagnose, nothing to leak.
    console.error(`Structured output webhook returned ${response.status} (${safeHost(url)})`)
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
  ensureWebSearchIndexes().catch((error) => {
    console.error('Could not create the web search indexes:', error)
  })
  ensureEmbeddingUsageIndexes().catch((error) => {
    console.error('Could not create the embedding usage indexes:', error)
  })
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
