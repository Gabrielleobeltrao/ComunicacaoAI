import { ObjectId } from 'mongodb'
import { ensureDefaultBuilding, ValidationError } from '../building.js'
import { encrypt } from '../crypto.js'
import { generatePublicKey, generateSecret } from './webhook.js'
import { getFloor } from '../floors.js'
import { computeDefinitionHash, validateDefinition } from './validate.js'
import type { ValidationIssue } from './validate.js'
import * as repo from './repository.js'
import { DEFAULT_LIMITS } from './types.js'
import type { Automation, AutomationDefinition, AutomationStatus, AutomationVersion } from './types.js'

// Raised when a publish is attempted on an invalid definition; carries the
// structured issues for a 400 response.
export class AutomationValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super('automation definition is invalid')
    this.name = 'AutomationValidationError'
  }
}

function defaultDefinition(): AutomationDefinition {
  return {
    trigger: { type: 'manual' },
    inputs: [],
    steps: [],
    resultFormat: 'markdown',
    deliveries: [],
    limits: { ...DEFAULT_LIMITS },
  }
}

function normalizeName(name: unknown): string {
  const s = String(name ?? '').trim()
  if (!s || s.length > 160) throw new ValidationError('invalid automation name')
  return s
}

async function requireFloor(ownerId: string, floorId: string): Promise<ObjectId> {
  if (!ObjectId.isValid(floorId)) throw new ValidationError('invalid floorId')
  const floor = await getFloor(ownerId, new ObjectId(floorId))
  if (!floor) throw new ValidationError('invalid floorId')
  return floor._id
}

export interface CreateAutomationInput {
  floorId: string
  name: string
  description?: string
  definition?: AutomationDefinition
  agentId?: ObjectId // set when this automation is an agent routine
}

export async function createAutomation(ownerId: string, input: CreateAutomationInput): Promise<Automation> {
  const building = await ensureDefaultBuilding(ownerId)
  const floorId = await requireFloor(ownerId, input.floorId)
  const name = normalizeName(input.name)
  const definition = input.definition ?? defaultDefinition()
  const now = new Date()
  const doc: Automation = {
    _id: new ObjectId(),
    ownerId,
    buildingId: building._id,
    floorId,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    name,
    description: String(input.description ?? '').slice(0, 2000),
    status: 'draft',
    trigger: definition.trigger,
    draftDefinition: definition,
    currentVersion: 0,
    lastPublishedVersion: null,
    createdAt: now,
    updatedAt: now,
  }
  if (definition.trigger.type === 'webhook') {
    doc.webhookPublicKey = generatePublicKey()
    doc.webhookSecretEncrypted = encrypt(generateSecret())
  }
  await repo.insertAutomation(doc)
  return doc
}

export function getAutomation(ownerId: string, id: ObjectId): Promise<Automation | null> {
  return repo.findAutomation(ownerId, id)
}

export function listAutomations(ownerId: string, q: { floorId?: string; status?: string; limit: number; skip: number }) {
  const floorId = q.floorId && ObjectId.isValid(q.floorId) ? new ObjectId(q.floorId) : undefined
  return repo.listAutomations(ownerId, { floorId, status: q.status, limit: q.limit, skip: q.skip })
}

export interface UpdateDraftPatch {
  name?: string
  description?: string
  definition?: AutomationDefinition
}

export async function updateDraft(ownerId: string, id: ObjectId, patch: UpdateDraftPatch): Promise<Automation | null> {
  const set: Partial<Automation> = {}
  if (patch.name !== undefined) set.name = normalizeName(patch.name)
  if (patch.description !== undefined) set.description = String(patch.description).slice(0, 2000)
  if (patch.definition !== undefined) {
    set.draftDefinition = patch.definition
    set.trigger = patch.definition.trigger
    if (patch.definition.trigger.type === 'webhook') {
      const existing = await repo.findAutomation(ownerId, id)
      if (existing && !existing.webhookPublicKey) {
        set.webhookPublicKey = generatePublicKey()
        set.webhookSecretEncrypted = encrypt(generateSecret())
      }
    }
  }
  return repo.updateAutomation(ownerId, id, set)
}

// Rotate (or create) the webhook signing secret. The plaintext secret is
// returned ONCE here and never again (only its encrypted form is stored).
export async function rotateWebhookSecret(ownerId: string, id: ObjectId): Promise<{ publicKey: string; secret: string } | null> {
  const automation = await repo.findAutomation(ownerId, id)
  if (!automation) return null
  const publicKey = automation.webhookPublicKey ?? generatePublicKey()
  const secret = generateSecret()
  await repo.updateAutomation(ownerId, id, { webhookPublicKey: publicKey, webhookSecretEncrypted: encrypt(secret) })
  return { publicKey, secret }
}

export async function validateAutomation(ownerId: string, id: ObjectId): Promise<{ valid: boolean; errors: ValidationIssue[] } | null> {
  const automation = await repo.findAutomation(ownerId, id)
  if (!automation) return null
  return validateDefinition(automation.draftDefinition)
}

// Publish an immutable version from the current draft. Re-publishing an unchanged
// draft returns the existing version (idempotent); any change creates a new one.
export async function publishAutomation(ownerId: string, id: ObjectId, createdBy: string): Promise<AutomationVersion | null> {
  const automation = await repo.findAutomation(ownerId, id)
  if (!automation) return null
  const result = validateDefinition(automation.draftDefinition)
  if (!result.valid) throw new AutomationValidationError(result.errors)

  const hash = computeDefinitionHash(automation.draftDefinition)
  if (automation.lastPublishedVersion != null) {
    const last = await repo.findVersion(ownerId, automation._id, automation.lastPublishedVersion)
    if (last && last.definitionHash === hash) return last // unchanged → no new version
  }

  const version = (automation.lastPublishedVersion ?? 0) + 1
  const doc: AutomationVersion = {
    _id: new ObjectId(),
    ownerId,
    automationId: automation._id,
    version,
    definition: automation.draftDefinition,
    definitionHash: hash,
    createdAt: new Date(),
    createdBy,
  }
  await repo.insertVersion(doc)
  await repo.updateAutomation(ownerId, id, { lastPublishedVersion: version, currentVersion: version })
  return doc
}

export async function setStatus(ownerId: string, id: ObjectId, status: AutomationStatus): Promise<Automation | null> {
  if (status === 'active') {
    const automation = await repo.findAutomation(ownerId, id)
    if (!automation) return null
    if (automation.lastPublishedVersion == null) throw new ValidationError('publish a version before activating')
  }
  return repo.updateAutomation(ownerId, id, { status })
}

export function listVersions(ownerId: string, id: ObjectId): Promise<AutomationVersion[]> {
  return repo.listVersions(ownerId, id)
}
