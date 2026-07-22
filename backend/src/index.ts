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
  getAgentById,
  GUARDRAIL_MODES,
  listAgents,
  MEMORY_TYPES,
  RESPONSE_DETAILS,
  RESPONSE_TONES,
  updateAgent,
} from './agents.js'
import type {
  Agent,
  ConversationPersistence,
  GuardrailMode,
  MemoryType,
  ResponseDetail,
  ResponseTone,
} from './agents.js'
import { auth } from './auth.js'
import {
  getLinkedVisitorProfileId,
  getConversationMemory,
  getStructuredMemory,
  getStructuredOutputData,
  linkVisitorProfile,
  setConversationMemory,
  setStructuredMemory,
  setStructuredOutputData,
} from './conversationMemory.js'
import { ensureConversationTurnsVectorIndex, recordTurn, searchRelevantTurns } from './conversationTurns.js'
import { mongoClient } from './db.js'
import { extractTextFromFile } from './fileExtraction.js'
import {
  createDocument,
  deleteDocument,
  ensureVectorIndex,
  getDocument,
  listDocuments,
  searchKnowledge,
  updateDocument,
} from './knowledge.js'
import {
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
import {
  buildIdentityCaptureInstruction,
  buildResponseStyleInstruction,
  formatStructuredMemory,
  GUARDRAIL_REFUSAL_MESSAGE,
  GUARDRAIL_SCOPE_INSTRUCTION,
} from './systemPrompt.js'
import {
  clearProviderApiKey,
  getProviderApiKey,
  getProviderKeyStatus,
  setProviderApiKey,
} from './userSettings.js'
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
  createWidget,
  getConversationMessages,
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
  const status = await getProviderKeyStatus(res.locals.userId)
  res.json(status)
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

app.post('/api/widgets', requireAuth, async (req, res) => {
  const { name, primaryColor, welcomeTitle, welcomeMessage, position, agentId } = req.body ?? {}
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (position !== undefined && !isWidgetPosition(position)) {
    res.status(400).json({ error: 'Invalid position' })
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
    agentId: agentObjectId,
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
  const { name, primaryColor, welcomeTitle, welcomeMessage, position, agentId } = req.body ?? {}
  const updates: {
    name?: string
    primaryColor?: string | null
    welcomeTitle?: string | null
    welcomeMessage?: string | null
    position?: WidgetPosition
    agentId?: ObjectId | null
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
  if (agentId !== undefined) {
    const { agentObjectId, error } = await resolveOwnedAgentId(res.locals.userId, agentId)
    if (error) {
      res.status(400).json({ error })
      return
    }
    updates.agentId = agentObjectId
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
  } = req.body ?? {}
  if (!name) {
    res.status(400).json({ error: 'name is required' })
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

app.get('/api/public/widgets/:publicKey', async (req, res) => {
  const widget = await getWidgetByPublicKey(req.params.publicKey)
  if (!widget) {
    res.status(404).json({ error: 'Widget not found' })
    return
  }
  const agent = widget.agentId ? await getAgentById(widget.ownerId, widget.agentId) : null
  res.json({
    name: widget.name,
    primaryColor: widget.primaryColor,
    welcomeTitle: widget.welcomeTitle,
    welcomeMessage: widget.welcomeMessage,
    position: widget.position,
    avatarUrl: widget.avatarUrl,
    conversationPersistence: agent?.conversationPersistence ?? 'same_browser',
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
  const visitorMessage = await addMessage(widget._id, conversationId, 'visitor', content)
  broadcastMessage(visitorMessage, widget.ownerId)
  res.status(201).json([visitorMessage])

  // Fire-and-forget: the visitor's request doesn't wait on embeddings + Claude.
  // The reply (if any) arrives over the socket once it's ready.
  respondWithAgentIfLinked(widget, conversationId, content).catch((error) => {
    console.error('Agent auto-reply failed:', error)
  })
})

async function respondWithAgentIfLinked(widget: WithId<Widget>, conversationId: string, visitorContent: string) {
  const widgetId = widget._id
  const ownerId = widget.ownerId
  const agent = widget.agentId ? await getAgentById(ownerId, widget.agentId) : null
  if (!agent) return

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
      inScope = await checkGuardrail(agent.objective, history, visitorContent, agent.provider, agent.model, apiKey)
    } catch (error) {
      console.error('Guardrail check failed, allowing the message through:', error)
    }
    if (!inScope) {
      const refusal = await addMessage(widgetId, conversationId, 'agent', GUARDRAIL_REFUSAL_MESSAGE)
      broadcastMessage(refusal, ownerId)
      return
    }
  }

  let knowledge: string[] = []
  try {
    const results = await searchKnowledge(agent._id, visitorContent)
    knowledge = results.map((result) => result.content)
  } catch (error) {
    console.error('Knowledge search failed, replying without grounding:', error)
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
  const guardrailInstruction = guardrailMode === 'prompt' ? GUARDRAIL_SCOPE_INSTRUCTION : ''
  const responseStyleInstruction = buildResponseStyleInstruction(
    agent.responseTone ?? 'neutral',
    agent.responseDetail ?? 'balanced',
    agent.responseEmojis ?? false,
    agent.responseFormatting ?? false,
  )

  const replyText = await generateAgentReply(
    agent.objective,
    knowledge,
    memoryText,
    history,
    agent.provider,
    agent.model,
    apiKey,
    identityInstruction,
    guardrailInstruction,
    responseStyleInstruction,
  )
  if (!replyText) return

  const agentMessage = await addMessage(widgetId, conversationId, 'agent', replyText)
  broadcastMessage(agentMessage, ownerId)

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
      agent.model,
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
    const updated = await updateConversationMemory(current, visitorContent, replyText, agent.provider, agent.model, apiKey)
    if (visitorProfileId) await setVisitorProfileMemory(visitorProfileId, updated)
    else await setConversationMemory(widgetId, conversationId, updated)
  } else if (memoryType === 'structured') {
    const current = visitorProfileId
      ? ((await getVisitorProfile(visitorProfileId))?.structuredMemory ?? {})
      : await getStructuredMemory(widgetId, conversationId)
    const updated = await updateStructuredMemory(current, visitorContent, replyText, agent.provider, agent.model, apiKey)
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
    const updated = await extractStructuredOutput(fields, current, visitorContent, replyText, agent.provider, agent.model, apiKey)

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
