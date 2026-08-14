// A REAL mongod for the integration tests (mongodb-memory-server downloads and runs
// the actual binary — not a mock). A single-node REPLICA SET so multi-document
// transactions are available, which is what production (Atlas) provides.
import { MongoMemoryReplSet } from 'mongodb-memory-server'

let server = null

export async function startMongo() {
  if (server) return server.getUri()
  server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  return server.getUri()
}

export async function stopMongo() {
  if (server) {
    await server.stop()
    server = null
  }
}
