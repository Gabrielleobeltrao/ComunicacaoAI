import 'dotenv/config'
import { createServer } from 'node:http'
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
  MEMORY_TYPES,
  RESPONSE_DETAILS,
  RESPONSE_TONES,
  updateAgent,
} from './agents.js'
import type {
  Agent,
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
import { createTeam, deleteTeam, getTeamById, listTeams, updateTeam } from './teams.js'
import type { Team, TeamMember, TeamMode, TeamTransition } from './teams.js'
import { ensureConversationTurnsVectorIndex, recordTurn, searchRelevantTurns } from './conversationTurns.js'
import { mongoClient } from './db.js'
import { extractTextFromFile } from './fileExtraction.js'
import {
  createDocument,
  deleteAllForAgent,
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
  planTeamResponse,
  PROVIDER_IDS,
  PROVIDER_INFO,
  updateConversationMemory,
  updateStructuredMemory,
} from './llm.js'
import type { ChatTurn, Provider } from './llm.js'
import type { RouterOption, StageTransitionOption } from './systemPrompt.js'
import { aggregateTeamDecisions, listTeamDecisionsForConversation, logTeamDecision } from './teamDecisions.js'
import {
  buildClarificationInstruction,
  buildIdentityCaptureInstruction,
  buildLanguageInstruction,
  buildPipelineStageObjective,
  buildProactivityInstruction,
  buildResponseStyleInstruction,
  buildTeamObjective,
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
import { getMonthlyTokens, getUsageSummary, recordReplyUsage } from './tokenUsage.js'
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
  createWidget,
  deleteWidget,
  getConversationMessages,
  getOwnerStats,
  getWidgetById,
  getWidgetByPublicKey,
  listConversationsForOwner,
  listMessages,
  listWidgets,
  setWidgetAvatar,
  updateWidget,
} from './widgets.js'

const app = express()
const port = process.env.PORT ?? 4000
const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173'
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })
const uploadAvatar = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } })
const AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

app.use(
  cors((req, callback) => {
    // Public widget endpoints are fetched by widget-loader.js from arbitrary
    // customer domains, so they need to allow any origin. They don't use
    // cookies (no requireAuth), so credentials stay off for that reflection.
    const isPublicWidgetRoute = req.path.startsWith('/api/public/')
    callback(null, isPublicWidgetRoute ? { origin: true, credentials: false } : { origin: clientUrl, credentials: true })
  }),
)

app.all('/api/auth/*splat', toNodeHandler(auth))

app.use(express.json())

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: clientUrl, credentials: true },
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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
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

async function resolveOwnedTeamId(ownerId: string, teamId: unknown) {
  if (!teamId) return { teamObjectId: null, error: null }
  if (typeof teamId !== 'string' || !ObjectId.isValid(teamId)) {
    return { teamObjectId: null, error: 'Invalid team id' }
  }
  const team = await getTeamById(ownerId, new ObjectId(teamId))
  if (!team) {
    return { teamObjectId: null, error: 'Team not found' }
  }
  return { teamObjectId: team._id, error: null }
}

