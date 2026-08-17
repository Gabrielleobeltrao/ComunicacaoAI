import { createHash } from 'node:crypto'
import { isExecutionMode, STEP_TYPES } from './types.js'
import { isConditionOperator } from './conditions.js'
import { isMemoryScope, isMemoryStrategy } from '../memory/model.js'
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
    case 'app.execute':
      if (!isNonEmptyString(config.appKey)) errors.push({ path: `${at}.appKey`, message: 'appKey is required' })
      if (!isNonEmptyString(config.actionKey)) errors.push({ path: `${at}.actionKey`, message: 'actionKey is required' })
      // Sob a permissão de quem a ação roda. Sem isto, a etapa não teria grant para
      // consultar — e um App só é alcançável por grant.
      if (!isNonEmptyString(config.ownerAgentId)) errors.push({ path: `${at}.ownerAgentId`, message: 'ownerAgentId is required' })
      if (config.args !== undefined && !isRecord(config.args)) errors.push({ path: `${at}.args`, message: 'args must be an object' })
      break
    // As etapas de memória. O que é conferido aqui é o que, faltando, faria a etapa
    // gravar em lugar nenhum ou apagar demais — e isso não pode esperar a execução.
    case 'memory.write':
    case 'memory.search':
    case 'memory.delete': {
      if (!isMemoryScope(config.scope)) {
        errors.push({ path: `${at}.scope`, message: 'scope must be agent, sector, floor or building' })
      } else if (config.scope !== 'agent') {
        // Escopo do agente aceita destino implícito (o próprio agente responsável);
        // os outros exigem dizer QUAL, senão a gravação não tem para onde ir.
        const campo = config.scope === 'sector' ? 'sectorId' : config.scope === 'floor' ? 'floorId' : 'buildingId'
        if (!isNonEmptyString(config[campo])) errors.push({ path: `${at}.${campo}`, message: `${campo} is required for scope ${config.scope}` })
      }
      // Sob a permissão de quem a etapa age. Sem isto, uma definição vinda por outro
      // caminho gravaria sem checagem nenhuma.
      if (!isNonEmptyString(config.ownerAgentId)) errors.push({ path: `${at}.ownerAgentId`, message: 'ownerAgentId is required' })

      if (type === 'memory.write') {
        if (!isNonEmptyString(config.key)) errors.push({ path: `${at}.key`, message: 'key is required' })
        if (config.strategy !== undefined && !isMemoryStrategy(config.strategy)) {
          errors.push({ path: `${at}.strategy`, message: 'strategy must be append, upsert or replace' })
        }
        if (config.ttlSeconds !== undefined && (typeof config.ttlSeconds !== 'number' || !Number.isFinite(config.ttlSeconds) || config.ttlSeconds < 0)) {
          errors.push({ path: `${at}.ttlSeconds`, message: 'ttlSeconds must be a positive number' })
        }
      }
      if (type === 'memory.delete' && !isNonEmptyString(config.key) && !isNonEmptyString(config.recordId)) {
        // Sem chave nem id isto apagaria o destino inteiro, e uma etapa automática não
        // pode ter esse poder por omissão de configuração.
        errors.push({ path: `${at}.key`, message: 'memory.delete requires key or recordId' })
      }
      break
    }
  }
}

/**
 * A condição de uma etapa (`runIf`).
 *
 * Validar aqui importa mais que na maioria dos campos: uma condição malformada é
 * avaliada como falsa em tempo de execução — o que é seguro, mas silencioso. O dono
 * configuraria "chamar a IA quando o valor passar de 1000", nunca seria chamado, e
 * não teria como saber por quê. Recusar na publicação diz o problema na hora.
 */
function validateRunIf(raw: unknown, at: string, errors: ValidationIssue[]): void {
  if (raw === undefined || raw === null) return
  if (!isRecord(raw)) {
    errors.push({ path: at, message: 'runIf must be an object' })
    return
  }
  if (!isNonEmptyString(raw.source)) errors.push({ path: `${at}.source`, message: 'source is required' })
  if (!isConditionOperator(raw.operator)) {
    errors.push({ path: `${at}.operator`, message: `unknown operator: ${String(raw.operator)}` })
  }
  if (raw.path !== undefined && typeof raw.path !== 'string') errors.push({ path: `${at}.path`, message: 'path must be a string' })
  // Operadores que comparam precisam do quê comparar; `exists`/`absent` não.
  const comparativos = ['equals', 'not_equals', 'contains', 'gt', 'lt', 'matches']
  if (typeof raw.operator === 'string' && comparativos.includes(raw.operator) && (raw.value === undefined || raw.value === null || raw.value === '')) {
    errors.push({ path: `${at}.value`, message: `operator ${raw.operator} requires a value` })
  }
  if (raw.operator === 'matches' && typeof raw.value === 'string') {
    try {
      new RegExp(raw.value)
    } catch {
      errors.push({ path: `${at}.value`, message: 'value is not a valid regular expression' })
    }
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

  // O modo de execução. Ausente é válido e significa `ai`, que é o comportamento de
  // sempre; o que não vale é um valor que ninguém sabe interpretar.
  if (def.executionMode !== undefined && !isExecutionMode(def.executionMode)) {
    errors.push({ path: 'executionMode', message: `unknown executionMode: ${String(def.executionMode)}` })
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
    validateRunIf(s.runIf, `${at}.runIf`, errors)
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
