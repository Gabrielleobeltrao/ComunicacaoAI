import { API_URL } from './api'
import type { ActivationMode, AgentPreset, DelegationPolicy } from './types'

// The role-preset catalog (GET /api/agent-presets) that seeds the hiring wizard.
// A preset is a STARTING configuration — every field stays editable afterwards.
export interface AgentPresetSpec {
  preset: AgentPreset
  label: string
  description: string
  objective: string
  capabilities: string[]
  activationModes: ActivationMode[]
  inputContract: string
  outputContract: string
  // Sugestões da definição, por bloco. Preenchem campo vazio e nunca passam por cima de
  // texto humano — ver `applyPreset` no assistente.
  role?: string
  instructions?: string
  constraints?: string
  // Safe per-role defaults applied at hiring; editable later under "Avançado".
  delegationPolicy: DelegationPolicy
  callerPolicy: DelegationPolicy
  requiresTool?: boolean
}

export const listAgentPresets = () =>
  fetch(`${API_URL}/api/agent-presets`, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.json() as Promise<AgentPresetSpec[]>
  })
