import type { GuardrailMode, MemoryType } from './types'

export const MEMORY_LABELS: Record<MemoryType, string> = {
  none: 'Sem memória',
  facts: 'Memória de fatos',
  structured: 'Memória estruturada',
  semantic: 'Memória semântica',
}

export const GUARDRAIL_LABELS: Record<GuardrailMode, string> = {
  none: 'Sem guardrail',
  prompt: 'Guardrail no prompt',
  verification: 'Guardrail por verificação',
}
