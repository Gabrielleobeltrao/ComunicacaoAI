import { ObjectId } from 'mongodb'
import type { ArchitectStamp } from '../architectStamp.js'
import { resolveOwnedSectorId } from '../sectors.js'
import { ensureDefaultBuilding, ValidationError } from '../building.js'
import { encrypt } from '../crypto.js'
import { generatePublicKey, generateSecret } from './webhook.js'
import { getFloor } from '../floors.js'
import { computeDefinitionHash, validateDefinition } from './validate.js'
import type { ValidationIssue } from './validate.js'
import * as repo from './repository.js'
import { ensureActivationMode, getAgentById } from '../agents.js'
import { agentsReferencedBy, isLiveWebhook } from './webhookTriggers.js'
import { DEFAULT_LIMITS } from './types.js'
import type { Automation, AutomationDefinition, AutomationStatus, AutomationTrigger, AutomationVersion } from './types.js'

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
  /** A marca do Arquiteto, quando foi ele que criou. Ver `architectStamp.ts`. */
  architect?: ArchitectStamp
}

export async function createAutomation(ownerId: string, input: CreateAutomationInput): Promise<Automation> {
  if (input.definition) await assertOwnedSectorRefs(ownerId, input.definition)
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
    ...(input.architect ? { architect: input.architect } : {}),
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
  if (patch.definition) await assertOwnedSectorRefs(ownerId, patch.definition)
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


// Every sectorId a definition references, so it can be authorised before the
// definition is ever stored or published. Pure.
export function collectSectorRefs(def: AutomationDefinition): string[] {
  const ids = new Set<string>()
  for (const step of def?.steps ?? []) {
    const raw = (step?.config ?? {}).sectorId
    if (typeof raw === 'string' && raw.trim()) ids.add(raw.trim())
  }
  return [...ids]
}

// EARLY AUTHORISATION: a definition may only reference sectors of the SAME account.
// Being a syntactically valid ObjectId is never enough. The error is deliberately
// uniform so it never reveals whether the id exists elsewhere.
export async function assertOwnedSectorRefs(ownerId: string, def: AutomationDefinition): Promise<void> {
  const refs = collectSectorRefs(def)
  if (refs.length === 0) return
  for (const raw of refs) {
    const owned = await resolveOwnedSectorId(ownerId, raw)
    if (!owned) {
      throw new AutomationValidationError([{ path: 'steps.config.sectorId', message: 'setor indisponível para esta conta' }])
    }
  }
}

// Every agent an `agent.execute` step names must exist, belong to THIS owner and
// live in the same building as the automation. Anything else is refused with a
// uniform message that never reveals whether the id belongs to someone else.
export async function assertOwnedAgentRefs(ownerId: string, def: AutomationDefinition, buildingId: ObjectId): Promise<void> {
  const refs = new Set<string>()
  for (const step of def.steps ?? []) {
    if (step.type !== 'agent.execute') continue
    const id = step.config?.agentId
    if (typeof id === 'string' && id.trim()) refs.add(id.trim())
    // A step with no agent at all is a shape problem, reported by validateDefinition.
  }
  if (refs.size === 0) return

  const fail = () => {
    throw new AutomationValidationError([{ path: 'steps.config.agentId', message: 'agente indisponível para esta conta' }])
  }
  for (const raw of refs) {
    if (!ObjectId.isValid(raw)) fail()
    const agent = await getAgentById(ownerId, new ObjectId(raw))
    if (!agent) fail() // another owner, or gone — indistinguishable on purpose
    const floor = await getFloor(ownerId, agent!.officeId)
    if (!floor || !floor.buildingId.equals(buildingId)) fail()
  }
}

export async function validateAutomation(ownerId: string, id: ObjectId): Promise<{ valid: boolean; errors: ValidationIssue[] } | null> {
  const automation = await repo.findAutomation(ownerId, id)
  if (!automation) return null
  const result = validateDefinition(automation.draftDefinition)
  // Ownership of referenced sectors AND agents is part of "is this definition
  // valid?" — the validate endpoint must report the SAME uniform errors that
  // create/update/publish use, instead of calling a draft valid that could never run.
  try {
    await assertOwnedSectorRefs(ownerId, automation.draftDefinition)
    await assertOwnedAgentRefs(ownerId, automation.draftDefinition, automation.buildingId)
  } catch (error) {
    if (!(error instanceof AutomationValidationError)) throw error
    return { valid: false, errors: [...result.errors, ...error.issues] }
  }
  return result
}

// Same schedule, or a different one? Only the fields that decide WHEN it fires.
function sameTrigger(a: AutomationTrigger | null, b: AutomationTrigger | null): boolean {
  const shape = (t: AutomationTrigger | null) =>
    t ? `${t.type}|${(t as { cron?: string }).cron ?? ''}|${(t as { timezone?: string }).timezone ?? ''}` : ''
  return shape(a) === shape(b)
}

// Publish an immutable version from the current draft. Re-publishing an unchanged
// draft returns the existing version (idempotent); any change creates a new one.
export async function publishAutomation(ownerId: string, id: ObjectId, createdBy: string): Promise<AutomationVersion | null> {
  const automation = await repo.findAutomation(ownerId, id)
  if (!automation) return null
  const result = validateDefinition(automation.draftDefinition)
  if (!result.valid) throw new AutomationValidationError(result.errors)
  // Re-check on publish: a draft stored before this rule (or edited elsewhere) must
  // not become an immutable version that references another account's sector — or an
  // agent that does not exist, belongs to someone else, or lives in another building.
  await assertOwnedSectorRefs(ownerId, automation.draftDefinition)
  await assertOwnedAgentRefs(ownerId, automation.draftDefinition, automation.buildingId)

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
  // The scheduler reads `publishedTrigger`, never the draft. When the cron, the
  // timezone or the trigger type changed, the pending fire is DROPPED here: without
  // this the automation would fire one last time at the old hour before the new
  // plan took effect. The next scheduler tick re-plans from the new trigger.
  const trigger = automation.draftDefinition.trigger
  const changed = !sameTrigger(automation.publishedTrigger ?? null, trigger)
  const published = await repo.updateAutomation(ownerId, id, {
    lastPublishedVersion: version,
    currentVersion: version,
    publishedTrigger: trigger,
    ...(changed ? { nextRunAt: null } : {}),
  })
  // Publishing an already-active webhook makes it live right now — the permission
  // has to follow, not wait for the next status change.
  if (published) await syncEventTriggerFor(ownerId, published)
  return doc
}

export async function setStatus(ownerId: string, id: ObjectId, status: AutomationStatus): Promise<Automation | null> {
  if (status === 'active') {
    const automation = await repo.findAutomation(ownerId, id)
    if (!automation) return null
    if (automation.lastPublishedVersion == null) throw new ValidationError('publish a version before activating')
    // Activating is the moment it can really fire: the definition about to run is
    // re-checked, so a version published before this rule cannot be switched on with
    // a foreign or cross-building agent.
    const published = await repo.findVersion(ownerId, automation._id, automation.lastPublishedVersion)
    if (published) {
      await assertOwnedSectorRefs(ownerId, published.definition)
      await assertOwnedAgentRefs(ownerId, published.definition, automation.buildingId)
    }
  }
  const updated = await repo.updateAutomation(ownerId, id, { status })
  if (updated) await syncEventTriggerFor(ownerId, updated)
  return updated
}

// Keep the 'event' permission in step with the webhooks that really exist. Only
// GRANTS: a paused/removed webhook never strips the permission, because another live
// webhook may still fire the same agent (and the UI reports the mismatch anyway).
// Ownership and building are enforced by loading the agent owner-scoped and by
// comparing it to the automation's own building.
export async function syncEventTriggerFor(ownerId: string, automation: Automation): Promise<void> {
  // Reason about what RUNS: the published version, never the draft.
  const published = automation.lastPublishedVersion == null ? null : ((await repo.findVersion(ownerId, automation._id, automation.lastPublishedVersion))?.definition ?? null)
  const live = { automation, published }
  if (!isLiveWebhook(live)) return
  for (const agentId of agentsReferencedBy(live)) {
    if (!ObjectId.isValid(agentId)) continue
    const agent = await getAgentById(ownerId, new ObjectId(agentId))
    if (!agent) continue
    const floor = await getFloor(ownerId, agent.officeId)
    if (!floor || !floor.buildingId.equals(automation.buildingId)) continue
    await ensureActivationMode(ownerId, agent._id, 'event')
  }
}

export function listVersions(ownerId: string, id: ObjectId): Promise<AutomationVersion[]> {
  return repo.listVersions(ownerId, id)
}
