import { createHash } from 'node:crypto'
import { STEP_TYPES } from './types.js'
import type { StepType } from './types.js'

// Pure validation + hashing for automation definitions. No DB / provider imports,
// so it is fully unit-testable. Unknown step types are rejected (never silently
// accepted, plan §8.7).

export interface ValidationIssue {
  path: string
  message: string
}
export interface ValidationResult {
  valid: boolean
  errors: ValidationIssue[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
function isHttpUrl(v: unknown): boolean {
  if (typeof v !== 'string') return false
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function validateStepConfig(type: StepType, config: Record<string, unknown>, at: string, errors: ValidationIssue[]): void {
  switch (type) {
    case 'source.rss':
    case 'source.http':
      if (!isHttpUrl(config.url)) errors.push({ path: `${at}.url`, message: 'url must be a valid http(s) URL' })
      break
    case 'agent.execute':
      if (!isNonEmptyString(config.agentId)) errors.push({ path: `${at}.agentId`, message: 'agentId is required' })
      if (!isNonEmptyString(config.instruction)) errors.push({ path: `${at}.instruction`, message: 'instruction is required' })
      break
    case 'transform.template':
      if (!isNonEmptyString(config.template)) errors.push({ path: `${at}.template`, message: 'template is required' })
      break
    case 'delivery.send':
      if (!isNonEmptyString(config.connectionId)) errors.push({ path: `${at}.connectionId`, message: 'connectionId is required' })
      if (!isNonEmptyString(config.fromStepId)) errors.push({ path: `${at}.fromStepId`, message: 'fromStepId is required' })
      break
  }
}

function hasCycle(steps: Array<{ id: string; dependsOn?: unknown }>): boolean {
  const deps = new Map(steps.map((s) => [s.id, Array.isArray(s.dependsOn) ? (s.dependsOn as string[]) : []]))
  const state = new Map<string, 0 | 1>() // 0 = visiting, 1 = done
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return false
    if (state.get(id) === 0) return true // back-edge → cycle
    state.set(id, 0)
    for (const d of deps.get(id) ?? []) if (deps.has(d) && visit(d)) return true
    state.set(id, 1)
    return false
  }
  return steps.some((s) => visit(s.id))
}

export function validateDefinition(def: unknown): ValidationResult {
  const errors: ValidationIssue[] = []
  if (!isRecord(def)) return { valid: false, errors: [{ path: '', message: 'definition must be an object' }] }

  const trigger = def.trigger
  if (!isRecord(trigger) || !['manual', 'schedule', 'webhook'].includes(String(trigger.type))) {
    errors.push({ path: 'trigger.type', message: 'invalid trigger type' })
  } else if (trigger.type === 'schedule') {
    if (!isNonEmptyString(trigger.timezone)) errors.push({ path: 'trigger.timezone', message: 'timezone is required' })
    if (!isNonEmptyString(trigger.cron)) errors.push({ path: 'trigger.cron', message: 'cron is required' })
  }

  if (!['text', 'markdown', 'json'].includes(String(def.resultFormat))) {
    errors.push({ path: 'resultFormat', message: 'invalid result format' })
  }

  const steps = Array.isArray(def.steps) ? (def.steps as Array<Record<string, unknown>>) : []
  if (steps.length === 0) errors.push({ path: 'steps', message: 'at least one step is required' })

  const ids = new Set<string>()
  steps.forEach((s, i) => {
    const at = `steps[${i}]`
    if (!isNonEmptyString(s.id)) errors.push({ path: `${at}.id`, message: 'id is required' })
    else if (ids.has(s.id)) errors.push({ path: `${at}.id`, message: 'duplicate step id' })
    else ids.add(s.id)
    if (!STEP_TYPES.includes(s.type as StepType)) {
      errors.push({ path: `${at}.type`, message: `unknown step type: ${String(s.type)}` })
      return
    }
    if (!isRecord(s.config)) errors.push({ path: `${at}.config`, message: 'config is required' })
    else validateStepConfig(s.type as StepType, s.config, `${at}.config`, errors)
  })

  steps.forEach((s, i) => {
    const dependsOn = Array.isArray(s.dependsOn) ? (s.dependsOn as string[]) : []
    for (const dep of dependsOn) {
      if (dep === s.id) errors.push({ path: `steps[${i}].dependsOn`, message: 'a step cannot depend on itself' })
      else if (!ids.has(dep)) errors.push({ path: `steps[${i}].dependsOn`, message: `unknown step: ${dep}` })
    }
  })

  if (steps.length > 0 && ids.size === steps.length && hasCycle(steps as Array<{ id: string; dependsOn?: unknown }>)) {
    errors.push({ path: 'steps', message: 'dependency cycle detected' })
  }

  return { valid: errors.length === 0, errors }
}

// Deterministic hash (sorted keys) so an unchanged definition hashes identically
// and any change yields a new hash — the basis for immutable versioning.
export function computeDefinitionHash(def: unknown): string {
  return createHash('sha256').update(canonical(def)).digest('hex')
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
}
