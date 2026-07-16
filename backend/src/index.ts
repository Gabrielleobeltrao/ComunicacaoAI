import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { auth } from './auth.js'
import { mongoClient } from './db.js'
import { toNodeHandler } from 'better-auth/node'

const app = express()
const port = process.env.PORT ?? 3001

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

async function start() {
  await mongoClient.connect()
  app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`)
  })
}

start()
