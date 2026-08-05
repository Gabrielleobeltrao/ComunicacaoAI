// The agent detail page's sub-sections, shared by the sidebar and the page.
// '' is the index (Visão geral). CONFIG entries also map to the AgentForm step
// whose fields they render.
export const AGENT_SECTIONS: { key: string; label: string }[] = [
  { key: '', label: 'Visão geral' },
  { key: 'testar', label: 'Testar' },
]

export const AGENT_CONFIG_SECTIONS: { key: string; label: string; step: number }[] = [
  { key: 'basico', label: 'Básico', step: 0 },
  { key: 'estilo', label: 'Estilo', step: 1 },
  { key: 'memoria', label: 'Memória', step: 2 },
  { key: 'guardrails', label: 'Guardrails', step: 3 },
  { key: 'identificacao', label: 'Identificação', step: 4 },
  { key: 'dados', label: 'Dados estruturados', step: 5 },
  { key: 'conhecimento', label: 'Base de conhecimento', step: 6 },
]
