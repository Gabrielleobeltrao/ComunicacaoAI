import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { auth } from './auth.js'
import { mongoClient } from './db.js'
import { addMessage, createWidget, getWidgetByPublicKey, listMessages, listWidgets } from './widgets.js'

const app = express()
const port = process.env.PORT ?? 4000

app.use(
  cors({
    origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
    credentials: true,
  }),
)

app.all('/api/auth/*splat', toNodeHandler(auth))

app.use(express.json())

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
  res.status(201).json([visitorMessage])
})

async function start() {
  await mongoClient.connect()
  app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`)
  })
}

start()
