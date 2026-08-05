import { db } from './db.js'

export type IntegrationProvider = 'google'

// A connected third-party account (per owner). Tokens are stored encrypted
// (see crypto.ts), mirroring how BYOK provider keys are kept.
export interface Integration {
  ownerId: string
  provider: IntegrationProvider
  accountEmail: string
  accessToken: string
  refreshToken: string
  expiryDate: number
  scope: string
  createdAt: Date
  updatedAt: Date
}

const integrations = db.collection<Integration>('integrations')

export function getIntegration(ownerId: string, provider: IntegrationProvider) {
  return integrations.findOne({ ownerId, provider })
}

export async function saveIntegration(
  ownerId: string,
  provider: IntegrationProvider,
  data: Pick<Integration, 'accountEmail' | 'accessToken' | 'refreshToken' | 'expiryDate' | 'scope'>,
) {
  const now = new Date()
  await integrations.updateOne(
    { ownerId, provider },
    { $set: { ...data, updatedAt: now }, $setOnInsert: { ownerId, provider, createdAt: now } },
    { upsert: true },
  )
}

export async function updateAccessToken(
  ownerId: string,
  provider: IntegrationProvider,
  accessToken: string,
  expiryDate: number,
) {
  await integrations.updateOne({ ownerId, provider }, { $set: { accessToken, expiryDate, updatedAt: new Date() } })
}

export function deleteIntegration(ownerId: string, provider: IntegrationProvider) {
  return integrations.deleteOne({ ownerId, provider })
}
