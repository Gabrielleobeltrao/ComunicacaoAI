import 'dotenv/config'
import { createServer } from 'node:http'
import cors from 'cors'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import multer from 'multer'
import { ObjectId } from 'mongodb'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { Server } from 'socket.io'
import {
  createAgent,
  getAgentById,
  getAgentByWidgetId,
  listAgents,
  setAgentWidget,
  updateAgent,
} from './agents.js'
import { auth } from './auth.js'
import { mongoClient } from './db.js'
import { extractTextFromFile } from './fileExtraction.js'
import {
  createDocument,
  deleteDocument,
  ensureVectorIndex,
  listDocuments,
  searchKnowledge,
} from './knowledge.js'
import { generateAgentReply, listModelsForProvider, PROVIDER_IDS, PROVIDER_INFO } from './llm.js'
import type { ChatTurn, Provider } from './llm.js'
import {
  clearProviderApiKey,
  getProviderApiKey,
  getProviderKeyStatus,
  setProviderApiKey,
} from './userSettings.js'
import type { WidgetMessage } from './widgets.js'
import {
  addMessage,
  addOwnerReply,
  createWidget,
  getConversationMessages,
  getWidgetById,
  getWidgetByPublicKey,
  listConversationsForOwner,
  listMessages,
  listWidgets,
  renameWidget,
} from './widgets.js'

const app = express()
const port = process.env.PORT ?? 4000
const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173'
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })

app.use(
  cors({
    origin: clientUrl,
    credentials: true,
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

app.post('/api/widgets', requireAuth, async (req, res) => {
  const { name } = req.body ?? {}
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const widget = await createWidget(res.locals.userId, name)
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
  const { name } = req.body ?? {}
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const widget = await renameWidget(res.locals.userId, new ObjectId(widgetId), name)
  if (!widget) {
    res.status(404).json({ error: 'Widget not found' })
    return
  }
  res.json(widget)
})

async function resolveOwnedWidgetId(ownerId: string, widgetId: unknown) {
  if (!widgetId) return { widgetObjectId: null, error: null }
  if (typeof widgetId !== 'string' || !ObjectId.isValid(widgetId)) {
    return { widgetObjectId: null, error: 'Invalid widget id' }
  }
  const widget = await getWidgetById(new ObjectId(widgetId))
  if (!widget || widget.ownerId !== ownerId) {
    return { widgetObjectId: null, error: 'Widget not found' }
  }
  return { widgetObjectId: widget._id, error: null }
}

app.post('/api/agents', requireAuth, async (req, res) => {
  const { name, widgetId, objective, provider, model } = req.body ?? {}
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (provider !== undefined && !isProvider(provider)) {
    res.status(400).json({ error: 'Unknown provider' })
    return
  }

  const { widgetObjectId, error } = await resolveOwnedWidgetId(res.locals.userId, widgetId)
  if (error) {
    res.status(400).json({ error })
    return
  }

  const agent = await createAgent(res.locals.userId, name, widgetObjectId, {
    objective: typeof objective === 'string' ? objective : undefined,
    provider,
    model: typeof model === 'string' || model === null ? model || null : undefined,
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
  const { name, objective, provider, model } = req.body ?? {}
  const updates: { name?: string; objective?: string; provider?: Provider; model?: string | null } = {}
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

app.post('/api/agents/:agentId/widget', requireAuth, async (req, res) => {
  const agentId = String(req.params.agentId)
  if (!ObjectId.isValid(agentId)) {
    res.status(400).json({ error: 'Invalid agent id' })
    return
  }

  const { widgetObjectId, error } = await resolveOwnedWidgetId(res.locals.userId, req.body?.widgetId)
  if (error) {
    res.status(400).json({ error })
    return
  }

  const agent = await setAgentWidget(res.locals.userId, new ObjectId(agentId), widgetObjectId)
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' })
    return
  }
  res.json(agent)
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
  res.json({ name: widget.name })
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
  respondWithAgentIfLinked(widget._id, widget.ownerId, conversationId, content).catch((error) => {
    console.error('Agent auto-reply failed:', error)
  })
})

async function respondWithAgentIfLinked(
  widgetId: ObjectId,
  ownerId: string,
  conversationId: string,
  visitorContent: string,
) {
  const agent = await getAgentByWidgetId(widgetId)
  if (!agent) return

  const recentMessages = await listMessages(widgetId, conversationId)
  const history: ChatTurn[] = recentMessages.slice(-10).map((message) => ({
    role: message.role === 'visitor' ? 'user' : 'assistant',
    content: message.content,
  }))

  let knowledge: string[] = []
  try {
    const results = await searchKnowledge(agent._id, visitorContent)
    knowledge = results.map((result) => result.content)
  } catch (error) {
    console.error('Knowledge search failed, replying without grounding:', error)
  }

  const apiKey = await getProviderApiKey(ownerId, agent.provider)
  const replyText = await generateAgentReply(
    agent.objective,
    knowledge,
    history,
    agent.provider,
    agent.model,
    apiKey,
  )
  if (!replyText) return

  const agentMessage = await addMessage(widgetId, conversationId, 'agent', replyText)
  broadcastMessage(agentMessage, ownerId)
}

async function start() {
  await mongoClient.connect()

  // Don't hold up accepting connections on this — it's a one-time setup
  // step (a no-op after the first successful run) and unrelated routes
  // shouldn't pay its round-trip to Atlas on every dev-server restart.
  ensureVectorIndex().catch((error) => {
    console.error('ensureVectorIndex failed:', error)
  })

  httpServer.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`)
  })
}

start()
