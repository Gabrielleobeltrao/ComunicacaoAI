import { API_URL } from './api'

// Client + types for automations and runs (AI-building pivot). Gated by
// featureFlags.aiAutomations; the backend enforces ownership. Ids are strings.
export type AutomationStatus = 'draft' | 'active' | 'paused' | 'archived'
export type TriggerType = 'manual' | 'schedule' | 'webhook'
export type OutputFormat = 'text' | 'markdown' | 'json'
export type StepType = 'source.rss' | 'source.http' | 'agent.execute' | 'transform.template' | 'delivery.send'
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancel_requested' | 'canceled'

export interface StepDefinition {
  id: string
  name: string
  type: StepType
  enabled: boolean
  dependsOn: string[]
  inputMapping: Record<string, string>
  config: Record<string, unknown>
  timeoutMs: number
  retryPolicy: { maxAttempts: number; backoffMs: number }
  continueOnError: boolean
}
export interface AutomationDefinition {
  trigger: { type: TriggerType; timezone?: string; cron?: string; requireSignature?: boolean }
  inputs: unknown[]
  steps: StepDefinition[]
  resultFormat: OutputFormat
  deliveries: unknown[]
  limits: { maxSteps: number; maxToolCalls: number; maxOutputChars: number; maxTokens: number | null }
}
export interface Automation {
  id: string
  floorId: string
  name: string
  description: string
  status: AutomationStatus
  draftDefinition: AutomationDefinition
  currentVersion: number
  lastPublishedVersion: number | null
  updatedAt: string
}
export interface ValidationIssue {
  path: string
  message: string
}
export interface RunSummary {
  id: string
  automationId: string
  floorId: string
  status: RunStatus
  triggerType: TriggerType
  startedAt: string | null
  finishedAt: string | null
  error: { kind: string; message: string } | null
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(String(res.status))
  return res.json() as Promise<T>
}
const req = (method: string, body?: unknown): RequestInit => ({
  method,
  credentials: 'include',
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const listAutomations = (floorId?: string) =>
  fetch(`${API_URL}/api/automations${floorId ? `?floorId=${floorId}` : ''}`, req('GET')).then(json<{ items: Automation[]; total: number }>)
export const getAutomation = (id: string) => fetch(`${API_URL}/api/automations/${id}`, req('GET')).then(json<Automation>)
export const createAutomation = (input: { floorId: string; name: string; description?: string }) =>
  fetch(`${API_URL}/api/automations`, req('POST', input)).then(json<Automation>)
export const patchAutomation = (id: string, patch: { name?: string; description?: string; definition?: AutomationDefinition }) =>
  fetch(`${API_URL}/api/automations/${id}`, req('PATCH', patch)).then(json<Automation>)
export const validateAutomation = (id: string) =>
  fetch(`${API_URL}/api/automations/${id}/validate`, req('POST')).then(json<{ valid: boolean; errors: ValidationIssue[] }>)
export const publishAutomation = (id: string) => fetch(`${API_URL}/api/automations/${id}/publish`, req('POST'))
export const setAutomationStatus = (id: string, action: 'activate' | 'pause' | 'archive') =>
  fetch(`${API_URL}/api/automations/${id}/${action}`, req('POST')).then(json<Automation>)
export const runAutomation = (id: string, input?: unknown) =>
  fetch(`${API_URL}/api/automations/${id}/runs`, req('POST', { input })).then(json<{ id: string; status: RunStatus }>)

export const listRuns = (query?: { floorId?: string; automationId?: string }) => {
  const qs = new URLSearchParams(query as Record<string, string>).toString()
  return fetch(`${API_URL}/api/runs${qs ? `?${qs}` : ''}`, req('GET')).then(json<{ items: RunSummary[]; total: number }>)
}
export const getRun = (id: string) => fetch(`${API_URL}/api/runs/${id}`, req('GET')).then(json<RunSummary & { finalOutput: string }>)
export const getRunSteps = (id: string) => fetch(`${API_URL}/api/runs/${id}/steps`, req('GET')).then(json<Array<{ id: string; stepId: string; stepType: string; status: string; outputPreview: unknown; error: unknown }>>)
export const cancelRun = (id: string) => fetch(`${API_URL}/api/runs/${id}/cancel`, req('POST')).then(json<RunSummary>)

// A blank linear step of a given type with sensible defaults.
export function blankStep(type: StepType, index: number): StepDefinition {
  return {
    id: `s${index}`,
    name: type,
    type,
    enabled: true,
    dependsOn: index > 1 ? [`s${index - 1}`] : [],
    inputMapping: {},
    config: {},
    timeoutMs: 60000,
    retryPolicy: { maxAttempts: 1, backoffMs: 0 },
    continueOnError: false,
  }
}
