import { db } from './db.js'
import { decrypt, encrypt } from './crypto.js'
import type { Provider } from './llm.js'

export interface UserSettings {
  _id: string
  anthropicApiKeyEncrypted: string | null
  openaiApiKeyEncrypted: string | null
  updatedAt: Date
}

const settings = db.collection<UserSettings>('user_settings')

const FIELD_BY_PROVIDER: Record<Provider, keyof UserSettings> = {
  anthropic: 'anthropicApiKeyEncrypted',
  openai: 'openaiApiKeyEncrypted',
}

export async function setProviderApiKey(ownerId: string, provider: Provider, apiKey: string) {
  const field = FIELD_BY_PROVIDER[provider]
  await settings.updateOne(
    { _id: ownerId },
    { $set: { [field]: encrypt(apiKey), updatedAt: new Date() } },
    { upsert: true },
  )
}

export async function clearProviderApiKey(ownerId: string, provider: Provider) {
  const field = FIELD_BY_PROVIDER[provider]
  await settings.updateOne(
    { _id: ownerId },
    { $set: { [field]: null, updatedAt: new Date() } },
    { upsert: true },
  )
}

export async function getProviderKeyStatus(ownerId: string): Promise<Record<Provider, boolean>> {
  const doc = await settings.findOne({ _id: ownerId })
  return {
    anthropic: Boolean(doc?.anthropicApiKeyEncrypted),
    openai: Boolean(doc?.openaiApiKeyEncrypted),
  }
}

export async function getProviderApiKey(ownerId: string, provider: Provider): Promise<string | null> {
  const doc = await settings.findOne({ _id: ownerId })
  const field = FIELD_BY_PROVIDER[provider]
  const encrypted = doc?.[field]
  if (!encrypted || typeof encrypted !== 'string') return null

  try {
    return decrypt(encrypted)
  } catch (error) {
    console.error(`Failed to decrypt stored ${provider} API key:`, error)
    return null
  }
}
