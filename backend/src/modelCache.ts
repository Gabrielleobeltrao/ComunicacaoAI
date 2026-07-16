import { createHash } from 'node:crypto'

const CACHE_TTL_MS = 10 * 60 * 1000

interface ModelOption {
  id: string
  label: string
}

const cache = new Map<string, { models: ModelOption[]; expiresAt: number }>()

function cacheKey(provider: string, apiKey: string) {
  return `${provider}:${createHash('sha256').update(apiKey).digest('hex')}`
}

export function getCachedModels(provider: string, apiKey: string): ModelOption[] | null {
  const entry = cache.get(cacheKey(provider, apiKey))
  if (!entry || entry.expiresAt < Date.now()) return null
  return entry.models
}

export function setCachedModels(provider: string, apiKey: string, models: ModelOption[]) {
  cache.set(cacheKey(provider, apiKey), { models, expiresAt: Date.now() + CACHE_TTL_MS })
}
