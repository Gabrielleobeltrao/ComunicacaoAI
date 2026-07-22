import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { db } from './db.js'

export interface VisitorProfile {
  _id: ObjectId
  agentId: ObjectId
  identityKey: string
  identityValues: Record<string, string>
  memory: string
  structuredMemory: Record<string, string>
  structuredOutputData: Record<string, string>
  createdAt: Date
  updatedAt: Date
}

const visitorProfiles = db.collection<VisitorProfile>('visitor_profiles')

function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Stable key derived from the owner-defined identity fields (e.g. name + email),
// independent of field order, so the same visitor resolves to the same profile
// across different conversations/devices.
export function computeIdentityKey(identityFields: string[], values: Record<string, string>): string | null {
  const normalized = identityFields
    .map((field) => normalizeValue(values[field] ?? ''))
    .filter((value) => value.length > 0)

  if (normalized.length !== identityFields.length) return null

  const raw = normalized.join('|')
  return createHash('sha256').update(raw).digest('hex')
}

export async function findVisitorProfile(agentId: ObjectId, identityKey: string) {
  return visitorProfiles.findOne({ agentId, identityKey })
}

export async function upsertVisitorProfile(
  agentId: ObjectId,
  identityKey: string,
  identityValues: Record<string, string>,
) {
  const now = new Date()
  await visitorProfiles.updateOne(
    { agentId, identityKey },
    {
      $set: { identityValues, updatedAt: now },
      $setOnInsert: { agentId, identityKey, memory: '', structuredMemory: {}, structuredOutputData: {}, createdAt: now },
    },
    { upsert: true },
  )
  return visitorProfiles.findOne({ agentId, identityKey })
}

export async function getVisitorProfile(profileId: ObjectId) {
  return visitorProfiles.findOne({ _id: profileId })
}

export async function setVisitorProfileMemory(profileId: ObjectId, memory: string) {
  await visitorProfiles.updateOne({ _id: profileId }, { $set: { memory, updatedAt: new Date() } })
}

export async function setVisitorProfileStructuredMemory(profileId: ObjectId, structuredMemory: Record<string, string>) {
  await visitorProfiles.updateOne({ _id: profileId }, { $set: { structuredMemory, updatedAt: new Date() } })
}

export async function setVisitorProfileStructuredOutputData(
  profileId: ObjectId,
  structuredOutputData: Record<string, string>,
) {
  await visitorProfiles.updateOne({ _id: profileId }, { $set: { structuredOutputData, updatedAt: new Date() } })
}