app.post('/api/widgets', requireAuth, async (req, res) => {
  const { name, primaryColor, welcomeTitle, welcomeMessage, position, agentId, teamId } = req.body ?? {}
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (position !== undefined && !isWidgetPosition(position)) {
    res.status(400).json({ error: 'Invalid position' })
    return
  }

  const { teamObjectId, error: teamError } = await resolveOwnedTeamId(res.locals.userId, teamId)
  if (teamError) {
    res.status(400).json({ error: teamError })
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
    // A widget is answered by a team OR a single agent, never both.
    teamId: teamObjectId,
    agentId: teamObjectId ? null : agentObjectId,
  })
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
  const { name, primaryColor, welcomeTitle, welcomeMessage, position, agentId, teamId } = req.body ?? {}
  const updates: {
    name?: string
    primaryColor?: string | null
    welcomeTitle?: string | null
    welcomeMessage?: string | null
    position?: WidgetPosition
    agentId?: ObjectId | null
    teamId?: ObjectId | null
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
  // The widget target: a team wins over a single agent when both are sent.
  if (teamId !== undefined) {
    const { teamObjectId, error } = await resolveOwnedTeamId(res.locals.userId, teamId)
    if (error) {
      res.status(400).json({ error })
      return
    }
    updates.teamId = teamObjectId
    if (teamObjectId) updates.agentId = null
  }
  if (agentId !== undefined && !updates.teamId) {
    const { agentObjectId, error } = await resolveOwnedAgentId(res.locals.userId, agentId)
    if (error) {
      res.status(400).json({ error })
      return
    }
    updates.agentId = agentObjectId
    if (agentObjectId) updates.teamId = null
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

// ---- Teams (agent orchestration) ----

const MAX_TEAM_MEMBERS = 10
const MAX_STAGE_TRANSITIONS = 5

function serializeTeam(team: WithId<Team>) {
  return {
    _id: team._id.toString(),
    name: team.name,
    mode: team.mode ?? 'adaptive',
    members: team.members.map((m) => ({
      agentId: m.agentId.toString(),
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

async function resolveTeamMembers(
  ownerId: string,
  raw: unknown,
): Promise<{ members?: TeamMember[]; error?: string }> {
  if (!Array.isArray(raw)) return { error: 'members must be a list' }
  if (raw.length > MAX_TEAM_MEMBERS) return { error: `A team can have at most ${MAX_TEAM_MEMBERS} agents` }
  const members: TeamMember[] = []
  const rawTransitions: unknown[] = []
  const seen = new Set<string>()
  for (const m of raw) {
    if (typeof m !== 'object' || m === null) return { error: 'Invalid member' }
    const agentId = (m as { agentId?: unknown }).agentId
    if (typeof agentId !== 'string' || !ObjectId.isValid(agentId)) return { error: 'Invalid agent id in members' }
    if (seen.has(agentId)) return { error: 'The same agent appears twice in the team' }
    const agent = await getAgentById(ownerId, new ObjectId(agentId))
    if (!agent) return { error: 'Agent not found' }
    seen.add(agentId)
    const desc = (m as { routingDescription?: unknown }).routingDescription
    const advanceWhen = (m as { advanceWhen?: unknown }).advanceWhen
    members.push({
      agentId: agent._id,
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
    const transitions: TeamTransition[] = []
    for (const t of rt) {
      if (typeof t !== 'object' || t === null) return { error: 'Invalid transition' }
      const condition = (t as { condition?: unknown }).condition
      const targetAgentId = (t as { targetAgentId?: unknown }).targetAgentId
      if (typeof targetAgentId !== 'string' || !ObjectId.isValid(targetAgentId)) {
        return { error: 'Invalid transition target' }
      }
      if (!seen.has(targetAgentId)) return { error: 'Transition target is not a member of the team' }
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

function parseTeamMode(value: unknown): TeamMode | null {
  if (value === undefined) return 'adaptive'
  return value === 'adaptive' || value === 'pipeline' ? value : null
}

app.post('/api/teams', requireAuth, async (req, res) => {
  const { name, mode, members } = req.body ?? {}
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const parsedMode = parseTeamMode(mode)
  if (parsedMode === null) {
    res.status(400).json({ error: 'Unknown team mode' })
    return
  }
  const { members: parsed, error } = await resolveTeamMembers(res.locals.userId, members ?? [])
  if (error) {
    res.status(400).json({ error })
    return
  }
  const team = await createTeam(res.locals.userId, name, parsedMode, parsed ?? [])
  res.status(201).json(serializeTeam(team as WithId<Team>))
})

app.get('/api/teams', requireAuth, async (_req, res) => {
  const teams = await listTeams(res.locals.userId)
  res.json(teams.map(serializeTeam))
})

app.patch('/api/teams/:teamId', requireAuth, async (req, res) => {
  const teamId = String(req.params.teamId)
  if (!ObjectId.isValid(teamId)) {
    res.status(400).json({ error: 'Invalid team id' })
    return
  }
  const { name, mode, members } = req.body ?? {}
  const updates: { name?: string; mode?: TeamMode; members?: TeamMember[] } = {}
  if (typeof name === 'string' && name.trim()) updates.name = name
  if (mode !== undefined) {
    const parsedMode = parseTeamMode(mode)
    if (parsedMode === null) {
      res.status(400).json({ error: 'Unknown team mode' })
      return
    }
    updates.mode = parsedMode
  }
  if (members !== undefined) {
    const { members: parsed, error } = await resolveTeamMembers(res.locals.userId, members)
    if (error) {
      res.status(400).json({ error })
      return
    }
    updates.members = parsed
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'Nothing to update' })
    return
  }
  const team = await updateTeam(res.locals.userId, new ObjectId(teamId), updates)
  if (!team) {
    res.status(404).json({ error: 'Team not found' })
    return
  }
  res.json(serializeTeam(team))
})

app.delete('/api/teams/:teamId', requireAuth, async (req, res) => {
  const teamId = String(req.params.teamId)
  if (!ObjectId.isValid(teamId)) {
    res.status(400).json({ error: 'Invalid team id' })
    return
  }
  await deleteTeam(res.locals.userId, new ObjectId(teamId))
  res.status(204).end()
})

// Stateless team test chat: runs the supervisor (plan → merge specialists →
// one unified reply, or a clarification) over the supplied history. Nothing is
// persisted; also reports which specialists were consulted so the owner can see
// the orchestration decision.
app.post('/api/teams/:teamId/playground', requireAuth, async (req, res) => {
  const teamIdStr = String(req.params.teamId)
  if (!ObjectId.isValid(teamIdStr)) {
    res.status(400).json({ error: 'Invalid team id' })
    return
  }
  const team = await getTeamById(res.locals.userId, new ObjectId(teamIdStr))
  if (!team) {
    res.status(404).json({ error: 'Team not found' })
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
      team.members.map(async (m) => ({ member: m, agent: await getAgentById(res.locals.userId, m.agentId) })),
    )
  ).filter((x): x is { member: TeamMember; agent: WithId<Agent> } => x.agent !== null)
  if (resolved.length === 0) {
    res.status(400).json({ error: 'Team has no valid agents' })
    return
  }

  const defaultIndex = Math.max(
    0,
    resolved.findIndex((x) => x.member.isDefault),
  )
  const configAgent = resolved[defaultIndex].agent
  const apiKey = await getProviderApiKey(res.locals.userId, configAgent.provider)
  const teamObjectiveFor = (chosen: { member: TeamMember; agent: WithId<Agent> }[]) =>
    buildTeamObjective(
      team.name,
      chosen.map((x) => ({ name: x.agent.name, objective: x.agent.objective })),
    )

  const mode: TeamMode = team.mode ?? 'adaptive'
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
        console.error('Team playground stage transition planning failed, staying on current stage:', error)
      }
    }
    const stage = resolved[stageIndex]
    replyObjective = buildPipelineStageObjective(team.name, {
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
        description: x.member.routingDescription.trim() || x.agent.objective.trim() || x.agent.name,
      }))
      try {
        plan = await planTeamResponse(
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
        console.error('Team playground planning failed, using default specialist:', error)
      }
    }
    clarify = plan.clarify
    if (plan.clarify) {
      replyObjective = teamObjectiveFor(resolved)
      knowledgeAgentIds = []
      specialistNames = []
      clarificationTopics = resolved.map((x) => x.member.routingDescription.trim() || x.agent.name)
    } else {
      const chosen = plan.specialists.map((i) => resolved[i]).filter(Boolean)
      if (chosen.length === 0) chosen.push(resolved[defaultIndex])
      replyObjective = teamObjectiveFor(chosen)
      knowledgeAgentIds = chosen.map((x) => x.agent._id)
      specialistNames = chosen.map((x) => x.agent.name)
    }
  }

  let knowledge: string[] = []
  for (const id of knowledgeAgentIds) {
    try {
      const results = await searchKnowledge(id, lastUser.content)
      knowledge.push(...results.map((r) => r.content))
    } catch (error) {
      console.error('Team playground knowledge search failed:', error)
    }
  }

  const behaviorInstruction = [
    configAgent.guardrailMode === 'prompt' ? GUARDRAIL_SCOPE_INSTRUCTION : '',
    configAgent.handoffEnabled ? HANDOFF_INSTRUCTION : '',
    configAgent.proactivityEnabled ? buildProactivityInstruction(configAgent.proactivityGuidance ?? '') : '',
    clarificationTopics ? buildClarificationInstruction(clarificationTopics) : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const { text, usage } = await generateAgentReply(
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
  })
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

  const agent = await createAgent(res.locals.userId, name, {
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
  })
  res.status(201).json(agent)
})

app.get('/api/agents', requireAuth, async (_req, res) => {
  const agents = await listAgents(res.locals.userId)
  res.json(agents)
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
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'Nothing to update' })
    return
  }

  const agent = await updateAgent(res.locals.userId, new ObjectId(agentId), updates)
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  res.json(agent)
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
  // widgets/teams pointing at it. Block and tell the owner what to unlink first.
  const [widgets, teams] = await Promise.all([listWidgets(ownerId), listTeams(ownerId)])
  const usedByWidgets = widgets.filter((w) => w.agentId?.toString() === agentId).map((w) => w.name)
  const usedByTeams = teams
    .filter((t) => t.members.some((m) => m.agentId.toString() === agentId))
    .map((t) => t.name)
  if (usedByWidgets.length > 0 || usedByTeams.length > 0) {
    const refs = [
      ...usedByWidgets.map((n) => `widget "${n}"`),
      ...usedByTeams.map((n) => `equipe "${n}"`),
    ]
    res.status(409).json({
      error: `Este agente está em uso por ${refs.join(', ')}. Desvincule antes de excluir.`,
      widgets: usedByWidgets,
      teams: usedByTeams,
    })
    return
  }

  await deleteAllForAgent(agentObjectId)
  await deleteAgent(ownerId, agentObjectId)
  res.status(204).end()
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

  const { text: generated, usage } = await generateAgentReply(
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
  )
  recordReplyUsage(res.locals.userId, usage).catch((error) =>
    console.error('Failed to record token usage:', error),
  )
  let reply = generated

  let handoff = false
  if (agent.handoffEnabled && reply.trimStart().startsWith(HANDOFF_MARKER)) {
    handoff = true
    reply = reply.trimStart().slice(HANDOFF_MARKER.length).trim()
  }
  res.json({ reply, refusedByGuardrail: false, handoff })
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

app.get('/api/conversations', requireAuth, async (_req, res) => {
  const conversations = await listConversationsForOwner(res.locals.userId)
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

// Per-team analytics from the orchestration decision log: how often each
// specialist/stage handled a turn, how often the supervisor asked to clarify,
// and how many pipeline moves happened — so owners can tune their teams.
app.get('/api/team-analytics', requireAuth, async (_req, res) => {
  const [teams, agg] = await Promise.all([
    listTeams(res.locals.userId),
    aggregateTeamDecisions(res.locals.userId),
  ])

  const totalsByTeam = new Map(agg.totals.map((t) => [t._id.toString(), t]))
  const specialistsByTeam = new Map<string, { name: string; count: number }[]>()
  for (const s of agg.specialists) {
    const key = s._id.teamId.toString()
    const list = specialistsByTeam.get(key) ?? []
    list.push({ name: s._id.name, count: s.count })
    specialistsByTeam.set(key, list)
  }
  const leftByTeam = new Map<string, Map<string, number>>()
  for (const f of agg.fromStages) {
    const key = f._id.teamId.toString()
    const map = leftByTeam.get(key) ?? new Map<string, number>()
    map.set(f._id.name, f.count)
    leftByTeam.set(key, map)
  }

  const analytics = teams
    .map((team) => {
      const id = team._id.toString()
      const totals = totalsByTeam.get(id) ?? { decisions: 0, clarify: 0, moved: 0 }
      const left = leftByTeam.get(id) ?? new Map<string, number>()
      const specialists = (specialistsByTeam.get(id) ?? []).sort((a, b) => b.count - a.count)
      return {
        teamId: id,
        teamName: team.name,
        mode: team.mode ?? 'adaptive',
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
    const decisions = await listTeamDecisionsForConversation(res.locals.userId, widgetId, conversationId)
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
    res.status(201).json(message)
  },
)

// The agent that supplies widget-level settings (first message, conversation
// persistence, daily limit): the single linked agent, or a team's default member.
async function getWidgetConfigAgent(widget: WithId<Widget>) {
  if (widget.agentId) return getAgentById(widget.ownerId, widget.agentId)
  if (widget.teamId) {
    const team = await getTeamById(widget.ownerId, widget.teamId)
    const member = team?.members.find((m) => m.isDefault) ?? team?.members[0]
    if (member) return getAgentById(widget.ownerId, member.agentId)
  }
  return null
}

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

// The moves available out of a pipeline stage: its explicit transitions
// (skip/branch/back) plus the implicit linear advance to the next stage. Targets
// are indices into `resolved`; self-targets, out-of-range, and duplicates drop.
function buildStageTransitionOptions(
  resolved: { member: TeamMember; agent: WithId<Agent> }[],
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

interface TeamTurn {
  // The default member supplies the team voice + memory/identity/guardrail config.
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
async function resolveTeamTurn(
  widget: WithId<Widget>,
  teamId: ObjectId,
  conversationId: string,
  visitorContent: string,
): Promise<TeamTurn | null> {
  const ownerId = widget.ownerId
  const widgetId = widget._id
  const team = await getTeamById(ownerId, teamId)
  if (!team || team.members.length === 0) return null

  const resolved = (
    await Promise.all(
      team.members.map(async (m) => ({ member: m, agent: await getAgentById(ownerId, m.agentId) })),
    )
  ).filter((x): x is { member: TeamMember; agent: WithId<Agent> } => x.agent !== null)
  if (resolved.length === 0) return null

  const defaultIndex = Math.max(
    0,
    resolved.findIndex((x) => x.member.isDefault),
  )
  const configAgent = resolved[defaultIndex].agent
  const teamObjectiveFor = (chosen: { member: TeamMember; agent: WithId<Agent> }[]) =>
    buildTeamObjective(
      team.name,
      chosen.map((x) => ({ name: x.agent.name, objective: x.agent.objective })),
    )

  // Single-member team: no planning needed.
  if (resolved.length === 1) {
    await setActiveAgentId(widgetId, conversationId, resolved[0].agent._id)
    await logTeamDecision({
      ownerId,
      teamId,
      widgetId,
      conversationId,
      specialists: [resolved[0].agent.name],
      clarify: false,
    })
    return {
      configAgent,
      replyObjective: teamObjectiveFor(resolved),
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
  if ((team.mode ?? 'adaptive') === 'pipeline') {
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
    await logTeamDecision({
      ownerId,
      teamId,
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
      replyObjective: buildPipelineStageObjective(team.name, {
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
    description: x.member.routingDescription.trim() || x.agent.objective.trim() || x.agent.name,
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
    plan = await planTeamResponse(
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
    console.error('Team planning failed, using default specialist:', error)
  }

  if (plan.clarify) {
    await logTeamDecision({ ownerId, teamId, widgetId, conversationId, specialists: [], clarify: true })
    return {
      configAgent,
      replyObjective: teamObjectiveFor(resolved),
      knowledgeAgentIds: [],
      replyAgentName: team.name,
      clarificationTopics: resolved.map((x) => x.member.routingDescription.trim() || x.agent.name),
    }
  }

  const chosen = plan.specialists.map((i) => resolved[i]).filter(Boolean)
  if (chosen.length === 0) chosen.push(resolved[defaultIndex])
  const names = chosen.map((x) => x.agent.name)
  await logTeamDecision({ ownerId, teamId, widgetId, conversationId, specialists: names, clarify: false })
  await setActiveAgentId(widgetId, conversationId, chosen[0].agent._id)

  return {
    configAgent,
    replyObjective: teamObjectiveFor(chosen),
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

  // Resolve who answers. Single agent: itself. Team: the adaptive supervisor
  // picks the specialists (or asks to clarify) and merges them into one voice.
  let agent: WithId<Agent>
  let replyObjective: string
  let knowledgeAgentIds: ObjectId[]
  let replyAgentName: string | null
  let clarificationTopics: string[] | null
  if (widget.teamId) {
    const turn = await resolveTeamTurn(widget, widget.teamId, conversationId, visitorContent)
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
  // every consulted specialist, for a team. Skipped when only clarifying.
  let knowledge: string[] = []
  for (const knowledgeAgentId of knowledgeAgentIds) {
    try {
      const results = await searchKnowledge(knowledgeAgentId, visitorContent)
      knowledge.push(...results.map((result) => result.content))
    } catch (error) {
      console.error('Knowledge search failed, replying without grounding:', error)
    }
  }

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
  // For a team, a clarification instruction may override "answer" with "ask".
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

  const { text: generatedReply, usage } = await generateAgentReply(
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
  )
  recordReplyUsage(ownerId, usage).catch((error) => console.error('Failed to record token usage:', error))
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
  await mongoClient.connect()

  // Don't hold up accepting connections on this — it's a one-time setup
  // step (a no-op after the first successful run) and unrelated routes
  // shouldn't pay its round-trip to Atlas on every dev-server restart.
  ensureVectorIndex().catch((error) => {
    console.error('ensureVectorIndex failed:', error)
  })
  ensureConversationTurnsVectorIndex().catch((error) => {
    console.error('ensureConversationTurnsVectorIndex failed:', error)
  })

  httpServer.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`)
  })
}

start()
