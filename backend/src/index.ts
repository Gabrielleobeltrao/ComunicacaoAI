import 'dotenv/config'
import { createServer } from 'node:http'
import cors from 'cors'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { ObjectId } from 'mongodb'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { Server } from 'socket.io'
import { auth } from './auth.js'
import { mongoClient } from './db.js'
import type { WidgetMessage } from './widgets.js'
import {
  addMessage,
  addOwnerReply,
  createWidget,
  getConversationMessages,
  getWidgetByPublicKey,
  listConversationsForOwner,
  listMessages,
  listWidgets,
} from './widgets.js'

const app = express()
const port = process.env.PORT ?? 4000
const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173'

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
})

async function start() {
  await mongoClient.connect()
  httpServer.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`)
  })
}

start()
