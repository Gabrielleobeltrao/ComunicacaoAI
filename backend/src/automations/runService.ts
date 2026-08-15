import { ObjectId } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { ValidationError } from '../building.js'
import { getAutomation } from './service.js'
import { findVersion } from './repository.js'
import { computeDefinitionHash } from './validate.js'
import { insertRunIdempotent } from './runRepository.js'
import type { AutomationRun } from './runTypes.js'
import type { TriggerType } from './types.js'

export interface CreateRunInput {
  triggerType?: TriggerType
  input?: unknown
  idempotencyKey?: string
}

// Create a run from an automation and enqueue it. Prefers the last published
// (immutable) version; falls back to the draft for a test run. Idempotent: the
// same idempotencyKey never creates or enqueues a second run.
export async function createRun(
  ownerId: string,
  automationId: ObjectId,
  input: CreateRunInput,
): Promise<{ run: AutomationRun; created: boolean }> {
  const automation = await getAutomation(ownerId, automationId)
  if (!automation) throw new ValidationError('automation not found')

  let definition = automation.draftDefinition
  let version = 0
  if (automation.lastPublishedVersion != null) {
    const published = await findVersion(ownerId, automationId, automation.lastPublishedVersion)
    if (published) {
      definition = published.definition
      version = published.version
    }
  }

  const idempotencyKey = input.idempotencyKey?.trim() || randomUUID()
  const run: AutomationRun = {
    _id: new ObjectId(),
    ownerId,
    buildingId: automation.buildingId,
    floorId: automation.floorId,
    automationId,
    automationVersion: version,
    definitionHash: computeDefinitionHash(definition),
    definitionSnapshot: definition,
    triggerType: input.triggerType ?? 'manual',
    triggerPayload: input.input ?? null,
    idempotencyKey,
    status: 'queued',
    currentStepId: null,
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    finalOutput: '',
    error: null,
  }

  // Inserting IS enqueuing: a run with status 'queued' is the queue entry. There
  // is no second system that could disagree with the database, and no enqueue that
  // could fail after the row was already written.
  return insertRunIdempotent(run)
}
